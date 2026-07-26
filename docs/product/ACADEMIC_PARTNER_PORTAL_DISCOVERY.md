# Academic Partner Portal: Discovery and Architecture Blueprint

Status: discovery and documentation only. No portal UI, API, SQL, migration, RLS, route,
or write workflow was implemented in this pass. Baseline commit: `3ab79cf` (clean `main`).
Branch: `academic-partner-portal-discovery`.

This document is the evidence base and implementation blueprint for the Academic Partner
Portal. All findings are traced to exact files, functions, tables, and migrations. Where a
capability does not exist yet, that is stated plainly rather than assumed.

---

## 1. Executive summary

The Academic Partner (AP) foundation is further along than a greenfield build. The role, a
school-scope mapping, a normalized schools table, and a live school-scoped roster endpoint
already exist and are deployed, following the same server-authorized pattern as the Unit
Leader (UL) portal. The blueprint is therefore mostly convergence and targeted extension,
not new architecture.

Headline findings:

1. **The AP portal already exists** and is not a placeholder. `src/portal/AcademicPartnerPortal.jsx`
   is a working, flat, table-only school roster that reads `GET /api/portal/school-students`.
   It has no tabs, no masthead, no drawer, no On Campus Now, no Messages, and no Placement
   Requests today.
2. **Identity and school scoping are built.** `user_role_grants.role` already permits
   `academic_partner`; `user_school_scopes` maps a user to one or more schools (with optional
   cohort); `get_my_portal_access()` already returns `school_keys`; a seeded `schools` table
   exists. School scope is derived server-side from DB mappings, never from request params.
3. **No new RLS is required for the base roster.** Portal reads use a service-role client
   behind a JWT-verified, server-side allowlist (not RLS-under-caller). New SQL is required
   only to expose data the current endpoint deliberately omits (shift history, onboarding,
   certificate, program, photo, preferences) and to add any AP-authored write path.
4. **Placement Requests has a clean, proven convergence path.** The public `/school-form`
   writes into the `students` table (there is no separate placement-request table for schools;
   the `students` row is the request), which the staff "At a Glance -> Placement Requests"
   panel groups by school. The authenticated AP tab should be a JWT-verified sibling of
   `api/school-form-submit.js` that derives school and cohort from scope. The exact model to
   copy is the `/unit-form` to UL Capacity convergence.
5. **Two real blockers exist for full parity:** Messages rejects `academic_partner`
   server-side (`api/lib/messagesAuth.js`), and `PortalUtilityLayer` returns null for any
   non-student, non-UL portal. Both are small, well-scoped changes.
6. **The Students landing workspace can be built now** on the existing endpoint plus the
   reusable shell, masthead, on-campus card, identity hero, and state primitives. On Campus
   Now, the AP student drawer, and Needs Attention require new school-scoped read endpoints
   that inherit the UL allowlist and file-boolean patterns.

Will SQL/RLS be required? **Yes, but modestly and in known places:** new school-scoped read
endpoints reuse the existing service-role + allowlist pattern (no new RLS), while an
AP-authored placement-request write path, a per-student AP detail read, and any newly exposed
fields need new SECURITY DEFINER functions or endpoint allowlists and an Owner SQL gate review.
No RLS rewrite is anticipated.

---

## 2. Approved product decisions (treated as settled)

- **Three top-level tabs:** `Students`, `Placement Requests`, `Messages`. No separate Home tab.
- **Students is the default landing workspace** and will contain: the shared greeting/weather
  masthead, school-scoped summary counts acting as roster filters, a prominent On Campus Now
  section, a Needs Attention section, the full school-scoped roster, an AP-safe student profile
  drawer, and Hours and Shifts inside that drawer.
- **Placement Requests** is the authenticated AP counterpart of `/school-form`; it must reuse
  the same questions, validation, conditional logic, and underlying workflow, and submissions
  must appear in Main App -> At a Glance -> Placement Requests. No second placement-request
  system.
- **Messages** is a dedicated top-level tab on the shared portal messaging foundation. No
  Messages card on the Students landing workspace.
- **Later phase:** NGRP analytics and outcomes may become a future `Reports` tab. Not in the
  first release.

---

## 3. Current-state inventory

### 3.1 Routing, role resolution, guards

- `/portal` mounts `src/portal/PortalApp.jsx`. It calls the SECURITY DEFINER RPC
  `get_my_portal_access()` once and normalizes the result into
  `access = { roles, student_ids, unit_keys, school_keys }` (`PortalApp.jsx:117-122`).
  `school_keys` is already present, so AP scope is available to the router with no new plumbing.
- Role branches, first match wins: `student` (`PortalApp.jsx:144`), `unit_leader` (`:191`),
  `academic_partner` (`:226`), else `BeingPrepared` (`:234`).
- Security contract (`PortalApp.jsx:1-20`): URLs never grant access; every read is authorized
  server-side; a missing or empty RPC result yields `BeingPrepared`, never an error.
- There is **no AP URL-section parser** today (contrast `unitViewFromPath`, `PortalApp.jsx:61-66`).
  An AP portal with sections needs one (for example `/portal/ap/<section>`).
- The AP branch renders the **bare** shell today: `<PortalShell title="Academic Partner Portal"
  userName=...><AcademicPartnerPortal /></PortalShell>` (`PortalApp.jsx:226-232`). No `nav`,
  no `utilityLayer`, no `withTabBar`, no `headerVariant="nightfall"`, no `logoSrc`,
  no `profileImageUrl`. So AP currently gets the light header and no tabs or floating utilities.

### 3.2 The existing AP component and endpoint

- `src/portal/AcademicPartnerPortal.jsx` (about 170 lines): reads roster from
  `GET /api/portal/school-students` (JWT bearer) and released reports from the scoped view
  `portal_my_school_reports`. Writes nothing. Renders one `SchoolSection` per school with a
  summary chip row, a Students table (Student, Stage, Cohort, Unit, Preceptor, Rotation, Hours,
  Evaluations), and a released-reports list. Hand-rolls its own loading and error states rather
  than using the shared state primitives (an inconsistency to fix on the rebuild).
- `api/portal/school-students.js`: the only AP data endpoint. Chain is `verifyPortalCaller`
  (JWT -> profile) -> `hasActiveRoleGrant(db, profile.id, 'academic_partner')` (`:51`) -> active
  `user_school_scopes` (`:54-66`) -> alias-match `students.school` against the caller scope
  (`:69-90`). Documented privacy posture at `school-students.js:12-18`: stage, placement,
  rotation dates, hours, and completion status only; no scores, no rubric or evaluation content,
  no shift narratives, no support requests, no disposition reasons, no compliance flags.

