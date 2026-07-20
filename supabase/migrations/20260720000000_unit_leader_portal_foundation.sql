-- ============================================================================
-- UNIT LEADER PORTAL: schema foundation
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester) in the Supabase SQL editor, ONLY AFTER      ***
-- *** running every preflight query in                                          ***
-- *** db/audit/unit_leader_portal_preflight_and_verification.sql separately and ***
-- *** reviewing the results. Run the ENTIRE file once (transactional).          ***
--
-- Wave F-2 boundary: this migration does NOT touch storage buckets, storage
-- policies, student file references, or any role behavior established by Wave F-2.
-- It creates no public.is_staff() policy and grants nothing to anon.
--
-- Authorization model: UNCHANGED and REUSED. public.user_unit_scopes already
-- provides identity-backed Unit Leader to unit assignment (user_profiles.id,
-- unit_key, optional cohort_id, starts_at/expires_at, revoked_at/revoked_by,
-- granted_by/granted_at). Nothing here replaces or widens it. Every new table
-- below is authorized THROUGH it, server side, fail closed.
--
-- Unit identity is the canonical unit NAME string (src/lib/unitCatalog.js), as
-- established by 20260712000007. The units DB table is per cohort, so unit_name
-- is the stable identity. New tables therefore carry unit_key text, matching
-- user_unit_scopes.unit_key exactly.
--
-- Sections
--   1. Per-student rotation completion dates       (locked decision: 90-day window)
--   2. Placement requests + response history
--   3. Capacity submissions + review + history
--   4. Unit milestones
--   5. Preceptor nomination state
--   6. Unit Leader notification preferences
--   7. Messages: two-participant Unit Leader to student threads
--   8. Messages: authorization and projection functions
-- ============================================================================

BEGIN;

-- ############################################################################
-- 1. Per-student rotation completion dates
-- ############################################################################
-- The 90-day completed-visibility rule needs a per-student end date. Today
-- students.term_dates is free text, cohorts.start_date/end_date are TEXT, and
-- cohort_school_rotations is granular per (cohort, school) and carries a
-- '1900-01-01' sentinel meaning "pending admin review".
--
-- FAIL CLOSED: rotation_end_date NULL means the student is NEVER shown in the
-- completed bucket. The backfill deliberately copies ONLY non-sentinel dates, so
-- schools whose rotation dates were never filled in stay NULL and stay hidden
-- rather than silently misclassifying.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS rotation_end_date date,
  ADD COLUMN IF NOT EXISTS rotation_completed_at timestamptz;

COMMENT ON COLUMN public.students.rotation_end_date IS
  'Per-student rotation end date. NULL means unknown: the student is never shown in a Unit Leader completed bucket. Backfilled from cohort_school_rotations where non-sentinel.';
COMMENT ON COLUMN public.students.rotation_completed_at IS
  'Set when a rotation is confirmed concluded. Drives the 90-day Unit Leader visibility window when present; falls back to rotation_end_date.';

-- Backfill: only real dates, only for students who actually have a rotation link.
UPDATE public.students s
SET rotation_end_date = r.rotation_end_date
FROM public.cohort_school_rotations r
WHERE s.cohort_school_rotation_id = r.id
  AND s.rotation_end_date IS NULL
  AND r.rotation_end_date <> DATE '1900-01-01';

CREATE INDEX IF NOT EXISTS idx_students_rotation_end_date
  ON public.students (rotation_end_date)
  WHERE rotation_end_date IS NOT NULL;


-- ############################################################################
-- 2. Placement requests
-- ############################################################################
-- No prior table exists. public.matches is a staff-side assignment record with no
-- status, no response, and hard deletes, so it cannot carry a request workflow.
--
-- ASPIRE retains final authority: a Unit Leader response NEVER becomes an approval.
-- unit_response and aspire_status are separate columns by design.

