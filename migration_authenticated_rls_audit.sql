-- ============================================================
-- ASPIRE Intelligence — Authenticated RLS Audit Migration
-- ============================================================
--
-- PROBLEM: Every table in this project was created with a policy scoped
-- to the `anon` role.  When users are logged in via Supabase Auth, their
-- requests use the `authenticated` PostgreSQL role.  The anon policy does
-- NOT apply to authenticated requests.  Result: every INSERT/UPDATE/DELETE
-- issued by a logged-in user is silently rejected by Supabase RLS — no
-- error reaches the UI.
--
-- This was first confirmed on interview_rubrics (see
-- migration_rubrics_authenticated_rls.sql).  This file extends the fix to
-- every other affected table identified in the audit.
--
-- SCOPE: This is an internal single-org application.  All authenticated
-- users are program staff (Jester, NPD-Ps, interviewers, co-leads).
-- Broad authenticated access is therefore appropriate; we are NOT adding
-- row-level restrictions within the authenticated role.
--
-- HOW TO RUN: Paste this file into the Supabase SQL Editor and execute.
-- The DROP POLICY lines are idempotent (safe to re-run).
--
-- Tables already fixed (NOT included here):
--   interview_rubrics  (migration_rubrics_authenticated_rls.sql)
--
-- Tables with unknown RLS status — NOT in any tracked migration file,
-- meaning they were created via the Supabase dashboard.  Audit these
-- manually in the Supabase Policy editor after running this migration:
--   user_profiles, activity_logs, unit_cohort_responses, unit_leaders
--
-- ============================================================


-- ── students ─────────────────────────────────────────────────
-- All app users read student records; admins/owners create and edit them.
-- App writes: App.jsx (update/delete), ImportStudentsCSV.jsx (insert),
--             SchoolFormPage.jsx (insert), StudentSidePanel.jsx (update),
--             RubricSession.jsx (update), many components

DROP POLICY IF EXISTS "authenticated_all_students" ON students;
CREATE POLICY "authenticated_all_students" ON students
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── cohorts ──────────────────────────────────────────────────
-- All app users read cohort list; owners/admins create and configure cohorts.
-- App writes: App.jsx (insert/update), ActionCenter.jsx (update)

DROP POLICY IF EXISTS "authenticated_all_cohorts" ON cohorts;
CREATE POLICY "authenticated_all_cohorts" ON cohorts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── communications ───────────────────────────────────────────
-- Communication history is read by all app users.  New log entries are
-- inserted by authenticated users from ActionCenter and the communications
-- log panel.
-- App writes: ActionCenter.jsx (insert)

DROP POLICY IF EXISTS "authenticated_all_communications" ON communications;
CREATE POLICY "authenticated_all_communications" ON communications
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── units ────────────────────────────────────────────────────
-- Unit roster and slot counts are read across the app.
-- Admins create/update/delete units.
-- App writes: App.jsx (update/delete), UnitSetupPanel.jsx (insert/update),
--             ImportUnitsCSV.jsx (insert), UnitFormPage.jsx (update/insert)

DROP POLICY IF EXISTS "authenticated_all_units" ON units;
CREATE POLICY "authenticated_all_units" ON units
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── matches ──────────────────────────────────────────────────
-- Match assignments are read across the app.
-- Matching operations create, update, and delete match rows.
-- App writes: App.jsx (insert/delete/update)

DROP POLICY IF EXISTS "authenticated_all_matches" ON matches;
CREATE POLICY "authenticated_all_matches" ON matches
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── interview_sessions ────────────────────────────────────────
-- Interview session records are read by interviewers and admins.
-- Sessions are created when slots are booked and updated throughout the flow.
-- App writes: App.jsx (delete), WeekCalendar.jsx (update/insert),
--             InterviewDayDrawer.jsx (update), TodaysInterviews.jsx

DROP POLICY IF EXISTS "authenticated_all_interview_sessions" ON interview_sessions;
CREATE POLICY "authenticated_all_interview_sessions" ON interview_sessions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── interviewers ─────────────────────────────────────────────
-- Interviewer catalog is read everywhere the interviewer dropdown appears.
-- Admins add/edit/delete interviewers via InterviewersModal.
-- NOTE: The original anon policy had SELECT + INSERT + UPDATE but no DELETE.
-- The authenticated policy below covers all operations including DELETE.
-- App writes: InterviewersModal.jsx (insert/update/delete via proxy)

DROP POLICY IF EXISTS "authenticated_all_interviewers" ON interviewers;
CREATE POLICY "authenticated_all_interviewers" ON interviewers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── interviews (legacy) ──────────────────────────────────────
-- Legacy table superseded by interview_rubrics.  May still have rows
-- that the app queries.  Adding authenticated coverage for completeness.

