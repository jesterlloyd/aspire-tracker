# Connect Send-and-Confirm Workflow (capacity requests + student forms)

How outreach launched from At a Glance flows through ASPIRE Connect and how the results are
confirmed. Companion to `docs/product/UNIT_RESPONSE_COUNT_SEMANTICS.md`. Supersedes the earlier
preparation-only concept by Owner correction: the real experience is launch, send through Connect,
return, confirm.

## The approved loop

1. The Owner clicks the real send action from At a Glance.
2. ASPIRE Intelligence opens `ASPIRE Connect -> Outreach -> Send to Many`.
3. The correct audience, recipients, cohort, and template are preselected.
4. The Owner reviews and sends through the existing Connect composer (typed confirmation, the proven
   `/api/connect-send-bulk-message` path; no second email system).
5. When the Owner returns to At a Glance, a confirmation modal appears once.
6. The Owner confirms what was actually sent.
7. Only then are unit response targets or student statuses updated.

Opening Connect never sends an email; sending requires the composer's typed confirmation. Launching
never writes a target or status; only the return confirmation (or the manual fallback) does.

## A. Unit capacity request

- **Launch** (`Send capacity request`, Placement Capacity area, Owner/Admin only): units are drawn
  from the full canonical catalog with a resolvable ACTIVE primary lead (`unit_leaders`), excluding
  units already active targets. Their leads become the preloaded recipients.
- **Connect opens with**: cohort preselected; audience source `Contacts`; contact group
  `Unit Leadership`; the matched unit-leader recipients preselected (matched to `contacts` rows by
  normalized email); message type `Unit Leader Capacity Request`; the capacity-response template
  loaded with the `/unit-form` link and the cohort name resolved (no placeholder copy).
- **Return confirmation** (modal, shown once):
  - Title: `Were the capacity requests sent?`
  - Copy: `Confirm which units actually received the Unit Leader Capacity Request. Only confirmed
    units will be counted as expected to respond.`
  - `Sent to all selected units` marks every launched unit as an active target (atomic RPC:
    already-active skipped, removed reactivated).
  - `Identify units sent` lists the launched units with checkboxes, preselected from the Connect
    per-recipient send results when available; only checked units are recorded.
  - `Not sent` (or closing) writes nothing.
- A unit becomes expected to respond only after this confirmation or the manual fallback.

## B. Student Profile Form

- **Direct student send**: opens Connect with audience `Students`, the intended student(s)
  preselected, message type `Student Profile Form Invitation`, the `/student-form` link populated.
- **School-mediated send** (Owner-approved final semantics, pre-release check): the request goes to
  the school's ACADEMIC PARTNER coordinator - audience `Contacts`, contact group `Academic Partners`,
  the coordinator on file preselected (from the school's student records), the same Student Profile
  Form Invitation template - with the affected Pending Outreach student ids retained in the return
  context. HISTORY NOTE: the retired mailto for this action BCC'd the students directly; moving the
  recipient to the coordinator was an explicit Owner decision in the final pre-release check, not a
  silent change. A school with no coordinator email on file cannot launch this flow (safe toast).
- **Return confirmation, gated on real send evidence**: the existing confirm-gated pattern
  (`src/lib/sendFormFlow.js`: `Mark N students as Form Sent?`, `Mark as sent` / `Not sent`) opens on
  return, but ONLY for recipients ASPIRE Connect reported as successfully sent:
  - direct student: only students whose email is in the recorded `sentEmails` are confirmable;
    failed/skipped/unsent students stay Pending Outreach.
  - school-mediated: the affected-student group is confirmable together only when the coordinator
    message was reported sent; otherwise no student status may change.
  - zero successes: a safe no-success notice, nothing written, context cleared - `Mark as sent` is
    never offered.
  Mark as sent updates ONLY the affected students (Pending Outreach -> Form Sent) through the
  existing `onStudentUpdate` transition; Not sent, closing, or canceling writes nothing. Partial
  write failures keep the existing retry behavior.

## C. Return-context contract

`src/lib/connect/launchContext.js`, sessionStorage key `aspire.connect.launchContext.v1`
(session-scoped; never in a URL, so no recipient data is exposed or bookmarkable; the URL carries
only a `?launch=1` flag).

Shape: `{ v, kind ('capacity_request' | 'student_form' | 'school_form'), status ('launched'),
cohortId, cohortName, source (originating section), templateKey, returnPath, units [{key, name,
email}] | studentIds [], school, batchId?, sentEmails?, summary?, createdAt }`.

Rules:

- Written ONLY by the launch actions; unrelated Connect visits never see a context and never record
  into one (`recordLaunchSendResults` no-ops unless an active context matches the template key).
- The composer records `{ batchId, sentEmails, summary }` after a real send so `Identify units sent`
  can preselect reliably.
- The return modal opens only while a context with `status: 'launched'` exists for the current
  cohort; every decision (confirm, subset, not sent, close) clears the context, so it can never
  reopen after a decision. A refresh before any decision re-offers the same pending confirmation
  without duplicating writes (target writes are the idempotent atomic RPC; status writes use the
  existing transition).

## D. Capacity template

`unit_capacity_response_request` - `Unit Leader Capacity Request` (Send to Many, Unit Leader
audience), body in `src/lib/outreachTemplates.js`, registered in `SEND_TO_MANY_TEMPLATES` with
`defaultSource: 'contacts'` and `defaultContactCategory: 'Unit Leadership'`. The `[Insert Unit Form
Link]` token resolves to the public `/unit-form` route via the composer's static-link substitution,
and the `[Cohort]` token always resolves (launch context cohort name, else a neutral fallback), so
no placeholder copy reaches the editor.

## E. Manual fallback

`Configure response targets` remains for outreach completed outside ASPIRE Connect. Its action is
labeled `Mark units as already contacted` and requires the explicit confirmation checkbox
`I confirm these units already received the capacity request outside ASPIRE Connect.` It is not the
normal send path.

## F. Security and integrity

Owner/Admin only for the capacity send-and-confirm workflow (launch button is staff-gated; target
writes are server-verified owner/admin; the send endpoint enforces its own owner/admin auth).
Students, Unit Leaders, and Academic Partners cannot reach unrestricted target configuration (RLS
denies the tables to anon/authenticated; service-role only after server authorization). Sending or
confirming creates no hosting response, no capacity, and no portal access. Failed, canceled, or
unconfirmed sends create nothing. Confirmations are idempotent (durable-row RPC; existing status
transition) and auditable (target event triggers; existing student audit path).
