# MESSAGES-ARCHIVE-P1: Owner verification

Companion to `supabase/migrations/20260730000002_messages_phase1_archive.sql`.
Everything in this document is READ-ONLY unless a section says otherwise. Run
each block in the Supabase SQL editor as the Owner; paste results back into the
project record.

## 1. Pre-application state checks

```sql
-- 1a. Confirm the new table does not exist yet (expect to_regclass to return NULL):
SELECT to_regclass('public.message_conversation_visibility');

-- 1b. Confirm the new RPC and both v3 list functions do not exist yet at their
--     EXACT signatures (expect all three to return NULL):
SELECT to_regprocedure(
  'public.messages_set_conversation_archived(uuid, text, uuid, boolean)');
SELECT to_regprocedure(
  'public.messages_staff_list_conversations_v3(integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text, text)');
SELECT to_regprocedure(
  'public.messages_portal_list_conversations_v3(integer, timestamptz, uuid, text)');

-- 1c. Confirm the current unread-count bodies do NOT yet reference the
--     visibility table (expect the source WITHOUT
--     message_conversation_visibility anywhere in it):
SELECT pg_get_functiondef('public.messages_staff_unread_count()'::regprocedure);
SELECT pg_get_functiondef('public.messages_portal_unread_count()'::regprocedure);

-- 1d. RACE FIX PRECHECK: confirm the CURRENT messages_post_reply is still the
--     Phase 0 definition (20260730000001) - a plain SELECT with no row lock,
--     and no reference to the not-yet-created visibility table (expect the
--     source WITHOUT "FOR UPDATE" and WITHOUT message_conversation_visibility):
SELECT pg_get_functiondef(
  'public.messages_post_reply(uuid, text, uuid, text, jsonb)'::regprocedure);
```

## 2. The migration

### Reply-path audit (why locking exactly two functions is sufficient)

Every append to an EXISTING conversation - a staff reply, a portal team
reply, and a Unit Leader/student direct reply - flows through
`messages_post_reply`. The `messages_start_*` functions
(`messages_start_conversation`, `messages_start_general_team_conversation`,
`messages_start_general_team_conversation_ap`) only ever create BRAND-NEW
conversations, which cannot yet hold a `message_conversation_visibility` row
(nothing can have archived a conversation that does not exist yet). Locking
exactly `messages_post_reply` and `messages_set_conversation_archived` against
the SAME conversation row is therefore sufficient to serialize every writer
relevant to the derived archive rule; no other function needs the fix.

Run the WHOLE file `20260730000002_messages_phase1_archive.sql` as one block.
It is a single transaction (`BEGIN` ... `COMMIT`): every statement lands
together or the whole migration rolls back and can be corrected and re-run from
a clean state.

## 3. Post-application checks

