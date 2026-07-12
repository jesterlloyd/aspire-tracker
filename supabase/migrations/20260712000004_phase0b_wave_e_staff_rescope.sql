-- ============================================================================
-- PHASE 0B, WAVE E: re-scope authenticated policies from "any authenticated
-- user" to staff, and give user_profiles and activity_logs least-privilege
-- shapes
-- ============================================================================
-- *** PREREQUISITE: Wave A (is_staff() must exist). Waves B, C, D may be     ***
-- *** applied before or after this wave, but A must come first.             ***
--
-- Owner instructions: run this ENTIRE file as one block in the Supabase SQL
-- editor. For every CURRENT user this is behavior-identical: all existing
-- accounts hold staff roles, and is_staff() returns true for them. The change
-- converts "authenticated" from a soon-to-break security boundary into a real
-- one before Phase 2 introduces portal accounts (students, unit leaders,
-- academic partners), which must see none of these tables by default.
--
-- Findings: F2, F5, F6 in docs/security/PHASE_0A_ACCESS_AUDIT.md.
-- Revert: db/audit/phase0b_reverts.sql, section Wave E.
-- ============================================================================

-- ── 1. Simple FOR ALL re-scopes ─────────────────────────────────────────────

DROP POLICY IF EXISTS "authenticated_all_students" ON public.students;
CREATE POLICY "staff_all_students" ON public.students
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "authenticated_all_cohorts" ON public.cohorts;
CREATE POLICY "staff_all_cohorts" ON public.cohorts
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "authenticated_all_communications" ON public.communications;
CREATE POLICY "staff_all_communications" ON public.communications
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "authenticated_all_units" ON public.units;
CREATE POLICY "staff_all_units" ON public.units
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "authenticated_all_matches" ON public.matches;
CREATE POLICY "staff_all_matches" ON public.matches
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "authenticated_all_interview_sessions" ON public.interview_sessions;
CREATE POLICY "staff_all_interview_sessions" ON public.interview_sessions
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "authenticated_all_interviewers" ON public.interviewers;
CREATE POLICY "staff_all_interviewers" ON public.interviewers
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "authenticated_all_interviews" ON public.interviews;
CREATE POLICY "staff_all_interviews" ON public.interviews
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "authenticated_all_program_events" ON public.program_events;
CREATE POLICY "staff_all_program_events" ON public.program_events
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "authenticated_all_availability_blocks" ON public.interview_availability_blocks;
CREATE POLICY "staff_all_availability_blocks" ON public.interview_availability_blocks
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "authenticated_all_interview_slots" ON public.interview_slots;
CREATE POLICY "staff_all_interview_slots" ON public.interview_slots
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "authenticated_all_student_shift_logs" ON public.student_shift_logs;
CREATE POLICY "staff_all_student_shift_logs" ON public.student_shift_logs
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "authenticated_all_ngrp_outcomes" ON public.ngrp_outcomes;
CREATE POLICY "staff_all_ngrp_outcomes" ON public.ngrp_outcomes
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "authenticated_all_cohort_snapshots" ON public.cohort_snapshots;
CREATE POLICY "staff_all_cohort_snapshots" ON public.cohort_snapshots
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "authenticated_all_rubrics" ON public.interview_rubrics;
CREATE POLICY "staff_all_rubrics" ON public.interview_rubrics
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

-- ── 2. contacts: four command policies, same re-scope ───────────────────────

DROP POLICY IF EXISTS "contacts_authenticated_select" ON public.contacts;
CREATE POLICY "contacts_staff_select" ON public.contacts
  FOR SELECT TO authenticated USING (public.is_staff());
DROP POLICY IF EXISTS "contacts_authenticated_insert" ON public.contacts;
CREATE POLICY "contacts_staff_insert" ON public.contacts
  FOR INSERT TO authenticated WITH CHECK (public.is_staff());
DROP POLICY IF EXISTS "contacts_authenticated_update" ON public.contacts;
CREATE POLICY "contacts_staff_update" ON public.contacts
  FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
DROP POLICY IF EXISTS "contacts_authenticated_delete" ON public.contacts;
CREATE POLICY "contacts_staff_delete" ON public.contacts
  FOR DELETE TO authenticated USING (public.is_staff());

-- ── 3. Read-policy re-scopes (writes already owner-gated or service-role) ───

DROP POLICY IF EXISTS "authenticated_read_preceptors" ON public.preceptors;
CREATE POLICY "staff_read_preceptors" ON public.preceptors
  FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "authenticated_read_pcp" ON public.preceptor_cohort_participation;
CREATE POLICY "staff_read_pcp" ON public.preceptor_cohort_participation
  FOR SELECT TO authenticated USING (public.is_staff());

