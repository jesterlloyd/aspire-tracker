-- ============================================================================
-- ASPIRE MESSAGES, PHASE 2 (STAGE A): notification-delivery and rate-limit
-- database foundation (ADDITIVE ONLY)
-- ============================================================================
-- Owner instructions: run this ENTIRE file as one block in the Supabase SQL
-- editor. It is additive only: two tables, three functions, their indexes, RLS,
-- least-privilege grants, and one staff observability policy. It creates no
-- data and modifies no existing table, policy, function, or grant. No Stage B
-- server code, cron, Resend, webhook, API, or UI is part of this file, so it is
-- safe to apply at any time.
--
-- Prerequisites (already applied and verified in production): ASPIRE Messages
-- Phase 1 (conversations, conversation_participants, messages,
-- staff_conversation_reads, participant_conversation_reads, conversation_events,
-- is_active_owner_or_admin(), my_message_conversation_ids()) and the Phase 2
-- portal authorization foundation (user_role_grants, user_student_links). This
-- file builds on those and recreates none of them. The Phase 1 migration
-- (20260716000000_messages_phase1_schema_foundation.sql) is not modified.
--
-- Core principles enforced here:
--   - The in-app conversation and message are authoritative. Email is
--     notification only. A durable delivery row is the job record, never the
--     authoritative message.
--   - No message body, preview, snippet, or free-form content column exists on
--     any table in this file. There is no metadata jsonb column on the delivery
--     row; only an explicit safe snapshot (sender display name, subject,
--     category, and a CTA route) may be persisted.
--   - Queue workflow state and provider (Resend) delivery state are SEPARATE
--     columns. A provider event never moves the queue state backward.
--   - The three-identity model is preserved. Every actor or recipient profile
--     reference uses user_profiles.id. Nothing assumes id equals auth.uid().
--   - service_role is not a default read path. Portal users get no access.
--     Active Owner/Admin get SELECT observability on deliveries only.
--
-- This file is atomic (BEGIN/COMMIT); a failed run rolls back completely.
-- Read-only verification lives in db/audit/messages_phase2_verification.sql and
-- runs AFTER this migration is applied.
-- ============================================================================

BEGIN;

-- ── 1. Durable notification delivery job/state table ────────────────────────
-- One row per logical notification (enforced by the UNIQUE idempotency_key).
-- The row is created BEFORE any email attempt (enqueue before send). Email
-- failure updates this row and never touches the authoritative conversation or
-- message. queue_status is the retry workflow; provider_status is the Resend
-- lifecycle. There is deliberately no body, preview, snippet, content, or
-- free-form metadata column.
CREATE TABLE IF NOT EXISTS public.message_notification_deliveries (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relationships (authoritative records live elsewhere; these never cascade-erase).
  conversation_id         uuid        NOT NULL REFERENCES public.conversations(id) ON DELETE RESTRICT,
  message_id              uuid        REFERENCES public.messages(id) ON DELETE SET NULL,
  triggered_by_profile_id uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  recipient_profile_id    uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,

  -- Recipient and routing identity.
  recipient_email         text        NOT NULL,
  recipient_kind          text        NOT NULL,
  event_type              text        NOT NULL,

  -- Deterministic deduplication key. Composed by Stage B from the logical event
  -- AND the actual recipient identity: event_type + conversation_id + message_id
  -- (where applicable) + normalized recipient identity (the normalized email for
  -- a shared inbox; recipient_profile_id plus normalized email for assigned
  -- staff and portal users). One logical notification yields at most one row.
  idempotency_key         text        NOT NULL,

  -- Queue workflow state (retry lifecycle), separate from provider state.
  queue_status            text        NOT NULL DEFAULT 'queued',
  -- Resend provider lifecycle state, reconciled by the webhook. Nullable until
  -- the first provider event.
  provider_status         text,

  -- Retry and claim bookkeeping.
  attempts                integer     NOT NULL DEFAULT 0,
  max_attempts            integer     NOT NULL DEFAULT 5,
  last_attempt_at         timestamptz,
  next_attempt_at         timestamptz,
  locked_at               timestamptz,
  locked_by               text,
  resend_email_id         text,
  notification_log_id     uuid        REFERENCES public.notification_log(id) ON DELETE SET NULL,
  error_code              text,
  error_detail            text,

  -- Explicit safe snapshot ONLY (no body, ever). Used by the retry worker so a
  -- later attempt can rebuild the same allowed email without reading content.
  snapshot_sender_name    text,
  snapshot_subject        text,
  snapshot_category       text,
  cta_path                text,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_message_notification_deliveries_idempotency UNIQUE (idempotency_key),

  CONSTRAINT chk_mnd_recipient_kind
    CHECK (recipient_kind IN ('shared_inbox', 'assigned_staff', 'portal_user')),
  CONSTRAINT chk_mnd_event_type
    CHECK (event_type IN ('new_conversation', 'portal_reply', 'staff_reply')),
  CONSTRAINT chk_mnd_queue_status
    CHECK (queue_status IN ('queued', 'processing', 'retry_wait', 'sent', 'failed', 'suppressed')),
  CONSTRAINT chk_mnd_provider_status
    CHECK (provider_status IS NULL OR provider_status IN (
      'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained')),

  CONSTRAINT chk_mnd_attempts_nonnegative
    CHECK (attempts >= 0),
  CONSTRAINT chk_mnd_max_attempts_bounded
    CHECK (max_attempts > 0 AND max_attempts <= 10),
  CONSTRAINT chk_mnd_attempts_within_max
    CHECK (attempts <= max_attempts),

  -- A processing row must carry an active claim.
  CONSTRAINT chk_mnd_processing_claim
    CHECK (queue_status <> 'processing' OR (locked_at IS NOT NULL AND locked_by IS NOT NULL)),
  -- retry_wait rows are schedulable; terminal rows are not retryable.
  CONSTRAINT chk_mnd_retry_wait_scheduled
    CHECK (queue_status <> 'retry_wait' OR next_attempt_at IS NOT NULL),
  CONSTRAINT chk_mnd_terminal_not_retryable
    CHECK (queue_status NOT IN ('sent', 'failed', 'suppressed') OR next_attempt_at IS NULL)
);

