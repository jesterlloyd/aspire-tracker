# Unit Leader Portal Performance Handoff

## Evidence collected before changes

Local static and production-build inspection showed the Unit Leader portal was
doing the right data fetches for Home, but carrying avoidable route code eagerly.

Before this pass:

- `src/portal/UnitLeaderPortal.jsx` statically imported the Home calendar, the
  Preceptors workspace, and the assignment manager.
- Approximate source sizes of those avoidable eager imports were:
  - `UnitRotationCalendar.jsx`: 9.7 KB
  - `UnitPreceptorsWorkspace.jsx`: 9.7 KB
  - `UnitLeaderPreceptorManager.jsx`: 17.8 KB
- The production build emitted a single portal chunk around 149 KB before this
  split, plus the existing large main-app chunk warning.
- Home performed one Unit Leader roster bootstrap request, then independent Home
  reads for notifications and 90-day rotation activity.
- The removed Home cards also removed the previous Home placement summary read,
  so Placement data now waits for the dedicated Placement Requests route.

The strongest code-level explanation in the repository was bundle/request shape:
route-only and interaction-only modules were loaded before the Unit Leader could
use them. No evidence supported weakening authorization, widening browser reads,
or changing service-role endpoint behavior.

## Remediation

`src/portal/UnitLeaderPortal.jsx` now lazy-loads:

- `src/portal/unit/UnitRotationCalendar.jsx`
- `src/portal/unit/UnitPreceptorsWorkspace.jsx`
- `src/portal/unit/UnitLeaderPreceptorManager.jsx`

Each lazy boundary keeps an honest loading state:

- rotation activity uses `LoadingState`
- Preceptors uses the existing `TableSkeleton`
- assignment manager uses `LoadingState`

This keeps non-Home route code from loading on initial non-Home Unit Leader
routes and keeps the assignment manager out of the route bundle until a Unit
Leader opens it.

## After-change build evidence

Production build with placeholder public Vite values emitted:

- `PortalApp-Dot6Czno.js`: 133.95 KB, 35.50 KB gzip
- `UnitRotationCalendar-BP_9SNw1.js`: 6.47 KB, 2.40 KB gzip
- `UnitPreceptorsWorkspace-BMuAGTB1.js`: 10.33 KB, 3.42 KB gzip
- `UnitLeaderPreceptorManager-4g0_mCsl.js`: 13.66 KB, 4.49 KB gzip

Compared with the immediately previous local build for this branch, the portal
chunk moved from 149.30 KB to 133.95 KB, a reduction of about 15.35 KB before
compression. The existing large main-app chunk warning remains and is unrelated
to the Unit Leader portal split.

## Request behavior

Home remains scoped and server-authorized:

- one `GET /api/portal/unit-roster` bootstrap from the parent Unit Leader portal
- `GET /api/portal/unit-notifications` for actionable Home notifications
- `GET /api/portal/unit-shift-activity` for the bounded 90-day activity calendar

The Preceptors workspace, assignment manager, Capacity, Placement Requests, and
Messages behavior remain routed or interaction-specific. Their authorization
checks still run on their existing server endpoints.

## Boundaries

This performance pass did not run SQL, add migrations, change environment
configuration, move service-role reads into the browser, widen Unit Leader scope,
change assignment semantics, or alter Messages backend behavior.
