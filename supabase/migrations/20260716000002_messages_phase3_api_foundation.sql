-- ============================================================================
-- ASPIRE MESSAGES, PHASE 3 (STAGE A): API database foundation (ADDITIVE)
-- ============================================================================
-- Owner instructions: run this ENTIRE file as one block in the Supabase SQL
-- editor. It is additive except for ONE widening constraint swap on
-- conversation_events (adding the 'category_change' event type), which is
-- required so staff category changes keep auditable history instead of
-- overloading an unrelated event type. It creates no data, no tables, and
-- modifies no other existing object. The Phase 1 and Phase 2 migrations are NOT
-- modified; this is a new canonical migration.
--
-- Prerequisites (applied and verified in production): ASPIRE Messages Phase 1
-- (conversations, conversation_participants, messages, staff_conversation_reads,
-- participant_conversation_reads, conversation_events, is_active_owner_or_admin(),
-- my_message_conversation_ids()) and Phase 2 (message_notification_deliveries,
-- message_rate_limit_counters, claim_due_message_notification_deliveries(),
-- message_recipient_has_active_access(), consume_message_rate_limit()).
--
-- What this adds:
--   1. 'category_change' event type on conversation_events.
--   2. Two explicit-profile authorization helpers (service-role only). The
--      existing is_active_owner_or_admin() and portal_profile_id() evaluate the
--      CURRENT AUTHENTICATED CALLER, so a service-role transactional RPC cannot
--      use them to validate an actor; these take an explicit user_profiles.id.
--   3. Seven service-role-only TRANSACTIONAL write RPCs. Each is one atomic
--      statement boundary, so a conversation can never be left partially
--      created. Each re-validates authorization from the passed, server-verified
--      profile id; nothing is trusted from a client body.
--   4. Six authenticated SECURITY DEFINER read RPCs. Portal reads resolve the
--      caller through portal_profile_id() and my_message_conversation_ids();
--      staff reads gate on is_active_owner_or_admin(). Base tables keep their
--      Phase 1 deny-by-default posture: no new portal base-table policy is added.
--
-- Authorization invariants preserved throughout:
--   - Three-identity model: every actor, participant, assignee, reader, and
--     event actor is a user_profiles.id. No profile id is compared to auth.uid().
--   - Version one authorizes the student portal role only. unit_leader,
--     academic_partner, and preceptor remain schema reservations.
--   - is_staff() is never used (it includes interviewer and viewer).
--   - Assignment never grants access. related_student_id, related_unit_key,
--     related_school_key, and related_cohort_id never grant access.
--   - Messages stay append-only: no RPC updates or deletes a message row.
--
-- Atomicity: every write RPC body runs inside the function's implicit
-- transaction, so all of its inserts and updates commit or roll back together.
--
-- This file is atomic (BEGIN/COMMIT) and designed to run once. Read-only
-- verification lives in db/audit/messages_phase3_verification.sql.
-- ============================================================================

BEGIN;

-- ── 1. Auditable category changes ───────────────────────────────────────────
-- Widen the Phase 1 event_type set with 'category_change'. Constraint swap only:
-- no data change, and every existing value remains valid.
ALTER TABLE public.conversation_events
  DROP CONSTRAINT IF EXISTS chk_conversation_events_type;
ALTER TABLE public.conversation_events
  ADD CONSTRAINT chk_conversation_events_type CHECK (event_type IN (
    'created',
    'status_change',
    'assignment_change',
    'resolved',
    'reopened',
    'flagged',
    'participant_access_changed',
    'category_change'
  ));

-- ── 2. Explicit-profile authorization helpers (service-role only) ───────────

-- Active Owner or Admin, by EXPLICIT profile id (not the current caller).
CREATE OR REPLACE FUNCTION public.message_profile_is_active_owner_or_admin(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = p_profile_id
      AND role IN ('owner', 'admin')
      AND COALESCE(is_active, true) = true
  );
$$;

-- Active student portal access for an EXPLICIT profile and student, using the
-- canonical active predicate. Used when starting a conversation, where no
-- participant row exists yet.
CREATE OR REPLACE FUNCTION public.message_profile_has_active_student_link(
  p_profile_id uuid,
  p_student_id uuid
)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_student_links l
    WHERE l.user_profile_id = p_profile_id
      AND l.student_id = p_student_id
      AND l.revoked_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.user_role_grants g
        WHERE g.user_profile_id = p_profile_id
          AND g.role = 'student'
          AND g.revoked_at IS NULL
          AND g.starts_at <= now()
          AND (g.expires_at IS NULL OR g.expires_at > now())
      )
  );
