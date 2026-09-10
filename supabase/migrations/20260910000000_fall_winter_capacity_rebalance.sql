-- ############################################################################
-- CAPACITY-REBALANCE-1: Fall 2026 keeps only the slots it used, and every unused
-- Fall slot becomes that unit's Winter 2027 offer. This REPLACES the
-- 2026-08-29 carry-over (20260901000000), which was taken when Fall had only 9
-- students placed; Fall reached 19 afterwards, so Winter was offering slots
-- that Fall has since used (NICU and Pediatrics among them).
--
-- Owner-gated. NOT auto-applied. Data only, plus one private backup table.
--
-- DECISIONS (Owner, 2026-09-10)
--   * Fall 2026 placement is final: 19 placed, 2 Not Proceeding (no slot needed).
--   * Each Fall unit keeps exactly the slots it used. Units that hosted nobody
--     leave Fall. Target: 19 slots, 19 filled, 21 student requests.
--   * Winter 2027's offer is exactly Fall's unused slots, unit by unit.
--
-- HOW A UNIT LEAVES A COHORT
--   Exactly as Set Up Units does it (UnitSetupPanel): is_participating = false,
--   never a DELETE of the units row. Every picker (intake form, Student Portal,
--   side panel, assignments) and the Placement Board read participating units
--   only, so the unit disappears, while every link into the row stays intact:
--   preceptors.unit_id, one past (inactive) PACU student_unit_assignment, and
--   matches (ON DELETE CASCADE, which a DELETE would have fired).
--   Its unit_cohort_responses row IS deleted, because Placement Capacity lists
--   every response row; its outreach targets are DEACTIVATED (the table's own
--   remove semantics, logged by the curt_log_transition trigger), because an
--   active target with no response shows as Pending.
--   Every row changed or deleted is copied first to
--   ops_backup.capacity_rebalance_20260910 (a schema the API does not expose).
--
-- THE PINNED SHAPE (Owner discovery D0, 2026-09-10)
--   Fall 2026: 20 hosting units, 33 slots, 19 placed.
--     leave Fall (hosted nobody): 3 SCCT 1, 4 South 1, 5 North 1, 7 South 3,
--                                 8 North 2, PACU 2               = 10 slots
--     shrink to what was used:    5 South, 7 North, 8 South, PICU (2 -> 1)
--     full, unchanged:            3 South Short Stay, 5 SCCT, 6 NE, 6 NW,
--                                 6 South, 7 SCCT, 8 SCCT, ACU/CDU, NICU,
--                                 Pediatrics
--     after: 14 hosting units, 19 slots, 19 filled.
--   Winter 2027: 18 units, 24 slots, untouched since the 08-29 clone.
--     leave Winter (Fall used them): 3 South Short Stay 1, 5 SCCT 1, 6 NE 2,
--                                    6 NW 1, 7 SCCT 1, 8 SCCT 1, NICU 1,
--                                    Pediatrics 1
--     PICU 2 -> 1
--     after: 10 units, 14 slots = Fall's unused 14.
--   One Winter student (7042c151) picked 5 SCCT (#1) and 6 NE (#2), which leave
--   Winter; their #3, PACU, stays. Student picks are NOT touched.
--
-- SAFETY
--   * Both cohorts' units, students, responses and Fall targets are locked
--     FOR UPDATE before any check, so no placement can move mid-run.
--   * Every unit is pinned by id with its name, slots and placements; any
--     deviation aborts. Winter's new offers are COMPUTED from Fall in-lock and
--     must equal the pinned plan.
--   * Aborts if anything references unit_cohort_responses (a delete would cascade).
--   * Refuses a second run (the backup table must be empty).
--   * Postconditions prove the final shape before COMMIT; any failure rolls back.
-- ############################################################################

BEGIN;

CREATE SCHEMA IF NOT EXISTS ops_backup;
REVOKE ALL ON SCHEMA ops_backup FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS ops_backup.capacity_rebalance_20260910 (
  id           bigserial   PRIMARY KEY,
  source_table text        NOT NULL,
  action       text        NOT NULL CHECK (action IN ('update', 'delete')),
  row_data     jsonb       NOT NULL,
  taken_at     timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ops_backup.capacity_rebalance_20260910 FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  c_fall   uuid := 'eedd91ec-ad6f-4df8-aa20-5c06b2889011';  -- Fall 2026, Active
  c_winter uuid := '52933615-cf6e-441f-ac68-130bdb6a0491';  -- Winter 2027, Planning

  -- Every hosting Fall unit as discovered: slots offered and students placed.
  f_before jsonb := '{
    "dbdbe02a-c7b1-4808-ae64-e928812d1016": {"name": "3 SCCT",             "total": 1, "matched": 0},
    "a034d6fa-ffd3-4a47-9608-5bbfb672d448": {"name": "3 South Short Stay", "total": 2, "matched": 2},
    "c09638f8-f48d-4ff5-9044-9b64625d52ca": {"name": "4 South",            "total": 1, "matched": 0},
    "89561136-df3f-4ea5-b637-b60ddf6a81af": {"name": "5 North",            "total": 1, "matched": 0},
    "8ca76460-8368-47d1-9432-23fc910c10b1": {"name": "5 SCCT",             "total": 2, "matched": 2},
    "ee74e154-ca5a-42be-bfe2-092a36f90f68": {"name": "5 South",            "total": 2, "matched": 1},
    "c18b77d8-5863-4681-bc0f-00c35ac8ef8d": {"name": "6 NE",               "total": 2, "matched": 2},
    "33d22e71-859d-42fb-b28e-ff68ce4aaebe": {"name": "6 NW",               "total": 2, "matched": 2},
    "cbf72085-bc13-4f91-8261-2586086f855e": {"name": "6 South",            "total": 1, "matched": 1},
    "2c67427c-9fe4-4025-844e-70d7f2e0d79d": {"name": "7 North",            "total": 2, "matched": 1},
    "3235a69d-6bcd-4c52-a066-42ac4b802070": {"name": "7 SCCT",             "total": 2, "matched": 2},
    "6b655d1b-5a1e-45ad-92e9-f1c2d45da3b1": {"name": "7 South",            "total": 3, "matched": 0},
    "2ed58d91-559b-4fdc-bf28-66d07700fab9": {"name": "8 North",            "total": 2, "matched": 0},
    "6badd8db-894b-4774-b154-88840516b68d": {"name": "8 SCCT",             "total": 1, "matched": 1},
    "c6177339-93b0-4e9b-b5b5-2f305945f28b": {"name": "8 South",            "total": 2, "matched": 1},
    "856b7373-6624-40c2-abdc-af8710576199": {"name": "ACU/CDU",            "total": 1, "matched": 1},
    "1a56c544-07ae-44e1-aba1-f1b61883167a": {"name": "NICU",               "total": 1, "matched": 1},
    "4c60305c-978c-441f-990b-b1d2e302a13e": {"name": "PACU",               "total": 2, "matched": 0},
    "68cd0214-e5b6-4083-88c0-1d08f9cd77d1": {"name": "Pediatrics",         "total": 1, "matched": 1},
    "f71d862c-7251-4b5d-8915-518a7b15fd1e": {"name": "PICU",               "total": 2, "matched": 1}
  }'::jsonb;

  -- Every Winter unit as the 08-29 carry left it (total = remaining = slots).
  w_before jsonb := '{
    "834af642-7a21-49ee-a932-c119525bc8dd": {"name": "3 SCCT",             "slots": 1},
    "cdac59d2-f5d4-4554-b670-ccca6d758ce9": {"name": "3 South Short Stay", "slots": 1},
    "6c437fe0-e8ff-4a83-ac8b-ada939088362": {"name": "4 South",            "slots": 1},
    "8c81097b-14f4-4b98-a86c-3e26dc74930f": {"name": "5 North",            "slots": 1},
    "35fcda95-41a8-4a26-ac76-8e306052eb3a": {"name": "5 SCCT",             "slots": 1},
    "67fca84c-74ab-4de8-9c43-f303565c05bd": {"name": "5 South",            "slots": 1},
    "dc0558cb-d723-414c-bf15-1dcaefcabf96": {"name": "6 NE",               "slots": 2},
    "1a2c19bd-e78e-4d56-835a-60977cdb46d7": {"name": "6 NW",               "slots": 1},
    "8355081a-8857-49f0-b55c-4726a52e60ff": {"name": "7 North",            "slots": 1},
    "83b395e1-051d-43c3-b004-528ae66b2e87": {"name": "7 SCCT",             "slots": 1},
    "9097df38-525b-46cb-884a-1f9e906d9594": {"name": "7 South",            "slots": 3},
    "59f69ea5-0dd1-4993-82dc-b5d236dddccd": {"name": "8 North",            "slots": 2},
    "3011426e-e266-4617-b483-634b36d73603": {"name": "8 SCCT",             "slots": 1},
    "9a71f02c-9982-44e7-8a39-a62471cdead5": {"name": "8 South",            "slots": 1},
    "3f496910-c29a-4aeb-ba2f-21486b0dafc4": {"name": "NICU",               "slots": 1},
    "96f4adca-17f0-4f03-a24a-5ea4e237c9e4": {"name": "PACU",               "slots": 2},
    "fe58a41b-c79d-441d-965b-af7c617fc9b3": {"name": "Pediatrics",         "slots": 1},
    "8dfa3ed4-69cf-4b1b-a161-e2c7c5015fbc": {"name": "PICU",               "slots": 2}
  }'::jsonb;

  -- The Winter units that stay, with their new offer (= Fall's unused slots).
  w_after jsonb := '{
    "834af642-7a21-49ee-a932-c119525bc8dd": {"name": "3 SCCT",  "slots": 1},
    "6c437fe0-e8ff-4a83-ac8b-ada939088362": {"name": "4 South", "slots": 1},
    "8c81097b-14f4-4b98-a86c-3e26dc74930f": {"name": "5 North", "slots": 1},
    "67fca84c-74ab-4de8-9c43-f303565c05bd": {"name": "5 South", "slots": 1},
    "8355081a-8857-49f0-b55c-4726a52e60ff": {"name": "7 North", "slots": 1},
    "9097df38-525b-46cb-884a-1f9e906d9594": {"name": "7 South", "slots": 3},
    "59f69ea5-0dd1-4993-82dc-b5d236dddccd": {"name": "8 North", "slots": 2},
    "9a71f02c-9982-44e7-8a39-a62471cdead5": {"name": "8 South", "slots": 1},
    "96f4adca-17f0-4f03-a24a-5ea4e237c9e4": {"name": "PACU",    "slots": 2},
    "8dfa3ed4-69cf-4b1b-a161-e2c7c5015fbc": {"name": "PICU",    "slots": 1}
  }'::jsonb;

  u               units%ROWTYPE;
  v_n             bigint;
  v_slots         bigint;
  v_matched       bigint;
  v_target        bigint;
  v_leave_fall    uuid[];
  v_shrink_fall   uuid[];
  v_leave_winter  uuid[];
  v_resize_winter uuid[];
  v_targets       uuid[];
