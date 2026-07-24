# Unit Leader Home Handoff

## Current Home structure

The Unit Leader Home page starts with the welcome heading and unit context, then
shows attention items when actionable. The rotation-activity calendar now uses
the shared canonical calendar shell and takes the full content width.

Home order:

- welcome heading and authorized unit context
- actionable attention strip, only when needed
- full-width `Rotation activity` calendar
- follow-up card row with `Upcoming students` and `Capacity and placement`
- full-width `Your students` table

The calendar is intentionally a historical activity record, not a schedule.
It keeps the existing 90-day server-bounded shift activity model and still tells
Unit Leaders that ASPIRE does not hold a forward schedule.

## Canonical calendar treatment

The Unit Leader calendar consumes the shared calendar foundation in
`src/components/shared/CanonicalCalendarFoundation.jsx`. The main Interviews
calendar sidebar also consumes the same shared sidebar foundation through
`src/components/CalendarSidebar.jsx`.

Unit Leader Home configures the shared shell for portal-safe activity:

- left sidebar with mini calendar
- selected-date `Today` panel
- previous and next month controls
- `Today` button
- month title
- month-only view indicator
- selected-day treatment in both mini and main calendars
- activity chips for completed and active logged shifts

Selecting any day updates the mini calendar and Today panel. A day drawer opens
only when the selected day has authorized activity. Empty selected days show:

```text
No student activity recorded for this day.
```

The Unit Leader calendar does not include staff-only interview, availability,
event creation, interviewer, cohort-wide, or schedule-management controls.

## Authorized unit selector

Home uses the shared compact `SegmentedTabs` unit selector when the caller has
more than one authorized unit. The selector is content-width, left-aligned, and
contains only:

- `All Assigned Units`
- server-authorized unit keys

The selector narrows the view only. Choosing all assigned units leaves authority
with the server-resolved scope.

The Home calendar applies the same local narrowing to the already-authorized
shift activity feed. `All Assigned Units` combines only authorized shift rows;
choosing a specific unit filters the visible calendar, attention strip, and day
drawer to that unit.

## Your Students table

`Your students` defaults to alphabetical A-to-Z order by student display name.
The Student header is now a sortable button:

- first render: A to Z
- click: toggles Z to A
- click again: toggles back to A to Z

The header exposes `aria-sort`, uses the same simple arrow treatment as the other
sortable tables, and sorts a copied array so the authorized source roster is not
mutated. Names with punctuation, hyphens, and mixed case are handled through the
shared `Intl.Collator` helper in `src/portal/unit/unitLeaderStudentSort.js`.

## Boundaries

This Home pass did not expose staff-only data or controls, change Unit Leader
scope, fabricate forward schedules, run SQL, add migrations, or alter backend
activity semantics.
