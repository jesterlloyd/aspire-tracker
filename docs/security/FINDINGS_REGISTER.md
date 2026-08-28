# Security Findings Register

Reconstructed 2026-08-27 from the repository at commit `d2f2719`, after the
remediation status audit found that the original audit report existed only in
chat and was never committed. This file is now the durable register. Update it
when a finding's status changes, in the same commit as the change.

## Provenance, and what this file can and cannot claim

The original security audit (2026-08-20, read-only, delivered in-chat) produced
findings S-01 through S-33 and dependency items D-01 through D-04, with severity
ratings and a prioritized remediation sequence. That report was never written to
a file. The only finding identifiers recoverable from the repository are the
ones the remediation commits left as code comments: S-01 through S-11 and S-14.

RECOVERY UPDATE, 2026-08-27: the original findings for S-12, S-13, S-15
through S-33, and D-01 through D-04 were recovered and are restored below with
their original severities. Nothing was marked closed on recollection; each was
re-checked against the code.

Consequences, stated plainly:

- S-01 through S-11 and S-14 below are reconstructed from the code, the
  remediation commits, and the audit SQL files. Their titles and evidence are
  verified. Their SEVERITY ratings are assessed from the code evidence during
  reconstruction, not recovered from the original report, and are labeled so.
- S-12, S-13, S-15 through S-33, and D-01 through D-04 carry their ORIGINAL
  severities, recovered and restored 2026-08-27, with every status re-verified
  against code at HEAD `556d8a4` before it was recorded.
- Nothing here should be marked closed on the strength of a commit message.
  Every "Closed" entry cites code that was verified present at `d2f2719`, and
  the security test files (152 tests) were run green at that commit.

Verification snapshot: `node --test` over `deactivationEnforcement`,
`deactivationSessionTermination`, `publicEndpointHardening`,
`portalAccessRevokedMidSession`, `s01InterviewLookup`, `s07InterviewBook`,
`s04WaveEWriteSplit`, `interviewersFullAccessDrop` = 152 pass, 0 fail
(2026-08-27, HEAD `d2f2719`).

## Rule: closing a finding updates this file in the same commit

Updating this register is PART OF closing a finding, not a follow-up to it.
The commit that closes, partially closes, or reopens a finding edits that
finding's entry here in the SAME commit: status, closing commit, and evidence.
A closure whose commit does not touch this file is not done. The same applies
to OWNER_SQL_GATE.md when a migration is involved. This rule exists because
every continuity failure this project has had came from recording status
afterward, from memory.

## Status vocabulary

- **Closed**: the defect is fixed in code at HEAD, verified by reading the code
  and by tests, not by commit message.
- **Closed (code); SQL unconfirmed**: the application side is verified at HEAD,
  but a required migration's applied state cannot be determined from the
  repository.
- **Partially closed**: a named part remains, with the reasoning recorded.
- **Unrecoverable**: defined in chat only; the repository cannot state what the
  finding was.

---

## S-01. Unauthenticated interview lookup leaked student PII and enabled enumeration

- **Severity (assessed)**: High. `select('*')` on students returned
  date_of_birth, ssn_last4, personal_email, GPA, and interview scores to any
  anonymous caller who knew a school email; found/not-found was distinguishable.
- **Status**: Closed.
- **Closing commit**: `b3627ef` (2026-08-21). Live-probed in production the same
  day with a fake address, including tripping the 60s burst bucket.
- **Evidence**: `api/interview-lookup.js` carries named-column selects,
  projection functions (`projectStudent`, `projectSlot`, `projectBooking`), the
  single `NOT_ELIGIBLE` refusal for not-found and not-eligible alike, two-bucket
  rate limiting (10/60s, 60/3600s) through `consume_evaluation_rate_limit`,
  narrowed CORS. `test/s01InterviewLookup.test.mjs` green at HEAD.
- **Deferred, with reasoning**: the endpoint stays public by design; the
  scheduling link ASPIRE Connect sends is a static tokenless URL, so the school
  email is the only credential the flow has. A tokenized scheduling flow was
  named as separate work and has not been built.

