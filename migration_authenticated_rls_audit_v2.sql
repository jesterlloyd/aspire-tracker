-- ============================================================
-- ASPIRE Intelligence — Authenticated RLS Audit Migration v2
-- ============================================================
--
-- v2 CHANGES FROM v1:
--   Removed three tables that do NOT exist in the database:
--     - unit_submissions  (PostgREST: PGRST205, hint → unit_cohort_responses)
--     - student_submissions  (PostgREST: PGRST205, hint → student_shift_logs)
--     - student_intake_submissions  (PostgREST: PGRST205, no app code uses it)
--   These tables are referenced in migration SQL files but were never created
--   in the live project (or were renamed).  No application code references them.
--
-- TABLES CONFIRMED TO EXIST via direct HTTP probe of PostgREST schema cache:
--   All 19 tables below returned HTTP 200/206 (not 404).
--
-- TABLES EXCLUDED FROM THIS MIGRATION (already correct):
--   interview_rubrics — fixed in migration_rubrics_authenticated_rls.sql
--   notification_log  — already has a restrictive authenticated SELECT policy;
--                       do not override it with a blanket ALL policy
--   student_reads     — uses auth.uid() without a TO clause; works for authenticated
--   session_reads     — same pattern as student_reads
--
-- HOW TO RUN: Paste into Supabase SQL Editor and execute.
-- All DROP POLICY lines are idempotent (safe to re-run).
--
-- ============================================================


-- ── students ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "authenticated_all_students" ON students;
CREATE POLICY "authenticated_all_students" ON students
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── cohorts ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "authenticated_all_cohorts" ON cohorts;
CREATE POLICY "authenticated_all_cohorts" ON cohorts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── communications ───────────────────────────────────────────
DROP POLICY IF EXISTS "authenticated_all_communications" ON communications;
CREATE POLICY "authenticated_all_communications" ON communications
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── units ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "authenticated_all_units" ON units;
CREATE POLICY "authenticated_all_units" ON units
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── matches ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "authenticated_all_matches" ON matches;
CREATE POLICY "authenticated_all_matches" ON matches
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── interview_sessions ────────────────────────────────────────
DROP POLICY IF EXISTS "authenticated_all_interview_sessions" ON interview_sessions;
CREATE POLICY "authenticated_all_interview_sessions" ON interview_sessions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── interviewers ─────────────────────────────────────────────
-- Original anon policy had SELECT + INSERT + UPDATE but no DELETE.
-- Authenticated policy covers all operations.
DROP POLICY IF EXISTS "authenticated_all_interviewers" ON interviewers;
CREATE POLICY "authenticated_all_interviewers" ON interviewers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── interviews (legacy) ──────────────────────────────────────
-- Table exists with 2 rows of historical data. Covered for completeness.
DROP POLICY IF EXISTS "authenticated_all_interviews" ON interviews;
CREATE POLICY "authenticated_all_interviews" ON interviews
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── program_events ───────────────────────────────────────────
-- logEvent.js is called from authenticated user sessions throughout the app.
-- Without this policy, all auto-logged events (interview, rubric_saved,
-- rubric_save_failed, etc.) silently fail for logged-in users.
DROP POLICY IF EXISTS "authenticated_all_program_events" ON program_events;
CREATE POLICY "authenticated_all_program_events" ON program_events
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── interview_availability_blocks ────────────────────────────
DROP POLICY IF EXISTS "authenticated_all_availability_blocks" ON interview_availability_blocks;
CREATE POLICY "authenticated_all_availability_blocks" ON interview_availability_blocks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── interview_slots ──────────────────────────────────────────
DROP POLICY IF EXISTS "authenticated_all_interview_slots" ON interview_slots;
CREATE POLICY "authenticated_all_interview_slots" ON interview_slots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── student_shift_logs ────────────────────────────────────────
DROP POLICY IF EXISTS "authenticated_all_student_shift_logs" ON student_shift_logs;
CREATE POLICY "authenticated_all_student_shift_logs" ON student_shift_logs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── ngrp_outcomes ────────────────────────────────────────────
DROP POLICY IF EXISTS "authenticated_all_ngrp_outcomes" ON ngrp_outcomes;
CREATE POLICY "authenticated_all_ngrp_outcomes" ON ngrp_outcomes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── preceptors ───────────────────────────────────────────────
DROP POLICY IF EXISTS "authenticated_all_preceptors" ON preceptors;
CREATE POLICY "authenticated_all_preceptors" ON preceptors
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── cohort_snapshots ─────────────────────────────────────────
DROP POLICY IF EXISTS "authenticated_all_cohort_snapshots" ON cohort_snapshots;
CREATE POLICY "authenticated_all_cohort_snapshots" ON cohort_snapshots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── user_profiles ─────────────────────────────────────────────
-- Not in any tracked migration file (created via Supabase dashboard).
-- Confirmed to exist with anon SELECT access.  AuthContext reads this table
-- on every login; components update avatar, preferences, tour state, etc.
DROP POLICY IF EXISTS "authenticated_all_user_profiles" ON user_profiles;
CREATE POLICY "authenticated_all_user_profiles" ON user_profiles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── activity_logs ────────────────────────────────────────────
-- Not in any tracked migration file.  Confirmed to exist.
-- logActivity.js inserts rows from authenticated user sessions (every
-- meaningful user action).  Without this policy, the entire activity log
-- is silently empty for all logged-in users.
DROP POLICY IF EXISTS "authenticated_all_activity_logs" ON activity_logs;
CREATE POLICY "authenticated_all_activity_logs" ON activity_logs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── unit_cohort_responses ────────────────────────────────────
-- Not in any tracked migration file.  Confirmed to exist with 15 rows.
-- Unit leaders submit responses anonymously (anon INSERT already works).
-- Authenticated users (admins/co-leads) read and manage responses in
-- OverviewTab and Keith AI.
DROP POLICY IF EXISTS "authenticated_all_unit_cohort_responses" ON unit_cohort_responses;
CREATE POLICY "authenticated_all_unit_cohort_responses" ON unit_cohort_responses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── unit_leaders ─────────────────────────────────────────────
-- Not in any tracked migration file.  Confirmed to exist with 104 rows.
-- Read by OverviewTab, notifications/recipients.js, keithKnowledge.js,
-- and unitLeaders.js.  Admins manage the roster.
DROP POLICY IF EXISTS "authenticated_all_unit_leaders" ON unit_leaders;
CREATE POLICY "authenticated_all_unit_leaders" ON unit_leaders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── Reload PostgREST schema cache ────────────────────────────
NOTIFY pgrst, 'reload schema';
