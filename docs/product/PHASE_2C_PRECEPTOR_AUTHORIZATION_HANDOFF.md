# Phase 2C: Scoped Preceptor-Assignment Authorization (Revised): Handoff

Status: AUTHORED AND VERIFIED LOCALLY. NOT APPLIED, NOT DEPLOYED, NOT MERGED.
Branch: `phase2c-preceptor-authz` (working tree; HEAD is the original 2C commit `3a90b66`).
Baseline: Phase 2B `c2103d5` (mirror repair + sync). This revision supersedes the original
2C authored at `3a90b66`.

This pass implemented the locked product decisions, authored the revised migration and its
preflight/verification/rollback, built a runnable Owner/Admin notification subsystem (in-app +
email queue + worker), updated the two server endpoints, updated the static guard tests, and
added a behavioral worker test. Per the standing constraint, no SQL was run, neither migration
was applied, nothing was merged/pushed/deployed, and the Unit Leader assignment UI is not
enabled.

---

## 1. Exact change set from `3a90b66`

All work is uncommitted in the working tree (HEAD = `3a90b66`), so the diff below IS the exact
change from the original 2C.

Modified (6):

| File | What changed |
| --- | --- |
| `supabase/migrations/20260723000000_preceptor_assignment_authorization.sql` | Full rewrite. Per-student transaction-local marker (was actor-scoped); completed-rotation 90-day window with UL hard-deny and Owner/Admin force+confirm+reason override; cross-unit assignment allowed; unified `staff_notifications` (in-app + email) replacing the prior separate queue; fan-out excludes the actor and is idempotent; `matches` anomaly recorded, not fatal; `claim_due_staff_notifications` and `mark_staff_notifications_read` RPCs; removed the client UPDATE policy (column-tamper hole). |
| `db/audit/preceptor_assignment_authorization_preflight_and_verification.sql` | Rewritten for the revised objects (INVOKER guard, four service-role RPCs, mark-read authenticated grant, two tables + policies, provenance columns, no-RLS-widening checks, rollback order). |
| `api/portal/unit-preceptor-manage.js` | Dropped `SHARED_INBOX_EMAIL`/`p_notify_email`; forwards `p_force`/`p_confirm_override` (a UL can never override; the RPC denies it regardless). |
| `api/preceptor-primary-assign.js` | Dropped `SHARED_INBOX_EMAIL`/`p_notify_email`; forwards `p_force`/`p_confirm_override` from the request. |
| `test/preceptorAuthorizationMigration.test.mjs` | Rewritten static guards for all revised objects. |
| `vercel.json` | Registered the `staff-notification-worker` cron (`*/10 * * * *`) and its 60s function budget. |

Added (5):

| File | Purpose |
| --- | --- |
| `lib/server/staffNotifications/config.js` | Reuses the messages sender + retry/claim constants (`aspire@cshs.org` reply identity). |
| `lib/server/staffNotifications/emailContent.js` | `buildStaffNotificationEmail(row)` → `{subject, text, html}`, links to the student/preceptor. |
| `lib/server/staffNotifications/deliveryService.js` | `runStaffNotificationWorker`/`processClaimedStaffNotification`: claim via RPC, send via Resend with a per-recipient idempotency key, persist queue state. Reuses `nextDeliveryState`/`classifyResendError`/`sanitizeErrorText`. |
| `api/cron/staff-notification-worker.js` | Vercel cron endpoint (Bearer `CRON_SECRET`, `startCronRun`/`finishCronRun*`), mirrors `messages-delivery-worker.js`. |
| `test/staffNotificationWorker.test.mjs` | Behavioral proof of the worker (send/mark-sent, retry, permanent-fail, give-up, idempotency key, resilience, empty no-op). |

Not part of this change: the two `" 2"`-suffixed working-tree files (`src/pages/ActivateAccountPage 2.jsx`, `test/portalActivation.test 2.mjs`) are cloud-sync duplication artifacts and are excluded from the commit.

---

## 2. Authorization truth table

Actor authority to change Primary / Secondary / Coverage for a given student. "In scope" = an
active `unit_leader` grant AND an active `user_unit_scopes` row whose `unit_key` equals the
student's matched unit name (cohort null = all cohorts). Preceptor may be from ANY unit
(cross-unit allowed); only an inactive preceptor is rejected.

| Actor | Student in actor's authority | Result |
| --- | --- | --- |
| Active Owner/Admin (`role in (owner,admin)` or `is_owner`) | Any student | ALLOWED (global) |
| Active Unit Leader | Student in the UL's active unit scope | ALLOWED |
| Active Unit Leader | Student outside scope / no scope row | DENIED `MS404` (non-enumerating) |
| Interviewer / viewer / co_lead / other staff | Any student | DENIED `MS404` |
| Any actor | Preceptor is inactive or missing | DENIED `MS400` |
| Any actor | Same preceptor already Primary | DENIED `MS409` (primary path) |
| Any actor | Duplicate active Secondary/Coverage for that preceptor | DENIED `MS409` |
| Direct client `UPDATE students.preceptor_id` by a non-owner/admin | n/a | DENIED `MS403` (guard) |
| Direct client `UPDATE students.preceptor_id` by an active owner/admin | n/a | ALLOWED (existing staff path, still audited when routed through the endpoint) |
| Unit Leader attempting a direct table write | n/a | Impossible: ULs have no table write; they act only through the service-role RPC |

The API always passes the caller's own resolved `user_profiles.id` as `p_actor_profile_id`; the
RPC re-derives authority from that id, so a compromised API layer cannot widen scope by passing
an arbitrary id.

---

## 3. Completed-rotation truth table

Window: student `status = 'Completed'` AND `COALESCE(rotation_completed_at,
rotation_end_date::timestamptz) >= now() - INTERVAL '90 days'` is "within window". A completed
student with a NULL end date is treated as BEYOND the window (fail-closed).

| Student state | Actor | force | confirm | reason | Result |
| --- | --- | --- | --- | --- | --- |
| Active, or Completed within 90 days | Owner/Admin or in-scope UL | any | any | any | ALLOWED, normal authorization; `was_override = false` |
| Completed beyond 90 days | Unit Leader | true or false | true or false | any | DENIED `MS403` (ULs can never override, even with force) |
| Completed beyond 90 days | Owner/Admin | false | any | any | DENIED `MS403` (force required) |
| Completed beyond 90 days | Owner/Admin | true | false | any | DENIED `MS403` (explicit confirmation required) |
| Completed beyond 90 days | Owner/Admin | true | true | empty/null | DENIED `MS400` (reason required) |
| Completed beyond 90 days | Owner/Admin | true | true | non-empty | ALLOWED; `was_override = true`; audit and every notification are flagged as a historical override |

The generic `force` flag never bypasses unit scope for a Unit Leader: scope is asserted before
the window check, and a UL who reaches the window branch is hard-denied regardless of `force`.

---

## 4. Notification-delivery truth table

Every UL assignment change, every UL-created preceptor, and every Owner/Admin >90-day override
writes one durable audit row (`preceptor_assignment_events`) AND fans out one durable
`staff_notifications` row per recipient, in the SAME committed transaction as the assignment.
The email worker is a separate, retry-safe process.

| Event | In-app row created for | Emailed to | Dedup key | Override flagged |
| --- | --- | --- | --- | --- |
| Primary changed | Every active Owner/Admin except the actor | Same set | `(correlation_id, recipient_profile_id)` | Yes when `was_override` |
| Secondary/Coverage add/replace/end | Same | Same | Same | Yes when `was_override` |
| Preceptor created (by UL or Owner/Admin) | Same | Same | Same (`preceptor_created:<id>`) | UL creations labeled "(review)" |
| `matches` anomaly (>1 same-cohort match) | Same | Same | `<corr>:anomaly` (distinct row) | n/a (does not fail the assignment) |

Worker behavior (proved in `test/staffNotificationWorker.test.mjs`):

| Send outcome | Queue transition | Re-sent? |
| --- | --- | --- |
| Success | `processing` → `sent`, `resend_email_id` recorded, 1 attempt | Never (only `queued`/`retry_wait` rows are due) |
| Transient error (throw / rate limit / 5xx), attempts < 5 | `retry_wait`, `next_attempt_at` scheduled by backoff | Yes, after backoff |
| Transient error, attempts = 5 | `failed` | No |
| Permanent error (validation, bad from, restricted key) | `failed` immediately | No |
| Row persistence throws | Row left `processing`; stale-claim recovery re-queues it | Recovered later |

Double-send protection is two-layered: the DB `UNIQUE(correlation_id, recipient_profile_id)`
guarantees one row per event per recipient, and the Resend `Idempotency-Key`
(`correlation_id:recipient_profile_id`) guarantees the provider never sends the same event to
the same recipient twice, even across retries. A send failure never rolls back the committed
assignment (the worker runs in its own transaction, after commit).

---

## 5. Exact Phase 2B dependency

2C depends on Phase 2B (`20260722000000_preceptor_mirror_repair_and_sync.sql`) and must be
applied AFTER it. The coupling is on `students.preceptor_id`:

- 2C's `assign_primary_preceptor` sets `students.preceptor_id` (authorized to the guard by the
  per-student marker), then relies on 2B's AFTER trigger `trg_sync_primary_preceptor_mirror` to
  mirror that change into the active-primary `student_preceptor_assignments` row, the students
  display fields, and the single current-cohort `matches.preceptor_id`.