CREATE TABLE IF NOT EXISTS public.unit_placement_requests (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  cohort_id             uuid        NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,
  unit_key              text        NOT NULL,

  -- Unit Leader side
  unit_response         text        NOT NULL DEFAULT 'pending',
  unit_comment          text,
  responded_by_profile_id uuid      REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  responded_at          timestamptz,

  -- ASPIRE side (authoritative)
  aspire_status         text        NOT NULL DEFAULT 'open',
  aspire_decided_by_profile_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  aspire_decided_at     timestamptz,
  aspire_note           text,

  due_at                timestamptz,
  created_by_profile_id uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_upr_unit_response CHECK (unit_response IN (
    'pending', 'accepted', 'declined', 'changes_requested')),
  CONSTRAINT chk_upr_aspire_status CHECK (aspire_status IN (
    'open', 'confirmed', 'withdrawn', 'reassigned')),
  CONSTRAINT chk_upr_response_attribution CHECK (
    (unit_response = 'pending' AND responded_by_profile_id IS NULL AND responded_at IS NULL)
    OR (unit_response <> 'pending' AND responded_by_profile_id IS NOT NULL AND responded_at IS NOT NULL)),
  CONSTRAINT chk_upr_comment_len CHECK (unit_comment IS NULL OR char_length(unit_comment) <= 2000),
  CONSTRAINT chk_upr_unit_key_trimmed CHECK (unit_key = btrim(unit_key) AND char_length(unit_key) > 0)
);

-- At most one open request per student per unit.
CREATE UNIQUE INDEX IF NOT EXISTS uq_upr_open_per_student_unit
  ON public.unit_placement_requests (student_id, unit_key)
  WHERE aspire_status = 'open';
CREATE INDEX IF NOT EXISTS idx_upr_unit_cohort
  ON public.unit_placement_requests (unit_key, cohort_id);

-- Append-only response history. Every transition is recorded, never overwritten.
CREATE TABLE IF NOT EXISTS public.unit_placement_request_events (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         uuid        NOT NULL REFERENCES public.unit_placement_requests(id) ON DELETE CASCADE,
  event_type         text        NOT NULL,
  actor_profile_id   uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  actor_role         text        NOT NULL,
  unit_key           text        NOT NULL,
  from_value         text,
  to_value           text,
  comment            text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_upre_event_type CHECK (event_type IN (
    'created', 'unit_response', 'aspire_decision', 'due_date_change', 'reopened')),
  CONSTRAINT chk_upre_actor_role CHECK (actor_role IN ('unit_leader', 'staff'))
);
CREATE INDEX IF NOT EXISTS idx_upre_request ON public.unit_placement_request_events (request_id, created_at);


-- ############################################################################
-- 3. Capacity submissions
-- ############################################################################
-- public.unit_cohort_responses is UNIQUE(cohort_id, unit_id), overwrites prior
-- values in place, has no ASPIRE review state, and is also written by the
-- UNAUTHENTICATED public unit form. It is deliberately left untouched here as the
-- legacy public-form path. This is the authenticated, reviewable, historied model.

CREATE TABLE IF NOT EXISTS public.unit_capacity_submissions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_key            text        NOT NULL,
  cohort_id           uuid        NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,

  period_label        text        NOT NULL,
  period_start_date   date,
  period_end_date     date,
  shift               text        NOT NULL DEFAULT 'any',
  student_count       integer     NOT NULL,
  notes               text,

  -- ASPIRE review (authoritative)
  review_status       text        NOT NULL DEFAULT 'submitted',
  reviewed_by_profile_id uuid     REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  reviewed_at         timestamptz,
  review_note         text,

  -- supersede-in-place is forbidden; a correction creates a new row
  supersedes_id       uuid        REFERENCES public.unit_capacity_submissions(id) ON DELETE SET NULL,
  superseded_at       timestamptz,

  submitted_by_profile_id uuid    NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  submitted_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_ucs_shift CHECK (shift IN ('any', 'day', 'evening', 'night', 'weekend')),
  CONSTRAINT chk_ucs_count CHECK (student_count >= 0 AND student_count <= 99),
  CONSTRAINT chk_ucs_review_status CHECK (review_status IN (
    'submitted', 'under_review', 'accepted', 'adjusted', 'declined')),
  CONSTRAINT chk_ucs_review_attribution CHECK (
    (review_status = 'submitted' AND reviewed_by_profile_id IS NULL AND reviewed_at IS NULL)
    OR (review_status <> 'submitted' AND reviewed_by_profile_id IS NOT NULL AND reviewed_at IS NOT NULL)),
  CONSTRAINT chk_ucs_period_order CHECK (
    period_start_date IS NULL OR period_end_date IS NULL OR period_end_date >= period_start_date),
  CONSTRAINT chk_ucs_period_label CHECK (
    period_label = btrim(period_label) AND char_length(period_label) BETWEEN 1 AND 120),
  CONSTRAINT chk_ucs_notes_len CHECK (notes IS NULL OR char_length(notes) <= 2000),
  CONSTRAINT chk_ucs_unit_key_trimmed CHECK (unit_key = btrim(unit_key) AND char_length(unit_key) > 0)
);

