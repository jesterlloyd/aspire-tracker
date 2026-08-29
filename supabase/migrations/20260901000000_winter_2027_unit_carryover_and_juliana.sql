-- ############################################################################
-- WINTER 2027 SETUP: carry Fall 2026's unused unit capacity into Winter 2027,
-- and duplicate Juliana Pilla as a fresh Winter 2027 pipeline entrant.
--
-- Owner-gated. NOT auto-applied. Data-only: no DDL, no schema change.
-- Run AFTER 20260830000000 and 20260831000000 (the term-split repairs): the
-- Juliana insert attaches to the Winter 2027 WCU NoHo rotation row those
-- scripts created, and fails closed if it is absent.
--
-- WHY (decided 2026-08-29)
-- Fall 2026 and Winter 2027 overlap, so the units are NOT being asked to host
-- again. Whatever capacity they offered for Fall and nobody used carries over
-- as their Winter offer:
--   * Every Fall 2026 unit with is_participating = true AND slots_remaining > 0
--     gets a Winter 2027 units row whose total_slots AND slots_remaining both
--     equal the Fall leftover. A unit that offered 2 and hosted 1 arrives in
--     Winter offering 1. Fall rows are untouched.
--   * Their unit_cohort_responses rows are copied too (slots_offered = the
--     carried number, original submitter and submitted_at preserved), so At a
--     Glance shows Winter as ANSWERED rather than nagging for re-outreach.
--   * Fully-used units (6 South, ACU/CDU) and not-hosting units (3 North,
--     4 North, Float Pool, Labor & Delivery) do not carry, and their "no" is
--     NOT copied: they were not asked about Winter.
--
-- The Owner's discovery (2026-08-29) verified total_slots - matched_students =
-- slots_remaining for every participating Fall unit, so slots_remaining is the
-- trustworthy carry number. This script re-proves that consistency in-lock
-- before writing, and pins the exact 18-unit, 22-slot expected shape.
--
-- Rows are cloned via to_jsonb -> jsonb_populate_record with explicit
-- overrides, so EVERY column the live schema actually has is carried
-- faithfully (division, patient_population, notes, anything added since) and
-- nothing is silently dropped by a hand-typed column list.
--
-- JULIANA PILLA (decided 2026-08-29): Tony Kim's Fall II submission listed her,
-- but the duplicate-safe upsert matched her existing Fall 2026 row by email and
-- only refreshed seed fields, so she never got a Fall II record. Her Fall 2026
-- row (Not Proceeding) is history and is NEVER written to. This inserts a NEW
-- Winter 2027 row seeded exactly as that submission would have created her:
-- identity, school email, phone, program, hours, graduation, coordinator
-- fields, linked to the Winter NoHo rotation row, status Pending Outreach,
-- everything student-owned left empty. She will fill the intake form anew -
-- INCLUDING her top-three units (her old #3, 6 South, was consumed in Fall and
-- does not exist in Winter).
--
-- NOTE, NOT SQL: do not resend her the intake form until Winter 2027 becomes
-- the accepting cohort. The public form resolves students inside the ONE
-- accepting cohort, which today is Fall 2026, so it would match her old Not
-- Proceeding row instead of this one.
--
-- SAFETY
--   * All qualifying Fall unit rows are locked FOR UPDATE before any check.
--   * The expected carry set is PINNED (18 unit ids with their exact remaining
--     counts, summing to 22); any deviation aborts.
--   * Winter 2027 must have ZERO units rows and ZERO response rows: this is a
--     first population, never a merge.
--   * Fails closed and rolls back on ANY deviation, including postconditions.
--     Re-running after success fails on the Winter-is-empty check.
-- ############################################################################

BEGIN;

