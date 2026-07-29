# MESSAGES-LIFECYCLE-PHASE2-PURGE-POSTURE: policy and Owner runbook

Status: DOCUMENTATION ONLY. This document changes no runtime code, no schema,
no permissions, and no production data. It defines the standing policy for
permanent deletion (purge) of Messages conversations and the exact
Owner-executed runbook for the single sanctioned case: explicitly identified
test conversations. There is no general Delete button, and this document does
not authorize building one; any future user-facing delete requires its own
gated task.

Companion documents:

- [OWNER_SQL_GATE.md](OWNER_SQL_GATE.md): the gate this runbook operates under.
- `docs/MESSAGES_PHASE1_FOUNDATION.md`: the written append-only guarantee.
- [MESSAGES_PHASE0_VERIFICATION.md](MESSAGES_PHASE0_VERIFICATION.md) and
  [MESSAGES_ARCHIVE_VERIFICATION.md](MESSAGES_ARCHIVE_VERIFICATION.md):
  production records proving no application role can UPDATE, DELETE, or
  TRUNCATE message history.

## 1. Current guarantees and relationships (inspected 2026-07-29 at fa15d12)

### 1a. Append-only posture

`docs/MESSAGES_PHASE1_FOUNDATION.md` ("Append-only message and event
guarantees") states that `messages` and `conversation_events` are append-only,
that no application role may UPDATE, DELETE, or TRUNCATE them, that
`conversations` and `conversation_participants` may not be deleted or
truncated by any application role, and that "The database owner retains
emergency administrative authority." A purge under this runbook is an exercise
of exactly that owner authority; it does not contradict the written guarantee,
because the guarantee is about application roles and user-facing paths. The
zero-grant posture was verified in production on 2026-07-29 (Phase 0
verification section 5 and the archive verification record).

Consequence: a purge can only run in the Supabase SQL editor as the database
owner. Nothing in the deployed application, including service_role code, can
perform it. That is by design and must remain true.

### 1b. Complete foreign-key web (from the committed migrations)

Tables referencing `conversations(id)`:

| Table | FK action | Purge handling |
| --- | --- | --- |
| `conversation_participants` | RESTRICT | explicit DELETE required |
| `messages` | RESTRICT | explicit DELETE required |
| `conversation_events` | RESTRICT | explicit DELETE required |
| `message_notification_deliveries` | RESTRICT | explicit DELETE required |
| `message_creation_requests` | RESTRICT | explicit DELETE required |
| `staff_conversation_reads` | CASCADE | removed automatically |
| `participant_conversation_reads` | CASCADE | removed automatically |
| `message_conversation_visibility` | CASCADE | removed automatically |

Tables referencing `messages(id)`:

| Table | FK action | Purge handling |
| --- | --- | --- |
| `message_notification_deliveries.message_id` | SET NULL | moot; rows deleted by conversation |
| `message_creation_requests.message_id` | RESTRICT | explicit DELETE required |
| `message_reactions.message_id` | CASCADE | removed automatically with its message |

Amendment (2026-07-29, MESSAGES-P3A): `message_reactions` (migration
20260801000000) cascades from `messages`, so the purge transaction in step 5
needs no additional DELETE; the preview, export, and verification blocks
below include it so its rows are counted, exported, and proven gone.

Notes:

- `message_creation_requests` (the general-team-thread idempotency ledger)
  cannot have its references nulled instead of deleted: the
  `chk_mcr_completed_consistent` CHECK requires a completed row to keep its
  `conversation_id` and `message_id`. Purging a conversation therefore also
  deletes its ledger rows. This is an accepted, recorded audit loss.
- `message_notification_deliveries.notification_log_id` is SET NULL toward
  `notification_log`; `notification_log` rows are NOT part of the purge (see
  1c).
- No views or materialized views exist over any Messages table.
- `public.message_archive` (migration 20260625000000) is the Outreach email
  sent-history table keyed by `notification_log_id`. It is unrelated to the
  Messages feature and is out of scope here.

### 1c. What survives a purge, deliberately

- `notification_log` rows for message notification emails. They contain the
  recipient email, the email subject line, and
  `metadata.context.conversationId`, but never a message body: the delivery
  pipeline enforces a no-body snapshot allowlist
  (`lib/server/messages/deliveryLogic.js`, `FORBIDDEN_SNAPSHOT_KEY`). These
  rows are the email-send audit and are retained.
- Resend provider logs. Notification emails carry subject and CTA only, never
  the message body, so external retention is limited to subject lines.
- For TEST conversation purges this residue is acceptable and ignored. For a
  legal or privacy erasure request it must be assessed explicitly: the
  `notification_log` subject snapshot and Resend's provider records are in
  scope of such a request and need their own decision. This runbook's SQL does
  NOT touch them.

### 1d. Recovery reality

Supabase backups and point-in-time recovery are project-level and
plan-dependent; they cannot be confirmed from this repository. Even where PITR
exists, restoring is all-or-nothing for the whole database: it would roll back
every unrelated table to the restore point. There is no per-conversation
restore. Treat a committed purge as irreversible, which is why the runbook
requires a pre-purge export and an inside-transaction verification with
ROLLBACK as the default outcome.

## 2. Policy: archive is the lifecycle, purge is the exception

Archive (per-user visibility, shipped in MESSAGES-LIFECYCLE-PHASE1-ARCHIVE) is
the only user-facing way a conversation leaves an inbox. Message history is
retained indefinitely by default; no automatic expiry exists or is planned by
this document.

Permanent purge is justified only for:

1. Explicitly identified TEST or synthetic conversations: every participant is
   a known test account and the content was created for QA or demonstration.
   This is the only case the runbook in section 5 covers.
2. A verified legal or privacy erasure obligation. Requires its own scoped
   plan per case (including the section 1c residue) before any SQL is drafted.
3. A security exposure inside a message body (a credential, token, or
   sensitive personal data posted in error) where continued retention is a
   live risk. Same treatment as case 2: per-case plan first.

Purge is never justified for tidiness, inbox volume, removing an
awkward-but-legitimate exchange, or "cleaning up" real program history.
Real conversations are archived, not deleted.

## 3. Authorization and execution

- Only the Owner (Jester) may authorize a purge, and only the Owner executes
  it, in the Supabase SQL editor as the database owner.
- Authorization and execution are two distinct recorded moments: first the
  explicit conversation UUID list and justification are appended to section 7
  of this document (committed before execution), then the runbook is executed
  against exactly that list.
- Claude, agents, staff users, and application code never execute a purge.
  The grants make this impossible for application roles; keep it that way.
- Scope pinning is absolute: purges name conversation UUIDs individually.
  No pattern matching, no subject or category predicates, no date-range
  deletes, no TRUNCATE, ever.

## 4. Rollback limits

Read before running anything in section 5:

- After COMMIT there is no application-level undo. The conversation, its
  messages, its participants, its lifecycle events, its delivery job rows, and
  its idempotency ledger rows are gone, and the CASCADE tables (read pointers,
  archive visibility) empty themselves.
- `conversation_events` cannot record its own purge; the in-app audit trail is
  deleted with the conversation. The surviving audit is the execution record
  in section 7 plus the retained `notification_log` rows.
- The only technical recovery after COMMIT is a whole-project restore, which
  reverts all other data and is not a realistic option. The protective
  controls are therefore all BEFORE the COMMIT: the export in step 3, the
  count verification in step 4, and the rule that ROLLBACK is the default
  and COMMIT requires exact-match counts.

## 5. Owner runbook: purge of explicitly identified TEST conversations

Every block below uses the same pinned-id CTE. Replace the placeholder UUIDs
with the authorized list from section 7 in every block, identically. Blocks
P1 through P3 and E1 are read-only. Only block X1 mutates, inside a
transaction whose default outcome is ROLLBACK.

### Step 0: scope pinning

The authorized UUID list is written into section 7 first. The same literal
list is used in every block. If at any step a result names a conversation,
participant, or count you did not expect: STOP, ROLLBACK if inside the
transaction, and record the discrepancy in section 7.

### Step 1 (P1): existence and identity precheck (read-only)

```sql
WITH pinned(conversation_id) AS (VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid)
)
SELECT p.conversation_id,
       c.id IS NOT NULL          AS exists,
       c.subject,
       c.category,
       c.status,
       c.related_student_id,
       c.created_at,
       c.last_message_at
FROM pinned p
LEFT JOIN public.conversations c ON c.id = p.conversation_id
ORDER BY p.conversation_id;
```

Every row must show `exists = true`. Any false row means a wrong UUID: STOP.
`related_student_id` must be NULL or a known test student; a real student id
disqualifies the conversation from this runbook.

### Step 2 (P2): participant confirmation (read-only)

```sql
WITH pinned(conversation_id) AS (VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid)
)
SELECT cp.conversation_id,
       cp.participant_role,
       cp.removed_at,
       up.full_name,
       up.email
FROM public.conversation_participants cp
JOIN pinned p ON p.conversation_id = cp.conversation_id
LEFT JOIN public.user_profiles up ON up.id = cp.participant_profile_id
ORDER BY cp.conversation_id, cp.participant_role;
```

Every listed email must be a known test account. One real person in the list
disqualifies the conversation: STOP and strike it from the pinned list.

### Step 3 (P3): impact preview and in-flight check (read-only)

```sql
WITH pinned(conversation_id) AS (VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid)
)
SELECT
  (SELECT count(*) FROM public.messages m
     WHERE m.conversation_id IN (SELECT conversation_id FROM pinned)) AS messages,
  (SELECT count(*) FROM public.conversation_events e
     WHERE e.conversation_id IN (SELECT conversation_id FROM pinned)) AS events,
  (SELECT count(*) FROM public.conversation_participants cp
     WHERE cp.conversation_id IN (SELECT conversation_id FROM pinned)) AS participants,
  (SELECT count(*) FROM public.message_notification_deliveries d
     WHERE d.conversation_id IN (SELECT conversation_id FROM pinned)) AS deliveries,
  (SELECT count(*) FROM public.message_notification_deliveries d
     WHERE d.conversation_id IN (SELECT conversation_id FROM pinned)
       AND d.queue_status NOT IN ('sent', 'failed', 'suppressed')) AS deliveries_not_final,
  (SELECT count(*) FROM public.message_creation_requests r
     WHERE r.conversation_id IN (SELECT conversation_id FROM pinned)
        OR r.message_id IN (SELECT id FROM public.messages
                            WHERE conversation_id IN (SELECT conversation_id FROM pinned))) AS creation_requests,
  (SELECT count(*) FROM public.staff_conversation_reads s
     WHERE s.conversation_id IN (SELECT conversation_id FROM pinned)) AS staff_reads,
  (SELECT count(*) FROM public.participant_conversation_reads pr
     WHERE pr.conversation_id IN (SELECT conversation_id FROM pinned)) AS participant_reads,
  (SELECT count(*) FROM public.message_conversation_visibility v
     WHERE v.conversation_id IN (SELECT conversation_id FROM pinned)) AS visibility_rows,
  (SELECT count(*) FROM public.message_reactions mr
     JOIN public.messages m ON m.id = mr.message_id
     WHERE m.conversation_id IN (SELECT conversation_id FROM pinned)) AS reaction_rows;
```

Record every number in section 7. If `deliveries_not_final` is greater than
zero, a notification job may still be in flight for a pinned conversation:
wait for it to reach a final state (or accept and record the interruption)
before proceeding. The final states are exactly the CHECK-constrained values
`sent`, `failed`, and `suppressed`; anything else (`queued`, `processing`,
`retry_wait`) means a job is still in flight.

### Step 4 (E1): export before deletion (read-only)

Run one full-row SELECT per table and save the results OUTSIDE this
repository (the export contains message bodies and participant identities;
never commit it, never paste it into a chat, never attach it to a ticket):

```sql
WITH pinned(conversation_id) AS (VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid)
)
SELECT 'conversations' AS t, to_jsonb(c.*) AS row
FROM public.conversations c WHERE c.id IN (SELECT conversation_id FROM pinned)
UNION ALL
SELECT 'conversation_participants', to_jsonb(cp.*)
FROM public.conversation_participants cp WHERE cp.conversation_id IN (SELECT conversation_id FROM pinned)
UNION ALL
SELECT 'messages', to_jsonb(m.*)
FROM public.messages m WHERE m.conversation_id IN (SELECT conversation_id FROM pinned)
UNION ALL
SELECT 'conversation_events', to_jsonb(e.*)
FROM public.conversation_events e WHERE e.conversation_id IN (SELECT conversation_id FROM pinned)
UNION ALL
SELECT 'message_notification_deliveries', to_jsonb(d.*)
FROM public.message_notification_deliveries d WHERE d.conversation_id IN (SELECT conversation_id FROM pinned)
UNION ALL
SELECT 'message_creation_requests', to_jsonb(r.*)
FROM public.message_creation_requests r
WHERE r.conversation_id IN (SELECT conversation_id FROM pinned)
   OR r.message_id IN (SELECT id FROM public.messages
                       WHERE conversation_id IN (SELECT conversation_id FROM pinned))
UNION ALL
SELECT 'staff_conversation_reads', to_jsonb(s.*)
FROM public.staff_conversation_reads s WHERE s.conversation_id IN (SELECT conversation_id FROM pinned)
UNION ALL
SELECT 'participant_conversation_reads', to_jsonb(pr.*)
FROM public.participant_conversation_reads pr WHERE pr.conversation_id IN (SELECT conversation_id FROM pinned)
UNION ALL
SELECT 'message_conversation_visibility', to_jsonb(v.*)
FROM public.message_conversation_visibility v WHERE v.conversation_id IN (SELECT conversation_id FROM pinned)
UNION ALL
SELECT 'message_reactions', to_jsonb(mr.*)
FROM public.message_reactions mr
WHERE mr.message_id IN (SELECT id FROM public.messages
                        WHERE conversation_id IN (SELECT conversation_id FROM pinned));
```

### Step 5 (X1): the purge transaction

Dependency order matters: the idempotency ledger and delivery rows RESTRICT
both `messages` and `conversations`, so they go first; `conversations` goes
last, and its deletion cascades the two read-pointer tables and the archive
visibility table. Deleting `messages` cascades `message_reactions`, so no
explicit reaction DELETE appears below; reaction rows are counted in step 3
and proven gone in step 6. Each DELETE returns its own count for comparison
against the step 3 preview.

```sql
BEGIN;

WITH pinned(conversation_id) AS (VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid)
),
del_requests AS (
  DELETE FROM public.message_creation_requests r
  WHERE r.conversation_id IN (SELECT conversation_id FROM pinned)
     OR r.message_id IN (SELECT id FROM public.messages
                         WHERE conversation_id IN (SELECT conversation_id FROM pinned))
  RETURNING 1
),
del_deliveries AS (
  DELETE FROM public.message_notification_deliveries d
  WHERE d.conversation_id IN (SELECT conversation_id FROM pinned)
  RETURNING 1
),
del_events AS (
  DELETE FROM public.conversation_events e
  WHERE e.conversation_id IN (SELECT conversation_id FROM pinned)
  RETURNING 1
),
del_messages AS (
  DELETE FROM public.messages m
  WHERE m.conversation_id IN (SELECT conversation_id FROM pinned)
  RETURNING 1
),
del_participants AS (
  DELETE FROM public.conversation_participants cp
  WHERE cp.conversation_id IN (SELECT conversation_id FROM pinned)
  RETURNING 1
),
del_conversations AS (
  DELETE FROM public.conversations c
  WHERE c.id IN (SELECT conversation_id FROM pinned)
  RETURNING 1
)
SELECT
  (SELECT count(*) FROM del_requests)      AS creation_requests_deleted,
  (SELECT count(*) FROM del_deliveries)    AS deliveries_deleted,
  (SELECT count(*) FROM del_events)        AS events_deleted,
  (SELECT count(*) FROM del_messages)      AS messages_deleted,
  (SELECT count(*) FROM del_participants)  AS participants_deleted,
  (SELECT count(*) FROM del_conversations) AS conversations_deleted;

-- DECISION POINT. Compare every count against the step 3 preview and the
-- pinned-list length (conversations_deleted must equal the number of pinned
-- ids exactly). The DEFAULT next statement is:
--
--   ROLLBACK;
--
-- Issue COMMIT only when every count matches exactly:
--
--   COMMIT;
```

Do not COMMIT on "close enough." A single unexpected count means something in
the pinned set changed between preview and execution (for example a new test
reply); ROLLBACK, rerun step 3, and start over.

### Step 6 (V1): post-commit verification (read-only, fresh session)

```sql
WITH pinned(conversation_id) AS (VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid)
)
SELECT
  (SELECT count(*) FROM public.conversations c
     WHERE c.id IN (SELECT conversation_id FROM pinned)) AS conversations_remaining,
  (SELECT count(*) FROM public.messages m
     WHERE m.conversation_id IN (SELECT conversation_id FROM pinned)) AS messages_remaining,
  (SELECT count(*) FROM public.conversation_events e
     WHERE e.conversation_id IN (SELECT conversation_id FROM pinned)) AS events_remaining,
  (SELECT count(*) FROM public.conversation_participants cp
     WHERE cp.conversation_id IN (SELECT conversation_id FROM pinned)) AS participants_remaining,
  (SELECT count(*) FROM public.message_notification_deliveries d
     WHERE d.conversation_id IN (SELECT conversation_id FROM pinned)) AS deliveries_remaining,
  (SELECT count(*) FROM public.message_creation_requests r
     WHERE r.conversation_id IN (SELECT conversation_id FROM pinned)) AS creation_requests_remaining,
  (SELECT count(*) FROM public.staff_conversation_reads s
     WHERE s.conversation_id IN (SELECT conversation_id FROM pinned)) AS staff_reads_remaining,
  (SELECT count(*) FROM public.participant_conversation_reads pr
     WHERE pr.conversation_id IN (SELECT conversation_id FROM pinned)) AS participant_reads_remaining,
  (SELECT count(*) FROM public.message_conversation_visibility v
     WHERE v.conversation_id IN (SELECT conversation_id FROM pinned)) AS visibility_remaining,
  (SELECT count(*) FROM public.message_reactions mr
     JOIN public.messages m ON m.id = mr.message_id
     WHERE m.conversation_id IN (SELECT conversation_id FROM pinned)) AS reactions_remaining;
```

Every column must be zero, including the three CASCADE tables. No application
deploy is needed: every list surface derives from these tables through the
participant-gated RPCs, so purged conversations simply stop appearing, and a
client holding a purged thread open receives an empty or not-found result on
its next fetch.

### Step 7: record

Append the execution record to section 7: date, operator, the exact UUID
list, the step 3 preview numbers, the step 5 deleted counts, COMMIT or
ROLLBACK, the step 6 zeros, and where the step 4 export is stored.

## 6. Issues reviewed before prescribing the runbook

Reported per the task's report-before-prescribe requirement. None blocks a
test-conversation purge under the controls above:

1. No in-app audit survives: `conversation_events` is deleted with its
   conversation and cannot log its own purge. Mitigated by the section 7
   execution record and retained `notification_log` rows.
2. Idempotency ledger loss: `message_creation_requests` rows must be deleted
   (RESTRICT FKs plus the completed-row consistency CHECK). Accepted for test
   data; the export preserves the rows.
3. No usable rollback after COMMIT: PITR, where enabled, is whole-database.
   Mitigated by export-first and ROLLBACK-by-default.
4. Residual metadata: `notification_log` (subject line, conversation UUID in
   metadata) and Resend provider logs survive. Acceptable for test purges;
   MUST be separately assessed for any legal-erasure case (section 1c).
5. In-flight deliveries: a queued or retrying notification job for a pinned
   conversation would fail mid-purge; the step 3 `deliveries_not_final` check
   exists for this.
6. Concurrent writes between preview and purge shift the counts; the step 5
   exact-match rule turns that race into a forced ROLLBACK instead of a
   silent partial surprise.

## 7. Authorization and execution records

No purge has been authorized or executed as of 2026-07-29. Records are
appended here, one entry per purge, before (authorization) and after
(execution) each run.
