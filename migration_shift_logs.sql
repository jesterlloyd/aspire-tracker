-- Shift logs table
CREATE TABLE IF NOT EXISTS student_shift_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  cohort_id UUID REFERENCES cohorts(id) ON DELETE CASCADE,
  school_email TEXT NOT NULL,
  shift_date TEXT NOT NULL,
  total_hours DECIMAL(4,2) NOT NULL,
  unit_name TEXT DEFAULT '',
  is_assigned_unit BOOLEAN DEFAULT TRUE,
  unit_override_reason TEXT DEFAULT '',
  preceptor_name TEXT DEFAULT '',
  is_assigned_preceptor BOOLEAN DEFAULT TRUE,
  preceptor_override_note TEXT DEFAULT '',
  shift_type TEXT DEFAULT 'Day',
  learning_highlight TEXT DEFAULT '',
  support_needed TEXT DEFAULT '',
  attestation BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'approved',
  exception_flags JSONB DEFAULT '[]',
  admin_notes TEXT DEFAULT '',
  reviewed_by TEXT DEFAULT '',
  reviewed_at TIMESTAMPTZ DEFAULT NULL,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE student_shift_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all_shift_logs" ON student_shift_logs
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Add tracking columns to students table
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS badge_created   BOOLEAN      DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS approved_hours  DECIMAL(6,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_hours   DECIMAL(6,2) DEFAULT 0;
