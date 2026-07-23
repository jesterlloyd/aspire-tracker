-- ============================================================================
-- ASPIRE MESSAGES: general ASPIRE Team threads with request idempotency
-- ============================================================================
-- APPLY MANUALLY (Owner/Jester), after:
--   20260720000002_unit_leader_notifications_and_concerns.sql
--
-- This migration adds the backend contract for portal users to start multiple
-- GENERAL ASPIRE Team threads with no student context and no arbitrary unit
-- context. It does not activate any UI.
--
-- What this adds:
--   1. A durable request-level idempotency ledger for conversation creation.
--   2. General portal authorization helpers for Student and Unit Leader actors.
--   3. A narrow participant-shape widening so a single portal participant can be
--      attached to a general ASPIRE Team thread without fake student or unit
--      context.
--   4. Updated read/send predicates for the new null-context participant rows.
--   5. A service-role-only transactional RPC that creates exactly one
--      conversation, participant, first message, event, read pointer, delivery
--      row, and idempotency result per intentional request.
--
-- Request idempotency is deliberately separate from notification-delivery
-- idempotency. Replaying the same actor + request_id + payload fingerprint
-- returns the original conversation/message/delivery result and creates no
-- second conversation, message, or delivery.
--
-- The migration does NOT:
--   - run or schedule any data backfill
--   - modify sender or Reply-To behavior
--   - create Academic Partner access
--   - weaken student-linked or direct-student scope checks
--   - grant portal users direct table writes
-- ============================================================================

BEGIN;