## S-02. Interviewers could self-grant cohort entitlement

- **Severity (assessed)**: High. The availability endpoint auto-ensured a cohort
  entitlement for whoever called it, so an interviewer could widen their own
  student-file access.
- **Status**: Closed.
- **Closing commit**: `d4c5e8b` (2026-08-21).
- **Evidence**: `api/availability.js` validates `cohort_id`, requires an
  existing active entitlement (`activeEntitledCohortIds`) for non-admin
  self-scheduling, and auto-ensures entitlements only when `adminLevel`.
- **Related open item**: `lib/server/access.js:101` still reads
  `interview_schedule: ['admin']`, a capability-table divergence noted during
  this work and never reconciled.

## S-03. Stored file references not bound to the owning student

- **Severity (assessed)**: High. A staff write could point one student's
  resume_url/headshot_url at another student's object; reads would sign it.
- **Status**: Closed.
- **Closing commits**: `7dfb32e` (write side), `d0b372e` (read side), both
  2026-08-21.
- **Evidence**: `lib/server/studentFiles.js` exports
  `validateStoredFileRefForStudent` (used by `api/student-update.js`,
  `api/student-intake-submit.js`, `api/portal/my-profile.js`) and
  `refBelongsToStudent` (used by `api/student-file-access.js`,
  `api/portal/student-file-access.js`, `api/portal/unit-student-file-access.js`,
  `api/portal/school-student-file-access.js`,
  `lib/server/keith/resumeInterviewQuestions.js`).
- **Deferred by documented decision**: the read guard compares the STUDENT path
  segment only, not the cohort segment. The reasoning is written into
  `studentFiles.js`: the student segment is the security-bearing invariant, and
  comparing the cohort segment would blank legitimate historical values without
  adding protection. This was a considered rejection, not an omission.

## S-04. Staff-wide FOR ALL RLS policies let any staff role write core tables

- **Severity (assessed)**: High. `is_staff()` FOR ALL policies meant viewer and
  interviewer sessions could write cohorts, students, communications, and more
  from the browser.
- **Status**: Partially closed. Code and migration complete; two parts remain.
- **Closing commits**: `8494615` (migration), `da5943d` (self-service-first
  revision), `d0a38b2` (interviewer delete moved server-side, refused UI
  controls gated).
- **Evidence**: `supabase/migrations/20260822020000_wave_e_write_policy_split.sql`
  creates `is_active_staff_writer()` and splits FOR ALL into SELECT plus
  writer policies for cohorts, communications, units, matches, interviewers,
  interviews, ngrp_outcomes, cohort_snapshots; contacts, students, and
  student_shift_logs get scoped write policies. Preflight and POST checks in
  `db/audit/wave_e_write_split_preflight_and_verification.sql`.
  `test/s04WaveEWriteSplit.test.mjs` green at HEAD.
- **Update 2026-08-27**: the migration is APPLIED, confirmed via its POST 1
  to 10 (see the OWNER_SQL_GATE ledger). The interviewers catch-all policy its
  POST 1 surfaced is also confirmed dropped, so the split's writer policies are
  in effect.
- **What remains**:
  1. `interview_availability_blocks`, `interview_slots`, and
     `interview_sessions` were EXCLUDED by explicit decision: interviewers
     legitimately write them, and restricting by role without asking what a
     role legitimately does was judged the wrong test (Owner correction,
     2026-08-22). The browser still writes all three directly
     (`AvailabilitySection.jsx`, `InterviewDayDrawer.jsx`, `WeekCalendar.jsx`,
     `App.jsx`). The precondition for splitting them, ownership-checked server
     endpoints for block activation, slot block/unblock, and Teams-invite
     marking, has not been built; `api/availability.js` ALLOWED_ACTIONS covers
     only create_block, delete_block, delete_slot, cancel_booking.
  This is now the ONLY remaining part of S-04.

## S-05. Account deactivation revoked nothing

- **Severity (assessed)**: Critical. Deactivation set a profile boolean; 41 of
  111 JWT-verifying endpoints never read it, so a deactivated Owner or Admin
  kept invite, bulk email, evaluation release, and edit authority until token
  expiry, and the session could refresh indefinitely.