-- One live submission per unit, cohort, period, and shift. Superseded rows stay.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ucs_live
  ON public.unit_capacity_submissions (unit_key, cohort_id, period_label, shift)
  WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ucs_unit_cohort
  ON public.unit_capacity_submissions (unit_key, cohort_id, submitted_at DESC);


-- ############################################################################
-- 4. Unit milestones
-- ############################################################################
-- No prior table. public.program_events has an unconstrained event_type and a TEXT
-- created_by, so it cannot carry attributable, correctable milestone confirmations.
--
-- Owner/Admin correctability: a milestone is never hard-deleted. A correction sets
-- corrected_at/corrected_by and (optionally) flips confirmed.

CREATE TABLE IF NOT EXISTS public.unit_student_milestones (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  cohort_id             uuid        NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,
  unit_key              text        NOT NULL,
  milestone             text        NOT NULL,

  confirmed             boolean     NOT NULL DEFAULT true,
  confirmed_by_profile_id uuid      NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  confirmed_at          timestamptz NOT NULL DEFAULT now(),
  comment               text,

  corrected_by_profile_id uuid      REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  corrected_at          timestamptz,
  correction_note       text,

  CONSTRAINT chk_usm_milestone CHECK (milestone IN (
    'arrival', 'unit_orientation', 'preceptor_confirmation', 'rotation_conclusion')),
  CONSTRAINT chk_usm_comment_len CHECK (comment IS NULL OR char_length(comment) <= 2000),
  CONSTRAINT chk_usm_correction_consistent CHECK (
    (corrected_at IS NULL AND corrected_by_profile_id IS NULL)
    OR (corrected_at IS NOT NULL AND corrected_by_profile_id IS NOT NULL)),
  CONSTRAINT chk_usm_unit_key_trimmed CHECK (unit_key = btrim(unit_key) AND char_length(unit_key) > 0)
);

-- One live milestone row per student, unit, and milestone.
CREATE UNIQUE INDEX IF NOT EXISTS uq_usm_live
  ON public.unit_student_milestones (student_id, unit_key, milestone)
  WHERE corrected_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_usm_unit_cohort
  ON public.unit_student_milestones (unit_key, cohort_id);


-- ############################################################################
-- 5. Preceptor nomination state
-- ############################################################################
-- public.student_preceptor_assignments is the authoritative assignment record and
-- is staff-written. A Unit Leader NOMINATES; ASPIRE confirms. Nomination is a
-- separate record so a nomination can never masquerade as an assignment.

