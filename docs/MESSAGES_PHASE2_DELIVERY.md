# ASPIRE Messages, Phase 2: Notification Delivery and Rate-Limit Foundation

Phase 2 builds the durable notification-delivery and portal-user rate-limit
foundation for ASPIRE Messages. It is delivered in two stages.

- Stage A (this document, done first): the database foundation. One migration,
  one read-only verification file, static tests, and this document. No server
  code, cron, Resend, webhook, API, or UI.
- Stage B (blocked until Stage A is applied and verified live): the server-side
  delivery helper, routing, retry worker, Resend webhook reconciliation, and the
  portal-user rate-limit server utility. Stage B is not started until the Owner
  confirms the Stage A SQL is applied and verified.

Stage A files:
- Migration: `supabase/migrations/20260716000001_messages_phase2_notification_delivery_foundation.sql`
- Verification: `db/audit/messages_phase2_verification.sql` (run after applying)
- Tests: `test/messagesPhase2DeliveryFoundation.test.mjs`

## Core principle: the in-app message is authoritative

The conversation and message rows (Phase 1) are the record of truth. Email is a
notification only. A durable delivery row is created before any email attempt
(enqueue before send), and an email failure never rolls back, alters, or deletes
an in-app message. No message body, preview, snippet, or free-form content is
ever stored in the delivery row, a rate-limit row, notification logs, cron logs,
error logs, or webhook logs.

## Queue status versus provider status

The delivery row separates two independent lifecycles into two columns.

- `queue_status` is the retry workflow: `queued`, `processing`, `retry_wait`,
  `sent`, `failed`, `suppressed`.
  - `queued`: ready for an initial attempt.
  - `processing`: atomically claimed by exactly one worker (carries `locked_at`
    and `locked_by`).
  - `retry_wait`: a prior attempt failed but the row is eligible for another
    attempt at `next_attempt_at`.
  - `sent`: accepted by Resend.
  - `failed`: retry limit exhausted or a permanent error. Not retryable.
  - `suppressed`: intentionally not sent because routing deduplication or
    recipient gating prevented delivery. Not retryable.
- `provider_status` is the Resend lifecycle, reconciled by the webhook in Stage
  B: `sent`, `delivered`, `opened`, `clicked`, `bounced`, `complained`. It is
  nullable until the first provider event.

A provider event updates `provider_status` only and never moves `queue_status`
backward. A delivered, opened, or clicked webhook must never return a `sent`
queue state to `queued`, `processing`, or `retry_wait`.

Constraints enforce the separation: `retry_wait` rows must carry
`next_attempt_at`; `sent`, `failed`, and `suppressed` rows must have
`next_attempt_at` null (they are not retryable); `processing` rows must carry an
active claim.

## Durable enqueue-before-send ordering

The mandatory order (Stage B implements steps 3 through 8):

1. the future API saves the authoritative conversation and message
2. the future API updates unread state
3. the helper creates or retrieves the queued delivery row
4. the helper atomically claims the row
5. the helper attempts the awaited Resend send
6. the helper records the notification_log result
7. the helper updates queue state and `resend_email_id`
8. the webhook later updates `provider_status`

## Deterministic idempotency

`idempotency_key` is `NOT NULL UNIQUE`, so one logical notification creates at
most one durable row and a duplicate enqueue for the same key is rejected. Stage
B composes the key from the logical event and the actual recipient identity:
`event_type` + `conversation_id` + `message_id` (where applicable) + normalized
recipient identity. For a shared-inbox delivery the normalized identity is the
normalized email address; for assigned staff and portal users it includes
`recipient_profile_id` plus the normalized email. The key therefore distinguishes
different recipients of the same event.

## Atomic claiming

`public.claim_due_message_notification_deliveries(p_worker, p_limit,
p_stale_seconds)` is service-role only. It first recovers stale `processing`
claims older than `p_stale_seconds` back to `retry_wait` (due now, lock cleared,
only while attempts remain), then atomically claims up to `p_limit` due rows
(`queued` or `retry_wait`, `next_attempt_at` due or null) using `FOR UPDATE SKIP
LOCKED` and marks them `processing` under `p_worker`. Overlapping cron runs or
simultaneous requests can never claim the same row. Terminal rows are never
claimed.

## Bounded retries and provider idempotency

Retries are bounded: `max_attempts` defaults to 5 and is capped at 10; `attempts`
is non-negative and cannot exceed `max_attempts`. Stage B applies a simple
documented backoff via `next_attempt_at`.

