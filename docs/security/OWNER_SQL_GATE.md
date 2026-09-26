# Owner SQL Gate: Consolidated Application Order

Every phase of the public-platform build is code-complete, deployed, and
verified in production. Every database change is drafted but NOT applied. This
file is the single ordered checklist for applying them.

Run each file WHOLE, as one block, in the Supabase SQL editor. Per-file detail
is in [PHASE_0B_RLS_HARDENING.md](PHASE_0B_RLS_HARDENING.md); audit context in
[PHASE_0A_ACCESS_AUDIT.md](PHASE_0A_ACCESS_AUDIT.md).

> **LEDGER UPDATE, 2026-08-27.** This document stopped being updated on
> 2026-08-02 and the sections below reflect that date. Twenty-four migrations
> have been added since; none of them appear in the ordered lists below. See
> the dated section "Migrations added since 2026-08-02" at the END of this
> file for the complete list with applied-state status, and
> [FINDINGS_REGISTER.md](FINDINGS_REGISTER.md) for the security remediation
> register. When a migration in that section is confirmed applied, record it
> THERE, in the same sitting.

## Live-state audit: COMPLETE

The read-only audit (`db/audit/phase0a_live_state_audit.sql`) has been run and
its findings confirmed against production. Confirmed conclusions:

- RLS is enabled on all public tables.
- Broad anon and authenticated policies, and broad table grants, exist on
  sensitive tables (findings F1 through F6, now confirmed).
- student-files is a PUBLIC storage bucket and contains resumes (F7, confirmed).
- Several SECURITY DEFINER functions are executable by anon or PUBLIC (F8,
  confirmed).
- students, interview_rubrics, interview_sessions, interview_slots are in the
  realtime publication (F11, confirmed; closed by Waves B, D, E via RLS).
- `user_profiles.id <> auth_user_id` for all profiles is EXPECTED and correct
  (intentional three-identity model), NOT a defect. Former finding F9 is
  withdrawn. Do not modify profile ids; do not make id equal auth_user_id.

## Application order

| # | File | Gate notes | Unlocks |
|---|---|---|---|
| 1 | `20260712000000_phase0b_wave_a_is_staff_helper.sql` | additive, safe anytime | Wave E, Wave F-1 |
| 2 | `20260712000001_phase0b_wave_b_drop_orphan_anon_policies.sql` | pure risk removal | closes F1 (orphan tables), part of F11 |
| 3 | `20260712000002_phase0b_wave_c_narrow_cohorts_anon.sql` | keeps public forms working | closes cohorts public-write |
| 4 | `20260712000003_phase0b_wave_d_form_backed_anon_removal.sql` | code prerequisite ALREADY live (74526e5); **QUIET PERIOD: the intake window is open, apply outside collection hours; stale tabs must refresh** | closes F1 students, F3, F4, part of F11 |
| 5 | `20260712000004_phase0b_wave_e_staff_rescope.sql` | requires 1; behavior-identical for current users | closes F2, F5, F6, completes F11 |
| 6 | `20260712000005_phase0b_wave_e2_residual_authenticated_policy_cleanup.sql` | requires 5; APPLIED-Wave-E follow-up. Drops the 14 residual dashboard-named broad authenticated policies Wave E missed by a name mismatch | completes F6 (and the activity_logs F5 insert) |
| 7 | `20260712000006_phase0b_wave_f1_function_execute_hardening.sql` | requires 1; privilege-only, no app change; preserves the two school-form functions | closes F8 (anon/PUBLIC EXECUTE) |
| 8 | `20260712000007_phase2_authz_foundation.sql` | requires 1 through 6; additive; explicitly transactional (BEGIN/COMMIT) | portal role grants, scopes, student links |
| 9 | `20260712000008_phase2_student_portal_views.sql` | requires 8; additive; explicitly transactional (BEGIN/COMMIT); PRECHECK that all referenced base-table columns exist (some base tables are dashboard-created); the eval view sources `evaluation_instruments.display_name` (live schema; there is no `title` column), exposed as `instrument_title` | student portal reads |
| 10 | `20260712000009_phase2_portal_access_lifecycle.sql` | requires 8; additive; explicitly transactional (BEGIN/COMMIT); two service-role-only SECURITY DEFINER functions (`provision_portal_access`, `revoke_portal_access`); **MUST be applied before inviting or renewing ANY portal account** (the invite endpoint now provisions through the RPC) | failure-safe portal provisioning, renewal, revocation |
| 11 | `20260712000010_phase2_portal_role_enablement.sql` | requires 9; CHECK-constraint widening only (adds `portal` to `user_profiles_role_check`, keeping owner/admin/interviewer/viewer); no data, no conversion; **MUST be applied before inviting any portal account** (provisioning sets `role='portal'`, which the live CHECK rejects until this runs) | portal profile role accepted |
| 12 | `20260712000011_phase3_unit_portal.sql` | requires 8 | unit leader portal reads, released_reports |
| 13 | `20260712000012_phase4_school_portal.sql` | requires 8 and 12; contains the ONE backfill (students.school_id, fills NULLs only) | academic partner portal, schools |
| 14 | `20260712000013_phase5_public_metrics.sql` | requires 1; additive, seeds nothing | public metrics workflow |
| 15 | `20260712000014_phase0b_wave_f2_student_files_private.sql` | **DO NOT RUN until the Wave F-2 code prerequisite below is deployed and verified** | closes F7 (public resume bucket) |

All files under `supabase/migrations/`. Each ends with its own verification
queries and (waves) a rollback section. Prior-wave reverts also live in
`db/audit/phase0b_reverts.sql`.

## Wave F-1 live-state reconciliation (F8 close, done in the migration)

Wave F-1 was reconciled against production and now, in the migration itself:

- Revokes PUBLIC and anon EXECUTE from every public SECURITY DEFINER function
  including the two school-form functions (they previously kept PUBLIC), then
  re-grants anon only to `school_form_requires_password` and
  `verify_school_form_password`, authenticated to the approved staff/self
  allowlist, and service_role to all.
- Sets a fixed `search_path = public, pg_catalog` on nine functions.
- Adds the required INTERNAL authorization gate to five dashboard-created
  functions, using their exact live bodies captured from production
  (`pg_get_functiondef`), so the repository is the source of truth:
  `get_all_user_profiles` and the interviewer-mutation RPCs (`add_interviewer`,
  `update_interviewer_color`, `update_interviewer_email`) gate to
  `is_owner_or_admin()`; `get_active_interviewers` gates to `is_staff()`.
  `is_current_user_owner` is a self-check and is intentionally left ungated.

Because these gates are now applied by Wave F-1, no separate pre-Phase-2 gate
step remains for these functions. `record_student_disposition`,
`clear_student_disposition`, and `complete_disposition_followup` already gate
internally (verified in the tracked migrations). Before inviting any portal
user, still confirm no NEW untracked SECURITY DEFINER function exposing
staff-wide data has appeared since this reconciliation.

## Which migrations gate which invitations

No portal account may be created (api/invite-portal-user) until its
prerequisites are applied AND the F8 internal-gate confirmation above is done.
Every invitation now provisions through `provision_portal_access` (file 10) and
sets `role='portal'`, which the role CHECK rejects until the role-enablement
migration (file 11) runs. Both are required for ALL roles.

- Invite a STUDENT: files 1 through 11 applied. (Provisioning RPC, role
  enablement, the Phase 2 foundation, and the student views.)
- Invite a UNIT LEADER: files 1 through 8 plus 10, 11, and 12 applied.
  (Provisioning RPC, role enablement, the Phase 2 foundation, and the Phase 3
  unit views/released_reports.)
- Invite an ACADEMIC PARTNER: files 1 through 8, 10, 11, 12, and 13 applied.
  (Provisioning RPC, role enablement, the Phase 3 released_reports dependency,
  and the schools normalization plus its scoped report view.)

In all three cases the security floor (files 1 through 7) MUST be in place
first; never invite an external account while any broad anon/authenticated
policy from F1/F2/F6 remains.

## Wave F-2 code prerequisite (blocks file 13 only)

File 13 makes student-files private. It must NOT run until an application
replacement is deployed and verified. That replacement is a separate,
guarded change (not in this package; it needs authorized-upload and
signed-download flows that can only be verified against real storage):

1. Public intake upload -> a signed-upload-URL endpoint (resolve the student
   server-side, issue createSignedUploadUrl for `cohortId/studentId/<file>`),
   storing the object PATH, not a public URL. Sites:
   `src/components/StudentIntakeFormPage.jsx` (2 uploads + getPublicUrl).
2. Staff upload -> keep under the authenticated staff session (Wave F-2's
   INSERT policy authorizes it), store the PATH. Sites:
   `src/components/StudentSidePanel.jsx`, `src/components/StudentRow.jsx`.
3. Rendering -> getPublicUrl() becomes createSignedUrl() everywhere
   resume_url/headshot_url is shown, with a compatibility shim for
   already-stored public-URL values until a backfill converts them to paths.
   The stored-value backfill touches production data and is its own gated step.

Until that ships, files 1 through 12 fully harden the database; file 13 waits.

## After application

1. Return the verification query outputs from each file.
2. Staff regression: log in as each staff role (especially viewer and
   interviewer), open every tab, dismiss the onboarding tour, upload an
   avatar, open a rubric session, record and clear a disposition.
3. Public forms smoke test (logged out): /student-form end to end,
   /unit-form pre-fill and submit, /school-form password gate,
   /interview-schedule, /shift-log, one tokenized evaluation link.
4. Pilot: invite ONE controlled account per role (guarded workflow), verify it
   sees only its own scope and that a staff account sees zero rows through the
   portal_my_* views, then decide on broader rollout.
5. Preceptor assignment integrity: after this package, and after ANY future
   manual SQL session that touches students, preceptors,
   student_preceptor_assignments, or matches, run the read-only
   `db/audit/preceptor_parity_check.sql` and confirm the summary shows match
   rows only (zero mismatch_changed, mismatch_cleared, or missing) and the
   duplicate-active-primary check returns zero rows. Any other result is
   out-of-band drift; investigate before closing the session.

## Wave E residual-policy correction (Wave E-2)

Wave E was applied to production. Production verification then found that 14
broad `authenticated` policies survived it, because Wave E's `DROP POLICY`
statements used the repository-assumed names (`authenticated_all_<table>`)
while the LIVE policies were dashboard-created under the names
`Authenticated full access on <table>` (13 tables, FOR ALL true/true) and
`Authenticated users can insert logs` (activity_logs, INSERT WITH CHECK true).
`DROP POLICY IF EXISTS` on a non-matching name is a silent no-op, so those
permissive policies remained and, combining with OR, defeat the new
`is_staff()` restrictions. Wave E's `CREATE` statements all succeeded, so the
staff policies exist alongside the residual ones.

