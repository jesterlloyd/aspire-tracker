# Phase 2B/2C: Request Idempotency and Final Owner SQL Package

Status: PHASE 2B AND PHASE 2C APPLIED MANUALLY. LIVE GRANTS HARDENED. CANONICAL SOURCE ALIGNED LOCALLY. NOT DEPLOYED OR MERGED.
Branch: `phase2c-preceptor-authz`.
Privilege-hardening baseline: `2da9bb431faa275858f2fb171d0714567f59e10f`.

Phase 2B and Phase 2C were applied manually to the live database. Live AFTER verification then
exposed Supabase default-grant gaps: internal functions remained client-executable and the three
new Phase 2C tables retained client table-level write privileges despite having no write policies.
Jester manually hardened the live grants. This source pass codifies that hardened state in the
canonical migrations, expands the AFTER verification proofs, refreshes the complete SQL
appendices, and preserves the approved mail identity. Codex ran no SQL and applied or rolled back
no migration; nothing was merged, pushed, or deployed; and the Unit Leader assignment UI remains
disabled.

---

## 1. Findings and corrections from `75f19eb`

| Finding | Correction / proof |
| --- | --- |
| `PreceptorAssignmentModal` was the only caller of `api/preceptor-primary-assign.js`; the API minted a new ID inside every HTTP attempt. | The modal now creates one `crypto.randomUUID()` before the request, retains it after failure for retry, and clears it only after success or when the user begins a new action. The API requires and forwards `requestId`. |
| A rapid double-click could issue two requests with two different IDs. | A synchronous request-controller guard blocks a second submission before React re-renders; the button is also disabled while in flight. |
| There is no current caller of `api/portal/unit-preceptor-manage.js`; it is reserved for the disabled future Unit Leader UI and also minted IDs per attempt. | The endpoint now requires non-empty `request_id` and forwards it unchanged. Any future UI must create, retain, and replace IDs under the same per-intent contract. The UI was not enabled. |
| SQL fingerprints used delimiter-concatenated MD5 input. A `|` inside free text could make different field tuples indistinguishable. Creation also lowercased a name even though the stored name preserves case. | Each RPC now fingerprints a canonical `jsonb_build_object(...)::text` containing every applicable mutation value. No delimiter parsing or digest collision is involved. The ledger also compares stored actor ID and RPC name explicitly. |
| The embedded SQL appendices were stale relative to the canonical files and omitted the email-uniqueness preflight. | Appendices A-E are regenerated from the five canonical SQL files and verified byte-for-byte by test. |
| Live AFTER verification exposed default table and function grants that were broader than the intended RLS/RPC model. | Jester manually hardened the live database. The Phase 2B/2C migrations now explicitly revoke client table/function privileges, restore only the intended authenticated SELECT/mark-read access, and grant full required access to `service_role`; AFTER verification proves the exact privilege matrix and SELECT-only policies. |
| The mail sender was described indirectly. | The approved values are preserved exactly: `ASPIRE at Cedars-Sinai <noreply@aspire-program.com>` and Reply-To `aspire@cshs.org`. Sender approval is not a blocker. |

The privilege-hardening diff from `2da9bb4` is limited to the two canonical migrations, their two
read-only audit files, static migration/safety tests, and this regenerated handoff package.

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

## 6. Future-environment maintenance-window order

The live database has already completed the Phase 2B and Phase 2C application sequence and Jester
has manually corrected its grants. The following order remains the canonical process for future
environments; it was not run during this source-hardening pass.

1. Run the email-uniqueness preflight (Appendix E). Confirm the normalized unique index exists,
   duplicate groups = 0, and excess duplicate rows = 0. The normalization and blank/null counts
   are informational because the partial index intentionally excludes blank/null email rows.
2. Run the Phase 2B BEFORE block; confirm counts match the accepted 2A findings
   (`6a_matched_preceptor=4`, `6a_preceptor_email=0`, `7a=4`, all others 0; cardinality B2b = 0).
3. Apply Phase 2B (`20260722000000_...`) in one transaction.
4. Run the Phase 2B AFTER block; confirm all defect counts are 0 and the 8-row audit provenance.
5. Run the Phase 2C BEFORE block; confirm the 2B trigger is present and the 2C objects are absent.
6. Apply Phase 2C (`20260723000000_...`) in one transaction.
7. Run the Phase 2C AFTER block; confirm the INVOKER guard, the four service-role RPCs, the
   `authenticated` mark-read grant, all three tables + SELECT-only policies, the provenance columns,
   and that no other RLS was widened.
8. Deploy the compatible app changes (endpoints, worker, `vercel.json` cron) so the worker is
   running BEFORE any UL assignment UI is enabled.
9. Leave the Unit Leader assignment UI disabled until explicitly approved.

The full numbered checklist for steps 1 through 8, with the exact SQL to paste at each step, is
in the Final Owner SQL Review Package below.

---

## 7. Existing UI compatibility (`PreceptorAssignmentModal`)

The staff `PreceptorAssignmentModal` routes the Primary write through
`/api/preceptor-primary-assign` and now owns the request ID for the entire intentional action.
The same ID is used after a failed attempt, double-clicks are blocked, and backing out or starting
a new selection clears the ID so the next intentional action gets a new one. After 2C, the endpoint
calls the audited `assign_primary_preceptor` RPC instead of a bare client UPDATE. The modal does not
send `force`/`confirmOverride`, so for an
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

- Full suite: `node --test 'test/*.test.mjs'` → 2179 tests, 2179 pass, 0 fail.
- Request-id / Phase 2B+2C targeted set → 68 pass, 0 fail. This includes behavioral controller
  tests for stable retry IDs, double-submit rejection, and new-action IDs; API-boundary guards;
  exact replay/conflict ordering; every fingerprint field; exact privilege matrices; internal
  function revokes; SELECT-only policies; and byte-identical SQL appendices.
- Client build: `npx vite build` → clean (size warning only).
- SSR bundle: `npx vite build --ssr src/public-site/prerender-entry.jsx --outDir .prerender-ssr`
  → clean.
- Source hygiene: `git diff --check` clean; no em dash in any changed SQL/JS/JSON.

---

## 11. Verdict and required Owner actions

Verdict: **LIVE GRANTS HARDENED; CANONICAL SOURCE ALIGNED**.

1. Live SQL state: both migrations were applied manually, live AFTER verification exposed the
   default-grant gaps, and Jester manually hardened those grants. The updated read-only AFTER
   checks now document the exact expected state. Codex did not run those checks or execute any SQL.
