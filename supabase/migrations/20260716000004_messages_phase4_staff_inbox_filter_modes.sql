-- ============================================================================
-- ASPIRE MESSAGES, PHASE 4B (STAGE A): staff inbox null-filter support
-- ============================================================================
-- Owner instructions: run this ENTIRE file as one block in the Supabase SQL
-- editor. It is ADDITIVE ONLY: one new read function. It creates no table, no
-- policy, and no data, changes no row, and modifies no existing function. All
-- four earlier Messages migrations are untouched.
--
-- WHY THIS EXISTS
-- The applied Phase 3 function messages_staff_list_conversations() filters with:
--     AND (p_assignee IS NULL OR c.assigned_staff_profile_id = p_assignee)
--     AND (p_category IS NULL OR c.category = p_category)
-- A null therefore means "no filter", so the function cannot distinguish
-- "no assignee filter" from "assigned_staff_profile_id IS NULL", nor "no category
-- filter" from "category IS NULL". The staff inbox needs Unassigned and
-- Uncategorized filters, and neither is expressible through that signature.
--
-- Client-side filtering of a partial cursor page was rejected: it would drop rows
-- from an already-limited server page and produce incorrect pagination and
-- incorrect counts. Phase 4A therefore omitted both options rather than ship a
-- control that silently returns wrong results.
--
-- WHAT THIS ADDS
-- One new function with a DISTINCT name, messages_staff_list_conversations_v2,
-- carrying explicit filter MODES so a null value is never ambiguous:
--   p_assignee_mode: any | unassigned | specific
--   p_category_mode: any | uncategorized | specific
--
-- A distinct name is deliberate. Creating an overloaded
-- messages_staff_list_conversations(...) would make PostgREST function
-- resolution ambiguous, so the original is left exactly as applied and remains
-- fully backward compatible for any existing caller.
--
-- The query body, ordering, return shape, authorization, unread calculation,
-- preview truncation, and search behavior are reused verbatim from the applied
-- Phase 3 definition. Only the assignee and category predicates change, plus
-- added validation. Search remains SUBJECT ONLY, exactly as the Phase 3 function
-- does today; message bodies are never searched.
--
-- Authorization is unchanged: an active Owner or Admin via
-- is_active_owner_or_admin(). is_staff() is never used (it also returns true for
-- interviewer and viewer). Assignment and related student, unit, school, or
-- cohort context are projections and filters only, never authorization gates.
-- The three-identity model is preserved: the caller is resolved through
-- portal_profile_id(), and no profile id is compared to auth.uid().
--
-- SQLSTATE mapping (5 characters, matching the Phase 3 convention):
--   MS400 -> 422 validation, MS403 -> 403 forbidden.
--
-- This file is atomic (BEGIN/COMMIT) and idempotent (CREATE OR REPLACE only).
-- Read-only verification lives in
-- db/audit/messages_phase4_staff_inbox_filter_modes_verification.sql.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.messages_staff_list_conversations_v2(
  p_limit               integer     DEFAULT 25,
  p_cursor_ts           timestamptz DEFAULT NULL,
  p_cursor_id           uuid        DEFAULT NULL,
  p_status              text        DEFAULT NULL,
  p_assignee_mode       text        DEFAULT 'any',
  p_assignee_profile_id uuid        DEFAULT NULL,
  p_category_mode       text        DEFAULT 'any',
  p_category            text        DEFAULT NULL,
  p_flagged             boolean     DEFAULT NULL,
  p_search              text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me       uuid    := public.portal_profile_id();
  v_limit    integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_amode    text    := COALESCE(p_assignee_mode, 'any');
  v_cmode    text    := COALESCE(p_category_mode, 'any');
  v_search   text    := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_category text    := NULLIF(btrim(COALESCE(p_category, '')), '');
  v_rows     jsonb;
BEGIN
  -- Authorization first: active Owner or Admin only.
  IF NOT public.is_active_owner_or_admin() THEN
    RAISE EXCEPTION 'staff access required' USING ERRCODE = 'MS403';
  END IF;

  -- Status: null means all; otherwise one of the three approved values.
  IF p_status IS NOT NULL AND p_status NOT IN ('open', 'waiting', 'resolved') THEN
    RAISE EXCEPTION 'invalid status' USING ERRCODE = 'MS400';
  END IF;

  -- Assignee mode. 'specific' requires a profile id; 'any' and 'unassigned'
  -- ignore it entirely. The future UI option Me is simply 'specific' with the
  -- server-verified current staff profile id, so no separate mode exists.
  IF v_amode NOT IN ('any', 'unassigned', 'specific') THEN
    RAISE EXCEPTION 'invalid assignee mode' USING ERRCODE = 'MS400';
  END IF;
  IF v_amode = 'specific' AND p_assignee_profile_id IS NULL THEN
    RAISE EXCEPTION 'specific assignee mode requires an assignee profile id' USING ERRCODE = 'MS400';
  END IF;

  -- Category mode. 'specific' requires one approved category.
  IF v_cmode NOT IN ('any', 'uncategorized', 'specific') THEN
    RAISE EXCEPTION 'invalid category mode' USING ERRCODE = 'MS400';
  END IF;
  IF v_cmode = 'specific' THEN
    IF v_category IS NULL THEN
      RAISE EXCEPTION 'specific category mode requires a category' USING ERRCODE = 'MS400';
    END IF;
    IF v_category NOT IN (
      'Placement and matching', 'Scheduling', 'Onboarding requirements',
      'Clinical rotation support', 'Preceptor support', 'Portal or account help',
      'General question'
    ) THEN
      RAISE EXCEPTION 'invalid category' USING ERRCODE = 'MS400';
    END IF;
  END IF;

  -- A cursor is both parts or neither. A partial cursor is rejected rather than
  -- silently returning an empty page (a null tie-breaker makes the row
  -- comparison null, which matches nothing).
  IF (p_cursor_ts IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'invalid cursor' USING ERRCODE = 'MS400';
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
    WHERE (p_status IS NULL OR c.status = p_status)
      -- Explicit assignee mode: 'unassigned' is now expressible.
      AND (
        v_amode = 'any'
        OR (v_amode = 'unassigned' AND c.assigned_staff_profile_id IS NULL)
        OR (v_amode = 'specific'   AND c.assigned_staff_profile_id = p_assignee_profile_id)
      )
      -- Explicit category mode: 'uncategorized' is now expressible.
      AND (
        v_cmode = 'any'
        OR (v_cmode = 'uncategorized' AND c.category IS NULL)
        OR (v_cmode = 'specific'      AND c.category = v_category)
      )
      AND (p_flagged IS NULL OR c.follow_up_flagged = p_flagged)
      -- Subject only, exactly as the applied Phase 3 function. Message bodies
      -- are never searched.
      AND (v_search IS NULL OR c.subject ILIKE '%' || v_search || '%')
      -- Stable cursor: every filter above is applied BEFORE the limit, so
      -- Unassigned and Uncategorized page correctly across the whole result set.
      AND (p_cursor_ts IS NULL OR (c.last_message_at, c.id) < (p_cursor_ts, p_cursor_id))
    ORDER BY c.last_message_at DESC, c.id DESC
    LIMIT v_limit
  ) r;

  RETURN jsonb_build_object('conversations', v_rows, 'limit', v_limit);
END;
$$;

COMMENT ON FUNCTION public.messages_staff_list_conversations_v2(integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text) IS
  'Staff conversation inbox with explicit assignee and category filter modes, so IS NULL is expressible (Unassigned, Uncategorized). Distinct name avoids PostgREST overload ambiguity; the Phase 3 messages_staff_list_conversations remains unchanged for backward compatibility. Active Owner/Admin only via is_active_owner_or_admin(); is_staff() is never used. Assignment and related context are projections and filters only, never authorization. Search covers subject only; message bodies are never searched. Ordering and cursor are unchanged: last_message_at desc with conversation id as tie-breaker.';

-- Read-RPC privilege convention (matches the Phase 3 read RPCs).
REVOKE ALL ON FUNCTION public.messages_staff_list_conversations_v2(integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_staff_list_conversations_v2(integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Read-only verification is intentionally NOT included here. After applying, run
-- db/audit/messages_phase4_staff_inbox_filter_modes_verification.sql.
