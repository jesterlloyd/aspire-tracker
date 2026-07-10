-- =============================================================================
-- Pause certificate issuance on the ASPIRE Post-Rotation Evaluation
-- Migration: 20260710000000_pause_postrotation_eval_certificate_issue
-- =============================================================================
--
-- The Certificate of Participation gate is moving to the Casey-Fink Readiness for
-- Practice Survey administered at timepoint post_rotation (see the companion
-- migration 20260710000001_caseyfink_post_rotation_certificate_gate). Until then,
-- the ASPIRE Post-Rotation Evaluation must STOP issuing certificates.
--
-- This migration replaces public.submit_post_rotation_evaluation_response() with the
-- exact same behavior EXCEPT it no longer calls public.issue_participation_certificate()
-- and returns certificate_status = null and certificate_number = null. Everything else
-- is preserved: response insert into evaluation_responses, assignment completion,
-- token consumption, structural validation, SECURITY DEFINER, search_path, and the
-- service_role-only EXECUTE grant.
--
-- No evaluation questions, response storage, or certificate tables are changed.
--
-- HOW TO RUN: apply manually in the Supabase SQL Editor, verify, then record here.
-- Do NOT apply automatically. Idempotent via CREATE OR REPLACE; safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.submit_post_rotation_evaluation_response(
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
  v_required_ratings TEXT[] := ARRAY[
    'overall_valuable_learning_experience',
    'confidence_clinical_setting',
    'readiness_transition_to_practice',
    'supportive_learning_environment',
    'included_as_care_team',
    'increased_interest_cedars_sinai',
    'understand_new_grad_expectations'
  ];
  v_required_texts   TEXT[] := ARRAY[
    'most_valuable_part',
    'improved_skills_behaviors_learning',
    'final_reflection'
  ];
  v_optional_texts   TEXT[] := ARRAY[
    'improve_learning_experience',
    'support_for_interview_or_transition'
  ];
  v_key              TEXT;
  v_num              INTEGER;
BEGIN
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

  SELECT * INTO v_assignment
  FROM public.evaluation_assignments
  WHERE id = v_token.assignment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'token_invalid');
  END IF;

  IF v_assignment.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'token_invalid');
  END IF;

  IF v_assignment.revoked_at IS NOT NULL
     OR v_assignment.status NOT IN ('sent', 'opened', 'reminder_due') THEN
    RETURN jsonb_build_object('status', 'assignment_state_invalid');
  END IF;

  IF v_assignment.expires_at IS NOT NULL AND v_assignment.expires_at <= v_submitted_at THEN
    RETURN jsonb_build_object('status', 'assignment_window_closed');
  END IF;

  IF v_assignment.respondent_type IS DISTINCT FROM 'student'
     OR v_assignment.timepoint IS DISTINCT FROM 'post_rotation' THEN
    RETURN jsonb_build_object('status', 'assignment_state_invalid');
  END IF;

  SELECT slug, permission_status INTO v_inst_slug, v_inst_perm_status
  FROM public.evaluation_instruments
  WHERE id = v_assignment.instrument_id
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'assignment_state_invalid');
  END IF;
  IF v_inst_slug IS DISTINCT FROM 'post_rotation_evaluation'
     OR v_inst_perm_status IS NULL
     OR v_inst_perm_status <> 'authorized' THEN
    RETURN jsonb_build_object('status', 'assignment_state_invalid');
  END IF;

  IF p_responses IS NULL OR jsonb_typeof(p_responses) <> 'object' THEN
    RETURN jsonb_build_object('status', 'responses_invalid');
  END IF;

  FOREACH v_key IN ARRAY v_required_ratings LOOP
    IF NOT (p_responses ? v_key) OR jsonb_typeof(p_responses->v_key) <> 'number' THEN
      RETURN jsonb_build_object('status', 'responses_invalid');
    END IF;
    v_num := floor((p_responses->>v_key)::numeric)::int;
    IF (p_responses->>v_key)::numeric <> v_num OR v_num < 1 OR v_num > 5 THEN
      RETURN jsonb_build_object('status', 'responses_invalid');
    END IF;
  END LOOP;

  FOREACH v_key IN ARRAY v_required_texts LOOP
    IF NOT (p_responses ? v_key)
       OR jsonb_typeof(p_responses->v_key) <> 'string'
       OR btrim(p_responses->>v_key) = '' THEN
      RETURN jsonb_build_object('status', 'responses_invalid');
    END IF;
  END LOOP;

  FOREACH v_key IN ARRAY v_optional_texts LOOP
    IF (p_responses ? v_key) AND jsonb_typeof(p_responses->v_key) <> 'string' THEN
      RETURN jsonb_build_object('status', 'responses_invalid');
    END IF;
  END LOOP;

  IF NOT (p_responses ? 'may_use_anonymized_comments')
     OR jsonb_typeof(p_responses->'may_use_anonymized_comments') <> 'boolean' THEN
    RETURN jsonb_build_object('status', 'responses_invalid');
  END IF;

  SELECT s.approved_hours INTO v_approved_hours
  FROM public.students s
  WHERE s.id = v_assignment.student_id;

  INSERT INTO public.evaluation_responses (
    assignment_id, instrument_id, student_id, cohort_id, timepoint,
    form_type, responses, submitted_at, locked_at
  ) VALUES (
    v_assignment.id, v_assignment.instrument_id, v_assignment.student_id,
    v_assignment.cohort_id, v_assignment.timepoint,
    'post_rotation_evaluation', p_responses, v_submitted_at, v_submitted_at
  )
  RETURNING id INTO v_response_id;

  UPDATE public.evaluation_assignments
  SET status = 'completed',
      completed_at = v_submitted_at,
      approved_hours_at_completion = v_approved_hours,
      updated_at = v_submitted_at
  WHERE id = v_assignment.id;

  UPDATE public.evaluation_assignment_tokens
  SET used_at = v_submitted_at
  WHERE id = v_token.id;

  -- CERTIFICATE ISSUANCE REMOVED. The ASPIRE Post-Rotation Evaluation no longer gates the
  -- Certificate of Participation; the Casey-Fink post_rotation survey is now the gate. The
  -- response, completion, and token consumption above are unchanged.
  RETURN jsonb_build_object(
    'status', 'success',
    'submitted_at', v_submitted_at,
    'certificate_status', NULL,
    'certificate_number', NULL
  );
END;
$$;

COMMENT ON FUNCTION public.submit_post_rotation_evaluation_response(TEXT, JSONB) IS
  'Atomic submission of an ASPIRE Post-Rotation Evaluation response (experience feedback). As of the Casey-Fink certificate gate, this function NO LONGER issues a Certificate of Participation; it inserts the response into evaluation_responses (form_type = post_rotation_evaluation), marks the assignment completed, and consumes the token. Requires respondent_type = student, timepoint = post_rotation, instrument slug = post_rotation_evaluation with permission_status = authorized. Structural validation of the flat 13-key payload unchanged. Never generates a PDF or sends email. Service-role execution only. Statuses: success (certificate_status and certificate_number are always null now), token_invalid, assignment_state_invalid, assignment_window_closed, responses_invalid.';

REVOKE ALL ON FUNCTION public.submit_post_rotation_evaluation_response(TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_post_rotation_evaluation_response(TEXT, JSONB)
  TO service_role;

NOTIFY pgrst, 'reload schema';
