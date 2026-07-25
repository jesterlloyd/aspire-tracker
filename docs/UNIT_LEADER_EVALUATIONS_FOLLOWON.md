# Unit Leader Evaluations: API + UI Follow-On Contract

This is the plan for the branch AFTER the SQL-gate migration is manually applied and
verified in production. Nothing here is built on the SQL-gate branch.

Planned branch: `unit-leader-evaluations-backend-ui`

## Preconditions (all required before starting the follow-on)

1. `supabase/migrations/20260725000000_unit_leader_evaluation_release_gate.sql` applied
   through the Owner SQL gate.
2. `db/audit/unit_leader_evaluation_release_gate_verification.sql` run and every check
   confirmed (objects, security attributes, least-privilege grants, backfill counts,
   immutability, base tables untouched).

## Planned sequence

1. **Verify production migration.** Re-run the verification script against production;
   confirm no non-approved instrument rows and that lifecycle functions are service_role
   only.
2. **Server API adapters.** Add `api/portal/unit-evaluations*.js` following the existing
   Unit Leader endpoint pattern (`verifyPortalUnitLeaderCaller` for the caller identity),
   calling the database read functions. The endpoints are thin: the database functions
   already enforce grant, scope, release, eligibility, and field shaping. Reads run as the
   authenticated caller (so `my_unit_scope_keys()` resolves their JWT scope); the endpoint
   never passes a unit key as authority, only as a narrowing filter.
3. **Owner/Admin release controls.** Add moderation/release/revoke controls to the existing
   staff Evaluation Dashboard (a new server endpoint calling `ul_eval_moderate_response` /
   `ul_eval_release_response` / `ul_eval_revoke_response` with the authenticated Owner/Admin
   actor id). Never expose these to Unit Leaders.
4. **Shared role-safe Evaluation components.** Extract/generalize the main-app Evaluation
   Dashboard primitives (KPI cards, instrument/timepoint selectors, response table,
   response viewer modal) with a role-safe adapter that renders only the anonymous,
   quantitative, unit-level payload the read functions return. No free text, no identity,
   no preceptor grouping, no staff lifecycle controls.
5. **Activate the Unit Leader Evaluations workspace.** Replace
   `src/portal/unit/UnitEvaluationsPlaceholder.jsx` with the workspace. Honest states:
   nothing released yet; awaiting eligibility; instrument unavailable. Present `n = 1`
   results plainly and never claim anonymity is guaranteed (the Owner-accepted contextual
   re-identification risk).
6. **Live security and privacy QC.** With a controlled Unit Leader account: confirm only
   released, eligible, in-scope, quantitative data appears; a revoked response disappears
   immediately; a parameter cannot widen scope; no identity, free text, or identifying
   timestamps ever render; the staff dashboard and student submission are unaffected.

## Explicitly out of scope for the SQL-gate branch

No endpoint, no UI, no activation, no release control, and no change to the staff
Evaluation Dashboard were made. The Evaluations tab remains the placeholder until the
follow-on ships and passes live QC.
