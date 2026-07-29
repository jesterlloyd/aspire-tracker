# Calendar Recurrence and Interaction — Discovery

Baseline: `main` at `da3f753` (the prompt's expected `6977e95` had advanced). Branch:
`calendar-recurrence-and-interaction-convergence`. This document is the Commit-1 audit that the
recurrence, anchored-availability, and action/color work build on.

## Two calendar stacks (scope)

- **`src/components/InterviewCalendar.jsx`** — the modern "Interviews → Calendar" stack (FullCalendar
  data + a custom month/week grid). It renders interview slots, **ASPIRE events**, availability, and
  the read-only **US holiday** overlay. **This is the target of all four changes.**
- **`src/components/WeekCalendar.jsx`** — an older/parallel stack (student-interview pills, its own
  `AvailabilityManagerModal`). It does **not** consume ASPIRE events. Left unchanged by this work.

## Event data model

### Table `public.aspire_events` — NOT in version-controlled schema

There is **no `CREATE TABLE` or `ALTER TABLE aspire_events` migration in the repo** (searched all
`supabase/migrations/*.sql` and the loose root SQL files). The table was created out-of-band
(dashboard / manual SQL). Its columns are reverse-engineered from `api/aspire-events.js`:

`id (uuid)`, `title (text)`, `event_type (text)`, `start_at (timestamptz)`, `end_at (timestamptz, null)`,
`all_day (bool)`, `is_milestone (bool)`, `show_on_welcome (bool)`, `audience (text, default 'internal')`,
`color (text, null)`, `url`, `location`, `school`, `description`, `cohort_id (uuid, null)`,
`status ('active' | 'archived')`, `created_by`, `updated_by`. **No recurrence/series fields exist.**

Constraints/CHECKs/RLS are not visible in the repo (no DDL). RLS is described in prose only
(`api/aspire-events.js:6-9`: client direct writes blocked; all writes go through the endpoint).
**Consequence:** recurrence needs an `ALTER TABLE … ADD COLUMN` migration authored blind of the real
constraints, applied only by the Owner, and the feature must be fail-closed until then.

### Event types — a JS allowlist duplicated in two places

Validated as a JS allowlist, **not** a DB enum/CHECK, and duplicated (kept in sync by hand):
`src/lib/aspireEvents.js` `ASPIRE_EVENT_TYPES` (value/label/color) and `api/aspire-events.js`
`EVENT_TYPES`. Current values:

`ngrp_open, ngrp_deadline, town_hall, interview_window, orientation, milestone, deadline, rotation,
reminder, custom`. **No `us_holiday` / `birthday`.**

### Audience / visibility — dormant

`audience ∈ {internal, all, cohort, school}` (default `internal`). It is **written but never read**:
the `list` handler returns all in-range active events regardless of audience; no staff surface and no
portal (student/unit/school) reads `aspire_events` at all. It gates nothing; access is controlled by
role in the API (owner/admin writes; any active internal user reads).

### Timezone / all-day

`start_at`/`end_at` are timestamptz ISO (UTC) strings. `all_day` is a boolean flag, but there is **no
date-only column** — an all-day event is still a timestamptz. All day-bucketing is **viewer-local**:
`src/lib/aspireEvents.js` `localDateStr(ts)` converts the timestamptz to a local `YYYY-MM-DD`, and
`eventOnDate`/`groupEventsByDate` bucket in local time. Canonical date-string helper repo-wide:
`toLocalDateStr` (`shared/dateUtils.js`, re-exported via `src/lib/designTokens.js`).

### Date-range fetching + Month/Week rendering

`api/aspire-events.js` `action:'list'` takes `from`/`to` (`YYYY-MM-DD`) and returns active events
**overlapping** the window (`start_at ≤ toEnd AND (start_at ≥ fromStart OR end_at ≥ fromStart)`). Both
views filter the flat `events` array per day with `eventOnDate(ev, dateStr)` (month: `CustomMonthGrid`
day cells; week: a dedicated all-day "Events" row). **Gap for recurrence:** the overlap query excludes
a recurring parent whose `start_at` is *before* the visible range (its `start_at ≥ fromStart` is false
and a null `end_at` fails the OR), so the list query must be widened to include recurring parents.

### Edit / delete

POST-only action endpoint: `list | create | update | archive`. Writes are owner/admin only. **Edit** =
`action:'update'` on one row by `id` (partial body; `status` stripped). **Delete** = soft `archive`
(`status='archived'`; never hard-deletes). No REST verbs, no per-occurrence concept. Explicit field
allowlist on create/update (`title, event_type, start_at, end_at, all_day, is_milestone,
show_on_welcome, audience, color, url, location, school, description, cohort_id`); `status/created_by/
updated_by/id` are server-set.

## US Holidays — computed, read-only, system-only

`src/lib/usHolidays.js` computes US federal holidays **client-side** from rules (fixed-date +
nth-weekday + weekend-observed shift), pure date math, **zero persistence** — never in `aspire_events`,
never fetched. `InterviewCalendar` merges them as a **separate read-only overlay prop** (`holidays`),
rendered as non-interactive amber chips (`onClick` stops propagation, `cursor:default`, no `id`, no
edit/delete path). The mini calendar (`CalendarSidebar`) shows a holiday dot from the same generator.
Leap years are handled implicitly by JS `Date` (no US holiday falls on Feb 29).

## Existing viewport-placement helper (for anchored availability)

`src/components/statusLegendPlacement.js` exports the pure `computeLegendPlacement({ rect, viewportW,
viewportH, position, margin, gap, desktopWidth, maxDesired })` → `{ placement, top, bottom, left,
width, maxHeight }` (below-preferred, flips above, clamps within margins). The availability
`CreatePopover` currently hand-rolls its own `Math.min/Math.max` clamp and, when opened from a **date
cell**, positions at **screen center** (`x: innerWidth/2 - 140, y: 200`) instead of near the cell —
the reported bug. This helper is the reuse target.

## Colors

- **Availability = navy `#1D2567`** (literal, equal to `--nightfall: #1d2567`) everywhere (header
  button, cell "+ Availability" chip, `CreatePopover` header/submit, manager add-block).
- **Event action = purple `#7C3AED`** (literal, **no CSS token**) on the header "Add Event" button and
  the cell "+ Event" chip. (Separately, event *chips* are per-type via `eventColor(ev)`; `town_hall`'s
  type default is also `#7C3AED`, `milestone` is `#9333EA`.) There is no `--aspire-event`/purple token;
  `.badge-purple`/`.card-purple` use `#5b21b6`/`#ede9fe` for unrelated badges.

## Action order today (inconsistent)

- **Header** (`InterviewCalendar` toolbar): **Add Event → Add Availability →** view toggle. Labels use
  an SVG "+" glyph ("Add Event" / "Add Availability").
- **Month cell hover** (empty cells only): **+ Availability (navy) → + Event (purple, admin-only)**.
- Week view has no per-cell hover add buttons (empty-column click opens the availability popover).

---

## Decisions (for Commits 2–4)

### Audience → keep the field, hide the control
Only `internal` is operative (nothing consumes the others; no authorized portal path exists). Per the
approved rule ("if only one audience is currently valid, hide the control rather than deleting the
field"): **preserve the `audience` column and allowlist for future access control, default every event
to `internal`, and hide the Audience/Visibility control in the modal.** Do **not** expand visibility to
Students / Unit Leaders / Academic Partners (no authorized read path exists).

### US Holidays → system-only, unchanged
Holidays come from an automatic (computed) source, so **do not add a `US Holiday` selectable event
type.** Preserve the automatic overlay; Holiday stays read-only/system. No manual-holiday duplication
is possible (there is no holiday event type to create).

### Birthday → new selectable type
Add a `birthday` event type. Defaults when chosen: **all-day on, recurrence = Annually, visibility =
Internal team, no required end date**, an existing approved celebratory color; the user can change any
default before saving.

### Recurrence storage → parent row + explicit fields, expanded on read
Smallest canonical model: one parent event row plus two explicit fields — `recurrence` (`none | weekly
| monthly | annually`) and `recurrence_end` (date, nullable). Occurrences are **expanded at read/render
time** by a pure, recurrence-aware `eventOnDate` (no materialized occurrence rows, no duplicates). The
`list` query is widened to also return active recurring parents whose recurrence window overlaps the
requested range. **Owner SQL gate:** `supabase/migrations/…_add_aspire_event_recurrence.sql`
(idempotent `ADD COLUMN IF NOT EXISTS`), **not applied by this branch**; recurrence is **fail-closed**
via a runtime readiness probe until the Owner applies it.

### Deterministic recurrence rules (documented)
- **Weekly**: every 7 days from the start (same weekday).
- **Monthly**: same day-of-month; months without that day (e.g. the 31st in a 30-day month, the 30th in
  February) have **no occurrence** that month (deterministic skip, never a shifted date).
- **Annually**: same month + day each year. **Feb 29 → Feb 28 in non-leap years** (deterministic).
- All-day recurring events stay all-day; time-based recurrence preserves the stored local time-of-day.

### Editing / deletion → series-level (create/display first release)
Recurrence lives on the single parent row, so the existing `update` edits the **whole series** and
`archive` removes the whole series — no new per-occurrence concept is introduced. **Per-occurrence
exceptions (edit/skip a single occurrence) are explicitly deferred**; this release is create + display
+ series-level edit/delete.

## Interaction convergence (implemented)

### Anchored Add Availability, centered Add Event
The small **Add Availability** panel now opens **anchored to the control or date cell that triggered
it** rather than screen-center. Every trigger threads a `triggerRect` (a button's
`getBoundingClientRect()` or a `rectFromPoint(x, y)` for a click) into `CreatePopover`, which reuses the
shared `computeLegendPlacement` helper (`src/components/statusLegendPlacement.js`) to flip
below/above, clamp to the viewport, and bound its height with a scrollable body. It is a labelled,
dismissable dialog (`role="dialog"`, `aria-label="Add Availability"`, Escape to close, focus returned
to the trigger, repositions on resize/scroll). The large **Add Event** modal (`AspireEventModal`) is
**unchanged and stays centered** — it deliberately does not adopt the anchoring machinery.

### Converged action hierarchy (order + color)
The two create actions read as one family everywhere they appear (header toolbar + date-cell hover
chips):

- **Order is always Availability, then Event.** The header toolbar was reordered to match the cells.
- **Availability is ASPIRE navy** (`#1D2567` / `--nightfall`, hover `#141928`) — unchanged.
- **Event is an accessible dark purple** design token, replacing the previous light purple
  (`#7C3AED`): `EVENT_ACTION = #6D28D9` (violet-700, ~6.7:1 on white), hover `#5B21B6` (violet-800).
  The token drives the header **Add Event** button and the date-cell **+ Event** chip, including their
  hover states.

These are **action colors only**. Per-type event chip colors (including `town_hall`'s `#7C3AED` and
the `Milestone` badge) are untouched, so an event's type color never changes.

## Implementation handoff

**Branch:** `calendar-recurrence-and-interaction-convergence` (off `main`). Not merged, not pushed, not
deployed; no SQL applied.

**Commits (in order):**
1. `Document calendar event model` — this discovery/audit doc.
2. `Add recurring ASPIRE events` — `birthday` type; `recurrence`/`recurrence_end` fields; read-time
   expansion (`eventOnDate`, `matchesRecurrence`); server allow-list + validation + `recurrence_enabled`
   capability + fail-closed 503; Owner-gated idempotent migration (not applied); modal Repeats control.
3. `Anchor availability to calendar actions` — `triggerRect` threading + `computeLegendPlacement`
   reuse; the centered Add Event modal left unchanged.
4. `Converge calendar action hierarchy` — action order (Availability then Event) and the navy/dark-
   purple action color family.
5. `Document calendar recurrence and interaction convergence` — this section, tests, handoff.

**Files changed:** `docs/product/CALENDAR_RECURRENCE_DISCOVERY.md`, `src/lib/aspireEvents.js`,
`api/aspire-events.js`, `src/components/AspireEventModal.jsx`, `src/components/InterviewCalendar.jsx`,
`supabase/migrations/20260731000000_add_aspire_event_recurrence.sql` (new, **not applied**),
`test/aspireCalendarRecurrenceAndInteractionConvergence.test.mjs` (new).

**Owner action required before recurrence goes live:** see **Event recurrence activation** below —
recurrence now requires **two** gates (apply the migration *and* set the server flag). Until both are
satisfied the API fails closed: one-time events are unaffected, and the modal's Repeats control is
hidden (`recurrence_enabled: false`).

**Tests:** `node --test test/aspireCalendarRecurrenceAndInteractionConvergence.test.mjs` (21 cases —
event model, recurrence expansion incl. Feb 29 / monthly-skip / no-duplicates, server allow-list +
fail-closed gate, anchored-vs-centered interaction, converged action order + color, type-color
regression). Owner-gate finalization adds
`test/aspireEventRecurrenceDataIntegrity.test.mjs` (DB constraints) and
`test/aspireEventRecurrenceCapabilityGate.test.mjs` (sentinel + flag readiness).

**Deferred:** per-occurrence exceptions (edit/skip one occurrence), a user-facing US-holiday toggle,
and any Audience beyond `internal` (control hidden, column retained defaulting to `internal`).

## Event recurrence activation

Recurrence is protected by **two independent gates**. It is live only when **both** hold; failing
either keeps the calendar in one-time-only mode with no error surface:

1. **Database migration applied** — `supabase/migrations/20260731000000_add_aspire_event_recurrence.sql`
   adds the `recurrence` / `recurrence_end` columns, the cadence and consistency constraints, and, last,
   the capability sentinel `public.aspire_event_recurrence_capability()` (EXECUTE granted to
   `service_role` only). The API probes this sentinel with the service-role client; a missing function
   or a failed probe reads as not-ready.
2. **Server release flag set** — `ASPIRE_EVENT_RECURRENCE_ENABLED` must equal the exact lowercase string
   `true`. It is server-only (no `VITE_` prefix), so the browser can neither read nor spoof it.
   `recurrence_enabled` is returned to the client only when the flag is `true` **and** the sentinel
   returns `true`.

**Activation step (Owner):** apply the migration, set `ASPIRE_EVENT_RECURRENCE_ENABLED=true` in the
server environment (Vercel project env, Production), and redeploy. Verify with the SQL in the
migration's footer and by confirming the modal's Repeats control appears.

**Data-integrity guarantees (enforced in the database, not only the API):**
- `recurrence` is constrained to `none | weekly | monthly | annually`.
- a one-time event (`recurrence = 'none'`) cannot carry a `recurrence_end`.
- a recurring event's `recurrence_end` is either NULL (indefinite) or on/after the event's UTC start
  date (`(start_at AT TIME ZONE 'UTC')::date`, matching the API's `start_at` contract exactly).

**Rollback behavior:**
- **Operational (safe, preferred, no SQL):** unset `ASPIRE_EVENT_RECURRENCE_ENABLED` (or set it to
  anything other than `true`) and redeploy. Recurrence disables immediately; **all columns and stored
  recurrence settings are preserved**. This is the intended rollback path.
- **Structural (DESTRUCTIVE):** dropping the `recurrence` / `recurrence_end` columns **discards every
  event's recurrence settings** and is appropriate only before any live recurring data exists, or after
  an explicit export. The migration footer documents the exact drop sequence with this warning.
- Existing rows are never rewritten by the migration; the new default simply makes them read as
  `recurrence = 'none'` with `recurrence_end = NULL`.
- RLS policies and existing grants on `public.aspire_events` are unchanged; occurrences remain
  read-time expansions only (no materialized occurrence rows).

**Owner-gate finalization commits (in order):**
1. `Harden event recurrence data integrity` — DB cadence + `recurrence_end` consistency constraints
   (idempotent drop-and-add).
2. `Gate event recurrence by server capability` — capability sentinel (created last, service_role-only),
   the `ASPIRE_EVENT_RECURRENCE_ENABLED` server flag, and the API readiness rewrite (flag AND sentinel).
3. `Document event recurrence activation` — this section.
