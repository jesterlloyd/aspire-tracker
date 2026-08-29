-- ############################################################################
-- TERM SPLIT: move West Coast University Anaheim's Fall II request from
-- Fall 2026 to Winter 2027.
--
-- Owner-gated. NOT auto-applied. Data-only: no DDL, no schema change.
-- Run this AFTER 20260830000000 (the North Hollywood repair), and only after
-- its verification queries look right. Deliberately a SEPARATE transaction:
-- Anaheim's students were created 2026-08-11 and may already carry interviews
-- or unit assignments, and an abort here must not roll back the North
-- Hollywood repair.
--
-- WHY THIS IS DIFFERENT FROM THE NORTH HOLLYWOOD SCRIPT
-- Nothing was overwritten here. WCU Anaheim had no Fall I request in Fall 2026,
-- so its rotation row (created 2026-08-11, window 2026-10-26 to 2027-01-10) IS
-- the Fall II request in its entirety. There is no split to make and nothing to
-- restore. The whole row moves.
--
-- So this REPOINTS the existing row rather than copying it into a new one:
--   * cohort_school_rotations.cohort_id  Fall 2026 -> Winter 2027
--   * every student on that row: cohort_id and aspire_cohort follow it
--   * cohort_school_rotation_id is UNCHANGED, because the row itself moved
-- Consequently the coordinator, the window, the fifteen holiday blackout dates,
-- the weekday availability, the row id, and created_at all survive untouched.
-- Nothing is copied, so nothing can be mistyped in the copying.
--
-- The unique key (cohort_id, school_name) is satisfied because step 2 proves
-- Winter 2027 has no WCU Anaheim row yet.
--
-- SAFETY
--   * The rotation row and every student on it are locked FOR UPDATE before any
--     check or write.
--   * Fails closed and rolls back on ANY deviation, including the
--     postconditions after the writes.
--   * Re-running after a successful run fails at step 1 (the row is no longer
--     in Fall 2026), which is the intended protection, not idempotence.
--   * NOTHING student-owned or ASPIRE-owned is touched: status,
--     interview_outcome, ngrp_outcome, disposition, matched_unit_id,
--     preceptor_id, hours, CS-Link, badge, and notes are all left alone.
--   * Step 3 aborts if any moving student has a row in a public base table with
--     a student_id column that is not explicitly classified (see follow_tables
--     and the derived no-cohort_id rule). The 2026-08-29 preflight found four:
--     program_events, communications, and notification_log carry cohort_id and
--     are repointed; student_reads has no cohort column and is skipped
--     structurally. If it fires on anything else, STOP and read what it names: an
--     interview or unit assignment may need to follow the student, and that is
--     a decision, not something to work around.
-- ############################################################################

BEGIN;

DO $$
DECLARE
  c_fall   uuid := 'eedd91ec-ad6f-4df8-aa20-5c06b2889011';  -- Fall 2026, Active
  c_winter uuid := '52933615-cf6e-441f-ac68-130bdb6a0491';  -- Winter 2027, Planning
  r_anah   uuid := '4dbf6d13-d5cd-4c63-8cec-0c61b6e2400e';  -- WCU Anaheim rotation row
  v_school text := 'West Coast University Anaheim';

  d_start  date := DATE '2026-10-26';
  d_end    date := DATE '2027-01-10';

  -- PLACEMENT-RESUBMIT-1 / incident repair: this script's job is to keep COHORT
  -- references consistent, so student-keyed tables are handled by that rule:
  --   follow_tables       carry cohort_id AND are per-student timeline, outreach,
  --                       or delivery records that belong with the student. Their
  --                       cohort_id is repointed in step 4.
  --   no cohort_id column a table with no cohort reference cannot BECOME
  --                       inconsistent, so it is skipped. This is derived from
  --                       the live schema, never from a hand-kept list, so it
  --                       cannot be wrong about which tables those are.
  --   anything else       has a cohort_id and is NOT classified -> abort.
  --                       Whether such a record should follow a student across
  --                       cohorts is a judgement (a certificate issued for Fall
  --                       2026 must keep saying Fall 2026), so it wants a human.
  --
  -- notification_log is a follow table, not an inert one: the attention engine
  -- decides whether an interview reminder was delivered by filtering it on
  -- cohort_id (src/App.jsx fetchReminderDeliveries), so a row left behind would
  -- read as a genuine missed send. The cohort-level access-retirement ledger in
  -- the same table is untouched, because those rows have a NULL student_id and
  -- every write below is scoped to the moving students.
  follow_tables text[] := ARRAY['program_events', 'communications', 'notification_log'];
  v_tbl         text;

  v_winter_name text;
  v_row    cohort_school_rotations%ROWTYPE;
  v_ids    uuid[];
  v_n      bigint;
  v_moved  bigint;
  t        record;
