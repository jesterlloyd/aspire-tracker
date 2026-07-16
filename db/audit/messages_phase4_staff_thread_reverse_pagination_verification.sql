-- ============================================================================
-- ASPIRE MESSAGES, PHASE 4B2A (STAGE A): READ-ONLY VERIFICATION QUERIES.
-- RUN ONLY AFTER THE MIGRATION HAS BEEN APPLIED.
-- ============================================================================
-- Companion to
-- supabase/migrations/20260716000005_messages_phase4_staff_thread_reverse_pagination.sql.
--
-- HOW TO RUN: paste this ENTIRE file into the Supabase SQL editor and run it as
-- one block. Every statement is a SELECT against system catalogs. It changes
-- nothing and is safe against production at any time.
--
-- Expected high-level outcome: messages_staff_get_thread_v2 exists, is SECURITY
-- DEFINER with a fixed search_path, is executable by authenticated and
-- service_role but never anon or PUBLIC, gates on is_active_owner_or_admin(),
-- never uses is_staff(), selects the newest rows with a DESC order and LIMIT
-- before returning them chronologically, pages backward with a less-than tuple
-- cursor, and never uses OFFSET or an unbounded full-thread fetch. The original
-- messages_staff_get_thread, messages_portal_get_thread, and messages_mark_read
-- are all still present and unchanged, exactly one function exists per name (no
-- ambiguous overload), and no table, policy, or data changed.
-- ============================================================================

-- 1. The new function exists with its full signature, SECURITY DEFINER, and the
--    fixed search_path. Expect ONE row, security_definer = true.
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer,
       p.provolatile AS volatility,
       p.proconfig AS config_settings
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_staff_get_thread_v2';

-- 2. Guard: the signature is the distinct expected one and the search_path is
--    fixed. Expect ONE row.
SELECT p.proname AS function_name
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'messages_staff_get_thread_v2'
  AND pg_get_function_identity_arguments(p.oid) = 'p_conversation_id uuid, p_limit integer, p_cursor_ts timestamp with time zone, p_cursor_id uuid'
  AND p.prosecdef = true
  AND array_to_string(p.proconfig, ',') ~ 'search_path=public, pg_catalog';

-- 3. EXECUTE grants. Expect authenticated and service_role only; anon and PUBLIC
--    must NOT appear.
SELECT routine_name, grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public'
  AND routine_name = 'messages_staff_get_thread_v2'
ORDER BY grantee;

-- 4. Guard: anon cannot execute. Expect ZERO rows.
SELECT p.proname AS function_name
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'messages_staff_get_thread_v2'
  AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- 5. Guard: authenticated CAN execute. Expect ONE row.
SELECT p.proname AS function_name
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'messages_staff_get_thread_v2'
  AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

-- 6. THE CORE PAGINATION GUARD. The live definition must: gate on
--    is_active_owner_or_admin(); select newest-first (created_at DESC, id DESC);
--    page backward with the less-than tuple cursor; return the bounded page
--    chronologically; reject a partial cursor; cap the limit at 100; and never
--    use is_staff() or OFFSET. Expect ONE row.
SELECT p.proname AS function_name
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'messages_staff_get_thread_v2'
  AND pg_get_functiondef(p.oid) ~ 'is_active_owner_or_admin'
  AND pg_get_functiondef(p.oid) ~ 'ORDER BY m\.created_at DESC, m\.id DESC'
  AND pg_get_functiondef(p.oid) ~ '\(m\.created_at, m\.id\) < \(p_cursor_ts, p_cursor_id\)'
  AND pg_get_functiondef(p.oid) ~ 'ORDER BY p\.created_at, p\.id'
  AND pg_get_functiondef(p.oid) ~ '\(p_cursor_ts IS NULL\) <> \(p_cursor_id IS NULL\)'
  AND pg_get_functiondef(p.oid) ~ 'LEAST\(GREATEST\(COALESCE\(p_limit, 50\), 1\), 100\)'
  AND pg_get_functiondef(p.oid) !~ 'is_staff'
  AND pg_get_functiondef(p.oid) !~ '\mOFFSET\M';

-- 7. Guard: the LIMIT is applied inside the newest-first page CTE, so the thread
--    is never aggregated unbounded before limiting. Expect ONE row.
SELECT p.proname AS function_name
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'messages_staff_get_thread_v2'
  AND pg_get_functiondef(p.oid) ~ 'ORDER BY m\.created_at DESC, m\.id DESC\s*\n\s*LIMIT v_limit';

