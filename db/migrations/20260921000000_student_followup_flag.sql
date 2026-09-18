-- STUDENT-CHART-1: the follow-up flag the student chart's ribbon pulls.
--
-- Owner decision, 2026-09-18: this is NOT the interview flag. `flagged_for_second
-- _interview` means "bring this candidate back for a second interview", it drives the
-- Review Flag row in Interview Recommendations, and a coordinator flagging a student
-- mid-rotation means nothing of the kind. The two ribbons look alike because the
-- gesture is the same; they must never write the same column.
--
-- Like the rubric's ribbon, this flag carries NO note. The pull is the whole
-- interaction: it says "come back to this student", and nothing more.
--
-- SAFE TO RUN TWICE. Adds one nullable-with-default boolean and nothing else: no
-- backfill, no constraint on existing rows, no RLS change (students' policies already
-- govern every column). Existing rows read false.
--
-- UNTIL THIS IS APPLIED the chart still works: the ribbon reads the absent column as
-- unflagged and renders inert with a tooltip saying so, and /api/student-update
-- answers a pull with a plain "not enabled yet" instead of an opaque 500. Applying
-- this switches the ribbon on with no redeploy.

BEGIN;

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS flagged_for_followup boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.students.flagged_for_followup IS
  'STUDENT-CHART-1: coordinator follow-up flag, set by the ribbon on the student chart. '
  'Carries no note. Distinct from flagged_for_second_interview, which is the interview '
  'rubric''s second-interview flag and drives Interview Recommendations.';

-- Postcondition: one row, data_type boolean, column_default false, is_nullable NO.
SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'students'
   AND column_name  = 'flagged_for_followup';

COMMIT;

-- ROLLBACK, if the flag is ever withdrawn. Drops the column and every value in it;
-- nothing else on students is touched.
--
-- ALTER TABLE public.students DROP COLUMN IF EXISTS flagged_for_followup;
