-- Communications log table
CREATE TABLE IF NOT EXISTS communications (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id  UUID        REFERENCES students(id) ON DELETE CASCADE,
  cohort_id   UUID        REFERENCES cohorts(id)  ON DELETE CASCADE,
  type        TEXT        NOT NULL,
  sent_to_email TEXT      DEFAULT '',
  sent_to_name  TEXT      DEFAULT '',
  sent_by       TEXT      DEFAULT '',
  sent_at       TIMESTAMPTZ DEFAULT NOW(),
  notes         TEXT      DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Valid type values:
-- 'student_form', 'scheduling_link', 'interview_reminder',
-- 'unit_notification', 'preceptor_welcome', 'cslink_reminder',
-- 'orientation_survey', 'midpoint_checkin', 'midpoint_eval',
-- 'post_survey', 'certificate', 'end_eval'

ALTER TABLE communications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all_comms" ON communications
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Add preceptor email to students
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS preceptor_email TEXT DEFAULT '';

-- Add cohort-level orientation sent tracking
ALTER TABLE cohorts
  ADD COLUMN IF NOT EXISTS orientation_sent_at TIMESTAMPTZ DEFAULT NULL;