-- unit_leaders: remove the v2 audit's blanket FOR ALL (any staff account could
-- rewrite the roster); reads become staff-scoped; anon_read stays for the
-- public unit form; writes remain service-role only.
DROP POLICY IF EXISTS "authenticated_all_unit_leaders" ON public.unit_leaders;
DROP POLICY IF EXISTS "authenticated_read_unit_leaders" ON public.unit_leaders;
CREATE POLICY "staff_read_unit_leaders" ON public.unit_leaders
  FOR SELECT TO authenticated USING (public.is_staff());

-- unit_cohort_responses: remove the blanket FOR ALL (any staff account could
-- delete submissions); reads staff-scoped; all writes now flow through
-- api/unit-form-submit.js (service role).
DROP POLICY IF EXISTS "authenticated_all_unit_cohort_responses" ON public.unit_cohort_responses;
DROP POLICY IF EXISTS "authenticated_read_unit_responses" ON public.unit_cohort_responses;
CREATE POLICY "staff_read_unit_responses" ON public.unit_cohort_responses
  FOR SELECT TO authenticated USING (public.is_staff());

-- ── 4. student_dispositions: align with the RPC posture ─────────────────────
-- Writes happen ONLY via the SECURITY DEFINER RPCs (record / clear /
-- supersede), which enforce owner or admin internally and bypass RLS. Client
-- reads use the student_active_disposition view and this SELECT policy.
DROP POLICY IF EXISTS "authenticated_all_student_dispositions" ON public.student_dispositions;
CREATE POLICY "owner_admin_select_student_dispositions" ON public.student_dispositions
  FOR SELECT TO authenticated USING (public.is_owner_or_admin());

-- ── 5. user_profiles: least-privilege shape (finding F2) ────────────────────
-- Closes the privilege-escalation path: no client role can change role,
-- is_owner, is_active, or can_conduct_interviews anymore. Role and account
-- management stays on the service-role endpoints (api/invite-user.js,
-- api/admin-users.js, api/manage-interviewers.js). The ONLY client-writable
-- columns are the cosmetic self-service ones the app actually writes
-- (avatar upload in UserMenu, onboarding tour state), enforced by BOTH a
-- column-level grant and a self-row policy.
DROP POLICY IF EXISTS "authenticated_all_user_profiles" ON public.user_profiles;

CREATE POLICY "user_profiles_select_self" ON public.user_profiles
  FOR SELECT TO authenticated USING (auth_user_id = auth.uid());
CREATE POLICY "user_profiles_select_staff" ON public.user_profiles
  FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "user_profiles_update_self" ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.user_profiles FROM authenticated;
-- last_login_at is included defensively: get_my_profile (dashboard-created,
-- definition untracked) stamps it on login. If that RPC is SECURITY DEFINER
-- the grant is unnecessary; if it is SECURITY INVOKER, omitting the column
-- would break login profile loading. A user can only touch their own row
-- (self policy), so the worst case is falsifying their own login timestamp.
GRANT UPDATE (
  avatar_url,
  onboarding_tour_completed,
  onboarding_tour_completed_at,
  onboarding_tour_version,
  onboarding_tour_dismissed,
  last_login_at
) ON public.user_profiles TO authenticated;
REVOKE ALL ON public.user_profiles FROM anon;

-- ── 6. activity_logs: append-only for staff, owner or admin read (F5) ───────
DROP POLICY IF EXISTS "authenticated_all_activity_logs" ON public.activity_logs;
CREATE POLICY "activity_logs_staff_insert" ON public.activity_logs
  FOR INSERT TO authenticated WITH CHECK (public.is_staff());
CREATE POLICY "activity_logs_owner_admin_select" ON public.activity_logs
  FOR SELECT TO authenticated USING (public.is_owner_or_admin());
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.activity_logs FROM authenticated;
REVOKE ALL ON public.activity_logs FROM anon;

-- ── 7. Residual anon grant cleanup on tables touched in this wave ───────────
REVOKE ALL ON public.contacts                     FROM anon;
REVOKE ALL ON public.student_dispositions         FROM anon;
REVOKE ALL ON public.preceptors                   FROM anon;
REVOKE ALL ON public.preceptor_cohort_participation FROM anon;

-- Intentionally NOT changed in this wave (documented in the audit):
--   - cohort_school_rotations (anon SELECT kept pending Phase 3 review)
--   - student_reads, session_reads, support_request_reads (already own-row)
--   - notification_log, evaluation_*, certificates, catalog_*, knowledge and
--     template governance tables (already least-privilege)

-- Verification (expected: zero rows; no permissive true/true authenticated
-- policy remains on these tables):
--   SELECT tablename, policyname FROM pg_policies
--   WHERE schemaname = 'public'
--     AND 'authenticated' = ANY(roles)
--     AND qual = 'true'
--     AND tablename NOT IN ('cohort_school_rotations');
--
-- Post-wave smoke test (as EACH staff role, especially viewer and
-- interviewer): log in, open /aggregate, /students, /interviews,
-- /rotation/matrix, /evaluation, /connect, /settings; complete the onboarding
-- tour dismiss action; upload an avatar; confirm an interviewer can open and
-- score a rubric session.