CREATE TABLE IF NOT EXISTS public.unit_preceptor_nominations (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  cohort_id             uuid        NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,
  unit_key              text        NOT NULL,

  preceptor_id          uuid        REFERENCES public.preceptors(id) ON DELETE SET NULL,
  proposed_name         text,
  note                  text,

  status                text        NOT NULL DEFAULT 'nominated',
  nominated_by_profile_id uuid      NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  nominated_at          timestamptz NOT NULL DEFAULT now(),

  decided_by_profile_id uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  decided_at            timestamptz,
  decision_note         text,
  resulting_assignment_id uuid      REFERENCES public.student_preceptor_assignments(id) ON DELETE SET NULL,

  CONSTRAINT chk_upn_status CHECK (status IN ('nominated', 'confirmed', 'declined', 'withdrawn')),
  CONSTRAINT chk_upn_identifies_someone CHECK (
    preceptor_id IS NOT NULL
    OR (proposed_name IS NOT NULL AND char_length(btrim(proposed_name)) BETWEEN 2 AND 120)),
  CONSTRAINT chk_upn_decision_attribution CHECK (
    (status = 'nominated' AND decided_by_profile_id IS NULL AND decided_at IS NULL)
    OR (status <> 'nominated' AND decided_by_profile_id IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT chk_upn_note_len CHECK (note IS NULL OR char_length(note) <= 2000),
  CONSTRAINT chk_upn_unit_key_trimmed CHECK (unit_key = btrim(unit_key) AND char_length(unit_key) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_upn_one_open_per_student_unit
  ON public.unit_preceptor_nominations (student_id, unit_key)
  WHERE status = 'nominated';
CREATE INDEX IF NOT EXISTS idx_upn_unit_cohort
  ON public.unit_preceptor_nominations (unit_key, cohort_id);


-- ############################################################################
-- 6. Unit Leader notification preferences
-- ############################################################################
-- "Do not email every state change" needs a per-recipient opt-out. No such table
-- exists anywhere. Default is opted IN for the five locked alert types; absence of
-- a row therefore means default behavior, and an explicit row can disable one.

CREATE TABLE IF NOT EXISTS public.unit_leader_notification_prefs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_profile_id   uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  alert_type        text        NOT NULL,
  email_enabled     boolean     NOT NULL DEFAULT true,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ulnp_alert_type CHECK (alert_type IN (
    'placement_request', 'response_deadline', 'onboarding_issue',
    'schedule_change', 'new_message'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ulnp_profile_type
  ON public.unit_leader_notification_prefs (user_profile_id, alert_type);


-- ############################################################################
-- RLS and grants for sections 2 through 6
-- ############################################################################
-- Every new table is SERVER MEDIATED ONLY. The browser gets nothing: no INSERT,
-- UPDATE, or DELETE policy exists, and SELECT is limited to active Owner/Admin for
-- staff oversight. Unit Leaders read through server endpoints that authorize via
-- user_unit_scopes, exactly like the existing unit-roster endpoint. anon gets
-- nothing anywhere.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'unit_placement_requests',
    'unit_placement_request_events',
    'unit_capacity_submissions',
    'unit_student_milestones',
    'unit_preceptor_nominations',
    'unit_leader_notification_prefs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL PRIVILEGES ON public.%I TO service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_admin_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_owner_or_admin())',
      t || '_owner_admin_select', t);
  END LOOP;
END $$;


-- ############################################################################
-- 7. Messages: two-participant Unit Leader to student threads
-- ############################################################################
-- Phase 1 reserved unit_leader in every role CHECK but modelled a conversation as
-- exactly ONE portal participant plus the implicit ASPIRE Team. Two structures
-- block a Unit Leader to student thread. Both are widened here, minimally.

-- 7a. Allow more than one active participant, while still forbidding duplicates.
DROP INDEX IF EXISTS public.uq_conversation_participants_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_participants_active
  ON public.conversation_participants (conversation_id, participant_profile_id)
  WHERE removed_at IS NULL;

-- 7b. Hard cap of two active portal participants per conversation. Replaces the
-- guarantee the old single-column index used to provide. Fail closed: the trigger
-- raises rather than silently allowing an unbounded thread.
CREATE OR REPLACE FUNCTION public.message_assert_participant_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_active integer;
BEGIN
  SELECT count(*) INTO v_active
  FROM public.conversation_participants
  WHERE conversation_id = NEW.conversation_id
    AND removed_at IS NULL;

  IF v_active > 2 THEN
    RAISE EXCEPTION 'MS409 too many active participants for conversation %', NEW.conversation_id
      USING ERRCODE = 'MS409';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_conversation_participant_limit ON public.conversation_participants;
CREATE CONSTRAINT TRIGGER trg_conversation_participant_limit
  AFTER INSERT OR UPDATE ON public.conversation_participants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.message_assert_participant_limit();

-- 7c. Let a unit_leader participant row name the student it concerns.
-- The reserved shape required scope_student_id IS NULL, which modelled a Unit
-- Leader talking to the ASPIRE Team about a unit. A Unit Leader to student thread
-- needs the row to carry the student so authorization can re-verify it on every
-- read. scope_student_id stays OPTIONAL so the original unit-scoped shape (Unit
-- Leader to ASPIRE Team) remains valid and unchanged.
ALTER TABLE public.conversation_participants
  DROP CONSTRAINT IF EXISTS chk_participant_role_scope;
ALTER TABLE public.conversation_participants
  ADD CONSTRAINT chk_participant_role_scope CHECK (
    (participant_role = 'student'
      AND scope_kind = 'student' AND scope_student_id IS NOT NULL
      AND scope_unit_key IS NULL AND scope_school_key IS NULL AND scope_cohort_id IS NULL)
    OR
    (participant_role = 'preceptor'
      AND scope_kind = 'student' AND scope_student_id IS NOT NULL
      AND scope_unit_key IS NULL AND scope_school_key IS NULL)
    OR
    (participant_role = 'unit_leader'
      AND scope_kind = 'unit'
      AND scope_unit_key IS NOT NULL
      AND scope_school_key IS NULL)
    OR
    (participant_role = 'academic_partner'
      AND scope_kind = 'school' AND scope_school_key IS NOT NULL
      AND scope_student_id IS NULL AND scope_unit_key IS NULL)
  );

-- 7d. Delivery event types for the new directions.
ALTER TABLE public.message_notification_deliveries
  DROP CONSTRAINT IF EXISTS chk_mnd_event_type;
ALTER TABLE public.message_notification_deliveries
  ADD CONSTRAINT chk_mnd_event_type CHECK (event_type IN (
    'new_conversation', 'portal_reply', 'staff_reply',
    'unit_leader_message', 'student_to_unit_leader_message'));


-- ############################################################################
-- 8. Messages: authorization and projection functions
-- ############################################################################
-- CREATE OR REPLACE only. No table is touched, grants are preserved.
-- Every function keeps the Phase 1 invariants: access is never derived from a
-- related_* context column, inaccessible and missing are indistinguishable, and
-- the canonical active predicate is used for every grant and scope.

-- 8a. Which conversations may the calling portal user see?
-- Generalized from student-only to (student OR unit_leader). A unit_leader row is
-- valid only while the profile holds an ACTIVE unit_leader grant AND an ACTIVE
-- user_unit_scopes row for that participant row's scope_unit_key. Revoking the
-- scope or deactivating the account removes access on the very next call.
CREATE OR REPLACE FUNCTION public.my_message_conversation_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT p.conversation_id
  FROM public.conversation_participants p
  WHERE p.participant_profile_id = public.portal_profile_id()
    AND p.removed_at IS NULL
    AND (
      -- Student participant: unchanged Phase 1 rule.
      (
        p.participant_role = 'student'
        AND p.scope_kind = 'student'
        AND EXISTS (
          SELECT 1 FROM public.user_role_grants g
          WHERE g.user_profile_id = public.portal_profile_id()
            AND g.role = 'student'
            AND g.revoked_at IS NULL
            AND g.starts_at <= now()
            AND (g.expires_at IS NULL OR g.expires_at > now())
        )
        AND EXISTS (
          SELECT 1 FROM public.user_student_links l
          WHERE l.user_profile_id = public.portal_profile_id()
            AND l.student_id = p.scope_student_id
            AND l.revoked_at IS NULL
        )
      )
      OR
      -- Unit Leader participant: active grant AND active scope on THIS unit.
      (
        p.participant_role = 'unit_leader'
        AND p.scope_kind = 'unit'
        AND EXISTS (
          SELECT 1 FROM public.user_role_grants g
          WHERE g.user_profile_id = public.portal_profile_id()
            AND g.role = 'unit_leader'
            AND g.revoked_at IS NULL
            AND g.starts_at <= now()
            AND (g.expires_at IS NULL OR g.expires_at > now())
        )
        AND EXISTS (
          SELECT 1 FROM public.user_unit_scopes s
          WHERE s.user_profile_id = public.portal_profile_id()
            AND s.unit_key = p.scope_unit_key
            AND s.revoked_at IS NULL
            AND s.starts_at <= now()
            AND (s.expires_at IS NULL OR s.expires_at > now())
        )
      )
    );
$$;

-- 8b. May this profile still receive a notification for this conversation?
-- Same generalization. Used by the delivery worker to suppress mail to a recipient
-- whose access ended between queueing and sending.
CREATE OR REPLACE FUNCTION public.message_recipient_has_active_access(
  p_conversation_id uuid,
  p_profile_id      uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = p_conversation_id
      AND cp.participant_profile_id = p_profile_id
      AND cp.removed_at IS NULL
      AND (
        (
          cp.participant_role = 'student'
          AND cp.scope_kind = 'student'
          AND EXISTS (
            SELECT 1 FROM public.user_role_grants g
            WHERE g.user_profile_id = p_profile_id
              AND g.role = 'student'
              AND g.revoked_at IS NULL
              AND g.starts_at <= now()
              AND (g.expires_at IS NULL OR g.expires_at > now())
          )
          AND EXISTS (
            SELECT 1 FROM public.user_student_links l
            WHERE l.user_profile_id = p_profile_id
              AND l.student_id = cp.scope_student_id
              AND l.revoked_at IS NULL
          )
        )
        OR
        (
          cp.participant_role = 'unit_leader'
          AND cp.scope_kind = 'unit'
          AND EXISTS (
            SELECT 1 FROM public.user_role_grants g
            WHERE g.user_profile_id = p_profile_id
              AND g.role = 'unit_leader'
              AND g.revoked_at IS NULL
              AND g.starts_at <= now()
              AND (g.expires_at IS NULL OR g.expires_at > now())
          )
          AND EXISTS (
            SELECT 1 FROM public.user_unit_scopes s
            WHERE s.user_profile_id = p_profile_id
              AND s.unit_key = cp.scope_unit_key
              AND s.revoked_at IS NULL
              AND s.starts_at <= now()
              AND (s.expires_at IS NULL OR s.expires_at > now())
          )
        )
      )
  );
$$;

-- 8c. Portal unread count.
-- Phase 1 counted only author_role = 'staff', which would never raise a badge for
-- a message from the other portal participant. The correct rule is "authored by
-- someone other than me", which preserves the existing student to staff behavior
-- exactly and additionally counts a Unit Leader to student message.
CREATE OR REPLACE FUNCTION public.messages_portal_unread_count()
RETURNS integer
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(count(*), 0)::integer
  FROM public.messages m
  WHERE m.conversation_id IN (SELECT public.my_message_conversation_ids())
    AND m.author_profile_id <> public.portal_profile_id()
    AND m.created_at > COALESCE(
      (SELECT r.last_read_at FROM public.participant_conversation_reads r
        WHERE r.participant_profile_id = public.portal_profile_id()
          AND r.conversation_id = m.conversation_id),
      '-infinity'::timestamptz);
$$;

COMMIT;


-- ============================================================================
-- Verification: see db/audit/unit_leader_portal_preflight_and_verification.sql
-- ============================================================================

-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Restores the pre-migration state. The new tables are dropped (they are additive
-- and hold only data created after this migration). The messages structures are
-- returned to their Phase 1 definitions verbatim. students.rotation_end_date and
-- rotation_completed_at are dropped, which discards only backfilled and
-- newly-captured values; no pre-existing column is touched.
/*
BEGIN;

-- 8. functions back to Phase 1 shape
CREATE OR REPLACE FUNCTION public.messages_portal_unread_count()
RETURNS integer LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog AS $rb$
  SELECT COALESCE(count(*), 0)::integer
  FROM public.messages m
  WHERE m.conversation_id IN (SELECT public.my_message_conversation_ids())
    AND m.author_role = 'staff'
    AND m.created_at > COALESCE(
      (SELECT r.last_read_at FROM public.participant_conversation_reads r
        WHERE r.participant_profile_id = public.portal_profile_id()
          AND r.conversation_id = m.conversation_id),
      '-infinity'::timestamptz);
$rb$;

CREATE OR REPLACE FUNCTION public.my_message_conversation_ids()
RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog AS $rb$
  SELECT p.conversation_id
  FROM public.conversation_participants p
  WHERE p.participant_profile_id = public.portal_profile_id()
    AND p.removed_at IS NULL
    AND p.participant_role = 'student'
    AND p.scope_kind = 'student'
    AND EXISTS (
      SELECT 1 FROM public.user_role_grants g
      WHERE g.user_profile_id = public.portal_profile_id()
        AND g.role = 'student' AND g.revoked_at IS NULL
        AND g.starts_at <= now()
        AND (g.expires_at IS NULL OR g.expires_at > now()))
    AND EXISTS (
      SELECT 1 FROM public.user_student_links l
      WHERE l.user_profile_id = public.portal_profile_id()
        AND l.student_id = p.scope_student_id
        AND l.revoked_at IS NULL);
$rb$;

CREATE OR REPLACE FUNCTION public.message_recipient_has_active_access(
  p_conversation_id uuid, p_profile_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog AS $rb$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id = p_conversation_id
      AND cp.participant_profile_id = p_profile_id
      AND cp.participant_role = 'student'
      AND cp.scope_kind = 'student'
      AND cp.removed_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.user_role_grants g
        WHERE g.user_profile_id = p_profile_id
          AND g.role = 'student' AND g.revoked_at IS NULL
          AND g.starts_at <= now()
          AND (g.expires_at IS NULL OR g.expires_at > now()))
      AND EXISTS (
        SELECT 1 FROM public.user_student_links l
        WHERE l.user_profile_id = p_profile_id
          AND l.student_id = cp.scope_student_id
          AND l.revoked_at IS NULL));
$rb$;

-- 7. messages structures
ALTER TABLE public.message_notification_deliveries DROP CONSTRAINT IF EXISTS chk_mnd_event_type;
ALTER TABLE public.message_notification_deliveries
  ADD CONSTRAINT chk_mnd_event_type CHECK (event_type IN (
    'new_conversation', 'portal_reply', 'staff_reply'));

ALTER TABLE public.conversation_participants DROP CONSTRAINT IF EXISTS chk_participant_role_scope;
ALTER TABLE public.conversation_participants
  ADD CONSTRAINT chk_participant_role_scope CHECK (
    (participant_role = 'student' AND scope_kind = 'student' AND scope_student_id IS NOT NULL
      AND scope_unit_key IS NULL AND scope_school_key IS NULL AND scope_cohort_id IS NULL)
    OR (participant_role = 'preceptor' AND scope_kind = 'student' AND scope_student_id IS NOT NULL
      AND scope_unit_key IS NULL AND scope_school_key IS NULL)
    OR (participant_role = 'unit_leader' AND scope_kind = 'unit' AND scope_unit_key IS NOT NULL
      AND scope_student_id IS NULL AND scope_school_key IS NULL)
    OR (participant_role = 'academic_partner' AND scope_kind = 'school' AND scope_school_key IS NOT NULL
      AND scope_student_id IS NULL AND scope_unit_key IS NULL));

DROP TRIGGER IF EXISTS trg_conversation_participant_limit ON public.conversation_participants;
DROP FUNCTION IF EXISTS public.message_assert_participant_limit();

DROP INDEX IF EXISTS public.uq_conversation_participants_active;
CREATE UNIQUE INDEX uq_conversation_participants_active
  ON public.conversation_participants (conversation_id) WHERE removed_at IS NULL;

-- 2 through 6. new tables
DROP TABLE IF EXISTS public.unit_leader_notification_prefs;
DROP TABLE IF EXISTS public.unit_preceptor_nominations;
DROP TABLE IF EXISTS public.unit_student_milestones;
DROP TABLE IF EXISTS public.unit_capacity_submissions;
DROP TABLE IF EXISTS public.unit_placement_request_events;
DROP TABLE IF EXISTS public.unit_placement_requests;

-- 1. student columns
DROP INDEX IF EXISTS public.idx_students_rotation_end_date;
ALTER TABLE public.students
  DROP COLUMN IF EXISTS rotation_completed_at,
  DROP COLUMN IF EXISTS rotation_end_date;

COMMIT;
*/
