-- ############################################################################
-- Correct the stored division for units 6 NE and 6 NW to 'Critical Care'
--
-- Owner-gated. NOT auto-applied by this branch. Per the Unit Specialty Resource Chart (page 3,
-- "Directory of Critical Care Division 2022", dated 2022-12-01), 6 NE and 6 NW belong to the Critical
-- Care Division. Some surfaces read the stored public.units.division column first, so if that column
-- holds 'Medical' (or NULL/empty) for these units, they display under Medical. The application code
-- fix (src/lib/unitCatalog.js) corrects the catalog-derived surfaces; THIS migration corrects the
-- stored column for the DB-first surfaces.
--
-- SAFETY:
--   * Data-only. Touches ONLY the `division` column, ONLY for the exact target unit names.
--   * No row is created or deleted; unit `id`s are stable; assignments, placements, preceptors,
--     capacity/slots, patient_population, cohort_id, and all scope/RLS/grants are untouched.
--   * Division is descriptive only and never gates authorization (scope keys on unit_name + cohort),
--     so this changes no one's access.
--   * Idempotent: a row already 'Critical Care' is left untouched (safe to re-run).
--   * Preflight fails closed if ZERO target rows exist (wrong unit names -> investigate first) and logs
--     every targeted row with its CURRENT division so the prior values are captured before the update.
--   * public.units is per-cohort, so multiple rows per unit name are expected and all are corrected.
--   * Exact-name matching only (no LIKE / free-text). '6 NE' / '6 NW' are canonical; the compact
--     '6NE' / '6NW' variants are included defensively for any legacy rows.
-- ############################################################################

BEGIN;

DO $$
DECLARE
  v_target text[] := ARRAY['6 NE', '6 NW', '6NE', '6NW'];
  v_matched integer;
  r record;
BEGIN
  -- Preflight visibility: log every targeted row and its CURRENT division (this is the record to use
  -- for rollback). Per-cohort rows are expected.
  FOR r IN
    SELECT id, unit_name, cohort_id, division
    FROM public.units
    WHERE unit_name = ANY (v_target)
    ORDER BY unit_name, cohort_id
  LOOP
    RAISE NOTICE '6NE/6NW preflight: id=% unit_name=% cohort=% current_division=%',
      r.id, r.unit_name, r.cohort_id, coalesce(r.division, '(null)');
  END LOOP;

  SELECT count(*) INTO v_matched FROM public.units WHERE unit_name = ANY (v_target);

  -- Fail closed if the canonical unit names are not present (wrong target). Abort with no changes.
  IF v_matched = 0 THEN
    RAISE EXCEPTION
      'No units matched % - expected at least one 6 NE / 6 NW row. Aborting with no changes.', v_target;
  END IF;

  RAISE NOTICE '6NE/6NW preflight: % matching row(s); rows not already Critical Care will be corrected.', v_matched;
END $$;

-- Correct ONLY the division field, ONLY for the exact target names, ONLY where not already correct.
UPDATE public.units
  SET division = 'Critical Care'
  WHERE unit_name IN ('6 NE', '6 NW', '6NE', '6NW')
    AND division IS DISTINCT FROM 'Critical Care';

COMMIT;

-- ############################################################################
-- Verification (run AFTER applying; OUTSIDE the transaction)
-- ############################################################################
--   SELECT unit_name, cohort_id, division
--   FROM public.units
--   WHERE unit_name IN ('6 NE', '6 NW', '6NE', '6NW')
--   ORDER BY unit_name, cohort_id;
--   -- Expect division = 'Critical Care' for every row.
--
--   -- Confirm no other unit was affected (spot check a Medical unit remains Medical):
--   SELECT unit_name, division FROM public.units WHERE unit_name IN ('5 South', '6 South');

-- ############################################################################
-- Rollback considerations
-- ############################################################################
-- Data-only and reversible. The preflight NOTICEs above captured each row's prior division (most
-- likely 'Medical' or NULL/empty). To revert a specific row, restore that value by id, e.g.:
--   UPDATE public.units SET division = '<prior value from preflight>' WHERE id = '<row id>';
-- No schema, RLS, grant, trigger, or non-division column is changed by this migration, so there is
-- nothing else to roll back.