- **Status**: Closed, with one production behavior unverified.
- **Closing commits**: `887c295` (per-request active checks, 41 endpoints),
  `6caf18d` (Supabase Auth ban on deactivation, lifted on reactivation and on
  re-invite), 2026-08-22.
- **Evidence**: `api/lib/activeAccount.js` (single predicate,
  `is_active === false`, never truthiness), `api/lib/accountSession.js`
  (`endAuthAccess`/`restoreAuthAccess` via `ban_duration`), wired in
  `api/admin-users.js` and `api/invite-user.js`.
  `test/deactivationEnforcement.test.mjs` sweeps the ENTIRE api/ tree rather
  than sampling, and is green at HEAD, so endpoints added since (Nursing
  Academics portal included) are covered. One deliberate exemption, by name:
  `api/portal-activation-event.js` (grants no authority; a diagnostic must not
  break activation).
- **Unverified**: whether GoTrue rejects a banned account's EXISTING access
  token immediately or only blocks refresh and re-login. The per-request checks
  hold either way.

## S-06. Unauthenticated email relay endpoints, unescaped templates, unbounded fields

- **Severity (assessed)**: High. Four public routes accepted recipient and
  display values from the request body and sent mail; template interpolations
  were unescaped; free-text fields had no length caps.
- **Status**: Closed.
- **Closing commits**: `dbed654` (routes closed), `284a7f8` (escaping),
  `143310b` (length caps), `aa19d5d` (lazy-loaded senders), 2026-08-20.
- **Evidence**: `api/notify-interview-booked.js`,
  `api/form-received-notification.js`, `api/unit-form-notification.js`, and
  `api/test-resend.js` confirmed absent at HEAD. Sends moved in-process
  (`lib/server/email/interviewBooked.js`,
  `lib/server/notifications/placementRequestNotifications.js`,
  `lib/server/notifications/unitFormNotifications.js`). Caps in
  `api/lib/fieldLimits.js` including MAX_STUDENTS_PER_PLACEMENT_REQUEST = 100.
- **Deferred**: client-side character counters on the public forms, so a
  submitter sees the limit before the server refuses. Not implemented.

## S-07. Interview booking trusted client-supplied identity

- **Severity (assessed)**: High.
- **Status**: Closed.
- **Closing commit**: `2aeb116` (2026-08-21).
- **Evidence**: `api/interview-book.js` re-resolves the student by email
  server-side, enforces the student-slot-cohort relationship, trims the
  response through `projectBookedSlot`, carries two-bucket rate limits
  (5/60s, 20/3600s), one `BOOKING_REFUSED` 409, and a post-claim
  double-booking re-check. `test/s07InterviewBook.test.mjs` green at HEAD.

## S-08. School form password verified client-side only; plaintext column

- **Severity (assessed)**: Medium-high. The password gated only the screen;
  posting directly to the API skipped it entirely. The column is plaintext with
  TRIM-equality comparison in an anon-executable RPC.
- **Status**: Partially closed.
- **Closing commit**: `0186482` (2026-08-23).
- **Evidence**: `api/school-form-submit.js` verifies via
  `school_form_requires_password` then `verify_school_form_password` BEFORE any
  write, mirroring the authenticated Academic Partner path; missing and wrong
  passwords are refused identically; a failed requirement lookup refuses rather
  than waves through; the entered password never reaches a write, log, or
  response. The client sends the password it already holds
  (`SchoolFormPage.jsx`), so no new friction.
- **What remains, with reasoning**: `cohorts.school_form_password` is still
  plaintext. Hashing was deliberately not bundled: the two password RPCs are
  dashboard-created (their bodies are not in this repository; migration
  20260712000006 only ALTERs them), and both cohort modals
  (`NewCohortModal.jsx`, `ManageCohortModal.jsx`) write the column directly, so
  hashing without changing them would break the next cohort created. The
  six-step sequence, including the `pg_get_functiondef` read that must come
  first, is in `db/audit/public_endpoint_hardening_checks.sql` section 4.

