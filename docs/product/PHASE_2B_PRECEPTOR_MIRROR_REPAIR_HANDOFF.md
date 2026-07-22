# Phase 2B: preceptor mirror repair and prevention (handoff)

SQL-authoring and review pass. Nothing was run, applied, merged, or deployed. This is the
proposed migration plus everything needed to review and apply it.

Deliverables:
- Migration (proposed): `supabase/migrations/20260722000000_preceptor_mirror_repair_and_sync.sql`
- Preflight + verification + rollback: `db/audit/preceptor_mirror_repair_preflight_and_verification.sql`
- Static guards (passing): `test/preceptorMirrorRepairMigration.test.mjs`

Accepted Phase 2A production findings (source of truth): the only defects are denormalized
mirror drift, `6a_freetext_disagrees = 4` and `7a_match_preceptor_disagrees = 4`; every other
category is 0. The canonical `students.preceptor_id` and the active-primary
`student_preceptor_assignments` rows are already correct, and there is no re-cohort ambiguity.

---

## 1. The proposed migration

See the file above. It is one transaction with two parts: a one-time data repair of the
4 + 4 mirror defects, and a prevention trigger that keeps the mirror in step on any future
canonical change. The repair writes NO `student_preceptor_assignments` rows because the
normalized model is already correct.

## 2. Preflight / verification / rollback SQL

See the audit file above. Run the BEFORE block (read-only) to confirm the accepted counts,
apply the migration, then run the AFTER block (read-only). The ROLLBACK block is a commented
WRITE script.

## 3. Plain-language explanation of every write

The migration performs exactly these writes, in order:

1. **Create `public.preceptor_mirror_repair_audit`** (idempotent `IF NOT EXISTS`). A small
   internal table that stores the prior value of every row the repair is about to change,
   tagged with the batch id `phase2b-preceptor-mirror`, so the one-time repair is exactly
   reversible. RLS is enabled with no policy, so only the service role can read it.
2. **Insert the pre-repair snapshot** into that audit table: for each student whose
   `matched_preceptor`/`preceptor_email` will change, the old value of each field; for each
   current-cohort match row whose `preceptor_id` will change, the old value. This is a read
   of current state written into the audit table; it changes no business data.
3. **Repair the students display mirror.** `UPDATE students SET matched_preceptor =
   preceptors.full_name, preceptor_email = preceptors.email` for students whose
   `preceptor_id` is set and whose free-text differs from the canonical preceptor record.
   Data-driven (joins `preceptors` on the FK; no student ids are hardcoded). In production
   this affects the 4 students with blank display fields.
4. **Repair the current-cohort match mirror.** `UPDATE matches SET preceptor_id =
   students.preceptor_id` where the match is the student's current-cohort row and its
   `preceptor_id` differs. In production this affects the 4 null match FKs. Historical match
   rows in other cohorts are not touched. **`matches.preceptor_assigned` is deliberately NOT
   written**: it is a free-text field the assignment writer never maintains
   (`PreceptorAssignmentModal` writes `matches.preceptor_id` only), and the architecture doc
   lists it as a fallback that must not be cleared, so aligning it is not canonical behavior.
5. **Create the function `public.sync_primary_preceptor_mirror()`** (SECURITY DEFINER, fixed
   `search_path = public, pg_temp`). It does no work at creation time; it defines what
   happens on a future canonical change.
6. **Create the trigger `trg_sync_primary_preceptor_mirror`** `AFTER INSERT OR UPDATE OF
   preceptor_id ON students` (preceptor_id ONLY; `cohort_id` is not a trigger event). From
   this point, whenever any writer changes a student's `preceptor_id`, the function runs and,
   inside the same transaction, writes:
   - on a **new/changed primary**: ends the stale active-primary row for the student's cohort;
     ends the new preceptor's active secondary/coverage row for that cohort if one exists
     (the only case a secondary/coverage row is ever touched, required so the primary insert
     does not violate the ppm3 relationship index); inserts one active-primary row if none
     exists; aligns `students.matched_preceptor`/`preceptor_email` from the preceptor record;
     aligns the current-cohort `matches.preceptor_id`;
   - on a **cleared primary** (`preceptor_id` set to NULL): ends the active-primary row for
     the student's cohort; clears the two display fields; nulls the current-cohort match FK.
   Every branch is guarded (`IS DISTINCT FROM`, `NOT EXISTS`) so re-running the same change is
   a no-op. The student's cohort is fixed (students are never re-cohorted), so every write is
   scoped to that one cohort and the function contains no cohort-change logic.
