-- migration_evaluation_stage2_rpcs.sql
-- Stage 2a: Evaluation MVP RPC migration (Revision 2).
--
-- Creates three SECURITY DEFINER functions and one support table:
--   public.validate_and_open_evaluation_assignment(p_token_hash TEXT)
--   public.submit_evaluation_response(p_token_hash TEXT, p_responses JSONB)
--   public.evaluation_rate_limit_counters (table)
--   public.consume_evaluation_rate_limit(p_bucket_key, p_window_seconds, p_max_per_window)
--
-- All functions are LANGUAGE plpgsql, SECURITY DEFINER, with SET search_path = public,
-- pg_catalog. Every table reference inside every function is schema-qualified. Functions
-- are service_role-only; PUBLIC, anon, and authenticated have execute revoked. The
-- browser never invokes any RPC defined here.
--
-- Atomicity:
--   validate_and_open_evaluation_assignment performs the token check, assignment
--   eligibility check, instrument authorization check, and idempotent open transition
--   in a single atomic operation with FOR UPDATE row locks on token and assignment,
--   and a FOR SHARE lock on the linked instrument.
--   submit_evaluation_response performs token validation, assignment eligibility,
--   instrument authorization, Section I subscale-mean derivation from p_responses,
--   approved-hours snapshot capture from public.students, response insert with the
--   assignment's identity columns, assignment completion, and token consumption in a
--   single atomic operation. The submitted_at timestamp is generated inside the
--   function and returned to the endpoint.
--
-- Instrument authorization gate:
--   Both RPCs require the linked public.evaluation_instruments row to have
--   permission_status = 'authorized'. The instrument row is read FOR SHARE inside the
--   same transaction so an Owner cannot revoke authorization mid-operation. If the
--   instrument is missing or its permission_status is not 'authorized', validate
--   returns { status: 'invalid' } and submit returns { status: 'assignment_state_invalid' },
--   in each case without performing any state transition.
--
-- Database-derived Section I subscale scores:
--   submit_evaluation_response accepts only the token hash and the full responses
--   jsonb payload. The three Section I cached subscale means are derived inside the
--   function from the structural item codes:
--     Clinical Problem-Solving: S1_Q01 through S1_Q06 (6 items)
--     Learning Activities:      S1_Q07 through S1_Q11 (5 items)
--     Practice Readiness:       S1_Q12 through S1_Q15 (4 items)
--   Each mean is rounded to three decimal places to match the Stage 1 NUMERIC(5,3)
--   column precision and CHECK bounds. If any Section I item is missing or cannot be
--   cast to a valid numeric value, the function raises an exception that aborts the
--   entire transaction. The endpoint validates the full payload before calling the RPC;
--   this in-RPC check is the database-layer defense in depth.
--
-- Data minimization: ip_submitted, user_agent, ip_used_first, user_agent_used_first
-- remain NULL. No IP or user-agent parameters appear in any function signature.
--
-- Rate limiting: per-bucket counter with bounded opportunistic cleanup (max 50 stale
-- rows older than 24 hours per call). bucket_key is HMAC-derived by the endpoint using
-- the server-only EVALUATION_RATE_LIMIT_PEPPER secret. Raw IPs are never stored.
-- Parameter guardrails reject malformed or out-of-range inputs.
--
-- QA implication (Stage 2b): the QA preview Supabase project must seed a clearly
-- labeled synthetic QA instrument row with permission_status = 'authorized' and
-- structural QA responses only. The production Casey-Fink seed row stays at
-- permission_status = 'pending' and must not be authorized merely for QA. No
-- copyrighted Casey-Fink item prose, response-anchor wording, or formatted survey
-- content appears anywhere in QA data or this migration.

BEGIN;

