-- ============================================================================
-- UNIT LEADER PORTAL: notification alert types and Report a Concern
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester), AFTER 20260720000000 and 20260720000001, and ***
-- *** ONLY after running every preflight query in                                 ***
-- *** db/audit/unit_leader_notifications_preflight_and_verification.sql           ***
-- *** separately. Run the ENTIRE file once (transactional).                       ***
--
-- Two changes, both required by approved product decisions.
--
-- 1. NOTIFICATION ALERT TYPES (explicitly approved). chk_ulnp_alert_type currently
--    allows five values, three of which do not exist for the approved alert set:
--    capacity review outcomes, preceptor assignment updates, and concern follow up.
--    Inserting a preference row for any of them violates the CHECK today. The five
--    existing values are PRESERVED exactly and three are added.
--
-- 2. REPORT A CONCERN (scope note, please read). The approved destination is a
--    prefilled conversation with the ASPIRE TEAM, not a direct student thread.
--    That could not be built on the applied schema, so this migration also adds a
--    'unit_leader_to_staff' actor kind to messages_start_conversation.
--
--    Why it was unavoidable: messages_start_conversation checks
--    message_profile_has_active_student_link for EVERY actor kind before branching,
--    and its unit_leader branch always inserts a STUDENT participant row. A concern
--    report therefore could not exist without making the student a participant of
--    the thread that reports on them, which they would then be able to read.
--
--    The new kind creates exactly ONE participant row, the Unit Leader, unit
--    scoped, carrying the student as CONTEXT only. The student has no participant
--    row, so my_message_conversation_ids() gives them no read path to it. Routing
--    is the unchanged 'new_conversation' shape, so it reaches the shared inbox
--    exactly like any other new thread.
--
--    NO SIGNATURE CHANGE: this is a new value for the existing p_actor_kind
--    parameter, so CREATE OR REPLACE applies and the ACL is preserved. There is no
--    DROP and no re-GRANT, and no overload can arise.
--
-- Wave F-2 is untouched: no bucket, no storage policy, no student file reference.
-- Nothing is granted to anon.
-- ============================================================================

BEGIN;

-- ############################################################################
-- 1. Notification alert types
-- ############################################################################
-- Additive only. Every previously allowed value remains allowed, so no existing
-- preference row can be invalidated by this change.
ALTER TABLE public.unit_leader_notification_prefs
  DROP CONSTRAINT IF EXISTS chk_ulnp_alert_type;
ALTER TABLE public.unit_leader_notification_prefs
  ADD CONSTRAINT chk_ulnp_alert_type CHECK (alert_type IN (
    -- preserved
    'placement_request', 'response_deadline', 'onboarding_issue',
    'schedule_change', 'new_message',
    -- added
    'capacity_review_outcome', 'preceptor_assignment_update', 'concern_follow_up'));


