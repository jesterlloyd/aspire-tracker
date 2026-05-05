-- Cascade delete: when a student record is deleted, all related records
-- in interviews, matches, and student_intake_submissions are automatically removed.
-- Run in Supabase SQL Editor before deploying.

-- interviews table
ALTER TABLE interviews
  DROP CONSTRAINT IF EXISTS interviews_student_id_fkey;
ALTER TABLE interviews
  ADD CONSTRAINT interviews_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

-- matches table
ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_student_id_fkey;
ALTER TABLE matches
  ADD CONSTRAINT matches_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

