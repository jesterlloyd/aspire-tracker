# Phase 2C Deployment Readiness

Review date: 2026-07-22

Branch: `phase2c-preceptor-authz`

Reviewed commit: `683d9ef97b7595401e707df9d9f708b06e8bf637`

Local comparison baseline: `main` / `origin/main` at `544ec5dc2ddedffacdaa12353a7b5067846c37c7`

## Verdict

**NOT READY FOR PRODUCTION DEPLOYMENT until the blockers below are resolved and the production
environment checklist is confirmed by the Owner.**

Phase 2B and Phase 2C, including the live privilege hardening, are already applied and verified.
This review did not run SQL, apply or roll back a migration, deploy, or enable the Unit Leader
assignment UI.

The local and remote-tracking `main` refs both identify `544ec5d` as the apparent production source
baseline. Repository history cannot prove which commit is currently deployed by Vercel. The Owner
must confirm the live deployment SHA before using the comparison as the final release manifest.

## Pre-deployment blockers

1. **Cron authentication must fail closed when configuration is missing.**
   `api/cron/staff-notification-worker.js` compares the request header with
   ``Bearer ${process.env.CRON_SECRET}`` but never first proves that `CRON_SECRET` is non-empty. If
   the variable is absent, a literal `Bearer undefined` header satisfies the comparison. Add an
   explicit missing-secret rejection and handler tests for absent, incorrect, and correct
   authorization.
2. **Worker persistence errors must be detected.**
   `lib/server/staffNotifications/deliveryService.js` awaits the Supabase update but does not inspect
   its resolved `{ error }`. Supabase normally resolves database failures rather than rejecting the
   promise, so the worker can report a row as sent/retried/failed even though it remains
   `processing`. Check and throw on the returned error; add a test for a resolved Supabase error,
   not only a rejected promise. Stale-claim recovery and the provider idempotency key reduce the
   duplicate-send risk but do not make the reported state correct.
3. **The in-app `preceptor_created` destination is not wired.**
   The database stores `/rotation/preceptors` in `dest_url`, and email renders that link, but
   `StaffNotificationsPanel` only makes rows with `student_id` navigable. A preceptor-created item
   can only be marked read. Route this event to the Preceptor Directory and add a behavioral test
   that covers both student and preceptor destinations.
4. **Production facts require Owner confirmation.**
   Confirm the actual deployed production SHA and the presence of every required production
   environment variable below without copying any value into tickets, logs, or this document.

## Runtime deployment contents

Deploy the application and serverless delta from the confirmed production baseline through
`683d9ef`. The database migrations are retained as canonical source but must not be re-applied.

### Assignment and idempotency

- `api/preceptor-primary-assign.js`: verifies an active Owner/Admin, then calls
  `assign_primary_preceptor` through the service role.
- `src/components/PreceptorAssignmentModal.jsx`: replaces direct primary-table writes with the
  audited endpoint and disables duplicate submission while a request is in flight.
- `src/lib/preceptorRequestId.js`: creates one client request ID per intentional action, retains it
  across a failed retry, and replaces it only for a new/completed action.
- `api/portal/unit-preceptor-manage.js`: authenticated Unit Leader backend for primary,
  Secondary/Coverage, and preceptor-creation RPCs. There is deliberately no Unit Leader assignment
  UI caller in this release.

The existing staff `api/preceptor-assignments.js` path for Owner/Admin additional preceptors is not
part of this Phase 2C delta. The new Secondary/Coverage RPC endpoint is the scoped Unit Leader
backend reserved for the disabled future UI.

### Staff notifications

- `lib/server/staffNotifications/config.js`: reuses the shared retry bounds and approved identity.
- `lib/server/staffNotifications/emailContent.js`: builds the assignment email and canonical link.
- `lib/server/staffNotifications/deliveryService.js`: claims due rows, sends through Resend, records
  delivery state, retries transient failures, and uses a stable provider idempotency key.
- `api/cron/staff-notification-worker.js`: authenticated serverless worker.
- `vercel.json`: schedules the worker every 10 minutes and gives it a 60-second maximum duration.

### Staff application surface

- `src/hooks/useStaffNotifications.js`: reads the recipient's latest rows and changes read state
  only through `mark_staff_notifications_read`.