-- ############################################################################
-- 1. Request-level idempotency ledger
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.message_creation_requests (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id    uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  operation_kind      text        NOT NULL,
  request_id          uuid        NOT NULL,
  payload_fingerprint text        NOT NULL,
  status              text        NOT NULL DEFAULT 'in_progress',
  conversation_id     uuid        REFERENCES public.conversations(id) ON DELETE RESTRICT,
  message_id          uuid        REFERENCES public.messages(id) ON DELETE RESTRICT,
  delivery_id         uuid        REFERENCES public.message_notification_deliveries(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_message_creation_requests_actor_operation_request
    UNIQUE (actor_profile_id, operation_kind, request_id),
  CONSTRAINT chk_mcr_operation_kind
    CHECK (operation_kind IN ('general_team_thread_start')),
  CONSTRAINT chk_mcr_payload_fingerprint
    CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_mcr_status
    CHECK (status IN ('in_progress', 'completed')),
  CONSTRAINT chk_mcr_completed_consistent
    CHECK (
      (status = 'in_progress'
        AND conversation_id IS NULL
        AND message_id IS NULL
        AND delivery_id IS NULL
        AND completed_at IS NULL)
      OR
      (status = 'completed'
        AND conversation_id IS NOT NULL
        AND message_id IS NOT NULL
        AND delivery_id IS NOT NULL
        AND completed_at IS NOT NULL)
    )
);

COMMENT ON TABLE public.message_creation_requests IS
  'Durable request-level idempotency ledger for ASPIRE Messages conversation creation. Scoped by actor_profile_id, operation_kind, and request_id. Stores only an opaque payload fingerprint and authoritative result ids, never message body or routing payload. Service-role-only direct access.';

CREATE INDEX IF NOT EXISTS idx_mcr_conversation
  ON public.message_creation_requests (conversation_id)
  WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mcr_message
  ON public.message_creation_requests (message_id)
  WHERE message_id IS NOT NULL;

ALTER TABLE public.message_creation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.message_creation_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.message_creation_requests TO service_role;

-- ############################################################################
-- 2. General portal authorization helpers
-- ############################################################################
CREATE OR REPLACE FUNCTION public.message_profile_has_active_student_portal(
  p_profile_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT public.message_profile_is_active(p_profile_id)
    AND EXISTS (
      SELECT 1 FROM public.user_role_grants g
      WHERE g.user_profile_id = p_profile_id
        AND g.role = 'student'
        AND g.revoked_at IS NULL
        AND g.starts_at <= now()
        AND (g.expires_at IS NULL OR g.expires_at > now())
    )
    AND EXISTS (
      SELECT 1 FROM public.user_student_links l
      WHERE l.user_profile_id = p_profile_id
        AND l.revoked_at IS NULL
    );
$$;

CREATE OR REPLACE FUNCTION public.message_profile_has_active_unit_leader_portal_scope(
  p_profile_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT public.message_profile_is_active(p_profile_id)
    AND EXISTS (
      SELECT 1 FROM public.user_role_grants g
      WHERE g.user_profile_id = p_profile_id
        AND g.role = 'unit_leader'
        AND g.revoked_at IS NULL
        AND g.starts_at <= now()
        AND (g.expires_at IS NULL OR g.expires_at > now())
    )
    AND EXISTS (
      SELECT 1 FROM public.user_unit_scopes s
      WHERE s.user_profile_id = p_profile_id
        AND s.revoked_at IS NULL
        AND s.starts_at <= now()
        AND (s.expires_at IS NULL OR s.expires_at > now())
    );
$$;

-- ############################################################################
-- 3. Participant shape: allow null-context general team rows
-- ############################################################################
ALTER TABLE public.conversation_participants
  DROP CONSTRAINT IF EXISTS chk_participant_role_scope;
ALTER TABLE public.conversation_participants
  ADD CONSTRAINT chk_participant_role_scope CHECK (
    (participant_role = 'student'
      AND scope_kind = 'student'
      AND scope_unit_key IS NULL
      AND scope_school_key IS NULL
      AND scope_cohort_id IS NULL)
    OR
    (participant_role = 'preceptor'
      AND scope_kind = 'student'
      AND scope_student_id IS NOT NULL
      AND scope_unit_key IS NULL
      AND scope_school_key IS NULL)
    OR
    (participant_role = 'unit_leader'
      AND scope_kind = 'unit'
      AND scope_school_key IS NULL
      AND scope_cohort_id IS NULL)
    OR
    (participant_role = 'academic_partner'
      AND scope_kind = 'school'
      AND scope_school_key IS NOT NULL
      AND scope_student_id IS NULL
      AND scope_unit_key IS NULL)
  );

-- ############################################################################
-- 4. Read and send predicates for general threads
-- ############################################################################
CREATE OR REPLACE FUNCTION public.message_participant_can_read(
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
      AND cp.removed_at IS NULL
      AND (
        (
          cp.participant_role = 'student'
          AND cp.scope_kind = 'student'
          AND (
            (
              cp.scope_student_id IS NULL
              AND public.message_profile_has_active_student_portal(p_profile_id)
            )
            OR
            (
              cp.scope_student_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM public.user_role_grants g
                WHERE g.user_profile_id = p_profile_id
                  AND g.role = 'student'
                  AND g.revoked_at IS NULL
                  AND g.starts_at <= now()
                  AND (g.expires_at IS NULL OR g.expires_at > now())
              )
              AND EXISTS (
                SELECT 1 FROM public.user_student_links l
                WHERE l.user_profile_id = p_profile_id
                  AND l.student_id = cp.scope_student_id
                  AND l.revoked_at IS NULL
              )
            )
          )
        )
        OR
        (
          cp.participant_role = 'unit_leader'
          AND cp.scope_kind = 'unit'
          AND public.message_profile_is_active(p_profile_id)
          AND EXISTS (
            SELECT 1 FROM public.user_role_grants g
            WHERE g.user_profile_id = p_profile_id
              AND g.role = 'unit_leader'
              AND g.revoked_at IS NULL
              AND g.starts_at <= now()
              AND (g.expires_at IS NULL OR g.expires_at > now())
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.message_participant_can_send(
  p_conversation_id uuid,
  p_profile_id      uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT
    public.message_participant_can_read(p_conversation_id, p_profile_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.conversation_participants cp
      WHERE cp.conversation_id = p_conversation_id
        AND cp.removed_at IS NULL
        AND cp.participant_role = 'unit_leader'
        AND (
          (
            cp.scope_unit_key IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.user_unit_scopes s
              WHERE s.user_profile_id = cp.participant_profile_id
                AND s.unit_key = cp.scope_unit_key
                AND s.revoked_at IS NULL
                AND s.starts_at <= now()
                AND (s.expires_at IS NULL OR s.expires_at > now())
            )
          )
          OR
          (
            cp.scope_unit_key IS NULL
            AND NOT public.message_profile_has_active_unit_leader_portal_scope(cp.participant_profile_id)
          )
        )
    );
$$;

-- ############################################################################
-- 5. Idempotent general ASPIRE Team start RPC
-- ############################################################################
CREATE OR REPLACE FUNCTION public.messages_start_general_team_conversation(
  p_actor_profile_id       uuid,
  p_actor_kind             text,
  p_request_id             uuid,
  p_payload_fingerprint    text,
  p_subject                text,
  p_category               text,
  p_body                   text,
  p_delivery               jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now              timestamptz := now();
  v_request_row_id   uuid;
  v_existing         public.message_creation_requests%ROWTYPE;
  v_conversation_id  uuid;
  v_message_id       uuid;
  v_delivery_id      uuid;
  v_subject          text := btrim(coalesce(p_subject, ''));
  v_category         text := nullif(btrim(coalesce(p_category, '')), '');
  v_rate             jsonb;
BEGIN
  IF p_actor_kind NOT IN ('student', 'unit_leader') THEN
    RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request id is required' USING ERRCODE = 'MS400';
  END IF;
  IF p_payload_fingerprint IS NULL OR p_payload_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'payload fingerprint is invalid' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(v_subject) < 3 OR char_length(v_subject) > 120 THEN
    RAISE EXCEPTION 'subject must be 3 to 120 characters' USING ERRCODE = 'MS400';
  END IF;
  IF v_category IS DISTINCT FROM 'General question' THEN
    RAISE EXCEPTION 'general team category must be General question' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(btrim(coalesce(p_body, ''))) < 1 OR char_length(p_body) > 5000 THEN
    RAISE EXCEPTION 'body must be 1 to 5000 characters' USING ERRCODE = 'MS400';
  END IF;

  INSERT INTO public.message_creation_requests (
    actor_profile_id, operation_kind, request_id, payload_fingerprint,
    status, created_at, updated_at
  ) VALUES (
    p_actor_profile_id, 'general_team_thread_start', p_request_id,
    p_payload_fingerprint, 'in_progress', v_now, v_now
  )
  ON CONFLICT (actor_profile_id, operation_kind, request_id) DO NOTHING
  RETURNING id INTO v_request_row_id;

  IF v_request_row_id IS NULL THEN
    SELECT *
    INTO v_existing
    FROM public.message_creation_requests
    WHERE actor_profile_id = p_actor_profile_id
      AND operation_kind = 'general_team_thread_start'
      AND request_id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'request idempotency state was not found' USING ERRCODE = 'MS409';
    END IF;
    IF v_existing.payload_fingerprint IS DISTINCT FROM p_payload_fingerprint THEN
      RAISE EXCEPTION 'request id was already used with a different payload' USING ERRCODE = 'MS409';
    END IF;
    IF v_existing.status = 'completed'
       AND v_existing.conversation_id IS NOT NULL
       AND v_existing.message_id IS NOT NULL
       AND v_existing.delivery_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'conversation_id', v_existing.conversation_id,
        'message_id', v_existing.message_id,
        'delivery_id', v_existing.delivery_id,
        'created_at', v_existing.completed_at,
        'status', 'open',
        'thread_kind', 'team_general',
        'idempotent_replay', true
      );
    END IF;

    RAISE EXCEPTION 'request is already in progress' USING ERRCODE = 'MS409';
  END IF;

  IF p_actor_kind = 'student' THEN
    IF NOT public.message_profile_has_active_student_portal(p_actor_profile_id) THEN
      RAISE EXCEPTION 'student portal access is not active' USING ERRCODE = 'MS403';
    END IF;
  ELSE
    IF NOT public.message_profile_has_active_unit_leader_portal_scope(p_actor_profile_id) THEN
      RAISE EXCEPTION 'unit leader access is not active' USING ERRCODE = 'MS403';
    END IF;
  END IF;

  SELECT public.consume_message_rate_limit(
    p_actor_profile_id, 'new_conversation', 3600, 5
  ) INTO v_rate;
  IF NOT COALESCE((v_rate->>'allowed')::boolean, false) THEN
    RAISE EXCEPTION 'new conversation rate limited' USING ERRCODE = 'MS429';
  END IF;

  SELECT public.consume_message_rate_limit(
    p_actor_profile_id, 'message', 600, 20
  ) INTO v_rate;
  IF NOT COALESCE((v_rate->>'allowed')::boolean, false) THEN
    RAISE EXCEPTION 'message rate limited' USING ERRCODE = 'MS429';
  END IF;

  PERFORM public.message_assert_valid_delivery(p_delivery, 'new_conversation', p_actor_profile_id);

  INSERT INTO public.conversations (
    subject, category, status, created_by_profile_id, created_by_role,
    related_student_id, related_unit_key, related_school_key, related_cohort_id,
    last_message_at, created_at, updated_at
  ) VALUES (
    v_subject, v_category, 'open', p_actor_profile_id, p_actor_kind,
    NULL, NULL, NULL, NULL,
    v_now, v_now, v_now
  ) RETURNING id INTO v_conversation_id;

  IF p_actor_kind = 'student' THEN
    INSERT INTO public.conversation_participants (
      conversation_id, participant_profile_id, participant_role, scope_kind,
      scope_student_id, scope_unit_key, scope_school_key, scope_cohort_id, added_at
    ) VALUES (
      v_conversation_id, p_actor_profile_id, 'student', 'student',
      NULL, NULL, NULL, NULL, v_now
    );
  ELSE
    INSERT INTO public.conversation_participants (
      conversation_id, participant_profile_id, participant_role, scope_kind,
      scope_student_id, scope_unit_key, scope_school_key, scope_cohort_id, added_at
    ) VALUES (
      v_conversation_id, p_actor_profile_id, 'unit_leader', 'unit',
      NULL, NULL, NULL, NULL, v_now
    );
  END IF;

  INSERT INTO public.messages (conversation_id, author_profile_id, author_role, body, created_at)
  VALUES (v_conversation_id, p_actor_profile_id, p_actor_kind, p_body, v_now)
  RETURNING id INTO v_message_id;

  INSERT INTO public.conversation_events (conversation_id, event_type, actor_profile_id, to_value, created_at)
  VALUES (v_conversation_id, 'created', p_actor_profile_id, 'open', v_now);

  INSERT INTO public.participant_conversation_reads (participant_profile_id, conversation_id, last_read_at)
  VALUES (p_actor_profile_id, v_conversation_id, v_now)
  ON CONFLICT (participant_profile_id, conversation_id) DO UPDATE SET last_read_at = v_now;

  BEGIN
    INSERT INTO public.message_notification_deliveries (
      conversation_id, message_id, triggered_by_profile_id, recipient_profile_id,
      recipient_email, recipient_kind, event_type, idempotency_key,
      queue_status, next_attempt_at,
      snapshot_sender_name, snapshot_subject, snapshot_category, cta_path
    ) VALUES (
      v_conversation_id, v_message_id, p_actor_profile_id,
      NULLIF(p_delivery->>'recipient_profile_id', '')::uuid,
      p_delivery->>'recipient_email', p_delivery->>'recipient_kind',
      p_delivery->>'event_type', p_delivery->>'idempotency_key',
      'queued', v_now,
      p_delivery->>'snapshot_sender_name', p_delivery->>'snapshot_subject',
      p_delivery->>'snapshot_category', p_delivery->>'cta_path'
    )
    RETURNING id INTO v_delivery_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate notification delivery for this message'
      USING ERRCODE = 'MS409';
  END;

  IF v_delivery_id IS NULL THEN
    RAISE EXCEPTION 'delivery row was not created' USING ERRCODE = 'MS409';
  END IF;

  UPDATE public.message_creation_requests
  SET status = 'completed',
      conversation_id = v_conversation_id,
      message_id = v_message_id,
      delivery_id = v_delivery_id,
      completed_at = v_now,
      updated_at = v_now
  WHERE id = v_request_row_id;

  RETURN jsonb_build_object(
    'conversation_id', v_conversation_id,
    'message_id', v_message_id,
    'delivery_id', v_delivery_id,
    'created_at', v_now,
    'status', 'open',
    'thread_kind', 'team_general',
    'idempotent_replay', false
  );
END;
$$;

COMMENT ON FUNCTION public.messages_start_general_team_conversation(uuid, text, uuid, text, text, text, text, jsonb) IS
  'Service-role-only. Idempotently starts a general portal-to-ASPIRE Team conversation with no student or unit context for an active Student or active Unit Leader with at least one active unit scope. The unique request ledger is scoped to actor_profile_id + operation_kind + request_id and stores an opaque payload fingerprint plus result ids. Replays with the same fingerprint return the original result; replays with a different fingerprint raise MS409. The function also creates the first notification delivery row in the same transaction.';

-- ############################################################################
-- 6. Grants
-- ############################################################################
REVOKE ALL ON FUNCTION public.message_profile_has_active_student_portal(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.message_profile_has_active_unit_leader_portal_scope(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.message_participant_can_read(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.message_participant_can_send(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.messages_start_general_team_conversation(uuid, text, uuid, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.message_profile_has_active_student_portal(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.message_profile_has_active_unit_leader_portal_scope(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.message_participant_can_read(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.message_participant_can_send(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.messages_start_general_team_conversation(uuid, text, uuid, text, text, text, text, jsonb)
  TO service_role;

-- my_message_conversation_ids(), message_recipient_has_active_access(), and the
-- portal read RPCs execute as SECURITY DEFINER functions. They may call the
-- updated predicates above while retaining their existing external grants.

COMMIT;
