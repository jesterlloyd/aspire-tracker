-- ============================================================================
-- One accepting cohort at a time, enforced by the database
-- ============================================================================
-- APPLY MANUALLY (Owner/Jester) in the Supabase SQL Editor, as ONE COMPLETE
-- BLOCK. Single transaction. Run the PRE-APPLY section of
-- db/audit/one_accepting_cohort_checks.sql first, one numbered section at a
-- time. PRE 1 IS A STOP CONDITION: if two cohorts are already accepting, this
-- migration will fail (correctly), and the Owner must choose which one keeps
-- the flag before applying.
--
-- WHAT IS WRONG
-- The Edit Cohort modal promises "Only one cohort can be active at a time,
-- enabling here will disable it on any other cohort." That promise is kept
-- entirely in the browser: src/App.jsx updateCohort clears the flag on every
-- other cohort, then sets it on the target. Nothing below the browser enforces
-- it. There is no constraint, no unique index, and no trigger.
--
-- So the invariant breaks whenever the browser is not the only writer:
--   1. a direct edit in the Supabase table editor,
--   2. two staff sessions opening the modal on different cohorts at once,
--   3. the first of those two writes failing while the second succeeds. Until
--      the change that accompanies this migration, updateCohort discarded the
--      result of the clearing write and set the target's flag regardless.
--
-- WHY IT MATTERS MORE THAN A TIDINESS RULE
-- accepting_submissions is not only an open/closed switch. On every anonymous
-- surface it is also the COHORT ROUTER: the server decides which cohort a
-- submission belongs to by finding the single row where this flag is true.
-- That routing was moved server-side deliberately (S-06, S-07) so that a
-- client "can no longer submit into an arbitrary cohort".
--
-- Ten call sites depend on there being exactly one such row, and they do NOT
-- agree on what to do when there are two. api/lib/intakeStudentLookup.js
-- resolveAcceptingCohort refuses with ambiguous_cohort and never picks a row,
-- and the student intake, unit form, and unit portal paths inherit that. But
-- api/interview-lookup.js and api/interview-book.js each used
-- `.limit(1).maybeSingle()`, which silently returns whichever row Postgres
-- happened to order first. In a two-accepting state those two endpoints would
-- have looked a student up in, and booked them into, an arbitrary cohort, with
-- no error raised to the student or to staff. The accompanying code change
-- moves both onto the fail-closed resolver; this index makes the state they
-- were guessing about impossible to reach in the first place.
--
-- WHAT THIS CHANGES FOR A LEGITIMATE USER
-- Nothing. The application already writes in the order this index requires:
-- the flag is cleared everywhere else BEFORE it is set on the target, so the
-- count never transiently exceeds one. Staff who use the modal see no
-- difference. Only the states that were never supposed to exist are refused.
--
-- This migration creates ONE INDEX. It changes no row, no policy, and no
-- function.
-- ============================================================================

BEGIN;

-- Every row in this partial index has accepting_submissions = true, so
-- requiring that value to be unique permits at most one such row in the table.
-- The partial predicate is what keeps the many `false` rows out of the index
-- entirely, so they are unconstrained and unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS cohorts_one_accepting_submissions
  ON public.cohorts (accepting_submissions)
  WHERE accepting_submissions = true;

COMMENT ON INDEX public.cohorts_one_accepting_submissions IS
  'At most one cohort may have accepting_submissions = true. This flag is the '
  'server-side cohort router for every anonymous public form (student intake, '
  'unit form, school form) as well as the AP and Unit Leader portal submission '
  'paths, so a second accepting cohort does not merely open a second form: it '
  'makes the routing ambiguous. Before this index the rule existed only in '
  'src/App.jsx updateCohort. Clear the flag on the current cohort before '
  'setting it on another.';

COMMIT;


-- ── Verification ─────────────────────────────────────────────────────────────
-- See db/audit/one_accepting_cohort_checks.sql, POST-APPLY section. Run each
-- numbered section separately.


-- ============================================================================
-- ROLLBACK (INERT). Removes the constraint and restores the browser-only rule.
-- Reintroduces the ambiguity by design: for emergency recovery only, and only
-- if the index is found to be blocking a legitimate write.
-- ============================================================================
/*
BEGIN;
DROP INDEX IF EXISTS public.cohorts_one_accepting_submissions;
COMMIT;
*/
