-- db/audit/demo_mode_preflight_probe.sql
--
-- DEMO-MODE-1: READ ONLY. Nothing here creates, alters, or deletes anything.
--
-- The foundation migration refuses to run if a single table or parent key is missing,
-- which is correct (a partial apply would leave the client filtering on a column that
-- does not exist) but means discovering the gaps one RAISE at a time. This answers the
-- whole question in one pass.
--
-- Run it and send back all three result sets. The migration and the seed will then be
-- corrected once, against what production actually has.
--
-- Already known from the first attempt: public.schools does not exist. This instance
-- predates the canonical schools catalog, which api/lib/schoolScope.js explicitly
-- tolerates ("Some environments predate the canonical schools catalog"), so gate item 13
-- (20260712000012_phase4_school_portal.sql) was never applied. That is expected, not a
-- problem, and schools is being dropped from the demo boundary entirely.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Do the tables exist?  EXPECT: present = true for all except schools.
-- ─────────────────────────────────────────────────────────────────────
SELECT
  t.name AS table_name,
  (to_regclass('public.' || t.name) IS NOT NULL) AS present
FROM unnest(ARRAY[
  'cohorts','students','units','contacts','preceptors','schools',
  'matches','student_shift_logs','student_shift_plans',
  'student_preceptor_assignments','student_unit_assignments',
  'student_active_disposition','evaluation_assignments',
  'interview_slots','interview_sessions','interview_rubrics',
  'cohort_school_rotations','unit_capacity_submissions',
  'unit_placement_requests','unit_cohort_responses'
]) AS t(name)
ORDER BY present, t.name;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Do the parent keys exist?  Each child inherits is_demo through these.
--    EXPECT: present = true for every row whose table exists.
-- ─────────────────────────────────────────────────────────────────────
SELECT
  k.child, k.parent, k.fk,
  EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = k.child AND c.column_name = k.fk
  ) AS present
FROM (VALUES
  ('matches','students','student_id'),
  ('student_shift_logs','students','student_id'),
  ('student_shift_plans','students','student_id'),
  ('student_preceptor_assignments','students','student_id'),
  ('student_unit_assignments','students','student_id'),
  ('student_active_disposition','students','student_id'),
  ('evaluation_assignments','students','student_id'),
  ('interview_slots','cohorts','cohort_id'),
  ('interview_sessions','students','student_id'),
  ('interview_rubrics','students','student_id'),
  ('cohort_school_rotations','cohorts','cohort_id'),
  ('unit_capacity_submissions','cohorts','cohort_id'),
  ('unit_placement_requests','cohorts','cohort_id'),
  ('unit_cohort_responses','cohorts','cohort_id')
) AS k(child, parent, fk)
ORDER BY present, k.child;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Do the columns the SEED writes exist, and what type are they?
--
--    The type matters as much as the existence. Some date columns in this schema are
--    TEXT holding 'YYYY-MM-DD' and some are real DATEs, and PostgreSQL will not cast
--    implicitly on INSERT, so a mismatch aborts the whole seed. The seed is written
--    against: cohorts.start_date TEXT, students.interview_scheduled_date TEXT,
--    student_shift_logs.shift_date TEXT, cohort_school_rotations.rotation_*_date DATE,
--    preceptors.started_at DATE, student_preceptor_assignments.start_date DATE.
--
--    EXPECT: a row for every pair below. A MISSING row is a column the seed writes that
--    production does not have.
-- ─────────────────────────────────────────────────────────────────────
SELECT c.table_name, c.column_name, c.data_type, c.is_nullable
FROM information_schema.columns c
JOIN (VALUES
  ('students','first_name'),('students','last_name'),('students','preferred_first_name'),
  ('students','name'),('students','school_email'),('students','personal_email'),
  ('students','school'),('students','program_type'),('students','status'),
  ('students','cohort_id'),('students','hours_required'),('students','approved_hours'),
  ('students','matched_unit_id'),('students','preceptor_id'),('students','matched_preceptor'),
  ('students','shift_assigned'),('students','interview_scheduled_date'),
  ('students','interview_scheduled_time'),('students','unit_preference_1'),
  ('students','unit_preference_2'),('students','unit_preference_3'),('students','cumulative_gpa'),
  ('cohorts','name'),('cohorts','status'),('cohorts','start_date'),('cohorts','end_date'),
  ('cohorts','accepting_submissions'),
  ('units','unit_name'),('units','division'),('units','total_slots'),('units','slots_remaining'),
  ('units','contact_person'),('units','contact_email'),('units','is_participating'),
  ('units','patient_population'),('units','cohort_id'),
  ('preceptors','full_name'),('preceptors','email'),('preceptors','unit_name'),
  ('preceptors','shift_type'),('preceptors','status'),('preceptors','is_active'),
  ('preceptors','started_at'),('preceptors','cohort_id'),
  ('contacts','full_name'),('contacts','email'),('contacts','category'),('contacts','role'),
  ('contacts','organization'),('contacts','unit_name'),('contacts','is_active'),
  ('matches','student_id'),('matches','unit_id'),('matches','preceptor_id'),
  ('matches','preceptor_assigned'),('matches','shift_assigned'),('matches','notification_sent'),
  ('matches','cohort_id'),
  ('student_shift_logs','shift_date'),('student_shift_logs','shift_type'),
  ('student_shift_logs','unit_name'),('student_shift_logs','preceptor_name'),
  ('student_shift_logs','total_hours'),('student_shift_logs','expected_hours'),
  ('student_shift_logs','status'),('student_shift_logs','lifecycle_state'),
  ('student_shift_logs','support_needed'),('student_shift_logs','submitted_at'),
  ('student_shift_logs','checked_in_at'),('student_shift_logs','cohort_id'),
  ('student_preceptor_assignments','role'),('student_preceptor_assignments','status'),
  ('student_preceptor_assignments','start_date'),
  ('cohort_school_rotations','school_name'),('cohort_school_rotations','rotation_start_date'),
  ('cohort_school_rotations','rotation_end_date'),('cohort_school_rotations','coordinator_name'),
  ('cohort_school_rotations','coordinator_email'),('cohort_school_rotations','min_days_per_week'),
  ('cohort_school_rotations','weekends_allowed'),('cohort_school_rotations','nights_allowed')
) AS want(t, col) ON want.t = c.table_name AND want.col = c.column_name
WHERE c.table_schema = 'public'
ORDER BY c.table_name, c.column_name;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Has any of this been applied already?  EXPECT: zero rows on a clean instance.
-- ─────────────────────────────────────────────────────────────────────
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public' AND column_name = 'is_demo'
ORDER BY table_name;