Follow-up migration (file 6 in the application order above):
`supabase/migrations/20260712000005_phase0b_wave_e2_residual_authenticated_policy_cleanup.sql`
drops the 14 residual policies by their exact live names (plus the assumed
variants, defensively). It creates nothing and changes no grants. It is
versioned `...000005` so it sorts immediately after Wave E (`...000004`) and
before Wave F-1 and every Phase 2 or later migration. The unapplied Wave F-1
and Phase 2 through Phase 5 files were re-versioned so that lexicographic
filename order now matches the roadmap exactly (Wave E-2 `...000005`, Wave F-1
`...000006`, Phase 2 authz `...000007`, Phase 2 views `...000008`, Phase 2
lifecycle `...000009`, Phase 2 role enablement `...000010`, Phase 3 `...000011`,
Phase 4 `...000012`, Phase 5 `...000013`, Wave F-2 `...000014`; the Phase 2
lifecycle migration was inserted at `...000009` and the Phase 2 role-enablement
migration at `...000010`, each shifting the later phases up by one). Apply it immediately AFTER Wave E and before inviting any
portal account. The Wave E migration file itself is left unchanged (it was
already applied); this note records the discovery and the required correction.
Revert lives in
`db/audit/phase0b_reverts.sql`, section Wave E-2.

## Phase 2 authorization foundation (file 8) notes

- The migration is now explicitly transactional (`BEGIN;` before the first DDL,
  `COMMIT;` after the last grant; the verification queries stay outside the
  transaction). It contains non-idempotent `CREATE POLICY` statements, so it is
  atomic rather than relying on the SQL editor's implicit-transaction behavior.
  Run the whole file as one block; do not rerun it (rerunning would error on the
  existing policies).
- Expired-but-unrevoked grant renewal was reviewed. The partial unique indexes
  key on `revoked_at IS NULL`, so an expired but unrevoked `user_role_grants`,
  `user_unit_scopes`, or `user_school_scopes` row still occupies its active slot.
  The only writer, `api/invite-portal-user.js`, uses plain `INSERT`s with no
  update, upsert, or revoke-before-insert, and there is no renewal, extension,
  or revoke endpoint. Renewing an expired-but-unrevoked grant (or re-inviting a
  still-active portal user) therefore fails with a uniqueness error surfaced as
  a 500 after the auth invite and profile update already ran (a partial state).
  Reinvitation after an explicit revocation (`revoked_at` set) works, because a
  revoked row frees the slot.
- REQUIRED before reinviting or renewing any portal user: add a renewal path
  (extend `expires_at` in place, or set `revoked_at` on the old grant before
  inserting the replacement, per the migration header), plus a pre-check in the
  invite endpoint that returns a clean 409 instead of a 500 partial. This
  foundation migration is safe to apply now; the renewal limitation must be
  resolved in application code before the first renewal or reinvitation.
- RESOLVED by file 10 (the Phase 2 access lifecycle migration) plus the
  refactored `api/invite-portal-user.js` and the new `api/revoke-portal-access.js`.
  See the next section.

## Phase 2 portal access lifecycle (file 10) notes

The renewal/revocation limitation recorded above is corrected by
`supabase/migrations/20260712000009_phase2_portal_access_lifecycle.sql` and the
matching application code. It is additive and explicitly transactional
(`BEGIN;`/`COMMIT;`); it creates no tables or policies.

- Two SECURITY DEFINER functions, both with `search_path = public, pg_catalog`
  and EXECUTE granted to `service_role` ONLY (PUBLIC, anon, and authenticated
  are revoked):
  - `provision_portal_access(...)` runs every database-side write (profile
    resolve/create, role grant, and the role's own student link or unit/school
    scopes) in ONE transaction. It creates, RENEWS (expired-unrevoked slot
    revoked then re-granted; reissued after a prior revoke; or an intentionally
    changed `expires_at` updated in place), or idempotently REUSES each row, so
    re-inviting or renewing a portal user no longer fails on the active-slot
    partial unique indexes. A student row already linked to a DIFFERENT active
    profile raises `PT409`; the same profile's own re-invite is idempotent. The
    three-identity model is preserved (profile `id` is never forced to equal
    `auth_user_id`), and `role='portal'` is set only when the profile is not an
    existing staff account.
  - `revoke_portal_access(...)` sets `revoked_at`/`revoked_by` on the active
    grant and, when cascading, on that role's own links/scopes. It NEVER
    deletes, never touches unrelated roles or assignments, and is idempotent
    (already-revoked is a success).
- `api/invite-portal-user.js` now invites or LOCATES the auth user, then calls
  `provision_portal_access` for all authorization writes (never four separate
  inserts). It pre-checks the student-link conflict before any auth work
  (clean 409, not a partial 500), and if the RPC fails after THIS request
  created the auth user, it deletes only that newly created auth user
  (compensation); a pre-existing auth user and any `user_profiles` row are never
  deleted. Status codes: 201 new account, 200 renewal/idempotent, 409 conflict,
  400 invalid, 401/403 caller-auth, 500 unexpected.
- `api/revoke-portal-access.js` is a new Owner/Admin endpoint that calls
  `revoke_portal_access`. It never deletes the auth user or the profile.
- DEPLOY ORDER before the pilot: apply file 10 AND deploy the refactored invite
  endpoint plus the new revoke endpoint before inviting, renewing, or revoking
  any portal account. The invite endpoint fails closed (500) if the RPC is not
  yet present.
- CHECK-constraint blocker (CONFIRMED live, RESOLVED by file 11): the live
  `user_profiles_role_check` allowed only `owner`, `admin`, `interviewer`,
  `viewer`, so provisioning `role='portal'` failed. File 11 (the role-enablement
  migration) widens the CHECK to add `portal`. See the next section.

## Phase 2 portal role enablement (file 11) notes

`supabase/migrations/20260712000010_phase2_portal_role_enablement.sql` drops and
re-adds `user_profiles_role_check` (same constraint name) to allow exactly five
roles: `owner`, `admin`, `interviewer`, `viewer`, `portal`. It is explicitly
transactional, inserts no data, converts no existing profile, and creates no
table, policy, function, or grant. Applying it does NOT activate any portal
account.

- Allowed roles after this migration: `owner`, `admin`, `interviewer`, `viewer`,
  `portal`. NULL role remains permitted (a CHECK passes on NULL), exactly as
  before. `co_lead`/`co-lead` were NOT in the live CHECK and are not added.
- NOT a staff role: `is_staff()` (owner, admin, co_lead, co-lead, interviewer,
  viewer) and `is_owner_or_admin()` (owner, admin) do not list `portal`, and the
  client `PORTAL_STAFF_ROLES` list (`src/App.jsx`) does not either. A
  `role='portal'` profile enters PortalApp, and with no active authorization
  grant it sees no portal data.
- No escalation path (audited): Phase 0B Wave E (applied) already revoked
  table-level UPDATE on `user_profiles` from `authenticated` and granted only a
  COLUMN-level UPDATE on the cosmetic self-service columns (`avatar_url`,
  `onboarding_tour_*`, `last_login_at`). `role`, `is_owner`, `is_active`,
  `can_conduct_interviews`, and `login_enabled` are not client-writable, so a
  portal user cannot self-promote. Widening the CHECK confers no privilege; only
  the service-role, Owner/Admin-gated `provision_portal_access` writes
  `role='portal'`. Avatar and Connect-signature self-service (the
  `update_my_avatar` and `update_my_connect_signature` RPCs, plus the avatar_url
  column grant) are unaffected.
- REQUIRED before any portal invitation: apply file 11 (in addition to file 10).
  Until it runs, `provision_portal_access` rolls back on the role write and the
  invite endpoint compensates any newly created auth user, so no partial account
  is left, but no portal account can be created.

## Accounts & Access directory (Owner-facing portal management UI)

Settings → Accounts & Access is now a scalable access directory
(`src/components/settings/AccountsDirectory.jsx`), replacing the former
role-grouped profile-card board. It is Owner/Admin-only (registry-hidden
otherwise, and every endpoint authorizes server-side regardless of client
visibility).

- Three tabs, staff and portal kept separate:
  - **Staff Access**: staff accounts from `get_all_user_profiles`; management via
    the existing `/api/admin-users` operations (unchanged payloads). The staff
    invite modal (`/api/invite-user`, renamed action "Invite Staff User") offers
    ONLY staff roles (admin, co-lead, interviewer, viewer). Portal roles never
    appear in the staff selector.
  - **Portal Access**: student, unit_leader, academic_partner grants with derived
    status (Active / Scheduled / Expired / Revoked), scope summary, and
    expiration. Data comes ONLY from the new listing endpoint.
  - **Pending Invitations**: portal invitations not yet accepted, derived from the
    auth admin API when reachable; an honest unavailable/empty state otherwise
    (staff acceptance state is not exposed by the staff data source, so it is not
    inferred).
- Summary indicators: Staff, Portal Users, Pending Invitations, Expiring Soon
  (active grants expiring within 30 days). Counts come from authorized sources
  only (staff RPC + the listing endpoint), never a direct browser read of the
  authorization tables.
- **New endpoint `GET /api/list-portal-access`**: Owner/Admin, service-role on the
  server, read-only, paginated, with search/role/status filters. Returns
  sanitized per-grant summaries (full_name, email, portal_role, status,
  starts_at, expires_at, resolved scope, `grant_id`, and `user_profile_id` solely
  so the client can submit a revoke). It never returns internal auth identifiers,
  revoker ids, tokens, or raw db errors, and performs no mutation. Historical
  (revoked/expired) grants are retained as separate records.
- **Grant Portal Access** modal (`GrantPortalAccessModal`) submits only through
  `POST /api/invite-portal-user` with the role-specific payload (student_id /
  unit_keys / school_keys, optional cohort_id, optional expires_at). It has a
  review step, prevents duplicate submission, and surfaces 201/200(grant_action)/
  409/400/401/403/500 with sanitized messages. The login email is explained as
  independent of the linked student record's email.
- **Renewal / Edit** reuses `POST /api/invite-portal-user` (backend idempotency:
  created | reused | renewed | reissued); no duplicate active grants are created
  in browser logic.
- **Revoke** (details drawer) uses `POST /api/revoke-portal-access` with a
  confirmation that states the sign-in identity and profile are not deleted,
  history is preserved, and only the selected role/scope closes. Repeat revoke is
  idempotent. The revoked row stays visible as history.
- **No browser authorization-table access**: the directory, grant modal, and
  drawer never read or write `user_role_grants`, `user_student_links`,
  `user_unit_scopes`, or `user_school_scopes`. The student selector reads the
  staff-authorized `students`/`cohorts` tables only (not authorization tables).
- The right-side details drawer traps focus, returns focus to the opening row,
  closes on Escape when no destructive confirmation is pending, and never renders
  internal identifiers.

**Pilot status: the Walden pilot account remains uncreated.** No portal account,
grant, link, or scope was created by this UI work. The exact next pilot step is
unchanged: the Owner applies files 10 and 11 (already applied in production per
the current state), then uses **Grant Portal Access → Student** to invite the one
designated pilot student through `/api/invite-portal-user`, and verifies scope
with the runbook queries in the pre-pilot verification section.

## First migration to run after approval

File 1, `supabase/migrations/20260712000000_phase0b_wave_a_is_staff_helper.sql`
(additive, no behavior change). It creates is_staff(), which Waves E and F-1
depend on.

## Follow-up: Academic Partner placement provenance (independent of the ordered list above)

**File:** `supabase/migrations/20260727000000_add_academic_partner_placement_provenance.sql`
**Gate notes:** additive; three nullable columns on `public.students` plus one
CHECK constraint; idempotent (IF NOT EXISTS columns, drop-then-add constraint);
no data conversion, no backfill; not dependent on any un-applied file above (the
`students` table and `user_profiles` already exist in production).
**Unlocks:** authenticated Academic Partner placement submission.

