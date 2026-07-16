-- ============================================================================
-- ASPIRE MESSAGES, PHASE 3 (STAGE A CORRECTIVE): READ-ONLY VERIFICATION QUERIES.
-- RUN ONLY AFTER THE MIGRATION HAS BEEN APPLIED.
-- ============================================================================
-- Companion to
-- supabase/migrations/20260716000003_messages_phase3_delivery_invariant_fix.sql.
--
-- HOW TO RUN: paste this ENTIRE file into the Supabase SQL editor and run it as
-- one block. Every statement is a SELECT against system catalogs. It changes
-- nothing and is safe against production at any time.
--
-- Expected high-level outcome: message_assert_valid_delivery() exists,
-- SECURITY DEFINER, fixed search_path, service-role only; the live definitions
-- of messages_start_conversation() and messages_post_reply() no longer contain
-- the optional delivery guard or ON CONFLICT DO NOTHING, DO call
-- message_assert_valid_delivery(), DO assert a non-null delivery_id, and DO
-- raise MS409 on a unique violation; both keep their authorization checks, the
-- 5000-character limit, sender-only read pointers, and the reopened event; and
-- the applied 00002 grants are unchanged (service-role only).
-- ============================================================================

-- 1. The validation helper exists, is SECURITY DEFINER, and has a fixed
--    search_path. Expect one row, security_definer = true.
SELECT p.proname AS function_name,
       p.prosecdef AS security_definer,
       p.proconfig AS config_settings,
       pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'message_assert_valid_delivery';

-- 2. Grants: the helper and both corrected RPCs are EXECUTE-granted to
--    service_role ONLY. anon and authenticated must NOT appear.
SELECT routine_name, grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public'
  AND routine_name IN (
    'message_assert_valid_delivery', 'messages_start_conversation', 'messages_post_reply'
  )
ORDER BY routine_name, grantee;

-- 3. Guard: neither anon nor authenticated may EXECUTE the corrected write RPCs
--    or the validation helper. Expect ZERO rows.
SELECT p.proname AS function_name, r.rolname AS role
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN (SELECT unnest(ARRAY['anon', 'authenticated']) AS rolname) r
WHERE n.nspname = 'public'
  AND p.proname IN ('message_assert_valid_delivery', 'messages_start_conversation', 'messages_post_reply')
  AND has_function_privilege(r.rolname, p.oid, 'EXECUTE');

-- 4. THE CORE INVARIANT GUARD. Neither corrected RPC may still contain the
--    optional-delivery guard or a silent conflict skip. Expect ZERO rows.
SELECT p.proname AS function_name, 'still permits a message without a delivery row' AS finding
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('messages_start_conversation', 'messages_post_reply')
  AND (
    pg_get_functiondef(p.oid) ~ 'ON CONFLICT \(idempotency_key\) DO NOTHING'
    OR pg_get_functiondef(p.oid) ~ 'p_delivery IS NOT NULL AND p_delivery \?'
  );

-- 5. THE POSITIVE INVARIANT GUARD. Both corrected RPCs must validate the
--    delivery payload, assert a non-null delivery_id, and raise MS409 on a
--    duplicate. Expect ZERO rows (any row names a function missing a control).
SELECT p.proname AS function_name, 'missing a required delivery control' AS finding
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('messages_start_conversation', 'messages_post_reply')
  AND NOT (
    pg_get_functiondef(p.oid) ~ 'message_assert_valid_delivery'
    AND pg_get_functiondef(p.oid) ~ 'v_delivery_id IS NULL'
    AND pg_get_functiondef(p.oid) ~ 'unique_violation'
    AND pg_get_functiondef(p.oid) ~ 'MS409'
  );

-- 6. Preserved behavior guard. Both corrected RPCs must still enforce the
--    5000-character limit, the authorization checks, sender-only read pointers,
--    and (for reply) the reopened event. Expect ZERO rows.
SELECT p.proname AS function_name, 'lost a preserved control' AS finding
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('messages_start_conversation', 'messages_post_reply')
  AND NOT (
    pg_get_functiondef(p.oid) ~ '5000'
    AND pg_get_functiondef(p.oid) ~ 'message_profile_is_active_owner_or_admin'
    AND pg_get_functiondef(p.oid) ~ '(participant|staff)_conversation_reads'
  );

SELECT 'messages_post_reply' AS function_name, 'lost reopen handling' AS finding
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_post_reply'
  AND NOT (pg_get_functiondef(p.oid) ~ 'reopened' AND pg_get_functiondef(p.oid) ~ 'resolved_at = NULL');

-- 7. Guard: no body-like field may be persisted to a delivery row. The helper
--    must reject content keys. Expect ONE row (the helper carries the guard).
SELECT p.proname AS function_name
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'message_assert_valid_delivery'
  AND pg_get_functiondef(p.oid) ~ 'may not contain message content';

-- 8. Full corrected definitions for inspection. Confirm the delivery insert has
--    no ON CONFLICT, is wrapped in a unique_violation handler that raises MS409,
--    and is followed by the non-null delivery_id assertion.
SELECT pg_get_functiondef(p.oid) AS start_conversation_definition
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_start_conversation';

SELECT pg_get_functiondef(p.oid) AS post_reply_definition
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_post_reply';

SELECT pg_get_functiondef(p.oid) AS assert_valid_delivery_definition
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'message_assert_valid_delivery';

-- 9. Guard: the corrective migration created no table and no policy. Expect the
--    same eight ASPIRE Messages tables as before (message_archive is a
--    PRE-EXISTING, UNRELATED Outreach sent-history table created by
--    20260625000000_message_archive.sql; it is intentionally excluded here).
SELECT c.relname AS table_name
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND c.relname IN (
    'conversations', 'conversation_participants', 'messages',
    'staff_conversation_reads', 'participant_conversation_reads',
    'conversation_events', 'message_notification_deliveries',
    'message_rate_limit_counters'
  )
ORDER BY c.relname;

-- 10. Guard: the unique idempotency constraint is intact and unchanged.
--     Expect one row.
SELECT con.conname AS constraint_name, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND rel.relname = 'message_notification_deliveries'
  AND con.contype = 'u';