COMMENT ON TABLE public.message_notification_deliveries IS
  'Durable per-notification delivery job and state record for ASPIRE Messages. Not the authoritative message. One row per logical notification (UNIQUE idempotency_key), created before any email attempt. queue_status is the retry workflow; provider_status is the Resend lifecycle, reconciled by the webhook and never moved backward. No message body, preview, snippet, or free-form metadata is stored; only an explicit safe snapshot (sender display name, subject, category, CTA route). Service-role writes; active Owner/Admin SELECT observability only; portal and anon have no access; no DELETE or TRUNCATE for any application role.';

-- Indexes for the required access patterns only.
CREATE INDEX IF NOT EXISTS idx_mnd_resend_email_id
  ON public.message_notification_deliveries (resend_email_id)
  WHERE resend_email_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mnd_due
  ON public.message_notification_deliveries (next_attempt_at)
  WHERE queue_status IN ('queued', 'retry_wait');
CREATE INDEX IF NOT EXISTS idx_mnd_stale_processing
  ON public.message_notification_deliveries (locked_at)
  WHERE queue_status = 'processing';
CREATE INDEX IF NOT EXISTS idx_mnd_conversation
  ON public.message_notification_deliveries (conversation_id);
CREATE INDEX IF NOT EXISTS idx_mnd_message
  ON public.message_notification_deliveries (message_id);
CREATE INDEX IF NOT EXISTS idx_mnd_recipient_profile
  ON public.message_notification_deliveries (recipient_profile_id);

-- ── 2. Portal-user rate-limit counters (keyed by user_profiles.id) ──────────
-- Mirrors evaluation_rate_limit_counters, but keyed by the authenticated portal
-- user's profile id and an action kind, NOT by an IP hash.
CREATE TABLE IF NOT EXISTS public.message_rate_limit_counters (
  profile_id   uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  action_kind  text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, action_kind),
  CONSTRAINT chk_mrl_action_kind CHECK (action_kind IN ('new_conversation', 'message')),
  CONSTRAINT chk_mrl_count_nonnegative CHECK (count >= 0)
);

COMMENT ON TABLE public.message_rate_limit_counters IS
  'Per-profile, per-action rate-limit counters for authenticated ASPIRE Messages portal actions. Keyed by user_profiles.id (never an IP hash). Consumed atomically by consume_message_rate_limit, which is passed a server-verified profile id. Service-role-only direct access; no RLS policies; anon and authenticated have zero privileges. Stale rows are cleaned opportunistically inside the consume function (max 50 rows older than 24 hours per call).';

CREATE INDEX IF NOT EXISTS idx_message_rate_limit_counters_window_start
  ON public.message_rate_limit_counters (window_start);

