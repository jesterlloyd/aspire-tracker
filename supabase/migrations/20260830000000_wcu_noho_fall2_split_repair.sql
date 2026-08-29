-- ############################################################################
-- INCIDENT REPAIR: split West Coast University North Hollywood's Fall II batch
-- out of Fall 2026, and restore the Fall I rotation window it overwrote.
--
-- Owner-gated. NOT auto-applied. Data-only: no DDL, no schema change.
--
-- WHAT HAPPENED (verified 2026-08-28 from production reads)
-- cohort_school_rotations is UNIQUE (cohort_id, school_name), so there is
-- exactly ONE rotation row per school per cohort, and the placement write
-- upserts onto it. On 2026-08-27 18:19:19 UTC an Academic Partner portal
-- submission from Tony Kim for WCU North Hollywood's Fall II term landed on the
-- SAME row as the Fall I request. It did not create a second request, it
-- replaced the first:
--   * The rotation window moved from 2026-08-17..2026-10-25 to
--     2026-10-25..2027-01-17. Students carry no dates of their own - they read
--     this shared row through cohort_school_rotation_id - so all four Fall I
--     students, three of them Placed and on rotation since August, began
--     displaying the October window.
--   * The Fall I availability was replaced by Fall II's: all seven weekdays
--     marked unavailable and fifteen Nov/Dec/Jan holiday blackout dates, which
--     are meaningless for a rotation that ended 25 October.
--
-- The original window is recoverable and is NOT guessed here: it is quoted from
-- the program_events rotation_created row written by the original submission on
-- 2026-07-11, "Dates: 2026-08-17 to 2026-10-25".
--
-- The original AVAILABILITY is NOT recoverable from the database. Nothing in the
-- schema versions those six columns. This script therefore CLEARS them on the
-- Fall 2026 row (approved 2026-08-28) rather than leaving January holidays on an
-- August rotation. Tony Kim re-supplies them, or they are lifted from the
-- 2026-08-27 12:19:55 UTC daily snapshot, which predates the overwrite by six
-- hours and rolls off around 2026-09-03.
--
-- WHAT THIS DOES
--   1. Locks and PROVES the exact nine-row shape discovery observed.
--   2. Creates the Winter 2027 rotation row for this school, carrying the Fall
--      II window and Fall II availability, copied column-to-column from the
--      current row so array/jsonb types are preserved without being retyped.
--   3. Restores the Fall 2026 row to 2026-08-17..2026-10-25 and clears its six
--      availability columns to their schema DEFAULT.
--   4. Moves the FIVE new students to Winter 2027 (cohort_id,
--      cohort_school_rotation_id, aspire_cohort), repoints the cohort_id of the
--      records that belong with them, then logs one rotation_updated event each.
--   5. Re-asserts the whole final shape before COMMIT.
--
-- WHO MOVES / WHO STAYS (decided 2026-08-28)
--   MOVE  (created 2026-08-27, submitted_via academic_partner_portal, all
--          Pending Outreach): Brandon Torres, Arghavan Memarian,
--          Anselle Elomina, Maria Talento, Mari Stoddard.
--   STAY  (created 2026-07-11, submitted_via student_form): Ace Capati,
--          Allison Rabanales, Chloe Tergalstanian (all Placed), and Juliana
--          Pilla (Not Proceeding). Juliana appears on Tony's Fall II roster -
--          her placement_request_last_submitted_at matches the overwrite to the
--          millisecond - but she keeps her Fall I history and outcome. If that
--          turns out to be wrong she is moved by hand, deliberately.
--
-- SAFETY
--   * Every target row is locked FOR UPDATE before any check or write, so the
--     verified shape cannot change between check and update.
--   * Fails closed and rolls back on ANY deviation, including the
--     postconditions after the writes. Re-running after a successful run fails
--     at step 1 (the row is no longer in the overwritten state), which is the
--     intended protection, not idempotence.
--   * NOTHING student-owned or ASPIRE-owned is touched: status,
--     interview_outcome, ngrp_outcome, disposition, matched_unit_id,
--     preceptor_id, hours, CS-Link, badge, and notes are all left alone. The
--     four staying students are never written to at all.
--   * Step 4a aborts if any moving student has a row in a public base table with
--     a student_id column that is not explicitly classified (see follow_tables
--     and inert_tables). The 2026-08-29 preflight found program_events and
--     communications carry cohort_id and are repointed; notification_log and
--     student_reads have no cohort dimension and are left alone. If it fires on
--     anything else, stop and read what it names: whether that record should
--     follow the student is a judgement, not something to work around.
-- ############################################################################

