-- ============================================================================
-- One accepting cohort: PRE-APPLY and POST-APPLY queries
-- ============================================================================
-- Every section here is READ ONLY except POST 3, which is clearly marked and
-- ends in ROLLBACK. Nothing exposes a secret. Cohort names are not PII.
--
-- Run the PRE-APPLY section BEFORE applying
-- supabase/migrations/20260902000000_one_accepting_cohort.sql, and the
-- POST-APPLY section after.
--
-- RUN EACH NUMBERED SECTION SEPARATELY. The Supabase SQL Editor returns only
-- one result set when several SELECT statements are submitted together. The
-- migration itself is the opposite: one transaction, run as ONE complete block.
--
-- PRE 1 IS A STOP CONDITION. The migration cannot succeed while two cohorts are
-- accepting, and it should not: choosing which one keeps the flag is an
-- operational decision, not something a migration may make silently.
-- ============================================================================


-- ############################################################################
-- PRE-APPLY (run BEFORE the migration)
-- ############################################################################

-- ── PRE 1: how many cohorts are accepting right now ────────────────────────
-- EXPECTED: exactly one row, or zero.
--
-- If this returns TWO OR MORE ROWS, STOP. Do not apply the migration yet. The
-- browser rule has already been bypassed at some point, and the public forms
-- are currently routing ambiguously. Decide which cohort should keep the flag,
-- clear it on the others through the Edit Cohort modal (not by hand, so the
-- application cache stays in step), re-run this section until it returns one
-- row, and only then apply.
--
-- If this returns ZERO rows, that is fine: the index applies cleanly and simply
-- has nothing to constrain yet. It does mean every public form is currently
-- closed, which is worth confirming is intended before you continue. Run alone.
SELECT
  id,
  name,
  status,
  accepting_submissions,
  created_at
FROM public.cohorts
WHERE accepting_submissions = true
ORDER BY created_at DESC;

-- ── PRE 2: the index does not already exist ────────────────────────────────
-- EXPECTED: zero rows. The migration uses IF NOT EXISTS, so an index that is
-- already present would be silently accepted without its definition being
-- checked. If this returns a row, read its indexdef and confirm it matches the
-- migration before deciding whether the migration is still needed. Run alone.
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'cohorts'
  AND indexname = 'cohorts_one_accepting_submissions';

-- ── PRE 3: the full cohort picture, for context ────────────────────────────
-- Not a gate. This is the list the Edit Cohort modal is acting on, so it is
-- worth capturing before a constraint is placed over it: it shows whether any
-- Archived or Completed cohort is still holding the flag, which is a state the
-- application can produce today and which would keep every public form pointed
-- at a finished cohort. Run alone.
SELECT
  name,
  status,
  accepting_submissions,
  start_date,
  end_date
FROM public.cohorts
ORDER BY created_at DESC;


-- ############################################################################
-- POST-APPLY (run AFTER the migration)
-- ############################################################################

-- ── POST 1: the index exists, and is unique AND partial ────────────────────
-- PASS: exactly one row, and its indexdef contains BOTH "CREATE UNIQUE INDEX"
-- and "WHERE (accepting_submissions = true)".
--
-- Both halves matter. Without UNIQUE it constrains nothing. Without the partial
-- WHERE clause it would constrain the `false` rows too, which would permit only
-- one non-accepting cohort in the entire table and would break every ordinary
-- cohort edit. Read the definition, do not just count the row. Run alone.
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'cohorts'
  AND indexname = 'cohorts_one_accepting_submissions';

-- ── POST 2: the live state still satisfies the invariant ───────────────────
-- PASS: accepting_count is 0 or 1. Anything higher is impossible once the index
-- exists, so a value above 1 here would mean the index was not actually created
-- and POST 1 was misread. Run alone.
SELECT count(*) AS accepting_count
FROM public.cohorts
WHERE accepting_submissions = true;

-- ── POST 3: OPTIONAL. Prove the constraint actually bites ──────────────────
-- THIS IS THE ONLY SECTION ON THIS PAGE THAT WRITES. It attempts a second
-- accepting cohort and then throws the attempt away.
--
-- PASTE AND RUN THIS SECTION WHOLE, from BEGIN to ROLLBACK. Do not run the
-- UPDATE on its own. If the editor is interrupted between the two, run
-- `ROLLBACK;` by itself before doing anything else.
--
-- PASS: the UPDATE fails with
--   ERROR: duplicate key value violates unique constraint
--          "cohorts_one_accepting_submissions"
-- An error here is the SUCCESS case. The ROLLBACK then discards everything
-- either way, so no row is changed whatever happens.
--
-- Skip this section entirely if you would rather not issue a write against
-- production. POST 1 and POST 2 are sufficient to confirm the migration
-- applied; this one confirms it enforces.
/*
BEGIN;
UPDATE public.cohorts
   SET accepting_submissions = true
 WHERE accepting_submissions = false;
ROLLBACK;
*/

-- ── POST 4: nothing else on cohorts was disturbed ──────────────────────────
-- PASS: the same rows, statuses, and flag values as PRE 3. The migration
-- creates an index and writes no row, so this must be byte-identical. A
-- difference means something other than this migration ran. Run alone.
SELECT
  name,
  status,
  accepting_submissions,
  start_date,
  end_date
FROM public.cohorts
ORDER BY created_at DESC;


-- ############################################################################
-- FOLLOW-UP, NOT PART OF THIS MIGRATION
-- ############################################################################
-- This index closes the "two accepting cohorts" state. It does NOT decide
-- WHICH surfaces should follow the flag at all. Two things remain open and are
-- deliberately not bundled here:
--
--   1. Unit Leader Portal hosting and roster (api/portal/unit-participation-
--      submit.js, api/portal/unit-roster.js) currently resolve their cohort
--      from this flag. The agreed direction is for them to read the signed-in
--      leader's own scope instead, so unit hosting no longer depends on which
--      cohort is recruiting. The public unit form stays flag-routed.
--
--   2. The Edit Cohort checkbox copy describes only "unit and school
--      coordinator form submissions". The flag also stops student intake,
--      student file uploads, and student interview self-scheduling. The copy
--      should be corrected once item 1 has settled what the flag covers.
--
-- Neither is a database change.
