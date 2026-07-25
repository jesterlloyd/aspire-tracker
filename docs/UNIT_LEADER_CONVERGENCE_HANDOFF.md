# Unit Leader Calendar, Performance, Scope, and Evaluations Convergence — Handoff

Branch: `unit-leader-calendar-evaluations-convergence`
Baseline: `a50da14` (Improve Unit Leader portal performance)
State: Commits 1-4 complete on the branch. Commit 5 (Evaluations workspace) is
intentionally blocked. Not merged, not pushed, not deployed. No SQL, no migrations,
no environment changes.

| Commit | Hash | Title |
|---|---|---|
| 1 | `7f24248` | Match Unit Leader calendar to main app |
| 2 | `7e21d74` | Fix Unit Leader calendar navigation and performance |
| 3 | `d85a3d8` | Remove redundant Unit Leader scope selectors |
| 4 | `e23d695` | Document Unit Leader evaluations gate; SQL verdict: definitely needed |

## Commit 1 — Shared calendar convergence

The Unit Leader rotation calendar and the main-app Interviews calendar now render
through the same primitives, so they are one visual system rather than two look-alikes.

- New shared primitives in `src/components/shared/CanonicalCalendarFoundation.jsx`,
  inline-styled with the main app's exact values so adoption is pixel-identical:
  `CanonicalCalendarNav` (grouped previous/next pill + Today), `CanonicalCalendarMonthTitle`
  (centered), `CanonicalWeekdayHeader`, `CanonicalMonthCell` (88px cell, 22px round day
  badge, navy today/selected treatment, navy left rail when selected),
  `CanonicalActivityChip`.
- Unit Leader calendar (`src/portal/unit/UnitRotationCalendar.jsx`): toolbar groups
  previous, next, and Today on the left, centers the month/year, and leaves the right
  side empty (a Unit Leader adds no events). Month grid built from the shared cell and
  chip. Week start changed to Sunday-first (`rotationCalendarDates.js`) to match the
  main app.
- Main app (`src/components/InterviewCalendar.jsx`): adopts `CanonicalCalendarNav` and
  `CanonicalWeekdayHeader` as byte-identical swaps. FullCalendar, capacity cards,
  Add Event / Add Availability / Month-Week toggle, and all staff interactions are
  untouched.
- CSS: trimmed the calendar classes the primitives replaced
  (`.ptl-cal-nav/-month/-grid/-dow/-cell/...`); kept chips, legend, mini calendar, and
  the Today-panel list. Aligned the shared shell sidebar to 260px
  (`.canonical-calendar-shell` in `src/index.css`).
- Role safety preserved: no staff controls, no FullCalendar, no data fetching in the
  Unit Leader calendar; activity chips remain initials-only over authorized, logged
  shifts. Legends and the 90-day explanation preserved.

Design note (honest limit): the main app is a 1766-line component with FullCalendar
entanglement and staff-only cell content (capacity cards, hover quick-add). The two
safe, self-contained pieces (nav cluster, weekday header) were converged onto shared
primitives; the main app's staff cell internals were deliberately not routed through
the shared cell, because that carries regression risk that cannot be visually verified
in this environment. Visual parity of the grid is achieved by the shared primitive
carrying the main app's exact values.

## Commit 2 — Navigation fix and performance

- Future-month navigation: the hard current-month ceiling (and the window floor) in
  `UnitRotationCalendar.jsx` are removed. Root cause: the calendar fetches the entire
  90-day window in one client-side request and never fetches per month, so the disabled
  `canGoForward`/`canGoBack` gates were pure UI limits with no data reason. Navigation
  is now free in both directions, matching the main-app calendar, which imposes no
  range. Empty past/future months render a normal grid with the honest "No rotation
  activity recorded in {month}" note and trigger no server request. Today returns to
  the real current month and selected date. The server keeps its `range_in_future` and
  `range_before_window` guards; the client simply never requests a future range.
