-- =============================================================================
-- PS-2b-pre: Dedicated preceptor survey submit RPC
-- Migration: 20260613000001_ps2b_pre_submit_preceptor_evaluation_response_rpc
-- =============================================================================
--
-- Records the additive RPC designed in PS-2b-pre, manually applied in the Supabase SQL
-- Editor, and Owner-verified. Brings the repo migration history in sync with Production.
-- Idempotent: CREATE OR REPLACE FUNCTION + named GRANT/REVOKE; safe to re-run.
--
-- Purpose:
--   public.submit_preceptor_evaluation_response(p_token_hash text, p_responses jsonb)
--   supports the future ASPIRE Preceptor Student Progress & Readiness Feedback survey.
--
-- Scope guardrails (PS-2b-pre only):
--   - ADDITIVE ONLY. Does NOT modify public.submit_evaluation_response (Casey-Fink),
--     Casey-Fink scoring, any table, RLS, instruments, tokens, or invitations.
--   - Mirrors the existing token/assignment lifecycle safety; performs NO Casey-Fink
--     scoring and leaves score_s1_* NULL.
--   - student_id remains the SUBJECT; respondent_type = 'preceptor' identifies the
--     respondent (PS-2a columns).
--   - No rollback SQL in this migration body. No PS-2b UI/API/send logic.
--
-- Owner verification at apply time: function exists (SECURITY DEFINER true), EXECUTE
-- granted to service_role (postgres as owner), submit_evaluation_response unchanged,
-- and the negative smoke test returned {"status":"token_invalid"}.
--
-- HOW TO RUN: already applied manually in Production. Idempotent if re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.submit_preceptor_evaluation_response(
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

  -- This RPC only ever processes PRECEPTOR assignments. A Casey-Fink/student token (or
  -- any other instrument) is rejected here, just as the Casey-Fink RPC rejects a
  -- preceptor token by requiring Section I items.
  IF v_assignment.respondent_type IS DISTINCT FROM 'preceptor'
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
  IF v_inst_slug IS DISTINCT FROM 'preceptor_progress'
     OR v_inst_perm_status IS NULL
     OR v_inst_perm_status <> 'authorized' THEN
    RETURN jsonb_build_object('status', 'assignment_state_invalid');
  END IF;

  -- Structural validation of the section-keyed payload (NO Casey-Fink scoring).
  IF p_responses IS NULL OR jsonb_typeof(p_responses) <> 'object' THEN
    RETURN jsonb_build_object('status', 'responses_invalid');
  END IF;
  IF NOT (p_responses ? 'developmental_feedback')
     OR jsonb_typeof(p_responses->'developmental_feedback') <> 'object' THEN
    RETURN jsonb_build_object('status', 'responses_invalid');
  END IF;
  IF NOT (p_responses ? 'readiness_endorsement')
     OR jsonb_typeof(p_responses->'readiness_endorsement') <> 'object' THEN
    RETURN jsonb_build_object('status', 'responses_invalid');
  END IF;
  -- Attestation must be present and affirmatively set (object, string, or true).
  IF NOT (p_responses ? 'attestation')
     OR (p_responses->'attestation') IN ('false'::jsonb, 'null'::jsonb) THEN
    RETURN jsonb_build_object('status', 'responses_invalid');
  END IF;
  -- confidential_team_comments is optional; not required here.

  -- Snapshot the student's approved hours (subject), mirroring the Casey-Fink RPC.
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
    'preceptor_progress', p_responses, v_submitted_at, v_submitted_at
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

COMMENT ON FUNCTION public.submit_preceptor_evaluation_response(TEXT, JSONB) IS
  'PS-2b-pre: atomic submission of an ASPIRE Preceptor Student Progress & Readiness Feedback response. Independent of submit_evaluation_response (Casey-Fink), which is unchanged. Mirrors the token+assignment lifecycle (FOR UPDATE locks; expiry/revocation/completion/window/eligible-status). Additionally requires respondent_type = preceptor, respondent_email NOT NULL, and instrument slug = preceptor_progress with permission_status = authorized. Validates only payload shape (developmental_feedback object, readiness_endorsement object, attestation present/affirmative; confidential_team_comments optional); performs NO Casey-Fink Section I scoring and leaves score_s1_* NULL. Snapshots students.approved_hours into approved_hours_at_completion, inserts with form_type = preceptor_progress using the assignment identity columns, marks the assignment completed, and consumes the token, atomically. Service-role execution only. Statuses: success (with submitted_at), token_invalid, assignment_state_invalid, assignment_window_closed, responses_invalid.';

REVOKE ALL ON FUNCTION public.submit_preceptor_evaluation_response(TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_preceptor_evaluation_response(TEXT, JSONB)
  TO service_role;

NOTIFY pgrst, 'reload schema';
