-- ============================================================================
-- PHASE 0B REVERT SCRIPTS (one section per wave, run only the needed section)
-- ============================================================================
-- Each section restores the pre-wave policy state EXACTLY as documented in
-- docs/security/PHASE_0A_ACCESS_AUDIT.md. Reverting reintroduces the audited
-- exposure; use only to unblock a broken production workflow, then re-plan.
-- Sections are independent and idempotent.
-- ============================================================================

-- ── REVERT WAVE A (is_staff helper) ─────────────────────────────────────────
-- Only safe if Wave E has been reverted first (its policies call is_staff()).
-- DROP FUNCTION IF EXISTS public.is_staff();

-- ── REVERT WAVE B (orphan anon policies) ────────────────────────────────────
/*
GRANT ALL ON public.interview_rubrics             TO anon;
GRANT ALL ON public.interview_sessions            TO anon;
GRANT ALL ON public.interviews                    TO anon;
GRANT ALL ON public.interviewers                  TO anon;
GRANT ALL ON public.interview_availability_blocks TO anon;
GRANT ALL ON public.interview_slots               TO anon;
GRANT ALL ON public.student_shift_logs            TO anon;
GRANT ALL ON public.matches                       TO anon;
GRANT ALL ON public.ngrp_outcomes                 TO anon;
GRANT ALL ON public.cohort_snapshots              TO anon;
GRANT ALL ON public.program_events                TO anon;

CREATE POLICY "anon_insert_students" ON public.students
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_all_rubrics" ON public.interview_rubrics
  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_sessions" ON public.interview_sessions
  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon select on interviews" ON public.interviews
  FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon insert on interviews" ON public.interviews
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon update on interviews" ON public.interviews
  FOR UPDATE TO anon USING (true);
CREATE POLICY "Allow anon select on interviewers" ON public.interviewers
  FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon insert on interviewers" ON public.interviewers
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon update on interviewers" ON public.interviewers
  FOR UPDATE TO anon USING (true);
CREATE POLICY "anon_all_blocks" ON public.interview_availability_blocks
  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_slots" ON public.interview_slots
  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_shift_logs" ON public.student_shift_logs
  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON public.matches
  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon full access on ngrp_outcomes" ON public.ngrp_outcomes
  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon full access on cohort_snapshots" ON public.cohort_snapshots
  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon read access on program_events" ON public.program_events
  FOR SELECT TO anon USING (true);
CREATE POLICY "Anon insert access on program_events" ON public.program_events
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon update access on program_events" ON public.program_events
  FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon delete access on program_events" ON public.program_events
  FOR DELETE TO anon USING (true);
*/

-- ── REVERT WAVE C (cohorts anon narrowing) ──────────────────────────────────
/*
GRANT ALL ON public.cohorts TO anon;
DROP POLICY IF EXISTS "anon_select_cohorts" ON public.cohorts;
CREATE POLICY "anon_all" ON public.cohorts
  FOR ALL TO anon USING (true) WITH CHECK (true);
*/

-- ── REVERT WAVE D (students, units, unit_cohort_responses) ──────────────────
-- Only meaningful together with rolling the application back to the pre-Wave-D
-- release; the current bundle no longer uses these anon paths.
/*
GRANT ALL ON public.students TO anon;
CREATE POLICY "anon_all" ON public.students
  FOR ALL TO anon USING (true) WITH CHECK (true);

GRANT ALL ON public.units TO anon;
DROP POLICY IF EXISTS "anon_select_units" ON public.units;
CREATE POLICY "anon_all" ON public.units
  FOR ALL TO anon USING (true) WITH CHECK (true);

GRANT ALL ON public.unit_cohort_responses TO anon;
CREATE POLICY "anon_insert_unit_responses" ON public.unit_cohort_responses
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_unit_responses" ON public.unit_cohort_responses
  FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_select_unit_responses" ON public.unit_cohort_responses
  FOR SELECT TO anon USING (true);
*/

