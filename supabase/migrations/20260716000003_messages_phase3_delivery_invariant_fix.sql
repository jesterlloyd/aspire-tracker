-- ============================================================================
-- ASPIRE MESSAGES, PHASE 3 (STAGE A CORRECTIVE): delivery invariant fix
-- ============================================================================
-- Owner instructions: run this ENTIRE file as one block in the Supabase SQL
-- editor. It replaces two function bodies and adds one validation helper. It
-- creates no table, no data, no policy, and no grant change beyond re-asserting
-- the existing hardened posture. The applied migration
-- 20260716000002_messages_phase3_api_foundation.sql is NOT modified.
--
-- WHY THIS EXISTS
-- The applied 00002 definitions of messages_start_conversation() and
-- messages_post_reply() guarded the durable delivery insert with
--   IF p_delivery IS NOT NULL AND p_delivery ? 'idempotency_key' THEN ...
--   ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO v_delivery_id;
-- That permits four ways to commit an authoritative message with NO delivery
-- row: a null p_delivery, a p_delivery missing idempotency_key, a silently
-- ignored conflict, and a null v_delivery_id that was never asserted. The
-- approved Phase 3 invariant is that starting a conversation and posting a reply
-- must ATOMICALLY create the durable queued delivery row. A server-side promise
-- to always pass a valid p_delivery is not sufficient, because this RPC is the
-- transaction boundary that must enforce the invariant.
--
-- WHAT CHANGES
--   1. New helper message_assert_valid_delivery(): strict allowlisted validation
--      of the delivery payload, raising a 5-character SQLSTATE on any problem.
--   2. messages_start_conversation() and messages_post_reply() are replaced
--      (same signatures, so grants are preserved) to:
--        - require a non-null delivery object with every required field
--        - reject a missing or blank idempotency_key or recipient_email
--        - reject an invalid recipient_kind or event_type
--        - require the event type appropriate to the operation
--        - enforce the approved Phase 2 routing shape for recipient_kind
--        - reject any body-like field in the delivery payload
--        - reject the sender being the recipient
--        - insert the delivery WITHOUT ON CONFLICT DO NOTHING, so a duplicate
--          idempotency key aborts the transaction (MS409) and the message is
--          never committed without its delivery row
--        - assert a non-null delivery_id before returning
--
-- Everything else is preserved byte-for-byte in behavior: the 5000-character
-- body limit, the 3 to 120 character subject rule, every authorization check,
-- sender-only read-pointer updates, automatic reopening with its reopened audit
-- event, and the append-only message model.
--
-- Phase 2 routing is NOT duplicated here. Stage B continues to compute routing
-- and the idempotency key with the Phase 2 modules; this migration only enforces
-- that whatever arrives is internally consistent and actually persisted.
--
-- SQLSTATE mapping (5 characters, mirroring PT400/PT404/PT409):
--   MS400 -> 422 validation, MS403 -> 403, MS404 -> 404, MS409 -> 409 conflict.
--
-- This file is atomic (BEGIN/COMMIT) and idempotent (CREATE OR REPLACE only).
-- Read-only verification lives in
-- db/audit/messages_phase3_delivery_invariant_verification.sql.
-- ============================================================================

BEGIN;

