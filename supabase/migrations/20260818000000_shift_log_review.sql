-- =============================================================================
-- Shift-log review: Owner/Admin decisions for Pending Review shifts
-- Migration: 20260818000000_shift_log_review
-- =============================================================================
--
-- WHY THIS EXISTS
-- A shift that submits with exception flags lands in status 'Pending Review'
-- and its hours sit in students.pending_hours. The status taxonomy has always
-- reserved 'Approved' and 'Rejected' (both recompute formulas already bucket
-- them: shift_log_check_out counts status IN ('Auto-Accepted','Approved') as
-- approved, and 'Rejected' as nothing) - but NOTHING in the application can
-- write them. WS1e-A4 removed the per-shift controls without replacing them,
-- so Pending Review is terminal: valid hours are stranded forever, and the
-- evaluation releases, certificates gates, and completion workflows that read
-- approved_hours can silently never fire.
--
-- THE MODEL
--   • shift_log_reviews - a strict APPEND-ONLY, DELETION-DURABLE audit ledger.
--     One row per decided shift, UNIQUE on the IMMUTABLE original_shift_log_id
--     (a plain uuid with no FK, so no deletion can ever erase WHICH shift and
--     WHICH student were reviewed). The ledger preserves the ORIGINAL
--     submitted values (status, hours, date, UNIT, PRECEPTOR, shift type,
--     flags, reason - unit/preceptor because unit_and_preceptor_mismatch is a
--     primary review reason), the student's name, the decision, the reviewer,
--     the rationale, the adjusted hours (adjust-and-approve only), every
--     warning the reviewer deliberately acknowledged, and the resulting
--     totals. Nobody - not even service_role - can UPDATE or DELETE a row.
--     Live FK links (shift_log_id/student_id) exist for convenient joins and
--     go NULL on source deletion; identity never depends on them.
--   • DELETE lockdown (section 6) - the durability audit found that
--     staff_all_students / staff_all_student_shift_logs (FOR ALL over
--     is_staff()) let EVERY active staff role, including viewer, delete
--     students and shift logs. Deletion narrows to active Owner/Admin;
--     SELECT/INSERT/UPDATE keep the exact same is_staff() predicate;
--     service_role (no repository evidence of any service-side delete)
--     loses DELETE on both tables.
--   • unit_name_key(text) - THE canonical unit identity, mirroring the client
--     (src/lib/unitNameCanon.js): lowercase, ALL whitespace stripped, so
--     '6NE', '6 NE', and case variants are the same unit in duplicate
--     detection exactly as they are everywhere else in the application.
--   • review_shift_log(...) - the ONLY writer of a review decision. It locks
--     the student row FOR UPDATE (the same serialization point as
--     shift_log_check_out AND submit_past_shift_log below, so a decision can
--     never interleave with any totals recompute), re-reads the shift under
--     the lock, verifies it is STILL 'Pending Review', computes same-day /
--     possible-duplicate warnings INSIDE the lock (canonical unit identity)
--     and refuses approval unless each one was explicitly acknowledged,
--     applies the decision, inserts the audit row, and recomputes
--     approved_hours/pending_hours from authoritative completed rows - one
--     transaction.
--   • submit_past_shift_log(...) - closes the LAST unserialized totals writer.
--     api/shift-log/submit-past-shift.js used to insert the completed row and
--     recompute totals client-side with NO lock ("must stay in sync"
--     duplication debt, documented non-transactional). This RPC performs the
--     insert (idempotent on the submission id) and the recompute under the
--     SAME student FOR UPDATE lock, so a past-shift submission and a review
--     decision serialize: whichever commits second recomputes over the full
--     final set, and a shift inserted concurrently with a review can never
--     evade the review's same-day/duplicate detection - the insert either
--     commits first (the locked review sees it) or waits for the review.
--   • shift_review_ready() - readiness probe. The review endpoint calls it
--     before ANY decision and fails closed with 'migration_required' until
--     this migration is applied. (submit-past-shift instead FALLS BACK to its
--     legacy non-atomic path when the RPC is absent, because a student-facing
--     submission flow must not break while the migration is pending.)
--
-- DECISION SEMANTICS (preserving existing bucket formulas, inventing nothing):
--   approve  -> status 'Approved'; hours unchanged; counted as approved.
--   adjust   -> status 'Approved'; total_hours replaced with the adjusted
--               value (original preserved in the ledger); counted as approved.
--   reject   -> status 'Rejected'; hours unchanged; counted in NEITHER bucket
--               (leaves pending, never enters approved); the row itself is
--               preserved as history - nothing is deleted.
-- Exceeding hours_required NEVER blocks a decision: required hours are a
-- completion threshold, not a maximum. Downstream events (Placed promotion,
-- rotation_start, rotation_end) stay in the endpoint layer, mirroring the
-- submit-past-shift Auto-Accepted path.
--
-- WHAT THIS DOES NOT TOUCH: no schema change to students or student_shift_logs
-- (section 6 changes ONLY their DELETE authorization - reads and writes keep
-- the identical is_staff() predicate); no automatic status 'Completed'
-- (completion remains a manual Owner/Admin action per UNIT_LEADER_STATUS_
-- LEGEND_AND_COMPLETION_READINESS.md); portal views are untouched, so
-- exception flags and reviewer notes remain unreachable for students and unit
-- leaders.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute. *** APPLY MANUALLY
-- (Owner/Jester). Claude Code has applied NOTHING. *** Run the verification
-- block below, THEN the executable smoke test named there.
-- =============================================================================

