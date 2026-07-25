# Unit Leader Evaluations: Release Verification and Handoff

Status: **Application layer complete on branch `unit-leader-evaluations-backend-ui`
(from `main` baseline `2acd56c`). Not merged, not pushed, not deployed.** No SQL was
added or run on this branch. The release-gate migration was applied and verified before
this branch began; this branch is UI and API only.

This document is the verification record for the Unit Leader Evaluations activation. It
states the current and intended state, the authorization contract, the staff action
matrix, the exact fields a Unit Leader may receive, the privacy guarantees and their
limits, the performance findings, the live QC steps to run after deployment, and the
rollback procedure.

## Scope of this branch

Five ordered commits, application layer only:

1. `Add Unit Leader evaluation API adapters` (`cb3247a`)
2. `Add evaluation Review and Release controls` (`b5cc4f2`)
3. `Build shared evaluation reporting components` (`9cb10bd`)
4. `Activate Unit Leader Evaluations workspace` (`b72aa4d`)
5. `Document Unit Leader evaluation release verification` (this commit)

## Database state (already applied and verified, not touched here)

Migration `supabase/migrations/20260725000000_unit_leader_evaluation_release_gate.sql`
was applied to production and verified before this branch. It must NOT be reapplied or
re-verified. The database contains:

- The release-state table (`evaluation_response_unit_release`) with an append-only
  lifecycle event table for audit.
- The quantitative allowlist table (`evaluation_unit_quantitative_keys`), seeded with the
  five approved paths below. This table is the **authoritative** source of what may be
  exposed; the server mirrors it only as defense in depth.
- Lifecycle functions (`ul_eval_moderate_response`, `ul_eval_release_response`,
  `ul_eval_revoke_response`, `ul_eval_rerelease_response`), each SECURITY DEFINER and
  gated on `is_active_owner_or_admin()`.
- Unit Leader read functions (`ul_eval_dashboard_summary`, `ul_eval_response_list`),
  SECURITY DEFINER, scoped from `auth.uid()` and the caller's active authorized units.

Thirteen legacy responses are quarantined (`backfill_unverified` / `ineligible`) and stay
hidden. Nothing in this branch reveals, releases, or re-verifies them.

## Authorization contract (caller JWT, never service role)

Every RPC in this feature is called with a Supabase client authenticated by the request
user's own access token (`getUserScopedDb`, api/lib/messagesAuth.js), which preserves
`auth.uid()` so each SECURITY DEFINER function derives identity, role, and unit scope
server-side. No RPC is ever called with the service-role client, and no caller identity
is ever replaced by a browser-supplied actor id, role, or unit list.

| Surface | Endpoint | Caller gate | DB client | RPC / read |
| --- | --- | --- | --- | --- |
| Unit Leader read | `GET /api/portal/unit-evaluations` | `verifyPortalUnitLeaderCaller` (active UL + scopes) | `getUserScopedDb` | `ul_eval_dashboard_summary`, `ul_eval_response_list` |
| Staff review queue | `GET /api/evaluation-unit-release-queue` | `verifyOwnerAdminCaller` (active Owner/Admin) | `getUserScopedDb` | release table + `evaluation_responses` + `students` via owner/admin RLS |
| Staff lifecycle action | `POST /api/evaluation-unit-release-action` | `verifyOwnerAdminCaller` | `getUserScopedDb` | one of the four lifecycle RPCs |

Unit scope is always server-derived. The browser may send `unit_key` only to NARROW an
already-authorized set; "All assigned units" omits the filter, so the server returns
exactly the caller's currently active authorized units. A `unit_key` outside scope is
denied, never widened. The Unit Leader unit picker is populated from the portal
bootstrap's authorized `unitKeys`, never from response rows.

## Staff action matrix (Owner/Admin only)

Unit Leaders never perform any lifecycle action. Only an active Owner or Admin may
moderate, release, revoke, or re-release. The endpoint maps each RPC status string to an
explicit HTTP code (no opaque 500):

| Action | RPC | Params | Meaning |
| --- | --- | --- | --- |
| Moderate (clear) | `ul_eval_moderate_response` | `p_decision: 'cleared'` | Marks a response cleared for release |
| Moderate (block) | `ul_eval_moderate_response` | `p_decision: 'blocked'` | Blocks a response from release |
| Release | `ul_eval_release_response` | `p_response_id` | Makes a cleared, eligible response visible to the unit |
| Revoke | `ul_eval_revoke_response` | `p_response_id` | Withdraws a released response |
| Re-release | `ul_eval_rerelease_response` | `p_response_id` | Explicit re-release of a revoked response |

Release requires a cleared moderation state AND eligibility (rotation end + 7 days). A
revoked response is never silently re-released; re-release is a separate explicit action.
Legacy `backfill_unverified` snapshots and `ineligible` rows are read-only in the queue.
Status strings mapped: `success`, `no_change`, `not_authorized`, `not_found`,
`invalid_decision`, `already_released`, `already_revoked`, `not_revoked`,
`not_releasable_state`, `revoked_requires_explicit_rerelease`, `snapshot_unverified`,
`snapshot_incomplete`, `not_yet_eligible`, `not_moderated`.

## Unit Leader output-field allowlist

The Unit Leader payload is built from ONLY these keys and fail-closed asserted before it
is sent (`assertUnitLeaderShape`, lib/server/unitEvaluations/serialize.js). Any key outside
the sets throws and is treated as a 500 rather than sent:

- Top level: `instrument_slug`, `timepoint`, `unit_key`, `released_response_count`,
  `quantitative_averages`, `responses`.
