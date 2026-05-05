-- ================================================================
-- ASPIRE Program Tracker — Structural Reorganization Migration
-- Run in Supabase SQL Editor BEFORE deploying updated code.
-- ================================================================

-- ── New columns on students ───────────────────────────────────
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS resume_url                TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS headshot_url              TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS estimated_graduation      TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS submitted_via             TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS school_coordinator_name   TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS school_coordinator_email  TEXT DEFAULT '',
  -- Fields from student intake form now stored directly on student record
  ADD COLUMN IF NOT EXISTS date_of_birth             TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS ssn_last4                 TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS gender                    TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS cs_affiliation            TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS cs_department             TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS cs_role                   TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS prior_healthcare_experience TEXT DEFAULT '';

-- ── Backfill submitted_via for existing manual records ────────
UPDATE students
SET submitted_via = 'manual'
WHERE submitted_via IS NULL OR submitted_via = '';

-- ── Drop obsolete submission queue tables ─────────────────────
DROP TABLE IF EXISTS unit_submissions CASCADE;
DROP TABLE IF EXISTS student_submissions CASCADE;
DROP TABLE IF EXISTS student_intake_submissions CASCADE;
