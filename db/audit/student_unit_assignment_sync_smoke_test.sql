-- =============================================================================
-- student_unit_assignment sync smoke test  (MULTI-UNIT-STUDENT-PLACEMENTS-2)
-- Owner-run, AFTER applying 20260817000000. EVERYTHING HERE ROLLS BACK.
-- =============================================================================
--
-- WHAT THIS PROVES, executably:
--   • BOTH sync directions: a classic matched_unit_id write materializes the
--     active-primary assignment row, and an assignment write projects back
--     into students.matched_unit_id;
--   • classic REMATCH ends the old primary and creates (or PROMOTES) the new
--     one - never a duplicate; classic UNMATCH ends the primary;
--   • set_primary_unit_assignment() changes the primary ATOMICALLY: the old
--     primary is ended, the new one lands, and matched_unit_id is already
--     projected inside the same transaction;
--   • a CROSS-COHORT classic match is REJECTED by the trigger and the ENTIRE
--     statement rolls back: matched_unit_id, the assignment rows, and the row
--     count are proven UNCHANGED afterward (never "insert nothing" drift);
--     the RPC refuses the same unit with 'unit_not_in_student_cohort';
--   • ending the active primary projects matched_unit_id to NULL.
--
-- FIXTURES ARE SYNTHETIC AND TRANSACTION-LOCAL. The test creates its own
-- cohorts, units, and student inside the transaction (names prefixed
-- 'ZZ SYNC'), never reads or targets a production row, and the final ROLLBACK
-- removes every trace. The actor id passed to the RPC is NULL on purpose: no
-- synthetic user_profiles row is created, and ended_by/assigned_by are
-- nullable by design. No placeholders to substitute; paste and run as-is.
--
-- EXPECTED OUTPUT: a series of 'ok: ...' notices ending in
-- 'ALL SYNC SMOKE TESTS PASSED', then ROLLBACK, then a trailing count of 0.
-- Any 'SMOKE TEST FAILURE' error means the sync misbehaved, and the
-- transaction aborts (still leaving no trace).
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_cohort       uuid;
  v_other_cohort uuid;
  v_student      uuid;
  v_unit_a       uuid;   -- 'ZZ SYNC Unit A' in the student's cohort
  v_unit_b       uuid;   -- 'ZZ SYNC Unit B' in the student's cohort
  v_unit_c       uuid;   -- 'ZZ SYNC Unit C' in the student's cohort
  v_unit_other   uuid;   -- 'ZZ SYNC Other-Cohort Unit' in the OTHER cohort
  v_matched      uuid;
  v_count        integer;
  v_status       text;
  v_result       jsonb;