2. `preceptors` normalized-email uniqueness: RESOLVED. The partial unique index
   `preceptors_email_lower_unique_idx ON public.preceptors (lower(trim(email))) WHERE email IS NOT
   NULL AND trim(email) <> ''` already enforces it (authored in the root-level
   `migration_preceptor_schema_v2.sql`), and `create_unit_preceptor`'s `lower(btrim(email))` matches
   that expression exactly (`btrim` = `trim`), so concurrent duplicate creation is impossible (the
   second insert hits the index, raises `unique_violation`, mapped to MS409). Because that index
   lives outside `supabase/migrations/`, its presence must be confirmed in the target DB:
   `db/audit/preceptor_email_uniqueness_preflight.sql` reports it plus any duplicate/blank rows, and
   Phase 2C after-verification now includes block A8 asserting the index exists. No new migration is
   required unless A8/the preflight shows the index absent.
3. `CRON_SECRET` and Resend env: before deployment, confirm `CRON_SECRET`, `RESEND_API_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_URL`. The approved envelope sender is exactly
   `ASPIRE at Cedars-Sinai <noreply@aspire-program.com>` with Reply-To `aspire@cshs.org`; the worker
   inherits these shared constants. Sender approval is resolved and is not a blocker.
4. In-app surface: IMPLEMENTED. Jester selected one header bell with two tabs: `Action Needed`
   contains the existing live-derived tasks, while `Notifications` reads durable
   `staff_notifications`. The combined unread badge, read/unread state, and deep links are
   implemented. The only remaining notification check is post-apply verification with live
   database rows; no placement decision or additional notification surface remains outstanding.
5. UL assignment UI stays disabled until explicitly approved.

---

# Final Owner SQL Review Package

Everything needed to reproduce both migrations back-to-back in a future environment, in one
place. The SQL in Appendices A through E is embedded verbatim from the canonical repository files
(identical byte-for-byte); apply from these files, and use the appendices for review. The live
database has already been applied and manually hardened; this package was not executed in this
source pass.

Canonical files:
- Appendix A: `supabase/migrations/20260722000000_preceptor_mirror_repair_and_sync.sql` (2B)
- Appendix B: `supabase/migrations/20260723000000_preceptor_assignment_authorization.sql` (2C)
- Appendix C: `db/audit/preceptor_mirror_repair_preflight_and_verification.sql` (2B BEFORE / AFTER / ROLLBACK)
- Appendix D: `db/audit/preceptor_assignment_authorization_preflight_and_verification.sql` (2C BEFORE / AFTER / ROLLBACK)
- Appendix E: `db/audit/preceptor_email_uniqueness_preflight.sql` (read-only prerequisite)

## Numbered back-to-back application checklist for future environments

Run as the service role or an owner/admin, in the Supabase SQL editor. Each apply is ONE
transaction (the migration files already contain `BEGIN;` / `COMMIT;`).

1. Paste and run Appendix E. Confirm the normalized unique index exists; duplicate groups = 0;
   and excess duplicate rows = 0. Q4/Q5 are informational. Stop if Q2, Q3, or Q6 fails.
2. Paste and run Appendix C's `BEFORE (read-only)` block. Confirm: `6a_matched_preceptor_disagrees = 4`,
   `6a_preceptor_email_disagrees = 0`, `7a_match_preceptor_disagrees = 4`, `1_* = 0`, `2_* = 0`;
   the cardinality query (B2b) returns ZERO rows; the equivalence gate (B3) returns ZERO rows;
   the 2B trigger does not yet exist (B4 ZERO rows). Record the B2 role/status baseline.
3. Paste and run all of Appendix A (Phase 2B migration). It runs in its own `BEGIN/COMMIT`.
4. Paste and run Appendix C's `AFTER (read-only)` block. Confirm: all five defect counts = 0;
   the role/status counts equal the step-2 baseline; the audit shows `students|matched_preceptor|4`
   and `matches|preceptor_id|4` and 8 total rows; the trigger is AFTER + SECURITY DEFINER with a
   fixed search_path and PUBLIC/anon/authenticated execute all false; the audit table gives
   PUBLIC/anon/authenticated no privileges and service_role SELECT/INSERT/UPDATE/DELETE; no new
   RLS policy.
5. Paste and run Appendix D's `BEFORE (read-only)` block. Confirm: the 2B trigger is present (B1
   ONE row); the 2C guard trigger and all three 2C tables are absent (B2 ZERO rows each); `preceptors`
   has no `created_by`/`created_by_role` yet (B3 ZERO rows); `is_active_owner_or_admin` and
   `portal_profile_id` both exist (B4).
6. Paste and run all of Appendix B (Phase 2C migration). It runs in its own `BEGIN/COMMIT`.
7. Paste and run Appendix D's `AFTER (read-only)` block. Confirm: the guard trigger exists,
   `security_definer = false` (INVOKER), search_path set (A1); the four write/claim RPCs are
   `security_definer = true` (A2); PUBLIC/anon cannot execute any intended RPC, authenticated can
   execute only `mark_staff_notifications_read`, and service_role can execute all five (A2b); all
   five internal functions deny PUBLIC/anon/authenticated execute (A2c); all three tables have the
   exact client-deny/authenticated-SELECT/service_role-all privilege matrix, RLS enabled, and only
   SELECT policies (A3/A3b/A3c); the provenance columns exist (A4); no other RLS was widened (A5);
   and all A10 fingerprint flags are true for their applicable RPCs.
8. Deploy the app changes on this branch (endpoints, `lib/server/staffNotifications/*`,
   `api/cron/staff-notification-worker.js`, `vercel.json`). Confirm `CRON_SECRET` and the Resend
   env are present so the `staff-notification-worker` cron can run.
9. Leave the Unit Leader assignment UI disabled until explicitly approved.

Rollback (only if reverting): run Appendix D's ROLLBACK block first (drops the 2C guard, RPCs,
tables, and provenance columns; note it REOPENS the broad students UPDATE RLS path and you must
stop the worker cron first), then Appendix C's ROLLBACK block (restores the 2B repair from its
audit table and drops the 2B trigger). Revert in the reverse of the apply order.

---

## Appendix A: Phase 2B migration (supabase/migrations/20260722000000_preceptor_mirror_repair_and_sync.sql)

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
REVOKE ALL PRIVILEGES ON TABLE public.preceptor_mirror_repair_audit FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.preceptor_mirror_repair_audit TO service_role;

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
REVOKE ALL ON FUNCTION public.sync_primary_preceptor_mirror() FROM PUBLIC, anon, authenticated;

