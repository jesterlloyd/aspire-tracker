# Phase 2C: scoped preceptor-assignment authorization + backend (handoff)

Implementation and review pass. Nothing was run, applied, merged, or deployed, and no Unit
Leader UI action is enabled. Depends on Phase 2B (`20260722000000`).

Deliverables in this branch:
- Migration: `supabase/migrations/20260723000000_preceptor_assignment_authorization.sql`
- Preflight/verification/rollback: `db/audit/preceptor_assignment_authorization_preflight_and_verification.sql`
- Backend: `api/preceptor-primary-assign.js` (owner/admin), `api/portal/unit-preceptor-manage.js` (Unit Leader)
- Staff path updated: `src/components/PreceptorAssignmentModal.jsx` routes the primary change through the audited endpoint
- Static guards: `test/preceptorAuthorizationMigration.test.mjs` (15, passing; full suite 2125/2125)

---

## 1. Migration
One transaction adding: preceptor provenance columns; a `preceptor_assignment_events` audit
table; a durable `staff_notification_queue`; a `BEFORE UPDATE OF preceptor_id` guard on
`students`; and three scoped `SECURITY DEFINER` RPCs plus two internal helpers. Every function
has a fixed `search_path`; the three public RPCs are `REVOKE`d from PUBLIC/anon/authenticated and
granted to `service_role` only; the two tables are RLS-enabled with an owner/admin SELECT policy
and no write policy. Errors use the established `MS400/403/404/409` SQLSTATE convention.

## 2. Application / backend code changes
- **`api/preceptor-primary-assign.js`** (new): owner/admin verify (WS1 pattern), calls
  `assign_primary_preceptor` with the service-role client and the actor's `profile.id`.
- **`api/portal/unit-preceptor-manage.js`** (new): `verifyPortalUnitLeaderCaller`, dispatches
  `change_primary` / `set_secondary` / `create_preceptor` to the three RPCs with `profile.id`;
  never writes a table directly; maps `MS4xx` via `unitLeaderRpcErrors.js`.
- **`src/components/PreceptorAssignmentModal.jsx`**: the primary change now POSTs to
  `/api/preceptor-primary-assign` instead of a bare `students.update({preceptor_id,…})` +
  `matches.update`. The 2B trigger keeps `matched_preceptor`/`preceptor_email`/the current-cohort
  match FK in sync. The cohort-participation upsert and query invalidation are unchanged.
- Not built (per scope): the Unit Leader UI actions that call `unit-preceptor-manage.js`.

## 3. Preflight / verification / rollback
See the audit file. BEFORE confirms 2B is applied and 2C objects are absent; AFTER confirms the
guard is `BEFORE UPDATE` + `SECURITY INVOKER` + fixed search_path, the RPCs are `SECURITY DEFINER`
+ service-role-only (with a `has_function_privilege` check that authenticated/anon cannot execute),
the two tables have RLS + owner/admin SELECT only, `preceptors` gained the provenance columns, and
no other RLS was widened. An optional scratch-transaction smoke test denies a non-owner/admin
direct `preceptor_id` update. ROLLBACK drops the objects (and warns that removing the guard
reopens the broad path).

## 4. Authorization truth table