$$;

-- ── 3. Transactional write RPCs (service-role only) ─────────────────────────
-- Each raises a custom 5-character SQLSTATE the API maps to an HTTP status:
--   MS400 -> 422 validation, MS403 -> 403, MS404 -> 404, MS409 -> 409.
-- These mirror the PT400/PT404/PT409 convention used by the portal access
-- lifecycle RPCs.

-- 3a. Start a conversation. Atomically creates conversation, participant,
-- initial message, created event, the sender's read pointer, and the durable
-- queued delivery row. p_actor_kind is 'student' or 'staff'.
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
  v_now            timestamptz := now();
  v_conversation_id uuid;
  v_message_id     uuid;
  v_delivery_id    uuid;
  v_subject        text := btrim(coalesce(p_subject, ''));
  v_author_role    text;
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
    -- A student may only start their own conversation.
    IF p_actor_profile_id IS DISTINCT FROM p_participant_profile_id THEN
      RAISE EXCEPTION 'student may only start their own conversation' USING ERRCODE = 'MS403';
    END IF;
    v_author_role := 'student';
  ELSE
    IF NOT public.message_profile_is_active_owner_or_admin(p_actor_profile_id) THEN
      RAISE EXCEPTION 'staff actor must be an active owner or admin' USING ERRCODE = 'MS403';
    END IF;
    v_author_role := 'staff';
  END IF;

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
  -- write. The idempotency key and routing are computed by the Phase 2 modules
  -- and passed in; the unique key guarantee is unchanged.
  IF p_delivery IS NOT NULL AND p_delivery ? 'idempotency_key' THEN
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
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_delivery_id;
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

-- 3b. Reply. Atomically reopens a resolved conversation, appends the message,
-- updates conversation timestamps, advances only the sender's read pointer, and
-- queues the delivery.
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
  v_now          timestamptz := now();
  v_message_id   uuid;
  v_delivery_id  uuid;
  v_status       text;
  v_reopened     boolean := false;
  v_author_role  text;
  v_participant  uuid;
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
    v_author_role := 'student';
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
    v_author_role := 'staff';
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

  IF p_delivery IS NOT NULL AND p_delivery ? 'idempotency_key' THEN
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
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_delivery_id;
  END IF;

  RETURN jsonb_build_object(
    'message_id', v_message_id,
    'delivery_id', v_delivery_id,
    'created_at', v_now,
    'reopened', v_reopened
  );
END;
$$;

-- 3c. Mark read. Advances ONLY the calling actor's own pointer, to a
-- SERVER-DERIVED timestamp (the latest message time, else now). A client
-- timestamp is never accepted.
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
  IF p_actor_kind NOT IN ('student', 'staff') THEN
    RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';
  END IF;

  SELECT COALESCE(max(m.created_at), now()) INTO v_read_at
  FROM public.messages m WHERE m.conversation_id = p_conversation_id;

  IF p_actor_kind = 'student' THEN
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
    IF NOT EXISTS (SELECT 1 FROM public.conversations WHERE id = p_conversation_id) THEN
      RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
    END IF;
    INSERT INTO public.staff_conversation_reads (staff_profile_id, conversation_id, last_read_at)
    VALUES (p_actor_profile_id, p_conversation_id, v_read_at)
    ON CONFLICT (staff_profile_id, conversation_id) DO UPDATE SET last_read_at = v_read_at;
  END IF;

  RETURN jsonb_build_object('conversation_id', p_conversation_id, 'last_read_at', v_read_at);
END;
$$;

