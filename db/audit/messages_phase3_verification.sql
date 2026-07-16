-- ============================================================================
-- ASPIRE MESSAGES, PHASE 3 (STAGE A): READ-ONLY VERIFICATION QUERIES.
-- RUN ONLY AFTER THE MIGRATION HAS BEEN APPLIED.
-- ============================================================================
-- Companion to
-- supabase/migrations/20260716000002_messages_phase3_api_foundation.sql.
--
-- HOW TO RUN: paste this ENTIRE file into the Supabase SQL editor and run it as
-- one block. Every statement is a SELECT against system catalogs. It changes
-- nothing and is safe against production at any time.
--
-- Expected high-level outcome: conversation_events accepts 'category_change'
-- plus the seven original event types; the two explicit-profile helpers and the
-- seven transactional write RPCs exist, are SECURITY DEFINER with a fixed
-- search_path, and are EXECUTE-granted to service_role ONLY; the six
-- authenticated read RPCs exist, are SECURITY DEFINER with a fixed search_path,
-- and are granted to authenticated and service_role but never anon or PUBLIC;
-- no new table or portal base-table policy was created; is_staff() is used
-- nowhere; no function authorizes through related context or assignment.
-- ============================================================================

-- 1. conversation_events event_type now includes category_change (and keeps all
--    seven original values). Expect one row whose definition lists 8 values.
SELECT con.conname AS constraint_name, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND rel.relname = 'conversation_events'
  AND con.conname = 'chk_conversation_events_type';

-- 2. All Phase 3 functions exist, are SECURITY DEFINER (except the pure label
--    mapper), and carry the fixed search_path. Expect 15 rows.
SELECT p.proname AS function_name,
       p.prosecdef AS security_definer,
       p.provolatile AS volatility,
       p.proconfig AS config_settings,
       pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'message_profile_is_active_owner_or_admin',
    'message_profile_has_active_student_link',
    'messages_start_conversation',
    'messages_post_reply',
    'messages_mark_read',
    'messages_set_assignment',
    'messages_set_status',
    'messages_set_category',
    'messages_set_follow_up',
    'message_portal_status_label',
    'messages_portal_list_conversations',
    'messages_portal_get_thread',
    'messages_portal_unread_count',
    'messages_staff_list_conversations',
    'messages_staff_get_thread',
    'messages_staff_unread_count'
  )
ORDER BY p.proname;

-- 3. EXECUTE grants for every Phase 3 function. Confirm: the write RPCs and the
--    two explicit-profile helpers are service_role ONLY; the read RPCs are
--    authenticated + service_role; anon and PUBLIC appear nowhere.
SELECT routine_name, grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public'
  AND routine_name IN (
    'message_profile_is_active_owner_or_admin',
    'message_profile_has_active_student_link',
    'messages_start_conversation', 'messages_post_reply', 'messages_mark_read',
    'messages_set_assignment', 'messages_set_status', 'messages_set_category',
    'messages_set_follow_up', 'message_portal_status_label',
    'messages_portal_list_conversations', 'messages_portal_get_thread',
    'messages_portal_unread_count', 'messages_staff_list_conversations',
    'messages_staff_get_thread', 'messages_staff_unread_count'
  )
ORDER BY routine_name, grantee;

-- 4. Guard: anon holds NO EXECUTE on any Phase 3 function. Expect ZERO rows.
SELECT p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE 'messages\_%' ESCAPE '\'
  AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- 5. Guard: authenticated holds NO EXECUTE on any TRANSACTIONAL WRITE RPC or
--    explicit-profile helper (those are service-role only). Expect ZERO rows.
SELECT p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'message_profile_is_active_owner_or_admin',
    'message_profile_has_active_student_link',
    'messages_start_conversation', 'messages_post_reply', 'messages_mark_read',
    'messages_set_assignment', 'messages_set_status', 'messages_set_category',
    'messages_set_follow_up'
  )
  AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

