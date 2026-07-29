-- ============================================================================
-- MESSAGES-LIFECYCLE-PHASE3A-REACTIONS: per-user message reactions
-- Migration: 20260801000000_messages_phase3a_reactions
-- ============================================================================
--
-- Approved design: docs/MESSAGES_REACTIONS_DISCOVERY.md (commit e6861a1).
-- Three allowlisted reactions (acknowledge, thanks, celebrate); at most ONE
-- reaction per user per message; toggle off or replace; available to active
-- staff (Owner/Admin) and to live conversation participants across all portal
-- roles (student, unit_leader, academic_partner).
--
-- NON-NEGOTIABLE BOUNDARY (the whole point of this design): reactions modify
-- ONLY public.message_reactions. Nothing in this file, and nothing in the
-- reaction RPC, ever touches conversations.last_message_at, the read-pointer
-- tables (staff_conversation_reads, participant_conversation_reads), archive
-- state (message_conversation_visibility), conversation_events, or
-- message_notification_deliveries. Reactions therefore can never bump an
-- unread count, resurface an archived thread, emit a lifecycle event, or send
-- an email. The delivery event_type CHECK is not extended.
--
-- Reactions are per-user presentation state, exactly like the read pointers
-- and the archive visibility table. They are deliberately NOT part of the
-- append-only messages / conversation_events record (that guarantee, in
-- docs/MESSAGES_PHASE1_FOUNDATION.md, is untouched). Removal is a hard delete
-- of the caller's own row; there is no reaction history and no tombstone.
--
-- WHAT THIS ADDS
--   1. public.message_reactions: PK (message_id, profile_id), reaction_key in
--      a closed CHECK allowlist, ON DELETE CASCADE from messages and
--      user_profiles. RLS enabled with ZERO policies; service_role grants
--      only. Expanding the reaction set requires a new Owner-gated migration
--      by design.
--   2. messages_set_message_reaction: service-role-only write RPC. Verified
--      actor kind from the API layer, never from the client. Staff authorize
--      via message_profile_is_active_owner_or_admin; portal kinds via
--      message_participant_can_read on the message's conversation
--      (non-enumerating MS404). Upserts or deletes the caller's single row
--      and returns the message's fresh aggregation.
--   3. messages_staff_get_thread_v3 and messages_portal_get_thread_v3:
--      byte-identical behavior to the applied v2 definitions plus one
--      additive per-message field, reactions: [{key, count, mine}]. Distinct
--      names avoid PostgREST overload ambiguity; both v2 functions remain
--      untouched for rollback and for the pre-migration API fallback.
--
-- No FOR UPDATE serialization is needed here: unlike archive, a reaction has
-- no cross-row timestamp derivation. Every write is a plain single-row upsert
-- or delete keyed by (message_id, profile_id).
--
-- DEPLOY-ORDER SAFETY: the application detects these functions at runtime
-- (PGRST202/42883 probes). Pre-migration, thread endpoints fall back to v2
-- and report reactions_available=false (the UI shows no reaction affordance),
-- and the reaction endpoints return 503 reactions_not_ready. Pre-deploy, the
-- new functions sit unused. Either order is safe.
--
-- SQLSTATE mapping (matches every other Messages RPC): MS400 -> 422
-- validation, MS403 -> 403 forbidden, MS404 -> 404 not found.
--
-- HOW TO RUN: the Owner pastes this file WHOLE into the Supabase SQL editor
-- and executes it as one block. Atomic (BEGIN/COMMIT) and idempotent
-- (IF NOT EXISTS / CREATE OR REPLACE only). Claude Code applies nothing.
-- Verification: docs/security/MESSAGES_REACTIONS_VERIFICATION.md.
-- ============================================================================

BEGIN;

-- ── 1. message_reactions ─────────────────────────────────────────────────────
-- One row per (message, profile): the "one reaction per user per message"
-- rule is the PRIMARY KEY, not application logic. CASCADE from messages means
-- reactions never outlive their message, and the Phase 2 purge runbook's
-- transaction remains valid without a new explicit DELETE (its documentation
-- is amended in this same commit).
CREATE TABLE IF NOT EXISTS public.message_reactions (
  message_id   uuid        NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  profile_id   uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  reaction_key text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (message_id, profile_id),

  -- The closed reaction set. Expanding it is a product decision that requires
  -- a new Owner-gated migration; the UI cannot invent keys.
  CONSTRAINT chk_message_reactions_key
    CHECK (reaction_key IN ('acknowledge', 'thanks', 'celebrate'))
);

