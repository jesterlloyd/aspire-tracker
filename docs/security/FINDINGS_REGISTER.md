# Security Findings Register

**Program status, 2026-10-02.** S-01 through S-33 and D-01 through D-05 are Closed, and
`npm audit` reports zero advisories at `58dc8324`. The "Unverified in production" list at
the end is resolved, with one accepted gap recorded by the Owner's decision: a revoked
portal session keeps showing already-loaded screens until its next request. A read-only
DELTA AUDIT of everything added since the original audit (commit `9258409`, 2026-08-20,
through `03f314db`: 739 commits, 85 migrations, about 200 endpoint files) was completed
the same day. It found no regression of a closed finding and sixteen new findings,
S-34 through S-49, all OPEN below: six Medium, ten Low, none High or Critical.

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
- **Status**: Closed. The three excluded tables were the last part: their browser
  writes are gone (S04-1, 2026-09-25) and the policy split for them,
  `20261004000000_s04_interview_tables_write_split.sql`, was APPLIED by the Owner on
  2026-09-25 with S04-1 live, its POST 1 to 4 passing (see the OWNER_SQL_GATE ledger).
  Every core table now has SELECT on `is_staff()` and writes on
  `is_active_staff_writer()`.
- **Closing commits**: `8494615` (migration), `da5943d` (self-service-first
  revision), `d0a38b2` (interviewer delete moved server-side, refused UI
  controls gated), and S04-1 (2026-09-25), the commit that adds
  `supabase/migrations/20261004000000_s04_interview_tables_write_split.sql`.
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
- **The last part, done in S04-1 (2026-09-25)**. `interview_availability_blocks`,
  `interview_slots` and `interview_sessions` were excluded from the Wave E split
  because interviewers legitimately write them from the browser, and RLS cannot say
  "your own". Discovery found eleven browser write sites: two unreferenced legacy
  components (`AvailabilitySection.jsx`, which inserted blocks and slots and toggled and
  deleted blocks; `WeekCalendar.jsx`, which updated and inserted sessions), the
  availability manager's pause/resume toggle, the day drawer's Mark sent, Block Time and
  Unblock, and the student-delete cascade in `StaffApp`. Ownership is reachable
  server-side for every one: a block names its interviewer (`interviewer_profile_id`,
  since WAVE F-2) or its creator (`created_by_user_id`); a slot reaches its block through
  `block_id`; a session reaches its slot through `slot_id`. Two shapes have no
  interviewer owner and are admin-level only: a slot with no parent block, and a session
  with no slot. No write was found whose ownership could not be decided.
- **Fix, application**: `api/availability.js` gains five ownership-checked actions,
  `set_block_active`, `block_slot`, `unblock_slot`, `mark_teams_invite_sent` and
  `delete_student_sessions`, beside its existing five. Each allows the owning
  interviewer (the block's `interviewer_profile_id` OR `created_by_user_id`, so a block an
  admin made FOR an interviewer is theirs to manage) or an active Owner, Admin or
  Co-Lead; Co-Lead joins the endpoint's admin level to match `is_active_staff_writer()`.
  A booked slot can be neither blocked nor unblocked. `teams_invite_sent_by` and
  `teams_invite_sent_at` come from the verified profile and are refused in the body.
  The two legacy components are deleted (nothing rendered them); the manager, the drawer
  and the cascade call the endpoint through `src/lib/availabilityApi.js`.
  `test/s04InterviewerSelfService.test.mjs` sweeps `src/` and fails on any direct write
  to the three tables, and drives every rule through the endpoint's factory.
- **Fix, database**: `20261004000000_s04_interview_tables_write_split.sql` drops the
  three named Wave E FOR ALL policies and creates the split (SELECT on `is_staff()`,
  INSERT, UPDATE and DELETE on `is_active_staff_writer()`), the shape the other eight
  tables already have; any other policy on the tables is preserved (tested). One
  transaction, safe to re-run, inert rollback at the end. Checks in
  `db/audit/s04_interview_tables_write_split_checks.sql`, PRE 1 to 3, the file, POST 1
  to 4. It was applied only after S04-1 was live, because until then an interviewer's
  self-service writes were still browser writes, which the split would have silently
  refused. Results, 2026-09-25: PRE 1 exactly the three Wave E FOR ALL rows on
  `is_staff()`, no other policy; PRE 2 both predicates SECURITY DEFINER with
  `search_path=public, pg_catalog`; PRE 3 RLS on, anon has no UPDATE; POST 1 the twelve
  split policies and no `staff_all_*` row; POST 2 no rows; POST 3 writes 9, writer_gated
  9; POST 4 identical to PRE 3.
- **What an interviewer keeps**: everything. Pause and resume their own blocks, block and
  unblock their own open slots, mark their own Teams invites sent, and the existing
  create, delete and cancel. What changes: they can no longer do any of those on another
  interviewer's rows, which the old FOR ALL policy allowed and the UI did not offer.

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
- **Status**: CLOSED. The server-side check has been live since `0186482`
  (2026-08-23); the hashing (S08-1, `4be42047`) was applied to production by the Owner on
  2026-09-25, both migrations in one sitting with the deploy live. Four cohorts held a
  password (Winter 2027, now the accepting cohort, Fall 2026, Spring 2027, Summer 2026;
  one more than the 2026-08-27 count); every one was hashed, re-verified through its hash
  inside migration A's transaction and again in POST-A 3 and PRE-B 1, and still verifies
  after the plaintext column was dropped (POST-B 3). The real password opened the live
  school form and a wrong one was refused (POST-B 4). The live RPC bodies PRE-A 1 read
  matched the recorded semantics exactly. No plaintext password remains anywhere in the
  database, and no code path can write one.
- **Closing commits**: `0186482` (the server-side check, 2026-08-23) and S08-1
  (2026-09-25), the commit that adds
  `supabase/migrations/20261002000000_s08_school_form_password_hash.sql` and
  `supabase/migrations/20261003000000_s08_school_form_password_plaintext_drop.sql`.
- **Part one, the bypass (closed 2026-08-23)**: `api/school-form-submit.js` verifies via
  `school_form_requires_password` then `verify_school_form_password` BEFORE any
  write, mirroring the authenticated Academic Partner path; missing and wrong
  passwords are refused identically; a failed requirement lookup refuses rather
  than waves through; the entered password never reaches a write, log, or
  response. The client sends the password it already holds.
- **Part two, found in discovery (2026-09-25)**: the plaintext column was READ by
  every `select *` on cohorts (the staff app loads all cohorts that way, so every
  staff session received every password) and by the two RPCs; it was WRITTEN by
  `NewCohortModal` and `ManageCohortModal` through `StaffApp.createCohort` and
  `updateCohort`, straight into the cohorts row from the browser, and the Manage
  modal prefilled the stored value into its text input. The RPC bodies are described
  in `db/audit/public_endpoint_hardening_checks.sql` (requires: column non-empty;
  verify: TRIM(stored) = TRIM(entered)) but not recorded verbatim, so PRE-A 1 re-reads
  them and STOPs on a difference. pgcrypto's `crypt` is the one password-hashing
  primitive available to a SECURITY DEFINER function; nothing else in the repo hashes
  a password (tokens use SHA-256 in Node). Three cohorts hold passwords: Fall 2026
  (accepting), Summer 2026, Winter 2027.
- **Fix, application (S08-1)**: `api/cohort-password-set.js` (Owner/Admin session,
  S-05 check included) is the one writer; it hands the value to the service_role-only
  RPC `set_school_form_password`, which stores `crypt(btrim(password),
  gen_salt('bf', 10))` in a new table `cohort_form_secrets` and NULLs any plaintext for
  that cohort. The password is never logged or echoed; an audit row records who set or
  cleared it, without the value. Until migration A is applied the endpoint answers 503
  (`password_hashing_not_enabled`) rather than fall back to plaintext. `StaffApp`
  strips the password from every cohorts insert and update and calls the endpoint;
  `ManageCohortModal` never prefills, shows whether a password is set through the same
  RPC the public form asks, and sends only a NEW password; `NewCohortModal` is
  unchanged. `test/s08SchoolFormPasswordHash.test.mjs` sweeps `src/` for any cohorts
  write naming the column.
