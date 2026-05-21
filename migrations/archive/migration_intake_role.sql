-- CHANGE 3: Add cs_role column (role/job title alongside cs_department)
-- CHANGE 4: Add unit preference columns (populated from dynamic dropdowns)
-- CHANGE 1 FIX: Add anon SELECT + UPDATE policies so the dashboard (which uses
--   the anon Supabase key without Supabase Auth) can read and update submissions.
-- Run this in the Supabase SQL Editor before deploying.

ALTER TABLE student_intake_submissions
  ADD COLUMN IF NOT EXISTS cs_role           TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS unit_preference_1 TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS unit_preference_2 TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS unit_preference_3 TEXT DEFAULT '';

-- Drop and recreate anon read/update policies (safe to re-run)
DROP POLICY IF EXISTS "Allow anon select on student_intake_submissions"
  ON student_intake_submissions;
CREATE POLICY "Allow anon select on student_intake_submissions"
  ON student_intake_submissions
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow anon update on student_intake_submissions"
  ON student_intake_submissions;
CREATE POLICY "Allow anon update on student_intake_submissions"
  ON student_intake_submissions
  FOR UPDATE TO anon USING (true);
