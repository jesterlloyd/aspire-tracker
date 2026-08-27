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

Consequences, stated plainly:

- S-01 through S-11 and S-14 below are reconstructed from the code, the
  remediation commits, and the audit SQL files. Their titles and evidence are
  verified. Their SEVERITY ratings are assessed from the code evidence during
  reconstruction, not recovered from the original report, and are labeled so.
- S-12, S-13, S-15 through S-33, and D-01 through D-04 are UNRECOVERABLE from
  the repository. Their entries below are placeholders. Do not infer from the
  placeholder that a finding was minor, open, or closed; the repository simply
  does not say what it was.
- Nothing here should be marked closed on the strength of a commit message.
  Every "Closed" entry cites code that was verified present at `d2f2719`, and
  the security test files (152 tests) were run green at that commit.

Verification snapshot: `node --test` over `deactivationEnforcement`,
`deactivationSessionTermination`, `publicEndpointHardening`,
`portalAccessRevokedMidSession`, `s01InterviewLookup`, `s07InterviewBook`,
`s04WaveEWriteSplit`, `interviewersFullAccessDrop` = 152 pass, 0 fail
(2026-08-27, HEAD `d2f2719`).

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
- **What remains**:
  1. Applied state of the migration is unknown from the repository (see the
     OWNER_SQL_GATE ledger).
  2. `interview_availability_blocks`, `interview_slots`, and
     `interview_sessions` were EXCLUDED by explicit decision: interviewers
     legitimately write them, and restricting by role without asking what a
     role legitimately does was judged the wrong test (Owner correction,
     2026-08-22). The browser still writes all three directly
     (`AvailabilitySection.jsx`, `InterviewDayDrawer.jsx`, `WeekCalendar.jsx`,
     `App.jsx`). The precondition for splitting them, ownership-checked server
     endpoints for block activation, slot block/unblock, and Teams-invite
     marking, has not been built; `api/availability.js` ALLOWED_ACTIONS covers
     only create_block, delete_block, delete_slot, cancel_booking.

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
  repository migration. Section 1 of
  `db/audit/public_endpoint_hardening_checks.sql` confirms it exists; that
  query has not been confirmed run.

## S-12. UNRECOVERABLE (defined in chat only)

No identifier, commit, code marker, or document for S-12 exists in the
repository. Status unknown. Do not infer it was closed or minor.

## S-13. UNRECOVERABLE (defined in chat only)

Same as S-12.

## S-14. Interviewer outcome writes unscoped by cohort

- **Severity (assessed)**: Medium-high. Any interviewer could write status and
  interview outcomes for students in any cohort; role alone was the gate.
- **Status**: Closed.
- **Closing commit**: `22ffe16` (2026-08-21).
- **Evidence**: `api/student-update.js` bounds interviewer outcome writes by
  ACTIVE cohort entitlements, using the same identity-based predicate as
  `api/student-file-access.js`, with the model stated in the S-14 comments at
  lines 456 to 462.

## S-15 through S-33. UNRECOVERABLE (defined in chat only)

Nineteen findings whose definitions exist only in the original in-chat report.
Nothing in the repository names, closes, or references any of them. If the
original report text can be recovered from conversation history, transcribe it
here; otherwise these remain permanently unknown and any future audit should
treat the S-numbering as historical rather than authoritative.

## D-01 through D-04. UNRECOVERABLE (defined in chat only)

Dependency items from the original report. Same situation as S-15 through S-33.

---

## Related remediation shipped without an S-number

- `bc77cdb` + `supabase/migrations/20260822010000_interview_rubric_authorization.sql`:
  interview rubric details restricted by author
  (`can_manage_all_interview_rubrics()`).
- `2571974` + `supabase/migrations/20260822030000_drop_interviewers_full_access_policy.sql`:
  drops the dashboard-created `"Full access on interviewers"` FOR ALL TO public
  USING (true) policy, discovered by POST 1 of the Wave E verification. Until
  applied, that policy nullifies every other policy on the table.
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
5. Applied state of migrations 20260822010000, 20260822020000, 20260822030000.