### 3.3 Where the AP role is already wired

- Grant lifecycle: `supabase/migrations/20260712000009_phase2_portal_access_lifecycle.sql`
  accepts `academic_partner`, requires at least one `school_key`, and provisions
  `user_school_scopes`.
- Data endpoint gate: `api/portal/school-students.js:10,51`.
- Staff provisioning UI: `src/components/settings/GrantPortalAccessModal.jsx`,
  `AccountDetailsDrawer.jsx`, `src/lib/portalAccessStatus.js`;
  `api/invite-portal-user.js`, `api/list-portal-access.js`, `api/revoke-portal-access.js`
  all include `academic_partner` and pass `p_school_keys`.
- Feedback is permitted for AP server-side: `lib/server/portalFeedback/config.js:18` includes
  `academic_partner` in `PORTAL_FEEDBACK_ROLES`.

### 3.4 Blockers in shared portal code

- **Messages backend rejects AP.** `api/lib/messagesAuth.js:55` states `academic_partner`
  is intentionally not accepted; `verifyPortalMessagesCaller` (`:75-95`) admits only `student`
  and `unit_leader`. The Messages UI would render but every request would fail closed.
- **`PortalUtilityLayer` returns null for AP.** `src/portal/PortalUtilityLayer.jsx:102-106,126`
  gate on `isStudentPortal || isUnitLeaderPortal`; an `academic_partner` portal gets no floating
  Feedback launcher (even though feedback is server-permitted for AP) and no Messages launcher.
  `PortalTeamMessagesPanel` variant is a binary UL/student ternary (`:177`).
- **Unread polling excludes AP.** `PortalApp.jsx:98-104`: `usePortalUnreadCount` is enabled only
  for `isStudent || isUnitLeader`; there is no `isAcademicPartner` flag.

---

## 4. /school-form field and workflow inventory

### 4.1 Route and files

- Route: `src/App.jsx:1310` (`/school-form/*`, theme-locked light).
- Component: `src/components/SchoolFormPage.jsx` (about 613 lines, self-contained; all sections
  inline, no child form components).
- Server: `api/school-form-submit.js`. Notification: `api/form-received-notification.js`.
- Shared pure helpers: `src/lib/availability.js` (weekday and date sanitizers, already shared
  with `api/student-intake-submit.js`).
- Option lists: `src/lib/constants.js` (`SCHOOLS` at `:1`, `PROGRAM_TYPES` at `:247`).
- Password gate RPCs: `school_form_requires_password`, `verify_school_form_password`; password
  column `cohorts.school_form_password`.

### 4.2 Lifecycle

On mount, the page queries `cohorts` for the single row with `accepting_submissions = true`
(`.single()`); if none, it shows "unavailable". Otherwise it checks
`school_form_requires_password`, gates on the cohort password, then renders the form
(`SchoolFormPage.jsx:58-80`).

### 4.3 Fields in actual order

Password gate (before the form): "School Coordinator Access", password required.

Section 1, School Information:
1. School or University Name (required, select, source `SCHOOLS` hardcoded 7 schools).
2. Your Name (Placement Coordinator) (required, text, placeholder "First Last, Title").
3. Your Email Address (required, email).

Section 2, Rotation Dates (apply to all students in the submission):
4. Rotation Start Date (required, date).
5. Rotation End Date (required, date; must be after start; length outside 4 to 16 weeks or a
   past start raises a soft, bypassable warning).

Section 2b, Rotation Availability (all optional):
6. Weekdays generally unavailable (multi-select toggles, `WEEKDAYS`).
7. Minimum clinical days per week (number 1 to 7).
8. Weekend rotations allowed (select: blank / Yes / No).
9. Night shifts allowed (select: blank / Yes / No).
10. School-wide blackout dates (date plus add-to-chips).
11. Scheduling notes for the ASPIRE team (textarea, trimmed to 2000 chars server-side).

Section 3, Students (repeatable block, "+ Add Another Student"):
12. First Name (required).
13. Last Name (required).
14. School Email (required; dedup key, normalized).
15. Phone (optional).
16. Program Type (optional, select, source `PROGRAM_TYPES` hardcoded 7).
17. Hours Required (effectively required; must be at least 90 for every student).
18. Estimated Graduation Date (optional; before rotation end raises a soft warning).

Section 4, Additional Notes:
19. Additional notes for the ASPIRE team (optional, textarea; stored on each student as
    `students.coordinators`).