-- ############################################################################
-- 2. messages_start_conversation: the unit_leader_to_staff actor kind
-- ############################################################################
CREATE OR REPLACE FUNCTION public.messages_start_conversation(
  p_actor_profile_id       uuid,
  p_actor_kind             text,
  p_participant_profile_id uuid,
  p_student_id             uuid,
  p_subject                text,
  p_category               text,
  p_body                   text,
  p_delivery               jsonb,
  p_unit_key               text DEFAULT NULL
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
  v_unit_key        text := nullif(btrim(coalesce(p_unit_key, '')), '');
BEGIN
  IF p_actor_kind NOT IN ('student', 'staff', 'unit_leader', 'unit_leader_to_staff') THEN
    RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(v_subject) < 3 OR char_length(v_subject) > 120 THEN
    RAISE EXCEPTION 'subject must be 3 to 120 characters' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(btrim(coalesce(p_body, ''))) < 1 OR char_length(p_body) > 5000 THEN
    RAISE EXCEPTION 'body must be 1 to 5000 characters' USING ERRCODE = 'MS400';
  END IF;

  -- The participant must hold active student portal access, EXCEPT for a
  -- unit_leader_to_staff thread, whose only participant is the Unit Leader. There
  -- the student is CONTEXT (related_student_id) and never a participant, which is
  -- what keeps a concern report invisible to the student it concerns.
  IF p_actor_kind <> 'unit_leader_to_staff'
     AND NOT public.message_profile_has_active_student_link(p_participant_profile_id, p_student_id) THEN
    RAISE EXCEPTION 'participant portal access is not active' USING ERRCODE = 'MS409';
  END IF;

  IF p_actor_kind = 'student' THEN
    IF p_actor_profile_id IS DISTINCT FROM p_participant_profile_id THEN
      RAISE EXCEPTION 'student may only start their own conversation' USING ERRCODE = 'MS403';
    END IF;
    v_author_role    := 'student';
    v_expected_event := 'new_conversation';
  ELSIF p_actor_kind = 'unit_leader_to_staff' THEN
    -- REPORT A CONCERN. A Unit Leader opens a thread with the ASPIRE Team, scoped
    -- to a unit, optionally naming a student as context. There is NO student
    -- participant, so the student never sees it.
    IF v_unit_key IS NULL THEN
      RAISE EXCEPTION 'unit key is required to start a unit thread' USING ERRCODE = 'MS400';
    END IF;
    IF p_actor_profile_id IS DISTINCT FROM p_participant_profile_id THEN
      RAISE EXCEPTION 'a unit leader may only start their own conversation' USING ERRCODE = 'MS403';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.user_role_grants g
      WHERE g.user_profile_id = p_actor_profile_id
        AND g.role = 'unit_leader'
        AND g.revoked_at IS NULL
        AND g.starts_at <= v_now
        AND (g.expires_at IS NULL OR g.expires_at > v_now)
    ) OR NOT public.message_profile_is_active(p_actor_profile_id) THEN
      RAISE EXCEPTION 'unit leader access is not active' USING ERRCODE = 'MS403';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.user_unit_scopes s
      WHERE s.user_profile_id = p_actor_profile_id
        AND s.unit_key = v_unit_key
        AND s.revoked_at IS NULL
        AND s.starts_at <= v_now
        AND (s.expires_at IS NULL OR s.expires_at > v_now)
    ) THEN
      RAISE EXCEPTION 'unit scope is not active' USING ERRCODE = 'MS403';
    END IF;
    -- If a student is named as context, they must actually be placed in that unit.
    -- Resolved server side from students.matched_unit_id, never from the request.
    IF p_student_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.students st
      JOIN public.units u ON u.id = st.matched_unit_id
      WHERE st.id = p_student_id AND u.unit_name = v_unit_key
    ) THEN
      RAISE EXCEPTION 'student is not in that unit' USING ERRCODE = 'MS403';
    END IF;
    v_author_role    := 'unit_leader';
    -- Routes to the shared inbox exactly like any other new conversation.
    v_expected_event := 'new_conversation';
  ELSIF p_actor_kind = 'unit_leader' THEN
    -- A DIRECT thread. Creation ALWAYS requires current active scope, so a former
    -- Unit Leader can never start a new thread on the ended relationship. A newly
    -- assigned Unit Leader creating a thread gets a NEW conversation with their own
    -- participant row, and never access to a predecessor's thread.
    IF v_unit_key IS NULL THEN
      RAISE EXCEPTION 'unit key is required to start a direct thread' USING ERRCODE = 'MS400';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.user_role_grants g
      WHERE g.user_profile_id = p_actor_profile_id
        AND g.role = 'unit_leader'
        AND g.revoked_at IS NULL
        AND g.starts_at <= now()
        AND (g.expires_at IS NULL OR g.expires_at > now())
    ) OR NOT public.message_profile_is_active(p_actor_profile_id) THEN
      RAISE EXCEPTION 'unit leader access is not active' USING ERRCODE = 'MS403';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.user_unit_scopes s
      WHERE s.user_profile_id = p_actor_profile_id
        AND s.unit_key = v_unit_key
        AND s.revoked_at IS NULL
        AND s.starts_at <= now()
        AND (s.expires_at IS NULL OR s.expires_at > now())
    ) THEN
      RAISE EXCEPTION 'unit scope is not active' USING ERRCODE = 'MS403';
    END IF;
    -- The student must actually be placed in that unit. Resolved server side from
    -- students.matched_unit_id, never from a client-supplied unit value.
    IF NOT EXISTS (
      SELECT 1
      FROM public.students st
      JOIN public.units u ON u.id = st.matched_unit_id
      WHERE st.id = p_student_id
        AND u.unit_name = v_unit_key
    ) THEN
      RAISE EXCEPTION 'student is not in that unit' USING ERRCODE = 'MS403';
    END IF;
    v_author_role    := 'unit_leader';
    v_expected_event := 'unit_leader_message';
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

  IF p_actor_kind = 'unit_leader_to_staff' THEN
    -- ONE participant: the Unit Leader, unit scoped, with the student as context
    -- only. No student participant row exists, so the student has no read path to
    -- this conversation through my_message_conversation_ids().
    INSERT INTO public.conversation_participants (
      conversation_id, participant_profile_id, participant_role, scope_kind,
      scope_student_id, scope_unit_key, added_at
    ) VALUES (
      v_conversation_id, p_actor_profile_id, 'unit_leader', 'unit',
      p_student_id, v_unit_key, v_now
    );
  ELSE
    INSERT INTO public.conversation_participants (
      conversation_id, participant_profile_id, participant_role, scope_kind,
      scope_student_id, added_at
    ) VALUES (
      v_conversation_id, p_participant_profile_id, 'student', 'student',
      p_student_id, v_now
    );
  END IF;

  -- A direct thread carries a SECOND participant row for the Unit Leader, scoped to
  -- the unit and naming the student. This row is the identity-backed record that
  -- keeps history readable after the assignment ends. Two rows is the cap.
  IF p_actor_kind = 'unit_leader' THEN
    INSERT INTO public.conversation_participants (
      conversation_id, participant_profile_id, participant_role, scope_kind,
      scope_student_id, scope_unit_key, added_at
    ) VALUES (
      v_conversation_id, p_actor_profile_id, 'unit_leader', 'unit',
      p_student_id, v_unit_key, v_now
    );
  END IF;

  INSERT INTO public.messages (conversation_id, author_profile_id, author_role, body, created_at)
  VALUES (v_conversation_id, p_actor_profile_id, v_author_role, p_body, v_now)
  RETURNING id INTO v_message_id;

  INSERT INTO public.conversation_events (conversation_id, event_type, actor_profile_id, to_value, created_at)
  VALUES (v_conversation_id, 'created', p_actor_profile_id, 'open', v_now);

  -- The SENDER's read pointer only. The recipient is never marked read.
  IF p_actor_kind IN ('student', 'unit_leader', 'unit_leader_to_staff') THEN
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

