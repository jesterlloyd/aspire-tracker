# Academic Partner Placement Requests, Phase 1 Handoff

The authenticated Academic Partner Placement Requests workflow: the portal counterpart of the public
`/school-form`, sharing one canonical form definition and one server write path. Branch:
`ap-placement-requests-phase-1`, off `main` at `e233980`. No SQL, no migrations were added.

**Submission is intentionally not enabled.** Recording the authenticated submitting profile requires
a `students` column that does not exist yet. Per the approved provenance rule, the workflow stops
before enabling the final submit rather than omit that identity silently. The exact migration is in
"Provenance and the SQL gate" below; everything else is built and live.

## Shared form modules (no drift)

Mirrors the `/unit-form` <-> Capacity convergence.

- `src/lib/schoolPlacementForm.js` (client): the canonical copy (`SCHOOL_PLACEMENT_TEXT`), empty-state
  factories, `validatePlacementForm` (scoped error), `collectPlacementSoftWarnings` (pure; today
  passed in), `buildPlacementBody`, `placementSubmitLabel`, `MIN_HOURS_REQUIRED = 90`. Re-exports
  `PROGRAM_TYPES` / `SCHOOLS` / `WEEKDAYS`. Both `src/components/SchoolFormPage.jsx` (public) and
  `src/portal/ap/PlacementRequestsView.jsx` (portal) render labels and validate from this module.
- `api/lib/schoolPlacementUpsert.js` (server): `performSchoolPlacementUpsert(db, params)`, the
  canonical write used by the public endpoint and (once unblocked) the authenticated endpoint. The
  public `api/school-form-submit.js` was refactored onto it; behavior is unchanged.

## Password-gate behavior

Reuses the public form's exact behavior and RPCs, verified before the form is shown:

1. Open a new request. The accepting cohort is resolved via `supabase.from('cohorts').eq('accepting_submissions', true)`.
2. `supabase.rpc('school_form_requires_password', { p_cohort_id })` decides whether a password is needed.
3. When required, the coordinator enters the cohort password; `supabase.rpc('verify_school_form_password', { p_cohort_id, p_entered_password })` verifies it (the DB function is the server-side check).
4. The form renders only after a successful verification.

The password is kept only in transient client state during entry; it is never stored, never logged,
and never sent to the placement endpoint. There is no bypass: the form view is gated behind the
verified state, and (once enabled) the submit endpoint re-verifies server-side before any write.

## Authorization chain

Identical to the roster and photo endpoints, via `api/lib/schoolScope.js`:

`verifyPortalAcademicPartnerCaller(req)` -> verified JWT -> ACTIVE `academic_partner` role grant ->
ACTIVE `user_school_scopes` -> `resolveSchoolScopedStudents(db, scopes, columns)` (EXACT normalized
term membership). Fails closed: unauthenticated -> 401, non-partner -> 403, empty scope -> empty list.
No request parameter (`req.query` / `req.body` / `req.params`) ever influences scope, and the school
is always derived server-side, never trusted from the browser. WCU Anaheim and North Hollywood stay
isolated because the shared resolver uses exact-term membership, not substring matching.

## Request-list fields and the security allowlist

`GET /api/portal/school-placement-requests` returns, grouped by authorized school, an explicit
allowlist per request: student name, cohort, ASPIRE status, requested rotation dates (from the
coordinator-owned `cohort_school_rotations` row), confirmed unit (reliable `matched_unit_id ->
units.unit_name`), primary preceptor, approved/pending hours, and the submission timestamp
(`created_at`).

It never exposes: internal notes, Unit Leader comments (`unit_comment` / `unit_response`), evaluation
content or interview scores/recommendations, rubric, NGRP disposition, review reasons, exception
flags, compliance/health fields, `changes_requested` / Needs Clarification, or another school's
students. A future ASPIRE-staff-facing partner clarification flag would be required before any
clarification state is shown to a partner.

## Write path into Main App "At a Glance"

A placement request IS a `students` row; there is no separate request table. The shared write helper
upserts one `cohort_school_rotations` row per (cohort, school) and inserts/updates the `students`
rows linked by `cohort_school_rotation_id`. "At a Glance -> Placement Requests" (`OverviewTab.jsx`)
groups the cohort's `students` by `school`, so a written request appears there automatically with no
extra wiring. `program_events` logs one `rotation_created` event for the first new student, and the
public endpoint fires `form-received` notifications for new students (unchanged).

