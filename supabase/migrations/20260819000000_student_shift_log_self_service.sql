-- =============================================================================
-- Student shift-log self-service: correct or withdraw my own shift
-- Migration: 20260819000000_student_shift_log_self_service
-- =============================================================================
--
-- WHY THIS EXISTS
-- A student who mistypes a shift has no way to fix it. The portal lists four
-- entries read-only, /shift-log can only create, and the confirmation screen
-- tells them to email the ASPIRE team. Every correction is therefore manual
-- staff work, and wrong hours sit in the totals until someone notices.
--
-- THE MODEL - VOID IS A LIFECYCLE STATE, NOT A DELETE
-- Every totals writer in the system (shift_log_check_out, review_shift_log,
-- submit_past_shift_log, and the JS fallback) recomputes with the SAME filter:
--     lifecycle_state = 'completed' AND status IN (...)
-- So marking a withdrawn shift lifecycle_state = 'voided' removes it from BOTH
-- buckets everywhere at once, with no formula anywhere needing to change. The
-- same filter appears in three more places, and a void inherits all of them
-- for free:
--   • review_shift_log's decidability gate  -> staff can no longer review it;
--   • its same-day / possible-duplicate warning queries -> a withdrawn shift
--     stops raising warnings against its siblings;
--   • buildExceptionFlags' daily_hours_exceed_24 sum -> it stops counting.
-- The row itself is never touched again: full history, nothing erased. This
-- also respects 20260818000000, which REVOKED DELETE on student_shift_logs
-- from service_role - a delete-based void is not even possible from an
-- endpoint, and should not be.
--
-- WHAT A STUDENT MAY TOUCH
--   • 'Auto-Accepted' and 'Pending Review' shifts: edit or void.
--   • 'Approved' and 'Rejected' shifts: NOTHING. These carry a staff decision
--     in shift_log_reviews, whose uq_slr_one_decision_per_shift index makes a
--     second decision on the same shift structurally impossible - so an edit
--     that pushed a reviewed shift back to Pending Review would create a row
--     staff could never re-decide. The portal offers a correction request
--     instead. This is a deliberate departure from "versioned correction":
--     see the handoff note.
--   • Nothing at all once a downstream artifact could be invalidated:
--     a certificate has been issued, the rotation has been concluded
--     (students.rotation_completed_at), or the student is in a terminal
--     status. Those cases are correction requests too.
--
-- EVERY change re-runs the canonical exception classification (the endpoint
-- computes flags exactly like submit-past-shift, then the status follows), and
-- every change is appended to student_shift_log_edits with a full before/after
-- snapshot. That ledger is SEPARATE from shift_log_reviews on purpose: the
-- staff ledger is one-decision-per-shift, append-only, and must never carry a
-- student action.
--
-- SERIALIZATION. Both RPCs take the SAME per-student
--   PERFORM 1 FROM public.students WHERE id = ... FOR UPDATE
-- lock as check-out, staff review, and past-shift submission, then re-verify
-- the shift's state UNDER the lock. A staff review landing concurrently makes
-- the student's edit fail cleanly (P0001) instead of overwriting the decision,
-- and totals can never interleave into a stale value.
--
-- WHAT THIS DOES NOT TOUCH: no schema or policy change to students or
-- student_shift_logs; no change to any recompute formula; no change to
-- shift_log_reviews; portal views keep excluding exception_flags, admin_notes,
-- and reviewed_by, so staff internals stay invisible to students.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute. *** APPLY MANUALLY
-- (Owner/Jester). Claude Code has applied NOTHING. *** Run the one-row
-- verification query below, THEN the executable smoke test named there.
-- =============================================================================

BEGIN;

-- ── 1. lifecycle_state becomes a closed vocabulary ──────────────────────────
-- 'voided' is about to carry real meaning (it removes hours from every
-- bucket), so the column must not accept NULL or a typo that would silently
-- behave like a withdrawal in some queries and like nothing in others. The
-- column shipped nullable with DEFAULT 'completed' and no constraint.
--
-- CONFORMANCE FIRST: this aborts the whole migration if any existing row would
-- violate the constraint, naming what it found - it never rewrites data.
DO $lifecycle$
DECLARE
  v_bad     integer;
  v_offend  text;
BEGIN
  SELECT count(*), COALESCE(string_agg(DISTINCT COALESCE(lifecycle_state, '<NULL>'), ', '), '')
    INTO v_bad, v_offend
  FROM public.student_shift_logs
  WHERE lifecycle_state IS NULL
     OR lifecycle_state NOT IN ('completed', 'in_progress', 'voided');
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'lifecycle_state conformance failed: % row(s) hold values outside (completed, in_progress, voided): %. Resolve these before applying.',
      v_bad, v_offend;
  END IF;
  RAISE NOTICE 'lifecycle_state conformance: all rows already conform';
