# Nursing Academics Portal: Discovery, Architecture, and Migration Plan

Date: 2026-08-24
Status: Design report delivered with the implementation. Nothing committed,
nothing pushed, no SQL applied. The migration in this package waits behind
the Owner SQL gate.

This document records the repository audit, the approved product
requirements as implemented, the architecture, the migration plan with
preflight and rollback, and every live-schema uncertainty that affects this
work.

---

## 1. Audit findings

### 1.1 Repository and working tree

- `main` is the only local branch and matches `origin/main` at `d087c9d`.
- Untracked files preserved and untouched: `.claude/`, `reference/`,
  `src/pages/ActivateAccountPage 2.jsx`, `src/portal/UnitLeaderPortal 2.jsx`,
  `test/portalActivation.test 2.mjs`, and the untracked copy of
  `supabase/migrations/20260821000000_outreach_attachment_uploads.sql`.
  The three `" 2"` files are Finder duplicates and are not imported anywhere.
- A stale note claiming the S-05 deactivation work was unpushed is wrong:
  S-05 landed on `main` as `887c295` and `6caf18d`. The hashes `69105ab` and
  `dba1a86` are pre-rebase reflog objects.

### 1.2 Portal authorization model (current state)

- `user_role_grants` is defined in
  `supabase/migrations/20260712000007_phase2_authz_foundation.sql` with an
  inline, unnamed CHECK: `role IN ('student','unit_leader','academic_partner')`.
  Postgres auto-names it `user_role_grants_role_check`. No later migration
  alters it.
- `has_active_role_grant(p_role)` and `get_my_portal_access()` carry no role
  allowlist. A `nursing_academic` grant flows through both with zero SQL
  changes to those two functions.
- `provision_portal_access` and `revoke_portal_access`
  (`20260712000009_phase2_portal_access_lifecycle.sql`) each hardcode the
  three-role allowlist and per-role scope validation. Both are
  `SECURITY DEFINER`, executable by `service_role` only.
- Three API endpoints carry their own copies of the role list:
  `api/invite-portal-user.js:45`, `api/revoke-portal-access.js:29`,
  `api/list-portal-access.js:23` (plus the `by_role` counter object at
  `list-portal-access.js:282`).
- Client role surfaces: `src/lib/portalAccessStatus.js` (labels, options,
  scope summaries), `src/portal/PortalApp.jsx` (two independent precedence
  chains), `src/components/settings/AccountsDirectory.jsx` (KPI cards and
  counts), `AccountDetailsDrawer.jsx`, `GrantPortalAccessModal.jsx`,
  `lib/server/email/portalInvitation.js` (role invite copy),
  `src/lib/onboardingTours.js`, `src/lib/portalAccessState.js`
  (refusal-reason classifier).
- Portal messaging and feedback constraints are separate enums
  (`chk_portal_feedback_role`, the messages `chk_*_role` family). Per the
  locked requirements, Nursing Academics is NOT added to messaging or
  feedback. Those constraints are deliberately untouched.
- Nine tests assert the exact three-role literals and were updated:
  `invitePortalUserLifecycle`, `revokePortalAccess`, `inviteStaffContactAware`,
  `accountsKpiSort`, `welcomeTourPortalsUi`, `portalActivation`,
  `portalActivationReliability`, `phase2PortalRoleEnablement` (unchanged,
  asserts `user_profiles` not `user_role_grants`), `accountsDirectory`
  (unchanged, asserts no inline lists).

### 1.3 Data model for the calendar and fiscal-year report

- `cohort_school_rotations` (`20260522000000_rotation_dates.sql`):
  `school_name` is TEXT, unique per `(cohort_id, school_name)`, with
  `rotation_start_date`/`rotation_end_date` defaulting to the sentinel
  `1900-01-01` ("pending admin review"). The canonical student-to-rotation
  join is the triple match used by `20260821130000_automatic_student_completion.sql`:
  FK `students.cohort_school_rotation_id` AND `cohort_id` agreement AND
  exact `school_name = students.school` agreement.
- `public.schools` and `students.school_id` are NOT in production
  (confirmed three ways: `docs/product/AP_SCHOOL_CANONICALIZATION.md`,
  `src/lib/schoolIdentity.js`, `api/lib/schoolPlacementUpsert.js`). School
  grouping therefore uses the `students.school` text resolved through
  `src/lib/schoolIdentity.js`.
- `students.program_type` exists in production but in NO tracked SQL: it is
  a dashboard-created text column validated only by the client list
  `PROGRAM_TYPES` in `src/lib/constants.js`.