-- ── 3. Atomic claim function (service-role only) ────────────────────────────
-- Recovers stale processing claims, then atomically claims a bounded batch of
-- due rows with FOR UPDATE SKIP LOCKED so overlapping cron runs or requests
-- never claim the same row. Only queued or retry_wait rows whose next_attempt_at
-- is due (or null) are claimed. Terminal rows are never claimed.
CREATE OR REPLACE FUNCTION public.claim_due_message_notification_deliveries(
  p_worker        text,
  p_limit         integer DEFAULT 10,
  p_stale_seconds integer DEFAULT 300
)
RETURNS SETOF public.message_notification_deliveries
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

  -- Recover stale processing claims (worker died mid-attempt) back to retry_wait,
  -- due now, with the lock cleared, only while attempts remain.
  UPDATE public.message_notification_deliveries d
  SET queue_status    = 'retry_wait',
      next_attempt_at = v_now,
      locked_at       = NULL,
      locked_by       = NULL,
      updated_at      = v_now
  WHERE d.queue_status = 'processing'
    AND d.locked_at IS NOT NULL
    AND d.locked_at < v_now - (p_stale_seconds || ' seconds')::interval
    AND d.attempts < d.max_attempts;

  -- Atomically claim a bounded batch of due rows.
  RETURN QUERY
  WITH due AS (
    SELECT d.id
    FROM public.message_notification_deliveries d
    WHERE d.queue_status IN ('queued', 'retry_wait')
      AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= v_now)
    ORDER BY d.next_attempt_at NULLS FIRST, d.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.message_notification_deliveries d
  SET queue_status = 'processing',
      locked_at    = v_now,
      locked_by    = p_worker,
      updated_at   = v_now
  FROM due
  WHERE d.id = due.id
  RETURNING d.*;
END;
$$;

COMMENT ON FUNCTION public.claim_due_message_notification_deliveries(text, integer, integer) IS
  'Service-role-only. Recovers stale processing claims older than p_stale_seconds, then atomically claims up to p_limit due (queued or retry_wait, next_attempt_at due or null) delivery rows using FOR UPDATE SKIP LOCKED and marks them processing under p_worker. Guarantees one active claim per row across overlapping workers. Terminal rows (sent/failed/suppressed) are never claimed.';

-- ── 4. Active portal-recipient gating (service-role only) ───────────────────
-- Answers, for a worker, whether an EXPLICIT participant profile currently has
-- active student access to a conversation. It does NOT use portal_profile_id()
-- or has_active_role_grant() (which evaluate the current authenticated caller),
-- because a service-role worker has no portal identity. It never authorizes
-- through conversation id alone, related_* context, assigned staff, or email
-- presence. It is for recipient eligibility only and exposes no conversation
-- rows.
CREATE OR REPLACE FUNCTION public.message_recipient_has_active_access(
  p_conversation_id uuid,
  p_profile_id      uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = p_conversation_id
      AND cp.participant_profile_id = p_profile_id
      AND cp.participant_role = 'student'
      AND cp.scope_kind = 'student'
      AND cp.removed_at IS NULL
      -- Active student role grant for THIS profile (canonical predicate).
      AND EXISTS (
        SELECT 1 FROM public.user_role_grants g
        WHERE g.user_profile_id = p_profile_id
          AND g.role = 'student'
          AND g.revoked_at IS NULL
          AND g.starts_at <= now()
          AND (g.expires_at IS NULL OR g.expires_at > now())
      )
      -- Active student link matching the participant's scope.
      AND EXISTS (
        SELECT 1 FROM public.user_student_links l
        WHERE l.user_profile_id = p_profile_id
          AND l.student_id = cp.scope_student_id
          AND l.revoked_at IS NULL
      )
  );
$$;

COMMENT ON FUNCTION public.message_recipient_has_active_access(uuid, uuid) IS
  'Service-role-only recipient-eligibility check. Returns true only when the explicit p_profile_id is an active (removed_at null) student participant of p_conversation_id, holds an active student role grant (revoked_at null, started, not expired), and has an active user_student_links row matching the participant scope_student_id. Uses an explicit profile id, not the current caller. Never authorizes via conversation id alone, related_* context, assignment, or email presence. Exposes no conversation rows.';

