-- =====================================================================
-- ASPIRE Tracker — First Name / Last Name Split Migration
-- Run this entire file in your Supabase SQL Editor
-- =====================================================================

-- 1. Add first_name / last_name to students table
ALTER TABLE students ADD COLUMN IF NOT EXISTS first_name TEXT DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS last_name  TEXT DEFAULT '';

-- Populate from existing name column (split on first space)
UPDATE students SET
  first_name = CASE
    WHEN position(' ' IN TRIM(name)) > 0
      THEN LEFT(TRIM(name), position(' ' IN TRIM(name)) - 1)
    ELSE TRIM(name)
  END,
  last_name = CASE
    WHEN position(' ' IN TRIM(name)) > 0
      THEN TRIM(SUBSTRING(TRIM(name) FROM position(' ' IN TRIM(name)) + 1))
    ELSE ''
  END
WHERE first_name = '';

-- 2. Add first_name / last_name to student_submissions table
ALTER TABLE student_submissions ADD COLUMN IF NOT EXISTS first_name TEXT DEFAULT '';
ALTER TABLE student_submissions ADD COLUMN IF NOT EXISTS last_name  TEXT DEFAULT '';

-- Populate from existing student_name column
UPDATE student_submissions SET
  first_name = CASE
    WHEN position(' ' IN TRIM(student_name)) > 0
      THEN LEFT(TRIM(student_name), position(' ' IN TRIM(student_name)) - 1)
    ELSE TRIM(student_name)
  END,
  last_name = CASE
    WHEN position(' ' IN TRIM(student_name)) > 0
      THEN TRIM(SUBSTRING(TRIM(student_name) FROM position(' ' IN TRIM(student_name)) + 1))
    ELSE ''
  END
WHERE first_name = '';
