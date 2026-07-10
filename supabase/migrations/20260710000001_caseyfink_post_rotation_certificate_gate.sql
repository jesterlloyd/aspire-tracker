-- =============================================================================
-- Casey-Fink post-rotation is the Certificate of Participation gate
-- Migration: 20260710000001_caseyfink_post_rotation_certificate_gate
-- =============================================================================
--
-- The Certificate of Participation is now unlocked by the Casey-Fink Readiness for
-- Practice Survey administered at timepoint post_rotation (student self-report). This
-- migration:
--   (1) generalizes public.issue_participation_certificate() so the gating assignment is a
--       COMPLETED, authorized Casey-Fink (casey_fink_readiness_2024) assignment at timepoint
--       post_rotation with respondent_type = student. Idempotency (one certificate per
--       student) and the per-year ASPIRE-YYYY-NNN sequence are unchanged.
--   (2) adds a gated issuance call to public.submit_evaluation_response() (the shared
--       Casey-Fink submit RPC) that fires ONLY for a student post_rotation Casey-Fink
--       submission. Baseline, early_rotation_baseline, and midpoint Casey-Fink NEVER issue.
--
-- Pre/post outcomes are preserved: each timepoint is a distinct assignment and a distinct
-- evaluation_responses row (identified by student_id, cohort_id, instrument_id, timepoint,
-- assignment_id, submitted_at). This migration does NOT modify Casey-Fink question content,
-- response storage, anonymity, or the certificate tables. No PDF is generated and no email is
-- sent by these functions.
--
-- Companion: 20260710000000_pause_postrotation_eval_certificate_issue removed issuance from
-- the ASPIRE Post-Rotation Evaluation submit RPC.
--
-- HOW TO RUN: apply manually in the Supabase SQL Editor after the companion migration,
-- verify, then record here. Do NOT apply automatically. Idempotent via CREATE OR REPLACE.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- (1) issue_participation_certificate: gate on completed Casey-Fink post_rotation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_participation_certificate(
  p_assignment_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_assignment public.evaluation_assignments%ROWTYPE;
  v_inst_slug  TEXT;
  v_inst_perm  TEXT;
  v_existing   public.certificates%ROWTYPE;
  v_year       INTEGER;
  v_seq        INTEGER;
  v_number     TEXT;
  v_cert_id    UUID;
  v_now        TIMESTAMPTZ := now();
BEGIN
  -- Lock the assignment.
  SELECT * INTO v_assignment
  FROM public.evaluation_assignments
  WHERE id = p_assignment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'assignment_not_found');
  END IF;

  -- Never issue before completion.
  IF v_assignment.completed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'not_completed');
  END IF;

  -- Gate: the assignment must be an authorized Casey-Fink Readiness survey, administered
  -- post-rotation, as a student self-report. Baseline/early_rotation_baseline/midpoint and any
  -- other instrument are rejected here.
  SELECT slug, permission_status INTO v_inst_slug, v_inst_perm
  FROM public.evaluation_instruments
  WHERE id = v_assignment.instrument_id
  FOR SHARE;
  IF NOT FOUND
     OR v_inst_slug IS DISTINCT FROM 'casey_fink_readiness_2024'
     OR v_inst_perm IS DISTINCT FROM 'authorized'
     OR v_assignment.timepoint IS DISTINCT FROM 'post_rotation'
     OR v_assignment.respondent_type IS DISTINCT FROM 'student' THEN
    RETURN jsonb_build_object('status', 'wrong_instrument');
  END IF;

  -- Idempotency: one certificate per student.
  SELECT * INTO v_existing
  FROM public.certificates
  WHERE student_id = v_assignment.student_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'already_issued',
      'certificate_number', v_existing.certificate_number,
      'certificate_year', v_existing.certificate_year,
      'certificate_sequence', v_existing.certificate_sequence,
      'certificate_unlocked_at', v_existing.certificate_unlocked_at
    );
  END IF;

  -- Certificate year = the year the student completed the gating survey.
  v_year := EXTRACT(YEAR FROM v_assignment.completed_at)::INTEGER;

  INSERT INTO public.certificate_sequences (year, next_seq)
  VALUES (v_year, 1)
  ON CONFLICT (year) DO NOTHING;

  SELECT next_seq INTO v_seq
  FROM public.certificate_sequences
  WHERE year = v_year
  FOR UPDATE;

  IF v_seq > 999 THEN
    RETURN jsonb_build_object('status', 'sequence_exhausted', 'year', v_year);
  END IF;

  UPDATE public.certificate_sequences
  SET next_seq = v_seq + 1, updated_at = v_now
  WHERE year = v_year;

  v_number := 'ASPIRE-' || v_year::TEXT || '-' || lpad(v_seq::TEXT, 3, '0');

  -- certificates.evaluation_assignment_id references the gating (Casey-Fink post_rotation)
  -- assignment. The post_rotation_evaluation_completed_at column stores the gating survey's
  -- completion timestamp (its name predates the gate change; no rename is done here).
  INSERT INTO public.certificates (
    student_id, evaluation_assignment_id, certificate_number,
    certificate_year, certificate_sequence,
    post_rotation_evaluation_completed_at, certificate_unlocked_at, released_by
  ) VALUES (
    v_assignment.student_id, p_assignment_id, v_number,
    v_year, v_seq,
    v_assignment.completed_at, v_now, v_assignment.assigned_by
  )
  RETURNING id INTO v_cert_id;

  RETURN jsonb_build_object(
    'status', 'issued',
    'certificate_id', v_cert_id,
    'certificate_number', v_number,
    'certificate_year', v_year,
    'certificate_sequence', v_seq,
    'certificate_unlocked_at', v_now
  );
