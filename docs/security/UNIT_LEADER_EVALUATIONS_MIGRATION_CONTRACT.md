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
- Identity: `id`, `response_id UNIQUE → evaluation_responses(id) ON DELETE RESTRICT`
  (audit-preserving: a response with a release row cannot be deleted out from under its
  history), `public_token` (opaque handle returned to Unit Leaders instead of the raw
  response_id), `assignment_id`, `instrument_id`, `instrument_slug`, `timepoint`.
- Immutable snapshot: `hist_unit_id`, `hist_unit_key`, `hist_preceptor_id`,
  `hist_preceptor_label` (audit only), `hist_cohort_id`, `hist_cohort_label`,
  `hist_rotation_id`, `hist_rotation_end` (timestamptz effective end),
  `unit_leader_eligible_at` (= effective end + 7 days; NULL if end unknown),
  `snapshot_source` (`submission_trigger` | `backfill_verified` | `backfill_unverified`),
  `snapshot_captured_at`.
- Mutable lifecycle: `release_state` (`pending` | `moderated` | `released` | `revoked` |
  `ineligible`, default `pending`) is the authoritative visibility state;
  `moderation_state` (`pending` | `cleared` | `blocked`, default `pending`);
  `quantitative_visible bool` (default false); `free_text_visible bool` (default false,
  hard-locked false by CHECK); `released_at/by`, `moderated_at/by`, `revoked_at/by`
  (`revoked_at/by` is the last-revocation record and is **never cleared**; reads gate on
  `release_state`, not `revoked_at`), `created_at`, `updated_at`.
- Constraints: approved-slug CHECK; free-text-hidden CHECK; released↔visible CHECK; state
  enums.

`public.evaluation_response_unit_release_events` (append-only lifecycle audit, §4a).

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

## 4a. Append-only lifecycle audit

`public.evaluation_response_unit_release_events` records every `moderate`, `release`,
`revoke`, and `re_release` action with: `response_id` (a durable reference, intentionally
NOT a cascading FK, so audit survives anything), `event_type`, `decision`
(`cleared`/`blocked` for moderation), `prior_release_state`/`new_release_state`,
`prior_moderation_state`/`new_moderation_state`, `actor_profile_id` (the acting Owner/Admin
from `portal_profile_id()`), `created_at`, and `notes`. A `BEFORE UPDATE OR DELETE` trigger
raises, so the log is strictly append-only: prior history is never overwritten or erased.
RLS mirrors the release table (owner/admin SELECT; Unit Leaders get nothing directly).

## 5. Authorization contract (enforced in the database)

Read functions (SECURITY DEFINER, `search_path = public, pg_catalog`, EXECUTE to
`authenticated`, scope from `auth.uid()` via `has_active_role_grant('unit_leader')` and
`my_unit_scope_keys()` — the active role-grant model with revocation/expiration; the
browser cannot supply scope authority):
- `ul_eval_dashboard_summary(p_instrument_slug, p_timepoint, p_unit_key)` → jsonb unit-level
  aggregates.
- `ul_eval_response_list(p_instrument_slug, p_timepoint, p_unit_key)` → rows of
  `(anon_label, response_token, instrument_slug, timepoint, unit_key, quantitative jsonb)`.
- `ul_eval_response_detail(p_token)` → jsonb; keyed by the **opaque token**, re-checks scope
  + release for that exact token, never trusting a prior list.

Every read applies the full defense-in-depth predicate set: active `unit_leader` grant;
approved instrument slug; `release_state = 'released'`; `release_state <> 'revoked'`;
`moderation_state = 'cleared'`; `quantitative_visible = true`; `free_text_visible = false`;
`snapshot_source IN ('submission_trigger','backfill_verified')`;
`unit_leader_eligible_at IS NOT NULL AND now() >= unit_leader_eligible_at`;
`hist_unit_key` ∈ the caller's active scopes (cohort-aware); `p_unit_key` only narrows.

**No raw response_id** is ever returned: reads emit `public_token` (an opaque 32-char
handle, unrelated to any record id); the exact `response_id` never leaves the server, and
`ul_eval_response_detail` accepts only the token. Quantitative payload comes from the
**explicit per-instrument section allowlist** `_ul_eval_safe_quantitative(slug, responses)`
(see §5a) — numeric leaves only, so free text, identity, and the evaluated target are
excluded structurally. No identity, no timestamps, no preceptor grouping. The anonymous
label is positional within the result (ephemeral), not a stable cross-context tracker.

Write / lifecycle functions (SECURITY DEFINER, EXECUTE to `authenticated`; the internal
gate `is_active_owner_or_admin()` — evaluated against the **caller's JWT**, not a passed or
spoofable actor id and not a bespoke `user_profiles.role` read — denies everyone who is not
an active Owner/Admin; the acting profile is `portal_profile_id()`). Every action writes an
append-only audit event (§4a):
- `ul_eval_moderate_response(p_response_id, p_decision)` — `cleared` advances a pending row
  to `moderated`; **`blocked` immediately hides a released response** (demotes it, clears
  `quantitative_visible`).
