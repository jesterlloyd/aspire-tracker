-- supabase/migrations/20260922000000_demo_mode_residency.sql
--
-- DEMO-MODE-2: the residency workspace joins the boundary.
--
-- 20260921000000 covered the ASPIRE spine. It deliberately left the ngrp_* family out,
-- and docs/DEMO_MODE.md said so: with no is_demo on those tables the Residency Portal's
-- cohort picker names REAL residency cycles even in demo mode, and no demo cycle could
-- be created without putting a fabricated cohort in front of real Talent Acquisition
-- work. This closes that.
--
-- ─────────────────────────────────────────────────────────────────────
-- WHY SIX TABLES AND NOT TWENTY-ONE
-- ─────────────────────────────────────────────────────────────────────
-- There are 21 ngrp_* tables. Only six get a column, and the other fifteen do not need
-- one, for the same reason student_active_disposition does not:
--
--   EVERY read of them is already scoped by an id that IS filtered.
--
-- That is not an assumption. Every .from('ngrp_*') in api/ and lib/server/ was read and
-- classified before this file was written:
--
--   ngrp_cycles                     NO FILTER - the picker lists them all.  <-- needs it
--   ngrp_residency_outcomes         filtered only by hired_at IS NOT NULL.  <-- needs it
--   ngrp_cycle_source_cohorts       eq/in cycle_id
--   ngrp_cycle_units                eq cycle_id
--   ngrp_candidates                 eq cycle_id, eq id, in id, eq student_id
--   ngrp_candidate_requirements     eq candidate_id
--   ngrp_transition_assignments     eq/in candidate_id, eq id
--   ngrp_transition_revisions       in/eq assignment_id
--   ngrp_transition_deliveries      eq batch_id, eq candidate_id, eq id
--   ngrp_transition_tokens          eq/in id, eq assignment_id, eq token_hash
--   ngrp_reflection_periods         in candidate_id
--   ngrp_reflection_submissions     in period_id
--   ngrp_preceptor_feedback_requests eq id
--
-- So ngrp_cycles is the one genuinely unscoped LIST, and filtering it is what makes a
-- demo see only its own cycle. The other five here get the column not because a read
-- would leak without it, but because THE SEED WRITES THEM and the teardown has to be
-- able to find its own rows again:
--
--   ngrp_cycle_source_cohorts.cohort_id is ON DELETE RESTRICT, so a demo mapping row
--   BLOCKS deleting the demo cohort. ngrp_residency_outcomes.student_id is RESTRICT
--   too, so a demo hire record BLOCKS deleting the demo student. A teardown that
--   cannot delete is a teardown that leaves fabricated people in the database.
--
-- ─────────────────────────────────────────────────────────────────────
-- WHAT INHERITS FROM WHAT, AND WHY IT IS NOT ALWAYS THE OBVIOUS PARENT
-- ─────────────────────────────────────────────────────────────────────
-- ngrp_candidates has TWO parents: a cycle and a student. It inherits from the STUDENT,
-- because the student is what carries the NAME that must never reach a projector. If it
-- inherited from the cycle instead, a real student added to a demo cycle would be marked
-- demo and would then be displayed BY a demo. Inheriting from the student fails the safe
-- way round: that candidate is simply not returned, and the roster is short by one
-- rather than wrong by one. ngrp_residency_outcomes carries student_id too, for the same
-- reason and the same choice.
--
-- The transition rows have no student_id at all, so they chain: an assignment inherits
-- from its candidate, a revision from its assignment. That works because the parent row
-- is INSERTED FIRST and its own BEFORE INSERT trigger has already resolved its value by
-- the time the child is written. A chain is only sound in that order, which is the order
-- the seed uses and the only order the foreign keys permit anyway.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 0. Preflight. Collect EVERY problem and raise once, so one run tells you
--    everything that is wrong rather than the first thing.
-- ─────────────────────────────────────────────────────────────────────
DO $preflight$
DECLARE
  required_tables text[] := ARRAY[
    'ngrp_cycles','ngrp_cycle_source_cohorts','ngrp_candidates',
    'ngrp_residency_outcomes','ngrp_transition_assignments','ngrp_transition_revisions'
  ];
  required_keys text[][] := ARRAY[
    ['ngrp_cycle_source_cohorts','ngrp_cycles','cycle_id'],
    ['ngrp_candidates','students','student_id'],
    ['ngrp_residency_outcomes','students','student_id'],
    ['ngrp_transition_assignments','ngrp_candidates','candidate_id'],
    ['ngrp_transition_revisions','ngrp_transition_assignments','assignment_id']
  ];
  problems text[] := ARRAY[]::text[];
  i int;
  kind "char";
