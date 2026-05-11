-- ============================================
-- PHASE 1 ANALYTICS FOUNDATION
-- ASPIRE Intelligence Platform
-- ============================================

-- 1. NGRP Outcomes table
-- Tracks what happens to each student after ASPIRE
-- This is the most important analytics table

CREATE TABLE IF NOT EXISTS ngrp_outcomes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  cohort_id UUID REFERENCES cohorts(id) ON DELETE CASCADE,

  -- Application
  applied_to_ngrp BOOLEAN DEFAULT FALSE,
  application_date DATE,

  -- Interview
  ngrp_interviewed BOOLEAN DEFAULT FALSE,
  ngrp_interview_date DATE,

  -- Offer
  ngrp_offered BOOLEAN DEFAULT FALSE,
  offer_date DATE,

  -- Hire
  ngrp_hired BOOLEAN DEFAULT FALSE,
  hire_date DATE,
  ngrp_unit TEXT DEFAULT '',
  ngrp_specialty TEXT DEFAULT '',

  -- Retention (populated later)
  retained_6_months BOOLEAN,
  retained_12_months BOOLEAN,
  retained_18_months BOOLEAN,
  separation_date DATE,
  separation_reason TEXT DEFAULT '',

  -- Meta
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ngrp_outcomes_student
  ON ngrp_outcomes(student_id);
CREATE INDEX IF NOT EXISTS idx_ngrp_outcomes_cohort
  ON ngrp_outcomes(cohort_id);

-- Enable RLS
ALTER TABLE ngrp_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon full access on ngrp_outcomes"
ON ngrp_outcomes FOR ALL TO anon
USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on ngrp_outcomes"
ON ngrp_outcomes FOR ALL TO service_role
USING (true) WITH CHECK (true);


-- 2. Preceptors table (normalized)
-- Currently preceptor names are scattered as text in student records
-- This table makes preceptor analytics possible

CREATE TABLE IF NOT EXISTS preceptors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
  unit_name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT TRUE,

  -- Engagement tracking
  cohorts_participated INTEGER DEFAULT 0,
  total_students_precepted INTEGER DEFAULT 0,
  last_active_cohort TEXT DEFAULT '',
  last_active_date DATE,

  -- Notes
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_preceptors_unit
  ON preceptors(unit_id);
CREATE INDEX IF NOT EXISTS idx_preceptors_active
  ON preceptors(is_active);

-- Enable RLS
ALTER TABLE preceptors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon full access on preceptors"
ON preceptors FOR ALL TO anon
USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on preceptors"
ON preceptors FOR ALL TO service_role
USING (true) WITH CHECK (true);


-- 3. Add preceptor_id foreign key to students
-- Links each student to their normalized preceptor record

ALTER TABLE students
ADD COLUMN IF NOT EXISTS preceptor_id UUID REFERENCES preceptors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_students_preceptor
  ON students(preceptor_id);


-- 4. Cohort snapshots table
-- Periodic point-in-time snapshots of cohort state
-- Used for trend analysis without recalculating historical data

CREATE TABLE IF NOT EXISTS cohort_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cohort_id UUID REFERENCES cohorts(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,

  -- Student counts by status at snapshot time
  total_students INTEGER DEFAULT 0,
  pending_outreach INTEGER DEFAULT 0,
  form_sent INTEGER DEFAULT 0,
  form_received INTEGER DEFAULT 0,
  interview_scheduled INTEGER DEFAULT 0,
  interviewed INTEGER DEFAULT 0,
  placed INTEGER DEFAULT 0,
  active_rotation INTEGER DEFAULT 0,
  completed INTEGER DEFAULT 0,
  declined INTEGER DEFAULT 0,

  -- Placement metrics
  total_slots INTEGER DEFAULT 0,
  slots_filled INTEGER DEFAULT 0,
  slots_remaining INTEGER DEFAULT 0,

  -- Hours metrics
  total_approved_hours INTEGER DEFAULT 0,
  students_at_required_hours INTEGER DEFAULT 0,

  -- NGRP metrics
  ngrp_applied INTEGER DEFAULT 0,
  ngrp_hired INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cohort_snapshots_unique
  ON cohort_snapshots(cohort_id, snapshot_date);

CREATE INDEX IF NOT EXISTS idx_cohort_snapshots_cohort
  ON cohort_snapshots(cohort_id);

-- Enable RLS
ALTER TABLE cohort_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon full access on cohort_snapshots"
ON cohort_snapshots FOR ALL TO anon
USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on cohort_snapshots"
ON cohort_snapshots FOR ALL TO service_role
USING (true) WITH CHECK (true);


-- 5. Useful analytics views

-- Conversion funnel view per cohort
CREATE OR REPLACE VIEW cohort_conversion_funnel AS
SELECT
  s.cohort_id,
  c.name AS cohort_name,
  COUNT(*) AS total_students,
  COUNT(*) FILTER (WHERE s.status NOT IN ('Pending Outreach', 'Form Sent', 'Declined')) AS submitted_form,
  COUNT(*) FILTER (WHERE s.status NOT IN ('Pending Outreach', 'Form Sent', 'Form Received', 'Declined')) AS scheduled_interview,
  COUNT(*) FILTER (WHERE s.status IN ('Interviewed','Placed','Active Rotation','Completed')) AS completed_interview,
  COUNT(*) FILTER (WHERE s.status IN ('Placed','Active Rotation','Completed')) AS placed,
  COUNT(*) FILTER (WHERE s.status IN ('Active Rotation','Completed')) AS started_rotation,
  COUNT(*) FILTER (WHERE s.status = 'Completed') AS completed_rotation,
  COUNT(*) FILTER (WHERE s.ngrp_hired = TRUE) AS ngrp_hired,
  COUNT(*) FILTER (WHERE s.status = 'Declined') AS declined
FROM students s
JOIN cohorts c ON s.cohort_id = c.id
GROUP BY s.cohort_id, c.name;

-- School pipeline yield view
CREATE OR REPLACE VIEW school_pipeline_yield AS
SELECT
  s.school,
  s.cohort_id,
  c.name AS cohort_name,
  COUNT(*) AS total_students,
  COUNT(*) FILTER (WHERE s.status IN ('Placed','Active Rotation','Completed')) AS placed,
  COUNT(*) FILTER (WHERE s.status = 'Completed') AS completed,
  COUNT(*) FILTER (WHERE s.ngrp_hired = TRUE) AS ngrp_hired,
  ROUND(
    COUNT(*) FILTER (WHERE s.status IN ('Placed','Active Rotation','Completed'))::numeric
    / NULLIF(COUNT(*), 0) * 100, 1
  ) AS placement_rate_pct,
  ROUND(
    COUNT(*) FILTER (WHERE s.ngrp_hired = TRUE)::numeric
    / NULLIF(COUNT(*), 0) * 100, 1
  ) AS ngrp_yield_pct,
  AVG(s.gpa) AS avg_gpa
FROM students s
JOIN cohorts c ON s.cohort_id = c.id
GROUP BY s.school, s.cohort_id, c.name;

-- ============================================
-- END PHASE 1 ANALYTICS MIGRATION
-- ============================================