### Why it is required
Enabling authenticated Academic Partner placement submission requires recording
WHICH authenticated profile submitted a request, without omitting provenance. The
server code fails closed (`submission_not_enabled`) until these columns exist, so
the feature cannot write a partial or unattributed request. The existing
`students.submitted_via` (original source) is NOT changed by this migration.

### Exact SQL to apply
Run the whole file as one block in the Supabase SQL editor. Its body:

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

### No-backfill behavior
Existing rows keep NULL in all three columns until their next successful
placement submission (public `/school-form` or the Academic Partner portal)
refreshes them. This is expected and correct; a full append-only submission
history is deferred.

### Rollback considerations
Reversible with no data loss beyond the latest-submission provenance (the
original `submitted_via` is untouched):
```sql
ALTER TABLE public.students DROP CONSTRAINT IF EXISTS chk_students_placement_request_last_source;
ALTER TABLE public.students
  DROP COLUMN IF EXISTS placement_request_last_source,
  DROP COLUMN IF EXISTS placement_request_last_submitted_by_profile_id,
  DROP COLUMN IF EXISTS placement_request_last_submitted_at;
```

### Enablement sequence
1. Apply the migration file above via the Owner SQL gate; run the verification query.
2. PostgREST reloads its schema automatically (usually within seconds); the server
   readiness probe then sees the columns.
3. No code deploy is required: the server auto-detects readiness and enables the
   authenticated POST; the workspace submit control enables from the server's
   `submission_enabled` signal. Public `/school-form` also begins recording the
   latest-submission provenance from that point.
4. Verify with the live QC checklist in
   `docs/product/ACADEMIC_PARTNER_PLACEMENT_REQUESTS_HANDOFF.md`.

## Follow-up: Messages Phase 0 correctness (independent of the ordered list above)

**File:** `supabase/migrations/20260730000001_messages_phase0_correctness.sql`
**Gate notes:** explicitly transactional (BEGIN/COMMIT) - both RPC replacements
and every privilege statement apply atomically; function redefinitions only
(`messages_post_reply` in place, NEW `messages_portal_list_conversations_v2`);
no table/column changes, no data conversion, NO UPDATE or DELETE on
`public.messages` or `public.conversation_events` (append-only preserved); not
dependent on any un-applied file above (requires only the already-applied
Messages foundation, 20260716000000 through 20260728000000).
**Unlocks:** true portal reply authorship (student / unit_leader /
academic_partner persisted verbatim) and portal row unread counts matching the
global badge.

### Application and verification order
Run the numbered blocks from
[MESSAGES_PHASE0_VERIFICATION.md](MESSAGES_PHASE0_VERIFICATION.md), in order:

1. **Prechecks** (section 1; read-only) - confirm the live `messages_post_reply`
   still lacks `academic_partner` and that
   `messages_portal_list_conversations_v2` does not exist.
2. **Migration** (the WHOLE file as one block) - it is a single transaction.
3. **Historical audit** (section 2; read-only) - record the mislabeled-row
   counts; per the Phase 0 decision the correction is NOT performed.
4. **Postchecks** (section 4; read-only) - four-kind CHECK present; v2 exists
   with EXECUTE for `authenticated` and `service_role` and NOT for `anon` or
   PUBLIC; no UPDATE/DELETE/TRUNCATE table grants on the two append-only tables
   in schema `public`.

APPLIED IN PRODUCTION 2026-07-29 with all verification blocks passing (see the
production record in MESSAGES_PHASE0_VERIFICATION.md; historical audit found
ZERO mislabeled rows). Deployment note (corrected): the application must ALSO
deploy the Phase 0 code commit before the fixes take effect - the migration
alone is inert to the running app. Ordering is safe either way; once the code
is live it detects v2 at runtime and its pre-migration fallback goes dead.
Rollback: v1 list function is untouched (the API falls back to it if v2 is
dropped); `messages_post_reply` rolls back by re-running its prior definition
from `20260720000000_unit_leader_portal_foundation.sql`.

## Follow-up: Messages Lifecycle Phase 1, archive (independent of the ordered list above)

**File:** `supabase/migrations/20260730000002_messages_phase1_archive.sql`
**Gate notes:** explicitly transactional (BEGIN/COMMIT) - the new table, the
new RPC, both new v3 list functions, and all THREE function redefinitions
apply atomically; additive (one new table, one new RPC, two new list
functions) plus three REDEFINED (CREATE OR REPLACE, same name) functions:
`messages_staff_unread_count` and `messages_portal_unread_count` (one added
`AND NOT EXISTS` clause each) and `messages_post_reply` (a race-safety fix,
detailed below - NOT a behavior change to authorization, reopen, the message
insert, the read pointer, or the delivery row, all of which are byte-identical
to its live Phase 0 definition). No existing table is altered, no row is
rewritten, no data conversion; NO UPDATE or DELETE on `public.messages` or
`public.conversation_events` (append-only preserved); not dependent on any
un-applied file above (requires only the already-applied Messages foundation,
`20260716000000` through `20260730000001`).
**Unlocks:** per-user conversation archive/unarchive for staff and portal
Messages, with a derived (not stored) archive state so a new message
automatically returns an archived thread to Active with no write and no race.

### Race-safety fix (added after initial review)

The bare derived-archive comparison (`archived_at >= last_message_at`) is not
race-free by itself, because Postgres `now()` is TRANSACTION-START time, not
commit time: a reply transaction that began before an archive transaction but
commits after it could otherwise stamp its message with a `now()` captured
before the archive, writing an OLDER `last_message_at` than the archive's
`archived_at` and leaving a newly-replied-to thread stuck archived. The fix
locks the SAME conversation row (`SELECT ... FOR UPDATE`) in both
`messages_set_conversation_archived` and (now also redefined here)
`messages_post_reply` before either derives any timestamp, serializing the two
writers, and each then derives its timestamp with `GREATEST(...)` against the
other side's already-committed state rather than a bare clock read. Per the
reply-path audit in section 2 of
[MESSAGES_ARCHIVE_VERIFICATION.md](MESSAGES_ARCHIVE_VERIFICATION.md), every
append to an EXISTING conversation flows through `messages_post_reply`, so
locking exactly these two functions is sufficient.

### Application and verification order
Run the numbered blocks from
[MESSAGES_ARCHIVE_VERIFICATION.md](MESSAGES_ARCHIVE_VERIFICATION.md), in order:

1. **Prechecks** (section 1; read-only) - confirm
   `message_conversation_visibility`, `messages_set_conversation_archived`,
   `messages_staff_list_conversations_v3`, and
   `messages_portal_list_conversations_v3` do not exist yet; that the current
   unread-count bodies do not reference the visibility table; and that the
   current `messages_post_reply` is still its Phase 0 shape (no `FOR UPDATE`,
   no reference to the visibility table).
2. **Migration** (section 2; the WHOLE file as one block) - it is a single
   transaction.
3. **Postchecks** (section 3; read-only) - table RLS enabled with zero
   policies; table grants are service_role only; the archive RPC is
   service_role-only EXECUTE; both v3 functions carry the standard
   authenticated + service_role read-RPC grant with anon and PUBLIC absent
   (via `aclexplode`); v1/v2 of every list RPC and both prior unread-count
   functions remain present and unchanged; append-only grants on `messages`
   and `conversation_events` are unchanged; `messages_post_reply` now locks the
   conversation row and derives `v_now` with the race-safe `GREATEST(...)`,
   with its grant matrix unchanged (service-role only).
4. **Behavior probe** (section 4; read-only) - spot-check the derived
   `is_archived` rule against one real conversation/profile pair, and (section
   4c) walk through the two-session interleaving reproduction.

Deployment note: the application must ALSO deploy this code commit before the
archive action and the `view` filter take effect - the migration alone is
inert to the running app. Ordering is safe either way: pre-deploy, the app
keeps calling v2/v1 exactly as it does today; pre-migration (post-deploy), the
list endpoints detect the v3 absence and report `archive_available: false`,
and the archive endpoints return `503 { error: 'archive_not_ready' }`. Once
both are live, the endpoints detect v3/the archive RPC at runtime and every
pre-migration fallback becomes dead code. The race-safety fix inside
`messages_post_reply` takes effect the moment this migration is applied,
independent of the code deploy - it changes only how the SQL derives a
timestamp, never a request or response shape.

Rollback: full statements (including the two prior unread-count definitions
AND the prior `messages_post_reply` definition, all inline for copy-paste) are
in section 5 of
[MESSAGES_ARCHIVE_VERIFICATION.md](MESSAGES_ARCHIVE_VERIFICATION.md). Dropping
the new table discards only archive/unarchive UI state; no message or
conversation_events row is ever affected, and v1/v2 of every list RPC keep the
API serving requests throughout.

## Follow-up: Messages lifecycle Phase 2, purge posture (documentation only)

Policy and Owner runbook:
[MESSAGES_PURGE_POSTURE.md](MESSAGES_PURGE_POSTURE.md)

There is NOTHING to apply for this entry: no migration, no code change, no
grant change, and no data change. The document defines when a permanent purge
of Messages conversations is justified (explicitly identified test
conversations; separately-planned legal-erasure or security-exposure cases),
who may authorize and execute one (the Owner only, in the SQL editor as the
database owner; no application role holds DELETE and none is being granted),
and the exact runbook: pinned-UUID scoping, read-only prechecks and impact
preview, export before deletion, a single guarded transaction whose default
outcome is ROLLBACK, post-commit zero-count verification, and a mandatory
authorization-and-execution record inside the document itself.

Any actual purge in the future is executed directly from that runbook, with
its section 7 record standing in for the per-migration records used elsewhere
in this gate.

## Follow-up: Messages Phase 3A, reactions (independent of the ordered list above)

Migration file (paste WHOLE into the SQL editor, one block):
`supabase/migrations/20260801000000_messages_phase3a_reactions.sql`

Verification and rollback:
[MESSAGES_REACTIONS_VERIFICATION.md](MESSAGES_REACTIONS_VERIFICATION.md)

What it adds: `message_reactions` (per-user, one reaction per user per
message, closed allowlist acknowledge/thanks/celebrate, CASCADE from
messages, RLS zero-policy, service-role-only grants), the service-role write
RPC `messages_set_message_reaction`, and thread RPCs
`messages_staff_get_thread_v3` / `messages_portal_get_thread_v3` (v2 behavior
verbatim plus a per-message `reactions` aggregation). Both v2 thread
functions are retained untouched for rollback and fallback.

Boundary: reactions write ONLY the new table. The migration never references
`last_message_at`, the read-pointer tables, archive visibility,
`conversation_events`, or `message_notification_deliveries` inside the
reaction RPC, and the delivery `event_type` CHECK is not extended, so a
reaction can never change unread counts, resurface an archived thread, emit
an event, or send an email. Verification section 3 proves this against the
deployed definitions.

Deployment note: ordering is safe either way. Pre-migration, the deployed
thread endpoints fall back to v2 (PGRST202/42883 probes) and report
`reactions_available: false`, so no reaction UI renders, and the reaction
endpoints return `503 { error: 'reactions_not_ready' }`. Pre-deploy, the new
functions sit unused. Once both are live the UI appears on its own.

Related documentation updated in the same commit: the purge runbook
([MESSAGES_PURGE_POSTURE.md](MESSAGES_PURGE_POSTURE.md)) now includes
`message_reactions` in its FK web, impact preview, export, and verification
blocks (it cascades with `messages`, so the purge transaction itself needed
no new DELETE).