- `student_shift_logs`: statuses are `'Auto-Accepted'`, `'Pending Review'`,
  `'Approved'`, `'Rejected'`, `'Edited'` (no DB CHECK), with
  `lifecycle_state IN ('completed','in_progress','voided')`. The canonical
  approved-hours formula (repeated verbatim in four RPCs):
  `SUM(total_hours) WHERE lifecycle_state='completed' AND status IN
  ('Auto-Accepted','Approved') AND total_hours IS NOT NULL`.
  `students.approved_hours` is a maintained projection of exactly that
  formula, recomputed in full by the RPCs. `shift_date` is TEXT but
  server-validated `YYYY-MM-DD`.
- Primary preceptor: `student_preceptor_assignments` row with
  `role='primary' AND status='active'` (partial unique index enforces one
  per student per cohort), joined to `preceptors.full_name`. Legacy
  free-text `students.matched_preceptor` is a trigger-maintained mirror and
  is used only as a clearly labeled fallback.
- Multi-unit placements live in `student_unit_assignments`; the report
  counts DISTINCT `students` rows and never joins through unit assignments,
  so multi-unit students cannot double-count.
- There is no fiscal-year logic anywhere in the repo (grep: zero matches).
  This package introduces it.

### 1.4 Placement workflow (course_type insertion points)

- One canonical form module: `src/lib/schoolPlacementForm.js` (text, row
  factory, validation, `buildPlacementBody` whitelist), consumed by the
  public `SchoolFormPage.jsx` and the Academic Partner
  `PlacementRequestsView.jsx`.
- One shared server upsert: `api/lib/schoolPlacementUpsert.js`. A placement
  request IS a `students` row; there is no separate request table and no
  staff conversion step.
- No course/subject column exists anywhere. `course_type` is added as a new
  `students` text column following the `program_type` pattern (client enum
  list + server length validation, no DB CHECK so historical rows stay
  legal), threaded through the shared module, both forms, the upsert, the
  staff student editor (`student-update.js` allowlist + StudentSidePanel),
  and the SchoolResponseDrawer.

### 1.5 Server and test conventions adopted

- New portal endpoints follow the `api/portal/unit-evaluations.js` template:
  DI factory (`createXHandler({deps})` + default export), `Cache-Control:
  no-store, private`, OPTIONS then method gate, shared verifier, strict
  output allowlist, `{ error: 'snake_case_reason' }` bodies, no CORS.
- Owner authority is the `is_owner` capability via `lib/server/access.js`
  (`CAPABILITIES` with an empty role list = Owner-only by construction).
  Rate and capstone writes gate on a new `community_benefit_admin: []`
  capability. Never `role === 'owner'`.
- Every new refusal reason must be classified in
  `src/lib/portalAccessState.js` or `portalAccessRevokedMidSession.test.mjs`
  fails. The new reason is `nursing_academic_role_required`.
- Tests: `node --test`, flat `test/*.test.mjs`, DI stubs (no source-rewrite
  harness needed because all new endpoints export factories),
  `/* global process */` in server files (browser-globals ESLint config).
- `npm run build` locally inlines empty `VITE_*` strings from `.env.local`;
  a green `npx vite build` is the local verification signal, and the
  prerender step needs shell env vars. Environmental, not a product defect.

---

## 2. Architecture

### 2.1 Authorization

- Fourth portal role key: `nursing_academic`. Grants live in
  `user_role_grants` exactly like the other three; `user_profiles.role`
  stays `'portal'`; NO scope rows of any kind (no student links, no unit
  scopes, no school scopes). Organization-wide read is the role itself.
- Every data request passes `verifyPortalNursingAcademicCaller(req)`
  (`api/lib/nursingAcademicScope.js`): bearer JWT verified via
  `verifyPortalCaller` (which enforces the active-profile S-05 check), then
  `has_active_role_grant`-equivalent lookup on `user_role_grants` via the
  service client. Refusal: 403 `nursing_academic_role_required`.
- View-only: the portal has zero write endpoints. The only writes in this
  package (rates, capstone hours, course-type corrections) live on
  staff-app endpoints and are Owner-gated server-side.

### 2.2 Routes and navigation

- `/portal/academics/calendar` and `/portal/academics/community-benefit`,
  parsed in `PortalApp.jsx` like the `unit`/`ap` namespaces.
- Precedence: student, then unit_leader, then academic_partner, then
  nursing_academic (appended last so existing users see no change).
- New experience directory `src/portal/na/` with its own `.ptl-na-*` CSS
  namespace (per the portal rule: never share a ptl-* class between
  components). PortalShell with `headerVariant="nightfall"`, the shared
  GreetingMasthead, and a two-item nav.
- Feedback and messages panels are NOT rendered for this experience
  (their DB constraints intentionally exclude the role).

### 2.3 Academic Calendar