BEGIN
  -- ── Fixtures (synthetic; rolled back with everything else) ────────────────
  INSERT INTO public.cohorts (name, status) VALUES ('ZZ SYNC TEST COHORT', 'Archived')
    RETURNING id INTO v_cohort;
  INSERT INTO public.cohorts (name, status) VALUES ('ZZ SYNC TEST OTHER COHORT', 'Archived')
    RETURNING id INTO v_other_cohort;

  INSERT INTO public.units (unit_name, cohort_id, total_slots)
    VALUES ('ZZ SYNC Unit A', v_cohort, 1) RETURNING id INTO v_unit_a;
  INSERT INTO public.units (unit_name, cohort_id, total_slots)
    VALUES ('ZZ SYNC Unit B', v_cohort, 1) RETURNING id INTO v_unit_b;
  INSERT INTO public.units (unit_name, cohort_id, total_slots)
    VALUES ('ZZ SYNC Unit C', v_cohort, 1) RETURNING id INTO v_unit_c;
  INSERT INTO public.units (unit_name, cohort_id, total_slots)
    VALUES ('ZZ SYNC Other-Cohort Unit', v_other_cohort, 1) RETURNING id INTO v_unit_other;

  INSERT INTO public.students (name, first_name, last_name, cohort_id)
    VALUES ('ZZ SYNC Student', 'ZZ', 'Sync', v_cohort) RETURNING id INTO v_student;

  -- ── 1. Direction 1: classic MATCH materializes the primary row ────────────
  UPDATE public.students SET matched_unit_id = v_unit_a WHERE id = v_student;

  SELECT count(*) INTO v_count FROM public.student_unit_assignments
   WHERE student_id = v_student AND unit_id = v_unit_a
     AND role = 'primary' AND status = 'active'
     AND unit_key = 'ZZ SYNC Unit A';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: classic match did not create the active primary (found %)', v_count;
  END IF;
  RAISE NOTICE 'ok: classic match created the active primary with derived unit_key';

  -- ── 2. Classic REMATCH: old primary ends, new one is created ──────────────
  UPDATE public.students SET matched_unit_id = v_unit_b WHERE id = v_student;

  SELECT status INTO v_status FROM public.student_unit_assignments
   WHERE student_id = v_student AND unit_id = v_unit_a AND role = 'primary';
  IF v_status IS DISTINCT FROM 'ended' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: rematch did not end the old primary (status %)', v_status;
  END IF;
  SELECT count(*) INTO v_count FROM public.student_unit_assignments
   WHERE student_id = v_student AND unit_id = v_unit_b
     AND role = 'primary' AND status = 'active';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: rematch did not create the new primary (found %)', v_count;
  END IF;
  RAISE NOTICE 'ok: classic rematch ended the old primary and created the new one';

  -- ── 3. Rematch onto an EXISTING live row PROMOTES it (no duplicate) ───────
  -- A planned additional row for unit C exists first; matching to C must
  -- promote that row rather than inserting a second live row for the unit.
  INSERT INTO public.student_unit_assignments (student_id, cohort_id, unit_id, role, status)
    VALUES (v_student, v_cohort, v_unit_c, 'additional', 'planned');

  -- The insert above fired the projection trigger; the active primary is
  -- still unit B, so matched_unit_id must NOT have moved.
  SELECT matched_unit_id INTO v_matched FROM public.students WHERE id = v_student;
  IF v_matched IS DISTINCT FROM v_unit_b THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: a non-primary insert moved matched_unit_id (now %)', v_matched;
  END IF;

  UPDATE public.students SET matched_unit_id = v_unit_c WHERE id = v_student;

  SELECT count(*) INTO v_count FROM public.student_unit_assignments
   WHERE student_id = v_student AND unit_id = v_unit_c;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: promote created a duplicate row for the unit (found %)', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.student_unit_assignments
   WHERE student_id = v_student AND unit_id = v_unit_c
     AND role = 'primary' AND status = 'active';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: the live row was not promoted to active primary';
  END IF;
  RAISE NOTICE 'ok: rematch promoted the existing live row - no duplicate';

  -- ── 4. Classic UNMATCH ends the primary ───────────────────────────────────
  UPDATE public.students SET matched_unit_id = NULL WHERE id = v_student;

  SELECT count(*) INTO v_count FROM public.student_unit_assignments
   WHERE student_id = v_student AND role = 'primary' AND status = 'active';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: unmatch left an active primary (found %)', v_count;
  END IF;
  RAISE NOTICE 'ok: classic unmatch ended the primary';

  -- ── 5. Atomic RPC primary change, matched projected in-transaction ────────
  v_result := public.set_primary_unit_assignment(v_student, v_unit_a, NULL, DATE '2026-08-01');
  IF (v_result->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: RPC refused a valid primary change (%)', v_result;
  END IF;
  SELECT matched_unit_id INTO v_matched FROM public.students WHERE id = v_student;
  IF v_matched IS DISTINCT FROM v_unit_a THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: RPC did not project matched_unit_id in-transaction (now %)', v_matched;
  END IF;

  v_result := public.set_primary_unit_assignment(v_student, v_unit_b, NULL, NULL);
  IF (v_result->>'previous_unit_id')::uuid IS DISTINCT FROM v_unit_a
     OR (v_result->>'new_unit_id')::uuid IS DISTINCT FROM v_unit_b THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: RPC audit payload wrong (%)', v_result;
  END IF;
  SELECT status INTO v_status FROM public.student_unit_assignments
   WHERE student_id = v_student AND unit_id = v_unit_a
   ORDER BY created_at DESC LIMIT 1;
  IF v_status IS DISTINCT FROM 'ended' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: RPC did not end the outgoing primary (status %)', v_status;
  END IF;
  SELECT matched_unit_id INTO v_matched FROM public.students WHERE id = v_student;
  IF v_matched IS DISTINCT FROM v_unit_b THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: RPC change did not land in matched_unit_id (now %)', v_matched;
  END IF;
  RAISE NOTICE 'ok: RPC primary change is atomic - old ended, new active, matched projected';

  -- ── 6. The RPC refuses a unit outside the student cohort ─────────────────
  v_result := public.set_primary_unit_assignment(v_student, v_unit_other, NULL, NULL);
  IF (v_result->>'ok')::boolean IS DISTINCT FROM false
     OR v_result->>'error' IS DISTINCT FROM 'unit_not_in_student_cohort' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: RPC accepted a cross-cohort unit (%)', v_result;
  END IF;
  SELECT matched_unit_id INTO v_matched FROM public.students WHERE id = v_student;
  IF v_matched IS DISTINCT FROM v_unit_b THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: refused RPC still moved matched_unit_id (now %)', v_matched;
  END IF;
  RAISE NOTICE 'ok: RPC refuses a cross-cohort unit (unit_not_in_student_cohort)';

  -- ── 7. CROSS-COHORT classic match: REJECTED, prior state UNCHANGED ────────
  -- The whole point of the correction: the trigger must raise BEFORE mutating
  -- anything, so the failed statement leaves matched_unit_id AND every
  -- assignment row exactly as they were - never "insert nothing" drift.
  SELECT count(*) INTO v_count FROM public.student_unit_assignments
   WHERE student_id = v_student;

  BEGIN
    UPDATE public.students SET matched_unit_id = v_unit_other WHERE id = v_student;
    RAISE EXCEPTION 'SMOKE TEST FAILURE: cross-cohort classic match was accepted';
  EXCEPTION WHEN raise_exception THEN
    -- Our own failure marker is also P0001 - discriminate on the message.
    IF position('cross-cohort match rejected' in SQLERRM) > 0 THEN
      RAISE NOTICE 'ok: cross-cohort classic match rejected by the trigger';
    ELSE
      RAISE;   -- the SMOKE TEST FAILURE above, or an unexpected error: abort
    END IF;
  END;

  -- Prior state proven unchanged: matched still unit B, unit B still the one
  -- active primary, and not a single assignment row appeared or changed state.
  SELECT matched_unit_id INTO v_matched FROM public.students WHERE id = v_student;
  IF v_matched IS DISTINCT FROM v_unit_b THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: rejected match still changed matched_unit_id (now %)', v_matched;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.student_unit_assignments
    WHERE student_id = v_student AND unit_id = v_unit_b
      AND role = 'primary' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: rejected match still ended the active primary';
  END IF;
  IF (SELECT count(*) FROM public.student_unit_assignments WHERE student_id = v_student)
     IS DISTINCT FROM v_count THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: rejected match changed the assignment row count';
  END IF;
  RAISE NOTICE 'ok: rejection preserved matched_unit_id, the active primary, and the row count';

  -- ── 8. Direction 2: ending the active primary projects NULL ───────────────
  UPDATE public.student_unit_assignments
     SET status = 'ended', ended_at = now()
   WHERE student_id = v_student AND unit_id = v_unit_b
     AND role = 'primary' AND status = 'active';

  SELECT matched_unit_id INTO v_matched FROM public.students WHERE id = v_student;
  IF v_matched IS NOT NULL THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: ending the primary left matched_unit_id = %', v_matched;
  END IF;
  RAISE NOTICE 'ok: ending the active primary projected matched_unit_id to NULL';

  -- ── 9. Direction 2: inserting an active primary projects it back ──────────
  INSERT INTO public.student_unit_assignments (student_id, cohort_id, unit_id, role, status)
    VALUES (v_student, v_cohort, v_unit_c, 'primary', 'active');

  SELECT matched_unit_id INTO v_matched FROM public.students WHERE id = v_student;
  IF v_matched IS DISTINCT FROM v_unit_c THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: inserted active primary was not projected (now %)', v_matched;
  END IF;
  RAISE NOTICE 'ok: an inserted active primary projects into matched_unit_id';

  RAISE NOTICE 'ALL SYNC SMOKE TESTS PASSED';
END;
$$;

ROLLBACK;

-- Nothing persists - this runs AFTER the rollback and must return 0:
SELECT count(*) AS zz_sync_fixture_rows_remaining
FROM public.cohorts WHERE name LIKE 'ZZ SYNC%';
-- =============================================================================
