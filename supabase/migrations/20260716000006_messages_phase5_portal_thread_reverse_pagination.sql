-- ASPIRE MESSAGES, PHASE 5A: STUDENT PORTAL THREAD REVERSE PAGINATION
--
-- The applied messages_portal_get_thread pages FORWARD from the OLDEST message:
-- it selects WHERE (created_at, id) > cursor ORDER BY created_at, id LIMIT n. A
-- student opening a long thread therefore lands on the first message ever sent
-- and has no way to reach the newest one, which is the message they were
-- notified about. "Load earlier messages" is not expressible against it.
--
-- This migration adds a distinctly named v2 that opens at the NEWEST messages
-- and pages BACKWARD, mirroring messages_staff_get_thread_v2 (migration
-- 20260716000005) so both sides of a conversation share one pagination model.
--
-- The original function is left exactly as applied. It stays callable for
-- rollback until the v2 integration is verified in production. This migration
-- creates no table, no policy, alters no data, and weakens no RLS.
--
-- Authorization is UNCHANGED from v1: active student participation only, via
-- public.my_message_conversation_ids(). No staff helper is used. Staff access
-- and portal access remain separate code paths.

BEGIN;

-- ── 1. Portal: read one thread, newest page first, paging backward ──────────
CREATE OR REPLACE FUNCTION public.messages_portal_get_thread_v2(
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
  -- ONLY from active student participation in this specific conversation.
  -- my_message_conversation_ids() requires an unremoved student participant row,
  -- a live student role grant, and an active student link matching the
  -- participant scope. Related staff assignment, subject, school, cohort, unit,
  -- placement, notification recipient, matching email, and student_id alone
  -- grant nothing here, and no staff helper is consulted.
  IF v_me IS NULL OR p_conversation_id NOT IN (SELECT public.my_message_conversation_ids()) THEN
    RETURN NULL;
  END IF;

  -- Conversation projection is byte-identical to v1: the student sees a coarse
  -- status label rather than the staff workflow status, and never an assignee,
  -- a flag, an internal note, or any email address.
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
        -- Author projection is byte-identical to v1. Staff are labeled as the
        -- team, with an optional staff display name and never a staff email.
        'author_type',  CASE WHEN p.author_role = 'staff' THEN 'staff' ELSE 'me' END,
        'author_label', CASE WHEN p.author_role = 'staff' THEN 'ASPIRE Team' ELSE 'You' END,
        'author_name',  CASE WHEN p.author_role = 'staff'
          THEN (SELECT up.full_name FROM public.user_profiles up WHERE up.id = p.author_profile_id)
          ELSE NULL END
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

COMMENT ON FUNCTION public.messages_portal_get_thread_v2(uuid, integer, timestamptz, uuid) IS
'ASPIRE Messages Phase 5A. Reads one conversation thread for the authenticated
student, newest page first, paging backward through history.

Pagination. With no cursor, returns the newest p_limit messages. With a cursor,
returns the newest p_limit messages strictly older than it. Each page is selected
in descending (created_at, id) order under LIMIT, then returned in ascending
chronological order, so the newest page opens first and each page still reads top
to bottom. next_cursor is the oldest message of the page returned, and is null
when no older history remains. There is no offset pagination and no unbounded
full-thread retrieval.

Deterministic ordering. The (created_at, id) tuple cursor uses the message id as
a tie-breaker, so messages sharing a timestamp are returned exactly once across
pages, with no duplicate and no skipped row.

Bounded page size. p_limit defaults to 50 and is clamped to between 1 and 100, so
zero, negative, and excessive values cannot produce an unbounded read.

Authorization boundary. Active student participation only, resolved through
portal_profile_id() and my_message_conversation_ids(). An inaccessible
conversation returns NULL exactly like a missing one, so ids cannot be probed. No
staff authorization helper is consulted; staff access and portal access are
separate paths. Matching email, student_id alone, school, cohort, unit,
placement, preceptor relationship, staff assignment, conversation subject, and
notification recipient grant nothing.

Supersedes messages_portal_get_thread, which pages forward from the oldest
message and is retained for rollback.';

-- ── 2. Function privileges (Wave F-1 conventions) ───────────────────────────
-- Read RPC: authenticated callers (caller-scoped inside) plus service_role.
-- No anonymous access. No direct table access is granted, and service_role is
-- not the normal portal read path: the endpoint calls this as the signed-in
-- user so the caller is resolved from their own JWT.
REVOKE ALL ON FUNCTION public.messages_portal_get_thread_v2(uuid, integer, timestamptz, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_portal_get_thread_v2(uuid, integer, timestamptz, uuid)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Read-only verification is intentionally NOT included here. After applying this
-- migration, run db/audit/messages_phase5_portal_thread_reverse_pagination_verification.sql
-- (system-catalog SELECTs and function-source assertions only).