7. **`REVOKE ALL ON FUNCTION ... FROM PUBLIC`.** The function is only ever invoked by the
   trigger; no caller executes it directly.

No other table is written. No RLS policy is created or changed. No grant is issued.

## 4. Rollback plan

- The migration is one transaction; a failed pre-COMMIT check is a plain `ROLLBACK`, zero
  effect.
- After COMMIT, the ROLLBACK block in the audit file reverts the one-time repair exactly,
  reading the prior values from `preceptor_mirror_repair_audit` (batch
  `phase2b-preceptor-mirror`): it restores `students.matched_preceptor`,
  `students.preceptor_email`, and the current-cohort `matches.preceptor_id` (NULL preserved),
  then drops the trigger and the function.
- The rollback intentionally does NOT undo mirror updates the trigger made for **real**
  `preceptor_id` changes committed after apply; those are legitimate and correct.
  Only the one-time repair rows and the prevention mechanism are reverted.
- The audit table may be retained as a record or dropped (a commented `DROP TABLE` line is
  included).

## 5. Compatibility analysis

- **Staff `PreceptorAssignmentModal` (writer #1).** Today it sets
  `students.preceptor_id` + `matched_preceptor` + `preceptor_email` in one update, then
  `matches.preceptor_id`, but never writes `student_preceptor_assignments`. With the trigger,
  that first update fires the sync, which inserts/repoints the active-primary SPA row (the
  behavior the modal was missing) and re-affirms the display and match mirrors it already set
  (idempotent no-ops). **No modal change is required, and the modal becomes correct.** The
  modal's own `matches.preceptor_id` update remains harmless.
- **Secondary/Coverage endpoint (`api/preceptor-assignments.js`).** It writes only
  secondary/coverage rows and never touches `students.preceptor_id`, so the trigger does not
  fire for it. The one interaction is intended: if a preceptor already holds an active
  secondary/coverage row and is later made that student's Primary, the trigger ends that
  secondary/coverage row (the same-preceptor conflict the ppm3 index requires). All other
  secondary/coverage rows are untouched.
- **Future Unit Leader transactional assignment RPC.** The trigger is writer-agnostic: the RPC
  should set `students.preceptor_id` (the canonical identity) and let the trigger maintain the
  SPA/display/match mirrors, rather than writing the active-primary SPA row itself. If the RPC
  updates `students.preceptor_id` LAST in its transaction, the trigger runs once with the
  final value and the RPC needs no mirror logic of its own. If the RPC also inserts the
  primary SPA row, it must do so BEFORE setting `preceptor_id` (the trigger's `NOT EXISTS`
  guard then no-ops); inserting after would hit the unique index. Recommended contract:
  **the RPC owns `students.preceptor_id`; the trigger owns the mirror.** This keeps a single
  place responsible for the normalized model for both the staff and Unit Leader paths.

## 6. Tests / static guards added

`test/preceptorMirrorRepairMigration.test.mjs` (14 guards, passing): gated + transactional;
repair is data-driven (no hardcoded UUIDs); repair aligns exactly the two mirror classes from
canonical; `matches.preceptor_assigned` never written; repair writes no SPA rows; audit table
with the batch sentinel and RLS enabled; function is SECURITY DEFINER with fixed search_path;
trigger fires only on `preceptor_id`/`cohort_id`; idempotent + history-preserving (no DELETE,
insert-only-when-missing, same-preceptor is the only secondary/coverage touch); cleared-primary
branch behavior; NO cohort-change logic (no `v_cohort_changed`, no `OLD.cohort_id`, trigger is
preceptor_id-only) while every write stays scoped to the fixed cohort; no permission widening
(REVOKE from PUBLIC, no CREATE POLICY, no anon/authenticated/portal grant); verification file
covers the equivalence gate and the definer/search_path/execute checks; no em dash.

## 7. Exact manual application order

1. Run the **BEFORE** block of `db/audit/preceptor_mirror_repair_preflight_and_verification.sql`
   as the service role. Confirm B1 shows `6a=4, 7a=4` and `1/2 = 0`; B3 (equivalence gate)
   returns 0 rows; B4 shows the trigger does not yet exist. Record the B2 SPA (role, status)
   counts.
2. Apply `supabase/migrations/20260722000000_preceptor_mirror_repair_and_sync.sql` in the
   Supabase SQL editor, as a single transaction, once. (It is `BEGIN … COMMIT`.)
3. Run the **AFTER** block. Confirm: A1 all four categories = 0; A2 SPA (role, status) counts
   equal B2 (the repair wrote no assignment rows); A4 equivalence gate returns 0; A6 shows the
   trigger present, `security_definer = true`, `search_path` set, and `public_can_execute =
   false`; A7 shows no new policy.
4. Optional live guard check: in a scratch transaction, update one student's `preceptor_id` and
   confirm the SPA active-primary row, display fields, and current-cohort match FK follow, then
   `ROLLBACK`.

## Revision: locked cohort model (all cohort-change logic removed)

Per the locked product decisions (a student is permanently tied to one cohort, is never
re-cohorted, and graduates after completing it; preceptors are not cohort-bound), this revised
migration:

- fires the trigger on `AFTER INSERT OR UPDATE OF preceptor_id` only (`cohort_id` removed from
  the event list);
- removed the `v_cohort_changed` flag, the cohort-change branch, and every reference to
  `OLD.cohort_id`;
- adds no logic that ends or recreates assignments because `students.cohort_id` changed;
- keeps existing historical assignment rows untouched;
- continues to scope every assignment write to the student's fixed cohort (`NEW.cohort_id`).

A static guard (`NO cohort-change logic exists ...`) asserts `v_cohort_changed` and
`OLD.cohort_id` are absent and that the trigger event is preceptor_id-only, so the removal cannot
silently regress.

## Authorization findings and recommended Phase 2C sequence

**Q1. Which roles can update `students.preceptor_id` today?**
Only one path writes it: the client Supabase mutation in `PreceptorAssignmentModal.jsx`
(`handleConfirm` / `handleAddSaved`), gated by the RLS policy `staff_all_students`
(`FOR ALL TO authenticated USING (is_staff())`). `is_staff()` is true for
`owner, admin, co_lead, interviewer, viewer`. The server action
`api/student-update.js: update_preceptor_assignment` is Owner/Admin only but explicitly does
NOT write `preceptor_id` (free-text fields only). So the RLS boundary that governs `preceptor_id`
writes is **owner, admin, co_lead, interviewer, viewer**.

**Q2. Can interviewer/viewer do it in practice, or only theoretically?**
In the UI, no: the assign-preceptor modal is gated by `canEdit`, and `canEdit = ['owner','admin']`
(`src/contexts/AuthContext.jsx:167`), so interviewer/viewer/co_lead never see the control.
But the true security boundary is RLS, not the UI, and RLS is broader: any `is_staff()` user holds
a valid `authenticated` JWT and could issue a direct `students.update({preceptor_id})` outside the
UI, which the policy would allow. So it is **theoretically reachable by interviewer/viewer/co_lead
today**, blocked only by the client UI, not by the database. This gap is the reason authorization
must be tightened before Unit Leaders (or anyone) get a new primary-write path.

**Q3. Smallest safe way to ensure only Owner/Admin use the existing staff write path?**
RLS cannot express "only owner/admin may change this one column": policies are row-level, not
column-level, and every app user shares the single DB role `authenticated`, so DB-level column
GRANTs cannot distinguish owner from interviewer either. The smallest safe enforcement is a
**`BEFORE UPDATE OF preceptor_id` guard trigger on `students`** that raises unless the acting
user is owner/admin, resolved from `user_profiles` via `auth.uid()` (mirroring `is_staff()` but
narrowed to `role IN ('owner','admin')`), with a controlled exception for the scoped Unit Leader
RPC below (e.g. the RPC sets a transaction-local GUC the guard recognizes, or the guard allows the
change when the row is being written by the definer RPC). This is an authorization change and is
deliberately **NOT** in the Phase 2B migration.

**Q4. How should the future Unit Leader path be exposed?**
Only through a `SECURITY DEFINER` transactional RPC, never direct table write. Proposed:
`unit_leader_set_primary_preceptor(p_student_id uuid, p_preceptor_id uuid)` that (a) verifies the
caller is a portal user with an ACTIVE `unit_leader` role grant AND an ACTIVE `user_unit_scopes`
row covering the student's matched unit (fail closed), (b) updates `students.preceptor_id` (which
fires the Phase 2B sync trigger to maintain all mirrors), (c) writes an audit row and queues an
Owner/Admin notification, all in one transaction. Unit Leaders receive `EXECUTE` on the RPC only;
they never gain a write policy on `students`, `matches`, or `student_preceptor_assignments`. This
mirrors the existing UL transactional RPC pattern (`unit_placement_respond`, `unit_capacity_submit`).

