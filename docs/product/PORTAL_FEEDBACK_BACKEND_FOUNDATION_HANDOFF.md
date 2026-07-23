# Portal Feedback Backend Foundation Handoff

## Architecture

This pass adds the dormant backend foundation for ASPIRE portal feedback and bug reports. The implementation is role-neutral at the storage and service layers, with a Unit Leader-only endpoint adapter for the first active release.

The boundary is:

1. shared validation and payload fingerprinting in `lib/server/portalFeedback/validation.js`,
2. verified reporter context from the portal endpoint adapter,
3. atomic database submission through `submit_portal_feedback_report`,
4. purpose-specific delivery/outbox processing through `portal_feedback_deliveries`,
5. retry worker processing through `/api/cron/portal-feedback-delivery-worker`,
6. dormant browser helpers in `src/lib/portalFeedbackApiClient.js`.

No portal launcher, floating control, desktop notice, navigation item, Student feedback UI, Unit Leader feedback UI, or Academic Partner feedback UI is mounted in this pass.

## Migration Contents

SQL is authored in:

`supabase/migrations/20260724000000_portal_feedback_backend_foundation.sql`

Jester should apply the full file manually in the Supabase SQL editor. Codex did not execute SQL locally.

The migration creates:

- `portal_feedback_submissions`: authoritative durable record for feedback and bug reports.
- `portal_feedback_deliveries`: purpose-specific retryable email outbox.
- `portal_feedback_rate_limits`: purpose-specific per-profile rate limiter.
- `submit_portal_feedback_report(jsonb, jsonb, text)`: service-role-only atomic submitter.
- `claim_due_portal_feedback_deliveries(text, integer, integer)`: service-role-only worker claim function.

## Table Responsibilities

`portal_feedback_submissions` is the source of truth. It stores the server-derived reporter profile, portal role, portal type, normalized route metadata, submission type, text fields, optional bug fields, payload fingerprint, review status, and timestamps.

`portal_feedback_deliveries` is notification state only. It stores the recipient, delivery status, attempts, retry time, lease fields, safe error code, and Resend correlation id. The report body remains in the authoritative submission row.

`portal_feedback_rate_limits` tracks accepted submissions by server-verified `user_profiles.id`, with a default limit of 5 accepted submissions per one-hour window.

## Endpoint Contract

`POST /api/portal/feedback-submit`

The browser may send only:

- `request_id`
- `type`
- `message`
- `pathname`
- `section`
- `build_sha`
- `environment`
- bug-only: `expected_behavior`, `actual_behavior`, `reproduction_steps`, `viewport_width`, `viewport_height`

The server rejects unexpected fields, including client-supplied identity or authority such as `profile_id`, `user_id`, `role`, `unit`, `school`, `student_id`, `actor_profile_id`, or `email`.

The endpoint sets `Cache-Control: no-store`, accepts JSON only, enforces a 64 KB body limit, normalizes plain text, rejects HTML-like text, bounds field lengths, and returns stable application error codes.

## Unit Leader-Only Active Authorization

This pass accepts only a currently authenticated Unit Leader with an active role grant and at least one active Unit Leader scope.

The endpoint uses `verifyPortalUnitLeaderCaller()` and derives:

- reporter profile id,
- display name,
- email,
- `portal_role = unit_leader`,
- `portal_type = unit_leader`.

No client-supplied role, profile, unit, school, or scope data is trusted.

## Role-Neutral Future Extension Point

Future Student or Academic Partner feedback support should add a new verified reporter-context adapter that calls the same `submitPortalFeedback()` service with:

- `profileId`
- optional display name/email
- `portalRole`
- `portalType`

That future adapter should not duplicate validation, idempotency, rate limiting, delivery, or schema. This pass intentionally does not add Academic Partner auth predicates, Academic Partner Messages, Academic Partner APIs, Academic Partner controls, Academic Partner desktop notice, or Academic Partner table repairs.