BEGIN;

-- ── 1. Canonical unit identity (mirrors src/lib/unitNameCanon.js unitNameKey) ─
CREATE OR REPLACE FUNCTION public.unit_name_key(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT lower(regexp_replace(COALESCE(p_name, ''), '\s+', '', 'g'));
$$;

REVOKE ALL ON FUNCTION public.unit_name_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unit_name_key(text) TO service_role;

-- ── 2. The append-only, deletion-durable review ledger ───────────────────────
CREATE TABLE IF NOT EXISTS public.shift_log_reviews (
  id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- IMMUTABLE identity: plain uuid snapshots with NO foreign key, so nothing -
  -- no deletion, no cascade - can ever null or change WHICH shift and WHICH
  -- student this decision was about.
  original_shift_log_id     uuid NOT NULL,
  original_student_id       uuid NOT NULL,

  -- LIVE navigation links, ON DELETE SET NULL: convenient joins while the
  -- sources exist, harmlessly nulled when they are deleted. Identity NEVER
  -- depends on them - that is what the original_* columns above are for.
  shift_log_id              uuid REFERENCES public.student_shift_logs(id) ON DELETE SET NULL,
  student_id                uuid REFERENCES public.students(id) ON DELETE SET NULL,
  cohort_id                 uuid REFERENCES public.cohorts(id) ON DELETE SET NULL,
  student_name              text NOT NULL DEFAULT '',

  -- The decision itself.
  decision                  text NOT NULL CHECK (decision IN ('approved', 'adjusted', 'rejected')),
  reviewer_profile_id       uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  reviewer_name             text NOT NULL DEFAULT '',
  rationale                 text NOT NULL DEFAULT '',

  -- ORIGINAL submitted values, preserved verbatim before any mutation. Unit
  -- and preceptor are here because unit_and_preceptor_mismatch is a PRIMARY
  -- review reason - a decision must stay explicable without its source row.
  -- Deliberately excluded (unnecessary for the decision, student free text):
  -- support_needed, learning_highlight, override notes.
  original_status           text NOT NULL,
  original_shift_date       text NOT NULL DEFAULT '',
  original_total_hours      numeric(4,2),
  original_unit_name        text NOT NULL DEFAULT '',
  original_preceptor_name   text NOT NULL DEFAULT '',
  original_shift_type       text NOT NULL DEFAULT '',
  original_exception_flags  jsonb NOT NULL DEFAULT '[]'::jsonb,
  original_review_reason    text,

  -- Adjust-and-approve only; every other decision leaves this NULL.
  adjusted_total_hours      numeric(4,2),

  -- Warnings the reviewer explicitly confirmed (e.g. same_day_shift,
  -- possible_duplicate). The RPC refuses approval when a computed warning is
  -- not in this list, so a non-empty array is PROOF of deliberate confirmation.
  acknowledged_warnings     jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Resulting authoritative totals, captured after the in-transaction recompute.
  approved_hours_after      numeric(6,2) NOT NULL,
  pending_hours_after       numeric(6,2) NOT NULL,

  created_at                timestamptz NOT NULL DEFAULT now(),

  -- A rejection or adjustment without a rationale is not auditable.
  CONSTRAINT chk_slr_rationale_required CHECK (
    decision = 'approved' OR btrim(rationale) <> ''
  ),
  -- Adjusted hours exist exactly when the decision is 'adjusted', and stay in
  -- the same bounds intake enforces (0 < hours <= 13).
  CONSTRAINT chk_slr_adjusted_hours CHECK (
    (decision = 'adjusted') = (adjusted_total_hours IS NOT NULL)
    AND (adjusted_total_hours IS NULL
         OR (adjusted_total_hours > 0 AND adjusted_total_hours <= 13))
  ),
  CONSTRAINT chk_slr_warnings_shape CHECK (jsonb_typeof(acknowledged_warnings) = 'array'),
  CONSTRAINT chk_slr_flags_shape    CHECK (jsonb_typeof(original_exception_flags) = 'array')
);

-- The concurrency backbone: a shift is decided AT MOST ONCE - EVER. Two racing
-- reviewers cannot both land: the second INSERT violates this constraint and
-- its whole transaction (status change included) rolls back. Keyed on the
-- IMMUTABLE identity column, so the barrier holds even after the source shift
-- is deleted and the live link is nulled.
CREATE UNIQUE INDEX IF NOT EXISTS uq_slr_one_decision_per_shift
  ON public.shift_log_reviews (original_shift_log_id);

CREATE INDEX IF NOT EXISTS idx_slr_student ON public.shift_log_reviews (student_id, created_at DESC);

-- RLS: modern posture. Owner/Admin may read the audit trail; nobody writes
-- through the API surface; service_role INSERTs (via the RPC) and can never
-- UPDATE or DELETE - the ledger is append-only for EVERY writer.
ALTER TABLE public.shift_log_reviews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.shift_log_reviews FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.shift_log_reviews TO authenticated;
GRANT SELECT, INSERT ON public.shift_log_reviews TO service_role;

-- The IDENTITY column generates its values from a linked sequence. NOTE
-- (verified in production): PostgreSQL does NOT require the inserting role to
-- hold privileges on an identity column's sequence - identity generation is
-- internal, and table INSERT alone governs insertion. These grants are
-- least-privilege HYGIENE, not an insertion dependency: deny-all keeps
-- anon/authenticated from touching the counter directly (currval/nextval/
-- setval), and the explicit service_role grant keeps the posture deliberate.
-- Same pattern as portal_invitation_events: deterministic lookup via
-- pg_get_serial_sequence, deny-all, explicit grant.
DO $seq$
DECLARE
  v_seq text := pg_get_serial_sequence('public.shift_log_reviews', 'id');
BEGIN
  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'identity sequence for shift_log_reviews.id not found';
  END IF;
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', v_seq);
  EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', v_seq);
END;
$seq$;

DROP POLICY IF EXISTS "shift_log_reviews_owner_admin_read" ON public.shift_log_reviews;
CREATE POLICY "shift_log_reviews_owner_admin_read"
  ON public.shift_log_reviews FOR SELECT
  TO authenticated
  USING (public.is_active_owner_or_admin());

-- ── 3. The transactional decision RPC ────────────────────────────────────────
-- Error taxonomy (matches the shift_log_check_out P000x convention):
--   P0001 shift_not_pending_review  - already decided / not reviewable (race-safe)
--   P0002 shift_not_found
--   P0003 invalid_decision
--   P0004 rationale_required        - adjust/reject need a non-blank rationale
--   P0005 adjusted_hours_invalid    - must be > 0 and <= 13, only for 'adjusted'
--   P0006 reviewer_not_authorized   - not an active owner/admin profile
--   P0007 warnings_not_acknowledged - computed warnings missing from the
--                                     acknowledged list (message carries them)
CREATE OR REPLACE FUNCTION public.review_shift_log(
  p_shift_id              uuid,
  p_decision              text,
  p_reviewer_profile_id   uuid,
  p_rationale             text DEFAULT NULL,
  p_adjusted_hours        numeric DEFAULT NULL,
  p_acknowledged_warnings jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_reviewer            record;
  v_student_name        text;
  v_before              record;
  v_new_status          text;
  v_warnings            text[] := '{}';
  v_unacknowledged      text[] := '{}';
  v_ack                 jsonb;
  v_same_day            integer;
  v_duplicate           integer;
  v_recomputed_approved numeric(6,2);
  v_recomputed_pending  numeric(6,2);
  v_updated_count       integer;
BEGIN
  -- ── Input validation (before any lock) ─────────────────────────────────────
  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'adjusted', 'rejected') THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = 'P0003';
  END IF;

  IF p_decision IN ('adjusted', 'rejected')
     AND (p_rationale IS NULL OR btrim(p_rationale) = '') THEN
    RAISE EXCEPTION 'rationale_required' USING ERRCODE = 'P0004';
  END IF;

  IF (p_decision = 'adjusted') <> (p_adjusted_hours IS NOT NULL)
     OR (p_adjusted_hours IS NOT NULL
         AND (p_adjusted_hours <= 0 OR p_adjusted_hours > 13)) THEN
    RAISE EXCEPTION 'adjusted_hours_invalid' USING ERRCODE = 'P0005';
  END IF;

  v_ack := COALESCE(p_acknowledged_warnings, '[]'::jsonb);
  IF jsonb_typeof(v_ack) <> 'array' THEN
    RAISE EXCEPTION 'warnings_not_acknowledged: malformed acknowledgement list'
      USING ERRCODE = 'P0007';
  END IF;

  -- Defense in depth: the endpoint already verifies the caller, but the actor
  -- recorded in an audit ledger must be provably an active Owner/Admin.
  SELECT id, role, is_active, COALESCE(full_name, email, '') AS display_name
    INTO v_reviewer
  FROM public.user_profiles
  WHERE id = p_reviewer_profile_id;
  IF v_reviewer.id IS NULL
     OR v_reviewer.role NOT IN ('owner', 'admin')
     OR COALESCE(v_reviewer.is_active, true) = false THEN
    RAISE EXCEPTION 'reviewer_not_authorized' USING ERRCODE = 'P0006';
  END IF;

  -- ── Serialize on the student row (same lock as shift_log_check_out AND
  --    submit_past_shift_log) - also snapshots the name for the ledger ────────
  SELECT s.name INTO v_student_name
  FROM public.students s
  WHERE s.id = (SELECT l.student_id FROM public.student_shift_logs l WHERE l.id = p_shift_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Re-read the shift UNDER the lock and pin it too.
  SELECT * INTO v_before
  FROM public.student_shift_logs
  WHERE id = p_shift_id
  FOR UPDATE;
  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'shift_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Only a completed Pending Review shift is decidable. Anything else means a
  -- concurrent decision (or a bad target) - refuse without touching anything.
  IF v_before.lifecycle_state IS DISTINCT FROM 'completed'
     OR v_before.status IS DISTINCT FROM 'Pending Review' THEN
    RAISE EXCEPTION 'shift_not_pending_review' USING ERRCODE = 'P0001';
  END IF;

  -- ── Warnings, computed INSIDE the lock, enforced for approval paths ────────
  -- A duplicate or overlapping shift must be a deliberate confirmation, never
  -- a silent approval - and never an unconditional prohibition. Unit identity
  -- is CANONICAL (unit_name_key): '6NE', '6 NE', and case variants are the
  -- same unit here exactly as they are in the client.
  IF p_decision IN ('approved', 'adjusted') THEN
    SELECT count(*) INTO v_same_day
    FROM public.student_shift_logs l
    WHERE l.student_id = v_before.student_id
      AND l.id <> p_shift_id
      AND l.shift_date = v_before.shift_date
      AND l.lifecycle_state = 'completed'
      AND l.status NOT IN ('Rejected', 'rejected');

    SELECT count(*) INTO v_duplicate
    FROM public.student_shift_logs l
    WHERE l.student_id = v_before.student_id
      AND l.id <> p_shift_id
      AND l.shift_date = v_before.shift_date
      AND public.unit_name_key(l.unit_name) = public.unit_name_key(v_before.unit_name)
      AND l.total_hours IS NOT DISTINCT FROM v_before.total_hours
      AND l.lifecycle_state = 'completed'
      AND l.status NOT IN ('Rejected', 'rejected');

    IF v_duplicate > 0 THEN
      v_warnings := array_append(v_warnings, 'possible_duplicate');
    END IF;
    IF v_same_day > 0 THEN
      v_warnings := array_append(v_warnings, 'same_day_shift');
    END IF;

    SELECT COALESCE(array_agg(w), '{}') INTO v_unacknowledged
    FROM unnest(v_warnings) AS w
    WHERE NOT v_ack ? w;

    IF array_length(v_unacknowledged, 1) > 0 THEN
      RAISE EXCEPTION 'warnings_not_acknowledged: %', array_to_string(v_unacknowledged, ', ')
        USING ERRCODE = 'P0007';
    END IF;
  END IF;

  -- ── Apply the decision (guarded - the WHERE re-checks Pending Review) ──────
  v_new_status := CASE WHEN p_decision = 'rejected' THEN 'Rejected' ELSE 'Approved' END;

  UPDATE public.student_shift_logs
  SET status      = v_new_status,
      total_hours = CASE WHEN p_decision = 'adjusted' THEN p_adjusted_hours ELSE total_hours END,
      admin_notes = COALESCE(NULLIF(btrim(p_rationale), ''), admin_notes),
      reviewed_by = v_reviewer.display_name,
      reviewed_at = now()
  WHERE id = p_shift_id
    AND status = 'Pending Review'
    AND lifecycle_state = 'completed';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'shift_not_pending_review' USING ERRCODE = 'P0001';
  END IF;

  -- ── Recompute authoritative totals (the check_out formula, verbatim) ───────
  SELECT COALESCE(SUM(total_hours), 0) INTO v_recomputed_approved
  FROM public.student_shift_logs
  WHERE student_id = v_before.student_id
    AND lifecycle_state = 'completed'
    AND status IN ('Auto-Accepted', 'Approved')
    AND total_hours IS NOT NULL;

  SELECT COALESCE(SUM(total_hours), 0) INTO v_recomputed_pending
  FROM public.student_shift_logs
  WHERE student_id = v_before.student_id
    AND lifecycle_state = 'completed'
    AND status IN ('Pending Review')
    AND total_hours IS NOT NULL;

  UPDATE public.students
  SET approved_hours = v_recomputed_approved,
      pending_hours  = v_recomputed_pending
  WHERE id = v_before.student_id;

  -- ── Append the audit row (the unique index is the double-apply barrier) ────
  INSERT INTO public.shift_log_reviews (
    original_shift_log_id, original_student_id,
    shift_log_id, student_id, cohort_id, student_name,
    decision, reviewer_profile_id, reviewer_name, rationale,
    original_status, original_shift_date, original_total_hours,
    original_unit_name, original_preceptor_name, original_shift_type,
    original_exception_flags, original_review_reason,
    adjusted_total_hours, acknowledged_warnings,
    approved_hours_after, pending_hours_after
  ) VALUES (
    p_shift_id, v_before.student_id,
    p_shift_id, v_before.student_id, v_before.cohort_id, COALESCE(v_student_name, ''),
    p_decision, v_reviewer.id, v_reviewer.display_name, COALESCE(btrim(p_rationale), ''),
    v_before.status, COALESCE(v_before.shift_date, ''), v_before.total_hours,
    COALESCE(v_before.unit_name, ''), COALESCE(v_before.preceptor_name, ''), COALESCE(v_before.shift_type, ''),
    COALESCE(v_before.exception_flags, '[]'::jsonb), v_before.review_reason,
    CASE WHEN p_decision = 'adjusted' THEN p_adjusted_hours ELSE NULL END, v_ack,
    v_recomputed_approved, v_recomputed_pending
  );

  RETURN jsonb_build_object(
    'ok', true,
    'shift_id', p_shift_id,
    'student_id', v_before.student_id,
    'decision', p_decision,
    'new_status', v_new_status,
    'original_total_hours', v_before.total_hours,
    'adjusted_total_hours', CASE WHEN p_decision = 'adjusted' THEN p_adjusted_hours ELSE NULL END,
    'warnings_acknowledged', v_ack,
    'approved_hours', v_recomputed_approved,
    'pending_hours', v_recomputed_pending
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_shift_log(uuid, text, uuid, text, numeric, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_shift_log(uuid, text, uuid, text, numeric, jsonb)
  TO service_role;

-- ── 4. Readiness probe for the review endpoint ───────────────────────────────
CREATE OR REPLACE FUNCTION public.shift_review_ready()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT to_regclass('public.shift_log_reviews') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'review_shift_log'
     );
$$;

REVOKE ALL ON FUNCTION public.shift_review_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shift_review_ready() TO service_role;

-- ── 5. Atomic past-shift submission (closes the last unserialized writer) ────
-- api/shift-log/submit-past-shift.js validated and classified in JS, then ran
-- a lockless insert + a client-side totals recompute ("DUPLICATED ... must
-- stay in sync"). This RPC takes the SAME per-student FOR UPDATE lock as
-- review_shift_log and shift_log_check_out, making every totals writer
-- serialize on the student row. Idempotent on the submission id: a retry (or
-- a race between retries) finds the row already present, recomputes nothing
-- twice, and returns the existing row with inserted=false - the endpoint then
-- compares payloads exactly as before.
--   P0002 student_not_found
--   P0006 invalid_status (only intake statuses are accepted here)
CREATE OR REPLACE FUNCTION public.submit_past_shift_log(
  p_id                      uuid,
  p_student_id              uuid,
  p_cohort_id               uuid,
  p_school_email            text,
  p_shift_date              text,
  p_total_hours             numeric,
  p_unit_name               text,
  p_is_assigned_unit        boolean,
  p_unit_override_reason    text,
  p_preceptor_name          text,
  p_is_assigned_preceptor   boolean,
  p_preceptor_override_note text,
  p_shift_type              text,
  p_learning_highlight      text,
  p_support_needed          text,
  p_status                  text,
  p_exception_flags         jsonb,
  p_review_reason           text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_inserted            integer := 0;
  v_shift               jsonb;
  v_recomputed_approved numeric(6,2);
  v_recomputed_pending  numeric(6,2);
BEGIN
  -- The serialization point shared with review_shift_log / shift_log_check_out.
  PERFORM 1 FROM public.students WHERE id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- EXISTS-FIRST, then validate: a resubmitted id whose row has since been
  -- REVIEWED (status 'Approved'/'Rejected') is a legitimate idempotent replay.
  -- It must return that row with a locked recompute - never a P0006, and never
  -- a status change. Only a GENUINE insert is held to the intake statuses.
  SELECT to_jsonb(l) INTO v_shift FROM public.student_shift_logs l WHERE l.id = p_id;

  IF v_shift IS NULL THEN
    IF p_status IS NULL OR p_status NOT IN ('Auto-Accepted', 'Pending Review') THEN
      RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'P0006';
    END IF;

    INSERT INTO public.student_shift_logs (
      id, student_id, cohort_id, school_email, shift_date, total_hours,
      unit_name, is_assigned_unit, unit_override_reason,
      preceptor_name, is_assigned_preceptor, preceptor_override_note,
      shift_type, learning_highlight, support_needed, attestation,
      lifecycle_state, status, exception_flags, review_reason, submitted_at
    ) VALUES (
      p_id, p_student_id, p_cohort_id, p_school_email, p_shift_date, p_total_hours,
      p_unit_name, p_is_assigned_unit, COALESCE(p_unit_override_reason, ''),
      COALESCE(p_preceptor_name, ''), p_is_assigned_preceptor, COALESCE(p_preceptor_override_note, ''),
      p_shift_type, COALESCE(p_learning_highlight, ''), COALESCE(p_support_needed, ''), true,
      'completed', p_status, COALESCE(p_exception_flags, '[]'::jsonb), p_review_reason, now()
    )
    ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    SELECT to_jsonb(l) INTO v_shift FROM public.student_shift_logs l WHERE l.id = p_id;
  END IF;

  -- Recompute BOTH totals under the lock (the check_out formula, verbatim).
  SELECT COALESCE(SUM(total_hours), 0) INTO v_recomputed_approved
  FROM public.student_shift_logs
  WHERE student_id = p_student_id
    AND lifecycle_state = 'completed'
    AND status IN ('Auto-Accepted', 'Approved')
    AND total_hours IS NOT NULL;

  SELECT COALESCE(SUM(total_hours), 0) INTO v_recomputed_pending
  FROM public.student_shift_logs
  WHERE student_id = p_student_id
    AND lifecycle_state = 'completed'
    AND status IN ('Pending Review')
    AND total_hours IS NOT NULL;

  UPDATE public.students
  SET approved_hours = v_recomputed_approved,
      pending_hours  = v_recomputed_pending
  WHERE id = p_student_id;

  RETURN jsonb_build_object(
    'inserted', v_inserted = 1,
    'shift', v_shift,
    'approved_hours', v_recomputed_approved,
    'pending_hours', v_recomputed_pending
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_past_shift_log(uuid, uuid, uuid, text, text, numeric, text, boolean, text, text, boolean, text, text, text, text, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_past_shift_log(uuid, uuid, uuid, text, text, numeric, text, boolean, text, text, boolean, text, text, text, text, text, jsonb, text)
  TO service_role;

-- ── 6. DELETE lockdown on the source tables ──────────────────────────────────
-- The durability audit surfaced this: staff_all_students and
-- staff_all_student_shift_logs are FOR ALL over is_staff(), so EVERY active
-- staff role - including viewer and interviewer - could DELETE students and
-- shift logs. The intended role model in the application is narrower:
--   • students: deleted only from the staff UI Danger Zone, which is an
--     Owner/Admin surface (canEdit = ['owner','admin'], AuthContext.jsx);
--   • student_shift_logs: NOTHING in src/ or api/ deletes them at all;
--   • service_role: no endpoint or cron deletes either table - it does not
--     need DELETE, so it loses it (trivially re-grantable if a future
--     operation genuinely requires it).
-- SELECT / INSERT / UPDATE behavior is intentionally UNCHANGED: the FOR ALL
-- policy is split into per-command policies with the SAME is_staff()
-- predicate, and only DELETE narrows to active Owner/Admin.
-- (db/audit/phase0b_reverts.sql predates this and would recreate the FOR ALL
-- policies if ever run; it is a historical revert script, not a live path.)

DROP POLICY IF EXISTS "staff_all_students" ON public.students;
DROP POLICY IF EXISTS "staff_select_students" ON public.students;
CREATE POLICY "staff_select_students" ON public.students
  FOR SELECT TO authenticated USING (public.is_staff());
DROP POLICY IF EXISTS "staff_insert_students" ON public.students;
CREATE POLICY "staff_insert_students" ON public.students
  FOR INSERT TO authenticated WITH CHECK (public.is_staff());
DROP POLICY IF EXISTS "staff_update_students" ON public.students;
CREATE POLICY "staff_update_students" ON public.students
  FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
DROP POLICY IF EXISTS "students_owner_admin_delete" ON public.students;
CREATE POLICY "students_owner_admin_delete" ON public.students
  FOR DELETE TO authenticated USING (public.is_active_owner_or_admin());

DROP POLICY IF EXISTS "staff_all_student_shift_logs" ON public.student_shift_logs;
DROP POLICY IF EXISTS "staff_select_student_shift_logs" ON public.student_shift_logs;
CREATE POLICY "staff_select_student_shift_logs" ON public.student_shift_logs
  FOR SELECT TO authenticated USING (public.is_staff());
DROP POLICY IF EXISTS "staff_insert_student_shift_logs" ON public.student_shift_logs;
CREATE POLICY "staff_insert_student_shift_logs" ON public.student_shift_logs
  FOR INSERT TO authenticated WITH CHECK (public.is_staff());
DROP POLICY IF EXISTS "staff_update_student_shift_logs" ON public.student_shift_logs;
CREATE POLICY "staff_update_student_shift_logs" ON public.student_shift_logs
  FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
DROP POLICY IF EXISTS "student_shift_logs_owner_admin_delete" ON public.student_shift_logs;
CREATE POLICY "student_shift_logs_owner_admin_delete" ON public.student_shift_logs
  FOR DELETE TO authenticated USING (public.is_active_owner_or_admin());

-- service_role: no repository evidence of any service-side DELETE on either
-- table - narrowest access means it keeps SELECT/INSERT/UPDATE only.
REVOKE DELETE ON public.students FROM service_role;
REVOKE DELETE ON public.student_shift_logs FROM service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;


-- =============================================================================
-- VERIFICATION (Owner runs after applying - not part of the migration)
-- =============================================================================
--
-- (a) the ledger, its uniqueness backbone, and all four functions exist
--   SELECT to_regclass('public.shift_log_reviews');          -- not null
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'shift_log_reviews'
--      AND indexname = 'uq_slr_one_decision_per_shift';      -- expect: 1 row
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('review_shift_log', 'shift_review_ready',
--                      'submit_past_shift_log', 'unit_name_key');  -- expect: 4 rows
--   SELECT public.shift_review_ready();                      -- expect: true
--
-- (b) DURABILITY: immutable identity + SET NULL live links, never CASCADE
--   SELECT conname, confdeltype FROM pg_constraint
--    WHERE conrelid = 'public.shift_log_reviews'::regclass AND contype = 'f';
--   -- expect: the student_shift_logs / students / cohorts FKs all show
--   --         confdeltype 'n' (SET NULL); the user_profiles FK shows 'r'
--   --         (RESTRICT). NO row shows 'c' (CASCADE).
--   SELECT attname, attnotnull FROM pg_attribute
--    WHERE attrelid = 'public.shift_log_reviews'::regclass
--      AND attname IN ('original_shift_log_id', 'original_student_id');
--   -- expect: both rows, attnotnull true (identity is immutable, FK-free)
--
-- (c) DELETE LOCKDOWN: source deletion narrowed to active Owner/Admin
--   SELECT c.relname, p.polname, p.polcmd, pg_get_expr(p.polqual, p.polrelid) AS using_expr
--   FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
--   WHERE p.polrelid IN ('public.students'::regclass, 'public.student_shift_logs'::regclass)
--   ORDER BY c.relname, p.polcmd;
--   -- expect per table: polcmd 'r'/'a'/'w' with is_staff() (reads and writes
--   --         UNCHANGED), polcmd 'd' ONLY via is_active_owner_or_admin()
--   --         (viewer/interviewer/co_lead cannot pass it - the helper requires
--   --         role IN ('owner','admin') AND active), and NO polcmd '*' row
--   --         remains (the old FOR ALL policies are gone).
--   SELECT has_table_privilege('service_role', 'public.students', 'DELETE');          -- false
--   SELECT has_table_privilege('service_role', 'public.student_shift_logs', 'DELETE');-- false
--   SELECT has_table_privilege('service_role', 'public.students', 'UPDATE');          -- true (unchanged)
--   SELECT has_table_privilege('service_role', 'public.student_shift_logs', 'INSERT');-- true (unchanged)
--   SELECT has_table_privilege('authenticated', 'public.students', 'DELETE');         -- true (grant layer;
--                                                                  -- RLS narrows it to Owner/Admin)
--
-- (d) privileges: append-only ledger, service-role-only RPCs
--   SELECT
--     has_sequence_privilege('service_role',  pg_get_serial_sequence('public.shift_log_reviews', 'id'), 'USAGE');   -- true
--   SELECT
--     has_sequence_privilege('anon',          pg_get_serial_sequence('public.shift_log_reviews', 'id'), 'USAGE');   -- false
--   SELECT
--     has_sequence_privilege('authenticated', pg_get_serial_sequence('public.shift_log_reviews', 'id'), 'USAGE');   -- false
--   SELECT has_table_privilege('service_role', 'public.shift_log_reviews', 'UPDATE');  -- false
--   SELECT has_table_privilege('service_role', 'public.shift_log_reviews', 'DELETE');  -- false
--   SELECT has_table_privilege('service_role', 'public.shift_log_reviews', 'INSERT');  -- true
--   SELECT has_table_privilege('authenticated', 'public.shift_log_reviews', 'INSERT'); -- false
--   SELECT has_function_privilege('anon', 'public.review_shift_log(uuid,text,uuid,text,numeric,jsonb)', 'EXECUTE');          -- false
--   SELECT has_function_privilege('authenticated', 'public.review_shift_log(uuid,text,uuid,text,numeric,jsonb)', 'EXECUTE'); -- false
--   SELECT has_function_privilege('service_role', 'public.review_shift_log(uuid,text,uuid,text,numeric,jsonb)', 'EXECUTE');  -- true
--   SELECT has_function_privilege('anon', 'public.submit_past_shift_log(uuid,uuid,uuid,text,text,numeric,text,boolean,text,text,boolean,text,text,text,text,text,jsonb,text)', 'EXECUTE'); -- false
--   SELECT has_function_privilege('service_role', 'public.submit_past_shift_log(uuid,uuid,uuid,text,text,numeric,text,boolean,text,text,boolean,text,text,text,text,text,jsonb,text)', 'EXECUTE'); -- true
--
-- (e) canonical unit identity
--   SELECT public.unit_name_key('6 NE') = public.unit_name_key('6NE');   -- true
--   SELECT public.unit_name_key('6 ne') = public.unit_name_key('6 NE');  -- true
--   SELECT public.unit_name_key('6 NE') = public.unit_name_key('6 NW');  -- false
--
-- (f) REVIEW SMOKE TEST - run the companion executable file
--     db/audit/shift_log_review_smoke_test.sql
--     Placeholder-free and synthetic: creates its own cohort/student/shifts
--     inside a transaction, proves approve / adjust / reject semantics, totals
--     recompute, over-required approval, warning enforcement + acknowledgement
--     (INCLUDING '6NE' vs '6 NE' canonical variants), double-decision refusal,
--     rationale requirements, the atomic past-shift RPC (insert + recompute +
--     idempotent retry + review interleaving), and that DELETING the reviewed
--     shift and the student leaves every audit row intact - then rolls back.
--     Expected output: 'ok: ...' notices ending in 'ALL REVIEW SMOKE TESTS
--     PASSED', then a trailing count of 0.
--
-- =============================================================================
-- ROLLBACK (safe - removes what this migration added and restores the prior
-- deletion posture)
-- =============================================================================
--   -- Restore the pre-migration FOR ALL policies + service_role DELETE:
--   DROP POLICY IF EXISTS "staff_select_students" ON public.students;
--   DROP POLICY IF EXISTS "staff_insert_students" ON public.students;
--   DROP POLICY IF EXISTS "staff_update_students" ON public.students;
--   DROP POLICY IF EXISTS "students_owner_admin_delete" ON public.students;
--   CREATE POLICY "staff_all_students" ON public.students
--     FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
--   DROP POLICY IF EXISTS "staff_select_student_shift_logs" ON public.student_shift_logs;
--   DROP POLICY IF EXISTS "staff_insert_student_shift_logs" ON public.student_shift_logs;
--   DROP POLICY IF EXISTS "staff_update_student_shift_logs" ON public.student_shift_logs;
--   DROP POLICY IF EXISTS "student_shift_logs_owner_admin_delete" ON public.student_shift_logs;
--   CREATE POLICY "staff_all_student_shift_logs" ON public.student_shift_logs
--     FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
--   GRANT DELETE ON public.students TO service_role;
--   GRANT DELETE ON public.student_shift_logs TO service_role;
--   -- Remove the review objects:
--   DROP FUNCTION IF EXISTS public.submit_past_shift_log(uuid, uuid, uuid, text, text, numeric, text, boolean, text, text, boolean, text, text, text, text, text, jsonb, text);
--   DROP FUNCTION IF EXISTS public.shift_review_ready();
--   DROP FUNCTION IF EXISTS public.review_shift_log(uuid, text, uuid, text, numeric, jsonb);
--   DROP TABLE IF EXISTS public.shift_log_reviews;
--   DROP FUNCTION IF EXISTS public.unit_name_key(text);
--   NOTIFY pgrst, 'reload schema';
-- =============================================================================