- `ul_eval_release_response(p_response_id)` — blocks unless instrument approved, snapshot
  verified (not `backfill_unverified`) and complete, `now() >= unit_leader_eligible_at`,
  moderation `cleared`. **Refuses a revoked row** (`revoked_requires_explicit_rerelease`)
  and never clears `revoked_at/by`.
- `ul_eval_revoke_response(p_response_id)` — immediately clears visibility; keeps
  `revoked_at/by`.
- `ul_eval_rerelease_response(p_response_id)` — the ONLY way to re-show a revoked response;
  explicit, audited (`event_type = 're_release'`), re-checks every gate, preserves
  `revoked_at/by`.

Table grants (both new tables): `ENABLE ROW LEVEL SECURITY`;
`REVOKE ALL FROM PUBLIC, anon, authenticated`; `GRANT SELECT TO authenticated` with an
`is_active_owner_or_admin()` SELECT policy (staff read directly; Unit Leaders get zero rows
via direct access and must use the functions); `GRANT ALL TO service_role`.

### 5a. Explicit per-instrument quantitative allowlist

`_ul_eval_safe_quantitative(p_slug, p_responses)` returns a flat `{'section.item': number}`
map taking numeric leaves ONLY from the allowlisted quantitative sections of each
instrument. The exact numeric leaf item codes live in the instruments' private content and
are narrowed further in the follow-on API branch; the numeric-only filter guarantees no
free text can ever leak.

| Instrument | Allowlisted quantitative sections | Excluded (never exposed) |
|---|---|---|
| `student_preceptor_eval` | `preceptor_support`, `learning_environment`, `psychological_safety`, `overall_experience` | `evaluated_target` (identifying), `narrative` (free text), `attestation` |
| `preceptor_progress` | `developmental_feedback`, `readiness_endorsement` | `confidential_team_comments` (free text), `attestation` |

### 5b. Preceptor attribution source (assignment/respondent relationship)

Preceptor attribution is snapshotted from the assignment, never from
`students.preceptor_id`:
- `preceptor_progress`: `hist_preceptor_id = evaluation_assignments.respondent_preceptor_id`
  (the responding preceptor is the evaluated preceptor).
- `student_preceptor_eval`: `hist_preceptor_id = NULL` — the evaluated preceptor/unit is
  carried in `responses.evaluated_target`, and there is no authoritative preceptor id
  column. Preceptor attribution is audit-only and is never returned to a Unit Leader.

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

Preferred emergency rollback preserves all data: revoke EXECUTE on the read functions (and,
optionally, the lifecycle functions) — instantly disabling Unit Leader reads and freezing
the lifecycle — while leaving both tables, all snapshots, all release state, and the entire
append-only audit history intact. Full teardown (only safe before first production use of
the lifecycle functions, i.e. before any real state or audit history exists) drops the
functions, then the triggers, then both new tables. See
`db/audit/unit_leader_evaluation_release_gate_rollback.sql`. Never delete
`evaluation_responses` content, and never erase audit history after first use.

## 10. Owner pre-apply review corrections (this revision)

| # | Correction | How it is enforced |
|---|---|---|
| A | Blocked moderation hides a released response; reads require cleared moderation | `ul_eval_moderate_response('blocked')` demotes + clears visibility; all reads require `moderation_state='cleared'` |
| B | Append-only lifecycle audit | `evaluation_response_unit_release_events` + append-only trigger (§4a) |
| C | Authoritative active authorization model | writes gate on `is_active_owner_or_admin()` (caller JWT); reads on `has_active_role_grant('unit_leader')`; no bespoke role read, no passed actor id |
| D | No raw response_id to Unit Leaders | reads emit `public_token`; detail keyed by token; response_id stays server-side |
| E | Per-instrument quantitative allowlist | `_ul_eval_safe_quantitative` section allowlist + numeric-only (§5a) |
| F | Immutability test fails hard | verification block raises `assert_failure` on a successful forbidden update, not swallowed |
| G | Explicit audited re-release | ordinary release refuses revoked; `ul_eval_rerelease_response` is the only path; `revoked_at/by` never cleared |
| H | Preceptor attribution from assignment/respondent | `respondent_preceptor_id` for `preceptor_progress`, NULL for `student_preceptor_eval`; never `students.preceptor_id` (§5b) |
| I | Audit-preserving deletion behavior | `response_id … ON DELETE RESTRICT`; audit `response_id` is a durable non-FK column |
| J | Defense-in-depth read predicates | cleared moderation, quantitative visibility, verified snapshot, hidden free text, release state, eligibility, non-revocation on every read |
| K | Expanded verification | active-grant, blocked invisibility, audit preservation, no-raw-UUID, allowlisted keys, corrected immutability failure |
| L | Docs/rollback/tests/verification realigned | this contract, the rollback, the static tests, and the verification script match the corrected SQL |

## 9. UI activation gate

The Unit Leader Evaluations workspace stays a placeholder until, in the follow-on branch
`unit-leader-evaluations-backend-ui`: (1) this migration is applied and verified in
production; (2) server API adapters call the read/write functions; (3) Owner/Admin release
controls exist in the staff Evaluation Dashboard; (4) shared role-safe Evaluation
components are built; (5) the workspace is activated; (6) live security and privacy QC
passes. None of those are in this branch.
