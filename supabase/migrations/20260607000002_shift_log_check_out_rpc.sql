-- Phase S.2.B3.A: shift_log_check_out RPC function
--
-- Atomically transitions an in_progress shift to completed AND recomputes
-- the matched student's approved_hours and pending_hours from authoritative
-- completed shift logs in a single transaction.
--
-- Security model:
--   - SECURITY INVOKER (caller's permissions; caller is service_role via Vercel endpoint)
--   - Fixed safe search_path (pg_catalog, public) to prevent search_path injection
--   - REVOKE EXECUTE FROM PUBLIC, anon, authenticated
--   - GRANT EXECUTE TO service_role only
--
-- Defense-in-depth invariant validation (early checks, before any lock or write):
--   - p_total_hours must be NOT NULL and between 1 and 13 inclusive
--   - p_shift_type must be one of 'Day', 'Night', 'Mid'
--   - p_attestation must be TRUE
--   - p_status must be 'Auto-Accepted' or 'Pending Review' (administrative statuses are later workflows)
--   - p_exception_flags must be a non-NULL jsonb array
--   - p_is_assigned_unit and p_is_assigned_preceptor must be NOT NULL (final assignment answers required)
--   - Status/flag/review_reason consistency:
--       Auto-Accepted requires 0 flags AND null/blank review_reason
--       Pending Review requires >= 1 flag AND non-blank review_reason
-- These guard against internal caller bugs even if the endpoint validation is bypassed.
-- The endpoint owns rich form-reproduction validation (matching ShiftLogPage.jsx).
-- The RPC owns contract-level invariants.
--
-- Ownership enforcement (defense in depth):
--   - Function requires both p_shift_id AND p_student_id
--   - Guarded UPDATE matches both id AND student_id AND lifecycle_state='in_progress'
--   - Student row locked via SELECT ... FOR UPDATE before transition
--
-- Idempotency:
--   - Guarded UPDATE returns 0 rows if shift is not in_progress or ownership mismatch
--   - Function raises 'shift_not_in_progress' exception in that case
--   - Endpoint catches the exception and translates to appropriate HTTP response
--
-- Totals recomputation:
--   - Approved bucket: status IN ('Auto-Accepted', 'Approved')
--   - Pending bucket: status IN ('Pending Review')
--   - Excluded: 'Rejected', 'Edited', non-completed lifecycle states
--   - Recomputes from authoritative completed shift logs (corrects any existing drift)
--
-- Preserves at check-out:
--   - checked_in_at (set at check-in)
--   - shift_date (Pacific date at check-in)
--   - planned values (planned_unit_name, planned_preceptor_name, planned_shift_type, expected_hours)
--   - student_id, cohort_id (set at check-in)
--   - school_email (canonical, set at check-in)
--
-- Sets at check-out:
--   - lifecycle_state = 'completed'
--   - checked_out_at = NOW()
--   - submitted_at = NOW()
--   - total_hours, shift_type, unit_name, preceptor_name (final values)
--   - is_assigned_unit, unit_override_reason, is_assigned_preceptor, preceptor_override_note
--   - learning_highlight, support_needed, attestation
--   - status, exception_flags, review_reason (computed by endpoint)
--
-- Return shape (nested):
--   {
--     "shift": { ...completed shift fields... },
--     "totals": { "approved_hours": <numeric>, "pending_hours": <numeric> }
--   }
--
-- Custom exception taxonomy:
--   - P0001 'shift_not_in_progress'          — guarded UPDATE affected 0 rows
--   - P0002 'student_not_found'              — student row lock found no row
--   - P0003 'invalid_total_hours'            — p_total_hours NULL or out of [1, 13]
--   - P0004 'invalid_shift_type'             — p_shift_type not in ('Day','Night','Mid')
--   - P0005 'attestation_required'           — p_attestation not TRUE
--   - P0006 'invalid_status'                 — p_status not in ('Auto-Accepted','Pending Review')
--   - P0007 'invalid_exception_flags'        — p_exception_flags NULL or not a jsonb array
--   - P0008 'inconsistent_review_outcome'    — status/flags/review_reason internally inconsistent
--   - P0009 'assignment_indicators_required' — is_assigned_unit or is_assigned_preceptor NULL
--
-- This migration is:
--   - additive only (CREATE OR REPLACE; no DROP statements)
--   - idempotent at the SQL level (CREATE OR REPLACE; REVOKE/GRANT repeatable)
--   - preserves all existing data, indexes, RLS policies
--   - does not modify any existing column or constraint
--   - does not modify any existing function
--
-- Owner runs this manually in Supabase SQL Editor after review.

CREATE OR REPLACE FUNCTION public.shift_log_check_out(
  p_shift_id uuid,
  p_student_id uuid,
  p_total_hours numeric,
  p_shift_type text,
  p_unit_name text,
  p_preceptor_name text,
  p_is_assigned_unit boolean,
  p_unit_override_reason text,
  p_is_assigned_preceptor boolean,
  p_preceptor_override_note text,
  p_learning_highlight text,
  p_support_needed text,
  p_attestation boolean,
  p_status text,
  p_exception_flags jsonb,
  p_review_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_shift public.student_shift_logs%ROWTYPE;
  v_updated_count integer;
  v_recomputed_approved numeric;
  v_recomputed_pending numeric;
  v_flag_count integer;
  v_review_reason_blank boolean;
BEGIN
  -- ── Defense-in-depth invariant validation (before any lock or write) ────────

  -- P0003: total_hours invariant
  IF p_total_hours IS NULL OR p_total_hours < 1 OR p_total_hours > 13 THEN
    RAISE EXCEPTION 'invalid_total_hours' USING ERRCODE = 'P0003';
  END IF;

  -- P0004: shift_type invariant
  IF p_shift_type IS NULL OR p_shift_type NOT IN ('Day', 'Night', 'Mid') THEN
    RAISE EXCEPTION 'invalid_shift_type' USING ERRCODE = 'P0004';
  END IF;

  -- P0005: attestation invariant
  IF p_attestation IS NOT TRUE THEN
    RAISE EXCEPTION 'attestation_required' USING ERRCODE = 'P0005';
  END IF;

  -- P0006: status invariant
  IF p_status IS NULL OR p_status NOT IN ('Auto-Accepted', 'Pending Review') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'P0006';
  END IF;

  -- P0007: exception_flags invariant (must be a jsonb array)
  IF p_exception_flags IS NULL OR jsonb_typeof(p_exception_flags) <> 'array' THEN
    RAISE EXCEPTION 'invalid_exception_flags' USING ERRCODE = 'P0007';
  END IF;

  -- P0009: assignment indicators required for completed shifts
  IF p_is_assigned_unit IS NULL OR p_is_assigned_preceptor IS NULL THEN
    RAISE EXCEPTION 'assignment_indicators_required' USING ERRCODE = 'P0009';
  END IF;

  -- P0008: status / flags / review_reason internal consistency.
  -- jsonb_array_length is safe here because P0007 confirmed the type is 'array'.
  v_flag_count := jsonb_array_length(p_exception_flags);
  v_review_reason_blank := (p_review_reason IS NULL OR btrim(p_review_reason) = '');

  IF p_status = 'Auto-Accepted' THEN
    IF v_flag_count <> 0 OR NOT v_review_reason_blank THEN
      RAISE EXCEPTION 'inconsistent_review_outcome' USING ERRCODE = 'P0008';
    END IF;
  ELSIF p_status = 'Pending Review' THEN
    IF v_flag_count = 0 OR v_review_reason_blank THEN
      RAISE EXCEPTION 'inconsistent_review_outcome' USING ERRCODE = 'P0008';
    END IF;
  END IF;
  -- P0006 already guarantees p_status is one of the two values; no else needed.

  -- ── Lock the student row to serialize concurrent check-outs per student ─────
  -- Also implicitly validates the student exists.
  PERFORM 1 FROM public.students WHERE id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- ── Guarded shift transition (ownership + lifecycle enforced in SQL) ────────
  UPDATE public.student_shift_logs
  SET
    lifecycle_state         = 'completed',
    checked_out_at          = NOW(),
    submitted_at            = NOW(),
    total_hours             = p_total_hours,
    shift_type              = p_shift_type,
    unit_name               = p_unit_name,
    preceptor_name          = p_preceptor_name,
    is_assigned_unit        = p_is_assigned_unit,
    unit_override_reason    = p_unit_override_reason,
    is_assigned_preceptor   = p_is_assigned_preceptor,
    preceptor_override_note = p_preceptor_override_note,
    learning_highlight      = p_learning_highlight,
    support_needed          = p_support_needed,
    attestation             = p_attestation,
    status                  = p_status,
    exception_flags         = p_exception_flags,
    review_reason           = p_review_reason
  WHERE id = p_shift_id
    AND student_id = p_student_id
    AND lifecycle_state = 'in_progress'
  RETURNING * INTO v_shift;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    -- shift_id missing, student_id mismatch, or not in_progress (already completed)
    RAISE EXCEPTION 'shift_not_in_progress' USING ERRCODE = 'P0001';
  END IF;

  -- ── Recompute totals from authoritative completed shift logs ────────────────
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

  -- ── Update student totals atomically with the shift transition ──────────────
  UPDATE public.students
  SET approved_hours = v_recomputed_approved,
      pending_hours  = v_recomputed_pending
  WHERE id = p_student_id;

  RETURN jsonb_build_object(
    'shift', row_to_json(v_shift)::jsonb,
    'totals', jsonb_build_object(
      'approved_hours', v_recomputed_approved,
      'pending_hours',  v_recomputed_pending
    )
  );
END;
$$;

-- Permissions: strict service_role-only access.
REVOKE ALL ON FUNCTION public.shift_log_check_out(
  uuid, uuid, numeric, text, text, text, boolean, text, boolean, text,
  text, text, boolean, text, jsonb, text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.shift_log_check_out(
  uuid, uuid, numeric, text, text, text, boolean, text, boolean, text,
  text, text, boolean, text, jsonb, text
) FROM anon;

REVOKE ALL ON FUNCTION public.shift_log_check_out(
  uuid, uuid, numeric, text, text, text, boolean, text, boolean, text,
  text, text, boolean, text, jsonb, text
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.shift_log_check_out(
  uuid, uuid, numeric, text, text, text, boolean, text, boolean, text,
  text, text, boolean, text, jsonb, text
) TO service_role;

COMMENT ON FUNCTION public.shift_log_check_out(
  uuid, uuid, numeric, text, text, text, boolean, text, boolean, text,
  text, text, boolean, text, jsonb, text
) IS 'Phase S.2.B3.A: atomically transitions in_progress shift to completed AND recomputes student totals from authoritative completed shift logs. SECURITY INVOKER. service_role-only. Defense-in-depth ownership via id+student_id+lifecycle_state guarded UPDATE. RPC-level invariant validation for total_hours [1,13], shift_type, attestation, status, exception_flags, assignment indicators, and status/flags/review_reason consistency. Returns {shift, totals} nested JSON.';

-- End of migration
