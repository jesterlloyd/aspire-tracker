-- =============================================================================
-- ASPIRE Post-Rotation Evaluation submit RPC
-- Migration: 20260709000000_postrotation_eval_submit
-- =============================================================================
--
-- Backend foundation for the ASPIRE Post-Rotation Evaluation (slug:
-- post_rotation_evaluation, timepoint: post_rotation). The student is BOTH the
-- subject (student_id) and the respondent (respondent_type = 'student'). Responses
-- are stored in the existing public.evaluation_responses table (form_type =
-- 'post_rotation_evaluation'); no new response table is introduced.
--
-- On a successful submission this function marks the assignment completed, consumes
-- the token, and then issues the Certificate of Participation metadata by calling the
-- existing public.issue_participation_certificate() (added in
-- 20260708000000_postrotation_cert_foundation). The certificate number is assigned
-- ONLY here, after completion. No PDF is generated and no email is sent.
--
-- Scope guardrails:
--   - ADDITIVE ONLY. New function name. Does NOT modify submit_evaluation_response
--     (Casey-Fink), submit_preceptor_evaluation_response (preceptor), or
--     submit_student_preceptor_evaluation_response (student experience), nor any
--     table, RLS, constraint, instrument, or token.
--   - Mirrors the proven token/assignment lifecycle of the sibling submit RPCs
--     (FOR UPDATE locks; expiry/revocation/completion/window/eligible-status).
--     Performs NO Casey-Fink scoring and leaves score_s1_* NULL.
--   - Section-level structural validation of the flat 13-key payload (required
--     ratings 1-5; required text non-empty; optional text may be blank; the yes/no
--     answer must be a boolean). Per-item wording lives in code; the RPC is the final
--     structural authority.
--   - Idempotent via CREATE OR REPLACE + named GRANT/REVOKE; safe to re-run.
--   - No rollback SQL in this migration body.
--
-- HOW TO RUN: apply manually in the Supabase SQL Editor, verify, then this file
-- records it in the repo migration history. Do NOT apply automatically.
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
  v_cert             JSONB;
  -- Canonical response keys, by type.
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
  -- Lock the token row.
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

  -- Lock the assignment row.
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

  -- This RPC only ever processes STUDENT-completed post-rotation assignments.
  IF v_assignment.respondent_type IS DISTINCT FROM 'student'
     OR v_assignment.timepoint IS DISTINCT FROM 'post_rotation' THEN
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
  IF v_inst_slug IS DISTINCT FROM 'post_rotation_evaluation'
     OR v_inst_perm_status IS NULL
     OR v_inst_perm_status <> 'authorized' THEN
    RETURN jsonb_build_object('status', 'assignment_state_invalid');
  END IF;

  -- ── Structural validation of the flat response object. ──
  IF p_responses IS NULL OR jsonb_typeof(p_responses) <> 'object' THEN
    RETURN jsonb_build_object('status', 'responses_invalid');
  END IF;

  -- Required ratings: present, JSON number, integer 1-5.
  FOREACH v_key IN ARRAY v_required_ratings LOOP
    IF NOT (p_responses ? v_key) OR jsonb_typeof(p_responses->v_key) <> 'number' THEN
      RETURN jsonb_build_object('status', 'responses_invalid');
    END IF;
    v_num := floor((p_responses->>v_key)::numeric)::int;
    IF (p_responses->>v_key)::numeric <> v_num OR v_num < 1 OR v_num > 5 THEN
      RETURN jsonb_build_object('status', 'responses_invalid');
    END IF;
  END LOOP;

  -- Required texts: present, JSON string, non-empty after trim.
  FOREACH v_key IN ARRAY v_required_texts LOOP
    IF NOT (p_responses ? v_key)
       OR jsonb_typeof(p_responses->v_key) <> 'string'
       OR btrim(p_responses->>v_key) = '' THEN
      RETURN jsonb_build_object('status', 'responses_invalid');
    END IF;
  END LOOP;

  -- Optional texts: if present, must be a JSON string (blank allowed).
  FOREACH v_key IN ARRAY v_optional_texts LOOP
    IF (p_responses ? v_key) AND jsonb_typeof(p_responses->v_key) <> 'string' THEN
      RETURN jsonb_build_object('status', 'responses_invalid');
    END IF;
  END LOOP;

  -- Yes/no consent: present and boolean.
  IF NOT (p_responses ? 'may_use_anonymized_comments')
     OR jsonb_typeof(p_responses->'may_use_anonymized_comments') <> 'boolean' THEN
    RETURN jsonb_build_object('status', 'responses_invalid');
  END IF;

  -- Snapshot the student's approved hours (subject), mirroring the sibling RPCs.
  SELECT s.approved_hours INTO v_approved_hours
  FROM public.students s
  WHERE s.id = v_assignment.student_id;

  -- Insert the response. score_s1_* stay NULL (no Casey-Fink scoring). The Stage 1 composite FK
  -- is satisfied via the assignment identity columns.
  INSERT INTO public.evaluation_responses (
    assignment_id, instrument_id, student_id, cohort_id, timepoint,
    form_type, responses, submitted_at, locked_at
  ) VALUES (
    v_assignment.id, v_assignment.instrument_id, v_assignment.student_id,
    v_assignment.cohort_id, v_assignment.timepoint,
    'post_rotation_evaluation', p_responses, v_submitted_at, v_submitted_at
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

  -- Issue the Certificate of Participation metadata now that the evaluation is completed. This is
  -- idempotent and assigns the certificate number (ASPIRE-YYYY-NNN). It runs in THIS transaction,
  -- so the completed_at set above is visible to it. It never generates a PDF or sends an email.
  v_cert := public.issue_participation_certificate(v_assignment.id);

  RETURN jsonb_build_object(
    'status', 'success',
    'submitted_at', v_submitted_at,
    'certificate_status', v_cert->>'status',
    'certificate_number', v_cert->>'certificate_number'
  );
END;
$$;

COMMENT ON FUNCTION public.submit_post_rotation_evaluation_response(TEXT, JSONB) IS
  'Atomic submission of an ASPIRE Post-Rotation Evaluation response. Independent of the Casey-Fink, preceptor, and student-experience submit RPCs, all unchanged. Requires respondent_type = student, timepoint = post_rotation, and instrument slug = post_rotation_evaluation with permission_status = authorized. Validates the flat 13-key payload structurally (required ratings 1-5; required text non-empty; optional text may be blank; may_use_anonymized_comments boolean), inserts into evaluation_responses with form_type = post_rotation_evaluation using the assignment identity columns, marks the assignment completed, consumes the token, then issues the Certificate of Participation metadata via issue_participation_certificate() in the same transaction. Never generates a PDF or sends email. Service-role execution only. Statuses: success (with submitted_at, certificate_status, certificate_number), token_invalid, assignment_state_invalid, assignment_window_closed, responses_invalid.';

REVOKE ALL ON FUNCTION public.submit_post_rotation_evaluation_response(TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_post_rotation_evaluation_response(TEXT, JSONB)
  TO service_role;

NOTIFY pgrst, 'reload schema';
