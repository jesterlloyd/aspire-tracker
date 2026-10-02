-- Student self-service remains available until BOTH approved hours and the
-- scheduled school rotation window are complete. Never use last logged shift
-- dates, a manual status, or certificate issuance as the scheduled end date.
BEGIN;
CREATE OR REPLACE FUNCTION public.student_shift_edit_eligibility(p_shift_id uuid, p_student_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_shift record;
  v_required numeric;
  v_approved numeric;
  v_end date;
BEGIN
  SELECT id, status, lifecycle_state INTO v_shift
    FROM public.student_shift_logs WHERE id = p_shift_id AND student_id = p_student_id;
  IF v_shift.id IS NULL THEN
    RETURN jsonb_build_object('editable', false, 'reason', 'not_found');
  END IF;
  IF v_shift.lifecycle_state = 'voided' THEN
    RETURN jsonb_build_object('editable', false, 'reason', 'already_voided');
  END IF;
  IF v_shift.lifecycle_state IS DISTINCT FROM 'completed' THEN
    RETURN jsonb_build_object('editable', false, 'reason', 'shift_in_progress');
  END IF;
  IF v_shift.status IS NULL OR v_shift.status NOT IN ('Auto-Accepted', 'Pending Review', 'Approved', 'Rejected') THEN
    RETURN jsonb_build_object('editable', false, 'reason', 'not_editable');
  END IF;
  SELECT s.hours_required, NULLIF(r.rotation_end_date::date, DATE '1900-01-01')
    INTO v_required, v_end
    FROM public.students s LEFT JOIN public.cohort_school_rotations r
      ON r.id = s.cohort_school_rotation_id
    WHERE s.id = p_student_id;
  SELECT COALESCE(SUM(total_hours), 0) INTO v_approved
    FROM public.student_shift_logs
    WHERE student_id = p_student_id AND lifecycle_state = 'completed'
      AND status IN ('Auto-Accepted', 'Approved');
  IF v_required > 0 AND v_approved >= v_required
     AND v_end < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date THEN
    RETURN jsonb_build_object('editable', false, 'reason', 'rotation_window_closed');
  END IF;
  RETURN jsonb_build_object('editable', true, 'reason', 'ok');
END;
$$;
REVOKE ALL ON FUNCTION public.student_shift_edit_eligibility(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.student_shift_edit_eligibility(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.student_void_shift_log(
  p_shift_id         uuid,
  p_student_id       uuid,
  p_actor_profile_id uuid,
  p_reason           text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_before              record;
  v_verdict             jsonb;
  v_recomputed_approved numeric(6,2);
  v_recomputed_pending  numeric(6,2);
  v_updated             integer;
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

  -- Lifecycle only. Status, hours, unit, preceptor, and flags are left exactly
  -- as submitted so the withdrawn entry still reads as what the student
  -- entered - it simply no longer counts anywhere.
  UPDATE public.student_shift_logs
  SET lifecycle_state = 'voided'
  WHERE id = p_shift_id
    AND student_id = p_student_id
    AND lifecycle_state = 'completed'
    AND status IN ('Auto-Accepted', 'Pending Review', 'Approved', 'Rejected');
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
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
    'voided', p_actor_profile_id, COALESCE(btrim(p_reason), ''),
    COALESCE(v_before.status, ''), COALESCE(v_before.lifecycle_state, ''),
    COALESCE(v_before.shift_date, ''), v_before.total_hours,
    COALESCE(v_before.unit_name, ''), COALESCE(v_before.preceptor_name, ''),
    COALESCE(v_before.shift_type, ''),
    COALESCE(v_before.exception_flags, '[]'::jsonb), v_before.review_reason,
    COALESCE(v_before.status, ''), 'voided',
    COALESCE(v_before.shift_date, ''), v_before.total_hours,
    COALESCE(v_before.unit_name, ''), COALESCE(v_before.preceptor_name, ''),
    COALESCE(v_before.shift_type, ''),
    COALESCE(v_before.exception_flags, '[]'::jsonb), v_before.review_reason,
    v_recomputed_approved, v_recomputed_pending
  );

  RETURN jsonb_build_object(
    'ok', true,
    'action', 'voided',
    'shift_id', p_shift_id,
    'student_id', p_student_id,
    'withdrawn_hours', v_before.total_hours,
    'approved_hours', v_recomputed_approved,
    'pending_hours', v_recomputed_pending
  );
END;
$$;

REVOKE ALL ON FUNCTION public.student_void_shift_log(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.student_void_shift_log(uuid, uuid, uuid, text)
  TO service_role;


CREATE OR REPLACE FUNCTION public.student_shift_self_service_v2_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public
AS $$ SELECT public.student_shift_edit_ready(); $$;
REVOKE ALL ON FUNCTION public.student_shift_self_service_v2_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.student_shift_self_service_v2_ready() TO service_role;
COMMIT;