## S-09. Shift-log endpoints authenticate by email alone, no throttle

- **Severity (assessed)**: Medium-high.
- **Status**: Closed as hardened. Retirement was evaluated and REJECTED with
  evidence: the portal endpoint (`api/portal/my-shift-log-manage.js`) accepts
  only edit, void, and eligibility, with no create path, and the signed-in
  Student Portal's own "Log a Shift" button links to the public `/shift-log`.
  The public path is the only way any student creates a shift log; retiring it
  would have broken shift logging for everyone in Active Rotation.
- **Closing commit**: `c2cc727` (2026-08-23).
- **Evidence**: all four routes (`lookup-student`, `check-in`, `check-out`,
  `submit-past-shift`) carry two-bucket throttles; ineligible lookups no longer
  return `{ id, full_name, school_email }` (nothing rendered it). The three
  ineligible REASONS stay distinguishable on purpose: the screens give
  genuinely different advice, and collapsing them would misdirect a real
  student. The throttle, not a generic reply, is the enumeration control.

## S-10. Unit form lookup disclosed staff identity and narrative to a guessed unit name

- **Severity (assessed)**: High for privacy. Name, work email, role, and every
  free-text answer (considerations, reason_for_zero, hiring_new_grads_reason,
  aspire_alumni_notes, named preceptor preferences) for the price of guessing
  "5 West".
- **Status**: Closed.
- **Closing commit**: `2119ea9` (2026-08-23).
- **Evidence**: `api/unit-form-lookup.js` splits the response: `projectOpen`
  (structured, authorless answers) on unit selection; `projectGuarded`
  (identity and prose) only when the supplied `submitter_email` matches the
  stored one. Both halves are projections, so a future column cannot leak by
  default. `UnitFormPage.jsx` re-looks-up on email blur and merges without
  overwriting anything already typed, so a returning coordinator still gets
  their prefill, one field later.

## S-11. No rate limiting on the public surface; intake lookup was an email oracle

- **Severity (assessed)**: High. Nine unauthenticated endpoints, zero
  throttles; the intake lookup distinguished four failure states by status and
  message, and returned student_id/cohort_id that nothing consumed.
- **Status**: Closed, one residual documented.
- **Closing commits**: `35c4623` (shared limiter), `03915ff` (intake oracle),
  plus `2119ea9`/`c2cc727`/`0186482` for their endpoints (2026-08-23).
- **Evidence**: `api/lib/publicRateLimit.js`, two buckets per endpoint, unique
  prefixes, fail-closed on RPC error/throw/non-true, keyed on a peppered HMAC
  of the IP. Verified at HEAD: all nine endpoints call
  `consumePublicRateLimit` before any lookup or write. The intake lookup
  answers every failure with the single `CANNOT_START` refusal, requires
  `last_name` as a second factor (already required by the form before the call,
  so zero friction), and returns `{ verified: true }` with no identifier.
- **Residual, by documented decision**: a caller holding both a valid address
  and its matching surname can still read the found bit. Irreducible for a
  pre-validation endpoint; the alternative was deleting the pre-check and
  letting applicants upload documents before learning their email is
  unrecognized.
- **Operational note**: the limiter FAILS CLOSED and depends on
  `consume_evaluation_rate_limit`, which is dashboard-created and not in any
  repository migration. CONFIRMED present in production 2026-08-27 via section
  1 of `db/audit/public_endpoint_hardening_checks.sql`.

## S-12. Cron handlers fail open when CRON_SECRET is unset

- **Severity (original)**: Medium.
- **Status**: CLOSED.
- **Closing commit**: this commit.
- **Risk (historical)**: the comparison was against the literal string
  "Bearer undefined" when the variable is unset, so a caller sending that exact
  header passed and could trigger reminder and digest sends.
- **Scope found**: THIRTEEN handlers carried the fail-open pattern, up from
  eleven at audit. The two added since,
  `api/cron/student-completion-reconciliation.js` (2026-08-21) and
  `api/cron/cohort-access-retirement.js` (2026-08-26), were copied from a
  vulnerable neighbour rather than from the one handler that had it right.
  That spread is why the fix is a shared helper plus a sweep test, not
  thirteen edits.
