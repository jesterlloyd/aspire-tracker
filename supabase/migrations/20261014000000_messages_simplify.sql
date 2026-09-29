-- MESSAGES-SIMPLIFY-1: Needs reply is computed, Done is shared, and staff can
-- see who replied or reacted.
-- Owner-gated. Apply this file whole, then run
-- db/audit/messages_simplify_checks.sql (read-only).
--
-- READ FUNCTIONS ONLY. No table, column, constraint, trigger, or row changes.
-- Every earlier list, count, and thread version stays in place for rollback
-- and for the code-first fallback in the API.
--
-- The rule, in one place (messages_staff_triage):
--   done        = status is resolved, OR this staff member archived the thread
--                 personally before this build (those stay out of the open
--                 lists; a new message clears a personal archive as before).
--   needs_reply = not done AND (follow_up_flagged
--                 OR (a participant wrote last AND no staff member reacted to
--                     that last message)).
--   handled_by  = the staff member who most recently replied, or reacted to a
--                 participant message.
-- A staff reactor is anyone who is not a participant of the conversation;
-- reactions by participants never count toward handling.
--
-- One reaction per person per message is already the primary key of
-- message_reactions (message_id, profile_id), so no constraint is added.

BEGIN;

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

COMMENT ON FUNCTION public.messages_staff_triage(uuid, uuid) IS
  'MESSAGES-SIMPLIFY-1: the one Needs reply / Done / handled-by rule, read by the staff list v5, the needs-reply count v2 and the staff thread v5. Internal: callers are SECURITY DEFINER functions that authorize first.';
