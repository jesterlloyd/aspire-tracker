-- Scheduling feature migration
-- Creates availability blocks, bookable slots tables, and adds scheduling fields.
-- Run in Supabase SQL Editor.

-- Availability blocks created by ASPIRE team
CREATE TABLE IF NOT EXISTS interview_availability_blocks (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  cohort_id         UUID          REFERENCES cohorts(id) ON DELETE CASCADE,
  interviewer_name  TEXT          DEFAULT '',
  block_date        TEXT          NOT NULL,
  start_time        TEXT          NOT NULL,
  end_time          TEXT          NOT NULL,
  duration_minutes  INTEGER       DEFAULT 30,
  is_active         BOOLEAN       DEFAULT TRUE,
  created_at        TIMESTAMPTZ   DEFAULT NOW()
);

-- Individual bookable slots generated from blocks
CREATE TABLE IF NOT EXISTS interview_slots (
  id                    UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  block_id              UUID          REFERENCES interview_availability_blocks(id) ON DELETE CASCADE,
  cohort_id             UUID          REFERENCES cohorts(id),
  slot_date             TEXT          NOT NULL,
  slot_time             TEXT          NOT NULL,
  duration_minutes      INTEGER       DEFAULT 30,
  interviewer_name      TEXT          DEFAULT '',
  is_booked             BOOLEAN       DEFAULT FALSE,
  booked_by_student_id  UUID          REFERENCES students(id) ON DELETE SET NULL,
  booked_at             TIMESTAMPTZ   DEFAULT NULL,
  created_at            TIMESTAMPTZ   DEFAULT NOW()
);

-- Add Teams meeting tracking and self-scheduling flag to interview_sessions
ALTER TABLE interview_sessions
ADD COLUMN IF NOT EXISTS teams_meeting_booked  BOOLEAN  DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS self_scheduled         BOOLEAN  DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS slot_id                UUID     REFERENCES interview_slots(id) ON DELETE SET NULL;

-- Add scheduling tracking to students
ALTER TABLE students
ADD COLUMN IF NOT EXISTS scheduling_viewed_at  TIMESTAMPTZ DEFAULT NULL;

-- Enable RLS
ALTER TABLE interview_availability_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all_blocks" ON interview_availability_blocks
  FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE interview_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all_slots" ON interview_slots
  FOR ALL TO anon USING (true) WITH CHECK (true);