COMMIT;
```

## Appendix B: Phase 2C migration (supabase/migrations/20260723000000_preceptor_assignment_authorization.sql)

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
-- TARGETED SECONDARY/COVERAGE (locked):
--   - add     : add ONE active secondary/coverage row; alter no existing assignment.
--   - replace : require p_assignment_id; lock+validate the selected ACTIVE assignment (belongs to
--               the student, role = p_role); end ONLY that assignment; add the new one; preserve
--               every other active assignment.
--   - end     : require p_assignment_id; lock+validate as above; end ONLY that assignment.
--   The actual old/new preceptor id AND name are recorded in the audit event, the in-app
--   notification, the queued email, and the RPC response. History is soft-ended, never deleted.
--
-- COMPLETED-ROTATION WINDOW (locked): a rotation is "completed" IFF students.status = 'Completed'
--   (the canonical source of truth api/lib/unitLeaderScopeRules.js lifecycleBucket; Declined /
--   Not Proceeding are off-ramps, NOT completed rotations). end date = COALESCE(rotation_completed_at,
--   rotation_end_date); NULL => beyond window (fail closed).
--   - Active, or completed within 90 days: normal authorization.
--   - Unit Leader beyond 90 days: DENIED (even with a force flag).
--   - Owner/Admin beyond 90 days: allowed ONLY with p_force = true AND p_confirm_override = true
--     AND a non-empty reason; the event and every notification are marked as a historical override.
--
-- IDEMPOTENCY (locked): every write RPC requires p_request_id and is idempotent on it via the
--   preceptor_assignment_requests ledger. Repeating the SAME request replays the stored result
--   with no second mutation and no second notification; the SAME request_id with DIFFERENT
--   parameters fails (MS409). Correlation ids are derived from p_request_id (stable, never
--   timestamp-based), so notification/email dedup is stable across retries.
--
-- NOTIFICATION (locked): every Unit Leader assignment change / UL-created preceptor, and every
--   Owner/Admin >90d override, writes a durable audit row AND fans out one durable
--   staff_notifications row per ACTIVE Owner/Admin except the acting user, in the SAME
--   transaction. That row carries BOTH the in-app state (read/unread) and the email queue state.
--   Destinations use REAL staff routes: a student notification links to /students?student=<id>
--   (the query form the Student Profiles tab reads; the /students/<id> path form does not route),
--   a preceptor-created notification links to /rotation/preceptors (the directory; there is no
--   per-preceptor detail route). A separate worker sends the emails; a send failure never rolls
--   back the committed assignment.
--
-- SECURITY: no RLS widened; no anon/authenticated write grant; new tables are owner/admin SELECT
--   (staff_notifications additionally lets a recipient read their own row) + service-role write.
--   Every function has a fixed search_path; the write RPCs are service-role only. Errors use the
--   established MS400/403/404/409 SQLSTATE convention.
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
  old_value        text,       -- human-readable old preceptor name (ids live in metadata)
  new_value        text,       -- human-readable new preceptor name (ids live in metadata)
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
REVOKE ALL PRIVILEGES ON TABLE public.preceptor_assignment_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.preceptor_assignment_events TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.preceptor_assignment_events TO service_role;


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
  old_value            text,       -- human-readable old preceptor name
  new_value            text,       -- human-readable new preceptor name
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
REVOKE ALL PRIVILEGES ON TABLE public.staff_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.staff_notifications TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.staff_notifications TO service_role;


-- ############################################################################
-- 3b. preceptor_assignment_requests -- idempotency ledger. One row per p_request_id. A repeat of
--     the SAME request (same fingerprint) replays the stored result with no second mutation and no
--     second notification; the SAME request_id with a DIFFERENT fingerprint is a conflict (MS409).
--     The claim is row-first (INSERT ... ON CONFLICT DO NOTHING), so two concurrent identical
--     requests serialize on the primary key and only one mutates. Owner/admin SELECT only.
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.preceptor_assignment_requests (
  request_id       text        PRIMARY KEY,
  actor_profile_id uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  rpc              text        NOT NULL,
  fingerprint      text        NOT NULL,
  result           jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);
ALTER TABLE public.preceptor_assignment_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "preceptor_assignment_requests_owner_admin_read"
  ON public.preceptor_assignment_requests FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin());
REVOKE ALL PRIVILEGES ON TABLE public.preceptor_assignment_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.preceptor_assignment_requests TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.preceptor_assignment_requests TO service_role;


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

REVOKE ALL ON FUNCTION public.guard_students_preceptor_id_change() FROM PUBLIC, anon, authenticated;


-- ############################################################################
-- 5a. Shared authorization helper. Returns jsonb { role, was_override, unit_key, cohort_id } for
--     the actor against the student, or RAISES MS4xx. Enforces the completed-rotation window and
--     the override rule. Completed <=> students.status = 'Completed' (see header).
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

  -- Completed-rotation window. Completed <=> status = 'Completed' (canonical, per header). end
  -- date = COALESCE(rotation_completed_at, rotation_end_date); NULL for a completed student =>
  -- treated as beyond window (fail closed).
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
REVOKE ALL ON FUNCTION public._preceptor_assert_actor_for_student(uuid, uuid, text, boolean, boolean) FROM PUBLIC, anon, authenticated;


-- ############################################################################
-- 5a2. Idempotency helpers. _preceptor_begin_request claims a request row (or detects a replay /
--      a conflicting reuse); _preceptor_finish_request stores the result. Internal (owner-only);
--      called only by the write RPCs below, which run as the definer owner.
-- ############################################################################
CREATE OR REPLACE FUNCTION public._preceptor_begin_request(
  p_request_id       text,
  p_actor_profile_id uuid,
  p_rpc              text,
  p_fingerprint      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_inserted int;
  v_actor    uuid;
  v_rpc      text;
  v_fp       text;
  v_res      jsonb;
BEGIN
  IF p_request_id IS NULL OR btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'a request id is required' USING ERRCODE = 'MS400';
  END IF;

  INSERT INTO public.preceptor_assignment_requests (request_id, actor_profile_id, rpc, fingerprint)
  VALUES (p_request_id, p_actor_profile_id, p_rpc, p_fingerprint)
  ON CONFLICT (request_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 1 THEN
    RETURN jsonb_build_object('claimed', true);   -- first time: caller proceeds and finishes
  END IF;

  -- A row already exists: replay or conflicting reuse. Lock it (serializes with any in-flight txn;
  -- by the time this returns, that txn has committed a result or rolled back the claim entirely).
  SELECT actor_profile_id, rpc, fingerprint, result INTO v_actor, v_rpc, v_fp, v_res
  FROM public.preceptor_assignment_requests WHERE request_id = p_request_id FOR UPDATE;

  IF v_actor IS DISTINCT FROM p_actor_profile_id
     OR v_rpc IS DISTINCT FROM p_rpc
     OR v_fp IS DISTINCT FROM p_fingerprint THEN
    RAISE EXCEPTION 'this request id was already used with different parameters' USING ERRCODE = 'MS409';
  END IF;
  IF v_res IS NULL THEN
    -- Same fingerprint, no stored result: a concurrent attempt is still in flight (a committed
    -- single-transaction RPC always stores its result before COMMIT). Refuse to double-run.
    RAISE EXCEPTION 'this request is already in progress' USING ERRCODE = 'MS409';
  END IF;
  RETURN jsonb_build_object('claimed', false, 'result', v_res);  -- idempotent replay
END;
$fn$;
REVOKE ALL ON FUNCTION public._preceptor_begin_request(text, uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._preceptor_finish_request(p_request_id text, p_result jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
BEGIN
  UPDATE public.preceptor_assignment_requests
     SET result = p_result, completed_at = now()
   WHERE request_id = p_request_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public._preceptor_finish_request(text, jsonb) FROM PUBLIC, anon, authenticated;


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
REVOKE ALL ON FUNCTION public._emit_staff_notifications(text, text, uuid, text, text, uuid, uuid, text, text, text, text, text, boolean, text) FROM PUBLIC, anon, authenticated;


-- ############################################################################
-- 5c. assign_primary_preceptor -- change/assign the Primary. Sets students.preceptor_id and lets
--     the Phase 2B trigger synchronize the Primary mirror. Idempotent on p_request_id.
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
  v_fp        text;
  v_claim     jsonb;
  v_authz     jsonb;
  v_role      text;
  v_override  boolean;
  v_cohort    uuid;
  v_unit_key  text;
  v_old       uuid;
  v_old_name  text;
  v_new_name  text;
  v_match_ct  int;
  v_corr      text;
  v_result    jsonb;
BEGIN
  IF p_actor_profile_id IS NULL OR p_student_id IS NULL OR p_preceptor_id IS NULL THEN
    RAISE EXCEPTION 'missing required argument' USING ERRCODE = 'MS400';
  END IF;

  -- Idempotency: claim (or replay) BEFORE any mutation. A failed run rolls the claim back with it.
  v_fp := jsonb_build_object(
    'rpc', 'assign_primary_preceptor',
    'actor_profile_id', p_actor_profile_id,
    'action', 'assign',
    'student_id', p_student_id,
    'assignment_id', NULL,
    'preceptor_id', p_preceptor_id,
    'role', 'primary',
    'reason', p_reason,
    'notes', NULL,
    'force', COALESCE(p_force, false),
    'confirm_override', COALESCE(p_confirm_override, false)
  )::text;
  v_claim := public._preceptor_begin_request(p_request_id, p_actor_profile_id, 'assign_primary_preceptor', v_fp);
  IF NOT (v_claim->>'claimed')::boolean THEN
    RETURN v_claim->'result';
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

  IF v_old IS NOT NULL THEN SELECT full_name INTO v_old_name FROM public.preceptors WHERE id = v_old; END IF;
  SELECT full_name INTO v_new_name FROM public.preceptors WHERE id = p_preceptor_id;

  v_corr := 'preceptor_primary:' || p_request_id;

  INSERT INTO public.preceptor_assignment_events
    (actor_profile_id, actor_role, action, student_id, preceptor_id, cohort_id, unit_key,
     assignment_role, old_value, new_value, reason, was_override, correlation_id, request_id, metadata)
  VALUES
    (p_actor_profile_id, v_role, 'assign_primary', p_student_id, p_preceptor_id, v_cohort, v_unit_key,
     'primary', v_old_name, v_new_name, p_reason, v_override, v_corr, p_request_id,
     jsonb_build_object('old_preceptor_id', v_old, 'old_preceptor_name', v_old_name,
                        'new_preceptor_id', p_preceptor_id, 'new_preceptor_name', v_new_name));

  PERFORM public._emit_staff_notifications(
    v_corr, 'preceptor_primary_changed', p_actor_profile_id, v_role,
    (CASE WHEN v_override THEN 'Primary preceptor changed (historical override)' ELSE 'Primary preceptor changed' END),
    p_student_id, p_preceptor_id, v_unit_key, 'primary', v_old_name, v_new_name, p_reason, v_override,
    '/students?student=' || p_student_id::text);

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
       'primary', v_old_name, v_new_name, p_reason, v_corr || ':anomaly', p_request_id,
       jsonb_build_object('same_cohort_match_rows', v_match_ct));
    PERFORM public._emit_staff_notifications(
      v_corr || ':anomaly', 'preceptor_match_anomaly', p_actor_profile_id, v_role,
      'Match record needs review (multiple same-cohort matches)',
      p_student_id, p_preceptor_id, v_unit_key, 'primary', v_old_name, v_new_name, NULL, false,
      '/students?student=' || p_student_id::text);
  END IF;

  v_result := jsonb_build_object('ok', true, 'student_id', p_student_id,
                            'old_preceptor_id', v_old, 'old_preceptor_name', v_old_name,
                            'new_preceptor_id', p_preceptor_id, 'new_preceptor_name', v_new_name,
                            'actor_role', v_role, 'was_override', v_override);
  PERFORM public._preceptor_finish_request(p_request_id, v_result);
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.assign_primary_preceptor(uuid, uuid, uuid, text, boolean, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_primary_preceptor(uuid, uuid, uuid, text, boolean, boolean, text) TO service_role;


-- ############################################################################
-- 5d. set_secondary_coverage_preceptor -- TARGETED add / replace / end of Secondary or Coverage
--     through the canonical student_preceptor_assignments. Replace/End act on the ONE assignment
--     named by p_assignment_id (locked + validated); all other active rows are preserved. Never
--     touches Primary. Cross-unit allowed. Idempotent on p_request_id.
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
  v_fp       text;
  v_claim    jsonb;
  v_authz    jsonb;
  v_role     text;
  v_override boolean;
  v_cohort   uuid;
  v_unit_key text;
  v_target   record;
  v_old_id   uuid;
  v_old_name text;
  v_new_name text;
  v_new_id   uuid;
  v_lbl      text;
  v_corr     text;
  v_result   jsonb;
BEGIN
  IF p_role NOT IN ('secondary', 'coverage') THEN
    RAISE EXCEPTION 'role must be secondary or coverage' USING ERRCODE = 'MS400';
  END IF;
  IF p_action NOT IN ('add', 'replace', 'end') THEN
    RAISE EXCEPTION 'action must be add, replace, or end' USING ERRCODE = 'MS400';
  END IF;

  v_fp := jsonb_build_object(
    'rpc', 'set_secondary_coverage_preceptor',
    'actor_profile_id', p_actor_profile_id,
    'action', p_action,
    'student_id', p_student_id,
    'assignment_id', p_assignment_id,
    'preceptor_id', p_preceptor_id,
    'role', p_role,
    'reason', p_reason,
    'notes', p_notes,
    'force', COALESCE(p_force, false),
    'confirm_override', COALESCE(p_confirm_override, false)
  )::text;
  v_claim := public._preceptor_begin_request(p_request_id, p_actor_profile_id, 'set_secondary_coverage_preceptor', v_fp);
  IF NOT (v_claim->>'claimed')::boolean THEN
    RETURN v_claim->'result';
  END IF;

  v_authz    := public._preceptor_assert_actor_for_student(p_actor_profile_id, p_student_id, p_reason, p_force, p_confirm_override);
  v_role     := v_authz->>'role';
  v_override := (v_authz->>'was_override')::boolean;
  v_unit_key := v_authz->>'unit_key';
  v_cohort   := (v_authz->>'cohort_id')::uuid;

  -- Replace and End both target ONE existing assignment: lock it, validate ownership + role, and
  -- end ONLY that row. Every other active assignment is left untouched.
  IF p_action IN ('replace', 'end') THEN
    IF p_assignment_id IS NULL THEN
      RAISE EXCEPTION 'assignment id is required to replace or end' USING ERRCODE = 'MS400';
    END IF;
    SELECT a.id, a.preceptor_id, a.role, a.student_id, a.status
      INTO v_target
      FROM public.student_preceptor_assignments a
     WHERE a.id = p_assignment_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'assignment not found' USING ERRCODE = 'MS404';
    END IF;
    IF v_target.student_id <> p_student_id THEN
      RAISE EXCEPTION 'assignment does not belong to this student' USING ERRCODE = 'MS404';
    END IF;
    IF v_target.role <> p_role THEN
      RAISE EXCEPTION 'assignment role does not match' USING ERRCODE = 'MS409';
    END IF;
    IF v_target.status <> 'active' THEN
      RAISE EXCEPTION 'assignment is not active' USING ERRCODE = 'MS409';
    END IF;
    v_old_id := v_target.preceptor_id;

    UPDATE public.student_preceptor_assignments
       SET status = 'ended', end_date = current_date, updated_at = now()
     WHERE id = p_assignment_id;
  END IF;

  -- Add and Replace both insert exactly ONE new active assignment.
  IF p_action IN ('add', 'replace') THEN
    IF p_preceptor_id IS NULL THEN
      RAISE EXCEPTION 'preceptor id is required to add or replace' USING ERRCODE = 'MS400';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.preceptors p WHERE p.id = p_preceptor_id AND p.is_active IS TRUE) THEN
      RAISE EXCEPTION 'preceptor is inactive or does not exist' USING ERRCODE = 'MS400';
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
  END IF;

  v_lbl := (CASE p_action WHEN 'add' THEN 'add_' WHEN 'replace' THEN 'replace_' ELSE 'end_' END) || p_role;

  IF v_old_id IS NOT NULL THEN SELECT full_name INTO v_old_name FROM public.preceptors WHERE id = v_old_id; END IF;
  IF p_preceptor_id IS NOT NULL THEN SELECT full_name INTO v_new_name FROM public.preceptors WHERE id = p_preceptor_id; END IF;

  v_corr := 'preceptor_' || v_lbl || ':' || p_request_id;

  INSERT INTO public.preceptor_assignment_events
    (actor_profile_id, actor_role, action, student_id, preceptor_id, cohort_id, unit_key,
     assignment_role, old_value, new_value, reason, was_override, correlation_id, request_id, metadata)
  VALUES
    (p_actor_profile_id, v_role, v_lbl, p_student_id, p_preceptor_id, v_cohort, v_unit_key,
     p_role, v_old_name, v_new_name, p_reason, v_override, v_corr, p_request_id,
     jsonb_build_object('assignment_id', COALESCE(v_new_id, p_assignment_id),
                        'ended_assignment_id', CASE WHEN p_action IN ('replace', 'end') THEN p_assignment_id ELSE NULL END,
                        'old_preceptor_id', v_old_id, 'old_preceptor_name', v_old_name,
                        'new_preceptor_id', p_preceptor_id, 'new_preceptor_name', v_new_name));

  PERFORM public._emit_staff_notifications(
    v_corr, 'preceptor_' || v_lbl, p_actor_profile_id, v_role, 'Preceptor assignment updated',
    p_student_id, p_preceptor_id, v_unit_key, p_role, v_old_name, v_new_name, p_reason, v_override,
    '/students?student=' || p_student_id::text);

  v_result := jsonb_build_object('ok', true, 'action', v_lbl,
     'assignment_id', COALESCE(v_new_id, p_assignment_id),
     'ended_assignment_id', CASE WHEN p_action IN ('replace', 'end') THEN p_assignment_id ELSE NULL END,
     'old_preceptor_id', v_old_id, 'old_preceptor_name', v_old_name,
     'new_preceptor_id', p_preceptor_id, 'new_preceptor_name', v_new_name);
  PERFORM public._preceptor_finish_request(p_request_id, v_result);
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_secondary_coverage_preceptor(uuid, uuid, text, text, uuid, uuid, text, text, boolean, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_secondary_coverage_preceptor(uuid, uuid, text, text, uuid, uuid, text, text, boolean, boolean, text) TO service_role;


-- ############################################################################
-- 5e. create_unit_preceptor -- canonical Preceptor Directory record. A Unit Leader may only
--     create under a unit in their active scope. Dedups by normalized email; records provenance.
--     Idempotent on p_request_id. Notification links to the preceptor directory (no detail route).
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
  v_fp      text;
  v_claim   jsonb;
  v_role    text;
  v_unit_id uuid;
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_new_id  uuid;
  v_corr    text;
  v_result  jsonb;
BEGIN
  IF btrim(coalesce(p_full_name, '')) = '' THEN RAISE EXCEPTION 'full name is required' USING ERRCODE = 'MS400'; END IF;
  IF v_email = '' OR position('@' in v_email) = 0 THEN RAISE EXCEPTION 'a valid email is required' USING ERRCODE = 'MS400'; END IF;
  IF p_shift NOT IN ('Day', 'Night', 'Mid', 'Variable') THEN RAISE EXCEPTION 'shift must be Day, Night, Mid, or Variable' USING ERRCODE = 'MS400'; END IF;

  v_fp := jsonb_build_object(
    'rpc', 'create_unit_preceptor',
    'actor_profile_id', p_actor_profile_id,
    'action', 'create',
    'full_name', btrim(p_full_name),
    'email', v_email,
    'unit_key', p_unit_key,
    'shift', p_shift,
    'phone', NULLIF(btrim(coalesce(p_phone, '')), '')
  )::text;
  v_claim := public._preceptor_begin_request(p_request_id, p_actor_profile_id, 'create_unit_preceptor', v_fp);
  IF NOT (v_claim->>'claimed')::boolean THEN
    RETURN v_claim->'result';
  END IF;

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

  v_corr := 'preceptor_created:' || p_request_id;

  INSERT INTO public.preceptor_assignment_events
    (actor_profile_id, actor_role, action, preceptor_id, unit_key, new_value, correlation_id, request_id, metadata)
  VALUES
    (p_actor_profile_id, v_role, 'create_preceptor', v_new_id, p_unit_key, btrim(p_full_name), v_corr, p_request_id,
     jsonb_build_object('preceptor_id', v_new_id, 'full_name', btrim(p_full_name), 'email', v_email, 'shift', p_shift));

  PERFORM public._emit_staff_notifications(
    v_corr, 'preceptor_created', p_actor_profile_id, v_role,
    'New preceptor created' || (CASE WHEN v_role = 'unit_leader' THEN ' by a Unit Leader (review)' ELSE '' END),
    NULL, v_new_id, p_unit_key, NULL, NULL, btrim(p_full_name), NULL, false, '/rotation/preceptors');

  v_result := jsonb_build_object('ok', true, 'preceptor_id', v_new_id, 'created_by_role', v_role);
  PERFORM public._preceptor_finish_request(p_request_id, v_result);
  RETURN v_result;
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
REVOKE ALL ON FUNCTION public.mark_staff_notifications_read(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_staff_notifications_read(uuid[]) TO authenticated, service_role;

COMMIT;
```