## Duplicate behavior

Duplicate detection is by NORMALIZED `school_email` (case / whitespace / zero-width insensitive)
within the cohort. On a match, ONLY coordinator-owned seed fields are updated (name, school,
program_type, hours_required, estimated graduation, coordinator name/email/notes, aspire_cohort,
rotation link). Student-owned fields (phone, personal_email, resume/headshot, interest statement,
unit preferences) and ASPIRE/admin-owned fields (status, interview_outcome, ngrp_outcome,
disposition, matched_unit_id, preceptor_id, CS-Link/badge, notes) are NEVER overwritten. An existing
`submitted_via` is preserved (a `student_form` record is never relabeled). Duplicate emails within a
single submission update in place rather than re-inserting. The response reports added / updated /
skipped counts.

## Provenance and the SQL gate

Approved provenance to record on a placement request: `submission_source = academic_partner_portal`,
the authenticated submitting profile, the authorized school, the server-selected cohort, and a server
timestamp. Using existing columns we can already record:

- origin: `students.submitted_via = 'academic_partner_portal'` (free TEXT, no CHECK; the shared
  helper already parameterizes this via `submittedVia`),
- authorized school: `students.school` / `students.school_id`,
- server-selected cohort: `students.cohort_id`,
- timestamp: `students.created_at`.

**Missing:** there is no column to record WHICH authenticated profile submitted the request.
`students` has no `submitting_profile_id` / `submitted_by` / `created_by uuid`. The smallest migration
that closes the gap (Owner SQL gate; not written or run here):

```sql
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS submitting_profile_id uuid REFERENCES public.user_profiles(id);
```

Optionally, a dedicated `submission_source text` column if product prefers a semantically distinct
field over overloading `submitted_via`; it is not required (the free-text `submitted_via` carries the
origin today).

Until `submitting_profile_id` exists, `POST /api/portal/school-placement-requests` fails closed with
`503 { error: 'submission_not_enabled', reason: 'provenance_pending_migration' }` after the auth
chain, performing no write, and the workspace disables its submit control with a truthful banner.

### Enabling submission after the migration (follow-up, not in this branch)

1. Apply the migration above via the Owner SQL gate.
2. In `api/portal/school-placement-requests.js`, replace the POST gate with: re-derive/validate the
   school (in scope) and cohort (accepting) server-side; re-verify the cohort password via
   `verify_school_form_password` when required; call `performSchoolPlacementUpsert(db, { ...,
   submittedVia: 'academic_partner_portal' })`; and write `submitting_profile_id = auth.profile.id`
   (extend the helper with an optional `submittingProfileId` that it only writes when provided).
3. Wire the workspace submit button to `submitSchoolPlacementRequest` (already in the AP client) and
   remove the disabled/pending banner.

## Not implemented in Phase 1 (explicit)

Drafts, unrestricted editing, withdrawal, Request a Change, Under Review locking, full audit-history
UI, Unit Leader internal comments, and Academic Partner-to-student messaging are NOT implemented, by
design.

## Tests

- `test/schoolPlacementFormConvergence.test.mjs`: shared form rules (validation, soft warnings,
  payload, labels) and the public/portal do-not-drift guard.
- `test/schoolPlacementUpsert.test.mjs`: the shared write helper (mock db) - insert defaults,
  coordinator-owned-only updates, `submitted_via` provenance, skip-incomplete, public-endpoint delegation.
- `test/academicPartnerPlacementRequests.test.mjs`: the workspace + list endpoint - read-only list,
  status pill/legend, refresh, cohort + server-verified password flow, locked school, gated submit,
  and the absence of drafts/edit/withdraw/Request-a-Change/audit controls.
- `test/academicPartnerPrivateFieldExclusion.test.mjs`: shared authorization across roster/photo/
  placement, the public-safe allowlist and confidential denylist, the fail-closed POST gate, and WCU
  campus isolation.
- `test/academicPartnerShell.test.mjs`: the Placement Requests section now routes to the workspace;
  Messages stays a prepared state.

## Baseline lint (pre-existing, unchanged)

`api/school-form-submit.js` gained a `/* global process */` pragma during its refactor (matching the
repo convention), so it is lint-clean. No new lint was introduced.
