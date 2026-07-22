# Unit Leader Preceptors Workspace Handoff

## Delivered behavior

The Unit Leader portal now exposes `Preceptors` at `/portal/unit/preceptors`.
Desktop navigation is `Home | Preceptors | Messages | Evaluations | Placement Requests | Capacity`.
At the existing 760px mobile breakpoint, the bottom navigation is
`Home | Preceptors | Messages | More`; More contains Evaluations, Placement
Requests, and Capacity. Profile and notification preferences remain in the avatar
menu, and `/portal/unit/students` remains available as a deep link without a
permanent navigation item.

The workspace provides a responsive, read-only roster with search, selected-unit
association, shift, status, cross-unit, and sorting controls. It defaults to active
preceptors. Loading, retryable error, no-associated-preceptor, and no-filter-result
states use the shared portal patterns.

## Authorized read model

`GET /api/portal/unit-preceptors` returns:

- `roster`: safe preceptor directory fields, active assignment count, a cross-unit
  association flag, and active assignments limited to server-authorized students.
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

`Add preceptor` opens a portal-specific form for full name, email, optional phone,
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

## Security boundary

The read endpoint verifies an active Unit Leader grant and resolves active unit
scopes before service-role reads. Browser RLS and client-supplied student IDs are
not treated as authorization. Safe candidate fields do not include assignment
details. Generic staff, interviewer, viewer, or co-lead status is insufficient.

The only new Unit Leader write is `create_preceptor`. Primary, Secondary,
Coverage, Replace, End, and Manage assignment controls remain disabled, and the
Unit Leader frontend has no assignment-mutation caller. Phase 2C authorization,
idempotency, audit, notification, completed-rotation, approved sender, and Reply-To
behavior were not changed. No SQL, migration, RPC, view, or schema change was
made.

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

## Remaining work

A later, separately authorized pass can build the shared assignment manager using
the safe `candidates` collection and the existing Phase 2C backend. That work must
design and test the Primary, Secondary, Coverage, Replace, End, and completed-
rotation interactions without weakening server-side scope resolution,
idempotency, audit, or notification guarantees. None of those controls is enabled
in this release.
