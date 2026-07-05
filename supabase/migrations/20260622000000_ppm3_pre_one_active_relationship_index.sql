-- =============================================================================
-- One active assignment per student/cohort/preceptor  (PRECEPTOR-MODEL-3-pre, Part A)
-- Migration: 20260622000000_ppm3_pre_one_active_relationship_index
-- =============================================================================
--
-- Adds a RELATIONSHIP-LEVEL partial unique index to student_preceptor_assignments enforcing AT MOST
-- ONE ACTIVE assignment per (student_id, cohort_id, preceptor_id) regardless of role. This backs the
-- PRECEPTOR-MODEL-3 "additional/coverage preceptor" flow:
--   • a preceptor cannot be active in two roles (e.g. primary AND coverage) for the same student/cohort;
--   • re-adding the CURRENT PRIMARY as secondary/coverage is structurally DB-rejected, because the
--     Phase-1 backfill already created an active row for that (student, cohort, preceptor);
--   • a role change must END/REMOVE the old active row first, THEN create a new active one;
--   • the SAME preceptor may still be active for DIFFERENT students, and for the same student in a
--     DIFFERENT cohort (cohort_id is part of the key).
--
-- COEXISTS WITH the Phase-1 index uq_spa_one_active_primary_per_student_cohort (one active PRIMARY per
-- student/cohort). The two are complementary, not duplicative: Phase-1 constrains the active PRIMARY
-- slot; this one constrains the active RELATIONSHIP per preceptor. Both remain in place.
--
-- ADDITIVE / ISOLATED: one new index. No table, column, RLS, policy, or data change. NOTHING is
-- written. students.preceptor_id stays authoritative for primary; survey routing, evaluation_assignments,
-- responses, and all current workflows are untouched.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute. Claude Code applies NOTHING - the Owner
-- runs the PRE-APPLY NO-CONFLICT check (must return 0 rows), applies, runs VERIFICATION, confirms, THEN
-- authorizes the Part B app-code commit.
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS.
-- =============================================================================

-- ── PRE-APPLY NO-CONFLICT CHECK (Owner runs FIRST - must return ZERO rows) ───────
-- Confirms no student/cohort/preceptor already has more than one ACTIVE row, so the new unique index
-- can be built without conflict. Post-Phase-1 each student has exactly one active (primary) row, so
-- this is expected to be empty. If it returns ANY row, STOP and report - do not apply.
--   SELECT student_id, cohort_id, preceptor_id, count(*) AS active_rows
--   FROM student_preceptor_assignments
--   WHERE status = 'active'
--   GROUP BY student_id, cohort_id, preceptor_id
--   HAVING count(*) > 1;                                                  -- expect 0 rows

-- ── Index ────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_spa_one_active_relationship_per_student_cohort_preceptor
  ON student_preceptor_assignments (student_id, cohort_id, preceptor_id)
  WHERE status = 'active';

-- ── Reload schema cache ──────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- VERIFICATION (Owner runs after applying - NOT part of the migration)
-- =============================================================================
--   -- 1. Both partial unique indexes exist (Phase-1 primary + this relationship index):
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE schemaname='public' AND tablename='student_preceptor_assignments'
--     AND indexname IN ('uq_spa_one_active_primary_per_student_cohort',
--                       'uq_spa_one_active_relationship_per_student_cohort_preceptor')
--   ORDER BY indexname;
--   -- expect BOTH rows; this one's indexdef must include
--   --   "(student_id, cohort_id, preceptor_id) WHERE (status = 'active'::text)"
--
--   -- 2. No-conflict re-confirm (same as pre-apply; the index would have failed to build otherwise):
--   SELECT student_id, cohort_id, preceptor_id, count(*)
--   FROM student_preceptor_assignments WHERE status='active'
--   GROUP BY 1,2,3 HAVING count(*) > 1;                                   -- expect 0 rows
--
--   -- 3. RELATIONSHIP DEDUP rejection - a SECOND active row for an existing (student, cohort,
--   --    preceptor), ANY role, must be rejected. Run inside a transaction and ROLL BACK. (This
--   --    reuses an existing active row's identity, e.g. a backfilled primary, and tries to add it
--   --    again as 'coverage' - exactly the "re-add the primary as coverage" case.)
--   BEGIN;
--     INSERT INTO student_preceptor_assignments (student_id, preceptor_id, cohort_id, role, status)
--     SELECT student_id, preceptor_id, cohort_id, 'coverage', 'active'
--     FROM student_preceptor_assignments
--     WHERE status='active'
--     LIMIT 1;
--   ROLLBACK;
--   -- EXPECT: ERROR  duplicate key value violates unique constraint
--   --         "uq_spa_one_active_relationship_per_student_cohort_preceptor".  (ROLLBACK discards it.)
--
--   -- 4. Allowed cases still work (verify by reasoning, no write needed):
--   --    • same preceptor, DIFFERENT student  -> different (student_id,...) tuple  -> allowed
--   --    • same preceptor+student, DIFFERENT cohort -> different cohort_id tuple    -> allowed
--   --    • re-add after the old row is ended/removed (status<>'active') -> not in the partial index -> allowed
-- =============================================================================
-- ROLLBACK (fully additive/reversible; the Phase-1 active-primary index and all data are untouched):
--   DROP INDEX IF EXISTS uq_spa_one_active_relationship_per_student_cohort_preceptor;
--   NOTIFY pgrst, 'reload schema';
-- =============================================================================