- Data: dedicated endpoint `api/portal/academics-calendar.js` returning
  allowlisted rotation windows (school, cohort name and id, structured
  dates, per-rotation student counts and program mix). Dates come only from
  `cohort_school_rotations`; `students.term_dates` is never read.
- Presentation: timeline-first (one school rotation per row, spanning
  bars across a month-window axis) built inside
  `CanonicalCalendarLayout` + `CanonicalCalendarNav` +
  `CanonicalCalendarMonthTitle`, with a month-grid alternative using
  `CanonicalWeekdayHeader`/`CanonicalMonthCell`. No calendar library is
  imported; the shared foundation covers the shell and the month grid, and
  the timeline body is ~200 lines of app code with zero bundle impact
  beyond itself.
- School colors: deterministic palette assignment via the canonical school
  identity (`schoolIdentity.js` group key), so a school keeps one color on
  every render, filter state, and legend.
- Filters: fiscal year, cohort (chronological ordering via
  `orderCohortsByTimeline`), school, program.
- Sentinel and missing dates are surfaced in a "Needs dates" data-quality
  strip, never silently omitted and never plotted as 1900.

### 2.4 Community Benefit report

- Fiscal year runs July 1 to June 30, labeled by ending year (FY 2027 =
  2026-07-01 through 2027-06-30). The whole rotation is assigned to the FY
  containing the triple-matched rotation's `rotation_end_date`. No
  proration.
- All computation is server-side in `lib/server/communityBenefit/compute.js`
  (pure, unit-tested) invoked by `api/portal/academics-community-benefit.js`:
  - Students included: `students` rows with status `Placed`,
    `Active Rotation`, or `Completed` (ASPIRE placements), counted DISTINCT
    by student id. `Not Proceeding` and legacy `Declined` rows are included
    only when authoritative approved actual hours are greater than zero;
    zero-hour exits do not contribute to the report.
  - Required hours: `students.hours_required`.
  - Approved actual hours: authoritative recomputation from
    `student_shift_logs` using the canonical formula
    (`lifecycle_state='completed' AND status IN ('Auto-Accepted','Approved')`).
    The `students.approved_hours` projection is cross-checked; any mismatch
    is flagged per student in a reconciliation note instead of silently
    trusting either number. Hours beyond the requirement count in full.
  - Pending Review, in-progress, rejected, and voided hours are never counted.
    Students who have rejected or voided hours are surfaced in a
    "Records for review" panel (hours that existed and then changed status
    do not silently vanish from view).
  - Standard benefit: approved actual hours x active `rn_preceptor` rate
    for the FY. Capstone benefit: owner-entered aggregate capstone hours x
    active `management` rate. Capstone hours are stored per
    FY + school (+ optional cohort), never allocated to students, never
    combined with shift logs. A missing rate renders an explicit "rate not
    set" state; no benefit number is invented.
  - Rotations with missing or sentinel `rotation_end_date` (or no
    triple-matched rotation at all) land in a "Needs reporting data" panel
    and are excluded from FY totals until corrected.
- Portal detail table columns are exactly the allowlisted set from the
  requirements (student, school, program, course type, cohort, rotation
  dates, required hours, approved hours, primary preceptor name, benefit
  category, estimated benefit) via the dedicated endpoint's response
  allowlist. No staff endpoint is reused.
- CSV: `api/portal/academics-benefit-export.js` streams a server-built
  aggregate CSV, one row per FY + school + program + course type + benefit
  category, with the recommended columns. It contains no names, emails,
  phones, database identifiers, shift rows, or narrative text; the
  aggregation happens server-side from the same compute module, never by
  hiding columns client-side.

### 2.5 Rates and manual capstone hours (Owner-only)

- Two append-only tables (see migration): `community_benefit_rates`
  (versioned by `superseded_at`; one active rate per FY + category) and
  `community_benefit_capstone_hours` (voidable, never deleted). Both record
  who and when, enforce nonnegative values and coherent FY identifiers, and
  are RLS-locked to service-role access only.
- One staff endpoint, `api/community-benefit-admin.js` (house `{action}`
  multiplex): `list`, `set_rate`, `add_capstone`, `void_capstone`. Every
  write requires `can(caller, 'community_benefit_admin')` where the
  capability's allowlist is empty, i.e. Owner-only by construction; reads
  are admin-level for visibility. The Settings panel
  (`CommunityBenefitPanel.jsx`) shows the capstone double-count warning
  next to the entry field, uses the canonical ASPIRE school list, and renders
  read-only for non-Owner staff (the server is the enforcement). Rate
  supersession and replacement run through one database function so the old
  active rate is restored automatically if the replacement cannot be saved.
- Course-type corrections for historical students ride the existing
  Owner/Admin `api/student-update.js` allowlist plus the StudentSidePanel
  select; unclassified history renders "Unclassified" everywhere and is
  never inferred or invented.