| Actor | Change Primary | Add/Replace/End Secondary/Coverage | Create preceptor | Direct `students.preceptor_id` UPDATE |
|---|---|---|---|---|
| **Owner** (active) | Allowed, any student (RPC; also allowed direct by the guard's owner/admin path) | Allowed, any student (RPC) | Allowed, any unit (RPC) | Allowed (guard path B) |
| **Admin** (active) | Allowed, any student | Allowed, any student | Allowed, any unit | Allowed (guard path B) |
| **Unit Leader** (active grant + active scope) | Allowed **only** for students in scope (RPC) | Allowed **only** in scope (RPC) | Allowed **only** for a unit in scope (RPC) | **Denied** (MS403); must use the RPC |
| **Interviewer / Viewer / co_lead** | Denied (RPC MS404; direct MS403) | Denied | Denied | **Denied** (MS403) |
| **Portal student / anon** | Denied | Denied | Denied | Denied (RLS + guard) |
| **service_role / migration** | Allowed via RPC (or a marked direct write) | Allowed | Allowed | Allowed only when the marker is set (trusted server context) |

Cross-cutting rules enforced by the RPCs for every actor: an **inactive preceptor** cannot be
assigned (MS400); a completed rotation **within** 90 days requires a **reason** (MS400); a
completed rotation **beyond** 90 days is **denied** (MS403); the same preceptor cannot be active in
two roles for a student/cohort (ppm3 index → MS409); primary rows are never written by the
secondary/coverage RPC; new preceptors dedup by normalized email (MS409).

**How the guard admits the RPC without a general bypass.** The guard (SECURITY INVOKER, so it sees
the real `current_user`) allows a `preceptor_id` change only when (A) a transaction-local marker
`app.preceptor_change_authorized` is set **AND** `current_user` is a privileged (non-`authenticated`/
`anon`) role; the RPC sets the marker right before its UPDATE; or (B) the JWT caller is an active
owner/admin (the existing staff path). A client cannot satisfy (A): it can't assume a privileged
role, and it cannot set the marker (PostgREST gives no raw-SQL channel), so the marker is never a
sole gate. A different `SECURITY DEFINER` function that does not set the marker fails (A), so there
is no general definer bypass. Everything else fails closed (MS403).

## 5. Exact dependency on Phase 2B
The primary RPC sets `students.preceptor_id` and relies on the 2B `trg_sync_primary_preceptor_mirror`
trigger to end the stale active-primary row, insert the new one, and align the display + single
current-cohort match mirror. **Apply 2B first.** The 2C BEFORE guard and the 2B AFTER trigger both
fire on a `preceptor_id` change: BEFORE (authorize) then the write then AFTER (mirror). If 2B is
absent, the RPC still sets `preceptor_id` but the normalized mirror would not update , so 2C must
not be applied without 2B.

## 6. Maintenance-window application order
1. Run both preflights (2B BEFORE, 2C BEFORE).
2. Apply Phase 2B (`20260722000000`).
3. Apply Phase 2C (`20260723000000`) immediately after.
4. Run both verifications (2B AFTER, 2C AFTER) , all checks must pass.
5. Deploy the compatible application changes (the two endpoints + the modal change) in the same
   window, so owner/admin primary assignment keeps working the moment the guard is live.
6. Enable the Unit Leader assignment UI (a later pass) only after all checks pass.

## 7. Compatibility with the current staff `PreceptorAssignmentModal`
- With only the guard applied and the modal unchanged, owner/admin still work (guard path B allows
  their direct write); interviewer/viewer lose the ability to write `preceptor_id` directly (they
  never had the UI, but the DB boundary now matches). So the migration is backward-compatible.
- The modal change (in this branch) routes the primary write through the RPC so every owner/admin
  primary change is audited and notified, and stops the modal writing `matched_preceptor`/
  `preceptor_email`/`matches.preceptor_id` (the 2B trigger owns those). **Tradeoff:** the modal now
  depends on the endpoint + RPC, so it must deploy in the same window as the migration; until then
  path B keeps the unchanged modal working. The modal keeps its `preceptor_cohort_participation`
  upsert and cache invalidation.

## 8. Test results
`test/preceptorAuthorizationMigration.test.mjs`: 15 static guards, all passing; full suite
**2125/2125**. Guards cover: guard is BEFORE/INVOKER/fixed-search_path/fail-closed; RPC path
requires marker AND privileged role (no sole-GUC, no general-definer bypass); RPCs are
DEFINER/service-role-only and authorize from `p_actor_profile_id` (never `auth.uid()`);
completed-rotation reason/window; primary sets `preceptor_id` + records the matches anomaly;
secondary/coverage never touch primary and dedup to MS409; create dedups by normalized email +
records provenance + pins shift; audit + durable enqueue in one transaction; no RLS widening;
endpoints verify the caller and never write directly; the modal routes through the endpoint; no em
dash. Behavioral proof (deny interviewer, allow owner/admin, in/out-of-scope UL, trigger still
syncs) requires the live DB and is scripted in the verification file's optional smoke section.

## 9. Blockers / genuine product decisions

- **B1 (decision): completed-rotation denial for Owner/Admin.** The RPC denies a change to a
  student whose rotation completed more than 90 days ago, for ALL actors, matching the task's
  "deny outside the window." For a Unit Leader this also falls out of scope (they can't see the
  student). For an **Owner/Admin**, this blocks legitimate late history corrections. Decide whether
  owner/admin should get an override (e.g. a `p_force` flag that still requires a reason and audits
  as an out-of-window correction). As written, owner/admin are bound by the window.
- **B2 (decision): cross-unit assignment.** The canonical model does not bind a student's preceptor
  to the student's unit, so the RPC permits assigning a preceptor from another unit (only inactivity
  is blocked). If a Unit Leader should be restricted to preceptors within their own unit, that is a
  new rule to add.
- **B3 (decision): notification delivery worker.** `staff_notification_queue` is enqueued
  transactionally (durable, not best-effort) but nothing drains it yet. A small worker (mirroring
  `lib/server/messages/deliveryService.js`) or a cron must be added to send the queued emails to the
  shared inbox. Until then, rows accumulate durably (correct) but no email is sent. Decide whether
  to build the drain worker in this phase or the next.
- **B4 (note, not a blocker): provenance columns are additive.** `preceptors.created_by` /
  `created_by_role` are nullable and back-compatible; existing rows stay NULL.
- **B5 (note): owner/admin audit completeness depends on the modal deploy.** Guard path B lets an
  owner/admin write `preceptor_id` directly (unaudited) if some other client path did so. After the
  modal change deploys, the only owner/admin path is the audited RPC. If you want to forbid ALL
  direct writes (including owner/admin) once the modal is migrated, remove guard path B in a
  follow-up so every change is audited; that is deliberately left in for maintenance-window safety.

## Stop point
Handoff delivered. Nothing applied or deployed. Apply under the Owner SQL gate per the
maintenance-window order, deploy the app changes in the same window, and enable the UL UI only
after verification passes.
