-- Checks for supabase/migrations/20260930000000_s15_unit_leader_thread_read_scope.sql
-- READ ONLY. Nothing here creates, alters, writes or deletes anything. No names or
-- emails are selected; rows are identified by id only.
--
-- Run each numbered section on its own in the Supabase SQL editor, in this order:
--   PRE 1 to PRE 5, then the migration as ONE block, then POST 1 to POST 6.
-- Keep the PRE 3, PRE 4 and PRE 5 result sets: POST 3, POST 4 and POST 5 are read
-- against them.
--
-- The rule being installed (the same rule message_participant_can_send already
-- applies): a unit_leader participant row is readable only while the profile holds an
-- ACTIVE user_unit_scopes row for the row's scope_unit_key; a row with NO unit key (a
-- general team thread) is readable only while the profile holds ANY active unit scope.
-- "Active" is revoked_at IS NULL, starts_at <= now(), expires_at NULL or in the future.

-- ── PRE 1: the predicates as they stand, and the helper the fix relies on ──────
-- Expect exactly 4 rows:
--   message_participant_can_read                     reads_unit_scopes FALSE
--   message_participant_can_send                     reads_unit_scopes TRUE, delegates_to_can_read TRUE
--   message_profile_has_active_unit_leader_portal_scope  present (any values)
--   my_message_conversation_ids                      delegates_to_can_read TRUE
-- STOP if message_profile_has_active_unit_leader_portal_scope is missing: the migration
-- calls it (it comes from 20260724000001). STOP if can_read already reads user_unit_scopes:
-- the migration or something like it has already run; go to POST 1.
SELECT p.proname,
       (p.prosrc ~* 'FROM[[:space:]]+public\.user_unit_scopes')   AS reads_unit_scopes,
       (p.prosrc ~* 'message_participant_can_read[[:space:]]*\(')  AS delegates_to_can_read
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('message_participant_can_read', 'message_participant_can_send',
                    'message_profile_has_active_unit_leader_portal_scope',
                    'my_message_conversation_ids')
ORDER BY p.proname;

-- ── PRE 2: can_read's attributes and grants, to be matched by POST 2 ──────────
-- Expect one row: security_definer true, stable true (provolatile 's'),
-- search_path {search_path=public, pg_catalog}, service_role true, authenticated false,
-- anon false, public false.
SELECT p.prosecdef                                   AS security_definer,
       p.provolatile = 's'                           AS stable,
       p.proconfig                                   AS search_path,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
       coalesce((SELECT bool_or(a.grantee = 0) FROM aclexplode(p.proacl) a), p.proacl IS NULL) AS public
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'message_participant_can_read'
  AND pg_get_function_identity_arguments(p.oid) = 'p_conversation_id uuid, p_profile_id uuid';

-- ── PRE 3: the exposure this migration closes ────────────────────────────────
-- Every unremoved unit_leader participant row, with whether the profile holds active
-- scope for it and whether can_read admits it TODAY.
-- Expect: any number of rows. Rows where has_active_scope = false AND can_read_now = true
-- are the threads a former Unit Leader can still read: the S-15 exposure. Note the
-- count; POST 3 must return zero such rows. Rows with has_active_scope = true must all
-- read can_read_now = true; if one does not, STOP, something other than scope is
-- blocking that Unit Leader (account inactive or grant lapsed) and the migration will
-- not change it.
SELECT cp.conversation_id,
       cp.participant_profile_id,
       cp.scope_unit_key,
       (cp.scope_student_id IS NOT NULL)                                AS has_student_context,
       CASE
         WHEN cp.scope_unit_key IS NOT NULL THEN EXISTS (
           SELECT 1 FROM public.user_unit_scopes s
           WHERE s.user_profile_id = cp.participant_profile_id
             AND s.unit_key = cp.scope_unit_key
             AND s.revoked_at IS NULL
             AND s.starts_at <= now()
             AND (s.expires_at IS NULL OR s.expires_at > now()))
         ELSE public.message_profile_has_active_unit_leader_portal_scope(cp.participant_profile_id)
       END                                                              AS has_active_scope,
       public.message_participant_can_read(cp.conversation_id, cp.participant_profile_id) AS can_read_now,
       public.message_participant_can_send(cp.conversation_id, cp.participant_profile_id) AS can_send_now
FROM public.conversation_participants cp
WHERE cp.participant_role = 'unit_leader'
  AND cp.removed_at IS NULL
ORDER BY has_active_scope, cp.conversation_id;

-- ── PRE 4: the other roles' baseline, to be matched exactly by POST 4 ────────
-- Expect: one row per role present (student, academic_partner, nursing_academic,
-- possibly preceptor), each with rows_unremoved and rows_readable. Record all numbers.
SELECT cp.participant_role,
       count(*)                                                                              AS rows_unremoved,
       count(*) FILTER (WHERE public.message_participant_can_read(cp.conversation_id, cp.participant_profile_id)) AS rows_readable
FROM public.conversation_participants cp
WHERE cp.participant_role <> 'unit_leader'
  AND cp.removed_at IS NULL
GROUP BY cp.participant_role
ORDER BY cp.participant_role;

-- ── PRE 5: how often read and send disagree for Unit Leaders today ───────────
-- Expect: disagreements = the number of exposure rows in PRE 3 (has_active_scope false
-- with can_read_now true). Every disagreement is can_read true, can_send false.
SELECT count(*) FILTER (WHERE public.message_participant_can_read(cp.conversation_id, cp.participant_profile_id)
                          <> public.message_participant_can_send(cp.conversation_id, cp.participant_profile_id)) AS disagreements,
       count(*)                                                                                                    AS unit_leader_rows
