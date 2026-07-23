# General ASPIRE Team Threads Backend Handoff

## Product model

General ASPIRE Team threads are portal-user-to-ASPIRE Team conversations with no student context and no arbitrary unit context. A thread is created only when the first message is successfully sent. Opening Messages, clicking New, or canceling compose must not create anything.

Multiple general threads may coexist for the same portal user. Student-linked and direct-student threads remain separate.

## Endpoint contract

New endpoint:

`POST /api/portal/team-messages-start`

Accepted JSON body:

```json
{
  "request_id": "<uuid>",
  "body": "<first message>"
}
```

The browser must not send `student_id`, `unit_key`, `school_key`, `role`, `portal_type`, `profile_id`, `actor_profile_id`, `destination`, `category`, or `subject`.

The server derives the authenticated profile, actor kind, subject, category, destination, notification routing, and thread classification. The subject is derived from the first non-empty line of the normalized first message, bounded to the existing 120-character subject limit, with `Message to ASPIRE Team` as fallback. Category is always `General question`.

## Authorization

Students may create a general ASPIRE Team thread when their existing Student portal authorization is active.

Unit Leaders may create a general ASPIRE Team thread when they have an active `unit_leader` role grant and at least one active `user_unit_scopes` row. The general thread does not store a unit key, and the server never chooses one when the caller has multiple units.

Academic Partner Messages remain excluded. Generic staff, interviewer, viewer, co-lead, and unauthenticated callers are not admitted by this endpoint.

## Idempotency ledger

Migration:

`supabase/migrations/20260724000001_general_team_threads_backend.sql`

The migration creates `message_creation_requests`, scoped by:

- `actor_profile_id`
- `operation_kind`
- `request_id`

It stores an opaque `payload_fingerprint`, `conversation_id`, `message_id`, `delivery_id`, and timestamps. The ledger stores no message body and no delivery routing payload.

Same actor plus same request id plus same normalized payload returns the original result. Same actor plus same request id plus different payload returns conflict. Different actors may reuse the same request id.

## Transaction/RPC

New service-role-only RPC:

`messages_start_general_team_conversation(uuid, text, uuid, text, text, text, text, jsonb)`

The RPC transactionally creates:

- conversation
- participant
- first message
- created event
- sender read pointer
- notification delivery row
- completed idempotency result

Rate limits are consumed inside the RPC only for newly inserted requests. Idempotent replays return before rate-limit consumption and before any delivery duplication.

## Participant shape

General Student thread:

- one `student` participant
- `scope_kind = 'student'`
- `scope_student_id IS NULL`
- no related student/unit/school/cohort context

General Unit Leader thread:

- one `unit_leader` participant
- `scope_kind = 'unit'`
- `scope_unit_key IS NULL`
- no related student/unit/school/cohort context

Student-linked Unit Leader concern threads and direct-student threads keep their existing context-bearing shapes.

## Thread classification

Portal list and thread responses now attach explicit metadata after the caller-scoped read RPC has authorized the row:

- `thread_kind: 'team_general'`
- `thread_kind: 'team_student_context'`
- `thread_kind: 'direct_student'`

Safe display metadata may include:

- `context_student_id`
- `context_student_name`
- `context_label`

`direct_student_name` is preserved for the current Unit Leader UI, but future UI should prefer `thread_kind`.

## Notification behavior

The first message uses the existing Messages delivery/outbox system and the `new_conversation` event type. Sender and Reply-To behavior are unchanged. Idempotent replay does not attempt another notification send.

## Existing flows preserved

The pass does not remove or repurpose:

- `POST /api/portal/messages-start`
- `POST /api/portal/unit-messages-start`
- Unit Leader concern threads
- direct-student threads
- replies
- mark-read
- unread count

## Manual SQL application order

1. Confirm production includes `f261947`.
2. Confirm all prior Messages and Unit Leader migrations through `20260720000002_unit_leader_notifications_and_concerns.sql` are applied.
3. Run the read-only preflight in `db/audit/general_team_threads_backend_preflight_and_verification.sql`.
4. Apply `supabase/migrations/20260724000001_general_team_threads_backend.sql` as one transaction.
5. Run the same audit file again and verify the post-SQL checks.

## Later UI dependency

The shared docked Messages refinement should switch thread creation to `startGeneralTeamConversation({ requestId, body })`, generate a stable request id per compose attempt, and use `thread_kind` rather than `!direct_student_name` to distinguish general, student-context, and direct-student threads.

Do not enable Academic Partner Messages as part of that UI pass.
