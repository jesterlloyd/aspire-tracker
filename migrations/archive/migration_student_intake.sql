-- Creates the student_intake_submissions table for the /student-form public intake form.
-- Run this in the Supabase SQL Editor before deploying.

CREATE TABLE IF NOT EXISTS student_intake_submissions (
  id                          UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name                  TEXT,
  last_name                   TEXT,
  personal_email              TEXT,
  phone                       TEXT,
  -- SENSITIVE: This field contains personally identifiable information. Handle in accordance with applicable privacy policies.
  date_of_birth               TEXT,
  -- SENSITIVE: This field contains personally identifiable information. Handle in accordance with applicable privacy policies.
  ssn_last4                   TEXT,
  gender                      TEXT,
  prior_healthcare_experience TEXT,
  cs_affiliation              TEXT,
  cs_department               TEXT,
  additional_notes            TEXT,
  review_status               TEXT         DEFAULT 'Pending',
  cohort_id                   UUID         REFERENCES cohorts(id),
  submitted_at                TIMESTAMPTZ  DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE student_intake_submissions ENABLE ROW LEVEL SECURITY;

-- Allow anyone (anon) to insert - required for the unauthenticated public form
CREATE POLICY "Allow anon insert on student_intake_submissions"
  ON student_intake_submissions
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow authenticated users (dashboard) to read and update (for review queue)
CREATE POLICY "Allow authenticated read on student_intake_submissions"
  ON student_intake_submissions
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated update on student_intake_submissions"
  ON student_intake_submissions
  FOR UPDATE
  TO authenticated
  USING (true);
