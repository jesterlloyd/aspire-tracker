-- Adds CS-Link access tracking columns to the students table.
-- Run this in the Supabase SQL Editor before deploying.

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS access_non_employee            BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS access_non_employee_date       TEXT    DEFAULT '',
  ADD COLUMN IF NOT EXISTS access_hybrid_student          BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS access_hybrid_student_date     TEXT    DEFAULT '',
  ADD COLUMN IF NOT EXISTS access_extended_end_date       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS access_extended_end_date_value TEXT    DEFAULT '',
  ADD COLUMN IF NOT EXISTS access_reactivated             BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS access_reactivated_date        TEXT    DEFAULT '',
  ADD COLUMN IF NOT EXISTS access_notes                   TEXT    DEFAULT '';
