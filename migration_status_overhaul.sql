-- Migrate Accepted → Placed
UPDATE students
SET status = 'Placed'
WHERE status = 'Accepted';

-- Add decline_reason column
ALTER TABLE students
ADD COLUMN IF NOT EXISTS decline_reason TEXT DEFAULT '';

-- Add events table
CREATE TABLE IF NOT EXISTS program_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  cohort_id UUID REFERENCES cohorts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_date DATE,
  event_time TIME,
  notes TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_program_events_student
  ON program_events(student_id);
CREATE INDEX IF NOT EXISTS idx_program_events_cohort
  ON program_events(cohort_id);
CREATE INDEX IF NOT EXISTS idx_program_events_type
  ON program_events(event_type);