- **Fix**: `api/lib/cronAuth.js` is now the single implementation, with three
  properties the old form lacked. It FAILS CLOSED (unset, empty,
  whitespace-only, or non-string secret refuses everything). It BUILDS NO
  STRING FROM AN UNDEFINED VALUE (the expected credential is constructed only
  after the secret is proven a non-empty string, so "Bearer undefined" cannot
  exist). It COMPARES IN CONSTANT TIME over fixed-width SHA-256 digests, which
  leaks neither the secret's length nor a first-differing-byte timing signal,
  and avoids timingSafeEqual's throw on unequal lengths.
- **Evidence**: all 14 authenticating cron routes call the helper;
  `api/cron/evaluation-reminders-recovery.js` delegates its whole request to a
  guarded handler and needs no guard of its own.
  `api/cron/staff-notification-worker.js`, whose inline guard was the correct
  one and became the helper, now CALLS it rather than keeping a second copy.
  No file under `api/cron/` reads CRON_SECRET any more.
- **Regression guard**: `test/cronSecretFailClosed.test.mjs` sweeps the whole
  directory and fails if any file builds a Bearer string from an environment
  value, compares the authorization header directly, reads CRON_SECRET, or has
  no authorization at all. A fourteenth handler cannot copy the vulnerable
  form without failing the suite.

## S-13. Admin notification endpoint gated on a static shared token

- **Severity (original)**: Medium.
- **Status**: OPEN (one component not locatable at HEAD).
- **Risk**: `api/send-notification.js` accepts any `type` and arbitrary
  `context`, recipient included, against a single static
  `ADMIN_NOTIFICATION_TOKEN`, records no actor, and returns raw `err.message`.
  Anyone holding the token sends arbitrary program email with no attribution.
- **Verified at HEAD**: the static-token gate, arbitrary context, and missing
  actor are present; it does fail closed on an unset token. The
  force-flag-bypassing-dedup component was NOT found at HEAD in this or any
  surviving endpoint; it may have lived in a route since deleted (S-06 removed
  four). Treat that component as unlocatable rather than fixed.

## S-14. Interviewer outcome writes unscoped by cohort

- **Severity (assessed)**: Medium-high. Any interviewer could write status and
  interview outcomes for students in any cohort; role alone was the gate.
- **Status**: Closed.
- **Closing commit**: `22ffe16` (2026-08-21).
- **Evidence**: `api/student-update.js` bounds interviewer outcome writes by
  ACTIVE cohort entitlements, using the same identity-based predicate as
  `api/student-file-access.js`, with the model stated in the S-14 comments at
  lines 456 to 462.

## S-15. Unit Leader retains thread read access after losing unit scope

- **Severity (original)**: Medium. **Status**: OPEN.
- **Risk**: revoking a unit scope does not remove conversation membership, so a former Unit Leader keeps reading unit threads.
- **Verified at HEAD**: no writer of `conversation_participants.removed_at` exists anywhere in api/, lib/, src/, or the migrations; the only references are a partial index and a different table's column.

## S-16. Avatar uploads bypass the server; avatar_url accepted as arbitrary string

- **Severity (original)**: Medium. **Status**: OPEN.
- **Risk**: content-type and path discipline enforced nowhere, and a staff admin can point another user's avatar at any URL.
- **Verified at HEAD**: `src/components/UserMenu.jsx` still uploads directly to the public `avatars` bucket with a client-chosen extension and stores `getPublicUrl`; `api/admin-users.js` `update_avatar` still accepts any string into `avatar_url`.

## S-17. Client caches survive sign-out and account switch

- **Severity (original)**: Medium. **Status**: OPEN.
- **Risk**: React Query data, drafts, and recipient lists from one account are readable in the next session on a shared machine.
- **Verified at HEAD**: no `queryClient.clear()` exists anywhere in src/.

## S-18. anon USING (true) read policy on unit_leaders

