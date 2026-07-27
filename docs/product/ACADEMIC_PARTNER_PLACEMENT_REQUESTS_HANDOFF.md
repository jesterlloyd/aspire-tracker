# Academic Partner Placement Requests, Phase 1 Handoff

The authenticated Academic Partner Placement Requests workflow: the portal counterpart of the public
`/school-form`, sharing one canonical form definition and one server write path. Branch:
`ap-placement-requests-phase-1`, off `main` at `e233980`.

**Submission is code-complete and fail-closed on a runtime readiness gate.** It requires one approved
migration (three latest-submission provenance columns). Until the Owner applies it, the server returns
`submission_not_enabled` and the workspace disables its submit control; the moment the columns exist,
the SAME code path enables submission with no redeploy (readiness is detected at runtime). The exact
migration, verification, enablement sequence, and live QC checklist are in "Provenance and the
readiness gate" below. No SQL was run and no migration was applied by this work.

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

## Provenance model (approved)

The ORIGINAL source stays in `students.submitted_via` (set once on a new row, preserved on updates;
never overwritten or reinterpreted). The LATEST placement submission is recorded in three new
columns, refreshed on every successful insert AND every duplicate-safe update:

- `placement_request_last_source` (`school_form` | `academic_partner_portal`)
- `placement_request_last_submitted_by_profile_id` (uuid; the verified submitting profile, or NULL)
- `placement_request_last_submitted_at` (timestamptz; server-generated)

Public `/school-form` writes source `school_form` with a NULL profile id. The authenticated portal
writes source `academic_partner_portal` with the verified caller `user_profiles.id`. All three values
are chosen SERVER-SIDE (`api/portal/school-placement-requests.js` for the portal,
`api/school-form-submit.js` for the public form); nothing is taken from the browser payload. The
authorized school and server-selected cohort remain recorded via the existing `school` / `school_id`
and `cohort_id` columns. A full append-only submission-history model remains deferred.

### Exact migration filename

`supabase/migrations/20260727000000_add_academic_partner_placement_provenance.sql`

### Exact SQL to apply (whole file, one block, Supabase SQL editor)

```sql
BEGIN;

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS placement_request_last_source text,
  ADD COLUMN IF NOT EXISTS placement_request_last_submitted_by_profile_id uuid
    REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS placement_request_last_submitted_at timestamptz;

ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS chk_students_placement_request_last_source;
ALTER TABLE public.students
  ADD CONSTRAINT chk_students_placement_request_last_source CHECK (
    placement_request_last_source IS NULL
    OR placement_request_last_source IN ('school_form', 'academic_partner_portal')
  );

COMMIT;
```

### Verification query (run after applying)

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'students'
  AND column_name LIKE 'placement_request_last_%'
ORDER BY column_name;
-- expect 3 rows (text, uuid, timestamptz), all nullable YES.

SELECT count(*) AS total, count(placement_request_last_source) AS with_source
FROM public.students;
-- expect with_source = 0 immediately after applying (no backfill).
```

### Expected null behavior for old rows

No backfill. Every existing row keeps NULL in all three columns until its next successful placement
submission (public or authenticated) refreshes them. This is expected and correct.

### Password POST enforcement

The final authenticated POST does NOT trust the client-side gate. On every submission it independently:
re-authorizes the submitted school + cohort against the caller's active `user_school_scopes`
(`matchSchoolCohortScope`, exact-term, WCU campuses isolated); re-derives and re-validates the cohort
server-side (exists + accepting); determines the cohort's password requirement via
`school_form_requires_password`; and, when required, verifies the entered password via
`verify_school_form_password`, rejecting missing (`password_required`) or wrong (`password_invalid`)
before any write. The RPCs are called through a caller-JWT client (role `authenticated`), never the
service role. The password is transient (verified, then dropped): never logged, echoed, persisted, or
copied into a write payload. Per-IP rate limiting is deferred: the only shared limiter is
evaluation-namespaced and DB-RPC-backed, and the caller is already JWT + active-role + school-scope
gated; the canonical RPC protection is preserved.

### Migration-readiness mechanism

`isPlacementProvenanceReady(db)` (in `api/lib/schoolPlacementUpsert.js`) probes the three columns at
runtime. The POST fails closed (`503 submission_not_enabled` / `provenance_pending_migration`) until
they exist; the GET list returns a `submission_enabled` hint for the UI, but the POST gates
independently and never trusts client state. There is no permanent false flag: applying the migration
flips readiness at runtime, so the SAME code path enables submission with no redeploy.

### Enablement sequence

1. Apply the migration file via the Owner SQL gate (`docs/security/OWNER_SQL_GATE.md`); run the
   verification query above.
2. PostgREST reloads its schema automatically (usually seconds); the readiness probe then passes.
3. No code deploy: the authenticated POST enables itself, and the workspace submit control enables
   from the server's `submission_enabled` signal. Public `/school-form` also begins recording the
   latest-submission provenance from that point.
4. Run the live QC checklist below.

### Rollback considerations

Reversible with no data loss beyond the latest-submission provenance (`submitted_via` untouched):

```sql
ALTER TABLE public.students DROP CONSTRAINT IF EXISTS chk_students_placement_request_last_source;
ALTER TABLE public.students
  DROP COLUMN IF EXISTS placement_request_last_source,
  DROP COLUMN IF EXISTS placement_request_last_submitted_by_profile_id,
  DROP COLUMN IF EXISTS placement_request_last_submitted_at;
