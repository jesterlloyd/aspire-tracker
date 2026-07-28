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

## 2. Hours completion is NOT lifecycle completion

### Root cause of a student sitting at e.g. `192 of 144`, still `Active Rotation`

There is **no automatic** `Active Rotation → Completed` transition anywhere in the system. Audit result:

- The **only** runtime writer of `students.status = 'Completed'` is a **manual, Owner/Admin-only**
  action — `update_student_status` in `api/student-update.js`, driven by the staff status dropdown in
  `StudentSidePanel.jsx`. It accepts any target status with no hours/date guardrails.
- No cron, RPC, or DB trigger flips status based on hours, rotation end date, or pending-hours
  clearing. The only *automatic* status write in the system is the reverse-direction
  `Placed → Active Rotation` promotion on a student's first approved shift
  (`api/shift-log/submit-past-shift.js`, `check-out.js`).
- The rotation-conclusion milestone (`api/portal/unit-milestones.js`) stamps
  `students.rotation_completed_at` (which starts the 90-day completed-visibility window) but explicitly
  does **not** touch `students.status`.
- The hours-complete student experience is advisory only: `ShiftLogPage.jsx` shows a "You've Completed
  Your Required Hours!" banner with a "Remind My Coordinator" mailto — completion is handed to a human.
- Casey-Fink and certificate release gate **certificate issuance only** (`caseyfink_post_rotation_…`),
  never the lifecycle status. Lifecycle status feeds those gates as a read; the direction is one-way.

So a student can reach or exceed required hours **before** the scheduled rotation end date and
correctly remain `Active Rotation`. Hours completion ≠ lifecycle completion.

### Canonical `Completed` transition path (today)

`Active Rotation → Completed` = a **manual Owner/Admin** status change (`api/student-update.js`
`update_student_status`). There is no server/scheduled transition and no hours/date auto-completion.

### Hours-cell UX (Unit Leader roster)

The Hours cell ([`HoursCell`](../../src/portal/UnitLeaderPortal.jsx), logic in the pure
[`deriveHoursCompletion`](../../src/portal/unit/hoursCompletion.js)) now:

- keeps the mini progress bar and the **uncapped** numbers (e.g. `192 of 144` — overage stays visible);
- shows a **"Hours complete"** indicator when `approved_hours >= required_hours` (required > 0), using
  the canonical portal "complete" green (`#16a34a` / `#e7f4ec` / `#14532d`, as the Next Steps
  timeline) — not a new status color system. The lifecycle status pill is untouched (stays
  `Active Rotation`);
- when the canonical rotation end date (`cohort_school_rotations.rotation_end_date`, surfaced as
  `student.rotation.end`) is still in the **future**, adds the helper note: *"Required approved hours
  reached. Rotation remains active through Aug 7."*

Edge cases handled by `deriveHoursCompletion` (unit-tested): approved == required; approved > required;
future vs today/past end; missing required; missing end date; pending hours; already `Completed`;
`Not Proceeding`; zero-hour requirement; negative values. "today" is a stable local `YYYY-MM-DD` read
once at roster mount (`useMemo`), never during render.

### `Ready to complete` attention signal (derived, display-only)

Because there is no automatic transition, **no background mutation was added**. Instead, a derived,
display-only **"Ready to complete"** chip appears on the roster row when ALL hold:

- stored `status === 'Active Rotation'`, AND
- `approved_hours >= required_hours` (requirement met), AND
- the canonical rotation end date is **today or past**.

It uses the portal's amber attention treatment and flags the student for the (manual) Owner/Admin
completion. It changes nothing server-side and is computed entirely from roster data already present.

### Deferred automation opportunity

If/when an automated or staff-surfaced completion queue is approved, the lowest-risk next step (no new
table, matching the existing derived-feed philosophy) is to add a `ready_to_complete` alert type to
`lib/server/notifications/unitLeaderAlerts.js` (`ALERT_TYPES` + `ALERT_LABEL`, kept out of
`EMAIL_ELIGIBLE` for in-app only) and emit it from `api/portal/unit-notifications.js` for in-scope
`Active Rotation` students whose rotation end date is reached and whose `deriveClinicalHours` yields
`remaining === 0` — rendering in the existing Home "Needs your attention" strip with zero UI change.
Whether the actual `Active Rotation → Completed` write should ever be automated (vs. remaining a
deliberate Owner/Admin decision, possibly with an unresolved-pending-hours guard) is a **product
decision** left open here; this branch adds no such automation.

## Explicitly unchanged

Student and Academic Partner hours displays (separate components; AP keeps `ApHoursCell` /
`deriveClinicalHours`); the lifecycle status vocabulary and the manual `Completed` transition; secure
photos, preceptor roles, cohort filtering, Refresh, and the status legend behavior. No SQL or
migration was added or run; no automatic lifecycle mutation was added; nothing was merged, pushed, or
deployed; the stray `src/portal/UnitLeaderPortal 2.jsx` was untouched.