-- ── 1. Strict delivery-payload validation helper ────────────────────────────
-- Raises on any invalid or unsafe delivery payload. Kept minimal: it validates
-- internal consistency and safety only, and does not re-implement Phase 2
-- routing selection.
CREATE OR REPLACE FUNCTION public.message_assert_valid_delivery(
  p_delivery         jsonb,
  p_expected_event   text,
  p_actor_profile_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_key   text;
  v_email text;
  v_kind  text;
  v_event text;
  v_rp    uuid;
  v_k     text;
BEGIN
  IF p_delivery IS NULL OR jsonb_typeof(p_delivery) <> 'object' THEN
    RAISE EXCEPTION 'delivery payload is required' USING ERRCODE = 'MS400';
  END IF;

  -- No message content may ever enter a delivery row.
  FOR v_k IN SELECT jsonb_object_keys(p_delivery) LOOP
    IF v_k ~* '(^|_)(body|preview|snippet|content|html|text|quote|quoted)(_|$)' THEN
      RAISE EXCEPTION 'delivery payload may not contain message content'
        USING ERRCODE = 'MS400';
    END IF;
  END LOOP;

  v_key   := btrim(coalesce(p_delivery->>'idempotency_key', ''));
  v_email := btrim(coalesce(p_delivery->>'recipient_email', ''));
  v_kind  := coalesce(p_delivery->>'recipient_kind', '');
  v_event := coalesce(p_delivery->>'event_type', '');
  v_rp    := NULLIF(p_delivery->>'recipient_profile_id', '')::uuid;

  IF v_key = '' THEN
    RAISE EXCEPTION 'delivery idempotency_key is required' USING ERRCODE = 'MS400';
  END IF;
  IF v_email = '' THEN
    RAISE EXCEPTION 'delivery recipient_email is required' USING ERRCODE = 'MS400';
  END IF;
  IF v_kind NOT IN ('shared_inbox', 'assigned_staff', 'portal_user') THEN
    RAISE EXCEPTION 'invalid delivery recipient_kind' USING ERRCODE = 'MS400';
  END IF;
  IF v_event NOT IN ('new_conversation', 'portal_reply', 'staff_reply') THEN
    RAISE EXCEPTION 'invalid delivery event_type' USING ERRCODE = 'MS400';
  END IF;
  IF v_event <> p_expected_event THEN
    RAISE EXCEPTION 'delivery event_type does not match the operation'
      USING ERRCODE = 'MS400';
  END IF;

  -- The recipient kind must match the approved Phase 2 routing shape.
  IF v_event = 'new_conversation' AND v_kind <> 'shared_inbox' THEN
    RAISE EXCEPTION 'new_conversation must route to the shared inbox' USING ERRCODE = 'MS400';
  END IF;
  IF v_event = 'portal_reply' AND v_kind NOT IN ('shared_inbox', 'assigned_staff') THEN
    RAISE EXCEPTION 'portal_reply must route to staff' USING ERRCODE = 'MS400';
  END IF;
  IF v_event = 'staff_reply' AND v_kind <> 'portal_user' THEN
    RAISE EXCEPTION 'staff_reply must route to the portal participant' USING ERRCODE = 'MS400';
  END IF;
  IF v_kind = 'portal_user' AND v_rp IS NULL THEN
    RAISE EXCEPTION 'portal_user delivery requires recipient_profile_id' USING ERRCODE = 'MS400';
  END IF;

  -- The sender is never the recipient.
  IF v_rp IS NOT NULL AND v_rp = p_actor_profile_id THEN
    RAISE EXCEPTION 'sender may not be the notification recipient' USING ERRCODE = 'MS400';
  END IF;

  -- Required safe snapshot and CTA fields.
  IF btrim(coalesce(p_delivery->>'snapshot_sender_name', '')) = '' THEN
    RAISE EXCEPTION 'delivery snapshot_sender_name is required' USING ERRCODE = 'MS400';
  END IF;
  IF btrim(coalesce(p_delivery->>'snapshot_subject', '')) = '' THEN
    RAISE EXCEPTION 'delivery snapshot_subject is required' USING ERRCODE = 'MS400';
  END IF;
  IF btrim(coalesce(p_delivery->>'cta_path', '')) = '' THEN
    RAISE EXCEPTION 'delivery cta_path is required' USING ERRCODE = 'MS400';
  END IF;
END;
$$;

-- ── 2. messages_start_conversation (corrected, same signature) ──────────────
CREATE OR REPLACE FUNCTION public.messages_start_conversation(
  p_actor_profile_id       uuid,
  p_actor_kind             text,
  p_participant_profile_id uuid,
  p_student_id             uuid,
  p_subject                text,
  p_category               text,
  p_body                   text,
  p_delivery               jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now             timestamptz := now();
  v_conversation_id uuid;
  v_message_id      uuid;
  v_delivery_id     uuid;
  v_subject         text := btrim(coalesce(p_subject, ''));
  v_author_role     text;
  v_expected_event  text;
BEGIN
  IF p_actor_kind NOT IN ('student', 'staff') THEN
    RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(v_subject) < 3 OR char_length(v_subject) > 120 THEN
    RAISE EXCEPTION 'subject must be 3 to 120 characters' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(btrim(coalesce(p_body, ''))) < 1 OR char_length(p_body) > 5000 THEN
    RAISE EXCEPTION 'body must be 1 to 5000 characters' USING ERRCODE = 'MS400';
  END IF;

  -- The participant must hold active student portal access in every case.
  IF NOT public.message_profile_has_active_student_link(p_participant_profile_id, p_student_id) THEN
    RAISE EXCEPTION 'participant portal access is not active' USING ERRCODE = 'MS409';
  END IF;

  IF p_actor_kind = 'student' THEN
    IF p_actor_profile_id IS DISTINCT FROM p_participant_profile_id THEN
      RAISE EXCEPTION 'student may only start their own conversation' USING ERRCODE = 'MS403';
    END IF;
    v_author_role    := 'student';
    v_expected_event := 'new_conversation';
  ELSE
    IF NOT public.message_profile_is_active_owner_or_admin(p_actor_profile_id) THEN
      RAISE EXCEPTION 'staff actor must be an active owner or admin' USING ERRCODE = 'MS403';
    END IF;
    v_author_role    := 'staff';
    v_expected_event := 'staff_reply';
  END IF;

  -- REQUIRED durable delivery payload. Validated before any authoritative write
  -- so an invalid payload fails fast and creates nothing.
  PERFORM public.message_assert_valid_delivery(p_delivery, v_expected_event, p_actor_profile_id);

  INSERT INTO public.conversations (
    subject, category, status, created_by_profile_id, created_by_role,
    related_student_id, last_message_at, created_at, updated_at
  ) VALUES (
    v_subject, p_category, 'open', p_actor_profile_id, v_author_role,
    p_student_id, v_now, v_now, v_now
  ) RETURNING id INTO v_conversation_id;

  INSERT INTO public.conversation_participants (
    conversation_id, participant_profile_id, participant_role, scope_kind,
    scope_student_id, added_at
  ) VALUES (
    v_conversation_id, p_participant_profile_id, 'student', 'student',
    p_student_id, v_now
  );

  INSERT INTO public.messages (conversation_id, author_profile_id, author_role, body, created_at)
  VALUES (v_conversation_id, p_actor_profile_id, v_author_role, p_body, v_now)
  RETURNING id INTO v_message_id;

  INSERT INTO public.conversation_events (conversation_id, event_type, actor_profile_id, to_value, created_at)
  VALUES (v_conversation_id, 'created', p_actor_profile_id, 'open', v_now);

  -- The SENDER's read pointer only. The recipient is never marked read.
  IF p_actor_kind = 'student' THEN
    INSERT INTO public.participant_conversation_reads (participant_profile_id, conversation_id, last_read_at)
    VALUES (p_actor_profile_id, v_conversation_id, v_now)
    ON CONFLICT (participant_profile_id, conversation_id) DO UPDATE SET last_read_at = v_now;
  ELSE
    INSERT INTO public.staff_conversation_reads (staff_profile_id, conversation_id, last_read_at)
    VALUES (p_actor_profile_id, v_conversation_id, v_now)
    ON CONFLICT (staff_profile_id, conversation_id) DO UPDATE SET last_read_at = v_now;
  END IF;

  -- Durable queued delivery row, in the SAME transaction as the authoritative
  -- write. NO ON CONFLICT DO NOTHING: the message is new inside this
  -- transaction, so an existing row for this key can never legitimately belong
  -- to it. A conflict aborts everything rather than committing a message with no
  -- delivery record. The unique idempotency guarantee is unchanged.
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

  RETURN jsonb_build_object(
    'conversation_id', v_conversation_id,
    'message_id', v_message_id,
    'delivery_id', v_delivery_id,
    'created_at', v_now,
    'status', 'open'
  );
END;
$$;

-- ── 3. messages_post_reply (corrected, same signature) ──────────────────────
CREATE OR REPLACE FUNCTION public.messages_post_reply(
  p_actor_profile_id uuid,
  p_actor_kind       text,
  p_conversation_id  uuid,
  p_body             text,
  p_delivery         jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now            timestamptz := now();
  v_message_id     uuid;
  v_delivery_id    uuid;
  v_status         text;
  v_reopened       boolean := false;
  v_author_role    text;
  v_participant    uuid;
  v_expected_event text;
BEGIN
  IF p_actor_kind NOT IN ('student', 'staff') THEN
    RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(btrim(coalesce(p_body, ''))) < 1 OR char_length(p_body) > 5000 THEN
    RAISE EXCEPTION 'body must be 1 to 5000 characters' USING ERRCODE = 'MS400';
  END IF;

  SELECT status INTO v_status FROM public.conversations WHERE id = p_conversation_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
  END IF;

  IF p_actor_kind = 'student' THEN
    -- Live active participant access (never conversation id alone).
    IF NOT public.message_recipient_has_active_access(p_conversation_id, p_actor_profile_id) THEN
      RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
    END IF;
    v_author_role    := 'student';
    v_expected_event := 'portal_reply';
  ELSE
    IF NOT public.message_profile_is_active_owner_or_admin(p_actor_profile_id) THEN
      RAISE EXCEPTION 'staff actor must be an active owner or admin' USING ERRCODE = 'MS403';
    END IF;
    -- Staff may not send into a thread whose participant lost portal access.
    SELECT cp.participant_profile_id INTO v_participant
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = p_conversation_id AND cp.removed_at IS NULL
    LIMIT 1;
    IF v_participant IS NULL
       OR NOT public.message_recipient_has_active_access(p_conversation_id, v_participant) THEN
      RAISE EXCEPTION 'participant portal access is not active' USING ERRCODE = 'MS409';
    END IF;
    v_author_role    := 'staff';
    v_expected_event := 'staff_reply';
  END IF;

  -- REQUIRED durable delivery payload, validated before any authoritative write.
  PERFORM public.message_assert_valid_delivery(p_delivery, v_expected_event, p_actor_profile_id);

  -- A staff reply must target the conversation's active portal participant.
  IF p_actor_kind = 'staff'
     AND NULLIF(p_delivery->>'recipient_profile_id', '')::uuid IS DISTINCT FROM v_participant THEN
    RAISE EXCEPTION 'staff reply must notify the active conversation participant'
      USING ERRCODE = 'MS400';
  END IF;

  -- Automatic reopen on reply to a resolved conversation.
  IF v_status = 'resolved' THEN
    UPDATE public.conversations
    SET status = 'open', resolved_at = NULL, updated_at = v_now
    WHERE id = p_conversation_id;
    INSERT INTO public.conversation_events (conversation_id, event_type, actor_profile_id, from_value, to_value, created_at)
    VALUES (p_conversation_id, 'reopened', p_actor_profile_id, 'resolved', 'open', v_now);
    v_reopened := true;
  END IF;

  INSERT INTO public.messages (conversation_id, author_profile_id, author_role, body, created_at)
  VALUES (p_conversation_id, p_actor_profile_id, v_author_role, p_body, v_now)
  RETURNING id INTO v_message_id;

  UPDATE public.conversations
  SET last_message_at = v_now, updated_at = v_now
  WHERE id = p_conversation_id;

  IF p_actor_kind = 'student' THEN
    INSERT INTO public.participant_conversation_reads (participant_profile_id, conversation_id, last_read_at)
    VALUES (p_actor_profile_id, p_conversation_id, v_now)
    ON CONFLICT (participant_profile_id, conversation_id) DO UPDATE SET last_read_at = v_now;
  ELSE
    INSERT INTO public.staff_conversation_reads (staff_profile_id, conversation_id, last_read_at)
    VALUES (p_actor_profile_id, p_conversation_id, v_now)
    ON CONFLICT (staff_profile_id, conversation_id) DO UPDATE SET last_read_at = v_now;
  END IF;

  -- Durable queued delivery row, same transaction, no silent conflict skip.
  BEGIN
    INSERT INTO public.message_notification_deliveries (
      conversation_id, message_id, triggered_by_profile_id, recipient_profile_id,
      recipient_email, recipient_kind, event_type, idempotency_key,
      queue_status, next_attempt_at,
      snapshot_sender_name, snapshot_subject, snapshot_category, cta_path
    ) VALUES (
      p_conversation_id, v_message_id, p_actor_profile_id,
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

  RETURN jsonb_build_object(
    'message_id', v_message_id,
    'delivery_id', v_delivery_id,
    'created_at', v_now,
    'reopened', v_reopened
  );
END;
$$;

-- ── 4. Function privileges (re-asserted; CREATE OR REPLACE preserves grants) ─
REVOKE ALL ON FUNCTION public.message_assert_valid_delivery(jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.message_assert_valid_delivery(jsonb, text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.messages_start_conversation(uuid, text, uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.messages_start_conversation(uuid, text, uuid, uuid, text, text, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.messages_post_reply(uuid, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.messages_post_reply(uuid, text, uuid, text, jsonb) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Read-only verification is intentionally NOT included here. After applying, run
-- db/audit/messages_phase3_delivery_invariant_verification.sql.
