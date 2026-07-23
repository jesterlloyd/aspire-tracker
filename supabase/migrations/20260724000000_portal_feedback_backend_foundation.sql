-- ============================================================================
-- ASPIRE PORTAL FEEDBACK BACKEND FOUNDATION (ADDITIVE ONLY)
-- ============================================================================
-- Owner instructions: run this ENTIRE file once in the Supabase SQL editor.
-- Jester manually applies SQL. This migration is authored for review and
-- verification only; Codex must not execute it.
--
-- Scope:
--   - Dedicated authoritative storage for portal feedback and bug reports.
--   - Purpose-specific delivery/outbox rows for the aspire@cshs.org email
--     notification.
--   - Stable per-reporter request idempotency with payload-conflict protection.
--   - Atomic per-profile rate limiting: 5 accepted submissions per 1 hour.
--   - Service-role submission and delivery writes only.
--   - Active Owner/Admin read access only.
--   - No direct portal-user table access and no anonymous endpoint support.
--
-- This migration does NOT alter ASPIRE Messages, communications,
-- staff_notifications, notification_log, shift-support records, Academic
-- Partner Messages, or any portal UI.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.portal_feedback_submissions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id            text        NOT NULL,
  payload_fingerprint   text        NOT NULL,

  reporter_profile_id   uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  reporter_display_name text,
  reporter_email        text,

  portal_role           text        NOT NULL,
  portal_type           text        NOT NULL,
  submission_type       text        NOT NULL,

  pathname              text        NOT NULL,
  section               text,
  message               text        NOT NULL,
  build_sha             text,
  environment           text,

  expected_behavior     text,
  actual_behavior       text,
  reproduction_steps    text,
  viewport_width        integer,
  viewport_height       integer,

  review_status         text        NOT NULL DEFAULT 'new',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_portal_feedback_request_per_reporter
    UNIQUE (reporter_profile_id, request_id),
  CONSTRAINT chk_portal_feedback_role
    CHECK (portal_role IN ('student', 'unit_leader', 'academic_partner')),
  CONSTRAINT chk_portal_feedback_type
    CHECK (submission_type IN ('feedback', 'bug')),
  CONSTRAINT chk_portal_feedback_review_status
    CHECK (review_status IN ('new', 'reviewing', 'resolved', 'closed')),
  CONSTRAINT chk_portal_feedback_request_id_len
    CHECK (length(request_id) BETWEEN 8 AND 128),
  CONSTRAINT chk_portal_feedback_fingerprint_len
    CHECK (length(payload_fingerprint) = 64),
  CONSTRAINT chk_portal_feedback_message_len
    CHECK (length(message) BETWEEN 1 AND 5000),
  CONSTRAINT chk_portal_feedback_pathname
    CHECK (pathname LIKE '/%' AND pathname NOT LIKE '//%' AND length(pathname) <= 240),
  CONSTRAINT chk_portal_feedback_section_len
    CHECK (section IS NULL OR length(section) <= 120),
  CONSTRAINT chk_portal_feedback_build_len
    CHECK (build_sha IS NULL OR length(build_sha) <= 80),
  CONSTRAINT chk_portal_feedback_environment_len
    CHECK (environment IS NULL OR length(environment) <= 40),
  CONSTRAINT chk_portal_feedback_bug_fields
    CHECK (
      submission_type = 'bug'
      OR (
        expected_behavior IS NULL
        AND actual_behavior IS NULL
        AND reproduction_steps IS NULL
        AND viewport_width IS NULL
        AND viewport_height IS NULL
      )
    ),
  CONSTRAINT chk_portal_feedback_viewport_bounds
    CHECK (
      (viewport_width IS NULL OR (viewport_width BETWEEN 1 AND 10000))
      AND (viewport_height IS NULL OR (viewport_height BETWEEN 1 AND 10000))
    )
);

COMMENT ON TABLE public.portal_feedback_submissions IS
  'Authoritative durable storage for ASPIRE portal feedback and bug reports. Feedback is separate from Messages, communications, assignment notifications, shift-support records, and delivery logs. Identity, role, portal type, and timestamps are server-derived. Portal users have no direct table access; service_role writes; active Owner/Admin SELECT only.';

