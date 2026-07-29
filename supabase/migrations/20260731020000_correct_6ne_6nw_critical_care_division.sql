-- ############################################################################
-- Correct the stored division for units 6 NE and 6 NW to 'Critical Care' (hardened, exact-row)
--
-- Owner-gated. NOT auto-applied by this branch. Per the Unit Specialty Resource Chart (page 3,
-- "Directory of Critical Care Division 2022", dated 2022-12-01), 6 NE and 6 NW belong to the Critical
-- Care Division. The Owner ran read-only queries and confirmed EXACTLY four canonical rows: two are
-- already 'Critical Care', and two (in cohort eedd91ec-...) have a blank/NULL division. This migration
-- proves that exact four-row shape, then corrects ONLY the two blank rows by id.
--
-- SAFETY:
--   * Data-only. Touches ONLY the `division` column, ONLY for the two verified target ids, ONLY when
--     that row's division is currently NULL or blank/whitespace.
--   * No row is created or deleted; unit ids, unit names, cohort ids, patient_population, assignments,
--     placements, preceptors, capacity/slots, shifts, evaluations, portal scopes, and authorization
--     are all untouched. Division is descriptive only and never gates access.
--   * Idempotent: a target row already 'Critical Care' is left untouched (safe to re-run).
--   * Fails closed on ANY deviation from the verified four-row shape (see preflight assertions).
-- ############################################################################

BEGIN;

DO $$
DECLARE
  -- Verified production rows (Owner read-only confirmation).
  id_ne_ok   uuid := 'f1f60b44-6958-4ccb-913a-939482134a61';  -- 6 NE, cohort_ok,  already Critical Care
  id_nw_ok   uuid := '56a2f3e5-86ca-41e2-a836-993788e1dcd6';  -- 6 NW, cohort_ok,  already Critical Care
  id_ne_fix  uuid := 'c18b77d8-5863-4681-bc0f-00c35ac8ef8d';  -- 6 NE, cohort_fix, blank/NULL -> correct
  id_nw_fix  uuid := '33d22e71-859d-42fb-b28e-ff68ce4aaebe';  -- 6 NW, cohort_fix, blank/NULL -> correct
  cohort_ok  uuid := '7f4e0a67-ccef-498c-80f5-1e5c7c681bd1';
  cohort_fix uuid := 'eedd91ec-ad6f-4df8-aa20-5c06b2889011';
  v_alias_total integer;
  v_unexpected  integer;
  rec           record;
  v_div         text;