-- ── REVERT WAVE E (staff re-scope) ──────────────────────────────────────────
/*
DROP POLICY IF EXISTS "staff_all_students" ON public.students;
CREATE POLICY "authenticated_all_students" ON public.students
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_all_cohorts" ON public.cohorts;
CREATE POLICY "authenticated_all_cohorts" ON public.cohorts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_all_communications" ON public.communications;
CREATE POLICY "authenticated_all_communications" ON public.communications
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_all_units" ON public.units;
CREATE POLICY "authenticated_all_units" ON public.units
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_all_matches" ON public.matches;
CREATE POLICY "authenticated_all_matches" ON public.matches
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_all_interview_sessions" ON public.interview_sessions;
CREATE POLICY "authenticated_all_interview_sessions" ON public.interview_sessions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_all_interviewers" ON public.interviewers;
CREATE POLICY "authenticated_all_interviewers" ON public.interviewers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_all_interviews" ON public.interviews;
CREATE POLICY "authenticated_all_interviews" ON public.interviews
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_all_program_events" ON public.program_events;
CREATE POLICY "authenticated_all_program_events" ON public.program_events
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_all_availability_blocks" ON public.interview_availability_blocks;
CREATE POLICY "authenticated_all_availability_blocks" ON public.interview_availability_blocks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_all_interview_slots" ON public.interview_slots;
CREATE POLICY "authenticated_all_interview_slots" ON public.interview_slots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_all_student_shift_logs" ON public.student_shift_logs;
CREATE POLICY "authenticated_all_student_shift_logs" ON public.student_shift_logs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_all_ngrp_outcomes" ON public.ngrp_outcomes;
CREATE POLICY "authenticated_all_ngrp_outcomes" ON public.ngrp_outcomes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_all_cohort_snapshots" ON public.cohort_snapshots;
CREATE POLICY "authenticated_all_cohort_snapshots" ON public.cohort_snapshots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_all_rubrics" ON public.interview_rubrics;
CREATE POLICY "authenticated_all_rubrics" ON public.interview_rubrics
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "contacts_staff_select" ON public.contacts;
CREATE POLICY "contacts_authenticated_select" ON public.contacts
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "contacts_staff_insert" ON public.contacts;
CREATE POLICY "contacts_authenticated_insert" ON public.contacts
  FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "contacts_staff_update" ON public.contacts;
CREATE POLICY "contacts_authenticated_update" ON public.contacts
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "contacts_staff_delete" ON public.contacts;
CREATE POLICY "contacts_authenticated_delete" ON public.contacts
  FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "staff_read_preceptors" ON public.preceptors;
CREATE POLICY "authenticated_read_preceptors" ON public.preceptors
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "staff_read_pcp" ON public.preceptor_cohort_participation;
CREATE POLICY "authenticated_read_pcp" ON public.preceptor_cohort_participation
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "staff_read_unit_leaders" ON public.unit_leaders;
CREATE POLICY "authenticated_read_unit_leaders" ON public.unit_leaders
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_all_unit_leaders" ON public.unit_leaders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "staff_read_unit_responses" ON public.unit_cohort_responses;
CREATE POLICY "authenticated_read_unit_responses" ON public.unit_cohort_responses
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_all_unit_cohort_responses" ON public.unit_cohort_responses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "owner_admin_select_student_dispositions" ON public.student_dispositions;
CREATE POLICY "authenticated_all_student_dispositions" ON public.student_dispositions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "user_profiles_select_self" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_select_staff" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_update_self" ON public.user_profiles;
GRANT ALL ON public.user_profiles TO authenticated;
CREATE POLICY "authenticated_all_user_profiles" ON public.user_profiles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "activity_logs_staff_insert" ON public.activity_logs;
DROP POLICY IF EXISTS "activity_logs_owner_admin_select" ON public.activity_logs;
GRANT ALL ON public.activity_logs TO authenticated;
CREATE POLICY "authenticated_all_activity_logs" ON public.activity_logs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
*/