FROM public.conversation_participants cp
WHERE cp.participant_role = 'unit_leader'
  AND cp.removed_at IS NULL;

-- ═════════════════════════════════════════════════════════════════════════════
-- APPLY supabase/migrations/20260930000000_s15_unit_leader_thread_read_scope.sql
-- as ONE block. Expected: "Success. No rows returned."
-- ═════════════════════════════════════════════════════════════════════════════

-- ── POST 1: can_read now reads user_unit_scopes; nothing else moved ──────────
-- Expect exactly 4 rows:
--   message_participant_can_read                     reads_unit_scopes TRUE
--   message_participant_can_send                     reads_unit_scopes TRUE, delegates_to_can_read TRUE
--   message_profile_has_active_unit_leader_portal_scope  present
--   my_message_conversation_ids                      delegates_to_can_read TRUE
-- STOP if can_read still reads FALSE: the CREATE OR REPLACE did not land.
SELECT p.proname,
       (p.prosrc ~* 'FROM[[:space:]]+public\.user_unit_scopes')   AS reads_unit_scopes,
       (p.prosrc ~* 'message_participant_can_read[[:space:]]*\(')  AS delegates_to_can_read
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('message_participant_can_read', 'message_participant_can_send',
                    'message_profile_has_active_unit_leader_portal_scope',
                    'my_message_conversation_ids')
ORDER BY p.proname;

-- ── POST 2: attributes and grants unchanged ──────────────────────────────────
-- Expect the SAME row as PRE 2: security_definer true, stable true, search_path
-- {search_path=public, pg_catalog}, service_role true, authenticated false, anon false,
-- public false. STOP on any difference.
SELECT p.prosecdef                                   AS security_definer,
       p.provolatile = 's'                           AS stable,
       p.proconfig                                   AS search_path,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
       coalesce((SELECT bool_or(a.grantee = 0) FROM aclexplode(p.proacl) a), p.proacl IS NULL) AS public
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'message_participant_can_read'
  AND pg_get_function_identity_arguments(p.oid) = 'p_conversation_id uuid, p_profile_id uuid';

-- ── POST 3: the proof. Scope decides, in both directions ─────────────────────
-- Expect one row: readable_without_scope 0 (a Unit Leader with no active scope for a
-- thread's unit cannot read it), and readable_with_scope = with_scope (every Unit
-- Leader who holds the scope still can). without_scope should equal the number of
-- exposure rows counted in PRE 3.
-- STOP if readable_without_scope > 0. STOP if readable_with_scope < with_scope.
WITH ul AS (
  SELECT cp.conversation_id, cp.participant_profile_id,
         CASE
           WHEN cp.scope_unit_key IS NOT NULL THEN EXISTS (
             SELECT 1 FROM public.user_unit_scopes s
             WHERE s.user_profile_id = cp.participant_profile_id
               AND s.unit_key = cp.scope_unit_key
               AND s.revoked_at IS NULL
               AND s.starts_at <= now()
               AND (s.expires_at IS NULL OR s.expires_at > now()))
           ELSE public.message_profile_has_active_unit_leader_portal_scope(cp.participant_profile_id)
         END AS has_active_scope,
         public.message_participant_can_read(cp.conversation_id, cp.participant_profile_id) AS can_read_now
  FROM public.conversation_participants cp
  WHERE cp.participant_role = 'unit_leader'
    AND cp.removed_at IS NULL
)
SELECT count(*) FILTER (WHERE NOT has_active_scope)                   AS without_scope,
       count(*) FILTER (WHERE NOT has_active_scope AND can_read_now)  AS readable_without_scope,
       count(*) FILTER (WHERE has_active_scope)                       AS with_scope,
       count(*) FILTER (WHERE has_active_scope AND can_read_now)      AS readable_with_scope
FROM ul;

-- ── POST 4: the other roles are untouched ────────────────────────────────────
-- Expect EXACTLY the rows and numbers PRE 4 returned. STOP on any difference: the
-- student, academic_partner and nursing_academic branches must not have moved.
SELECT cp.participant_role,
       count(*)                                                                              AS rows_unremoved,
       count(*) FILTER (WHERE public.message_participant_can_read(cp.conversation_id, cp.participant_profile_id)) AS rows_readable
FROM public.conversation_participants cp
WHERE cp.participant_role <> 'unit_leader'
  AND cp.removed_at IS NULL
GROUP BY cp.participant_role
ORDER BY cp.participant_role;

-- ── POST 5: read and send now agree for every Unit Leader row ────────────────
-- Expect: disagreements 0, unit_leader_rows the same count as PRE 5.
-- STOP if disagreements > 0.
SELECT count(*) FILTER (WHERE public.message_participant_can_read(cp.conversation_id, cp.participant_profile_id)
                          <> public.message_participant_can_send(cp.conversation_id, cp.participant_profile_id)) AS disagreements,
       count(*)                                                                                                    AS unit_leader_rows
FROM public.conversation_participants cp
WHERE cp.participant_role = 'unit_leader'
  AND cp.removed_at IS NULL;

-- ── POST 6: history is intact; nothing was written to participant rows ───────
-- Expect: removed_now = the number of removed rows you would expect (this migration
-- writes none; compare with any earlier count you hold, or simply confirm no row's
-- removed_at falls after the moment you applied the migration).
SELECT count(*) FILTER (WHERE removed_at IS NOT NULL)          AS removed_now,
       max(removed_at)                                          AS latest_removed_at,
       count(*)                                                 AS participant_rows
FROM public.conversation_participants;