BEGIN
  -- Normalized 6NE/6NW matcher (whitespace-insensitive, case-insensitive). The known canonical/alias
  -- forms are '6 NE', '6 NW', '6NE', '6NW'; normalization also catches odd-whitespace variants.

  -- (1) Exactly four rows with normalized unit name 6NE or 6NW.
  SELECT count(*) INTO v_alias_total
  FROM public.units
  WHERE regexp_replace(upper(coalesce(unit_name, '')), '\s+', '', 'g') IN ('6NE', '6NW');
  IF v_alias_total <> 4 THEN
    RAISE EXCEPTION 'Expected exactly 4 normalized 6NE/6NW rows, found %. Aborting with no changes.', v_alias_total;
  END IF;

  -- (7) No additional 6NE/6NW alias rows beyond the four verified ids.
  SELECT count(*) INTO v_unexpected
  FROM public.units
  WHERE regexp_replace(upper(coalesce(unit_name, '')), '\s+', '', 'g') IN ('6NE', '6NW')
    AND id NOT IN (id_ne_ok, id_nw_ok, id_ne_fix, id_nw_fix);
  IF v_unexpected <> 0 THEN
    RAISE EXCEPTION 'Found % unexpected 6NE/6NW alias row(s) beyond the four verified ids. Aborting.', v_unexpected;
  END IF;

  -- (2)&(3) Each exact id exists with the expected unit_name AND cohort_id.
  PERFORM 1 FROM public.units WHERE id = id_ne_ok  AND unit_name = '6 NE' AND cohort_id = cohort_ok;
  IF NOT FOUND THEN RAISE EXCEPTION 'Row % is missing or has an unexpected unit_name/cohort (expected 6 NE / %).', id_ne_ok, cohort_ok; END IF;
  PERFORM 1 FROM public.units WHERE id = id_nw_ok  AND unit_name = '6 NW' AND cohort_id = cohort_ok;
  IF NOT FOUND THEN RAISE EXCEPTION 'Row % is missing or has an unexpected unit_name/cohort (expected 6 NW / %).', id_nw_ok, cohort_ok; END IF;
  PERFORM 1 FROM public.units WHERE id = id_ne_fix AND unit_name = '6 NE' AND cohort_id = cohort_fix;
  IF NOT FOUND THEN RAISE EXCEPTION 'Row % is missing or has an unexpected unit_name/cohort (expected 6 NE / %).', id_ne_fix, cohort_fix; END IF;
  PERFORM 1 FROM public.units WHERE id = id_nw_fix AND unit_name = '6 NW' AND cohort_id = cohort_fix;
  IF NOT FOUND THEN RAISE EXCEPTION 'Row % is missing or has an unexpected unit_name/cohort (expected 6 NW / %).', id_nw_fix, cohort_fix; END IF;

  -- (4) The two already-correct rows are Critical Care.
  IF (SELECT division FROM public.units WHERE id = id_ne_ok) IS DISTINCT FROM 'Critical Care'
     OR (SELECT division FROM public.units WHERE id = id_nw_ok) IS DISTINCT FROM 'Critical Care' THEN
    RAISE EXCEPTION 'An already-correct row (% or %) is no longer Critical Care. Aborting.', id_ne_ok, id_nw_ok;
  END IF;

  -- (5)&(6) Each target row is NULL, blank/whitespace, or already Critical Care (idempotent re-run).
  -- Any other nonblank division aborts.
  FOR rec IN SELECT id, division FROM public.units WHERE id IN (id_ne_fix, id_nw_fix) LOOP
    v_div := rec.division;
    IF v_div IS NOT NULL AND btrim(v_div) <> '' AND v_div <> 'Critical Care' THEN
      RAISE EXCEPTION 'Target row % has unexpected division "%"; expected NULL/blank or Critical Care. Aborting.', rec.id, v_div;
    END IF;
  END LOOP;

  RAISE NOTICE 'Hardened 6NE/6NW preflight passed: four-row shape verified; correcting the two blank target rows.';
END $$;

-- Correct ONLY the two verified target rows, ONLY the division field, ONLY when NULL or blank/whitespace.
UPDATE public.units
  SET division = 'Critical Care'
  WHERE id IN ('c18b77d8-5863-4681-bc0f-00c35ac8ef8d', '33d22e71-859d-42fb-b28e-ff68ce4aaebe')
    AND (division IS NULL OR btrim(division) = '');

COMMIT;

-- ############################################################################
-- Verification (run AFTER applying; OUTSIDE the transaction)
-- ############################################################################
--   -- All four exact rows now Critical Care, patient_population unchanged:
--   SELECT id, unit_name, cohort_id, division, patient_population
--   FROM public.units
--   WHERE id IN ('f1f60b44-6958-4ccb-913a-939482134a61',
--                '56a2f3e5-86ca-41e2-a836-993788e1dcd6',
--                'c18b77d8-5863-4681-bc0f-00c35ac8ef8d',
--                '33d22e71-859d-42fb-b28e-ff68ce4aaebe')
--   ORDER BY unit_name, cohort_id;
--   -- Expect division = 'Critical Care' for all four; patient_population as before.
--
--   -- Normalized 6NE/6NW count is still exactly four (no duplicate aliases introduced):
--   SELECT count(*) AS normalized_6ne_6nw
--   FROM public.units
--   WHERE regexp_replace(upper(coalesce(unit_name, '')), '\s+', '', 'g') IN ('6NE', '6NW');
--   -- Expect 4.

-- ############################################################################
-- Rollback (NARROW, data-DESTRUCTIVE with respect to the corrected classification)
-- ############################################################################
-- Restores ONLY the two corrected rows to NULL, discarding the Critical Care classification for them.
-- Use deliberately and only if the correction must be reverted:
--   UPDATE public.units SET division = NULL
--   WHERE id IN ('c18b77d8-5863-4681-bc0f-00c35ac8ef8d', '33d22e71-859d-42fb-b28e-ff68ce4aaebe');
-- No schema, RLS, grant, trigger, or non-division column is changed by this migration.
