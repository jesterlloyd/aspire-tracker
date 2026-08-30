-- ============================================================================
-- NGRP legacy reconciliation preflight - READ-ONLY
-- ============================================================================
-- Run each numbered section separately in the Supabase SQL Editor and file
-- the output with the NGRP-WORKSPACE-1 handoff. NOTHING here writes.
--
-- Purpose: the repository carries legacy NGRP signals - a legacy
-- ngrp_outcomes table (if present) and the student-level fields
-- students.ngrp_cohort_target / students.ngrp_outcome. The corrected NGRP
-- foundation deliberately does NOT trust, migrate, overwrite, or delete any
-- of them. Before any historical rows are mapped into the cycle-centered
-- tables (ngrp_candidates / ngrp_residency_outcomes), Jester reviews this
-- snapshot and decides, row-family by row-family, what is trustworthy.
-- Until that explicit decision, the new tables start empty and the roster's
-- prior-hire exclusion simply has no legacy rows to act on.

-- ── L1. Does a legacy ngrp_outcomes table exist, and what is its shape? ─────
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'ngrp_outcomes'
ORDER BY ordinal_position;
-- (No rows = the table does not exist in this database; note that and skip L2-L3.)

-- ── L2. Legacy table volume and constraint/policy posture ───────────────────
SELECT
  (SELECT count(*) FROM public.ngrp_outcomes)                              AS row_count,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'ngrp_outcomes')    AS rls_enabled,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'ngrp_outcomes')     AS policy_count;

-- ── L3. Legacy table distinct values (adjust column names to L1's output) ───
-- SELECT <status-ish column>, count(*) FROM public.ngrp_outcomes
-- GROUP BY 1 ORDER BY count(*) DESC;

-- ── L4. Student-level legacy fields: volume ─────────────────────────────────
SELECT
  count(*)                                                                  AS students_total,
  count(*) FILTER (WHERE ngrp_cohort_target IS NOT NULL
                     AND btrim(ngrp_cohort_target) <> '')                   AS with_cohort_target,
  count(*) FILTER (WHERE ngrp_outcome IS NOT NULL
                     AND btrim(ngrp_outcome) <> '')                         AS with_outcome
FROM public.students;

-- ── L5. Student-level legacy fields: distinct values ────────────────────────
SELECT ngrp_outcome, count(*) FROM public.students
WHERE ngrp_outcome IS NOT NULL AND btrim(ngrp_outcome) <> ''
GROUP BY 1 ORDER BY count(*) DESC;

SELECT ngrp_cohort_target, count(*) FROM public.students
WHERE ngrp_cohort_target IS NOT NULL AND btrim(ngrp_cohort_target) <> ''
GROUP BY 1 ORDER BY count(*) DESC;

-- ── L6. Potential prior-hire candidates hiding in legacy data ───────────────
-- Students whose legacy outcome claims a hire. These are the rows a future,
-- explicitly-approved mapping would consider for ngrp_residency_outcomes;
-- the roster exclusion ignores them until then.
SELECT id, aspire_cohort, status, ngrp_cohort_target, ngrp_outcome
FROM public.students
WHERE ngrp_outcome ILIKE '%hire%'
ORDER BY aspire_cohort, last_name;

-- ── L7. Conflicts: completed alumni with contradictory legacy signals ───────
-- (e.g. an outcome recorded on a student who never completed ASPIRE)
SELECT status, ngrp_outcome, count(*)
FROM public.students
WHERE ngrp_outcome IS NOT NULL AND btrim(ngrp_outcome) <> ''
GROUP BY 1, 2
ORDER BY 1, 2;