```sql
-- 3a. The table now exists, RLS is enabled, and it has ZERO policies (deny by
--     default; only service_role can read or write it, matching
--     participant_conversation_reads):
SELECT relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE oid = 'public.message_conversation_visibility'::regclass;
-- expect relrowsecurity = true.

SELECT policyname FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'message_conversation_visibility';
-- expect ZERO rows.

-- 3b. Table grants: filtered to the four grantees the repo checks everywhere.
--     Expect service_role rows ONLY (SELECT, INSERT, UPDATE, DELETE) - no
--     PUBLIC, anon, or authenticated row of any kind. The postgres owner
--     necessarily retains full DML implicitly; that is expected and outside
--     this filtered check.
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'message_conversation_visibility'
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
ORDER BY grantee, privilege_type;

-- 3c. Archive RPC EXECUTE matrix (expect service_role=true, everyone else
--     false - write RPCs are service-role only, matching every other Messages
--     write RPC):
SELECT
  has_function_privilege('service_role',
    'public.messages_set_conversation_archived(uuid, text, uuid, boolean)'::regprocedure,
    'EXECUTE') AS service_role_may_execute,
  has_function_privilege('authenticated',
    'public.messages_set_conversation_archived(uuid, text, uuid, boolean)'::regprocedure,
    'EXECUTE') AS authenticated_may_execute,
  has_function_privilege('anon',
    'public.messages_set_conversation_archived(uuid, text, uuid, boolean)'::regprocedure,
    'EXECUTE') AS anon_may_execute;

-- 3d. Both v3 EXECUTE matrices (expect authenticated=true, service_role=true,
--     anon=false - the standard read-RPC grant every prior list function has):
SELECT
  has_function_privilege('authenticated',
    'public.messages_staff_list_conversations_v3(integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text, text)'::regprocedure,
    'EXECUTE') AS authenticated_may_execute,
  has_function_privilege('service_role',
    'public.messages_staff_list_conversations_v3(integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text, text)'::regprocedure,
    'EXECUTE') AS service_role_may_execute,
  has_function_privilege('anon',
    'public.messages_staff_list_conversations_v3(integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text, text)'::regprocedure,
    'EXECUTE') AS anon_may_execute;

SELECT
  has_function_privilege('authenticated',
    'public.messages_portal_list_conversations_v3(integer, timestamptz, uuid, text)'::regprocedure,
    'EXECUTE') AS authenticated_may_execute,
  has_function_privilege('service_role',
    'public.messages_portal_list_conversations_v3(integer, timestamptz, uuid, text)'::regprocedure,
    'EXECUTE') AS service_role_may_execute,
  has_function_privilege('anon',
    'public.messages_portal_list_conversations_v3(integer, timestamptz, uuid, text)'::regprocedure,
    'EXECUTE') AS anon_may_execute;

-- 3e. PUBLIC must hold NO grant on either v3 or the archive RPC: list every
--     explicit grantee via aclexplode (expect rows ONLY for the function owner,
--     authenticated where applicable, and service_role; a 'PUBLIC' row must
--     NEVER appear):
SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
       a.privilege_type
FROM pg_proc p
CROSS JOIN LATERAL aclexplode(p.proacl) a
WHERE p.oid = 'public.messages_staff_list_conversations_v3(integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text, text)'::regprocedure
ORDER BY 1;

SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
       a.privilege_type
FROM pg_proc p
CROSS JOIN LATERAL aclexplode(p.proacl) a
WHERE p.oid = 'public.messages_portal_list_conversations_v3(integer, timestamptz, uuid, text)'::regprocedure
ORDER BY 1;

SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
       a.privilege_type
FROM pg_proc p
CROSS JOIN LATERAL aclexplode(p.proacl) a
WHERE p.oid = 'public.messages_set_conversation_archived(uuid, text, uuid, boolean)'::regprocedure
ORDER BY 1;

-- 3f. Owner privileges are expected on every object above (the postgres owner
--     retains full rights) and are deliberately outside every grantee filter in
--     this document; only the four application-facing grantees (PUBLIC, anon,
--     authenticated, service_role) are asserted.

-- 3g. v1/v2 of every list RPC and both prior unread-count functions are
--     UNTOUCHED (still present, unchanged signatures):
SELECT to_regprocedure('public.messages_staff_list_conversations(integer, timestamptz, uuid, text, uuid, text, boolean, text)');
SELECT to_regprocedure('public.messages_staff_list_conversations_v2(integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text)');
SELECT to_regprocedure('public.messages_portal_list_conversations(integer, timestamptz, uuid)');
SELECT to_regprocedure('public.messages_portal_list_conversations_v2(integer, timestamptz, uuid)');
-- expect all four to return a non-NULL oid.

-- 3h. Append-only is unchanged: NO application role gained UPDATE, DELETE, or
--     TRUNCATE on messages or conversation_events (expect ZERO rows):
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('messages', 'conversation_events')
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
  AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE');

-- 3i. RACE FIX POSTCHECK: messages_post_reply now locks the conversation row
--     and derives v_now from GREATEST(clock_timestamp(), last_message_at + 1
--     microsecond, max(archived_at) + 1 microsecond) (expect the source to
--     contain "FOR UPDATE" on the conversations select AND a reference to
--     message_conversation_visibility in the v_now derivation):
SELECT pg_get_functiondef(
  'public.messages_post_reply(uuid, text, uuid, text, jsonb)'::regprocedure);
-- Grant matrix is unchanged from every prior definition (service-role only):
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
```

