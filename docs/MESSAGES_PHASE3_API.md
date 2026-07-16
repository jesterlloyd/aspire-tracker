# ASPIRE Messages, Phase 3: Backend Conversation and Unread APIs

Phase 3 makes the Phase 1 conversation schema and the Phase 2 notification and
rate-limit foundation usable by future staff and portal interfaces. No staff or
portal user interface is built in this phase.

Phase 3 is delivered in two stages.

- Stage A (this document, done first): the API database foundation. One
  migration, one read-only verification file, static tests, and this document.
- Stage B (blocked until Stage A is applied and verified live): the server API
  handlers, the service layer, notification and rate-limit integration, API
  tests, and the API documentation.

Stage A files:
- Migration: `supabase/migrations/20260716000002_messages_phase3_api_foundation.sql`
- Verification: `db/audit/messages_phase3_verification.sql` (run after applying)
- Tests: `test/messagesPhase3ApiFoundation.test.mjs`

## Why a migration is required

Stage A is not optional. Three gaps in the live schema make it necessary:

1. `conversation_events.chk_conversation_events_type` accepts only `created`,
   `status_change`, `assignment_change`, `resolved`, `reopened`, `flagged`, and
   `participant_access_changed`. Staff category changes need auditable history,
   and overloading an unrelated event type is not acceptable, so the constraint
   is widened with `category_change`.
2. Portal users have no base-table read path. Phase 1 deliberately created only
   active Owner/Admin SELECT policies. Portal reads therefore need authenticated
   SECURITY DEFINER read RPCs.
3. No transactional write boundary exists. The approved atomic invariants
   (conversation, participant, message, event, sender read pointer, and the
   durable queued delivery row created together) cannot be satisfied by a
   sequence of client-side inserts.

No new table is created. The Phase 1 and Phase 2 migrations are not modified.

## What Stage A adds

### 1. Auditable category changes

The `conversation_events` event-type constraint is swapped for one that adds
`category_change` and keeps all seven original values. This is a constraint swap
only: no data change, and every existing row stays valid.

### 2. Explicit-profile authorization helpers (service-role only)

The existing `is_active_owner_or_admin()` and `portal_profile_id()` evaluate the
current authenticated caller. A service-role transactional RPC has no portal or
staff identity, so it cannot use them to validate an actor. This is the same
lesson Phase 2 applied to `message_recipient_has_active_access`. Stage A adds:

- `message_profile_is_active_owner_or_admin(p_profile_id)`: active Owner/Admin by
  explicit profile id.
- `message_profile_has_active_student_link(p_profile_id, p_student_id)`: active
  student role grant plus active `user_student_links` row, using the canonical
  active predicate. Used when starting a conversation, where no participant row
  exists yet.

### 3. Transactional write RPCs (service-role only)

Each RPC is one atomic boundary: all of its inserts and updates commit or roll
back together, so a conversation can never be left partially created. Each
re-validates authorization from the passed, server-verified `user_profiles.id`.
Nothing is trusted from a client body.

- `messages_start_conversation(actor, actor_kind, participant, student, subject,
  category, body, delivery)`: creates the conversation, the student participant,
  the initial message, the `created` event, the sender's read pointer, and the
  durable queued delivery row.
- `messages_post_reply(actor, actor_kind, conversation, body, delivery)`:
  reopens a resolved conversation (status to open, `resolved_at` cleared,
  `reopened` event), appends the message, updates `last_message_at` and
  `updated_at`, advances only the sender's read pointer, and queues the delivery.
- `messages_mark_read(actor, actor_kind, conversation)`: advances only the
  caller's own pointer to a server-derived timestamp (latest message time, else
  now). A client timestamp is never accepted.
- `messages_set_assignment(actor, conversation, assignee)`: assignee must be an
  active Owner/Admin; records an `assignment_change` event. Assignment never
  grants access and never sends email.
- `messages_set_status(actor, conversation, status)`: open, waiting, or
  resolved; sets or clears `resolved_at` to satisfy the Phase 1 consistency
  constraint; records `resolved`, `reopened`, or `status_change`. Resolution is
  silent.
- `messages_set_category(actor, conversation, category)`: null or one approved
  category; records a `category_change` event.
- `messages_set_follow_up(actor, conversation, flagged)`: keeps
  `follow_up_flagged`, `follow_up_flagged_by`, and `follow_up_flagged_at`
  internally consistent; records a `flagged` event. No email.

Custom 5-character SQLSTATEs map to HTTP: `MS400` to 422, `MS403` to 403, `MS404`
to 404, `MS409` to 409. This mirrors the PT400/PT404/PT409 convention used by the
portal access lifecycle RPCs.

