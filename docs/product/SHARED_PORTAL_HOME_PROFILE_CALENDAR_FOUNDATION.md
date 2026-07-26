# Shared Portal Home, Profile, and Calendar Foundation

Status: **Complete on branch `portal-shared-home-profile-calendar-refinement` (from `main`
baseline `8a02011`). Not merged, pushed, or deployed. No SQL was run and no migration was
added.** This refinement targets the Unit Leader Portal, but every piece was built as a reusable
foundation for the Academic Partner and Student portals. Those portals were NOT started here.

The governing rule for the work: reuse the canonical main-app component, adapter, styling,
asset, and interaction pattern whenever possible; where direct reuse was blocked (a guard-locked
staff component, or a staff surface that exposes data a Unit Leader may not see), extract the
smallest role-configurable shared component and leave the main-app rendering visually unchanged.

## Commits

1. `Extract shared portal greeting masthead` (`0ce161c`)
2. `Reuse On Campus Now in Unit Leader Home` (`ffbb3da`)
3. `Reuse student profile modal with logged shifts` (`03f344b`)
4. `Add preceptor and shift ordinals to Unit Leader calendar` (`8d41c00`)
5. `Document shared portal reuse foundation` (this commit)

## Shared components and utilities

### Greeting masthead (`src/components/masthead/GreetingMasthead.jsx`)
Presentational, role-neutral. Reuses the exact main-app masthead visual system: the
deterministic greeting (`src/lib/masthead.js` `greetingLine`, the four daypart windows), the
compact HTC-style weather scene (`WeatherMasthead` from `src/components/WeatherScene.jsx`), and
the `.mast*` card styling in `src/index.css`. Every role value (name, date, context label,
last-visit line, optional milestone / today-items / calendar slots) is a prop.

The main app's own `TodayMasthead.jsx` is intentionally left untouched: its guard tests
(`test/chartToday.test.mjs`, `test/mastheadGreeting.test.mjs`) pin its internal JSX, and the
"main app unchanged" rule is load-bearing. `GreetingMasthead` is the smaller reusable wrapper
the portals share; `TodayMasthead` remains the staff adapter over the same primitives. A future
cleanup could migrate `TodayMasthead` onto `GreetingMasthead` once its guards are updated; that
was deliberately out of scope to keep staff byte-for-byte unchanged.

### Weather asset reuse
No new weather artwork was created. The portal masthead mounts the same `WeatherMasthead`
variant the staff masthead uses, which reuses `useWelcomeWeather` (one shared Open-Meteo query,
module-singleton geolocation), the same condition-to-scene mapping (`src/lib/weatherAssetMap.js`),
and the same saved icon files under `public/weather/aspire-licensed/`. Because the query key and
geolocation singleton are shared, mounting it in the portal dedupes against any other consumer.

### Last-visit primitive (`src/lib/lastVisit.js`)
`useLastVisitLabel(storageKey)` + the pure `formatLastVisit(iso, now)`. The caller supplies the
full storage key. The staff masthead keeps its existing per-user, per-cohort key
(`aspire:lastVisit:<userId>:<cohortId>`) inline in `TodayMasthead`; the Unit Leader portal uses a
**separate** key `aspire:lastVisit:portal:ul:<profileId>`.

**Why a separate key.** The portal is a distinct surface whose "last visit" is not scoped to a
staff cohort, and a single account could in principle hold both a staff and a portal role; a
shared key would let one surface's visit overwrite the other's. Academic Partner and Student
portals should follow the same pattern with their own `:portal:<role>:` key.

### On Campus Now card (`src/components/oncampus/OnCampusNow.jsx`)
Presentational, role-safe. Renders the canonical `.mast-live-*` card system from already-
normalized rows plus one avatar node per row; it holds no data, no authorization, and reads no
clock. Both the staff At a Glance dashboard (`OverviewTab.jsx` `OnCampusStrip`) and the Unit
Leader Home now render this same component, so there is one card definition, not a Unit Leader
copy. The staff strip keeps its guard-pinned strings (`if (!mergedCampusLogs.length) return
null`, `Clock-out may be overdue`, `shiftBadge(shiftTypeOf(log))`) in the row-building code, so
its output is unchanged.