- Each response row: `position`, `anon_label`, `instrument_slug`, `timepoint`, `unit_key`,
  `quantitative`.

A Unit Leader NEVER receives: any id (response/assignment/student/preceptor/cohort/rotation),
student or preceptor identity, email, headshot, any timestamp, free text, raw JSON, staff
actor, or moderation/release lifecycle metadata.

### The five approved quantitative paths

Do not add paths without a matching Owner-reviewed database curation pass on
`evaluation_unit_quantitative_keys`.

- `student_preceptor_eval` → `overall_experience.overall_rating`
- `preceptor_progress` → `developmental_feedback.context.shifts_observed` (context, not an
  outcome), `readiness_endorsement.transition_readiness`,
  `readiness_endorsement.unit_endorsement_consideration`,
  `readiness_endorsement.cedars_consideration_recommendation`

Only two instruments are approved for the first release: `student_preceptor_eval`
("Preceptor & Unit Feedback") and `preceptor_progress` ("Preceptor Readiness
Assessment"). Casey-Fink and the post-rotation program evaluation are excluded and never
appear.

## No-stable-identifier design

The only per-response key a Unit Leader sees is `position`, a 1-based index into the
already-returned in-memory array for the current filter. It is NOT a database id and is
not stable across requests, filters, or releases. The in-memory modal opens from that
positional row; it issues no per-row fetch and holds no durable token. Historical
attribution (the unit and preceptor recorded at submission time) is immutable in the
database and is never surfaced to the Unit Leader.

## No-free-text guarantee

Free text is never requested, serialized, or rendered on the Unit Leader surface. The
allowlist above is quantitative-only; `sanitizeQuantitative` keeps only allowlisted
numeric values (raw numbers for rows, `{avg, n}` for summary averages) and drops
everything else. The modal states its own limit: "Quantitative responses only. Written
comments and identifying details are not shown."

## n = 1 disclosure (no suppression, no anonymity claim)

There is NO minimum-count suppression. Results may appear at n = 1. The interface never
claims anonymity: the words "fully anonymous", "guaranteed anonymous", and
"unidentifiable" do not appear anywhere in this feature. The workspace states plainly that
results are released after the rotation, are quantitative-only, are shown without names or
identifying details, and that when only a few responses exist they should be treated
accordingly. The staff console carries the same caution ("a single-response result is not
anonymous"). This is deliberate: at the cohort sizes a unit sees, a small count can be
identifying, so the UI must not promise otherwise.

## Remaining private-content curation

The database allowlist table is the authority for what is exposed. Broadening the surface
(a new instrument, a new quantitative path, free-text handling) is a database curation
decision that requires Owner review and a new gated migration, not an application change.
The client mirror (`INSTRUMENT_METRIC_PATHS`, `QUANT_METRIC_META`) and the server mirror
(`QUANTITATIVE_PATHS`) exist only to label and defend; neither can widen what the RPCs
return.

## Performance findings

- The workspace is lazy-loaded (`React.lazy`), so its chunk and the shared reporting
  components download only when a Unit Leader opens the Evaluations tab.
- Each `(timepoint, unit)` selection issues exactly two parallel reads, one per approved
  instrument. Each read returns that instrument's summary AND response list together, so
  the critical path for a filter change is ONE round trip (the slower of the two parallel
  requests), not a summary call followed by a separate list call.
- Switching the selected instrument is in-memory: both instruments' payloads for the
  current filter are already held, so no network request occurs.
- An unchanged filter never refetches (the effect keys only on `timepoint` and `unit`).
- A request-id ref guards against a stale response overwriting a newer one, and every
  in-flight request is aborted on unmount or re-fetch.

## Live QC after deployment (manual)

Run these once the branch is deployed and verified live:

1. As a Unit Leader with one active unit, open Evaluations. Confirm exactly two instrument
   cards, released counts, KPI cards, quantitative averages, and an anonymous response
   table. Confirm no names, preceptors, dates, free text, or ids appear anywhere.
2. Open a response row. Confirm the modal shows only the positional label, instrument,
   timepoint, unit, and allowlisted quantitative values; confirm Escape closes it and
   focus returns to the opening row.
3. Switch the selected instrument and confirm no network request fires; change timepoint
   or unit and confirm exactly two parallel requests fire.
4. As a Unit Leader with multiple units, confirm the unit picker lists only authorized
   units plus "All assigned units", and that narrowing changes results without widening.
5. As a non-Owner/Admin, confirm the staff review queue and action endpoints answer 403.
6. As an Owner/Admin, confirm the Review & Release console lists the queue, that legacy
   `backfill_unverified` / `ineligible` rows are read-only, and that a moderate → release
   → revoke → re-release sequence returns the expected statuses. Then confirm a released
   response appears on the matching Unit Leader surface, and a revoked one disappears.

## Rollback

Prefer an application-only rollback that preserves all snapshots and audit history. Do NOT
drop tables, functions, or the migration; the release records and append-only lifecycle
events are the audit trail.

- Fastest: restore the Evaluations mount to the retained placeholder. The placeholder file
  (`src/portal/unit/UnitEvaluationsPlaceholder.jsx`) is kept on disk unreferenced precisely
  as a rollback target; re-point `view === 'evaluations'` at it and redeploy.
- Alternative: disable the route/tab so Evaluations is not reachable, leaving the endpoints
  and database untouched.
- The staff Review & Release console can be hidden independently by reverting the
  Evaluation Dashboard automation-subtab change, without affecting the read surface.

None of these rollbacks touch data: released state, moderation state, eligibility, and the
lifecycle audit remain intact for a later re-activation.