### 4. Authenticated read RPCs

These resolve the current authenticated caller, so the API calls them with a
user-scoped client. Base tables keep their Phase 1 deny-by-default posture: no
new portal base-table policy is added.

- `messages_portal_list_conversations(limit, cursor_ts, cursor_id)`: scoped by
  `my_message_conversation_ids()`, newest first.
- `messages_portal_get_thread(conversation, limit, cursor_ts, cursor_id)`:
  returns NULL for an inaccessible or missing conversation (non-enumerating).
- `messages_portal_unread_count()`.
- `messages_staff_list_conversations(limit, cursor_ts, cursor_id, status,
  assignee, category, flagged, search)`: gated on `is_active_owner_or_admin()`.
- `messages_staff_get_thread(conversation, limit, cursor_ts, cursor_id)`.
- `messages_staff_unread_count()`.
- `message_portal_status_label(status)`: pure mapping, open/waiting to `Open`,
  resolved to `Closed`.

## Access model

Portal access requires an authenticated user resolved through
`user_profiles.auth_user_id`, an active student role grant, an active
`user_student_links` row, an active participant row with `participant_role =
student` and `scope_kind = student`, and a participant scope matching the active
student link. All of this is enforced by `my_message_conversation_ids()` (reads)
and `message_recipient_has_active_access()` / `message_profile_has_active_student_link()`
(writes).

Staff access requires an authenticated active Owner or Admin. `is_staff()` is
never used, so interviewer, viewer, inactive Owner, inactive Admin, and
portal-only profiles cannot reach staff Messages functions.

Version one authorizes the student portal role only. `unit_leader`,
`academic_partner`, and `preceptor` remain schema reservations with no active
authorization branch.

Assignment never grants authorization. `related_student_id`, `related_unit_key`,
`related_school_key`, and `related_cohort_id` are staff context for display only
and never appear in an authorization predicate.

## Three-identity model

`auth.users.id`, `user_profiles.auth_user_id`, and `user_profiles.id` remain
distinct. Every actor, participant, assignee, reader, event actor, and
rate-limit identity is a `user_profiles.id`. No profile id is compared to
`auth.uid()`. Callers are resolved through `portal_profile_id()` (reads) or the
server-verified profile passed by the API (writes).

## Read and unread rules

Portal unread counts staff-authored messages created after the participant's
`last_read_at`, in accessible conversations only. Staff unread counts
portal-authored messages (`author_role <> 'staff'`) created after that staff
member's own `last_read_at`. Read state stays per-user: one staff member reading
never clears another's unread, and a participant reading never affects staff
unread. A sender's write advances only the sender's own pointer.

## Pagination

Cursor-based. Conversations use `(last_message_at, id)` descending; messages use
`(created_at, id)` ascending. Limits are capped in the RPC (default 25 and 50,
maximum 100). A malformed or partial cursor is rejected by the API layer.

## Privacy

Messages are plain text. The latest-message preview is returned only inside the
authenticated portal or staff response and is truncated; it is never written to
email, delivery metadata, or logs. Staff email addresses are never exposed to the
portal: staff messages display as `ASPIRE Team` with an optional staff full name
beneath. No message body enters any log.

## Grants

Write RPCs and the explicit-profile helpers: `REVOKE ALL FROM PUBLIC, anon,
authenticated` and `GRANT EXECUTE TO service_role` only. Read RPCs: `REVOKE ALL
FROM PUBLIC, anon` and `GRANT EXECUTE TO authenticated, service_role`. Every
function is SECURITY DEFINER with `SET search_path = public, pg_catalog`,
following the Wave F-1 hardening conventions.

## Manual Owner SQL gate

The Stage A migration is committed and pushed before it is applied. The Owner
runs it whole, as one block, in the Supabase SQL editor, then runs
`db/audit/messages_phase3_verification.sql` (read-only) to confirm the event-type
widening, the function inventory, the security mode and search_path, the grant
posture, the absence of new tables and portal base-table policies, and that
`is_staff()` is used nowhere. The committed migration is not modified after it is
applied.

## Stage A corrective migration (delivery invariant fix)

Migration `20260716000002_messages_phase3_api_foundation.sql` was applied
successfully and is now locked. Verification of the applied definitions then
exposed a transactional invariant gap that must be closed before any API
deployment.

### The defect

The applied `messages_start_conversation()` and `messages_post_reply()` guarded
the durable delivery insert with:

```
IF p_delivery IS NOT NULL AND p_delivery ? 'idempotency_key' THEN
  INSERT INTO message_notification_deliveries (...)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_delivery_id;
END IF;
```