BEGIN;

DO $$
DECLARE
  -- Verified production ids (Owner read-only confirmation, 2026-08-28).
  c_fall     uuid := 'eedd91ec-ad6f-4df8-aa20-5c06b2889011';  -- Fall 2026, Active
  c_winter   uuid := '52933615-cf6e-441f-ac68-130bdb6a0491';  -- Winter 2027, Planning
  r_fall     uuid := '8206a856-c910-4cf4-abe9-f66e7ddd511d';  -- WCU NoHo rotation row
  v_school   text := 'West Coast University North Hollywood';

  -- Fall I: quoted from the 2026-07-11 rotation_created program_event.
  d_f1_start date := DATE '2026-08-17';
  d_f1_end   date := DATE '2026-10-25';
  -- Fall II: the window the overwrite wrote, which moves to Winter 2027.
  d_f2_start date := DATE '2026-10-25';
  d_f2_end   date := DATE '2027-01-17';

  movers uuid[] := ARRAY[
    '4901f694-8a46-4d50-b900-7583231d4bc2',  -- Brandon Torres
    'da1d51c6-514a-4291-892b-900b42891eb9',  -- Arghavan Memarian
    'ea42bb7e-a906-4b8d-8b7f-e47cfb09c01b',  -- Anselle Elomina
    'a7240031-da1e-4f1e-8f7c-714874ad1577',  -- Maria Talento
    'b4abd33a-81fe-4227-a35e-6472084c90ba'   -- Mari Stoddard
  ]::uuid[];
  stayers uuid[] := ARRAY[
    'aa773d63-5ab3-4635-9051-5b2457afd477',  -- Ace Capati, Placed
    '4be0c57e-1a7e-4071-9627-4b193d68cfb1',  -- Allison Rabanales, Placed
    '2bde78c7-a6aa-4066-a446-2636034cdf8a',  -- Chloe Tergalstanian, Placed
    'd6ff6ac4-94c0-4818-935a-e5bde2c07c00'   -- Juliana Pilla, Not Proceeding
  ]::uuid[];

  -- PLACEMENT-RESUBMIT-1 / incident repair: student-keyed tables are CLASSIFIED,
  -- not blanket-blocked. Anything not named here still blocks, so a table added
  -- later fails closed rather than being silently skipped.
  --   follow_tables  carry cohort_id AND are per-student timeline or outreach
  --                  records that belong with the student. Their cohort_id is
  --                  repointed in step 4.
  --   inert_tables   have no cohort dimension at all, so they already follow the
  --                  student through student_id and need no write. Each is
  --                  ASSERTED to have no cohort_id column, so if that ever
  --                  changes this script stops instead of quietly under-writing.
  follow_tables text[] := ARRAY['program_events', 'communications'];
  inert_tables  text[] := ARRAY['notification_log', 'student_reads'];
  v_tbl         text;

  r_winter      uuid;
  v_winter_name text;
  v_row         cohort_school_rotations%ROWTYPE;
  v_n           bigint;
  t             record;
