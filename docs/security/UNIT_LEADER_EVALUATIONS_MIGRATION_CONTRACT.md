# Unit Leader Evaluations: Locked Migration Contract

Branch: `unit-leader-evaluations-sql-gate`
Status: migration AUTHORED, not applied. Jester applies it manually after review through
the Owner SQL gate (`docs/security/OWNER_SQL_GATE.md`). No SQL is run on this branch, no
API or UI is built, nothing is merged/pushed/deployed.

Governing diagnostic: `docs/UNIT_LEADER_EVALUATIONS_DIAGNOSTIC.md`.
Migration file: `supabase/migrations/20260725000000_unit_leader_evaluation_release_gate.sql`.

## 1. Owner-approved policy (final for the first release)

- **Instruments**: exactly two, by `evaluation_instruments.slug`:
  `student_preceptor_eval` (Preceptor & Unit Feedback) and `preceptor_progress`
  (Preceptor Readiness Assessment). Casey-Fink (`casey_fink_readiness_2024`) and the
  ASPIRE Post-Rotation Evaluation (`post_rotation_evaluation`) are excluded.
- **Release timing**: a response is eligible for Unit Leader release only after the
  student's rotation has ended **and** an additional **7-day** delay, derived from an
  immutable submission-time snapshot of the effective rotation end.
- **Release authority**: only active Owner/Admin may moderate, release, revoke, or change
  release visibility. Unit Leaders never can.
- **Identity**: Unit Leaders receive no student name, profile id, email, headshot, direct
  identifier, or identifying/exact timestamp. Server-generated anonymous response labels
  only.
- **Response-count**: no minimum-count suppression. Quantitative aggregates and released
  anonymous quantitative responses display even at `n = 1`. No hidden five-response
  threshold. Documented **Owner-accepted contextual re-identification risk** at `n = 1`;
  the system never claims a one-response result is mathematically anonymous.
- **Free text**: all free text hidden (comments, narratives, suggestions, open-ended
  answers, internal moderation notes). Stored for staff; excluded from every Unit Leader
  read.
- **Reporting level**: unit-level only. No preceptor-specific dashboards, filters, scores,
  or groupings. Historical preceptor attribution is snapshotted immutably for audit but
  never returned to a Unit Leader.
- **Individual viewer** (future): released, anonymous, quantitative, role-safe fields
  only. Excludes identity, free text, internal notes, moderation/release history,
  staff-only lifecycle timestamps, raw db metadata.
- **Historical attribution**: at submission, permanently snapshot evaluated unit,
  evaluated preceptor, cohort, rotation, instrument, timepoint, and assignment context.
  Later changes to student/unit/cohort/rotation/preceptor do not alter historical
  reporting.
- **Unit filtering**: All Assigned Units or a single authorized active unit. Server-derived
  scope is authoritative; a requested unit only narrows, never widens.

## 2. Existing schema map (verified, exact identifiers)

Evaluation core (`migrations/migration_evaluation_stage1_schema.sql`):
- `evaluation_responses(id, assignment_id UNIQUE, instrument_id, student_id, cohort_id,
  timepoint, form_type, responses jsonb, score_s1_* NUMERIC(5,3), submitted_at, locked_at,
  ...)`. RLS: SELECT to `authenticated` gated `is_owner_or_admin()`; writes service_role.
- `evaluation_assignments(...)` incl. `respondent_type`, `respondent_preceptor_id`
  (`20260613000000_ps2a_...`).
- `evaluation_instruments(id, slug UNIQUE, ...)`. Only `casey_fink_readiness_2024` and
  `post_rotation_evaluation` are seeded in-repo; `student_preceptor_eval` and
  `preceptor_progress` rows are seeded manually in production, so the migration keys on
  **slug**, never on a hard-coded instrument id.
- Submit RPCs write `evaluation_responses` (service_role, SECURITY DEFINER): Casey-Fink
  `submit_evaluation_response`; `submit_preceptor_evaluation_response` (slug
  `preceptor_progress`); `submit_student_preceptor_evaluation_response` (slug
  `student_preceptor_eval`); `submit_post_rotation_evaluation_response`. The two in-scope
  instruments leave `score_s1_*` NULL; their quantitative answers live in `responses`
  JSONB.

Linkage (verified):
- response → student: `evaluation_responses.student_id` → `students.id`.
- student → unit: `students.matched_unit_id` → `units.id`; `units.unit_name` is the stable
  cross-cohort key equal to `user_unit_scopes.unit_key`.