DO $$
DECLARE
  c_fall   uuid := 'eedd91ec-ad6f-4df8-aa20-5c06b2889011';  -- Fall 2026, Active
  c_winter uuid := '52933615-cf6e-441f-ac68-130bdb6a0491';  -- Winter 2027, Planning
  s_juliana_fall uuid := 'd6ff6ac4-94c0-4818-935a-e5bde2c07c00';
  v_school text := 'West Coast University North Hollywood';

  -- The pinned carry set (Owner discovery 2026-08-29): Fall unit id -> the
  -- unused slots that carry. 18 units, 22 slots.
  v_expected jsonb := '{
    "dbdbe02a-c7b1-4808-ae64-e928812d1016": 1,
    "a034d6fa-ffd3-4a47-9608-5bbfb672d448": 1,
    "c09638f8-f48d-4ff5-9044-9b64625d52ca": 1,
    "89561136-df3f-4ea5-b637-b60ddf6a81af": 1,
    "8ca76460-8368-47d1-9432-23fc910c10b1": 1,
    "ee74e154-ca5a-42be-bfe2-092a36f90f68": 1,
    "c18b77d8-5863-4681-bc0f-00c35ac8ef8d": 2,
    "33d22e71-859d-42fb-b28e-ff68ce4aaebe": 1,
    "2c67427c-9fe4-4025-844e-70d7f2e0d79d": 1,
    "3235a69d-6bcd-4c52-a066-42ac4b802070": 1,
    "6b655d1b-5a1e-45ad-92e9-f1c2d45da3b1": 3,
    "2ed58d91-559b-4fdc-bf28-66d07700fab9": 2,
    "6badd8db-894b-4774-b154-88840516b68d": 1,
    "c6177339-93b0-4e9b-b5b5-2f305945f28b": 1,
    "1a56c544-07ae-44e1-aba1-f1b61883167a": 1,
    "4c60305c-978c-441f-990b-b1d2e302a13e": 2,
    "68cd0214-e5b6-4083-88c0-1d08f9cd77d1": 1,
    "f71d862c-7251-4b5d-8915-518a7b15fd1e": 2
  }'::jsonb;

  fall_unit  units%ROWTYPE;
  jr         students%ROWTYPE;
  v_new_unit uuid;
  v_rot      uuid;
  v_matched  bigint;
  v_n        bigint;
  v_slots    bigint;