-- ========================================================================
-- (1) validate_and_open_evaluation_assignment
-- ========================================================================
CREATE OR REPLACE FUNCTION public.validate_and_open_evaluation_assignment(
  p_token_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_token              public.evaluation_assignment_tokens%ROWTYPE;
  v_assignment         public.evaluation_assignments%ROWTYPE;
  v_inst_perm_status   TEXT;
  v_inst_slug          TEXT;
  v_inst_display       TEXT;
  v_first_name         TEXT;
  v_now                TIMESTAMPTZ := now();
BEGIN
  -- Lock the token row
  SELECT * INTO v_token
  FROM public.evaluation_assignment_tokens
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  -- Token security checks. used_at is intentionally NOT checked here; the assignment
  -- completed_at check below takes precedence so a returning student loading their
  -- completed link receives the friendly 'completed' status.
  IF v_token.revoked_at IS NOT NULL OR v_token.expires_at <= v_now THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  -- Lock the assignment row
  SELECT * INTO v_assignment
  FROM public.evaluation_assignments
  WHERE id = v_token.assignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  -- Completed assignment takes precedence over token used_at state.
  IF v_assignment.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'completed');
  END IF;

  -- Token used but assignment not completed: anomalous state.
  IF v_token.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  -- Assignment revoked or ineligible status.
  IF v_assignment.revoked_at IS NOT NULL OR
     v_assignment.status NOT IN ('sent', 'opened', 'reminder_due') THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  -- Response window closed before completion.
  IF v_assignment.expires_at IS NOT NULL AND v_assignment.expires_at <= v_now THEN
    RETURN jsonb_build_object('status', 'window_closed');
  END IF;

  -- Instrument authorization gate (defense in depth). Read FOR SHARE so an Owner
  -- cannot revoke authorization between this check and the open transition below.
  SELECT permission_status, slug, display_name
    INTO v_inst_perm_status, v_inst_slug, v_inst_display
  FROM public.evaluation_instruments
  WHERE id = v_assignment.instrument_id
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF v_inst_perm_status IS NULL OR v_inst_perm_status <> 'authorized' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  -- Eligible. Perform the idempotent open transition.
  UPDATE public.evaluation_assignments
  SET opened_at = COALESCE(opened_at, v_now),
      status = CASE WHEN status = 'sent' THEN 'opened' ELSE status END,
      updated_at = v_now
  WHERE id = v_assignment.id;

  -- Read student first name for sanitized return context.
  SELECT s.first_name INTO v_first_name
  FROM public.students s
  WHERE s.id = v_assignment.student_id;

  RETURN jsonb_build_object(
    'status', 'valid',
    'first_name', v_first_name,
    'instrument_slug', v_inst_slug,
    'instrument_display_name', v_inst_display,
    'timepoint', v_assignment.timepoint
  );
END;
$$;

COMMENT ON FUNCTION public.validate_and_open_evaluation_assignment(TEXT) IS
  'Atomic token validation, assignment eligibility check, instrument authorization gate, and idempotent open-state transition. Reads the linked public.evaluation_instruments row FOR SHARE and requires permission_status = ''authorized'' before any state transition. Service-role-only execution; browser never invokes directly. Possible return statuses: valid (with first_name, instrument_slug, instrument_display_name, timepoint), completed (assignment already finished, returned even when token used_at is populated), window_closed (assignment.expires_at has passed), invalid (token state failure, assignment ineligible, instrument missing, instrument not authorized, or anomalous used-token-not-completed state). All non-valid statuses map to the same 410 generic response surface on the public side except window_closed and completed which are user-facing policy messages.';

-- ========================================================================
-- (2) submit_evaluation_response
-- ========================================================================
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
  v_s1_q01 NUMERIC;
  v_s1_q02 NUMERIC;
  v_s1_q03 NUMERIC;
  v_s1_q04 NUMERIC;
  v_s1_q05 NUMERIC;
  v_s1_q06 NUMERIC;
  v_s1_q07 NUMERIC;
  v_s1_q08 NUMERIC;
  v_s1_q09 NUMERIC;
  v_s1_q10 NUMERIC;
  v_s1_q11 NUMERIC;
  v_s1_q12 NUMERIC;
  v_s1_q13 NUMERIC;
  v_s1_q14 NUMERIC;
  v_s1_q15 NUMERIC;
  v_score_s1_cps NUMERIC(5,3);
  v_score_s1_la  NUMERIC(5,3);
  v_score_s1_pr  NUMERIC(5,3);