The installed Resend SDK (v6.12.3) supports an `Idempotency-Key` header through
the `idempotencyKey` request option (verified in the installed SDK types and
client, and reflected in the SDK error codes `invalid_idempotency_key` and
`concurrent_idempotent_requests`). Stage B will reuse the durable
`idempotency_key` (or a safe provider-specific derivative) as the provider
idempotency key.

Honest guarantee: the application guarantees one durable row per logical
notification, no duplicate enqueue for the same key, one active worker claim at a
time, and bounded retries, plus best-available provider deduplication within
Resend's idempotency window. It does not mathematically guarantee exactly-once
external email delivery after an ambiguous network failure (a send that times out
after Resend accepted it). Provider idempotency reduces, but cannot fully
eliminate, that residual duplicate-delivery risk.

## Active portal-recipient gating

`public.message_recipient_has_active_access(p_conversation_id, p_profile_id)` is
service-role only and answers whether an explicit participant profile currently
has active access to a conversation. It does not use `portal_profile_id()` or
`has_active_role_grant()` (both evaluate the current authenticated caller, which a
service-role worker is not). For Student Portal version one it confirms: the
participant matches, `participant_role = student`, `scope_kind = student`,
`removed_at IS NULL`, an active student role grant (`revoked_at IS NULL`,
`starts_at <= now()`, `expires_at IS NULL OR expires_at > now()`), and an active
`user_student_links` row matching the participant's `scope_student_id`. It never
authorizes through conversation id alone, `related_student_id`,
`related_unit_key`, `related_school_key`, `related_cohort_id`,
`assigned_staff_profile_id`, or email presence. It is for recipient eligibility
only and exposes no conversation rows.

## User-profile rate limiting

`public.consume_message_rate_limit(p_profile_id, p_action_kind, p_window_seconds,
p_max_per_window)` is service-role only. It is passed a server-verified
`user_profiles.id` (never a client-supplied id), atomically consumes the window,
fails closed on invalid parameters, and returns jsonb `{allowed, action_kind,
limit, remaining, reset_at, retry_after_seconds}` so a future API can produce a
429. Counters live in `public.message_rate_limit_counters`, keyed by
`(profile_id, action_kind)`, never by an IP hash. Windows and limits are bounded
(window at most 3600 seconds, limit at most 1000) with bounded opportunistic
cleanup of stale rows.

Approved configurable limits (applied by Stage B callers):

- 5 new conversations per profile per 3600 seconds (`action_kind =
  new_conversation`).
- 20 messages per profile per 600 seconds (`action_kind = message`).

The 5000-character message limit is already enforced by the Phase 1 `messages`
body constraint. Phase 2 does not create any API endpoint.

## No message-body persistence

There is no body, preview, snippet, content, or free-form metadata column on the
delivery table or the counters table. The delivery row persists only an explicit
safe snapshot for retry rendering: `snapshot_sender_name`, `snapshot_subject`,
`snapshot_category`, and `cta_path` (a route, not a token). Stage B will never
write message text into any snapshot, log, or email preview.

## RLS and privileges

- `message_notification_deliveries`: RLS enabled. anon none; authenticated
  SELECT only, restricted by the `mnd_staff_select` policy to active Owner/Admin
  via `is_active_owner_or_admin()` for observability; service_role
  SELECT/INSERT/UPDATE, never DELETE or TRUNCATE. No mutation policy and no
  portal policy.
- `message_rate_limit_counters`: RLS enabled with no policies. anon and
  authenticated have zero privileges; service_role holds the CRUD the consume
  function uses; no TRUNCATE.
- All three functions are SECURITY DEFINER with fixed `search_path = public,
  pg_catalog`, REVOKE from PUBLIC/anon/authenticated, EXECUTE to service_role
  only, following the Wave F-1 hardening conventions.

## Manual Owner SQL gate

The Stage A migration is committed and pushed before it is applied. It is not
applied by the repository tooling. The Owner runs the migration file whole, as
one block, in the Supabase SQL editor, then runs
`db/audit/messages_phase2_verification.sql` (read-only) to confirm the tables,
RLS, constraints, function security, grants, the queue/provider separation, and
the no-body posture. The committed migration is not modified after it is applied.

## Stage B remains blocked

Stage B (server helper, routing, retry worker, webhook reconciliation, and the
rate-limit server utility) does not begin until the Owner confirms the Stage A
SQL is applied and verified live. No conversation API or user interface is built
in Phase 2. Phase 3 backend APIs are out of scope.
