-- Adds the interview_assigned_interviewers column to the students table.
-- Run in Supabase SQL Editor before deploying.

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS interview_assigned_interviewers TEXT DEFAULT '';