DROP POLICY IF EXISTS "authenticated_all_interviews" ON interviews;
CREATE POLICY "authenticated_all_interviews" ON interviews
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── program_events ───────────────────────────────────────────
-- Event log is written by logEvent.js (called from authenticated user
-- sessions) and read by Keith AI.  The existing policy covered anon and
-- service_role but NOT authenticated — meaning auto-logged interview
-- events, rubric_saved events, etc. were silently failing.
-- App writes: logEvent.js (many call sites), StudentSidePanel.jsx

DROP POLICY IF EXISTS "authenticated_all_program_events" ON program_events;
CREATE POLICY "authenticated_all_program_events" ON program_events
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── interview_availability_blocks ────────────────────────────
-- Interviewers and admins create availability blocks for scheduling.
-- App writes: AvailabilitySection.jsx (insert/update/delete),
--             AvailabilityManagerModal.jsx (update)

DROP POLICY IF EXISTS "authenticated_all_availability_blocks" ON interview_availability_blocks;
CREATE POLICY "authenticated_all_availability_blocks" ON interview_availability_blocks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── interview_slots ──────────────────────────────────────────
-- Slot management is performed by interviewers and admins.
-- App writes: AvailabilitySection.jsx (insert), InterviewDayDrawer.jsx
--             (delete/update)

DROP POLICY IF EXISTS "authenticated_all_interview_slots" ON interview_slots;
CREATE POLICY "authenticated_all_interview_slots" ON interview_slots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── student_shift_logs ────────────────────────────────────────
-- Shift log records are read and edited by admins.
-- App writes: ShiftLogPage.jsx (insert), StudentSidePanel.jsx (update)

DROP POLICY IF EXISTS "authenticated_all_student_shift_logs" ON student_shift_logs;
CREATE POLICY "authenticated_all_student_shift_logs" ON student_shift_logs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── ngrp_outcomes ────────────────────────────────────────────
-- Analytics data for the NGRP outcomes dashboard.
-- App writes: Likely written by admins via the analytics panel.

DROP POLICY IF EXISTS "authenticated_all_ngrp_outcomes" ON ngrp_outcomes;
CREATE POLICY "authenticated_all_ngrp_outcomes" ON ngrp_outcomes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── preceptors ───────────────────────────────────────────────
-- Preceptor roster read by matching and placement components.

DROP POLICY IF EXISTS "authenticated_all_preceptors" ON preceptors;
CREATE POLICY "authenticated_all_preceptors" ON preceptors
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── cohort_snapshots ─────────────────────────────────────────
-- Cohort analytics snapshots read by the analytics/reporting panel.

DROP POLICY IF EXISTS "authenticated_all_cohort_snapshots" ON cohort_snapshots;
CREATE POLICY "authenticated_all_cohort_snapshots" ON cohort_snapshots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── unit_submissions ─────────────────────────────────────────
-- Unit form submissions from unit leaders (submitted anonymously).
-- Admins/coordinators read these in the OverviewTab.
-- anon already has INSERT access (the form submits without auth).
-- Add authenticated read + all for admin management.

DROP POLICY IF EXISTS "authenticated_all_unit_submissions" ON unit_submissions;
CREATE POLICY "authenticated_all_unit_submissions" ON unit_submissions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── student_submissions ──────────────────────────────────────
-- Legacy student submission records, read by admins.

DROP POLICY IF EXISTS "authenticated_all_student_submissions" ON student_submissions;
CREATE POLICY "authenticated_all_student_submissions" ON student_submissions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── student_intake_submissions ────────────────────────────────
-- Students submit the intake form anonymously (anon INSERT already exists).
-- Authenticated users (staff) read and update submissions, and may delete
-- test/duplicate entries.  SELECT + UPDATE already existed; adding DELETE.

DROP POLICY IF EXISTS "Allow authenticated delete on student_intake_submissions" ON student_intake_submissions;
CREATE POLICY "Allow authenticated delete on student_intake_submissions"
  ON student_intake_submissions
  FOR DELETE TO authenticated
  USING (true);

-- Also add INSERT for authenticated so staff can create entries directly
-- (e.g., manually entering a student who submitted via email).
DROP POLICY IF EXISTS "Allow authenticated insert on student_intake_submissions" ON student_intake_submissions;
CREATE POLICY "Allow authenticated insert on student_intake_submissions"
  ON student_intake_submissions
  FOR INSERT TO authenticated
  WITH CHECK (true);


-- ── Reload PostgREST schema cache ────────────────────────────
-- Forces PostgREST to recognise the new policies immediately without
-- requiring a server restart.
NOTIFY pgrst, 'reload schema';
