-- ============================================================================
-- ASPIRE MESSAGES, PHASE 1: schema and authorization foundation (ADDITIVE ONLY)
-- ============================================================================
-- Owner instructions: run this ENTIRE file as one block in the Supabase SQL
-- editor. It is additive only: two functions, six tables, their indexes, RLS,
-- least-privilege grants, and staff read policies. It creates no data and
-- modifies no existing table, policy, function, or grant. Nothing in the
-- application reads or writes these objects yet (there is no Messages UI, API,
-- notification, worker, rate limiter, or portal navigation in this phase), so
-- it is safe to apply at any time.
--
-- Prerequisites (already applied and verified in production): the Phase 2
-- portal authorization foundation. This file builds on, and does not recreate,
-- the existing objects:
--   user_role_grants, user_student_links, user_unit_scopes, user_school_scopes,
--   portal_profile_id(), has_active_role_grant(), my_linked_student_ids(),
--   is_owner_or_admin(), provision_portal_access(), revoke_portal_access().
--
-- Identity model (preserved exactly): auth.users.id, user_profiles.auth_user_id,
-- and user_profiles.id are three distinct values and are NOT required to be
-- equal. Every Messages actor, participant, assignee, reader, and event
-- reference uses user_profiles.id. The current profile is resolved from
-- auth.uid() through portal_profile_id() or the established
-- (SELECT id FROM public.user_profiles WHERE auth_user_id = auth.uid())
-- subquery. No policy compares a profile id column directly against auth.uid().
--
-- Version-one boundary: the schema reserves a shared shape for student,
-- unit_leader, academic_partner, preceptor, and staff authors. Phase 1
-- AUTHORIZES portal access for the student role and an active student link
-- ONLY. Unit Leader, Academic Partner, and Preceptor participant roles and
-- scope columns are schema reservations; their authorization branches arrive in
-- later portal-specific migrations after those experiences are ready.
--
-- Staff authorization: Messages staff access is limited to an active Owner or
-- active Admin, gated by the new public.is_active_owner_or_admin() helper.
-- is_staff() is intentionally NOT used anywhere in Messages SQL because it also
-- returns true for interviewer and viewer. The existing is_owner_or_admin()
-- helper is left unmodified.
--
-- Record integrity: messages and conversation_events are append-only. No
-- application role may UPDATE, DELETE, or TRUNCATE them. Conversations and
-- participants may not be deleted or truncated by any application role. There
-- is no user-facing delete path. Related student, unit, school, and cohort
-- values on a conversation are staff context metadata only and never grant
-- access.
--
-- This file is designed to run once. It is atomic (BEGIN/COMMIT), so a failed
-- run rolls back completely and can be corrected and re-run from a clean state.
-- Read-only verification lives in db/audit/messages_phase1_verification.sql and
-- is run AFTER this migration is applied.
-- ============================================================================

BEGIN;

-- ── 1. Staff authorization helper (active Owner or active Admin) ─────────────
-- Directly verifies that the current auth.uid() maps to an active owner/admin
-- user_profiles row. Mirrors the hardened helper conventions (SECURITY DEFINER,
-- STABLE, fixed search_path, REVOKE from PUBLIC/anon, EXECUTE to authenticated
-- and service_role). Unlike is_owner_or_admin(), this helper also requires the
-- profile to be active. It never calls is_staff().
CREATE OR REPLACE FUNCTION public.is_active_owner_or_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE auth_user_id = auth.uid()
      AND role IN ('owner', 'admin')
      AND COALESCE(is_active, true) = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_owner_or_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_owner_or_admin() TO authenticated, service_role;

