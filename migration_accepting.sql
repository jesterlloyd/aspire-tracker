-- =====================================================================
-- ASPIRE Placement Tracker — Accepting Submissions + Student Submissions
-- Run this entire file in your Supabase SQL Editor
-- =====================================================================

-- 1. Add accepting_submissions flag to cohorts
ALTER TABLE cohorts ADD COLUMN IF NOT EXISTS accepting_submissions BOOLEAN DEFAULT FALSE;

-- 2. Create student_submissions table
CREATE TABLE IF NOT EXISTS student_submissions (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school           TEXT DEFAULT '',
  coordinator_name TEXT DEFAULT '',
  coordinator_email TEXT DEFAULT '',
  student_name     TEXT DEFAULT '',
  student_email    TEXT DEFAULT '',
  student_phone    TEXT DEFAULT '',
  program_type     TEXT DEFAULT '',
  term_dates       TEXT DEFAULT '',
  hours_required   INTEGER DEFAULT 0,
  notes            TEXT DEFAULT '',
  review_status    TEXT DEFAULT 'Pending',  -- Pending | Approved | Rejected
  cohort_id        UUID REFERENCES cohorts(id) ON DELETE SET NULL,
  submitted_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE student_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON student_submissions;
CREATE POLICY "anon_all" ON student_submissions
  FOR ALL TO anon USING (true) WITH CHECK (true);
