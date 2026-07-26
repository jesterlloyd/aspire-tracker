# Academic Partner Portal: Phase 1 foundation handoff

Phase 1 delivers the Academic Partner (AP) portal shell, three-tab navigation, and the Students
landing workspace, on the approved shared portal foundation. It is a foundation phase: On Campus
Now, Needs Attention, the student profile drawer, Hours and Shifts detail, Placement Request
submission or editing, and Academic Partner Messaging are NOT implemented here. See the discovery
blueprint at `docs/product/ACADEMIC_PARTNER_PORTAL_DISCOVERY.md`.

Baseline: `3ab79cf` (discovery doc `f8aa51d` was one doc-only commit above main; the implementation
branch `ap-shell-students-foundation` was created from it).

## Routes

- `/portal` resolves to Students for an Academic Partner (the default; no separate Home tab).
- `/portal/ap/students`
- `/portal/ap/placement-requests`
- `/portal/ap/messages`

Sections are real routes parsed by `apViewFromPath` in `src/portal/PortalApp.jsx` (mirroring
`unitViewFromPath`). Back, forward, refresh, and a pasted deep link all work. Student and Unit
Leader routing are unchanged. Access is server-derived from `get_my_portal_access()`; a URL never
grants access.

## Shell reuse

The AP branch renders the same shared `PortalShell` as the Student and Unit Leader portals:
Nightfall header (`headerVariant="nightfall"`, `logoSrc="/cs-logo-large.png"`), the combined sticky
header + nav chrome (`.ptl-topsection` / `.ptl-header-nightfall`), ASPIRE branding, the profile
menu (name, Public site, Sign out), `withTabBar`, and `showHeaderName`. No second shell, no new
tokens, no duplicate masthead or weather art. The Students workspace reuses `GreetingMasthead`,
`WeatherMasthead`, `useLastVisitLabel`, and the shared state primitives (`LoadingState`,
`EmptyState`, `ErrorState`, `DeniedState`).

## Navigation

`AcademicPartnerNav` (`src/portal/ap/AcademicPartnerChrome.jsx`) is exactly Students, Placement
Requests, Messages, reusing the shared `.ptl-nav` attached-nav language, `aria-current` page
semantics, and the responsive bottom-bar behavior. No mobile More overflow is needed at three tabs.
No unread badge is wired (AP Messages is not authorized this phase).

## School picker behavior

- One authorized school: no selector, a static `School · <name>` context line.
- More than one: an accessible labeled `<select>` school picker.
- Changing school resets the cohort to that school's default and the filter to All, and updates the
  counts and roster.
- School scope is NEVER sent to the server. The roster fetch (`GET /api/portal/school-students`)
  carries only the JWT; the endpoint keeps deriving scope from `user_school_scopes`. A school
  outside the authenticated scope is never displayed.

## Cohort picker behavior

Cohort options are derived from the selected school's scoped roster (each student carries cohort
`{ id, name, status, start_date, end_date }`). Order and default:

- "All Current Cohorts" appears only when more than one cohort is currently Active.
- Individual cohorts, newest first (by `start_date` descending, then name).
- "All Cohorts" (includes historical), always last.
- Default: the newest Active cohort. If no cohort is Active, the default is "All Cohorts" so
  historical students are never silently hidden.

"Current" is the canonical cohort status: `cohorts.status === 'Active'` (from
`src/lib/constants.js` `COHORT_STATUSES = ['Planning', 'Active', 'Completed', 'Archived']`). We do
not infer "current" from student status. The pure logic lives in
`src/portal/ap/academicPartnerRoster.js` and is unit-tested.

## Summary filter definitions

Scoped to the selected school and cohort, computed client-side (no new request):

- All Students: every student in the selected school and cohort scope.
- Currently Rotating: real `students.status === 'Active Rotation'`.
- Completed: real `students.status === 'Completed'`.

No Needs Attention filter this phase (the approved school-facing attention signals need later
backend work; nothing is inferred). Counts are screen-reader labeled; selection uses `aria-pressed`
plus a ring, never color alone.

## Confirmed-unit fix

The endpoint previously read the legacy free-text `students.unit`, which no writer populates. It now
resolves the confirmed unit from the reliable normalized assignment
`students.matched_unit_id -> units.unit_name` (a `units` lookup keyed on the matched ids), returning
null when there is no confirmed placement. The legacy column is no longer selected or read.

## Privacy posture

`api/portal/school-students.js` is unchanged in its authorization spine and re-hardened by tests:

- Server-side chain: `verifyPortalCaller` (JWT) then `hasActiveRoleGrant('academic_partner')` then
  active `user_school_scopes`. Empty or revoked scope returns nothing; a non-partner is 403; an
  unauthenticated caller is 401/403.
