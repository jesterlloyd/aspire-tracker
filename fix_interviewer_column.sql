-- Ensures the interview_assigned_interviewers column exists on the students table.
-- Safe to re-run — IF NOT EXISTS prevents errors if already present.
-- Run in Supabase SQL Editor before deploying.

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS interview_assigned_interviewers TEXT DEFAULT '';
