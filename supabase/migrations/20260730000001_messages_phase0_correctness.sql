-- MESSAGES-CORRECTNESS-PHASE0-1
--
-- Two correctness fixes for ASPIRE Messages, both additive; awaits the Owner SQL
-- gate (docs/security/OWNER_SQL_GATE.md). Read-only verification queries and the
-- historical-audit interpretation live in docs/security/MESSAGES_PHASE0_VERIFICATION.md.
--
-- FIX 1 - portal reply authorship. messages_post_reply previously accepted only
-- ('student','staff','unit_leader'), and the general ASPIRE Team reply path always
-- passed 'student'. A unit leader or academic partner replying in a general team
-- thread (no direct counterpart) was therefore PERSISTED with author_role='student',
-- and 'academic_partner' was not an acceptable actor kind at all. This redefinition:
--   - accepts the academic_partner actor kind;
--   - persists v_author_role = the VERIFIED caller kind for every portal kind;
--   - derives the expected delivery event from the caller-declared payload within a
--     strict per-kind allowlist, so a unit leader can send BOTH a direct-thread
--     message (unit_leader_message) and a team-thread reply (portal_reply), and an
--     academic partner can only ever send portal_reply. The event allowlist is:
--       student:           portal_reply | student_to_unit_leader_message
--       unit_leader:       portal_reply | unit_leader_message
--       academic_partner:  portal_reply
--       staff:             staff_reply (unchanged branch)
--   - changes NOTHING else: authorization stays message_participant_can_send for
--     portal kinds (identical predicate the academic partner already passes through
--     today via the student branch), the staff branch, reopen, read-pointer, and
--     delivery-row logic are verbatim from 20260720000000.
--
-- FIX 2 - portal per-row unread counts. messages_portal_list_conversations counts
-- unread with the Phase 1 rule (author_role='staff'), while the global badge
-- (messages_portal_unread_count, redefined in 20260720000000) counts
-- author_profile_id <> me. A unit-leader-to-student direct message therefore bumps
-- the nav badge but shows unread 0 on the row. Per the v1/v2 naming convention
-- (20260716000004), the corrected rule ships as a NEW function,
-- messages_portal_list_conversations_v2; v1 stays intact for rollback, and the API
-- switches at runtime only once this function exists.
--
-- APPEND-ONLY: this migration performs no UPDATE and no DELETE on public.messages
-- or public.conversation_events, adds no columns, and broadens no table grants.
-- Existing mislabeled rows are NOT rewritten (see the verification doc for the
-- read-only audit and the correction-feasibility statement).

-- The whole migration applies ATOMICALLY: both RPC replacements and every
-- privilege statement land together or not at all.
BEGIN;

-- ── FIX 1: messages_post_reply with true portal actor kinds ──────────────────

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
  IF p_actor_kind NOT IN ('student', 'staff', 'unit_leader', 'academic_partner') THEN
    RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(btrim(coalesce(p_body, ''))) < 1 OR char_length(p_body) > 5000 THEN
    RAISE EXCEPTION 'body must be 1 to 5000 characters' USING ERRCODE = 'MS400';
  END IF;

  SELECT status INTO v_status FROM public.conversations WHERE id = p_conversation_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
  END IF;

  IF p_actor_kind IN ('student', 'unit_leader', 'academic_partner') THEN
    -- SEND authorization, not read. A former Unit Leader can still READ this thread
    -- but must never add to it, and once a direct relationship ends the thread is
    -- frozen for BOTH portal parties. can_send requires current active scope. The
    -- academic partner path already flows through this same predicate today.
    IF NOT public.message_participant_can_send(p_conversation_id, p_actor_profile_id) THEN
      -- Non-enumerating: a readable-but-frozen thread and an invisible one are
      -- indistinguishable to the caller.
      RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
    END IF;

    -- PHASE0: the author role is the VERIFIED caller kind, never a hardcoded value.
    v_author_role := p_actor_kind;

    -- PHASE0: expected delivery event, allowlisted per actor kind. The declared
    -- event still has to survive message_assert_valid_delivery below; this CASE
    -- only decides which event this actor is permitted to declare.
    v_expected_event := CASE
      WHEN p_actor_kind = 'student' AND p_delivery->>'event_type' = 'student_to_unit_leader_message'
        THEN 'student_to_unit_leader_message'
      WHEN p_actor_kind = 'unit_leader' AND p_delivery->>'event_type' = 'unit_leader_message'
        THEN 'unit_leader_message'
      ELSE 'portal_reply'
    END;
  ELSE
    IF NOT public.message_profile_is_active_owner_or_admin(p_actor_profile_id) THEN
      RAISE EXCEPTION 'staff actor must be an active owner or admin' USING ERRCODE = 'MS403';
    END IF;
    -- UL-PORTAL: a conversation may hold TWO active portal participants, and staff
    -- must be able to intervene even after a unit assignment has ended. The
    -- delivery's declared recipient is authoritative and is validated to be a
    -- participant of THIS conversation who can still READ it. Read, not send: a
    -- former Unit Leader may still receive a staff reply.
    v_participant := NULLIF(p_delivery->>'recipient_profile_id', '')::uuid;
    IF v_participant IS NULL
       OR NOT EXISTS (
            SELECT 1 FROM public.conversation_participants cp
            WHERE cp.conversation_id = p_conversation_id
              AND cp.participant_profile_id = v_participant
              AND cp.removed_at IS NULL)
       OR NOT public.message_participant_can_read(p_conversation_id, v_participant) THEN
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

  IF p_actor_kind IN ('student', 'unit_leader', 'academic_partner') THEN
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