-- 8. Guard: the backward cursor is built from created_at and id of the oldest
--    returned row, and non-enumerating NULL is preserved. Expect ONE row.
SELECT p.proname AS function_name
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'messages_staff_get_thread_v2'
  AND pg_get_functiondef(p.oid) ~ 'jsonb_build_object\(''cursor_ts'', v_oldest_ts, ''cursor_id'', v_oldest_id\)'
  AND pg_get_functiondef(p.oid) ~ 'IF v_conv IS NULL THEN\s*\n\s*RETURN NULL;';

-- 9. Guard: assignment and related context are never authorization gates. They
--    may appear only in the conversation projection. Inspect the definition in
--    query 12 and confirm every reference sits inside jsonb_build_object.
--    Expect ZERO rows (no related_* or assigned_staff inside an IF/WHERE gate).
SELECT p.proname AS function_name, 'context used as a gate' AS finding
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'messages_staff_get_thread_v2'
  AND pg_get_functiondef(p.oid) ~ '(IF|WHERE)[^;]*(related_student_id|related_unit_key|related_school_key|related_cohort_id|assigned_staff_profile_id)[^;]*(THEN|=)';

-- 10. Guard: the ORIGINAL staff thread RPC is still present and STILL uses the
--     old forward cursor (proof it was not modified or replaced). Expect ONE row.
SELECT p.proname AS function_name, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'messages_staff_get_thread'
  AND pg_get_functiondef(p.oid) ~ '\(m\.created_at, m\.id\) > \(p_cursor_ts, p_cursor_id\)'
  AND pg_get_functiondef(p.oid) ~ 'ORDER BY m\.created_at, m\.id';

-- 11. Guard: the PORTAL thread RPC and mark-read RPC are unchanged. The portal
--     function must still carry the forward cursor (its Phase 5 fix is
--     intentionally out of scope here), and mark-read must still derive its
--     timestamp server-side. Expect TWO rows.
SELECT p.proname AS function_name
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
    (p.proname = 'messages_portal_get_thread'
      AND pg_get_functiondef(p.oid) ~ '\(m\.created_at, m\.id\) > \(p_cursor_ts, p_cursor_id\)')
    OR (p.proname = 'messages_mark_read'
      AND pg_get_functiondef(p.oid) ~ 'COALESCE\(max\(m\.created_at\), now\(\)\)')
  )
ORDER BY p.proname;

-- 12. Full definition for inspection. Confirm by reading: the page CTE orders
--     DESC and LIMITs first; the returned array is ordered ascending; the oldest
--     CTE derives the backward cursor from the bounded page; has_more is a
--     bounded EXISTS; no OFFSET; no unbounded fetch.
SELECT pg_get_functiondef(p.oid) AS staff_thread_v2_definition
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_staff_get_thread_v2';

-- 13. Guard: NO ambiguous overload. Expect three rows, each count = 1.
SELECT p.proname AS function_name, count(*) AS overloads
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('messages_staff_get_thread', 'messages_staff_get_thread_v2', 'messages_portal_get_thread')
GROUP BY p.proname
ORDER BY p.proname;

-- 14. Guard: no portal v2 thread function was created here (Phase 5 work).
--     Expect ZERO rows.
SELECT p.proname AS function_name
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_portal_get_thread_v2';

-- 15. Guard: no new table. Expect exactly the eight known ASPIRE Messages
--     tables. message_archive is a PRE-EXISTING, UNRELATED Outreach
--     sent-history table and is intentionally excluded; it must not be modified.
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

-- 16. Guard: no new policy. Policies on the Messages tables must still be only
--     the active Owner/Admin staff policies from Phase 1 and Phase 2.
SELECT tablename, policyname, cmd, roles, qual AS using_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'conversations', 'conversation_participants', 'messages',
    'staff_conversation_reads', 'participant_conversation_reads',
    'conversation_events', 'message_notification_deliveries',
    'message_rate_limit_counters'
  )
ORDER BY tablename, policyname;

-- 17. Guard: message_archive is untouched (RLS enabled, and query 16 shows it
--     has no policy). Expect ONE row, rls_enabled = true.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'message_archive';

-- 18. Guard: every prior Messages function is still present, proving this
--     migration replaced none of them. Expect 19 rows.
SELECT p.proname AS function_name
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'is_active_owner_or_admin', 'my_message_conversation_ids',
    'claim_due_message_notification_deliveries', 'message_recipient_has_active_access',
    'consume_message_rate_limit', 'message_profile_is_active_owner_or_admin',
    'message_profile_has_active_student_link', 'message_assert_valid_delivery',
    'messages_start_conversation', 'messages_post_reply', 'messages_mark_read',
    'messages_set_assignment', 'messages_set_status', 'messages_set_category',
    'messages_set_follow_up', 'messages_staff_get_thread',
    'messages_staff_unread_count', 'messages_staff_list_conversations',
    'messages_staff_list_conversations_v2'
  )
ORDER BY p.proname;