## Appendix C: Phase 2B preflight / verification / rollback (db/audit/preceptor_mirror_repair_preflight_and_verification.sql)

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
--     SECURITY DEFINER with a fixed search_path and no PUBLIC/anon/authenticated execute.
SELECT t.tgname, t.tgenabled, p.prosecdef AS security_definer, p.proconfig AS settings
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.students'::regclass
  AND t.tgname = 'trg_sync_primary_preceptor_mirror';

SELECT p.proname,
  EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) AS public_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'sync_primary_preceptor_mirror';
  -- Expect: all three execute columns = false.

-- A6b. Rollback-audit table privileges are fail-closed. PUBLIC/anon/authenticated have no table
--      privileges; service_role has the SELECT/INSERT/UPDATE/DELETE access needed for support and
--      rollback operations. Expect every public/anon/authenticated column false and every
--      service_role column true.
WITH target AS (
  SELECT c.oid, c.relacl, c.relowner
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'preceptor_mirror_repair_audit'
)
SELECT
  EXISTS (SELECT 1 FROM aclexplode(COALESCE(t.relacl, acldefault('r', t.relowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'SELECT') AS public_select,
  EXISTS (SELECT 1 FROM aclexplode(COALESCE(t.relacl, acldefault('r', t.relowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'INSERT') AS public_insert,
  EXISTS (SELECT 1 FROM aclexplode(COALESCE(t.relacl, acldefault('r', t.relowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'UPDATE') AS public_update,
  EXISTS (SELECT 1 FROM aclexplode(COALESCE(t.relacl, acldefault('r', t.relowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'DELETE') AS public_delete,
  has_table_privilege('anon', t.oid, 'SELECT') AS anon_select,
  has_table_privilege('anon', t.oid, 'INSERT') AS anon_insert,
  has_table_privilege('anon', t.oid, 'UPDATE') AS anon_update,
  has_table_privilege('anon', t.oid, 'DELETE') AS anon_delete,
  has_table_privilege('authenticated', t.oid, 'SELECT') AS authenticated_select,
  has_table_privilege('authenticated', t.oid, 'INSERT') AS authenticated_insert,
  has_table_privilege('authenticated', t.oid, 'UPDATE') AS authenticated_update,
  has_table_privilege('authenticated', t.oid, 'DELETE') AS authenticated_delete,
  has_table_privilege('service_role', t.oid, 'SELECT') AS service_role_select,
  has_table_privilege('service_role', t.oid, 'INSERT') AS service_role_insert,
  has_table_privilege('service_role', t.oid, 'UPDATE') AS service_role_update,
  has_table_privilege('service_role', t.oid, 'DELETE') AS service_role_delete
FROM target t;

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

## Appendix D: Phase 2C preflight / verification / rollback (db/audit/preceptor_assignment_authorization_preflight_and_verification.sql)

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
WHERE schemaname = 'public' AND tablename IN ('preceptor_assignment_events', 'staff_notifications', 'preceptor_assignment_requests');

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

-- A2b. Intended RPC grants. Expect PUBLIC=false, anon=false, service_role=true for every row;
--      authenticated=true only for mark_staff_notifications_read and false for all other rows.
WITH expected(fn, signature, authenticated_should) AS (VALUES
  ('assign_primary_preceptor',          'public.assign_primary_preceptor(uuid,uuid,uuid,text,boolean,boolean,text)', false),
  ('set_secondary_coverage_preceptor',  'public.set_secondary_coverage_preceptor(uuid,uuid,text,text,uuid,uuid,text,text,boolean,boolean,text)', false),
  ('create_unit_preceptor',             'public.create_unit_preceptor(uuid,text,text,text,text,text,text)', false),
  ('claim_due_staff_notifications',     'public.claim_due_staff_notifications(text,integer,integer)', false),
  ('mark_staff_notifications_read',     'public.mark_staff_notifications_read(uuid[])', true)
)
SELECT e.fn,
  EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) AS public_can,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can,
  e.authenticated_should,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can
FROM expected e
JOIN pg_proc p ON p.oid = to_regprocedure(e.signature)
ORDER BY e.fn;

-- A2c. Internal functions are never client-callable. Expect five rows with public_can=false,
--      anon_can=false, and authenticated_can=false.
WITH internal(signature) AS (VALUES
  ('public.guard_students_preceptor_id_change()'),
  ('public._preceptor_assert_actor_for_student(uuid,uuid,text,boolean,boolean)'),
  ('public._preceptor_begin_request(text,uuid,text,text)'),
  ('public._preceptor_finish_request(text,jsonb)'),
  ('public._emit_staff_notifications(text,text,uuid,text,text,uuid,uuid,text,text,text,text,text,boolean,text)')
)
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) AS public_can,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can
FROM internal i
JOIN pg_proc p ON p.oid = to_regprocedure(i.signature)
ORDER BY p.proname;

-- A3. New tables: RLS enabled; preceptor_assignment_events has one owner/admin SELECT policy;
--     staff_notifications has one SELECT policy (own-or-admin) and NO client write policy.
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('preceptor_assignment_events', 'staff_notifications', 'preceptor_assignment_requests')
ORDER BY tablename, cmd;
SELECT c.relname, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('preceptor_assignment_events', 'staff_notifications', 'preceptor_assignment_requests');

-- A3b. Exact table-level privileges. Expect for each of the three tables:
--      PUBLIC SELECT/INSERT/UPDATE/DELETE=false; anon SELECT/INSERT/UPDATE/DELETE=false;
--      authenticated SELECT=true and INSERT/UPDATE/DELETE=false;
--      service_role SELECT/INSERT/UPDATE/DELETE=true.
WITH target AS (
  SELECT c.oid, c.relname, c.relacl, c.relowner
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('preceptor_assignment_events', 'staff_notifications', 'preceptor_assignment_requests')
)
SELECT t.relname,
  EXISTS (SELECT 1 FROM aclexplode(COALESCE(t.relacl, acldefault('r', t.relowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'SELECT') AS public_select,
  EXISTS (SELECT 1 FROM aclexplode(COALESCE(t.relacl, acldefault('r', t.relowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'INSERT') AS public_insert,
  EXISTS (SELECT 1 FROM aclexplode(COALESCE(t.relacl, acldefault('r', t.relowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'UPDATE') AS public_update,
  EXISTS (SELECT 1 FROM aclexplode(COALESCE(t.relacl, acldefault('r', t.relowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'DELETE') AS public_delete,
  has_table_privilege('anon', t.oid, 'SELECT') AS anon_select,
  has_table_privilege('anon', t.oid, 'INSERT') AS anon_insert,
  has_table_privilege('anon', t.oid, 'UPDATE') AS anon_update,
  has_table_privilege('anon', t.oid, 'DELETE') AS anon_delete,
  has_table_privilege('authenticated', t.oid, 'SELECT') AS authenticated_select,
  has_table_privilege('authenticated', t.oid, 'INSERT') AS authenticated_insert,
  has_table_privilege('authenticated', t.oid, 'UPDATE') AS authenticated_update,
  has_table_privilege('authenticated', t.oid, 'DELETE') AS authenticated_delete,
  has_table_privilege('service_role', t.oid, 'SELECT') AS service_role_select,
  has_table_privilege('service_role', t.oid, 'INSERT') AS service_role_insert,
  has_table_privilege('service_role', t.oid, 'UPDATE') AS service_role_update,
  has_table_privilege('service_role', t.oid, 'DELETE') AS service_role_delete
FROM target t
ORDER BY t.relname;

-- A3c. Policies remain SELECT-only. Expect non_select_policy_count=0.
SELECT count(*) FILTER (WHERE cmd <> 'SELECT') AS non_select_policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('preceptor_assignment_events', 'staff_notifications', 'preceptor_assignment_requests');

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

-- A8. Preceptor email uniqueness (the guarantee create_unit_preceptor's dedup relies on). Expect
--     ONE row: a UNIQUE, PARTIAL index on a normalized email expression (lower(trim(email))),
--     matching the RPC's lower(btrim(email)). If this returns ZERO rows, STOP and run
--     db/audit/preceptor_email_uniqueness_preflight.sql before enabling Unit Leader preceptor
--     creation (concurrent duplicate creation would otherwise be possible).
SELECT i.relname AS index_name,
       ix.indisunique AS is_unique,
       (ix.indpred IS NOT NULL) AS is_partial,
       pg_get_indexdef(ix.indexrelid) AS definition
FROM pg_index ix
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' AND t.relname = 'preceptors'
  AND ix.indisunique
  AND pg_get_indexdef(ix.indexrelid) ILIKE '%lower(%trim%(email%';
-- Expect: preceptors_email_lower_unique_idx | t | t | ...lower(trim(email))...WHERE...

-- A9. Idempotency ledger present: RLS enabled, ONE owner/admin SELECT policy, NO client write
--     policy; and the two internal helpers exist but are NOT executable by anon/authenticated.
SELECT has_table_privilege('authenticated', 'public.preceptor_assignment_requests', 'INSERT') AS authenticated_insert; -- expect false
SELECT p.proname, p.prosecdef AS security_definer,
  has_function_privilege('authenticated', 'public._preceptor_begin_request(text,uuid,text,text)', 'EXECUTE') AS begin_authenticated_can,
  has_function_privilege('authenticated', 'public._preceptor_finish_request(text,jsonb)', 'EXECUTE')          AS finish_authenticated_can
FROM pg_proc p WHERE p.proname IN ('_preceptor_begin_request', '_preceptor_finish_request')
ORDER BY p.proname;
-- Expect: authenticated_insert=false; both helpers prosecdef=true; begin/finish authenticated_can=false.

-- A10. Fingerprint coverage in the deployed write RPC definitions. Expect common_keys=true and
--      delimiter_fingerprint_absent=true on all three rows; assignment_keys=true for the two
--      assignment RPCs; creation_keys=true for create_unit_preceptor. Non-applicable columns are NULL.
SELECT p.proname,
  (position('jsonb_build_object' IN p.prosrc) > 0
   AND position('actor_profile_id' IN p.prosrc) > 0
   AND position('''rpc''' IN p.prosrc) > 0
   AND position('''action''' IN p.prosrc) > 0) AS common_keys,
  CASE WHEN p.proname IN ('assign_primary_preceptor', 'set_secondary_coverage_preceptor') THEN
    position('student_id' IN p.prosrc) > 0
    AND position('assignment_id' IN p.prosrc) > 0
    AND position('preceptor_id' IN p.prosrc) > 0
    AND position('''role''' IN p.prosrc) > 0
    AND position('''reason''' IN p.prosrc) > 0
    AND position('''notes''' IN p.prosrc) > 0
    AND position('''force''' IN p.prosrc) > 0
    AND position('confirm_override' IN p.prosrc) > 0
  END AS assignment_keys,
  CASE WHEN p.proname = 'create_unit_preceptor' THEN
    position('full_name' IN p.prosrc) > 0
    AND position('''email''' IN p.prosrc) > 0
    AND position('unit_key' IN p.prosrc) > 0
    AND position('''shift''' IN p.prosrc) > 0
    AND position('''phone''' IN p.prosrc) > 0
  END AS creation_keys,
  (position('concat_ws(' IN p.prosrc) = 0) AS delimiter_fingerprint_absent
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('assign_primary_preceptor', 'set_secondary_coverage_preceptor', 'create_unit_preceptor')
ORDER BY p.proname;

-- A6. Guard smoke test (REAL; scratch transaction; ROLLBACK). Picks a student and a DIFFERENT
--     active preceptor than the student's current primary, then attempts an UNAUTHORIZED direct
--     client UPDATE as role authenticated (auth.uid() is NULL, so is_active_owner_or_admin() is
--     false and no per-row marker is set). Because the target preceptor DIFFERS from the current
--     one, the guard's change-detection fires and MUST raise MS403. Uses a genuinely different
--     preceptor id (not the no-op self-assignment). ROLL BACK regardless.
-- BEGIN;
--   SET LOCAL ROLE authenticated;
--   WITH tgt AS (
--     SELECT s.id AS student_id,
--            (SELECT p.id FROM public.preceptors p
--               WHERE p.is_active IS TRUE AND p.id IS DISTINCT FROM s.preceptor_id
--               ORDER BY p.id LIMIT 1) AS other_preceptor
--     FROM public.students s
--     WHERE EXISTS (SELECT 1 FROM public.preceptors p2
--                   WHERE p2.is_active IS TRUE AND p2.id IS DISTINCT FROM s.preceptor_id)
--     ORDER BY s.id LIMIT 1
--   )
--   UPDATE public.students s SET preceptor_id = t.other_preceptor
--   FROM tgt t WHERE s.id = t.student_id;
--   -- EXPECT: ERROR 'preceptor_id may only be changed ...' USING ERRCODE = 'MS403'
-- ROLLBACK;
-- Fixture note: if the dataset has no active preceptor distinct from a chosen student's current
-- primary, substitute a known student id and any active preceptor id that is not currently their
-- primary; the assertion (MS403) is unchanged.


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
--   DROP FUNCTION IF EXISTS public._preceptor_begin_request(text, uuid, text, text);
--   DROP FUNCTION IF EXISTS public._preceptor_finish_request(text, jsonb);
--   DROP FUNCTION IF EXISTS public._emit_staff_notifications(text, text, uuid, text, text, uuid, uuid, text, text, text, text, text, boolean, text);
--   DROP FUNCTION IF EXISTS public.claim_due_staff_notifications(text, integer, integer);
--   DROP FUNCTION IF EXISTS public.mark_staff_notifications_read(uuid[]);
--   DROP TABLE IF EXISTS public.staff_notifications;
--   DROP TABLE IF EXISTS public.preceptor_assignment_requests;
--   DROP TABLE IF EXISTS public.preceptor_assignment_events;
--   ALTER TABLE public.preceptors DROP COLUMN IF EXISTS created_by_role;
--   ALTER TABLE public.preceptors DROP COLUMN IF EXISTS created_by;
-- COMMIT;
-- NOTE: dropping the guard REOPENS the broad students UPDATE RLS path. Also stop the
-- staff-notification-worker cron before rollback so it does not query a dropped table.
```

## Appendix E: Preceptor email-uniqueness preflight (db/audit/preceptor_email_uniqueness_preflight.sql)

```sql
-- ============================================================================
-- PRECEPTOR EMAIL UNIQUENESS PREFLIGHT (READ-ONLY)
-- ============================================================================
-- Companion to Phase 2C (20260723000000_preceptor_assignment_authorization.sql). The Unit Leader
-- create-preceptor RPC (create_unit_preceptor) dedups on a NORMALIZED email lower(btrim(email))
-- and relies on a DB unique index to make concurrent duplicate creation impossible. This script
-- verifies that guarantee exists and is currently clean. It is 100% read-only. Run as the service
-- role or an owner/admin.
--
-- EXPECTED (per the repository): a partial, normalized unique index
--   preceptors_email_lower_unique_idx ON public.preceptors (lower(trim(email)))
--   WHERE email IS NOT NULL AND trim(email) <> ''
-- created by the root-level migration_preceptor_schema_v2.sql. That index is NOT re-created inside
-- supabase/migrations/, so this preflight is the way to confirm it is actually live in the target
-- database before enabling Unit Leader preceptor creation.
--
-- NORMALIZATION PARITY: the RPC uses lower(btrim(email)); btrim() is exactly trim(), so the RPC's
-- normalization is identical to the index expression lower(trim(email)). Query Q4 below proves the
-- two agree on the live data (zero divergent rows).
-- ============================================================================


-- Q1. Every index on public.preceptors, with its full definition. Confirm one of them is a UNIQUE
--     index on a normalized email expression. Expect a row named preceptors_email_lower_unique_idx
--     whose indexdef contains "UNIQUE", "lower(trim(email))" (or "lower(btrim(email))"), and the
--     partial WHERE clause.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'preceptors'
ORDER BY indexname;

-- Q2. Machine-checkable existence + shape of the normalized-email uniqueness guarantee. Expect
--     ONE row with is_unique = true, is_partial = true, and normalized_expr = true.
SELECT
  i.relname                                             AS index_name,
  ix.indisunique                                        AS is_unique,
  (ix.indpred IS NOT NULL)                              AS is_partial,
  (pg_get_indexdef(ix.indexrelid) ILIKE '%lower(%trim%(email%')  AS normalized_expr,
  pg_get_indexdef(ix.indexrelid)                        AS definition
FROM pg_index ix
JOIN pg_class i  ON i.oid = ix.indexrelid
JOIN pg_class t  ON t.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' AND t.relname = 'preceptors'
  AND ix.indisunique
  AND pg_get_indexdef(ix.indexrelid) ILIKE '%lower(%trim%(email%';
-- Zero rows here means the normalized-email uniqueness guarantee is ABSENT in this database
-- (see the "if absent" note at the end).

-- Q3. Duplicate normalized-email groups. MUST RETURN ZERO ROWS. Any row is a pre-existing
--     duplicate that both violates the intended guarantee and would have to be resolved before
--     the unique index could be (re)created. Uses the RPC's exact normalization.
SELECT lower(btrim(email)) AS normalized_email,
       count(*)            AS rows,
       array_agg(id ORDER BY created_at) AS preceptor_ids,
       array_agg(full_name ORDER BY created_at) AS names
FROM public.preceptors
WHERE email IS NOT NULL AND btrim(email) <> ''
GROUP BY lower(btrim(email))
HAVING count(*) > 1
ORDER BY rows DESC, normalized_email;

-- Q4. Normalization parity on live data: rows whose stored email is not already in normalized
--     form (i.e. lower(btrim(email)) <> email). Informational only; the index and the RPC both
--     normalize, so these still dedup correctly. A non-zero count just means some legacy rows were
--     stored un-normalized (mixed case / surrounding whitespace).
SELECT count(*) AS non_normalized_rows
FROM public.preceptors
WHERE email IS NOT NULL AND btrim(email) <> '' AND lower(btrim(email)) IS DISTINCT FROM email;

-- Q5. Blank / null email rows. Informational: the partial index intentionally excludes these, so
--     multiple blank-email preceptors are allowed and are NOT duplicates for this guarantee.
SELECT
  count(*) FILTER (WHERE email IS NULL)                          AS null_email_rows,
  count(*) FILTER (WHERE email IS NOT NULL AND btrim(email) = '') AS empty_email_rows
FROM public.preceptors;

-- Q6. Conflicts that would block ADDING the guarantee if it were absent. This is Q3 rolled into a
--     single number for a fast go/no-go read. Expect 0.
SELECT COALESCE(sum(rows) - count(*), 0) AS excess_duplicate_rows
FROM (
  SELECT count(*) AS rows
  FROM public.preceptors
  WHERE email IS NOT NULL AND btrim(email) <> ''
  GROUP BY lower(btrim(email))
  HAVING count(*) > 1
) d;


-- ############################################################################
-- INTERPRETATION
-- ############################################################################
-- PASS (guarantee present and clean): Q2 returns one row; Q3 returns zero rows; Q6 = 0. In this
--   case NO migration is required. Concurrent duplicate creation is already impossible: a second
--   INSERT with the same normalized email hits preceptors_email_lower_unique_idx and raises
--   unique_violation, which create_unit_preceptor maps to MS409. Record the Q1 index definition in
--   the Phase 2C after-verification (block A8 of
--   db/audit/preceptor_assignment_authorization_preflight_and_verification.sql).
--
-- IF ABSENT (Q2 returns zero rows): do NOT auto-merge duplicates. First resolve every Q3 group by
--   a data decision (pick the canonical preceptor per normalized email; repoint
--   student_preceptor_assignments.preceptor_id, students.preceptor_id, matches.preceptor_id, and
--   any evaluation routing to the survivor; soft-deactivate the losers). THEN create the index in
--   a gated migration:
--     CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS preceptors_email_lower_unique_idx
--       ON public.preceptors (lower(trim(email)))
--       WHERE email IS NOT NULL AND trim(email) <> '';
--   (CONCURRENTLY cannot run inside a transaction block; run it as a standalone statement in a
--   maintenance window, after Q3/Q6 are zero.) The expression MUST be lower(trim(email)) to match
--   the create_unit_preceptor RPC's lower(btrim(email)). This script authors NO change because the
--   repository indicates the index already exists; it is provided only for the absent case.
-- ============================================================================
```

_End of Final Owner SQL Review Package._
