-- ASPIRE Messages refinement: reply triage, sender search, and six reactions.
-- Owner-gated. Apply this file whole, then run the companion read-only audit.
-- Existing messages, reactions, read pointers, archive state, and lifecycle
-- events are preserved. Reactions remain quiet presentation state.

BEGIN;

-- Keep one reaction total per profile per message. The primary key remains
-- (message_id, profile_id); only the closed key set expands. Existing keys keep
-- their stored values and receive the refined glyph/label in the client.
ALTER TABLE public.message_reactions
  DROP CONSTRAINT chk_message_reactions_key;
ALTER TABLE public.message_reactions
  ADD CONSTRAINT chk_message_reactions_key
  CHECK (reaction_key IN ('acknowledge', 'on_it', 'done', 'thanks', 'warm', 'celebrate'));

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
  IF p_actor_kind NOT IN ('student', 'unit_leader', 'academic_partner', 'staff') THEN
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

COMMENT ON FUNCTION public.messages_set_message_reaction_v2(uuid, text, uuid, text) IS
  'ASPIRE Messages refinement: set, replace, or remove the caller single reaction using the six-key allowlist. Writes only message_reactions and never changes unread, archive, last_message_at, events, or deliveries.';
REVOKE ALL ON FUNCTION public.messages_set_message_reaction_v2(uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.messages_set_message_reaction_v2(uuid, text, uuid, text)
  TO service_role;

-- Capability-bearing wrappers preserve the applied v3 thread behavior and add
-- only a top-level reaction_set_version. Code-first deploys fall back to v3 and
-- keep the original three-key picker until this migration is present.
CREATE OR REPLACE FUNCTION public.messages_staff_get_thread_v4(
  p_conversation_id uuid,
  p_limit           integer     DEFAULT 50,
  p_cursor_ts       timestamptz DEFAULT NULL,
  p_cursor_id       uuid        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE WHEN q.payload IS NULL THEN NULL
    ELSE q.payload || jsonb_build_object('reaction_set_version', 2) END
  FROM (
    SELECT public.messages_staff_get_thread_v3(
      p_conversation_id, p_limit, p_cursor_ts, p_cursor_id
    ) AS payload
  ) q;
$$;

CREATE OR REPLACE FUNCTION public.messages_portal_get_thread_v4(
  p_conversation_id uuid,
  p_limit           integer     DEFAULT 50,
  p_cursor_ts       timestamptz DEFAULT NULL,
  p_cursor_id       uuid        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE WHEN q.payload IS NULL THEN NULL
    ELSE q.payload || jsonb_build_object('reaction_set_version', 2) END
  FROM (
    SELECT public.messages_portal_get_thread_v3(
      p_conversation_id, p_limit, p_cursor_ts, p_cursor_id
    ) AS payload
  ) q;
$$;

REVOKE ALL ON FUNCTION public.messages_staff_get_thread_v4(uuid, integer, timestamptz, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_staff_get_thread_v4(uuid, integer, timestamptz, uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.messages_portal_get_thread_v4(uuid, integer, timestamptz, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_portal_get_thread_v4(uuid, integer, timestamptz, uuid)
  TO authenticated, service_role;

-- Staff inbox v4 adds latest_author_role, sender-name search, authoritative
-- quick-filter counts, and an attention mode. Every predicate is applied before
-- the cursor limit, so quick filters remain correct across the full result set.
CREATE OR REPLACE FUNCTION public.messages_staff_list_conversations_v4(
  p_limit               integer     DEFAULT 25,
  p_cursor_ts           timestamptz DEFAULT NULL,
  p_cursor_id           uuid        DEFAULT NULL,
  p_status              text        DEFAULT NULL,
  p_assignee_mode       text        DEFAULT 'any',
  p_assignee_profile_id uuid        DEFAULT NULL,
  p_category_mode       text        DEFAULT 'any',
  p_category            text        DEFAULT NULL,
  p_flagged             boolean     DEFAULT NULL,
  p_search              text        DEFAULT NULL,
  p_view                text        DEFAULT 'active',
  p_attention           text        DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me        uuid    := public.portal_profile_id();
  v_limit     integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_amode     text    := COALESCE(p_assignee_mode, 'any');
  v_cmode     text    := COALESCE(p_category_mode, 'any');
  v_view      text    := COALESCE(p_view, 'active');
  v_attention text    := COALESCE(p_attention, 'all');
  v_search    text    := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_category  text    := NULLIF(btrim(COALESCE(p_category, '')), '');
  v_rows      jsonb;
  v_counts    jsonb;
BEGIN
  IF NOT public.is_active_owner_or_admin() THEN
    RAISE EXCEPTION 'staff access required' USING ERRCODE = 'MS403';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('open', 'waiting', 'resolved') THEN
    RAISE EXCEPTION 'invalid status' USING ERRCODE = 'MS400';
  END IF;
  IF v_amode NOT IN ('any', 'unassigned', 'specific') THEN
    RAISE EXCEPTION 'invalid assignee mode' USING ERRCODE = 'MS400';
  END IF;
  IF v_amode = 'specific' AND p_assignee_profile_id IS NULL THEN
    RAISE EXCEPTION 'specific assignee mode requires an assignee profile id' USING ERRCODE = 'MS400';
  END IF;
  IF v_cmode NOT IN ('any', 'uncategorized', 'specific') THEN
    RAISE EXCEPTION 'invalid category mode' USING ERRCODE = 'MS400';
  END IF;
  IF v_cmode = 'specific' AND (
    v_category IS NULL OR v_category NOT IN (
      'Placement and matching', 'Scheduling', 'Onboarding requirements',
      'Clinical rotation support', 'Preceptor support', 'Portal or account help',
      'General question'
    )
  ) THEN
    RAISE EXCEPTION 'invalid category' USING ERRCODE = 'MS400';
  END IF;
  IF v_view NOT IN ('active', 'archived', 'all') THEN
    RAISE EXCEPTION 'invalid view' USING ERRCODE = 'MS400';
  END IF;
  IF v_attention NOT IN ('all', 'needs_reply', 'unassigned') THEN
    RAISE EXCEPTION 'invalid attention mode' USING ERRCODE = 'MS400';
  END IF;
  IF (p_cursor_ts IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'invalid cursor' USING ERRCODE = 'MS400';
  END IF;

  WITH source AS (
    SELECT
      c.id, c.subject, c.category, c.status, c.last_message_at,
      c.follow_up_flagged, c.assigned_staff_profile_id,
      (SELECT up.full_name FROM public.user_profiles up
        WHERE up.id = c.assigned_staff_profile_id) AS assignee_name,
      c.related_student_id,
      latest.latest_preview,
      latest.latest_author_role,
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
      ), false) AS participant_access_active,
      EXISTS (
        SELECT 1 FROM public.message_conversation_visibility visibility
        WHERE visibility.profile_id = v_me
          AND visibility.conversation_id = c.id
          AND visibility.archived_at >= c.last_message_at
      ) AS is_archived
    FROM public.conversations c
    LEFT JOIN LATERAL (
      SELECT left(m.body, 160) AS latest_preview,
             m.author_role AS latest_author_role
      FROM public.messages m
      WHERE m.conversation_id = c.id
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ) latest ON true
    LEFT JOIN LATERAL (
      SELECT cp.participant_profile_id, up.full_name AS participant_name
      FROM public.conversation_participants cp
      LEFT JOIN public.user_profiles up ON up.id = cp.participant_profile_id
      WHERE cp.conversation_id = c.id AND cp.removed_at IS NULL
      LIMIT 1
    ) participant ON true
  ),
  base AS (
    SELECT s.* FROM source s
    WHERE (p_status IS NULL OR s.status = p_status)
      AND (
        v_amode = 'any'
        OR (v_amode = 'unassigned' AND s.assigned_staff_profile_id IS NULL)
        OR (v_amode = 'specific' AND s.assigned_staff_profile_id = p_assignee_profile_id)
      )
      AND (
        v_cmode = 'any'
        OR (v_cmode = 'uncategorized' AND s.category IS NULL)
        OR (v_cmode = 'specific' AND s.category = v_category)
      )
      AND (p_flagged IS NULL OR s.follow_up_flagged = p_flagged)
      AND (
        v_search IS NULL
        OR s.subject ILIKE '%' || v_search || '%'
        OR s.participant_name ILIKE '%' || v_search || '%'
      )
  ),
  counts AS (
    SELECT
      count(*) FILTER (WHERE NOT is_archived)::integer AS active_count,
      count(*) FILTER (
        WHERE NOT is_archived
          AND status <> 'resolved'
          AND latest_author_role <> 'staff'
      )::integer AS needs_reply_count,
      count(*) FILTER (
        WHERE NOT is_archived
          AND status <> 'resolved'
          AND assigned_staff_profile_id IS NULL
      )::integer AS unassigned_count
    FROM source
  ),
  page AS (
    SELECT b.* FROM base b
    WHERE (
        v_view = 'all'
        OR (v_view = 'active' AND NOT b.is_archived)
        OR (v_view = 'archived' AND b.is_archived)
      )
      AND (
        v_attention = 'all'
        OR (v_attention = 'needs_reply'
          AND b.status <> 'resolved' AND b.latest_author_role <> 'staff')
        OR (v_attention = 'unassigned'
          AND b.status <> 'resolved' AND b.assigned_staff_profile_id IS NULL)
      )
      AND (p_cursor_ts IS NULL OR (b.last_message_at, b.id) < (p_cursor_ts, p_cursor_id))
    ORDER BY b.last_message_at DESC, b.id DESC
    LIMIT v_limit
  )
  SELECT
    COALESCE((SELECT jsonb_agg(p ORDER BY p.last_message_at DESC, p.id DESC) FROM page p), '[]'::jsonb),
    (SELECT jsonb_build_object(
      'active', c.active_count,
      'needs_reply', c.needs_reply_count,
      'unassigned', c.unassigned_count
    ) FROM counts c)
  INTO v_rows, v_counts;

  RETURN jsonb_build_object('conversations', v_rows, 'counts', v_counts, 'limit', v_limit);
END;
$$;

COMMENT ON FUNCTION public.messages_staff_list_conversations_v4(integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text, text, text) IS
  'ASPIRE Messages refined staff inbox. Adds sender search, latest author direction, server-side needs-reply and unassigned quick filtering, and authoritative active quick counts. Preserves v3 authorization, archive derivation, cursor ordering, privacy, and advanced filters.';
REVOKE ALL ON FUNCTION public.messages_staff_list_conversations_v4(integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_staff_list_conversations_v4(integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.messages_staff_needs_reply_count()
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
    WHERE c.status <> 'resolved'
      AND (SELECT m.author_role FROM public.messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC, m.id DESC LIMIT 1) <> 'staff'
      AND NOT EXISTS (
        SELECT 1 FROM public.message_conversation_visibility visibility
        WHERE visibility.profile_id = v_me
          AND visibility.conversation_id = c.id
          AND visibility.archived_at >= c.last_message_at
      )
  );
END;
$$;

COMMENT ON FUNCTION public.messages_staff_needs_reply_count() IS
  'Counts active, non-resolved conversations whose latest message is portal-authored. Per-staff archive visibility is honored; read pointers are irrelevant.';
REVOKE ALL ON FUNCTION public.messages_staff_needs_reply_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_staff_needs_reply_count()
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
