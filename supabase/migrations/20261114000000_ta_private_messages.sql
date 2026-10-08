-- 20261114000000_ta_private_messages.sql
--
-- TA-MESSAGES-1 (Owner, 2026-10-07): private portal conversations, and Talent Acquisition in
-- Messages.
--
--   * Talent Acquisition (HR) may message the ASPIRE Team (the shared team inbox, as every portal
--     does) and, PRIVATELY, one unit leader or one alumnus; a unit leader or an alumnus may also
--     start a private conversation with HR. "It should only be between the portal user and who
--     they send a message to."
--   * A conversation now says what it is: conversations.visibility, 'team' (the default, every
--     existing thread) or 'private'. A private conversation has exactly two portal participants
--     and the ASPIRE team cannot see it: it has no staff triage row, so the staff list, the
--     needs-reply count and the staff thread drop it; the staff unread badge skips it; the staff
--     read policies hide it; and triggers refuse any staff write into it.
--   * Owner, same day: the existing unit leader to student direct threads become private too.
--     Section 1 backfills them (two participants, a unit leader and a student).
--   * Older staff list/thread/count versions are revoked from clients, so nothing can route
--     around the filter through a fallback. The app calls only the newest ones once this runs.
--   * Fixed along the way (the same allow-lists): mark-read admitted only students and staff, and
--     reply/archive/react did not list nursing_academic. Each now lists every portal kind.
--
-- Owner-gated. The app runs on both sides of it: before it, the private-message endpoints answer
-- 409 not_enabled and Talent Acquisition's Messages shows the prepared state.
-- PRE and POST checks: db/audit/ta_private_messages_checks.sql. Rollback at the end of this file.

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. What a conversation is, fixed at creation.
-- ----------------------------------------------------------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'team';
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS chk_conversations_visibility;
ALTER TABLE public.conversations
  ADD CONSTRAINT chk_conversations_visibility CHECK (visibility IN ('team', 'private'));

-- The unit leader to student direct threads: exactly two participant rows, one each.
UPDATE public.conversations c
SET visibility = 'private'
WHERE c.visibility = 'team'
  AND (SELECT count(*) FROM public.conversation_participants cp WHERE cp.conversation_id = c.id) = 2
  AND EXISTS (SELECT 1 FROM public.conversation_participants cp
              WHERE cp.conversation_id = c.id AND cp.participant_role = 'unit_leader')
  AND EXISTS (SELECT 1 FROM public.conversation_participants cp
              WHERE cp.conversation_id = c.id AND cp.participant_role = 'student');

-- ----------------------------------------------------------------------------
-- 2. Roles and shapes: talent_acquisition joins messaging; private_message is a delivery event.
-- ----------------------------------------------------------------------------
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
    OR
    (participant_role IN ('nursing_academic', 'talent_acquisition')
      AND scope_kind = 'general'
      AND scope_student_id IS NULL
      AND scope_unit_key IS NULL
      AND scope_school_key IS NULL
      AND scope_cohort_id IS NULL)
  );

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS chk_conversations_created_by_role;
ALTER TABLE public.conversations
  ADD CONSTRAINT chk_conversations_created_by_role
    CHECK (created_by_role IN ('student', 'unit_leader', 'academic_partner', 'preceptor', 'staff', 'nursing_academic', 'talent_acquisition'));

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS chk_messages_author_role;
ALTER TABLE public.messages
  ADD CONSTRAINT chk_messages_author_role
    CHECK (author_role IN ('student', 'unit_leader', 'academic_partner', 'preceptor', 'staff', 'nursing_academic', 'talent_acquisition'));

ALTER TABLE public.message_notification_deliveries
  DROP CONSTRAINT IF EXISTS chk_mnd_event_type;
ALTER TABLE public.message_notification_deliveries
  ADD CONSTRAINT chk_mnd_event_type CHECK (event_type IN (
    'new_conversation', 'portal_reply', 'staff_reply',
    'unit_leader_message', 'student_to_unit_leader_message', 'private_message'));

-- ----------------------------------------------------------------------------
-- 3. Helpers.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.message_conversation_is_private(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = p_conversation_id AND c.visibility = 'private'
  );
$$;

CREATE OR REPLACE FUNCTION public.message_profile_has_active_talent_acquisition_portal_scope(p_profile_id uuid)
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
        AND g.role = 'talent_acquisition'
        AND g.revoked_at IS NULL
        AND g.starts_at <= now()
        AND (g.expires_at IS NULL OR g.expires_at > now())
    );
$$;

