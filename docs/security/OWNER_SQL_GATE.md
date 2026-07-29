# Owner SQL Gate: Consolidated Application Order

Every phase of the public-platform build is code-complete, deployed, and
verified in production. Every database change is drafted but NOT applied. This
file is the single ordered checklist for applying them.

Run each file WHOLE, as one block, in the Supabase SQL editor. Per-file detail
is in [PHASE_0B_RLS_HARDENING.md](PHASE_0B_RLS_HARDENING.md); audit context in
[PHASE_0A_ACCESS_AUDIT.md](PHASE_0A_ACCESS_AUDIT.md).

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
