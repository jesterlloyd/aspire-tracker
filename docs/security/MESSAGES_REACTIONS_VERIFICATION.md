# MESSAGES-LIFECYCLE-PHASE3A-REACTIONS: Owner verification

Companion to `supabase/migrations/20260801000000_messages_phase3a_reactions.sql`.
Everything in this document is READ-ONLY unless a section says otherwise (the
rollback section is the only mutating one, and it is optional). Run each block
in the Supabase SQL editor as the Owner; paste results back into the project
record (section 5).

## 1. Pre-application state checks

```sql
-- 1a. The reactions table must not exist yet (expect NULL):
SELECT to_regclass('public.message_reactions');

-- 1b. None of the three new functions exist yet at their EXACT signatures
--     (expect NULL for all three):
SELECT
  to_regprocedure('public.messages_set_message_reaction(uuid, text, uuid, text)')      AS set_reaction,
  to_regprocedure('public.messages_staff_get_thread_v3(uuid, integer, timestamptz, uuid)')  AS staff_thread_v3,
  to_regprocedure('public.messages_portal_get_thread_v3(uuid, integer, timestamptz, uuid)') AS portal_thread_v3;

-- 1c. The v2 thread functions this migration falls back to must exist
--     (expect two non-NULL rows):
SELECT
  to_regprocedure('public.messages_staff_get_thread_v2(uuid, integer, timestamptz, uuid)')  AS staff_thread_v2,
  to_regprocedure('public.messages_portal_get_thread_v2(uuid, integer, timestamptz, uuid)') AS portal_thread_v2;
```

## 2. Post-application checks

```sql
-- 2a. Table shape: RLS enabled, ZERO policies (expect relrowsecurity = true
--     and policy_count = 0):
SELECT c.relrowsecurity,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = 'message_reactions') AS policy_count
FROM pg_class c
WHERE c.oid = 'public.message_reactions'::regclass;

-- 2b. The closed reaction allowlist is a table CHECK (expect the three keys
--     acknowledge, thanks, celebrate in the definition):
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.message_reactions'::regclass
ORDER BY conname;

-- 2c. Table grants: service_role holds SELECT/INSERT/UPDATE/DELETE and NO
--     application role holds anything else (expect ONLY service_role rows):
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'message_reactions'
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
ORDER BY grantee, privilege_type;

-- 2d. Write RPC EXECUTE matrix at the EXACT signature (expect
--     service_role=true, authenticated=false, anon=false):
SELECT
  has_function_privilege('service_role',
    'public.messages_set_message_reaction(uuid, text, uuid, text)'::regprocedure,
    'EXECUTE') AS service_role_may_execute,
  has_function_privilege('authenticated',
    'public.messages_set_message_reaction(uuid, text, uuid, text)'::regprocedure,
    'EXECUTE') AS authenticated_may_execute,
  has_function_privilege('anon',
    'public.messages_set_message_reaction(uuid, text, uuid, text)'::regprocedure,
    'EXECUTE') AS anon_may_execute;

-- 2e. Thread v3 EXECUTE matrices at the EXACT signatures (expect, for BOTH:
--     authenticated=true, service_role=true, anon=false):
SELECT
  has_function_privilege('authenticated',
    'public.messages_staff_get_thread_v3(uuid, integer, timestamptz, uuid)'::regprocedure,
    'EXECUTE') AS staff_v3_authenticated,
  has_function_privilege('service_role',
    'public.messages_staff_get_thread_v3(uuid, integer, timestamptz, uuid)'::regprocedure,
    'EXECUTE') AS staff_v3_service_role,
  has_function_privilege('anon',
    'public.messages_staff_get_thread_v3(uuid, integer, timestamptz, uuid)'::regprocedure,
    'EXECUTE') AS staff_v3_anon,
  has_function_privilege('authenticated',
    'public.messages_portal_get_thread_v3(uuid, integer, timestamptz, uuid)'::regprocedure,
    'EXECUTE') AS portal_v3_authenticated,
  has_function_privilege('service_role',
    'public.messages_portal_get_thread_v3(uuid, integer, timestamptz, uuid)'::regprocedure,
    'EXECUTE') AS portal_v3_service_role,
  has_function_privilege('anon',
    'public.messages_portal_get_thread_v3(uuid, integer, timestamptz, uuid)'::regprocedure,
    'EXECUTE') AS portal_v3_anon;

-- 2f. PUBLIC must hold NO grant on any of the three functions: list every
--     explicit grantee per function (expect rows ONLY for the function owner,
--     service_role, and, for the two thread functions only, authenticated;
--     a 'PUBLIC' row must NOT appear anywhere):
SELECT p.oid::regprocedure AS function,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
       a.privilege_type
FROM pg_proc p
CROSS JOIN LATERAL aclexplode(p.proacl) a
WHERE p.oid IN (
  'public.messages_set_message_reaction(uuid, text, uuid, text)'::regprocedure,
  'public.messages_staff_get_thread_v3(uuid, integer, timestamptz, uuid)'::regprocedure,
  'public.messages_portal_get_thread_v3(uuid, integer, timestamptz, uuid)'::regprocedure
)
ORDER BY 1, 2;
```

## 3. Boundary checks (the non-negotiable rules)