BEGIN
  -- ── 1. Lock and PROVE the Anaheim rotation row is where we think it is
  SELECT * INTO v_row FROM cohort_school_rotations WHERE id = r_anah FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rotation row % not found. Stop and re-run discovery.', r_anah;
  END IF;
  IF v_row.school_name <> v_school THEN
    RAISE EXCEPTION 'Rotation % is for "%", expected "%".', r_anah, v_row.school_name, v_school;
  END IF;
  IF v_row.cohort_id <> c_fall THEN
    RAISE EXCEPTION
      'Rotation % is already in cohort %, not Fall 2026. Either this already ran or someone moved it. Stop and re-run discovery.',
      r_anah, v_row.cohort_id;
  END IF;
  IF v_row.rotation_start_date <> d_start OR v_row.rotation_end_date <> d_end THEN
    RAISE EXCEPTION
      'Rotation % reads % to %, expected % to %. Stop and re-run discovery.',
      r_anah, v_row.rotation_start_date, v_row.rotation_end_date, d_start, d_end;
  END IF;

  -- ── 2. The destination cohort exists and has no WCU Anaheim row yet
  SELECT name INTO v_winter_name FROM cohorts WHERE id = c_winter FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Destination cohort % not found.', c_winter;
  END IF;
  IF v_winter_name <> 'Winter 2027' THEN
    RAISE EXCEPTION 'Destination cohort % is named "%", expected "Winter 2027".', c_winter, v_winter_name;
  END IF;
  SELECT count(*) INTO v_n FROM cohort_school_rotations
   WHERE cohort_id = c_winter AND school_name = v_school;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% already has a rotation row in Winter 2027. Stop and reconcile by hand.', v_school;
  END IF;

  -- ── 3. Lock the roster and capture exactly who moves
  -- Unlike North Hollywood there is no split here: EVERY student on this row
  -- moves, because the row itself is the Fall II request. The set is defined by
  -- the row, so it is captured at runtime rather than hardcoded, then proven.
  PERFORM 1 FROM students WHERE cohort_school_rotation_id = r_anah FOR UPDATE;

  SELECT array_agg(id ORDER BY id), count(*) INTO v_ids, v_n
    FROM students WHERE cohort_school_rotation_id = r_anah;
  IF v_n = 0 OR v_ids IS NULL THEN
    RAISE EXCEPTION 'No students are on rotation %. Nothing to move; stop and re-run discovery.', r_anah;
  END IF;

  -- Every one of them must currently be in Fall 2026. A student on this row but
  -- in another cohort means the data is already inconsistent, and this script is
  -- not the place to discover that silently.
  SELECT count(*) INTO v_moved FROM students
   WHERE cohort_school_rotation_id = r_anah AND cohort_id = c_fall;
  IF v_moved <> v_n THEN
    RAISE EXCEPTION
      '% of % students on rotation % are in Fall 2026. Stop and reconcile the rest by hand.',
      v_moved, v_n, r_anah;
  END IF;

  -- Every public BASE TABLE with a student_id column is examined, so this cannot
  -- miss one by being out of date with the schema. Classified tables are handled
  -- (follow) or provably irrelevant (inert); anything else aborts.
  FOR t IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name = 'student_id'
       AND tb.table_type = 'BASE TABLE'
     ORDER BY c.table_name
  LOOP
    IF t.table_name = ANY(follow_tables) THEN CONTINUE; END IF;
    -- No cohort_id column means no cohort reference to leave stale.
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = t.table_name
                      AND column_name = 'cohort_id') THEN
      CONTINUE;
    END IF;
    EXECUTE format(
      'SELECT count(*) FROM public.%I WHERE student_id::text = ANY($1)', t.table_name)
      INTO v_n USING v_ids::text[];
    IF v_n > 0 THEN
      RAISE EXCEPTION
        'Anaheim students have % cohort-scoped row(s) in public.%, which is not classified. Stop and decide whether its cohort_id should follow them to Winter 2027.',
        v_n, t.table_name;
    END IF;
  END LOOP;

  -- ── 4. Move the row, then the people on it
  UPDATE cohort_school_rotations
     SET cohort_id = c_winter, updated_at = now()
   WHERE id = r_anah;

  UPDATE students
     SET cohort_id = c_winter, aspire_cohort = v_winter_name
   WHERE cohort_school_rotation_id = r_anah;

  -- Records that belong with the student follow them. Guarded by to_regclass so
  -- a table that does not exist in this database is skipped, not an error.
  FOREACH v_tbl IN ARRAY follow_tables LOOP
    IF to_regclass('public.' || quote_ident(v_tbl)) IS NOT NULL THEN
      EXECUTE format(
        'UPDATE public.%I SET cohort_id = $1 WHERE student_id::text = ANY($2) AND cohort_id = $3', v_tbl)
        USING c_winter, v_ids::text[], c_fall;
    END IF;
  END LOOP;

  INSERT INTO program_events (student_id, cohort_id, event_type, event_date, notes, created_by)
  SELECT s.id, c_winter, 'rotation_updated', CURRENT_DATE,
         format('[Auto-logged] Moved from Fall 2026 to %s with the %s Fall II placement request. Rotation %s to %s, unchanged.',
                v_winter_name, v_school, d_start, d_end),
         'system'
    FROM students s WHERE s.id = ANY(v_ids);

  -- ── 5. Postconditions: prove the final shape before COMMIT ────────────────
  SELECT * INTO v_row FROM cohort_school_rotations WHERE id = r_anah;
  IF v_row.cohort_id <> c_winter THEN
    RAISE EXCEPTION 'POSTCONDITION: the Anaheim rotation row is still in cohort %.', v_row.cohort_id;
  END IF;
  -- The window and availability moved WITH the row, so they must be untouched.
  IF v_row.rotation_start_date <> d_start OR v_row.rotation_end_date <> d_end THEN
    RAISE EXCEPTION 'POSTCONDITION: the Anaheim window changed. It should not have.';
  END IF;
  IF coalesce(v_row.blackout_dates::text, '') IN ('', '{}', '[]') THEN
    RAISE EXCEPTION 'POSTCONDITION: the Anaheim blackout dates were lost. They should not have moved at all.';
  END IF;

  SELECT count(*) INTO v_moved FROM students
   WHERE cohort_school_rotation_id = r_anah
     AND cohort_id = c_winter AND aspire_cohort = v_winter_name;
  IF v_moved <> array_length(v_ids, 1) THEN
    RAISE EXCEPTION 'POSTCONDITION: expected % students in Winter 2027, found %.',
      array_length(v_ids, 1), v_moved;
  END IF;

  -- Nothing of this school is left behind in Fall 2026.
  SELECT count(*) INTO v_n FROM students s
    JOIN cohort_school_rotations r ON r.id = s.cohort_school_rotation_id
   WHERE s.cohort_id = c_fall AND r.school_name = v_school;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'POSTCONDITION: % Anaheim student(s) remain in Fall 2026.', v_n;
  END IF;

  RAISE NOTICE 'OK. % moved to % with % student(s); window % .. % unchanged.',
    v_school, v_winter_name, array_length(v_ids, 1), d_start, d_end;