REVOKE ALL ON FUNCTION public.messages_staff_triage(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.messages_staff_triage(uuid, uuid) TO service_role;

-- Staff inbox v5: three views (needs_reply | all | done), search, cursor
-- pagination, and counts for all three views (unaffected by search).
CREATE OR REPLACE FUNCTION public.messages_staff_list_conversations_v5(
  p_limit     integer     DEFAULT 25,
  p_cursor_ts timestamptz DEFAULT NULL,
  p_cursor_id uuid        DEFAULT NULL,
  p_search    text        DEFAULT NULL,
  p_view      text        DEFAULT 'needs_reply'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me     uuid    := public.portal_profile_id();
  v_limit  integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_view   text    := COALESCE(p_view, 'needs_reply');
  v_search text    := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_rows   jsonb;
  v_counts jsonb;
BEGIN
  IF NOT public.is_active_owner_or_admin() THEN
    RAISE EXCEPTION 'staff access required' USING ERRCODE = 'MS403';
  END IF;
  IF v_view NOT IN ('needs_reply', 'all', 'done') THEN
    RAISE EXCEPTION 'invalid view' USING ERRCODE = 'MS400';
  END IF;
  IF (p_cursor_ts IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'invalid cursor' USING ERRCODE = 'MS400';
  END IF;

  WITH source AS (
    SELECT
      c.id, c.subject, c.status, c.last_message_at, c.follow_up_flagged,
      c.related_student_id,
      t.is_archived, t.is_done, t.needs_reply,
      t.latest_author_role, t.latest_author_profile_id, t.latest_author_name,
      t.latest_preview,
      t.handled_by_profile_id, t.handled_by_name, t.handled_at,
      (SELECT count(*) FROM public.messages m
        WHERE m.conversation_id = c.id
          AND m.author_role <> 'staff'
          AND m.created_at > COALESCE(
            (SELECT r2.last_read_at FROM public.staff_conversation_reads r2
              WHERE r2.staff_profile_id = v_me AND r2.conversation_id = c.id),
            '-infinity'::timestamptz)) AS unread_count,
      participant.participant_profile_id,
      participant.participant_name,
      COALESCE(public.message_recipient_has_active_access(
        c.id, participant.participant_profile_id
      ), false) AS participant_access_active
    FROM public.conversations c
    CROSS JOIN LATERAL public.messages_staff_triage(c.id, v_me) t
    LEFT JOIN LATERAL (
      SELECT cp.participant_profile_id, up.full_name AS participant_name
      FROM public.conversation_participants cp
      LEFT JOIN public.user_profiles up ON up.id = cp.participant_profile_id
      WHERE cp.conversation_id = c.id AND cp.removed_at IS NULL
      LIMIT 1
    ) participant ON true
  ),
  counts AS (
    SELECT
      count(*) FILTER (WHERE needs_reply)::integer AS needs_reply_count,
      count(*) FILTER (WHERE NOT is_done)::integer AS all_count,
      count(*) FILTER (WHERE is_done)::integer     AS done_count
    FROM source
  ),
  page AS (
    SELECT s.* FROM source s
    WHERE (
        (v_view = 'needs_reply' AND s.needs_reply)
        OR (v_view = 'all' AND NOT s.is_done)
        OR (v_view = 'done' AND s.is_done)
      )
      AND (
        v_search IS NULL
        OR s.subject ILIKE '%' || v_search || '%'
        OR s.participant_name ILIKE '%' || v_search || '%'
      )
      AND (p_cursor_ts IS NULL OR (s.last_message_at, s.id) < (p_cursor_ts, p_cursor_id))
    ORDER BY s.last_message_at DESC, s.id DESC
    LIMIT v_limit
  )
  SELECT
    COALESCE((SELECT jsonb_agg(p ORDER BY p.last_message_at DESC, p.id DESC) FROM page p), '[]'::jsonb),
    (SELECT jsonb_build_object(
      'needs_reply', k.needs_reply_count,
      'all', k.all_count,
      'done', k.done_count
    ) FROM counts k)
  INTO v_rows, v_counts;

  RETURN jsonb_build_object('conversations', v_rows, 'counts', v_counts, 'limit', v_limit);
END;
$$;

COMMENT ON FUNCTION public.messages_staff_list_conversations_v5(integer, timestamptz, uuid, text, text) IS
  'MESSAGES-SIMPLIFY-1 staff inbox: Needs reply | All | Done from messages_staff_triage, sender and subject search, counts for all three views. v4 and earlier are kept for rollback.';
REVOKE ALL ON FUNCTION public.messages_staff_list_conversations_v5(integer, timestamptz, uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_staff_list_conversations_v5(integer, timestamptz, uuid, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.messages_staff_needs_reply_count_v2()
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
    FROM public.conversations c
    CROSS JOIN LATERAL public.messages_staff_triage(c.id, v_me) t
    WHERE t.needs_reply
  );
END;
$$;

COMMENT ON FUNCTION public.messages_staff_needs_reply_count_v2() IS
  'MESSAGES-SIMPLIFY-1: the top-bar badge. Counts exactly the rows the v5 Needs reply view lists.';
REVOKE ALL ON FUNCTION public.messages_staff_needs_reply_count_v2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_staff_needs_reply_count_v2() TO authenticated, service_role;

-- Staff thread v5: the v4 payload plus
--   conversation: is_archived, is_done, needs_reply, handled_by_profile_id,
--                 handled_by_name, latest_author_role
--   each message: author_profile_id and reactors [{key, profile_id, name, is_staff}]
-- Reactor names are shown to staff only; the portal thread is unchanged and
-- still carries counts and the caller's own flag, never identities.
CREATE OR REPLACE FUNCTION public.messages_staff_get_thread_v5(
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
  v_me      uuid := public.portal_profile_id();
  v_payload jsonb;
  v_msgs    jsonb;
  v_triage  jsonb;
BEGIN
  -- v4 authorizes (active Owner/Admin) and validates the cursor.
  v_payload := public.messages_staff_get_thread_v4(p_conversation_id, p_limit, p_cursor_ts, p_cursor_id);
  IF v_payload IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(
    e.msg || jsonb_build_object(
      'author_profile_id', m.author_profile_id,
      'reactors', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'key', mr.reaction_key,
          'profile_id', mr.profile_id,
          'name', up.full_name,
          'is_staff', NOT EXISTS (
            SELECT 1 FROM public.conversation_participants cp
            WHERE cp.conversation_id = p_conversation_id
              AND cp.participant_profile_id = mr.profile_id
          )
        ) ORDER BY mr.created_at)
        FROM public.message_reactions mr
        LEFT JOIN public.user_profiles up ON up.id = mr.profile_id
        WHERE mr.message_id = m.id
      ), '[]'::jsonb)
    ) ORDER BY e.ord
  ), '[]'::jsonb)
  INTO v_msgs
  FROM jsonb_array_elements(v_payload->'messages') WITH ORDINALITY AS e(msg, ord)
  LEFT JOIN public.messages m ON m.id = (e.msg->>'id')::uuid;

  SELECT jsonb_build_object(
    'is_archived', t.is_archived,
    'is_done', t.is_done,
    'needs_reply', t.needs_reply,
    'latest_author_role', t.latest_author_role,
    'handled_by_profile_id', t.handled_by_profile_id,
    'handled_by_name', t.handled_by_name
  ) INTO v_triage
  FROM public.messages_staff_triage(p_conversation_id, v_me) t;

  RETURN v_payload
    || jsonb_build_object(
      'messages', v_msgs,
      'conversation', (v_payload->'conversation') || COALESCE(v_triage, '{}'::jsonb),
      'triage_version', 2
    );
END;
$$;

COMMENT ON FUNCTION public.messages_staff_get_thread_v5(uuid, integer, timestamptz, uuid) IS
  'MESSAGES-SIMPLIFY-1: messages_staff_get_thread_v4 plus the triage state and, per message, author_profile_id and reactor identities (staff only). v4 and earlier are kept for rollback.';
REVOKE ALL ON FUNCTION public.messages_staff_get_thread_v5(uuid, integer, timestamptz, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_staff_get_thread_v5(uuid, integer, timestamptz, uuid)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