- **Severity (original)**: Medium. **Status**: OPEN (live state unconfirmed).
- **Risk**: the full unit leader roster including emails readable with the publishable anon key.
- **Verified at HEAD**: `anon_read_unit_leaders` appears in NO repository migration (dashboard-created out-of-band, same class as the interviewers catch-all closed by 20260822030000), and no migration REVOKEs anon on unit_leaders. Confirming and dropping it needs a live read plus a migration.

## S-19. Raw provider and database error text returned on public routes

- **Severity (original)**: Low. **Status**: PARTIALLY CLOSED.
- **Risk**: internal table, constraint, and provider detail disclosed to anonymous callers.
- **Verified at HEAD**: the S-01/S-06/S-07 and S-08 through S-11 hardening made the interview, intake, unit-form, and shift-log surfaces generic. ONE named residual remains: `api/school-form-submit.js:141` still returns `{ error: result.error }` raw from the placement upsert helper on a public route.

## S-20. Recipient names and emails written to function logs in three crons

- **Severity (original)**: Low. **Status**: OPEN.
- **Risk**: student and coordinator PII accumulates in Vercel log retention.
- **Verified at HEAD**: `interview-reminders.js:153`, `coordinator-weekly-digest.js:459`, and `midpoint-checkin.js:148` each log recipient email and name on every send.

## S-21. Resend webhook allows same-rank lateral writes, no replay dedup

- **Severity (original)**: Low. **Status**: OPEN.
- **Risk**: a replayed or reordered event of equal rank rewrites delivery status and timestamps.
- **Verified at HEAD**: `api/webhooks/resend.js` verifies the Svix signature, but the guard is `newRank >= currentRank` (same-rank writes pass) and no svix-id is stored or checked for replay.

## S-22. is_owner_or_admin() ignores is_active

- **Severity (original)**: Low. Assessed higher in practice: the exposure below
  is a live browser path, not a theoretical one.
- **Status**: CODE COMPLETE, SQL PENDING. The migration is written and awaits
  manual application; the finding is NOT closed until it is applied and the
  POST checks pass.
- **Closing commit**: this commit (migration + audit + tests).
- **Migration**: supabase/migrations/20260829000000_s22_is_owner_or_admin_requires_active.sql
- **Risk**: the predicate checks role only, so a deactivated Owner or Admin
  holding a still-valid access token passes every policy and RPC guard built on
  it. S-05 closed the endpoint layer; this is the database layer.
- **Exposure is real, not theoretical**: src/App.jsx routes a staff profile to
  /aggregate regardless of is_active, so the staff application renders for a
  deactivated admin and issues its normal browser reads. Of the gated tables,
  the browser reads activity_logs, evaluation_assignments, certificates, and
  support_request_reads directly, and calls get_all_user_profiles() and
  complete_disposition_followup() as RPCs.
- **Scope found**: 15 policies across 14 tables (user_role_grants,
  user_student_links, user_unit_scopes, user_school_scopes, released_reports,
  student_dispositions, activity_logs, certificates,
  student_disposition_followups, evaluation_instruments, evaluation_assignments,
  evaluation_responses, evaluation_reminders, and support_request_reads with
  two), plus 5 functions (get_all_user_profiles, add_interviewer,
  update_interviewer_color, update_interviewer_email,
  complete_disposition_followup). The original audit counted SEVEN RPCs, so at
  least two references exist only in the dashboard and cannot be seen from this
  repository.
- **Approach, and why**: the fix REDEFINES the predicate to delegate to
  is_active_owner_or_admin() rather than rewriting call sites. Rewriting what
  the repository can see would leave the invisible references still trusting a
  deactivated account, and this project has been bitten twice by exactly that
  (the Full-access-on-interviewers policy and the anon read on unit_leaders,
  both created out-of-band). Redefinition fixes every reference at once, with
  no policy churn.
- **The two helpers differed in TWO ways**, both handled: the is_active check,
  and the EXECUTE grant (is_owner_or_admin had authenticated only;
  is_active_owner_or_admin has authenticated and service_role). The migration
  brings the grant to parity, which is a superset and removes access from
  nobody. Everything else was already identical.