COMMIT;


-- ============================================================================
-- Verification: see
-- db/audit/unit_leader_notifications_preflight_and_verification.sql
-- ============================================================================

-- Rollback. Restores the previous CHECK and the previous function definition
-- verbatim. Run the two blocks in this order.
--
-- IMPORTANT: the CHECK rollback FAILS if any preference row already uses one of the
-- three added values. That is deliberate: silently dropping such a row would lose a
-- Unit Leader's stated preference. Delete or re-map those rows first, then re-run.
/*
BEGIN;

CREATE OR REPLACE FUNCTION public.messages_start_conversation(
  p_actor_profile_id       uuid,
  p_actor_kind             text,
  p_participant_profile_id uuid,
  p_student_id             uuid,
  p_subject                text,
  p_category               text,
  p_body                   text,
  p_delivery               jsonb,
  p_unit_key               text DEFAULT NULL
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
  v_unit_key        text := nullif(btrim(coalesce(p_unit_key, '')), '');
BEGIN
  IF p_actor_kind NOT IN ('student', 'staff', 'unit_leader') THEN
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
  ELSIF p_actor_kind = 'unit_leader' THEN
    -- A DIRECT thread. Creation ALWAYS requires current active scope, so a former
    -- Unit Leader can never start a new thread on the ended relationship. A newly
    -- assigned Unit Leader creating a thread gets a NEW conversation with their own
    -- participant row, and never access to a predecessor's thread.
    IF v_unit_key IS NULL THEN
      RAISE EXCEPTION 'unit key is required to start a direct thread' USING ERRCODE = 'MS400';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.user_role_grants g
      WHERE g.user_profile_id = p_actor_profile_id
        AND g.role = 'unit_leader'
        AND g.revoked_at IS NULL
        AND g.starts_at <= now()
        AND (g.expires_at IS NULL OR g.expires_at > now())
    ) OR NOT public.message_profile_is_active(p_actor_profile_id) THEN
      RAISE EXCEPTION 'unit leader access is not active' USING ERRCODE = 'MS403';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.user_unit_scopes s
      WHERE s.user_profile_id = p_actor_profile_id
        AND s.unit_key = v_unit_key
        AND s.revoked_at IS NULL
        AND s.starts_at <= now()
        AND (s.expires_at IS NULL OR s.expires_at > now())
    ) THEN
      RAISE EXCEPTION 'unit scope is not active' USING ERRCODE = 'MS403';
    END IF;
    -- The student must actually be placed in that unit. Resolved server side from
    -- students.matched_unit_id, never from a client-supplied unit value.
    IF NOT EXISTS (
      SELECT 1
      FROM public.students st
      JOIN public.units u ON u.id = st.matched_unit_id
      WHERE st.id = p_student_id
        AND u.unit_name = v_unit_key
    ) THEN
      RAISE EXCEPTION 'student is not in that unit' USING ERRCODE = 'MS403';
    END IF;
    v_author_role    := 'unit_leader';
    v_expected_event := 'unit_leader_message';
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

  -- A direct thread carries a SECOND participant row for the Unit Leader, scoped to
  -- the unit and naming the student. This row is the identity-backed record that
  -- keeps history readable after the assignment ends. Two rows is the cap.
  IF p_actor_kind = 'unit_leader' THEN
    INSERT INTO public.conversation_participants (
      conversation_id, participant_profile_id, participant_role, scope_kind,
      scope_student_id, scope_unit_key, added_at
    ) VALUES (
      v_conversation_id, p_actor_profile_id, 'unit_leader', 'unit',
      p_student_id, v_unit_key, v_now
    );
  END IF;

  INSERT INTO public.messages (conversation_id, author_profile_id, author_role, body, created_at)
  VALUES (v_conversation_id, p_actor_profile_id, v_author_role, p_body, v_now)
  RETURNING id INTO v_message_id;

  INSERT INTO public.conversation_events (conversation_id, event_type, actor_profile_id, to_value, created_at)
  VALUES (v_conversation_id, 'created', p_actor_profile_id, 'open', v_now);

  -- The SENDER's read pointer only. The recipient is never marked read.
  IF p_actor_kind IN ('student', 'unit_leader') THEN
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

ALTER TABLE public.unit_leader_notification_prefs
  DROP CONSTRAINT IF EXISTS chk_ulnp_alert_type;
ALTER TABLE public.unit_leader_notification_prefs
  ADD CONSTRAINT chk_ulnp_alert_type CHECK (alert_type IN (
    'placement_request', 'response_deadline', 'onboarding_issue',
    'schedule_change', 'new_message'));

COMMIT;
*/