- `src/components/StaffNotificationsPanel.jsx`: renders read/unread activity and mark-read actions.
- `src/components/ActionCenter.jsx`: retains `Action Needed` and adds a separate `Notifications`
  tab.
- `src/components/Header/HeaderActions.jsx` and `src/App.jsx`: combine live task count and durable
  notification unread count on the existing single header bell.

Tests and handoff/audit artifacts deploy with the source repository but do not add runtime routes.

## Unit Leader assignment UI boundary

The Unit Leader assignment UI remains disabled:

- `src/portal/UnitLeaderPortal.jsx` renders only `Message student` in each student action menu.
- Its `Preceptor Assignments` page remains the existing nomination workflow; it does not call
  `api/portal/unit-preceptor-manage.js`.
- Repository search finds no frontend caller of `api/portal/unit-preceptor-manage.js`.
- `test/unitLeaderPhase1.test.mjs` statically prevents the assignment labels/actions from entering
  the portal.

The backend endpoint will exist after deployment, but it independently verifies an active Unit
Leader grant and active unit scope before the RPC re-checks authorization. Backend availability is
not UI enablement.

## Production environment checklist

Confirm presence and correct Production scope only. Do not disclose values.

| Variable | Required by | Readiness requirement |
| --- | --- | --- |
| `CRON_SECRET` | `api/cron/staff-notification-worker.js` | Required for worker authentication. Block deployment until present and until the missing-secret fail-closed code path is fixed. |
| `RESEND_API_KEY` | `api/cron/staff-notification-worker.js` | Required to create the Resend client and deliver claimed email jobs. |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker, primary endpoint, Unit Leader endpoint through `portalAuth` | Server-only database/RPC access. Never expose to the browser. |
| `SUPABASE_URL` or `VITE_SUPABASE_URL` | Worker and both assignment endpoints | At least one server-side URL name must be present. The browser specifically requires `VITE_SUPABASE_URL`. |
| `VITE_SUPABASE_ANON_KEY` or `SUPABASE_ANON_KEY` | Server-side JWT verification in both assignment endpoint families | At least one name must be present server-side. The browser specifically requires `VITE_SUPABASE_ANON_KEY`. |

`APP_BASE_URL` / `VITE_APP_URL` is an optional override. Without it, notification email links use
the canonical `https://aspireintelligence.app` base.

## Approved mail identity

- Envelope sender: `ASPIRE at Cedars-Sinai <noreply@aspire-program.com>`
- Reply-To: `aspire@cshs.org`

The staff notification worker imports both values from `lib/server/messages/config.js`; this review
found no Phase 2C override or drift.

## Deployment sequence

1. Resolve the three code blockers and run the same verification matrix again.
2. Confirm the actual Vercel production SHA. Recompute and review the runtime diff if it is not
   `544ec5d`.
3. Confirm all production environment variable names above are present in the Production scope.
4. Confirm the live Phase 2B/2C verification record and privilege-hardening sign-off. Do not
   re-apply either migration.
5. Build a preview from the final release commit. Verify app startup, authenticated staff startup,
   the assignment endpoint, Notifications tab, and an authenticated worker no-op against the
   intended non-production environment.
6. Deploy the same reviewed commit to production. The deployment must include the frontend,
   serverless functions, and `vercel.json` together.
7. Record the production deployment ID and commit SHA, then run the smoke checklist below.
8. Keep the Unit Leader assignment UI disabled. Do not add a caller for
   `api/portal/unit-preceptor-manage.js` in this release.

## Post-deployment smoke checklist

Use a controlled test student/preceptor and two active Owner/Admin accounts so the actor is excluded
and the second account receives the notification. Do not copy secrets into evidence.

### Application and assignment

- [ ] Production app loads, authenticates, and shows no new startup/runtime errors.
- [ ] One Primary assignment from `PreceptorAssignmentModal` succeeds through
      `/api/preceptor-primary-assign`.
- [ ] The student Primary and maintained mirrors show the selected preceptor after refresh.
- [ ] Repeated clicking while the request is in flight produces only one request.
- [ ] A deliberate client retry uses the same request ID and replays rather than mutating twice.

### Durable in-app notification