-- 6. Guard: no Phase 3 function references is_staff(). Expect ZERO rows.
SELECT p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (p.proname LIKE 'messages\_%' ESCAPE '\' OR p.proname LIKE 'message\_%' ESCAPE '\')
  AND pg_get_functiondef(p.oid) ~ 'is_staff';

-- 7. INSPECTION (not a zero-row guard). Lists every Phase 3 function whose
--    definition MENTIONS related context or assignment, so each reference can be
--    confirmed as a projection, a filter, or a write, and never an authorization
--    gate. related_* and assigned_staff_profile_id may be selected for display,
--    filtered on by an already-authorized staff caller, or written; they must
--    never gate access.
--
--    EXPECTED: exactly these four rows, all reviewed and correct:
--      - messages_start_conversation      writes related_student_id as context
--                                         metadata on INSERT (not a gate).
--      - messages_set_assignment          reads the prior assignee for the audit
--                                         event and UPDATEs it (not a gate).
--      - messages_staff_list_conversations projects assignee/related_student_id
--                                         and uses p_assignee as a caller FILTER
--                                         that narrows an already-authorized set.
--      - messages_staff_get_thread        projects assignee name,
--                                         related_student_id, related_cohort_id.
--    Authorization in all four is message_profile_is_active_owner_or_admin(),
--    is_active_owner_or_admin(), or message_profile_has_active_student_link().
--    Any OTHER function appearing here, or any related_*/assigned_staff
--    reference used as an access predicate, is a defect.
SELECT p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE 'messages\_%' ESCAPE '\'
  AND pg_get_functiondef(p.oid) ~ '(related_student_id|related_unit_key|related_school_key|related_cohort_id|assigned_staff_profile_id)'
ORDER BY p.proname;

-- 8. Full definitions of the two transactional write RPCs. Confirm by
--    inspection: authorization is re-validated from the passed profile id;
--    a student may only start their own conversation; staff must be an active
--    owner/admin; the participant must hold active student access; the
--    conversation, participant, message, created event, SENDER-ONLY read
--    pointer, and queued delivery are created together; the recipient's read
--    pointer is never advanced.
SELECT pg_get_functiondef(p.oid) AS start_conversation_definition
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_start_conversation';

SELECT pg_get_functiondef(p.oid) AS post_reply_definition
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_post_reply';

-- 9. Guard: no NEW table was created by Phase 3. Expect exactly the eight known
--    ASPIRE Messages tables (six from Phase 1, two from Phase 2), listed
--    explicitly.
--
--    NOTE on message_archive: an earlier version of this query used the pattern
--    LIKE 'message%', which also matched public.message_archive and made the
--    result look like nine Messages tables. message_archive is NOT part of
--    ASPIRE Messages. It PRE-EXISTS Phase 3: it was created on 2026-06-25 by
--    supabase/migrations/20260625000000_message_archive.sql (SENT-HISTORY-PHASE2A)
--    and stores redacted rendered bodies of manual ASPIRE Connect Outreach
--    emails, one row per notification_log row (FK to notification_log(id)),
--    RLS-enabled with no policies and service-role writes. Neither Phase 3
--    migration created, modified, or references it. It is intentionally excluded
--    from this inventory and must not be modified or deleted.
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

-- 10. Guard: NO portal base-table SELECT policy was added. Policies on the six
--     Phase 1 tables must still be only the active Owner/Admin staff ones.
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

-- 11. Guard: base-table privileges are unchanged (authenticated SELECT only, no
--     mutation; service_role never DELETE/TRUNCATE on the record tables).
--     Expect ZERO rows.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'conversations', 'conversation_participants', 'messages',
    'conversation_events', 'message_notification_deliveries'
  )
  AND (
    (grantee = 'authenticated' AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'))
    OR (grantee = 'anon')
    OR (privilege_type = 'TRUNCATE')
    OR (grantee = 'service_role' AND table_name IN ('messages', 'conversation_events', 'message_notification_deliveries')
        AND privilege_type = 'DELETE')
  );