- Explicit column allowlist (allowlist, not denylist). No private or confidential field is selected
  or returned: no support narrative, learning highlight, admin notes, review reason, exception
  flags, interview outcome or notes, rubric or scores, NGRP, disposition, compliance or clearance or
  health fields, SSN, date of birth, contact email or phone, resume, or headshot. Evaluation
  exposure is counts-only (completed and pending), never content.
- School isolation uses EXACT normalized term membership from `resolveSchoolAliases`, so West Coast
  University Anaheim and North Hollywood cannot cross campuses, and a bare-parent alias cannot pull a
  campus roster.
- No request parameter (`req.query`, `req.body`, `req.params`) influences scope.

`program_type` is not in the current endpoint allowlist, so it is not shown in the roster this
phase; it is deferred to the student-drawer release gate.

## Feedback utility (approved decision)

Feedback (Report a Bug) is enabled for the Academic Partner in `PortalUtilityLayer`. The floating
Messages launcher and unread polling are NOT enabled (`messagesAuthorized={false}`; the
`PortalTeamMessagesPanel` mounts only where Messages is enabled).

The feedback config and the DB already permitted `academic_partner`
(`PORTAL_FEEDBACK_ROLES`, the `portal_feedback_reports.portal_role` CHECK, and the RPC), but the
endpoint `verifyPortalFeedbackCaller` admitted only student and unit_leader, so an AP Send Feedback
would have returned 403 (a broken control). Per the approved decision, the endpoint now authorizes
an active `academic_partner` grant (feedback carries no roster data, so no further scope is needed),
completing the chain. Code-only, no SQL.

## Deferred to later phases (not implemented, no placeholder data)

- On Campus Now (needs a school-scoped, lifecycle-only shift-activity endpoint)
- Needs Attention (needs the approved rule set and a school-scoped feed)
- Student profile drawer and Hours and Shifts detail (needs a per-student AP detail endpoint with
  its own allowlist and exclusion test)
- Placement Request submission and editing (needs an authenticated sibling of the school form, and a
  request lifecycle for editing and withdrawal)
- Academic Partner Messages backend (needs `verifyPortalMessagesCaller` and the gating RPCs extended)
- NGRP Reports

Placement Requests and Messages have stable routes now, each rendering an honest prepared state
(the shared `EmptyState`), with no unsupported API calls and no broken controls.

Released reports (`portal_my_school_reports`) shown by the previous flat page are a published-
outcomes concern, not roster context, so they are intentionally not in the first-release Students
workspace; they belong with the later Reports / NGRP surface.

## Exact backend and SQL gaps

- No SQL or migration was added in Phase 1. All work is frontend plus one code-only endpoint auth
  addition (AP feedback).
- Later phases will need: a school-scoped On Campus Now endpoint; a per-student AP detail endpoint
  (possibly new SECURITY DEFINER reads for any newly exposed fields, Owner-gated); an authenticated
  placement-request submit and a request-editing lifecycle (new tables/RPCs/audit, Owner-gated);
  Messages auth RPC changes (Owner-gated). None are started here.

## Test coverage

- `test/academicPartnerShell.test.mjs`: shell, three-tab nav, URL routing, prepared states, the
  dormant Messages boundary, and the Feedback-only utility layer end to end.
- `test/academicPartnerStudentsWorkspace.test.mjs`: pure roster helpers (cohort options, scope,
  counts, filtering) plus workspace source guards (masthead reuse, single vs multi school, scope
  never sent to the server, exact filters, no later-phase surfaces).
- `test/academicPartnerPrivateFieldExclusion.test.mjs`: matched-unit resolution, no legacy unit,
  the response allowlist, private-field exclusion, WCU campus isolation, empty/revoked scope, and
  spoofing fail-closed.
- Existing chrome, utility-layer, feedback, and Messages-activation suites were updated to reflect
  the AP shell upgrade and the wired AP feedback endpoint.

Known pre-existing lint items in changed files (present on baseline `main`, not introduced here):
`api/portal/school-students.js` reports a `process` no-undef (the file has no `/* global process */`
pragma) at its existing `process.env` check.

## Deployment prerequisites

- Confirm the Phase 2/4 migrations are applied in production (per `docs/security/OWNER_SQL_GATE.md`):
  `public.schools`, `public.user_school_scopes`, `portal_my_school_reports`, and the feedback backend
  (`portal_feedback_reports` with the `academic_partner` CHECK and the RPC) must exist, and at least
  one `academic_partner` grant plus an active `user_school_scopes` row for live QC.
- No new SQL is required to deploy Phase 1.

## Not implemented in Phase 1 (explicit)

Placement Requests, Messages, On Campus Now, Needs Attention, and the student drawer are NOT
implemented. They render prepared states or are absent, exactly as described above.