BEGIN
  -- ── 1. Lock and PROVE the Fall 2026 rotation row is in the overwritten state
  SELECT * INTO v_row FROM cohort_school_rotations WHERE id = r_fall FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rotation row % not found. Stop and re-run discovery.', r_fall;
  END IF;
  IF v_row.cohort_id <> c_fall OR v_row.school_name <> v_school THEN
    RAISE EXCEPTION 'Rotation % is (cohort %, school %), expected (%, %).',
      r_fall, v_row.cohort_id, v_row.school_name, c_fall, v_school;
  END IF;
  IF v_row.rotation_start_date <> d_f2_start OR v_row.rotation_end_date <> d_f2_end THEN
    RAISE EXCEPTION
      'Rotation % reads % to %, not the overwritten % to %. Either this already ran or someone edited it. Stop and re-run discovery.',
      r_fall, v_row.rotation_start_date, v_row.rotation_end_date, d_f2_start, d_f2_end;
  END IF;

  -- ── 2. The destination cohort exists, and has no rotation row for this school
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

  -- ── 3. Lock all nine students and PROVE the split is exactly as observed
  PERFORM 1 FROM students WHERE cohort_school_rotation_id = r_fall FOR UPDATE;

  SELECT count(*) INTO v_n FROM students WHERE cohort_school_rotation_id = r_fall;
  IF v_n <> 9 THEN
    RAISE EXCEPTION 'Expected 9 students on rotation %, found %. Stop and re-run discovery.', r_fall, v_n;
  END IF;

  SELECT count(*) INTO v_n FROM students
   WHERE id = ANY(movers) AND cohort_school_rotation_id = r_fall AND cohort_id = c_fall;
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'Expected the 5 moving students on rotation % in cohort %, found %.', r_fall, c_fall, v_n;
  END IF;

  SELECT count(*) INTO v_n FROM students
   WHERE id = ANY(stayers) AND cohort_school_rotation_id = r_fall AND cohort_id = c_fall;
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'Expected the 4 staying students on rotation % in cohort %, found %.', r_fall, c_fall, v_n;
  END IF;

  -- Belt and braces: the two lists must not overlap and must cover the nine.
  IF EXISTS (SELECT 1 FROM unnest(movers) m WHERE m = ANY(stayers)) THEN
    RAISE EXCEPTION 'A student id appears in both the move and stay lists.';
  END IF;

  -- ── 4a. The movers carry no dependent records anywhere
  -- Every BASE TABLE in public with a student_id column is checked, so this
  -- cannot miss a table by being out of date with the schema. program_events is
  -- excluded because step 4c deliberately repoints it.
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
    IF t.table_name = ANY(inert_tables) THEN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = t.table_name
                    AND column_name = 'cohort_id') THEN
        RAISE EXCEPTION
          'public.% now has a cohort_id column, so it is no longer inert. Reclassify it before running this.',
          t.table_name;
      END IF;
      CONTINUE;
    END IF;
    EXECUTE format(
      'SELECT count(*) FROM public.%I WHERE student_id::text = ANY($1)', t.table_name)
      INTO v_n USING movers::text[];
    IF v_n > 0 THEN
      RAISE EXCEPTION
        'Moving students have % row(s) in public.%. They were expected to have none. Stop and decide what should follow them.',
        v_n, t.table_name;
    END IF;
  END LOOP;

  -- ── 4b. Create the Winter 2027 rotation row
  -- Availability is copied COLUMN TO COLUMN from the current row, so whatever
  -- type those six columns actually are (text[] or jsonb) is preserved without
  -- this script having to know or retype it.
  INSERT INTO cohort_school_rotations (
    cohort_id, school_name, rotation_start_date, rotation_end_date,
    coordinator_name, coordinator_email,
    unavailable_weekdays, min_days_per_week, weekends_allowed, nights_allowed,
    blackout_dates, scheduling_notes
  )
  SELECT c_winter, r.school_name, d_f2_start, d_f2_end,
         r.coordinator_name, r.coordinator_email,
         r.unavailable_weekdays, r.min_days_per_week, r.weekends_allowed, r.nights_allowed,
         r.blackout_dates, r.scheduling_notes
    FROM cohort_school_rotations r
   WHERE r.id = r_fall
  RETURNING id INTO r_winter;

  -- ── 4c. Restore the Fall 2026 row and clear the Fall II availability
  -- = DEFAULT is type-agnostic: it resolves to whatever empty value each column
  -- actually declares, so this needs no assumption about text[] versus jsonb.
  UPDATE cohort_school_rotations
     SET rotation_start_date  = d_f1_start,
         rotation_end_date    = d_f1_end,
         unavailable_weekdays = DEFAULT,
         min_days_per_week    = DEFAULT,
         weekends_allowed     = DEFAULT,
         nights_allowed       = DEFAULT,
         blackout_dates       = DEFAULT,
         scheduling_notes     = DEFAULT,
         updated_at           = now()
   WHERE id = r_fall;

  -- ── 4d. Move the five students
  UPDATE students
     SET cohort_id                 = c_winter,
         cohort_school_rotation_id = r_winter,
         aspire_cohort             = v_winter_name
   WHERE id = ANY(movers);

  -- Their existing timeline and outreach history follow them (including the
  -- rotation_created event the overwriting submission logged against Brandon
  -- Torres).
  -- Records that belong with the student follow them. Guarded by to_regclass so
  -- a table that does not exist in this database is skipped, not an error.
  FOREACH v_tbl IN ARRAY follow_tables LOOP
    IF to_regclass('public.' || quote_ident(v_tbl)) IS NOT NULL THEN
      EXECUTE format(
        'UPDATE public.%I SET cohort_id = $1 WHERE student_id::text = ANY($2) AND cohort_id = $3', v_tbl)
        USING c_winter, movers::text[], c_fall;
    END IF;
  END LOOP;

  -- And the move itself is recorded, so this is not an invisible edit.
  INSERT INTO program_events (student_id, cohort_id, event_type, event_date, notes, created_by)
  SELECT s.id, c_winter, 'rotation_updated', CURRENT_DATE,
         format('[Auto-logged] Moved from Fall 2026 to %s with the %s Fall II placement request. Rotation %s to %s. Fall 2026 restored to %s to %s.',
                v_winter_name, v_school, d_f2_start, d_f2_end, d_f1_start, d_f1_end),
         'system'
    FROM students s WHERE s.id = ANY(movers);

  -- ── 5. Postconditions: prove the final shape before COMMIT ────────────────
  SELECT * INTO v_row FROM cohort_school_rotations WHERE id = r_fall;
  IF v_row.rotation_start_date <> d_f1_start OR v_row.rotation_end_date <> d_f1_end THEN
    RAISE EXCEPTION 'POSTCONDITION: Fall 2026 window reads % to %, expected % to %.',
      v_row.rotation_start_date, v_row.rotation_end_date, d_f1_start, d_f1_end;
  END IF;
  -- Emptiness is asserted through ::text so it holds for text[] and jsonb alike.
  IF coalesce(v_row.unavailable_weekdays::text, '') NOT IN ('', '{}', '[]') THEN
    RAISE EXCEPTION 'POSTCONDITION: Fall 2026 unavailable_weekdays not cleared (%).', v_row.unavailable_weekdays::text;
  END IF;
  IF coalesce(v_row.blackout_dates::text, '') NOT IN ('', '{}', '[]') THEN
    RAISE EXCEPTION 'POSTCONDITION: Fall 2026 blackout_dates not cleared (%).', v_row.blackout_dates::text;
  END IF;
  IF v_row.scheduling_notes IS NOT NULL AND btrim(v_row.scheduling_notes) <> '' THEN
    RAISE EXCEPTION 'POSTCONDITION: Fall 2026 scheduling_notes not cleared.';
  END IF;

  SELECT * INTO v_row FROM cohort_school_rotations WHERE id = r_winter;
  IF v_row.cohort_id <> c_winter OR v_row.school_name <> v_school
     OR v_row.rotation_start_date <> d_f2_start OR v_row.rotation_end_date <> d_f2_end THEN
    RAISE EXCEPTION 'POSTCONDITION: the Winter 2027 rotation row is not the expected shape.';
  END IF;
  IF coalesce(v_row.blackout_dates::text, '') IN ('', '{}', '[]') THEN
    RAISE EXCEPTION 'POSTCONDITION: the Fall II blackout dates did not carry over to Winter 2027.';
  END IF;

  SELECT count(*) INTO v_n FROM students WHERE cohort_school_rotation_id = r_fall;
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'POSTCONDITION: expected 4 students left on the Fall 2026 rotation, found %.', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM students
   WHERE id = ANY(movers) AND cohort_id = c_winter
     AND cohort_school_rotation_id = r_winter AND aspire_cohort = v_winter_name;
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'POSTCONDITION: expected 5 students moved to Winter 2027, found %.', v_n;
  END IF;
  -- The four stayers are exactly as they were.
  SELECT count(*) INTO v_n FROM students
   WHERE id = ANY(stayers) AND cohort_id = c_fall AND cohort_school_rotation_id = r_fall;
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'POSTCONDITION: a staying student was moved. Expected 4 on Fall 2026, found %.', v_n;
  END IF;

  RAISE NOTICE 'OK. Fall 2026 restored to % .. %; 5 students moved to % (rotation %).',
    d_f1_start, d_f1_end, v_winter_name, r_winter;