-- ── 2. conversations ────────────────────────────────────────────────────────
-- One row per one-to-one conversation between a portal participant and the
-- ASPIRE Team. related_* columns are staff context metadata only.
CREATE TABLE IF NOT EXISTS public.conversations (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject                   text        NOT NULL,
  category                  text,
  status                    text        NOT NULL DEFAULT 'open',
  assigned_staff_profile_id uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  follow_up_flagged         boolean     NOT NULL DEFAULT false,
  follow_up_flagged_by      uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  follow_up_flagged_at      timestamptz,
  created_by_profile_id     uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_by_role           text        NOT NULL,
  related_student_id        uuid        REFERENCES public.students(id) ON DELETE SET NULL,
  related_unit_key          text,
  related_school_key        text,
  related_cohort_id         uuid        REFERENCES public.cohorts(id) ON DELETE SET NULL,
  last_message_at           timestamptz NOT NULL DEFAULT now(),
  resolved_at               timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  -- Subject is stored trimmed, 3 to 120 characters.
  CONSTRAINT chk_conversations_subject_trimmed
    CHECK (subject = btrim(subject)),
  CONSTRAINT chk_conversations_subject_length
    CHECK (char_length(btrim(subject)) BETWEEN 3 AND 120),

  -- Category is null or exactly one of the approved values.
  CONSTRAINT chk_conversations_category
    CHECK (category IS NULL OR category IN (
      'Placement and matching',
      'Scheduling',
      'Onboarding requirements',
      'Clinical rotation support',
      'Preceptor support',
      'Portal or account help',
      'General question'
    )),

  -- Status is one of the three version-one states.
  CONSTRAINT chk_conversations_status
    CHECK (status IN ('open', 'waiting', 'resolved')),

  -- Creator role reserves the shared shape (staff plus the four portal roles).
  CONSTRAINT chk_conversations_created_by_role
    CHECK (created_by_role IN ('student', 'unit_leader', 'academic_partner', 'preceptor', 'staff')),

  -- Follow-up fields are internally consistent: all set together or all clear.
  CONSTRAINT chk_conversations_follow_up_consistent
    CHECK (
      (follow_up_flagged = false AND follow_up_flagged_by IS NULL AND follow_up_flagged_at IS NULL)
      OR
      (follow_up_flagged = true  AND follow_up_flagged_by IS NOT NULL AND follow_up_flagged_at IS NOT NULL)
    ),

  -- resolved_at is present exactly when the conversation is resolved. A reopen
  -- clears resolved_at as it moves status away from 'resolved'.
  CONSTRAINT chk_conversations_resolved_consistent
    CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);

-- ── 3. conversation_participants ────────────────────────────────────────────
-- Explicit typed scope columns (no polymorphic scope_ref_id). The participant
-- row is HISTORICAL: it is not removed when a grant expires or is revoked.
-- Current access is derived live from the active grant, never from this row.
CREATE TABLE IF NOT EXISTS public.conversation_participants (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id        uuid        NOT NULL REFERENCES public.conversations(id) ON DELETE RESTRICT,
  participant_profile_id uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  participant_role       text        NOT NULL,
  scope_kind             text        NOT NULL,
  scope_student_id       uuid        REFERENCES public.students(id) ON DELETE SET NULL,
  scope_unit_key         text,
  scope_school_key       text,
  scope_cohort_id        uuid        REFERENCES public.cohorts(id) ON DELETE SET NULL,
  added_at               timestamptz NOT NULL DEFAULT now(),
  removed_at             timestamptz,

  CONSTRAINT chk_participant_role
    CHECK (participant_role IN ('student', 'unit_leader', 'academic_partner', 'preceptor')),
  CONSTRAINT chk_participant_scope_kind
    CHECK (scope_kind IN ('student', 'unit', 'school')),

  -- Role-to-scope shape. Student is the only Phase 1 authorized role; the other
  -- three shapes are reserved for later portal-specific phases.
  CONSTRAINT chk_participant_role_scope
    CHECK (
      (participant_role = 'student'
        AND scope_kind = 'student'
        AND scope_student_id IS NOT NULL
        AND scope_unit_key IS NULL
        AND scope_school_key IS NULL
        AND scope_cohort_id IS NULL)
      OR
      (participant_role = 'preceptor'
        AND scope_kind = 'student'
        AND scope_student_id IS NOT NULL
        AND scope_unit_key IS NULL
        AND scope_school_key IS NULL)
      OR
      (participant_role = 'unit_leader'
        AND scope_kind = 'unit'
        AND scope_unit_key IS NOT NULL
        AND scope_student_id IS NULL
        AND scope_school_key IS NULL)
      OR
      (participant_role = 'academic_partner'
        AND scope_kind = 'school'
        AND scope_school_key IS NOT NULL
        AND scope_student_id IS NULL
        AND scope_unit_key IS NULL)
    )
);