-- May this profile take part in a private conversation as this kind, right now?
CREATE OR REPLACE FUNCTION public.message_private_party_active(p_profile_id uuid, p_kind text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE p_kind
    WHEN 'talent_acquisition' THEN public.message_profile_has_active_talent_acquisition_portal_scope(p_profile_id)
    WHEN 'unit_leader'        THEN public.message_profile_has_active_unit_leader_portal_scope(p_profile_id)
    WHEN 'student'            THEN public.message_profile_has_active_student_portal(p_profile_id)
    ELSE false
  END;
$$;

-- 4. Read rule: Talent Acquisition (byte-for-byte 20260930000000 plus one branch).
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
          -- S-15: current scope for THIS thread's unit, tested exactly as
          -- message_participant_can_send tests it. A revoked or expired scope fails
          -- here at read time; nothing has to be written for access to end.
          AND (
            (
              cp.scope_unit_key IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM public.user_unit_scopes s
                WHERE s.user_profile_id = p_profile_id
                  AND s.unit_key = cp.scope_unit_key
                  AND s.revoked_at IS NULL
                  AND s.starts_at <= now()
                  AND (s.expires_at IS NULL OR s.expires_at > now())
              )
            )
            OR
            (
              cp.scope_unit_key IS NULL
              AND public.message_profile_has_active_unit_leader_portal_scope(p_profile_id)
            )
          )
        )
        OR
        (
          -- ADDED: an Academic Partner reads a GENERAL school thread ONLY. This is enforced
          -- EXPLICITLY, not by comment or the participant CHECK constraint alone:
          --   * the participant row is a school-scoped academic_partner row with NO student/unit/cohort
          --     context (scope_student_id / scope_unit_key / scope_cohort_id all NULL);
          --   * the CONVERSATION itself carries no student/unit/cohort context. Because there is no
          --     stored thread_kind column, the school-scoped participant PLUS these null-context checks
          --     ARE the canonical general-team discriminator;
          --   * scope_school_key EXACTLY matches one of the caller's active school scopes (WCU campuses
          --     isolated; never LIKE/substring/email-domain/display-name; revoked/expired fails closed).
          -- A removed participant row is already excluded by cp.removed_at IS NULL above.
          cp.participant_role = 'academic_partner'
          AND cp.scope_kind = 'school'
          AND cp.scope_school_key IS NOT NULL
          AND cp.scope_student_id IS NULL
          AND cp.scope_unit_key IS NULL
          AND cp.scope_cohort_id IS NULL
          AND public.message_profile_is_active(p_profile_id)
          AND EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = cp.conversation_id
              AND c.related_student_id IS NULL
              AND c.related_unit_key IS NULL
              AND c.related_cohort_id IS NULL
          )
          AND EXISTS (
            SELECT 1 FROM public.user_role_grants g
            WHERE g.user_profile_id = p_profile_id
              AND g.role = 'academic_partner'
              AND g.revoked_at IS NULL
              AND g.starts_at <= now()
              AND (g.expires_at IS NULL OR g.expires_at > now())
          )
          AND EXISTS (
            SELECT 1 FROM public.user_school_scopes s
            WHERE s.user_profile_id = p_profile_id
              AND s.school_key = cp.scope_school_key
              AND s.revoked_at IS NULL
              AND s.starts_at <= now()
              AND (s.expires_at IS NULL OR s.expires_at > now())
          )
        )
        OR
        (
          -- ADDED (NA-PORTAL-UTILITIES-1): a Nursing Education & Leadership member reads a GENERAL
          -- team thread ONLY. Enforced EXPLICITLY:
          --   * the participant row is a nursing_academic row with scope_kind = 'general' and NO
          --     student/unit/school/cohort context;
          --   * the CONVERSATION itself carries no student/unit/cohort context (with the school-less
          --     participant shape, these null-context checks ARE the general-team discriminator);
          --   * the caller holds an ACTIVE nursing_academic role grant. The role is org-wide by
          --     design (NURSING-ACADEMICS-1); no narrower scope table exists for it.
          cp.participant_role = 'nursing_academic'
          AND cp.scope_kind = 'general'
          AND cp.scope_student_id IS NULL
          AND cp.scope_unit_key IS NULL
          AND cp.scope_school_key IS NULL
          AND cp.scope_cohort_id IS NULL
          AND public.message_profile_is_active(p_profile_id)
          AND EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = cp.conversation_id
              AND c.related_student_id IS NULL
              AND c.related_unit_key IS NULL
              AND c.related_cohort_id IS NULL
          )
          AND EXISTS (
            SELECT 1 FROM public.user_role_grants g
            WHERE g.user_profile_id = p_profile_id
              AND g.role = 'nursing_academic'
              AND g.revoked_at IS NULL
              AND g.starts_at <= now()
              AND (g.expires_at IS NULL OR g.expires_at > now())
          )
        )
        OR
        (
          -- TA-MESSAGES-1: Talent Acquisition reads a thread it is a participant of: a
          -- general-scope row with no student/unit/school/cohort context, on a conversation
          -- that carries none either, while the caller is active and holds an ACTIVE
          -- talent_acquisition grant. Private threads and its ASPIRE Team threads alike.
          cp.participant_role = 'talent_acquisition'
          AND cp.scope_kind = 'general'
          AND cp.scope_student_id IS NULL
          AND cp.scope_unit_key IS NULL
          AND cp.scope_school_key IS NULL
          AND cp.scope_cohort_id IS NULL
          AND EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = cp.conversation_id
              AND c.related_student_id IS NULL
              AND c.related_unit_key IS NULL
              AND c.related_cohort_id IS NULL
          )
          AND public.message_profile_has_active_talent_acquisition_portal_scope(p_profile_id)
        )
      )
  );
$$;

-- 5. Delivery validator: private_message (20260720000000 plus the event).
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
  IF v_event NOT IN ('new_conversation', 'portal_reply', 'staff_reply',
                     'unit_leader_message', 'student_to_unit_leader_message',
                     'private_message') THEN
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
  -- UL-PORTAL: a direct Unit Leader to student thread notifies the OTHER portal
  -- participant, never staff. Both new directions therefore route to portal_user.
  IF v_event IN ('unit_leader_message', 'student_to_unit_leader_message', 'private_message')
     AND v_kind <> 'portal_user' THEN
    RAISE EXCEPTION 'direct portal message must route to the other portal participant'
      USING ERRCODE = 'MS400';
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

-- 6. Reply: every portal kind; private threads (20260730000002 plus the marked lines).
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
  v_now            timestamptz;
  v_message_id     uuid;
  v_delivery_id    uuid;
  v_status         text;
  v_reopened       boolean := false;
  v_author_role    text;
  v_participant    uuid;
  v_expected_event text;
