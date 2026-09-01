-- =============================================================================
-- Student Rotation Activity: planning overlay and reviewed-log correction
-- Migration: 20260901010000_student_rotation_activity
-- =============================================================================

BEGIN;

-- A planned shift is not a clinical-hour record. It carries no hours, approval,
-- check-in, or attestation fields and therefore cannot enter any totals. Cancel
-- is soft so student planning changes remain recoverable for audit/support.
CREATE TABLE IF NOT EXISTS public.student_shift_plans (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id              uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  cohort_id               uuid REFERENCES public.cohorts(id) ON DELETE SET NULL,
  shift_date              text NOT NULL CHECK (shift_date ~ '^\d{4}-\d{2}-\d{2}$'),
  preceptor_name          text NOT NULL CHECK (btrim(preceptor_name) <> '' AND length(preceptor_name) <= 200),
  created_by_profile_id   uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  cancelled_at            timestamptz,
  cancelled_by_profile_id uuid REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_student_shift_plan_cancel_actor CHECK (
    (cancelled_at IS NULL AND cancelled_by_profile_id IS NULL)
    OR (cancelled_at IS NOT NULL AND cancelled_by_profile_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_shift_plans_active_day
  ON public.student_shift_plans (student_id, shift_date)
  WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_student_shift_plans_student_date
  ON public.student_shift_plans (student_id, shift_date, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_student_shift_plans ON public.student_shift_plans;
CREATE TRIGGER set_updated_at_student_shift_plans
  BEFORE UPDATE ON public.student_shift_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.student_shift_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.student_shift_plans FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.student_shift_plans TO service_role;

-- A reviewed shift may be corrected and reviewed again. The ledger stays
-- append-only; dropping the one-ever unique index preserves every prior review
-- and permits a new decision row after the student edit returns the live shift
-- to Pending Review. The shift row lock + Pending Review predicate remain the
-- concurrency barrier for each review cycle.
DROP INDEX IF EXISTS public.uq_slr_one_decision_per_shift;
CREATE INDEX IF NOT EXISTS idx_slr_shift_history
  ON public.shift_log_reviews (original_shift_log_id, created_at DESC);

-- Reviewed completed entries become editable, but downstream finalization
-- gates remain unchanged. Withdraw remains narrower at the API/RPC boundary.
CREATE OR REPLACE FUNCTION public.student_shift_edit_eligibility(
  p_shift_id   uuid,
  p_student_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_shift   record;
  v_student record;
  v_certs   integer;
BEGIN
  SELECT id, student_id, status, lifecycle_state
    INTO v_shift
  FROM public.student_shift_logs
  WHERE id = p_shift_id AND student_id = p_student_id;

  IF v_shift.id IS NULL THEN
    RETURN jsonb_build_object('editable', false, 'reason', 'not_found');
  END IF;

  SELECT id, status, rotation_completed_at INTO v_student
  FROM public.students WHERE id = p_student_id;

  IF v_shift.lifecycle_state = 'voided' THEN
    RETURN jsonb_build_object('editable', false, 'reason', 'already_voided');
  END IF;
  IF v_shift.lifecycle_state IS DISTINCT FROM 'completed' THEN
    RETURN jsonb_build_object('editable', false, 'reason', 'shift_in_progress');
  END IF;
  IF v_shift.status NOT IN ('Auto-Accepted', 'Pending Review', 'Approved', 'Rejected') THEN
    RETURN jsonb_build_object('editable', false, 'reason', 'not_editable');
  END IF;

  SELECT count(*) INTO v_certs FROM public.certificates WHERE student_id = p_student_id;
  IF v_certs > 0 THEN
    RETURN jsonb_build_object('editable', false, 'reason', 'certificate_issued');
  END IF;
  IF v_student.rotation_completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('editable', false, 'reason', 'rotation_concluded');
  END IF;
  IF v_student.status IN ('Completed', 'Not Proceeding') THEN
    RETURN jsonb_build_object('editable', false, 'reason', 'student_status_terminal');
  END IF;

  RETURN jsonb_build_object('editable', true, 'reason', 'ok');
END;
$$;

REVOKE ALL ON FUNCTION public.student_shift_edit_eligibility(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.student_shift_edit_eligibility(uuid, uuid) TO service_role;

-- Any student edit requires a fresh staff decision. Classification still runs
-- under the student lock to refresh exception evidence, but it cannot auto-
-- accept the edit. Prior reviewer metadata is cleared from the live row; the
-- append-only shift_log_reviews ledger retains the prior decision verbatim.
CREATE OR REPLACE FUNCTION public.student_revise_shift_log(
  p_shift_id                uuid,
  p_student_id              uuid,
  p_actor_profile_id        uuid,
  p_shift_date              text,
  p_total_hours             numeric,
  p_unit_name               text,
  p_is_assigned_unit        boolean,
  p_unit_override_reason    text,
  p_preceptor_name          text,
  p_is_assigned_preceptor   boolean,
  p_preceptor_override_note text,
  p_shift_type              text,
  p_learning_highlight      text,
  p_support_needed          text,
  p_reason                  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_before              record;
  v_after               record;
  v_verdict             jsonb;
  v_class               jsonb;
  v_flags               jsonb;
  v_review_reason       text;
  v_recomputed_approved numeric(6,2);
  v_recomputed_pending  numeric(6,2);
BEGIN
  PERFORM 1 FROM public.students WHERE id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_before
  FROM public.student_shift_logs
  WHERE id = p_shift_id AND student_id = p_student_id
  FOR UPDATE;
  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'shift_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_verdict := public.student_shift_edit_eligibility(p_shift_id, p_student_id);
  IF (v_verdict->>'editable')::boolean IS DISTINCT FROM true THEN
    IF v_verdict->>'reason' = 'not_found' THEN
      RAISE EXCEPTION 'shift_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'shift_not_editable: %', v_verdict->>'reason' USING ERRCODE = 'P0001';
  END IF;

  v_class := public.student_shift_classify(
    p_student_id, p_shift_id, p_shift_date, p_total_hours,
    p_unit_name, p_is_assigned_unit, p_preceptor_name);
  v_flags         := v_class->'flags';
  v_review_reason := v_class->>'review_reason';
  IF v_flags IS NULL OR jsonb_typeof(v_flags) <> 'array' THEN
    RAISE EXCEPTION 'classification_failed' USING ERRCODE = 'P0006';
  END IF;

  UPDATE public.student_shift_logs
  SET shift_date              = p_shift_date,
      total_hours             = p_total_hours,
      unit_name               = p_unit_name,
      is_assigned_unit        = p_is_assigned_unit,
      unit_override_reason    = COALESCE(p_unit_override_reason, ''),
      preceptor_name          = COALESCE(p_preceptor_name, ''),
      is_assigned_preceptor   = p_is_assigned_preceptor,
      preceptor_override_note = COALESCE(p_preceptor_override_note, ''),
      shift_type              = p_shift_type,
      learning_highlight      = COALESCE(p_learning_highlight, ''),
      support_needed          = COALESCE(p_support_needed, ''),
      status                  = 'Pending Review',
      exception_flags         = v_flags,
      review_reason           = v_review_reason,
      admin_notes             = NULL,
      reviewed_by             = NULL,
      reviewed_at             = NULL
  WHERE id = p_shift_id
    AND student_id = p_student_id
    AND lifecycle_state = 'completed'
    AND status IN ('Auto-Accepted', 'Pending Review', 'Approved', 'Rejected')
  RETURNING * INTO v_after;

  IF v_after.id IS NULL THEN
    RAISE EXCEPTION 'shift_not_editable: raced' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(total_hours), 0) INTO v_recomputed_approved
  FROM public.student_shift_logs
  WHERE student_id = p_student_id
    AND lifecycle_state = 'completed'
    AND status IN ('Auto-Accepted', 'Approved')
    AND total_hours IS NOT NULL;

  SELECT COALESCE(SUM(total_hours), 0) INTO v_recomputed_pending
  FROM public.student_shift_logs
  WHERE student_id = p_student_id
    AND lifecycle_state = 'completed'
    AND status IN ('Pending Review')
    AND total_hours IS NOT NULL;

  UPDATE public.students
  SET approved_hours = v_recomputed_approved,
      pending_hours  = v_recomputed_pending
  WHERE id = p_student_id;

  INSERT INTO public.student_shift_log_edits (
    original_shift_log_id, original_student_id, shift_log_id, student_id, cohort_id,
    action, actor_profile_id, reason,
    before_status, before_lifecycle_state, before_shift_date, before_total_hours,
    before_unit_name, before_preceptor_name, before_shift_type,
    before_exception_flags, before_review_reason,
    after_status, after_lifecycle_state, after_shift_date, after_total_hours,
    after_unit_name, after_preceptor_name, after_shift_type,
    after_exception_flags, after_review_reason,
    approved_hours_after, pending_hours_after
  ) VALUES (
    p_shift_id, p_student_id, p_shift_id, p_student_id, v_before.cohort_id,
    'edited', p_actor_profile_id, COALESCE(btrim(p_reason), ''),
    COALESCE(v_before.status, ''), COALESCE(v_before.lifecycle_state, ''),
    COALESCE(v_before.shift_date, ''), v_before.total_hours,
    COALESCE(v_before.unit_name, ''), COALESCE(v_before.preceptor_name, ''),
    COALESCE(v_before.shift_type, ''),
    COALESCE(v_before.exception_flags, '[]'::jsonb), v_before.review_reason,
    'Pending Review', COALESCE(v_after.lifecycle_state, ''),
    COALESCE(v_after.shift_date, ''), v_after.total_hours,
    COALESCE(v_after.unit_name, ''), COALESCE(v_after.preceptor_name, ''),
    COALESCE(v_after.shift_type, ''),
    COALESCE(v_after.exception_flags, '[]'::jsonb), v_after.review_reason,
    v_recomputed_approved, v_recomputed_pending
  );

  RETURN jsonb_build_object(
    'ok', true,
    'action', 'edited',
    'shift_id', p_shift_id,
    'student_id', p_student_id,
    'status', 'Pending Review',
    'previous_status', v_before.status,
    'total_hours', v_after.total_hours,
    'exception_flags', v_after.exception_flags,
    'approved_hours', v_recomputed_approved,
    'pending_hours', v_recomputed_pending
  );
END;
$$;

REVOKE ALL ON FUNCTION public.student_revise_shift_log(uuid, uuid, uuid, text, numeric, text, boolean, text, text, boolean, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.student_revise_shift_log(uuid, uuid, uuid, text, numeric, text, boolean, text, text, boolean, text, text, text, text, text)
  TO service_role;

-- Existing clients call this probe. Requiring the new RPC makes deployment
-- fail closed until the reviewed-entry correction path is available.
CREATE OR REPLACE FUNCTION public.student_shift_edit_ready()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT to_regclass('public.student_shift_log_edits') IS NOT NULL
     AND to_regclass('public.student_shift_plans') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'student_revise_shift_log')
     AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'student_void_shift_log');
$$;

REVOKE ALL ON FUNCTION public.student_shift_edit_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.student_shift_edit_ready() TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
