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

- **Header** (CAPACITY-FILTER-REMINDER-1): the Placement Capacity card carries no prose summary.
  The four pills under the title (`All` / `Hosting` / `Not Hosting` / `Pending`) are the indicators
  AND the filters; counts derive per cohort from the response rows plus synthesized pending targets,
  so pills and the division-grouped table always agree. Pending targets with no
  `unit_cohort_responses` row at all render as synthetic pending rows in their catalog divisions.
  The dynamic action sits on the right of the header (canonical light-green `.ov-send-btn`,
  Owner/Admin only): `Send Capacity Request` while `All` is active, `Send Reminder to Pending
  Units` while `Pending` is active, and NO send action under `Hosting` / `Not Hosting`.
- **Launch** (`Send Capacity Request`): units are drawn from the full canonical catalog, excluding
  units already active targets. Recipients are the unit's ACTIVE leadership from `unit_leaders` by
  role - Associate Director, Assistant Nurse Manager, Unit NPD-P (the `UNIT_LEADERSHIP_ROLES` set,
  which also accepts the `Unit NPD Practitioner` alias) - falling back to the active primary lead
  when no role matches, so no previously reachable unit becomes unreachable.
- **Reminder launch** (`Send Reminder to Pending Units`): preselects ONLY the pending units'
  leadership recipients (same role set) with the `Unit Leader Capacity Reminder` template. A
  reminder is informational outreach only: it never changes target or response status, and
  returning from a reminder launch never opens a confirmation (the context clears silently).
- **Connect opens with**: cohort preselected; audience source `Contacts`; contact group
  `Unit Leadership`; the matched unit-leader recipients preselected (matched to `contacts` rows by
  normalized email); message type `Unit Leader Capacity Request`; the Owner-approved rich template
  (Tiptap Content Blocks: heading, Unit Form button resolving to `/unit-form`, why-hosting bullets)
  with the cohort-aware subject resolved. The cohort and rotation-window blanks in the body are
  intentional Owner fill-ins from the approved copy.
- **Return confirmation** (modal, shown once; ASPIRE-DESIGN-CORRECTION-1 compact redesign):
  - The first step is compact - title, one line of copy, three actions - and shows NO unit list.
  - Title: `Were the capacity requests sent?`
  - Copy: `Confirm whether the Unit Leader Capacity Request was sent. Only confirmed units will be
    counted as expected to respond.`
  - `Sent to All Selected Units` marks every launched unit as an active target (atomic RPC:
    already-active skipped, removed reactivated).
  - `Identify Units Sent` opens the secondary checklist step: the launched units with checkboxes,
    preselected from the Connect per-recipient send results when available; only checked units are
    recorded.
  - `Not Sent` (or closing) writes nothing.
- A unit becomes expected to respond only after this confirmation or the manual fallback.

## B. Student Profile Form

- **Direct student send**: opens Connect with audience `Students`, the intended student(s)
  preselected, message type `Student Profile Form Invitation`, the `/student-form` link populated.
- **School-level batch send** (`Send Forms to Students`, Owner-renamed 2026-07-30 from `Send Form
  to School` to reflect what it does; each student row keeps its own singular `Send Form` action;
  ASPIRE-DESIGN-CORRECTION-1, Owner-directed 2026-07-29, superseding the earlier
  coordinator-mediated decision): opens Connect with audience `Students`,
  the school's Pending Outreach students preselected, the current cohort preserved, and the same
  Student Profile Form Invitation template (Tiptap Content Blocks: Complete Your ASPIRE Intake Form
  heading, Complete Your Form button resolving to `/student-form`, What Happens Next section). The
  affected student ids are retained in the return context. HISTORY NOTE: the interim release routed
  this action to the school's Academic Partner coordinator (Contacts → Academic Partners); the Owner
  reversed that in the design correction - the audience must be the students themselves.
- **Return confirmation, gated on real send evidence**: the existing confirm-gated pattern
  (`src/lib/sendFormFlow.js`: `Mark N students as Form Sent?`, `Mark as sent` / `Not sent`) opens on
  return, but ONLY for recipients ASPIRE Connect reported as successfully sent:
  - both flows share one per-student gate: only students whose email is in the recorded
    `sentEmails` are confirmable; failed/skipped/unsent students stay Pending Outreach. The school
    flow confirms its successfully sent group together.
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

## D. Capacity templates

`unit_capacity_response_request` - `Unit Leader Capacity Request` (Send to Many, Unit Leader
audience), body in `src/lib/outreachTemplates.js`, registered in `SEND_TO_MANY_TEMPLATES` with
`defaultSource: 'contacts'` and `defaultContactCategory: 'Unit Leadership'`. Ships the
Owner-approved copy (ASPIRE-DESIGN-CORRECTION-1) as both a rich Content Block layout (heading
hierarchy, Unit Form button, why-hosting bullets) and a plain-body fallback. The `[Insert Unit Form
Link]` token resolves to the public `/unit-form` route via the composer's static-link substitution;
the `[Cohort]` token in the SUBJECT always resolves (launch context cohort name, else a neutral
fallback); the body's cohort and rotation-window blanks are intentional Owner fill-ins.

`unit_capacity_response_reminder` - `Unit Leader Capacity Reminder` (CAPACITY-FILTER-REMINDER-1):
the pending-units follow-up, same registration shape (`Unit Leadership` contacts default) and the
same `/unit-form` link substitution, with the Owner-approved reminder copy (heading `ASPIRE Unit
Capacity Request Reminder`, bolded rotation window, `Complete Unit Response` button). Sending it
never changes target or response status.

## E. Manual fallback: no UI entry point (Owner decision, 2026-07-30)

There is NO visible manual fallback for historical outreach anywhere in the product, and none
should be added. The backend target model, the staff API, and the `CohortResponseTargetsModal`
component are preserved in code (the modal keeps its `Mark units as already contacted` label and
outside-Connect confirmation checkbox), but the component is intentionally unmounted. Historical
targets (e.g. Fall 2026) are handled ONCE through an Owner-applied SQL backfill after the exact
contacted-unit list is approved - see the commented backfill template in
`supabase/migrations/20260731030000_add_cohort_unit_response_targets.sql`.

## F. Security and integrity

Owner/Admin only for the capacity send-and-confirm workflow (launch button is staff-gated; target
writes are server-verified owner/admin; the send endpoint enforces its own owner/admin auth).
Students, Unit Leaders, and Academic Partners cannot reach unrestricted target configuration (RLS
denies the tables to anon/authenticated; service-role only after server authorization). Sending or
confirming creates no hosting response, no capacity, and no portal access. Failed, canceled, or
unconfirmed sends create nothing. Confirmations are idempotent (durable-row RPC; existing status
transition) and auditable (target event triggers; existing student audit path).
