# MESSAGES-CORRECTNESS-PHASE0-1: Owner verification

Companion to `supabase/migrations/20260730000001_messages_phase0_correctness.sql`.
Everything in this document is READ-ONLY. Run each block in the Supabase SQL editor
as the Owner; paste results back into the project record.

## 1. Pre-application state checks

```sql
-- 1a. Confirm the live messages_post_reply (EXACT signature) still rejects
--     academic_partner (expect the source WITHOUT academic_partner in its
--     actor-kind CHECK list):
SELECT pg_get_functiondef(
  'public.messages_post_reply(uuid, text, uuid, text, jsonb)'::regprocedure);

-- 1b. Confirm v2 of the portal list function does not exist yet at its EXACT
--     signature (expect NULL):
SELECT to_regprocedure(
  'public.messages_portal_list_conversations_v2(integer, timestamptz, uuid)');
```

## 2. Historical audit: suspected mislabeled author_role rows (READ-ONLY)

A message is SUSPECTED mislabeled when it says `author_role = 'student'` but its
author is a `unit_leader` or `academic_partner` participant of that same
conversation. The inference is deterministic: a conversation holds at most two
active participants, `(conversation_id, participant_profile_id)` is unique among
unremoved rows, and `participant_role` is fixed on the row, so each
(author, conversation) pair maps to exactly one participant role.

```sql
-- 2a. Count suspected mislabeled rows by true (inferred) role:
SELECT cp.participant_role AS inferred_true_role,
       count(*)            AS mislabeled_messages,
       count(DISTINCT m.conversation_id) AS conversations_affected,
       min(m.created_at)   AS earliest,
       max(m.created_at)   AS latest
FROM public.messages m
JOIN public.conversation_participants cp
  ON cp.conversation_id = m.conversation_id
 AND cp.participant_profile_id = m.author_profile_id
WHERE m.author_role = 'student'
  AND cp.participant_role IN ('unit_leader', 'academic_partner')
GROUP BY cp.participant_role
ORDER BY cp.participant_role;

-- 2b. Safety cross-check: confirm the inference is unambiguous (expect 0 rows -
--     no author maps to two different participant roles in one conversation):
SELECT m.conversation_id, m.author_profile_id, count(DISTINCT cp.participant_role)
FROM public.messages m
JOIN public.conversation_participants cp
  ON cp.conversation_id = m.conversation_id
 AND cp.participant_profile_id = m.author_profile_id
GROUP BY m.conversation_id, m.author_profile_id
HAVING count(DISTINCT cp.participant_role) > 1;
```

## 3. Correction feasibility statement

A one-time correction IS technically safe and deterministic: query 2a's join is
exact, query 2b proves no ambiguity, and the UPDATE would be
`SET author_role = cp.participant_role` over precisely that join. However it
requires an UPDATE on `public.messages`, which no application role may perform and
which the written append-only guarantee (docs/MESSAGES_PHASE1_FOUNDATION.md,
"Append-only") exists to prevent. Recommendation, consistent with the
MESSAGES-LIFECYCLE-DISCOVERY-1 decision record: DO NOT perform the correction.
Leave historical rows as written, keep this document as the record of the defect
window (Phase 4b2ii AP activation through the application of this migration), and
let query 2a's counts stand as the bounded impact statement. Display-side effects
are cosmetic (bubble attribution in mixed threads); no authorization ever reads
`messages.author_role`.

If you decide the correction is warranted anyway, it must run as the postgres
owner, inside a transaction with 2a/2b snapshots before and after, and this
document must be amended with the executed statement and row counts.

## 4. Post-application checks

```sql
-- 4a. New CHECK list includes academic_partner at the EXACT signature (expect
--     the four-kind list in the source):
SELECT pg_get_functiondef(
  'public.messages_post_reply(uuid, text, uuid, text, jsonb)'::regprocedure);

-- 4b. v2 EXECUTE matrix at the EXACT signature (expect authenticated=true,
--     service_role=true, anon=false):
SELECT
  has_function_privilege('authenticated',
    'public.messages_portal_list_conversations_v2(integer, timestamptz, uuid)'::regprocedure,
    'EXECUTE') AS authenticated_may_execute,
  has_function_privilege('service_role',
    'public.messages_portal_list_conversations_v2(integer, timestamptz, uuid)'::regprocedure,
    'EXECUTE') AS service_role_may_execute,
  has_function_privilege('anon',
    'public.messages_portal_list_conversations_v2(integer, timestamptz, uuid)'::regprocedure,
    'EXECUTE') AS anon_may_execute;

-- 4b-public. PUBLIC must hold NO grant on v2: list every explicit grantee
--     (expect rows ONLY for the function owner, authenticated, and
--     service_role; a 'PUBLIC' row must NOT appear):
SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
       a.privilege_type
FROM pg_proc p
CROSS JOIN LATERAL aclexplode(p.proacl) a
WHERE p.oid = 'public.messages_portal_list_conversations_v2(integer, timestamptz, uuid)'::regprocedure
ORDER BY 1;

-- Same matrix for the redefined reply RPC (expect service_role=true and
-- authenticated=false, anon=false; write RPCs are service-role only):
SELECT
  has_function_privilege('service_role',
    'public.messages_post_reply(uuid, text, uuid, text, jsonb)'::regprocedure,
    'EXECUTE') AS service_role_may_execute,
  has_function_privilege('authenticated',
    'public.messages_post_reply(uuid, text, uuid, text, jsonb)'::regprocedure,
    'EXECUTE') AS authenticated_may_execute,
  has_function_privilege('anon',
    'public.messages_post_reply(uuid, text, uuid, text, jsonb)'::regprocedure,
    'EXECUTE') AS anon_may_execute;

-- 4c. Append-only unchanged in schema public for the APPLICATION roles
--     (expect ZERO rows). The postgres owner necessarily retains full DML on
--     every table; owner privileges are EXPECTED and are deliberately outside
--     this check - the append-only guarantee is about application roles only.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('messages', 'conversation_events')
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
  AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE');

-- 4d. Behavior probe (read-only): the v2 row unread rule matches the global badge
--     rule for a spot-checked portal profile id <PROFILE_ID>:
--     compare a single conversation's row count vs the global count delta.
```

## 5. Production application record (2026-07-29)

The Owner applied the migration and ran every block above in production:

- Prechecks 1a/1b: passed (academic_partner absent pre-application; v2 absent).
- Historical audit 2a: ZERO mislabeled messages. 2b: ZERO ambiguous roles. The
  defect window produced no mislabeled rows; no correction question remains.
- Postcheck 4b: v2 EXECUTE authenticated=true, service_role=true, anon=false.
- Postcheck 4b-public: explicit grantees on v2 are exactly authenticated,
  postgres (owner, expected), service_role. No PUBLIC row.
- Reply RPC matrix: service_role=true, authenticated=false, anon=false.
- Postcheck 4c: ZERO application-role UPDATE/DELETE/TRUNCATE grants on
  messages / conversation_events.

## 6. Deployment requirement (corrected)

The migration being applied does NOT by itself change application behavior: the
deployed application must also carry the Phase 0 code (this commit) before it
passes the verified actorKind to messages_post_reply and calls
messages_portal_list_conversations_v2. Until that deploy, the live app keeps its
previous behavior against the new (backward-compatible) functions. After the
deploy, no further sequencing is needed: the code detects v2 at runtime and the
reply path's pre-migration fallback becomes dead code. An earlier revision of
this document claimed no deployment was required; that claim was wrong and is
corrected here.
