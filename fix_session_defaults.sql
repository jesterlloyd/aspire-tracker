-- Fix interview_sessions question_index column defaults.
-- Ensures all three question_index columns default to NULL, not 0.
-- Run in Supabase SQL Editor if the table already exists from a prior migration.
-- Safe to run even if defaults are already NULL.

ALTER TABLE interview_sessions
  ALTER COLUMN cj_question_index SET DEFAULT NULL,
  ALTER COLUMN pp_question_index SET DEFAULT NULL,
  ALTER COLUMN ga_question_index SET DEFAULT NULL;

-- Also fix any rows that were inserted with 0 (the PostgreSQL integer default)
-- before this migration ran. Set them back to NULL.
UPDATE interview_sessions
SET
  cj_question_index = NULL WHERE cj_question_index = 0;
UPDATE interview_sessions
SET
  pp_question_index = NULL WHERE pp_question_index = 0;
UPDATE interview_sessions
SET
  ga_question_index = NULL WHERE ga_question_index = 0;
