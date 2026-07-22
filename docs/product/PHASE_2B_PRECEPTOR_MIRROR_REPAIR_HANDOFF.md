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
   preceptor_id, cohort_id ON students`. From this point, whenever any writer changes a
   student's `preceptor_id` or `cohort_id`, the function runs and, inside the same
   transaction, writes:
   - on a **cohort change**: ends every active assignment tied to the OLD cohort (soft-end,
     never delete), then rebuilds the current-cohort mirror below;
   - on a **new/changed primary**: ends the stale active-primary row for the current cohort;
     ends the new preceptor's active secondary/coverage row for that cohort if one exists
     (the only case a secondary/coverage row is ever touched, required so the primary insert
     does not violate the ppm3 relationship index); inserts one active-primary row if none
     exists; aligns `students.matched_preceptor`/`preceptor_email` from the preceptor record;
     aligns the current-cohort `matches.preceptor_id`;
   - on a **cleared primary** (`preceptor_id` set to NULL): ends the active-primary row for
     the current cohort; clears the two display fields; nulls the current-cohort match FK.
   Every branch is guarded (`IS DISTINCT FROM`, `NOT EXISTS`) so re-running the same change is
   a no-op.
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
  `preceptor_id`/`cohort_id` changes committed after apply; those are legitimate and correct.
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
branch behavior; cohort-change ends old-cohort active rows; no permission widening (REVOKE from
PUBLIC, no CREATE POLICY, no anon/authenticated/portal grant); verification file covers the
equivalence gate and the definer/search_path/execute checks; no em dash.

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

## Notes for the reviewer (judgment calls to confirm)

- **Cohort-change handling is included** (`AFTER UPDATE OF preceptor_id, cohort_id`) because the
  task asks the mechanism to handle future cohort changes and, without it, a future re-cohort
  would recreate exactly the drift Phase 2A found. It is inert on current data (zero cohort-stale
  rows). Consequence to confirm: a change to `students.cohort_id` now ends that student's
  old-cohort active assignments (history preserved). If a `cohort_id` value ever needs correcting
  WITHOUT ending assignments (a data fix, not a real re-cohort), do it with the trigger disabled.
  If you prefer to defer cohort handling to Phase 2C, drop the `cohort_id` column from the
  trigger's `UPDATE OF` list and the `v_cohort_changed` branch; the preceptor_id repair and
  prevention stand alone.
- **SECURITY DEFINER is required** so the mirror is maintained when a staff user changes
  `preceptor_id` from the client (that user has no direct write policy on
  `student_preceptor_assignments`). It does not widen who may change `preceptor_id`.
- **Pre-existing observation (out of scope):** the `students` write policy is `is_staff()`,
  which today includes interviewer/viewer, so the staff assignment path is reachable more broadly
  than owner/admin. This migration neither widens nor narrows that; flagging it for a separate
  authorization review before Unit Leader primary writes ship.

## Stop point

Handoff delivered. Nothing applied or deployed. Next action for the owner: review, then follow
the application order above under the Owner SQL gate.