BEGIN
  -- ── 0. One run only ──────────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM ops_backup.capacity_rebalance_20260910) THEN
    RAISE EXCEPTION 'The backup table already holds rows: this rebalance already ran. Stop; use the verification queries instead.';
  END IF;

  -- ── 1. Both cohorts, by id AND name ─────────────────────────────────────────
  PERFORM 1 FROM cohorts WHERE id = c_fall AND name = 'Fall 2026' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fall 2026 cohort % not found by id+name. Stop.', c_fall; END IF;
  PERFORM 1 FROM cohorts WHERE id = c_winter AND name = 'Winter 2027' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Winter 2027 cohort % not found by id+name. Stop.', c_winter; END IF;

  -- ── 2. Lock everything this touches or depends on ───────────────────────────
  PERFORM 1 FROM units WHERE cohort_id IN (c_fall, c_winter) FOR UPDATE;
  PERFORM 1 FROM students WHERE cohort_id IN (c_fall, c_winter) FOR UPDATE;
  PERFORM 1 FROM unit_cohort_responses WHERE cohort_id IN (c_fall, c_winter) FOR UPDATE;
  PERFORM 1 FROM cohort_unit_response_targets WHERE cohort_id = c_fall FOR UPDATE;

  -- ── 3. Nothing may hang off a response row (the delete would take it along) ─
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE confrelid = 'public.unit_cohort_responses'::regclass AND contype = 'f';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% foreign key(s) reference unit_cohort_responses; deleting responses could cascade. Stop and reconcile.', v_n;
  END IF;

  -- ── 4. Fall 2026 exactly as discovered ──────────────────────────────────────
  SELECT count(*), coalesce(sum(total_slots), 0) INTO v_n, v_slots
    FROM units WHERE cohort_id = c_fall AND is_participating = true;
  IF v_n <> 20 OR v_slots <> 33 THEN
    RAISE EXCEPTION 'Expected 20 hosting Fall units offering 33 slots, found % offering %. Re-run discovery D0.', v_n, v_slots;
  END IF;
  SELECT count(*) INTO v_n FROM students WHERE cohort_id = c_fall AND matched_unit_id IS NOT NULL;
  IF v_n <> 19 THEN
    RAISE EXCEPTION 'Expected 19 placed Fall students, found %. Re-run discovery D0.', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM students
   WHERE cohort_id = c_fall AND matched_unit_id IS NOT NULL AND status IN ('Not Proceeding', 'Declined');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% exited Fall student(s) still hold a unit. Stop and reconcile.', v_n;
  END IF;
  -- Every Fall placement sits on a hosting Fall unit.
  SELECT count(*) INTO v_n
    FROM students s LEFT JOIN units x ON x.id = s.matched_unit_id
   WHERE s.cohort_id = c_fall AND s.matched_unit_id IS NOT NULL
     AND (x.id IS NULL OR x.cohort_id <> c_fall OR x.is_participating IS DISTINCT FROM true);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% Fall placement(s) point outside the hosting Fall units. Stop and reconcile.', v_n;
  END IF;

  FOR u IN SELECT * FROM units WHERE cohort_id = c_fall AND is_participating = true ORDER BY unit_name LOOP
    IF NOT (f_before ? u.id::text) THEN
      RAISE EXCEPTION 'Fall unit "%" (%) is hosting but not in the pinned plan. Re-run discovery D0.', u.unit_name, u.id;
    END IF;
    SELECT count(*) INTO v_matched FROM students WHERE matched_unit_id = u.id;
    IF u.unit_name <> (f_before -> u.id::text ->> 'name')
       OR u.total_slots <> (f_before -> u.id::text ->> 'total')::int
       OR v_matched <> (f_before -> u.id::text ->> 'matched')::int THEN
      RAISE EXCEPTION 'Fall unit "%" is (% slots, % placed), pinned (% slots, % placed). Re-run discovery D0.',
        u.unit_name, u.total_slots, v_matched,
        (f_before -> u.id::text ->> 'total')::int, (f_before -> u.id::text ->> 'matched')::int;
    END IF;
    IF u.total_slots - v_matched <> u.slots_remaining THEN
      RAISE EXCEPTION 'Fall unit "%" ledger is inconsistent: % - % <> %. Fix the ledger first.',
        u.unit_name, u.total_slots, v_matched, u.slots_remaining;
    END IF;
    SELECT count(*) INTO v_n FROM unit_cohort_responses WHERE unit_id = u.id;
    IF v_n <> 1 THEN RAISE EXCEPTION 'Fall unit "%" has % response row(s), expected 1.', u.unit_name, v_n; END IF;
    PERFORM 1 FROM unit_cohort_responses
     WHERE unit_id = u.id AND cohort_id = c_fall
       AND response_status = 'submitted_hosting' AND slots_offered = u.total_slots;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Fall unit "%" response is not a hosting offer of % slot(s). Stop and reconcile.', u.unit_name, u.total_slots;
    END IF;
  END LOOP;

  SELECT array_agg(x.id ORDER BY x.unit_name) INTO v_leave_fall FROM units x
   WHERE x.cohort_id = c_fall AND x.is_participating = true
     AND NOT EXISTS (SELECT 1 FROM students s WHERE s.matched_unit_id = x.id);
  SELECT array_agg(x.id ORDER BY x.unit_name) INTO v_shrink_fall FROM units x
   WHERE x.cohort_id = c_fall AND x.is_participating = true
     AND (SELECT count(*) FROM students s WHERE s.matched_unit_id = x.id) BETWEEN 1 AND x.total_slots - 1;
  IF cardinality(v_leave_fall) IS DISTINCT FROM 6 OR cardinality(v_shrink_fall) IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'Expected 6 Fall units to leave and 4 to shrink, found % and %. Re-run discovery D0.',
      cardinality(v_leave_fall), cardinality(v_shrink_fall);
  END IF;
  -- Nothing live may hang off a unit leaving Fall.
  SELECT count(*) INTO v_n FROM matches WHERE unit_id = ANY (v_leave_fall);
  IF v_n <> 0 THEN RAISE EXCEPTION '% match row(s) sit on units leaving Fall. Stop and reconcile.', v_n; END IF;
  SELECT count(*) INTO v_n FROM student_unit_assignments
   WHERE unit_id = ANY (v_leave_fall) AND status IN ('planned', 'active');
  IF v_n <> 0 THEN RAISE EXCEPTION '% live assignment(s) sit on units leaving Fall. Stop and reconcile.', v_n; END IF;

  -- ── 5. Winter 2027 exactly as the 08-29 carry left it ───────────────────────
  SELECT count(*), coalesce(sum(total_slots), 0) INTO v_n, v_slots FROM units WHERE cohort_id = c_winter;
  IF v_n <> 18 OR v_slots <> 24 THEN
    RAISE EXCEPTION 'Expected 18 Winter units offering 24 slots, found % offering %. Re-run discovery D0.', v_n, v_slots;
  END IF;
  FOR u IN SELECT * FROM units WHERE cohort_id = c_winter ORDER BY unit_name LOOP
    IF NOT (w_before ? u.id::text) THEN
      RAISE EXCEPTION 'Winter unit "%" (%) is not in the pinned plan. Re-run discovery D0.', u.unit_name, u.id;
    END IF;
    IF u.unit_name <> (w_before -> u.id::text ->> 'name')
       OR u.total_slots <> (w_before -> u.id::text ->> 'slots')::int
       OR u.slots_remaining <> u.total_slots
       OR u.is_participating IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Winter unit "%" changed since discovery (% total, % remaining). Re-run discovery D0.',
        u.unit_name, u.total_slots, u.slots_remaining;
    END IF;
    PERFORM 1 FROM unit_cohort_responses
     WHERE unit_id = u.id AND cohort_id = c_winter
       AND response_status = 'submitted_hosting' AND slots_offered = u.total_slots;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Winter unit "%" response is not a hosting offer of % slot(s). Stop and reconcile.', u.unit_name, u.total_slots;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM students s JOIN units x ON x.id = s.matched_unit_id WHERE x.cohort_id = c_winter;
  IF v_n <> 0 THEN RAISE EXCEPTION '% student(s) are placed on Winter units. Stop and reconcile.', v_n; END IF;
  SELECT count(*) INTO v_n FROM student_unit_assignments a JOIN units x ON x.id = a.unit_id WHERE x.cohort_id = c_winter;
  IF v_n <> 0 THEN RAISE EXCEPTION '% assignment(s) sit on Winter units. Stop and reconcile.', v_n; END IF;
  SELECT count(*) INTO v_n FROM matches m JOIN units x ON x.id = m.unit_id WHERE x.cohort_id = c_winter;
  IF v_n <> 0 THEN RAISE EXCEPTION '% match row(s) sit on Winter units. Stop and reconcile.', v_n; END IF;

  -- ── 6. Winter's new offer, COMPUTED from Fall, must equal the pinned plan ───
  -- Every Fall unit with unused slots has exactly one Winter row of the same unit.
  SELECT count(*) INTO v_n FROM units f
   WHERE f.cohort_id = c_fall AND f.is_participating = true
     AND f.total_slots > (SELECT count(*) FROM students s WHERE s.matched_unit_id = f.id)
     AND (SELECT count(*) FROM units w
           WHERE w.cohort_id = c_winter
             AND regexp_replace(upper(w.unit_name), '[^A-Z0-9]', '', 'g')
               = regexp_replace(upper(f.unit_name), '[^A-Z0-9]', '', 'g')) <> 1;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% Fall unit(s) with unused slots lack exactly one Winter row. Stop and reconcile.', v_n;
  END IF;
  FOR u IN SELECT * FROM units WHERE cohort_id = c_winter ORDER BY unit_name LOOP
    SELECT coalesce(max(f.total_slots - (SELECT count(*) FROM students s WHERE s.matched_unit_id = f.id)), 0)
      INTO v_target
      FROM units f
     WHERE f.cohort_id = c_fall AND f.is_participating = true
       AND regexp_replace(upper(f.unit_name), '[^A-Z0-9]', '', 'g')
         = regexp_replace(upper(u.unit_name), '[^A-Z0-9]', '', 'g');
    IF v_target <> coalesce((w_after -> u.id::text ->> 'slots')::int, 0) THEN
      RAISE EXCEPTION 'Winter "%" computes to % slot(s) from Fall, but the pinned plan says %. Stop.',
        u.unit_name, v_target, coalesce((w_after -> u.id::text ->> 'slots')::int, 0);
    END IF;
  END LOOP;

  SELECT array_agg(x.id ORDER BY x.unit_name) INTO v_leave_winter FROM units x
   WHERE x.cohort_id = c_winter AND NOT (w_after ? x.id::text);
  SELECT array_agg(x.id ORDER BY x.unit_name) INTO v_resize_winter FROM units x
   WHERE x.cohort_id = c_winter AND (w_after ? x.id::text)
     AND x.total_slots <> (w_after -> x.id::text ->> 'slots')::int;
  IF cardinality(v_leave_winter) IS DISTINCT FROM 8 OR cardinality(v_resize_winter) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Expected 8 Winter units to leave and 1 to resize, found % and %. Stop.',
      cardinality(v_leave_winter), cardinality(v_resize_winter);
  END IF;

  -- The Fall outreach targets of units leaving Fall, by unit id or canonical name.
  SELECT coalesce(array_agg(t.id), '{}') INTO v_targets FROM cohort_unit_response_targets t
   WHERE t.cohort_id = c_fall AND t.is_active = true
     AND (t.unit_id = ANY (v_leave_fall)
          OR t.unit_key_canon IN (SELECT regexp_replace(upper(x.unit_name), '[^A-Z0-9]', '', 'g')
                                    FROM units x WHERE x.id = ANY (v_leave_fall)));

  -- ── 7. Back up every row about to change, BEFORE any write ──────────────────
  INSERT INTO ops_backup.capacity_rebalance_20260910 (source_table, action, row_data)
  SELECT 'units', 'update', to_jsonb(x) FROM units x
   WHERE x.id = ANY (v_leave_fall || v_shrink_fall || v_leave_winter || v_resize_winter);
  INSERT INTO ops_backup.capacity_rebalance_20260910 (source_table, action, row_data)
  SELECT 'unit_cohort_responses', 'delete', to_jsonb(r) FROM unit_cohort_responses r
   WHERE r.unit_id = ANY (v_leave_fall || v_leave_winter);
  INSERT INTO ops_backup.capacity_rebalance_20260910 (source_table, action, row_data)
  SELECT 'unit_cohort_responses', 'update', to_jsonb(r) FROM unit_cohort_responses r
   WHERE r.unit_id = ANY (v_shrink_fall || v_resize_winter);
  INSERT INTO ops_backup.capacity_rebalance_20260910 (source_table, action, row_data)
  SELECT 'cohort_unit_response_targets', 'update', to_jsonb(t) FROM cohort_unit_response_targets t
   WHERE t.id = ANY (v_targets);

  -- ── 8. Fall 2026 ────────────────────────────────────────────────────────────
  -- Shrink to what was used.
  UPDATE units x
     SET total_slots = (SELECT count(*) FROM students s WHERE s.matched_unit_id = x.id),
         slots_remaining = 0
   WHERE x.id = ANY (v_shrink_fall);
  UPDATE unit_cohort_responses r
     SET slots_offered = (SELECT x.total_slots FROM units x WHERE x.id = r.unit_id),
         last_updated_at = now()
   WHERE r.unit_id = ANY (v_shrink_fall);
  -- Leave Fall, the way Set Up Units removes a unit; the response and targets go with it.
  UPDATE units SET is_participating = false, total_slots = 0, slots_remaining = 0
   WHERE id = ANY (v_leave_fall);
  DELETE FROM unit_cohort_responses WHERE unit_id = ANY (v_leave_fall);
  UPDATE cohort_unit_response_targets SET is_active = false, removed_at = now()
   WHERE id = ANY (v_targets);

  -- ── 9. Winter 2027 ──────────────────────────────────────────────────────────
  UPDATE units x
     SET total_slots = (w_after -> x.id::text ->> 'slots')::int,
         slots_remaining = (w_after -> x.id::text ->> 'slots')::int
   WHERE x.id = ANY (v_resize_winter);
  UPDATE unit_cohort_responses r
     SET slots_offered = (SELECT x.total_slots FROM units x WHERE x.id = r.unit_id),
         last_updated_at = now()
   WHERE r.unit_id = ANY (v_resize_winter);
  UPDATE units SET is_participating = false, total_slots = 0, slots_remaining = 0
   WHERE id = ANY (v_leave_winter);
  DELETE FROM unit_cohort_responses WHERE unit_id = ANY (v_leave_winter);

  -- ── 10. Postconditions: prove the final shape before COMMIT ─────────────────
  -- Fall: 14 hosting units, 19 slots, every one full, offer = slots.
  SELECT count(*), coalesce(sum(total_slots), 0) INTO v_n, v_slots
    FROM units WHERE cohort_id = c_fall AND is_participating = true;
  IF v_n <> 14 OR v_slots <> 19 THEN
    RAISE EXCEPTION 'POSTCONDITION: Fall has % hosting units offering %, expected 14 offering 19.', v_n, v_slots;
  END IF;
  SELECT count(*) INTO v_n FROM units x
   WHERE x.cohort_id = c_fall AND x.is_participating = true
     AND (x.slots_remaining <> 0
          OR x.total_slots <> (SELECT count(*) FROM students s WHERE s.matched_unit_id = x.id));
  IF v_n <> 0 THEN RAISE EXCEPTION 'POSTCONDITION: % Fall unit(s) are not exactly full.', v_n; END IF;
  SELECT count(*) INTO v_n FROM unit_cohort_responses r JOIN units x ON x.id = r.unit_id
   WHERE r.cohort_id = c_fall AND r.response_status = 'submitted_hosting' AND r.slots_offered = x.total_slots
     AND x.is_participating = true;
  IF v_n <> 14 THEN RAISE EXCEPTION 'POSTCONDITION: % Fall hosting responses agree with their units, expected 14.', v_n; END IF;
  SELECT count(*) INTO v_n FROM unit_cohort_responses WHERE unit_id = ANY (v_leave_fall || v_leave_winter);
  IF v_n <> 0 THEN RAISE EXCEPTION 'POSTCONDITION: % response(s) remain on units that left.', v_n; END IF;
  SELECT count(*) INTO v_n FROM cohort_unit_response_targets WHERE id = ANY (v_targets) AND is_active = true;
  IF v_n <> 0 THEN RAISE EXCEPTION 'POSTCONDITION: % outreach target(s) for units that left are still active.', v_n; END IF;
  SELECT count(*) INTO v_n FROM unit_cohort_responses
   WHERE cohort_id = c_fall AND response_status = 'submitted_not_hosting';
  IF v_n <> 4 THEN RAISE EXCEPTION 'POSTCONDITION: Fall shows % Not Hosting responses, expected the original 4.', v_n; END IF;
  -- Placements untouched: 19, all on hosting Fall units.
  SELECT count(*) INTO v_n
    FROM students s JOIN units x ON x.id = s.matched_unit_id
   WHERE s.cohort_id = c_fall AND x.cohort_id = c_fall AND x.is_participating = true;
  IF v_n <> 19 THEN RAISE EXCEPTION 'POSTCONDITION: % Fall placements sit on hosting Fall units, expected 19.', v_n; END IF;
  -- Winter: 10 hosting units, 14 slots, full availability, offer = slots.
  SELECT count(*), coalesce(sum(total_slots), 0) INTO v_n, v_slots
    FROM units WHERE cohort_id = c_winter AND is_participating = true;
  IF v_n <> 10 OR v_slots <> 14 THEN
    RAISE EXCEPTION 'POSTCONDITION: Winter has % hosting units offering %, expected 10 offering 14.', v_n, v_slots;
  END IF;
  SELECT count(*) INTO v_n FROM units
   WHERE cohort_id = c_winter AND is_participating = true AND total_slots <> slots_remaining;
  IF v_n <> 0 THEN RAISE EXCEPTION 'POSTCONDITION: % Winter unit(s) are not at full availability.', v_n; END IF;
  SELECT count(*) INTO v_n FROM unit_cohort_responses r JOIN units x ON x.id = r.unit_id
   WHERE r.cohort_id = c_winter AND r.response_status = 'submitted_hosting' AND r.slots_offered = x.total_slots
     AND x.is_participating = true;
  IF v_n <> 10 THEN RAISE EXCEPTION 'POSTCONDITION: % Winter hosting responses agree with their units, expected 10.', v_n; END IF;
  -- The backup holds every changed row: 19 units, 14 deleted + 5 updated responses, the targets.
  SELECT count(*) INTO v_n FROM ops_backup.capacity_rebalance_20260910 WHERE source_table = 'units';
  IF v_n <> 19 THEN RAISE EXCEPTION 'POSTCONDITION: backup holds % unit rows, expected 19.', v_n; END IF;
  SELECT count(*) INTO v_n FROM ops_backup.capacity_rebalance_20260910 WHERE source_table = 'unit_cohort_responses';
  IF v_n <> 19 THEN RAISE EXCEPTION 'POSTCONDITION: backup holds % response rows, expected 19.', v_n; END IF;

  RAISE NOTICE 'OK. Fall 2026: 14 hosting units, 19 slots, 19 filled (6 units left Fall, 4 shrank). Winter 2027: 10 units, 14 slots (8 left, PICU 2 -> 1). % Fall outreach target(s) deactivated. Every changed row is in ops_backup.capacity_rebalance_20260910.',
    cardinality(v_targets);