BEGIN
  IF p_actor_kind NOT IN ('student', 'staff', 'unit_leader', 'academic_partner', 'nursing_academic', 'talent_acquisition') THEN
    RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(btrim(coalesce(p_body, ''))) < 1 OR char_length(p_body) > 5000 THEN
    RAISE EXCEPTION 'body must be 1 to 5000 characters' USING ERRCODE = 'MS400';
  END IF;

  -- MESSAGES-ARCHIVE-P1 (race fix): lock the conversation row FIRST. This is
  -- the serialization point that pairs with messages_set_conversation_archived's
  -- FOR UPDATE on the SAME row - the two functions can never both proceed past
  -- this point for the same conversation at once.
  SELECT status INTO v_status FROM public.conversations WHERE id = p_conversation_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
  END IF;

  -- MESSAGES-ARCHIVE-P1 (race fix): with the row now locked, derive v_now so
  -- it is STRICTLY greater than this conversation's own current
  -- last_message_at AND strictly greater than every archived_at any profile
  -- has ever recorded for it. Under the lock just acquired, no concurrent
  -- messages_set_conversation_archived call can be mid-flight against this
  -- same conversation, so this MAX(archived_at) read is exact, and the +1
  -- microsecond on both floors is what proves - by construction, not by
  -- clock luck - that the derived archive rule (archived_at >= last_message_at)
  -- flips to Active for every profile once this reply commits.
  v_now := GREATEST(
    clock_timestamp(),
    (SELECT c.last_message_at + interval '1 microsecond' FROM public.conversations c WHERE c.id = p_conversation_id),
    (SELECT COALESCE(MAX(v.archived_at), '-infinity'::timestamptz) + interval '1 microsecond'
       FROM public.message_conversation_visibility v WHERE v.conversation_id = p_conversation_id)
  );

  IF p_actor_kind IN ('student', 'unit_leader', 'academic_partner', 'nursing_academic', 'talent_acquisition') THEN
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
      -- TA-MESSAGES-1: a private thread notifies the other participant only.
      WHEN public.message_conversation_is_private(p_conversation_id)
           AND p_delivery->>'event_type' = 'private_message'
        THEN 'private_message'
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
    -- TA-MESSAGES-1: staff never write into a private thread (non-enumerating).
    IF public.message_conversation_is_private(p_conversation_id) THEN
      RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
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

  IF p_actor_kind IN ('student', 'unit_leader', 'academic_partner', 'nursing_academic', 'talent_acquisition') THEN
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

-- 7. Mark read: every portal kind by read access; staff never on a private thread.
CREATE OR REPLACE FUNCTION public.messages_mark_read(
  p_actor_profile_id uuid,
  p_actor_kind       text,
  p_conversation_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_read_at timestamptz;
BEGIN
  IF p_actor_kind NOT IN ('student', 'unit_leader', 'academic_partner', 'nursing_academic', 'talent_acquisition', 'staff') THEN
    RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';
  END IF;

  SELECT COALESCE(max(m.created_at), now()) INTO v_read_at
  FROM public.messages m WHERE m.conversation_id = p_conversation_id;

  IF p_actor_kind <> 'staff' THEN
    IF NOT public.message_recipient_has_active_access(p_conversation_id, p_actor_profile_id) THEN
      RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
    END IF;
    INSERT INTO public.participant_conversation_reads (participant_profile_id, conversation_id, last_read_at)
    VALUES (p_actor_profile_id, p_conversation_id, v_read_at)
    ON CONFLICT (participant_profile_id, conversation_id) DO UPDATE SET last_read_at = v_read_at;
  ELSE
    IF NOT public.message_profile_is_active_owner_or_admin(p_actor_profile_id) THEN
      RAISE EXCEPTION 'staff actor must be an active owner or admin' USING ERRCODE = 'MS403';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.conversations WHERE id = p_conversation_id AND visibility <> 'private') THEN
      RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
    END IF;
    INSERT INTO public.staff_conversation_reads (staff_profile_id, conversation_id, last_read_at)
    VALUES (p_actor_profile_id, p_conversation_id, v_read_at)
    ON CONFLICT (staff_profile_id, conversation_id) DO UPDATE SET last_read_at = v_read_at;
  END IF;

  RETURN jsonb_build_object('conversation_id', p_conversation_id, 'last_read_at', v_read_at);
END;
$$;