### 2.6 Access lifecycle surfaces updated

`invite-portal-user` (no scope requirement branch), `revoke-portal-access`,
`list-portal-access` (`by_role.nursing_academic`), `provision_portal_access`
and `revoke_portal_access` (migration), `PORTAL_ROLE_LABELS`/`OPTIONS`/
`summarizeScope` ("ASPIRE-wide"), AccountsDirectory KPI card, drawer scope
details and revoke body, GrantPortalAccessModal validation (no pickers, the
role is valid with no scopes), invitation email `ROLE_COPY`, onboarding
tour registration, `portalAccessState` refusal classification, PortalApp
routing/precedence, and the literal-asserting tests. Messaging, feedback,
and conversation constraints are intentionally not widened.

---

## 3. Migration plan

One additive migration:
`supabase/migrations/20260824000000_nursing_academics_portal_foundation.sql`

It performs, in a single transaction:

1. Widen `user_role_grants_role_check` to the four-role list
   (drop by verified name, re-add named).
2. `CREATE OR REPLACE` `provision_portal_access` and
   `revoke_portal_access` with `nursing_academic` in the allowlists.
   `nursing_academic` requires and writes NO scope rows; revocation
   cascades nothing beyond the grant. Signatures are unchanged, so the
   existing service-role grants survive `CREATE OR REPLACE` untouched.
3. Create `community_benefit_rates` and `community_benefit_capstone_hours`
   with the constraints above, RLS enabled, all client-role privileges
   revoked (service-role endpoints are the only path).
4. `ALTER TABLE students ADD COLUMN IF NOT EXISTS course_type text`
   (nullable, no CHECK, matching the production reality of `program_type`;
   values validated server-side against `COURSE_TYPES`).

The migration file contains preflight queries (verify the live constraint
name, verify the live function signatures, verify `schools` absence, verify
target tables do not already exist), post-apply verification queries, and a
rollback section. It is NOT applied by this work; it joins the Owner SQL
gate. Until it is applied, inviting a `nursing_academic` user fails closed
(the live `provision_portal_access` raises `PT400 unsupported portal role`),
and the portal endpoints return 403 to everyone because no grant can exist.
Nothing rewrites historical data.

### Live-schema uncertainties (verify in preflight before applying)

1. The exact live name of the `user_role_grants` role CHECK. The repo
   defines it inline (auto-name `user_role_grants_role_check`); the
   preflight SELECT confirms before the DROP.
2. The live bodies of `provision_portal_access`/`revoke_portal_access` may
   have drifted from the repo (the gate doc is internally inconsistent
   about what is applied). The preflight dumps
   `pg_get_functiondef` for comparison; the migration replaces the whole
   body, so drift is absorbed, but review the dump first.
3. `docs/security/OWNER_SQL_GATE.md` says `20260712000007` (authz
   foundation) is "pending" while the portal demonstrably runs on those
   tables in production; the doc's prose is stale. The preflight confirms
   `user_role_grants` exists rather than trusting either statement.
4. `students.program_type` and several live columns exist in no tracked
   SQL; `course_type` is added with `IF NOT EXISTS` and no CHECK for the
   same reason.
5. `student_unit_assignments`, `shift_log_review`, and self-service
   migrations carry "applied nothing" headers; the report intentionally
   depends only on `student_shift_logs` columns from the older, live
   lifecycle migrations (statuses + `lifecycle_state`), and treats
   `lifecycle_state` absence defensively (a missing column would surface
   as an endpoint error, not silent wrong numbers).

---

## 4. Decisions taken (and what remains open)

- COURSE_TYPES draft list (open for Jester to edit before the form ships
  to schools): Medical-Surgical, Critical Care, Pediatrics,
  Maternal-Newborn, Psychiatric-Mental Health, Community/Public Health,
  Leadership/Management, Capstone/Preceptorship, Other. Stored verbatim;
  historical rows stay NULL and render "Unclassified".
- Student inclusion statuses for the FY report: Placed, Active Rotation,
  Completed. Not Proceeding and legacy Declined are included only when they
  have approved actual hours; their zero-hour rows and all pre-placement
  statuses are out.
- Capstone rows in the CSV carry Benefit Category "Management",
  Preceptor Type "Management", program and course type as "-", and a
  student count of 0 (they are school-level aggregates by design).
- The portal shows estimated benefit only when an active rate exists for
  the FY and category; otherwise the UI shows "Rate not set" and the CSV
  leaves Applied Hourly Rate and Estimated Nursing Benefit blank.
- Wage rates and capstone hours: Owner-only writes enforced through the
  `community_benefit_admin` capability (empty allowlist) in
  `lib/server/access.js`, in addition to the UI being read-only for
  non-Owner staff.