## 4. Behavior probes (4a-4b read-only; 4c rollback-safe transactional)

Pick one real `<CONVERSATION_ID>` and its participant `<PROFILE_ID>` (or a
staff `<PROFILE_ID>` for the staff-side probe). These SELECT-only queries
confirm the derived rule without calling the write RPC:

```sql
-- 4a. Is the conversation currently archived for this profile, by the derived
--     rule (no row means "not archived"; a stale archived_at below
--     last_message_at also means "not archived" - this is the auto-unarchive
--     behavior working as designed):
SELECT c.id, c.last_message_at, v.archived_at,
       (v.archived_at IS NOT NULL AND v.archived_at >= c.last_message_at) AS is_archived_by_rule
FROM public.conversations c
LEFT JOIN public.message_conversation_visibility v
  ON v.conversation_id = c.id AND v.profile_id = '<PROFILE_ID>'
WHERE c.id = '<CONVERSATION_ID>';

-- 4b. Confirm the v3 list projects the SAME is_archived value the rule above
--     computes (run as the Owner via the service role, or compare against the
--     application response for that profile).
```

### 4c. Two-session locking probe (manual, rollback-safe transactional probe)

SCOPE: this production probe verifies SERIALIZATION ONLY - that the archive RPC
and the reply path block on the same conversation row lock. It does NOT
reproduce the adverse clock-skew ordering: doing that in production would
require persistent writes, so the exact adverse-ordering proof lives in the
AUTOMATED concurrency simulation and the static SQL assertions in
test/messagesArchiveServer.test.mjs, not here. Every session below ends with
ROLLBACK and contains no COMMIT; nothing is persisted.

Use two SQL editor tabs (Session A and Session B) against a REAL
`<CONVERSATION_ID>` and its portal `<PROFILE_ID>`, in this order:

```sql
-- STEP 1 - Session A: open a transaction and take the conversation row lock,
-- exactly where both RPCs serialize. Then PAUSE (run nothing else in A yet).
BEGIN;
SELECT id, last_message_at FROM public.conversations
  WHERE id = '<CONVERSATION_ID>'::uuid FOR UPDATE;
-- (pause here; leave this transaction open)
```

```sql
-- STEP 2 - Session B: attempt the archive while A holds the lock. This
-- statement must BLOCK (the editor spinner hangs) - that visible wait IS the
-- serialization proof: messages_set_conversation_archived cannot derive its
-- timestamps until the competing transaction on the same row finishes.
BEGIN;
SELECT public.messages_set_conversation_archived(
  '<PROFILE_ID>'::uuid, 'student', '<CONVERSATION_ID>'::uuid, true);
-- (blocked - do not cancel; proceed to STEP 3 in Session A)
```

```sql
-- STEP 3 - Session A: release the lock. Nothing was written in A.
ROLLBACK;
```

```sql
-- STEP 4 - Session B: the RPC completes the moment A rolls back (observe the
-- blocked statement return `{"archived": true}`). Inspect the effect INSIDE
-- this still-open transaction if useful, then ROLL IT BACK so the archive is
-- never persisted:
SELECT profile_id, conversation_id, archived_at
FROM public.message_conversation_visibility
WHERE conversation_id = '<CONVERSATION_ID>'::uuid
  AND profile_id = '<PROFILE_ID>'::uuid; -- visible only inside this transaction
ROLLBACK; -- discards the visibility row AND the read-pointer advance
```

Optional post-probe confirmation, in its own statement (plain autocommit
read-only SELECT, outside any transaction):

