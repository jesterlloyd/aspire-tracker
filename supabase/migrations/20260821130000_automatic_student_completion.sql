-- =============================================================================
-- Canonical automatic student completion
-- Migration: 20260821130000_automatic_student_completion
-- Apply through the normal Supabase migration workflow before deploying the
-- scheduled endpoint. The one-time reconciliation near the end repairs existing
-- eligible records as part of the same transaction.
-- =============================================================================
--
-- students.status is the one ASPIRE lifecycle source used by the staff app,
-- Academic Partner portal, Unit Leader portal, student portal, reminders, and
-- certificate/evaluation gates. A display-only "Ready to complete" badge left
-- that source stale, so different screens correctly repeated the same wrong
-- Active Rotation value.
--
-- A student is automatically completed only when every condition is true:
--   1. stored status is exactly Active Rotation (terminal/off-ramp states are
--      never changed);
--   2. the student is explicitly linked to the school-form rotation row for
--      the same cohort and exact school identity;
--   3. that official end date is real, non-sentinel, and has fully passed in
--      Pacific time (strictly before today, so the final rotation day remains
--      active for the whole day);
--   4. required hours are configured and greater than zero; and
--   5. approved hours meet or exceed the requirement. Pending hours do not count.
--
-- There is deliberately no fallback to cohorts.start_date/end_date or the
-- legacy students.term_dates text. Unknown or inconsistent evidence fails closed.
-- The transition also stamps rotation_completed_at and appends the canonical
-- completion program event. The function is transactional and idempotent.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.reconcile_student_completions(
  p_cohort_id uuid DEFAULT NULL,
  p_student_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now       timestamptz := clock_timestamp();
  v_today_pt  date := timezone('America/Los_Angeles', v_now)::date;
  v_ids       uuid[] := ARRAY[]::uuid[];
  v_updated   integer := 0;
BEGIN
  WITH eligible AS (
    SELECT s.id, r.rotation_end_date
    FROM public.students s
    JOIN public.cohort_school_rotations r
      ON r.id = s.cohort_school_rotation_id
     AND r.cohort_id = s.cohort_id
     AND r.school_name = s.school
    WHERE s.status = 'Active Rotation'
      AND (p_cohort_id IS NULL OR s.cohort_id = p_cohort_id)
      AND (p_student_id IS NULL OR s.id = p_student_id)
      AND r.rotation_end_date IS NOT NULL
      AND r.rotation_end_date <> DATE '1900-01-01'
      AND r.rotation_end_date < v_today_pt
      AND s.hours_required IS NOT NULL
      AND s.hours_required > 0
      AND COALESCE(s.approved_hours, 0) >= s.hours_required
  ), updated AS (
    UPDATE public.students s
       SET status = 'Completed',
           rotation_end_date = e.rotation_end_date,
           rotation_completed_at = COALESCE(s.rotation_completed_at, v_now),
           updated_at = v_now
      FROM eligible e
     WHERE s.id = e.id
       AND s.status = 'Active Rotation'
    RETURNING s.id
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]), count(*)::integer
    INTO v_ids, v_updated
    FROM updated;

  IF v_updated > 0 THEN
    INSERT INTO public.program_events
      (student_id, cohort_id, event_type, event_date, notes, created_by)
    SELECT
      s.id,
      s.cohort_id,
      'completion',
      s.rotation_end_date,
      '[Auto-logged] Status changed from Active Rotation to Completed after the official rotation end date passed and approved hours met the requirement.',
      'system'
    FROM public.students s
    WHERE s.id = ANY(v_ids)
      AND NOT EXISTS (
        SELECT 1
        FROM public.program_events pe
        WHERE pe.student_id = s.id
          AND pe.cohort_id = s.cohort_id
          AND pe.event_type = 'completion'
      );
  END IF;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_student_completions(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_student_completions(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.reconcile_student_completions(uuid, uuid) IS
  'Transitions eligible Active Rotation students to Completed using the linked school-specific end date and approved-hour requirement.';

-- Reconcile immediately when staff closes a cohort. The same strict per-student
-- date/hour guards still apply; cohort completion by itself never completes a student.
CREATE OR REPLACE FUNCTION public.reconcile_students_after_cohort_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status = 'Completed' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.reconcile_student_completions(NEW.id, NULL);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_students_after_cohort_completion()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS reconcile_students_after_cohort_completion ON public.cohorts;
CREATE TRIGGER reconcile_students_after_cohort_completion
AFTER UPDATE OF status ON public.cohorts
FOR EACH ROW
EXECUTE FUNCTION public.reconcile_students_after_cohort_completion();

-- Late approval/correction of hours or a newly-linked school rotation should
-- reconcile that one student without waiting for the daily sweep.
CREATE OR REPLACE FUNCTION public.reconcile_student_after_completion_input()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status = 'Active Rotation' THEN
    PERFORM public.reconcile_student_completions(NULL, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_student_after_completion_input()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS reconcile_student_after_completion_input ON public.students;
CREATE TRIGGER reconcile_student_after_completion_input
AFTER UPDATE OF approved_hours, hours_required, cohort_school_rotation_id ON public.students
FOR EACH ROW
EXECUTE FUNCTION public.reconcile_student_after_completion_input();

-- Corrected school-form dates can make several linked students newly eligible.
CREATE OR REPLACE FUNCTION public.reconcile_students_after_rotation_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.rotation_end_date IS DISTINCT FROM OLD.rotation_end_date THEN
    PERFORM public.reconcile_student_completions(NEW.cohort_id, NULL);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_students_after_rotation_date()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS reconcile_students_after_rotation_date ON public.cohort_school_rotations;
CREATE TRIGGER reconcile_students_after_rotation_date
AFTER UPDATE OF rotation_end_date ON public.cohort_school_rotations
FOR EACH ROW
EXECUTE FUNCTION public.reconcile_students_after_rotation_date();

-- One-time repair for already-stale records (including the completed Summer
-- 2026 cohort). Safe to re-run: only Active Rotation rows can transition.
SELECT public.reconcile_student_completions(NULL, NULL);

COMMIT;

-- Verification after applying:
--
-- 1. No eligible student remains stale (expected count: 0).
-- SELECT count(*)
-- FROM public.students s
-- JOIN public.cohort_school_rotations r ON r.id = s.cohort_school_rotation_id
-- WHERE s.status = 'Active Rotation'
--   AND r.cohort_id = s.cohort_id
--   AND r.school_name = s.school
--   AND r.rotation_end_date <> DATE '1900-01-01'
--   AND r.rotation_end_date < timezone('America/Los_Angeles', now())::date
--   AND s.hours_required > 0
--   AND COALESCE(s.approved_hours, 0) >= s.hours_required;
--
-- 2. Review recent automatic completions (no names or emails required).
-- SELECT cohort_id, count(*) AS completed_students, max(created_at) AS last_completed_at
-- FROM public.program_events
-- WHERE event_type = 'completion' AND created_by = 'system'
-- GROUP BY cohort_id
-- ORDER BY last_completed_at DESC;