- **Fix, database, two migrations**: A (`20261002000000`) installs pgcrypto if
  absent, creates `cohort_form_secrets` (RLS on, no policy, so no browser role can
  read a hash; the app's `select *` on cohorts never sees one), drops and recreates
  both RPCs from the repository with the same signatures, SECURITY DEFINER, pinned
  `search_path = public, pg_catalog`, and EXECUTE for anon, authenticated and
  service_role (anon must keep it: the public form calls both before sign-in),
  adds `set_school_form_password`, backfills a hash for every cohort with a plaintext
  password, and PROVES inside the transaction that `verify_school_form_password`
  accepts each cohort's own plaintext through the hash and refuses a wrong one; one
  failure rolls the file back. B (`20261003000000`), only after A's POST passes and
  S08-1 is live, re-proves, NULLs and drops the plaintext column, and recreates the
  three functions without the fallback branch.
- **No correct password is refused at any point**: TRIM is preserved on both sides
  (the hash is over `btrim(stored)`, the entered value is `btrim`'d), the verifier
  prefers the hash and, until B, falls back to the old TRIM-equality rule for a
  cohort with plaintext and no hash, so a password written by the old modal code
  between A and the deploy still works, and A's own assertion runs the new verifier
  against every stored password before committing. Fall 2026 stays live throughout.
- **What proves the fallback is safe to remove**: POST-A 3 (every cohort with a
  password verifies through its hash, and a wrong password is refused), PRE-B 1
  (plaintext rows = hashed rows = verifying rows), the sweep test (no browser
  writer), and B's own precondition, which refuses to drop a plaintext value that has
  no hash. Applying either file twice is a no-op (tested).
- **Verification**: `db/audit/s08_school_form_password_hash_checks.sql`, PRE-A 1 to 4,
  A, POST-A 1 to 5, deploy, PRE-B 1 to 2, B, POST-B 1 to 4 (POST-B 4 is the live try
  on the school form with the real password, by hand). No section selects a password
  or a hash as output. The test runs A and B on real Postgres with pgcrypto (PGlite)
  against passwords generated at test time; no password value is in the repository.

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
- **Closing commit**: `74bc75ba` (2026-08-27).
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
- **Status**: CLOSED.
- **Closing commit**: S13-1 (2026-09-25), the commit that deletes `api/send-notification.js`
  and `api/admin/resend-interview-reminders.js`. Application code only; no SQL.
- **Risk (historical)**: `api/send-notification.js` accepted any `type` and arbitrary
  `context`, recipient included, against a single static `ADMIN_NOTIFICATION_TOKEN`
  compared with `!==`, recorded no actor, and returned raw `err.message`. Anyone holding
  the token could send arbitrary program email with no attribution.
- **Found in discovery, at HEAD**: THREE endpoints authenticated with that token, all
  with the same `!==` comparison: `api/send-notification.js`,
  `api/admin/resend-interview-reminders.js` and `api/admin/resend-coordinator-digest.js`.
  No code, cron, script or UI called any of them; the only usage was the curl examples in
  their own headers, and Keith's knowledge text names the digest one as the recovery
  endpoint. The token is present in the local `.env.local` (name only; the value was not
  read or printed). **The force flag the audit described exists at HEAD and is now
  located**: not in `send-notification.js`, where the last verification looked, but in
  both admin endpoints. In the interview-reminder one, `force` bypassed the 48-hour
  already-sent check; in the digest one it bypassed the already-sent check AND the
  coordinator's `weekly_digest: false` opt-out. Recipients: `send-notification.js`
  took them from the caller (every student-facing type reads `context.studentEmail`);
  the interview-reminder re-run derived them from booked slots; the digest re-run
  derived them from contacts by school, except `testMode`, which mailed a rendered
  digest full of real students' events to whatever `testRecipientEmail` the caller
  supplied.
- **Decision**: retire what nothing uses; keep the one endpoint with operational value
  on a real session. `send-notification.js` had no caller and was, by design, an
  arbitrary-recipient sender for every template: deleted. `resend-interview-reminders.js`
  was a one-shot recovery for the interview-reminder window bug of 2026-05-20, fixed
  since, with no caller: deleted. `resend-coordinator-digest.js` is the digest's test and
  backfill tool and stays.
- **Fix, on the kept endpoint**: authentication is an ACTIVE Owner or Admin session,
  verified server-side from the Bearer JWT through `verifyOwnerAdminCaller` (S-05's
  deactivation check included). No token is read. The verified profile is the actor on
  every row: `triggered_by_profile_id` and `triggered_by_name` in the metadata of the
  test, sent and failed `notification_log` rows, and an `activity_logs` row per run
  (`coordinator_digest_manual_run`). A test send goes only to the caller's own account
  email, compared case-insensitively; any other address is refused with 403. `force`
  now bypasses the already-sent check ONLY; an opted-out coordinator is never sent a
  digest. Every response is generic (`internal_error`, `send_failed`); provider and
  database text stays in the server log. The handler is built by a factory so it is
  tested with the caller, database and mailer mocked and no email can leave.
- **Regression guard**: `test/s13StaticTokenAuth.test.mjs` sweeps `api/`, `lib/` and
  `src/` for any `===` or `!==` against a TOKEN, SECRET or KEY environment value, any
  `x-admin-token` read, and any mention of `ADMIN_NOTIFICATION_TOKEN`; asserts the two
  retired files are absent and unreferenced; pins `api/lib/cronAuth.js` as the one
  constant-time credential check; and drives the digest endpoint: refused without a
  session and before any read or send, a foreign test address refused, a test send only
  to the caller, the actor on every row, an opt-out surviving `force`, generic failure
  text.
- **What an admin workflow loses**: the ability to re-send missed interview reminders by
  hand, and to send any notification template to any address from a shell. The digest
  test and backfill keep working from a signed-in Owner or Admin session, with a Bearer
  token instead of the shared header; a test digest now goes to the caller's own address
  rather than a chosen one. `ADMIN_NOTIFICATION_TOKEN` can be removed from Vercel and
  `.env.local`; nothing reads it (an Owner action, not made here).

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

- **Severity (original)**: Medium.
- **Status**: CLOSED.
- **Closing commit**: `42e67e67` (S15-1, 2026-09-24), which adds
  `supabase/migrations/20260930000000_s15_unit_leader_thread_read_scope.sql`. Applied to
  production by the Owner the same day; POST 1 to 6 of the audit file all matched their
  expected results (POST 1: can_read now reads user_unit_scopes; POST 2: attributes and
  grants identical to PRE 2; POST 3: 0 / 0 / 0 / 0; POST 4: student 7 / 7, unchanged;
  POST 5: 0 disagreements; POST 6: no participant row removed). PRE 3 returned no rows:
  no Unit Leader has been a thread participant yet, so the exposure was 0 at the time of
  closing and the fix is preventive.
- **Risk (historical)**: revoking a unit scope does not remove conversation membership,
  so a former Unit Leader keeps reading unit threads.
- **Root cause, found in discovery**: `message_participant_can_read`'s unit_leader branch
  required an unremoved participant row, an active account and an active `unit_leader`
  role grant, and never asked `user_unit_scopes`. `message_participant_can_send` did.
  `my_message_conversation_ids()` delegates to can_read, so list, thread, unread count,
  archive and reactions all inherited the gap. It was a decision, not an oversight:
  VERIFY 7c of `db/audit/unit_leader_portal_preflight_and_verification.sql` PASSED only
  while can_read did NOT read `user_unit_scopes`, "so that history is preserved after an
  assignment ends". The Owner reversed it on 2026-09-24: access ends when scope ends, no
  grace period.
- **Fix**: the unit_leader branch of can_read gains the SAME active-scope test can_send
  applies, in the same shape: a unit-scoped row (direct_student and team_student_context
  threads) needs an active `user_unit_scopes` row for THAT unit; a general row
  (team_general, `scope_unit_key` NULL) needs any active unit scope through
  `message_profile_has_active_unit_leader_portal_scope()`. Enforced in the read
  predicate, never by writing `removed_at`: participant rows stay as history (Messages
  Phase 1), and a scope that lapses through `expires_at` runs no code, so only a
  predicate evaluated at read time catches it. `revoke_portal_access` is unchanged.
  Signature, SECURITY DEFINER, STABLE, the pinned search_path and the service_role-only
  grants are restated exactly; the student, academic_partner and nursing_academic
  branches are the 20260828000000 bytes (a test compares them).
- **Scope is by unit, not cohort**: `user_unit_scopes.cohort_id` is not consulted,
  because can_send does not consult it and a unit_leader participant row cannot carry a
  cohort (`chk_participant_role_scope`). Gating by cohort would be a second rule.
- **What else changes**: `message_recipient_has_active_access` delegates to can_read,
  so a staff reply no longer notifies a Unit Leader who has lost the thread's unit, and
  the staff reply RPC refuses a delivery naming such a Unit Leader as recipient (MS409),
  which is its existing rule for any participant who cannot read. Staff reads are
  policy-gated on `is_active_owner_or_admin()` and do not touch can_read.
- **Verification**: `db/audit/s15_unit_leader_thread_read_scope_checks.sql`, PRE 1 to
  PRE 5 then the migration then POST 1 to POST 6; POST 3 proves a Unit Leader without
  active scope for a thread's unit cannot read it and one with scope still can, POST 4
  that the other roles' readable counts are unchanged, POST 5 that read and send agree.
  `test/s15UnitLeaderThreadReadScope.test.mjs` runs the migration on real Postgres
  (PGlite): revoked scope blocks, expired scope blocks the moment it lapses, active
  scope allows, read and send agree for every Unit Leader row, student and Academic
  Partner reads unchanged, and every audit section is executable. The old predicate is
  shown admitting the revoked case first, so the proof is not vacuous.
- **Superseded, on purpose**: VERIFY 7c of the 2026-07-20 audit file now reports
  `requires_active_unit_scope = true` for can_read. That section recorded the earlier
  decision and is left as its record; this entry is the correction.

## S-16. Avatar uploads bypass the server; avatar_url accepted as arbitrary string

- **Severity (original)**: Medium.
- **Status**: CLOSED.
- **Closing commit**: `c53a0d5d` (S16-1, 2026-09-24), which adds
  `supabase/migrations/20261001000000_s16_avatar_writes_server_only.sql`. Applied to
  production by the Owner on 2026-09-25 after the code was live; POST 1 to 4 all matched
  (avatar_url no longer browser-updatable while the six other self-service columns,
  `ui_preferences` included, kept their grant; update_my_avatar EXECUTE false for
  authenticated and anon; only the two SELECT policies remain on the buckets; row counts
  identical). PRE 3 found and the migration dropped three dashboard-created `avatars`
  write policies (insert, update, delete, each scoped to the caller's own folder); their
  expressions are recorded in the OWNER_SQL_GATE ledger row. PRE 4 found zero stored
  avatar_url values outside own Storage, so no legacy value exists to grandfather.
- **Risk (historical)**: content-type and path discipline enforced nowhere, and a staff
  admin can point another user's avatar at any URL.
- **Found in discovery, at HEAD**: five write paths, three of them browser-side.
  `src/components/UserMenu.jsx` uploaded to the public `avatars` bucket with the client's
  file extension, then called `update_my_avatar` with the URL, falling back to a direct
  `user_profiles.avatar_url` update that Wave E's column grant allowed.
  `src/lib/contactAvatarUpload.js` (shared by Connect > Contacts and Rotation >
  Preceptors) uploaded to `contact-avatars` the same way. Connect's contact form also had
  a free-text "Avatar URL ... or paste directly" field. Server-side, `api/contacts-upsert.js`
  allowlisted `avatar_url` with no validation, `api/portal/academics-contacts.js` accepted
  any http(s) URL, and `api/admin-users.js` `update_avatar` accepted any string. Three
  endpoints already did it right (`api/portal/my-avatar.js`, `api/admin-avatar-upload.js`,
  `api/portal/academics-contact-avatar.js`): server-side upload, fixed extension map,
  size cap, magic-byte sniff. `update_my_avatar` is dashboard-created; its body is not in
  the repository. The two buckets are public-read by design (stored URLs render as
  `<img src>`); only `contact-avatars`' write policies were in the repository.
- **What a hostile value could do**: every render is an `<img src>` (Accounts & Access,
  the header menu, Connect contacts and the address book, the recipient picker, contact
  autocomplete, universal search, the preceptor directory, the four portal headers); none
  is an `href`, an inline style or `dangerouslySetInnerHTML`. A pasted value therefore
  cannot run script, but it can point every viewer's browser at a third-party host (a
  tracking pixel that logs who opened which screen and when) and show whatever image that
  host chooses under a real person's name.
- **Fix**: one rule module, `api/lib/avatarImage.js`: the image contract from
  `my-avatar.js` (type map, 2 MB decoded cap, sniff) and `isOwnAvatarStorageUrl`, which
  admits only an empty value or an https public-object URL on this project's Storage
  origin in the `avatars` or `contact-avatars` bucket, with an optional `?v=` token.
  Two new endpoints on that module: `api/my-avatar.js` (a staff member's own photo, path
  derived from the verified identity, portal profiles refused) and
  `api/contact-avatar-upload.js` (Owner/Admin, the staff twin of the NE&L portal's
  endpoint, persists `contacts.avatar_url` when a contact id is given). `UserMenu` and
  `contactAvatarUpload.js` now post bytes to them; the paste field is gone. The three
  value writers call `validateAvatarUrlChange`, which passes an unchanged stored value
  (a legacy row keeps saving and rendering until its photo is replaced or cleared) and
  refuses any new value outside own Storage. Existing avatars render unchanged: nothing
  rewrites a stored URL.
- **Migration** (Owner-gated, one block): revokes the `avatar_url` column UPDATE from
  `authenticated` (the other five self-service columns keep theirs), revokes browser
  EXECUTE on every `update_my_avatar` overload, drops the two named `contact-avatars`
  write policies, and drops any INSERT/UPDATE/DELETE/ALL policy on `storage.objects`
  whose expression names the `avatars` bucket, raising each name as a NOTICE. Read
  policies stay. Server uploads run as service_role and bypass Storage RLS, so nothing
  the application does depends on a dropped policy. Apply only after S16-1 is live.
- **Verification**: `db/audit/s16_avatar_writes_server_only_checks.sql`, PRE 1 to 4 then
  the migration then POST 1 to 4 (PRE 3's output is the only record of the dropped
  avatars-bucket policy text; keep it). `test/s16AvatarUploadsServerOnly.test.mjs`
  sweeps `src/` and fails on any browser write to an avatar bucket, any
  `update_my_avatar` call or any browser write of `avatar_url`; tests the rule against
  a list of hostile values; drives both endpoints through their factories; pins the three
  value writers to the rule; and runs the migration on real Postgres (PGlite) with the
  Wave E grant, the RPC and both buckets' policies in place, proving what goes and what
  stays and that every audit section executes.
- **Left as is, on purpose**: `api/lib/unitPreceptorContactSync.js` and
  `api/portal/unit-preceptors.js` write a contact `avatar_url` from a photo the Unit
  Leader endpoint itself uploaded with the service role; the value never comes from a
  client. `api/portal/my-avatar.js` mirrors its own `avatars` URL into the matching
  contact, which is why the rule admits both buckets on a contact.

## S-17. Client caches survive sign-out and account switch

- **Severity (original)**: Medium.
- **Status**: CLOSED.
- **Closing commit**: S17-1 (2026-09-25), the commit that adds `src/lib/signOutCleanup.js`.
  Application code only; no SQL.
- **Risk (historical)**: React Query data, drafts, and recipient lists from one account
  are readable in the next session on a shared machine.
- **Found in discovery, at HEAD**: `AuthContext.signOut` cleared the signed-photo cache
  and the portal cohort hint; the SIGNED_OUT handler additionally cleared the leaving
  user's tab keys (FRESH-LOGIN-HOME-1). Nothing cleared the React Query cache, so every
  roster, thread and list the previous person opened stayed in memory until the tab
  closed, readable by the next sign-in before their own fetches landed. Every session
  end arrives as SIGNED_OUT (deliberate sign-out and expiry alike); S-05's deactivation
  and revocation paths refuse on the server and show the no-access card, and never
  ended the session client-side, so nothing ran for them either. Forty-odd storage
  writes existed across `src/`. Most drafts were already keyed by user id (Outreach
  direct, pointer and bulk drafts by user and cohort; rubric drafts by student and
  interviewer profile; cohort, tab, cycle, preferences, demo choice, Keith settings).
  Unkeyed keys that held people or place: the interviewer roster cache (names, emails),
  the last opened contact, the Connect tab, the Outreach launch context in
  sessionStorage (a student's or contact's id, name and email), the signed-photo
  mirror, the portal feedback idempotency id, the tour snooze, and four legacy auth
  flags.
- **Decision, keyed versus deleted**: a draft already keyed by user id is kept. Its
  readers build the key from the signed-in id, so another account cannot reach it
  through the app, and deleting it on sign-out would lose unsent work the person is
  entitled to find again. Everything unkeyed that holds a person or a place is deleted.
  Device and UI preferences with no personal data are kept. The demo ARMED marker is
  kept because `reconcileDemoModeForUser` settles it against the arriving user's own key
  at sign-in; clearing it would run a presenter's first queries in real mode.
- **Fix**: `src/lib/signOutCleanup.js` is the one registry of every storage key the app
  writes, each with a class (clear, keyed, preference, mechanism, public, auth) and what
  it holds, and one function, `clearClientStateOnSignOut`, which clears the React Query
  cache, drops the photo cache, and removes every `clear` key from both stores. Never
  throws; idempotent. `AuthContext` calls it before the sign-out request, on SIGNED_OUT
  (expiry included), on a SIGNED_IN whose user differs from the one this tab or this
  browser last held, and on a restored session for a different user than the browser
  last saw (`aspire:lastAuthenticatedUserId`). The query client is reached through
  `getQueryClient()` in `src/lib/supabase.js` rather than the hook, because
  `AuthProvider` also mounts in the public-site prerender with no provider above it.
- **Regression guard**: `test/s17SignOutCleanup.test.mjs` walks every `setItem()` in
  `src/`, resolves the key each writes (literal, template prefix, constant, key-builder
  function, or a wrapper's callers) and fails if the registry does not classify it; and
  proves sign-out clears the cache and the sensitive keys, preferences survive, a switch
  to another user leaves nothing readable as theirs, and the cleanup never throws.
- **Behaviour a person will notice**: after signing out, Connect reopens on its first
  tab rather than the last one, the last opened contact is not preselected, the
  interviewer roster loads from the server instead of the cache, and a tour snoozed in
  the previous session shows again. Unsent Outreach and rubric drafts are still there
  for the same person on the same browser, as before.

## S-18. anon USING (true) read policy on unit_leaders

- **Severity (original)**: Medium. **Status**: CLOSED, by table removal.
- **Closing commit**: `68de62b0` (the migration, 2026-09-20) with `a92e83e3` (the
  ledger row); the readers had already moved to Connect in `31f943c3`
  (UNIT-LEADERS-RETIRE-1).
- **Risk (historical)**: the full unit leader roster including emails readable with the publishable anon key.
- **Evidence**: `supabase/migrations/20260923000000_drop_unit_leaders.sql` drops
  `anon_read_unit_leaders` by name, then the table itself; the Owner applied it
  on 2026-09-20 (PRE 3 listed exactly the three policies the migration names;
  POST 1: present false, policies 0, indexes 0; see the OWNER_SQL_GATE ledger).
  A policy on a table that no longer exists cannot be read through. Nothing
  reads the table any more: `test/unitLeadersFromConnect.test.mjs` sweeps
  `api/`, `lib/` and `src/` for any `from('unit_leaders')` and fails on one, so
  the table cannot be quietly recreated and read without failing the suite.
  Unit leadership is read from Connect contacts through
  `src/lib/unitLeadersFromConnect.js` only.
- **Historical note**: `anon_read_unit_leaders` was dashboard-created and
  appeared in no repository migration, the same class as the interviewers
  catch-all closed by 20260822030000. It was never confirmed by a live read
  before the drop; the drop's PRE 3 was that confirmation.

## S-19. Raw provider and database error text returned on public routes

- **Severity (original)**: Low. **Status**: Closed.
- **Risk**: internal table, constraint, and provider detail disclosed to anonymous callers.
- **Verified at HEAD**: the S-01/S-06/S-07 and S-08 through S-11 hardening made the interview, intake, unit-form, and shift-log surfaces generic. The one named residual, `api/school-form-submit.js` returning `{ error: result.error }` from the placement upsert helper, was re-read at LOW-1 (2026-09-26): `result.error` is never provider or database text. `api/lib/schoolPlacementUpsert.js` returns only its own fixed sentences ("Failed to save rotation dates.", "Failed to load existing students for matching.", and two that name the submitted student, "Failed to add student X."), and writes the underlying error to the server log with `console.error` before returning. One of them ("There is no existing placement request for this school and cohort to add students to.") is a message the coordinator is meant to read. No code change; `test/lowSeverityCleanup.test.mjs` pins that the helper never returns `err.message`, `error.message` or a template over a database error.
- **Closing commit**: LOW-1 (2026-09-26), by verification.

## S-20. Recipient names and emails written to function logs in three crons

- **Severity (original)**: Low. **Status**: Closed.
- **Risk**: student and coordinator PII accumulates in Vercel log retention.
- **Verified at HEAD (before LOW-1)**: `interview-reminders.js:156`, `coordinator-weekly-digest.js:465`, and `midpoint-checkin.js:151` each logged recipient email and name on every send; the digest also named the coordinator in five error and skip lines, and the two student crons put the email in their send-failure line.
- **Fix (LOW-1, 2026-09-26)**: every one of those lines logs ids only: the session and student id, the student id, or the coordinator id. `test/lowSeverityCleanup.test.mjs` sweeps the three files and fails on any console line that interpolates an email, a first or last name or `full_name`.
- **Closing commit**: LOW-1 (2026-09-26).

## S-21. Resend webhook allows same-rank lateral writes, no replay dedup

- **Severity (original)**: Low. **Status**: Closed.
- **Risk**: a replayed or reordered event of equal rank rewrites delivery status and timestamps.
- **Verified at HEAD (before S21-1)**: `api/webhooks/resend.js` verifies the Svix signature, but the guard is `newRank >= currentRank` (same-rank writes pass) and no svix-id is stored or checked for replay.
- **Closing commit**: S21-1 (2026-09-26). Code only; no SQL.
- **Discovery (S21-1)**: the ranking was queued 0, sent 1, delivered 2, delayed 2, opened 3,
  clicked 4, bounced 5, complained 5, failed 5, applied with `>=`, so delayed could
  overwrite delivered and complained could overwrite bounced; every timestamp column was
  rewritten on every event. The webhook writes `notification_log` (status and the six
  timestamp columns), `message_notification_deliveries.provider_status` (through
  `shouldApplyProviderStatus`, also `>=`), and inserts one `staff_notifications` row on the
  first delivered event of an outreach send. Svix sends `svix-id`, `svix-timestamp` and
  `svix-signature` on every event and the signature covers the id, so the id is available
  and trustworthy on every verified event. `notification_log.metadata` is a jsonb column
  no other writer updates, so the applied ids live there without a new table.
- **Fix**: `decideNotificationUpdate` is the pure rule: a terminal status (bounced,
  complained, failed) is never overwritten; a status moves only to a strictly higher rank,
  with delayed now BELOW delivered; a timestamp column is written once, when null. The
  applied `svix-id`s are kept in `metadata.webhook_event_ids` (most recent 50); a known id
  is acknowledged and changes nothing, and the update is a compare-and-set that matches no
  row when a concurrent duplicate got there first. `shouldApplyProviderStatus` is now
  strictly greater-than, so the Messages delivery path cannot move sideways either.
  Signature verification is unchanged and still runs first; a forged signature is refused
  before any read. `createResendWebhookHandler` makes the handler testable; the default
  export is unchanged for Vercel. `test/s21ResendWebhook.test.mjs` proves the forged
  signature, the out-of-order events, the replays (including a concurrent one) and the
  provider-status rule.

## S-22. is_owner_or_admin() ignores is_active

- **Severity (original)**: Low. Assessed higher in practice: the exposure below
  is a live browser path, not a theoretical one.
- **Status**: CLOSED.
- **Closing commit**: `8762010` (migration, audit file, and tests). Applied to
  production 2026-08-29 and confirmed via POST 1 to 5 of the audit file: the
  predicate delegates to is_active_owner_or_admin with its hardened attributes
  intact, both helpers agree for the session, every dependency is unchanged
  from the PRE 2 inventory, grants exclude anon and PUBLIC, and no second
  overload exists.
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
- **CORRECTION, recorded 2026-08-29**: the discovery report claimed the two
  helpers differed in TWO ways, the is_active check and the EXECUTE grant. Only
  the FIRST was real. PRE 4 against production showed is_owner_or_admin ALREADY
  held service_role EXECUTE, so the grant-parity step in the migration was a
  no-op. The claim came from reading the legacy CREATE statement in
  migrations/migration_track_b_v1a_secure_completion_rpc.sql, which grants to
  authenticated only, and assuming the live grants still matched it; a grant
  added later out-of-band is invisible in repository SQL, which is the same
  blind spot this finding's whole approach was designed around. The applied
  migration's header still carries the original claim and was deliberately not
  edited, since it is a record of what ran; this entry is the correction of
  record. The one real difference, the is_active check, is what the migration
  fixed.
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

- **Severity (original)**: Low. **Status**: Closed. The migration
  `20261006000000_s23_append_only_event_tables.sql` was APPLIED by the Owner on
  2026-09-25 and PRE 1 to 4 and POST 1 to 5 passed (see the OWNER_SQL_GATE ledger). Every
  documented append-only event and audit table now refuses UPDATE, DELETE and TRUNCATE by
  trigger, whatever role issues them.
- **Risk**: documented-append-only history (e.g. preceptor_assignment_events) is silently rewritable by any service-role code path or compromised key.
- **Verified at HEAD (before S23-1)**: GRANT ALL to service_role, and no UPDATE/DELETE-blocking trigger in any migration touches `preceptor_assignment_events`.
- **Template for the fix, in-repo since 2026-09-23**: the enforcement this finding asks for now exists on two newer tables. `supabase/migrations/20260927000000_signatures_phase2.sql` puts `trg_sig_events_append_only` (BEFORE UPDATE OR DELETE) and `trg_sig_events_no_truncate` (BEFORE TRUNCATE) on `sig_events`, and `20260929000000_form_sheet.sql` puts `trg_form_answer_corrections_append_only` on `form_answer_corrections`; both refuse the statement regardless of role, so a service-role path cannot rewrite history. `test/signaturesMigration.test.mjs` proves the sig_events triggers on real Postgres (PGlite). `20260725000000_unit_leader_evaluation_release_gate.sql` has the same pair, plus trimmed grants, on `evaluation_response_unit_release_events`.
- **Closing commits**: S23-1 (0b811653, 2026-09-25), which adds
  `supabase/migrations/20261006000000_s23_append_only_event_tables.sql`, and S23-2
  (2026-09-25), which records the application. Results: PRE 1 all fifteen present, only
  `form_answer_corrections`' own trigger and the Action Center's AFTER INSERT trigger on
  `conversation_events` pre-existing; PRE 2 six tables with service_role UPDATE, DELETE
  and TRUNCATE; PRE 3 CASCADE only on the two named keys and the corrections table, none
  from students or cohorts; PRE 4 `program_events` cascades from both students and cohorts
  (confirming its exclusion), `activity_logs` has SET NULL keys only and service_role still
  holds UPDATE and DELETE on it (a safe follow-up under this template); POST 1 both
  triggers on all fifteen; POST 2 no rows; POST 3 every table refused UPDATE, DELETE and
  TRUNCATE (three empty tables read no-rows for the row statements), the corrections
  table's TRUNCATE refused with its own check_violation code; POST 4 inserted 4, every
  update and delete refused, rolled back; POST 5 identical to PRE 2 on SELECT and INSERT
  with every write privilege false.
- **Discovery (S23-1)**. Every table in the migrations named as an event, audit or
  history table, or documented append-only, was listed with its enforcement:
  - Enforced already (grants and triggers): `sig_events`,
    `evaluation_response_unit_release_events`. `form_answer_corrections` had the
    UPDATE/DELETE trigger but no TRUNCATE trigger.
  - Grants only, no trigger: `conversation_events`, `ngrp_audit_events`,
    `ngrp_preceptor_feedback_access_events`, `portal_invitation_events`,
    `preceptor_projection_backfill_audit`, `shift_log_reviews`, `student_shift_log_edits`,
    `keith_requests`, `keith_skill_invocations`, `student_activity_completions`.
  - GRANT ALL for service_role, or the default privileges, and no trigger:
    `preceptor_assignment_events`, `cohort_unit_response_target_events`,
    `support_checkin_events` (added 2026-09-25, after the audit),
    `preceptor_mirror_repair_audit`, `unit_placement_request_events`.
  - Code paths: none of the tables above is updated or deleted by any file in `api/`,
    `lib/` or `src/`, or by any SQL routine in the migrations. Three documented-append-only
    tables DO have legitimate rewrite paths and are left out: `program_events` (maintenance
    UPDATE and DELETE in migrations; a delete in `StudentSidePanel.jsx`), `notification_log`
    (delivery status updated by the Resend webhook), and `cron_runs`,
    `evaluation_reminder_deliveries` and the community-benefit tables, which are updated by
    design. `activity_logs` is a pre-existing table whose foreign keys the repository cannot
    state; it is listed in PRE 4 of the checks for a follow-up rather than guessed at.
  - Foreign keys: `unit_placement_request_events` cascades from `unit_placement_requests`
    and `cohort_unit_response_target_events` from `cohort_unit_response_targets`; nothing
    deletes either parent (targets are deactivated). The template does not special-case a
    cascade: the cascaded DELETE fires the trigger and the parent delete fails, which is
    how `form_answer_corrections` already behaves toward `catalog_forms`.
    `student_activity_completions` cascades from `students`, which the staff app deletes,
    so a trigger there would break student deletion; it is EXCLUDED and stays
    grant-enforced (UPDATE and DELETE revoked from every role in 20260822000000). The
    version, revision and submission snapshot tables (`knowledge_entry_versions`,
    `template_versions`, `template_partial_versions`, `keith_skill_versions`,
    `ngrp_transition_revisions`, `ngrp_reflection_submissions`) and `messages` are
    immutable content, not event tables; they are out of this migration's scope and noted.
- **Fix**: `20261006000000_s23_append_only_event_tables.sql` adds one shared function,
  `public.append_only_refuse()` (ERRCODE 42501, as sig_events), and the template pair
  `trg_<table>_append_only` (BEFORE UPDATE OR DELETE, FOR EACH ROW) and
  `trg_<table>_no_truncate` (BEFORE TRUNCATE) to fourteen tables, adds the missing TRUNCATE
  trigger to `form_answer_corrections` on its own function, and revokes UPDATE, DELETE and
  TRUNCATE from PUBLIC, anon, authenticated and service_role on all fifteen (SELECT and
  INSERT grants untouched). One transaction, refuses to run if any covered table is
  missing, safe to re-run, inert rollback at the end. Checks in
  `db/audit/s23_append_only_event_tables_checks.sql`: PRE 1 to 4, the file, POST 1 to 5;
  POST 3 and POST 4 prove refusal and a successful INSERT on the live tables inside DO
  blocks that roll themselves back. `test/s23AppendOnlyEventTables.test.mjs` runs the
  migration on PGlite (INSERT succeeds, UPDATE, DELETE and TRUNCATE refused on every table,
  the cascade parent refused, twice-run, refuses on a missing table) and sweeps every
  `_events` and `_audit` table created in the migrations plus the documented ledgers,
  failing on any without both triggers unless excused with a reason.

## S-24. cohort_school_rotations readable by anon and any authenticated

- **Severity (original)**: Low. **Status**: Closed. The migration
  `20261007000000_s24_cohort_school_rotations_read_scope.sql` was APPLIED by the Owner on
  2026-09-26 and PRE 1 to 3 and POST 1 to 3 passed (see the OWNER_SQL_GATE ledger). The
  table is readable by staff only; an anon read is refused and a portal session reads
  nothing directly.
- **Risk**: rotation and coordinator detail readable with the anon key.
- **Verified at HEAD (before S24-1)**: `cohort_school_rotations_anon_select` USING (true) in 20260522000000; Wave E2 cleanup EXPLICITLY excluded this table (noted in 20260712000005), so the exclusion was deliberate but the exposure stands.
- **Closing commits**: S24-1 (cabaec9c, 2026-09-25), which adds
  `supabase/migrations/20261007000000_s24_cohort_school_rotations_read_scope.sql`, and S24-2
  (2026-09-26), which records the application. Results: PRE 1 exactly the two USING (true)
  policies; PRE 2 `is_staff` SECURITY DEFINER, RLS on, anon and authenticated SELECT
  granted; PRE 3 14 rows, 4 staff profiles, 8 portal profiles; POST 1 the single
  `cohort_school_rotations_staff_select` on `is_staff()`; POST 2 anon holds nothing,
  authenticated and service_role keep SELECT, RLS on; POST 3 PASS: anon refused,
  authenticated with no JWT 0, Academic Partner portal user 0, staff 14 of 14.
- **Discovery (S24-1)**. Every reader of the table at HEAD, and the role it runs as:
  - Browser, staff app, signed in with a staff role (`StaffApp.jsx`, `RotationActivity.jsx`,
    `MatchingTab.jsx`, `ManageCohortModal.jsx`, `CohortBar.jsx`, `OverviewTab.jsx`,
    `StudentSidePanel.jsx`, `StudentCoverage.jsx`, `Header/scope/InternshipCohortList.jsx`,
    `lib/home/homeLoaders.js`): ten readers, all covered by `is_staff()`. No portal bundle
    imports any of them.
  - Server, service role (bypasses RLS): the school form and placement upsert, Keith,
    community benefit, certificates, the shift-log window checks, `api/lib/schoolScope.js`
    and every portal endpoint (`school-students`, `school-placement-requests`,
    `unit-roster`, `unit-student-detail`, `my-rotation-activity`, `academics-calendar`).
    Each portal endpoint already scopes what it returns by the caller's school, unit or
    student; `auth.db` in those files is the service client, not the caller's JWT. The one
    caller-scoped client in `api/` (`getCallerScopedDb`) calls the school-form password RPC
    and never this table.
  - SQL routines: `reconcile_student_completions`, `reconcile_students_after_rotation_date`
    and `aspire_demo_inherit` are SECURITY DEFINER; `student_shift_classify` is
    invoker-rights with EXECUTE granted to service_role only. No view reads the table.
  - Public, logged-out pages: none. The "school-form confirmation fetch" the 2026-05 anon
    policy anticipated was never built, so nothing needed a field-allow-listed endpoint and
    none was added.
  - Portal roles: none reads the table from the browser, so no portal policy is created. A
    scoped policy would guard a read that does not exist; if a portal ever needs a direct
    read, one policy on `my_school_scope_keys()` is the shape.
  - Staff reads do not change: `is_staff()` admits owner, admin, co-lead, interviewer and
    viewer, exactly the accounts the staff app signs in.
- **Fix**: `20261007000000_s24_cohort_school_rotations_read_scope.sql` drops both USING
  (true) policies, creates `cohort_school_rotations_staff_select` FOR SELECT TO
  authenticated USING (`is_staff()`), and revokes the anon role's table grant so an anon
  read is refused outright. Writes were already service-role only and are untouched. One
  transaction, refuses to run without the table or `is_staff()`, safe to re-run, inert
  rollback at the end. No deploy is needed before or after it: no application code changes.
  Checks in `db/audit/s24_cohort_school_rotations_read_scope_checks.sql`: PRE 1 to 3, the
  file, POST 1 to 3; POST 3 impersonates anon, an unauthenticated JWT, an Academic Partner
  portal user and a staff profile inside a rolled-back DO block and proves anon is refused,
  the portal user reads nothing and staff reads every row.
  `test/s24CohortSchoolRotationsReadScope.test.mjs` runs the migration on PGlite with the
  same four callers and fails if any migration creates a USING (true) policy on this table.

## S-25. Suspected legacy USING (true) policies on archived submission tables

- **Severity (original)**: Low, suspected. **Status**: Closed, by absence.
- **Risk**: if the three archived tables still exist live, their legacy authenticated policies are fully open.
- **Verified live (Owner, 2026-09-26)**: `unit_submissions`, `student_submissions` and
  `student_intake_submissions` do not exist in production (`to_regclass` NULL for all
  three), so there is nothing to narrow and no migration follows.
- **The same catalog read, every permissive policy in `public`**: eleven rows, none of
  them a finding. Nine are `service_role` policies (`activity_logs`, `cohort_snapshots`,
  `contacts`, `ngrp_outcomes`, `notification_log`, `program_events` x2,
  `unit_cohort_responses`, `user_profiles`), which are inert because the service role
  bypasses RLS whatever the policy says. The other two are deliberate and documented:
  `anon_select_cohorts` (Wave C, 20260712000002: the public student, school and unit
  forms look up the accepting cohort client-side) and `anon_select_units` (Wave D,
  20260712000003: the unit dropdowns on the student and unit forms). Both are SELECT only;
  anon holds no write on either table. Tables with policies but RLS disabled: none.
- **Closing commit**: S25-1 (2026-09-26), by verification.

## S-26. PostgREST .or() filter strings built from raw search input

- **Severity (original)**: Low. **Status**: Closed.
- **Risk**: commas and parentheses in a search term alter filter semantics client-side (bounded by RLS, so integrity of the query, not access).
- **Verified at HEAD (re-swept 2026-09-24)**: ten `.or()` template sites in `src/`; nine interpolated a typed search term into an `ilike` filter. At LOW-1 two of the nine were already routed through the sanitizer: `src/lib/contactSearch.js` (`sanitizeContactTerm` at the top of `searchContacts`) and `src/components/connect/ContactAutocomplete.jsx` (through the same hook), and `GrantPortalAccessModal.jsx`'s student search used a local copy of the same regex.
- **Fix (LOW-1, 2026-09-26)**: every typed term now goes through the one `sanitizeContactTerm` in `src/lib/contactSearchCore.js` before it enters a filter string: the four universal-search queries in `StaffApp.jsx` (`runSearch` sanitizes once, at the top), `PreceptorAssignmentModal.jsx`, and the two local copies of the regex in `GrantPortalAccessModal.jsx` and `ContactAutocomplete.jsx` are the shared function now. The one email lookup in `GrantPortalAccessModal.jsx` is an exact, case-insensitive match, so it escapes LIKE wildcards with `escapeLikePattern` and never interpolates a value carrying filter syntax. The tenth site interpolates a cohort id, not input. `test/lowSeverityCleanup.test.mjs` sweeps every `.or()` template in `src/` and fails if an interpolated term is not sanitized or escaped.
- **Closing commit**: LOW-1 (2026-09-26).

## S-27. Unescaped ilike wildcards on service-role queries

- **Severity (original)**: Low. **Status**: Closed.
- **Risk**: % and _ in caller input broaden service-role matches (the public intake and shift-log paths escape; these do not).
- **Verified at HEAD (before LOW-1)**: `api/interview-book.js:259` (interviewer name), `api/messages-staff-options.js:120`, `api/keith.js:418` and `:503` passed unescaped values to ilike.
- **Fix (LOW-1, 2026-09-26)**: all four wrap the value in the existing `escapeLikePattern` from `src/lib/emailUtils.js`, as the student email lookup in the same booking file already did. `test/lowSeverityCleanup.test.mjs` pins each site.
- **Closing commit**: LOW-1 (2026-09-26).

## S-28. interview_slots lacked database-level double-booking protection

- **Severity (original)**: Low. **Status**: Closed. The slot-side constraint
  `uq_interview_sessions_one_per_slot` was APPLIED by the Owner on 2026-09-26 in
  `20261008000000_s28_s29_constraints_and_activity_logs.sql`, with S28-2 live, and
  PRE 1 to 5 and POST 1 to 5 passed (see the OWNER_SQL_GATE ledger). Both sides of a
  booking are now unique at the database.
- **Risk**: concurrent bookings race the application check.
- **Verified at HEAD (before S28-1)**: 20260822020000 (confirmed APPLIED 2026-08-27) added `uq_interview_slots_one_booking_per_student`, so one student holding two bookings is now impossible at the database. The slot side (two students on one slot) still has no constraint and relies on the atomic conditional claim (`.eq('is_booked', false)`) plus the post-claim re-check in api/interview-book.js.
- **Closing commits**: S28-1 (ce9068b1, 2026-09-26), which adds
  `supabase/migrations/20261008000000_s28_s29_constraints_and_activity_logs.sql` and the
  S28-2 cancel fix, and S28-3 (2026-09-26), which records the application. PRE 3 showed
  no slot shared by two sessions (47 sessions with a slot, 47 distinct slots); POST 5
  refused a second session on a booked slot.
- **Discovery (S28-1)**: a booking is an `interview_sessions` row with a `slot_id`
  (`api/interview-book.js` writes it; `move_booking` in `api/availability.js` carries it to
  the new slot; `slot_id` is `ON DELETE SET NULL` to the slot). The slot row itself can only
  name one `booked_by_student_id`, so the double booking that can exist is two sessions on
  one slot. One legitimate path produced exactly that shape: `cancel_booking` deleted a
  kept session only when it had no rubric, and left a rubric-bearing session pointing at
  the slot it had just released, so the next student to book that slot got a second
  session on it. That is the stale pointer PRE 3 lists.
- **Fix**: S28-2, in the same commit, makes `cancel_booking` clear `slot_id` on a kept
  session. The migration adds `uq_interview_sessions_one_per_slot`, a partial unique index
  on `interview_sessions (slot_id) WHERE slot_id IS NOT NULL`, behind a guard that names
  any slot two sessions already share and refuses the file. **Apply only after S28-2 is
  live**, or a cancel followed by a rebooking of the same slot would be refused at the
  session insert.

## S-29. evaluation_assignment_tokens has no one-active-token constraint

- **Severity (original)**: Low. **Status**: Closed. `uq_eval_tokens_one_active` was
  APPLIED by the Owner on 2026-09-26 in
  `20261008000000_s28_s29_constraints_and_activity_logs.sql` and PRE 1 to 5 and POST 1 to
  5 passed (see the OWNER_SQL_GATE ledger). One active token per assignment is now a
  property of the database.
- **Risk**: multiple live tokens per assignment can accumulate; revocation by token id (the house rule) mitigates but nothing enforces singularity.
- **Verified at HEAD (before S29-1)**: no unique index or constraint on the table in any migration.
- **Closing commits**: S29-1 (ce9068b1, 2026-09-26), the same commit and migration as
  S-28, and S29-2 (2026-09-26), which records the application. PRE 2 showed no assignment
  with more than one active token (43 active tokens on 43 assignments, 248 tokens in
  all); POST 5 refused a second active token. The same run gave `activity_logs` (602
  rows) both S-23 triggers and removed service_role's UPDATE, DELETE and TRUNCATE.
- **Discovery (S29-1)**: "active" means not revoked and not used and not expired; every
  reader agrees (the submit RPCs check `revoked_at IS NULL AND expires_at > now() AND
  used_at IS NULL`). Expiry is time-based and cannot sit in an index predicate, so the
  database rule is `revoked_at IS NULL AND used_at IS NULL`. Every issuing path already
  keeps to it: `api/evaluation-create-invitation.js` revokes an assignment's other tokens
  and rotates one survivor, `lib/server/evaluation/assignmentReissue.js` revokes them all
  before it writes, and the two release endpoints revoke on reissue.
- **Fix**: `uq_eval_tokens_one_active`, a partial unique index on
  `evaluation_assignment_tokens (assignment_id) WHERE revoked_at IS NULL AND used_at IS
  NULL`, behind a guard that names any assignment holding more than one active token and
  refuses the file. Same migration as S-28, which also gives `activity_logs` the S-23
  trigger pair through `public.append_only_refuse()` and revokes UPDATE, DELETE and
  TRUNCATE on it (every writer inserts: fourteen server files, `src/lib/logActivity.js`
  and the KT and Keith governance RPCs; no code or SQL path updates or deletes a row).
  Checks in `db/audit/s28_s29_constraints_and_activity_logs_checks.sql`: PRE 1 to 5, the
  file, POST 1 to 5; POST 5 tries a duplicate token, a duplicate session and an
  activity_logs rewrite inside a rolled-back block. `test/s28s29Constraints.test.mjs`
  runs the migration on PGlite, proves each refusal, proves the guard names violating ids
  and applies nothing, and pins the cancel-path fix.

## S-30. Keith GET reveals hasApiKey unauthenticated

- **Severity (original)**: Informational. **Status**: Closed.
- **Risk**: configuration reconnaissance without a token.
- **Verified at HEAD (before LOW-1)**: `api/keith.js:750` returned `hasApiKey: !!process.env.ANTHROPIC_API_KEY` on GET before any auth.
- **Fix (LOW-1, 2026-09-26)**: the field is removed; the unauthenticated GET is a liveness check that says only "Keith is alive". `test/lowSeverityCleanup.test.mjs` fails if `hasApiKey` returns.
- **Closing commit**: LOW-1 (2026-09-26).

## S-31. Activation token_hash remains in the address bar after verifyOtp

- **Severity (original)**: Informational. **Status**: Closed.
- **Risk**: a consumed single-use token hash lingers in browser history.
- **Verified at HEAD (before LOW-1)**: no `history.replaceState` in `src/pages/ActivateAccountPage.jsx`.
- **Fix (LOW-1, 2026-09-26)**: `handleActivate` replaces the URL with the bare pathname the moment `verifyOtp` returns, before the outcome is read, so the hash is gone whether the token was accepted or refused. The scanner-safe confirm step is unchanged: nothing is consumed and nothing is rewritten until the recipient clicks. `test/lowSeverityCleanup.test.mjs` pins the order.
- **Closing commit**: LOW-1 (2026-09-26).

## S-32. Student PII hardcoded in a dormant cron

- **Severity (original)**: Informational. **Status**: Closed, by file removal.
- **Risk**: two students' names and schools live in source control.
- **Verified at HEAD (before LOW-1)**: `api/cron/clockout-reminders-resend.js:42-43`, the APPROVED_SHIFT_LOG_IDS comments. The endpoint was CRON_SECRET-gated and not in `vercel.json`; the one-off run it existed for completed in 2026.
- **Fix (LOW-1, 2026-09-26)**: the file is deleted. Nothing referenced it except the demo-boundary test's exemption list, which drops the entry. The names remain in git history, as every deletion does; nothing in the working tree carries them. `test/lowSeverityCleanup.test.mjs` fails if the file or a schedule for it returns.
- **Closing commit**: LOW-1 (2026-09-26).

## S-33. Policies without ENABLE ROW LEVEL SECURITY in repo SQL

- **Severity (original)**: Informational. **Status**: Closed.
- **Risk**: if RLS is not enabled live on user_profiles, activity_logs, or aspire_events, their policies are decorative.
- **Verified at HEAD**: no repository migration contains ENABLE ROW LEVEL SECURITY for any of the three (all three are dashboard-managed).
- **Verified live (Owner, 2026-09-26)**: `pg_class.relrowsecurity` is true on all three
  (`activity_logs` with 4 policies, `aspire_events` with 2, `user_profiles` with 9), so
  every policy is in force. `aspire_events` still carries the anon SELECT table grant, but
  its two policies are for signed-in readers and no anon policy exists, so an anon read
  returns nothing; the grant is noted, not acted on. Nothing to enable; no migration
  follows.
- **Closing commit**: S33-1 (2026-09-26), by verification.

## D-01. react-router-dom 7.15.1 advisories

- **Severity (original)**: Low. **Status**: Closed.
- **Verified at HEAD (before DEPS-1)**: `react-router-dom` 7.15.1 with `react-router` 7.15.1; five advisories on `react-router` (open redirect via backslash in Link and useNavigate, RSC error-handler XSS, constructor injection in SSR error deserialization, route-matching DoS, RSC CSRF bypass), all fixed by 7.18.2. Production runtime (the client bundle and the public-site prerender). Minor bump.
- **Fix (DEPS-1, 2026-09-26)**: `react-router-dom` ^7.18.4 (`react-router` 7.18.4). No code change; the suite, the production build and the prerender stage all pass.
- **Live paths touched**: every route. After deploy, click through the public site routes (home, about, the four public forms) and one portal's navigation end to end, including a browser back and a deep link with a query string.

## D-02. ws 8.20.0 via @supabase/realtime-js

- **Severity (original)**: Low. **Status**: Closed.
- **Verified at HEAD (before DEPS-1)**: `ws` 8.20.0 under `@supabase/realtime-js` 2.105.1 (declared range ^8.18.2); two advisories (uninitialized memory disclosure, fragment memory-exhaustion DoS), fixed by 8.21.0. Production runtime on the Node side only; the browser bundle uses the native WebSocket. Patch bump within the declared range.
- **Fix (DEPS-1, 2026-09-26)**: `ws` 8.22.0 through the lockfile. `@supabase/supabase-js` stays at ^2.105.1 on purpose: the advisory needed no client bump, and the client is exercised by every test that mocks it.
- **Live paths touched**: realtime subscriptions. After deploy, open a Messages thread, send a reply from a second account and confirm the thread updates and the unread badge on the ASPIRE Connect icon changes without a reload.

## D-03. postcss and nanoid via sanitize-html

- **Severity (original)**: Low. **Status**: Closed.
- **Verified at HEAD (before DEPS-1)**: `sanitize-html` 2.17.5 (two mutation-XSS bypasses, fixed by 2.17.7), `postcss` 8.5.13 (sourceMappingURL file disclosure, fixed above 8.5.22) and `nanoid` 3.3.12 (infinite-loop generators, fixed by 3.3.18). Production runtime: the server sanitizes outreach and template HTML before it is sent. All patch bumps.
- **Fix (DEPS-1, 2026-09-26)**: `sanitize-html` ^2.17.7, `postcss` 8.5.28 and `nanoid` 3.3.19 through the lockfile.
- **Live paths touched**: email rendering. After deploy, open Outreach, pick a template with formatting and a button, and confirm the preview and a test send to yourself render the same as before.

## D-04. vite 8.0.10, brace-expansion, @babel/core

- **Severity (original)**: Informational. **Status**: Closed.
- **Verified at HEAD (before DEPS-1)**: dev-only, all three under devDependencies: `vite` 8.0.10 (dev-server `server.fs.deny` bypass and launch-editor hash disclosure, Windows only, fixed by 8.0.16), `brace-expansion` 5.0.5 under `eslint`'s `minimatch` (four expansion DoS advisories, fixed by 5.0.9), `@babel/core` 7.29.0 under `eslint-plugin-react-hooks` (sourceMappingURL file read, fixed by 7.29.6). Minor bump for vite, patch bumps for the other two; no major bump was needed (`@babel/core` 8.x exists but the fix is in 7.29.6).
- **Fix (DEPS-1, 2026-09-26)**: `vite` ^8.3.1, `brace-expansion` 5.0.12 and `@babel/core` 7.29.7 through the lockfile. The Babel chain update also carried `browserslist` to 4.29.1 and `baseline-browser-mapping` to 2.11.26, which closed the two advisories the same audit had raised on them (unbounded cache growth and a crash on untrusted custom stats).
- **Live paths touched**: none at runtime. The production build and the prerender stage ran on the new vite.

## D-05. @tiptap advisories surfaced by the same audit

- **Severity**: Moderate to high per npm. **Status**: Closed.
- **Verified at HEAD (before DEPS-2)**: `@tiptap/core` 3.27.1 and its extensions (the Connect editor): a prototype-key attribute bypass in `mergeAttributes` (fixed by 3.30.4) and a quadratic ReDoS in Markdown attribute parsing (fixed by 3.30.5). Production runtime in the browser, where the only input is the staff author's own document. Minor bump.
- **Fix (DEPS-2, 2026-09-26)**: every `@tiptap/*` package moved together to 3.31.3, sixty-six packages at one version. The four declared packages (`react`, `starter-kit`, `extension-link`, `extension-underline`) are ^3.31.3, and `@tiptap/pm` is now declared explicitly at ^3.31.3 because tiptap pins it as an exact peer and the locked 3.27.1 tree would not resolve otherwise. No major bump was needed; no source file changed. After DEPS-2, `npm audit` reports zero advisories.
- **Live paths touched**: the Connect rich-text editor (`src/components/connect/RichTextEditor.jsx`) and its four custom content blocks (button, event, note, divider), used by Outreach's Send to One and Send to Many and by the template editor. After deploy, click through: type and format (bold, italic, underline, bulleted and numbered lists, clear formatting), add and remove a link, insert each content block and edit it in place, scroll a long draft to confirm the toolbar stays pinned, open the preview, and send a test to yourself.
- **Closing commit**: DEPS-2 (2026-09-26).

## Delta audit, 2026-08-20 to 2026-10-02 (S-34 onward)

Scope: every endpoint, migration, policy, SECURITY DEFINER function, storage path, cron,
webhook and portal surface added or changed between `9258409` and `03f314db`. Read-only;
no SQL was run. Severity is judged by real exploitability in this system (who can reach
it, with what credential). CONFIRMED means the code path was read end to end; SUSPECTED
means a live catalog, a race, or production data would be needed to prove it. Standing
sweeps re-run green on 2026-10-02 and still discover new code: S-05 (132 tests across the
S-05, S-13, S-16, S-17, S-23, S-24, demo-boundary, demo-mailer, public-hardening and
revocation suites), S-12 (`test/cronSecretFailClosed.test.mjs`, every file in `api/cron/`).

## S-34. Keith's data tools ignore an Interviewer's cohort entitlement and rubric authorship

- **Severity**: Medium. **Status**: OPEN.
- **Risk**: an active Interviewer reads contact details, GPA, scores and every other
  interviewer's rubric comments for students in any cohort, through the model.
- **Evidence** (CONFIRMED): `api/keith.js:265-275` grants `search_students`,
  `get_student_detail`, `get_unit_details` and `get_cohort_summary` by role alone
  (`allowedRoles: ['admin', 'interviewer']`); `:1455` takes the active cohort from the
  request body (`liveData?.activeCohortId`); `:552` lets the tool input override it;
  `get_student_detail` (`:430-465`) selects `school_email`, `personal_email`, `phone`,
  `cumulative_gpa` and then every `interview_rubrics` row for the student with
  `summary_comments`, on the service role. No entitlement check exists in the file. The
  platform's own rule (`api/student-update.js:476-490`, `api/student-file-access.js:79-85`)
  bounds an Interviewer by `activeEntitledCohortIds`, and RLS limits them to their own rubrics.
- **Exploit**: POST `/api/keith` with any cohort id in `liveData.activeCohortId` and ask for
  the students, then for a student's details. The caller controls the prompt.
- **Fix direction**: in the tool executor, derive the entitled cohort set from the caller's
  profile for any role without `student_read`, refuse a cohort outside it, re-check the
  student's cohort in `get_student_detail`, and filter rubrics to the caller's own unless
  `can_manage_all`. Never treat `activeCohortId` from the body as authority. Needs SQL: no.

## S-35. Invite-user matches an existing account with an unescaped ILIKE and re-enables it

- **Severity**: Medium. **Status**: OPEN.
- **Risk**: an Owner or Admin invite can silently attach staff access to the wrong person,
  including a deactivated former account, and lift its auth ban.
- **Evidence** (CONFIRMED): `api/invite-user.js:209` validates the address only as
  containing `@` and `.`; `:232-236` looks up the profile with `.ilike('email', normEmail)`
  where `_` matches any character and `%` any run; `:303-316` reuses the matched profile
  (`is_active: true`, `role: requestedRole`, `login_enabled: true`); `:344` calls
  `restoreAuthAccess`. Two matches make `maybeSingle` error, the error is ignored, and the
  insert path runs. Introduced in `fa689d41` (2026-08-03); not among the S-27 sites.
- **Exploit**: invite `jane_doe@cshs.org` as Admin while `jane.doe@cshs.org` exists as a
  portal or deactivated profile.
- **Fix direction**: exact match on a normalised email (or `escapeLikePattern`), treat a
  lookup error as a failure, validate the address, and add the site to the S-27 sweep.
  Needs SQL: no.

## S-36. Interview rubric policies and the cohort list function carry no cohort scope

- **Severity**: Medium. **Status**: OPEN.
- **Risk**: the RLS-layer twin of S-14. An Interviewer or Viewer reads rubric scores,
  recommendations, suggested units and summary comments for every rubric in any cohort,
  and an Interviewer can write their own-identity rubric against any student in any cohort.
- **Evidence** (CONFIRMED): `supabase/migrations/20260822010000_interview_rubric_authorization.sql`
  INSERT policy `:133-142` and UPDATE policy `:144-157` pass on
  `interview_rubric_identity_matches_caller` alone; `list_interview_rubrics_for_cohort`
  `:203-224` admits `interviewer` and `viewer` for any `p_cohort_id` and `:227-258` masks
  only the notes and question columns, returning `cj_score`, `pp_score`, `ga_score`,
  `individual_recommendation`, `suggested_unit`, `summary_comments` and `composite_score`
  for every row. The browser writes the table directly (`src/components/RubricSession.jsx`)
  and reads through the RPC (`:149`). No cohort-entitlement predicate exists in SQL.
- **Fix direction**: add an active cohort-entitlement predicate (the model
  `api/student-file-access.js` uses) to the non-privileged branches of both write policies
  and of the list function, or move rubric writes behind an endpoint as S-04 did for slots.
  Needs SQL: yes.

## S-37. Email preheaders and organization fields are interpolated into email HTML unescaped

- **Severity**: Medium. **Status**: OPEN.
- **Risk**: a student-controlled name becomes live markup inside an authentic ASPIRE email
  to staff, an interviewer, and an outside department.
- **Evidence** (CONFIRMED): `lib/server/email/aspireShell.js:60` writes
  `<div style="display:none;...">${preheader}</div>` raw, and `:50-55, 69, 89, 95-97`
  interpolate `display_name`, `logo_alt_text`, the address and `general_email` raw.
  Callers that build the preheader from data: `lib/server/email/interviewBooked.js:47`
  (`${studentName} self-scheduled ...`, from `api/interview-book.js:268`, a name any
  student sets at intake or in My Profile with no character rule),
  `lib/server/forms/mail.js:52` (the forward email to `settings.forwardTo`, an external
  inbox, with `${title} from ${who}` where `who` is the respondent's name) and `:28`, and
  `lib/server/signatures/mail.js:30`. `preceptorEmailTemplates.js:100` escapes its
  preheader, so the shell's "plain text" contract is applied inconsistently. This is a gap
  left by the S-06 closing commit `dbed654d`, not a regression of it.
- **Exploit**: set `last_name` to markup that closes the hidden div and shows a link, then
  self-book an interview, or submit a ScrubEx form that is forwarded to Linen Services.
  Mail clients run no script; the risk is phishing and content spoofing.
- **Fix direction**: escape `preheader` and the organization fields inside
  `aspireEmailShell`, remove the pre-escaping at the one call site that does it, and add a
  test that sweeps the preheader sinks. Needs SQL: no.

## S-38. The school form password verifier is an unthrottled anon oracle at the database

- **Severity**: Medium. **Status**: OPEN.
- **Risk**: online guessing of a cohort password, and CPU denial of service, through
  PostgREST, bypassing every endpoint rate limit.
- **Evidence** (CONFIRMED): `20261003000000_s08_school_form_password_plaintext_drop.sql:137-138`
  grants EXECUTE on `verify_school_form_password` (bcrypt cost 10) and
  `school_form_requires_password` to `anon` and `authenticated`. The browser calls the
  verifier directly: `src/components/SchoolFormPage.jsx:258`,
  `src/portal/ap/PlacementRequestsView.jsx:213`. The S-11 limiter lives in `api/` and
  never sees this path. S-08 recorded the anon grant as deliberate; the missing throttle on
  it was not recorded.
- **Exploit**: loop `POST /rest/v1/rpc/verify_school_form_password` with the anon key and
  the cohort id the public page loads. Each call costs one bcrypt on a `t4g.nano` instance.
- **Fix direction**: revoke EXECUTE from `anon` and `authenticated`, and verify through a
  throttled endpoint (`api/school-form-existing-request.js` already does this on the
  service role); or add a per-cohort attempt counter inside the function. Needs SQL: yes
  (REVOKE), after the two browser call sites move.

## S-39. The Skyline masthead script is loaded live into the app origin with no CSP or SRI

- **Severity**: Medium (supply chain; the service is the Owner's own project).
- **Status**: OPEN.
- **Risk**: whoever can deploy to the Skyline Vercel project, or compromises it, runs
  JavaScript in the ASPIRE origin on the staff home and all four portals, with the
  signed-in session available.
- **Evidence** (CONFIRMED): `src/lib/skylineService.js:7-8, 20` loads
  `${SKYLINE_URL}/v1/skyline.js` as an unpinned module script with no `integrity`
  attribute; `vercel.json` and `index.html` set no `Content-Security-Policy`,
  `frame-ancestors` or `X-Frame-Options`, so `/sign` and `/form` can also be framed.
- **Fix direction**: serve a versioned file with SRI or vendor it into the build, add a
  CSP whose `script-src` is self plus that exact URL, and `frame-ancestors 'none'`.
  Needs SQL: no.

## S-40. Demo boundary gaps: a missing header mixes populations on portal resolvers, and demo events email real staff

- **Severity**: Low. **Status**: OPEN.
- **Risk**: fabricated rows shown to real portal users or aggregated into real reports;
  real Owner and Admin inboxes receive notifications about demo students.
- **Evidence** (CONFIRMED): `api/lib/unitLeaderScope.js:79`, `api/lib/schoolScope.js:33-35`,
  `api/lib/nursingAcademicScope.js:40`, `api/portal/unit-participation-submit.js:55`, the
  `api/ngrp-*.js` endpoints and the community-benefit endpoints use
  `serviceDbForRequest`, which maps an absent `x-aspire-demo` header to "no filter"
  (`lib/server/demoScope.js:188-190`); DEMO-DATA-2 reserved that behaviour for single-record
  reads and gave aggregates `populationDb`. A portal user controls the header. The comment
  at `demoScope.js:12-14` claiming only Owner or Admin endpoints read it is false.
  `_emit_staff_notifications` (`20260723000000:440-462`) queues an emailed row to every
  active Owner and Admin with no `is_demo` check on the subject student, so a primary
  preceptor change made in demo mode emails real staff; the mailer guard looks only at
  recipients (`lib/server/email/mailer.js:56-66`). SUSPECTED: `students.is_demo` is
  column-writable by any staff writer through the Wave E UPDATE policies
  (`20260921000000:126-149`; the inherit trigger is INSERT-only, `:164-195`), which would
  let an insider drop a real student out of every real sweep.
- **Fix direction**: use `populationDb` in the portal verifiers (absent means real);
  suppress or skip `_emit_staff_notifications` when the subject student is demo; refuse
  `is_demo` changes outside the service role. Needs SQL: yes for the last two.

## S-41. Database portal predicates ignore `user_profiles.is_active`

- **Severity**: Low. **Status**: OPEN.
- **Risk**: a deactivated portal account whose access token has not yet expired can read
  its own records through the browser-direct views and still-joined threads. The
  endpoints refuse it (S-05); the database does not.
- **Evidence** (CONFIRMED): `20260712000007_phase2_authz_foundation.sql:192` defines
  `portal_profile_id()` with no `is_active` test, and `has_active_role_grant` and
  `my_linked_student_ids` (`:195-218`) inherit that; the scoped-student branch of
  `message_participant_can_read` (`20260930000000:94-110`) has no
  `message_profile_is_active` while the other branches do. `src/portal/StudentPortal.jsx:217-219`
  reads `portal_my_shift_logs`, `portal_my_evaluation_assignments` and
  `portal_my_certificates` directly. Deactivation does not revoke grants or links
  (`api/admin-users.js:307`). Not a regression: S-05 was scoped to endpoints.
- **Fix direction**: AND `is_active` into `portal_profile_id()`. Needs SQL: yes.

## S-42. A Nursing Education and Leadership contacts editor can rewrite the Unit Leader contacts that drive routing

- **Severity**: Low (needs a `contacts_access = 'manage'` grant). **Status**: OPEN.
- **Risk**: the derived unit lead, and therefore the unit form CC, the placement greeting
  and the capacity outreach selector, can be redirected to an address the editor chooses.
- **Evidence** (CONFIRMED): `api/portal/academics-contacts.js:43-47` makes `email`,
  `category`, `role`, `unit_name` and `related_units` writable, and `:353-377` patches any
  contact id; `src/lib/unitLeadersFromConnect.js:87-89` derives leadership from exactly
  those fields. An `activity_logs` row is written (`:254-273`).
- **Fix direction**: refuse NE&L edits to those five fields on a contact whose current or
  resulting category is Unit Leader, or route them for staff confirmation. Needs SQL: no.

## S-43. The signer one-time code attempt counter is not atomic

- **Severity**: Low. **Status**: OPEN, SUSPECTED (a race).
- **Evidence**: `lib/server/signatures/engine.js:275-283` reads `code_attempts`, compares
  it to the maximum, then writes the incremented value with no compare-and-set; the same
  shape at `:261-266` for sends. The per-IP limit is 40 a minute (`api/sig-signer.js:37-40`).
- **Risk**: a link holder firing parallel guesses gets more than five attempts per code.
- **Fix direction**: increment with a conditional update (`.lt('code_attempts', max)`)
  and act on the matched row count, or an RPC. Needs SQL: optional.

## S-44. Raw database error text can reach anonymous callers on the form and signer routes

- **Severity**: Low (S-19 class). **Status**: OPEN.
- **Evidence** (CONFIRMED): `lib/server/forms/engine.js:48` throws
  `FormError('db_failed', \`${what}: ${res.error.message}\`, 500)`, returned verbatim by
  `api/form-respond.js:43`; `lib/server/signatures/engine.js:77, 156, 170, 187, 366, 576`
  embed `error.message`, returned by `api/sig-signer.js:114`.
- **Fix direction**: log the provider message and return a fixed sentence for those
  codes; extend `test/lowSeverityCleanup.test.mjs` to the two engines. Needs SQL: no.

## S-45. Recipient emails and names still written to function logs outside the three S-20 crons

- **Severity**: Low (S-20 class). **Status**: OPEN.
- **Evidence** (CONFIRMED): `src/lib/notifications/index.js:125, 128, 133` log
  `recipient.email` on every `sendNotification` send, which every reminder, birthday,
  midpoint, retirement and clock-out cron uses; `api/send-midpoint-checkin.js:128`;
  `api/admin/resend-coordinator-digest.js:416, 418`; `api/cron/teams-invite-reminders.js:161`
  (interviewer name). S-20 named only the three crons it fixed.
- **Fix direction**: log type, ids and the provider id only; widen the S-20 sweep to
  these files. Needs SQL: no.

## S-46. Student shift self-service no longer stops at a certificate, a concluded rotation or a terminal status

- **Severity**: Low (integrity; intent unconfirmed). **Status**: OPEN.
- **Evidence** (CONFIRMED): `20261027000000_student_shift_self_service_window.sql:5-43`
  replaced the eligibility function of `20260901010000:86-102`, dropping the
  `certificate_issued`, `rotation_concluded` and `student_status_terminal` refusals; the
  only lock is now `v_approved >= v_required AND v_end < today`, and `v_end` is NULL for
  the sentinel or a missing rotation row, so that comparison never closes. The header says
  certificate issuance must never be used as the end date, which reads as deliberate.
- **Risk**: a certified, Completed or Not Proceeding student can still revise or void
  approved shifts, so a certificate and the stored hours can disagree.
- **Fix direction**: Owner decision. If unintended, restore the terminal gates and treat
  an unknown window as closed once the status is terminal. Needs SQL: yes, if changed.

## S-47. Transition Form links never expire, and a closed link still returns prefill and prior answers

- **Severity**: Low. **Status**: OPEN.
- **Evidence** (CONFIRMED): `api/ngrp-transition.js:82-145` serves `load` when the form is
  closed, returning school, program, the suggested email and the latest revision payload;
  `lib/server/ngrpTransition.js:418-442` never checks token age, and `isFormClosed`
  (`:100-103`) gates writes only. Reflection links, by contrast, die when the run stops.
  Related: `api/ngrp-reflection.js:99-112` runs `schedule_add` and `schedule_remove`
  before the submitted and closed checks, so an old period link keeps schedule write access
  while the run is active.
- **Fix direction**: on closed, return the state only; retire tokens some days after
  close; order the reflection checks before the schedule actions. Needs SQL: no.

## S-48. Form-link surface hardening: unbounded uploads, drafts of prefilled PII, and an indefinite copy

- **Severity**: Low. **Status**: OPEN.
- **Evidence** (CONFIRMED): `lib/server/forms/engine.js:499-507` mints an upload slot per
  call with the size checked only as the client declared it, no content-type allow-list and
  no per-assignment cap, at 400 an hour per IP; `respondentCopy` (`:468-476`) returns the
  filed PDF to any link holder with no time limit, and `respondentState` (`:484-490`)
  returns prefilled phone, unit, preceptor and rotation dates before submission;
  `src/pages/.../FormRenderer.jsx:18, 25` writes the prefill plus answers to
  `localStorage` on page open and clears it only on submit. The path confinement itself is
  sound (`:584-588`).
- **Fix direction**: bucket MIME and size limits, a slot cap and an orphan sweep in
  `form-maintenance`; a window on `copy`; draft only what was typed, with a TTL. Needs SQL:
  no (bucket settings are an Owner storage change).

## S-49. Unescaped ILIKE wildcards at three more sites (S-27 siblings)

- **Severity**: Low. **Status**: OPEN.
- **Evidence** (CONFIRMED): `api/contacts-upsert.js:447` (the duplicate-email check, so `_`
  can produce a false "already exists"), `api/lib/unitPreceptorContactSync.js:99`,
  `api/cron/teams-invite-reminders.js:155`. All run on the service role with staff- or
  data-sourced values; S-35 is the one with a privilege consequence and is listed on its own.
- **Fix direction**: `escapeLikePattern` or exact matches, and add the sites to the S-27
  pins. Needs SQL: no.

## Delta audit: informational notes (no finding opened)

- The organization logo accepts SVG screened by a blocklist regex
  (`lib/server/organizationSettings.js:55`) into the public `organization-branding`
  bucket, which has no size or MIME limit (`20260923000000:44-46`). Only the Owner uploads,
  and the file renders as `<img>`. Rasterise or drop SVG when convenient.
- The catalog, signature and forms tables never revoke Supabase's default anon and
  authenticated table privileges; RLS with SELECT-only policies refuses writes today, so
  this is defence in depth only (`20260926000000`, `20260927000000`, `20260928000000`,
  `20260929000000`). The budget, Keith and NGRP files revoke explicitly.
- Real student names sit in migration comments and exception text
  (`20260830000000:95-105`, `20260901000000`), the S-32 class; relevant only if the
  repository is public.
- Five migration pairs share a version number (20260829000000, 20260922000000,
  20260923000000, 20261021000000, 20261027000000). Harmless under the manual Owner gate;
  CLI tooling would skip the second of each pair.
- Messaging capability switches for Academic Partner and NE&L are checked on thread
  creation only, not on reply or react.
- `messages_mark_read` refuses `unit_leader`, `academic_partner` and `nursing_academic`
  callers (`20260716000002:366`), a functional defect that fails closed.
- The `sig_events` hash chain is ordered by `id`, assigned before the advisory lock, so
  two concurrent events can commit out of chain order; nothing verifies the chain today.
  The TSA reply's own signature is not verified and the default TSA URL is plain HTTP.
- Talent Acquisition receives `candidates.notes` and eligibility override reasons and holds
  cycle, source and unit management actions; consistent with "TA co-owns", for the Owner
  to confirm.
- `src/lib/connect/richCompose.js:69-70` parses HTML into a live-document element; only
  the user's own draft reaches it today. Use `DOMParser` or a `<template>`.
- Keith's markdown renderer allows any `https:` link from model output; text a student
  controls reaches the model, so an injected instruction could surface a phishing link.
  `javascript:` and HTML are blocked.
- `sig-signer` serves the document before consent is recorded; `requireSession` compares
  hashes with `!==` (negligible); `FORM_TOKEN_SECRET` falls back to `SIG_TOKEN_SECRET`, so
  setting it later invalidates every live form link.

Not verifiable read-only: live `pg_policies` and column grants on tables created outside
the repo (`aspire_events`, `students.is_demo`, `interview_rubrics`); whether the
dashboard-created `aspire-catalog` and `outreach-attachments` buckets are private and what
storage policies they carry; bucket size and MIME settings; whether Vercel overwrites a
client-supplied `X-Forwarded-For` (which keys every public limiter); the configured JWT
lifetime (which bounds S-41); whether production function bodies match the repository for
`messages_mark_read`, `can_read`, `_emit_staff_notifications` and the `ul_eval_*` RPCs;
who can deploy to the Skyline project; and whether any stored name or title already
contains markup (a `db/audit` query would show it).

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

## Unverified in production (list from 2026-08-27, updated 2026-10-02)

1. Mid-session revocation (`b8db8a4`), VERIFIED on the Student Portal 2026-10-02 by the
   Owner with a test account, with one gap recorded. Result: after the revoke, nothing
   new was served. The first tab that made a request (Shift Log) was refused and the
   portal replaced itself with the "No portal access on this account" card. Tabs that
   had already loaded before the revoke stayed readable until the next request, because
   the Student Portal fetches its summary once on open and a tab switch redraws that
   data without asking the server. So access ends at the endpoints immediately; the
   screen catches up on the next request or a reload. Follow-up, Owner's call: re-run
   `get_my_portal_access()` on tab change or window focus so the card appears without a
   fetch. The other four surfaces (Unit Leader, Academic Partner, My Profile, Messages)
   use the same handoff and are unverified live.
2. CONFIRMED 2026-08-23: a deactivated (banned) account's existing access token stayed
   valid after deactivation, and the per-request endpoint checks (S-05) refused all
   data. Access ends at the endpoints immediately; the session itself ends at token
   expiry.
3. Rate-limit ceiling, VERIFIED live 2026-10-02 on the public unit form lookup
   (`api/unit-form-lookup.js`, burst bucket 15 per 60 seconds per address): fifteen
   lookups in one minute were answered, the sixteenth was refused with 429 and "Too many
   requests. Please wait a moment and try again.", and a lookup after the minute was
   answered again. Read-only lookups of a unit name that does not exist; nothing was
   written or sent. The other buckets share the same limiter and RPC.
4. S-08 server-side password path: CONFIRMED 2026-09-25 by POST-B 4 of
   `db/audit/s08_school_form_password_hash_checks.sql` (the Owner confirmed the live
   school form accepts the right password and refuses a wrong one after the plaintext
   column was dropped). S-10 guarded prefill on the unit form: VERIFIED live 2026-10-02. For
   a unit with a stored response in the accepting cohort (Winter 2027), the lookup with
   no email and with a wrong email returned exactly the seven structured fields
   (`response_status`, `slots_offered`, `shift_preference`, `hiring_new_grads_ngrp`,
   `has_hired_aspire_alumni`, `aspire_alumni_outcome`, `would_consider_aspire_alumni`)
   and none of the guarded ones (no name, email, role or free text).
5. RESOLVED 2026-08-27: migrations 20260822010000, 20260822020000, and
   20260822030000 are confirmed APPLIED (see the OWNER_SQL_GATE ledger for the
   verification each ran).
