-- ============================================================================
-- UNIT LEADER: notification alert types and Report a Concern
-- PREFLIGHT and VERIFICATION
-- ============================================================================
-- Run each block SEPARATELY in the Supabase SQL editor. Every query is READ ONLY.
-- PREFLIGHT before applying
-- supabase/migrations/20260720000002_unit_leader_notifications_and_concerns.sql,
-- VERIFICATION after. No query exposes a secret or a signed token.
--
-- Every introspection predicate matches EXECUTABLE syntax, never a bare identifier,
-- because a substring test on prosrc also matches the explanatory comments inside
-- these functions.
--
-- STOP CONDITIONS:
--   - preflight 1 shows either earlier migration was not applied
--   - preflight 2 shows the CHECK already contains the three added values
--   - preflight 3 shows a preference row whose alert_type is outside the CURRENT
--     five, which would mean the CHECK is not what this migration expects
--   - preflight 4 shows messages_start_conversation already admits
--     'unit_leader_to_staff'
--   - preflight 5 shows more than one messages_start_conversation overload
-- ============================================================================


-- ############################################################################
-- PREFLIGHT (run BEFORE the migration)
-- ############################################################################

-- ── PREFLIGHT 1: both earlier migrations are applied ────────────────────────
-- Expected: 3 rows. unit_leader_notification_prefs (from 20260720000000), and the
-- two RPCs from 20260720000001. STOP if any is missing.
SELECT 'table' AS kind, c.relname AS name
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'unit_leader_notification_prefs'
UNION ALL
SELECT 'function', p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('unit_placement_respond', 'unit_capacity_submit')
ORDER BY kind, name;

-- ── PREFLIGHT 2: the CURRENT alert-type CHECK ───────────────────────────────
-- Expected: exactly the five current values, and NONE of the three being added.
-- STOP if the three are already present: the migration has already been applied.
SELECT
  pg_get_constraintdef(oid) AS chk_ulnp_alert_type,
  (pg_get_constraintdef(oid) LIKE '%capacity_review_outcome%')     AS already_has_capacity,
  (pg_get_constraintdef(oid) LIKE '%preceptor_assignment_update%') AS already_has_preceptor,
  (pg_get_constraintdef(oid) LIKE '%concern_follow_up%')           AS already_has_concern
FROM pg_constraint
WHERE conrelid = 'public.unit_leader_notification_prefs'::regclass
  AND conname = 'chk_ulnp_alert_type';

-- ── PREFLIGHT 3: existing preference rows ───────────────────────────────────
-- Expected: 0 rows on a fresh install, since no Unit Leader is assigned yet. Any
-- alert_type outside the current five would mean the live CHECK differs from what
-- this migration expects: STOP and reconcile. This is also the count the rollback
-- would have to consider.
SELECT alert_type, count(*) AS rows, count(*) FILTER (WHERE email_enabled) AS email_enabled_rows
FROM public.unit_leader_notification_prefs
GROUP BY alert_type
ORDER BY alert_type;

-- ── PREFLIGHT 4: the start RPC does not yet admit the new actor kind ────────
-- Expected: admits_unit_leader = true (from 20260720000000), and
-- admits_unit_leader_to_staff = FALSE. STOP if the latter is already true.
SELECT
  (prosrc ~* '''unit_leader''')          AS admits_unit_leader,
  (prosrc ~* '''unit_leader_to_staff''') AS admits_unit_leader_to_staff
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_start_conversation';

-- ── PREFLIGHT 5: exactly one start RPC, and its ACL ─────────────────────────
-- Expected: ONE row, args ending 'jsonb, text', service_role EXECUTE true.
-- CREATE OR REPLACE preserves this ACL and the signature does not change, so this
-- is the baseline VERIFY 4 compares against. STOP if more than one row appears.
SELECT
  pg_get_function_identity_arguments(p.oid)                 AS args,
  has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_role_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_start_conversation';

-- ── PREFLIGHT 6: conversation baseline ──────────────────────────────────────
-- Expected: matches the current live counts (conversations 2, messages 3,
-- participants 2 at the time of writing). VERIFY 6 compares against this. This
-- migration must move no data.
SELECT
  (SELECT count(*) FROM public.conversations)             AS conversations,
  (SELECT count(*) FROM public.messages)                  AS messages,
  (SELECT count(*) FROM public.conversation_participants) AS participants,
  (SELECT count(*) FROM public.conversation_participants
     WHERE participant_role = 'unit_leader')              AS unit_leader_participants;


-- ############################################################################
-- VERIFICATION (run AFTER the migration)
-- ############################################################################

-- ── VERIFY 1: the CHECK now allows all EIGHT values ────────────────────────
-- PASS: all eight columns true. The five preserved values matter as much as the
-- three added ones: losing one would invalidate existing preferences.
SELECT
  (pg_get_constraintdef(oid) LIKE '%placement_request%')           AS has_placement_request,
  (pg_get_constraintdef(oid) LIKE '%response_deadline%')           AS has_response_deadline,
  (pg_get_constraintdef(oid) LIKE '%onboarding_issue%')            AS has_onboarding_issue,
  (pg_get_constraintdef(oid) LIKE '%schedule_change%')             AS has_schedule_change,
  (pg_get_constraintdef(oid) LIKE '%new_message%')                 AS has_new_message,
  (pg_get_constraintdef(oid) LIKE '%capacity_review_outcome%')     AS has_capacity_review_outcome,
  (pg_get_constraintdef(oid) LIKE '%preceptor_assignment_update%') AS has_preceptor_assignment_update,
  (pg_get_constraintdef(oid) LIKE '%concern_follow_up%')           AS has_concern_follow_up
