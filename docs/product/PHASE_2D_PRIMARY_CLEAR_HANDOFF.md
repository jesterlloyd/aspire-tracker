# Phase 2D: Canonical Primary-Preceptor Clear for Match Revert

Status: **SQL APPLIED 2026-08-03. V1-V3 PASSED. PARITY CLEAN (28/0/0). App
integration committed with this handoff; V4 pending the first real
revert-driven clear.**

## Product decision

Reverting a student match ends the primary preceptor relationship. A reverted
student must not retain a hidden canonical primary assignment. (Decision:
Jester, 2026-08-03.)

## What was applied

`supabase/migrations/20260803000000_phase2d_clear_primary_preceptor.sql` (R1),
applied manually by the Owner in the Supabase SQL editor on 2026-08-03 as one
transaction, after the read-only preflight
`db/audit/phase2d_clear_primary_preflight.sql`:

1. `preceptor_assignment_events_action_check` re-created with `clear_primary`
   added to the nine prior actions. The transactional PRECHECK asserted the
   live action list matched the expected nine exactly before the replace.
2. New `public.clear_primary_preceptor(uuid, uuid, text, boolean, boolean, text)`:
   SECURITY DEFINER, fixed search_path, EXECUTE service_role only. Owner/Admin
   only (the shared actor assertion plus a stricter `owner_admin` gate; unit
   leaders are rejected), nonblank request id required at the RPC surface,
   request-id idempotent (claim-before-mutate, replay returns the stored
   result), 2C guard-marker compatible around its single
   `UPDATE students SET preceptor_id = NULL`, `clear_primary` audit event,
   `preceptor_primary_cleared` staff-notification fan-out, matches-anomaly
   surfacing, and an ok/no_change silent path for already-clear students.
   All mirror cleanup is performed by the applied Phase 2B trigger's clear
   branch: the active `role='primary'` assignment row is soft-ended (never
   deleted), `matched_preceptor` and `preceptor_email` are blanked, and the
   current-cohort `matches.preceptor_id` is nulled when the student has
   exactly one same-cohort match row. Secondary and coverage assignments are
   untouched; history is preserved.

## Verification recorded at apply (2026-08-03)

- V1: function present, SECURITY DEFINER, fixed search_path, EXECUTE for
  service_role only (authenticated and anon: false). PASSED.
- V2: the action CHECK lists all ten actions including `clear_primary`. PASSED.
- V3: `assign_primary_preceptor`, `set_secondary_coverage_preceptor`, and
  `create_unit_preceptor` grants unchanged. PASSED.
- Parity: `db/audit/preceptor_parity_check.sql` returned 28 matches, zero
  mismatch_changed, zero mismatch_cleared, zero missing, zero duplicate
  active-primary rows.
- V4 (per-student spot check, audit-event and notification correlation, and
  the controlled same-request replay) is defined in the migration tail and
  REMAINS TO RUN after the first real revert-driven clear in production.

## Application integration (this commit)

- `api/preceptor-assignment-manage.js`: new `clear_primary` action routing to
  the RPC. The caller is server-verified Owner/Admin; the actor id always
  comes from the verified profile, never the request body.
- `src/lib/staffPreceptorAssignmentApi.js`: `clearPrimaryPreceptor(studentId,
  reason)` with one `crypto.randomUUID()` request id per intentional action.
- `src/App.jsx`: both revert paths clear canonically FIRST and fail closed.
  Single unmatch aborts with "Unmatch blocked" if the clear fails; bulk unit
  delete clears every matched student before any mutation and aborts entirely
  ("Unit not deleted") on the first failure. The revert updates no longer
  blank `matched_preceptor` (the trigger owns the mirrors); local state merges
  echo the trigger result.
- Tests: `test/primaryPreceptorClear.test.mjs` (17: RPC contract, R1
  prechecks, endpoint, helper, both integrations, preservation) and the
  revised match-revert guard in `test/preceptorFreetextReplacement.test.mjs`.

## Sequencing note

The app integration is safe only with the migration applied (an unapplied RPC
makes revert fail closed with "Unmatch blocked" and no mutation). The SQL was
applied BEFORE this commit, so the release order is satisfied.

## Remaining owner action

After the first production match revert that clears a primary, run V4a-V4g in
the migration tail (canonical field and mirrors, soft-ended history,
same-cohort match FK or anomaly event, exactly one `clear_primary` event under
`preceptor_clear:<request_id>`, notification rows against the expected
recipient count, the idempotency ledger row, and the controlled same-request
replay with unchanged counts), then re-run
`db/audit/preceptor_parity_check.sql` (expect match-only).
