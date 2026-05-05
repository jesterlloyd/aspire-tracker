-- COHORT ISOLATION GUARD MIGRATION
--
-- STEP 1: Run the CHECK queries below first.
-- If any SELECT returns rows, fix those records before proceeding.
-- Only run STEP 2 (the ALTER TABLE statements) after all checks return 0 rows.
--
-- ================================================================

-- ── STEP 1: Safety checks ────────────────────────────────────────

-- Run each of these and verify they return 0 rows before continuing:
SELECT id, name        FROM students  WHERE cohort_id IS NULL;
SELECT id, unit_name   FROM units     WHERE cohort_id IS NULL;
SELECT id              FROM matches   WHERE cohort_id IS NULL;
SELECT id              FROM interviews WHERE cohort_id IS NULL;

-- ── STEP 2: Add NOT NULL constraints ─────────────────────────────
-- Only run after confirming all checks above return 0 rows.

ALTER TABLE students   ALTER COLUMN cohort_id SET NOT NULL;
ALTER TABLE units      ALTER COLUMN cohort_id SET NOT NULL;
ALTER TABLE matches    ALTER COLUMN cohort_id SET NOT NULL;
ALTER TABLE interviews ALTER COLUMN cohort_id SET NOT NULL;
