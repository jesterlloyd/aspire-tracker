# Portal QC Polish and Shared Refresh Handoff

Three approved QC refinements to the shared portal experience (Student, Unit Leader, Academic
Partner). Branch: `portal-qc-polish-refresh`, off `main` at `5cb0902`. No SQL, no migrations.

## 1. ASPIRE Status Legend stays open while scrolling

Component: `src/components/StatusLegendPopover.jsx` (shared by the main app and the Academic Partner
roster).

- Root cause: the popover is `position: fixed` and portaled to `document.body`, with its coordinates
  captured once from the trigger's `getBoundingClientRect()` at open time. A capture-phase `scroll`
  listener called `setIsOpen(false)` on any external scroll, because scrolling would otherwise leave
  the fixed popover visually detached from its trigger.
- Fix: the scroll listener now REPOSITIONS instead of closing. On `scroll` (capture phase, so it
  catches any scrollable ancestor) and on `resize`, the popover recomputes its coordinates from the
  trigger rect and follows it. Positioning math is factored into a shared `computeCoords()` used by
  both open and reposition. A scroll originating inside the popover's own scrollable body is ignored
  (it does not move the trigger).
- Close paths (unchanged): the visible close button, an outside click (`mousedown`), Escape, toggling
  the trigger, and route change / unmount. Focus still returns to the trigger on close. The Academic
  Partner still passes `showStaffDetail={false}`, so the disposition/readiness detail stays hidden.
- Tests: `test/statusLegendScroll.test.mjs`.

## 2. Canonical sortable-header indicators

The Academic Partner roster used bespoke glyphs (▲ ▼ ↕ in a `.ptl-ap-sort` button). The canonical
treatment lived as a file-local, non-exported `SortHeader` inside
`src/components/shared/PreceptorDirectoryTable.jsx`.

- Extraction: the canonical header is now a shared component, `src/components/shared/SortHeader.jsx`.
  It renders a real `<button className="preceptor-dir-sort">` with the column label and a directional
  text arrow (` ↑` ascending, ` ↓` descending, nothing when unsorted), `aria-sort` on the `<th>`, and
  a dynamic `aria-label` ("Sort by {label} {ascending|descending}"). No SVG, no icon set.
- Reusable without visual change: two optional props keep it adoptable anywhere. `thClassName`
  (default `am-th am-sortable`, the staff cell) lets a caller keep its own header-cell styling;
  `after` renders adjacent header content (used for the ASPIRE Status Legend), aligned by the shared
  `.am-sort-th-inner` row.
- Adoption: `PreceptorDirectoryTable` imports the shared component and drops its local copy (output
  byte-identical with defaults, so the staff app is unchanged). `AcademicPartnerPortal` imports it for
  Student, ASPIRE status, and Hours, passing `thClassName=""` to keep the portal table cell styling
  and carrying the legend through `after`. The bespoke `.ptl-ap-sort*` CSS was removed.
- Preserved: sort logic, canonical pathway ranking, school/cohort selection, the KPI filter,
  client-side sorting, stable ordering.
- Tests: `test/sortHeaderConvergence.test.mjs`, plus updated
  `test/academicPartnerRosterSorting.test.mjs`, `test/academicPartnerRosterConvergence.test.mjs`,
  `test/portalExperienceConvergencePhase2.test.mjs`,
  `test/unitLeaderPortalVisualConvergenceCommit1.test.mjs`.

## 3. Shared portal Refresh action

Reuses the canonical main-app `RefreshHint` (`src/components/UnifiedNav.jsx`).

### Placement
- Right-aligned at the end of the attached nav row (`.ptl-nav`) in all three portals, via
  `.ptl-nav-refresh { margin-left: auto }`. Hidden on phones (≤760px), where `.ptl-nav` is the fixed
  bottom tab bar, exactly like the main app's `.chart-nav-refresh`. Tabs are never crowded or
  truncated, and the mobile bottom-nav behavior is unchanged.

### Architecture (`src/portal/PortalRefresh.jsx`)
- `PortalShell` wraps its content in a `PortalRefreshProvider`, so any portal that passes a nav gets
  Refresh for free.
- `PortalNavRefresh` (rendered inside each nav's `.ptl-nav`) consumes the context and renders
  `RefreshHint` with `loading={refreshing}` and `disabled={!canRefresh}`.
- The ACTIVE section registers its own refetch through `useRegisterPortalRefresh(fn, active)`. The
  provider holds the handler in a ref (registering never re-renders the tree) and exposes a boolean
  `canRefresh`. A concurrency guard prevents a second run while one is in flight.
- This is NOT a browser reload. The main-app top nav falls back to `window.location.reload()` only
  because it passes no handler; every portal surface registers a state-driven refetch instead, so
  routes, history, filters, selection, and open drawers are preserved.

### Refetch contract per surface
- Student: Home registers its `load()` (gated to the active view, since Home and Messages stay
  mounted); Messages registers an inbox + open-thread refetch when active.
- Unit Leader: Home refetches roster + in-app feed + calendar activity; Students refetches the roster;
  Placement Requests refetches its list; Capacity refetches the roster (its accepting-cohort source);
  Preceptors refetches the directory + nomination history; Evaluations refetches the released
  results; Profile refetches notification preferences; Messages as above.
- Academic Partner: Students refetches the school roster (and re-primes secure photos through
  `has_photo`). The Placement Requests and Messages prepared states register nothing, so Refresh is
  disabled there and issues no unsupported call.
- Tests: `test/portalRefreshAction.test.mjs`, plus updated `test/unitLeaderPhase1.test.mjs` and
  `test/unitLeaderScopeSelectorRemoval.test.mjs`.

## Known limitations / notes
- Refresh is a desktop chrome affordance; on phones it is intentionally hidden (the bottom bar is
  reserved for tab navigation), matching the main app.
- Prepared states (Academic Partner Placement Requests and Messages) show a disabled Refresh rather
  than a hidden one, so the control's location stays consistent across sections while remaining
  honest about having no data source yet.
- Pre-existing baseline lint items in touched files are unchanged: `StudentPortal.jsx` reports a
  `react-hooks/set-state-in-effect` on its existing `load()` mount effect, and
  `StatusLegendPopover.jsx` reports an unused-`React` import (both present on `main`).
