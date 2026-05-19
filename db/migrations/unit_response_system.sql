-- ============================================
-- UNIT LEADERS ROSTER (catalog of unit leadership contacts)
-- ============================================

CREATE TABLE IF NOT EXISTS unit_leaders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_name text NOT NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN (
    'Associate Director',
    'Executive Director',
    'Assistant Nurse Manager',
    'NPD Practitioner',
    'Clinical Nurse Specialist',
    'Acting Associate Director'
  )),
  role_qualifier text,
  is_primary_lead boolean DEFAULT false,
  is_active boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_unit_leaders_unit_name ON unit_leaders(unit_name);
CREATE INDEX IF NOT EXISTS idx_unit_leaders_email ON unit_leaders(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_unit_leaders_active ON unit_leaders(is_active);

ALTER TABLE unit_leaders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_unit_leaders"
  ON unit_leaders FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_unit_leaders"
  ON unit_leaders FOR SELECT TO authenticated USING (true);

-- Anon read: unit_leaders is not sensitive (public Cedars-Sinai leadership roster)
CREATE POLICY "anon_read_unit_leaders"
  ON unit_leaders FOR SELECT TO anon USING (true);

-- ============================================
-- ASPIRE ELIGIBLE FLAG ON UNITS
-- ============================================

ALTER TABLE units ADD COLUMN IF NOT EXISTS aspire_eligible boolean DEFAULT true;

UPDATE units SET aspire_eligible = false
  WHERE unit_name IN ('Emergency Department', 'Operating Room', 'OR', 'ED');

-- ============================================
-- UNIT COHORT RESPONSES (one row per unit per cohort)
-- ============================================

CREATE TABLE IF NOT EXISTS unit_cohort_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id uuid NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  unit_name text NOT NULL,

  response_status text NOT NULL DEFAULT 'pending' CHECK (response_status IN (
    'pending',
    'submitted_hosting',
    'submitted_not_hosting'
  )),

  submitted_by_name text,
  submitted_by_email text,
  submitted_by_role text,

  slots_offered integer,
  shift_preference text,
  preferred_preceptors text,
  considerations text,

  reason_for_zero text,

  hiring_new_grads_ngrp boolean,
  hiring_new_grads_reason text,

  has_hired_aspire_alumni text CHECK (has_hired_aspire_alumni IN ('yes', 'no', 'not_sure') OR has_hired_aspire_alumni IS NULL),
  aspire_alumni_outcome text CHECK (aspire_alumni_outcome IN ('successful', 'mixed', 'would_not_hire_again') OR aspire_alumni_outcome IS NULL),
  aspire_alumni_notes text,
  would_consider_aspire_alumni text CHECK (would_consider_aspire_alumni IN ('yes', 'no', 'maybe') OR would_consider_aspire_alumni IS NULL),

  submission_count integer DEFAULT 0,
  submitted_at timestamptz,
  last_updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),

  UNIQUE(cohort_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_unit_responses_cohort ON unit_cohort_responses(cohort_id);
CREATE INDEX IF NOT EXISTS idx_unit_responses_unit ON unit_cohort_responses(unit_id);
CREATE INDEX IF NOT EXISTS idx_unit_responses_status ON unit_cohort_responses(response_status);

ALTER TABLE unit_cohort_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_unit_responses"
  ON unit_cohort_responses FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_unit_responses"
  ON unit_cohort_responses FOR SELECT TO authenticated USING (true);

CREATE POLICY "anon_insert_unit_responses"
  ON unit_cohort_responses FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_update_unit_responses"
  ON unit_cohort_responses FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_select_unit_responses"
  ON unit_cohort_responses FOR SELECT TO anon USING (true);

-- ============================================
-- BACKFILL: existing participating units → submitted_hosting
-- ============================================

INSERT INTO unit_cohort_responses (cohort_id, unit_id, unit_name, response_status, slots_offered, preferred_preceptors, shift_preference, considerations, submitted_at, last_updated_at, submission_count)
SELECT
  u.cohort_id,
  u.id,
  u.unit_name,
  CASE WHEN u.is_participating AND u.total_slots > 0 THEN 'submitted_hosting' ELSE 'pending' END,
  u.total_slots,
  u.preceptors,
  u.shift_preference,
  u.considerations,
  CASE WHEN u.is_participating THEN u.created_at ELSE NULL END,
  u.created_at,
  CASE WHEN u.is_participating THEN 1 ELSE 0 END
FROM units u
WHERE NOT EXISTS (
  SELECT 1 FROM unit_cohort_responses ucr WHERE ucr.unit_id = u.id AND ucr.cohort_id = u.cohort_id
);