```sql
SELECT count(*) AS should_be_zero
FROM public.message_conversation_visibility
WHERE conversation_id = '<CONVERSATION_ID>'::uuid
  AND profile_id = '<PROFILE_ID>'::uuid;
```

Expected: STEP 2 visibly blocks while A holds the lock; STEP 4 completes only
after A's ROLLBACK and its own ROLLBACK leaves zero persistent rows. An earlier
revision of this section had Session B commit a real archive (persisting the
visibility row and read-pointer advance that no other session's rollback could
undo) while carrying a safety label it did not deserve; that was wrong and is
corrected here.
## 5. Rollback

Reversible with no loss beyond the archive/unarchive UI state itself (the
append-only `messages` and `conversation_events` tables are never touched by
either the migration or this rollback):

```sql
BEGIN;

-- Drop the two v3 list functions. v1 and v2 of each remain, so the API's
-- existing runtime fallback continues to serve every list request.
DROP FUNCTION IF EXISTS public.messages_staff_list_conversations_v3(
  integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text, text);
DROP FUNCTION IF EXISTS public.messages_portal_list_conversations_v3(
  integer, timestamptz, uuid, text);

-- Drop the archive RPC.
DROP FUNCTION IF EXISTS public.messages_set_conversation_archived(uuid, text, uuid, boolean);

-- Restore messages_post_reply to its PRIOR (Phase 0, 20260730000001) shape
-- FIRST, before dropping the table it currently references in its v_now
-- derivation - copy-paste, byte-identical to the live Phase 0 definition.
CREATE OR REPLACE FUNCTION public.messages_post_reply(
  p_actor_profile_id uuid,
  p_actor_kind       text,
  p_conversation_id  uuid,
  p_body             text,
  p_delivery         jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now            timestamptz := now();
  v_message_id     uuid;
  v_delivery_id    uuid;
  v_status         text;
  v_reopened       boolean := false;
  v_author_role    text;
  v_participant    uuid;
  v_expected_event text;
BEGIN
  IF p_actor_kind NOT IN ('student', 'staff', 'unit_leader', 'academic_partner') THEN
    RAISE EXCEPTION 'invalid actor kind' USING ERRCODE = 'MS400';
  END IF;
  IF char_length(btrim(coalesce(p_body, ''))) < 1 OR char_length(p_body) > 5000 THEN
    RAISE EXCEPTION 'body must be 1 to 5000 characters' USING ERRCODE = 'MS400';
  END IF;

  SELECT status INTO v_status FROM public.conversations WHERE id = p_conversation_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
  END IF;

  IF p_actor_kind IN ('student', 'unit_leader', 'academic_partner') THEN
    IF NOT public.message_participant_can_send(p_conversation_id, p_actor_profile_id) THEN
      RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'MS404';
    END IF;

    v_author_role := p_actor_kind;

    v_expected_event := CASE
      WHEN p_actor_kind = 'student' AND p_delivery->>'event_type' = 'student_to_unit_leader_message'
        THEN 'student_to_unit_leader_message'
      WHEN p_actor_kind = 'unit_leader' AND p_delivery->>'event_type' = 'unit_leader_message'
        THEN 'unit_leader_message'
      ELSE 'portal_reply'
    END;
  ELSE
    IF NOT public.message_profile_is_active_owner_or_admin(p_actor_profile_id) THEN
      RAISE EXCEPTION 'staff actor must be an active owner or admin' USING ERRCODE = 'MS403';
    END IF;
    v_participant := NULLIF(p_delivery->>'recipient_profile_id', '')::uuid;
    IF v_participant IS NULL
       OR NOT EXISTS (
            SELECT 1 FROM public.conversation_participants cp
            WHERE cp.conversation_id = p_conversation_id
              AND cp.participant_profile_id = v_participant
              AND cp.removed_at IS NULL)
       OR NOT public.message_participant_can_read(p_conversation_id, v_participant) THEN
      RAISE EXCEPTION 'participant portal access is not active' USING ERRCODE = 'MS409';
    END IF;
    v_author_role    := 'staff';
    v_expected_event := 'staff_reply';
  END IF;

  PERFORM public.message_assert_valid_delivery(p_delivery, v_expected_event, p_actor_profile_id);

  IF p_actor_kind = 'staff'
     AND NULLIF(p_delivery->>'recipient_profile_id', '')::uuid IS DISTINCT FROM v_participant THEN
    RAISE EXCEPTION 'staff reply must notify the active conversation participant'
      USING ERRCODE = 'MS400';
  END IF;

  IF v_status = 'resolved' THEN
    UPDATE public.conversations
    SET status = 'open', resolved_at = NULL, updated_at = v_now
    WHERE id = p_conversation_id;
    INSERT INTO public.conversation_events (conversation_id, event_type, actor_profile_id, from_value, to_value, created_at)
    VALUES (p_conversation_id, 'reopened', p_actor_profile_id, 'resolved', 'open', v_now);
    v_reopened := true;
  END IF;

  INSERT INTO public.messages (conversation_id, author_profile_id, author_role, body, created_at)
  VALUES (p_conversation_id, p_actor_profile_id, v_author_role, p_body, v_now)
  RETURNING id INTO v_message_id;

  UPDATE public.conversations
  SET last_message_at = v_now, updated_at = v_now
  WHERE id = p_conversation_id;

  IF p_actor_kind IN ('student', 'unit_leader', 'academic_partner') THEN
    INSERT INTO public.participant_conversation_reads (participant_profile_id, conversation_id, last_read_at)
    VALUES (p_actor_profile_id, p_conversation_id, v_now)
    ON CONFLICT (participant_profile_id, conversation_id) DO UPDATE SET last_read_at = v_now;
  ELSE
    INSERT INTO public.staff_conversation_reads (staff_profile_id, conversation_id, last_read_at)
    VALUES (p_actor_profile_id, p_conversation_id, v_now)
    ON CONFLICT (staff_profile_id, conversation_id) DO UPDATE SET last_read_at = v_now;
  END IF;

  BEGIN
    INSERT INTO public.message_notification_deliveries (
      conversation_id, message_id, triggered_by_profile_id, recipient_profile_id,
      recipient_email, recipient_kind, event_type, idempotency_key,
      queue_status, next_attempt_at,
      snapshot_sender_name, snapshot_subject, snapshot_category, cta_path
    ) VALUES (
      p_conversation_id, v_message_id, p_actor_profile_id,
      NULLIF(p_delivery->>'recipient_profile_id', '')::uuid,
      p_delivery->>'recipient_email', p_delivery->>'recipient_kind',
      p_delivery->>'event_type', p_delivery->>'idempotency_key',
      'queued', v_now,
      p_delivery->>'snapshot_sender_name', p_delivery->>'snapshot_subject',
      p_delivery->>'snapshot_category', p_delivery->>'cta_path'
    )
    RETURNING id INTO v_delivery_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate notification delivery for this message'
      USING ERRCODE = 'MS409';
  END;

  IF v_delivery_id IS NULL THEN
    RAISE EXCEPTION 'delivery row was not created' USING ERRCODE = 'MS409';
  END IF;

  RETURN jsonb_build_object(
    'message_id', v_message_id,
    'delivery_id', v_delivery_id,
    'created_at', v_now,
    'reopened', v_reopened
  );
END;
$$;

REVOKE ALL ON FUNCTION public.messages_post_reply(uuid, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.messages_post_reply(uuid, text, uuid, text, jsonb) TO service_role;

-- Drop the visibility table. Every archived/unarchived state is discarded;
-- every conversation reverts to "not archived" for every profile. No message
-- or conversation_events row is affected.
DROP TABLE IF EXISTS public.message_conversation_visibility;

-- Re-run the PRIOR unread-count definitions, verbatim, so both badges stop
-- referencing the now-dropped table. These are copy-paste from
-- 20260716000002_messages_phase3_api_foundation.sql (staff) and
-- 20260720000000_unit_leader_portal_foundation.sql (portal, section 8f - the
-- live, non-rollback-comment definition in that file).

CREATE OR REPLACE FUNCTION public.messages_staff_unread_count()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me uuid := public.portal_profile_id();
BEGIN
  IF NOT public.is_active_owner_or_admin() THEN
    RAISE EXCEPTION 'staff access required' USING ERRCODE = 'MS403';
  END IF;
  RETURN (
    SELECT COALESCE(count(*), 0)::integer
    FROM public.messages m
    WHERE m.author_role <> 'staff'
      AND m.created_at > COALESCE(
        (SELECT r.last_read_at FROM public.staff_conversation_reads r
          WHERE r.staff_profile_id = v_me AND r.conversation_id = m.conversation_id),
        '-infinity'::timestamptz)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.messages_staff_unread_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_staff_unread_count() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.messages_portal_unread_count()
RETURNS integer
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(count(*), 0)::integer
  FROM public.messages m
  WHERE m.conversation_id IN (SELECT public.my_message_conversation_ids())
    AND m.author_profile_id <> public.portal_profile_id()
    AND m.created_at > COALESCE(
      (SELECT r.last_read_at FROM public.participant_conversation_reads r
        WHERE r.participant_profile_id = public.portal_profile_id()
          AND r.conversation_id = m.conversation_id),
      '-infinity'::timestamptz);
$$;

REVOKE ALL ON FUNCTION public.messages_portal_unread_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messages_portal_unread_count() TO authenticated, service_role;

COMMIT;
```