**Q5. Owner/Admin notification and audit when a Unit Leader changes Primary?**
In the same RPC transaction, insert an audit row (a dedicated `preceptor_change_log`, or reuse the
`activity_logs` + `unitLeaderAudit.js` pattern) capturing `student_id`, `old_preceptor_id`,
`new_preceptor_id`, `changed_by_profile_id`, acting role, `unit_key`, and timestamp. After the
authoritative write, best-effort notify Owner/Admin through the existing staff notification path
(so a notification failure never rolls back the change). The Phase 2B trigger is compatible: it
runs inside the RPC's transaction when the RPC sets `preceptor_id`.

**Why authorization is NOT changed in Phase 2B.** The sync trigger's safety does not depend on
WHO changes `preceptor_id`: it only mirrors an already-committed canonical change into the
service-managed tables, idempotently and history-preservingly. Tightening WHO may change
`preceptor_id` (Q3) and adding the scoped UL RPC (Q4/Q5) are orthogonal authorization work with
their own review, tests, and rollback. Bundling them into the data-repair migration would enlarge
its blast radius and couple a hot staff path change to a data fix. Recommended split:

- **Phase 2B (this handoff):** repair the four mirror defects + install the writer-agnostic sync
  trigger. No authorization change.
- **Phase 2C (separate migration + app change):** (1) the `BEFORE UPDATE OF preceptor_id` guard
  restricting the direct path to owner/admin; (2) point `PreceptorAssignmentModal` at an owner/admin
  RPC (or keep the direct path but behind the guard); (3) the scoped
  `unit_leader_set_primary_preceptor` RPC + audit + Owner/Admin notification; (4) the Unit Leader UI
  that calls it. Sequence 2C AFTER 2B so the mirror trigger already exists when the new write paths
  land.

**SECURITY DEFINER note.** The Phase 2B trigger function is `SECURITY DEFINER` because a client
staff change to `preceptor_id` runs as the `authenticated` role, which has no write policy on
`student_preceptor_assignments`; the definer (owned by the migration runner) performs the mirror
write. This does not widen who may change `preceptor_id` (still the unchanged `is_staff()` students
policy); it only keeps the mirror consistent for changes that are already allowed. Until Phase 2C
narrows that policy, the trigger faithfully mirrors whatever the current policy permits, neither
improving nor worsening the authorization posture.

## Stop point

Handoff delivered. Nothing applied or deployed. Next action for the owner: review, then follow
the application order above under the Owner SQL gate.
