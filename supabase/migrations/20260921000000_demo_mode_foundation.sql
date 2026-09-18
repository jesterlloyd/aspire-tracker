-- 20260921000000_demo_mode_foundation.sql
--
-- DEMO-MODE-1, phase 1 of 4: the is_demo boundary.
--
-- WHAT THIS IS FOR
--   Demo mode lets ASPIRE Intelligence be presented at a conference without a real
--   student's name appearing on screen. Every row in the app becomes one of two
--   populations: real (is_demo = false) or demo (is_demo = true). The client filters
--   every read and every write to exactly one population at a time.
--
-- WHY THE COLUMN DEFAULTS TO false
--   Because that makes this migration a no-op for the live app. Every existing row is
--   real, every existing query returns exactly what it returned before, and nothing
--   changes until the seed in phase 4 inserts the first demo row. Applying this file
--   alone is safe and reversible.
--
-- GATE NOTES
--   * Additive only. No data is modified, no policy is changed, nothing is dropped.
--   * ADD COLUMN ... NOT NULL DEFAULT false is a metadata-only operation on
--     PostgreSQL 11+, so it does not rewrite these tables and does not hold a long
--     lock, even on student_shift_logs.
--   * Explicitly transactional. If ANY assertion fails, the whole file rolls back and
--     the database is untouched. A partial apply would be worse than no apply, because
--     the client registry in src/lib/demoScope.js would then filter on a column that
--     does not exist and every read of that table would 400.
--   * Six of these tables were created through the Supabase dashboard and have no
--     CREATE TABLE in this repository. That is exactly why section 1 asserts instead
--     of assuming.
--
-- IMPORTANT: this is not a security control. It is applied in the browser and hides
-- demo rows from a presentation. It does not hide real rows from anyone holding the
-- anon key, and it must never be cited as a privacy boundary. RLS is unchanged here.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Preflight. Every table and every parent key this file touches must
--    exist before anything is altered.
-- ─────────────────────────────────────────────────────────────────────
DO $preflight$
DECLARE
  required_tables text[] := ARRAY[
    'cohorts','students','units','contacts','preceptors',
    'matches','student_shift_logs','student_shift_plans',
    'student_preceptor_assignments','student_unit_assignments',
    'student_active_disposition','evaluation_assignments',
    'interview_slots','interview_sessions','interview_rubrics',
    'cohort_school_rotations','unit_capacity_submissions',
    'unit_placement_requests','unit_cohort_responses'
  ];
  -- child table, parent table, foreign key column on the child
  required_keys text[][] := ARRAY[
    ['matches','students','student_id'],
    ['student_shift_logs','students','student_id'],
    ['student_shift_plans','students','student_id'],
    ['student_preceptor_assignments','students','student_id'],
    ['student_unit_assignments','students','student_id'],
    ['student_active_disposition','students','student_id'],
    ['evaluation_assignments','students','student_id'],
    ['interview_slots','cohorts','cohort_id'],
    ['interview_sessions','students','student_id'],
    ['interview_rubrics','students','student_id'],
    ['cohort_school_rotations','cohorts','cohort_id'],
    ['unit_capacity_submissions','cohorts','cohort_id'],
    ['unit_placement_requests','cohorts','cohort_id'],
    ['unit_cohort_responses','cohorts','cohort_id']
  ];
  t text;
  i int;
BEGIN
  FOREACH t IN ARRAY required_tables LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE EXCEPTION
        'DEMO-MODE-1 preflight: table public.% does not exist. Remove it from this migration AND from DEMO_SCOPED_TABLES in src/lib/demoScope.js before applying.', t;
    END IF;
  END LOOP;

  FOR i IN 1 .. array_length(required_keys, 1) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = required_keys[i][1]
        AND column_name  = required_keys[i][3]
    ) THEN
      RAISE EXCEPTION
        'DEMO-MODE-1 preflight: %.% does not exist, so it cannot inherit is_demo from %.',
        required_keys[i][1], required_keys[i][3], required_keys[i][2];
    END IF;
  END LOOP;

  RAISE NOTICE 'DEMO-MODE-1 preflight passed: 19 tables, 14 parent keys.';