```

After a rollback the readiness probe returns false again and submission fail-closes; no other behavior
regresses.

### Live QC checklist (after applying the migration)

1. Academic Partner portal, Placement Requests, New Placement Request: the submit control is enabled
   (no pending banner). Submit a one-student request for your authorized school.
2. Confirm the added/updated/skipped confirmation, and that the new request appears in the list after
   the automatic refresh.
3. Main App, At a Glance, Placement Requests: the student appears under the correct school/cohort.
4. Row check:
   `SELECT submitted_via, placement_request_last_source, placement_request_last_submitted_by_profile_id, placement_request_last_submitted_at`
   `FROM public.students WHERE school_email = '<the test email>';`
   expect `submitted_via = 'academic_partner_portal'`, `placement_request_last_source = 'academic_partner_portal'`,
   the submitting profile id populated, and a recent timestamp.
5. Password: for a password-required cohort, a wrong password is rejected before any row is written; a
   correct one succeeds. Confirm the password appears in no server log.
6. Public `/school-form`: submit as before; the student is created and
   `placement_request_last_source = 'school_form'` with a NULL profile id.
7. Duplicate: re-submit the same student email; only coordinator-owned fields update, `submitted_via`
   is unchanged, and the three `placement_request_last_*` columns refresh.

## Not implemented in Phase 1 (explicit)

Drafts, unrestricted editing, withdrawal, Request a Change, Under Review locking, full audit-history
UI, Unit Leader internal comments, and Academic Partner-to-student messaging are NOT implemented, by
design.

## Tests

- `test/schoolPlacementFormConvergence.test.mjs`: shared form rules (validation, soft warnings,
  payload, labels) and the public/portal do-not-drift guard.
- `test/schoolPlacementUpsert.test.mjs`: the shared write helper (mock db) - insert defaults, the
  latest-submission provenance on insert and duplicate-safe update, `submitted_via` preservation, the
  not-ready path omitting the columns, skip-incomplete, public-endpoint delegation, and
  `isPlacementProvenanceReady`.
- `test/academicPartnerPlacementPassword.test.mjs`: `matchSchoolCohortScope` (school/cohort
  authorization + WCU isolation) plus the endpoint's independent server-side password verification
  chain and password hygiene (never logged/echoed/persisted, caller-JWT RPC).
- `test/academicPartnerPlacementProvenance.test.mjs`: server-selected provenance (browser value
  ignored), readiness ordering (no partial write when not ready), Main-App At-a-Glance visibility
  fields (school + cohort_id + status), and the public `/school-form` regression.
- `test/academicPartnerPlacementRequests.test.mjs`: the workspace + list endpoint - read-only list,
  status pill/legend, refresh, cohort + server-verified password flow, locked school, the
  server-gated submit (enabled from `submission_enabled`), the readiness gate + shared-write
  delegation, and the absence of drafts/edit/withdraw/Request-a-Change/audit controls.
- `test/academicPartnerPrivateFieldExclusion.test.mjs`: shared authorization across roster/photo/
  placement, the public-safe allowlist and confidential denylist, the readiness gate, and WCU campus
  isolation.
- `test/academicPartnerShell.test.mjs`: the Placement Requests section routes to the workspace;
  Messages stays a prepared state.

## Baseline lint (pre-existing, unchanged)

`api/school-form-submit.js` gained a `/* global process */` pragma during its refactor (matching the
repo convention), so it is lint-clean. No new lint was introduced.