## Idempotency

The client supplies a stable `request_id`; the server normalizes the allowlisted payload and computes a SHA-256 payload fingerprint.

The database enforces `UNIQUE (reporter_profile_id, request_id)`.

Semantics:

- same reporter + same request id + same normalized payload returns the original submission,
- same reporter + same request id + different normalized payload returns conflict,
- different reporters cannot collide,
- replay does not create another authoritative submission,
- replay does not create another delivery row,
- failure after persistence leaves the original delivery row retryable.

## Rate Limiting

`submit_portal_feedback_report` consumes the `portal_feedback_submission` rate limit only when creating a new accepted submission. The default is 5 accepted submissions per reporter profile per one-hour window.

The limiter is implemented with an atomic upsert on `portal_feedback_rate_limits`, keyed by `reporter_profile_id` and `action_kind`.

## Privacy Allowlist

Stored context is limited to:

- server-derived profile id,
- optional server-resolved display name/email,
- server-derived portal role and portal type,
- normalized pathname,
- current section,
- build SHA,
- environment,
- authoritative server timestamp,
- bug-only viewport dimensions and plain-text bug fields.

This pass does not collect user agent, IP address, selected unit lists, school scope lists, student IDs, preceptor IDs, message thread IDs, message content, evaluation content, page form data, failed request payloads, raw browser console output, screenshots, attachments, access tokens, secret headers, or raw database/provider errors.

Logs must not contain report text.

## Email Delivery

The notification goes to `aspire@cshs.org` using the approved constants from `lib/server/messages/config.js`:

- `MESSAGE_FROM`
- `MESSAGE_REPLY_TO`
- `SHARED_INBOX_EMAIL`

The email includes a plain-text alternative and escaped HTML. A report is considered submitted when the authoritative database record is committed; email delivery is notification-only and remains retryable through the outbox.

## Worker And Retry Behavior

`/api/cron/portal-feedback-delivery-worker` is protected by `Authorization: Bearer ${CRON_SECRET}` and records `cron_runs` observability using existing conventions.

The worker calls `claim_due_portal_feedback_deliveries`, which:

- recovers stale processing leases,
- claims a bounded due batch,
- uses `FOR UPDATE SKIP LOCKED`,
- never claims terminal rows.

Retries use bounded backoff. Delivery states are `pending`, `processing`, `sent`, `retryable_failure`, and `permanent_failure`.

No external schedule was added in this pass. Deployment should add a Vercel cron only after the migration is applied and the endpoint is ready to receive live submissions.

## Attachments Deferred

Screenshots, pasted images, and file attachments are intentionally deferred. There is no generic upload, malware scanning, retention, or review workflow in this pass.

## SQL Application Order

1. Apply `supabase/migrations/20260724000000_portal_feedback_backend_foundation.sql` as one transaction.
2. Confirm the `NOTIFY pgrst, 'reload schema'` statement runs at the end.
3. Run catalog-only verification queries or the static migration tests before enabling any UI.
4. Configure the cron schedule only after the migration exists in production.

## Post-SQL Verification Commands

Local/static verification:

```bash
node --test test/portalFeedbackBackendFoundation.test.mjs
```

Full local verification used by this pass:

```bash
node --test 'test/*.test.mjs'
npm run lint
npm run build
git diff --check
```

Live database verification is deferred until after Jester manually applies SQL. Do not claim live database verification from this branch alone.

## Future Pass 2 Dependencies

Before mounting UI, confirm:

- migration applied in production,
- endpoint can submit as an active Unit Leader,
- outbox row is created on submit,
- worker can send or retry notification without duplicate submissions,
- the first UI pass sends no server-derived identity fields,
- the UI preserves the same privacy allowlist.

Academic Partner feedback can be added later by introducing a verified Academic Partner reporter-context resolver that calls the same shared service. Academic Partner Messages was not built in this pass.