END;
$lifecycle$;

ALTER TABLE public.student_shift_logs
  ALTER COLUMN lifecycle_state SET DEFAULT 'completed';

UPDATE public.student_shift_logs SET lifecycle_state = 'completed' WHERE lifecycle_state IS NULL;

ALTER TABLE public.student_shift_logs
  ALTER COLUMN lifecycle_state SET NOT NULL;

ALTER TABLE public.student_shift_logs
  DROP CONSTRAINT IF EXISTS chk_ssl_lifecycle_state;
ALTER TABLE public.student_shift_logs
  ADD CONSTRAINT chk_ssl_lifecycle_state
  CHECK (lifecycle_state IN ('completed', 'in_progress', 'voided'));

-- ── 2. The append-only student edit ledger ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.student_shift_log_edits (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- IMMUTABLE identity: plain uuids with no FK, so no deletion can ever erase
  -- WHICH shift and WHICH student an action referred to (same doctrine as
  -- shift_log_reviews.original_*).
  original_shift_log_id  uuid NOT NULL,
  original_student_id    uuid NOT NULL,

  -- Live navigation links only; nulled if the source is ever deleted.
  shift_log_id           uuid REFERENCES public.student_shift_logs(id) ON DELETE SET NULL,
  student_id             uuid REFERENCES public.students(id) ON DELETE SET NULL,
  cohort_id              uuid REFERENCES public.cohorts(id) ON DELETE SET NULL,

  action                 text NOT NULL CHECK (action IN ('edited', 'voided')),
  -- The portal account that acted. RESTRICT: an audit actor never vanishes.
  actor_profile_id       uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  reason                 text NOT NULL DEFAULT '',

  -- BEFORE snapshot (what the row was, verbatim, prior to this action).
  before_status          text NOT NULL DEFAULT '',
  before_lifecycle_state text NOT NULL DEFAULT '',
  before_shift_date      text NOT NULL DEFAULT '',
  before_total_hours     numeric(4,2),
  before_unit_name       text NOT NULL DEFAULT '',
  before_preceptor_name  text NOT NULL DEFAULT '',
  before_shift_type      text NOT NULL DEFAULT '',
  before_exception_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  before_review_reason   text,

  -- AFTER snapshot (voids repeat the before values and change lifecycle only).
  after_status           text NOT NULL DEFAULT '',
  after_lifecycle_state  text NOT NULL DEFAULT '',
  after_shift_date       text NOT NULL DEFAULT '',
  after_total_hours      numeric(4,2),
  after_unit_name        text NOT NULL DEFAULT '',
  after_preceptor_name   text NOT NULL DEFAULT '',
  after_shift_type       text NOT NULL DEFAULT '',
  after_exception_flags  jsonb NOT NULL DEFAULT '[]'::jsonb,
  after_review_reason    text,

  -- Authoritative totals captured after the in-transaction recompute.
  approved_hours_after   numeric(6,2) NOT NULL,
  pending_hours_after    numeric(6,2) NOT NULL,

  created_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_ssle_flag_shapes CHECK (
    jsonb_typeof(before_exception_flags) = 'array'
    AND jsonb_typeof(after_exception_flags) = 'array'
  ),
  -- A void ends at 'voided'; an edit never changes the lifecycle.
  CONSTRAINT chk_ssle_action_lifecycle CHECK (
    (action = 'voided' AND after_lifecycle_state = 'voided')
    OR (action = 'edited' AND after_lifecycle_state = before_lifecycle_state)
  )
);