-- ── 5. Atomic portal-user rate-limit consumption (service-role only) ────────
-- Receives a SERVER-VERIFIED user_profiles.id (never a client-supplied id) and
-- an action kind, atomically consumes the window, and returns enough for a
-- future API to render a 429. Fails closed on invalid parameters (raises).
CREATE OR REPLACE FUNCTION public.consume_message_rate_limit(
  p_profile_id     uuid,
  p_action_kind    text,
  p_window_seconds integer,
  p_max_per_window integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now      timestamptz := now();
  v_count    integer;
  v_window   timestamptz;
  v_allowed  boolean;
  v_reset_at timestamptz;
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'p_profile_id must be non-null';
  END IF;
  IF p_action_kind IS NULL OR p_action_kind NOT IN ('new_conversation', 'message') THEN
    RAISE EXCEPTION 'p_action_kind must be new_conversation or message';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds <= 0 OR p_window_seconds > 3600 THEN
    RAISE EXCEPTION 'p_window_seconds must be between 1 and 3600';
  END IF;
  IF p_max_per_window IS NULL OR p_max_per_window <= 0 OR p_max_per_window > 1000 THEN
    RAISE EXCEPTION 'p_max_per_window must be between 1 and 1000';
  END IF;

  -- Opportunistic bounded cleanup of stale rows (older than 24 hours, max 50 per call).
  DELETE FROM public.message_rate_limit_counters
  WHERE ctid IN (
    SELECT ctid FROM public.message_rate_limit_counters
    WHERE window_start < v_now - interval '24 hours'
    LIMIT 50
  );

  -- Atomic upsert with window rollover.
  INSERT INTO public.message_rate_limit_counters AS c (profile_id, action_kind, window_start, count)
  VALUES (p_profile_id, p_action_kind, v_now, 1)
  ON CONFLICT (profile_id, action_kind) DO UPDATE
  SET count = CASE
        WHEN c.window_start + (p_window_seconds || ' seconds')::interval <= v_now THEN 1
        ELSE c.count + 1
      END,
      window_start = CASE
        WHEN c.window_start + (p_window_seconds || ' seconds')::interval <= v_now THEN v_now
        ELSE c.window_start
      END
  RETURNING count, window_start INTO v_count, v_window;

  v_allowed  := v_count <= p_max_per_window;
  v_reset_at := v_window + (p_window_seconds || ' seconds')::interval;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'action_kind', p_action_kind,
    'limit', p_max_per_window,
    'remaining', GREATEST(0, p_max_per_window - v_count),
    'reset_at', v_reset_at,
    'retry_after_seconds',
      CASE WHEN v_allowed THEN 0
           ELSE GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_reset_at - v_now)))::integer)
      END
  );
END;
$$;

COMMENT ON FUNCTION public.consume_message_rate_limit(uuid, text, integer, integer) IS
  'Service-role-only. Atomically consumes one unit of an authenticated portal user rate-limit window keyed by user_profiles.id and action_kind (new_conversation or message). Receives a server-verified profile id only; never trusts a client-supplied id. Returns jsonb {allowed, action_kind, limit, remaining, reset_at, retry_after_seconds} for a future API to produce a 429. Fails closed on invalid parameters. Bounded window and limit guardrails; bounded opportunistic cleanup of stale rows.';

-- ── 6. Row Level Security ───────────────────────────────────────────────────
ALTER TABLE public.message_notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_rate_limit_counters      ENABLE ROW LEVEL SECURITY;

-- ── 7. Table privileges (deny by default, then least privilege) ─────────────
-- Deliveries: authenticated SELECT (rows restricted by the Owner/Admin policy),
-- no authenticated mutation; service_role SELECT/INSERT/UPDATE, never
-- DELETE/TRUNCATE. Rate counters: service-role only, no client access at all.
REVOKE ALL ON public.message_notification_deliveries,
              public.message_rate_limit_counters
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON public.message_notification_deliveries TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.message_notification_deliveries TO service_role;

-- Rate counters are ephemeral throwaway state; the consume function needs the
-- upsert and bounded cleanup. No TRUNCATE, no client access.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_rate_limit_counters TO service_role;

-- ── 8. Policies ─────────────────────────────────────────────────────────────
-- Active Owner/Admin may SELECT deliveries for operational observability only.
-- No mutation policy exists (writes are service-role). No portal policy exists.
CREATE POLICY "mnd_staff_select" ON public.message_notification_deliveries
  FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin());

-- message_rate_limit_counters has NO policy: RLS is enabled with no policy, so
-- anon and authenticated are denied; service_role writes bypass RLS.

-- ── 9. Function privileges (Wave F-1 conventions: service-role only) ─────────
REVOKE ALL ON FUNCTION public.claim_due_message_notification_deliveries(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_message_notification_deliveries(text, integer, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.message_recipient_has_active_access(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.message_recipient_has_active_access(uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.consume_message_rate_limit(uuid, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_message_rate_limit(uuid, text, integer, integer)
  TO service_role;

COMMIT;

-- Refresh the PostgREST schema cache so the new objects are visible to the API
-- layer (Stage B uses service-role clients). Safe and idempotent.
NOTIFY pgrst, 'reload schema';

-- Read-only verification is intentionally NOT included here. After applying this
-- migration, run db/audit/messages_phase2_verification.sql (system-catalog
-- SELECTs only) to confirm tables, RLS, constraints, function security, grants,
-- the separation of queue and provider status, and the no-body posture.