- Trigger ordering on `students` is correct by design: 2C's guard is `BEFORE UPDATE OF
  preceptor_id` (it authorizes the write) and 2B's sync is `AFTER INSERT OR UPDATE OF
  preceptor_id` (it mirrors the committed value). BEFORE fires first, then the row updates, then
  AFTER mirrors. The two triggers coexist without interference.
- 2C's `matches` anomaly branch exists precisely because 2B's mirror updates the match FK only
  when the student has exactly one same-cohort match row. When there is more than one, 2B leaves
  the FK unsynced by design; 2C records a structured anomaly event and notifies, without failing
  the assignment.

If 2B is not applied first, the primary assignment still succeeds (the row is written and
audited) but the SPA/display/match mirror is not maintained, which violates the canonical model.
Do not apply 2C alone.

---

## 6. Maintenance-window order

1. Run the Phase 2B BEFORE block; confirm counts match the accepted 2A findings
   (`6a_matched_preceptor=4`, `6a_preceptor_email=0`, `7a=4`, all others 0; cardinality B2b = 0).
2. Apply Phase 2B (`20260722000000_...`) in one transaction.
3. Run the Phase 2B AFTER block; confirm all defect counts are 0 and the 8-row audit provenance.
4. Run the Phase 2C BEFORE block; confirm the 2B trigger is present and the 2C objects are absent.
5. Apply Phase 2C (`20260723000000_...`) in one transaction.
6. Run the Phase 2C AFTER block; confirm the INVOKER guard, the four service-role RPCs, the
   `authenticated` mark-read grant, both tables + SELECT-only policies, the provenance columns,
   and that no other RLS was widened.
7. Deploy the compatible app changes (endpoints, worker, `vercel.json` cron) so the worker is
   running BEFORE any UL assignment UI is enabled.
8. Leave the Unit Leader assignment UI disabled until explicitly approved.

The full numbered checklist for steps 1 through 8, with the exact SQL to paste at each step, is
in the Final Owner SQL Review Package below.

---

## 7. Existing UI compatibility (`PreceptorAssignmentModal`)

The staff `PreceptorAssignmentModal` already routes the Primary write through
`/api/preceptor-primary-assign` (its `assignPrimaryViaApi` path); this pass did not change the
component. After 2C, that endpoint calls the audited `assign_primary_preceptor` RPC instead of a
bare client UPDATE, so the modal keeps working with no code change and every staff Primary change
becomes audited and notified. The modal does not send `force`/`confirmOverride`, so for an
active or within-90-day student it behaves exactly as before; a >90-day override would require
those flags, which is a future UI affordance, not enabled here.

---

## 8. Notification model justification (why a new table)

The requirement is one durable, per-recipient record carrying BOTH in-app read/unread state AND
email queue state, deduped by a stable event key, linked to student/preceptor, for a fan-out set
(every active Owner/Admin except the actor). The existing `message_notification_deliveries` model
cannot support this: it is FK-coupled to `conversations`/`messages` with a constrained
`event_type`, and it has no per-recipient in-app read state for staff. Reusing it would mean
inventing synthetic conversation/message rows for assignment events, which is a worse coupling
than a purpose-built table. `staff_notifications` is therefore a new table, but it deliberately
reuses the proven queue shape (queue_status CHECK, attempts, next_attempt_at, locked_at/by,
SKIP-LOCKED claim, the `nextDeliveryState` retry logic) so the two workers behave identically.
No competing in-app system was created: the table holds both channels in one row.

---

## 9. Guard safety under connection pooling and nested SECURITY DEFINER (re-check)

The original 2C used a transaction-local GUC marker set to the actor id plus a privileged-role
check. Re-examined under Supabase transaction pooling and nested definer calls:

- The marker is `set_config(..., is_local => true)`, which resets at COMMIT/ROLLBACK. Supabase
  transaction pooling reuses a backend only BETWEEN transactions, so a transaction-local value
  cannot leak into another pooled session's transaction.
- The remaining risk was intra-transaction: while the marker was set, any nested write to a
  DIFFERENT student's `preceptor_id` would also pass. This pass HARDENS the marker to the exact
  student id being changed (`v_marker = NEW.id::text`), so the marker authorizes only the one row
  the RPC is updating; an unrelated nested write is not covered and hits the guard.
- The marker alone is never sufficient: the guard also requires `current_user NOT IN
  ('authenticated','anon')`. A client (PostgREST) cannot set the GUC (no raw-SQL channel) and
  cannot assume a privileged role, and a bare SECURITY DEFINER function that does not set the
  per-row marker fails the check, so there is no general definer bypass.
- The guard is `SECURITY INVOKER` (not DEFINER) so it observes the REAL `current_user`: a client
  update runs as `authenticated`; the RPC's update runs as the RPC owner. A DEFINER guard would
  always see its own owner and could not distinguish them. Fixed `search_path` on every function.

No GUC-based general bypass exists, and the authority model (owner/admin global, UL scoped, no
one else) is preserved.

---

## 10. Test and build results

- Full suite: `node --test 'test/*.test.mjs'` → 2136 tests, 2136 pass, 0 fail.
- Phase 2C files: `test/preceptorAuthorizationMigration.test.mjs` (static guards) +
  `test/staffNotificationWorker.test.mjs` (behavioral) → 26 pass, 0 fail.
- Client build: `vite build` → clean.
- SSR bundle build: clean. The `npm run build` prerender STEP fails locally on a missing
  `VITE_SUPABASE_URL` (the Vercel-pulled `.env.local` has empty `VITE_` vars); this is a known
  local-env gap, not a code regression, and this change touches no client/SSR/prerender code.
- Lint: the changed JS lints clean except the repo-wide pre-existing `process is not defined`
  pattern shared by every `api/*.js` and `vite.config.js` (present on the untouched sibling
  `api/preceptor-assignments.js`); `eslint .` reports ~924 pre-existing errors and is not the
  project's pass/fail gate.
- Source hygiene: `git diff --check` clean; no em dash in any changed SQL/JS/JSON.

---

## 11. Blockers and required Owner actions

1. Owner SQL gate: both migrations are GATED and must be applied manually by the Owner in the
   order in Section 6 / the checklist below. Nothing here applies them.
2. `preceptors` UNIQUE on `lower(btrim(email))`: `create_unit_preceptor` dedups by normalized
   email in application logic and catches `unique_violation`. If the `preceptors` table has no
   unique index on the normalized email, two concurrent creations could still both insert. Confirm
   whether such an index exists; if not, it is a follow-up (out of scope for this gated pass).
3. `CRON_SECRET` and Resend env: the worker cron requires `CRON_SECRET` and the Resend key to be
   present in the deployment (same as the messages worker). Confirm both are set before the cron
   runs.
4. In-app surface: `mark_staff_notifications_read` and the `staff_notifications` SELECT policy are
   ready, but no staff in-app notification UI is built in this pass. The email path is fully
   runnable; the in-app cards are a future UI task.
5. UL assignment UI stays disabled until explicitly approved.

---

# Final Owner SQL Review Package

Everything the Owner needs to apply both migrations back-to-back, in one place. The SQL in
Appendices A through D is embedded verbatim from the canonical repository files (identical
byte-for-byte); apply from these files, and use the appendices for review.

Canonical files:
- Appendix A: `supabase/migrations/20260722000000_preceptor_mirror_repair_and_sync.sql` (2B)
- Appendix B: `supabase/migrations/20260723000000_preceptor_assignment_authorization.sql` (2C)
- Appendix C: `db/audit/preceptor_mirror_repair_preflight_and_verification.sql` (2B BEFORE / AFTER / ROLLBACK)
- Appendix D: `db/audit/preceptor_assignment_authorization_preflight_and_verification.sql` (2C BEFORE / AFTER / ROLLBACK)

## Numbered back-to-back application checklist

Run as the service role or an owner/admin, in the Supabase SQL editor. Each apply is ONE
transaction (the migration files already contain `BEGIN;` / `COMMIT;`).

1. Paste and run Appendix C's `BEFORE (read-only)` block. Confirm: `6a_matched_preceptor_disagrees = 4`,
   `6a_preceptor_email_disagrees = 0`, `7a_match_preceptor_disagrees = 4`, `1_* = 0`, `2_* = 0`;
   the cardinality query (B2b) returns ZERO rows; the equivalence gate (B3) returns ZERO rows;
   the 2B trigger does not yet exist (B4 ZERO rows). Record the B2 role/status baseline.
2. Paste and run all of Appendix A (Phase 2B migration). It runs in its own `BEGIN/COMMIT`.
3. Paste and run Appendix C's `AFTER (read-only)` block. Confirm: all five defect counts = 0;
   the role/status counts equal the step-1 baseline; the audit shows `students|matched_preceptor|4`
   and `matches|preceptor_id|4` and 8 total rows; the trigger is AFTER + SECURITY DEFINER with a
   fixed search_path and `public_can_execute = false`; no new RLS policy.
4. Paste and run Appendix D's `BEFORE (read-only)` block. Confirm: the 2B trigger is present (B1
   ONE row); the 2C guard trigger and both 2C tables are absent (B2 ZERO rows each); `preceptors`
   has no `created_by`/`created_by_role` yet (B3 ZERO rows); `is_active_owner_or_admin` and
   `portal_profile_id` both exist (B4).
5. Paste and run all of Appendix B (Phase 2C migration). It runs in its own `BEGIN/COMMIT`.
6. Paste and run Appendix D's `AFTER (read-only)` block. Confirm: the guard trigger exists,
   `security_definer = false` (INVOKER), search_path set (A1); the four write/claim RPCs are
   `security_definer = true` (A2); `assign_primary_preceptor` authenticated = false / service_role
   = true and `mark_staff_notifications_read` authenticated = true / anon = false (A2b); both new
   tables have RLS enabled with SELECT-only policies and NO client write policy (A3); the
   provenance columns exist (A4); no other RLS was widened (A5).
7. Deploy the app changes on this branch (endpoints, `lib/server/staffNotifications/*`,
   `api/cron/staff-notification-worker.js`, `vercel.json`). Confirm `CRON_SECRET` and the Resend
   env are present so the `staff-notification-worker` cron can run.
8. Leave the Unit Leader assignment UI disabled until explicitly approved.

Rollback (only if reverting): run Appendix D's ROLLBACK block first (drops the 2C guard, RPCs,
tables, and provenance columns; note it REOPENS the broad students UPDATE RLS path and you must
stop the worker cron first), then Appendix C's ROLLBACK block (restores the 2B repair from its
audit table and drops the 2B trigger). Revert in the reverse of the apply order.

---

## Appendix A: Phase 2B migration (20260722000000_preceptor_mirror_repair_and_sync.sql)

```sql
-- ============================================================================
-- PHASE 2B: preceptor mirror repair + writer-agnostic sync (PROPOSED, NOT APPLIED)
-- ============================================================================
-- *** GATED. APPLY MANUALLY (Owner/Jester) in the Supabase SQL editor, in ONE      ***
-- *** transaction, ONLY AFTER running the BEFORE block of                          ***
-- *** db/audit/preceptor_mirror_repair_preflight_and_verification.sql and          ***
-- *** confirming the counts match the accepted Phase 2A findings (6a=4, 7a=4, all  ***
-- *** other categories 0). Run the AFTER block immediately after COMMIT.           ***
--
-- WHAT THIS DOES
--   1. A one-time, COLUMN-PRECISE DATA REPAIR of the only defects Phase 2A found:
--      4 students whose students.matched_preceptor is blank (their students.preceptor_email
--      is ALREADY correct) and 4 students whose current-cohort matches.preceptor_id is null.
--      The canonical students.preceptor_id and the active-primary
--      student_preceptor_assignments rows are ALREADY correct (Phase 2A categories
--      1/2/3a/8a = 0), so this repair writes NO student_preceptor_assignments rows. Each
--      mirror column is audited and updated ONLY when that specific column differs, so an
--      already-canonical value (e.g. preceptor_email) is never touched or audited.
--   2. A PREVENTION trigger that keeps the same mirror in step whenever the canonical
--      students.preceptor_id changes, from ANY writer.
--
-- MATCHES CARDINALITY: matches has no unique constraint on (student_id, cohort_id), and the
--   staff writer (PreceptorAssignmentModal) updates a SINGLE match row per student
--   (student_id filter, LIMIT 1, no ordering). To avoid overwriting one of several rows, the
--   repair and the trigger update the current-cohort match FK ONLY when the student has
--   EXACTLY ONE match row in that cohort. Students with more than one are surfaced by the
--   cardinality query in the companion audit file and left for a data decision.
--
-- CANONICAL RULE (unchanged): students.preceptor_id (in students.cohort_id) is THE
--   primary-preceptor identity. Every mirror is derived FROM it. Liveness is status
--   only; rows are soft-ended, never deleted.
--
-- STUDENT-COHORT MODEL (locked): a student is permanently tied to one cohort and is never
--   re-cohorted (they graduate after completing it). Preceptors are NOT tied to a cohort
--   and may precept across cohorts. The trigger therefore fires ONLY on preceptor_id and
--   never watches or responds to students.cohort_id; every assignment write is scoped to
--   the student's fixed cohort, and existing historical rows are left untouched.
--
-- WHAT IT DOES NOT DO
--   - It does not respond to a students.cohort_id change (there is no such thing) and adds
--     no logic that ends or recreates assignments because cohort_id changed.
--   - It does not touch correct active-primary rows, secondary/coverage rows, or ended/
--     removed history (except a direct same-preceptor conflict, see the trigger).
--   - It does not touch matches.preceptor_assigned. That free-text column is NOT a
--     maintained mirror of the canonical preceptor: the assignment writer
--     (PreceptorAssignmentModal) writes matches.preceptor_id only, never
--     preceptor_assigned, and docs/PRECEPTOR_ARCHITECTURE.md lists it as a free-text
--     fallback that "must not be cleared". Aligning it is therefore not canonical behavior.
--   - It does not touch evaluation routing, the preceptors directory, or any RLS policy.
--   - It widens NO permission: who may change students.preceptor_id is unchanged (the
--     existing is_staff() policy on students). The trigger only MIRRORS an already
--     authorized change into the service-managed tables.
--
-- ROLLBACK: see the audit table below and the rollback block in the companion audit file.
-- ============================================================================

BEGIN;

-- ############################################################################
-- 0. Rollback audit table. Captures the prior value of every row this repair will
--    change, under a fixed batch id, so the one-time repair is exactly reversible.
--    No RLS policy is added; RLS is enabled with no policy so the table is reachable
--    only by the service role (never by anon/authenticated via the API).
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.preceptor_mirror_repair_audit (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch       text        NOT NULL,
  entity      text        NOT NULL,   -- 'students' | 'matches'
  ref_id      uuid        NOT NULL,   -- student_id or match_id
  col         text        NOT NULL,   -- column captured
  old_value   text,                   -- prior value, text-cast (NULL preserved)
  captured_at timestamptz NOT NULL DEFAULT now(),
  -- Exactly one snapshot per repaired column, so re-running the snapshot is a no-op and the
  -- rollback join (ref_id, col) can never match more than one row.
  CONSTRAINT uq_pmra_batch_entity_ref_col UNIQUE (batch, entity, ref_id, col)
);
ALTER TABLE public.preceptor_mirror_repair_audit ENABLE ROW LEVEL SECURITY;

-- COLUMN-PRECISE, CONFLICT-SAFE snapshots: each mirror column is captured ONLY when that
-- specific column differs from canonical (an already-correct value is never audited), and
-- ON CONFLICT DO NOTHING makes the snapshot safely repeatable.

-- students.matched_preceptor (only when it differs).
INSERT INTO public.preceptor_mirror_repair_audit (batch, entity, ref_id, col, old_value)
SELECT 'phase2b-preceptor-mirror', 'students', s.id, 'matched_preceptor', s.matched_preceptor
FROM public.students s
JOIN public.preceptors p ON p.id = s.preceptor_id
WHERE s.preceptor_id IS NOT NULL
  AND btrim(lower(coalesce(s.matched_preceptor,''))) IS DISTINCT FROM btrim(lower(coalesce(p.full_name,'')))
ON CONFLICT (batch, entity, ref_id, col) DO NOTHING;

-- students.preceptor_email (only when it differs; for the accepted data this captures ZERO rows).
INSERT INTO public.preceptor_mirror_repair_audit (batch, entity, ref_id, col, old_value)
SELECT 'phase2b-preceptor-mirror', 'students', s.id, 'preceptor_email', s.preceptor_email
FROM public.students s
JOIN public.preceptors p ON p.id = s.preceptor_id
WHERE s.preceptor_id IS NOT NULL
  AND btrim(lower(coalesce(s.preceptor_email,''))) IS DISTINCT FROM btrim(lower(coalesce(p.email,'')))
ON CONFLICT (batch, entity, ref_id, col) DO NOTHING;

-- matches.preceptor_id (current-cohort, only the student's SINGLE current-cohort match row).
INSERT INTO public.preceptor_mirror_repair_audit (batch, entity, ref_id, col, old_value)
SELECT 'phase2b-preceptor-mirror', 'matches', m.id, 'preceptor_id', m.preceptor_id::text
FROM public.matches m
JOIN public.students s ON s.id = m.student_id AND s.cohort_id = m.cohort_id
WHERE s.preceptor_id IS NOT NULL
  AND m.preceptor_id IS DISTINCT FROM s.preceptor_id
  AND (SELECT count(*) FROM public.matches m2
       WHERE m2.student_id = s.id AND m2.cohort_id = s.cohort_id) = 1
ON CONFLICT (batch, entity, ref_id, col) DO NOTHING;


-- ############################################################################
-- 1. One-time repair (data-driven; no student ids are hardcoded).
-- ############################################################################

-- 1a. Align students.matched_preceptor, ONLY where it differs from canonical.
UPDATE public.students s
   SET matched_preceptor = p.full_name
FROM public.preceptors p
WHERE s.preceptor_id = p.id
  AND s.preceptor_id IS NOT NULL
  AND btrim(lower(coalesce(s.matched_preceptor,''))) IS DISTINCT FROM btrim(lower(coalesce(p.full_name,'')));

-- 1b. Align students.preceptor_email, ONLY where it differs from canonical. Independent of
--     1a, so an already-correct email is never rewritten (for the accepted data this changes
--     ZERO rows).
UPDATE public.students s
   SET preceptor_email = p.email
FROM public.preceptors p
WHERE s.preceptor_id = p.id
  AND s.preceptor_id IS NOT NULL
  AND btrim(lower(coalesce(s.preceptor_email,''))) IS DISTINCT FROM btrim(lower(coalesce(p.email,'')));

-- 1c. Align the student's current-cohort match FK to the canonical primary, ONLY when the
--     student has EXACTLY ONE match row in that cohort, so no historical or duplicate match
--     row is ever overwritten. Students with more than one current-cohort match row are left
--     for a data decision (see the cardinality query in the companion audit file). Matches in
--     other cohorts are untouched.
UPDATE public.matches m
   SET preceptor_id = s.preceptor_id
FROM public.students s
WHERE m.student_id = s.id
  AND m.cohort_id  = s.cohort_id
  AND s.preceptor_id IS NOT NULL
  AND m.preceptor_id IS DISTINCT FROM s.preceptor_id
  AND (SELECT count(*) FROM public.matches m2
       WHERE m2.student_id = s.id AND m2.cohort_id = s.cohort_id) = 1;


-- ############################################################################
-- 2. Prevention: keep the mirror in step on any future canonical change.
--
-- SECURITY DEFINER so the mirror is maintained even when the change comes from the
-- client staff path (an authenticated staff user has no write policy on
-- student_preceptor_assignments; the definer, owned by the migration runner, writes it).
-- This does NOT let anyone change students.preceptor_id who could not already: the
-- students write policy (is_staff()) is unchanged, and this function only mirrors an
-- authorized change. Fixed search_path; execution revoked from PUBLIC.
-- ############################################################################
CREATE OR REPLACE FUNCTION public.sync_primary_preceptor_mirror()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_full_name text;
  v_email     text;
BEGIN
  -- Fire only on a real change of the canonical Primary identity. A student is permanently
  -- tied to one cohort and is never re-cohorted, so students.cohort_id is fixed and this
  -- function neither watches for nor responds to a cohort change: it always scopes every
  -- assignment write to the student's fixed cohort (NEW.cohort_id).
  IF TG_OP = 'UPDATE' AND NEW.preceptor_id IS NOT DISTINCT FROM OLD.preceptor_id THEN
    RETURN NULL;  -- preceptor_id did not change; the triggering row is already locked
  END IF;
  IF TG_OP = 'INSERT' AND NEW.preceptor_id IS NULL THEN
    RETURN NULL;  -- new student with no Primary; nothing to mirror
  END IF;

  IF NEW.preceptor_id IS NOT NULL THEN
    -- New/changed Primary for the student's cohort.

    -- End any active primary for the cohort that is not this preceptor.
    UPDATE public.student_preceptor_assignments
       SET status = 'ended', end_date = COALESCE(end_date, current_date), updated_at = now()
     WHERE student_id = NEW.id
       AND cohort_id  = NEW.cohort_id
       AND role       = 'primary'
       AND status     = 'active'
       AND preceptor_id IS DISTINCT FROM NEW.preceptor_id;

    -- Same-preceptor conflict: the ppm3 relationship index forbids the new preceptor
    -- being active in two roles for this (student, cohort). End its active secondary/
    -- coverage row (the ONLY case a secondary/coverage row is ever touched) so the
    -- primary insert below can succeed.
    UPDATE public.student_preceptor_assignments
       SET status = 'ended', end_date = COALESCE(end_date, current_date), updated_at = now()
     WHERE student_id  = NEW.id
       AND cohort_id   = NEW.cohort_id
       AND preceptor_id = NEW.preceptor_id
       AND role IN ('secondary', 'coverage')
       AND status = 'active';

    -- Ensure exactly one active primary for the current cohort (idempotent).
    INSERT INTO public.student_preceptor_assignments (student_id, preceptor_id, cohort_id, role, status)
    SELECT NEW.id, NEW.preceptor_id, NEW.cohort_id, 'primary', 'active'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.student_preceptor_assignments
      WHERE student_id = NEW.id AND cohort_id = NEW.cohort_id
        AND role = 'primary' AND status = 'active'
    );

    -- Align the students display mirror from the canonical preceptor record.
    SELECT full_name, email INTO v_full_name, v_email
      FROM public.preceptors WHERE id = NEW.preceptor_id;

    UPDATE public.students
       SET matched_preceptor = COALESCE(v_full_name, ''),
           preceptor_email   = COALESCE(v_email, '')
     WHERE id = NEW.id
       AND ( matched_preceptor IS DISTINCT FROM COALESCE(v_full_name, '')
          OR preceptor_email   IS DISTINCT FROM COALESCE(v_email, '') );

    -- Align the current-cohort match FK, ONLY when the student has exactly one match row in
    -- that cohort (never overwrite one of several rows). Mirrors the staff writer, which
    -- updates a single match row per student. Matches in other cohorts are untouched.
    UPDATE public.matches
       SET preceptor_id = NEW.preceptor_id
     WHERE student_id = NEW.id
       AND cohort_id  = NEW.cohort_id
       AND preceptor_id IS DISTINCT FROM NEW.preceptor_id
       AND (SELECT count(*) FROM public.matches m2
            WHERE m2.student_id = NEW.id AND m2.cohort_id = NEW.cohort_id) = 1;

  ELSE
    -- Primary CLEARED for the current cohort.
    UPDATE public.student_preceptor_assignments
       SET status = 'ended', end_date = COALESCE(end_date, current_date), updated_at = now()
     WHERE student_id = NEW.id
       AND cohort_id  = NEW.cohort_id
       AND role       = 'primary'
       AND status     = 'active';

    UPDATE public.students
       SET matched_preceptor = '', preceptor_email = ''
     WHERE id = NEW.id
       AND (coalesce(matched_preceptor,'') <> '' OR coalesce(preceptor_email,'') <> '');

    UPDATE public.matches
       SET preceptor_id = NULL
     WHERE student_id = NEW.id
       AND cohort_id  = NEW.cohort_id
       AND preceptor_id IS NOT NULL
       AND (SELECT count(*) FROM public.matches m2
            WHERE m2.student_id = NEW.id AND m2.cohort_id = NEW.cohort_id) = 1;
  END IF;

  RETURN NULL;  -- AFTER trigger: return value is ignored
END;
$fn$;

COMMENT ON FUNCTION public.sync_primary_preceptor_mirror() IS
  'Phase 2B: mirrors the canonical students.preceptor_id into the active-primary '
  'student_preceptor_assignments row (scoped to the student fixed cohort), the students '
  'display fields, and the current-cohort matches.preceptor_id (only when the student has '
  'exactly one match row in that cohort). Writer-agnostic and idempotent. Does not respond '
  'to cohort changes (students are single-cohort), and does not touch matches.preceptor_assigned, '
  'secondary/coverage rows (except a same-preceptor conflict), or history.';

-- The self-UPDATE of students.matched_preceptor / preceptor_email inside the function does
-- NOT re-enter this trigger: it fires only on INSERT or on UPDATE OF preceptor_id, and the
-- self-UPDATE sets neither. No recursion is possible.
DROP TRIGGER IF EXISTS trg_sync_primary_preceptor_mirror ON public.students;
CREATE TRIGGER trg_sync_primary_preceptor_mirror
  AFTER INSERT OR UPDATE OF preceptor_id ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.sync_primary_preceptor_mirror();

-- No caller ever executes this function directly; it runs only via the trigger.
REVOKE ALL ON FUNCTION public.sync_primary_preceptor_mirror() FROM PUBLIC;

COMMIT;
```

## Appendix B: Phase 2C migration (20260723000000_preceptor_assignment_authorization.sql)

```sql
-- ============================================================================
-- PHASE 2C: scoped preceptor-assignment authorization + backend (PROPOSED, NOT APPLIED)
-- ============================================================================
-- *** GATED. Depends on Phase 2B (20260722000000_preceptor_mirror_repair_and_sync.sql):    ***
-- *** apply 2B FIRST, then this, in one controlled maintenance window. Apply MANUALLY after  ***
-- *** the preflight, and deploy the compatible app changes + start the notification worker   ***
-- *** BEFORE enabling any Unit Leader assignment UI.                                          ***
--
-- LOCKED AUTHORITY MODEL
--   - Owner/Admin: may change Primary/Secondary/Coverage for any student, any active preceptor.
--   - Unit Leader: only for students in their ACTIVE unit scope; may pick ANY active preceptor
--     (cross-unit allowed); a UL-created preceptor's unit must be within the UL's scope.
--   - Interviewer / viewer / co_lead / other is_staff() roles: NOT allowed.
--   - Unit Leaders never get direct table-write permission; they act only through the RPCs.
--
-- COMPLETED-ROTATION WINDOW (locked)
--   - Active, or completed within 90 days: normal authorization.
--   - Unit Leader beyond 90 days: DENIED (even with a force flag).
--   - Owner/Admin beyond 90 days: allowed ONLY with p_force = true AND p_confirm_override = true
--     AND a non-empty reason; the event and every notification are marked as a historical override.
--
-- NOTIFICATION (locked): every Unit Leader assignment change / UL-created preceptor, and every
--   Owner/Admin >90d override, writes a durable audit row AND fans out one durable
--   staff_notifications row per ACTIVE Owner/Admin except the acting user, in the SAME
--   transaction. That row carries BOTH the in-app state (read/unread) and the email queue state.
--   A separate worker (lib/server/staffNotifications/deliveryService.js, api/cron/...) sends the
--   emails; a send failure never rolls back the committed assignment.
--
-- SECURITY: no RLS widened; no anon/authenticated write grant; new tables are owner/admin SELECT
--   (staff_notifications additionally lets a recipient read/update their own row) + service-role
--   write. Every function has a fixed search_path; the write RPCs are service-role only. Errors
--   use the established MS400/403/404/409 SQLSTATE convention.
-- ============================================================================

BEGIN;

-- ############################################################################
-- 1. Preceptor provenance (additive, nullable).
-- ############################################################################
ALTER TABLE public.preceptors
  ADD COLUMN IF NOT EXISTS created_by      uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_role text
    CONSTRAINT chk_preceptors_created_by_role CHECK (created_by_role IS NULL OR created_by_role IN ('owner_admin', 'unit_leader'));


-- ############################################################################
-- 2. preceptor_assignment_events -- audit OF RECORD (append-only). was_override flags a
--    completed-rotation historical override (>90 days) by an owner/admin.
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.preceptor_assignment_events (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  actor_role       text        NOT NULL CHECK (actor_role IN ('owner_admin', 'unit_leader')),
  action           text        NOT NULL CHECK (action IN (
                     'assign_primary', 'add_secondary', 'add_coverage',
                     'replace_secondary', 'replace_coverage', 'end_secondary', 'end_coverage',
                     'create_preceptor', 'matches_anomaly')),
  student_id       uuid        REFERENCES public.students(id)   ON DELETE SET NULL,
  preceptor_id     uuid        REFERENCES public.preceptors(id) ON DELETE SET NULL,
  cohort_id        uuid        REFERENCES public.cohorts(id)    ON DELETE SET NULL,
  unit_key         text,
  assignment_role  text        CHECK (assignment_role IS NULL OR assignment_role IN ('primary', 'secondary', 'coverage')),
  old_value        text,
  new_value        text,
  reason           text,
  was_override     boolean     NOT NULL DEFAULT false,
  correlation_id   text,
  request_id       text,
  metadata         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pae_student ON public.preceptor_assignment_events (student_id);
CREATE INDEX IF NOT EXISTS idx_pae_actor   ON public.preceptor_assignment_events (actor_profile_id);
CREATE INDEX IF NOT EXISTS idx_pae_created ON public.preceptor_assignment_events (created_at DESC);

ALTER TABLE public.preceptor_assignment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "preceptor_assignment_events_owner_admin_read"
  ON public.preceptor_assignment_events FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin());


-- ############################################################################
-- 3. staff_notifications -- unified, durable, per-recipient IN-APP + EMAIL row. One row per
--    (correlation_id, recipient owner/admin). in_app_read_at drives read/unread; the email
--    queue columns (queue_status/attempts/next_attempt_at/...) mirror message_notification_deliveries.
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.staff_notifications (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id       text        NOT NULL,           -- stable event key (shared across recipients)
  recipient_profile_id uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  recipient_email      text        NOT NULL,
  event_type           text        NOT NULL,
  -- Rendered content for the in-app card and the email.
  actor_profile_id     uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  actor_name           text,
  actor_role           text,
  student_id           uuid        REFERENCES public.students(id)   ON DELETE SET NULL,
  preceptor_id         uuid        REFERENCES public.preceptors(id) ON DELETE SET NULL,
  unit_key             text,
  assignment_role      text,
  old_value            text,
  new_value            text,
  reason               text,
  was_override         boolean     NOT NULL DEFAULT false,
  subject              text        NOT NULL,
  dest_url             text,
  -- In-app read state.
  in_app_read_at       timestamptz,
  -- Email queue state (mirrors message_notification_deliveries).
  queue_status         text        NOT NULL DEFAULT 'queued'
                         CHECK (queue_status IN ('queued', 'processing', 'retry_wait', 'sent', 'failed', 'suppressed')),
  attempts             int         NOT NULL DEFAULT 0,
  max_attempts         int         NOT NULL DEFAULT 5,
  next_attempt_at      timestamptz,
  last_attempt_at      timestamptz,
  locked_at            timestamptz,
  locked_by            text,
  resend_email_id      text,
  notification_log_id  uuid,
  error_code           text,
  error_detail         text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- One notification per event per recipient: idempotent fan-out and no double email.
  CONSTRAINT uq_staff_notifications_event_recipient UNIQUE (correlation_id, recipient_profile_id)
);
CREATE INDEX IF NOT EXISTS idx_sn_recipient_unread
  ON public.staff_notifications (recipient_profile_id, created_at DESC)
  WHERE in_app_read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sn_email_due
  ON public.staff_notifications (next_attempt_at)
  WHERE queue_status IN ('queued', 'retry_wait');

ALTER TABLE public.staff_notifications ENABLE ROW LEVEL SECURITY;
-- A recipient reads their OWN notifications; owner/admin may read all. NO client write policy:
-- an RLS UPDATE policy is row-level, not column-level, so it could not stop a recipient from
-- tampering with the email-queue columns. Read state is changed only through the scoped
-- mark_staff_notifications_read RPC below (which touches in_app_read_at and nothing else).
CREATE POLICY "staff_notifications_read_own_or_admin"
  ON public.staff_notifications FOR SELECT TO authenticated
  USING (
    recipient_profile_id = public.portal_profile_id()
    OR public.is_active_owner_or_admin()
  );


-- ############################################################################
-- 4. Guard: only owner/admin (direct staff path) or an authorized RPC may change
--    students.preceptor_id. Fails closed. SECURITY INVOKER (see note). Fixed search_path.
--
-- HARDENED MARKER (pooling + nested-definer safe): the authorized RPC sets a TRANSACTION-LOCAL
-- marker app.preceptor_change_authorized to the SPECIFIC student id it is changing, and the guard
-- requires the marker to equal NEW.id AND current_user to be a privileged (non-client) role.
--   - Transaction-local (set_config is_local = true) resets at COMMIT/ROLLBACK, so it never leaks
--     across pooled transactions (transaction-pooling reuses a backend only between transactions).
--   - Scoping the marker to the exact student id means an unrelated nested write to a DIFFERENT
--     student's preceptor_id is NOT covered by the marker (it would have to equal that row's id),
--     closing the mid-transaction window.
--   - A client (authenticated/anon) can neither assume a privileged role nor set the marker
--     (PostgREST exposes no raw-SQL channel), so the marker is never a sole gate.
--   - A bare SECURITY DEFINER function that does not set the per-row marker fails the check, so
--     there is no general definer bypass.
-- INVOKER is required so the guard observes the REAL current_user (a client update runs as
-- 'authenticated'; the RPC's update runs as the RPC owner). A DEFINER guard would always see its
-- own owner and could not tell them apart.
-- ############################################################################
CREATE OR REPLACE FUNCTION public.guard_students_preceptor_id_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $guard$
DECLARE
  v_marker     text    := current_setting('app.preceptor_change_authorized', true);
  v_privileged boolean := current_user NOT IN ('authenticated', 'anon');
BEGIN
  IF NEW.preceptor_id IS NOT DISTINCT FROM OLD.preceptor_id THEN
    RETURN NEW;  -- not a preceptor change
  END IF;

  -- (A) Authorized RPC path: per-student marker set to THIS row AND a privileged role.
  IF v_marker IS NOT NULL AND v_marker = NEW.id::text AND v_privileged THEN
    RETURN NEW;
  END IF;

  -- (B) Existing owner/admin staff path: a direct client update by an active owner/admin.
  IF public.is_active_owner_or_admin() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'preceptor_id may only be changed by an owner/admin or an authorized assignment RPC'
    USING ERRCODE = 'MS403';
END;
$guard$;

DROP TRIGGER IF EXISTS trg_guard_students_preceptor_id ON public.students;
CREATE TRIGGER trg_guard_students_preceptor_id
  BEFORE UPDATE OF preceptor_id ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.guard_students_preceptor_id_change();

REVOKE ALL ON FUNCTION public.guard_students_preceptor_id_change() FROM PUBLIC;


-- ############################################################################
-- 5a. Shared authorization helper. Returns jsonb { role, was_override } for the actor against
--     the student, or RAISES MS4xx. Enforces the completed-rotation window and the override rule.
-- ############################################################################
CREATE OR REPLACE FUNCTION public._preceptor_assert_actor_for_student(
  p_actor_profile_id uuid,
  p_student_id       uuid,
  p_reason           text,
  p_force            boolean,
  p_confirm_override boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_now        timestamptz := now();
  v_stu        record;
  v_unit_key   text;
  v_role       text;
  v_end        timestamptz;
  v_completed  boolean;
  v_within_90  boolean;
BEGIN
  SELECT s.id, s.cohort_id, s.matched_unit_id, s.status,
         s.rotation_completed_at, s.rotation_end_date
    INTO v_stu
  FROM public.students s WHERE s.id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'MS404';
  END IF;

  SELECT u.unit_name INTO v_unit_key FROM public.units u WHERE u.id = v_stu.matched_unit_id;

  -- Actor role. Active owner/admin (role or is_owner) acts globally.
  IF EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.id = p_actor_profile_id AND COALESCE(p.is_active, true) = true
      AND (p.role IN ('owner', 'admin') OR p.is_owner IS TRUE)
  ) THEN
    v_role := 'owner_admin';
  ELSIF EXISTS (
    SELECT 1 FROM public.user_role_grants g
    WHERE g.user_profile_id = p_actor_profile_id AND g.role = 'unit_leader'
      AND g.revoked_at IS NULL AND g.starts_at <= v_now AND (g.expires_at IS NULL OR g.expires_at > v_now)
  ) AND v_unit_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_unit_scopes s
    WHERE s.user_profile_id = p_actor_profile_id AND s.unit_key = v_unit_key
      AND (s.cohort_id IS NULL OR s.cohort_id = v_stu.cohort_id)
      AND s.revoked_at IS NULL AND s.starts_at <= v_now AND (s.expires_at IS NULL OR s.expires_at > v_now)
  ) THEN
    v_role := 'unit_leader';
  ELSE
    RAISE EXCEPTION 'not found' USING ERRCODE = 'MS404';  -- non-enumerating
  END IF;

  -- Completed-rotation window. end date = COALESCE(rotation_completed_at, rotation_end_date),
  -- mirroring completedStillVisible; NULL for a completed student => treated as beyond window.
  v_completed := (v_stu.status = 'Completed');
  v_end := COALESCE(v_stu.rotation_completed_at, v_stu.rotation_end_date::timestamptz);
  v_within_90 := v_completed AND v_end IS NOT NULL AND v_end >= v_now - INTERVAL '90 days';

  IF v_completed AND NOT v_within_90 THEN
    -- Beyond the 90-day window.
    IF v_role = 'unit_leader' THEN
      RAISE EXCEPTION 'completed rotation is outside the 90-day window' USING ERRCODE = 'MS403';
    END IF;
    -- Owner/Admin override: force + explicit confirmation + reason, all required.
    IF p_force IS NOT TRUE OR p_confirm_override IS NOT TRUE THEN
      RAISE EXCEPTION 'a completed rotation beyond 90 days requires force and explicit confirmation'
        USING ERRCODE = 'MS403';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
      RAISE EXCEPTION 'a reason is required for a historical override' USING ERRCODE = 'MS400';
    END IF;
    RETURN jsonb_build_object('role', v_role, 'was_override', true, 'unit_key', v_unit_key, 'cohort_id', v_stu.cohort_id);
  END IF;

  -- Active or within 90 days: normal authorization (no forced reason).
  RETURN jsonb_build_object('role', v_role, 'was_override', false, 'unit_key', v_unit_key, 'cohort_id', v_stu.cohort_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public._preceptor_assert_actor_for_student(uuid, uuid, text, boolean, boolean) FROM PUBLIC;


-- ############################################################################
-- 5b. _emit_staff_notifications -- fan out one durable in-app + email row to every ACTIVE
--     owner/admin EXCEPT the actor, idempotent on (correlation_id, recipient). Runs inside the
--     RPC transaction; a duplicate fan-out is a no-op, and no recipient is emailed twice.
-- ############################################################################
CREATE OR REPLACE FUNCTION public._emit_staff_notifications(
  p_correlation_id   text,
  p_event_type       text,
  p_actor_profile_id uuid,
  p_actor_role       text,
  p_subject          text,
  p_student_id       uuid,
  p_preceptor_id     uuid,
  p_unit_key         text,
  p_assignment_role  text,
  p_old_value        text,
  p_new_value        text,
  p_reason           text,
  p_was_override     boolean,
  p_dest_url         text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_actor_name text;
  v_count      int;
BEGIN
  SELECT full_name INTO v_actor_name FROM public.user_profiles WHERE id = p_actor_profile_id;

  INSERT INTO public.staff_notifications
    (correlation_id, recipient_profile_id, recipient_email, event_type, actor_profile_id, actor_name,
     actor_role, student_id, preceptor_id, unit_key, assignment_role, old_value, new_value, reason,
     was_override, subject, dest_url, queue_status, next_attempt_at)
  SELECT p_correlation_id, up.id, up.email, p_event_type, p_actor_profile_id, v_actor_name,
         p_actor_role, p_student_id, p_preceptor_id, p_unit_key, p_assignment_role, p_old_value, p_new_value,
         p_reason, COALESCE(p_was_override, false), p_subject, p_dest_url, 'queued', now()
  FROM public.user_profiles up
  WHERE (up.role IN ('owner', 'admin') OR up.is_owner IS TRUE)
    AND COALESCE(up.is_active, true) = true
    AND up.id <> p_actor_profile_id
    AND up.email IS NOT NULL AND btrim(up.email) <> ''
  ON CONFLICT (correlation_id, recipient_profile_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public._emit_staff_notifications(text, text, uuid, text, text, uuid, uuid, text, text, text, text, text, boolean, text) FROM PUBLIC;


-- ############################################################################
-- 5c. assign_primary_preceptor -- change/assign the Primary. Sets students.preceptor_id and lets
--     the Phase 2B trigger synchronize the Primary mirror.
-- ############################################################################
CREATE OR REPLACE FUNCTION public.assign_primary_preceptor(
  p_actor_profile_id uuid,
  p_student_id       uuid,
  p_preceptor_id     uuid,
  p_reason           text    DEFAULT NULL,
  p_force            boolean DEFAULT false,
  p_confirm_override boolean DEFAULT false,
  p_request_id       text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_authz     jsonb;
  v_role      text;
  v_override  boolean;
  v_cohort    uuid;
  v_unit_key  text;
  v_old       uuid;
  v_match_ct  int;
  v_corr      text;
BEGIN
  IF p_actor_profile_id IS NULL OR p_student_id IS NULL OR p_preceptor_id IS NULL THEN
    RAISE EXCEPTION 'missing required argument' USING ERRCODE = 'MS400';
  END IF;

  v_authz := public._preceptor_assert_actor_for_student(p_actor_profile_id, p_student_id, p_reason, p_force, p_confirm_override);
  v_role     := v_authz->>'role';
  v_override := (v_authz->>'was_override')::boolean;
  v_unit_key := v_authz->>'unit_key';
  v_cohort   := (v_authz->>'cohort_id')::uuid;

  SELECT s.preceptor_id INTO v_old FROM public.students s WHERE s.id = p_student_id;

  -- Cross-unit assignment is allowed: only inactivity blocks the preceptor.
  IF NOT EXISTS (SELECT 1 FROM public.preceptors p WHERE p.id = p_preceptor_id AND p.is_active IS TRUE) THEN
    RAISE EXCEPTION 'preceptor is inactive or does not exist' USING ERRCODE = 'MS400';
  END IF;
  IF v_old IS NOT DISTINCT FROM p_preceptor_id THEN
    RAISE EXCEPTION 'that preceptor is already the primary' USING ERRCODE = 'MS409';
  END IF;

  -- Per-student marker authorizes THIS one row change to the guard; the 2B trigger then mirrors.
  PERFORM set_config('app.preceptor_change_authorized', p_student_id::text, true);
  UPDATE public.students SET preceptor_id = p_preceptor_id WHERE id = p_student_id;
  PERFORM set_config('app.preceptor_change_authorized', '', true);

  v_corr := 'preceptor_primary:' || p_student_id::text || ':' || p_preceptor_id::text
            || ':' || extract(epoch from now())::bigint::text;

  INSERT INTO public.preceptor_assignment_events
    (actor_profile_id, actor_role, action, student_id, preceptor_id, cohort_id, unit_key,
     assignment_role, old_value, new_value, reason, was_override, correlation_id, request_id)
  VALUES
    (p_actor_profile_id, v_role, 'assign_primary', p_student_id, p_preceptor_id, v_cohort, v_unit_key,
     'primary', v_old::text, p_preceptor_id::text, p_reason, v_override, v_corr, p_request_id);

  PERFORM public._emit_staff_notifications(
    v_corr, 'preceptor_primary_changed', p_actor_profile_id, v_role,
    (CASE WHEN v_override THEN 'Primary preceptor changed (historical override)' ELSE 'Primary preceptor changed' END),
    p_student_id, p_preceptor_id, v_unit_key, 'primary', v_old::text, p_preceptor_id::text, p_reason, v_override,
    '/students/' || p_student_id::text);

  -- matches anomaly: >1 same-cohort match rows => 2B trigger left the match FK unsynced. Record a
  -- structured event AND notify, without failing the assignment.
  SELECT count(*) INTO v_match_ct FROM public.matches m
  WHERE m.student_id = p_student_id AND m.cohort_id = v_cohort;
  IF v_match_ct > 1 THEN
    INSERT INTO public.preceptor_assignment_events
      (actor_profile_id, actor_role, action, student_id, preceptor_id, cohort_id, unit_key,
       assignment_role, old_value, new_value, reason, correlation_id, request_id, metadata)
    VALUES
      (p_actor_profile_id, v_role, 'matches_anomaly', p_student_id, p_preceptor_id, v_cohort, v_unit_key,
       'primary', v_old::text, p_preceptor_id::text, p_reason, v_corr || ':anomaly', p_request_id,
       jsonb_build_object('same_cohort_match_rows', v_match_ct));
    PERFORM public._emit_staff_notifications(
      v_corr || ':anomaly', 'preceptor_match_anomaly', p_actor_profile_id, v_role,
      'Match record needs review (multiple same-cohort matches)',
      p_student_id, p_preceptor_id, v_unit_key, 'primary', v_old::text, p_preceptor_id::text, NULL, false,
      '/students/' || p_student_id::text);
  END IF;

  RETURN jsonb_build_object('ok', true, 'student_id', p_student_id, 'old_preceptor_id', v_old,
                            'new_preceptor_id', p_preceptor_id, 'actor_role', v_role, 'was_override', v_override);
END;
$fn$;
REVOKE ALL ON FUNCTION public.assign_primary_preceptor(uuid, uuid, uuid, text, boolean, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_primary_preceptor(uuid, uuid, uuid, text, boolean, boolean, text) TO service_role;


-- ############################################################################
-- 5d. set_secondary_coverage_preceptor -- add / replace / end Secondary or Coverage through the
--     canonical student_preceptor_assignments. Never touches Primary. Cross-unit allowed.
-- ############################################################################
CREATE OR REPLACE FUNCTION public.set_secondary_coverage_preceptor(
  p_actor_profile_id uuid,
  p_student_id       uuid,
  p_role             text,
  p_action           text,               -- 'add' | 'replace' | 'end'
  p_preceptor_id     uuid    DEFAULT NULL,
  p_assignment_id    uuid    DEFAULT NULL,
  p_reason           text    DEFAULT NULL,
  p_notes            text    DEFAULT NULL,
  p_force            boolean DEFAULT false,
  p_confirm_override boolean DEFAULT false,
  p_request_id       text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_authz    jsonb;
  v_role     text;
  v_override boolean;
  v_cohort   uuid;
  v_unit_key text;
  v_new_id   uuid;
  v_lbl      text;
  v_corr     text;
BEGIN
  IF p_role NOT IN ('secondary', 'coverage') THEN
    RAISE EXCEPTION 'role must be secondary or coverage' USING ERRCODE = 'MS400';
  END IF;
  IF p_action NOT IN ('add', 'replace', 'end') THEN
    RAISE EXCEPTION 'action must be add, replace, or end' USING ERRCODE = 'MS400';
  END IF;

  v_authz    := public._preceptor_assert_actor_for_student(p_actor_profile_id, p_student_id, p_reason, p_force, p_confirm_override);
  v_role     := v_authz->>'role';
  v_override := (v_authz->>'was_override')::boolean;
  v_unit_key := v_authz->>'unit_key';
  v_cohort   := (v_authz->>'cohort_id')::uuid;

  IF p_action = 'end' THEN
    IF p_assignment_id IS NULL THEN
      RAISE EXCEPTION 'assignment id is required to end an assignment' USING ERRCODE = 'MS400';
    END IF;
    UPDATE public.student_preceptor_assignments a
       SET status = 'ended', end_date = current_date, updated_at = now()
     WHERE a.id = p_assignment_id AND a.student_id = p_student_id
       AND a.role IN ('secondary', 'coverage') AND a.status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not found' USING ERRCODE = 'MS404';
    END IF;
    v_lbl := 'end_' || p_role;
  ELSE
    IF p_preceptor_id IS NULL THEN
      RAISE EXCEPTION 'preceptor id is required to add or replace' USING ERRCODE = 'MS400';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.preceptors p WHERE p.id = p_preceptor_id AND p.is_active IS TRUE) THEN
      RAISE EXCEPTION 'preceptor is inactive or does not exist' USING ERRCODE = 'MS400';
    END IF;
    IF p_action = 'replace' THEN
      UPDATE public.student_preceptor_assignments a
         SET status = 'ended', end_date = current_date, updated_at = now()
       WHERE a.student_id = p_student_id AND a.cohort_id = v_cohort AND a.role = p_role AND a.status = 'active';
    END IF;
    BEGIN
      INSERT INTO public.student_preceptor_assignments
        (student_id, preceptor_id, cohort_id, role, status, notes, assigned_by)
      VALUES
        (p_student_id, p_preceptor_id, v_cohort, p_role, 'active',
         NULLIF(btrim(coalesce(p_notes, '')), ''), p_actor_profile_id)
      RETURNING id INTO v_new_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'that preceptor already has an active assignment for this student' USING ERRCODE = 'MS409';
    END;
    v_lbl := (CASE WHEN p_action = 'replace' THEN 'replace_' ELSE 'add_' END) || p_role;
  END IF;

  v_corr := 'preceptor_' || v_lbl || ':' || p_student_id::text || ':'
            || COALESCE(p_preceptor_id::text, p_assignment_id::text) || ':' || extract(epoch from now())::bigint::text;

  INSERT INTO public.preceptor_assignment_events
    (actor_profile_id, actor_role, action, student_id, preceptor_id, cohort_id, unit_key,
     assignment_role, old_value, new_value, reason, was_override, correlation_id, request_id)
  VALUES
    (p_actor_profile_id, v_role, v_lbl, p_student_id, p_preceptor_id, v_cohort, v_unit_key,
     p_role, NULL, COALESCE(p_preceptor_id::text, p_assignment_id::text), p_reason, v_override, v_corr, p_request_id);

  PERFORM public._emit_staff_notifications(
    v_corr, 'preceptor_' || v_lbl, p_actor_profile_id, v_role, 'Preceptor assignment updated',
    p_student_id, p_preceptor_id, v_unit_key, p_role, NULL,
    COALESCE(p_preceptor_id::text, p_assignment_id::text), p_reason, v_override, '/students/' || p_student_id::text);

  RETURN jsonb_build_object('ok', true, 'assignment_id', COALESCE(v_new_id, p_assignment_id), 'action', v_lbl);
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_secondary_coverage_preceptor(uuid, uuid, text, text, uuid, uuid, text, text, boolean, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_secondary_coverage_preceptor(uuid, uuid, text, text, uuid, uuid, text, text, boolean, boolean, text) TO service_role;


-- ############################################################################
-- 5e. create_unit_preceptor -- canonical Preceptor Directory record. A Unit Leader may only
--     create under a unit in their active scope. Dedups by normalized email; records provenance.
-- ############################################################################
CREATE OR REPLACE FUNCTION public.create_unit_preceptor(
  p_actor_profile_id uuid,
  p_full_name        text,
  p_email            text,
  p_unit_key         text,
  p_shift            text,
  p_phone            text DEFAULT NULL,
  p_request_id       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_now     timestamptz := now();
  v_role    text;
  v_unit_id uuid;
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_new_id  uuid;
  v_corr    text;
BEGIN
  IF btrim(coalesce(p_full_name, '')) = '' THEN RAISE EXCEPTION 'full name is required' USING ERRCODE = 'MS400'; END IF;
  IF v_email = '' OR position('@' in v_email) = 0 THEN RAISE EXCEPTION 'a valid email is required' USING ERRCODE = 'MS400'; END IF;
  IF p_shift NOT IN ('Day', 'Night', 'Mid', 'Variable') THEN RAISE EXCEPTION 'shift must be Day, Night, Mid, or Variable' USING ERRCODE = 'MS400'; END IF;

  SELECT u.id INTO v_unit_id FROM public.units u WHERE u.unit_name = p_unit_key LIMIT 1;
  IF v_unit_id IS NULL THEN RAISE EXCEPTION 'unit not found' USING ERRCODE = 'MS400'; END IF;

  -- Owner/admin global; a UL must have an active scope for THIS unit (creation is unit-scoped).
  IF EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.id = p_actor_profile_id AND COALESCE(p.is_active, true) = true
      AND (p.role IN ('owner', 'admin') OR p.is_owner IS TRUE)
  ) THEN
    v_role := 'owner_admin';
  ELSIF EXISTS (
    SELECT 1 FROM public.user_role_grants g
    WHERE g.user_profile_id = p_actor_profile_id AND g.role = 'unit_leader'
      AND g.revoked_at IS NULL AND g.starts_at <= v_now AND (g.expires_at IS NULL OR g.expires_at > v_now)
  ) AND EXISTS (
    SELECT 1 FROM public.user_unit_scopes s
    WHERE s.user_profile_id = p_actor_profile_id AND s.unit_key = p_unit_key
      AND s.revoked_at IS NULL AND s.starts_at <= v_now AND (s.expires_at IS NULL OR s.expires_at > v_now)
  ) THEN
    v_role := 'unit_leader';
  ELSE
    RAISE EXCEPTION 'not found' USING ERRCODE = 'MS404';
  END IF;

  IF EXISTS (SELECT 1 FROM public.preceptors p WHERE lower(btrim(p.email)) = v_email AND btrim(p.email) <> '') THEN
    RAISE EXCEPTION 'a preceptor with this email already exists' USING ERRCODE = 'MS409';
  END IF;

  BEGIN
    INSERT INTO public.preceptors
      (full_name, email, phone, unit_id, unit_name, shift_type, is_active, created_by, created_by_role)
    VALUES
      (btrim(p_full_name), v_email, NULLIF(btrim(coalesce(p_phone, '')), ''), v_unit_id, p_unit_key,
       p_shift, true, p_actor_profile_id, v_role)
    RETURNING id INTO v_new_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a preceptor with this email already exists' USING ERRCODE = 'MS409';
  END;

  v_corr := 'preceptor_created:' || v_new_id::text;

  INSERT INTO public.preceptor_assignment_events
    (actor_profile_id, actor_role, action, preceptor_id, unit_key, new_value, correlation_id, request_id, metadata)
  VALUES
    (p_actor_profile_id, v_role, 'create_preceptor', v_new_id, p_unit_key, v_new_id::text, v_corr, p_request_id,
     jsonb_build_object('full_name', btrim(p_full_name), 'email', v_email, 'shift', p_shift));

  PERFORM public._emit_staff_notifications(
    v_corr, 'preceptor_created', p_actor_profile_id, v_role,
    'New preceptor created' || (CASE WHEN v_role = 'unit_leader' THEN ' by a Unit Leader (review)' ELSE '' END),
    NULL, v_new_id, p_unit_key, NULL, NULL, v_new_id::text, NULL, false, '/preceptors/' || v_new_id::text);

  RETURN jsonb_build_object('ok', true, 'preceptor_id', v_new_id, 'created_by_role', v_role);
END;
$fn$;
REVOKE ALL ON FUNCTION public.create_unit_preceptor(uuid, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_unit_preceptor(uuid, text, text, text, text, text, text) TO service_role;


-- ############################################################################
-- 6. claim_due_staff_notifications -- the email worker's atomic claim (SKIP LOCKED), mirroring
--    claim_due_message_notification_deliveries. Recovers stale processing claims, claims a
--    bounded batch of due rows, marks them processing, returns them.
-- ############################################################################
CREATE OR REPLACE FUNCTION public.claim_due_staff_notifications(
  p_worker        text,
  p_limit         integer DEFAULT 25,
  p_stale_seconds integer DEFAULT 300
)
RETURNS SETOF public.staff_notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF p_worker IS NULL OR length(btrim(p_worker)) = 0 THEN
    RAISE EXCEPTION 'p_worker must be non-null and non-empty';
  END IF;
  IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 100 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 100';
  END IF;
  IF p_stale_seconds IS NULL OR p_stale_seconds <= 0 OR p_stale_seconds > 3600 THEN
    RAISE EXCEPTION 'p_stale_seconds must be between 1 and 3600';
  END IF;

  UPDATE public.staff_notifications d
  SET queue_status = 'retry_wait', next_attempt_at = v_now, locked_at = NULL, locked_by = NULL, updated_at = v_now
  WHERE d.queue_status = 'processing' AND d.locked_at IS NOT NULL
    AND d.locked_at < v_now - (p_stale_seconds || ' seconds')::interval
    AND d.attempts < d.max_attempts;

  RETURN QUERY
  WITH due AS (
    SELECT d.id FROM public.staff_notifications d
    WHERE d.queue_status IN ('queued', 'retry_wait')
      AND d.next_attempt_at IS NOT NULL AND d.next_attempt_at <= v_now
    ORDER BY d.next_attempt_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.staff_notifications d
  SET queue_status = 'processing', locked_at = v_now, locked_by = p_worker, updated_at = v_now
  FROM due WHERE d.id = due.id
  RETURNING d.*;
END;
$fn$;
REVOKE ALL ON FUNCTION public.claim_due_staff_notifications(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_staff_notifications(text, integer, integer) TO service_role;


-- ############################################################################
-- 7. mark_staff_notifications_read -- the ONLY way a recipient changes in-app read state. It sets
--    in_app_read_at (and nothing else) on the caller's OWN rows, resolved from auth.uid() via
--    portal_profile_id(). Granted to authenticated so the in-app client can call it with the user's
--    JWT; it cannot touch the email-queue columns or another user's rows.
-- ############################################################################
CREATE OR REPLACE FUNCTION public.mark_staff_notifications_read(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_me    uuid := public.portal_profile_id();
  v_count int;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'MS403';
  END IF;
  UPDATE public.staff_notifications
     SET in_app_read_at = now(), updated_at = now()
   WHERE recipient_profile_id = v_me
     AND (p_ids IS NULL OR id = ANY(p_ids))
     AND in_app_read_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public.mark_staff_notifications_read(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_staff_notifications_read(uuid[]) TO authenticated;

COMMIT;
```

## Appendix C: Phase 2B preflight / verification / rollback

```sql
-- ============================================================================
-- PHASE 2B PREFLIGHT + VERIFICATION + ROLLBACK for
--   supabase/migrations/20260722000000_preceptor_mirror_repair_and_sync.sql
-- ============================================================================
-- Run the BEFORE block (read-only) immediately before applying the migration and confirm
-- the counts match the accepted Phase 2A findings. Run the AFTER block (read-only)
-- immediately after COMMIT. The ROLLBACK block is a WRITE script; run it only to revert.
-- Run as the service role or an owner/admin.
-- ============================================================================


-- ############################################################################
-- BEFORE (read-only). Expect: 6a_name=4, 6a_email=0, 7a=4, everything else 0.
-- ############################################################################

-- B1. Defect counts, COLUMN-PRECISE. The free-text defect is split so it is explicit that
--     for the accepted data only matched_preceptor is wrong (email is already canonical).
WITH
missing AS (SELECT s.id FROM students s WHERE s.preceptor_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM student_preceptor_assignments a
    WHERE a.student_id=s.id AND a.cohort_id=s.cohort_id AND a.role='primary' AND a.status='active')),
stale AS (SELECT s.id FROM students s
  JOIN student_preceptor_assignments a ON a.student_id=s.id AND a.cohort_id=s.cohort_id AND a.role='primary' AND a.status='active'
  WHERE s.preceptor_id IS DISTINCT FROM a.preceptor_id),
name_drift AS (SELECT s.id FROM students s JOIN preceptors p ON p.id=s.preceptor_id
  WHERE s.preceptor_id IS NOT NULL
    AND btrim(lower(coalesce(s.matched_preceptor,''))) IS DISTINCT FROM btrim(lower(coalesce(p.full_name,'')))),
email_drift AS (SELECT s.id FROM students s JOIN preceptors p ON p.id=s.preceptor_id
  WHERE s.preceptor_id IS NOT NULL
    AND btrim(lower(coalesce(s.preceptor_email,''))) IS DISTINCT FROM btrim(lower(coalesce(p.email,'')))),
matchfk AS (SELECT m.id FROM matches m JOIN students s ON s.id=m.student_id AND s.cohort_id=m.cohort_id
  WHERE m.preceptor_id IS DISTINCT FROM s.preceptor_id)
SELECT '1_primary_missing_mirror'     AS category, count(*) FROM missing
UNION ALL SELECT '2_primary_stale_mirror',        count(*) FROM stale
UNION ALL SELECT '6a_matched_preceptor_disagrees', count(*) FROM name_drift
UNION ALL SELECT '6a_preceptor_email_disagrees',   count(*) FROM email_drift
UNION ALL SELECT '7a_match_preceptor_disagrees',   count(*) FROM matchfk
ORDER BY category;

-- B2. Baseline count of student_preceptor_assignments rows by (role, status). Record this;
--     the repair must leave it UNCHANGED (it writes no assignment rows).
SELECT role, status, count(*) AS rows
FROM student_preceptor_assignments
GROUP BY role, status
ORDER BY role, status;

-- B2b. MATCHES CARDINALITY. Students with more than one match row in their OWN cohort.
--      Expect ZERO rows. Any row here means the "single current match" rule is undecided for
--      that student: the repair and the trigger will NOT touch that student's match FK, and a
--      data decision (which match row is canonical) is required before those rows are repaired.
SELECT m.student_id, m.cohort_id, count(*) AS same_cohort_match_rows, array_agg(m.id) AS match_ids
FROM matches m
JOIN students s ON s.id = m.student_id AND s.cohort_id = m.cohort_id
GROUP BY m.student_id, m.cohort_id
HAVING count(*) > 1
ORDER BY m.student_id;

-- B3. The equivalence gate (should already be clean per Phase 2A). MUST RETURN ZERO ROWS.
SELECT s.id AS student_id, s.preceptor_id AS canonical, a.preceptor_id AS active_primary
FROM students s
LEFT JOIN student_preceptor_assignments a
  ON a.student_id=s.id AND a.cohort_id=s.cohort_id AND a.role='primary' AND a.status='active'
WHERE s.preceptor_id IS DISTINCT FROM a.preceptor_id;

-- B4. Confirm the trigger does not already exist (fresh apply). Expect ZERO rows.
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.students'::regclass AND tgname = 'trg_sync_primary_preceptor_mirror';


-- ############################################################################
-- AFTER (read-only). Run immediately after COMMIT.
-- ############################################################################

-- A1. Defect counts now ZERO (re-run B1's column-precise CTEs). Expect all five = 0.
WITH
missing AS (SELECT s.id FROM students s WHERE s.preceptor_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM student_preceptor_assignments a
    WHERE a.student_id=s.id AND a.cohort_id=s.cohort_id AND a.role='primary' AND a.status='active')),
stale AS (SELECT s.id FROM students s
  JOIN student_preceptor_assignments a ON a.student_id=s.id AND a.cohort_id=s.cohort_id AND a.role='primary' AND a.status='active'
  WHERE s.preceptor_id IS DISTINCT FROM a.preceptor_id),
name_drift AS (SELECT s.id FROM students s JOIN preceptors p ON p.id=s.preceptor_id
  WHERE s.preceptor_id IS NOT NULL
    AND btrim(lower(coalesce(s.matched_preceptor,''))) IS DISTINCT FROM btrim(lower(coalesce(p.full_name,'')))),
email_drift AS (SELECT s.id FROM students s JOIN preceptors p ON p.id=s.preceptor_id
  WHERE s.preceptor_id IS NOT NULL
    AND btrim(lower(coalesce(s.preceptor_email,''))) IS DISTINCT FROM btrim(lower(coalesce(p.email,'')))),
matchfk AS (SELECT m.id FROM matches m JOIN students s ON s.id=m.student_id AND s.cohort_id=m.cohort_id
  WHERE m.preceptor_id IS DISTINCT FROM s.preceptor_id
    AND (SELECT count(*) FROM matches m2 WHERE m2.student_id=s.id AND m2.cohort_id=s.cohort_id) = 1)
SELECT '1_primary_missing_mirror'     AS category, count(*) FROM missing
UNION ALL SELECT '2_primary_stale_mirror',        count(*) FROM stale
UNION ALL SELECT '6a_matched_preceptor_disagrees', count(*) FROM name_drift
UNION ALL SELECT '6a_preceptor_email_disagrees',   count(*) FROM email_drift
UNION ALL SELECT '7a_match_preceptor_disagrees',   count(*) FROM matchfk
ORDER BY category;

-- A2. student_preceptor_assignments rows by (role, status) are IDENTICAL to B2 (the repair
--     wrote no assignment rows). Compare visually to the B2 output.
SELECT role, status, count(*) AS rows
FROM student_preceptor_assignments
GROUP BY role, status
ORDER BY role, status;

-- A3. No secondary/coverage row was changed by the repair. The repair touched only students
--     and matches, so no secondary/coverage row exists in the rollback audit. Expect ZERO.
SELECT count(*) AS secondary_coverage_rows_in_audit
FROM public.preceptor_mirror_repair_audit
WHERE batch = 'phase2b-preceptor-mirror'
  AND entity = 'student_preceptor_assignments';

-- A4. The equivalence gate still clean: every active primary mirror equals the canonical.
--     MUST RETURN ZERO ROWS.
SELECT s.id AS student_id, s.preceptor_id AS canonical, a.preceptor_id AS active_primary
FROM students s
LEFT JOIN student_preceptor_assignments a
  ON a.student_id=s.id AND a.cohort_id=s.cohort_id AND a.role='primary' AND a.status='active'
WHERE s.preceptor_id IS DISTINCT FROM a.preceptor_id;

-- A5. Repaired-row provenance from the audit, one row per repaired column. For the accepted
--     production data expect EXACTLY:
--        students | matched_preceptor | 4
--        matches  | preceptor_id      | 4
--     and NO students/preceptor_email row (email was already canonical) -> 8 audit rows total.
SELECT entity, col, count(*) AS repaired_rows
FROM public.preceptor_mirror_repair_audit
WHERE batch = 'phase2b-preceptor-mirror'
GROUP BY entity, col
ORDER BY entity, col;

-- A5b. Total audit rows for the batch. Expect 8 for the accepted data.
SELECT count(*) AS total_audit_rows
FROM public.preceptor_mirror_repair_audit
WHERE batch = 'phase2b-preceptor-mirror';

-- A6. The trigger exists, is an AFTER trigger on students, and the function is
--     SECURITY DEFINER with a fixed search_path and no PUBLIC execute.
SELECT t.tgname, t.tgenabled, p.prosecdef AS security_definer, p.proconfig AS settings
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.students'::regclass
  AND t.tgname = 'trg_sync_primary_preceptor_mirror';

SELECT has_function_privilege('public', 'public.sync_primary_preceptor_mirror()', 'EXECUTE') AS public_can_execute;
  -- Expect false.

-- A7. No new RLS policy was added to the relationship tables (permissions unchanged).
SELECT schemaname, tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('student_preceptor_assignments', 'matches', 'students')
ORDER BY tablename, policyname;
  -- Compare to the known baseline; there must be NO new policy from this migration.


-- ############################################################################
-- ROLLBACK (WRITE script; run ONLY to revert). Restores the one-time repair from the
-- audit table and removes the prevention trigger. It does NOT (and cannot) revert changes
-- the trigger made for real preceptor_id changes committed AFTER apply; those are
-- legitimate. Run inside a transaction.
-- ############################################################################
-- BEGIN;
--
-- -- Restore students display mirror.
-- UPDATE public.students s SET matched_preceptor = a.old_value
-- FROM public.preceptor_mirror_repair_audit a
-- WHERE a.batch='phase2b-preceptor-mirror' AND a.entity='students' AND a.col='matched_preceptor'
--   AND a.ref_id = s.id;
-- UPDATE public.students s SET preceptor_email = a.old_value
-- FROM public.preceptor_mirror_repair_audit a
-- WHERE a.batch='phase2b-preceptor-mirror' AND a.entity='students' AND a.col='preceptor_email'
--   AND a.ref_id = s.id;
--
-- -- Restore current-cohort match FK (NULL preserved).
-- UPDATE public.matches m SET preceptor_id = a.old_value::uuid
-- FROM public.preceptor_mirror_repair_audit a
-- WHERE a.batch='phase2b-preceptor-mirror' AND a.entity='matches' AND a.col='preceptor_id'
--   AND a.ref_id = m.id;
--
-- -- Remove the prevention mechanism.
-- DROP TRIGGER IF EXISTS trg_sync_primary_preceptor_mirror ON public.students;
-- DROP FUNCTION IF EXISTS public.sync_primary_preceptor_mirror();
--
-- -- Optionally retain the audit table as a record, or drop it:
-- -- DROP TABLE IF EXISTS public.preceptor_mirror_repair_audit;
--
-- COMMIT;
```

## Appendix D: Phase 2C preflight / verification / rollback

```sql
-- ============================================================================
-- PHASE 2C PREFLIGHT + VERIFICATION + ROLLBACK for
--   supabase/migrations/20260723000000_preceptor_assignment_authorization.sql
-- ============================================================================
-- Run BEFORE (read-only) then apply the migration, then run AFTER (read-only). The ROLLBACK
-- block is a WRITE script. Run as the service role or an owner/admin. Phase 2B must be applied
-- first (this migration's RPCs rely on the 2B sync trigger).
-- ============================================================================


-- ############################################################################
-- BEFORE (read-only)
-- ############################################################################

-- B1. Phase 2B dependency present (the sync trigger must already exist). Expect ONE row.
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.students'::regclass AND tgname = 'trg_sync_primary_preceptor_mirror';

-- B2. The 2C guard/objects do NOT yet exist. Expect ZERO rows each.
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.students'::regclass AND tgname = 'trg_guard_students_preceptor_id';
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('preceptor_assignment_events', 'staff_notifications');

-- B3. Baseline: preceptors has no provenance columns yet. Expect ZERO rows.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'preceptors'
  AND column_name IN ('created_by', 'created_by_role');

-- B4. Dependencies exist. Expect is_active_owner_or_admin and portal_profile_id.
SELECT proname FROM pg_proc WHERE proname IN ('is_active_owner_or_admin', 'portal_profile_id') ORDER BY proname;


-- ############################################################################
-- AFTER (read-only)
-- ############################################################################

-- A1. Guard trigger exists, BEFORE UPDATE, function is SECURITY INVOKER + fixed search_path.
--     Expect prosecdef = false (INVOKER) and proconfig showing search_path.
SELECT t.tgname, p.prosecdef AS security_definer, p.proconfig AS settings
FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.students'::regclass AND t.tgname = 'trg_guard_students_preceptor_id';

-- A2. The write + claim RPCs are SECURITY DEFINER and granted to service_role only.
SELECT p.proname, p.prosecdef AS security_definer
FROM pg_proc p
WHERE p.proname IN ('assign_primary_preceptor', 'set_secondary_coverage_preceptor',
                    'create_unit_preceptor', 'claim_due_staff_notifications')
ORDER BY p.proname;

-- A2b. Grants. The write/claim RPCs: authenticated/anon = false, service_role = true. The
--      mark-read RPC is authenticated = true (called with the user's JWT), anon = false.
SELECT 'assign_primary_preceptor' AS fn,
  has_function_privilege('authenticated', 'public.assign_primary_preceptor(uuid,uuid,uuid,text,boolean,boolean,text)', 'EXECUTE') AS authenticated_can,
  has_function_privilege('service_role',  'public.assign_primary_preceptor(uuid,uuid,uuid,text,boolean,boolean,text)', 'EXECUTE') AS service_role_can;
SELECT 'mark_staff_notifications_read' AS fn,
  has_function_privilege('authenticated', 'public.mark_staff_notifications_read(uuid[])', 'EXECUTE') AS authenticated_can,
  has_function_privilege('anon',          'public.mark_staff_notifications_read(uuid[])', 'EXECUTE') AS anon_can;
-- Expect: assign authenticated=false/service_role=true; mark-read authenticated=true/anon=false.

-- A3. New tables: RLS enabled; preceptor_assignment_events has one owner/admin SELECT policy;
--     staff_notifications has one SELECT policy (own-or-admin) and NO client write policy.
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('preceptor_assignment_events', 'staff_notifications')
ORDER BY tablename, cmd;
SELECT c.relname, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('preceptor_assignment_events', 'staff_notifications');

-- A4. preceptors gained the provenance columns.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'preceptors'
  AND column_name IN ('created_by', 'created_by_role')
ORDER BY column_name;

-- A5. No RLS widened elsewhere: students / student_preceptor_assignments / preceptors / matches
--     policies unchanged. Compare to the known baseline (visual).
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('students', 'student_preceptor_assignments', 'preceptors', 'matches')
ORDER BY tablename, policyname;

-- A6. Behavioral smoke (OPTIONAL; run only in a scratch transaction and ROLLBACK):
-- BEGIN;
--   SET LOCAL ROLE authenticated;   -- auth.uid() is NULL, so is_active_owner_or_admin() = false
--   UPDATE public.students SET preceptor_id = preceptor_id WHERE id = (SELECT id FROM public.students LIMIT 1);
--   -- expect: ERROR MS403 (guarded)
-- ROLLBACK;


-- ############################################################################
-- ROLLBACK (WRITE script; run ONLY to revert). Order: trigger, functions, tables, columns.
-- ############################################################################
-- BEGIN;
--   DROP TRIGGER IF EXISTS trg_guard_students_preceptor_id ON public.students;
--   DROP FUNCTION IF EXISTS public.guard_students_preceptor_id_change();
--   DROP FUNCTION IF EXISTS public.assign_primary_preceptor(uuid, uuid, uuid, text, boolean, boolean, text);
--   DROP FUNCTION IF EXISTS public.set_secondary_coverage_preceptor(uuid, uuid, text, text, uuid, uuid, text, text, boolean, boolean, text);
--   DROP FUNCTION IF EXISTS public.create_unit_preceptor(uuid, text, text, text, text, text, text);
--   DROP FUNCTION IF EXISTS public._preceptor_assert_actor_for_student(uuid, uuid, text, boolean, boolean);
--   DROP FUNCTION IF EXISTS public._emit_staff_notifications(text, text, uuid, text, text, uuid, uuid, text, text, text, text, text, boolean, text);
--   DROP FUNCTION IF EXISTS public.claim_due_staff_notifications(text, integer, integer);
--   DROP FUNCTION IF EXISTS public.mark_staff_notifications_read(uuid[]);
--   DROP TABLE IF EXISTS public.staff_notifications;
--   DROP TABLE IF EXISTS public.preceptor_assignment_events;
--   ALTER TABLE public.preceptors DROP COLUMN IF EXISTS created_by_role;
--   ALTER TABLE public.preceptors DROP COLUMN IF EXISTS created_by;
-- COMMIT;
-- NOTE: dropping the guard REOPENS the broad students UPDATE RLS path. Also stop the
-- staff-notification-worker cron before rollback so it does not query a dropped table.
```

_End of Final Owner SQL Review Package._