BEGIN
  -- ── 1. Winter 2027 exists, and is EMPTY of units and responses ────────────
  PERFORM 1 FROM cohorts WHERE id = c_winter AND name = 'Winter 2027' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Winter 2027 cohort % not found by id+name. Stop and re-run discovery.', c_winter;
  END IF;
  SELECT count(*) INTO v_n FROM units WHERE cohort_id = c_winter;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Winter 2027 already has % units row(s). This is a first population, not a merge. Either this already ran or Set Up Units was used; stop and reconcile.', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM unit_cohort_responses WHERE cohort_id = c_winter;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Winter 2027 already has % response row(s). Stop and reconcile.', v_n;
  END IF;

  -- ── 2. Lock the qualifying Fall units and PROVE the pinned carry set ──────
  PERFORM 1 FROM units
   WHERE cohort_id = c_fall AND is_participating = true AND slots_remaining > 0
   FOR UPDATE;

  SELECT count(*), coalesce(sum(slots_remaining), 0) INTO v_n, v_slots
    FROM units
   WHERE cohort_id = c_fall AND is_participating = true AND slots_remaining > 0;
  IF v_n <> 18 OR v_slots <> 22 THEN
    RAISE EXCEPTION
      'Expected 18 qualifying Fall units carrying 22 slots, found % carrying %. Slots have moved since discovery; stop and re-run it.',
      v_n, v_slots;
  END IF;

  FOR fall_unit IN
    SELECT * FROM units
     WHERE cohort_id = c_fall AND is_participating = true AND slots_remaining > 0
     ORDER BY unit_name
  LOOP
    IF NOT (v_expected ? fall_unit.id::text) THEN
      RAISE EXCEPTION 'Unit "%" (%) qualifies but is not in the pinned carry set. Stop and re-run discovery.',
        fall_unit.unit_name, fall_unit.id;
    END IF;
    IF (v_expected ->> fall_unit.id::text)::int <> fall_unit.slots_remaining THEN
      RAISE EXCEPTION 'Unit "%" now has % remaining, pinned %. Stop and re-run discovery.',
        fall_unit.unit_name, fall_unit.slots_remaining, (v_expected ->> fall_unit.id::text)::int;
    END IF;
    -- Re-prove the ledger in-lock: total - matched must equal remaining.
    SELECT count(*) INTO v_matched FROM students WHERE matched_unit_id = fall_unit.id;
    IF fall_unit.total_slots - v_matched <> fall_unit.slots_remaining THEN
      RAISE EXCEPTION
        'Unit "%" ledger is inconsistent: total % - matched % <> remaining %. Fix the ledger first.',
        fall_unit.unit_name, fall_unit.total_slots, v_matched, fall_unit.slots_remaining;
    END IF;

    -- ── 3. Clone the unit into Winter 2027 at leftover capacity ─────────────
    -- to_jsonb carries EVERY column the schema has; only what must differ is
    -- overridden. created_at/updated_at are refreshed when those columns exist
    -- (|| on jsonb only replaces keys that are present in the left operand).
    v_new_unit := gen_random_uuid();
    INSERT INTO units
    SELECT (jsonb_populate_record(
      NULL::units,
      to_jsonb(u) || jsonb_build_object(
        'id',              v_new_unit,
        'cohort_id',       c_winter,
        'total_slots',     u.slots_remaining,
        'slots_remaining', u.slots_remaining
      )
      || CASE WHEN to_jsonb(u) ? 'created_at' THEN jsonb_build_object('created_at', now()) ELSE '{}'::jsonb END
      || CASE WHEN to_jsonb(u) ? 'updated_at' THEN jsonb_build_object('updated_at', now()) ELSE '{}'::jsonb END
    )).*
    FROM units u WHERE u.id = fall_unit.id;

    -- ── 4. Copy the unit's Fall response as its Winter answer ───────────────
    -- The decision IS "their Fall answer stands for Winter", so the submitter
    -- and submitted_at are preserved as the true provenance of that answer;
    -- only the offer is scaled to what actually carries.
    INSERT INTO unit_cohort_responses
    SELECT (jsonb_populate_record(
      NULL::unit_cohort_responses,
      to_jsonb(r) || jsonb_build_object(
        'id',              gen_random_uuid(),
        'cohort_id',       c_winter,
        'unit_id',         v_new_unit,
        'slots_offered',   fall_unit.slots_remaining,
        'last_updated_at', now()
      )
      || CASE WHEN to_jsonb(r) ? 'created_at' THEN jsonb_build_object('created_at', now()) ELSE '{}'::jsonb END
    )).*
    FROM unit_cohort_responses r
    WHERE r.cohort_id = c_fall AND r.unit_id = fall_unit.id;
    -- Every carried unit responded (discovery showed 18/18); a missing row
    -- means the ledger and the response table disagree.
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'Unit "%" has % Fall response row(s), expected exactly 1. Stop and reconcile.',
        fall_unit.unit_name, v_n;
    END IF;
  END LOOP;

  -- ── 5. Juliana Pilla: fresh Winter 2027 pipeline entrant ──────────────────
  SELECT * INTO jr FROM students WHERE id = s_juliana_fall FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Juliana Pilla (%) not found. Stop and re-run discovery.', s_juliana_fall;
  END IF;
  IF jr.cohort_id <> c_fall OR jr.status <> 'Not Proceeding' THEN
    RAISE EXCEPTION 'Juliana''s Fall row is (cohort %, status %), expected (Fall 2026, Not Proceeding). Stop and re-run discovery.',
      jr.cohort_id, jr.status;
  END IF;
  -- The Winter NoHo rotation row created by 20260830000000.
  SELECT id INTO STRICT v_rot FROM cohort_school_rotations
   WHERE cohort_id = c_winter AND school_name = v_school;
  -- Never a second Winter row for her.
  SELECT count(*) INTO v_n FROM students
   WHERE cohort_id = c_winter
     AND lower(btrim(school_email)) = lower(btrim(jr.school_email));
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Juliana already has % Winter 2027 row(s). Stop; this already ran or she was re-added.', v_n;
  END IF;

  INSERT INTO students (
    name, first_name, last_name, school_email, phone, school, program_type,
    course_type, hours_required, hours_completed,
    estimated_graduation_date, estimated_graduation,
    status, interview_outcome, ngrp_outcome,
    submitted_via,
    placement_request_last_source,
    placement_request_last_submitted_by_profile_id,
    placement_request_last_submitted_at,
    school_coordinator_name, school_coordinator_email, coordinators,
    aspire_cohort, gpa_verified, bls_current, health_cleared, background_check,
    cohort_id, cohort_school_rotation_id
  ) VALUES (
    jr.name, jr.first_name, jr.last_name, jr.school_email, jr.phone, jr.school,
    jr.program_type, jr.course_type, jr.hours_required, 0,
    jr.estimated_graduation_date, jr.estimated_graduation,
    'Pending Outreach', 'Pending Interview', 'Pending',
    'academic_partner_portal',
    jr.placement_request_last_source,
    jr.placement_request_last_submitted_by_profile_id,
    jr.placement_request_last_submitted_at,
    jr.school_coordinator_name, jr.school_coordinator_email, jr.coordinators,
    'Winter 2027', false, false, false, false,
    c_winter, v_rot
  );

  INSERT INTO program_events (student_id, cohort_id, event_type, event_date, notes, created_by)
  SELECT s.id, c_winter, 'rotation_created', CURRENT_DATE,
         '[Auto-logged] Fresh Winter 2027 record created from the Fall II placement request (Tony Kim listed her on 2026-08-27). Fall 2026 record and its Not Proceeding outcome are unchanged. Student will resubmit the intake form.',
         'system'
    FROM students s
   WHERE s.cohort_id = c_winter
     AND lower(btrim(s.school_email)) = lower(btrim(jr.school_email));

  -- ── 6. Postconditions: prove the final shape before COMMIT ────────────────
  SELECT count(*), coalesce(sum(total_slots), 0) INTO v_n, v_slots
    FROM units WHERE cohort_id = c_winter;
  IF v_n <> 18 OR v_slots <> 22 THEN
    RAISE EXCEPTION 'POSTCONDITION: Winter 2027 has % units carrying %, expected 18 carrying 22.', v_n, v_slots;
  END IF;
  SELECT count(*) INTO v_n FROM units
   WHERE cohort_id = c_winter AND (total_slots <> slots_remaining OR is_participating IS DISTINCT FROM true);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'POSTCONDITION: % Winter unit(s) are not clean full-availability rows.', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM unit_cohort_responses
   WHERE cohort_id = c_winter AND response_status = 'submitted_hosting';
  IF v_n <> 18 THEN
    RAISE EXCEPTION 'POSTCONDITION: Winter 2027 has % hosting responses, expected 18.', v_n;
  END IF;
  -- Winter offers equal Winter capacity, row by row.
  SELECT count(*) INTO v_n
    FROM unit_cohort_responses r JOIN units u ON u.id = r.unit_id
   WHERE r.cohort_id = c_winter AND r.slots_offered <> u.total_slots;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'POSTCONDITION: % Winter response(s) disagree with their unit''s slots.', v_n;
  END IF;
  -- Fall is untouched: same 18 qualifying rows, same remaining counts.
  SELECT count(*), coalesce(sum(slots_remaining), 0) INTO v_n, v_slots
    FROM units
   WHERE cohort_id = c_fall AND is_participating = true AND slots_remaining > 0;
  IF v_n <> 18 OR v_slots <> 22 THEN
    RAISE EXCEPTION 'POSTCONDITION: Fall 2026 changed (% units, % remaining). It must not have.', v_n, v_slots;
  END IF;
  -- Juliana: exactly one fresh Winter row; the Fall row exactly as it was.
  SELECT count(*) INTO v_n FROM students
   WHERE cohort_id = c_winter AND lower(btrim(school_email)) = lower(btrim(jr.school_email))
     AND status = 'Pending Outreach' AND cohort_school_rotation_id = v_rot
     AND coalesce(unit_preference_1, '') = '';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'POSTCONDITION: expected exactly 1 fresh Winter row for Juliana, found %.', v_n;
  END IF;
  PERFORM 1 FROM students
   WHERE id = s_juliana_fall AND cohort_id = c_fall AND status = 'Not Proceeding';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POSTCONDITION: Juliana''s Fall 2026 row changed. It must not have.';
  END IF;

  RAISE NOTICE 'OK. 18 units carried to Winter 2027 (22 slots), 18 responses copied, Juliana Pilla duplicated fresh.';
