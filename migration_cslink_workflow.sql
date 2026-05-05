-- CS-Link Access Workflow Migration
-- Replaces the old four-checkbox access model with a guided workflow model.
-- Run in Supabase SQL Editor before deploying.

-- Remove old access columns (no data to preserve)
ALTER TABLE students
  DROP COLUMN IF EXISTS access_non_employee,
  DROP COLUMN IF EXISTS access_non_employee_date,
  DROP COLUMN IF EXISTS access_hybrid_student,
  DROP COLUMN IF EXISTS access_hybrid_student_date,
  DROP COLUMN IF EXISTS access_extended_end_date,
  DROP COLUMN IF EXISTS access_extended_end_date_value,
  DROP COLUMN IF EXISTS access_reactivated,
  DROP COLUMN IF EXISTS access_reactivated_date,
  DROP COLUMN IF EXISTS access_notes;

-- Add new workflow columns
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS cs_cedars_status          TEXT    DEFAULT '',
  ADD COLUMN IF NOT EXISTS cs_stage1_action          TEXT    DEFAULT '',
  ADD COLUMN IF NOT EXISTS cs_stage1_submitted       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cs_stage1_submitted_date  TEXT    DEFAULT '',
  ADD COLUMN IF NOT EXISTS cs_stage1_complete        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cs_stage1_complete_date   TEXT    DEFAULT '',
  ADD COLUMN IF NOT EXISTS cs_link_requested         BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cs_link_requested_date    TEXT    DEFAULT '',
  ADD COLUMN IF NOT EXISTS cs_link_complete          BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cs_link_complete_date     TEXT    DEFAULT '',
  ADD COLUMN IF NOT EXISTS cs_access_notes           TEXT    DEFAULT '';
