-- =====================================================================
-- ASPIRE Placement Tracker — Unit Submissions Migration
-- Run this entire file in your Supabase SQL Editor
-- =====================================================================

CREATE TABLE IF NOT EXISTS unit_submissions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_name       TEXT DEFAULT '',
  contact_person  TEXT DEFAULT '',
  contact_email   TEXT DEFAULT '',
  is_participating BOOLEAN DEFAULT TRUE,
  total_slots     INTEGER DEFAULT 0,
  shift_preference TEXT DEFAULT '',
  preceptors      TEXT DEFAULT '',
  considerations  TEXT DEFAULT '',
  review_status   TEXT DEFAULT 'Pending',  -- Pending | Approved | Rejected
  cohort_id       UUID REFERENCES cohorts(id) ON DELETE SET NULL,
  submitted_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE unit_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON unit_submissions;
CREATE POLICY "anon_all" ON unit_submissions
  FOR ALL TO anon USING (true) WITH CHECK (true);