-- Unlike the staff ledger there is NO one-row-per-shift index: a student may
-- legitimately correct the same shift more than once, and every attempt is
-- kept. History is read newest-first per shift.
CREATE INDEX IF NOT EXISTS idx_ssle_shift
  ON public.student_shift_log_edits (original_shift_log_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ssle_student
  ON public.student_shift_log_edits (original_student_id, created_at DESC);

-- RLS: Owner/Admin may read the trail. Students never read it (their portal
-- shows current state only). Nobody may UPDATE or DELETE - append-only for
-- every writer, service_role included.
ALTER TABLE public.student_shift_log_edits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.student_shift_log_edits FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.student_shift_log_edits TO authenticated;
GRANT SELECT, INSERT ON public.student_shift_log_edits TO service_role;

DROP POLICY IF EXISTS "student_shift_log_edits_owner_admin_read" ON public.student_shift_log_edits;
CREATE POLICY "student_shift_log_edits_owner_admin_read"
  ON public.student_shift_log_edits FOR SELECT
  TO authenticated
  USING (public.is_active_owner_or_admin());

-- Identity sequence: least-privilege hygiene, matching portal_invitation_events
-- and shift_log_reviews. (Identity generation itself does not require these -
-- table INSERT governs insertion - but the counter stays deny-all regardless.)
DO $seq$
DECLARE
  v_seq text := pg_get_serial_sequence('public.student_shift_log_edits', 'id');
BEGIN
  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'identity sequence for student_shift_log_edits.id not found';
  END IF;
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', v_seq);
  EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', v_seq);
END;
$seq$;

-- ── 3. Shared eligibility: what may a student still change? ──────────────────
-- Returns a jsonb verdict rather than a boolean so the endpoint can tell the
-- student WHY, and so both RPCs and the read endpoint share one rule.
--   { editable: bool, reason: text }
-- reason ∈ ok | not_found | already_voided | shift_in_progress |
--          staff_decided | certificate_issued | rotation_concluded |
--          student_status_terminal
CREATE OR REPLACE FUNCTION public.student_shift_edit_eligibility(
  p_shift_id   uuid,
  p_student_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_shift   record;
  v_student record;
  v_certs   integer;
BEGIN
  SELECT id, student_id, status, lifecycle_state
    INTO v_shift
  FROM public.student_shift_logs
  WHERE id = p_shift_id AND student_id = p_student_id;

  -- Non-enumerating: a shift belonging to somebody else is indistinguishable
  -- from one that does not exist.
  IF v_shift.id IS NULL THEN
    RETURN jsonb_build_object('editable', false, 'reason', 'not_found');
  END IF;

  SELECT id, status, rotation_completed_at INTO v_student
  FROM public.students WHERE id = p_student_id;

  IF v_shift.lifecycle_state = 'voided' THEN
    RETURN jsonb_build_object('editable', false, 'reason', 'already_voided');
  END IF;
  IF v_shift.lifecycle_state IS DISTINCT FROM 'completed' THEN
    -- An open (checked-in) shift is finished through check-out, not here.
    RETURN jsonb_build_object('editable', false, 'reason', 'shift_in_progress');
  END IF;
  IF v_shift.status NOT IN ('Auto-Accepted', 'Pending Review') THEN
    -- Approved / Rejected carry a staff decision in shift_log_reviews.
    RETURN jsonb_build_object('editable', false, 'reason', 'staff_decided');
  END IF;

  -- Downstream artifacts that a changed hour count could invalidate.
  SELECT count(*) INTO v_certs FROM public.certificates WHERE student_id = p_student_id;
  IF v_certs > 0 THEN
    RETURN jsonb_build_object('editable', false, 'reason', 'certificate_issued');
  END IF;
  IF v_student.rotation_completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('editable', false, 'reason', 'rotation_concluded');
  END IF;
  IF v_student.status IN ('Completed', 'Not Proceeding') THEN
    RETURN jsonb_build_object('editable', false, 'reason', 'student_status_terminal');
  END IF;

  RETURN jsonb_build_object('editable', true, 'reason', 'ok');
END;
$$;

REVOKE ALL ON FUNCTION public.student_shift_edit_eligibility(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.student_shift_edit_eligibility(uuid, uuid) TO service_role;

-- ── 4. Canonical exception classification, evaluated IN the database ────────
-- A faithful port of api/lib/shiftExceptionFlags.js (itself extracted verbatim
-- from submit-past-shift). It lives here so the EDIT path derives flags from
-- facts read AFTER the student row is locked: a caller-computed status could
-- be stale by the time it lands (a sibling shift added, an assignment window
-- changed, the student's status moved), and the writer must never trust it.
--
-- Flag ORDER is load-bearing: joined with '; ' it becomes review_reason.
-- Every read here is inside the caller's transaction and therefore inside the
-- caller's lock; there is no error path that can silently yield "no flags",
-- because a failure raises and aborts rather than returning a clean result.
--
-- Returns { flags: [...], status: text, review_reason: text|null }.
CREATE OR REPLACE FUNCTION public.student_shift_classify(
  p_student_id            uuid,
  p_exclude_shift_id      uuid,
  p_shift_date            text,
  p_total_hours           numeric,
  p_unit_name             text,
  p_is_assigned_unit      boolean,
  p_preceptor_name        text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_flags        text[] := '{}';
  v_student      record;
  v_rot_start    text;
  v_rot_end      text;
  v_daily        numeric;
  v_assign_count integer;
  v_recognized   boolean;
  v_assigned_nm  text;
  v_prec_differs boolean;
  v_status       text;
BEGIN
  -- The student's own facts, read now (never passed in by the caller).
  SELECT s.id, s.status, s.matched_preceptor, s.matched_unit_id, s.cohort_school_rotation_id
    INTO v_student
  FROM public.students s WHERE s.id = p_student_id;
  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'student_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- 1. hours_over_13 / 2. hours_under_2
  IF p_total_hours > 13 THEN v_flags := array_append(v_flags, 'hours_over_13'); END IF;
  IF p_total_hours < 2  THEN v_flags := array_append(v_flags, 'hours_under_2');  END IF;

  -- 3. outside_rotation_dates - canonical coordinator-owned window only, with
  --    the '1900-01-01' sentinel meaning "unavailable", which never flags.
  IF v_student.cohort_school_rotation_id IS NOT NULL THEN
    SELECT r.rotation_start_date::text, r.rotation_end_date::text
      INTO v_rot_start, v_rot_end
    FROM public.cohort_school_rotations r
    WHERE r.id = v_student.cohort_school_rotation_id;
  END IF;
  IF v_rot_start IS NOT NULL AND v_rot_end IS NOT NULL
     AND v_rot_start <> '1900-01-01' AND v_rot_end <> '1900-01-01'
     AND p_shift_date IS NOT NULL AND p_shift_date <> ''
     AND (p_shift_date < v_rot_start OR p_shift_date > v_rot_end) THEN
    v_flags := array_append(v_flags, 'outside_rotation_dates');
  END IF;

  -- 4. daily_hours_exceed_24 - same-day CREDITED hours plus this shift. The
  --    row being edited is excluded so its own previous hours are not counted
  --    against its new value.
  SELECT COALESCE(SUM(l.total_hours), 0) INTO v_daily
  FROM public.student_shift_logs l
  WHERE l.student_id = p_student_id
    AND l.shift_date = p_shift_date
    AND l.lifecycle_state = 'completed'
    AND l.status IN ('Auto-Accepted', 'Approved')
    AND (p_exclude_shift_id IS NULL OR l.id <> p_exclude_shift_id);
  IF (v_daily + p_total_hours) > 24 THEN
    v_flags := array_append(v_flags, 'daily_hours_exceed_24');
  END IF;

  -- 5. missing_preceptor / 6. pre_placement_log
  IF btrim(COALESCE(p_preceptor_name, '')) = '' THEN
    v_flags := array_append(v_flags, 'missing_preceptor');
  END IF;
  IF v_student.status IS NULL OR v_student.status NOT IN ('Placed', 'Active Rotation') THEN
    v_flags := array_append(v_flags, 'pre_placement_log');
  END IF;

  -- 7. unit_and_preceptor_mismatch - only when the student says this was NOT
  --    their assigned unit. "Recognized" = any assignment whose dated window
  --    covers THIS shift's date, canonically named ('6NE' = '6 NE'); an ENDED
  --    assignment still validates shifts inside its window, and a 'removed'
  --    row validates nothing. Students with no assignment rows keep the
  --    pre-existing single-matched-unit compare.
  IF p_is_assigned_unit IS NOT TRUE THEN
    SELECT count(*) INTO v_assign_count
    FROM public.student_unit_assignments a
    WHERE a.student_id = p_student_id;

    IF v_assign_count > 0 THEN
      SELECT EXISTS (
        SELECT 1 FROM public.student_unit_assignments a
        WHERE a.student_id = p_student_id
          AND a.status IN ('planned', 'active', 'ended')
          AND public.unit_name_key(a.unit_key) = public.unit_name_key(p_unit_name)
          AND (a.start_date IS NULL OR p_shift_date >= a.start_date::text)
          AND (a.end_date   IS NULL OR p_shift_date <= a.end_date::text)
      ) INTO v_recognized;
    ELSE
      v_assigned_nm := '';
      IF v_student.matched_unit_id IS NOT NULL THEN
        SELECT u.unit_name INTO v_assigned_nm
        FROM public.units u WHERE u.id = v_student.matched_unit_id;
      END IF;
      v_recognized := btrim(COALESCE(p_unit_name, '')) = btrim(COALESCE(v_assigned_nm, ''));
    END IF;

    v_prec_differs := btrim(COALESCE(p_preceptor_name, ''))
                   IS DISTINCT FROM btrim(COALESCE(v_student.matched_preceptor, ''));
    IF NOT COALESCE(v_recognized, false) AND v_prec_differs THEN
      v_flags := array_append(v_flags, 'unit_and_preceptor_mismatch');
    END IF;
  END IF;

  v_status := CASE WHEN array_length(v_flags, 1) > 0 THEN 'Pending Review' ELSE 'Auto-Accepted' END;

  RETURN jsonb_build_object(
    'flags', COALESCE(to_jsonb(v_flags), '[]'::jsonb),
    'status', v_status,
    'review_reason', CASE WHEN array_length(v_flags, 1) > 0
                          THEN array_to_string(v_flags, '; ') ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.student_shift_classify(uuid, uuid, text, numeric, text, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.student_shift_classify(uuid, uuid, text, numeric, text, boolean, text)
  TO service_role;

-- ── 5. Edit my own shift (atomic, re-classified under the lock, audited) ─────
-- Error taxonomy (mirrors the shift-log P000x convention):
--   P0001 shift_not_editable   - staff-decided, voided, in progress, or locked
--                                by a downstream artifact (message carries the
--                                exact reason)
--   P0002 shift_not_found      - unknown id OR not this student's (same code:
--                                cross-student ids must not be distinguishable)
--   P0006 invalid_status       - classification produced a non-intake status
CREATE OR REPLACE FUNCTION public.student_edit_shift_log(
  p_shift_id                uuid,
  p_student_id              uuid,
  p_actor_profile_id        uuid,
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
  p_reason                  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_before              record;
  v_after               record;
  v_verdict             jsonb;
  v_class               jsonb;
  v_status              text;
  v_flags               jsonb;
  v_review_reason       text;
  v_recomputed_approved numeric(6,2);
  v_recomputed_pending  numeric(6,2);
BEGIN
  -- The serialization point shared with check-out, staff review, and submission.
  PERFORM 1 FROM public.students WHERE id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Pin the shift and re-verify OWNERSHIP + eligibility UNDER the lock, so a
  -- staff decision landing concurrently loses the race cleanly.
  SELECT * INTO v_before
  FROM public.student_shift_logs
  WHERE id = p_shift_id AND student_id = p_student_id
  FOR UPDATE;
  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'shift_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_verdict := public.student_shift_edit_eligibility(p_shift_id, p_student_id);
  IF (v_verdict->>'editable')::boolean IS DISTINCT FROM true THEN
    IF v_verdict->>'reason' = 'not_found' THEN
      RAISE EXCEPTION 'shift_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'shift_not_editable: %', v_verdict->>'reason' USING ERRCODE = 'P0001';
  END IF;

  -- CLASSIFY HERE, UNDER THE LOCK, from facts read now. The caller supplies
  -- only the student's own intake values; status, flags, and review_reason are
  -- derived server-side and cannot be influenced or raced. A failure inside
  -- the classifier raises and aborts the whole edit (fail closed) rather than
  -- yielding an empty flag set.
  v_class := public.student_shift_classify(
    p_student_id, p_shift_id, p_shift_date, p_total_hours,
    p_unit_name, p_is_assigned_unit, p_preceptor_name);
  v_status        := v_class->>'status';
  v_flags         := v_class->'flags';
  v_review_reason := v_class->>'review_reason';
  IF v_status IS NULL OR v_status NOT IN ('Auto-Accepted', 'Pending Review')
     OR v_flags IS NULL OR jsonb_typeof(v_flags) <> 'array' THEN
    RAISE EXCEPTION 'classification_failed' USING ERRCODE = 'P0006';
  END IF;

  -- Apply. Only student-authored intake fields plus the re-derived
  -- classification move; ownership, cohort, email, attestation, lifecycle, and
  -- every staff-review column are untouched by construction.
  UPDATE public.student_shift_logs
  SET shift_date              = p_shift_date,
      total_hours             = p_total_hours,
      unit_name               = p_unit_name,
      is_assigned_unit        = p_is_assigned_unit,
      unit_override_reason    = COALESCE(p_unit_override_reason, ''),
      preceptor_name          = COALESCE(p_preceptor_name, ''),
      is_assigned_preceptor   = p_is_assigned_preceptor,
      preceptor_override_note = COALESCE(p_preceptor_override_note, ''),
      shift_type              = p_shift_type,
      learning_highlight      = COALESCE(p_learning_highlight, ''),
      support_needed          = COALESCE(p_support_needed, ''),
      status                  = v_status,
      exception_flags         = v_flags,
      review_reason           = v_review_reason
  WHERE id = p_shift_id
    AND student_id = p_student_id
    AND lifecycle_state = 'completed'
    AND status IN ('Auto-Accepted', 'Pending Review')
  RETURNING * INTO v_after;

  IF v_after.id IS NULL THEN
    RAISE EXCEPTION 'shift_not_editable: raced' USING ERRCODE = 'P0001';
  END IF;

  -- Recompute BOTH totals from authoritative rows (the canonical formula).
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

  INSERT INTO public.student_shift_log_edits (
    original_shift_log_id, original_student_id, shift_log_id, student_id, cohort_id,
    action, actor_profile_id, reason,
    before_status, before_lifecycle_state, before_shift_date, before_total_hours,
    before_unit_name, before_preceptor_name, before_shift_type,
    before_exception_flags, before_review_reason,
    after_status, after_lifecycle_state, after_shift_date, after_total_hours,
    after_unit_name, after_preceptor_name, after_shift_type,
    after_exception_flags, after_review_reason,
    approved_hours_after, pending_hours_after
  ) VALUES (
    p_shift_id, p_student_id, p_shift_id, p_student_id, v_before.cohort_id,
    'edited', p_actor_profile_id, COALESCE(btrim(p_reason), ''),
    COALESCE(v_before.status, ''), COALESCE(v_before.lifecycle_state, ''),
    COALESCE(v_before.shift_date, ''), v_before.total_hours,
    COALESCE(v_before.unit_name, ''), COALESCE(v_before.preceptor_name, ''),
    COALESCE(v_before.shift_type, ''),
    COALESCE(v_before.exception_flags, '[]'::jsonb), v_before.review_reason,
    COALESCE(v_after.status, ''), COALESCE(v_after.lifecycle_state, ''),
    COALESCE(v_after.shift_date, ''), v_after.total_hours,
    COALESCE(v_after.unit_name, ''), COALESCE(v_after.preceptor_name, ''),
    COALESCE(v_after.shift_type, ''),
    COALESCE(v_after.exception_flags, '[]'::jsonb), v_after.review_reason,
    v_recomputed_approved, v_recomputed_pending
  );

  RETURN jsonb_build_object(
    'ok', true,
    'action', 'edited',
    'shift_id', p_shift_id,
    'student_id', p_student_id,
    'status', v_after.status,
    'previous_status', v_before.status,
    'total_hours', v_after.total_hours,
    'exception_flags', v_after.exception_flags,
    'approved_hours', v_recomputed_approved,
    'pending_hours', v_recomputed_pending
  );
END;
$$;

REVOKE ALL ON FUNCTION public.student_edit_shift_log(uuid, uuid, uuid, text, numeric, text, boolean, text, text, boolean, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.student_edit_shift_log(uuid, uuid, uuid, text, numeric, text, boolean, text, text, boolean, text, text, text, text, text)
  TO service_role;

-- ── 6. Withdraw (void) my own shift ──────────────────────────────────────────
-- Not a delete: lifecycle_state 'voided' removes the hours from BOTH buckets
-- (every recompute filters lifecycle_state = 'completed') while the row, its
-- submitted values, and its history are preserved exactly as entered.
CREATE OR REPLACE FUNCTION public.student_void_shift_log(
  p_shift_id         uuid,
  p_student_id       uuid,
  p_actor_profile_id uuid,
  p_reason           text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_before              record;
  v_verdict             jsonb;
  v_recomputed_approved numeric(6,2);
  v_recomputed_pending  numeric(6,2);
  v_updated             integer;
BEGIN
  PERFORM 1 FROM public.students WHERE id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_before
  FROM public.student_shift_logs
  WHERE id = p_shift_id AND student_id = p_student_id
  FOR UPDATE;
  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'shift_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_verdict := public.student_shift_edit_eligibility(p_shift_id, p_student_id);
  IF (v_verdict->>'editable')::boolean IS DISTINCT FROM true THEN
    IF v_verdict->>'reason' = 'not_found' THEN
      RAISE EXCEPTION 'shift_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'shift_not_editable: %', v_verdict->>'reason' USING ERRCODE = 'P0001';
  END IF;

  -- Lifecycle only. Status, hours, unit, preceptor, and flags are left exactly
  -- as submitted so the withdrawn entry still reads as what the student
  -- entered - it simply no longer counts anywhere.
  UPDATE public.student_shift_logs
  SET lifecycle_state = 'voided'
  WHERE id = p_shift_id
    AND student_id = p_student_id
    AND lifecycle_state = 'completed'
    AND status IN ('Auto-Accepted', 'Pending Review');
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'shift_not_editable: raced' USING ERRCODE = 'P0001';
  END IF;

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

  INSERT INTO public.student_shift_log_edits (
    original_shift_log_id, original_student_id, shift_log_id, student_id, cohort_id,
    action, actor_profile_id, reason,
    before_status, before_lifecycle_state, before_shift_date, before_total_hours,
    before_unit_name, before_preceptor_name, before_shift_type,
    before_exception_flags, before_review_reason,
    after_status, after_lifecycle_state, after_shift_date, after_total_hours,
    after_unit_name, after_preceptor_name, after_shift_type,
    after_exception_flags, after_review_reason,
    approved_hours_after, pending_hours_after
  ) VALUES (
    p_shift_id, p_student_id, p_shift_id, p_student_id, v_before.cohort_id,
    'voided', p_actor_profile_id, COALESCE(btrim(p_reason), ''),
    COALESCE(v_before.status, ''), COALESCE(v_before.lifecycle_state, ''),
    COALESCE(v_before.shift_date, ''), v_before.total_hours,
    COALESCE(v_before.unit_name, ''), COALESCE(v_before.preceptor_name, ''),
    COALESCE(v_before.shift_type, ''),
    COALESCE(v_before.exception_flags, '[]'::jsonb), v_before.review_reason,
    COALESCE(v_before.status, ''), 'voided',
    COALESCE(v_before.shift_date, ''), v_before.total_hours,
    COALESCE(v_before.unit_name, ''), COALESCE(v_before.preceptor_name, ''),
    COALESCE(v_before.shift_type, ''),
    COALESCE(v_before.exception_flags, '[]'::jsonb), v_before.review_reason,
    v_recomputed_approved, v_recomputed_pending
  );

  RETURN jsonb_build_object(
    'ok', true,
    'action', 'voided',
    'shift_id', p_shift_id,
    'student_id', p_student_id,
    'withdrawn_hours', v_before.total_hours,
    'approved_hours', v_recomputed_approved,
    'pending_hours', v_recomputed_pending
  );
END;
$$;

REVOKE ALL ON FUNCTION public.student_void_shift_log(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.student_void_shift_log(uuid, uuid, uuid, text)
  TO service_role;

-- ── 7. Readiness probe (endpoint fails closed until this is applied) ─────────
CREATE OR REPLACE FUNCTION public.student_shift_edit_ready()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT to_regclass('public.student_shift_log_edits') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'student_edit_shift_log')
     AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'student_void_shift_log');
$$;

REVOKE ALL ON FUNCTION public.student_shift_edit_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.student_shift_edit_ready() TO service_role;

-- ── 8. Extend the student's own read view - APPEND ONLY ─────────────────────
-- COLUMN ORDER IS A CONTRACT. The original 15 columns keep their exact
-- positions (a client doing SELECT * and reading positionally, or any
-- consumer diffing the shape, must not break); the three new columns are
-- APPENDED after reviewed_at:
--   lifecycle_state         - so the portal can label a withdrawn entry;
--   unit_override_reason    - the STUDENT's own words, needed to prefill an
--   preceptor_override_note   edit without silently erasing them.
-- Both override columns are student-authored free text about their own shift,
-- not staff internals. exception_flags, admin_notes, reviewed_by, review_reason
-- and school_email remain excluded exactly as before.
CREATE OR REPLACE VIEW public.portal_my_shift_logs
WITH (security_barrier = true) AS
  SELECT
    -- ORIGINAL 15 COLUMNS, ORIGINAL ORDER - do not reorder or remove.
    l.id, l.student_id, l.cohort_id, l.shift_date, l.total_hours,
    l.unit_name, l.is_assigned_unit, l.preceptor_name, l.is_assigned_preceptor,
    l.shift_type, l.learning_highlight, l.support_needed,
    l.status, l.submitted_at, l.reviewed_at,
    -- APPENDED by 20260819000000:
    l.lifecycle_state, l.unit_override_reason, l.preceptor_override_note
  FROM public.student_shift_logs l
  WHERE l.student_id IN (SELECT public.my_linked_student_ids());

REVOKE ALL ON public.portal_my_shift_logs FROM PUBLIC, anon;
GRANT SELECT ON public.portal_my_shift_logs TO authenticated;
GRANT SELECT ON public.portal_my_shift_logs TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;


-- =============================================================================
-- VERIFICATION (Owner runs after applying - not part of the migration)
-- =============================================================================
-- ONE row, every column TRUE when the migration landed correctly.
--
-- SELECT
--   to_regclass('public.student_shift_log_edits') IS NOT NULL             AS ledger_exists,
--   public.student_shift_edit_ready()                                     AS rpcs_ready,
--   (SELECT count(*) = 5 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public' AND p.proname IN
--       ('student_edit_shift_log','student_void_shift_log','student_shift_edit_eligibility',
--        'student_shift_classify','student_shift_edit_ready'))             AS all_five_functions,
--   NOT has_table_privilege('service_role','public.student_shift_log_edits','UPDATE')
--   AND NOT has_table_privilege('service_role','public.student_shift_log_edits','DELETE')
--   AND has_table_privilege('service_role','public.student_shift_log_edits','INSERT')
--                                                                         AS ledger_append_only,
--   NOT has_table_privilege('authenticated','public.student_shift_log_edits','INSERT')
--                                                                         AS ledger_client_readonly,
--   NOT has_function_privilege('authenticated','public.student_edit_shift_log(uuid,uuid,uuid,text,numeric,text,boolean,text,text,boolean,text,text,text,text,text)','EXECUTE')
--   AND has_function_privilege('service_role','public.student_edit_shift_log(uuid,uuid,uuid,text,numeric,text,boolean,text,text,boolean,text,text,text,text,text)','EXECUTE')
--                                                                         AS edit_rpc_service_only,
--   NOT has_function_privilege('authenticated','public.student_void_shift_log(uuid,uuid,uuid,text)','EXECUTE')
--   AND has_function_privilege('service_role','public.student_void_shift_log(uuid,uuid,uuid,text)','EXECUTE')
--                                                                         AS void_rpc_service_only,
--   NOT has_function_privilege('authenticated','public.student_shift_classify(uuid,uuid,text,numeric,text,boolean,text)','EXECUTE')
--                                                                         AS classifier_not_client_callable,
--   has_sequence_privilege('service_role', pg_get_serial_sequence('public.student_shift_log_edits','id'),'USAGE')
--   AND NOT has_sequence_privilege('anon', pg_get_serial_sequence('public.student_shift_log_edits','id'),'USAGE')
--                                                                         AS sequence_posture,
--   (SELECT count(*) = 0 FROM pg_constraint
--     WHERE conrelid = 'public.student_shift_log_edits'::regclass
--       AND contype = 'f' AND confdeltype = 'c')                           AS no_cascade_fks,
--   -- lifecycle_state is now a closed, NOT NULL vocabulary
--   (SELECT count(*) = 1 FROM pg_constraint
--     WHERE conrelid = 'public.student_shift_logs'::regclass
--       AND conname = 'chk_ssl_lifecycle_state')                           AS lifecycle_constraint,
--   (SELECT attnotnull FROM pg_attribute
--     WHERE attrelid = 'public.student_shift_logs'::regclass
--       AND attname = 'lifecycle_state')                                   AS lifecycle_not_null,
--   (SELECT count(*) = 0 FROM public.student_shift_logs
--     WHERE lifecycle_state NOT IN ('completed','in_progress','voided'))   AS lifecycle_conforms,
--   -- VIEW SHAPE: the original 15 columns keep their exact positions 1..15,
--   -- and the three new columns are appended at 16..18.
--   (SELECT array_agg(column_name::text ORDER BY ordinal_position)
--      FILTER (WHERE ordinal_position <= 15)
--    FROM information_schema.columns WHERE table_name = 'portal_my_shift_logs')
--   = ARRAY['id','student_id','cohort_id','shift_date','total_hours','unit_name',
--           'is_assigned_unit','preceptor_name','is_assigned_preceptor','shift_type',
--           'learning_highlight','support_needed','status','submitted_at','reviewed_at']
--                                                                         AS view_prefix_unchanged,
--   (SELECT array_agg(column_name::text ORDER BY ordinal_position)
--      FILTER (WHERE ordinal_position > 15)
--    FROM information_schema.columns WHERE table_name = 'portal_my_shift_logs')
--   = ARRAY['lifecycle_state','unit_override_reason','preceptor_override_note']
--                                                                         AS view_appended_only,
--   (SELECT count(*) = 0 FROM information_schema.columns
--     WHERE table_name = 'portal_my_shift_logs'
--       AND column_name IN ('exception_flags','admin_notes','reviewed_by','school_email','review_reason'))
--                                                                         AS view_still_hides_internals;
-- -- expect: a single row, every column t
--
-- SMOKE TEST - run the companion executable file
--   db/audit/student_shift_self_service_smoke_test.sql
--   Synthetic, transaction-wrapped, rolled back. Proves ownership isolation,
--   atomic recompute on edit and void, re-classification, staff-decided
--   immutability, downstream-artifact locks, concurrency against a staff
--   review, and that a void is never a delete.
--
-- =============================================================================
-- ROLLBACK (safe - removes only what this migration added)
-- =============================================================================
--   ALTER TABLE public.student_shift_logs DROP CONSTRAINT IF EXISTS chk_ssl_lifecycle_state;
--   ALTER TABLE public.student_shift_logs ALTER COLUMN lifecycle_state DROP NOT NULL;
--   DROP FUNCTION IF EXISTS public.student_shift_classify(uuid, uuid, text, numeric, text, boolean, text);
--   DROP FUNCTION IF EXISTS public.student_shift_edit_ready();
--   DROP FUNCTION IF EXISTS public.student_void_shift_log(uuid, uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.student_edit_shift_log(uuid, uuid, uuid, text, numeric, text, boolean, text, text, boolean, text, text, text, text, text);
--   DROP FUNCTION IF EXISTS public.student_shift_edit_eligibility(uuid, uuid);
--   DROP TABLE IF EXISTS public.student_shift_log_edits;
--   -- restore the pre-migration view (without lifecycle_state):
--   CREATE OR REPLACE VIEW public.portal_my_shift_logs WITH (security_barrier = true) AS
--     SELECT l.id, l.student_id, l.cohort_id, l.shift_date, l.total_hours,
--            l.unit_name, l.is_assigned_unit, l.preceptor_name, l.is_assigned_preceptor,
--            l.shift_type, l.learning_highlight, l.support_needed,
--            l.status, l.submitted_at, l.reviewed_at
--     FROM public.student_shift_logs l
--     WHERE l.student_id IN (SELECT public.my_linked_student_ids());
--   GRANT SELECT ON public.portal_my_shift_logs TO authenticated, service_role;
--   NOTIFY pgrst, 'reload schema';
-- =============================================================================