BEGIN
  -- Lock the token row
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

  -- Lock the assignment row
  SELECT * INTO v_assignment
  FROM public.evaluation_assignments
  WHERE id = v_token.assignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'token_invalid');
  END IF;

  -- Completed assignment: submit never accepts resubmission.
  IF v_assignment.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'token_invalid');
  END IF;

  -- Ineligible assignment state.
  IF v_assignment.revoked_at IS NOT NULL OR
     v_assignment.status NOT IN ('sent', 'opened', 'reminder_due') THEN
    RETURN jsonb_build_object('status', 'assignment_state_invalid');
  END IF;

  -- Response window closed.
  IF v_assignment.expires_at IS NOT NULL AND v_assignment.expires_at <= v_submitted_at THEN
    RETURN jsonb_build_object('status', 'assignment_window_closed');
  END IF;

  -- Instrument authorization gate (defense in depth). Read FOR SHARE so an Owner
  -- cannot revoke authorization between this check and the response insert.
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

  -- Extract Section I items from p_responses. Casts that fail raise an exception
  -- that aborts the entire RPC, leaving no partial state.
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

  -- All 15 Section I items must be present (non-NULL) for subscale computation.
  IF v_s1_q01 IS NULL OR v_s1_q02 IS NULL OR v_s1_q03 IS NULL OR
     v_s1_q04 IS NULL OR v_s1_q05 IS NULL OR v_s1_q06 IS NULL OR
     v_s1_q07 IS NULL OR v_s1_q08 IS NULL OR v_s1_q09 IS NULL OR
     v_s1_q10 IS NULL OR v_s1_q11 IS NULL OR v_s1_q12 IS NULL OR
     v_s1_q13 IS NULL OR v_s1_q14 IS NULL OR v_s1_q15 IS NULL THEN
    RAISE EXCEPTION 'Section I items S1_Q01 through S1_Q15 are all required for scoring';
  END IF;

  -- Section I item values must each be an integer in the inclusive range 1 through 4.
  -- Values like 0, 5, negatives, and decimals such as 2.5 must be rejected here, because
  -- the cached Section I subscale means alone cannot detect individual out-of-range items
  -- (e.g., a mix of 0s and 5s can still produce a mean within the 1.000-4.000 CHECK bounds).
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

  -- Compute Section I subscale means, rounded to 3 decimals to match NUMERIC(5,3).
  -- Subscale mappings per Casey-Fink published scoring instructions:
  --   Clinical Problem-Solving: items 1-6 (6 items)
  --   Learning Activities:      items 7-11 (5 items)
  --   Practice Readiness:       items 12-15 (4 items)
  v_score_s1_cps := round((v_s1_q01 + v_s1_q02 + v_s1_q03 + v_s1_q04 + v_s1_q05 + v_s1_q06) / 6.0, 3);
  v_score_s1_la  := round((v_s1_q07 + v_s1_q08 + v_s1_q09 + v_s1_q10 + v_s1_q11) / 5.0, 3);
  v_score_s1_pr  := round((v_s1_q12 + v_s1_q13 + v_s1_q14 + v_s1_q15) / 4.0, 3);

  -- Capture approved_hours snapshot from students inside the same transaction.
  SELECT s.approved_hours INTO v_approved_hours_at_completion
  FROM public.students s
  WHERE s.id = v_assignment.student_id;

  -- Insert the response using the assignment's identity columns. The Stage 1
  -- fk_response_assignment_identity composite FK enforces alignment.
  -- ip_submitted, user_agent remain NULL per data minimization.
  INSERT INTO public.evaluation_responses (
    assignment_id,
    instrument_id,
    student_id,
    cohort_id,
    timepoint,
    form_type,
    responses,
    score_s1_clinical_problem_solving,
    score_s1_learning_activities,
    score_s1_practice_readiness,
    submitted_at,
    locked_at
  ) VALUES (
    v_assignment.id,
    v_assignment.instrument_id,
    v_assignment.student_id,
    v_assignment.cohort_id,
    v_assignment.timepoint,
    v_inst_slug,
    p_responses,
    v_score_s1_cps,
    v_score_s1_la,
    v_score_s1_pr,
    v_submitted_at,
    v_submitted_at
  )
  RETURNING id INTO v_response_id;

  -- Mark the assignment completed.
  UPDATE public.evaluation_assignments
  SET status = 'completed',
      completed_at = v_submitted_at,
      approved_hours_at_completion = v_approved_hours_at_completion,
      updated_at = v_submitted_at
  WHERE id = v_assignment.id;

  -- Consume the token. ip_used_first and user_agent_used_first remain NULL.
  UPDATE public.evaluation_assignment_tokens
  SET used_at = v_submitted_at
  WHERE id = v_token.id;

  RETURN jsonb_build_object(
    'status', 'success',
    'submitted_at', v_submitted_at
  );
END;
$$;

COMMENT ON FUNCTION public.submit_evaluation_response(TEXT, JSONB) IS
  'Atomic submission of an evaluation response. Validates token state, assignment state, and instrument authorization (permission_status = ''authorized'' on the linked public.evaluation_instruments row, read FOR SHARE inside the same transaction). Derives the three Section I cached subscale means inside the function from p_responses using the published subscale mappings (Clinical Problem-Solving S1_Q01-S1_Q06, Learning Activities S1_Q07-S1_Q11, Practice Readiness S1_Q12-S1_Q15); the endpoint cannot supply or override these values. If any Section I item is missing or cannot be cast to a valid numeric value, the function raises an exception that aborts the entire transaction. Derives approved_hours_at_completion from public.students.approved_hours inside the same transaction. Inserts the response using the assignment identity columns, marks the assignment completed, and consumes the token, all atomically. ip_submitted, user_agent, ip_used_first, and user_agent_used_first all remain NULL per the Stage 2 data minimization decision. The submitted_at timestamp is generated inside the function and returned. Service-role-only execution. Possible return statuses: success (with submitted_at), token_invalid (token state failure or assignment already completed), assignment_state_invalid (assignment revoked, ineligible status, or instrument not authorized), assignment_window_closed (assignment.expires_at has passed).';

