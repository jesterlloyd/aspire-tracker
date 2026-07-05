-- =============================================================================
-- SR-2-pre: Dedicated student-completed survey submit RPC
-- Migration: 20260616000000_sr2_pre_submit_student_preceptor_evaluation_response_rpc
-- =============================================================================
--
-- Backend foundation for the new "Student Evaluation of Preceptor/Unit Experience"
-- survey (slug: student_preceptor_eval). The student is BOTH the subject (student_id)
-- and the respondent (respondent_type = 'student', respondent_email = the student's
-- email). The preceptor/unit being evaluated is the evaluated_target ONLY and is carried
-- inside the response JSON (responses.evaluated_target) - it is NOT modeled as the
-- respondent and must never be written to respondent_preceptor_id.
--
-- Scope guardrails (SR-2-pre only):
--   - ADDITIVE ONLY. New function name. Does NOT modify public.submit_evaluation_response
--     (Casey-Fink) or public.submit_preceptor_evaluation_response (preceptor), nor any
--     table, RLS, constraint, instrument, or token.
--   - Mirrors the proven token/assignment lifecycle of the preceptor RPC; performs NO
--     Casey-Fink scoring and leaves score_s1_* NULL.
--   - Section-level shape validation only (objects present + affirmative attestation +
--     narrative string typing). Per-item scale/value validation is enforced by the SR-2
--     validation module and the client; the RPC remains the final structural authority.
--   - No rollback SQL in this migration body. Idempotent via CREATE OR REPLACE + named
--     GRANT/REVOKE; safe to re-run.
--
-- HOW TO RUN: apply manually in the Supabase SQL editor, verify, then this file records it
-- in the repo migration history (PS-2b-pre pattern). Do not apply automatically.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.submit_student_preceptor_evaluation_response(
  p_token_hash TEXT,
  p_responses  JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_token            public.evaluation_assignment_tokens%ROWTYPE;
  v_assignment       public.evaluation_assignments%ROWTYPE;
  v_inst_slug        TEXT;
  v_inst_perm_status TEXT;
  v_approved_hours   NUMERIC(6,2);
  v_response_id      UUID;
  v_submitted_at     TIMESTAMPTZ := now();
  v_narrative        JSONB;
BEGIN
  -- Lock the token row
  SELECT * INTO v_token
  FROM public.evaluation_assignment_tokens
  WHERE token_hash = p_token_hash
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'token_invalid');
  END IF;

  IF v_token.revoked_at IS NOT NULL
     OR v_token.expires_at <= v_submitted_at
     OR v_token.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'token_invalid');
  END IF;

  -- Lock the assignment row
  SELECT * INTO v_assignment
  FROM public.evaluation_assignments
  WHERE id = v_token.assignment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'token_invalid');
  END IF;

  -- Already completed: never accept resubmission.
  IF v_assignment.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'token_invalid');
  END IF;

  -- Ineligible assignment state.
  IF v_assignment.revoked_at IS NOT NULL
     OR v_assignment.status NOT IN ('sent', 'opened', 'reminder_due') THEN
    RETURN jsonb_build_object('status', 'assignment_state_invalid');
  END IF;

  -- Response window closed.
  IF v_assignment.expires_at IS NOT NULL AND v_assignment.expires_at <= v_submitted_at THEN
    RETURN jsonb_build_object('status', 'assignment_window_closed');
  END IF;

  -- This RPC only ever processes STUDENT-completed assignments. A preceptor or Casey-Fink
  -- token is rejected here (the preceptor RPC likewise requires respondent_type = preceptor).
  -- respondent_email is the student's own email (resolved server-side at send time).
  IF v_assignment.respondent_type IS DISTINCT FROM 'student'
     OR v_assignment.respondent_email IS NULL THEN
    RETURN jsonb_build_object('status', 'assignment_state_invalid');
  END IF;

  -- Instrument authorization + identity gate (defense in depth), read FOR SHARE.
  SELECT slug, permission_status INTO v_inst_slug, v_inst_perm_status
  FROM public.evaluation_instruments
  WHERE id = v_assignment.instrument_id
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'assignment_state_invalid');
  END IF;
  IF v_inst_slug IS DISTINCT FROM 'student_preceptor_eval'
     OR v_inst_perm_status IS NULL
     OR v_inst_perm_status <> 'authorized' THEN
    RETURN jsonb_build_object('status', 'assignment_state_invalid');
  END IF;

  -- ── Section-level structural validation of the section-keyed payload. ──
  -- (Per-item scale/value validation is handled by the SR-2 validation module + client.)
  IF p_responses IS NULL OR jsonb_typeof(p_responses) <> 'object' THEN
    RETURN jsonb_build_object('status', 'responses_invalid');
  END IF;

  -- Required section objects (evaluated_target carries the rated preceptor/unit context).
  IF NOT (p_responses ? 'evaluated_target')      OR jsonb_typeof(p_responses->'evaluated_target')      <> 'object' THEN RETURN jsonb_build_object('status','responses_invalid'); END IF;
  IF NOT (p_responses ? 'preceptor_support')     OR jsonb_typeof(p_responses->'preceptor_support')     <> 'object' THEN RETURN jsonb_build_object('status','responses_invalid'); END IF;
  IF NOT (p_responses ? 'learning_environment')  OR jsonb_typeof(p_responses->'learning_environment')  <> 'object' THEN RETURN jsonb_build_object('status','responses_invalid'); END IF;
  IF NOT (p_responses ? 'psychological_safety')  OR jsonb_typeof(p_responses->'psychological_safety')  <> 'object' THEN RETURN jsonb_build_object('status','responses_invalid'); END IF;
  IF NOT (p_responses ? 'overall_experience')    OR jsonb_typeof(p_responses->'overall_experience')    <> 'object' THEN RETURN jsonb_build_object('status','responses_invalid'); END IF;

  -- Narrative must be an object; its text fields, when present, must be strings.
  IF NOT (p_responses ? 'narrative') OR jsonb_typeof(p_responses->'narrative') <> 'object' THEN
    RETURN jsonb_build_object('status', 'responses_invalid');
  END IF;
  v_narrative := p_responses->'narrative';
  IF (v_narrative ? 'strengths'   AND jsonb_typeof(v_narrative->'strengths')   <> 'string')
     OR (v_narrative ? 'suggestions' AND jsonb_typeof(v_narrative->'suggestions') <> 'string')
     OR (v_narrative ? 'open_comment' AND jsonb_typeof(v_narrative->'open_comment') <> 'string') THEN
    RETURN jsonb_build_object('status', 'responses_invalid');
  END IF;

  -- Attestation must be an object whose attestation_confirmed is boolean true.
  IF NOT (p_responses ? 'attestation')
     OR jsonb_typeof(p_responses->'attestation') <> 'object'
     OR (p_responses->'attestation'->'attestation_confirmed') IS DISTINCT FROM 'true'::jsonb THEN
    RETURN jsonb_build_object('status', 'responses_invalid');
  END IF;

  -- Snapshot the student's approved hours (subject), mirroring the preceptor/Casey RPCs.
  SELECT s.approved_hours INTO v_approved_hours
  FROM public.students s
  WHERE s.id = v_assignment.student_id;

  -- Insert the response. score_s1_* are left NULL (no Casey-Fink scoring). The Stage 1
  -- composite FK is satisfied via the assignment identity columns.
  INSERT INTO public.evaluation_responses (
    assignment_id, instrument_id, student_id, cohort_id, timepoint,
    form_type, responses, submitted_at, locked_at
  ) VALUES (
    v_assignment.id, v_assignment.instrument_id, v_assignment.student_id,
    v_assignment.cohort_id, v_assignment.timepoint,
    'student_preceptor_eval', p_responses, v_submitted_at, v_submitted_at
  )
  RETURNING id INTO v_response_id;

  -- Mark the assignment completed.
  UPDATE public.evaluation_assignments
  SET status = 'completed',
      completed_at = v_submitted_at,
      approved_hours_at_completion = v_approved_hours,
      updated_at = v_submitted_at
  WHERE id = v_assignment.id;

  -- Consume the token (single use).
  UPDATE public.evaluation_assignment_tokens
  SET used_at = v_submitted_at
  WHERE id = v_token.id;

  RETURN jsonb_build_object('status', 'success', 'submitted_at', v_submitted_at);