That permits four ways to commit an authoritative message with no delivery row:
a null `p_delivery`, a `p_delivery` missing `idempotency_key`, a silently ignored
conflict, and a `v_delivery_id` that was never asserted non-null. The approved
invariant is that starting a conversation and posting a reply must atomically
create the durable queued delivery row. A server-side promise to always pass a
valid payload is not sufficient, because the RPC is the transaction boundary that
must enforce the invariant.

The other five write RPCs (`messages_mark_read`, `messages_set_assignment`,
`messages_set_status`, `messages_set_category`, `messages_set_follow_up`) were
reviewed for the same class of problem. They create no delivery rows by design
(assignment, status, category, flag, and read changes send no email; resolution
is silent), and each performs its update and its audit-event insert
unconditionally after authorization. No similar gap exists.

### The correction

`supabase/migrations/20260716000003_messages_phase3_delivery_invariant_fix.sql`
uses `CREATE OR REPLACE FUNCTION` on only the two affected RPCs (same signatures,
so grants are preserved) and adds one helper,
`message_assert_valid_delivery(p_delivery, p_expected_event, p_actor_profile_id)`
(SECURITY DEFINER, fixed search_path, service-role only). The corrected RPCs now:

- require a non-null delivery object and reject a missing or blank
  `idempotency_key` or `recipient_email`
- reject an invalid `recipient_kind` or `event_type`, and require the event type
  appropriate to the operation (student start is `new_conversation`, staff start
  is `staff_reply`, student reply is `portal_reply`, staff reply is
  `staff_reply`)
- enforce the approved Phase 2 routing shape: `new_conversation` to
  `shared_inbox`, `portal_reply` to `shared_inbox` or `assigned_staff`,
  `staff_reply` to `portal_user` with a required `recipient_profile_id` that must
  match the conversation's active participant
- reject the sender being the recipient
- require the safe snapshot and CTA fields, and reject any body-like key
  (`body`, `preview`, `snippet`, `content`, `html`, `text`, `quote`, `quoted`)
- validate before any authoritative write, so an invalid payload creates nothing
- insert the delivery with **no** `ON CONFLICT DO NOTHING`. Because the message is
  new inside the transaction, an existing row for that key can never legitimately
  belong to it, so a unique violation raises `MS409` and rolls the whole
  transaction back rather than committing a message with no delivery record
- assert a non-null `delivery_id` and return it

Everything else is preserved: the 5000-character body limit, the 3 to 120
character subject rule, every authorization check, sender-only read-pointer
updates, automatic reopening with its `reopened` audit event, and the append-only
message model. Phase 2 routing is not duplicated in SQL; Stage B still computes
routing and the idempotency key with the Phase 2 modules, and the RPC only
enforces that what arrives is internally consistent and actually persisted.

The unique idempotency guarantee is unchanged: one successful authoritative
message has exactly one durable delivery row, with no duplicate enqueue and no
silent omission.

Corrective verification:
`db/audit/messages_phase3_delivery_invariant_verification.sql` (read-only).
Corrective tests: `test/messagesPhase3DeliveryInvariant.test.mjs`.

### Two verification clarifications

- **`message_archive` is pre-existing and unrelated.** It was created on
  2026-06-25 by `supabase/migrations/20260625000000_message_archive.sql`
  (SENT-HISTORY-PHASE2A) and stores redacted rendered bodies of manual ASPIRE
  Connect Outreach emails, one row per `notification_log` row. It is not part of
  ASPIRE Messages, and neither Phase 3 migration created, modified, or references
  it. The nine-versus-eight table count came from an over-broad
  `LIKE 'message%'` pattern in verification query 9, which now lists the eight
  ASPIRE Messages tables explicitly and documents the exclusion.
- **Audit 7 is an inspection, not a zero-row guard.** It lists any Phase 3
  function that mentions related context or assignment so each reference can be
  confirmed as a projection, a filter, or a write rather than an authorization
  gate. The four returned rows (`messages_start_conversation`,
  `messages_set_assignment`, `messages_staff_list_conversations`,
  `messages_staff_get_thread`) were each reviewed and are correct: context is
  written or projected for display, and `p_assignee` is a caller filter that
  narrows an already-authorized result set. Authorization remains
  `message_profile_is_active_owner_or_admin()`, `is_active_owner_or_admin()`, or
  `message_profile_has_active_student_link()`. The audit's expectation text has
  been corrected to name all four.

## Stage B remains blocked

Stage B (portal and staff API handlers, the service layer, notification and
rate-limit integration, API tests, and the API documentation) does not begin
until the Owner confirms the Stage A SQL is applied and verified live. No staff
or portal user interface is built in Phase 3. Phase 4 is out of scope.