-- At most one active (removed_at IS NULL) participant per conversation. Version
-- one conversations are one-to-one between one portal participant and the team.
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_participants_active
  ON public.conversation_participants (conversation_id)
  WHERE removed_at IS NULL;

-- ── 4. messages (append-only, immutable) ────────────────────────────────────
-- No edit timestamp, no delete timestamp, no soft-delete, and no system-author
-- flag. Lifecycle and system history is recorded in conversation_events, not in
-- a synthetic system-author row.
CREATE TABLE IF NOT EXISTS public.messages (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid        NOT NULL REFERENCES public.conversations(id) ON DELETE RESTRICT,
  author_profile_id uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  author_role       text        NOT NULL,
  body              text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_messages_author_role
    CHECK (author_role IN ('student', 'unit_leader', 'academic_partner', 'preceptor', 'staff')),
  -- Body is non-blank and at most 5000 characters.
  CONSTRAINT chk_messages_body_nonblank
    CHECK (char_length(btrim(body)) >= 1),
  CONSTRAINT chk_messages_body_maxlen
    CHECK (char_length(body) <= 5000)
);

-- ── 5. staff_conversation_reads (per-staff last-read pointer) ────────────────
-- One row per (staff profile, conversation). One staff member advancing their
-- pointer never affects another staff member's pointer.
CREATE TABLE IF NOT EXISTS public.staff_conversation_reads (
  staff_profile_id uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  conversation_id  uuid        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  last_read_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_profile_id, conversation_id)
);

-- ── 6. participant_conversation_reads (per-participant last-read pointer) ────
CREATE TABLE IF NOT EXISTS public.participant_conversation_reads (
  participant_profile_id uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  conversation_id        uuid        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  last_read_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (participant_profile_id, conversation_id)
);

-- ── 7. conversation_events (append-only lifecycle log) ──────────────────────
CREATE TABLE IF NOT EXISTS public.conversation_events (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid        NOT NULL REFERENCES public.conversations(id) ON DELETE RESTRICT,
  event_type       text        NOT NULL,
  actor_profile_id uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  from_value       text,
  to_value         text,
  metadata         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_conversation_events_type
    CHECK (event_type IN (
      'created',
      'status_change',
      'assignment_change',
      'resolved',
      'reopened',
      'flagged',
      'participant_access_changed'
    ))
);

-- ── 8. Participant authorization helper (student scope only, Phase 1) ───────
-- Returns the conversation ids the current caller may access AS A STUDENT
-- PARTICIPANT. It authorizes on participant membership plus a live active
-- student role grant plus an active student link matching the participant's
-- scope_student_id. It returns nothing for unit_leader, academic_partner, or
-- preceptor participants (those branches are added in later phases). It never
-- authorizes using conversation id alone, assigned staff, or a conversation's
-- related_student_id / related_unit_key / related_school_key / related_cohort_id
-- context metadata. This helper is the authorization foundation; it does not
-- itself expose any base table in Phase 1.
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
    AND p.participant_role = 'student'
    AND p.scope_kind = 'student'
    -- Live active student role grant (canonical active predicate).
    AND EXISTS (
      SELECT 1 FROM public.user_role_grants g
      WHERE g.user_profile_id = public.portal_profile_id()
        AND g.role = 'student'
        AND g.revoked_at IS NULL
        AND g.starts_at <= now()
        AND (g.expires_at IS NULL OR g.expires_at > now())
    )
    -- Active student link matching the participant scope.
    AND EXISTS (
      SELECT 1 FROM public.user_student_links l
      WHERE l.user_profile_id = public.portal_profile_id()
        AND l.student_id = p.scope_student_id
        AND l.revoked_at IS NULL
    );
$$;

REVOKE ALL ON FUNCTION public.my_message_conversation_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_message_conversation_ids() TO authenticated, service_role;