CREATE INDEX IF NOT EXISTS idx_portal_feedback_created_at
  ON public.portal_feedback_submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_feedback_reporter
  ON public.portal_feedback_submissions (reporter_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_feedback_review_status
  ON public.portal_feedback_submissions (review_status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.portal_feedback_deliveries (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id       uuid        NOT NULL REFERENCES public.portal_feedback_submissions(id) ON DELETE RESTRICT,
  recipient_email     text        NOT NULL DEFAULT 'aspire@cshs.org',
  idempotency_key     text        NOT NULL,
  delivery_status     text        NOT NULL DEFAULT 'pending',
  attempt_count       integer     NOT NULL DEFAULT 0,
  max_attempts        integer     NOT NULL DEFAULT 5,
  next_retry_at       timestamptz NOT NULL DEFAULT now(),
  last_attempt_at     timestamptz,
  sent_at             timestamptz,
  resend_email_id     text,
  last_error_code     text,
  locked_at           timestamptz,
  locked_by           text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_portal_feedback_delivery_submission UNIQUE (submission_id),
  CONSTRAINT uq_portal_feedback_delivery_idempotency UNIQUE (idempotency_key),
  CONSTRAINT chk_portal_feedback_delivery_recipient
    CHECK (recipient_email = 'aspire@cshs.org'),
  CONSTRAINT chk_portal_feedback_delivery_status
    CHECK (delivery_status IN ('pending', 'processing', 'sent', 'retryable_failure', 'permanent_failure')),
  CONSTRAINT chk_portal_feedback_delivery_attempts
    CHECK (attempt_count >= 0 AND max_attempts BETWEEN 1 AND 10 AND attempt_count <= max_attempts),
  CONSTRAINT chk_portal_feedback_processing_claim
    CHECK (delivery_status <> 'processing' OR (locked_at IS NOT NULL AND locked_by IS NOT NULL)),
  CONSTRAINT chk_portal_feedback_retry_scheduled
    CHECK (delivery_status <> 'retryable_failure' OR next_retry_at IS NOT NULL),
  CONSTRAINT chk_portal_feedback_terminal_not_retryable
    CHECK (delivery_status NOT IN ('sent', 'permanent_failure') OR next_retry_at IS NULL)
);

COMMENT ON TABLE public.portal_feedback_deliveries IS
  'Purpose-specific retryable email outbox for ASPIRE portal feedback notifications. One row per authoritative submission. Stores delivery state and safe error codes only; the report body remains on portal_feedback_submissions. Service-role writes; active Owner/Admin SELECT only.';

CREATE INDEX IF NOT EXISTS idx_portal_feedback_deliveries_due
  ON public.portal_feedback_deliveries (next_retry_at)
  WHERE delivery_status IN ('pending', 'retryable_failure');
CREATE INDEX IF NOT EXISTS idx_portal_feedback_deliveries_stale
  ON public.portal_feedback_deliveries (locked_at)
  WHERE delivery_status = 'processing';
CREATE INDEX IF NOT EXISTS idx_portal_feedback_deliveries_submission
  ON public.portal_feedback_deliveries (submission_id);

CREATE TABLE IF NOT EXISTS public.portal_feedback_rate_limits (
  reporter_profile_id uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  action_kind         text        NOT NULL,
  window_start        timestamptz NOT NULL,
  count               integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (reporter_profile_id, action_kind),
  CONSTRAINT chk_portal_feedback_rate_action
    CHECK (action_kind = 'portal_feedback_submission'),
  CONSTRAINT chk_portal_feedback_rate_count
    CHECK (count >= 0)
);

COMMENT ON TABLE public.portal_feedback_rate_limits IS
  'Purpose-specific atomic per-profile rate limiter for authenticated portal feedback submissions. Keyed by server-verified user_profiles.id, not IP address or user agent. Service-role only; no portal-user access.';

CREATE INDEX IF NOT EXISTS idx_portal_feedback_rate_window
  ON public.portal_feedback_rate_limits (window_start);

CREATE OR REPLACE FUNCTION public.claim_due_portal_feedback_deliveries(
  p_worker        text,
  p_limit         integer DEFAULT 20,
  p_stale_seconds integer DEFAULT 300
)
RETURNS SETOF public.portal_feedback_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF p_worker IS NULL OR length(btrim(p_worker)) = 0 THEN
    RAISE EXCEPTION 'p_worker must be non-null and non-empty';
  END IF;
  IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 100 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 100';
  END IF;
  IF p_stale_seconds IS NULL OR p_stale_seconds <= 0 OR p_stale_seconds > 3600 THEN
    RAISE EXCEPTION 'p_stale_seconds must be between 1 and 3600';
  END IF;

  UPDATE public.portal_feedback_deliveries d
  SET delivery_status = 'retryable_failure',
      next_retry_at   = v_now,
      locked_at       = NULL,
      locked_by       = NULL,
      updated_at      = v_now
  WHERE d.delivery_status = 'processing'
    AND d.locked_at IS NOT NULL
    AND d.locked_at < v_now - (p_stale_seconds || ' seconds')::interval
    AND d.attempt_count < d.max_attempts;

  RETURN QUERY
  WITH due AS (
    SELECT d.id
    FROM public.portal_feedback_deliveries d
    WHERE d.delivery_status IN ('pending', 'retryable_failure')
      AND (d.next_retry_at IS NULL OR d.next_retry_at <= v_now)
    ORDER BY d.next_retry_at NULLS FIRST, d.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.portal_feedback_deliveries d
  SET delivery_status = 'processing',
      locked_at       = v_now,
      locked_by       = p_worker,
      updated_at      = v_now
  FROM due
  WHERE d.id = due.id
  RETURNING d.*;
END;
$$;

COMMENT ON FUNCTION public.claim_due_portal_feedback_deliveries(text, integer, integer) IS
  'Service-role-only. Recovers stale portal feedback delivery claims, then atomically claims a bounded due batch with FOR UPDATE SKIP LOCKED. Terminal rows are never claimed.';

CREATE OR REPLACE FUNCTION public.submit_portal_feedback_report(
  p_reporter_context    jsonb,
  p_payload             jsonb,
  p_payload_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now                 timestamptz := now();
  v_profile_id          uuid := (p_reporter_context->>'reporter_profile_id')::uuid;
  v_request_id          text := p_payload->>'request_id';
  v_existing            public.portal_feedback_submissions%ROWTYPE;
  v_submission          public.portal_feedback_submissions%ROWTYPE;
  v_delivery_id         uuid;
  v_count               integer;
  v_window              timestamptz;
  v_reset_at            timestamptz;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'missing reporter profile id' USING ERRCODE = 'PF400';
  END IF;
  IF p_reporter_context->>'portal_role' NOT IN ('student', 'unit_leader', 'academic_partner') THEN
    RAISE EXCEPTION 'invalid portal role' USING ERRCODE = 'PF400';
  END IF;
  IF p_payload->>'type' NOT IN ('feedback', 'bug') THEN
    RAISE EXCEPTION 'invalid submission type' USING ERRCODE = 'PF400';
  END IF;

  -- Serialize the idempotency lane for this reporter/request id before the
  -- existence check, rate consumption, authoritative insert, and outbox insert.
  -- This prevents concurrent identical first attempts from over-consuming the
  -- accepted-submission rate limit or surfacing a raw unique-constraint error.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_profile_id::text || ':' || COALESCE(v_request_id, ''), 0)
  );

  SELECT *
  INTO v_existing
  FROM public.portal_feedback_submissions s
  WHERE s.reporter_profile_id = v_profile_id
    AND s.request_id = v_request_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.payload_fingerprint <> p_payload_fingerprint THEN
      RAISE EXCEPTION 'request id reused with different payload' USING ERRCODE = 'PF409';
    END IF;

    SELECT d.id INTO v_delivery_id
    FROM public.portal_feedback_deliveries d
    WHERE d.submission_id = v_existing.id;

    RETURN jsonb_build_object(
      'submission_id', v_existing.id,
      'delivery_id', v_delivery_id,
      'created_at', v_existing.created_at,
      'created', false,
      'replayed', true
    );
  END IF;

  DELETE FROM public.portal_feedback_rate_limits
  WHERE ctid IN (
    SELECT ctid FROM public.portal_feedback_rate_limits
    WHERE window_start < v_now - interval '24 hours'
    LIMIT 50
  );

  INSERT INTO public.portal_feedback_rate_limits AS r (
    reporter_profile_id, action_kind, window_start, count
  )
  VALUES (v_profile_id, 'portal_feedback_submission', v_now, 1)
  ON CONFLICT (reporter_profile_id, action_kind) DO UPDATE
  SET count = CASE
        WHEN r.window_start + interval '1 hour' <= v_now THEN 1
        ELSE r.count + 1
      END,
      window_start = CASE
        WHEN r.window_start + interval '1 hour' <= v_now THEN v_now
        ELSE r.window_start
      END
  RETURNING count, window_start INTO v_count, v_window;

  v_reset_at := v_window + interval '1 hour';
  IF v_count > 5 THEN
    RAISE EXCEPTION 'portal feedback rate limited' USING ERRCODE = 'PF429';
  END IF;

  INSERT INTO public.portal_feedback_submissions (
    request_id,
    payload_fingerprint,
    reporter_profile_id,
    reporter_display_name,
    reporter_email,
    portal_role,
    portal_type,
    submission_type,
    pathname,
    section,
    message,
    build_sha,
    environment,
    expected_behavior,
    actual_behavior,
    reproduction_steps,
    viewport_width,
    viewport_height
  )
  VALUES (
    v_request_id,
    p_payload_fingerprint,
    v_profile_id,
    NULLIF(p_reporter_context->>'reporter_display_name', ''),
    NULLIF(p_reporter_context->>'reporter_email', ''),
    p_reporter_context->>'portal_role',
    p_reporter_context->>'portal_type',
    p_payload->>'type',
    p_payload->>'pathname',
    NULLIF(p_payload->>'section', ''),
    p_payload->>'message',
    NULLIF(p_payload->>'build_sha', ''),
    NULLIF(p_payload->>'environment', ''),
    NULLIF(p_payload->>'expected_behavior', ''),
    NULLIF(p_payload->>'actual_behavior', ''),
    NULLIF(p_payload->>'reproduction_steps', ''),
    NULLIF(p_payload->>'viewport_width', '')::integer,
    NULLIF(p_payload->>'viewport_height', '')::integer
  )
  RETURNING * INTO v_submission;

  INSERT INTO public.portal_feedback_deliveries (
    submission_id,
    recipient_email,
    idempotency_key,
    delivery_status,
    next_retry_at
  )
  VALUES (
    v_submission.id,
    'aspire@cshs.org',
    'portal_feedback_v1:' || v_submission.id::text,
    'pending',
    v_now
  )
  RETURNING id INTO v_delivery_id;

  RETURN jsonb_build_object(
    'submission_id', v_submission.id,
    'delivery_id', v_delivery_id,
    'created_at', v_submission.created_at,
    'created', true,
    'replayed', false,
    'rate_limit', jsonb_build_object(
      'limit', 5,
      'remaining', GREATEST(0, 5 - v_count),
      'reset_at', v_reset_at
    )
  );
END;
$$;

COMMENT ON FUNCTION public.submit_portal_feedback_report(jsonb, jsonb, text) IS
  'Service-role-only authoritative portal feedback submitter. Accepts server-derived reporter context and a server-normalized payload only. Enforces per-reporter idempotency, rejects request-id payload conflicts, consumes a purpose-specific atomic 5/hour rate limit only for new accepted submissions, inserts the authoritative submission, and queues exactly one aspire@cshs.org delivery row. Does not authorize callers; endpoint adapters must verify active portal grants before calling.';

ALTER TABLE public.portal_feedback_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_feedback_deliveries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_feedback_rate_limits  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.portal_feedback_submissions,
              public.portal_feedback_deliveries,
              public.portal_feedback_rate_limits
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON public.portal_feedback_submissions TO authenticated;
GRANT SELECT ON public.portal_feedback_deliveries TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.portal_feedback_submissions TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.portal_feedback_deliveries TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_feedback_rate_limits TO service_role;

CREATE POLICY "portal_feedback_staff_select_submissions"
  ON public.portal_feedback_submissions
  FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin());

CREATE POLICY "portal_feedback_staff_select_deliveries"
  ON public.portal_feedback_deliveries
  FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin());

REVOKE ALL ON FUNCTION public.claim_due_portal_feedback_deliveries(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_portal_feedback_deliveries(text, integer, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.submit_portal_feedback_report(jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_portal_feedback_report(jsonb, jsonb, text)
  TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
