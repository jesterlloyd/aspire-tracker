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

-- Backfill: ONLY where the source is uniquely and confidently determined.
--
-- Every condition below is required. If any one fails the field stays NULL, and a
-- NULL rotation_end_date makes the student invisible in the completed bucket, so
-- every failure mode is a fail-closed failure mode.
--
--   a. the student carries an explicit FK to one rotation row. cohort_school_rotations.id
--      is the primary key, so this join can match AT MOST ONE source row: the
--      backfill is structurally incapable of an ambiguous multi-row match.
--   b. that row's cohort AND school still agree with the student's own cohort and
--      school. This catches drift where a student was moved between cohorts or
--      schools after the FK was set, in which case the linked dates are no longer
--      trustworthy and are deliberately NOT copied.
--   c. the date is not the '1900-01-01' sentinel, which means "pending admin review".
--   d. the column is already a real `date`, so no cast, parse, or coercion occurs.
--
-- Explicitly NOT used as a source, in any branch: shift logs, students.term_dates
-- (free text), and cohorts.start_date / end_date (TEXT). Nothing is inferred.
--
-- rotation_completed_at is deliberately NOT backfilled at all: no existing column
-- records when a rotation was actually confirmed concluded, and inventing one from
-- a scheduled end date would be exactly the inference this rule forbids. It is
-- populated going forward by the milestone confirmation flow.
UPDATE public.students s
SET rotation_end_date = r.rotation_end_date
FROM public.cohort_school_rotations r
WHERE s.cohort_school_rotation_id = r.id
  AND s.rotation_end_date IS NULL
  AND r.rotation_end_date IS NOT NULL
  AND r.rotation_end_date <> DATE '1900-01-01'
  AND r.cohort_id   = s.cohort_id
  AND r.school_name = s.school;

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
--
-- THE CENTRAL RULE OF THIS SECTION: read authorization and send authorization are
-- SEPARATE predicates.
--
--   Historical READ  survives the end of a unit assignment. It rests on the
--                    identity-backed participant row that was created WHILE the
--                    scope was valid, plus a live active account and role grant.
--   SEND             always requires CURRENT active unit scope. A former Unit
--                    Leader can read the thread and can never add to it.
--
-- This is why a single "has access" predicate is no longer sufficient and is split
-- into message_participant_can_read and message_participant_can_send below.
--
-- Everything else keeps the Phase 1 invariants: access is never derived from a
-- related_* context column, inaccessible and missing are indistinguishable, and the
-- canonical active predicate is used for every grant and scope.

-- 8a. Is this profile's ACCOUNT live?
-- portal_profile_id() maps auth.uid() to a profile and does NOT check is_active, so
-- the historical-read path (the one thing that now survives scope revocation) checks
-- it explicitly rather than relying on the API layer alone.
CREATE OR REPLACE FUNCTION public.message_profile_is_active(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = p_profile_id
      AND COALESCE(up.is_active, true) IS TRUE
  );
$$;

-- 8b. READ: may this profile see this conversation and its history?
--
-- Student branch: UNCHANGED from Phase 1, deliberately, so every existing portal to
-- ASPIRE Team thread behaves exactly as before.
--
-- Unit Leader branch: the participant row plus an active unit_leader grant plus a
-- live account. It does NOT require an active user_unit_scopes row, which is what
-- preserves historical visibility after the assignment ends. The participant row is
-- the identity-backed record, created while the scope was valid, and it is never
-- forged by a client: only the server writes conversation_participants.
--
-- A newly assigned Unit Leader gets NO access to a former leader's thread, because
-- access is per participant row and a new leader holds none on that conversation.
CREATE OR REPLACE FUNCTION public.message_participant_can_read(
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
          -- Live account. An inactive Unit Leader is denied ALL portal access,
          -- including historical thread access.
          AND public.message_profile_is_active(p_profile_id)
          -- Still a Unit Leader at all. Losing the role grant removes the portal.
          AND EXISTS (
            SELECT 1 FROM public.user_role_grants g
            WHERE g.user_profile_id = p_profile_id
              AND g.role = 'unit_leader'
              AND g.revoked_at IS NULL
              AND g.starts_at <= now()
              AND (g.expires_at IS NULL OR g.expires_at > now())
          )
          -- Deliberately NO user_unit_scopes requirement: history survives the end
          -- of the assignment. Sending does not (see 8c).
        )
      )
  );
$$;