- [ ] Exactly one `staff_notifications` row exists per eligible recipient for the test correlation
      ID; the actor has no recipient row.
- [ ] The recipient's existing header bell badge increases by one in addition to any Action Needed
      count.
- [ ] The Action Center has distinct `Action Needed` and `Notifications` tabs.
- [ ] The notification shows actor, role, unit, assignment role, old/new values, reason when set,
      timestamp, and read/unread state.
- [ ] Opening a student-linked item routes to the intended student and marks only that item read.
- [ ] `Mark all read` clears the recipient's remaining unread notification rows and badge count.
- [ ] After blocker 3 is fixed, a `preceptor_created` item routes to `/rotation/preceptors`.

### Worker and Resend

- [ ] Missing and incorrect worker authorization return 401; no claim occurs.
- [ ] Correct worker authorization returns a bounded count response without exposing row content.
- [ ] One due row is claimed once; overlapping worker invocations do not claim the same row.
- [ ] A successful job reaches `sent`, records one attempt and the Resend message ID, and clears its
      lock.
- [ ] Resend shows exactly one delivery with the approved sender and Reply-To.
- [ ] In a controlled non-production failure test, a transient result enters `retry_wait`, receives
      a future attempt time, and later succeeds or stops at the maximum attempts.
- [ ] Replaying the same job uses the identical provider idempotency key and creates no duplicate
      provider email.
- [ ] The database unique key prevents duplicate recipient rows for the same correlation ID.
- [ ] Cron run history records claimed/sent/retried/failed/error counts accurately.

### Unit Leader boundary

- [ ] A Unit Leader sees the existing nomination page, not Primary/Secondary/Coverage assignment
      controls.
- [ ] A Unit Leader student action menu contains only `Message student`.
- [ ] Normal Unit Leader navigation produces no request to `/api/portal/unit-preceptor-manage`.

## Rollback sequence

### 1. Disable the cron

1. Pause the `staff-notification-worker` schedule in Vercel before rolling application code back.
2. Confirm no scheduled invocation is running and record any rows left in `processing`.
3. Do not delete notification rows. Stale claims are recoverable when a corrected worker resumes.
4. Remember that a later deployment containing the current `vercel.json` can recreate the schedule;
   verify the platform state after every rollback deployment.

### 2. Roll back the application

1. Roll Vercel back to the previously recorded production deployment.
2. Verify app health and staff authentication.
3. Suspend Primary preceptor assignment operations while the old application is live. The prior
   modal writes directly as Owner/Admin, so it can bypass the new audited RPC and omit durable
   notifications even though the live database remains structurally compatible.
4. Prefer a forward fix or a compatibility deployment that retains the audited primary endpoint
   and modal while disabling only the failing notification/worker surface.
5. Leave the Unit Leader assignment UI disabled.

### 3. Database rollback: manual Owner-only last resort

Do not roll back the database for an application, UI, worker, cron, or email-provider defect. If an
independent database defect requires reversal, the Owner must stop the worker, preserve required
audit/notification evidence, assess data loss, and use the reviewed handoff rollback in reverse
order: Phase 2C before Phase 2B. That rollback drops Phase 2C objects and reopens the older broad
student-update path. It is destructive, manual, and outside this deployment package.

## Verification completed in this review

- Targeted Phase 2B/2C, idempotency, notification, badge, and Unit Leader boundary tests:
  **170 passed, 0 failed**.
- Full suite, `node --test 'test/*.test.mjs'`: **2,179 passed, 0 failed**.
- Client build, `npx vite build`: **passed**; non-blocking warning for chunks larger than 500 kB.
- SSR build, `npx vite build --ssr src/public-site/prerender-entry.jsx --outDir .prerender-ssr`:
  **passed**.
- `git diff --check`: **passed** before this document was added.

## Remaining test and evidence gaps

- No live database, Vercel, or Resend integration was run in this review.
- The new assignment endpoints are covered primarily by static source assertions rather than
  request-level handler tests.
- The notification panel tests inspect source text rather than rendering and exercising the React
  component.
- No test covers a missing `CRON_SECRET` or a Supabase update that resolves with `{ error }`.
- No test proves the `preceptor_created` in-app destination.
- Production environment presence and the actual deployed SHA remain Owner-confirmed facts.