COMMENT ON TABLE public.message_reactions IS
  'MESSAGES-P3A: per-user message reactions (one per user per message, closed key allowlist). Per-user presentation state like the read pointers and archive visibility, NOT part of the append-only message/event record: no history, no tombstones, hard delete on removal. Never touches last_message_at, read pointers, archive state, events, or deliveries, so a reaction can never change unread counts, resurface an archived thread, or trigger a notification. Service-role-only; RLS enabled with zero policies.';

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
-- No policy is added: RLS is enabled with ZERO policies, denying every
-- authenticated read/write by default, exactly like the read-pointer tables
-- and message_conversation_visibility. service_role writes bypass RLS.

REVOKE ALL ON public.message_reactions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_reactions TO service_role;

-- ── 2. messages_set_message_reaction (service-role only) ────────────────────
-- Sets, replaces, or removes THE CALLER'S OWN reaction on one message.
-- p_reaction_key NULL removes. Every write below is scoped to
-- p_actor_profile_id's own row; no other profile's reaction is ever touched,
-- and NOTHING outside public.message_reactions is written.
CREATE OR REPLACE FUNCTION public.messages_set_message_reaction(
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
  IF p_actor_kind NOT IN ('student', 'unit_leader', 'academic_partner', 'staff') THEN
    RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';
  END IF;
  IF p_reaction_key IS NOT NULL
     AND p_reaction_key NOT IN ('acknowledge', 'thanks', 'celebrate') THEN
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
    -- Reacting requires READ visibility, not send (matches the archive rule:
    -- a frozen-but-readable thread may still be reacted to). Non-enumerating:
    -- an inaccessible message and a missing one are indistinguishable.
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
          created_at   = now();
  END IF;

  -- Fresh aggregation for THIS message, computed for the caller, so the
  -- client can reconcile its optimistic state from the authoritative answer.
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

COMMENT ON FUNCTION public.messages_set_message_reaction(uuid, text, uuid, text) IS
  'MESSAGES-P3A: set, replace, or remove (NULL key) the calling profile''s own reaction on one message. Closed key allowlist enforced here AND by the table CHECK. Staff (Owner/Admin) authorize via message_profile_is_active_owner_or_admin; portal kinds require live READ participation on the message''s conversation via message_participant_can_read (non-enumerating MS404). Writes ONLY message_reactions: never last_message_at, read pointers, archive visibility, events, or deliveries, so reactions cannot alter unread counts, archive state, or notifications. Service-role only; the API layer passes the VERIFIED actor kind.';

REVOKE ALL ON FUNCTION public.messages_set_message_reaction(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.messages_set_message_reaction(uuid, text, uuid, text) TO service_role;

-- ── 3. messages_staff_get_thread_v3 ──────────────────────────────────────────
-- The applied v2 definition verbatim (same auth, pagination, projections,
-- events) plus: v_me for the caller and a per-message reactions aggregation.
-- v2 remains untouched for rollback and pre-migration fallback.
CREATE OR REPLACE FUNCTION public.messages_staff_get_thread_v3(
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
  v_limit       integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_me          uuid := public.portal_profile_id();
  v_conv        jsonb;
  v_msgs        jsonb;
  v_events      jsonb;
  v_participant uuid;
  v_oldest_ts   timestamptz;
  v_oldest_id   uuid;
  v_count       integer;
  v_has_more    boolean := false;
BEGIN
  IF NOT public.is_active_owner_or_admin() THEN
    RAISE EXCEPTION 'staff access required' USING ERRCODE = 'MS403';
  END IF;

  -- A cursor is both parts or neither. A partial cursor is rejected rather than
  -- silently returning an empty page (a null tie-breaker makes the row
  -- comparison null, which matches nothing).
  IF (p_cursor_ts IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'invalid cursor' USING ERRCODE = 'MS400';
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

  -- Non-enumerating: an inaccessible or missing conversation returns NULL.
  IF v_conv IS NULL THEN
    RETURN NULL;
  END IF;

  -- Newest-first selection, BOUNDED BY LIMIT, then reordered ascending for
  -- chronological display. The inner query never aggregates the whole thread.
  --   no cursor      -> the newest v_limit messages
  --   with a cursor  -> the newest v_limit messages STRICTLY OLDER than it
  WITH page AS (
    SELECT m.id, m.body, m.created_at, m.author_role, m.author_profile_id
    FROM public.messages m
    WHERE m.conversation_id = p_conversation_id
      AND (p_cursor_ts IS NULL OR (m.created_at, m.id) < (p_cursor_ts, p_cursor_id))
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT v_limit
  ),
  -- The oldest row of the BOUNDED page is the backward cursor. Taken from the
  -- page itself, so no extra scan and no OFFSET.
  oldest AS (
    SELECT p.created_at, p.id FROM page p ORDER BY p.created_at, p.id LIMIT 1
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'body', p.body,
        'created_at', p.created_at,
        'author_role', p.author_role,
        'author_name', (SELECT up.full_name FROM public.user_profiles up WHERE up.id = p.author_profile_id),
        -- MESSAGES-P3A: the ONLY addition over v2. Bounded per message-page
        -- row; [] when a message has no reactions.
        'reactions', (
          SELECT COALESCE(jsonb_agg(
            jsonb_build_object('key', r.reaction_key, 'count', r.cnt, 'mine', r.mine)
            ORDER BY r.reaction_key
          ), '[]'::jsonb)
          FROM (
            SELECT mr.reaction_key,
                   count(*)::integer AS cnt,
                   bool_or(mr.profile_id = v_me) AS mine
            FROM public.message_reactions mr
            WHERE mr.message_id = p.id
            GROUP BY mr.reaction_key
          ) r
        )
      ) ORDER BY p.created_at, p.id
    ), '[]'::jsonb),
    (SELECT o.created_at FROM oldest o),
    (SELECT o.id FROM oldest o),
    count(*)::integer
  INTO v_msgs, v_oldest_ts, v_oldest_id, v_count
  FROM page p;

  -- Older history remains only when a message exists strictly older than the
  -- oldest row of this page. Bounded existence check, never a full fetch.
  IF v_count > 0 AND v_oldest_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.conversation_id = p_conversation_id
        AND (m.created_at, m.id) < (v_oldest_ts, v_oldest_id)
    ) INTO v_has_more;
  END IF;

  SELECT COALESCE(jsonb_agg(e ORDER BY e.created_at DESC), '[]'::jsonb) INTO v_events
  FROM (
    SELECT ev.event_type, ev.from_value, ev.to_value, ev.created_at,
           (SELECT up.full_name FROM public.user_profiles up WHERE up.id = ev.actor_profile_id) AS actor_name
    FROM public.conversation_events ev
    WHERE ev.conversation_id = p_conversation_id
    ORDER BY ev.created_at DESC LIMIT 50
  ) e;

  RETURN jsonb_build_object(
    'conversation', v_conv,
    'messages', v_msgs,
    'events', v_events,
    'limit', v_limit,
    'has_more', v_has_more,
    -- next_cursor points at the OLDEST message of this page, so the next request
    -- continues BACKWARD through history. Null when no older history remains.
    'next_cursor', CASE WHEN v_has_more
      THEN jsonb_build_object('cursor_ts', v_oldest_ts, 'cursor_id', v_oldest_id)
      ELSE NULL END
  );
END;
$$;

COMMENT ON FUNCTION public.messages_staff_get_thread_v3(uuid, integer, timestamptz, uuid) IS
  'MESSAGES-P3A: the applied messages_staff_get_thread_v2 behavior verbatim (active Owner/Admin only, reverse pagination, identical conversation/message/event projections) plus one additive per-message field: reactions [{key, count, mine}], with mine computed for the caller via portal_profile_id(). Distinct name avoids PostgREST overload ambiguity; v2 is retained unchanged for rollback and for the pre-migration API fallback.';

REVOKE ALL ON FUNCTION public.messages_staff_get_thread_v3(uuid, integer, timestamptz, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_staff_get_thread_v3(uuid, integer, timestamptz, uuid)
  TO authenticated, service_role;

-- ── 4. messages_portal_get_thread_v3 ─────────────────────────────────────────
-- The applied v2 definition verbatim (same auth, pagination, projections)
-- plus the identical per-message reactions aggregation. v2 remains untouched.
CREATE OR REPLACE FUNCTION public.messages_portal_get_thread_v3(
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
  v_me         uuid := public.portal_profile_id();
  v_limit      integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_conv       jsonb;
  v_msgs       jsonb;
  v_oldest_ts  timestamptz;
  v_oldest_id  uuid;
  v_count      integer;
  v_has_more   boolean := false;
BEGIN
  -- A cursor is both parts or neither. A partial cursor is rejected rather than
  -- silently returning an empty page: a null tie-breaker makes the row
  -- comparison null, which matches nothing and would look like "no history".
  IF (p_cursor_ts IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'invalid cursor' USING ERRCODE = 'MS400';
  END IF;

  -- Non-enumerating: an inaccessible conversation returns NULL exactly like a
  -- missing one, so a student cannot probe for conversation ids. Access comes
  -- ONLY from active participation in this specific conversation.
  -- my_message_conversation_ids() requires an unremoved participant row, a
  -- live role grant, and an active link matching the participant scope.
  IF v_me IS NULL OR p_conversation_id NOT IN (SELECT public.my_message_conversation_ids()) THEN
    RETURN NULL;
  END IF;

  -- Conversation projection is byte-identical to v2: the portal caller sees a
  -- coarse status label rather than the staff workflow status, and never an
  -- assignee, a flag, an internal note, or any email address.
  SELECT jsonb_build_object(
    'id', c.id, 'subject', c.subject, 'category', c.category,
    'status', public.message_portal_status_label(c.status),
    'last_message_at', c.last_message_at, 'can_reply', true
  ) INTO v_conv
  FROM public.conversations c WHERE c.id = p_conversation_id;

  IF v_conv IS NULL THEN
    RETURN NULL;
  END IF;

  -- Newest-first selection, BOUNDED BY LIMIT, then reordered ascending for
  -- chronological display. The inner query never aggregates the whole thread.
  --   no cursor      -> the newest v_limit messages
  --   with a cursor  -> the newest v_limit messages STRICTLY OLDER than it
  -- The (created_at, id) row comparison is a deterministic tuple cursor: id
  -- breaks ties so two messages sharing a timestamp still paginate exactly once,
  -- with no duplicate and no skipped row.
  WITH page AS (
    SELECT m.id, m.body, m.created_at, m.author_role, m.author_profile_id
    FROM public.messages m
    WHERE m.conversation_id = p_conversation_id
      AND (p_cursor_ts IS NULL OR (m.created_at, m.id) < (p_cursor_ts, p_cursor_id))
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT v_limit
  ),
  -- The oldest row of the BOUNDED page is the backward cursor. Taken from the
  -- page itself, so no extra scan and no offset arithmetic.
  oldest AS (
    SELECT p.created_at, p.id FROM page p ORDER BY p.created_at, p.id LIMIT 1
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'body', p.body,
        'created_at', p.created_at,
        -- Author projection is byte-identical to v2. Staff are labeled as the
        -- team, with an optional staff display name and never a staff email.
        'author_type',  CASE WHEN p.author_role = 'staff' THEN 'staff' ELSE 'me' END,
        'author_label', CASE WHEN p.author_role = 'staff' THEN 'ASPIRE Team' ELSE 'You' END,
        'author_name',  CASE WHEN p.author_role = 'staff'
          THEN (SELECT up.full_name FROM public.user_profiles up WHERE up.id = p.author_profile_id)
          ELSE NULL END,
        -- MESSAGES-P3A: the ONLY addition over v2. Bounded per message-page
        -- row; [] when a message has no reactions. Counts and mine only:
        -- reactor identities are never projected to portal callers.
        'reactions', (
          SELECT COALESCE(jsonb_agg(
            jsonb_build_object('key', r.reaction_key, 'count', r.cnt, 'mine', r.mine)
            ORDER BY r.reaction_key
          ), '[]'::jsonb)
          FROM (
            SELECT mr.reaction_key,
                   count(*)::integer AS cnt,
                   bool_or(mr.profile_id = v_me) AS mine
            FROM public.message_reactions mr
            WHERE mr.message_id = p.id
            GROUP BY mr.reaction_key
          ) r
        )
      ) ORDER BY p.created_at, p.id
    ), '[]'::jsonb),
    (SELECT o.created_at FROM oldest o),
    (SELECT o.id FROM oldest o),
    count(*)::integer
  INTO v_msgs, v_oldest_ts, v_oldest_id, v_count
  FROM page p;

  -- Older history remains only when a message exists strictly older than the
  -- oldest row of this page. Bounded existence check, never a full fetch. This
  -- is what lets the API report has_more without over-fetching by one row.
  IF v_count > 0 AND v_oldest_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.conversation_id = p_conversation_id
        AND (m.created_at, m.id) < (v_oldest_ts, v_oldest_id)
    ) INTO v_has_more;
  END IF;

  RETURN jsonb_build_object(
    'conversation', v_conv,
    'messages', v_msgs,
    'limit', v_limit,
    'has_more', v_has_more,
    -- next_cursor points at the OLDEST message of this page, so the next request
    -- continues BACKWARD through history. Null when no older history remains.
    'next_cursor', CASE WHEN v_has_more
      THEN jsonb_build_object('cursor_ts', v_oldest_ts, 'cursor_id', v_oldest_id)
      ELSE NULL END
  );
END;
$$;

COMMENT ON FUNCTION public.messages_portal_get_thread_v3(uuid, integer, timestamptz, uuid) IS
  'MESSAGES-P3A: the applied messages_portal_get_thread_v2 behavior verbatim (active participation only via portal_profile_id() and my_message_conversation_ids(), non-enumerating NULL, reverse pagination, identical conversation/author projections) plus one additive per-message field: reactions [{key, count, mine}]. Counts and the caller''s own flag only; reactor identities are never projected to portal callers. Distinct name avoids PostgREST overload ambiguity; v2 is retained unchanged for rollback and for the pre-migration API fallback.';

REVOKE ALL ON FUNCTION public.messages_portal_get_thread_v3(uuid, integer, timestamptz, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_portal_get_thread_v3(uuid, integer, timestamptz, uuid)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Read-only verification is intentionally NOT included here. After applying,
-- run the blocks in docs/security/MESSAGES_REACTIONS_VERIFICATION.md.