-- 8c. SEND: may this profile add a NEW message to this conversation?
--
-- Always requires read, and then CURRENT operational standing:
--   unit_leader  an ACTIVE user_unit_scopes row for that participant row's unit.
--   student      if the thread has a Unit Leader participant (a direct thread), that
--                Unit Leader must still hold active scope. This is the "current
--                active direct-thread relationship" rule: once the relationship
--                ends, neither side may add to it. A student to ASPIRE Team thread
--                has no Unit Leader participant, so this clause is inert and student
--                behavior is unchanged.
CREATE OR REPLACE FUNCTION public.message_participant_can_send(
  p_conversation_id uuid,
  p_profile_id      uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT
    public.message_participant_can_read(p_conversation_id, p_profile_id)
    AND NOT EXISTS (
      -- Any Unit Leader participant on this thread whose scope has ended freezes it
      -- for BOTH portal parties.
      SELECT 1
      FROM public.conversation_participants cp
      WHERE cp.conversation_id = p_conversation_id
        AND cp.removed_at IS NULL
        AND cp.participant_role = 'unit_leader'
        AND NOT EXISTS (
          SELECT 1 FROM public.user_unit_scopes s
          WHERE s.user_profile_id = cp.participant_profile_id
            AND s.unit_key = cp.scope_unit_key
            AND s.revoked_at IS NULL
            AND s.starts_at <= now()
            AND (s.expires_at IS NULL OR s.expires_at > now())
        )
    );
$$;

-- 8d. Which conversations may the calling portal user SEE?
-- Uses the READ predicate, so a former Unit Leader keeps the thread in their list.
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
    AND public.message_participant_can_read(p.conversation_id, public.portal_profile_id());
$$;

-- 8e. May this profile still RECEIVE a notification for this conversation?
-- Read is the right bar: staff may reply to a former Unit Leader who can still read
-- the thread, and that reply should reach them.
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
  SELECT public.message_participant_can_read(p_conversation_id, p_profile_id);
$$;

-- 8f. Portal unread count.
-- Phase 1 counted only author_role = 'staff', which would never raise a badge for a
-- message from the other portal participant. The correct rule is "authored by
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

-- 8g. Delivery validation: admit the two direct-thread event types.
-- Both route to portal_user, because a direct Unit Leader to student message
-- notifies the OTHER portal participant and never staff. Every existing binding
-- (new_conversation -> shared_inbox, portal_reply -> staff, staff_reply ->
-- portal_user) is preserved byte for byte.
CREATE OR REPLACE FUNCTION public.message_assert_valid_delivery(
  p_delivery         jsonb,
  p_expected_event   text,
  p_actor_profile_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_key   text;
  v_email text;
  v_kind  text;
  v_event text;
  v_rp    uuid;
  v_k     text;
BEGIN
  IF p_delivery IS NULL OR jsonb_typeof(p_delivery) <> 'object' THEN
    RAISE EXCEPTION 'delivery payload is required' USING ERRCODE = 'MS400';
  END IF;

  -- No message content may ever enter a delivery row.
  FOR v_k IN SELECT jsonb_object_keys(p_delivery) LOOP
    IF v_k ~* '(^|_)(body|preview|snippet|content|html|text|quote|quoted)(_|$)' THEN
      RAISE EXCEPTION 'delivery payload may not contain message content'
        USING ERRCODE = 'MS400';
    END IF;
  END LOOP;

  v_key   := btrim(coalesce(p_delivery->>'idempotency_key', ''));
  v_email := btrim(coalesce(p_delivery->>'recipient_email', ''));
  v_kind  := coalesce(p_delivery->>'recipient_kind', '');
  v_event := coalesce(p_delivery->>'event_type', '');
  v_rp    := NULLIF(p_delivery->>'recipient_profile_id', '')::uuid;

  IF v_key = '' THEN
    RAISE EXCEPTION 'delivery idempotency_key is required' USING ERRCODE = 'MS400';
  END IF;
  IF v_email = '' THEN
    RAISE EXCEPTION 'delivery recipient_email is required' USING ERRCODE = 'MS400';
  END IF;
  IF v_kind NOT IN ('shared_inbox', 'assigned_staff', 'portal_user') THEN
    RAISE EXCEPTION 'invalid delivery recipient_kind' USING ERRCODE = 'MS400';
  END IF;
  IF v_event NOT IN ('new_conversation', 'portal_reply', 'staff_reply',
                     'unit_leader_message', 'student_to_unit_leader_message') THEN
    RAISE EXCEPTION 'invalid delivery event_type' USING ERRCODE = 'MS400';
  END IF;
  IF v_event <> p_expected_event THEN
    RAISE EXCEPTION 'delivery event_type does not match the operation'
      USING ERRCODE = 'MS400';
  END IF;

  -- The recipient kind must match the approved Phase 2 routing shape.
  IF v_event = 'new_conversation' AND v_kind <> 'shared_inbox' THEN
    RAISE EXCEPTION 'new_conversation must route to the shared inbox' USING ERRCODE = 'MS400';
  END IF;
  IF v_event = 'portal_reply' AND v_kind NOT IN ('shared_inbox', 'assigned_staff') THEN
    RAISE EXCEPTION 'portal_reply must route to staff' USING ERRCODE = 'MS400';
  END IF;
  IF v_event = 'staff_reply' AND v_kind <> 'portal_user' THEN
    RAISE EXCEPTION 'staff_reply must route to the portal participant' USING ERRCODE = 'MS400';
  END IF;
  -- UL-PORTAL: a direct Unit Leader to student thread notifies the OTHER portal
  -- participant, never staff. Both new directions therefore route to portal_user.
  IF v_event IN ('unit_leader_message', 'student_to_unit_leader_message')
     AND v_kind <> 'portal_user' THEN
    RAISE EXCEPTION 'direct portal message must route to the other portal participant'
      USING ERRCODE = 'MS400';
  END IF;
  IF v_kind = 'portal_user' AND v_rp IS NULL THEN
    RAISE EXCEPTION 'portal_user delivery requires recipient_profile_id' USING ERRCODE = 'MS400';
  END IF;

  -- The sender is never the recipient.
  IF v_rp IS NOT NULL AND v_rp = p_actor_profile_id THEN
    RAISE EXCEPTION 'sender may not be the notification recipient' USING ERRCODE = 'MS400';
  END IF;

  -- Required safe snapshot and CTA fields.
  IF btrim(coalesce(p_delivery->>'snapshot_sender_name', '')) = '' THEN
    RAISE EXCEPTION 'delivery snapshot_sender_name is required' USING ERRCODE = 'MS400';
  END IF;
  IF btrim(coalesce(p_delivery->>'snapshot_subject', '')) = '' THEN
    RAISE EXCEPTION 'delivery snapshot_subject is required' USING ERRCODE = 'MS400';
  END IF;
  IF btrim(coalesce(p_delivery->>'cta_path', '')) = '' THEN
    RAISE EXCEPTION 'delivery cta_path is required' USING ERRCODE = 'MS400';
  END IF;
END;
$$;

-- 8h. Reply. Portal actors are gated by SEND, staff targets are gated by READ.
CREATE OR REPLACE FUNCTION public.messages_post_reply(
  p_actor_profile_id uuid,
  p_actor_kind       text,
  p_conversation_id  uuid,
  p_body             text,
  p_delivery         jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now            timestamptz := now();
  v_message_id     uuid;
  v_delivery_id    uuid;
  v_status         text;
  v_reopened       boolean := false;
  v_author_role    text;
  v_participant    uuid;
  v_expected_event text;
BEGIN
  IF p_actor_kind NOT IN ('student', 'staff', 'unit_leader') THEN
    RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(btrim(coalesce(p_body, ''))) < 1 OR char_length(p_body) > 5000 THEN
    RAISE EXCEPTION 'body must be 1 to 5000 characters' USING ERRCODE = 'MS400';
  END IF;

  SELECT status INTO v_status FROM public.conversations WHERE id = p_conversation_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
  END IF;

  IF p_actor_kind IN ('student', 'unit_leader') THEN
    -- SEND authorization, not read. A former Unit Leader can still READ this thread
    -- but must never add to it, and once a direct relationship ends the thread is
    -- frozen for BOTH portal parties. can_send requires current active unit scope.
    IF NOT public.message_participant_can_send(p_conversation_id, p_actor_profile_id) THEN
      -- Non-enumerating: a readable-but-frozen thread and an invisible one are
      -- indistinguishable to the caller.
      RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
    END IF;
    IF p_actor_kind = 'student' THEN
      v_author_role := 'student';
      -- Unchanged for a student to ASPIRE Team thread. A student replying in a
      -- DIRECT thread notifies the unit leader instead, which the caller declares.
      v_expected_event := CASE
        WHEN p_delivery->>'event_type' = 'student_to_unit_leader_message'
          THEN 'student_to_unit_leader_message'
        ELSE 'portal_reply' END;
    ELSE
      v_author_role    := 'unit_leader';
      v_expected_event := 'unit_leader_message';
    END IF;
  ELSE
    IF NOT public.message_profile_is_active_owner_or_admin(p_actor_profile_id) THEN
      RAISE EXCEPTION 'staff actor must be an active owner or admin' USING ERRCODE = 'MS403';
    END IF;
    -- UL-PORTAL: a conversation may now hold TWO active portal participants, and
    -- staff must be able to intervene even after a unit assignment has ended. The
    -- old "SELECT ... LIMIT 1" resolution was NONDETERMINISTIC with two rows and
    -- could refuse a legitimate intervention.
    --
    -- The delivery's declared recipient is now authoritative, and is validated to be
    -- a participant of THIS conversation who can still READ it. Read, not send: a
    -- former Unit Leader may still receive a staff reply.
    v_participant := NULLIF(p_delivery->>'recipient_profile_id', '')::uuid;
    IF v_participant IS NULL
       OR NOT EXISTS (
            SELECT 1 FROM public.conversation_participants cp
            WHERE cp.conversation_id = p_conversation_id
              AND cp.participant_profile_id = v_participant
              AND cp.removed_at IS NULL)
       OR NOT public.message_participant_can_read(p_conversation_id, v_participant) THEN
      RAISE EXCEPTION 'participant portal access is not active' USING ERRCODE = 'MS409';
    END IF;
    v_author_role    := 'staff';
    v_expected_event := 'staff_reply';
  END IF;

  -- REQUIRED durable delivery payload, validated before any authoritative write.
  PERFORM public.message_assert_valid_delivery(p_delivery, v_expected_event, p_actor_profile_id);

  -- A staff reply must target the conversation's active portal participant.
  IF p_actor_kind = 'staff'
     AND NULLIF(p_delivery->>'recipient_profile_id', '')::uuid IS DISTINCT FROM v_participant THEN
    RAISE EXCEPTION 'staff reply must notify the active conversation participant'
      USING ERRCODE = 'MS400';
  END IF;

  -- Automatic reopen on reply to a resolved conversation.
  IF v_status = 'resolved' THEN
    UPDATE public.conversations
    SET status = 'open', resolved_at = NULL, updated_at = v_now
    WHERE id = p_conversation_id;
    INSERT INTO public.conversation_events (conversation_id, event_type, actor_profile_id, from_value, to_value, created_at)
    VALUES (p_conversation_id, 'reopened', p_actor_profile_id, 'resolved', 'open', v_now);
    v_reopened := true;
  END IF;

  INSERT INTO public.messages (conversation_id, author_profile_id, author_role, body, created_at)
  VALUES (p_conversation_id, p_actor_profile_id, v_author_role, p_body, v_now)
  RETURNING id INTO v_message_id;

  UPDATE public.conversations
  SET last_message_at = v_now, updated_at = v_now
  WHERE id = p_conversation_id;

  IF p_actor_kind IN ('student', 'unit_leader') THEN
    INSERT INTO public.participant_conversation_reads (participant_profile_id, conversation_id, last_read_at)
    VALUES (p_actor_profile_id, p_conversation_id, v_now)
    ON CONFLICT (participant_profile_id, conversation_id) DO UPDATE SET last_read_at = v_now;
  ELSE
    INSERT INTO public.staff_conversation_reads (staff_profile_id, conversation_id, last_read_at)
    VALUES (p_actor_profile_id, p_conversation_id, v_now)
    ON CONFLICT (staff_profile_id, conversation_id) DO UPDATE SET last_read_at = v_now;
  END IF;

  -- Durable queued delivery row, same transaction, no silent conflict skip.
  BEGIN
    INSERT INTO public.message_notification_deliveries (
      conversation_id, message_id, triggered_by_profile_id, recipient_profile_id,
      recipient_email, recipient_kind, event_type, idempotency_key,
      queue_status, next_attempt_at,
      snapshot_sender_name, snapshot_subject, snapshot_category, cta_path
    ) VALUES (
      p_conversation_id, v_message_id, p_actor_profile_id,
      NULLIF(p_delivery->>'recipient_profile_id', '')::uuid,
      p_delivery->>'recipient_email', p_delivery->>'recipient_kind',
      p_delivery->>'event_type', p_delivery->>'idempotency_key',
      'queued', v_now,
      p_delivery->>'snapshot_sender_name', p_delivery->>'snapshot_subject',
      p_delivery->>'snapshot_category', p_delivery->>'cta_path'
    )
    RETURNING id INTO v_delivery_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate notification delivery for this message'
      USING ERRCODE = 'MS409';
  END;

  IF v_delivery_id IS NULL THEN
    RAISE EXCEPTION 'delivery row was not created' USING ERRCODE = 'MS409';
  END IF;

  RETURN jsonb_build_object(
    'message_id', v_message_id,
    'delivery_id', v_delivery_id,
    'created_at', v_now,
    'reopened', v_reopened
  );
END;
$$;

-- 8i. Start a conversation. Adds the unit_leader actor for a DIRECT thread, which
-- always requires current active scope, so an ended relationship can never be
-- restarted. Student and staff paths are unchanged.
--
-- SIGNATURE CHANGE, handled deliberately: this adds a 9th argument (p_unit_key).
-- CREATE OR REPLACE cannot change a function's argument list, so leaving the old
-- 8-argument form in place would create an OVERLOAD, and every existing 8-argument
-- call would then fail with "function is not unique" because the 9th argument has a
-- DEFAULT. The old signature is therefore dropped first, and because DROP plus
-- CREATE does NOT preserve grants (unlike CREATE OR REPLACE), the exact Phase 3
-- grants are re-applied immediately after the new definition below.
DROP FUNCTION IF EXISTS public.messages_start_conversation(
  uuid, text, uuid, uuid, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.messages_start_conversation(
  p_actor_profile_id       uuid,
  p_actor_kind             text,
  p_participant_profile_id uuid,
  p_student_id             uuid,
  p_unit_key               text DEFAULT NULL,
  p_subject                text,
  p_category               text,
  p_body                   text,
  p_delivery               jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now             timestamptz := now();
  v_conversation_id uuid;
  v_message_id      uuid;
  v_delivery_id     uuid;
  v_subject         text := btrim(coalesce(p_subject, ''));
  v_author_role     text;
  v_expected_event  text;
  v_unit_key        text := nullif(btrim(coalesce(p_unit_key, '')), '');
BEGIN
  IF p_actor_kind NOT IN ('student', 'staff', 'unit_leader') THEN
    RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(v_subject) < 3 OR char_length(v_subject) > 120 THEN
    RAISE EXCEPTION 'subject must be 3 to 120 characters' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(btrim(coalesce(p_body, ''))) < 1 OR char_length(p_body) > 5000 THEN
    RAISE EXCEPTION 'body must be 1 to 5000 characters' USING ERRCODE = 'MS400';
  END IF;

  -- The participant must hold active student portal access in every case.
  IF NOT public.message_profile_has_active_student_link(p_participant_profile_id, p_student_id) THEN
    RAISE EXCEPTION 'participant portal access is not active' USING ERRCODE = 'MS409';
  END IF;

  IF p_actor_kind = 'student' THEN
    IF p_actor_profile_id IS DISTINCT FROM p_participant_profile_id THEN
      RAISE EXCEPTION 'student may only start their own conversation' USING ERRCODE = 'MS403';
    END IF;
    v_author_role    := 'student';
    v_expected_event := 'new_conversation';
  ELSIF p_actor_kind = 'unit_leader' THEN
    -- A DIRECT thread. Creation ALWAYS requires current active scope, so a former
    -- Unit Leader can never start a new thread on the ended relationship. A newly
    -- assigned Unit Leader creating a thread gets a NEW conversation with their own
    -- participant row, and never access to a predecessor's thread.
    IF v_unit_key IS NULL THEN
      RAISE EXCEPTION 'unit key is required to start a direct thread' USING ERRCODE = 'MS400';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.user_role_grants g
      WHERE g.user_profile_id = p_actor_profile_id
        AND g.role = 'unit_leader'
        AND g.revoked_at IS NULL
        AND g.starts_at <= now()
        AND (g.expires_at IS NULL OR g.expires_at > now())
    ) OR NOT public.message_profile_is_active(p_actor_profile_id) THEN
      RAISE EXCEPTION 'unit leader access is not active' USING ERRCODE = 'MS403';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.user_unit_scopes s
      WHERE s.user_profile_id = p_actor_profile_id
        AND s.unit_key = v_unit_key
        AND s.revoked_at IS NULL
        AND s.starts_at <= now()
        AND (s.expires_at IS NULL OR s.expires_at > now())
    ) THEN
      RAISE EXCEPTION 'unit scope is not active' USING ERRCODE = 'MS403';
    END IF;
    -- The student must actually be placed in that unit. Resolved server side from
    -- students.matched_unit_id, never from a client-supplied unit value.
    IF NOT EXISTS (
      SELECT 1
      FROM public.students st
      JOIN public.units u ON u.id = st.matched_unit_id
      WHERE st.id = p_student_id
        AND u.unit_name = v_unit_key
    ) THEN
      RAISE EXCEPTION 'student is not in that unit' USING ERRCODE = 'MS403';
    END IF;
    v_author_role    := 'unit_leader';
    v_expected_event := 'unit_leader_message';
  ELSE
    IF NOT public.message_profile_is_active_owner_or_admin(p_actor_profile_id) THEN
      RAISE EXCEPTION 'staff actor must be an active owner or admin' USING ERRCODE = 'MS403';
    END IF;
    v_author_role    := 'staff';
    v_expected_event := 'staff_reply';
  END IF;

  -- REQUIRED durable delivery payload. Validated before any authoritative write
  -- so an invalid payload fails fast and creates nothing.
  PERFORM public.message_assert_valid_delivery(p_delivery, v_expected_event, p_actor_profile_id);

  INSERT INTO public.conversations (
    subject, category, status, created_by_profile_id, created_by_role,
    related_student_id, last_message_at, created_at, updated_at
  ) VALUES (
    v_subject, p_category, 'open', p_actor_profile_id, v_author_role,
    p_student_id, v_now, v_now, v_now
  ) RETURNING id INTO v_conversation_id;

  INSERT INTO public.conversation_participants (
    conversation_id, participant_profile_id, participant_role, scope_kind,
    scope_student_id, added_at
  ) VALUES (
    v_conversation_id, p_participant_profile_id, 'student', 'student',
    p_student_id, v_now
  );

  -- A direct thread carries a SECOND participant row for the Unit Leader, scoped to
  -- the unit and naming the student. This row is the identity-backed record that
  -- keeps history readable after the assignment ends. Two rows is the cap.
  IF p_actor_kind = 'unit_leader' THEN
    INSERT INTO public.conversation_participants (
      conversation_id, participant_profile_id, participant_role, scope_kind,
      scope_student_id, scope_unit_key, added_at
    ) VALUES (
      v_conversation_id, p_actor_profile_id, 'unit_leader', 'unit',
      p_student_id, v_unit_key, v_now
    );
  END IF;

  INSERT INTO public.messages (conversation_id, author_profile_id, author_role, body, created_at)
  VALUES (v_conversation_id, p_actor_profile_id, v_author_role, p_body, v_now)
  RETURNING id INTO v_message_id;

  INSERT INTO public.conversation_events (conversation_id, event_type, actor_profile_id, to_value, created_at)
  VALUES (v_conversation_id, 'created', p_actor_profile_id, 'open', v_now);

  -- The SENDER's read pointer only. The recipient is never marked read.
  IF p_actor_kind IN ('student', 'unit_leader') THEN
    INSERT INTO public.participant_conversation_reads (participant_profile_id, conversation_id, last_read_at)
    VALUES (p_actor_profile_id, v_conversation_id, v_now)
    ON CONFLICT (participant_profile_id, conversation_id) DO UPDATE SET last_read_at = v_now;
  ELSE
    INSERT INTO public.staff_conversation_reads (staff_profile_id, conversation_id, last_read_at)
    VALUES (p_actor_profile_id, v_conversation_id, v_now)
    ON CONFLICT (staff_profile_id, conversation_id) DO UPDATE SET last_read_at = v_now;
  END IF;

  -- Durable queued delivery row, in the SAME transaction as the authoritative
  -- write. NO ON CONFLICT DO NOTHING: the message is new inside this
  -- transaction, so an existing row for this key can never legitimately belong
  -- to it. A conflict aborts everything rather than committing a message with no
  -- delivery record. The unique idempotency guarantee is unchanged.
  BEGIN
    INSERT INTO public.message_notification_deliveries (
      conversation_id, message_id, triggered_by_profile_id, recipient_profile_id,
      recipient_email, recipient_kind, event_type, idempotency_key,
      queue_status, next_attempt_at,
      snapshot_sender_name, snapshot_subject, snapshot_category, cta_path
    ) VALUES (
      v_conversation_id, v_message_id, p_actor_profile_id,
      NULLIF(p_delivery->>'recipient_profile_id', '')::uuid,
      p_delivery->>'recipient_email', p_delivery->>'recipient_kind',
      p_delivery->>'event_type', p_delivery->>'idempotency_key',
      'queued', v_now,
      p_delivery->>'snapshot_sender_name', p_delivery->>'snapshot_subject',
      p_delivery->>'snapshot_category', p_delivery->>'cta_path'
    )
    RETURNING id INTO v_delivery_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate notification delivery for this message'
      USING ERRCODE = 'MS409';
  END;

  IF v_delivery_id IS NULL THEN
    RAISE EXCEPTION 'delivery row was not created' USING ERRCODE = 'MS409';
  END IF;

  RETURN jsonb_build_object(
    'conversation_id', v_conversation_id,
    'message_id', v_message_id,
    'delivery_id', v_delivery_id,
    'created_at', v_now,
    'status', 'open'
  );
END;
$$;

-- Restore the exact Phase 3 grants for the re-created function.
REVOKE ALL ON FUNCTION public.messages_start_conversation(
  uuid, text, uuid, uuid, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.messages_start_conversation(
  uuid, text, uuid, uuid, text, text, text, jsonb, text) TO service_role;

-- The new helper functions follow the same rule as every other messages helper:
-- never callable by a browser role.
REVOKE ALL ON FUNCTION public.message_profile_is_active(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.message_participant_can_read(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.message_participant_can_send(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.message_profile_is_active(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.message_participant_can_read(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.message_participant_can_send(uuid, uuid) TO service_role;

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

-- 8g/8h/8i. delivery validator, reply, and start back to Phase 3 shape
CREATE OR REPLACE FUNCTION public.message_assert_valid_delivery(
  p_delivery         jsonb,
  p_expected_event   text,
  p_actor_profile_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_key   text;
  v_email text;
  v_kind  text;
  v_event text;
  v_rp    uuid;
  v_k     text;
BEGIN
  IF p_delivery IS NULL OR jsonb_typeof(p_delivery) <> 'object' THEN
    RAISE EXCEPTION 'delivery payload is required' USING ERRCODE = 'MS400';
  END IF;

  -- No message content may ever enter a delivery row.
  FOR v_k IN SELECT jsonb_object_keys(p_delivery) LOOP
    IF v_k ~* '(^|_)(body|preview|snippet|content|html|text|quote|quoted)(_|$)' THEN
      RAISE EXCEPTION 'delivery payload may not contain message content'
        USING ERRCODE = 'MS400';
    END IF;
  END LOOP;

  v_key   := btrim(coalesce(p_delivery->>'idempotency_key', ''));
  v_email := btrim(coalesce(p_delivery->>'recipient_email', ''));
  v_kind  := coalesce(p_delivery->>'recipient_kind', '');
  v_event := coalesce(p_delivery->>'event_type', '');
  v_rp    := NULLIF(p_delivery->>'recipient_profile_id', '')::uuid;

  IF v_key = '' THEN
    RAISE EXCEPTION 'delivery idempotency_key is required' USING ERRCODE = 'MS400';
  END IF;
  IF v_email = '' THEN
    RAISE EXCEPTION 'delivery recipient_email is required' USING ERRCODE = 'MS400';
  END IF;
  IF v_kind NOT IN ('shared_inbox', 'assigned_staff', 'portal_user') THEN
    RAISE EXCEPTION 'invalid delivery recipient_kind' USING ERRCODE = 'MS400';
  END IF;
  IF v_event NOT IN ('new_conversation', 'portal_reply', 'staff_reply') THEN
    RAISE EXCEPTION 'invalid delivery event_type' USING ERRCODE = 'MS400';
  END IF;
  IF v_event <> p_expected_event THEN
    RAISE EXCEPTION 'delivery event_type does not match the operation'
      USING ERRCODE = 'MS400';
  END IF;

  -- The recipient kind must match the approved Phase 2 routing shape.
  IF v_event = 'new_conversation' AND v_kind <> 'shared_inbox' THEN
    RAISE EXCEPTION 'new_conversation must route to the shared inbox' USING ERRCODE = 'MS400';
  END IF;
  IF v_event = 'portal_reply' AND v_kind NOT IN ('shared_inbox', 'assigned_staff') THEN
    RAISE EXCEPTION 'portal_reply must route to staff' USING ERRCODE = 'MS400';
  END IF;
  IF v_event = 'staff_reply' AND v_kind <> 'portal_user' THEN
    RAISE EXCEPTION 'staff_reply must route to the portal participant' USING ERRCODE = 'MS400';
  END IF;
  IF v_kind = 'portal_user' AND v_rp IS NULL THEN
    RAISE EXCEPTION 'portal_user delivery requires recipient_profile_id' USING ERRCODE = 'MS400';
  END IF;

  -- The sender is never the recipient.
  IF v_rp IS NOT NULL AND v_rp = p_actor_profile_id THEN
    RAISE EXCEPTION 'sender may not be the notification recipient' USING ERRCODE = 'MS400';
  END IF;

  -- Required safe snapshot and CTA fields.
  IF btrim(coalesce(p_delivery->>'snapshot_sender_name', '')) = '' THEN
    RAISE EXCEPTION 'delivery snapshot_sender_name is required' USING ERRCODE = 'MS400';
  END IF;
  IF btrim(coalesce(p_delivery->>'snapshot_subject', '')) = '' THEN
    RAISE EXCEPTION 'delivery snapshot_subject is required' USING ERRCODE = 'MS400';
  END IF;
  IF btrim(coalesce(p_delivery->>'cta_path', '')) = '' THEN
    RAISE EXCEPTION 'delivery cta_path is required' USING ERRCODE = 'MS400';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.messages_post_reply(
  p_actor_profile_id uuid,
  p_actor_kind       text,
  p_conversation_id  uuid,
  p_body             text,
  p_delivery         jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now            timestamptz := now();
  v_message_id     uuid;
  v_delivery_id    uuid;
  v_status         text;
  v_reopened       boolean := false;
  v_author_role    text;
  v_participant    uuid;
  v_expected_event text;
BEGIN
  IF p_actor_kind NOT IN ('student', 'staff') THEN
    RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(btrim(coalesce(p_body, ''))) < 1 OR char_length(p_body) > 5000 THEN
    RAISE EXCEPTION 'body must be 1 to 5000 characters' USING ERRCODE = 'MS400';
  END IF;

  SELECT status INTO v_status FROM public.conversations WHERE id = p_conversation_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
  END IF;

  IF p_actor_kind = 'student' THEN
    -- Live active participant access (never conversation id alone).
    IF NOT public.message_recipient_has_active_access(p_conversation_id, p_actor_profile_id) THEN
      RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
    END IF;
    v_author_role    := 'student';
    v_expected_event := 'portal_reply';
  ELSE
    IF NOT public.message_profile_is_active_owner_or_admin(p_actor_profile_id) THEN
      RAISE EXCEPTION 'staff actor must be an active owner or admin' USING ERRCODE = 'MS403';
    END IF;
    -- Staff may not send into a thread whose participant lost portal access.
    SELECT cp.participant_profile_id INTO v_participant
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = p_conversation_id AND cp.removed_at IS NULL
    LIMIT 1;
    IF v_participant IS NULL
       OR NOT public.message_recipient_has_active_access(p_conversation_id, v_participant) THEN
      RAISE EXCEPTION 'participant portal access is not active' USING ERRCODE = 'MS409';
    END IF;
    v_author_role    := 'staff';
    v_expected_event := 'staff_reply';
  END IF;

  -- REQUIRED durable delivery payload, validated before any authoritative write.
  PERFORM public.message_assert_valid_delivery(p_delivery, v_expected_event, p_actor_profile_id);

  -- A staff reply must target the conversation's active portal participant.
  IF p_actor_kind = 'staff'
     AND NULLIF(p_delivery->>'recipient_profile_id', '')::uuid IS DISTINCT FROM v_participant THEN
    RAISE EXCEPTION 'staff reply must notify the active conversation participant'
      USING ERRCODE = 'MS400';
  END IF;

  -- Automatic reopen on reply to a resolved conversation.
  IF v_status = 'resolved' THEN
    UPDATE public.conversations
    SET status = 'open', resolved_at = NULL, updated_at = v_now
    WHERE id = p_conversation_id;
    INSERT INTO public.conversation_events (conversation_id, event_type, actor_profile_id, from_value, to_value, created_at)
    VALUES (p_conversation_id, 'reopened', p_actor_profile_id, 'resolved', 'open', v_now);
    v_reopened := true;
  END IF;

  INSERT INTO public.messages (conversation_id, author_profile_id, author_role, body, created_at)
  VALUES (p_conversation_id, p_actor_profile_id, v_author_role, p_body, v_now)
  RETURNING id INTO v_message_id;

  UPDATE public.conversations
  SET last_message_at = v_now, updated_at = v_now
  WHERE id = p_conversation_id;

  IF p_actor_kind = 'student' THEN
    INSERT INTO public.participant_conversation_reads (participant_profile_id, conversation_id, last_read_at)
    VALUES (p_actor_profile_id, p_conversation_id, v_now)
    ON CONFLICT (participant_profile_id, conversation_id) DO UPDATE SET last_read_at = v_now;
  ELSE
    INSERT INTO public.staff_conversation_reads (staff_profile_id, conversation_id, last_read_at)
    VALUES (p_actor_profile_id, p_conversation_id, v_now)
    ON CONFLICT (staff_profile_id, conversation_id) DO UPDATE SET last_read_at = v_now;
  END IF;

  -- Durable queued delivery row, same transaction, no silent conflict skip.
  BEGIN
    INSERT INTO public.message_notification_deliveries (
      conversation_id, message_id, triggered_by_profile_id, recipient_profile_id,
      recipient_email, recipient_kind, event_type, idempotency_key,
      queue_status, next_attempt_at,
      snapshot_sender_name, snapshot_subject, snapshot_category, cta_path
    ) VALUES (
      p_conversation_id, v_message_id, p_actor_profile_id,
      NULLIF(p_delivery->>'recipient_profile_id', '')::uuid,
      p_delivery->>'recipient_email', p_delivery->>'recipient_kind',
      p_delivery->>'event_type', p_delivery->>'idempotency_key',
      'queued', v_now,
      p_delivery->>'snapshot_sender_name', p_delivery->>'snapshot_subject',
      p_delivery->>'snapshot_category', p_delivery->>'cta_path'
    )
    RETURNING id INTO v_delivery_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate notification delivery for this message'
      USING ERRCODE = 'MS409';
  END;

  IF v_delivery_id IS NULL THEN
    RAISE EXCEPTION 'delivery row was not created' USING ERRCODE = 'MS409';
  END IF;

  RETURN jsonb_build_object(
    'message_id', v_message_id,
    'delivery_id', v_delivery_id,
    'created_at', v_now,
    'reopened', v_reopened
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.messages_start_conversation(
  p_actor_profile_id       uuid,
  p_actor_kind             text,
  p_participant_profile_id uuid,
  p_student_id             uuid,
  p_subject                text,
  p_category               text,
  p_body                   text,
  p_delivery               jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now             timestamptz := now();
  v_conversation_id uuid;
  v_message_id      uuid;
  v_delivery_id     uuid;
  v_subject         text := btrim(coalesce(p_subject, ''));
  v_author_role     text;
  v_expected_event  text;
BEGIN
  IF p_actor_kind NOT IN ('student', 'staff') THEN
    RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(v_subject) < 3 OR char_length(v_subject) > 120 THEN
    RAISE EXCEPTION 'subject must be 3 to 120 characters' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(btrim(coalesce(p_body, ''))) < 1 OR char_length(p_body) > 5000 THEN
    RAISE EXCEPTION 'body must be 1 to 5000 characters' USING ERRCODE = 'MS400';
  END IF;

  -- The participant must hold active student portal access in every case.
  IF NOT public.message_profile_has_active_student_link(p_participant_profile_id, p_student_id) THEN
    RAISE EXCEPTION 'participant portal access is not active' USING ERRCODE = 'MS409';
  END IF;

  IF p_actor_kind = 'student' THEN
    IF p_actor_profile_id IS DISTINCT FROM p_participant_profile_id THEN
      RAISE EXCEPTION 'student may only start their own conversation' USING ERRCODE = 'MS403';
    END IF;
    v_author_role    := 'student';
    v_expected_event := 'new_conversation';
  ELSE
    IF NOT public.message_profile_is_active_owner_or_admin(p_actor_profile_id) THEN
      RAISE EXCEPTION 'staff actor must be an active owner or admin' USING ERRCODE = 'MS403';
    END IF;
    v_author_role    := 'staff';
    v_expected_event := 'staff_reply';
  END IF;

  -- REQUIRED durable delivery payload. Validated before any authoritative write
  -- so an invalid payload fails fast and creates nothing.
  PERFORM public.message_assert_valid_delivery(p_delivery, v_expected_event, p_actor_profile_id);

  INSERT INTO public.conversations (
    subject, category, status, created_by_profile_id, created_by_role,
    related_student_id, last_message_at, created_at, updated_at
  ) VALUES (
    v_subject, p_category, 'open', p_actor_profile_id, v_author_role,
    p_student_id, v_now, v_now, v_now
  ) RETURNING id INTO v_conversation_id;

  INSERT INTO public.conversation_participants (
    conversation_id, participant_profile_id, participant_role, scope_kind,
    scope_student_id, added_at
  ) VALUES (
    v_conversation_id, p_participant_profile_id, 'student', 'student',
    p_student_id, v_now
  );

  INSERT INTO public.messages (conversation_id, author_profile_id, author_role, body, created_at)
  VALUES (v_conversation_id, p_actor_profile_id, v_author_role, p_body, v_now)
  RETURNING id INTO v_message_id;

  INSERT INTO public.conversation_events (conversation_id, event_type, actor_profile_id, to_value, created_at)
  VALUES (v_conversation_id, 'created', p_actor_profile_id, 'open', v_now);

  -- The SENDER's read pointer only. The recipient is never marked read.
  IF p_actor_kind = 'student' THEN
    INSERT INTO public.participant_conversation_reads (participant_profile_id, conversation_id, last_read_at)
    VALUES (p_actor_profile_id, v_conversation_id, v_now)
    ON CONFLICT (participant_profile_id, conversation_id) DO UPDATE SET last_read_at = v_now;
  ELSE
    INSERT INTO public.staff_conversation_reads (staff_profile_id, conversation_id, last_read_at)
    VALUES (p_actor_profile_id, v_conversation_id, v_now)
    ON CONFLICT (staff_profile_id, conversation_id) DO UPDATE SET last_read_at = v_now;
  END IF;

  -- Durable queued delivery row, in the SAME transaction as the authoritative
  -- write. NO ON CONFLICT DO NOTHING: the message is new inside this
  -- transaction, so an existing row for this key can never legitimately belong
  -- to it. A conflict aborts everything rather than committing a message with no
  -- delivery record. The unique idempotency guarantee is unchanged.
  BEGIN
    INSERT INTO public.message_notification_deliveries (
      conversation_id, message_id, triggered_by_profile_id, recipient_profile_id,
      recipient_email, recipient_kind, event_type, idempotency_key,
      queue_status, next_attempt_at,
      snapshot_sender_name, snapshot_subject, snapshot_category, cta_path
    ) VALUES (
      v_conversation_id, v_message_id, p_actor_profile_id,
      NULLIF(p_delivery->>'recipient_profile_id', '')::uuid,
      p_delivery->>'recipient_email', p_delivery->>'recipient_kind',
      p_delivery->>'event_type', p_delivery->>'idempotency_key',
      'queued', v_now,
      p_delivery->>'snapshot_sender_name', p_delivery->>'snapshot_subject',
      p_delivery->>'snapshot_category', p_delivery->>'cta_path'
    )
    RETURNING id INTO v_delivery_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate notification delivery for this message'
      USING ERRCODE = 'MS409';
  END;

  IF v_delivery_id IS NULL THEN
    RAISE EXCEPTION 'delivery row was not created' USING ERRCODE = 'MS409';
  END IF;

  RETURN jsonb_build_object(
    'conversation_id', v_conversation_id,
    'message_id', v_message_id,
    'delivery_id', v_delivery_id,
    'created_at', v_now,
    'status', 'open'
  );
END;
$$;

-- The read/send split helpers are removed. messages_start_conversation
-- regains its original 8-argument signature, so drop the 9-argument form.
DROP FUNCTION IF EXISTS public.messages_start_conversation(uuid, text, uuid, uuid, text, text, text, jsonb, text);
REVOKE ALL ON FUNCTION public.messages_start_conversation(uuid, text, uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.messages_start_conversation(uuid, text, uuid, uuid, text, text, text, jsonb) TO service_role;
DROP FUNCTION IF EXISTS public.message_participant_can_send(uuid, uuid);
DROP FUNCTION IF EXISTS public.message_participant_can_read(uuid, uuid);
DROP FUNCTION IF EXISTS public.message_profile_is_active(uuid);

CREATE OR REPLACE FUNCTION public.message_assert_valid_delivery(
  p_delivery         jsonb,
  p_expected_event   text,
  p_actor_profile_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_key   text;
  v_email text;
  v_kind  text;
  v_event text;
  v_rp    uuid;
  v_k     text;
BEGIN
  IF p_delivery IS NULL OR jsonb_typeof(p_delivery) <> 'object' THEN
    RAISE EXCEPTION 'delivery payload is required' USING ERRCODE = 'MS400';
  END IF;

  -- No message content may ever enter a delivery row.
  FOR v_k IN SELECT jsonb_object_keys(p_delivery) LOOP
    IF v_k ~* '(^|_)(body|preview|snippet|content|html|text|quote|quoted)(_|$)' THEN
      RAISE EXCEPTION 'delivery payload may not contain message content'
        USING ERRCODE = 'MS400';
    END IF;
  END LOOP;

  v_key   := btrim(coalesce(p_delivery->>'idempotency_key', ''));
  v_email := btrim(coalesce(p_delivery->>'recipient_email', ''));
  v_kind  := coalesce(p_delivery->>'recipient_kind', '');
  v_event := coalesce(p_delivery->>'event_type', '');
  v_rp    := NULLIF(p_delivery->>'recipient_profile_id', '')::uuid;

  IF v_key = '' THEN
    RAISE EXCEPTION 'delivery idempotency_key is required' USING ERRCODE = 'MS400';
  END IF;
  IF v_email = '' THEN
    RAISE EXCEPTION 'delivery recipient_email is required' USING ERRCODE = 'MS400';
  END IF;
  IF v_kind NOT IN ('shared_inbox', 'assigned_staff', 'portal_user') THEN
    RAISE EXCEPTION 'invalid delivery recipient_kind' USING ERRCODE = 'MS400';
  END IF;
  IF v_event NOT IN ('new_conversation', 'portal_reply', 'staff_reply') THEN
    RAISE EXCEPTION 'invalid delivery event_type' USING ERRCODE = 'MS400';
  END IF;
  IF v_event <> p_expected_event THEN
    RAISE EXCEPTION 'delivery event_type does not match the operation'
      USING ERRCODE = 'MS400';
  END IF;

  -- The recipient kind must match the approved Phase 2 routing shape.
  IF v_event = 'new_conversation' AND v_kind <> 'shared_inbox' THEN
    RAISE EXCEPTION 'new_conversation must route to the shared inbox' USING ERRCODE = 'MS400';
  END IF;
  IF v_event = 'portal_reply' AND v_kind NOT IN ('shared_inbox', 'assigned_staff') THEN
    RAISE EXCEPTION 'portal_reply must route to staff' USING ERRCODE = 'MS400';
  END IF;
  IF v_event = 'staff_reply' AND v_kind <> 'portal_user' THEN
    RAISE EXCEPTION 'staff_reply must route to the portal participant' USING ERRCODE = 'MS400';
  END IF;
  IF v_kind = 'portal_user' AND v_rp IS NULL THEN
    RAISE EXCEPTION 'portal_user delivery requires recipient_profile_id' USING ERRCODE = 'MS400';
  END IF;

  -- The sender is never the recipient.
  IF v_rp IS NOT NULL AND v_rp = p_actor_profile_id THEN
    RAISE EXCEPTION 'sender may not be the notification recipient' USING ERRCODE = 'MS400';
  END IF;

  -- Required safe snapshot and CTA fields.
  IF btrim(coalesce(p_delivery->>'snapshot_sender_name', '')) = '' THEN
    RAISE EXCEPTION 'delivery snapshot_sender_name is required' USING ERRCODE = 'MS400';
  END IF;
  IF btrim(coalesce(p_delivery->>'snapshot_subject', '')) = '' THEN
    RAISE EXCEPTION 'delivery snapshot_subject is required' USING ERRCODE = 'MS400';
  END IF;
  IF btrim(coalesce(p_delivery->>'cta_path', '')) = '' THEN
    RAISE EXCEPTION 'delivery cta_path is required' USING ERRCODE = 'MS400';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.messages_post_reply(
  p_actor_profile_id uuid,
  p_actor_kind       text,
  p_conversation_id  uuid,
  p_body             text,
  p_delivery         jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now            timestamptz := now();
  v_message_id     uuid;
  v_delivery_id    uuid;
  v_status         text;
  v_reopened       boolean := false;
  v_author_role    text;
  v_participant    uuid;
  v_expected_event text;
BEGIN
  IF p_actor_kind NOT IN ('student', 'staff') THEN
    RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(btrim(coalesce(p_body, ''))) < 1 OR char_length(p_body) > 5000 THEN
    RAISE EXCEPTION 'body must be 1 to 5000 characters' USING ERRCODE = 'MS400';
  END IF;

  SELECT status INTO v_status FROM public.conversations WHERE id = p_conversation_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
  END IF;

  IF p_actor_kind = 'student' THEN
    -- Live active participant access (never conversation id alone).
    IF NOT public.message_recipient_has_active_access(p_conversation_id, p_actor_profile_id) THEN
      RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
    END IF;
    v_author_role    := 'student';
    v_expected_event := 'portal_reply';
  ELSE
    IF NOT public.message_profile_is_active_owner_or_admin(p_actor_profile_id) THEN
      RAISE EXCEPTION 'staff actor must be an active owner or admin' USING ERRCODE = 'MS403';
    END IF;
    -- Staff may not send into a thread whose participant lost portal access.
    SELECT cp.participant_profile_id INTO v_participant
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = p_conversation_id AND cp.removed_at IS NULL
    LIMIT 1;
    IF v_participant IS NULL
       OR NOT public.message_recipient_has_active_access(p_conversation_id, v_participant) THEN
      RAISE EXCEPTION 'participant portal access is not active' USING ERRCODE = 'MS409';
    END IF;
    v_author_role    := 'staff';
    v_expected_event := 'staff_reply';
  END IF;

  -- REQUIRED durable delivery payload, validated before any authoritative write.
  PERFORM public.message_assert_valid_delivery(p_delivery, v_expected_event, p_actor_profile_id);

  -- A staff reply must target the conversation's active portal participant.
  IF p_actor_kind = 'staff'
     AND NULLIF(p_delivery->>'recipient_profile_id', '')::uuid IS DISTINCT FROM v_participant THEN
    RAISE EXCEPTION 'staff reply must notify the active conversation participant'
      USING ERRCODE = 'MS400';
  END IF;

  -- Automatic reopen on reply to a resolved conversation.
  IF v_status = 'resolved' THEN
    UPDATE public.conversations
    SET status = 'open', resolved_at = NULL, updated_at = v_now
    WHERE id = p_conversation_id;
    INSERT INTO public.conversation_events (conversation_id, event_type, actor_profile_id, from_value, to_value, created_at)
    VALUES (p_conversation_id, 'reopened', p_actor_profile_id, 'resolved', 'open', v_now);
    v_reopened := true;
  END IF;

  INSERT INTO public.messages (conversation_id, author_profile_id, author_role, body, created_at)
  VALUES (p_conversation_id, p_actor_profile_id, v_author_role, p_body, v_now)
  RETURNING id INTO v_message_id;

  UPDATE public.conversations
  SET last_message_at = v_now, updated_at = v_now
  WHERE id = p_conversation_id;

  IF p_actor_kind = 'student' THEN
    INSERT INTO public.participant_conversation_reads (participant_profile_id, conversation_id, last_read_at)
    VALUES (p_actor_profile_id, p_conversation_id, v_now)
    ON CONFLICT (participant_profile_id, conversation_id) DO UPDATE SET last_read_at = v_now;
  ELSE
    INSERT INTO public.staff_conversation_reads (staff_profile_id, conversation_id, last_read_at)
    VALUES (p_actor_profile_id, p_conversation_id, v_now)
    ON CONFLICT (staff_profile_id, conversation_id) DO UPDATE SET last_read_at = v_now;
  END IF;

  -- Durable queued delivery row, same transaction, no silent conflict skip.
  BEGIN
    INSERT INTO public.message_notification_deliveries (
      conversation_id, message_id, triggered_by_profile_id, recipient_profile_id,
      recipient_email, recipient_kind, event_type, idempotency_key,
      queue_status, next_attempt_at,
      snapshot_sender_name, snapshot_subject, snapshot_category, cta_path
    ) VALUES (
      p_conversation_id, v_message_id, p_actor_profile_id,
      NULLIF(p_delivery->>'recipient_profile_id', '')::uuid,
      p_delivery->>'recipient_email', p_delivery->>'recipient_kind',
      p_delivery->>'event_type', p_delivery->>'idempotency_key',
      'queued', v_now,
      p_delivery->>'snapshot_sender_name', p_delivery->>'snapshot_subject',
      p_delivery->>'snapshot_category', p_delivery->>'cta_path'
    )
    RETURNING id INTO v_delivery_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate notification delivery for this message'
      USING ERRCODE = 'MS409';
  END;

  IF v_delivery_id IS NULL THEN
    RAISE EXCEPTION 'delivery row was not created' USING ERRCODE = 'MS409';
  END IF;

  RETURN jsonb_build_object(
    'message_id', v_message_id,
    'delivery_id', v_delivery_id,
    'created_at', v_now,
    'reopened', v_reopened
  );
END;
$$;

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
