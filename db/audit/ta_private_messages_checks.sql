-- db/audit/ta_private_messages_checks.sql
-- TA-MESSAGES-1: read-only checks for supabase/migrations/20261114000000_ta_private_messages.sql.
-- Run PRE before applying, POST after. Every statement is a SELECT.

-- ============================== PRE ==============================
-- PRE 1. The column does not exist yet (expect: false).
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'visibility'
) AS visibility_exists;

-- PRE 2. The live functions are the ones the migration was written against (expect: every column true).
SELECT
  position('nursing_academic' in pg_get_functiondef('public.message_participant_can_read(uuid,uuid)'::regprocedure)) > 0
    AND position('talent_acquisition' in pg_get_functiondef('public.message_participant_can_read(uuid,uuid)'::regprocedure)) = 0 AS can_read_as_expected,
  position('student_to_unit_leader_message' in pg_get_functiondef('public.message_assert_valid_delivery(jsonb,text,uuid)'::regprocedure)) > 0 AS validator_as_expected,
  position($q$IF p_actor_kind NOT IN ('student', 'staff', 'unit_leader', 'academic_partner') THEN$q$ in pg_get_functiondef('public.messages_post_reply(uuid,text,uuid,text,jsonb)'::regprocedure)) > 0 AS reply_as_expected,
  position($q$IF p_actor_kind NOT IN ('student', 'staff') THEN$q$ in pg_get_functiondef('public.messages_mark_read(uuid,text,uuid)'::regprocedure)) > 0 AS mark_read_as_expected,
  position('FROM public.conversations c WHERE c.id = p_conversation_id' in pg_get_functiondef('public.messages_staff_triage(uuid,uuid)'::regprocedure)) > 0 AS triage_as_expected,
  position('messages_staff_get_thread_v5' in pg_get_functiondef('public.messages_staff_get_thread_v6(uuid,integer,timestamptz,uuid)'::regprocedure)) > 0 AS thread_v6_as_expected;

-- PRE 3. How many existing unit leader to student direct threads become private (a count, no names).
SELECT count(*) AS direct_threads_to_make_private
FROM public.conversations c
WHERE (SELECT count(*) FROM public.conversation_participants cp WHERE cp.conversation_id = c.id) = 2
  AND EXISTS (SELECT 1 FROM public.conversation_participants cp WHERE cp.conversation_id = c.id AND cp.participant_role = 'unit_leader')
  AND EXISTS (SELECT 1 FROM public.conversation_participants cp WHERE cp.conversation_id = c.id AND cp.participant_role = 'student');

-- PRE 4. Every older staff version the migration revokes exists (expect: 10).
SELECT count(*) AS old_staff_versions_present FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN (
  'messages_staff_get_thread', 'messages_staff_get_thread_v2', 'messages_staff_get_thread_v3', 'messages_staff_get_thread_v4',
  'messages_staff_get_thread_v5', 'messages_staff_list_conversations', 'messages_staff_list_conversations_v2',
  'messages_staff_list_conversations_v3', 'messages_staff_list_conversations_v4', 'messages_staff_needs_reply_count');

-- ============================== POST ==============================
-- POST 1. The column, its rule, and the backfill (expect: true, then the PRE 3 count).
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'visibility') AS visibility_exists,
  (SELECT count(*) FROM public.conversations WHERE visibility = 'private') AS private_threads;

-- POST 2. Talent Acquisition is in the read rule, the start functions exist, and no client can call
-- an old staff version (expect: true, true, true, 0).
SELECT
  position('talent_acquisition' in pg_get_functiondef('public.message_participant_can_read(uuid,uuid)'::regprocedure)) > 0 AS can_read_has_ta,
  to_regprocedure('public.messages_start_private_conversation(uuid,text,uuid,text,text,text,jsonb)') IS NOT NULL AS private_start_exists,
  to_regprocedure('public.messages_start_general_team_conversation_ta(uuid,uuid,text,text,text,text,jsonb)') IS NOT NULL AS ta_team_start_exists,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('messages_staff_get_thread_v5', 'messages_staff_list_conversations_v4', 'messages_staff_needs_reply_count')
      AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE'))) AS old_versions_still_callable;

-- POST 3. The five write guards are installed (expect: 5).
SELECT count(*) AS private_guards FROM pg_trigger WHERE tgname LIKE 'trg_private_guard_%' AND NOT tgisinternal;

-- POST 4. The staff read policies hide private rows (expect: 4 rows, each mentioning private).
SELECT tablename, policyname, position('private' in qual) > 0 AS hides_private
FROM pg_policies
WHERE schemaname = 'public' AND policyname IN (
  'messages_conversations_staff_select', 'messages_participants_staff_select',
  'messages_messages_staff_select', 'messages_events_staff_select');
