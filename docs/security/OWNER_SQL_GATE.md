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
| 9 | `20260712000008_phase2_student_portal_views.sql` | requires 8 | student portal reads |
| 10 | `20260712000009_phase3_unit_portal.sql` | requires 8 | unit leader portal reads, released_reports |
| 11 | `20260712000010_phase4_school_portal.sql` | requires 8 and 10; contains the ONE backfill (students.school_id, fills NULLs only) | academic partner portal, schools |
| 12 | `20260712000011_phase5_public_metrics.sql` | requires 1; additive, seeds nothing | public metrics workflow |
| 13 | `20260712000012_phase0b_wave_f2_student_files_private.sql` | **DO NOT RUN until the Wave F-2 code prerequisite below is deployed and verified** | closes F7 (public resume bucket) |

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

- Invite a STUDENT: files 1 through 9 applied. (Student portal reads
  need the Phase 2 foundation and the student views.)
- Invite a UNIT LEADER: files 1 through 8 plus 10 applied. (Unit portal needs the
  Phase 2 foundation and the Phase 3 unit views/released_reports.)
- Invite an ACADEMIC PARTNER: files 1 through 8, 10, and 11 applied. (Partner
  portal needs schools normalization and its scoped report view.)

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
`...000006`, Phase 2 authz `...000007`, Phase 2 views `...000008`, Phase 3
`...000009`, Phase 4 `...000010`, Phase 5 `...000011`, Wave F-2 `...000012`). Apply it immediately AFTER Wave E and before inviting any
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

## First migration to run after approval

File 1, `supabase/migrations/20260712000000_phase0b_wave_a_is_staff_helper.sql`
(additive, no behavior change). It creates is_staff(), which Waves E and F-1
depend on.