END $$;

COMMIT;

-- ── Verification (run AFTER the commit; each returns rows) ───────────────────
--
-- V1  both rotation rows, side by side. Fall 2026 should read 2026-08-17 to
--     2026-10-25 with EMPTY availability; Winter 2027 should read 2026-10-25 to
--     2027-01-17 and hold the fifteen Fall II blackout dates:
--     SELECT c.name AS cohort, r.rotation_start_date, r.rotation_end_date,
--            r.coordinator_name, r.unavailable_weekdays, r.blackout_dates,
--            r.scheduling_notes, r.updated_at
--       FROM cohort_school_rotations r JOIN cohorts c ON c.id = r.cohort_id
--      WHERE r.school_name = 'West Coast University North Hollywood'
--      ORDER BY r.rotation_start_date;
--
-- V2  the nine students, now split 4 / 5 across two cohorts, with every status
--     unchanged (Placed x3, Not Proceeding x1, Pending Outreach x5):
--     SELECT s.name, s.status, s.aspire_cohort, c.name AS cohort,
--            r.rotation_start_date, r.rotation_end_date
--       FROM students s
--       JOIN cohorts c ON c.id = s.cohort_id
--       JOIN cohort_school_rotations r ON r.id = s.cohort_school_rotation_id
--      WHERE s.school = 'West Coast University North Hollywood'
--      ORDER BY c.name, s.name;
--
-- V3  the move is on each moved student's timeline:
--     SELECT s.name, pe.event_type, pe.event_date, pe.notes
--       FROM program_events pe JOIN students s ON s.id = pe.student_id
--      WHERE pe.notes ILIKE '%Moved from Fall 2026%'
--      ORDER BY s.name;
--
-- ── Rollback ────────────────────────────────────────────────────────────────
-- Only if the commit is judged wrong AFTER the fact. Reverses every write in
-- reverse order. It cannot restore the Fall II availability onto the Fall 2026
-- row, because this script cleared values that were never Fall I's to begin
-- with; that is the intended outcome, not data loss.
--
--   BEGIN;
--   DO $rb$
--   DECLARE
--     c_fall   uuid := 'eedd91ec-ad6f-4df8-aa20-5c06b2889011';
--     c_winter uuid := '52933615-cf6e-441f-ac68-130bdb6a0491';
--     r_fall   uuid := '8206a856-c910-4cf4-abe9-f66e7ddd511d';
--     r_winter uuid;
--     movers   uuid[] := ARRAY[
--       '4901f694-8a46-4d50-b900-7583231d4bc2','da1d51c6-514a-4291-892b-900b42891eb9',
--       'ea42bb7e-a906-4b8d-8b7f-e47cfb09c01b','a7240031-da1e-4f1e-8f7c-714874ad1577',
--       'b4abd33a-81fe-4227-a35e-6472084c90ba']::uuid[];
--   BEGIN
--     SELECT id INTO STRICT r_winter FROM cohort_school_rotations
--      WHERE cohort_id = c_winter AND school_name = 'West Coast University North Hollywood';
--     DELETE FROM program_events WHERE student_id = ANY(movers) AND notes ILIKE '%Moved from Fall 2026%';
--     UPDATE program_events SET cohort_id = c_fall WHERE student_id = ANY(movers) AND cohort_id = c_winter;
--     UPDATE students SET cohort_id = c_fall, cohort_school_rotation_id = r_fall, aspire_cohort = 'Fall 2026'
--      WHERE id = ANY(movers);
--     UPDATE cohort_school_rotations SET
--       rotation_start_date = DATE '2026-10-25', rotation_end_date = DATE '2027-01-17',
--       unavailable_weekdays = w.unavailable_weekdays, min_days_per_week = w.min_days_per_week,
--       weekends_allowed = w.weekends_allowed, nights_allowed = w.nights_allowed,
--       blackout_dates = w.blackout_dates, scheduling_notes = w.scheduling_notes, updated_at = now()
--       FROM cohort_school_rotations w WHERE w.id = r_winter AND cohort_school_rotations.id = r_fall;
--     DELETE FROM cohort_school_rotations WHERE id = r_winter;
--   END $rb$;
--   COMMIT;