END $$;

COMMIT;

-- ── Verification (run AFTER the commit; each returns rows) ───────────────────
--
-- V1  the Winter 2027 unit pool: 18 rows, total = remaining everywhere, 22 in
--     all, contacts and shift preferences carried:
--     SELECT u.unit_name, u.total_slots, u.slots_remaining, u.contact_person,
--            u.shift_preference, r.slots_offered, r.submitted_by_name, r.submitted_at
--       FROM units u
--       LEFT JOIN unit_cohort_responses r ON r.unit_id = u.id
--      WHERE u.cohort_id = '52933615-cf6e-441f-ac68-130bdb6a0491'
--      ORDER BY u.unit_name;
--
-- V2  Fall 2026 is byte-for-byte where it was (compare with your discovery):
--     SELECT unit_name, is_participating, total_slots, slots_remaining
--       FROM units WHERE cohort_id = 'eedd91ec-ad6f-4df8-aa20-5c06b2889011'
--      ORDER BY unit_name;
--
-- V3  Juliana, both records: Fall Not Proceeding untouched, Winter fresh:
--     SELECT s.name, c.name AS cohort, s.status, s.interview_outcome,
--            s.unit_preference_1, s.hours_required, s.submitted_via
--       FROM students s JOIN cohorts c ON c.id = s.cohort_id
--      WHERE lower(btrim(s.school_email)) = (
--        SELECT lower(btrim(school_email)) FROM students
--         WHERE id = 'd6ff6ac4-94c0-4818-935a-e5bde2c07c00')
--      ORDER BY c.name;
--
-- ── Rollback ────────────────────────────────────────────────────────────────
-- Winter 2027 was proven empty before this ran, so removal IS the reversal.
--
--   BEGIN;
--   DELETE FROM program_events WHERE cohort_id = '52933615-cf6e-441f-ac68-130bdb6a0491'
--     AND notes ILIKE '%Fresh Winter 2027 record created from the Fall II placement request%';
--   DELETE FROM students WHERE cohort_id = '52933615-cf6e-441f-ac68-130bdb6a0491'
--     AND lower(btrim(school_email)) = (
--       SELECT lower(btrim(school_email)) FROM students
--        WHERE id = 'd6ff6ac4-94c0-4818-935a-e5bde2c07c00');
--   DELETE FROM unit_cohort_responses WHERE cohort_id = '52933615-cf6e-441f-ac68-130bdb6a0491';
--   DELETE FROM units WHERE cohort_id = '52933615-cf6e-441f-ac68-130bdb6a0491';
--   COMMIT;