END $$;

COMMIT;

-- ── Verification (run AFTER the commit; each returns rows) ───────────────────
--
-- V1  The Snapshot numbers for both cohorts (expect Fall 14 / 19 / 19 / 0,
--     Winter 10 / 14 / 0 / 14):
--     SELECT c.name,
--            count(*) FILTER (WHERE u.is_participating)                        AS hosting_units,
--            coalesce(sum(u.total_slots) FILTER (WHERE u.is_participating), 0) AS total_slots,
--            (SELECT count(*) FROM students s
--              WHERE s.cohort_id = c.id AND s.matched_unit_id IS NOT NULL)      AS slots_filled,
--            coalesce(sum(u.total_slots) FILTER (WHERE u.is_participating), 0)
--              - (SELECT count(*) FROM students s
--                  WHERE s.cohort_id = c.id AND s.matched_unit_id IS NOT NULL)  AS open_slots
--       FROM cohorts c JOIN units u ON u.cohort_id = c.id
--      WHERE c.id IN ('eedd91ec-ad6f-4df8-aa20-5c06b2889011', '52933615-cf6e-441f-ac68-130bdb6a0491')
--      GROUP BY c.id, c.name ORDER BY c.name;
--
-- V2  Unit by unit, both cohorts: hosting units with their slots, placements
--     and response offer (the two must agree everywhere):
--     SELECT c.name AS cohort, u.unit_name, u.is_participating, u.total_slots, u.slots_remaining,
--            (SELECT count(*) FROM students s WHERE s.matched_unit_id = u.id) AS placed,
--            r.response_status, r.slots_offered
--       FROM units u JOIN cohorts c ON c.id = u.cohort_id
--       LEFT JOIN unit_cohort_responses r ON r.unit_id = u.id
--      WHERE u.cohort_id IN ('eedd91ec-ad6f-4df8-aa20-5c06b2889011', '52933615-cf6e-441f-ac68-130bdb6a0491')
--      ORDER BY c.name, u.is_participating DESC, u.unit_name;
--
-- V3  The Fall outreach targets this deactivated, and their logged events:
--     SELECT t.unit_name, t.is_active, t.removed_at, e.action, e.occurred_at
--       FROM cohort_unit_response_targets t
--       LEFT JOIN cohort_unit_response_target_events e ON e.target_id = t.id AND e.action = 'deactivated'
--      WHERE t.id IN (SELECT (row_data->>'id')::uuid FROM ops_backup.capacity_rebalance_20260910
--                      WHERE source_table = 'cohort_unit_response_targets');
--
-- V4  What the backup holds (expect units 19; responses 14 delete + 5 update; the targets):
--     SELECT source_table, action, count(*) FROM ops_backup.capacity_rebalance_20260910
--      GROUP BY 1, 2 ORDER BY 1, 2;
--
-- ── Rollback (restores every changed row from the backup) ───────────────────
--
--   BEGIN;
--   UPDATE units u
--      SET is_participating = (b.row_data->>'is_participating')::boolean,
--          total_slots      = (b.row_data->>'total_slots')::int,
--          slots_remaining  = (b.row_data->>'slots_remaining')::int
--     FROM ops_backup.capacity_rebalance_20260910 b
--    WHERE b.source_table = 'units' AND u.id = (b.row_data->>'id')::uuid;
--   INSERT INTO unit_cohort_responses
--   SELECT (jsonb_populate_record(NULL::unit_cohort_responses, b.row_data)).*
--     FROM ops_backup.capacity_rebalance_20260910 b
--    WHERE b.source_table = 'unit_cohort_responses' AND b.action = 'delete';
--   UPDATE unit_cohort_responses r
--      SET slots_offered   = (b.row_data->>'slots_offered')::int,
--          last_updated_at = (b.row_data->>'last_updated_at')::timestamptz
--     FROM ops_backup.capacity_rebalance_20260910 b
--    WHERE b.source_table = 'unit_cohort_responses' AND b.action = 'update'
--      AND r.id = (b.row_data->>'id')::uuid;
--   UPDATE cohort_unit_response_targets t   -- the trigger logs 'reactivated'
--      SET is_active = true, removed_at = NULL, removed_by_profile_id = NULL
--     FROM ops_backup.capacity_rebalance_20260910 b
--    WHERE b.source_table = 'cohort_unit_response_targets' AND t.id = (b.row_data->>'id')::uuid;
--   DELETE FROM ops_backup.capacity_rebalance_20260910;
--   COMMIT;
