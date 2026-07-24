# Shared Calendar Foundation Handoff

## Shared foundation

The repository now has a shared presentation foundation for canonical calendar
surfaces:

- `src/components/shared/CanonicalCalendarFoundation.jsx`
- shared shell styles in `src/index.css`

Exports:

- `CanonicalCalendarLayout`
- `CanonicalCalendarSidebar`
- `CanonicalCalendarTodayPanel`

The foundation owns the common two-panel calendar frame: sidebar, main calendar
panel, toolbar region, title/description treatment, selected-date Today panel,
border, radius, shadow, and responsive collapse.

## Current consumers

Main app Interviews calendar:

- `src/components/CalendarSidebar.jsx` wraps the existing mini calendar and
  Today snapshot in `CanonicalCalendarSidebar`.
- `src/components/InterviewCalendar.jsx` continues to own staff-only interview,
  availability, event, Month/Week, and admin behavior.

Unit Leader Home:

- `src/portal/unit/UnitRotationCalendar.jsx` uses `CanonicalCalendarLayout`,
  `CanonicalCalendarSidebar`, and `CanonicalCalendarTodayPanel`.
- `src/portal/UnitLeaderPortal.jsx` renders the calendar full width before the
  `Your students` roster.

## Unit Leader configuration

The Unit Leader calendar is configured as a role-safe activity record:

- historically logged student shifts only
- selected-date mini calendar and Today panel synchronization
- no forward schedule fabrication
- no duplicate data fetches inside the presentational calendar
- no Supabase, auth, fetch, or staff calendar dependencies inside
  `UnitRotationCalendar`
- unit selector filtering applies to already-authorized activity rows
- previous, next, Today, and month-title controls without a redundant static
  Month-view pill

Staff-only controls intentionally remain absent from the Unit Leader calendar:

- Add Event
- Add Availability
- Manage Interviewers
- Schedule Interview
- interviewer chips
- cohort-wide event editing

## Responsive and accessibility notes

The shell uses a sidebar-plus-main grid on desktop and collapses to one column
below `760px`. Both panels use `min-width: 0` to avoid horizontal overflow.

The Unit Leader calendar provides labelled grids, gridcells, keyboard-focus
styles, selected-day styling, month navigation labels, and a clear empty state
for selected dates with no recorded activity.

## Unchanged boundaries

This shared foundation did not change calendar backends, authorization,
database schema, migrations, SQL, environment configuration, deployments, or
staff Interviews calendar permissions.
