# Unit Leader Status Legend and Completion Readiness — Handoff

Branch: `unit-leader-status-legend-and-completion-readiness` (off `main` at `21dc94f`; the prompt's
expected baseline `1bcf7e2` had advanced by two unrelated staff-app commits). NOT merged, pushed, or
deployed. No SQL or migration added or run.

Two commits:

1. `Add Unit Leader ASPIRE status legend`
2. `Clarify rotation completion readiness`

## 1. Shared ASPIRE Status Legend on the Unit Leader roster

The Unit Leader student roster's **ASPIRE status** column header now carries the same information
trigger the Academic Partner roster uses, reusing the ONE canonical
[`StatusLegendPopover`](../../src/components/StatusLegendPopover.jsx) — no Unit Leader-specific legend.
It is placed on the shared `.am-sort-th-inner` row (`ASPIRE status` + the `ⓘ` trigger), matching the
AP placement, in **portal-safe** detail mode (`showStaffDetail={false}`): the "Not Proceeding"
disposition breakdown and the Readiness Colors (NGRP / staff-only detail) are hidden; only the active
pathway statuses show.

All approved behavior lives in the shared component, so the Unit Leader roster inherits it unchanged:

- scrolling the page/roster **repositions** the popover to follow its trigger (capture-phase scroll
  listener); a scroll inside the popover's own body is ignored;
- it closes **only** via the visible close button, an outside click/tap, `Escape`, toggling the
  trigger, or route change / unmount;
- focus returns to the trigger on close (derived, not a setState-in-effect);
- accessible trigger (`aria-label`, `aria-expanded`) and `Escape` handling are intact.

Main App (`StudentProfilesTab` and peers), Academic Partner, and Unit Leader now all render the same
component; AP and Main App behavior are unchanged (regression-covered).

## 2. Canonical automatic lifecycle completion

### Root cause of a student sitting at e.g. `192 of 144`, still `Active Rotation`

The original audit found no automatic `Active Rotation → Completed` transition. That gap is now
closed by `public.reconcile_student_completions` and the daily
`/api/cron/student-completion-reconciliation` repair sweep.

- The automatic transition updates the canonical `students.status`, so staff, student, Academic
  Partner, and Unit Leader surfaces plus reminders and release gates all converge without local
  status inference.
- Eligibility requires stored status `Active Rotation`, the explicitly linked and identity-consistent
  `cohort_school_rotations` row, an official end date strictly before the current Pacific date, a
  positive configured hours requirement, and approved hours greater than or equal to that
  requirement. Pending hours never count. Cohort dates and legacy `term_dates` never substitute for
  the school-form row.
- The transition stamps `rotation_completed_at`, preserves any earlier conclusion stamp, and appends
  one system `completion` program event.
- The hours-complete student experience is advisory only: `ShiftLogPage.jsx` shows a "You've Completed
  Your Required Hours!" banner with a "Remind My Coordinator" mailto — completion is handed to a human.
- Casey-Fink and certificate release gate **certificate issuance only** (`caseyfink_post_rotation_…`),
  never the lifecycle status. Lifecycle status feeds those gates as a read; the direction is one-way.

So a student can reach or exceed required hours **before** the scheduled rotation end date and
correctly remain `Active Rotation`. Hours completion ≠ lifecycle completion.

### Canonical `Completed` transition paths

The same database function runs after a cohort is marked Completed, after relevant student hours or
rotation-link inputs change, after an official school rotation end date is corrected, during the
one-time migration backfill, and once daily to catch date passage. Cohort completion alone is never
enough; every student must independently satisfy the official date and approved-hours rules. The
manual Owner/Admin override remains available for genuine exceptions.

### Hours-cell UX (Unit Leader roster)

The Hours cell ([`HoursCell`](../../src/portal/UnitLeaderPortal.jsx), logic in the pure
[`deriveHoursCompletion`](../../src/portal/unit/hoursCompletion.js)) now:

- keeps the mini progress bar and the **uncapped** numbers (e.g. `192 of 144` — overage stays visible);
- shows one **"Hours complete"** indicator when `approved_hours >= required_hours` (required > 0), using
  the canonical portal "complete" green (`#16a34a` / `#e7f4ec` / `#14532d`, as the Next Steps
  timeline) — not a new status color system;
- when the canonical rotation end date (`cohort_school_rotations.rotation_end_date`, surfaced as
  `student.rotation.end`) is still in the **future**, adds the helper note: *"Required approved hours
  reached. Rotation remains active through Aug 7."*

Edge cases handled by `deriveHoursCompletion` (unit-tested): approved == required; approved > required;
future vs today/past end; missing required; missing end date; pending hours; already `Completed`;
`Not Proceeding`; zero-hour requirement; negative values. "today" is a stable local `YYYY-MM-DD` read
once at roster mount (`useMemo`), never during render.

### Removed duplicate readiness signal

The amber **"Ready to complete"** chip was removed. It duplicated the green hours-complete signal and
asked Unit Leaders to interpret an internal administrative gap. The Hours column now reports hours;
the ASPIRE Status column reports the reconciled canonical lifecycle state.

## Explicitly unchanged

Student hours display; the lifecycle status vocabulary and the manual override; secure
photos, preceptor roles, cohort filtering, Refresh, and the status legend behavior. No SQL or
migration is applied merely by editing the repository; deployment must apply the completion migration.
The stray `src/portal/UnitLeaderPortal 2.jsx` remains untouched.