END;
$$;

COMMENT ON FUNCTION public.submit_student_preceptor_evaluation_response(TEXT, JSONB) IS
  'SR-2-pre: atomic submission of an ASPIRE Student Evaluation of Preceptor/Unit Experience response. Independent of submit_evaluation_response (Casey-Fink) and submit_preceptor_evaluation_response (preceptor), both unchanged. Mirrors the token+assignment lifecycle (FOR UPDATE locks; expiry/revocation/completion/window/eligible-status). Requires respondent_type = student, respondent_email NOT NULL, and instrument slug = student_preceptor_eval with permission_status = authorized. Section-level validation only: evaluated_target, preceptor_support, learning_environment, psychological_safety, overall_experience, and narrative must be objects; narrative text fields (when present) must be strings; attestation must be an object whose attestation_confirmed is boolean true. The student is the subject and respondent; the evaluated preceptor/unit is carried in responses.evaluated_target, never in respondent_preceptor_id. Performs NO Casey-Fink Section I scoring (score_s1_* left NULL). Snapshots students.approved_hours into approved_hours_at_completion, inserts with form_type = student_preceptor_eval using the assignment identity columns, marks the assignment completed, and consumes the token, atomically. Service-role execution only. Statuses: success (with submitted_at), token_invalid, assignment_state_invalid, assignment_window_closed, responses_invalid.';

REVOKE ALL ON FUNCTION public.submit_student_preceptor_evaluation_response(TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_student_preceptor_evaluation_response(TEXT, JSONB)
  TO service_role;

NOTIFY pgrst, 'reload schema';
