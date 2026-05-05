-- Ensures all columns the school form inserts exist on the students table,
-- and grants the anon role INSERT permission so the public form can write rows.
-- Run in Supabase SQL Editor before deploying.

-- Columns added by earlier migrations (safe to re-run with IF NOT EXISTS)
ALTER TABLE students ADD COLUMN IF NOT EXISTS estimated_graduation      TEXT DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS submitted_via             TEXT DEFAULT 'manual';
ALTER TABLE students ADD COLUMN IF NOT EXISTS school_coordinator_name   TEXT DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS school_coordinator_email  TEXT DEFAULT '';

-- Allow the anon role (used by all public forms) to INSERT into students.
-- This is the most likely root cause of "Something went wrong" on form submit:
-- RLS is enabled on students but no INSERT policy exists for anon.
DROP POLICY IF EXISTS "anon_insert_students" ON students;
CREATE POLICY "anon_insert_students" ON students
  FOR INSERT TO anon
  WITH CHECK (true);