-- 8. Archive and react: the two newer portal kinds.
CREATE OR REPLACE FUNCTION public.messages_set_conversation_archived(
  p_actor_profile_id uuid,
  p_actor_kind       text,
  p_conversation_id  uuid,
  p_archived         boolean
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_last_message_at timestamptz;
  v_archived_at      timestamptz;
  v_read_at          timestamptz;
BEGIN
  IF p_actor_kind NOT IN ('student', 'unit_leader', 'academic_partner', 'nursing_academic', 'talent_acquisition', 'staff') THEN
    RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';
  END IF;
  IF p_archived IS NULL THEN
    RAISE EXCEPTION 'archived is required' USING ERRCODE = 'MS400';
  END IF;

  IF p_actor_kind = 'staff' THEN
    IF NOT public.message_profile_is_active_owner_or_admin(p_actor_profile_id) THEN
      RAISE EXCEPTION 'staff actor must be an active owner or admin' USING ERRCODE = 'MS403';
    END IF;
  ELSE
    -- MESSAGES-ARCHIVE-P1: archive requires READ visibility, NOT send. A
    -- frozen-but-readable thread (for example a former Unit Leader's ended
    -- assignment) may still be archived by a participant who can no longer
    -- send into it. Non-enumerating: an inaccessible conversation and a
    -- missing one are indistinguishable to the caller.
    IF NOT public.message_participant_can_read(p_conversation_id, p_actor_profile_id) THEN
      RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
    END IF;
  END IF;

  -- MESSAGES-ARCHIVE-P1 (race fix): lock the conversation row and read its
  -- last_message_at BEFORE deriving or writing ANY timestamp. This is the
  -- serialization point that pairs with the matching FOR UPDATE in
  -- messages_post_reply: whichever of the two transactions gets here SECOND
  -- for the SAME conversation must wait for the first to commit, so the
  -- GREATEST(...) below always sees the other side's true, already-committed
  -- last_message_at rather than a possibly-stale snapshot. IF NOT FOUND also
  -- covers "conversation does not exist" for the staff branch (the portal
  -- branch's can_read check above already implies it exists via the FK, but
  -- this still fails closed defensively).
  SELECT last_message_at INTO v_last_message_at
  FROM public.conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
  END IF;

  IF p_archived THEN
    -- GREATEST against the just-locked v_last_message_at (never a bare
    -- clock_timestamp()/now()): guarantees archived_at >= last_message_at even
    -- when clock_timestamp() reads BEHIND the conversation's own
    -- last_message_at due to clock skew or transaction-start timing between
    -- sessions - the actual bug this fix prevents, a thread that a reply just
    -- reopened but which archiving would otherwise re-freeze as if the reply
    -- had never landed.
    v_archived_at := GREATEST(clock_timestamp(), v_last_message_at);

    INSERT INTO public.message_conversation_visibility (profile_id, conversation_id, archived_at)
    VALUES (p_actor_profile_id, p_conversation_id, v_archived_at)
    ON CONFLICT (profile_id, conversation_id) DO UPDATE SET archived_at = v_archived_at;

    -- MESSAGES-ARCHIVE-P1: archiving also clears the caller's own unread count
    -- by advancing THEIR OWN read pointer to the SERVER-DERIVED latest message
    -- time (never a client-supplied timestamp - mirrors messages_mark_read),
    -- taking the GREATEST with any existing pointer so this can never move a
    -- pointer backward.
    SELECT COALESCE(max(m.created_at), v_archived_at) INTO v_read_at
    FROM public.messages m WHERE m.conversation_id = p_conversation_id;

    IF p_actor_kind = 'staff' THEN
      INSERT INTO public.staff_conversation_reads (staff_profile_id, conversation_id, last_read_at)
      VALUES (p_actor_profile_id, p_conversation_id, v_read_at)
      ON CONFLICT (staff_profile_id, conversation_id) DO UPDATE
        SET last_read_at = GREATEST(public.staff_conversation_reads.last_read_at, v_read_at);
    ELSE
      INSERT INTO public.participant_conversation_reads (participant_profile_id, conversation_id, last_read_at)
      VALUES (p_actor_profile_id, p_conversation_id, v_read_at)
      ON CONFLICT (participant_profile_id, conversation_id) DO UPDATE
        SET last_read_at = GREATEST(public.participant_conversation_reads.last_read_at, v_read_at);
    END IF;
  ELSE
    -- MESSAGES-ARCHIVE-P1: unarchive deletes the caller's own row outright.
    -- ONLY p_actor_profile_id's row is ever affected.
    DELETE FROM public.message_conversation_visibility
    WHERE profile_id = p_actor_profile_id AND conversation_id = p_conversation_id;
  END IF;

  RETURN jsonb_build_object('archived', p_archived);
END;
$$;

CREATE OR REPLACE FUNCTION public.messages_set_message_reaction_v2(
  p_actor_profile_id uuid,
  p_actor_kind       text,
  p_message_id       uuid,
  p_reaction_key     text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_conversation_id uuid;
  v_reactions       jsonb;
BEGIN
  IF p_actor_kind NOT IN ('student', 'unit_leader', 'academic_partner', 'nursing_academic', 'talent_acquisition', 'staff') THEN
    RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';
  END IF;
  IF p_reaction_key IS NOT NULL
     AND p_reaction_key NOT IN ('acknowledge', 'on_it', 'done', 'thanks', 'warm', 'celebrate') THEN
    RAISE EXCEPTION 'invalid reaction key' USING ERRCODE = 'MS400';
  END IF;

  SELECT m.conversation_id INTO v_conversation_id
  FROM public.messages m WHERE m.id = p_message_id;
  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION 'message not found' USING ERRCODE = 'MS404';
  END IF;

  IF p_actor_kind = 'staff' THEN
    IF NOT public.message_profile_is_active_owner_or_admin(p_actor_profile_id) THEN
      RAISE EXCEPTION 'staff actor must be an active owner or admin' USING ERRCODE = 'MS403';
    END IF;
  ELSE
    IF NOT public.message_participant_can_read(v_conversation_id, p_actor_profile_id) THEN
      RAISE EXCEPTION 'message not found' USING ERRCODE = 'MS404';
    END IF;
  END IF;

  IF p_reaction_key IS NULL THEN
    DELETE FROM public.message_reactions
    WHERE message_id = p_message_id AND profile_id = p_actor_profile_id;
  ELSE
    INSERT INTO public.message_reactions (message_id, profile_id, reaction_key)
    VALUES (p_message_id, p_actor_profile_id, p_reaction_key)
    ON CONFLICT (message_id, profile_id) DO UPDATE
      SET reaction_key = EXCLUDED.reaction_key,
          created_at = now();
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('key', r.reaction_key, 'count', r.cnt, 'mine', r.mine)
    ORDER BY r.reaction_key
  ), '[]'::jsonb)
  INTO v_reactions
  FROM (
    SELECT mr.reaction_key,
           count(*)::integer AS cnt,
           bool_or(mr.profile_id = p_actor_profile_id) AS mine
    FROM public.message_reactions mr
    WHERE mr.message_id = p_message_id
    GROUP BY mr.reaction_key
  ) r;

  RETURN jsonb_build_object('message_id', p_message_id, 'reactions', v_reactions);
END;
$$;