- student → preceptor: `students.preceptor_id` → `preceptors.id` (`preceptors.full_name`).
- cohort: `evaluation_responses.cohort_id` → `cohorts.id` (`cohorts.name`).
- rotation end: `COALESCE(students.rotation_completed_at, students.rotation_end_date::timestamptz)`;
  NULL ⇒ unknown ⇒ never eligible. Granular source `cohort_school_rotations` via
  `students.cohort_school_rotation_id`.

Authorization primitives (`20260712000007_phase2_authz_foundation.sql`):
- `portal_profile_id()` (auth.uid → profile id), `has_active_role_grant('unit_leader')`,
  `my_unit_scope_keys()` → `(unit_key, cohort_id)` (active grant + scope, expiry/revocation
  aware), all SECURITY DEFINER + `search_path = public, pg_catalog`, EXECUTE to
  `authenticated`.
- `is_owner_or_admin()` (owner/admin, auth.uid) / `is_active_owner_or_admin()` (adds
  `is_active`). For service-role write functions the migration validates a passed actor
  profile id directly against `user_profiles(role, is_active)` because auth.uid() is null
  under the service role.

## 3. Target data model (this migration)

One linked table, one row per approved-instrument response, holding both the immutable
attribution snapshot and the mutable release lifecycle:

`public.evaluation_response_unit_release`
- Identity: `id`, `response_id UNIQUE → evaluation_responses(id) ON DELETE CASCADE`,
  `assignment_id`, `instrument_id`, `instrument_slug`, `timepoint`.
- Immutable snapshot: `hist_unit_id`, `hist_unit_key`, `hist_preceptor_id`,
  `hist_preceptor_label` (audit only), `hist_cohort_id`, `hist_cohort_label`,
  `hist_rotation_id`, `hist_rotation_end` (timestamptz effective end),
  `unit_leader_eligible_at` (= effective end + 7 days; NULL if end unknown),
  `snapshot_source` (`submission_trigger` | `backfill_verified` | `backfill_unverified`),
  `snapshot_captured_at`.
- Mutable lifecycle: `release_state` (`pending` | `moderated` | `released` | `revoked` |
  `ineligible`, default `pending`), `moderation_state` (`pending` | `cleared` | `blocked`,
  default `pending`), `quantitative_visible bool` (default false), `free_text_visible bool`
  (default false, hard-locked false by CHECK for the first release), `released_at/by`,
  `moderated_at/by`, `revoked_at/by`, `created_at`, `updated_at`.
- Constraints: approved-slug CHECK; free-text-hidden CHECK; state enums.

Rationale for a linked table (not extending `evaluation_responses`): the response tables
are written by four separate SECURITY DEFINER submit RPCs and guarded for immutability by
"no client write + completed-once"; adding lifecycle columns there would entangle release
state with submission and require touching every RPC. A 1:1 linked table isolates the new
lifecycle, lets a trigger own snapshot capture, and keeps the base tables untouched.

Immutability: a `BEFORE UPDATE` trigger rejects any change to the snapshot columns; only
lifecycle columns may change. Owner/Admin correction, if ever required, is a future
separate audited pathway, never a generic UPDATE.

Snapshot capture: an `AFTER INSERT` trigger on `evaluation_responses` inserts a row **only**
for the two approved instrument slugs, deriving the snapshot from the student's state at
submission (which, because it fires at submission, IS the historical state). `release_state`
starts `pending`; `unit_leader_eligible_at` computed from the effective rotation end
(NULL ⇒ stays ineligible until a future audited recapture).

## 4. Legacy backfill policy

For `evaluation_responses` of the two approved instruments that already exist when the
migration is applied:
- Insert a snapshot row with `snapshot_source = 'backfill_unverified'` and
  `release_state = 'ineligible'`. Best-effort labels are captured for audit only.
- Never auto-eligible: the release function refuses `backfill_unverified` rows, so a legacy
  response cannot be released without a future, explicit, audited verification pathway.
- The migration never derives a "historical" unit as authoritative from current state for
  eligibility; legacy rows are quarantined as ineligible precisely because their true
  submission-time unit cannot be reconstructed.
- The migration's verification section reports backfilled counts by source and state.

## 5. Authorization contract (enforced in the database)