---

## Migrations added since 2026-08-02 (ledger update, 2026-08-27)

This section was reconstructed from `git log` during the 2026-08-27 security
remediation status audit, because the ledger above had gone stale and the
continuity record had already been wrong once about applied state (Wave F-2
Pass 3 was reviewed for application a month after it had run). Rules for this
section:

- Applied state is NOT knowable from the repository. Every row below is
  UNKNOWN until the Owner confirms it against production and edits this file.
- Confirm applied state with each migration's own verification queries (most
  carry them inline or in a companion `db/audit/` file), not by memory.
- When confirmed, replace UNKNOWN with APPLIED YYYY-MM-DD or NOT APPLIED, in
  the same sitting as the confirmation.
- Topped up 2026-08-29 with the three migrations added by the parallel session
  (20260830000000, 20260831000000, 20260901000000) plus 20260902000000. The
  commit and date columns come from `git log`; the applied state does not, and
  is UNKNOWN for the first three exactly as the rule above requires.
- Completed 2026-09-24 (SECURITY-RECORDS-1): ten tracked migrations had no row here
  at all. Each now has one. A row reads APPLIED only where another record in this
  repository proves it (a later ledger row's check that could not have passed without
  it, or a source file that records the confirmation); it names that record. The rest
  read UNKNOWN until the Owner confirms them against production.
- Reconciled 2026-09-15 (SQL-LOG-RECONCILE-1): the Owner ran the one read-only
  query in db/audit/sql_log_reconciliation_20260915.sql against production. All 23
  rows that still read UNKNOWN returned applied = true with every piece of evidence
  true, so each is now APPLIED. The apply dates were never recorded and are not
  recoverable from the repository; the confirmation date is the reconciliation date.