After rollback, re-run section 1's precheck queries: all three new objects
(the table, the archive RPC, both v3 functions) should again return NULL/no
rows; the two unread-count function bodies should again lack any reference to
`message_conversation_visibility`; and `messages_post_reply` should again
match its Phase 0 source exactly (no `FOR UPDATE`, no reference to
`message_conversation_visibility`, `v_now timestamptz := now()` restored at
DECLARE time).

## 6. Deployment requirement

The migration alone does not change application behavior. The server code
(this commit) must ALSO deploy before the endpoints call the v3 RPCs or the
archive action: until it deploys, the running application keeps calling
v2/v1 exactly as it does today, which remain fully functional and unmodified.
After the code deploys but BEFORE this migration is applied, the endpoints
detect the v3/RPC absence (`PGRST202`/`42883`), report `archive_available:
false`, and the archive action returns `503 { error: 'archive_not_ready' }`;
no request fails ungracefully either way. Ordering is therefore safe in either
direction; once both the code and the migration are live, the endpoints detect
v3 at runtime and the pre-migration fallback becomes dead code.

## Production application record (2026-07-29)

The Owner applied `20260730000002_messages_phase1_archive.sql` in production and
ran the verification blocks:

- Prechecks: passed (table, RPC, and both v3 functions absent pre-application;
  prior function bodies confirmed at their expected definitions).
- Structural, privilege, append-only, rollback-availability, and unread-function
  postchecks: ALL PASSED (RLS enabled with zero policies; service-role-only
  table grants; EXECUTE matrices exactly as specified; no PUBLIC grantee rows;
  v1/v2 functions untouched; no application-role DML on the append-only tables).
- Section 4c two-session locking probe: INCONCLUSIVE - the Supabase SQL Editor
  did not permit genuinely overlapping execution across tabs, so the blocking
  behavior could not be observed. The probe is NOT claimed as passed.
  Serialization remains verified by three other layers: the DEPLOYED function
  definitions (postchecks confirmed FOR UPDATE and both GREATEST derivations in
  the live sources), the static SQL assertions, and the automated concurrency
  simulation in test/messagesArchiveServer.test.mjs.

Deployment note: as with Phase 0, the applied migration is inert to the running
application until the archive code commit deploys; the app's v3-first fallback
chain and archive_available flag make either ordering safe.
