-- ============================================================================
-- ASPIRE MESSAGES, PHASE 4B (STAGE A): READ-ONLY VERIFICATION QUERIES.
-- RUN ONLY AFTER THE MIGRATION HAS BEEN APPLIED.
-- ============================================================================
-- Companion to
-- supabase/migrations/20260716000004_messages_phase4_staff_inbox_filter_modes.sql.
--
-- HOW TO RUN: paste this ENTIRE file into the Supabase SQL editor and run it as
-- one block. Every statement is a SELECT against system catalogs. It changes
-- nothing and is safe against production at any time.
--
-- Expected high-level outcome: messages_staff_list_conversations_v2 exists with
-- explicit assignee and category modes, is SECURITY DEFINER with a fixed
-- search_path, is executable by authenticated and service_role but never by anon
-- or PUBLIC, gates on is_active_owner_or_admin(), supports
-- assigned_staff_profile_id IS NULL and category IS NULL, never uses is_staff(),
-- never authorizes through assignment or related context, keeps the
-- last_message_at plus id cursor, and never searches message bodies. The original
-- Phase 3 function is still present and unchanged, exactly one function of that
-- base name exists (no ambiguous overload), and no table or policy was created.
-- ============================================================================

-- 1. The new function exists, with its full argument signature. Confirm the
--    signature includes p_assignee_mode and p_category_mode. Expect one row.
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer,
       p.provolatile AS volatility,
       p.proconfig AS config_settings
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'messages_staff_list_conversations_v2';

-- 2. Guard: the new function declares BOTH explicit mode parameters and the
--    separate assignee profile id. Expect ONE row.
SELECT p.proname AS function_name
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'messages_staff_list_conversations_v2'
  AND pg_get_function_identity_arguments(p.oid) ~ 'p_assignee_mode'
  AND pg_get_function_identity_arguments(p.oid) ~ 'p_category_mode'
  AND pg_get_function_identity_arguments(p.oid) ~ 'p_assignee_profile_id';

-- 3. Guard: SECURITY DEFINER and the fixed search_path are present.
--    Expect ONE row.
SELECT p.proname AS function_name
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'messages_staff_list_conversations_v2'
  AND p.prosecdef = true
  AND array_to_string(p.proconfig, ',') ~ 'search_path=public, pg_catalog';

-- 4. EXECUTE grants on the new function. Expect authenticated and service_role
--    only; anon and PUBLIC must NOT appear.
SELECT routine_name, grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public'
  AND routine_name = 'messages_staff_list_conversations_v2'
ORDER BY grantee;

-- 5. Guard: anon cannot execute the new function. Expect ZERO rows.
SELECT p.proname AS function_name
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'messages_staff_list_conversations_v2'
  AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- 6. Guard: authenticated CAN execute the new function. Expect ONE row.
SELECT p.proname AS function_name
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'messages_staff_list_conversations_v2'
  AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

-- 7. Guard: authorization, null-filter support, and safety, all in one check.
--    The definition must gate on is_active_owner_or_admin(), express both IS NULL
--    filters, keep the cursor, and never reference is_staff(). Expect ONE row.
SELECT p.proname AS function_name
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'messages_staff_list_conversations_v2'
  AND pg_get_functiondef(p.oid) ~ 'is_active_owner_or_admin'
  AND pg_get_functiondef(p.oid) ~ 'assigned_staff_profile_id IS NULL'
  AND pg_get_functiondef(p.oid) ~ 'c\.category IS NULL'
  AND pg_get_functiondef(p.oid) ~ 'last_message_at DESC, c\.id DESC'
  AND pg_get_functiondef(p.oid) !~ 'is_staff';

-- 8. Guard: no message-body search and no offset pagination. The only body read
--    is the approved 160-character latest preview. Expect ZERO rows.
SELECT p.proname AS function_name, 'unsafe search or pagination' AS finding
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'messages_staff_list_conversations_v2'
  AND (
    pg_get_functiondef(p.oid) ~ 'm\.body ILIKE'
    OR pg_get_functiondef(p.oid) ~ '\mOFFSET\M'
  );

-- 9. Full definition for inspection. Confirm by reading: assignment and related
--    context appear only as projections or filters and never as an access gate;
--    search is subject only; every filter is applied before LIMIT.
SELECT pg_get_functiondef(p.oid) AS v2_definition
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_staff_list_conversations_v2';

-- 10. The ORIGINAL Phase 3 function is still present and still uses the old
--     null-means-no-filter predicates (proof it was not modified or replaced).
--     Expect ONE row.
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'messages_staff_list_conversations'
  AND pg_get_functiondef(p.oid) ~ 'p_assignee IS NULL OR c\.assigned_staff_profile_id = p_assignee'
  AND pg_get_functiondef(p.oid) ~ 'p_category IS NULL OR c\.category = p_category';

-- 11. Guard: NO ambiguous overload. Exactly ONE function named
--     messages_staff_list_conversations must exist, and exactly ONE named
--     messages_staff_list_conversations_v2. Expect two rows, each count = 1.
SELECT p.proname AS function_name, count(*) AS overloads
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('messages_staff_list_conversations', 'messages_staff_list_conversations_v2')
GROUP BY p.proname
ORDER BY p.proname;

-- 12. Guard: the migration created no new table. Expect exactly the eight known
--     ASPIRE Messages tables. message_archive is a PRE-EXISTING, UNRELATED
--     Outreach sent-history table (created by 20260625000000_message_archive.sql)
--     and is intentionally excluded; it must not be modified.
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

-- 13. Guard: no new policy was created. Policies on the Messages tables must be
--     exactly the active Owner/Admin staff policies from Phase 1 and Phase 2.
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

-- 14. Guard: message_archive is untouched and still owned by its original
--     Outreach design (RLS enabled, no policies). Expect one row, rls = true,
--     and query 13 above shows no policy for it.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'message_archive';

-- 15. Guard: the Phase 1 through Phase 3 Messages functions are all still
--     present, proving this migration replaced none of them. Expect 17 rows.
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
    'messages_set_follow_up', 'messages_staff_get_thread', 'messages_staff_unread_count'
  )
ORDER BY p.proname;
