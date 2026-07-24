# Unit Leader Preceptor Assignment Manager Handoff

## Entry points

One shared assignment-manager foundation, `UnitLeaderPreceptorManager`, serves the
Unit Leader portal and the main-app Preceptor Directory through role-specific data
and mutation adapters.

Unit Leader entry points:

- focused mode from the student kebab actions,
- full-management mode from `Manage assignments` in the Student Detail Drawer,
- full-management mode from `Manage Preceptor Assignments` in the Preceptors
  workspace row-action menu.

Main-app entry point:

- `Manage Preceptor Assignments` in the rightmost row-action menu at
  `Main app > Rotation > Preceptors > Preceptor Directory`.

The old `Manage student assignments` label is retired. The legacy staff
`PreceptorAssignmentModal` remains available to older student-profile/placement
entry points, but the main-app Preceptor Directory no longer requires opening a
student profile to manage Secondary or Coverage rows.

The student kebab order is:

1. Message student
2. Change Primary preceptor
3. Add Secondary preceptor
4. Add Coverage preceptor

Replace and End are available only on a specific Secondary or Coverage row inside
the full manager.

## Shared title and student context

The modal title is title case and comes from one shared source:

```text
Manage Preceptor Assignments
```

The subtitle uses one normalized safe display model for both staff and Unit
Leader callers:

```text
Student Name · Unit · Shift
```

Unavailable segments are omitted rather than shown as `-`, so the subtitle never
has dangling separators. The main-app Preceptor Directory passes the student unit
and shift through the same assignment display model used by the Unit Leader
portal.

## Assignment behavior

- Primary uses `change_primary` to assign or change the one active Primary.
- Add Secondary and Add Coverage use `set_secondary` with `op: add` and create one
  additional active assignment without changing existing rows.
- Replace uses `set_secondary` with `op: replace`, the selected role, and the exact
  selected `assignment_id`.
- End uses `set_secondary` with `op: end`, the selected role, and the exact selected
  `assignment_id`; it requires a confirmation naming the role and preceptor.

The UI never implements a role-wide Replace or End. The existing Phase 2C RPCs
remain authoritative for row locking, stale-row detection, unrelated-row
preservation, audit events, and notifications.

## Presentation

`UnitLeaderPreceptorManager` remains the shared presentational foundation. The
modal is a clean white responsive sheet with internal scrolling, a stronger title
hierarchy, compact student-context subtitle, and consistent Primary, Secondary,
and Coverage sections.

Each active assignment row shows:

- preceptor name
- home unit when available
- shift when available
- start date when available
- compact contextual actions

Secondary and Coverage empty states are exact:

- `No active Secondary assignments`
- `No active Coverage assignments`

Primary uses `No active Primary assignment` when no active Primary is present.
Add actions remain visible and aligned.

## Staff adapter

The main app supplies a staff read adapter from the Preceptor Directory's existing
preceptor/student data plus active `student_preceptor_assignments` rows, and a
staff mutation adapter:

```text
POST /api/preceptor-assignment-manage
```

The staff endpoint verifies an active Owner/Admin server-side, then calls the same
audited RPCs:

- `assign_primary_preceptor`
- `set_secondary_coverage_preceptor`

It does not use Unit Leader scope as staff authority. It does not accept actor,
cohort, student-unit, or role authority from the browser. It preserves the same
request-id idempotency, exact-row Replace/End, audit, and notification behavior.

## Candidate selection

Candidates come only from the safe `candidates` collection returned by
`GET /api/portal/unit-preceptors`. The selector shows active canonical preceptor
name, home unit, and shift; supports name search plus unit and shift filters; and
labels choices outside the student's unit. Active preceptors from any unit are
eligible.

Preceptors already holding any active assignment for the student are removed from
the selector, including the exact current preceptor for Change or Replace. This
prevents known duplicate conflicts as a convenience; the backend remains the final
authority. No other-unit student or assignment details are read through the
candidate collection.

## Request ID lifecycle

