-- ============================================================================
-- PRECEPTOR EMAIL UNIQUENESS PREFLIGHT (READ-ONLY)
-- ============================================================================
-- Companion to Phase 2C (20260723000000_preceptor_assignment_authorization.sql). The Unit Leader
-- create-preceptor RPC (create_unit_preceptor) dedups on a NORMALIZED email lower(btrim(email))
-- and relies on a DB unique index to make concurrent duplicate creation impossible. This script
-- verifies that guarantee exists and is currently clean. It is 100% read-only. Run as the service
-- role or an owner/admin.
--
-- EXPECTED (per the repository): a partial, normalized unique index
--   preceptors_email_lower_unique_idx ON public.preceptors (lower(trim(email)))
--   WHERE email IS NOT NULL AND trim(email) <> ''
-- created by the root-level migration_preceptor_schema_v2.sql. That index is NOT re-created inside
-- supabase/migrations/, so this preflight is the way to confirm it is actually live in the target
-- database before enabling Unit Leader preceptor creation.
--
-- NORMALIZATION PARITY: the RPC uses lower(btrim(email)); btrim() is exactly trim(), so the RPC's
-- normalization is identical to the index expression lower(trim(email)). Query Q4 below proves the
-- two agree on the live data (zero divergent rows).
-- ============================================================================


-- Q1. Every index on public.preceptors, with its full definition. Confirm one of them is a UNIQUE
--     index on a normalized email expression. Expect a row named preceptors_email_lower_unique_idx
--     whose indexdef contains "UNIQUE", "lower(trim(email))" (or "lower(btrim(email))"), and the
--     partial WHERE clause.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'preceptors'
ORDER BY indexname;

-- Q2. Machine-checkable existence + shape of the normalized-email uniqueness guarantee. Expect
--     ONE row with is_unique = true, is_partial = true, and normalized_expr = true.
SELECT
  i.relname                                             AS index_name,
  ix.indisunique                                        AS is_unique,
  (ix.indpred IS NOT NULL)                              AS is_partial,
  (pg_get_indexdef(ix.indexrelid) ILIKE '%lower(%trim%(email%')  AS normalized_expr,
  pg_get_indexdef(ix.indexrelid)                        AS definition
FROM pg_index ix
JOIN pg_class i  ON i.oid = ix.indexrelid
JOIN pg_class t  ON t.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' AND t.relname = 'preceptors'
  AND ix.indisunique
  AND pg_get_indexdef(ix.indexrelid) ILIKE '%lower(%trim%(email%';
-- Zero rows here means the normalized-email uniqueness guarantee is ABSENT in this database
-- (see the "if absent" note at the end).

-- Q3. Duplicate normalized-email groups. MUST RETURN ZERO ROWS. Any row is a pre-existing
--     duplicate that both violates the intended guarantee and would have to be resolved before
--     the unique index could be (re)created. Uses the RPC's exact normalization.
SELECT lower(btrim(email)) AS normalized_email,
       count(*)            AS rows,
       array_agg(id ORDER BY created_at) AS preceptor_ids,
       array_agg(full_name ORDER BY created_at) AS names
FROM public.preceptors
WHERE email IS NOT NULL AND btrim(email) <> ''
GROUP BY lower(btrim(email))
HAVING count(*) > 1
ORDER BY rows DESC, normalized_email;

-- Q4. Normalization parity on live data: rows whose stored email is not already in normalized
--     form (i.e. lower(btrim(email)) <> email). Informational only; the index and the RPC both
--     normalize, so these still dedup correctly. A non-zero count just means some legacy rows were
--     stored un-normalized (mixed case / surrounding whitespace).
SELECT count(*) AS non_normalized_rows
FROM public.preceptors
WHERE email IS NOT NULL AND btrim(email) <> '' AND lower(btrim(email)) IS DISTINCT FROM email;

-- Q5. Blank / null email rows. Informational: the partial index intentionally excludes these, so
--     multiple blank-email preceptors are allowed and are NOT duplicates for this guarantee.
SELECT
  count(*) FILTER (WHERE email IS NULL)                          AS null_email_rows,
  count(*) FILTER (WHERE email IS NOT NULL AND btrim(email) = '') AS empty_email_rows
FROM public.preceptors;

-- Q6. Conflicts that would block ADDING the guarantee if it were absent. This is Q3 rolled into a
--     single number for a fast go/no-go read. Expect 0.
SELECT COALESCE(sum(rows) - count(*), 0) AS excess_duplicate_rows
FROM (
  SELECT count(*) AS rows
  FROM public.preceptors
  WHERE email IS NOT NULL AND btrim(email) <> ''
  GROUP BY lower(btrim(email))
  HAVING count(*) > 1
) d;


-- ############################################################################
-- INTERPRETATION
-- ############################################################################
-- PASS (guarantee present and clean): Q2 returns one row; Q3 returns zero rows; Q6 = 0. In this
--   case NO migration is required. Concurrent duplicate creation is already impossible: a second
--   INSERT with the same normalized email hits preceptors_email_lower_unique_idx and raises
--   unique_violation, which create_unit_preceptor maps to MS409. Record the Q1 index definition in
--   the Phase 2C after-verification (block A8 of
--   db/audit/preceptor_assignment_authorization_preflight_and_verification.sql).
--
-- IF ABSENT (Q2 returns zero rows): do NOT auto-merge duplicates. First resolve every Q3 group by
--   a data decision (pick the canonical preceptor per normalized email; repoint
--   student_preceptor_assignments.preceptor_id, students.preceptor_id, matches.preceptor_id, and
--   any evaluation routing to the survivor; soft-deactivate the losers). THEN create the index in
--   a gated migration:
--     CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS preceptors_email_lower_unique_idx
--       ON public.preceptors (lower(trim(email)))
--       WHERE email IS NOT NULL AND trim(email) <> '';
--   (CONCURRENTLY cannot run inside a transaction block; run it as a standalone statement in a
--   maintenance window, after Q3/Q6 are zero.) The expression MUST be lower(trim(email)) to match
--   the create_unit_preceptor RPC's lower(btrim(email)). This script authors NO change because the
--   repository indicates the index already exists; it is provided only for the absent case.
-- ============================================================================
