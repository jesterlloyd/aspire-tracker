-- Read-only verification for 20261014000000_messages_simplify.sql
-- (MESSAGES-SIMPLIFY-1). Every section is SELECT-only. Run PRE 1 before
-- applying, the POST sections after. Run one section at a time.

-- PRE 1: one reaction per person per message is already enforced. Expect one
-- row: message_reactions_pkey, PRIMARY KEY (message_id, profile_id). If it is
-- there, no unique constraint needs to be added (the migration adds none).
SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' AND t.relname = 'message_reactions' AND c.contype IN ('p', 'u');

-- PRE 2: no conflicting reaction data. Expect 0.
SELECT count(*) AS duplicate_person_message_reactions
FROM (
  SELECT message_id, profile_id FROM public.message_reactions
  GROUP BY message_id, profile_id HAVING count(*) > 1
) d;

-- PRE 3: reactions that the new who-may-react rule would refuse, for the
-- record only (they stay; removing one is always allowed). Expect a small
-- number or 0: staff reactions on staff messages, and participant reactions on
-- participant messages.
SELECT
  count(*) FILTER (WHERE m.author_role = 'staff' AND cp.participant_profile_id IS NULL) AS staff_on_staff,
  count(*) FILTER (WHERE m.author_role <> 'staff' AND cp.participant_profile_id IS NOT NULL) AS participant_on_participant
FROM public.message_reactions mr
JOIN public.messages m ON m.id = mr.message_id
LEFT JOIN public.conversation_participants cp
  ON cp.conversation_id = m.conversation_id AND cp.participant_profile_id = mr.profile_id;

-- PRE 4: what Done will mean on day one. Resolved threads become Done for
-- everyone; personally archived open threads are Done only for the person who
-- archived them. For the record.
SELECT
  count(*) FILTER (WHERE c.status = 'resolved') AS resolved_become_done,
  count(*) FILTER (WHERE c.status <> 'resolved' AND EXISTS (
    SELECT 1 FROM public.message_conversation_visibility v
    WHERE v.conversation_id = c.id AND v.archived_at >= c.last_message_at
  )) AS open_but_archived_by_someone,
  count(*) FILTER (WHERE c.status = 'waiting') AS waiting_now_counts_as_open
FROM public.conversations c;

-- POST 1: the four functions exist, are SECURITY DEFINER, and pin search_path.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer, p.provolatile AS volatility, p.proconfig AS configuration
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'messages_staff_triage',
    'messages_staff_list_conversations_v5',
    'messages_staff_needs_reply_count_v2',
    'messages_staff_get_thread_v5'
  )
ORDER BY p.proname;

-- POST 2: grants. messages_staff_triage: service_role only. The other three:
-- authenticated and service_role. anon and PUBLIC: none. Expect every
-- `ok` to be true.
SELECT f.proname, f.grantee, f.has_execute,
  CASE
    WHEN f.grantee IN ('anon', 'public') THEN NOT f.has_execute
    WHEN f.proname = 'messages_staff_triage' AND f.grantee = 'authenticated' THEN NOT f.has_execute
    ELSE f.has_execute
  END AS ok
FROM (
  SELECT p.proname, g.grantee,
         has_function_privilege(g.grantee, p.oid, 'EXECUTE') AS has_execute
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) g(grantee)
  WHERE n.nspname = 'public'
    AND p.proname IN ('messages_staff_triage', 'messages_staff_list_conversations_v5',
                      'messages_staff_needs_reply_count_v2', 'messages_staff_get_thread_v5')
) f
ORDER BY f.proname, f.grantee;

-- POST 3: the rule, applied to every thread, as the Owner's own profile.
-- Replace the uuid with your user_profiles.id. Expect needs_reply to match
-- what you would say by reading each thread; the three totals are the chips.
SELECT
  count(*) FILTER (WHERE t.needs_reply) AS needs_reply,
  count(*) FILTER (WHERE NOT t.is_done) AS all_open,
  count(*) FILTER (WHERE t.is_done) AS done
FROM public.conversations c
CROSS JOIN LATERAL public.messages_staff_triage(c.id, '00000000-0000-0000-0000-000000000000'::uuid) t;

-- POST 4: who handled what. One row per open thread, newest first.
SELECT c.subject, t.needs_reply, t.latest_author_role, t.handled_by_name, t.handled_at
FROM public.conversations c
CROSS JOIN LATERAL public.messages_staff_triage(c.id, '00000000-0000-0000-0000-000000000000'::uuid) t
WHERE NOT t.is_done
ORDER BY c.last_message_at DESC
LIMIT 25;