Submit label: "Submit N Student(s)". No file uploads, no consent or attestation, no captcha.
The only quasi-attestation is the availability disclaimer ("Availability is considered but
cannot be guaranteed").

### 4.4 Submission behavior

- Success: confirmation card "Thank you, {school}." with added / updated / skipped counts.
- Duplicate detection (server, `school-form-submit.js:104-166`): index existing cohort students
  by normalized `school_email`; a match updates coordinator-owned seed fields only (never
  student-owned or ASPIRE-owned), preserving `submitted_via`; no match inserts.
- Errors: 4xx/5xx JSON `{error}`, inline display; incomplete student rows are skipped, not failed.
- Notifications: fire-and-forget POST per new student to `/api/form-received-notification` ->
  `sendNotification('form_received', ...)` -> Resend.
- Audit: one `program_events` row `event_type='rotation_created'` `created_by='system'` for the
  first added student; every student carries `submitted_via='school_form'`.
- Rate limiting: none. The endpoint is `Access-Control-Allow-Origin: *`, unauthenticated; the
  only gates are the client cohort password and the server `accepting_submissions` re-check.

### 4.5 Exact write path

```
/school-form (src/App.jsx:1310)
  -> src/components/SchoolFormPage.jsx  (state, validation handleSubmit, payload doSubmit)
  -> POST /api/school-form-submit  (api/school-form-submit.js, service-role, NO auth)
       READ cohorts (accepting_submissions guard)
       UPSERT cohort_school_rotations onConflict (cohort_id, school_name)   (availability lives here)
       READ students (dedup by normalized school_email)
       per student: UPDATE students (coordinator-owned only) OR INSERT students
                    (status 'Pending Outreach', submitted_via 'school_form', cohort_school_rotation_id)
       INSERT program_events (rotation_created)
       fire-and-forget POST /api/form-received-notification -> Resend
     returns { added, updated, skipped, rotationId }

Staff read (At a Glance -> Placement Requests):
  src/components/OverviewTab.jsx (route /aggregate)
    students prop grouped by s.school (:579-585); "Placement Requests" panel per school (:767)
```

The exact code and DB object that makes a public submission appear in the main app: the INSERT
into **`students`** in `api/school-form-submit.js` (with `school`, coordinator fields, `cohort_id`,
`submitted_via='school_form'`), which `OverviewTab.jsx` groups by `students.school`. **There is
no dedicated placement-request table for schools; the `students` row is the request.**
`cohort_school_rotations` supplies rotation-date and availability context read elsewhere.

### 4.6 Reuse assessment for an authenticated AP Placement Requests tab

- `src/lib/availability.js` and `PROGRAM_TYPES`: reusable as-is.
- `SCHOOLS` dropdown: public-only. Replace with the partner's scoped `school_key`(s); school is
  not free-choice for an authenticated partner.
- Form JSX and validation: reusable with changes; validation is currently inline in the component
  and should be extracted into a shared module (mirroring `unitParticipationForm.js`).
- Payload builder: shape reusable; cohort must come from scope, not the public "single accepting
  cohort" query.
- API client and server route: build an authenticated sibling (for example
  `api/portal/placement-request-submit.js`) that verifies the JWT plus the `academic_partner`
  grant, derives `school_name` and cohort from `user_school_scopes`, rejects any client-supplied
  school not in scope, then reuses the identical upsert/dedup/insert/notify core.
- Notification path: reusable as-is.

Public-form assumptions that must be replaced by authenticated context: no auth and CORS `*`;
school entered by hand; cohort via the public single-accepting-cohort query; cohort password
gate; theme-lock and marketing chrome and public unavailable states; `accepting_submissions`
as the sole spoof guard; anonymously-typed coordinator identity.

### 4.7 Test coverage gap

No test exercises `api/school-form-submit.js`, `SchoolFormPage.jsx`, or `src/lib/availability.js`.
The dedup-by-normalized-email, the `(cohort_id, school_name)` rotation upsert, the
coordinator-owned-only update, and the availability coercions are untested. Any refactor for
portal reuse should add this coverage. `test/portalSchoolMatching.test.mjs` already covers the
school-scope resolution mechanism (`matchSchoolKeys` / `normalizeSchoolTerm`).

---

## 5. /unit-form and Unit Leader Capacity parallel (the primary model to copy)

### 5.1 One form definition, one write, three surfaces

| Surface | Component | Endpoint | Writes |
|---|---|---|---|
| Public `/unit-form` | `src/components/UnitFormPage.jsx` | `POST /api/unit-form-submit` | `units` + `unit_cohort_responses` |
| UL Portal Capacity | `CapacityScreen` in `src/portal/UnitLeaderPortal.jsx:502` | `POST /api/portal/unit-participation-submit` | same |
| Staff At a Glance -> Placement Capacity | `src/components/OverviewTab.jsx:150,712` | reads `unit_cohort_responses` | read-only |

Both writers converge on `performUnitResponseUpsert()` in `api/lib/unitResponseUpsert.js:25`.

### 5.2 Shared source of truth

`src/lib/unitParticipationForm.js` holds options, copy (`PARTICIPATION_TEXT`), `emptyParticipation()`,
`validateParticipation(form, { requireIdentity })`, `participationReady(...)`, and
`buildParticipationBody(form, { includeIdentity })`. The only axis of difference between public
and authenticated is identity, expressed by the two flags. Public calls with `requireIdentity:true`
/ `includeIdentity:true`; portal calls with both false and derives identity server-side.

### 5.3 Authorization of the authenticated write

`api/portal/unit-participation-submit.js`: `verifyPortalCaller` -> `hasActiveRoleGrant('unit_leader')`
-> `resolveAcceptingCohort` (server-chosen cohort) -> `getActiveUnitScopes` scope check -> strict
`ALLOWED_BODY_KEYS` allowlist that excludes `submitter_name`/`submitter_email` so identity cannot
be spoofed. Service-role DB, not caller-JWT RPC.

### 5.4 Two capacity models (key architectural choice)

- **Model A (wired, live):** shared form -> `unit-participation-submit` -> `unit_cohort_responses`.
  Overwrite-in-place, `UNIQUE(cohort_id, unit_id)`, no review state, no history. This is what the
  UL Capacity tab uses and At a Glance reads.
- **Model B (built, not wired to UI):** `unit_capacity_submissions` with supersede-never-overwrite,
  an ASPIRE `review_status` (`submitted -> under_review -> accepted/adjusted/declined`), and full
  history. API exists (`api/portal/unit-capacity.js`, RPC `unit_capacity_submit`; staff
  `decideCapacity` in `api/unit-leader-decisions.js`). No UI references it yet.

Lesson: if AP placement requests need a lifecycle (they do, per section 12), follow Model B's
shape, not Model A's overwrite table.

### 5.5 Lessons for AP Placement Requests

1. One canonical form module, two identity flags. Never fork a second form definition.
2. One shared server write helper so public and authenticated paths cannot drift.
3. Server owns identity, cohort, and counters; strip identity from the body allowlist.
4. Authorize through the existing scope table, fail closed. The AP analogue of `user_unit_scopes`
   is `user_school_scopes`.
5. Prefer the reviewable, historied model over overwrite-in-place.
6. Add an origin/source column deliberately; the capacity model has none.
7. Prepopulate both context (school) and any prior draft via a lookup like `api/unit-form-lookup.js`.

### 5.6 Provenance and prepopulation gaps

`unit_cohort_responses` has no source/origin column; a portal submission is indistinguishable
from a public one except by which identity values landed. The UL Capacity screen prefills only
the locked unit for single-unit leaders and does not prepopulate prior answers. An AP feature
should add an origin column and prepopulate the prior draft.

---

## 6. Academic Partner identity and school-scoping findings

### 6.1 What exists

- `public.user_role_grants` (`20260712000007_phase2_authz_foundation.sql:49-67`): `role` CHECK
  already includes `academic_partner`. Active grant = not revoked and within start/expiry.
  Grant/revoke RPCs in `...20260712000009...` take `p_school_keys text[]` and require at least
  one school_key for an AP grant.
- `public.user_school_scopes` (`...000007...:119-139`): `user_profile_id, school_key (canonical
  school name), cohort_id (NULL = all cohorts)`, plus lifecycle columns. SECURITY DEFINER helper
  `my_school_scope_keys()` (`:234-245`) is aggregated into `get_my_portal_access()` -> `school_keys`.
- `public.schools` (`20260712000012_phase4_school_portal.sql:30-56`): `id uuid PK,
  canonical_name UNIQUE, operative_name, aliases text[], is_active`; seeded with 7 schools (APU,
  CSULB, CSULA, CSUN, UCLA, WCU Anaheim, WCU North Hollywood). Staff-read RLS only.
- Student affiliation: `students.school` (free text, the operative column all scoping matches on)
  and `students.school_id` (nullable FK to `schools.id`, backfilled in Phase 4 for future
  reporting). Alias-aware matching in `api/lib/schoolAliases.js` (`resolveSchoolAliases`,
  `schoolMatches`).

### 6.2 Answers, from evidence

- One AP can belong to multiple schools: yes (grant takes an array; the endpoint iterates scopes).
- Multiple APs per school: yes (no uniqueness ties a school to one user).
- Scope derivation: DB mappings only. `school-students.js` re-reads the grant and scopes each
  request; no request parameter influences scope. The JWT supplies identity, not scope claims.
- Cross-school prevention today: the server-side filter in `school-students.js` keeps only students
  whose normalized `students.school` is in the caller's own scope. Reads run under the service role,
  so RLS is not the guard; the endpoint allowlist is.
- Stable identifiers: `schools.id` and `schools.canonical_name` exist, but the read-time join is
  still the `students.school` text via aliases; `students.school_id` is currently a reporting
  convenience, not the match key.
- New SQL/RLS for the base roster: not required. Required only to expose omitted surfaces or add a
  write path.

### 6.3 The authorization pattern to mirror

`api/lib/portalAuth.js`: `verifyPortalCaller` verifies the Supabase JWT with the anon key plus the
Bearer header (preserving `auth.uid()`), then resolves the profile via the service DB; helpers
`getServiceDb`, `hasActiveRoleGrant`, `getActiveUnitScopes`. `api/lib/unitLeaderScope.js`
composes these into `verifyPortalUnitLeaderCaller`. The AP analogue is verify -> `hasActiveRoleGrant
('academic_partner')` -> active `user_school_scopes`; an empty scope set means "sees nothing",
never "unrestricted".

### 6.4 Cross-school leakage risk to test first

School scoping matches the `students.school` text via aliases, not the `school_id` FK. A new
unaliased `students.school` variant is missed (fails closed, safe). More important: verify that a
partner scoped to one WCU campus cannot pull the other via a parent `West Coast University` / `WCU`
alias (`schoolAliases.js`). This is the single most important isolation test before trusting the
boundary. Any new AP endpoint must re-derive scope server-side and never accept a school from
request params, because service-role reads have no RLS backstop.

### 6.5 Migration application caveat

The Phase 2/4 objects depend on migrations `20260712000007`, `...000009`, and `...000012`.
Per `docs/security/OWNER_SQL_GATE.md`, some migrations may still await Owner execution. Before
treating the AP roster as live, confirm in production that `public.schools`,
`public.user_school_scopes`, and `portal_my_school_reports` exist and that at least one AP grant
plus scope row is present. This was not verified in this read-only pass.

---

## 7. Student roster data map

Candidate query is already implemented in `api/portal/school-students.js`. Per-field source and
current AP exposure:

| Field | Source | Exposed to AP today |
|---|---|---|
| Student identity (first/preferred/last, id) | `students` | Yes |
| School affiliation | `students.school` (alias-matched); FK `students.school_id` | Yes (match key) |
| Cohort | `students.cohort_id` -> `cohorts (name, status, start_date, end_date)` | Yes |
| Program | `students.program_type` (not in any portal allowlist) | No |
| ASPIRE status | `students.status` | Yes |
| Placement status | derived from `students.status` | Yes (via status) |
| Unit assignment | AP reads legacy `students.unit` (text, mostly unpopulated); canonical is `students.matched_unit_id -> units.unit_name` | Yes but unreliable (see note) |
| Preceptor(s) | primary from `student_preceptor_assignments` + `preceptors.full_name`; fallback `students.preceptor_name` | Yes (primary only) |
| Rotation dates | `students.term_dates` (free text) or cohort dates; canonical `cohort_school_rotations.rotation_start_date/end_date`; UL also has `students.rotation_end_date`, `rotation_completed_at` | Partly |
| Hours | `students.hours_required, approved_hours, pending_hours` | Yes |
| Logged shifts | `student_shift_logs` (UL reads via `unit-shift-activity.js`, `unit-student-shifts.js`) | No AP path |
| Onboarding | `students.badge_created, cs_link_complete, student_form_privacy_ack_at` rolled up by `onboardingSummary` (`unitLeaderScopeRules.js:92`) | No AP path (UL-only) |
| Surveys/evaluations | `evaluation_assignments` (AP gets counts only) | Counts only |
| Certificate | `certificates.certificate_unlocked_at` etc. | No AP path |

Note: the AP endpoint reads legacy `students.unit`, which the UL path deliberately abandoned
because no writer populates it (`unit-roster.js:16-19`). **The AP unit column is unreliable and
should switch to `matched_unit_id -> units.unit_name`.**

The fuller UL allowlist `UL_STUDENT_COLUMNS` (`unitLeaderScopeRules.js:26-37`) is the reference
superset; the AP endpoint intentionally exposes a narrower subset for privacy.

Roster population direction: show all ASPIRE students associated with the authenticated school(s),
including historical students where appropriate. The data model supports this (the query is
school-scoped, not cohort-limited). The default view should distinguish current from historical
by cohort status and `students.status` (for example, current = active cohort and non-terminal
status; historical = completed or prior cohorts), surfaced as roster filters driven by the
summary counts.

---

## 8. Student profile visibility matrix

Legend: SAFE = already exposed to AP or clearly appropriate; NEW-RELEASE = requires an approved
expansion of the AP allowlist; STAFF/UL-only = restricted today; CONFIDENTIAL = must never reach
a partner.

Identity and program: Name SAFE; School SAFE; Cohort SAFE; Program type NEW-RELEASE (from
`students.program_type`); Photo NEW-RELEASE (serve as boolean plus server-mediated signed URL
only, never a storage path).

ASPIRE progress: pipeline stage (`students.status`) SAFE; derived hero stage/timeline SAFE
(`src/lib/portalProgress.js`, pure, derives only from status).

Placement: requested unit preferences (`students.unit_preference_1/2/3`) NEW-RELEASE and
sensitive; confirmed unit NEW-RELEASE-fix (safe to show, but must switch to
`matched_unit_id -> units.unit_name`); primary preceptor name SAFE, full preceptor set with
roles/dates NEW-RELEASE; rotation dates SAFE for `term_dates`/cohort dates, canonical window
NEW-RELEASE improvement.

Hours and shifts: required/approved/pending hours SAFE; total shift count and last shift date
NEW-RELEASE (low sensitivity); shift history NEW-RELEASE, using the exact
`unit-student-shifts.js` `SAFE_COLUMNS` allowlist (`id, shift_date, total_hours, unit_name,
preceptor_name, shift_type, status`), which excludes all narrative and review fields.

Completion: survey/evaluation status counts SAFE; certificate eligibility/release NEW-RELEASE
(status-level derivation safe; the PDF stays token-gated).

CONFIDENTIAL, must never be exposed (enforced today by the UL allowlist and
`test/unitLeaderPrivateFieldExclusion.test.mjs`): `support_needed`, `learning_highlight`,
`admin_notes`, `reviewed_by/at`, `review_reason`, `exception_flags`, `unit_override_reason`,
`preceptor_override_note`, `interview_outcome/notes`, rubric/scores, `ngrp`, `disposition`, and
all compliance/clearance/health fields (`gpa_verified`, `cumulative_gpa`, `bls_current`,
`health_cleared`, `background_check`, `ssn`, `date_of_birth`) which are excluded even as booleans
because they reveal why a student is not ready.

Contact fields (`school_email`, `personal_email`, `phone`): approved for UL but NOT in the AP
allowlist; treat as STAFF/UL-only pending an explicit decision. UL serves them from a separate
per-student detail endpoint, never the bulk roster, to limit blast radius; copy that pattern if
AP contact access is ever approved.

Reusable enforcement pattern: server column allowlists (not denylists), files as booleans plus
server-mediated signed URLs, and a per-endpoint exclusion guard test. Recommendation: write an
`academicPartnerPrivateFieldExclusion` test alongside any new AP endpoint.

---

## 9. On Campus Now findings

- Shared presentational card: `src/components/oncampus/OnCampusNow.jsx` (holds no data, no clock,
  no auth; its header already anticipates an AP caller). Row shape is `{ key, avatar, name,
  subLabel, badge, statusText, statusWarn, onClick, ariaLabel }`.
- There is **no scheduled-shift data** anywhere (`unit-shift-activity.js:5-9`). "On campus now"
  means currently checked in. `shift_date` is stamped to Pacific today at check-in; future dates
  are refused.
- Staff At a Glance strip (`OverviewTab.jsx` `OnCampusStrip`, logic in `src/lib/onCampusNow.js`):
  a hybrid of the authoritative lifecycle source (`student_shift_logs.lifecycle_state='in_progress'`)
  plus a time-window fallback (today/yesterday approved logs whose canonical shift window contains
  now), merged with lifecycle winning. Cohort-scoped, refetched every 60s.
- UL Home (`UnitLeaderPortal.jsx:248-254`, source `api/portal/unit-shift-activity.js`): lifecycle
  only, no fallback. Rows via `src/lib/onCampusRows.js` `buildLiveShiftDisplay`, clock from
  `activity.loadedAt` (never render-time `Date.now()`).
- Timezone: single Pacific assumption; `shift_date` is TEXT, range-filtered lexicographically;
  windows in `src/lib/shiftWindows.js` (Day 07:00 to 19:30, Night 19:00 to 07:30 crossing
  midnight, Mid 11:00 to 23:30); yesterday is pulled so night shifts crossing midnight are caught.
- Open shift unit/preceptor: null until check-out, so `planned_unit_name`/`planned_preceptor_name`
  are the live values; missing preceptor is a safe no-suffix fallback.

Recommendation: a new `api/portal/school-shift-activity.js` that authorizes via the existing AP
+ `user_school_scopes` chain, resolves the scoped student-id set first (school scope is the
filter, never a request param), then queries `student_shift_logs .in('student_id', scopedIds)
.eq('lifecycle_state','in_progress')`. Reuse `OnCampusNow.jsx`, `onCampusRows.js`, `shiftStatus.js`,
and the `SAFE_COLUMNS` and `has_photo` boolean plus signed-URL patterns unchanged. Recommend
**lifecycle-only** for AP (drop the time-window fallback); the fallback infers presence and is a
weaker, higher-false-positive signal for an external audience.

---

## 10. Needs Attention candidate rules (for later approval, not implemented)

Data availability today, with false-positive risk. Existing precedent to mirror:
`api/portal/unit-notifications.js` already builds a unit-scoped attention feed
(`placement_request`, `response_deadline`, `capacity_review_outcome`, `preceptor_assignment_update`).

| Candidate rule | Data source today | Computable now | False-positive risk |
|---|---|---|---|
| Placement request needs clarification | `unit_placement_requests.unit_response='changes_requested'` + comment | Yes (unit-side signal; AP visibility is a policy question) | Low |
| No confirmed placement | `aspire_status='open'` or status not yet Placed; `matched_unit_id` null | Yes | Medium (open is normal early; needs a stage/time gate) |
| Missing onboarding requirement | `onboardingSummary` keys (badge/access/acknowledgment) | Yes, but UL-scoped; not in AP allowlist today | Medium (only these 3 are partner-appropriate) |
| Approaching start without ready-to-start | rotation start (`cohort_school_rotations` sentinel-laden or `term_dates` free text or `cohorts.start_date` TEXT) + onboarding rollup | Partial | High (fragile date fields) |
| No recent shift activity | most-recent `student_shift_logs.shift_date` | Yes | Medium (days off look like inactivity) |
| Expected hours behind pace | hours columns (real) + elapsed rotation time | Partial | High (depends on fragile dates) |
| Hour discrepancy | shift totals vs approved/pending; reason in restricted `exception_flags` | Partial | High (root-cause fields off-limits) |
| Missed/cancelled shift | none (no scheduled-shift model) | No, needs new data | N/A |
| Approaching rotation end | `cohort_school_rotations.rotation_end_date` / `students.rotation_end_date` | Partial | Medium to high |
| Overdue survey | `evaluation_assignments.status IN ('sent','opened','reminder_due')` past `expires_at`; `non_responder` exists | Yes | Low to medium |
| Certificate not released after completion | `deriveCertificateStatus` eligible/processing gate | Yes | Low |

The most reliable first-release rules are: certificate not released after completion; overdue
survey; placement request needs clarification (if AP-appropriate); no recent shift activity. The
date-dependent pace/start/end rules should wait until rotation dates are parsed reliably.

---

## 11. Status mapping

Real (column-backed) statuses:

- Student ASPIRE progress `students.status` (`constants.js:181-192` `ASPIRE_STATUSES`):
  Pending Outreach, Form Sent, Form Received, Interview Scheduled, Interviewed, Placed,
  Active Rotation, Completed, Declined, Not Proceeding.
- Placement request `unit_response`: pending, accepted, declined, changes_requested.
- Placement request `aspire_status` (authoritative): open, confirmed, withdrawn, reassigned.
- Preceptor assignment `student_preceptor_assignments.status`: active, ended, removed.
- Evaluation `status`: draft, sent, opened, completed, expired, revoked, reminder_due,
  non_responder; plus `timepoint` and `respondent_type`.
- Shift log `status`: Auto-Accepted, Approved, Pending Review.

Derived: hero stage/timeline (`portalProgress.js`), onboarding rollup (`onboardingSummary`),
rotation bucket, certificate status (`deriveCertificateStatus`), badge status (`deriveBadgeStatus`).

Recommended AP-facing lifecycle mapped only to real support (do not invent precision):

| AP-facing label | Backed by |
|---|---|
| Submitted by School | `students.submitted_via='school_form'`, status Pending Outreach/Form Received |
| Eligibility Review | status Interview Scheduled / Interviewed (interview content stays hidden) |
| Placement Requested | student in pipeline pre-Placed; any open `unit_placement_requests` |
| Matching in Progress | status pre-Placed with active matching (derive from status) |
| Placement Confirmed | status Placed and/or `matched_unit_id` set and/or `aspire_status='confirmed'` |
| Onboarding | Placed with onboarding rollup not ready |
| Ready to Start | Placed with onboarding rollup ready |
| Active Rotation | status Active Rotation |
| Rotation Completed | status Completed / `rotation_completed_at` |
| Survey Pending | evaluation_assignments open past due for the student |
| Certificate Released | `certificate_unlocked_at` set |
| Unable to Place | status Declined / Not Proceeding; `aspire_status='withdrawn'` |
| Withdrawn | `aspire_status='withdrawn'` (staff decision today) |

Gaps to flag rather than fake: "Matching in Progress" and "Eligibility Review" have no dedicated
column and must be derived from `students.status`; there is no partner-authored draft/submitted
status axis.

---

## 12. Placement request editing policy analysis

The only existing placement-request record type is `unit_placement_requests` (UL responds,
ASPIRE decides), a two-column authority split: UL side (`unit_response`, `unit_comment`, responder)
and authoritative ASPIRE side (`aspire_status`, `aspire_note`, decider). Append-only audit in
`unit_placement_request_events`, written atomically for UL responses via the RPC
`unit_placement_respond` (guarded on `aspire_status='open'` under a row lock). Staff decisions via
`decidePlacement` set `aspire_status` one-way (no reopen). `changes_requested` requires a comment
end to end.

Critical gaps: **no endpoint or RPC INSERTs `unit_placement_requests`** (rows are authored
out-of-band; the `created` event type is defined but never emitted), and there is **no
submitter-initiated withdrawal** (withdrawn is an ASPIRE decision only).

Assessment of the proposed first-release policy (direct edit while Draft/Submitted; lock after
Under Review; Request a Change after review; withdrawal with confirmation and audit):

| Element | Supported today | Detail |
|---|---|---|
| Direct edit while Draft/Submitted | Partial | Edit-while-open exists but only for response fields; no Draft state, no author path |
| Lock after Under Review | Pattern exists (Model B) | `unit_capacity_submissions.review_status` proves the lock; reuse it rather than the binary open guard |
| Request a Change after review | Directly reusable | `changes_requested` with mandatory comment exists end to end |
| Withdrawal with confirmation + audit | Partial | `withdrawn` exists as a staff decision only; no submitter self-withdraw |

Backend work required for the policy: a create/author path (RPC plus endpoint); a Draft state and
submit transition; an `under_review`/lock state on the request (borrow Model B's `review_status`);
a submitter-initiated withdraw RPC with confirmation plus an audit event (extend the event enum or
reuse the decision event); school-scoped authorization for a partner author (the current placement
RPCs authorize on `user_unit_scopes`, which does not fit AP); and an origin/source column if
partner-authored vs staff-authored requests must be distinguished.

Reality check against section 4: for schools, "the placement request" today is simply the
`students` row created by `/school-form`. First-release AP editing should therefore be scoped to
what that model supports (edit coordinator-owned seed fields on students the partner submitted,
before ASPIRE begins outreach), plus a Request-a-Change affordance and a withdraw affordance, both
of which need new backend. A full Draft/Submitted/Under-Review lifecycle is a later, backend-heavy
phase.

---

## 13. Messages scope

- The shared workspace `src/portal/messages/PortalMessagesWorkspace.jsx` threads a `variant`
  (`student` | `unit_leader`) that only swaps copy; it is otherwise role-agnostic (URL-driven,
  react-query polling). Adding an `academic_partner` variant is a small copy change.
- The blocker is the server: `api/lib/messagesAuth.js:55,75-95` `verifyPortalMessagesCaller`
  admits only student and unit_leader; `academic_partner` is an explicit non-acceptance. The
  gating RPCs (`my_message_conversation_ids()`, `message_participant_can_send`) would also need to
  admit AP.
- `PortalUtilityLayer` returns null for AP, so the floating Messages launcher and unread wiring
  are also gated (section 3.4).

Safest first-release Messages scope: Academic Partner to ASPIRE staff only (school-scoped
threads), reusing the shared workspace with a new `academic_partner` variant. Do **not** enable
AP-to-student messaging in the first release; student messaging authorization and school-scoped
thread membership for external partners are a larger policy and backend surface. This requires:
extend `verifyPortalMessagesCaller` and the gating RPCs to admit AP with school-scoped thread
membership; add the `academic_partner` case to `PortalUtilityLayer` and `PortalTeamMessagesPanel`
variant; add AP to the unread-polling enable condition in `PortalApp.jsx`.

---

## 14. Security and backend gap analysis

Ready now (no backend work):
- AP role, grant lifecycle, and `user_school_scopes` mapping.
- `get_my_portal_access()` returning `school_keys`.
- `api/portal/school-students.js` roster (server-side allowlist, alias-aware school scope).
- `schools` table and `portal_my_school_reports` scoped view.
- Reusable shell, Nightfall chrome, masthead, On Campus Now card, identity hero, state primitives.

Frontend-only work:
- AP portal branch upgrade in `PortalApp.jsx` (Nightfall header, nav slot, utilityLayer, tabbar,
  profile controls) and a new `/portal/ap/<section>` URL parser.
- An `AcademicPartnerNav` (3 tabs), a reduced clone of `UnitLeaderNav`.
- Students landing workspace: masthead, summary-count filters, roster table, wired to the existing
  endpoint; replace the hand-rolled states with the shared primitives.
- Extract `/school-form` validation into a shared module (mirroring `unitParticipationForm.js`).

Backend API work:
- `api/portal/school-shift-activity.js` (school-scoped, lifecycle-only On Campus Now).
- `api/portal/school-student-detail.js` (per-student AP drawer) modeled on `unit-student-detail.js`
  + `unit-student-shifts.js`, inheriting their allowlists and file-boolean pattern, with a new
  exclusion test.
- `api/portal/placement-request-submit.js` (authenticated sibling of `school-form-submit.js`).
- A school-scoped Needs Attention feed, modeled on `api/portal/unit-notifications.js`.
- Fix the unreliable `students.unit` read (switch to `matched_unit_id -> units.unit_name`).
- Messages: extend `verifyPortalMessagesCaller` + gating RPCs; add AP to `PortalUtilityLayer`,
  `PortalTeamMessagesPanel`, and unread polling.

SQL/RLS work requiring explicit Owner approval:
- Any newly exposed columns (program, photo boolean, shift history, certificate, canonical
  rotation window) via new SECURITY DEFINER read functions or endpoint allowlists (likely no new
  RLS, because portal reads use the service role).
- A placement-request author/edit/withdraw model if the full lifecycle is pursued (new table or
  new status axis, new RPCs, audit events; borrow Model B's `review_status` and the
  `unit_placement_request_events` audit shape).
- An origin/source column for provenance.
- Confirm the Phase 2/4 migrations are applied (Owner SQL gate).

Unresolved product decisions: section 17.

Cross-cutting security requirements: every new AP endpoint must re-derive school scope
server-side from `user_school_scopes` and reject any client-supplied school; inherit the UL
column allowlists and file-boolean patterns; serve photos and documents only as booleans plus
server-mediated signed URLs; add a per-endpoint private-field-exclusion test; and verify the
WCU parent-alias cannot cross campuses.

---

## 15. Reuse map

Reusable as-is: `PortalShell`, the Nightfall chrome tokens and `.ptl-topsection`/
`.ptl-header-nightfall`, `GreetingMasthead`, `ProfileIdentityHero`, `OnCampusNow` (card),
the state primitives (`LoadingState`, `TableSkeleton`, `EmptyState`, `ErrorState`,
`DeniedState`, `SectionHeading`, `Pill`) from `UnitLeaderChrome.jsx`, `src/lib/lastVisit.js`,
`src/lib/availability.js`, `src/lib/onCampusRows.js`, `src/lib/shiftStatus.js`,
`src/lib/portalProgress.js`, `PROGRAM_TYPES`.

Reusable with props or extraction: `UnitLeaderNav` -> `AcademicPartnerNav` (reduce to 3 tabs);
`PortalMessagesWorkspace` (+ `academic_partner` variant); the `/school-form` fields and validation
(extract to a shared module); `UnitSwitcher`/`SegmentedTabs` -> a multi-school switcher.

Unsafe to reuse verbatim (data or authz coupling; use as design reference and build an AP adapter):
`StudentDetailDrawer.jsx` (all reads are unit-scoped), `EditProfileDrawer.jsx` (student
self-service), `PortalNav.jsx` (student destinations).

Needs a code change before AP works: `PortalUtilityLayer.jsx` (add `academic_partner` case),
`api/lib/messagesAuth.js` (admit AP), `PortalApp.jsx` (AP branch upgrade + URL sections + unread
polling).

Do not duplicate: the placement-request workflow (reuse the `students` write path and the
`/unit-form` convergence model), the masthead, the weather system, the On Campus card, or the
Messages workspace.

---

## 16. Recommended implementation phases

Each phase is one branch, documentation-driven, with tests and a security gate. Adjust ordering
only if evidence supports it.

**Phase 1: AP shell, authorization, and Students landing foundation.**
Objective: upgrade the AP branch to the full shell (Nightfall header, 3-tab nav, tabbar, profile
controls, URL sections) and render the masthead + summary-count filters + existing roster.
Dependencies: none (endpoint exists). Reused: PortalShell, chrome, GreetingMasthead, state
primitives, `school-students.js`. New: `AcademicPartnerNav`, AP URL parser, Students workspace
shell. API: none. SQL: none. Tests: AP nav, URL routing, roster render, no cross-portal leakage.
Security gate: confirm scope derivation is server-side. Decisions needed: current-vs-historical
default filter. Branch: `ap-shell-students-foundation`. Commits: branch upgrade; AP nav; Students
workspace + masthead + filters; tests.

**Phase 2: School-scoped roster fixes and AP student profile drawer.**
Objective: fix the unreliable unit read; add a per-student AP detail endpoint and an AP-safe
drawer (identity + ASPIRE progress + placement + Hours and Shifts). Reused: `ProfileIdentityHero`,
`StudentDetailDrawer` structure as reference, `unit-student-shifts.js` `SAFE_COLUMNS`. New:
`api/portal/school-student-detail.js`, an AP drawer. API: new detail endpoint. SQL: only if newly
exposed columns need a SECURITY DEFINER read. Tests: `academicPartnerPrivateFieldExclusion`.
Security gate: allowlist review, file-boolean pattern, confidential-set exclusion. Decisions
needed: which NEW-RELEASE fields (photo, program, preferences, full preceptor set, contact,
certificate). Branch: `ap-student-drawer`. Commits: unit-read fix; detail endpoint + exclusion
test; drawer.

**Phase 3: On Campus Now and approved Needs Attention rules.**
Objective: school-scoped, lifecycle-only On Campus Now; implement only the approved reliable
attention rules. Reused: `OnCampusNow`, `onCampusRows.js`, `shiftStatus.js`,
`unit-notifications.js` pattern. New: `api/portal/school-shift-activity.js`, an attention feed.
SQL: none expected. Tests: scope isolation, lifecycle-only, attention rule fixtures. Decisions
needed: final attention rule set and severities. Branch: `ap-oncampus-attention`.

**Phase 4: Placement Requests list and /school-form convergence.**
Objective: the Placement Requests tab (list of the school's requests, which are `students` rows)
plus an authenticated submit reusing the extracted form module. Reused: extracted school-form
module, `availability.js`, `performUnitResponseUpsert`-style shared write. New:
`api/portal/placement-request-submit.js`, list view. SQL: origin column (approval); confirm the
students write path. Tests: authenticated submit, scope enforcement, dedup, At a Glance
appearance. Security gate: reject out-of-scope school; no client cohort trust. Branch:
`ap-placement-requests`.

**Phase 5: Placement request editing, change request, and withdrawal.**
Objective: edit-while-editable, Request a Change, withdraw with confirmation and audit.
Dependencies: Phase 4. New: author/edit/withdraw RPCs and audit events (borrow Model B
`review_status` and `unit_placement_request_events`). SQL/RLS: substantial, Owner-gated. Tests:
lifecycle guards, audit atomicity. Decisions needed: exact editable window and lock semantics.
Branch: `ap-placement-editing`.

**Phase 6: Messages and shared utilities.**
Objective: AP-to-staff Messages tab; enable the floating Feedback and Messages launchers.
New: `academic_partner` Messages variant; extend `verifyPortalMessagesCaller` + gating RPCs; add
AP to `PortalUtilityLayer`, `PortalTeamMessagesPanel`, and unread polling. SQL: message auth RPC
changes (Owner-gated). Tests: AP thread membership scope, unread counts. Decisions needed:
AP-to-student messaging (recommend deferring). Branch: `ap-messages-utilities`.

**Phase 7: Accessibility, responsive, security, and regression pass.**
Objective: full a11y and responsive sweep, cross-school isolation tests, WCU alias test, and
regression across Student and UL portals. Branch: `ap-final-hardening`.

**Phase 8 (later): Reports and NGRP outcomes.** Out of first-release scope.

---

## 17. Open decisions requiring Jester's approval

1. **Roster default:** current-only vs current-plus-historical default view, and how historical is
   defined (completed status vs prior cohort). Data supports either.
2. **NEW-RELEASE drawer fields:** which of photo, program type, requested unit preferences, full
   preceptor set with roles/dates, canonical rotation window, shift history, total shifts/last
   shift, and certificate status are approved for AP exposure. Each is safe to build but each
   expands the allowlist.
3. **Contact fields for AP:** whether `school_email`/`phone` are ever exposed (currently STAFF/UL
   only). If yes, serve from a separate detail endpoint only.
4. **Needs Attention rule set and severities:** which rules ship first (recommend the reliable
   subset: certificate-not-released, overdue survey, no-recent-activity, needs-clarification).
5. **Placement request lifecycle depth:** first release limited to editing coordinator-owned seed
   fields plus Request-a-Change and withdraw, vs a full Draft/Submitted/Under-Review model (larger
   backend).
6. **Messages scope:** AP-to-staff only for first release (recommended), deferring AP-to-student.
7. **Provenance:** whether an origin/source column is added to distinguish partner-authored from
   public and staff-authored submissions.
8. **Owner SQL gate:** confirm the Phase 2/4 migrations are applied in production before treating
   the AP roster as live.

---

## 18. Exact file and database references

Portal shell and chrome: `src/portal/PortalApp.jsx`, `src/portal/PortalShell.jsx`,
`src/portal/PortalUtilityLayer.jsx`, `src/portal/portal.css`, `src/index.css` (Nightfall tokens),
`src/portal/AcademicPartnerPortal.jsx`, `src/portal/unit/UnitLeaderChrome.jsx` (nav + state
primitives).

Shared components: `src/components/masthead/GreetingMasthead.jsx`,
`src/components/oncampus/OnCampusNow.jsx`, `src/components/portal/ProfileIdentityHero.jsx`,
`src/portal/unit/StudentDetailDrawer.jsx`, `src/portal/messages/PortalMessagesWorkspace.jsx`,
`src/lib/lastVisit.js`, `src/lib/onCampusRows.js`, `src/lib/shiftStatus.js`,
`src/lib/onCampusNow.js`, `src/lib/shiftWindows.js`, `src/lib/portalProgress.js`,
`src/lib/portalDocuments.js`.

Placement request (school): `src/App.jsx:1310`, `src/components/SchoolFormPage.jsx`,
`api/school-form-submit.js`, `api/form-received-notification.js`, `src/lib/availability.js`,
`src/lib/constants.js` (`SCHOOLS`, `PROGRAM_TYPES`, `ASPIRE_STATUSES`), `src/components/OverviewTab.jsx`
(At a Glance panels).

Unit-form parallel: `src/lib/unitParticipationForm.js`, `src/components/UnitFormPage.jsx`,
`api/unit-form-submit.js`, `api/unit-form-lookup.js`, `api/lib/unitResponseUpsert.js`,
`api/portal/unit-participation-submit.js`, `api/portal/unit-capacity.js` (Model B),
`api/unit-leader-decisions.js`.

Auth and scope: `api/lib/portalAuth.js`, `api/lib/unitLeaderScope.js`,
`api/lib/unitLeaderScopeRules.js` (`UL_STUDENT_COLUMNS`, `onboardingSummary`),
`api/lib/schoolAliases.js`, `api/lib/messagesAuth.js`, `api/portal/school-students.js`.

Placement request (unit) and audit: `api/portal/unit-placement-requests.js`,
`api/portal/unit-notifications.js`, `api/portal/unit-shift-activity.js`,
`api/portal/unit-student-detail.js`, `api/portal/unit-student-shifts.js`.

Database (migrations): `supabase/migrations/20260712000007_phase2_authz_foundation.sql`
(`user_role_grants`, `user_school_scopes`, `my_school_scope_keys`, `get_my_portal_access`),
`...20260712000009_phase2_portal_access_lifecycle.sql` (grant/revoke with school_keys),
`...20260712000012_phase4_school_portal.sql` (`schools`, `students.school_id`,
`portal_my_school_reports`), `...20260720000000_unit_leader_portal_foundation.sql`
(`unit_placement_requests`, `unit_placement_request_events`, `unit_capacity_submissions`,
`unit_cohort_responses` note), `...20260720000001...` (`unit_placement_respond`,
`unit_capacity_submit`).

Tests to mirror: `test/unitLeaderPrivateFieldExclusion.test.mjs`,
`test/portalSchoolMatching.test.mjs`, `test/unitLeaderCapacityPreceptors.test.mjs`.

Key tables by name: `students`, `cohorts`, `cohort_school_rotations`, `schools`, `user_role_grants`,
`user_school_scopes`, `user_unit_scopes`, `student_shift_logs`, `student_preceptor_assignments`,
`preceptors`, `units`, `evaluation_assignments`, `certificates`, `unit_cohort_responses`,
`unit_capacity_submissions`, `unit_placement_requests`, `unit_placement_request_events`,
`program_events`.

---

End of discovery. No implementation was performed.