END;
$$;

COMMENT ON FUNCTION public.issue_participation_certificate(UUID) IS
  'Atomically and idempotently issues an ASPIRE Certificate of Participation for a COMPLETED, authorized Casey-Fink (casey_fink_readiness_2024) assignment at timepoint post_rotation with respondent_type student. Assigns the next per-year sequence under a row lock (ASPIRE-YYYY-NNN); re-invocation for the same student returns the existing certificate. Service-role only. Statuses: issued, already_issued, not_completed, wrong_instrument, assignment_not_found, sequence_exhausted.';

REVOKE ALL ON FUNCTION public.issue_participation_certificate(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_participation_certificate(UUID)
  TO service_role;

-- ---------------------------------------------------------------------------
-- (2) submit_evaluation_response: issue the certificate after a completed student
--     post_rotation Casey-Fink submission. All other behavior is unchanged; baseline and
--     early_rotation_baseline submissions never issue. Casey-Fink question content, Section I
--     scoring, response storage, and pre/post linkage are untouched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_evaluation_response(
  p_token_hash TEXT,
  p_responses  JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_token                          public.evaluation_assignment_tokens%ROWTYPE;
  v_assignment                     public.evaluation_assignments%ROWTYPE;
  v_inst_slug                      TEXT;
  v_inst_perm_status               TEXT;
  v_approved_hours_at_completion   NUMERIC(6,2);
  v_response_id                    UUID;
  v_submitted_at                   TIMESTAMPTZ := now();
  v_cert                           JSONB;
  v_s1_q01 NUMERIC; v_s1_q02 NUMERIC; v_s1_q03 NUMERIC; v_s1_q04 NUMERIC; v_s1_q05 NUMERIC;
  v_s1_q06 NUMERIC; v_s1_q07 NUMERIC; v_s1_q08 NUMERIC; v_s1_q09 NUMERIC; v_s1_q10 NUMERIC;
  v_s1_q11 NUMERIC; v_s1_q12 NUMERIC; v_s1_q13 NUMERIC; v_s1_q14 NUMERIC; v_s1_q15 NUMERIC;
  v_score_s1_cps NUMERIC(5,3);
  v_score_s1_la  NUMERIC(5,3);
  v_score_s1_pr  NUMERIC(5,3);
BEGIN
  SELECT * INTO v_token
  FROM public.evaluation_assignment_tokens
  WHERE token_hash = p_token_hash
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'token_invalid');
  END IF;

  IF v_token.revoked_at IS NOT NULL OR
     v_token.expires_at <= v_submitted_at OR
     v_token.used_at IS NOT NULL THEN
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

  IF v_assignment.revoked_at IS NOT NULL OR
     v_assignment.status NOT IN ('sent', 'opened', 'reminder_due') THEN
    RETURN jsonb_build_object('status', 'assignment_state_invalid');
  END IF;

  IF v_assignment.expires_at IS NOT NULL AND v_assignment.expires_at <= v_submitted_at THEN
    RETURN jsonb_build_object('status', 'assignment_window_closed');
  END IF;

  SELECT slug, permission_status INTO v_inst_slug, v_inst_perm_status
  FROM public.evaluation_instruments
  WHERE id = v_assignment.instrument_id
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'assignment_state_invalid');
  END IF;
  IF v_inst_perm_status IS NULL OR v_inst_perm_status <> 'authorized' THEN
    RETURN jsonb_build_object('status', 'assignment_state_invalid');
  END IF;

  BEGIN
    v_s1_q01 := (p_responses->>'S1_Q01')::NUMERIC;
    v_s1_q02 := (p_responses->>'S1_Q02')::NUMERIC;
    v_s1_q03 := (p_responses->>'S1_Q03')::NUMERIC;
    v_s1_q04 := (p_responses->>'S1_Q04')::NUMERIC;
    v_s1_q05 := (p_responses->>'S1_Q05')::NUMERIC;
    v_s1_q06 := (p_responses->>'S1_Q06')::NUMERIC;
    v_s1_q07 := (p_responses->>'S1_Q07')::NUMERIC;
    v_s1_q08 := (p_responses->>'S1_Q08')::NUMERIC;
    v_s1_q09 := (p_responses->>'S1_Q09')::NUMERIC;
    v_s1_q10 := (p_responses->>'S1_Q10')::NUMERIC;
    v_s1_q11 := (p_responses->>'S1_Q11')::NUMERIC;
    v_s1_q12 := (p_responses->>'S1_Q12')::NUMERIC;
    v_s1_q13 := (p_responses->>'S1_Q13')::NUMERIC;
    v_s1_q14 := (p_responses->>'S1_Q14')::NUMERIC;
    v_s1_q15 := (p_responses->>'S1_Q15')::NUMERIC;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Section I item values must be valid numeric values';
  END;

  IF v_s1_q01 IS NULL OR v_s1_q02 IS NULL OR v_s1_q03 IS NULL OR
     v_s1_q04 IS NULL OR v_s1_q05 IS NULL OR v_s1_q06 IS NULL OR
     v_s1_q07 IS NULL OR v_s1_q08 IS NULL OR v_s1_q09 IS NULL OR
     v_s1_q10 IS NULL OR v_s1_q11 IS NULL OR v_s1_q12 IS NULL OR
     v_s1_q13 IS NULL OR v_s1_q14 IS NULL OR v_s1_q15 IS NULL THEN
    RAISE EXCEPTION 'Section I items S1_Q01 through S1_Q15 are all required for scoring';
  END IF;

  IF v_s1_q01 NOT IN (1, 2, 3, 4) OR v_s1_q02 NOT IN (1, 2, 3, 4) OR
     v_s1_q03 NOT IN (1, 2, 3, 4) OR v_s1_q04 NOT IN (1, 2, 3, 4) OR
     v_s1_q05 NOT IN (1, 2, 3, 4) OR v_s1_q06 NOT IN (1, 2, 3, 4) OR
     v_s1_q07 NOT IN (1, 2, 3, 4) OR v_s1_q08 NOT IN (1, 2, 3, 4) OR
     v_s1_q09 NOT IN (1, 2, 3, 4) OR v_s1_q10 NOT IN (1, 2, 3, 4) OR
     v_s1_q11 NOT IN (1, 2, 3, 4) OR v_s1_q12 NOT IN (1, 2, 3, 4) OR
     v_s1_q13 NOT IN (1, 2, 3, 4) OR v_s1_q14 NOT IN (1, 2, 3, 4) OR
     v_s1_q15 NOT IN (1, 2, 3, 4) THEN
    RAISE EXCEPTION 'Section I items S1_Q01 through S1_Q15 must each be an integer in the inclusive range 1 through 4';
  END IF;

  v_score_s1_cps := round((v_s1_q01 + v_s1_q02 + v_s1_q03 + v_s1_q04 + v_s1_q05 + v_s1_q06) / 6.0, 3);
  v_score_s1_la  := round((v_s1_q07 + v_s1_q08 + v_s1_q09 + v_s1_q10 + v_s1_q11) / 5.0, 3);
  v_score_s1_pr  := round((v_s1_q12 + v_s1_q13 + v_s1_q14 + v_s1_q15) / 4.0, 3);

  SELECT s.approved_hours INTO v_approved_hours_at_completion
  FROM public.students s
  WHERE s.id = v_assignment.student_id;

  -- Insert the response using the assignment identity columns (student_id, cohort_id,
  -- instrument_id, timepoint) - this preserves identifiable pre/post linkage; baseline and
  -- post_rotation are separate rows and neither overwrites the other.
  INSERT INTO public.evaluation_responses (
    assignment_id, instrument_id, student_id, cohort_id, timepoint,
    form_type, responses,
    score_s1_clinical_problem_solving, score_s1_learning_activities, score_s1_practice_readiness,
    submitted_at, locked_at
  ) VALUES (
    v_assignment.id, v_assignment.instrument_id, v_assignment.student_id,
    v_assignment.cohort_id, v_assignment.timepoint,
    v_inst_slug, p_responses,
    v_score_s1_cps, v_score_s1_la, v_score_s1_pr,
    v_submitted_at, v_submitted_at
  )
  RETURNING id INTO v_response_id;

  UPDATE public.evaluation_assignments
  SET status = 'completed',
      completed_at = v_submitted_at,
      approved_hours_at_completion = v_approved_hours_at_completion,
      updated_at = v_submitted_at
  WHERE id = v_assignment.id;

  UPDATE public.evaluation_assignment_tokens
  SET used_at = v_submitted_at
  WHERE id = v_token.id;

  -- Certificate gate: issue ONLY for a completed student post_rotation Casey-Fink submission.
  -- issue_participation_certificate re-verifies the gate and is idempotent per student.
  IF v_inst_slug = 'casey_fink_readiness_2024'
     AND v_assignment.timepoint = 'post_rotation'
     AND v_assignment.respondent_type = 'student' THEN
    v_cert := public.issue_participation_certificate(v_assignment.id);
  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'submitted_at', v_submitted_at,
    'certificate_status', v_cert->>'status',
    'certificate_number', v_cert->>'certificate_number'
  );
END;
$$;

COMMENT ON FUNCTION public.submit_evaluation_response(TEXT, JSONB) IS
  'Atomic submission of a Casey-Fink evaluation response with Section I subscale scoring (unchanged). Inserts the response using the assignment identity columns (preserving identifiable pre/post linkage across timepoints), marks the assignment completed, and consumes the token. As of the Casey-Fink certificate gate, it additionally issues the ASPIRE Certificate of Participation via issue_participation_certificate() ONLY when the assignment is a student post_rotation Casey-Fink submission; baseline, early_rotation_baseline, and midpoint never issue. Never generates a PDF or sends email. Service-role only. Statuses: success (with submitted_at, plus certificate_status and certificate_number when a certificate was issued or already existed), token_invalid, assignment_state_invalid, assignment_window_closed.';

REVOKE ALL ON FUNCTION public.submit_evaluation_response(TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_evaluation_response(TEXT, JSONB)
  TO service_role;

NOTIFY pgrst, 'reload schema';