-- ========================================================================
-- (3) evaluation_rate_limit_counters
-- ========================================================================
CREATE TABLE public.evaluation_rate_limit_counters (
  bucket_key   TEXT        PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  count        INTEGER     NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.evaluation_rate_limit_counters IS
  'Per-bucket rate-limit counters for the evaluation public endpoints. bucket_key is an HMAC-derived value computed by the endpoint using the server-only EVALUATION_RATE_LIMIT_PEPPER secret over the normalized client IP. Raw IPs and truncated IPs are never stored. Service-role-only direct access. anon, authenticated, and PUBLIC have zero privileges and no RLS policies. Stale rows are cleaned opportunistically inside consume_evaluation_rate_limit (max 50 rows older than 24 hours per call). Scope: abuse-throttling control, not denial-of-service protection.';

CREATE INDEX idx_evaluation_rate_limit_counters_window_start
  ON public.evaluation_rate_limit_counters(window_start);

ALTER TABLE public.evaluation_rate_limit_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.evaluation_rate_limit_counters
  FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.evaluation_rate_limit_counters TO service_role;

-- ========================================================================
-- (4) consume_evaluation_rate_limit
-- ========================================================================
CREATE OR REPLACE FUNCTION public.consume_evaluation_rate_limit(
  p_bucket_key     TEXT,
  p_window_seconds INTEGER,
  p_max_per_window INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now           TIMESTAMPTZ := now();
  v_current_count INTEGER;
BEGIN
  -- Parameter guardrails
  IF p_bucket_key IS NULL OR length(trim(p_bucket_key)) = 0 THEN
    RAISE EXCEPTION 'p_bucket_key must be non-null and non-empty';
  END IF;
  IF length(p_bucket_key) > 200 THEN
    RAISE EXCEPTION 'p_bucket_key exceeds 200 character maximum';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
    RAISE EXCEPTION 'p_window_seconds must be a positive integer';
  END IF;
  IF p_window_seconds > 3600 THEN
    RAISE EXCEPTION 'p_window_seconds exceeds 3600 second maximum';
  END IF;
  IF p_max_per_window IS NULL OR p_max_per_window <= 0 THEN
    RAISE EXCEPTION 'p_max_per_window must be a positive integer';
  END IF;
  IF p_max_per_window > 1000 THEN
    RAISE EXCEPTION 'p_max_per_window exceeds 1000 maximum';
  END IF;

  -- Opportunistic bounded cleanup of stale rows (older than 24 hours, max 50 per call).
  DELETE FROM public.evaluation_rate_limit_counters
  WHERE bucket_key IN (
    SELECT bucket_key FROM public.evaluation_rate_limit_counters
    WHERE window_start < v_now - interval '24 hours'
    LIMIT 50
  );

  -- Atomic upsert with window rollover.
  INSERT INTO public.evaluation_rate_limit_counters AS rlc (bucket_key, window_start, count)
  VALUES (p_bucket_key, v_now, 1)
  ON CONFLICT (bucket_key) DO UPDATE
  SET count = CASE
        WHEN rlc.window_start + (p_window_seconds || ' seconds')::interval <= v_now
          THEN 1
          ELSE rlc.count + 1
      END,
      window_start = CASE
        WHEN rlc.window_start + (p_window_seconds || ' seconds')::interval <= v_now
          THEN v_now
          ELSE rlc.window_start
      END
  RETURNING count INTO v_current_count;

  RETURN v_current_count <= p_max_per_window;
END;
$$;

COMMENT ON FUNCTION public.consume_evaluation_rate_limit(TEXT, INTEGER, INTEGER) IS
  'Atomic per-bucket rate-limit consumption. Returns true if the resulting count is at or below the maximum for the current window, false otherwise. Performs bounded opportunistic cleanup of stale counter rows (max 50 rows older than 24 hours per call). Parameter guardrails reject null/empty bucket keys, bucket keys longer than 200 characters, non-positive window_seconds, window_seconds above 3600, non-positive max_per_window, and max_per_window above 1000. Service-role-only execution. Scope: abuse-throttling, not denial-of-service.';

-- ========================================================================
-- Function privilege posture (explicit for all three functions)
-- ========================================================================

REVOKE ALL ON FUNCTION public.validate_and_open_evaluation_assignment(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_and_open_evaluation_assignment(TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.submit_evaluation_response(TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_evaluation_response(TEXT, JSONB)
  TO service_role;

REVOKE ALL ON FUNCTION public.consume_evaluation_rate_limit(TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_evaluation_rate_limit(TEXT, INTEGER, INTEGER)
  TO service_role;

COMMIT;