END
$preflight$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. The column, on every table inside the boundary.
--    Roots own their value. Children have it set for them by section 3.
-- ─────────────────────────────────────────────────────────────────────
DO $addcol$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cohorts','students','units','contacts','preceptors',
    'matches','student_shift_logs','student_shift_plans',
    'student_preceptor_assignments','student_unit_assignments',
    'student_active_disposition','evaluation_assignments',
    'interview_slots','interview_sessions','interview_rubrics',
    'cohort_school_rotations','unit_capacity_submissions',
    'unit_placement_requests','unit_cohort_responses'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false', t
    );
    EXECUTE format(
      'COMMENT ON COLUMN public.%I.is_demo IS %L', t,
      'DEMO-MODE-1: true = presentation-only fabricated row. Never counts in a report, never receives email, never touched by a cron.'
    );
  END LOOP;
END
$addcol$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Inheritance. A child row is demo because its parent is.
--
--    The client stamps is_demo on its own inserts, but the client is not the only
--    writer: SECURITY DEFINER rpcs (record_student_disposition and friends) and the
--    server endpoints under api/ also insert here, and neither knows demo mode exists.
--    Making the database derive the value means the invariant holds no matter who
--    writes, which is the difference between a rule and a convention.
--
--    BEFORE INSERT only, deliberately. Recomputing on UPDATE would add a parent lookup
--    to every update of every real row on hot tables like student_shift_logs, to defend
--    against re-pointing a row at a different parent, which nothing in this app does.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.aspire_demo_inherit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  parent_table text := TG_ARGV[0];
  fk_column    text := TG_ARGV[1];
  fk_value     uuid;
  parent_demo  boolean;
BEGIN
  EXECUTE format('SELECT ($1).%I', fk_column) INTO fk_value USING NEW;

  -- An unparented row (an interview slot nobody has booked) keeps whatever the writer
  -- stamped. There is no parent to disagree with.
  IF fk_value IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format('SELECT is_demo FROM public.%I WHERE id = $1', parent_table)
    INTO parent_demo USING fk_value;

  -- A missing parent means a dangling key, which is not this trigger's problem to
  -- solve; leave the stamped value and let the foreign key raise if it must.
  IF parent_demo IS NOT NULL THEN
    NEW.is_demo := parent_demo;
  END IF;

  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION public.aspire_demo_inherit() IS
  'DEMO-MODE-1: BEFORE INSERT trigger. Sets is_demo from the parent row named by TG_ARGV[0] (table) and TG_ARGV[1] (fk column), so every writer produces a consistent population.';