- Performance:
  - Baseline critical path: `getRoster` (bootstrap) -> Home mounts -> `getNotifications`
    + `getShiftActivity` fire -> the lazy calendar chunk downloads only when Home renders
    its Suspense boundary. The prior pass (`a50da14`) had already split the chunk and
    lazy-loaded the calendar, preceptors workspace, and preceptor manager.
  - Change: warm the lazy calendar chunk on portal mount
    (`import('./unit/UnitRotationCalendar')`), so it downloads in parallel with the
    roster bootstrap instead of after Home renders. Same specifier as the `lazy()`
    import, so both resolve one chunk; a failed prefetch is a no-op.
  - Request shape preserved: exactly one bootstrap (`getRoster`) plus Home's two
    independent reads. Shift activity is fetched once with deps `[]`, so switching units
    narrows the visible set client-side and never refetches. No duplicate reads.
  - Honest limits: the shift-activity and notifications reads remain gated behind the
    single roster bootstrap by the portal's established "one bootstrap" contract
    (guarded by `test/unitLeaderPortalPerformance.test.mjs`); this pass did not
    re-architect that. There is no per-month prefetch to add, because all window data
    arrives in one fetch. Serverless cold-start latency is outside client control and
    unchanged.

## Commit 3 — Redundant scope selector removal

- The page-level unit switcher (`All Assigned Units | 6 NE | 6 NW`) is removed from
  Placement Requests and Capacity. `UNIT_SCOPED_VIEWS` is now
  `['home', 'students', 'preceptors']`.
- Placement Requests fetches the full authorized set (`getPlacementRequests(ALL_UNITS)`,
  no page-level `unitKey` dependency); each row already carries a Unit column for
  context. Empty state unchanged.
- Capacity depends solely on its own in-form unit picker (the only unit selection that
  matters for submission). A single-unit leader is prefilled and locked; a multi-unit
  leader starts unset and chooses in the form. The endpoint independently rejects an
  out-of-scope unit.
- Scope stays server-derived; the browser holds no unit authority; direct URL
  manipulation cannot widen scope. The nav still exposes both tabs.

## Commit 4 — Evaluations safety review (SQL verdict: definitely needed)

See `docs/UNIT_LEADER_EVALUATIONS_DIAGNOSTIC.md` for the full diagnostic, the 11-point
Unit Leader authorization contract, the schema/policy gaps, the proposed migration
contract, per-instrument release rules, threshold behavior, and the response-viewer
field contract.

Summary: the evaluation schema has no release-to-unit, moderation, delayed-release,
stable historical unit/preceptor attribution, small-cohort threshold, unit-visibility
consent, or free-text redaction. Unit Leaders cannot read any evaluation table (RLS is
owner/admin only), and no Unit Leader evaluation endpoint exists. A client-only
implementation would be unsafe because every missing safeguard is an authorization and
disclosure control. The Evaluations tab keeps its honest placeholder
(`UnitEvaluationsPlaceholder.jsx`), and the gate is locked by
`test/unitLeaderEvaluationsGate.test.mjs`.

## Commit 5 — Blocked

The Unit Leader Evaluations workspace and the shared Evaluation Dashboard component
extraction are not built on this branch. They require the migration contract in the
diagnostic to be approved through the Owner SQL gate
(`docs/security/OWNER_SQL_GATE.md`) and applied first. Building them now would mean
simulating release, moderation, delayed release, stable attribution, and thresholds in
client code, which the branch's locked principles forbid.

## Live QC checklist (post-deploy, when this branch ships)

Calendar
- [ ] Unit Leader calendar toolbar: previous/next grouped with Today, month centered,
      right side empty.
- [ ] Grid cells match the main app (88px, round day badge, navy today/selected).
- [ ] Week starts Sunday.
- [ ] Next navigates past the current month; empty future months render the "no
      activity" note; Today returns to the current month.
- [ ] Previous navigates freely; no dead-end.
- [ ] Main-app Interviews calendar is visually and functionally unchanged (Add Event,
      Add Availability, Month/Week, capacity cards, week view).
- [ ] 320px width, 200% zoom, keyboard, and screen reader behave.

Performance
- [ ] Home renders the shell and heading before calendar data completes.
- [ ] Switching units does not refetch the calendar.

Scope selectors
- [ ] Placement Requests: no page-level switcher; all authorized requests show with a
      Unit column.
- [ ] Capacity: no page-level switcher; form unit picker limited to authorized units.
- [ ] Home, Students, Preceptors: switcher still present.

Evaluations
- [ ] Evaluations tab shows the placeholder, no data, no counts.