Row display fields for the portal are built by the pure `src/lib/onCampusRows.js`
`buildLiveShiftDisplay(shift, now)`, which reuses the canonical `src/lib/shiftStatus.js` helpers
(`shiftBadge`, `formatDuration`, `isClockoutMaybeOverdue`) so the portal and staff cards cannot
disagree on the badge, open duration, or hedged overdue wording. The Unit Leader activity row
exposes `state`; a small shim bridges it to the helpers' `lifecycle_state`.

Avatars: the portal uses `UnitStudentAvatar` + `useUnitStudentPhotos` (the unit-scoped batch file
endpoint), never the staff `StudentAvatar` (which signs through a staff endpoint a Unit Leader
cannot call).

### Role-configurable student profile modal
The canonical staff profile "modal" (`StudentSidePanel.jsx`) is a 2,682-line editable, always-
open inline drawer wired to direct Supabase reads/writes, real-time subscriptions, optimistic-
concurrency conflicts, and ~16 richly editable sections. It is not a dialog and cannot be role-
configured without endangering staff behavior, so it stays staff-only.

The portal's canonical student modal is the existing `StudentDetailDrawer.jsx` (a real
`role="dialog"` with focus trap, Escape, focus restoration). On Campus Now cards open it. This
refinement made two additive changes: it gated the "Manage assignments" control on an
`onManageAssignments` handler (so the On Campus Now instance shows no staff-style control), and it
added a Clinical Hours section.

### Clinical Hours section (`src/portal/unit/UnitClinicalHours.jsx`) and logged-shift table
Role-safe by construction. Reuses the canonical calculation `deriveClinicalHours`
(`src/lib/portalProgress.js`, remaining floored at zero, pct clamped) and the canonical status-
chip vocabulary (`src/lib/shiftStatusChips.js`, newly extracted so the staff `ClinicalHoursPanel`
and this section share one map). It mirrors the main-app presentation: Required / Approved /
Pending / Remaining tiles, a progress bar, and a logged-shift table with the columns Date, Hrs,
Unit, Preceptor, Type, Status, Details.

Unlike the staff `ClinicalHoursPanel`, it does **not** mount `useSupportRequestReads`, the
support-needed dot, or `ShiftDetailsModal` (which exposes the private support narrative, the
student's learning highlight, and the internal review reason). The Details column is a read-only,
non-identifying note only.

### Shift ordinal utility (`lib/server/shiftOrdinals.js`) and word helper (`src/lib/ordinalWord.js`)
`buildStudentShiftOrdinals(logs)` returns a Map of shift-log id to a 1-based chronological
ordinal within each student's full history. `ordinalWord(n)` renders the accessible label
("first" through "tenth", then a numeric suffix such as "23rd").

### Calendar chip (`CanonicalActivityChip` in `src/components/shared/CanonicalCalendarFoundation.jsx`)
Extended with optional `secondary`, `ordinal`, and `ariaLabel` props. When both `secondary` and
`ordinal` are absent it renders exactly as before, so the main-app Interviews calendar and any
label-only caller are unchanged. The Unit Leader calendar passes the student's initials, "with
<preceptor first name>", and the ordinal as a small navy/green badge, with a full accessible
label ("Jordan Cruz with Susie, fourth logged shift"). The same label appears in the selected-day
sidebar list; the mini calendar is left uncrowded (activity dots only).

## Unit Leader role-safe data contracts

- **On Campus Now** reuses the existing `GET /api/portal/unit-shift-activity` payload (no new
  request). Commit 2 added one boolean, `has_photo` (via `hasFile(headshot_url)`); the storage
  path is never sent. Scope is server-derived (`verifyPortalUnitLeaderCaller` +
  `resolveUnitScopedStudents`); a student outside the caller's active units is invisible.
- **Clinical hours / logged shifts**: `GET /api/portal/unit-student-shifts?student_id=…`. Auth is
  `verifyPortalUnitLeaderCaller` then `authorizeStudentForUnitLeader`, which re-checks the
  selected student against the caller's active unit scope on this request and answers 404 (non-
  enumerating) otherwise. The fact that a student appeared in On Campus Now is never trusted. The
  response is an explicit allowlist: `hours { required, approved, pending }` from the authorized
  student record, and shift rows of `id, shift_date, total_hours, unit_name, preceptor_name,
  shift_type, status` only. Never `support_needed`, `learning_highlight`, `review_reason`,
  `admin_notes`, `reviewed_by`, `exception_flags`, `unit_override_reason`,
  `preceptor_override_note`, or check-in/out timestamps. `Cache-Control: no-store, private`.
