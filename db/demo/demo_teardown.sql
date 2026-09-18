-- db/demo/demo_teardown.sql
--
-- DEMO-MODE-1: removes the entire fabricated cast and nothing else.
--
-- WHY EVERY PREDICATE IS `is_demo` AND NOTHING ELSE
--
-- Not a name, not an email pattern, not an id prefix. One column, set by the seed and
-- enforced by the inheritance triggers, and it is the only thing these statements look
-- at. A teardown written against names would delete a real student who happened to be
-- called Grace Mbeki. A teardown written against the 0de0 id prefix would miss any row
-- the app itself created during a live demo, because those got real uuids from
-- gen_random_uuid() and were marked demo by the trigger, not by the seed.
--
-- That second case is the one that matters. Demo mode is interactive: a shift logged on
-- stage, a student moved on the board, an evaluation released. Those rows are real rows
-- in the database with is_demo = true, and they have to go too.
--
-- SAFE TO RUN AT ANY TIME. If no demo rows exist, every statement deletes nothing.
--
-- AFTER A CONFERENCE, run this. Demo rows cost nothing to leave in place (they are
-- invisible outside demo mode and skipped by every cron), but leaving them is how a
-- database accumulates fabricated people nobody remembers creating.

BEGIN;

-- Preflight: if is_demo does not exist, the foundation migration was never applied and
-- there is nothing here to tear down. Say so rather than failing with a column error.
DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='students' AND column_name='is_demo'
  ) THEN
    RAISE EXCEPTION
      'DEMO TEARDOWN: students.is_demo does not exist, so no demo rows can exist either. Nothing to do.';
  END IF;
END
$preflight$;

-- Children before parents. Several of these would cascade anyway; being explicit means
-- the counts below are honest about what this removed.
DELETE FROM student_preceptor_assignments WHERE is_demo;
DELETE FROM student_shift_logs            WHERE is_demo;
DELETE FROM student_shift_plans           WHERE is_demo;
DELETE FROM student_unit_assignments      WHERE is_demo;
DELETE FROM evaluation_assignments        WHERE is_demo;
DELETE FROM interview_rubrics             WHERE is_demo;
DELETE FROM interview_sessions            WHERE is_demo;
DELETE FROM interview_slots               WHERE is_demo;
DELETE FROM preceptor_cohort_participation WHERE is_demo;
DELETE FROM matches                       WHERE is_demo;
DELETE FROM unit_cohort_responses         WHERE is_demo;
DELETE FROM unit_placement_requests       WHERE is_demo;
DELETE FROM unit_capacity_submissions     WHERE is_demo;
DELETE FROM cohort_school_rotations       WHERE is_demo;
DELETE FROM students                      WHERE is_demo;
DELETE FROM preceptors                    WHERE is_demo;
DELETE FROM units                         WHERE is_demo;
DELETE FROM contacts                      WHERE is_demo;
DELETE FROM cohorts                       WHERE is_demo;

COMMIT;

-- ═════════════════════════════════════════════════════════════════════
-- VERIFICATION. EXPECT: every demo_rows = 0, and every real_rows unchanged.
-- ═════════════════════════════════════════════════════════════════════
SELECT 'students' AS t, count(*) FILTER (WHERE is_demo) AS demo_rows, count(*) AS total FROM students
UNION ALL SELECT 'cohorts',    count(*) FILTER (WHERE is_demo), count(*) FROM cohorts
UNION ALL SELECT 'units',      count(*) FILTER (WHERE is_demo), count(*) FROM units
UNION ALL SELECT 'contacts',   count(*) FILTER (WHERE is_demo), count(*) FROM contacts
UNION ALL SELECT 'preceptors', count(*) FILTER (WHERE is_demo), count(*) FROM preceptors
UNION ALL SELECT 'preceptor_cohort_participation', count(*) FILTER (WHERE is_demo), count(*) FROM preceptor_cohort_participation
UNION ALL SELECT 'matches',    count(*) FILTER (WHERE is_demo), count(*) FROM matches
UNION ALL SELECT 'student_shift_logs', count(*) FILTER (WHERE is_demo), count(*) FROM student_shift_logs
UNION ALL SELECT 'student_preceptor_assignments', count(*) FILTER (WHERE is_demo), count(*) FROM student_preceptor_assignments
UNION ALL SELECT 'cohort_school_rotations', count(*) FILTER (WHERE is_demo), count(*) FROM cohort_school_rotations
ORDER BY t;
