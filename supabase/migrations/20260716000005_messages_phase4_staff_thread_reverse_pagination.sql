-- ============================================================================
-- ASPIRE MESSAGES, PHASE 4B2A (STAGE A): staff thread reverse pagination
-- ============================================================================
-- Owner instructions: run this ENTIRE file as one block in the Supabase SQL
-- editor. It is ADDITIVE ONLY: one new read function. It creates no table, no
-- policy, and no data, changes no row, and modifies no existing function. All
-- five earlier Messages migrations are untouched.
--
-- WHY THIS EXISTS
-- The applied Phase 3 messages_staff_get_thread() paginates FORWARD from the
-- OLDEST message:
--     AND (p_cursor_ts IS NULL OR (m.created_at, m.id) > (p_cursor_ts, p_cursor_id))
--     ORDER BY m.created_at, m.id
--     LIMIT v_limit
-- The cursor is greater-than with an ascending order, so the first page is the
-- oldest messages and paging moves toward newer ones. That means:
--   - "Load earlier messages" is impossible: nothing is earlier than page one.
--   - Staff opening a long thread land on the oldest messages, not the newest
--     activity they opened the thread to read.
--   - messages_mark_read derives max(created_at) across the whole conversation,
--     so marking read after only the oldest page rendered would mark newer
--     messages read that were never displayed.
--
-- No safe bounded API workaround exists: reaching the newest page would require
-- either a reverse-ordered query or fetching/paging the entire thread, which is
-- unbounded.
--
-- WHAT THIS ADDS
-- One new function with a DISTINCT name, messages_staff_get_thread_v2, that
-- opens at the NEWEST messages and pages BACKWARD through history:
--   - no cursor: select the newest p_limit rows
--   - with a cursor: select the newest p_limit rows STRICTLY OLDER than the
--     cursor, using (m.created_at, m.id) < (p_cursor_ts, p_cursor_id)
--   - in both cases the inner query orders DESC and applies LIMIT first, so the
--     thread is never fetched or aggregated unbounded, then the BOUNDED result is
--     reordered ASC for chronological display
--   - next_cursor identifies the OLDEST message in the returned page, so the next
--     request continues backward
--
-- A distinct name is deliberate. Overloading messages_staff_get_thread would make
-- PostgREST function resolution ambiguous, so the original is left exactly as
-- applied and remains fully backward compatible.
--
-- The conversation, message, and event response contract is reused verbatim from
-- the applied Phase 3 definition. One field is added: has_more, which is true
-- when older history remains. It is additive and optional for callers.
--
-- READ-STATE SAFETY (behavior documented, nothing changed here)
-- messages_mark_read is NOT modified. The Phase 4B2a interface will open the
-- NEWEST page first and mark read only after that page successfully loads and
-- renders. Loading older pages must not trigger a further mark-read. Because the
-- newest activity is present in the initial rendered page, messages_mark_read may
-- continue deriving the authoritative latest timestamp server-side.
--
-- PORTAL THREAD (Phase 5 prerequisite, intentionally NOT touched here)
-- messages_portal_get_thread has the same oldest-first forward-cursor pattern and
-- is unsuitable for a portal thread view. A separate portal v2 thread RPC must be
-- created before the Student Portal Messages interface is built. Do not silently
-- reuse the forward-pagination contract in Phase 5.
--
-- Authorization is unchanged: an active Owner or Admin via
-- is_active_owner_or_admin(). is_staff() is never used (it also returns true for
-- interviewer and viewer). Assignment and related student, unit, school, or
-- cohort context are projections only, never authorization gates. The
-- three-identity model is preserved. An inaccessible or missing conversation
-- returns NULL, preserving the non-enumerating behavior.
--
-- SQLSTATE mapping (5 characters, matching the existing convention):
--   MS400 -> 422 validation, MS403 -> 403 forbidden.
--
-- This file is atomic (BEGIN/COMMIT) and idempotent (CREATE OR REPLACE only).
-- Read-only verification lives in
-- db/audit/messages_phase4_staff_thread_reverse_pagination_verification.sql.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.messages_staff_get_thread_v2(
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
        'author_name', (SELECT up.full_name FROM public.user_profiles up WHERE up.id = p.author_profile_id)
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

COMMENT ON FUNCTION public.messages_staff_get_thread_v2(uuid, integer, timestamptz, uuid) IS
  'Staff conversation thread that opens at the NEWEST messages and pages BACKWARD. The inner query orders created_at DESC, id DESC and applies LIMIT first (never aggregating the whole thread), then the bounded page is returned in chronological order. next_cursor identifies the OLDEST message of the page so the caller can load earlier history. Distinct name avoids PostgREST overload ambiguity; the Phase 3 messages_staff_get_thread remains unchanged for backward compatibility. Active Owner/Admin only via is_active_owner_or_admin(); is_staff() is never used. Assignment and related context are projections only, never authorization. An inaccessible conversation returns NULL (non-enumerating). Does not modify messages_mark_read: the interface opens the newest page and marks read only after that page renders.';

-- Read-RPC privilege convention (matches the Phase 3 and Phase 4 read RPCs).
REVOKE ALL ON FUNCTION public.messages_staff_get_thread_v2(uuid, integer, timestamptz, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_staff_get_thread_v2(uuid, integer, timestamptz, uuid)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Read-only verification is intentionally NOT included here. After applying, run
-- db/audit/messages_phase4_staff_thread_reverse_pagination_verification.sql.