- **Calendar ordinals**: `GET /api/portal/unit-shift-activity` now computes each row's `ordinal`
  from a second, full-history query (minimal columns: `id, student_id, shift_date, checked_in_at,
  lifecycle_state`) that is NOT bounded by `from`/`to`. Only the resulting integer is attached to
  the visible 90-day rows, so the caller's visible history is not widened.

### Ordinal algorithm and tie-breaking
For each student, sort their full shift-log history and assign a 1-based ordinal:
1. `shift_date` ascending (TEXT `YYYY-MM-DD`, so lexicographic equals chronological).
2. same-day tie-break: `checked_in_at` ascending (a row with a check-in time sorts before one
   without).
3. final tie-break: `id` ascending (immutable, so the order is fully deterministic and stable
   across requests).

The ordinal counts every actual logged shift and never resets by month or by unit. In-progress
(active) and completed rows both count. ASPIRE holds no forward schedule (a row exists only once a
student checks in) and has no canceled/deleted rows, so there are no placeholders to exclude; the
only rows excluded are any with an unexpected `lifecycle_state` (defensive). Historical range:
**full history**, computed server-side; the client never receives shifts older than 90 days.

## Ready for reuse (do not implement here)

### Academic Partner Portal
Potentially reusable, each still server-scoped by an active Academic Partner role grant and the
affiliated school/program/cohort scope with an explicit student relationship:
- `GreetingMasthead` + `useLastVisitLabel` (with a `:portal:academic_partner:` key) + weather.
- `OnCampusNow` (or a current-placement card) if policy permits, fed by an AP-scoped endpoint.
- `StudentDetailDrawer` reused as the role-configurable modal, with only affiliated-student
  sections; `UnitClinicalHours` + `deriveClinicalHours` for clinical hours and logged shifts.
- Calendar chips with student/preceptor/ordinal where authorized.

Restrictions that MUST remain: never trust a browser-supplied scope; never expose a student
outside the AP's affiliation; the same field allowlists as the Unit Leader endpoints.

### Student Portal
Potentially reusable, each strictly self-only (never peer data):
- `GreetingMasthead` + weather + `useLastVisitLabel` (with a `:portal:student:` key).
- The student's OWN current-shift card (a single-row `OnCampusNow`).
- The student's OWN clinical-hours summary and logged-shift list (`UnitClinicalHours` +
  `deriveClinicalHours`), fed by a self-scoped endpoint.
- The student's OWN calendar ordinal / progress indicator (`buildStudentShiftOrdinals`,
  `ordinalWord`).

Restrictions that MUST remain: self-only server scoping; no other student's rows in any payload.

### Role-specific restrictions that stay in place
The staff-only surfaces stay staff-only: `StudentSidePanel` (editable, restricted data),
`StudentAvatar` (staff file endpoint), `ShiftDetailsModal` and the support-request reads (private
support text / internal review). Portal endpoints keep explicit output allowlists, server-derived
scope, and the non-enumerating 404 pattern.

## Performance review

- **Greeting / weather** introduced no new network request on Home: `WeatherMasthead` reuses the
  shared weather query (deduped by key + geolocation singleton), and last-visit is a localStorage
  read/write only.
- **On Campus Now** reuses the Home shift-activity payload already fetched for the calendar
  (`getShiftActivity`); it issues no additional shift request. Its open-duration clock comes from
  `activity.loadedAt` (the moment the data loaded), not a render-time `Date.now()`.