Read functions (SECURITY DEFINER, `search_path = public, pg_catalog`, EXECUTE to
`authenticated`, scope from `auth.uid()` via `my_unit_scope_keys()` — the browser cannot
supply scope authority):
- `ul_eval_dashboard_summary(p_instrument_slug, p_timepoint, p_unit_key)` → jsonb unit-level
  aggregates.
- `ul_eval_response_list(p_instrument_slug, p_timepoint, p_unit_key)` → rows of
  `(anon_label, response_id, instrument_slug, timepoint, unit_key, quantitative jsonb)`.
- `ul_eval_response_detail(p_response_id)` → jsonb; re-checks scope + release for that exact
  id, never trusting a prior list.

Every read requires: active `unit_leader` grant; `hist_unit_key` ∈ the caller's active
scopes (cohort-aware); approved instrument slug; `release_state = 'released'` and not
revoked; `now() >= unit_leader_eligible_at`. `p_unit_key` only narrows (intersected with
scopes). Returned quantitative payload = only numeric-valued entries of `responses` (all
strings/free text dropped); no identity, no timestamps, no preceptor grouping. Anonymous
label is positional within the result (ephemeral), so it is not a stable cross-context
tracker; `response_id` is returned only as a fetch token the detail function re-authorizes.

Write functions (SECURITY DEFINER, EXECUTE to `service_role` only — Unit Leaders cannot
execute at all; the future server API passes the authenticated Owner/Admin actor id):
- `ul_eval_moderate_response(p_actor_profile_id, p_response_id, p_decision)`.
- `ul_eval_release_response(p_actor_profile_id, p_response_id)` — blocks unless actor is
  active Owner/Admin, instrument approved, snapshot complete and not `backfill_unverified`,
  `now() >= unit_leader_eligible_at`, moderation `cleared`, not revoked.
- `ul_eval_revoke_response(p_actor_profile_id, p_response_id)` — immediately clears
  visibility.

Table grants: `ENABLE ROW LEVEL SECURITY`; `REVOKE ALL FROM PUBLIC, anon, authenticated`;
`GRANT SELECT TO authenticated` with an `is_active_owner_or_admin()` SELECT policy (staff
read release state directly; Unit Leaders get zero rows via direct access and must use the
functions); `GRANT ALL TO service_role`.

## 6. Contextual re-identification risk (Owner-accepted)

With no minimum-count suppression, a released quantitative result for a unit that had a
single eligible respondent identifies that respondent by context. This is an explicit,
Owner-accepted trade for timely feedback. Mitigations that remain in force: free text
hidden, no identity, no identifying timestamps, unit-level only, delayed release (rotation
end + 7 days), moderation gate, and Owner/Admin-only release. The UI (future branch) must
present results plainly and must never assert that a single-response result is anonymous.

## 7. Deployment order (manual, Owner SQL gate)

1. Prerequisites already applied in production: Phase 2 authz foundation
   (`...000007`) and the unit-leader portal foundation (`20260720000000...`), which
   provide `my_unit_scope_keys`, the grant/scope tables, and `students.rotation_end_date` /
   `rotation_completed_at`.
2. Apply `20260725000000_unit_leader_evaluation_release_gate.sql` as one whole block in the
   Supabase SQL editor. It is transactional (`BEGIN/COMMIT`); the verification and rollback
   queries live outside the transaction as comments.
3. Run the verification script (`db/audit/unit_leader_evaluation_release_gate_verification.sql`)
   and confirm every check.
4. Do NOT invite/activate any Unit Leader evaluations surface: the API/UI is a later branch
   (`unit-leader-evaluations-backend-ui`).

## 8. Rollback plan

Preferred emergency rollback preserves all data: revoke EXECUTE on the read functions
(instantly disables Unit Leader reads) while leaving the table, snapshots, and release
history intact. Full teardown (only safe before first production use of the release
functions) drops the functions, then the trigger, then the table. See
`db/audit/unit_leader_evaluation_release_gate_rollback.sql`. Never delete
`evaluation_responses` content in any rollback.

## 9. UI activation gate

The Unit Leader Evaluations workspace stays a placeholder until, in the follow-on branch
`unit-leader-evaluations-backend-ui`: (1) this migration is applied and verified in
production; (2) server API adapters call the read/write functions; (3) Owner/Admin release
controls exist in the staff Evaluation Dashboard; (4) shared role-safe Evaluation
components are built; (5) the workspace is activated; (6) live security and privacy QC
passes. None of those are in this branch.