Each mutation intent has an independent `createPreceptorRequestIdController`.
The identity includes the action, operation, role, exact target assignment, and
selected preceptor. A failed attempt releases the synchronous in-flight guard but
retains its request ID for retry. Success, cancellation, or changing any intent
identity resets the lifecycle. A second click before React re-renders is blocked by
both the controller and a synchronous component guard.

The browser sends only the approved assignment payload fields. It never sends
`force`, `confirm_override`, an actor profile ID, or cohort reassignment data.

## Completed rotations and errors

The current safe roster/read models do not expose the authoritative
`rotation_completed_at` or `rotation_end_date` used by the backend's 90-day check.
The UI therefore does not duplicate or infer that authorization rule from a display
date. It renders read-only controls if a future server-derived
`assignment_window_closed` flag is explicitly present; otherwise the Phase 2C RPC
enforces the window. An `MS403` response clearly explains the Unit Leader 90-day
limit. No force or Owner/Admin override control exists.

Stable error handling is:

- `MS400`: incomplete request or inactive/missing preceptor.
- `MS403`: forbidden change or completed rotation outside the Unit Leader window.
- `MS404`: student or exact assignment is no longer in authorized scope.
- `MS409`: duplicate/same assignment, stale or ended row, role mismatch, or request
  conflict/in-progress state.

Messages remain non-enumerating and never reveal raw database errors.

## Refresh behavior

After a committed mutation, the manager waits for a fresh authorized Preceptors read
and for the calling surface to refresh. Student roster data, an open Student Detail
Drawer, and the Preceptors workspace are refreshed without optimistic assignment
edits. Focused mode closes only after successful refresh; full mode returns to the
refreshed assignment list.

If either refresh fails, the actual backend success message is preserved, the stale
mutation flow is removed, and `Retry refresh` performs reads only. The mutation is
never automatically repeated. Success copy uses the backend's actual old and new
preceptor names when present.

## Accessibility and responsive behavior

The manager is a responsive portal modal/sheet with a labelled modal dialog, focus
trap, safe Escape behavior, focus restoration to the initiating control, visible
focus treatment, 44px-or-larger action targets, keyboard-operable candidate and
row actions, internal scrolling, wrapped long names/units, and no required
horizontal scrolling on mobile. The Student Detail Drawer suspends its own
keyboard trap while the manager is open and refreshes its authorized detail record
after a mutation.

## Security boundary

- Unit Leader assignment writes use `POST /api/portal/unit-preceptor-manage`.
- Main-app Preceptor Directory assignment writes use `POST /api/preceptor-assignment-manage`.
- No browser assignment-table write is used.
- Server-side active Unit Leader grant and student scope checks are unchanged.
- Staff writes require existing active Owner/Admin authority and do not reuse Unit
  Leader scope.
- Cross-unit candidate visibility carries no outside-scope assignment details.
- Unit Leader canonical creation remains limited to active authorized units.
- Replace and End always carry the exact selected assignment ID and role.
- No cohort reassignment or generic-role enablement was added.
- Phase 2C RPC, audit, notification, retry, sender, and Reply-To behavior is unchanged.
- No SQL, migration, RPC, view, or schema change was made.

## Verification

- New assignment-manager tests: 20 passed, 0 failed.
- All Unit Leader plus preceptor-authorization tests: 539 passed, 0 failed.
- Phase 2B/2C authorization, idempotency, and notification tests: 104 passed, 0
  failed.
- Full test suite: 2,235 passed, 0 failed, 0 skipped.
- Targeted ESLint for changed JS/JSX and test files: passed with no warnings.
- Client production build: passed; Vite emitted only the existing advisory that
  some chunks exceed 500 kB after minification.
- SSR build: passed (11 modules transformed; 36.08 kB output, 8.06 kB gzip).
- `git diff --check`: passed with no whitespace errors.

## Remaining limitations

The portal intentionally cannot pre-compute the 90-day backend cutoff from the
current safe response because the authoritative completion timestamps are not
exposed. Late or concurrent scope, assignment, and preceptor changes can still
produce an authoritative `MS403`, `MS404`, or `MS409`; the manager refreshes and
asks the Unit Leader to retry as a new intent when appropriate. Historical override
controls remain Owner/Admin-only and outside this portal.
