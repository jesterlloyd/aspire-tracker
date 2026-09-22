-- Read-only verification for 20260922000000_messages_refinement_triage_reactions.sql
-- Run after the Owner applies the migration. Every section is SELECT-only.

-- POST 1: one reaction total per person per message remains the primary key,
-- and the expanded allowlist contains all six refined keys.
SELECT
  c.conname,
  pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname = 'message_reactions'
  AND c.contype IN ('p', 'c')
ORDER BY c.contype DESC, c.conname;

-- POST 2: the new functions exist with pinned search paths and the expected
-- security mode. The two write/count RPCs and two thread wrappers are listed.
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS security_definer,
  p.provolatile AS volatility,
  p.proconfig AS configuration
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'messages_set_message_reaction_v2',
    'messages_staff_get_thread_v4',
    'messages_portal_get_thread_v4',
    'messages_staff_list_conversations_v4',
    'messages_staff_needs_reply_count'
  )
ORDER BY p.proname;

-- POST 3: privilege matrix. The reaction write RPC and needs-reply count are
-- service-role-only; authenticated may execute the list/thread read RPCs;
-- anon and PUBLIC must hold no execute grant on any new function.
SELECT
  p.proname,
  COALESCE(r.rolname, 'PUBLIC') AS grantee,
  x.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
LEFT JOIN pg_roles r ON r.oid = x.grantee
WHERE n.nspname = 'public'
  AND p.proname IN (
    'messages_set_message_reaction_v2',
    'messages_staff_get_thread_v4',
    'messages_portal_get_thread_v4',
    'messages_staff_list_conversations_v4',
    'messages_staff_needs_reply_count'
  )
ORDER BY p.proname, grantee;

-- POST 4: stored reactions all remain legal and the primary-key rule has no
-- duplicates. Both counts must be zero.
SELECT count(*) AS invalid_reaction_keys
FROM public.message_reactions
WHERE reaction_key NOT IN ('acknowledge', 'on_it', 'done', 'thanks', 'warm', 'celebrate');

SELECT count(*) AS duplicate_profile_message_reactions
FROM (
  SELECT message_id, profile_id
  FROM public.message_reactions
  GROUP BY message_id, profile_id
  HAVING count(*) > 1
) duplicates;

-- POST 5: reaction writes stay presentation-only. Every forbidden reference
-- must be false in the v2 setter definition.
SELECT
  position('last_message_at' IN lower(pg_get_functiondef(p.oid))) > 0 AS touches_last_message_at,
  position('staff_conversation_reads' IN lower(pg_get_functiondef(p.oid))) > 0 AS touches_staff_reads,
  position('portal_conversation_reads' IN lower(pg_get_functiondef(p.oid))) > 0 AS touches_portal_reads,
  position('conversation_events' IN lower(pg_get_functiondef(p.oid))) > 0 AS touches_events,
  position('message_notification_deliveries' IN lower(pg_get_functiondef(p.oid))) > 0 AS touches_deliveries
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'messages_set_message_reaction_v2';

-- POST 6: the list function contains sender search, latest-author direction,
-- attention modes, archive derivation, and full-set counts before pagination.
SELECT
  position('participant_name ilike' IN lower(pg_get_functiondef(p.oid))) > 0 AS sender_search,
  position('latest_author_role' IN lower(pg_get_functiondef(p.oid))) > 0 AS latest_author_direction,
  position('needs_reply' IN lower(pg_get_functiondef(p.oid))) > 0 AS needs_reply_mode,
  position('unassigned' IN lower(pg_get_functiondef(p.oid))) > 0 AS unassigned_mode,
  position('message_conversation_visibility' IN lower(pg_get_functiondef(p.oid))) > 0 AS archive_preserved,
  position('from source' IN lower(pg_get_functiondef(p.oid))) > 0 AS counts_before_page_limit
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'messages_staff_list_conversations_v4';