REVOKE ALL ON FUNCTION public.messages_post_reply(uuid, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.messages_post_reply(uuid, text, uuid, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.messages_post_reply(uuid, text, uuid, text, jsonb) IS
  'Append one reply. PHASE0: portal author_role is the verified actor kind (student, unit_leader, or academic_partner - never a hardcoded student), with a per-kind delivery-event allowlist. Staff branch unchanged. Service-role only.';

-- ── FIX 2: messages_portal_list_conversations_v2 (row unread = global rule) ──

CREATE OR REPLACE FUNCTION public.messages_portal_list_conversations_v2(
  p_limit     integer DEFAULT 25,
  p_cursor_ts timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me    uuid := public.portal_profile_id();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_rows  jsonb;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('conversations', '[]'::jsonb, 'next_cursor', NULL);
  END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY r.last_message_at DESC, r.id DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT
      c.id,
      c.subject,
      c.category,
      public.message_portal_status_label(c.status) AS status,
      c.last_message_at,
      (SELECT left(m.body, 160) FROM public.messages m
        WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS latest_preview,
      -- PHASE0: the per-row unread rule now matches messages_portal_unread_count
      -- (20260720000000): any message NOT authored by me and newer than my read
      -- pointer counts, so a unit-leader-to-student direct message (or any future
      -- non-staff counterpart) is unread on the ROW exactly as it is on the BADGE.
      (SELECT count(*) FROM public.messages m
        WHERE m.conversation_id = c.id
          AND m.author_profile_id <> v_me
          AND m.created_at > COALESCE(
            (SELECT r2.last_read_at FROM public.participant_conversation_reads r2
              WHERE r2.participant_profile_id = v_me AND r2.conversation_id = c.id),
            '-infinity'::timestamptz)) AS unread_count,
      true AS can_reply
    FROM public.conversations c
    WHERE c.id IN (SELECT public.my_message_conversation_ids())
      AND (p_cursor_ts IS NULL OR (c.last_message_at, c.id) < (p_cursor_ts, p_cursor_id))
    ORDER BY c.last_message_at DESC, c.id DESC
    LIMIT v_limit
  ) r;

  RETURN jsonb_build_object('conversations', v_rows, 'limit', v_limit);
END;
$$;

REVOKE ALL ON FUNCTION public.messages_portal_list_conversations_v2(integer, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_portal_list_conversations_v2(integer, timestamptz, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.messages_portal_list_conversations_v2(integer, timestamptz, uuid) IS
  'Portal conversation list. v2 (PHASE0): per-row unread counts author_profile_id <> caller, matching messages_portal_unread_count, instead of v1''s stale author_role = staff rule. v1 is retained for rollback.';

COMMIT;