BEGIN
  -- The foundation must be applied first. Without it there is no aspire_demo_inherit()
  -- to hang these triggers on, and no is_demo on students to inherit from.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'aspire_demo_inherit'
  ) THEN
    problems := problems || 'MISSING: public.aspire_demo_inherit() does not exist. Apply 20260921000000_demo_mode_foundation.sql first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'students' AND column_name = 'is_demo'
  ) THEN
    problems := problems || 'MISSING: students.is_demo does not exist. Apply 20260921000000_demo_mode_foundation.sql first.';
  END IF;

  -- relkind, not to_regclass: to_regclass resolves a VIEW perfectly happily, and
  -- ALTER TABLE ... ADD COLUMN then fails halfway through with a message about the
  -- relation rather than about the plan. That cost a round trip on the foundation.
  FOR i IN 1 .. array_length(required_tables, 1) LOOP
    SELECT c.relkind INTO kind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = required_tables[i];

    IF kind IS NULL THEN
      problems := problems || format('MISSING TABLE: public.%s does not exist on this instance', required_tables[i]);
    ELSIF kind NOT IN ('r','p') THEN
      problems := problems || format('NOT A TABLE: public.%s is relkind %s, so it cannot carry a column', required_tables[i], kind);
    END IF;
  END LOOP;

  FOR i IN 1 .. array_length(required_keys, 1) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = required_keys[i][1]
        AND column_name  = required_keys[i][3]
    ) THEN
      problems := problems || format(
        'MISSING KEY: %s.%s does not exist, so it cannot inherit is_demo from %s',
        required_keys[i][1], required_keys[i][3], required_keys[i][2]);
    END IF;
  END LOOP;

  IF array_length(problems, 1) > 0 THEN
    RAISE EXCEPTION E'DEMO-MODE-2 preflight found % problem(s). NOTHING was applied:\n  %',
      array_length(problems, 1), array_to_string(problems, E'\n  ');
  END IF;

  RAISE NOTICE 'DEMO-MODE-2 preflight passed: % tables, % parent keys.',
    array_length(required_tables, 1), array_length(required_keys, 1);
END
$preflight$;

-- ─────────────────────────────────────────────────────────────────────
-- 1. The column. NOT NULL DEFAULT false is metadata-only in PG11+, so this
--    rewrites nothing and takes no meaningful lock.
-- ─────────────────────────────────────────────────────────────────────
DO $addcol$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ngrp_cycles','ngrp_cycle_source_cohorts','ngrp_candidates',
    'ngrp_residency_outcomes','ngrp_transition_assignments','ngrp_transition_revisions'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false', t
    );
    EXECUTE format(
      'COMMENT ON COLUMN public.%I.is_demo IS %L', t,
      'DEMO-MODE-2: true = presentation-only fabricated row. Never counts in a report, never receives email, never touched by a cron.'
    );
  END LOOP;
END
$addcol$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Inheritance. The same aspire_demo_inherit() the foundation installed;
--    this file only registers five more triggers on it.
-- ─────────────────────────────────────────────────────────────────────
DO $triggers$
DECLARE
  spec text[][] := ARRAY[
    ['ngrp_cycle_source_cohorts','ngrp_cycles','cycle_id'],
    ['ngrp_candidates','students','student_id'],
    ['ngrp_residency_outcomes','students','student_id'],
    ['ngrp_transition_assignments','ngrp_candidates','candidate_id'],
    ['ngrp_transition_revisions','ngrp_transition_assignments','assignment_id']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(spec, 1) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS aspire_demo_inherit_trg ON public.%I', spec[i][1]);
    EXECUTE format(
      'CREATE TRIGGER aspire_demo_inherit_trg BEFORE INSERT ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.aspire_demo_inherit(%L, %L)',
      spec[i][1], spec[i][2], spec[i][3]
    );
  END LOOP;
END
$triggers$;

COMMIT;

-- ═════════════════════════════════════════════════════════════════════
-- VERIFICATION. Run after COMMIT.
-- ═════════════════════════════════════════════════════════════════════

-- V1. The column exists on all six, is NOT NULL, and defaults to false.
--     EXPECT: 6 rows, every is_nullable NO and every default false.
SELECT table_name, column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND column_name = 'is_demo'
  AND table_name IN ('ngrp_cycles','ngrp_cycle_source_cohorts','ngrp_candidates',
                     'ngrp_residency_outcomes','ngrp_transition_assignments','ngrp_transition_revisions')
ORDER BY table_name;

-- V2. Five inheritance triggers, each naming its parent and key.
--     EXPECT: 5 rows.
SELECT c.relname AS child, p.proname AS fn, t.tgargs IS NOT NULL AS has_args
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc  p ON p.oid = t.tgfoid
WHERE t.tgname = 'aspire_demo_inherit_trg'
  AND c.relname IN ('ngrp_cycle_source_cohorts','ngrp_candidates','ngrp_residency_outcomes',
                    'ngrp_transition_assignments','ngrp_transition_revisions')
ORDER BY c.relname;

-- V3. Nothing real was touched: every existing row is real.
--     EXPECT: demo_rows = 0 on every line, real_rows unchanged from before.
SELECT 'ngrp_cycles' AS t, count(*) FILTER (WHERE NOT is_demo) AS real_rows, count(*) FILTER (WHERE is_demo) AS demo_rows FROM ngrp_cycles
UNION ALL SELECT 'ngrp_cycle_source_cohorts', count(*) FILTER (WHERE NOT is_demo), count(*) FILTER (WHERE is_demo) FROM ngrp_cycle_source_cohorts
UNION ALL SELECT 'ngrp_candidates', count(*) FILTER (WHERE NOT is_demo), count(*) FILTER (WHERE is_demo) FROM ngrp_candidates
UNION ALL SELECT 'ngrp_residency_outcomes', count(*) FILTER (WHERE NOT is_demo), count(*) FILTER (WHERE is_demo) FROM ngrp_residency_outcomes
UNION ALL SELECT 'ngrp_transition_assignments', count(*) FILTER (WHERE NOT is_demo), count(*) FILTER (WHERE is_demo) FROM ngrp_transition_assignments
UNION ALL SELECT 'ngrp_transition_revisions', count(*) FILTER (WHERE NOT is_demo), count(*) FILTER (WHERE is_demo) FROM ngrp_transition_revisions
ORDER BY t;