-- 9. ASPIRE Team thread start: Talent Acquisition, routed like Nursing Education & Leadership.
CREATE OR REPLACE FUNCTION public.messages_start_general_team_conversation_core(
  p_actor_profile_id       uuid,
  p_actor_kind             text,
  p_request_id             uuid,
  p_payload_fingerprint    text,
  p_subject                text,
  p_category               text,
  p_body                   text,
  p_delivery               jsonb,
  p_scope_school_key       text
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
  v_school_key       text;        -- the verified authorized school (academic_partner only)
  v_ap_recipient_kind    text;    -- fixed-recipient assertion (academic_partner only)
  v_ap_recipient_email   text;
  v_ap_recipient_profile text;
BEGIN
  IF p_actor_kind NOT IN ('student', 'unit_leader', 'academic_partner', 'nursing_academic', 'talent_acquisition') THEN
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

  -- Academic Partner: the recipient is LOCKED to the ASPIRE Team shared inbox. The shared validator
  -- message_assert_valid_delivery already forces recipient_kind = 'shared_inbox' for new_conversation,
  -- but does NOT pin the exact address, so the AP path additionally requires the canonical
  -- aspire@cshs.org recipient (lib/server/messages/config.js SHARED_INBOX_EMAIL), the shared_inbox
  -- kind, and NO recipient_profile_id (never an arbitrary staff member / recipient). Checked BEFORE any
  -- write (before the idempotency ledger insert), so a rejected recipient leaves no row. Generic safe
  -- error; no individual staff identity is disclosed.
  IF p_actor_kind IN ('academic_partner', 'nursing_academic', 'talent_acquisition') THEN
    v_ap_recipient_kind    := coalesce(p_delivery->>'recipient_kind', '');
    v_ap_recipient_email   := lower(btrim(coalesce(p_delivery->>'recipient_email', '')));
    v_ap_recipient_profile := nullif(btrim(coalesce(p_delivery->>'recipient_profile_id', '')), '');
    IF v_ap_recipient_kind <> 'shared_inbox'
       OR v_ap_recipient_email <> 'aspire@cshs.org'
       OR v_ap_recipient_profile IS NOT NULL THEN
      RAISE EXCEPTION 'portal messages must be sent to the ASPIRE Team' USING ERRCODE = 'MS403';
    END IF;
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
  ELSIF p_actor_kind = 'unit_leader' THEN
    IF NOT public.message_profile_has_active_unit_leader_portal_scope(p_actor_profile_id) THEN
      RAISE EXCEPTION 'unit leader access is not active' USING ERRCODE = 'MS403';
    END IF;
  ELSIF p_actor_kind = 'academic_partner' THEN
    -- academic_partner: verify active grant + scope, then re-verify the SERVER-SUPPLIED school key is
    -- an active scope for this actor (browser selection is never trusted; the caller passes only a
    -- server-verified canonical key, and this is the SQL re-verification). Exact match => WCU isolated.
    IF NOT public.message_profile_has_active_academic_partner_portal_scope(p_actor_profile_id) THEN
      RAISE EXCEPTION 'academic partner access is not active' USING ERRCODE = 'MS403';
    END IF;
    v_school_key := btrim(coalesce(p_scope_school_key, ''));
    IF v_school_key = '' THEN
      RAISE EXCEPTION 'academic partner school scope is required' USING ERRCODE = 'MS400';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.user_school_scopes s
      WHERE s.user_profile_id = p_actor_profile_id
        AND s.school_key = v_school_key
        AND s.revoked_at IS NULL
        AND s.starts_at <= v_now
        AND (s.expires_at IS NULL OR s.expires_at > v_now)
    ) THEN
      RAISE EXCEPTION 'academic partner school scope is not active' USING ERRCODE = 'MS403';
    END IF;
  ELSIF p_actor_kind = 'talent_acquisition' THEN
    -- TA-MESSAGES-1: an active talent_acquisition grant is the whole requirement.
    IF NOT public.message_profile_has_active_talent_acquisition_portal_scope(p_actor_profile_id) THEN
      RAISE EXCEPTION 'talent acquisition access is not active' USING ERRCODE = 'MS403';
    END IF;
  ELSE
    -- nursing_academic: an active org-wide grant is the whole requirement (no
    -- narrower scope exists for the role by design). p_scope_school_key is
    -- ignored for this kind.
    IF NOT public.message_profile_has_active_nursing_academic_portal_scope(p_actor_profile_id) THEN
      RAISE EXCEPTION 'nursing education access is not active' USING ERRCODE = 'MS403';
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

  -- Shared delivery invariants (no content, shared_inbox kind for new_conversation, snapshot/CTA
  -- fields, sender != recipient). For academic_partner the exact aspire@cshs.org recipient was already
  -- pre-asserted above, before any write.
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
  ELSIF p_actor_kind = 'unit_leader' THEN
    INSERT INTO public.conversation_participants (
      conversation_id, participant_profile_id, participant_role, scope_kind,
      scope_student_id, scope_unit_key, scope_school_key, scope_cohort_id, added_at
    ) VALUES (
      v_conversation_id, p_actor_profile_id, 'unit_leader', 'unit',
      NULL, NULL, NULL, NULL, v_now
    );
  ELSIF p_actor_kind = 'academic_partner' THEN
    -- academic_partner: school-scoped participant with the verified authorized school. No student/unit
    -- context, matching chk_participant_role_scope for the academic_partner shape.
    INSERT INTO public.conversation_participants (
      conversation_id, participant_profile_id, participant_role, scope_kind,
      scope_student_id, scope_unit_key, scope_school_key, scope_cohort_id, added_at
    ) VALUES (
      v_conversation_id, p_actor_profile_id, 'academic_partner', 'school',
      NULL, NULL, v_school_key, NULL, v_now
    );
  ELSIF p_actor_kind = 'talent_acquisition' THEN
    INSERT INTO public.conversation_participants (
      conversation_id, participant_profile_id, participant_role, scope_kind,
      scope_student_id, scope_unit_key, scope_school_key, scope_cohort_id, added_at
    ) VALUES (
      v_conversation_id, p_actor_profile_id, 'talent_acquisition', 'general',
      NULL, NULL, NULL, NULL, v_now
    );
  ELSE
    -- nursing_academic: general-scope participant with no student/unit/school/cohort
    -- context, matching the chk_participant_role_scope nursing_academic shape.
    INSERT INTO public.conversation_participants (
      conversation_id, participant_profile_id, participant_role, scope_kind,
      scope_student_id, scope_unit_key, scope_school_key, scope_cohort_id, added_at
    ) VALUES (
      v_conversation_id, p_actor_profile_id, 'nursing_academic', 'general',
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

-- 10. Staff reads: triage, unread badge, thread.
CREATE OR REPLACE FUNCTION public.messages_staff_triage(
  p_conversation_id uuid,
  p_viewer          uuid
)
RETURNS TABLE (
  is_archived              boolean,
  is_done                  boolean,
  needs_reply              boolean,
  latest_author_role       text,
  latest_author_profile_id uuid,
  latest_author_name       text,
  latest_preview           text,
  latest_at                timestamptz,
  handled_by_profile_id    uuid,
  handled_by_name          text,
  handled_at               timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH conv AS (
    SELECT c.id, c.status, c.follow_up_flagged, c.last_message_at
    FROM public.conversations c WHERE c.id = p_conversation_id
      -- TA-MESSAGES-1: a private thread is not the ASPIRE team's. No row here drops it from
      -- the staff list v5, the needs-reply count v2 and the staff thread, all of which join it.
      AND c.visibility <> 'private'
  ),
  latest AS (
    SELECT m.id, m.author_role, m.author_profile_id, left(m.body, 160) AS preview, m.created_at
    FROM public.messages m
    WHERE m.conversation_id = p_conversation_id
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ),
  staff_signal AS (
    SELECT s.profile_id, s.at FROM (
      (SELECT m.author_profile_id AS profile_id, m.created_at AS at
       FROM public.messages m
       WHERE m.conversation_id = p_conversation_id AND m.author_role = 'staff'
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 1)
      UNION ALL
      (SELECT mr.profile_id, mr.created_at
       FROM public.message_reactions mr
       JOIN public.messages m ON m.id = mr.message_id
       WHERE m.conversation_id = p_conversation_id
         AND m.author_role <> 'staff'
         AND NOT EXISTS (
           SELECT 1 FROM public.conversation_participants cp
           WHERE cp.conversation_id = p_conversation_id
             AND cp.participant_profile_id = mr.profile_id
         )
       ORDER BY mr.created_at DESC
       LIMIT 1)
    ) s
    ORDER BY s.at DESC
    LIMIT 1
  ),
  flags AS (
    SELECT
      EXISTS (
        SELECT 1 FROM public.message_conversation_visibility v, conv
        WHERE v.profile_id = p_viewer
          AND v.conversation_id = p_conversation_id
          AND v.archived_at >= conv.last_message_at
      ) AS is_archived,
      EXISTS (
        SELECT 1 FROM latest l
        JOIN public.message_reactions mr ON mr.message_id = l.id
        WHERE l.author_role <> 'staff'
          AND NOT EXISTS (
            SELECT 1 FROM public.conversation_participants cp
            WHERE cp.conversation_id = p_conversation_id
              AND cp.participant_profile_id = mr.profile_id
          )
      ) AS latest_staff_reacted
  )
  SELECT
    f.is_archived,
    (conv.status = 'resolved' OR f.is_archived) AS is_done,
    (NOT (conv.status = 'resolved' OR f.is_archived))
      AND (conv.follow_up_flagged
        OR (l.author_role IS NOT NULL AND l.author_role <> 'staff' AND NOT f.latest_staff_reacted))
      AS needs_reply,
    l.author_role,
    l.author_profile_id,
    (SELECT up.full_name FROM public.user_profiles up WHERE up.id = l.author_profile_id),
    l.preview,
    l.created_at,
    s.profile_id,
    (SELECT up.full_name FROM public.user_profiles up WHERE up.id = s.profile_id),
    s.at
  FROM conv
  CROSS JOIN flags f
  LEFT JOIN latest l ON true
  LEFT JOIN staff_signal s ON true;
$$;

CREATE OR REPLACE FUNCTION public.messages_staff_unread_count()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me uuid := public.portal_profile_id();
BEGIN
  IF NOT public.is_active_owner_or_admin() THEN
    RAISE EXCEPTION 'staff access required' USING ERRCODE = 'MS403';
  END IF;
  RETURN (
    SELECT COALESCE(count(*), 0)::integer
    FROM public.messages m
    WHERE m.author_role <> 'staff'
      -- TA-MESSAGES-1: private threads are not the ASPIRE team's.
      AND NOT public.message_conversation_is_private(m.conversation_id)
      AND m.created_at > COALESCE(
        (SELECT r.last_read_at FROM public.staff_conversation_reads r
          WHERE r.staff_profile_id = v_me AND r.conversation_id = m.conversation_id),
        '-infinity'::timestamptz)
      -- MESSAGES-ARCHIVE-P1: an archived thread contributes nothing to the
      -- badge. Derived, so a new message auto-restores it with no write.
      AND NOT EXISTS (
        SELECT 1 FROM public.message_conversation_visibility v
        JOIN public.conversations c ON c.id = v.conversation_id
        WHERE v.profile_id = v_me
          AND v.conversation_id = m.conversation_id
          AND v.archived_at >= c.last_message_at
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.messages_staff_get_thread_v6(
  p_conversation_id uuid,
  p_limit           integer     DEFAULT 50,
  p_cursor_ts       timestamptz DEFAULT NULL,
  p_cursor_id       uuid        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_payload jsonb;
BEGIN
  -- TA-MESSAGES-1: a private thread does not exist for staff (non-enumerating NULL, a 404).
  IF public.message_conversation_is_private(p_conversation_id) THEN
    RETURN NULL;
  END IF;
  v_payload := public.messages_staff_get_thread_v5(p_conversation_id, p_limit, p_cursor_ts, p_cursor_id);
  IF v_payload IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_payload || jsonb_build_object(
    'receipt', public.messages_receipt_state(p_conversation_id, 'staff', public.portal_profile_id())
  );
END;
$$;
-- ----------------------------------------------------------------------------
-- 11. Start a private conversation: Talent Acquisition and one unit leader or one alumnus,
--     started by either side. Service-role only; the endpoint proves who the recipient is
--     (an alumnus on a residency roster, a unit leader with an active grant) before calling.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messages_start_private_conversation(
  p_actor_profile_id     uuid,
  p_actor_kind           text,
  p_recipient_profile_id uuid,
  p_recipient_kind       text,
  p_subject              text,
  p_body                 text,
  p_delivery             jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now             timestamptz := now();
  v_subject         text := btrim(coalesce(p_subject, ''));
  v_conversation_id uuid;
  v_message_id      uuid;
  v_delivery_id     uuid;
  v_rate            jsonb;
  k                 text;
  pid               uuid;
BEGIN
  IF p_actor_kind NOT IN ('talent_acquisition', 'unit_leader', 'student')
     OR p_recipient_kind NOT IN ('talent_acquisition', 'unit_leader', 'student') THEN
    RAISE EXCEPTION 'invalid participant kind' USING ERRCODE = 'MS400';
  END IF;
  -- Exactly one side is Talent Acquisition: HR and one unit leader or one alumnus.
  IF (p_actor_kind = 'talent_acquisition') = (p_recipient_kind = 'talent_acquisition') THEN
    RAISE EXCEPTION 'a private conversation is between Talent Acquisition and one other person'
      USING ERRCODE = 'MS400';
  END IF;
  IF p_actor_profile_id IS NULL OR p_recipient_profile_id IS NULL
     OR p_actor_profile_id = p_recipient_profile_id THEN
    RAISE EXCEPTION 'invalid recipient' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(v_subject) < 3 OR char_length(v_subject) > 120 THEN
    RAISE EXCEPTION 'subject must be 3 to 120 characters' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(btrim(coalesce(p_body, ''))) < 1 OR char_length(p_body) > 5000 THEN
    RAISE EXCEPTION 'body must be 1 to 5000 characters' USING ERRCODE = 'MS400';
  END IF;
  IF NOT public.message_private_party_active(p_actor_profile_id, p_actor_kind) THEN
    RAISE EXCEPTION 'portal access is not active' USING ERRCODE = 'MS403';
  END IF;
  IF NOT public.message_private_party_active(p_recipient_profile_id, p_recipient_kind) THEN
    RAISE EXCEPTION 'recipient portal access is not active' USING ERRCODE = 'MS409';
  END IF;

  PERFORM public.message_assert_valid_delivery(p_delivery, 'private_message', p_actor_profile_id);
  IF NULLIF(p_delivery->>'recipient_profile_id', '')::uuid IS DISTINCT FROM p_recipient_profile_id THEN
    RAISE EXCEPTION 'a private message notifies its recipient' USING ERRCODE = 'MS400';
  END IF;

  SELECT public.consume_message_rate_limit(p_actor_profile_id, 'new_conversation', 3600, 5) INTO v_rate;
  IF NOT COALESCE((v_rate->>'allowed')::boolean, false) THEN
    RAISE EXCEPTION 'new conversation rate limited' USING ERRCODE = 'MS429';
  END IF;
  SELECT public.consume_message_rate_limit(p_actor_profile_id, 'message', 600, 20) INTO v_rate;
  IF NOT COALESCE((v_rate->>'allowed')::boolean, false) THEN
    RAISE EXCEPTION 'message rate limited' USING ERRCODE = 'MS429';
  END IF;

  INSERT INTO public.conversations (
    subject, category, status, created_by_profile_id, created_by_role,
    related_student_id, related_unit_key, related_school_key, related_cohort_id,
    last_message_at, created_at, updated_at, visibility
  ) VALUES (
    v_subject, 'General question', 'open', p_actor_profile_id, p_actor_kind,
    NULL, NULL, NULL, NULL,
    v_now, v_now, v_now, 'private'
  ) RETURNING id INTO v_conversation_id;

  -- Two rows, one shape per kind: Talent Acquisition 'general'; a unit leader 'unit' with no
  -- unit key (any active unit scope reads it); an alumnus 'student' with no student key (an
  -- active Student Portal reads it). The two-participant trigger already holds the count.
  FOR k, pid IN SELECT v.party_kind, v.party_id FROM (VALUES (p_actor_kind, p_actor_profile_id), (p_recipient_kind, p_recipient_profile_id)) v(party_kind, party_id) LOOP
    INSERT INTO public.conversation_participants (
      conversation_id, participant_profile_id, participant_role, scope_kind,
      scope_student_id, scope_unit_key, scope_school_key, scope_cohort_id, added_at
    ) VALUES (
      v_conversation_id, pid, k,
      CASE k WHEN 'talent_acquisition' THEN 'general' WHEN 'unit_leader' THEN 'unit' ELSE 'student' END,
      NULL, NULL, NULL, NULL, v_now
    );
  END LOOP;

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
      v_conversation_id, v_message_id, p_actor_profile_id, p_recipient_profile_id,
      p_delivery->>'recipient_email', p_delivery->>'recipient_kind',
      p_delivery->>'event_type', p_delivery->>'idempotency_key',
      'queued', v_now,
      p_delivery->>'snapshot_sender_name', p_delivery->>'snapshot_subject',
      p_delivery->>'snapshot_category', p_delivery->>'cta_path'
    )
    RETURNING id INTO v_delivery_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate notification delivery for this message' USING ERRCODE = 'MS409';
  END;

  RETURN jsonb_build_object(
    'conversation_id', v_conversation_id,
    'message_id', v_message_id,
    'delivery_id', v_delivery_id,
    'created_at', v_now,
    'status', 'open',
    'thread_kind', 'private'
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 12. Staff never write into a private conversation, whatever path they take.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.message_private_conversation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_conv    uuid;
  v_profile uuid;
  v_changed text[];
BEGIN
  IF TG_TABLE_NAME = 'conversations' THEN
    IF NEW.visibility IS DISTINCT FROM OLD.visibility THEN
      RAISE EXCEPTION 'conversation visibility is fixed at creation' USING ERRCODE = 'MS409';
    END IF;
    IF OLD.visibility = 'private' THEN
      -- Only what a portal reply writes may change: the timestamps, and a reopen.
      SELECT array_agg(n.key) INTO v_changed
      FROM jsonb_each(to_jsonb(NEW)) n
      WHERE n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key)
        AND n.key NOT IN ('last_message_at', 'updated_at', 'status', 'resolved_at');
      IF v_changed IS NOT NULL OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'open') THEN
        RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'messages' THEN
    IF NEW.author_role = 'staff' AND public.message_conversation_is_private(NEW.conversation_id) THEN
      RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'staff_conversation_reads' THEN
    IF public.message_conversation_is_private(NEW.conversation_id) THEN
      RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'message_reactions' THEN
    SELECT m.conversation_id INTO v_conv FROM public.messages m WHERE m.id = NEW.message_id;
    v_profile := NEW.profile_id;
  ELSE -- message_conversation_visibility
    v_conv := NEW.conversation_id;
    v_profile := NEW.profile_id;
  END IF;
  IF public.message_conversation_is_private(v_conv)
     AND NOT EXISTS (
       SELECT 1 FROM public.conversation_participants cp
       WHERE cp.conversation_id = v_conv AND cp.participant_profile_id = v_profile
     ) THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_private_guard_conversations ON public.conversations;
CREATE TRIGGER trg_private_guard_conversations
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.message_private_conversation_guard();
DROP TRIGGER IF EXISTS trg_private_guard_messages ON public.messages;
CREATE TRIGGER trg_private_guard_messages
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.message_private_conversation_guard();
DROP TRIGGER IF EXISTS trg_private_guard_staff_reads ON public.staff_conversation_reads;
CREATE TRIGGER trg_private_guard_staff_reads
  BEFORE INSERT OR UPDATE ON public.staff_conversation_reads
  FOR EACH ROW EXECUTE FUNCTION public.message_private_conversation_guard();
DROP TRIGGER IF EXISTS trg_private_guard_reactions ON public.message_reactions;
CREATE TRIGGER trg_private_guard_reactions
  BEFORE INSERT OR UPDATE ON public.message_reactions
  FOR EACH ROW EXECUTE FUNCTION public.message_private_conversation_guard();
DROP TRIGGER IF EXISTS trg_private_guard_visibility ON public.message_conversation_visibility;
CREATE TRIGGER trg_private_guard_visibility
  BEFORE INSERT OR UPDATE ON public.message_conversation_visibility
  FOR EACH ROW EXECUTE FUNCTION public.message_private_conversation_guard();

-- ----------------------------------------------------------------------------
-- 13. Staff read policies: a private conversation and everything in it are hidden.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "messages_conversations_staff_select" ON public.conversations;
CREATE POLICY "messages_conversations_staff_select" ON public.conversations
  FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin() AND visibility <> 'private');
DROP POLICY IF EXISTS "messages_participants_staff_select" ON public.conversation_participants;
CREATE POLICY "messages_participants_staff_select" ON public.conversation_participants
  FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin() AND NOT public.message_conversation_is_private(conversation_id));
DROP POLICY IF EXISTS "messages_messages_staff_select" ON public.messages;
CREATE POLICY "messages_messages_staff_select" ON public.messages
  FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin() AND NOT public.message_conversation_is_private(conversation_id));
DROP POLICY IF EXISTS "messages_events_staff_select" ON public.conversation_events;
CREATE POLICY "messages_events_staff_select" ON public.conversation_events
  FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin() AND NOT public.message_conversation_is_private(conversation_id));

