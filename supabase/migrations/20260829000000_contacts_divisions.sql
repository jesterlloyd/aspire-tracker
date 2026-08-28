-- ############################################################################
-- NA-CONTACTS-SCOPE-4: give contacts an explicit divisions list
--
-- Owner-gated. NOT auto-applied by this branch. Deploy the code FIRST: the
-- endpoints probe for this column and fail closed (503 divisions_unavailable)
-- on a write that needs it, exactly as they already do for contacts.services,
-- so the app behaves correctly before and after this runs.
--
-- WHY: a Nursing Executive's division is currently INFERRED from the free-text
-- Services line ("Critical Care Services" -> Critical Care). That inference
-- cannot find an executive whose remit is not named after a division: Claude
-- Stang is Executive Director for Clinical Operations and covers Emergency,
-- and his card should keep saying "Clinical Operations". This column stores
-- the answer instead of guessing it. The Services text and the unit-based
-- match both remain as fallbacks, so nothing that resolves today stops.
--
-- SAFETY:
--   * Additive only. One nullable column with a default of '{}'; no existing
--     column, row, constraint, policy, index, or trigger is touched.
--   * No backfill. Every existing contact keeps resolving through the unchanged
--     unit and Services-text rules until someone sets divisions by hand.
--   * Idempotent: IF NOT EXISTS, safe to re-run.
--   * Division NAMES are validated in application code against the unit
--     catalog (src/lib/unitCatalog.js), the same place unit names are
--     validated. Deliberately no CHECK constraint here: the catalog is code,
--     and a SQL enum would be a second source of truth that silently drifts
--     (this is why the unit columns have no CHECK either).
-- ############################################################################

BEGIN;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS divisions text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.contacts.divisions IS
  'Catalog divisions this contact covers (Nursing Executive + Executive Director). '
  'Validated in application code against src/lib/unitCatalog.js DIVISION_ORDER. '
  'Explicit answer for the Contacts division filter; contacts.services stays free text.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'divisions'
  ) THEN
    RAISE EXCEPTION 'contacts.divisions was not created';
  END IF;
END $$;

COMMIT;

-- ── Verification (run AFTER the commit; each should return the noted shape) ──
--
-- V1  the column exists, is a text array, defaults to empty, and is NOT NULL:
--     SELECT column_name, data_type, is_nullable, column_default
--       FROM information_schema.columns
--      WHERE table_schema='public' AND table_name='contacts' AND column_name='divisions';
--     -> divisions | ARRAY | NO | '{}'::text[]
--
-- V2  every existing row got the empty default, none are NULL:
--     SELECT count(*) AS total,
--            count(*) FILTER (WHERE divisions IS NULL)        AS nulls,
--            count(*) FILTER (WHERE cardinality(divisions)>0) AS with_divisions
--       FROM public.contacts;
--     -> total = your contact count, nulls = 0, with_divisions = 0
--
-- ── Rollback ────────────────────────────────────────────────────────────────
--     BEGIN;
--     ALTER TABLE public.contacts DROP COLUMN IF EXISTS divisions;
--     COMMIT;
--   Safe: the column is additive and nothing reads it when absent (the
--   endpoints' readiness probe returns false and strips it from writes).