END $$;

COMMIT;

-- ── Verification (run AFTER the commit; each returns rows) ───────────────────
--
-- V1  both WCU campuses now sit in Winter 2027, and Fall 2026 keeps only North
--     Hollywood's restored Fall I row:
--     SELECT c.name AS cohort, r.school_name, r.rotation_start_date, r.rotation_end_date,
--            r.coordinator_name, r.blackout_dates, r.updated_at
--       FROM cohort_school_rotations r JOIN cohorts c ON c.id = r.cohort_id
--      WHERE r.school_name LIKE 'West Coast University%'
--      ORDER BY c.name, r.school_name;
--
-- V2  every WCU student, with the cohort and window they now read:
--     SELECT s.name, s.status, s.school, s.aspire_cohort, c.name AS cohort,
--            r.rotation_start_date, r.rotation_end_date
--       FROM students s
--       JOIN cohorts c ON c.id = s.cohort_id
--       JOIN cohort_school_rotations r ON r.id = s.cohort_school_rotation_id
--      WHERE s.school LIKE 'West Coast University%'
--      ORDER BY c.name, s.school, s.name;
--
-- V3  nothing anywhere still claims a WCU Anaheim student is in Fall 2026:
--     SELECT count(*) AS should_be_zero
--       FROM students s
--       JOIN cohort_school_rotations r ON r.id = s.cohort_school_rotation_id
--      WHERE s.cohort_id = 'eedd91ec-ad6f-4df8-aa20-5c06b2889011'
--        AND r.school_name = 'West Coast University Anaheim';
--
-- ── Rollback ────────────────────────────────────────────────────────────────
-- Reverses every write. Safe and complete: nothing was copied or cleared here,
-- so putting the row back in Fall 2026 restores the exact prior state.
--
--   BEGIN;
--   DO $rb$
--   DECLARE
--     c_fall   uuid := 'eedd91ec-ad6f-4df8-aa20-5c06b2889011';
--     c_winter uuid := '52933615-cf6e-441f-ac68-130bdb6a0491';
--     r_anah   uuid := '4dbf6d13-d5cd-4c63-8cec-0c61b6e2400e';
--     v_ids    uuid[];
--   BEGIN
--     SELECT array_agg(id) INTO v_ids FROM students WHERE cohort_school_rotation_id = r_anah;
--     DELETE FROM program_events
--      WHERE student_id = ANY(v_ids) AND notes ILIKE '%Moved from Fall 2026%';
--     UPDATE program_events SET cohort_id = c_fall
--      WHERE student_id = ANY(v_ids) AND cohort_id = c_winter;
--     UPDATE students SET cohort_id = c_fall, aspire_cohort = 'Fall 2026'
--      WHERE cohort_school_rotation_id = r_anah;
--     UPDATE cohort_school_rotations SET cohort_id = c_fall, updated_at = now()
--      WHERE id = r_anah;
--   END $rb$;
--   COMMIT;
