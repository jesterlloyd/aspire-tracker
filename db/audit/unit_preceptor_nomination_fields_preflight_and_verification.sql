-- ============================================================================
-- PREFLIGHT + VERIFICATION for
--   supabase/migrations/20260721000000_unit_preceptor_nomination_fields.sql
-- ============================================================================
-- Run each PREFLIGHT block separately BEFORE applying the migration and review the
-- results. Run each VERIFICATION block separately AFTER applying it. Every query here
-- is READ ONLY. Nothing in this file mutates data.
-- ============================================================================


-- ############################################################################
-- PREFLIGHT
-- ############################################################################

-- P1. Confirm the current NOT NULL state we intend to relax. Expect student_id and
--     cohort_id to be NOT NULL (is_nullable = 'NO'), unit_key NOT NULL, and expect the
--     three new columns to be ABSENT.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'unit_preceptor_nominations'
  AND column_name IN ('student_id', 'cohort_id', 'unit_key',
                      'proposed_name', 'proposed_email', 'proposed_phone', 'proposed_shift')
ORDER BY column_name;

-- P2. Confirm the shift constraint name is free (expect ZERO rows).
SELECT conname
FROM pg_constraint
WHERE conrelid = 'public.unit_preceptor_nominations'::regclass
  AND conname = 'chk_upn_proposed_shift';

-- P3. Confirm the canonical shift set we are pinning to still matches the Preceptor
--     Directory. Expect the CHECK on preceptors.shift_type to list exactly
--     'Day','Night','Mid','Variable'. If this has changed, update the migration's CHECK
--     to match BEFORE applying.
SELECT pg_get_constraintdef(oid) AS preceptors_shift_check
FROM pg_constraint
WHERE conrelid = 'public.preceptors'::regclass
  AND pg_get_constraintdef(oid) ILIKE '%shift_type%';

-- P4. How many existing nominations will be grandfathered (they have a student and no
--     new fields)? Informational: these rows stay valid and are never rewritten.
SELECT
  count(*)                                            AS total_nominations,
  count(*) FILTER (WHERE student_id IS NULL)          AS already_studentless,
  count(*) FILTER (WHERE status = 'nominated')        AS open_nominations
FROM public.unit_preceptor_nominations;

-- P5. Confirm no view or generated column depends on the NOT NULL of student_id/cohort_id
--     (expect ZERO rows). Dropping NOT NULL is safe regardless, but this surfaces any
--     surprising dependency to review first.
SELECT dependent.relname AS dependent_object, dependent.relkind
FROM pg_depend d
JOIN pg_rewrite r        ON r.oid = d.objid
JOIN pg_class dependent  ON dependent.oid = r.ev_class
JOIN pg_class src        ON src.oid = d.refobjid
WHERE src.relname = 'unit_preceptor_nominations'
  AND dependent.relname <> 'unit_preceptor_nominations';


-- ############################################################################
-- VERIFICATION (run AFTER applying the migration)
-- ############################################################################

-- V1. student_id and cohort_id are now nullable; unit_key stays NOT NULL.
--     Expect student_id = YES, cohort_id = YES, unit_key = NO.
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'unit_preceptor_nominations'
  AND column_name IN ('student_id', 'cohort_id', 'unit_key')
ORDER BY column_name;

-- V2. The three structured columns exist and are nullable (text).
--     Expect three rows: proposed_email, proposed_phone, proposed_shift, all YES.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'unit_preceptor_nominations'
  AND column_name IN ('proposed_email', 'proposed_phone', 'proposed_shift')
ORDER BY column_name;

-- V3. The shift CHECK exists and pins exactly the canonical directory set.
SELECT pg_get_constraintdef(oid) AS proposed_shift_check
FROM pg_constraint
WHERE conrelid = 'public.unit_preceptor_nominations'::regclass
  AND conname = 'chk_upn_proposed_shift';

-- V4. Every existing row survived unchanged (no data was rewritten). Compare the count
--     to P4.total_nominations; the new columns are all NULL on pre-existing rows.
SELECT
  count(*)                                          AS total_nominations,
  count(*) FILTER (WHERE proposed_email IS NOT NULL) AS with_email,
  count(*) FILTER (WHERE proposed_shift IS NOT NULL) AS with_shift
FROM public.unit_preceptor_nominations;

-- V5. Attribution and decision constraints are untouched (audit behavior preserved).
--     Expect chk_upn_decision_attribution and chk_upn_identifies_someone both present.
SELECT conname
FROM pg_constraint
WHERE conrelid = 'public.unit_preceptor_nominations'::regclass
  AND conname IN ('chk_upn_decision_attribution', 'chk_upn_identifies_someone',
                  'chk_upn_status', 'chk_upn_note_len', 'chk_upn_unit_key_trimmed')
ORDER BY conname;

-- V6. No write policy was added to the table (server-mediated only, unchanged).
--     Expect ZERO rows with a permissive write policy for anon/authenticated/public.
SELECT polname, polcmd, polroles::regrole[]
FROM pg_policy
WHERE polrelid = 'public.unit_preceptor_nominations'::regclass
  AND polcmd IN ('a', 'w', '*');  -- INSERT, UPDATE, ALL
