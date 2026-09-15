-- ============================================================================
-- RESIDENTS-1: resident details on the hire record
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester). Claude Code has applied NOTHING. ***
--
-- Owner decisions, 2026-09-14. Residency > Residents lists every hired new grad
-- (unit, shift, hire date, position/title, preceptor, email and phone) and
-- whether they are still at Cedars-Sinai, per cohort or across all cohorts.
--
-- Unit, shift, hire date, Cedars-Sinai email and the separation (separated_at,
-- separation_reason) already live on ngrp_residency_outcomes. Three facts do not:
--   1. position_title - the current position (RN Resident, Clinical Nurse I, II,
--      III, or a typed title). The list lives in src/lib/ngrp/ngrpResidents.js;
--      the column accepts any nonblank title so "Other" never needs SQL.
--   2. preceptor_name - a TYPED override. Without it the page shows the
--      preceptor names the resident gave in their first bi-weekly reflection.
--   3. phone - a TYPED override. Without it the page shows the preferred phone
--      from their Transition Form.
--
-- Additive and transactional; nullable columns; no data rewrite. Safe in either
-- deploy order: before it is applied the Residents table loads without these
-- three columns and the edit form says the details are not available yet.
--
-- PREFLIGHT / POSTFLIGHT: db/audit/ngrp_resident_details_checks.sql

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.ngrp_residency_outcomes') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: ngrp_residency_outcomes is missing';
  END IF;
END
$pre$;

ALTER TABLE public.ngrp_residency_outcomes
  ADD COLUMN IF NOT EXISTS position_title text
    CHECK (position_title IS NULL OR (btrim(position_title) <> '' AND char_length(position_title) <= 120)),
  ADD COLUMN IF NOT EXISTS preceptor_name text
    CHECK (preceptor_name IS NULL OR (btrim(preceptor_name) <> '' AND char_length(preceptor_name) <= 200)),
  ADD COLUMN IF NOT EXISTS phone text
    CHECK (phone IS NULL OR (btrim(phone) <> '' AND char_length(phone) <= 40));

COMMENT ON COLUMN public.ngrp_residency_outcomes.position_title IS
  'RESIDENTS-1: the resident''s current position or title, set on Residency > Residents.';
COMMENT ON COLUMN public.ngrp_residency_outcomes.preceptor_name IS
  'RESIDENTS-1: typed preceptor override; when null the page shows the names from the first reflection.';
COMMENT ON COLUMN public.ngrp_residency_outcomes.phone IS
  'RESIDENTS-1: typed phone override; when null the page shows the Transition Form preferred phone.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── ROLLBACK (only while the three columns are still empty) ──────────────────
-- BEGIN;
--   ALTER TABLE public.ngrp_residency_outcomes
--     DROP COLUMN IF EXISTS position_title,
--     DROP COLUMN IF EXISTS preceptor_name,
--     DROP COLUMN IF EXISTS phone;
--   NOTIFY pgrst, 'reload schema';
-- COMMIT;