FROM pg_constraint
WHERE conrelid = 'public.unit_leader_notification_prefs'::regclass
  AND conname = 'chk_ulnp_alert_type';

-- ── VERIFY 1b: no existing preference row was invalidated ──────────────────
-- PASS: same rows as PREFLIGHT 3. The change is additive, so no row can have been
-- rejected. Run alone.
SELECT alert_type, count(*) AS rows
FROM public.unit_leader_notification_prefs
GROUP BY alert_type
ORDER BY alert_type;

-- ── VERIFY 2: the start RPC admits the new actor kind ──────────────────────
-- PASS: every column true. skips_student_link_for_new_kind proves a concern report
-- does not require a student participant; creates_lone_ul_participant proves the
-- student is NOT made a participant of the thread that reports on them.
SELECT
  (prosrc ~* '''unit_leader_to_staff''')                                        AS admits_new_kind,
  (prosrc ~* 'p_actor_kind <> ''unit_leader_to_staff''')                        AS skips_student_link_for_new_kind,
  (prosrc ~* '''unit_leader'', ''unit'',')                                      AS creates_lone_ul_participant,
  (prosrc ~* 'FROM public\.user_unit_scopes')                                   AS checks_active_scope,
  (prosrc ~* 'JOIN public\.units u ON u\.id = st\.matched_unit_id')             AS resolves_student_unit_server_side
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_start_conversation';

-- ── VERIFY 3: a concern thread routes to staff, not to the student ─────────
-- PASS: routes_new_conversation = true. The new kind reuses the unchanged
-- 'new_conversation' event, which message_assert_valid_delivery binds to the
-- shared inbox. STOP if it instead uses a direct-thread event type, which would
-- notify the student.
SELECT
  (prosrc ~* 'v_expected_event := ''new_conversation''')            AS routes_new_conversation,
  (prosrc ~* 'v_expected_event := ''unit_leader_message''')         AS also_has_direct_event
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_start_conversation';

-- ── VERIFY 4: signature and ACL are UNCHANGED ─────────────────────────────
-- PASS: ONE row, identical to PREFLIGHT 5. This migration adds a VALUE to an
-- existing parameter, not a parameter, so CREATE OR REPLACE preserves the ACL.
-- STOP if more than one row appears, or if any privilege differs from preflight 5.
SELECT
  pg_get_function_identity_arguments(p.oid)                 AS args,
  has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_role_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_start_conversation';

-- ── VERIFY 5: no student is a participant of a concern thread ─────────────
-- PASS: 0 rows. A unit_leader_to_staff conversation must have exactly one
-- participant, the Unit Leader. Any student participant on such a thread would let
-- the student read a report about themselves. Expected 0 rows now simply because
-- none exists yet; this is the query to re-run after acceptance testing.
SELECT cp.conversation_id, count(*) AS participants,
       count(*) FILTER (WHERE cp.participant_role = 'student') AS student_participants
FROM public.conversation_participants cp
WHERE cp.removed_at IS NULL
  AND cp.conversation_id IN (
    SELECT conversation_id FROM public.conversation_participants
    WHERE participant_role = 'unit_leader' AND scope_kind = 'unit' AND removed_at IS NULL)
GROUP BY cp.conversation_id
HAVING count(*) FILTER (WHERE cp.participant_role = 'student') > 0
   AND count(*) > 1;

-- ── VERIFY 6: no conversation or message data was moved ───────────────────
-- PASS: identical to PREFLIGHT 6. This migration changes a CHECK and a function
-- body only.
SELECT
  (SELECT count(*) FROM public.conversations)             AS conversations,
  (SELECT count(*) FROM public.messages)                  AS messages,
  (SELECT count(*) FROM public.conversation_participants) AS participants,
  (SELECT count(*) FROM public.conversation_participants
     WHERE participant_role = 'unit_leader')              AS unit_leader_participants;

-- ── VERIFY 7: the read/send split and Wave F-2 are untouched ──────────────
-- PASS: can_read requires_active_unit_scope = false, can_send = true, and
-- bucket_public = false with zero student-files policies.
SELECT
  (SELECT (p.prosrc ~* 'FROM[[:space:]]+public\.user_unit_scopes')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'message_participant_can_read')  AS read_requires_scope,
  (SELECT (p.prosrc ~* 'FROM[[:space:]]+public\.user_unit_scopes')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'message_participant_can_send')  AS send_requires_scope,
  (SELECT public FROM storage.buckets WHERE id = 'student-files')                AS bucket_public,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND (COALESCE(qual,'') LIKE '%student-files%'
         OR COALESCE(with_check,'') LIKE '%student-files%'))                     AS student_files_policies;