-- ── 9. Indexes for the approved version-one access patterns ─────────────────
CREATE INDEX IF NOT EXISTS idx_conversations_status_last_message
  ON public.conversations (status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_assigned_staff
  ON public.conversations (assigned_staff_profile_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_profile
  ON public.conversation_participants (participant_profile_id);
CREATE INDEX IF NOT EXISTS idx_conversation_events_conversation_created
  ON public.conversation_events (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_staff_conversation_reads_conversation
  ON public.staff_conversation_reads (conversation_id);
CREATE INDEX IF NOT EXISTS idx_participant_conversation_reads_conversation
  ON public.participant_conversation_reads (conversation_id);

-- ── 10. Row Level Security ──────────────────────────────────────────────────
ALTER TABLE public.conversations                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_conversation_reads      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participant_conversation_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_events           ENABLE ROW LEVEL SECURITY;

-- ── 11. Table privileges (deny by default, then least privilege) ────────────
-- Do not rely on RLS alone: explicitly strip default grants, then grant the
-- minimum. authenticated receives SELECT only (rows restricted by policy) and
-- NO INSERT/UPDATE/DELETE/TRUNCATE on any Messages table. service_role receives
-- only the privileges future server code needs, and never DELETE or TRUNCATE.
-- postgres (owner) retains full administrative privileges implicitly.
REVOKE ALL ON public.conversations,
              public.conversation_participants,
              public.messages,
              public.staff_conversation_reads,
              public.participant_conversation_reads,
              public.conversation_events
  FROM PUBLIC, anon, authenticated, service_role;

-- authenticated: SELECT only, on the staff-readable surfaces and the staff's own
-- read pointers. participant_conversation_reads gets NO authenticated grant in
-- Phase 1 (no portal base-table read path yet).
GRANT SELECT ON public.conversations             TO authenticated;
GRANT SELECT ON public.conversation_participants TO authenticated;
GRANT SELECT ON public.messages                  TO authenticated;
GRANT SELECT ON public.conversation_events       TO authenticated;
GRANT SELECT ON public.staff_conversation_reads  TO authenticated;

-- service_role: least privilege per table. messages and conversation_events are
-- append-only (SELECT and INSERT only). conversations, participants, and the
-- read pointers allow UPDATE for future lifecycle and pointer advancement. None
-- receive DELETE or TRUNCATE.
GRANT SELECT, INSERT, UPDATE ON public.conversations                  TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.conversation_participants      TO service_role;
GRANT SELECT, INSERT         ON public.messages                       TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.staff_conversation_reads       TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.participant_conversation_reads TO service_role;
GRANT SELECT, INSERT         ON public.conversation_events            TO service_role;

-- ── 12. Policies: active Owner/Admin SELECT only (Phase 1) ──────────────────
-- No portal base-table SELECT policy exists in Phase 1. No INSERT/UPDATE/DELETE
-- policy exists for any role, so authenticated cannot mutate anything and
-- messages/events stay append-only at the policy layer as well. Related student,
-- unit, school, and cohort context is never referenced in any USING clause.
CREATE POLICY "messages_conversations_staff_select" ON public.conversations
  FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin());

CREATE POLICY "messages_participants_staff_select" ON public.conversation_participants
  FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin());

CREATE POLICY "messages_messages_staff_select" ON public.messages
  FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin());

CREATE POLICY "messages_events_staff_select" ON public.conversation_events
  FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin());

-- Staff read pointers: an active Owner/Admin sees only their own row. The
-- profile id is resolved with the auth_user_id subquery convention rather than a
-- direct auth.uid() comparison, correct whether or not id equals auth_user_id.
CREATE POLICY "messages_staff_reads_self_select" ON public.staff_conversation_reads
  FOR SELECT TO authenticated
  USING (
    public.is_active_owner_or_admin()
    AND staff_profile_id = (SELECT id FROM public.user_profiles WHERE auth_user_id = auth.uid())
  );

-- participant_conversation_reads has NO policy in Phase 1: RLS is enabled with
-- no policy, so authenticated reads are denied by default and other
-- participants' read state is not exposed. service_role writes bypass RLS.

COMMIT;

-- Read-only verification is intentionally NOT included here. After applying this
-- migration, run db/audit/messages_phase1_verification.sql (system-catalog
-- SELECTs only) to confirm tables, RLS, constraints, helper security, grants,
-- and the append-only posture.