- **Nothing legitimate breaks**: an ACTIVE Owner or Admin evaluates identically
  before and after, and service_role bypasses RLS entirely, so no server
  endpoint depends on these policies. No caller depends on the
  deactivated-still-passes behaviour; every application path already refuses
  such an account.
- **Alias kept, not dropped**, deliberately. Dropping it would fix only the
  references this repository knows about, and Postgres would refuse the drop
  while any policy depends on it. It is now a documented deprecated alias with
  one implementation behind it. Retiring it is optional follow-up, recorded at
  the end of the audit file, to be done from the live PRE 2 and PRE 3 inventory
  rather than from the repository.
- **Regression guard**: test/s22ActiveOwnerOrAdmin.test.mjs (17 tests) pins the
  delegation, the hardened attributes, the untouched-policy property, the inert
  rollback, and that the audit file stays read-only and PII-free.

## S-23. Append-only event tables have no enforcement

- **Severity (original)**: Low. **Status**: OPEN.
- **Risk**: documented-append-only history (e.g. preceptor_assignment_events) is silently rewritable by any service-role code path or compromised key.
- **Verified at HEAD**: GRANT ALL to service_role, no UPDATE/DELETE-blocking trigger in any migration.

## S-24. cohort_school_rotations readable by anon and any authenticated

- **Severity (original)**: Low. **Status**: OPEN.
- **Risk**: rotation and coordinator detail readable with the anon key.
- **Verified at HEAD**: `cohort_school_rotations_anon_select` USING (true) in 20260522000000; Wave E2 cleanup EXPLICITLY excluded this table (noted in 20260712000005), so the exclusion was deliberate but the exposure stands.

## S-25. Suspected legacy USING (true) policies on archived submission tables

- **Severity (original)**: Low, suspected. **Status**: OPEN, unconfirmed.
- **Risk**: if the three archived tables still exist live, their legacy authenticated policies are fully open.
- **Verified at HEAD**: not verifiable read-only; needs one live catalog query. Nothing in the repo has touched them since the audit.

## S-26. PostgREST .or() filter strings built from raw search input

- **Severity (original)**: Low. **Status**: OPEN.
- **Risk**: commas and parentheses in a search term alter filter semantics client-side (bounded by RLS, so integrity of the query, not access).
- **Verified at HEAD**: six template sites, including the universal search in `src/App.jsx:1095-1103` and `PreceptorAssignmentModal.jsx:40`.

## S-27. Unescaped ilike wildcards on service-role queries

- **Severity (original)**: Low. **Status**: OPEN.
- **Risk**: % and _ in caller input broaden service-role matches (the public intake and shift-log paths escape; these do not).
- **Verified at HEAD**: `api/interview-book.js:251`, `api/messages-staff-options.js:120`, `api/keith.js:417` and `:502` pass unescaped values to ilike.

## S-28. interview_slots lacked database-level double-booking protection

- **Severity (original)**: Low. **Status**: PARTIALLY CLOSED.
- **Risk**: concurrent bookings race the application check.
- **Verified at HEAD**: 20260822020000 (confirmed APPLIED 2026-08-27) added `uq_interview_slots_one_booking_per_student`, so one student holding two bookings is now impossible at the database. The slot side (two students on one slot) still has no constraint and relies on the atomic conditional claim (`.eq('is_booked', false)`) plus the post-claim re-check in api/interview-book.js. Remaining: a partial unique index on slot id WHERE is_booked, if desired.

## S-29. evaluation_assignment_tokens has no one-active-token constraint

- **Severity (original)**: Low. **Status**: OPEN.
- **Risk**: multiple live tokens per assignment can accumulate; revocation by token id (the house rule) mitigates but nothing enforces singularity.
- **Verified at HEAD**: no unique index or constraint on the table in any migration.

## S-30. Keith GET reveals hasApiKey unauthenticated

- **Severity (original)**: Informational. **Status**: OPEN.
- **Risk**: configuration reconnaissance without a token.
- **Verified at HEAD**: `api/keith.js:741` returns `hasApiKey: !!process.env.ANTHROPIC_API_KEY` on GET before any auth.

