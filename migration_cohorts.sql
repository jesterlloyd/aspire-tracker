-- =====================================================================
-- ASPIRE Placement Tracker — Cohort Management Migration
-- Run this entire file in your Supabase SQL Editor
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. Create cohorts table
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cohorts (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  status     TEXT DEFAULT 'Active',      -- Active | Completed | Archived
  start_date TEXT DEFAULT '',
  end_date   TEXT DEFAULT '',
  notes      TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE cohorts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON cohorts;
CREATE POLICY "anon_all" ON cohorts FOR ALL TO anon USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Add shift_assigned to students (Part 5 cross-tab sync)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE students ADD COLUMN IF NOT EXISTS shift_assigned TEXT DEFAULT '';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Add cohort_id foreign key to students, units, matches
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE students ADD COLUMN IF NOT EXISTS cohort_id UUID REFERENCES cohorts(id) ON DELETE SET NULL;
ALTER TABLE units    ADD COLUMN IF NOT EXISTS cohort_id UUID REFERENCES cohorts(id) ON DELETE SET NULL;
ALTER TABLE matches  ADD COLUMN IF NOT EXISTS cohort_id UUID REFERENCES cohorts(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Seed Summer 2026 cohort and link all existing data to it
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  summer_id UUID;
BEGIN
  -- Insert cohort (safe: only runs if name does not exist)
  IF NOT EXISTS (SELECT 1 FROM cohorts WHERE name = 'Summer 2026') THEN
    INSERT INTO cohorts (name, status, start_date, end_date)
    VALUES ('Summer 2026', 'Active', 'June 1, 2026', 'August 18, 2026')
    RETURNING id INTO summer_id;
  ELSE
    SELECT id INTO summer_id FROM cohorts WHERE name = 'Summer 2026' LIMIT 1;
  END IF;

  -- Link all existing records that have no cohort
  UPDATE students SET cohort_id = summer_id WHERE cohort_id IS NULL;
  UPDATE units    SET cohort_id = summer_id WHERE cohort_id IS NULL;
  UPDATE matches  SET cohort_id = summer_id WHERE cohort_id IS NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Data integrity: prevent records without cohort_id (Part 6)
--    Run AFTER the UPDATE above has populated all existing rows.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE students ALTER COLUMN cohort_id SET NOT NULL;
ALTER TABLE units    ALTER COLUMN cohort_id SET NOT NULL;
ALTER TABLE matches  ALTER COLUMN cohort_id SET NOT NULL;
