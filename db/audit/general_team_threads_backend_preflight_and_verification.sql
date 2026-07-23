-- ============================================================================
-- GENERAL ASPIRE TEAM THREADS BACKEND: READ-ONLY PREFLIGHT AND VERIFICATION
-- ============================================================================
-- Run this file manually in Supabase SQL editor.
--
-- Before applying 20260724000001_general_team_threads_backend.sql:
--   - every "required prior object" row should be present
--   - message_creation_requests should be absent
--
-- After applying the migration:
--   - message_creation_requests should be present
--   - the unique actor/operation/request constraint should be present
--   - the new RPC should be SECURITY DEFINER, service-role-only
--   - participant scope checks should allow null-context student and unit_leader rows
--   - no execute grant should be present for anon/authenticated on the write RPC
--
-- This file is read-only. It does not execute the migration and does not write
-- application data.
-- ============================================================================

-- 1. Required prior objects.
SELECT
  'required prior object' AS check_name,
  required.object_name,
  to_regclass(required.object_name) IS NOT NULL AS present
FROM (VALUES
  ('public.conversations'),
  ('public.conversation_participants'),
  ('public.messages'),
  ('public.message_notification_deliveries'),
  ('public.message_rate_limit_counters')
) AS required(object_name)
ORDER BY required.object_name;

-- 2. New ledger presence.
SELECT
  'message_creation_requests table' AS check_name,
  to_regclass('public.message_creation_requests') IS NOT NULL AS present;

-- 3. Ledger constraints and indexes.
SELECT
  conname,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.message_creation_requests'::regclass
ORDER BY conname;

-- 4. New and replaced functions.
SELECT
  p.proname,
  p.prosecdef AS security_definer,
  pg_get_function_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS result_type,
  array_to_string(p.proconfig, ',') AS config
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'message_profile_has_active_student_portal',
    'message_profile_has_active_unit_leader_portal_scope',
    'message_participant_can_read',
    'message_participant_can_send',
    'messages_start_general_team_conversation'
  )
ORDER BY p.proname;

-- 5. Function grants. The write RPC and helpers should not be executable by anon
-- or authenticated.
SELECT
  routine_name,
  grantee,
  privilege_type
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public'
  AND routine_name IN (
    'message_profile_has_active_student_portal',
    'message_profile_has_active_unit_leader_portal_scope',
    'message_participant_can_read',
    'message_participant_can_send',
    'messages_start_general_team_conversation'
  )
ORDER BY routine_name, grantee;

-- 6. Participant shape constraint. Confirm it permits null context for general
-- student and unit_leader rows while preserving the named role branches.
SELECT
  conname,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.conversation_participants'::regclass
  AND conname = 'chk_participant_role_scope';

-- 7. Ledger table grants. anon/authenticated should have no direct privileges.
SELECT
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'message_creation_requests'
ORDER BY grantee, privilege_type;

-- 8. RLS posture.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS force_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'message_creation_requests';
