-- db/audit/demo_mode_preflight_probe_2.sql
--
-- DEMO-MODE-1: READ ONLY. Second pass.
--
-- Probe 1 answered its part 3 and it was decisive: every column the seed writes exists
-- with the type it was written against, INCLUDING the three TEXT date columns that would
-- otherwise have aborted the file, EXCEPT on preceptors, which turns out to carry
-- identity only. No cohort_id, no status, no started_at. The seed is corrected.
--
-- Still outstanding: probe 1's parts 1, 2 and 4, which confirm the tables and the parent
-- keys the inheritance triggers hang off. Those are repeated here so everything needed
-- is in one file, plus one new question about the table that holds what preceptors does
-- not.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Do the 19 tables exist?  EXPECT: present = true for all 19.
-- ─────────────────────────────────────────────────────────────────────
SELECT t.name AS table_name, (to_regclass('public.' || t.name) IS NOT NULL) AS present
FROM unnest(ARRAY[
  'cohorts','students','units','contacts','preceptors',
  'matches','student_shift_logs','student_shift_plans',
  'student_preceptor_assignments','student_unit_assignments',
  'student_active_disposition','evaluation_assignments',
  'interview_slots','interview_sessions','interview_rubrics',
  'cohort_school_rotations','unit_capacity_submissions',
  'unit_placement_requests','unit_cohort_responses'
]) AS t(name)
ORDER BY present, t.name;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Do the 14 parent keys exist?  Each child inherits is_demo through these.
--    EXPECT: present = true for all 14.
-- ─────────────────────────────────────────────────────────────────────
SELECT k.child, k.parent, k.fk,
  EXISTS (SELECT 1 FROM information_schema.columns c
          WHERE c.table_schema='public' AND c.table_name=k.child AND c.column_name=k.fk) AS present
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
-- 3. preceptor_cohort_participation: what preceptors does NOT carry.
--
--    src/hooks/usePreceptors.js embeds this table to get a preceptor's cohort, status
--    and dates. The embed is a LEFT join, so demo preceptors will appear without a row
--    here, just with no cohort and no status beside their name. Whether it is worth
--    seeding depends on this answer.
--
--    EXPECT: the table plus its columns, or nothing at all if it does not exist here.
-- ─────────────────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'preceptor_cohort_participation'
ORDER BY ordinal_position;

-- ─────────────────────────────────────────────────────────────────────
-- 4. And its CHECK constraints, so the seed writes a status the table accepts.
-- ─────────────────────────────────────────────────────────────────────
SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND rel.relname IN ('preceptor_cohort_participation','student_preceptor_assignments','preceptors','students')
  AND con.contype = 'c'
ORDER BY rel.relname, con.conname;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Has any of this been applied already?  EXPECT: zero rows.
-- ─────────────────────────────────────────────────────────────────────
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public' AND column_name = 'is_demo'
ORDER BY table_name;