| Migration | Added (commit, date) | Applied state |
|---|---|---|
| 20260803000000_phase2d_clear_primary_preceptor.sql | b74e4c6, 2026-08-03 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: function clear_primary_preceptor |
| 20260804000000_portal_invitation_events.sql | 3cec9c6, 2026-08-03 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: table portal_invitation_events; policy portal_invitation_events_owner_admin_read |
| 20260805000001_keith_p0_foundations_and_skills.sql | 589ea10, 2026-08-05 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: table keith_requests; table keith_skills; table keith_skill_invocations; function keith_activate_skill; trigger trg_keith_skills_updated_at |
| 20260805000002_program_events_rls_lockdown.sql | 589ea10, 2026-08-05 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: table program_events_rls_lockdown_runs; function is_staff_event_writer; policy staff_select_program_events |
| 20260807000001_knowledge_vault_markdown.sql | 9974e56, 2026-08-07 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: column knowledge_entries.body_format; column knowledge_entries.superseded_by; table knowledge_links; function governance_restore_knowledge_version |
| 20260811000000_preceptor_certificate_foundation.sql | bf3a9a8, 2026-08-10 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: table preceptor_certificates; table preceptor_certificate_sequences; function issue_preceptor_certificate |
| 20260814000000_message_archive_content_kinds.sql | fd08ed5, 2026-08-14 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: check chk_message_archive_content_kind lists more than one kind |
| 20260815000000_evaluation_reminder_deliveries.sql | 1f0987d, 2026-08-15 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: table evaluation_reminder_deliveries; function claim_evaluation_reminders |
| 20260816000000_student_unit_assignments.sql | bb5e83c, 2026-08-15 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: table student_unit_assignments; trigger trg_sua_enforce_unit_identity; policy student_unit_assignments_owner_admin_read |
| 20260817000000_student_unit_assignment_sync.sql | a8a216c, 2026-08-15 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: function set_primary_unit_assignment; function sua_sync_ready; trigger trg_sync_assignments_from_matched_unit; trigger trg_sync_matched_unit_from_assignments |
| 20260818000000_shift_log_review.sql | 8014c5e, 2026-08-15 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: table shift_log_reviews; function review_shift_log; function submit_past_shift_log; policy staff_select_students |
| 20260819000000_student_shift_log_self_service.sql | 4f641ef, 2026-08-16 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: table student_shift_log_edits; function student_edit_shift_log; function student_void_shift_log; view portal_my_shift_logs; check chk_ssl_lifecycle_state |
| 20260820000000_preceptor_shift_projection.sql | 6803b43, 2026-08-16 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: function preceptor_projected_shift; table preceptor_projection_backfill_audit; trigger trg_sync_students_from_preceptor_record |
| 20260821000000_outreach_attachment_uploads.sql | committed 2026-08-27 (this ledger sitting) | NOT APPLIED, and correct so: DESIGN ONLY for the Phase 2 ad-hoc attachment feature, which was never built. No code references the outreach_attachments table or bucket. Apply only if that feature is ever taken up; its verification block is inline |
| 20260821130000_automatic_student_completion.sql | 2a0eed2, 2026-08-21 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: function reconcile_student_completions; trigger reconcile_students_after_cohort_completion; trigger reconcile_student_after_completion_input; trigger reconcile_students_after_rotation_date |
| 20260822000000_student_activity_completions.sql | ee9e175, 2026-08-17 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: table student_activity_completions; policy sac_owner_admin_read |
| 20260822010000_interview_rubric_authorization.sql | bc77cdb, 2026-08-21 | APPLIED, confirmed 2026-08-27. Verified by the seven read-only sections printed in the 2026-08-27 status sitting: interviewer_profile_id column + idx_interview_rubrics_profile_cohort present, all four functions SECURITY DEFINER with pinned search_path, EXECUTE held by authenticated/service_role only (no anon/PUBLIC), RLS enabled, no legacy or catch-all policy remaining, exactly the four _own_or_privileged policies |
| 20260822020000_wave_e_write_policy_split.sql | 8494615, 2026-08-22 | APPLIED, confirmed 2026-08-27 via POST 1 to 10 of db/audit/wave_e_write_split_preflight_and_verification.sql (is_active_staff_writer present with correct grants, each split table showing SELECT + writer policies and no FOR ALL, the three self-service tables untouched, trigger and unique index present). Its POST 1 is what surfaced the out-of-band interviewers policy, closed by 20260822030000 below |
| 20260822030000_drop_interviewers_full_access_policy.sql | 2571974, 2026-08-22 | APPLIED, confirmed 2026-08-27 via POST 1 to 5 of db/audit/interviewers_full_access_preflight_and_verification.sql (policy gone, no USING (true) or TO public policy remains on interviewers, expected policy set only, grants and row count unchanged). The Wave E writer policies on interviewers are therefore now in effect |
| 20260824000000_nursing_academics_portal_foundation.sql | 8cf628f, 2026-08-24 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: role check allows nursing_academic; table community_benefit_rates; table community_benefit_capstone_hours; function set_community_benefit_rate; column students.course_type |
| 20260825000000_nursing_academic_contacts_editor.sql | 374f113, 2026-08-25 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: column user_role_grants.contacts_access; check user_role_grants_contacts_access_check |
| 20260826000000_contacts_canonicalization.sql | b2dee20, 2026-08-25 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: check chk_contacts_category; column contacts.services; column contacts.preferred_contact_method dropped |
| 20260827000000_cohort_completed_at.sql | 5c27f60, 2026-08-26 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: column cohorts.completed_at; function stamp_cohort_completed_at; trigger stamp_cohort_completed_at |
| 20260828000000_enable_nursing_academic_portal_utilities.sql | 15e45b7, 2026-08-27 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: function na_portal_utilities_capability; function messages_start_general_team_conversation_na; function submit_portal_feedback_report; check chk_portal_feedback_role allows nursing_academic |
| 20260829000000_contacts_divisions.sql | CONTACT-DIVISIONS, 9ba92732, 2026-08-28 | **APPLIED (apply date not recorded), confirmed 2026-09-24 by the Owner.** Idempotent re-run: "Success. No rows returned." V1: divisions, ARRAY, NO, '{}'::text[]. V2: total 245, nulls 0, with_divisions 7. The 7 contacts already carrying divisions show the column was in use before this confirmation, so the original apply predates it. |
| 20260830000000_wcu_noho_fall2_split_repair.sql | ffccfd6, 2026-08-29 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: Winter 2027 rotation row for WCU North Hollywood |
| 20260831000000_wcu_anaheim_move_to_winter_2027.sql | ffccfd6, 2026-08-29 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: WCU Anaheim rotation row in Winter 2027; no WCU Anaheim rotation row left in Fall 2026 |
| 20260901000000_winter_2027_unit_carryover_and_juliana.sql | a848ee5, 2026-08-29 | APPLIED (apply date not recorded), confirmed 2026-09-15 via db/audit/sql_log_reconciliation_20260915.sql, every check true: Winter 2027 has units; Juliana Pilla has a Winter 2027 student row |
| 20260901010000_student_rotation_activity.sql | ROTATION-ACTIVITY, dd329edb, 2026-09-01 | APPLIED (apply date not recorded; row added 2026-09-24, SECURITY-RECORDS-1), proven by a later migration: `20260921000000_demo_mode_foundation.sql` adds `is_demo` to `student_shift_plans` (the table this migration creates), and `src/lib/demoBoundaryFlag.js` records that migration applied and confirmed on 2026-09-17 with all nineteen `is_demo` columns present. The table therefore existed in production by 2026-09-17; the functions were not separately checked. |
| 20260902000000_one_accepting_cohort.sql | 81bd79e, 2026-08-29 | APPLIED, confirmed 2026-08-29 via POST 1 and POST 2 of db/audit/one_accepting_cohort_checks.sql. POST 1 returned the index with both required halves present: `CREATE UNIQUE INDEX cohorts_one_accepting_submissions ON public.cohorts USING btree (accepting_submissions) WHERE (accepting_submissions = true)`. POST 2 returned accepting_count = 1. At most one cohort may now hold accepting_submissions = true. ON THE EVIDENCE: because the index is UNIQUE, the migration succeeding is itself proof that no more than one cohort was accepting at apply time, since creation would otherwise have failed. POST 1 was still required, because the migration uses CREATE UNIQUE INDEX IF NOT EXISTS, which would have reported success without complaint had an index of that name already existed with a different definition. PRE 2 exists to rule that out beforehand; POST 1 is what confirms it after the fact |
| 20260829000000_s22_is_owner_or_admin_requires_active.sql | 8762010, 2026-08-27 | APPLIED, confirmed 2026-08-29 via POST 1 to 5 of db/audit/s22_is_owner_or_admin_preflight_and_verification.sql (the predicate now delegates to is_active_owner_or_admin with its hardened attributes intact, both helpers agree for the session, every dependency unchanged from PRE 2, grants exclude anon and PUBLIC, and no second overload exists). S-22 closed. CORRECTION: PRE 4 showed is_owner_or_admin ALREADY held service_role EXECUTE before the migration, so the grant-parity step was a no-op; the migration header and the original discovery report both said otherwise |
| 20260903000000_ngrp_foundation.sql | NGRP-WORKSPACE-1, 1f7a6483 + 413c6a29, 2026-08-30 | APPLIED (apply date not recorded; row added 2026-09-24, SECURITY-RECORDS-1), proven by the ledger rows that depend on its tables: 20260904000000 (APPLIED, confirmed 2026-08-31) installs functions over ngrp_cycles and ngrp_candidates; 20260905000000's PRE 1 returned a row from ngrp_cycles and PRE 2 the `ngrp_cycles_status_check` this file creates (2026-09-02); 20260916000000's PRE 1 returned candidates true, outcomes true (2026-09-12). |
| 20260903010000_ngrp_residency_outcomes_revoke_delete.sql | NGRP-WORKSPACE-1, 09d37bc2, 2026-08-30 | APPLIED (apply date not recorded; row added 2026-09-24, SECURITY-RECORDS-1), confirmed 2026-09-14: POST 3 of `db/audit/ngrp_resident_details_checks.sql` (the 20260919000000 row) returned `delete_revoked false`, which is `has_table_privilege('service_role', 'public.ngrp_residency_outcomes', 'DELETE')` false, exactly this one-statement migration's effect. |
| 20260904000000_ngrp_planning_transition.sql | 3722e2d, 2026-08-31 | APPLIED, confirmed 2026-08-31 (8 tables + 10 transaction functions) |
| 20260905000000_ngrp_cycle_status_canon.sql | NGRP-CYCLE-STATUS-CANON, 2026-09-02 | **APPLIED, confirmed 2026-09-02** via PRE 1 to POST 4 of db/audit/ngrp_cycle_status_canon_checks.sql. PRE 1 returned a single cycle (Winter 2027) already on 'Planning', so the collapse rewrote ZERO rows and no phase information was lost; in practice this was pure constraint work. PRE 2 returned the expected `ngrp_cycles_status_check` with all nine old values, so the DROP targeted a real constraint rather than silently no-opping. POST 1 returned `ngrp_cycles_status_canon` naming exactly Planning, Active, Completed, Archived. POST 2 returned zero rows outside the canon. POST 3 matched PRE 1 unchanged. POST 4 raised `23514 new row for relation "ngrp_cycles" violates check constraint "ngrp_cycles_status_canon"`, which is its PASS condition: the constraint refuses an old value rather than merely existing. That error's DETAIL line shows the REJECTED candidate row, not stored data; the surrounding ROLLBACK means nothing was written |
| 20260906000000_ngrp_assignment_interview.sql | NGRP-PLACEMENT-BOARD-1, 6035a370, 2026-09-02 | **APPLIED, apply date unrecorded; confirmed 2026-09-10.** The Owner could not locate a record of running it, but a read-only check on 2026-09-10 returned interview_columns = 7 (assigned_unit, assigned_unit_at, assigned_by_profile_id, interview_status, interview_at, interview_recorded_by_profile_id, interview_recorded_at all present on ngrp_candidates). **DO NOT RE-RUN IT.** Its column work is IF NOT EXISTS and would no-op, but its audit section re-creates `ngrp_audit_events_event_type_check` with the OLDER list (ending at unit_assignment_cleared) and would silently drop the four event types 20260907000000 added. If it is ever re-run by accident, re-running 20260907000000 restores the full list |
| 20260907000000_ngrp_interview_hire_events.sql | NGRP-INTERVIEW-HIRE-1, 8bf65a83, 2026-09-02 | **APPLIED 2026-09-10 by the Owner**, confirmed the same day by the combined read-only check: interview_columns = 7, event_type_checks = 1 (exactly one CHECK on ngrp_audit_events.event_type, so no narrower copy survived the DROP), hire_events_allowed = true (the live constraint carries interview_recorded, offer_extended, offer_accepted, hire_recorded plus every earlier value). Safe to re-run: it drops and re-creates the constraint with the full list |
| 20260908000000_aspire_event_audiences.sql | EVENT-AUDIENCE-2, 2895d6f0, 2026-09-04 | APPLIED (apply date not recorded; row added 2026-09-24, SECURITY-RECORDS-1), confirmed before 2026-09-11: PRE 4 of the 20260911000000 row returned the four-role `aspire_events_audiences_check` (student, unit_leader, academic_partner, nursing_academic), the constraint this migration creates, before that migration re-created it with talent_acquisition. Checks: `db/audit/aspire_event_audiences_preflight_and_verification.sql`. |
| 20260910000000_fall_winter_capacity_rebalance.sql | CAPACITY-REBALANCE-1, 73e4c1d4, 2026-09-10 | **APPLIED, confirmed 2026-09-10** via V1 of db/audit/fall_winter_capacity_rebalance_verify.sql: Fall 2026 14 hosting units, 19 total slots, 19 filled, 0 open; Winter 2027 10 hosting units, 14 total, 0 filled, 14 open; backup_rows 44 (19 units + 19 responses + 6 outreach targets deactivated, two of them matched by canonical name). The Owner's first V1 attempt returned no rows because the copies inside the apply script are commented out; the verify file is the runnable one. Every changed row is in ops_backup.capacity_rebalance_20260910; the rollback is inline in the script |
| 20260911000000_residency_portal_talent_acquisition.sql | RESIDENCY-PORTAL-1, bc5486cd, 2026-09-10 | **APPLIED 2026-09-11 by the Owner.** PRE 4 returned the four-role aspire_events_audiences_check before applying (student, unit_leader, academic_partner, nursing_academic). The single-transaction apply returned "Success. No rows returned", so every statement committed: user_role_grants_role_check and aspire_events_audiences_check both re-created with talent_acquisition, and provision/revoke_portal_access re-declared (bodies byte-for-byte from 20260824000000 except the allowlists, pinned by test/residencyPortalFoundation.test.mjs). POST 3 grant counts afterwards: academic_partner 8, nursing_academic 2, student 19, unit_leader 3, no talent_acquisition row yet. Full checks: db/audit/residency_portal_talent_acquisition_checks.sql |
| 20260912000000_ngrp_preceptor_feedback_requests.sql | RESIDENCY-PORTAL-2b, ccd8d8fa, 2026-09-11 | **APPLIED 2026-09-11 by the Owner.** "Success. No rows returned." POST 1: both tables RLS on. POST 2: service_role only (events INSERT,SELECT; requests INSERT,SELECT,UPDATE). POST 3: both functions EXECUTE for service_role only (anon and authenticated false). POST 4: uq_ngrp_pf_requests_open and idx_evaluation_responses_form_type_student present. POST 5: 0 requests, 0 events. Additive and transactional: two server-only tables (requests, append-only access events), an evaluation_responses (form_type, student_id) index, and two SECURITY DEFINER functions executable by service_role only (ngrp_pf_request_tx, ngrp_pf_decide_tx; the Owner rule is checked in the function as well as the API). Safe in either deploy order: the app hides the feature until it is applied. Checks: db/audit/ngrp_preceptor_feedback_requests_checks.sql (PRE 1-4, POST 1-5) |
| 20260913000000_ngrp_preceptor_feedback_admin_decide.sql | RESIDENCY-PORTAL-2c, 8fbf381c, 2026-09-11 | **APPLIED 2026-09-11 by the Owner.** PRE 1: exists true, owner_only true, admits_admin false. Apply: "Success. No rows returned." POST 1: admits_admin true, still SECURITY DEFINER. POST 2: EXECUTE anon false, authenticated false, service_role true. POST 3: deciders are Jester Lloyd Bautista (owner, is_owner) and Krystal Rodriguez (admin). CREATE OR REPLACE of ngrp_pf_decide_tx only: the decider check widens from the Owner to the Owner or an Admin (the same rule as the request notification fan-out). Body, signature, and service_role-only EXECUTE otherwise unchanged. Either deploy order: until applied, an Admin's decision returns owner_required. Checks: db/audit/ngrp_preceptor_feedback_admin_decide_checks.sql (PRE 1, POST 1-3) |
| 20260914000000_ngrp_support.sql | RESIDENCY-SUPPORT-1, 29e1f715, 2026-09-11 | **APPLIED 2026-09-11 by the Owner.** PRE 1: entries NULL, mentors NULL, candidates true, cycles true. Apply: "Success. No rows returned." POST 1: both tables RLS on. POST 2: service_role only, INSERT,SELECT,UPDATE on both (no DELETE). POST 3: uq_ngrp_support_entry_live present. POST 4: 0 entries, 0 mentors. Additive and transactional: ngrp_support_entries (one row per activity per alumnus per day; voided, never deleted; partial unique index on live entries) and ngrp_resident_mentors (one assigned NPD-P per resident). RLS on, service_role SELECT/INSERT/UPDATE only, no DELETE for anyone. Either deploy order: the Support tab shows a placeholder until applied. Checks: db/audit/ngrp_support_checks.sql (PRE 1, POST 1-4) |
| 20260915000000_ngrp_outcome_cs_email.sql | RESIDENCY-SUPPORT-1, 4af84bc4, 2026-09-11 | **APPLIED 2026-09-11 by the Owner.** PRE 1: table true, cs_email_exists false. Apply: "Success. No rows returned." POST 1: cs_email text, nullable. POST 2: ngrp_residency_outcomes_cs_email_check in force (non-blank, <= 200 chars, looks like an address). POST 3: 0 recorded, 0 hires missing one (no hires recorded yet). One nullable column, ngrp_residency_outcomes.cs_email, with a shape CHECK: where residency correspondence goes once a resident is hired (Owner: never the school address; personal email is the backup). Either deploy order: the roster reads the column when present and falls back when absent. Checks: db/audit/ngrp_outcome_cs_email_checks.sql (PRE 1, POST 1-3) |
| 20260916000000_ngrp_not_proceeding_choices_outcome.sql | RESIDENCY-ROSTER-1, 279919bd, 2026-09-12 | **APPLIED 2026-09-12 by the Owner.** PRE 1: candidates true, outcomes true, new_columns 0. PRE 2: both constraints present in their pre-migration form (three-value status check, three-branch state-times). PRE 3 returned **NO ROWS**, which is the finding worth keeping: `ngrp_candidates` is EMPTY in production, so the withdrawn rewrite was a no-op and no candidate-level NGRP action has ever been recorded live. Apply: "Success. No rows returned." POST 1: all nine columns present and nullable. POST 2: all five constraints in force, state-times now four-branch, canon four-value. POST 3: see the correction below. POST 4: withdrawn_left 0, not_proceeding 0, missing_reason 0, missing_time 0, matching PRE 3. POST 5: both outcome constraints in force. POST 6: event_type_checks 1, keeps_hire_events true, learns_new true. **TWO CORRECTIONS TO THIS FILE'S POST 3, both mine, neither a database problem.** It first matched `'%application_status IN%'` and returned 0 rows against a correctly migrated database, because Postgres normalizes `IN (...)` to `= ANY (ARRAY[...])`: match the COLUMN NAME, never the syntax you wrote. Re-run corrected, it returned THREE rows, not the two the file predicted, because `ngrp_not_proceeding_requires_reason_time` names the column in its own body. The question POST 3 exists to answer is answered: `ngrp_candidates_application_status_check` is GONE, so exactly one vocabulary check survives and it carries all four values. A surviving three-value copy would have refused every not_proceeding write while the new canon looked perfectly healthy, since a row must satisfy EVERY check on its table. Additive and transactional, plus ONE small data rewrite. Adds to ngrp_candidates: not_proceeding_reason / _note / _at / _by_profile_id (the Owner's replacement for "Reject", reason required from an allowlist) and staff_unit_preferences / unit_preferences_set_by_profile_id / _at (a staff ranking beside the immutable submitted one). Adds to ngrp_residency_outcomes: not_selected_at and offer_declined_at, the two interview results the record could not hold. Widens the ngrp_candidates application_status CHECK to admit 'not_proceeding', rewrites existing 'withdrawn' rows to 'not_proceeding' with reason 'withdrew' keeping their original timestamp ('withdrawn' stays legal so nothing older breaks), and widens ngrp_audit_events_event_type_check with five event types while carrying every earlier value including the NGRP-INTERVIEW-HIRE-1 four. Either deploy order: the roster reads the new columns when they exist and falls back to the previous shape when they do not. Checks: db/audit/ngrp_not_proceeding_choices_outcome_checks.sql (PRE 1-3, POST 1-6). PRE 3 counts the rows the rewrite will touch; POST 4 must match it |
| 20260917000000_ngrp_reflections.sql | RESIDENCY-REFLECTION-1, 122ee8d4 + e3765e2d, 2026-09-13 | **APPLIED 2026-09-14 by the Owner.** PRE 1: all four tables NULL, candidates true, cycles true. PRE 2: the 20260916 audit check present (has_20260916 true, has_reflections false). Apply: "Success. No rows returned." POST 1: four tables, RLS true. POST 2: exactly the expected grants, and ngrp_reflection_submissions holds INSERT,SELECT only, so a submitted reflection cannot be changed by any role. POST 3: the three UNIQUE constraints (candidate_id; run_id, period_number; period_id). POST 4: event_type_checks 1, keeps_earlier true, learns_new true. POST 5: 0, 0, 0, 0. Every section matched its stated expectation; no corrections. Additive and transactional; no data rewrite. Four server-only tables for the bi-weekly NGRP Clinical Orientation Progress and Reflection Tool: ngrp_reflection_runs (one per resident, UNIQUE candidate_id, the schedule's shape and status), ngrp_reflection_periods (one per run per period, materialized opens/due/send dates, lifecycle, one autosave draft, UNIQUE (run_id, period_number)), ngrp_reflection_tokens (HMAC hash only, pending/active/revoked/failed, same posture as ngrp_transition_tokens), and ngrp_reflection_submissions (one immutable answer per period: service_role holds SELECT and INSERT only, nothing may UPDATE or DELETE). RLS on all four, nothing for anon/authenticated/PUBLIC. Widens ngrp_audit_events_event_type_check with five reflection_* event types while carrying every earlier value including 20260916's five. Either deploy order: Support shows "Start is not available yet" and the public page answers 410 until applied. Checks: db/audit/ngrp_reflections_checks.sql (PRE 1-2, POST 1-5). The cron (api/cron/resident-reflections, Sat 02/03/04 UTC gated on Pacific Friday 19:00+) is a no-op until a run exists |
| 20260918000000_ngrp_resident_schedule.sql | RESIDENCY-REFLECTION-2, 521f2b10 + d7956343, 2026-09-14 | **APPLIED 2026-09-14 by the Owner.** PRE 1: schedule_days NULL, shift_exists false, outcomes true, candidates true. Apply: "Success. No rows returned." POST 1: rls true. POST 2: exactly ngrp_resident_schedule_days / service_role / DELETE,INSERT,SELECT. POST 3: three rows (uq_ngrp_resident_schedule_day UNIQUE (candidate_id, on_date); the schedule-days shift CHECK Day/Night/Mid; the outcomes shift CHECK Day/Night/Mid/Variable). POST 4: shift, text, YES. POST 5: 0 marks, 0 shifts recorded. Every section matched its stated expectation; no corrections. Additive and transactional; no data rewrite. One server-only table, ngrp_resident_schedule_days (one row per resident per day they mark as working on their reflection form: candidate_id, student_id, on_date, an optional per-day shift Day/Night/Mid for a Variable resident, UNIQUE (candidate_id, on_date)), plus ngrp_residency_outcomes.shift (Day/Night/Mid/Variable, the shift they were hired into, set in the drawer's Residency Outcome section). RLS on, nothing for anon/authenticated/PUBLIC; service_role holds SELECT, INSERT and DELETE on the new table (a mark is a plan, not a record: unmarking a day deletes the row; there is deliberately no UPDATE). No audit change. Either deploy order: before it is applied the reflection form loads without the calendar's marks (schedule null), the Activity calendar shows no marks (provisioned false), and a schedule_add answers 500. Checks: db/audit/ngrp_resident_schedule_checks.sql (PRE 1, POST 1-5). Rollback in the migration's trailing comment |
| 20260919000000_ngrp_resident_details.sql | RESIDENTS-1, 0289e4e8, 2026-09-14 | **APPLIED 2026-09-14 by the Owner.** PRE 1: outcomes true, position_title false, preceptor_name false, phone false. Apply: "Success. No rows returned." POST 1: phone, position_title, preceptor_name, each text, YES. POST 2: ngrp_residency_outcomes_phone_check (40), ngrp_residency_outcomes_position_title_check (120), ngrp_residency_outcomes_preceptor_name_check (200), each nonblank-and-length. POST 3: delete_revoked false, titles 0, preceptors 0, phones 0. Every section matched its stated expectation; no corrections. Additive and transactional; no data rewrite. Three nullable text columns on ngrp_residency_outcomes, each with a nonblank-and-length CHECK: position_title (120; the Residents tab offers RN Resident, Clinical Nurse I, II, III or a typed title), preceptor_name (200; a typed override of the names from the resident's first reflection) and phone (40; a typed override of the Transition Form's preferred phone). No grant change: DELETE stays revoked from service_role. Written only by api/ngrp-manage.js resident_details_set (a partial update, together with the existing separated_at and separation_reason). Either deploy order: before it is applied Residency > Residents still lists hires, affiliation and retention, the edit form says title, preceptor and phone are not available yet, and a save answers { provisioned: false }. Checks: db/audit/ngrp_resident_details_checks.sql (PRE 1, POST 1-3). Rollback in the migration's trailing comment |
| 20260920000000_ngrp_mentorship_session_details.sql | MENTORSHIP-1, c42702bb, 2026-09-14 | **APPLIED 2026-09-15 by the Owner.** PRE 1: entries true, session_format, duration_minutes, topics, next_steps and logged_by all false. PRE 2: 0 entries, 0 mentorship sessions. Apply: "Success. No rows returned." POST 1: duration_minutes integer YES null; logged_by text NO 'aspire_team'::text; next_steps, session_format, topics text YES null. POST 2: six rows (chk_ngrp_support_session_details plus the duration 5-480, logged_by aspire_team/mentor/resident, next_steps 2000, session_format in_person/virtual/phone and topics 2000 checks). POST 3: ngrp_support_entries / service_role / INSERT,SELECT,UPDATE only. POST 4: 0, 0, 0, 0, equal to PRE 2. Every section matched its stated expectation; no corrections. Additive and transactional; no data rewrite; no new table. Five columns on ngrp_support_entries for the mentorship session record that replaces Cedars-Sinai's mentorship platform: session_format (in_person, virtual, phone), duration_minutes (5 to 480), topics (2000), next_steps (2000), and logged_by (aspire_team, mentor, resident; NOT NULL DEFAULT aspire_team, so every existing row reads as logged by the ASPIRE team; mentor and resident are the future self-logging paths). chk_ngrp_support_session_details keeps the four session fields NULL on every activity other than mentorship_session. Lists match src/lib/ngrp/ngrpMentorshipSession.js. No grant change: service_role keeps INSERT, SELECT, UPDATE and still has no DELETE. Either deploy order: before it is applied Before Residency records as today, the session log shows date, mentor and note only, and logging a session answers { provisioned: false, error: session_details_unavailable }. Checks: db/audit/ngrp_mentorship_session_details_checks.sql (PRE 1-2, POST 1-4). Rollback in the migration's trailing comment |
| 20260921000000_demo_mode_foundation.sql | DEMO-MODE-1, f870053d + 6b539672 + bbe27797, 2026-09-17 | **APPLIED 2026-09-17** (row added 2026-09-24, SECURITY-RECORDS-1), recorded in `src/lib/demoBoundaryFlag.js` ("LIVE SINCE 2026-09-17": all nineteen `is_demo` columns, fourteen inheritance triggers and five partial indexes confirmed), where the boundary flag was flipped to true in the same commit; the flag would 400 every scoped read if the columns were absent. Preflight: `db/audit/demo_mode_preflight_probe.sql` and `_2.sql`. The demo seed (`db/demo/demo_seed.sql`) is a separate data step, not a migration. |
| 20260922000000_demo_mode_residency.sql | DEMO-MODE-2, 9557b2c7, 2026-09-18 | **APPLIED (apply date not recorded), confirmed 2026-09-24 by the Owner.** Idempotent re-run: "Success. No rows returned." V1: is_demo on all six tables, NO, false. V2: five aspire_demo_inherit_trg triggers, has_args true. V3: ngrp_cycles 1 real / 1 demo, ngrp_cycle_source_cohorts 3 / 1, ngrp_candidates 0 / 10, ngrp_residency_outcomes 0 / 5, ngrp_transition_assignments 0 / 6, ngrp_transition_revisions 0 / 4. The demo rows are the Residency demo cast (db/demo/demo_seed.sql), which could only have been written after this migration, so the original apply predates the seed. ngrp_candidates and ngrp_residency_outcomes hold no real rows yet. |
| 20260922000000_messages_refinement_triage_reactions.sql | MESSAGES-REFINEMENT-1, 2026-09-21 | **APPLIED 2026-09-21 by the Owner.** Apply: "Success. No rows returned." POST 1: `message_reactions_pkey` remains `(message_id, profile_id)` and `chk_message_reactions_key` allows exactly acknowledge, on_it, done, thanks, warm, and celebrate. POST 2: all five expected RPCs exist, are SECURITY DEFINER, have the expected stable/volatile modes, and pin `search_path=public, pg_catalog`. POST 3: grants match the intended matrix; PUBLIC and anon have no EXECUTE. POST 4: 0 invalid reaction keys and 0 duplicate profile-message reactions. POST 5: all five forbidden reaction-setter side-effect checks are false. POST 6: all six inbox capability checks are true. Every section matched its stated expectation; no corrections. Expands the existing reaction CHECK from three keys to six while preserving the primary key `(message_id, profile_id)`, adds a v2 reaction setter, capability-bearing v4 staff and portal thread wrappers, a v4 staff inbox with sender search, reply direction, server-side Needs reply and Unassigned filtering, authoritative active counts, and a staff Needs reply badge count. Existing v1, v2, and v3 RPCs remain for fallback. Reaction writes touch only `message_reactions` and cannot change unread, archive, events, or delivery state. |
| 20260923000000_drop_unit_leaders.sql | UNIT-LEADERS-RETIRE-2, 68de62b0, 2026-09-20 | **APPLIED 2026-09-20 by the Owner.** PRE 1: present true, rows_total 104, rows_active 104 (the seed records 102; two rows added by hand after it had no record in git and went with the table under the Owner's rule). PRE 3: anon_read_unit_leaders {anon}, service_role_all_unit_leaders {service_role}, staff_read_unit_leaders {authenticated}, all named in the migration. Apply: "Success. No rows returned." POST 1: present false, policies 0, indexes 0. Drops the hand-seeded `unit_leaders` table and its policies. Precondition met: 31f943c3 (UNIT-LEADERS-RETIRE-1) is live and nothing reads the table; the Owner ran `db/audit/unit_leaders_vs_connect_preflight.sql` on 2026-09-20 (26 of 28 units same lead, 4 North and Transfer Center resolve from Connect, Float Pool has no Associate Director in Connect yet, no unit without Connect leadership). Refuses to run if any out-of-band object depends on the table. PRE 1 to 4 and POST 1 to 2 in `db/audit/unit_leaders_drop_checks.sql`. Not reversible: the seed stays in `db/migrations/seed_unit_leaders.sql` as the record. |
| 20260923000000_organization_settings.sql | ORGANIZATION-1, 1d79fa60, 2026-09-24 | **APPLIED 2026-09-24 by the Owner** (the seeded row's created_at/updated_at is 2026-09-24 09:02:50 UTC). Re-run: "Success. No rows returned." 3a: 20 columns (the 19 this file creates, in order, plus footer_logo_path from 20260924020000). 3b: 1 row, legal_name Cedars-Sinai Medical Center, general_email aspire@cshs.org; display_name now reads Cedars-Sinai Medical Center (edited in Settings > Organization since the seed). 3c: rls_enabled true, anon_select false, authenticated_select false, service_role_select true. 3d: bucket organization-branding, public true. |
| 20260924000000_user_ui_preferences.sql | USER-PREFERENCES-1 / CONTACTS-BOOK-1, b35fc1bb + 51226d2a, 2026-09-20 | **APPLIED 2026-09-20 by the Owner, after the code was live.** PRE 1: column_exists false, self_update_policy true, table_update_granted false, 42 profiles. PRE 2: no triggers on user_profiles. Apply: "Success. No rows returned." POST 1: ui_preferences | jsonb | NO | '{}'::jsonb. POST 2: user_profiles_ui_preferences_shape CHECK ((jsonb_typeof(ui_preferences) = 'object') AND (octet_length(ui_preferences::text) <= 4096)). POST 3: exactly the seven client-writable columns (avatar_url, last_login_at, the four onboarding_tour_* columns, ui_preferences), table_update_granted false. POST 4: 42 of 42 rows empty, no values in use. POST 5 raised 23514 on user_profiles_ui_preferences_shape, its PASS condition; the DETAIL line shows the REJECTED candidate row, not stored data, and the ROLLBACK meant nothing was written. Every section matched its stated expectation; no corrections. The smallest per-user preference store: one column, user_profiles.ui_preferences jsonb NOT NULL DEFAULT '{}' (metadata-only, no rewrite), a CHECK that it is a JSON object of at most 4 KB, and GRANT UPDATE (ui_preferences) TO authenticated. No new table, no new policy, no function, no data rewrite: the Wave E self-row policy user_profiles_update_self already limits the write to the caller's own row, and the column grant makes this the seventh and only new client-writable column. First key: appearance.contactsLayout (classic, default, or book), registered in src/lib/userPreferences.js. Either deploy order: before it is applied the read answers 42703 and the Contacts layout is kept in the browser (Settings says "Saved in this browser for now."); after, the first load adopts that browser choice into the account. Checks: db/audit/user_ui_preferences_checks.sql (PRE 1-2, POST 1-5; POST 5 PASSES by raising 23514 inside a rolled-back transaction). Rollback in the migration's trailing comment |
| 20260924010000_organization_application_title.sql | ORGANIZATION-1, bc116911, 2026-09-24 | **APPLIED 2026-09-24 by the Owner.** Re-run: "Success. No rows returned." Check: one row (f14cc0d1-7402-466b-9be2-76a465db06a1), header_short_name ASPIRE Intelligence. |
| 20260924020000_organization_footer_logo.sql | ORGANIZATION-1, 70efcb12, 2026-09-24 | **APPLIED 2026-09-24 by the Owner.** Re-run: "Success. No rows returned." Check: footer_logo_path, text, YES, null. |
| 20260925000000_contact_followup_flag.sql | CONTACTS-BOOK-3, 0b629575, 2026-09-20 | **APPLIED 2026-09-21 by the Owner, before the code was pushed.** PRE 1: column_exists false, staff_select_policy true, 243 contacts. Apply: "Success. No rows returned." POST 1: flagged_for_followup | boolean | NO | false. POST 2: flagged 0, unset 0, contacts 243 (unchanged from PRE 1). POST 3: five policies, contacts_service_role_all (ALL), contacts_staff_select (SELECT), contacts_writer_delete, contacts_writer_insert, contacts_writer_update; the migration contains no policy statement, and the check's stated expectation had left out the pre-existing service-role policy, now corrected in the checks file. Every other section matched; no data or policy change beyond the one column. One boolean on contacts, flagged_for_followup NOT NULL DEFAULT false (metadata-only, every row reads unflagged), with a column comment. No policy, no grant, no backfill, no function: contacts' table-level staff policies already cover every column, and the only writer is the service-role status path in /api/contacts-upsert (api/lib/contactStatusUpdate.js). It is the Contacts address book's follow-up ribbon (the canonical FlagRibbon), shared by all staff, no note, reaching the book only. Either deploy order: before it is applied the ribbon renders inert and says the flag is not enabled, and a pull answers 409 not_enabled; the app selects contacts with '*', so applying it switches the ribbon on with no redeploy. Checks: db/audit/contact_followup_flag_checks.sql (PRE 1, POST 1-3, one query per section). Rollback in the migration's trailing comment |
| 20260926000000_catalog_revamp_1.sql | CATALOG-REVAMP-1 (Phase 1), merged 6a3addc0, 2026-09-23 | **APPLIED 2026-09-23 by the Owner, after the code was live.** PRE 1: all six false. PRE 2 (the rollback list for the pinned backfill): two rows featured and not pinned, 9ce2bba8-2340-4c6f-82f4-d9fe464b652a aspire-digital-brochure (ASPIRE Brochure) and e16f4981-2a01-41c4-ab47-e602d5d4d8dc general-guidelines-for-pre-licensure-students (General Guidelines for Pre-Licensure Students); to reverse only the backfill, set is_pinned = false on those two ids. PRE 3: no rows. PRE 4: seven categories; forms held 4 rows (4 active), the reassignment worklist. Apply: "Success. No rows returned." POST 1: the three tables resolve, bucket_public false. POST 2: featured_not_pinned 0, non_file_rows 0, non_v1_rows 0, internal_files 27, sized 27. POST 3: no rows (the audience CHECK could be VALIDATEd). POST 4: nine categories, forms retired, student_onboarding and school_documents present. POST 5: RLS on, one SELECT policy each on catalog_send_recipients, catalog_sends, record_documents, no write policy. POST 6: kind, version and the moved-record FK validated; audience convalidated false as designed. Every section matched its stated expectation; no corrections. Additive, one transaction. catalog_resources gains kind (file/form/signature, default file), version (default 1), version_updated_at, file_size_bytes (backfilled from storage.objects metadata) and moved_to_record_document_id, plus a NOT VALID one-value audience CHECK on the existing audience text[]; is_featured is folded into is_pinned (featured rows are pinned; nothing is unpinned; is_featured is kept, unread). catalog_categories gains retired_at; 'forms' is retired (Forms is now an item kind), 'student_onboarding' and 'school_documents' are added; no slug changes. New tables record_documents (a student's or school's filed documents), catalog_sends and catalog_send_recipients (the Catalog send log, written by /api/connect-send-bulk-message after the batch), each with RLS on and ONE Owner/Admin SELECT policy, no client write policy. New PRIVATE bucket record-documents (10 MB), no storage.objects policy (service role only). Either deploy order: before it is applied the Catalog reads 42703/42P01 as not enabled (no send log, no Upload new version, no personal-file move) and every other action works. Checks: db/audit/catalog_revamp_1_checks.sql (PRE 1-4 before, POST 1-6 after; keep PRE 2's output, it is the rollback list for the pinned backfill). Rollback in the migration's trailing comment |
| 20260927000000_signatures_phase2.sql | SIGNATURES-PHASE2 (ASPIRE Catalog Phase 2), merged cb31f4b9, 2026-09-23 | **APPLIED 2026-09-23 by the Owner, after the code was live.** PRE 1: all twelve false. PRE 2: all six true (is_staff, is_active_owner_or_admin, sha256 built-in, kind allows signature, record_documents source allows signature, record-documents bucket). Apply: "Success. No rows returned." POST 1: ten tables, RLS on all, org_id on all but organizations. POST 2: ten policies, every one SELECT to {authenticated}. POST 3: catalog.signatures = off; sig_settings env_p12, http://timestamp.digicert.com, disclosure 1.0, code TTL 10, 5 attempts. POST 4: trg_sig_events_append_only, trg_sig_events_chain, trg_sig_events_no_truncate. POST 5: signature-documents private, 26214400, [application/pdf]. The flag stays off; turning it on is a separate Owner write (end of db/audit/signatures_phase2_checks.sql). Rollback at the end of the migration. |
| 20260928000000_forms_phase3.sql | FORMS-PHASE3 (ASPIRE Catalog Phase 3), merged 1a4d25a1, 2026-09-24 | **APPLIED 2026-09-24 by the Owner, after the code was live.** PRE 1: all six false. PRE 2: all six true (organizations, sig_caller_org_id, is_active_owner_or_admin, kind allows form, record source allows form_submission, record-documents bucket). Apply: "Success. No rows returned." POST 1: catalog_form_versions, catalog_forms, form_assignments, form_submissions, RLS on and org_id on all four. POST 2: four policies, every one SELECT to {authenticated}. POST 3: trg_catalog_form_versions_frozen. POST 4: form-files private, 10485760. POST 5: 0 forms, 0 assignments, 0 submissions. Starter forms are added from the Catalog (+ New > Add the starter forms). Rollback at the end of the migration. |
| 20260929000000_form_sheet.sql | FORM-SHEET-2 (Responses > Sheet editing, Smartsheet-style), 2026-09-24 | **APPLIED 2026-09-24 by the Owner, before the code was pushed.** PRE 1: all four false. PRE 2: all five true. Apply: "Success. No rows returned." POST 1: form_answer_corrections, form_sheet_cells, form_sheet_views, RLS on and org_id on all three. POST 2: three policies, every one SELECT to {authenticated}. POST 3: trg_form_answer_corrections_append_only exists; 0 views, 0 cells, 0 corrections. Additive: form_sheet_views (layout + staff columns), form_sheet_cells (staff values + formatting), form_answer_corrections (append-only correction history; submissions and filed PDFs are never changed). RLS on, Owner/Admin read policy each, writes service-role only. Checks: db/audit/form_sheet_checks.sql (PRE 1-2, POST 1-3). The app runs on both sides: before it, the Sheet is read-only and says so. Rollback at the end of the migration. |
| 20260930000000_s15_unit_leader_thread_read_scope.sql | S15-1 (FINDINGS_REGISTER S-15), 42e67e67, 2026-09-24 | **APPLIED 2026-09-24 by the Owner.** PRE 1: can_read reads_unit_scopes false, can_send true and delegates true, helper present. PRE 2: security_definer true, stable true, search_path {public, pg_catalog}, service_role true, authenticated false, anon false, public false. PRE 3: no rows (no unit_leader participant row exists yet; exposure 0, the fix is preventive). PRE 4: student 7 / 7. PRE 5: 0 / 0. Apply: "Success. No rows returned." POST 1: can_read reads_unit_scopes TRUE, everything else unchanged. POST 2: identical to PRE 2. POST 3: 0 / 0 / 0 / 0. POST 4: student 7 / 7, identical. POST 5: 0 / 0. POST 6: removed_now 0, latest_removed_at null, 7 participant rows. Checks: `db/audit/s15_unit_leader_thread_read_scope_checks.sql`. |
| 20261001000000_s16_avatar_writes_server_only.sql | S16-1 (FINDINGS_REGISTER S-16), c53a0d5d, 2026-09-24 | **APPLIED 2026-09-25 by the Owner, after the code was live.** PRE 1: seven browser-updatable columns (the six the audit named plus `ui_preferences`, granted by 20260924000000 and correctly untouched). PRE 2: update_my_avatar(text), security definer, authenticated true. PRE 3: seven policies; the three dashboard-created `avatars` write policies, recorded here because the migration dropped them by expression and their text lived nowhere else: "Avatars: authenticated insert into own folder" (INSERT, WITH CHECK `bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text`), "Avatars: authenticated update own folder" (UPDATE, same USING), "Avatars: authenticated delete own folder" (DELETE, same USING); plus "Avatars: public read" (SELECT, public) and the three contact-avatars policies from 20260601000001. PRE 4: contacts 158 with avatar, 0 outside own Storage; user_profiles 6, 0. Apply: "Success. No rows returned." POST 1: six columns, avatar_url gone, the other six kept. POST 2: authenticated false, anon false, service_role true. POST 3: only "Avatars: public read" and contact-avatars-public-read, both SELECT. POST 4: identical to PRE 4. Checks: `db/audit/s16_avatar_writes_server_only_checks.sql`. |
| 20261002000000_s08_school_form_password_hash.sql | S08-1 (FINDINGS_REGISTER S-08, part two), 4be42047, 2026-09-25 | **APPLIED 2026-09-25 by the Owner** (step A). PRE-A 1: both live bodies were plpgsql with exactly the recorded semantics (requires: `v_password IS NOT NULL AND TRIM(v_password) != ''`; verify: `TRIM(stored) = TRIM(entered)`), SECURITY DEFINER, search_path public, pg_catalog; parameter names matched. PRE-A 2: anon, authenticated, service_role true on both, dependents 0. PRE-A 3: pgcrypto 1.3 in schema `extensions`. PRE-A 4: FOUR cohorts with a password, not the three recorded on 2026-08-27: Winter 2027 (now the accepting cohort), Fall 2026, Spring 2027, Summer 2026; the two Demo cohorts have none. Apply: "Success. No rows returned." POST-A 1: three functions, SECURITY DEFINER, pinned search_path, anon and authenticated true on requires and verify, false on set, service_role true on all, all read the secrets table. POST-A 2: rls true, policies 0, anon and authenticated select false, service_role true. POST-A 3: all four hashed, bcrypt, own password verifies, with spaces verifies, wrong and empty refused; demo cohorts not required. POST-A 4: 4 plaintext, 4 hashed. POST-A 5: set function present. |
| 20261003000000_s08_school_form_password_plaintext_drop.sql | S08-1 (FINDINGS_REGISTER S-08, part two), 4be42047, 2026-09-25 | **APPLIED 2026-09-25 by the Owner** (step B), same sitting as A, with the S08-1 deploy live. PRE-B 1: 4 / 4 / 4. PRE-B 2 returned ONE row, `pg_attrdef` deptype `a`: the column's own DEFAULT expression, which DROP COLUMN removes with the column; it is not an outside dependent, and the section's "stop on any row" was written too broadly (noted here, not a defect). Apply: "Success. No rows returned." POST-B 1: column_present false, secrets_table_present true. POST-B 2: no function mentions the plaintext column; SECURITY DEFINER and grants as in POST-A 1. POST-B 3: the four cohorts require a password and are hashed, the two demo cohorts neither; wrong and empty refused everywhere. POST-B 4 (by hand, on the live school form): the real password opened the form and a wrong one was refused. No plaintext password remains anywhere in the database. |
| 20261004000000_s04_interview_tables_write_split.sql | S04-1 (FINDINGS_REGISTER S-04, last part), 2026-09-25 | **APPLIED 2026-09-25 by the Owner**, with S04-1 (96003c14) live in production. PRE 1: exactly 3 rows, `staff_all_availability_blocks`, `staff_all_interview_sessions`, `staff_all_interview_slots`, each ALL / `{authenticated}` / `is_staff()`, no other policy. PRE 2: `is_active_staff_writer` and `is_staff`, both security_definer true, `search_path=public, pg_catalog`. PRE 3: all three tables rls_enabled true, authenticated select and update true, anon update false. Migration: Success, no rows returned. POST 1: 12 rows, per table `_staff_select` SELECT `is_staff()`, `_writer_insert` INSERT with_check `is_active_staff_writer()`, `_writer_update` UPDATE qual and with_check `is_active_staff_writer()`, `_writer_delete` DELETE `is_active_staff_writer()`; no `staff_all_*` row. POST 2: no rows. POST 3: writes 9, writer_gated 9. POST 4: identical to PRE 3. Replaces the three Wave E FOR ALL `is_staff()` policies on `interview_availability_blocks`, `interview_slots` and `interview_sessions` with the split every other core table has: SELECT on `is_staff()`, INSERT, UPDATE, DELETE on `is_active_staff_writer()`. Only the three named policies and its own names are dropped; any other policy survives. One transaction, safe to re-run. It was applied only after S04-1 was live in production: interviewer self-service (pause a block, block or unblock a slot, mark a Teams invite) runs through `api/availability.js` from that commit; before it those were browser writes this file would have silently refused. Checks were run as PRE 1 to 3 of `db/audit/s04_interview_tables_write_split_checks.sql`, then the file as ONE block, then POST 1 to 4. Rollback at the end of the migration. |
| 20261005000000_action_center_queue.sql | ACTION-CENTER-1 (Action Center queue and notifications), f059b204, 2026-09-25 | **APPLIED 2026-09-25 by the Owner.** Apply: "Success. No rows returned." Creates `action_snoozes` and `support_checkin_events` (RLS on), `classify_support_checkin`, `record_support_checkin_decision` (authenticated), the `capture_support_checkin_event` trigger and the four Action Center notification triggers (messages, signatures, calendar, evaluations). **Historical support check-in backfill, same day, by the Owner.** (1) The review-only script, `db/audit/action_center_support_checkin_backfill.sql` (ends in ROLLBACK, persisted nothing): 1 automatic decline, 84 needing review, 2 remaining open. (2) One attempt failed because `ac_reviewed_support_decisions` did not exist; no changes. (3) A safety check returned `safety_passed = false` and inserted zero events; no changes. (4) The corrected production backfill: `safety_passed = true`, `reviewed_events = 84`, `auto_classified_events = 3`, `verified_events = 87`, `closed_as_no_help_needed = 76`, `opened_for_staff_action = 11` (`urgent = 1`, `requests = 10`). The counts reconcile: 84 + 3 = 87 verified, 76 + 11 = 87, 1 + 10 = 11. The corrected production script (the one that reads `ac_reviewed_support_decisions` and gates on the safety check) is NOT in the repository; the committed file is the review-only version. |
| 20261006000000_s23_append_only_event_tables.sql | S23-1 (FINDINGS_REGISTER S-23), 2026-09-25 | **APPLIED 2026-09-25 by the Owner.** Apply: "Success. No rows returned." PRE 1: 15 present; pre-existing triggers only `trg_form_answer_corrections_append_only` and the Action Center's AFTER INSERT `trg_action_center_message_notification` on `conversation_events`. PRE 2: svc UPDATE/DELETE/TRUNCATE true on `cohort_unit_response_target_events`, `form_answer_corrections` (plus authenticated and anon, the default privilege), `keith_requests`, `keith_skill_invocations`, `preceptor_assignment_events`, `preceptor_mirror_repair_audit`, `support_checkin_events`, `unit_placement_request_events`, and TRUNCATE alone on `portal_invitation_events`; false elsewhere. PRE 3: CASCADE only on `unit_placement_request_events.request_id`, `cohort_unit_response_target_events.target_id` and the three `form_answer_corrections` keys; nothing from students or cohorts. PRE 4: `program_events` CASCADE from cohorts and students; `activity_logs` SET NULL from cohorts and user_profiles with service_role UPDATE and DELETE true; `student_activity_completions` CASCADE from students. POST 1: 15 rows, both triggers true on every row. POST 2: no rows. POST 3: every table update=refused delete=refused truncate=refused (`unit_placement_request_events`, `ngrp_preceptor_feedback_access_events` and `form_answer_corrections` had 0 rows, so no-rows for the row statements); `form_answer_corrections` truncate refused with SQLSTATE 23514 from its own 20260929000000 function, which the first version of POST 3 reported as FAIL; the audit file now classifies check_violation as a refusal (S23-2). POST 4: PASS, inserted=4, every update and delete refused, rolled back. POST 5: identical to PRE 2 on SELECT and INSERT, every write privilege false. Adds the sig_events template pair, `trg_<table>_append_only` (BEFORE UPDATE OR DELETE) and `trg_<table>_no_truncate` (BEFORE TRUNCATE), through one shared `public.append_only_refuse()` to fourteen documented append-only tables (`preceptor_assignment_events`, `unit_placement_request_events`, `cohort_unit_response_target_events`, `support_checkin_events`, `preceptor_mirror_repair_audit`, `preceptor_projection_backfill_audit`, `conversation_events`, `ngrp_audit_events`, `ngrp_preceptor_feedback_access_events`, `portal_invitation_events`, `shift_log_reviews`, `student_shift_log_edits`, `keith_requests`, `keith_skill_invocations`), adds the missing TRUNCATE trigger to `form_answer_corrections`, and revokes UPDATE, DELETE and TRUNCATE from every role on all fifteen. `student_activity_completions` is deliberately left out (cascades from students). One transaction, refuses to run if a covered table is missing, safe to re-run. No ordering constraint beyond the tables existing (all fifteen creating migrations are applied). Run PRE 1 to 4 of `db/audit/s23_append_only_event_tables_checks.sql`, then the file as ONE block, then POST 1 to 5 (POST 3 and 4 end with a deliberate RAISE EXCEPTION whose message is the report). Rollback at the end of the migration. |
| 20261007000000_s24_cohort_school_rotations_read_scope.sql | S24-1 (FINDINGS_REGISTER S-24), 2026-09-25 | UNKNOWN (drafted 2026-09-25; NOT APPLIED). Drops `cohort_school_rotations_anon_select` and `cohort_school_rotations_authenticated_select` (both USING (true), from 20260522000000), creates `cohort_school_rotations_staff_select` FOR SELECT TO authenticated USING (`is_staff()`), and revokes the anon role's table grant. Every browser reader is the staff app; every portal and public read goes through a service-role endpoint that scopes its own result; no anonymous page reads the table. Writes untouched (service role only). One transaction, safe to re-run, refuses without the table or `is_staff()`. **No deploy dependency**: no application code changes with it. Run PRE 1 to 3 of `db/audit/s24_cohort_school_rotations_read_scope_checks.sql`, then the file as ONE block, then POST 1 to 3 (POST 3 ends with a deliberate RAISE EXCEPTION whose message is the report). Rollback at the end of the migration. |

CONFIRMED 2026-08-27: `consume_evaluation_rate_limit` is present in
production, verified via section 1 of
`db/audit/public_endpoint_hardening_checks.sql` (one row: the function exists
with its expected signature). This mattered because the public-surface
throttle added 2026-08-23 FAILS CLOSED; had the function been absent, every
public submission (student intake, unit form, school form, shift log) would
have been refused. It remains dashboard-created and appears in no repository
migration, so treat any future change to it as out-of-band.