- **Home photos**: the roster photo batch (`useUnitStudentPhotos`) is now hoisted once at the Home
  level and passed to both On Campus Now and the student roster, so Home makes one photo batch
  instead of two (`StudentRoster` accepts an optional `photos` prop; the standalone
  `/portal/unit/students` route still resolves its own).
- **Student modal**: opening it fetches the role-safe detail, milestones, and the new logged-
  shifts endpoint, each guarded by a `forId` pattern (a stale response for a previously viewed
  student can never paint over the current one) and aborted on unmount; the Try-again affordance
  uses a nonce. `StudentDetailDrawer` itself is already lazy-loaded in the portal.
- **Calendar ordinals** are computed server-side (one extra minimal, full-history query per Home
  activity load), so the browser does no ordinal math and receives no extra history. Payload
  growth is one integer per shift row (`ordinal`) plus one boolean per row (`has_photo`).
- **Stale-request handling**: the shared portal endpoint hook (`useEndpoint`) and the drawer's
  `forId` pattern both discard stale responses; effects abort in-flight requests on unmount.

## Live QC checklist

### Greeting
- Correct daypart (morning / afternoon / evening / overnight "Welcome back").
- Correct Unit Leader first name; correct full date; correct cohort label (when a cohort is
  accepting); last-visit text on a return visit.
- Same main-app weather icon and styling; graceful when weather is unavailable.
- No duplicate unit heading (one "Unit Leader · <units>" line only).

### On Campus Now
- Only authorized on-shift students appear; none from outside the caller's active units.
- Photo shows when available, initials fallback otherwise; unit, preceptor, shift badge, and
  open-duration render; the overdue hedge shows for a long-running open shift.
- A card opens the student profile drawer on click and on keyboard (Enter/Space).
- Zero-state text shows when no authorized students are on shift.

### Student modal
- The correct student; role-safe sections only (no notes, communications, disposition, SSN, CS-
  Link, evaluations, or edit controls).
- Clinical-hours totals (Required / Approved / Pending / Remaining) and progress bar; logged-shift
  rows with the seven columns; canonical status chips; a role-safe Details note only.
- Closes with Escape; focus trap; focus returns to the opening card.
- A direct request for an out-of-scope student is denied server-side (404).

### Calendar
- Chip shows initials, "with <preceptor first name>" (never a last name), and the ordinal badge.
- Current and pending shifts count toward the ordinal; the ordinal does not reset by month or
  unit; same-day shifts get distinct ordinals; a student with history before the 90-day window
  shows the correct (higher) ordinal.
- Accessible label reads e.g. "Jordan Cruz with Susie, fourth logged shift"; narrow cells
  truncate gracefully with full meaning on hover/focus.
- No navigation regression; the mini calendar stays uncrowded.

### Regression
- Main app greeting, On Campus Now, student profile modal, and Interviews calendar unchanged.
- Unit Leader Evaluations, Messages, and Feedback unchanged; Student and Academic Partner portals
  unchanged (not started here).

## Verification (run on this branch)

- Focused suites: shared greeting, On Campus Now, clinical hours, and shift ordinals all pass.
- Full suite `node --test 'test/*.test.mjs'`: all tests pass.
- Changed-file ESLint: no new errors or warnings (the one pre-existing `setState`-in-effect error
  in `ClinicalHoursPanel.jsx` is in the untouched `autoOpenShiftLogId` effect and exists at
  baseline `8a02011`).
- Production build clean (the prerender step needs the dev env vars:
  `set -a && . ./.env.development.local && set +a && npm run build`).
- `git diff --check` clean.

## Rollback

Each surface can be reverted independently and non-destructively (no data or schema is involved):
- Greeting: restore the plain "Welcome" heading in the Unit Leader `HomeScreen`.
- On Campus Now: restore the attention-strip live rows; the shared component and `has_photo` field
  are inert if unused.
- Clinical hours: remove the section from `StudentDetailDrawer`; the `unit-student-shifts`
  endpoint is inert if uncalled.
- Calendar ordinals: stop passing `secondary`/`ordinal` to the chip (it falls back to label-only)
  and drop the `ordinal` field from the endpoint.
