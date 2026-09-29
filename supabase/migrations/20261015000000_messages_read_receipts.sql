-- MESSAGES-RECEIPTS-1: Sent, Delivered, Read on the latest message.
-- Owner-gated. Apply this file whole, then run
-- db/audit/messages_read_receipts_checks.sql (read-only).
--
-- READ FUNCTIONS ONLY. No table, column, constraint, trigger, or row changes.
-- The earlier thread versions stay for rollback and the code-first fallback.
--
-- One receipt per thread, on its latest message, and only when that message is
-- the viewer's side's own (iMessage: a reply from the other side replaces it).
--   read       the other side opened the thread in ASPIRE after it was sent
--              (participant_conversation_reads for a staff message; any
--              staff_conversation_reads for a participant's message)
--   delivered  the email notice for that message reached the inbox (Resend's
--              delivered, opened or clicked on message_notification_deliveries)
--   sent       otherwise: saved in ASPIRE
-- The portal never learns WHICH staff member read, only that the team did.

BEGIN;

CREATE OR REPLACE FUNCTION public.messages_receipt_state(
  p_conversation_id uuid,
  p_side            text,
  p_viewer          uuid
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH latest AS (
    SELECT m.id, m.author_role, m.author_profile_id, m.created_at
    FROM public.messages m
    WHERE m.conversation_id = p_conversation_id
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ),
  mine AS (
    SELECT l.* FROM latest l
    WHERE (p_side = 'staff' AND l.author_role = 'staff')
       OR (p_side = 'portal' AND l.author_profile_id = p_viewer)
  )
  SELECT jsonb_build_object(
    'message_id', mine.id,
    'state', CASE
      WHEN (p_side = 'staff' AND EXISTS (
              SELECT 1 FROM public.participant_conversation_reads pr
              JOIN public.conversation_participants cp
                ON cp.conversation_id = pr.conversation_id
               AND cp.participant_profile_id = pr.participant_profile_id
               AND cp.removed_at IS NULL
              WHERE pr.conversation_id = p_conversation_id
                AND pr.last_read_at >= mine.created_at))
        OR (p_side = 'portal' AND EXISTS (
              SELECT 1 FROM public.staff_conversation_reads sr
              WHERE sr.conversation_id = p_conversation_id
                AND sr.last_read_at >= mine.created_at))
        THEN 'read'
      WHEN EXISTS (
              SELECT 1 FROM public.message_notification_deliveries d
              WHERE d.message_id = mine.id
                AND d.provider_status IN ('delivered', 'opened', 'clicked'))
        THEN 'delivered'
      ELSE 'sent'
    END
  )
  FROM mine;
$$;

COMMENT ON FUNCTION public.messages_receipt_state(uuid, text, uuid) IS
  'MESSAGES-RECEIPTS-1: {message_id, state} for the latest message when it is the viewer side''s own, else NULL. state is read | delivered | sent. Internal: called by the thread readers after they authorize.';
REVOKE ALL ON FUNCTION public.messages_receipt_state(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.messages_receipt_state(uuid, text, uuid) TO service_role;

-- Staff thread v6: v5 plus `receipt`. v5 authorizes.
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
  v_payload := public.messages_staff_get_thread_v5(p_conversation_id, p_limit, p_cursor_ts, p_cursor_id);
  IF v_payload IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_payload || jsonb_build_object(
    'receipt', public.messages_receipt_state(p_conversation_id, 'staff', public.portal_profile_id())
  );
END;
$$;

COMMENT ON FUNCTION public.messages_staff_get_thread_v6(uuid, integer, timestamptz, uuid) IS
  'MESSAGES-RECEIPTS-1: messages_staff_get_thread_v5 plus the receipt on the latest staff message.';
REVOKE ALL ON FUNCTION public.messages_staff_get_thread_v6(uuid, integer, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_staff_get_thread_v6(uuid, integer, timestamptz, uuid)
  TO authenticated, service_role;

-- Portal thread v5: v4 plus `receipt`. v4 authorizes (participation only, and
-- a non-participant gets NULL, so no receipt can leak).
CREATE OR REPLACE FUNCTION public.messages_portal_get_thread_v5(
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
  v_payload := public.messages_portal_get_thread_v4(p_conversation_id, p_limit, p_cursor_ts, p_cursor_id);
  IF v_payload IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_payload || jsonb_build_object(
    'receipt', public.messages_receipt_state(p_conversation_id, 'portal', public.portal_profile_id())
  );
END;
$$;

COMMENT ON FUNCTION public.messages_portal_get_thread_v5(uuid, integer, timestamptz, uuid) IS
  'MESSAGES-RECEIPTS-1: messages_portal_get_thread_v4 plus the receipt on the caller''s own latest message. Says only that the team read it, never who.';
REVOKE ALL ON FUNCTION public.messages_portal_get_thread_v5(uuid, integer, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_portal_get_thread_v5(uuid, integer, timestamptz, uuid)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
