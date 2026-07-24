# Unit Leader Preceptors Workspace Handoff

## Delivered behavior

The Unit Leader portal now exposes `Preceptors` at `/portal/unit/preceptors`.
Desktop navigation is `Home | Preceptors | Messages | Evaluations | Placement Requests | Capacity`.
At the existing 760px mobile breakpoint, the bottom navigation is
`Home | Preceptors | Messages | More`; More contains Evaluations, Placement
Requests, and Capacity. Profile and notification preferences remain in the avatar
menu, and `/portal/unit/students` remains available as a deep link without a
permanent navigation item.

The workspace provides a responsive roster with a compact control row:

- `+ Add Preceptor`
- compact search
- compact Filters disclosure for shift, status, and cross-unit association

It defaults to active preceptors. Sorting is handled by the shared sortable table
headers instead of a standalone Sort dropdown. Loading, retryable error,
no-associated-preceptor, and no-filter-result states use the shared portal
patterns.

The directory table now uses the same shared presentation foundation as the main
app Preceptor Directory:

- `src/components/shared/PreceptorDirectoryTable.jsx`
- `src/lib/preceptorDirectory.js`

The shared foundation provides a white table surface, compact directory density,
row separators, circular profile-photo/initials treatment, sortable headers with
`aria-sort`, status pills, assignment-role badges, and the same `Current Student`
assignment list treatment. Unit Leader still receives only the safe Unit Leader
columns and never receives main-app Edit or Delete controls.

For multi-unit leaders, the portal unit selector is a segmented control with
`All Assigned Units` followed by the caller's authorized units. It is a view
narrowing control only; unauthorized units never appear.

## Authorized read model

`GET /api/portal/unit-preceptors` returns:

- `roster`: safe preceptor directory fields, active assignment count, a cross-unit
  association flag, an authorized contact avatar URL when available, and active
  assignments limited to server-authorized students.
- `candidates`: every active canonical preceptor with only `id`, `full_name`,
  `home_unit`, and `shift`, reserved for a future assignment selector.

Each returned roster assignment contains the exact assignment ID, student ID,
student display name, student unit, normalized role (`Primary`, `Secondary`, or
`Coverage`), start date, optional end date, and status.

A canonical preceptor is in the roster when their home unit is within an active
Unit Leader scope or they have an active assignment to an in-scope student.
Assignment details are intersected with the server-resolved student scope before
shaping the response, so out-of-scope students are not exposed.

## Direct creation

`+ Add Preceptor` opens a portal-specific form for full name, email, optional phone,
home unit, and shift. Home-unit options come only from the caller's active scopes.
The form sends only `action: create_preceptor`, a stable client-generated
`request_id`, and the form fields to the existing
`/api/portal/unit-preceptor-manage` endpoint.

Rapid duplicate submissions are blocked. A failed attempt retains its request ID
for a safe retry; closing the form or completing a successful submission ends that
intent. Success refreshes the roster and accurately confirms that the canonical
preceptor is active and that the existing Owner/Admin review notification was
generated. No manual-approval requirement is implied.

## Legacy nominations

Existing scoped nomination records appear only when present in a collapsed,
read-only `Legacy nomination history` section. The workspace uses the existing GET
path and has no legacy nomination submission form or nomination POST caller.

## Assignment management

Each active assignment row in the `Current Student` column renders only assignment
display information:

- student name,
- role badge: `Primary`, `Secondary`, or `Coverage`,
- safe unit context when available.

The old `Manage student assignments` label is retired.

The rightmost row kebab uses the shared row-action menu with the accessible name
`Open actions for <Preceptor Name>`. Unit Leaders see only
`Manage Preceptor Assignments`; staff see that plus `Edit Preceptor` and
destructive `Delete Preceptor` when authorized. Selecting the manager action opens
`UnitLeaderPreceptorManager` with the exact row context. The manager supports
Change Primary, Add Secondary, Add Coverage, Replace exact Secondary/Coverage
assignment, and End exact Secondary/Coverage assignment while preserving the Phase
2C idempotency, audit, notification, stale-row, and role validation guarantees.

## Security boundary

The read endpoint verifies an active Unit Leader grant and resolves active unit
scopes before service-role reads. Browser RLS and client-supplied student IDs are
not treated as authorization. Generic staff, interviewer, viewer, or co-lead
status is insufficient.

Unit Leader assignment writes still use only:

```text
POST /api/portal/unit-preceptor-manage
```

Unit Leaders do not receive Edit/Delete preceptor authority, staff endpoints,
historical override controls, or any ability to widen their scoped student set.
Phase 2C authorization, idempotency, audit, notification, completed-rotation,
approved sender, and Reply-To behavior were not changed. No SQL, migration, RPC,
view, or schema change was made.

## Verification

- Targeted navigation, endpoint, roster, creation, and boundary tests: 201 passed,
  0 failed.
- All Unit Leader and preceptor-authorization tests: 519 passed, 0 failed.
- Phase 2B/2C authorization and notification tests: 104 passed, 0 failed.
- Full suite: 2,215 passed, 0 failed, 0 skipped.
- Targeted ESLint: passed with no warnings.
- Client production build: passed; Vite reported only the existing advisory that
  some chunks exceed 500 kB after minification.
- SSR build: passed (11 modules transformed; 36.08 kB output, 8.06 kB gzip).
- `git diff --check`: passed with no whitespace errors.

## Main-app convergence

The main app Preceptor Directory is the canonical visual foundation. Both the
main app and Unit Leader portal use the same shared white table and shared
rightmost row action menu. Staff authority is separate from Unit Leader authority
and uses the Owner/Admin endpoint documented in the assignment-manager handoff.
