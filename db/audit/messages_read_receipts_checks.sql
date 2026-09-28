-- Read-only verification for 20261015000000_messages_read_receipts.sql
-- (MESSAGES-RECEIPTS-1). Every section is SELECT-only. Run one at a time.

-- PRE 1: the email notices the Delivered state reads. For the record: how many
-- message emails Resend has confirmed, and how many are still just "sent".
SELECT provider_status, count(*) FROM public.message_notification_deliveries
GROUP BY provider_status ORDER BY provider_status NULLS FIRST;

-- POST 1: the three functions exist, are SECURITY DEFINER, and pin search_path.
SELECT p.proname, p.prosecdef AS security_definer, p.proconfig AS configuration
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('messages_receipt_state', 'messages_staff_get_thread_v6', 'messages_portal_get_thread_v5')
ORDER BY p.proname;

-- POST 2: grants. messages_receipt_state: service_role only. The two thread
-- readers: authenticated and service_role. anon: none. Expect every ok true.
SELECT f.proname, f.grantee, f.has_execute,
  CASE
    WHEN f.grantee = 'anon' THEN NOT f.has_execute
    WHEN f.proname = 'messages_receipt_state' AND f.grantee = 'authenticated' THEN NOT f.has_execute
    ELSE f.has_execute
  END AS ok
FROM (
  SELECT p.proname, g.grantee, has_function_privilege(g.grantee, p.oid, 'EXECUTE') AS has_execute
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) g(grantee)
  WHERE n.nspname = 'public'
    AND p.proname IN ('messages_receipt_state', 'messages_staff_get_thread_v6', 'messages_portal_get_thread_v5')
) f
ORDER BY f.proname, f.grantee;

-- POST 3: the receipt staff will see on each thread whose latest message is a
-- staff message, newest first. Expect read where the student has opened it,
-- delivered where only the email arrived, sent otherwise.
SELECT c.subject, (public.messages_receipt_state(c.id, 'staff', NULL))->>'state' AS staff_sees
FROM public.conversations c
WHERE public.messages_receipt_state(c.id, 'staff', NULL) IS NOT NULL
ORDER BY c.last_message_at DESC
LIMIT 25;