```sql
-- 3a. Append-only unchanged in schema public for the APPLICATION roles
--     (expect ZERO rows; the postgres owner necessarily retains full DML on
--     every table, which is expected and outside this check):
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('messages', 'conversation_events')
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
  AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE');

-- 3b. The reaction RPC touches ONLY message_reactions. Inspect the deployed
--     source (expect: NO reference to last_message_at, staff_conversation_reads,
--     participant_conversation_reads, message_conversation_visibility,
--     conversation_events, or message_notification_deliveries anywhere in the
--     function body; conversations and conversation_participants appear only
--     inside read-only authorization lookups):
SELECT pg_get_functiondef(
  'public.messages_set_message_reaction(uuid, text, uuid, text)'::regprocedure);

-- 3c. Mechanical form of 3b (expect all six columns = false):
SELECT
  src ~* 'last_message_at'                    AS touches_last_message_at,
  src ~* 'staff_conversation_reads'           AS touches_staff_reads,
  src ~* 'participant_conversation_reads'     AS touches_participant_reads,
  src ~* 'message_conversation_visibility'    AS touches_archive_state,
  src ~* 'conversation_events'                AS touches_events,
  src ~* 'message_notification_deliveries'    AS touches_deliveries
FROM (
  SELECT pg_get_functiondef(
    'public.messages_set_message_reaction(uuid, text, uuid, text)'::regprocedure) AS src
) s;

-- 3d. The delivery event_type CHECK was NOT extended or altered by Phase 3A.
--     The production baseline holds FIVE event types: new_conversation,
--     portal_reply, staff_reply, unit_leader_message, and
--     student_to_unit_leader_message (the last two were added by the Unit
--     Leader enablement work, before Phase 3A). Expect exactly those five in
--     the definition; the invariant this block proves is that Phase 3A added
--     no reaction event type and changed nothing here. (An earlier revision
--     of this document wrongly expected only the first three; that stale
--     baseline claim is corrected here. The migration itself never touches
--     this constraint, so nothing in production was affected.)
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.message_notification_deliveries'::regclass
  AND conname = 'chk_mnd_event_type';

-- 3e. Both v2 thread functions remain at their applied definitions (expect
--     both to exist; the API falls back to them if v3 is ever dropped):
SELECT
  to_regprocedure('public.messages_staff_get_thread_v2(uuid, integer, timestamptz, uuid)')  AS staff_thread_v2,
  to_regprocedure('public.messages_portal_get_thread_v2(uuid, integer, timestamptz, uuid)') AS portal_thread_v2;
```

## 4. Rollback (optional, mutating, run whole as one block)

Dropping the three functions and the table fully reverts this migration. The
deployed application recovers WITHOUT a code change: the thread endpoints
detect the missing v3 (PGRST202/42883), fall back to v2, and report
`reactions_available: false`, which hides every reaction affordance; the
reaction endpoints return `503 { error: 'reactions_not_ready' }`. Dropping the
table discards only reaction rows; no message, event, read pointer, archive
row, or delivery row is affected.

```sql
BEGIN;
DROP FUNCTION IF EXISTS public.messages_set_message_reaction(uuid, text, uuid, text);
DROP FUNCTION IF EXISTS public.messages_staff_get_thread_v3(uuid, integer, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.messages_portal_get_thread_v3(uuid, integer, timestamptz, uuid);
DROP TABLE IF EXISTS public.message_reactions;
COMMIT;

NOTIFY pgrst, 'reload schema';
```

## 5. Production application record (2026-07-29)

The Owner applied migration 20260801000000 in production and ran every block
above. All checks passed:

- Prechecks 1a/1b/1c: passed (table and all three new functions absent
  pre-application; both v2 thread functions present).
- Postcheck 2a: `message_reactions` has RLS enabled (relrowsecurity = true)
  with ZERO policies.
- Postcheck 2b: the CHECK allowlist is exactly
  `reaction_key IN ('acknowledge', 'thanks', 'celebrate')`.
- Postcheck 2c: table grants are service_role-only
  (SELECT/INSERT/UPDATE/DELETE); no PUBLIC, anon, or authenticated grant.
- Postcheck 2d: `messages_set_message_reaction` EXECUTE matrix is
  service_role = true, authenticated = false, anon = false.
- Postcheck 2e: both thread v3 functions EXECUTE as authenticated = true,
  service_role = true, anon = false.
- Postcheck 2f: zero PUBLIC grants on all three functions; explicit grantees
  are exactly the function owner, service_role, and (thread functions only)
  authenticated.
- Boundary 3a: ZERO application-role UPDATE/DELETE/TRUNCATE grants on
  `messages` / `conversation_events` (append-only unchanged).
- Boundary 3b/3c: all six forbidden references in the reaction RPC source are
  false (no last_message_at, no staff or participant read pointers, no
  archive visibility, no conversation_events, no deliveries).
- Boundary 3d: the delivery `event_type` CHECK is UNCHANGED at its five-type
  production baseline (new_conversation, portal_reply, staff_reply,
  unit_leader_message, student_to_unit_leader_message). Phase 3A added no
  reaction event type. Note: an earlier revision of block 3d wrongly stated a
  three-type baseline; the constraint in production was correct throughout
  and the migration never touched it. The stale expectation, not production,
  was the defect, and it is corrected above.
- Boundary 3e: both v2 thread functions remain at their applied definitions
  for rollback and fallback.

The rollback block in section 4 was NOT run. Deployment of the application
code is still required before reactions appear: until then the deployed app
calls the v2 thread functions and has no reaction endpoints.