DO $triggers$
DECLARE
  spec text[][] := ARRAY[
    ['matches','students','student_id'],
    ['student_shift_logs','students','student_id'],
    ['student_shift_plans','students','student_id'],
    ['student_preceptor_assignments','students','student_id'],
    ['student_unit_assignments','students','student_id'],
    ['student_active_disposition','students','student_id'],
    ['evaluation_assignments','students','student_id'],
    ['interview_slots','cohorts','cohort_id'],
    ['interview_sessions','students','student_id'],
    ['interview_rubrics','students','student_id'],
    ['cohort_school_rotations','cohorts','cohort_id'],
    ['unit_capacity_submissions','cohorts','cohort_id'],
    ['unit_placement_requests','cohorts','cohort_id'],
    ['unit_cohort_responses','cohorts','cohort_id']
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

-- ─────────────────────────────────────────────────────────────────────
-- 4. Indexes.
--
--    PARTIAL, on is_demo true only. A plain index on is_demo would be useless: almost
--    every row is false, so the planner would ignore it for real-mode reads and keep
--    doing what it does today. The partial index is tiny (it covers only the seeded
--    rows) and makes demo-mode reads an index scan instead of a filter over the whole
--    table. Only the tables large enough for it to matter are listed.
-- ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS students_is_demo_idx
  ON public.students (id) WHERE is_demo;
CREATE INDEX IF NOT EXISTS student_shift_logs_is_demo_idx
  ON public.student_shift_logs (student_id) WHERE is_demo;
CREATE INDEX IF NOT EXISTS evaluation_assignments_is_demo_idx
  ON public.evaluation_assignments (student_id) WHERE is_demo;
CREATE INDEX IF NOT EXISTS matches_is_demo_idx
  ON public.matches (student_id) WHERE is_demo;
CREATE INDEX IF NOT EXISTS contacts_is_demo_idx
  ON public.contacts (id) WHERE is_demo;

COMMIT;

-- ═════════════════════════════════════════════════════════════════════
-- VERIFICATION. Run after COMMIT. Expected results are stated with each.
-- ═════════════════════════════════════════════════════════════════════

-- V1. The column exists on all 20 tables, is NOT NULL, and defaults to false.
--     EXPECT: 20 rows, every is_nullable = 'NO', every default = 'false'.
SELECT table_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND column_name = 'is_demo'
ORDER BY table_name;

-- V2. No row anywhere became a demo row. EXPECT: every demo_rows = 0.
SELECT 'students' AS t, count(*) FILTER (WHERE is_demo) AS demo_rows, count(*) AS total FROM public.students
UNION ALL SELECT 'cohorts',  count(*) FILTER (WHERE is_demo), count(*) FROM public.cohorts
UNION ALL SELECT 'units',    count(*) FILTER (WHERE is_demo), count(*) FROM public.units
UNION ALL SELECT 'contacts', count(*) FILTER (WHERE is_demo), count(*) FROM public.contacts
UNION ALL SELECT 'preceptors', count(*) FILTER (WHERE is_demo), count(*) FROM public.preceptors
UNION ALL SELECT 'matches',  count(*) FILTER (WHERE is_demo), count(*) FROM public.matches
UNION ALL SELECT 'student_shift_logs', count(*) FILTER (WHERE is_demo), count(*) FROM public.student_shift_logs
ORDER BY t;

-- V3. All 14 inheritance triggers are installed. EXPECT: 14 rows.
SELECT c.relname AS child_table, t.tgname
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE t.tgname = 'aspire_demo_inherit_trg' AND NOT t.tgisinternal
ORDER BY c.relname;

-- V4. The five partial indexes exist. EXPECT: 5 rows.
SELECT indexname, tablename FROM pg_indexes
WHERE schemaname = 'public' AND indexname LIKE '%_is_demo_idx'
ORDER BY indexname;

-- ═════════════════════════════════════════════════════════════════════
-- ROLLBACK. Reverses this file completely.
--
-- SAFE ONLY WHILE NO DEMO ROWS EXIST (that is, before the phase 4 seed, or after its
-- teardown). Dropping the column after seeding would leave fabricated rows behind with
-- nothing marking them as fabricated, which is far worse than leaving the column in
-- place. Confirm V2 above returns all zeros first.
-- ═════════════════════════════════════════════════════════════════════
-- BEGIN;
-- DO $rollback$
-- DECLARE t text;
-- BEGIN
--   FOREACH t IN ARRAY ARRAY[
--     'matches','student_shift_logs','student_shift_plans',
--     'student_preceptor_assignments','student_unit_assignments',
--     'student_active_disposition','evaluation_assignments',
--     'interview_slots','interview_sessions','interview_rubrics',
--     'cohort_school_rotations','unit_capacity_submissions',
--     'unit_placement_requests','unit_cohort_responses'
--   ] LOOP
--     EXECUTE format('DROP TRIGGER IF EXISTS aspire_demo_inherit_trg ON public.%I', t);
--   END LOOP;
--   FOREACH t IN ARRAY ARRAY[
--     'cohorts','students','units','contacts','preceptors',
--     'matches','student_shift_logs','student_shift_plans',
--     'student_preceptor_assignments','student_unit_assignments',
--     'student_active_disposition','evaluation_assignments',
--     'interview_slots','interview_sessions','interview_rubrics',
--     'cohort_school_rotations','unit_capacity_submissions',
--     'unit_placement_requests','unit_cohort_responses'
--   ] LOOP
--     EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS is_demo', t);
--   END LOOP;
-- END
-- $rollback$;
-- DROP FUNCTION IF EXISTS public.aspire_demo_inherit();
-- COMMIT;