-- 3d. Assignment. Only an active Owner/Admin may be assigned. Assignment never
-- grants access. No email is sent for assignment alone.
CREATE OR REPLACE FUNCTION public.messages_set_assignment(
  p_actor_profile_id    uuid,
  p_conversation_id     uuid,
  p_assignee_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now  timestamptz := now();
  v_from uuid;
BEGIN
  IF NOT public.message_profile_is_active_owner_or_admin(p_actor_profile_id) THEN
    RAISE EXCEPTION 'staff actor must be an active owner or admin' USING ERRCODE = 'MS403';
  END IF;
  SELECT assigned_staff_profile_id INTO v_from FROM public.conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
  END IF;
  IF p_assignee_profile_id IS NOT NULL
     AND NOT public.message_profile_is_active_owner_or_admin(p_assignee_profile_id) THEN
    RAISE EXCEPTION 'assignee must be an active owner or admin' USING ERRCODE = 'MS400';
  END IF;

  UPDATE public.conversations
  SET assigned_staff_profile_id = p_assignee_profile_id, updated_at = v_now
  WHERE id = p_conversation_id;

  INSERT INTO public.conversation_events (conversation_id, event_type, actor_profile_id, from_value, to_value, created_at)
  VALUES (p_conversation_id, 'assignment_change', p_actor_profile_id,
          v_from::text, p_assignee_profile_id::text, v_now);

  RETURN jsonb_build_object('conversation_id', p_conversation_id, 'assigned_staff_profile_id', p_assignee_profile_id);
END;
$$;

-- 3e. Status. resolving sets resolved_at; leaving resolved clears it. Resolution
-- is silent (no email).
CREATE OR REPLACE FUNCTION public.messages_set_status(
  p_actor_profile_id uuid,
  p_conversation_id  uuid,
  p_status           text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now  timestamptz := now();
  v_from text;
  v_event text;
BEGIN
  IF NOT public.message_profile_is_active_owner_or_admin(p_actor_profile_id) THEN
    RAISE EXCEPTION 'staff actor must be an active owner or admin' USING ERRCODE = 'MS403';
  END IF;
  IF p_status NOT IN ('open', 'waiting', 'resolved') THEN
    RAISE EXCEPTION 'invalid status' USING ERRCODE = 'MS400';
  END IF;
  SELECT status INTO v_from FROM public.conversations WHERE id = p_conversation_id;
  IF v_from IS NULL THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
  END IF;

  UPDATE public.conversations
  SET status = p_status,
      resolved_at = CASE WHEN p_status = 'resolved' THEN v_now ELSE NULL END,
      updated_at = v_now
  WHERE id = p_conversation_id;

  v_event := CASE
    WHEN p_status = 'resolved' THEN 'resolved'
    WHEN v_from = 'resolved' THEN 'reopened'
    ELSE 'status_change'
  END;

  INSERT INTO public.conversation_events (conversation_id, event_type, actor_profile_id, from_value, to_value, created_at)
  VALUES (p_conversation_id, v_event, p_actor_profile_id, v_from, p_status, v_now);

  RETURN jsonb_build_object('conversation_id', p_conversation_id, 'status', p_status);
END;
$$;

-- 3f. Category. Null or one approved value, with a category_change audit event.
CREATE OR REPLACE FUNCTION public.messages_set_category(
  p_actor_profile_id uuid,
  p_conversation_id  uuid,
  p_category         text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now  timestamptz := now();
  v_from text;
BEGIN
  IF NOT public.message_profile_is_active_owner_or_admin(p_actor_profile_id) THEN
    RAISE EXCEPTION 'staff actor must be an active owner or admin' USING ERRCODE = 'MS403';
  END IF;
  IF p_category IS NOT NULL AND p_category NOT IN (
    'Placement and matching', 'Scheduling', 'Onboarding requirements',
    'Clinical rotation support', 'Preceptor support', 'Portal or account help',
    'General question'
  ) THEN
    RAISE EXCEPTION 'invalid category' USING ERRCODE = 'MS400';
  END IF;
  SELECT category INTO v_from FROM public.conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
  END IF;

  UPDATE public.conversations SET category = p_category, updated_at = v_now
  WHERE id = p_conversation_id;

  INSERT INTO public.conversation_events (conversation_id, event_type, actor_profile_id, from_value, to_value, created_at)
  VALUES (p_conversation_id, 'category_change', p_actor_profile_id, v_from, p_category, v_now);

  RETURN jsonb_build_object('conversation_id', p_conversation_id, 'category', p_category);
END;
$$;

-- 3g. Follow-up flag. Keeps the Phase 1 follow-up consistency constraint valid
-- and records a flagged event. No email.
CREATE OR REPLACE FUNCTION public.messages_set_follow_up(
  p_actor_profile_id uuid,
  p_conversation_id  uuid,
  p_flagged          boolean
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now  timestamptz := now();
  v_from boolean;
BEGIN
  IF NOT public.message_profile_is_active_owner_or_admin(p_actor_profile_id) THEN
    RAISE EXCEPTION 'staff actor must be an active owner or admin' USING ERRCODE = 'MS403';
  END IF;
  SELECT follow_up_flagged INTO v_from FROM public.conversations WHERE id = p_conversation_id;
  IF v_from IS NULL THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
  END IF;

  UPDATE public.conversations
  SET follow_up_flagged = p_flagged,
      follow_up_flagged_by = CASE WHEN p_flagged THEN p_actor_profile_id ELSE NULL END,
      follow_up_flagged_at = CASE WHEN p_flagged THEN v_now ELSE NULL END,
      updated_at = v_now
  WHERE id = p_conversation_id;

  INSERT INTO public.conversation_events (conversation_id, event_type, actor_profile_id, from_value, to_value, created_at)
  VALUES (p_conversation_id, 'flagged', p_actor_profile_id, v_from::text, p_flagged::text, v_now);

  RETURN jsonb_build_object('conversation_id', p_conversation_id, 'follow_up_flagged', p_flagged);
END;
$$;

-- ── 4. Authenticated read RPCs (SECURITY DEFINER, caller-scoped) ────────────
-- These resolve the CURRENT AUTHENTICATED caller. Portal reads use
-- portal_profile_id() + my_message_conversation_ids() (student scope only);
-- staff reads gate on is_active_owner_or_admin(). No new base-table policy is
-- added: the Phase 1 deny-by-default posture is unchanged.

-- Portal-facing status mapping: open/waiting -> Open, resolved -> Closed.
CREATE OR REPLACE FUNCTION public.message_portal_status_label(p_status text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE WHEN p_status = 'resolved' THEN 'Closed' ELSE 'Open' END;
$$;

-- 4a. Portal: list my conversations (cursor paginated, newest first).
CREATE OR REPLACE FUNCTION public.messages_portal_list_conversations(
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
      (SELECT count(*) FROM public.messages m
        WHERE m.conversation_id = c.id
          AND m.author_role = 'staff'
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

-- 4b. Portal: read one thread (messages paginated forward, chronological).
CREATE OR REPLACE FUNCTION public.messages_portal_get_thread(
  p_conversation_id uuid,
  p_limit           integer DEFAULT 50,
  p_cursor_ts       timestamptz DEFAULT NULL,
  p_cursor_id       uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me    uuid := public.portal_profile_id();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_conv  jsonb;
  v_msgs  jsonb;
BEGIN
  -- Non-enumerating: an inaccessible conversation returns NULL exactly like a
  -- missing one. Access comes only from active participation.
  IF v_me IS NULL OR p_conversation_id NOT IN (SELECT public.my_message_conversation_ids()) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'id', c.id, 'subject', c.subject, 'category', c.category,
    'status', public.message_portal_status_label(c.status),
    'last_message_at', c.last_message_at, 'can_reply', true
  ) INTO v_conv
  FROM public.conversations c WHERE c.id = p_conversation_id;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at, x.id), '[]'::jsonb) INTO v_msgs
  FROM (
    SELECT
      m.id, m.body, m.created_at,
      CASE WHEN m.author_role = 'staff' THEN 'staff' ELSE 'me' END AS author_type,
      CASE WHEN m.author_role = 'staff' THEN 'ASPIRE Team' ELSE 'You' END AS author_label,
      -- Staff author name may appear beneath the team label. Never an email.
      CASE WHEN m.author_role = 'staff'
        THEN (SELECT up.full_name FROM public.user_profiles up WHERE up.id = m.author_profile_id)
        ELSE NULL END AS author_name
    FROM public.messages m
    WHERE m.conversation_id = p_conversation_id
      AND (p_cursor_ts IS NULL OR (m.created_at, m.id) > (p_cursor_ts, p_cursor_id))
    ORDER BY m.created_at, m.id
    LIMIT v_limit
  ) x;

  RETURN jsonb_build_object('conversation', v_conv, 'messages', v_msgs, 'limit', v_limit);
END;
$$;

-- 4c. Portal: unread count (staff-authored messages only, accessible threads).
CREATE OR REPLACE FUNCTION public.messages_portal_unread_count()
RETURNS integer
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(count(*), 0)::integer
  FROM public.messages m
  WHERE m.conversation_id IN (SELECT public.my_message_conversation_ids())
    AND m.author_role = 'staff'
    AND m.created_at > COALESCE(
      (SELECT r.last_read_at FROM public.participant_conversation_reads r
        WHERE r.participant_profile_id = public.portal_profile_id()
          AND r.conversation_id = m.conversation_id),
      '-infinity'::timestamptz);
$$;

-- 4d. Staff: conversation inbox (filters + cursor pagination).
CREATE OR REPLACE FUNCTION public.messages_staff_list_conversations(
  p_limit        integer DEFAULT 25,
  p_cursor_ts    timestamptz DEFAULT NULL,
  p_cursor_id    uuid DEFAULT NULL,
  p_status       text DEFAULT NULL,
  p_assignee     uuid DEFAULT NULL,
  p_category     text DEFAULT NULL,
  p_flagged      boolean DEFAULT NULL,
  p_search       text DEFAULT NULL
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
  IF NOT public.is_active_owner_or_admin() THEN
    RAISE EXCEPTION 'staff access required' USING ERRCODE = 'MS403';
  END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY r.last_message_at DESC, r.id DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT
      c.id, c.subject, c.category, c.status, c.last_message_at,
      c.follow_up_flagged, c.assigned_staff_profile_id,
      (SELECT up.full_name FROM public.user_profiles up WHERE up.id = c.assigned_staff_profile_id) AS assignee_name,
      c.related_student_id,
      (SELECT left(m.body, 160) FROM public.messages m
        WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS latest_preview,
      (SELECT count(*) FROM public.messages m
        WHERE m.conversation_id = c.id
          AND m.author_role <> 'staff'
          AND m.created_at > COALESCE(
            (SELECT r2.last_read_at FROM public.staff_conversation_reads r2
              WHERE r2.staff_profile_id = v_me AND r2.conversation_id = c.id),
            '-infinity'::timestamptz)) AS unread_count,
      (SELECT cp.participant_profile_id FROM public.conversation_participants cp
        WHERE cp.conversation_id = c.id AND cp.removed_at IS NULL LIMIT 1) AS participant_profile_id,
      (SELECT up.full_name FROM public.user_profiles up
        WHERE up.id = (SELECT cp.participant_profile_id FROM public.conversation_participants cp
                        WHERE cp.conversation_id = c.id AND cp.removed_at IS NULL LIMIT 1)) AS participant_name,
      COALESCE(public.message_recipient_has_active_access(
        c.id,
        (SELECT cp.participant_profile_id FROM public.conversation_participants cp
          WHERE cp.conversation_id = c.id AND cp.removed_at IS NULL LIMIT 1)
      ), false) AS participant_access_active
    FROM public.conversations c
    WHERE (p_status   IS NULL OR c.status = p_status)
      AND (p_assignee IS NULL OR c.assigned_staff_profile_id = p_assignee)
      AND (p_category IS NULL OR c.category = p_category)
      AND (p_flagged  IS NULL OR c.follow_up_flagged = p_flagged)
      AND (p_search   IS NULL OR c.subject ILIKE '%' || p_search || '%')
      AND (p_cursor_ts IS NULL OR (c.last_message_at, c.id) < (p_cursor_ts, p_cursor_id))
    ORDER BY c.last_message_at DESC, c.id DESC
    LIMIT v_limit
  ) r;

  RETURN jsonb_build_object('conversations', v_rows, 'limit', v_limit);
END;
$$;

-- 4e. Staff: read one thread.
CREATE OR REPLACE FUNCTION public.messages_staff_get_thread(
  p_conversation_id uuid,
  p_limit           integer DEFAULT 50,
  p_cursor_ts       timestamptz DEFAULT NULL,
  p_cursor_id       uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_limit       integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_conv        jsonb;
  v_msgs        jsonb;
  v_events      jsonb;
  v_participant uuid;
BEGIN
  IF NOT public.is_active_owner_or_admin() THEN
    RAISE EXCEPTION 'staff access required' USING ERRCODE = 'MS403';
  END IF;

  SELECT cp.participant_profile_id INTO v_participant
  FROM public.conversation_participants cp
  WHERE cp.conversation_id = p_conversation_id AND cp.removed_at IS NULL LIMIT 1;

  SELECT jsonb_build_object(
    'id', c.id, 'subject', c.subject, 'category', c.category, 'status', c.status,
    'last_message_at', c.last_message_at, 'resolved_at', c.resolved_at,
    'assigned_staff_profile_id', c.assigned_staff_profile_id,
    'assignee_name', (SELECT up.full_name FROM public.user_profiles up WHERE up.id = c.assigned_staff_profile_id),
    'follow_up_flagged', c.follow_up_flagged,
    'related_student_id', c.related_student_id,
    'related_cohort_id', c.related_cohort_id,
    'participant_profile_id', v_participant,
    'participant_name', (SELECT up.full_name FROM public.user_profiles up WHERE up.id = v_participant),
    'participant_access_active',
      COALESCE(public.message_recipient_has_active_access(c.id, v_participant), false)
  ) INTO v_conv
  FROM public.conversations c WHERE c.id = p_conversation_id;

  IF v_conv IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at, x.id), '[]'::jsonb) INTO v_msgs
  FROM (
    SELECT m.id, m.body, m.created_at, m.author_role,
           (SELECT up.full_name FROM public.user_profiles up WHERE up.id = m.author_profile_id) AS author_name
    FROM public.messages m
    WHERE m.conversation_id = p_conversation_id
      AND (p_cursor_ts IS NULL OR (m.created_at, m.id) > (p_cursor_ts, p_cursor_id))
    ORDER BY m.created_at, m.id
    LIMIT v_limit
  ) x;

  SELECT COALESCE(jsonb_agg(e ORDER BY e.created_at DESC), '[]'::jsonb) INTO v_events
  FROM (
    SELECT ev.event_type, ev.from_value, ev.to_value, ev.created_at,
           (SELECT up.full_name FROM public.user_profiles up WHERE up.id = ev.actor_profile_id) AS actor_name
    FROM public.conversation_events ev
    WHERE ev.conversation_id = p_conversation_id
    ORDER BY ev.created_at DESC LIMIT 50
  ) e;

  RETURN jsonb_build_object('conversation', v_conv, 'messages', v_msgs, 'events', v_events, 'limit', v_limit);
END;
$$;

-- 4f. Staff: unread count (portal-authored messages only).
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
      AND m.created_at > COALESCE(
        (SELECT r.last_read_at FROM public.staff_conversation_reads r
          WHERE r.staff_profile_id = v_me AND r.conversation_id = m.conversation_id),
        '-infinity'::timestamptz)
  );
END;
$$;

-- ── 5. Function privileges (Wave F-1 conventions) ───────────────────────────
-- Write RPCs and explicit-profile helpers: service-role only.
REVOKE ALL ON FUNCTION public.message_profile_is_active_owner_or_admin(uuid)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.message_profile_has_active_student_link(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.messages_start_conversation(uuid, text, uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.messages_post_reply(uuid, text, uuid, text, jsonb)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.messages_mark_read(uuid, text, uuid)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.messages_set_assignment(uuid, uuid, uuid)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.messages_set_status(uuid, uuid, text)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.messages_set_category(uuid, uuid, text)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.messages_set_follow_up(uuid, uuid, boolean)         FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.message_profile_is_active_owner_or_admin(uuid)      TO service_role;
GRANT EXECUTE ON FUNCTION public.message_profile_has_active_student_link(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.messages_start_conversation(uuid, text, uuid, uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.messages_post_reply(uuid, text, uuid, text, jsonb)  TO service_role;
GRANT EXECUTE ON FUNCTION public.messages_mark_read(uuid, text, uuid)                TO service_role;
GRANT EXECUTE ON FUNCTION public.messages_set_assignment(uuid, uuid, uuid)           TO service_role;
GRANT EXECUTE ON FUNCTION public.messages_set_status(uuid, uuid, text)               TO service_role;
GRANT EXECUTE ON FUNCTION public.messages_set_category(uuid, uuid, text)             TO service_role;
GRANT EXECUTE ON FUNCTION public.messages_set_follow_up(uuid, uuid, boolean)         TO service_role;

-- Read RPCs: authenticated callers (caller-scoped inside) plus service_role.
REVOKE ALL ON FUNCTION public.message_portal_status_label(text)                              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.messages_portal_list_conversations(integer, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.messages_portal_get_thread(uuid, integer, timestamptz, uuid)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.messages_portal_unread_count()                                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.messages_staff_list_conversations(integer, timestamptz, uuid, text, uuid, text, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.messages_staff_get_thread(uuid, integer, timestamptz, uuid)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.messages_staff_unread_count()                                  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.message_portal_status_label(text)                              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.messages_portal_list_conversations(integer, timestamptz, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.messages_portal_get_thread(uuid, integer, timestamptz, uuid)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.messages_portal_unread_count()                                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.messages_staff_list_conversations(integer, timestamptz, uuid, text, uuid, text, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.messages_staff_get_thread(uuid, integer, timestamptz, uuid)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.messages_staff_unread_count()                                  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Read-only verification is intentionally NOT included here. After applying,
-- run db/audit/messages_phase3_verification.sql.