-- ----------------------------------------------------------------------------
-- 14. Older staff versions: no client may call them. The newest call the older ones
--     internally (they run as the owner), so nothing that works today stops working.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.messages_staff_get_thread(uuid, integer, timestamptz, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.messages_staff_get_thread_v2(uuid, integer, timestamptz, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.messages_staff_get_thread_v3(uuid, integer, timestamptz, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.messages_staff_get_thread_v4(uuid, integer, timestamptz, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.messages_staff_get_thread_v5(uuid, integer, timestamptz, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.messages_staff_list_conversations(integer, timestamptz, uuid, text, uuid, text, boolean, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.messages_staff_list_conversations_v2(integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.messages_staff_list_conversations_v3(integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.messages_staff_list_conversations_v4(integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.messages_staff_needs_reply_count() FROM PUBLIC, anon, authenticated, service_role;

-- New functions: service role only (helpers are internal to the definer functions).
REVOKE ALL ON FUNCTION public.message_conversation_is_private(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.message_conversation_is_private(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.message_profile_has_active_talent_acquisition_portal_scope(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.message_profile_has_active_talent_acquisition_portal_scope(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.message_private_party_active(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.message_private_party_active(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.messages_start_private_conversation(uuid, text, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.messages_start_private_conversation(uuid, text, uuid, text, text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.message_private_conversation_guard() FROM PUBLIC, anon, authenticated;

-- The ASPIRE Team start for Talent Acquisition (the same wrapper shape as _na).
CREATE OR REPLACE FUNCTION public.messages_start_general_team_conversation_ta(
  p_actor_profile_id       uuid,
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
BEGIN
  IF NOT public.message_profile_has_active_talent_acquisition_portal_scope(p_actor_profile_id) THEN
    RAISE EXCEPTION 'talent acquisition access is not active' USING ERRCODE = 'MS403';
  END IF;
  RETURN public.messages_start_general_team_conversation_core(
    p_actor_profile_id, 'talent_acquisition', p_request_id, p_payload_fingerprint,
    p_subject, p_category, p_body, p_delivery, NULL
  );
END;
$$;
REVOKE ALL ON FUNCTION public.messages_start_general_team_conversation_ta(uuid, uuid, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.messages_start_general_team_conversation_ta(uuid, uuid, text, text, text, text, jsonb) TO service_role;

COMMIT;

-- ----------------------------------------------------------------------------
-- Rollback (run by hand only after reading it; not part of the migration):
--   BEGIN;
--   DROP TRIGGER IF EXISTS trg_private_guard_conversations ON public.conversations;
--   DROP TRIGGER IF EXISTS trg_private_guard_messages ON public.messages;
--   DROP TRIGGER IF EXISTS trg_private_guard_staff_reads ON public.staff_conversation_reads;
--   DROP TRIGGER IF EXISTS trg_private_guard_reactions ON public.message_reactions;
--   DROP TRIGGER IF EXISTS trg_private_guard_visibility ON public.message_conversation_visibility;
--   Re-run the function definitions from 20260930000000 (can_read), 20260720000000 (validator),
--   20260730000002 (reply, archive, unread), 20260716000002 (mark read), 20260922000000 (react),
--   20260828000000 (team start core), 20261014000000 (triage), 20261015000000 (thread v6), and the
--   four staff select policies and grants from 20260716000000 and their later migrations.
--   UPDATE public.conversations SET visibility = 'team' WHERE visibility = 'private';  -- un-privates every thread
--   COMMIT;
-- ----------------------------------------------------------------------------
