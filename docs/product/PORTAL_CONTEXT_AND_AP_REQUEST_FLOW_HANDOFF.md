# Portal Context Convergence and Academic Partner Request Flow Handoff

Five approved portal-convergence changes. Branch: `portal-context-and-ap-request-flow`, off `main` at
`f97cd5c`. No SQL, no migrations added or run. The previously approved placement provenance migration
(already applied in production) was not reapplied or modified. Reuses the main app as the canon; the
main app's visual behavior is unchanged.

## 1. Unified Nightfall role + scope headers

PortalShell now exposes two header slots (`src/portal/PortalHeaderSlots.jsx`): a scope line after the
role subtitle, and a right-aligned controls area left of the profile menu. Each portal fills them via
`createPortal` (slot nodes published through context by ref callbacks, so no setState-in-effect and no
cross-tree state lifting). Because the content is portaled out of the page body, it stays visible even
when its owning view is `display:none`.

- Academic Partner subtitle: `Academic Partner Portal · <school>` for one school; multiple schools get
  an authorized-school selector in the header. The cohort picker sits beside it.
- Unit Leader subtitle: `Unit Leader Portal · <unit>` for one unit; multiple units get the authorized
  unit selector in the header, on unit-scoped views only.
- Student subtitle: `Student Portal · <school>`. No cohort switcher (students remain in one cohort);
  school context is not repeated below the masthead.

### Redundant-context removal

The page-level `School · X` (AP Students + Placement Requests) and `Unit · X` (single-unit UL) rows
were removed, and the AP in-page school/cohort picker block moved into the header. Selectors offer
only server-authorized options and never send scope to the server. Headers stay responsive (the scope
line hides on phones with the subtitle; header controls remain reachable).

## 2. Canonical, role-scoped cohort availability

Root cause of Fall 2026 being absent: the AP portal derived cohort options ONLY from returned student
rows (`deriveCohorts(students)`), so a Planning + Accepting cohort with zero students never appeared,
while the main app's picker uses `cohorts.select('*')` unfiltered.

Canonical source adopted: `api/lib/schoolScope.resolveSchoolScopedCohorts(db, scopes, matches)` returns
each authorized school's cohorts INDEPENDENT of the roster, from the `cohorts` table. Role scope:

- Main app: all authorized cohorts (unchanged).
- Academic Partner: for an unrestricted school scope, the union of its students' cohorts, cohorts it
  participates in via `cohort_school_rotations` (matched by EXACT normalized school name, so WCU
  Anaheim and North Hollywood stay isolated), and any cohort currently `accepting_submissions`. A
  cohort-restricted scope (`user_school_scopes.cohort_id`) sees only that cohort.
- Unit Leader / Student scoping is unchanged.

Both AP endpoints return a top-level, newest-first `cohorts` array per school. School and cohort are
always server-derived; a browser-supplied school or cohort id is never trusted.

### Separate Students vs Placement Requests cohort defaults

- Students (`cohortOptions`): default = newest Active cohort; `All Current Cohorts` only when more than
  one is Active; `All Cohorts` for historical viewing. Changing cohort updates the KPIs and roster. A
  zero-student accepting cohort now appears in the picker.
- Placement Requests (`submissionCohortOptions`): only cohorts currently `accepting_submissions` are
  valid targets (no `All Cohorts`), default = the nearest upcoming accepting cohort. So when a Summer
  cohort is Active but closed and a Fall cohort is accepting, Fall is the submission target. Changing
  the submission cohort resets only the cohort-dependent password verification (adjust-state-during-
  render pattern), never unrelated typed form data.
- Messages: no cohort filtering was invented.

## 3. Submission-focused Placement Requests

Placement Requests no longer duplicates the Students roster. It defaults to the new-request workflow:
heading + short copy, school scope and the submission cohort in the header, the cohort password gate
when required, and the canonical shared placement form after verification. The full current-student
table is removed; a `View students and statuses` action links to the Students tab, which stays the
canonical place to follow status, unit and preceptor assignment, requested/confirmed rotation dates,
hours, and completed/not-proceeding state.

Closed-state correction: the truthful "No cohort is accepting requests right now" state shows only
when the server reports no accepting cohort for the selected school, never because the Students
workspace was viewing a closed cohort. Success shows added/updated/skipped counts and links to
Students; there is no duplicate table. Final-POST password re-verification, the provenance readiness
probe, latest-submission provenance, duplicate-safe writes, Main App At-a-Glance visibility, privacy
allowlists, no Unit Leader comments, and the absence of drafts / editing / withdrawal / Request a
Change / audit-history UI are all unchanged.

## 4. Canonical Academic Partner pathway KPI band

The three-card AP filter set was replaced with the full canonical main-app Student Profiles band:
Total, Needs Outreach (Pending Outreach + Form Sent), Awaiting Interview (Form Received + Interview
Scheduled), Interviewed, Placed, Active Rotation, Completed, Not Proceeding. Counts and grouping come
from the shared `src/lib/derivations/cohortStatus.computeStatusCounts` (NOT a parallel AP grouping;
the AP-only `summaryCounts`/`applyFilter` were removed). Each card filters the roster scoped by the
selected school and cohort; selection is visible beyond color (aria-pressed fill), keyboard activation
is native, and sorting, secure photos, and the disposition-safe legend are intact. The grid mirrors
the main app's column steps (8 -> 4 -> 2).

Privacy: Not Proceeding uses the privacy-safe subtitle "No longer moving forward" for the Academic
Partner, never the internal disposition detail (not selected / withdrew / declined offer).

## WCU isolation result

WCU Anaheim and WCU North Hollywood remain isolated everywhere: cohort resolution matches
`cohort_school_rotations` by EXACT normalized school name (never substring), and student/placement
authorization continues to use exact-term membership. Server tests assert a North Hollywood rotation
never leaks into an Anaheim scope.

## Tests

- `test/portalHeaderScope.test.mjs`: the shared header slots; AP/UL/Student scope in the header;
  redundant page rows removed; no Student cohort switcher.
- `test/schoolScopedCohorts.test.mjs`: zero-student accepting cohort appears; rotation-linked cohorts;
  WCU isolation; cohort-restricted scope; newest-first order.
- `test/academicPartnerStudentsWorkspace.test.mjs`: canonical cohorts consumed (not roster-inferred);
  Fall-2026-with-zero-students appears; Students default = newest Active; submission cohort default =
  nearest upcoming accepting; the canonical 8-card band with privacy-safe Not Proceeding copy; the
  header school scope.
- `test/academicPartnerPlacementRequests.test.mjs`: submission-focused (no roster table), View
  students link, canonical accepting submission cohort, server-side password verification, truthful
  closed state, no drafts/edit/withdraw controls, server-gated submit.
- `test/academicPartnerShell.test.mjs`, `test/unitLeaderScopeSelectorRemoval.test.mjs`,
  `test/unitLeaderPortalPolish.test.mjs`: updated for the header-based scope and the onNavigate wiring.

## Not changed

The main app cohort picker, `/school-form`, the AP placement POST security (password + provenance +
readiness), Student and Unit Leader portal behavior, portal Refresh, the status legend, and the shared
sortable headers are unchanged, and were kept green by the regression suite.
