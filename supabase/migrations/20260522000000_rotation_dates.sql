-- =============================================================================
-- ASPIRE Intelligence: Rotation Dates as First-Class Data
-- Migration: 20260522000000_rotation_dates
-- =============================================================================
--
-- CONCEPTUAL MODEL
-- Cohort:   internal ASPIRE grouping (e.g. Summer 2026). Multi-school.
-- Rotation: a specific school's bedside dates within a cohort. One row per
--           school per cohort. All students from that school reference it.
--
-- SCHEMA CHOICES
-- No standalone 'schools' table exists in this project; schools are stored as
-- a text column on students. cohort_school_rotations therefore uses
-- school_name text rather than school_id uuid.
--
-- SENTINEL VALUE
-- Backfilled rows have rotation_start_date = rotation_end_date = '1900-01-01'.
-- The admin UI surfaces a "Rotation dates pending" warning for any row that
-- matches this sentinel. Real submissions overwrite the sentinels.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute.
-- Idempotent: all DDL uses IF NOT EXISTS; backfill INSERT uses ON CONFLICT DO NOTHING.
-- =============================================================================


-- ============================================================
-- 1. TRIGGER FUNCTION (used by the new table and can be shared)
-- ============================================================

-- Reuse the existing function if it was already created by an earlier migration.
-- Nothing to add here; update_updated_at_column() was created in
-- migration_concurrency_protections.sql. If running this migration on a fresh
-- schema, create the function first:
-- CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$
-- BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;


-- ============================================================
-- 2. NEW TABLE: cohort_school_rotations
-- ============================================================

CREATE TABLE IF NOT EXISTS cohort_school_rotations (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- One row per school per cohort
  cohort_id           uuid        NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  school_name         text        NOT NULL,

  -- Rotation window (sentinel: '1900-01-01' means "pending admin review")
  rotation_start_date date        NOT NULL DEFAULT '1900-01-01',
  rotation_end_date   date        NOT NULL DEFAULT '1900-01-01',

  -- Latest coordinator contact from form submission
  coordinator_name    text,
  coordinator_email   text,

  -- Audit columns
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by          uuid        REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Exactly one rotation row per school per cohort
  CONSTRAINT cohort_school_rotations_unique UNIQUE (cohort_id, school_name),

  -- End must be after start (unless both are the sentinel)
  CONSTRAINT rotation_dates_order CHECK (
    rotation_end_date > rotation_start_date
    OR (rotation_start_date = '1900-01-01' AND rotation_end_date = '1900-01-01')
  )
);

CREATE INDEX IF NOT EXISTS idx_cohort_school_rotations_cohort
  ON cohort_school_rotations(cohort_id);

DROP TRIGGER IF EXISTS set_updated_at_cohort_school_rotations ON cohort_school_rotations;
CREATE TRIGGER set_updated_at_cohort_school_rotations
  BEFORE UPDATE ON cohort_school_rotations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- 3. RLS: cohort_school_rotations
-- ============================================================

ALTER TABLE cohort_school_rotations ENABLE ROW LEVEL SECURITY;

-- Authenticated users (staff) can read rotation rows (needed by the drawer panel)
DROP POLICY IF EXISTS "cohort_school_rotations_authenticated_select" ON cohort_school_rotations;
CREATE POLICY "cohort_school_rotations_authenticated_select"
  ON cohort_school_rotations FOR SELECT TO authenticated USING (true);

-- Anon can also read (needed by the public /school-form confirmation fetch, if any)
DROP POLICY IF EXISTS "cohort_school_rotations_anon_select" ON cohort_school_rotations;
CREATE POLICY "cohort_school_rotations_anon_select"
  ON cohort_school_rotations FOR SELECT TO anon USING (true);

-- All writes go through /api/ functions which use the service role key.
-- The service role bypasses RLS; no explicit policy needed for writes.


-- ============================================================
-- 4. NEW COLUMNS ON students
-- ============================================================

-- Foreign key to the school's rotation row for this cohort
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS cohort_school_rotation_id uuid
    REFERENCES cohort_school_rotations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_students_cohort_school_rotation
  ON students(cohort_school_rotation_id);

-- Structured graduation date (replaces the free-text estimated_graduation column)
-- The old estimated_graduation text column is preserved for backward compatibility;
-- new form submissions write to estimated_graduation_date (date type).
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS estimated_graduation_date date;


-- ============================================================
-- 5. BACKFILL: Summer 2026 cohort
-- ============================================================
-- Active cohort ID: 7f4e0a67-ccef-498c-80f5-1e5c7c681bd1
-- Distinct schools: APU, Cal State LA, Cal State Long Beach, WCU Anaheim, WCU NoHo
--
-- Step 5a: Create one sentinel rotation row per school.
--          Admin must replace '1900-01-01' with real dates via the drawer panel.

INSERT INTO cohort_school_rotations
  (cohort_id, school_name, rotation_start_date, rotation_end_date)
SELECT DISTINCT ON (school)
  '7f4e0a67-ccef-498c-80f5-1e5c7c681bd1'::uuid,
  school,
  '1900-01-01'::date,
  '1900-01-01'::date
FROM students
WHERE cohort_id = '7f4e0a67-ccef-498c-80f5-1e5c7c681bd1'
  AND school IS NOT NULL AND school != ''
ORDER BY school
ON CONFLICT (cohort_id, school_name) DO NOTHING;

-- Step 5b: Link every Summer 2026 student to their school's rotation row.

UPDATE students s
SET cohort_school_rotation_id = r.id
FROM cohort_school_rotations r
WHERE s.cohort_id      = '7f4e0a67-ccef-498c-80f5-1e5c7c681bd1'
  AND r.cohort_id      = '7f4e0a67-ccef-498c-80f5-1e5c7c681bd1'
  AND s.school         = r.school_name
  AND s.cohort_school_rotation_id IS NULL;


-- ============================================================
-- 6. RELOAD SCHEMA CACHE
-- ============================================================

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- VERIFICATION QUERIES (uncomment to check)
-- ============================================================
-- SELECT school_name, rotation_start_date, rotation_end_date
--   FROM cohort_school_rotations
--   WHERE cohort_id = '7f4e0a67-ccef-498c-80f5-1e5c7c681bd1';
-- Expected: 5 rows (APU, Cal State LA, Cal State Long Beach, WCU Anaheim, WCU NoHo)
--           all with '1900-01-01' sentinels.

-- SELECT COUNT(*) FROM students
--   WHERE cohort_id = '7f4e0a67-ccef-498c-80f5-1e5c7c681bd1'
--   AND cohort_school_rotation_id IS NULL;
-- Expected: 0 (all Summer 2026 students linked)