## S-31. Activation token_hash remains in the address bar after verifyOtp

- **Severity (original)**: Informational. **Status**: OPEN.
- **Risk**: a consumed single-use token hash lingers in browser history.
- **Verified at HEAD**: no `history.replaceState` in `src/pages/ActivateAccountPage.jsx`.

## S-32. Student PII hardcoded in a dormant cron

- **Severity (original)**: Informational. **Status**: OPEN.
- **Risk**: two students' names and schools live in source control.
- **Verified at HEAD**: `api/cron/clockout-reminders-resend.js:42-43`, the APPROVED_SHIFT_LOG_IDS comments. The endpoint is CRON_SECRET-gated (and fail-open per S-12); the run it existed for is long complete, so the whole file is retirable.

## S-33. Policies without ENABLE ROW LEVEL SECURITY in repo SQL

- **Severity (original)**: Informational. **Status**: OPEN, not verifiable read-only.
- **Risk**: if RLS is not enabled live on user_profiles, activity_logs, or aspire_events, their policies are decorative.
- **Verified at HEAD**: confirmed that no repository migration contains ENABLE ROW LEVEL SECURITY for any of the three (all three are dashboard-managed). Live state needs one catalog query (pg_class.relrowsecurity).

## D-01. react-router-dom 7.15.1 advisories

- **Severity (original)**: Low. **Status**: OPEN (upgrade housekeeping). Open redirect and DoS advisories, judged not reachable by the audit. Still at ^7.15.1 in package.json.

## D-02. ws 8.20.0 via @supabase/realtime-js

- **Severity (original)**: Low. **Status**: OPEN (upgrade housekeeping). Client-side only. supabase-js still at ^2.105.1.

## D-03. postcss and nanoid via sanitize-html

- **Severity (original)**: Low. **Status**: OPEN (upgrade housekeeping). Server runtime path. sanitize-html still present (^2.17.5).

## D-04. vite 8.0.10, brace-expansion, @babel/core

- **Severity (original)**: Informational. **Status**: OPEN (dev-only). Build-time only; vite still at ^8.0.10.

---

## Related remediation shipped without an S-number

- `bc77cdb` + `supabase/migrations/20260822010000_interview_rubric_authorization.sql`:
  interview rubric details restricted by author
  (`can_manage_all_interview_rubrics()`). Confirmed APPLIED 2026-08-27.
- `2571974` + `supabase/migrations/20260822030000_drop_interviewers_full_access_policy.sql`:
  drops the dashboard-created `"Full access on interviewers"` FOR ALL TO public
  USING (true) policy, discovered by POST 1 of the Wave E verification.
  Confirmed APPLIED 2026-08-27; the nullification it caused is over.
- `b8db8a4`: mid-session revocation on five portal surfaces routed to the
  no-access card via reason-classified failures
  (`src/lib/portalAccessState.js` `classifyPortalFailure`), replacing false
  transient errors and one silent blank portal.

## Standing verification

- `test/deactivationEnforcement.test.mjs`: repo-wide sweep; any new JWT
  endpoint missing the active check fails the suite.
- `test/publicEndpointHardening.test.mjs`: all nine public endpoints throttled,
  limiter fail-closed, oracle closed.
- `test/portalAccessRevokedMidSession.test.mjs`: walks every verifier reason;
  a new reason falling through unreviewed fails the suite.
- `db/audit/preceptor_parity_check.sql`: standing data-integrity checks,
  including the ones lifted from the deleted Phase 2A preflight branch.

## Unverified in production (as of 2026-08-27)

1. Mid-session revocation behavior on all five portal surfaces (`b8db8a4`).
2. Banned account's existing access token: immediate rejection vs expiry.
3. Every rate-limit ceiling (no live request has exercised one).
4. S-08 server-side password path and S-10 guarded prefill, live.
5. RESOLVED 2026-08-27: migrations 20260822010000, 20260822020000, and
   20260822030000 are confirmed APPLIED (see the OWNER_SQL_GATE ledger for the
   verification each ran).
