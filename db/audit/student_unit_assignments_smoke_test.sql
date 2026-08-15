-- =============================================================================
-- student_unit_assignments smoke test  (MULTI-UNIT-STUDENT-PLACEMENTS-1)
-- Owner-run, AFTER applying 20260816000000. EVERYTHING HERE ROLLS BACK.
-- =============================================================================
--
-- WHAT THIS PROVES, executably:
--   • two and three concurrent units insert cleanly (no cap exists);
--   • every forbidden shape is REJECTED by the exact constraint or trigger
--     built for it - and each rejection runs in its own exception block, so an
--     unexpected success FAILS the test loudly while an expected rejection
--     lets the remaining checks continue;
--   • deleting a unit with a LIVE assignment is blocked; ending the assignment
--     releases the unit for deletion and history keeps its unit_key.
--
-- FIXTURES ARE SYNTHETIC AND TRANSACTION-LOCAL. The test creates its own
-- cohorts, units, and student inside the transaction (names prefixed
-- 'ZZ SMOKE'), never reads or targets a production row, and the final ROLLBACK
-- removes every trace. No placeholders to substitute; paste and run as-is.
--
-- EXPECTED OUTPUT: a series of 'ok: ...' notices ending in
-- 'ALL SMOKE TESTS PASSED', then ROLLBACK. Any 'SMOKE TEST FAILURE' error
-- means an invalid operation unexpectedly succeeded, and the transaction
-- aborts (still leaving no trace).
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_cohort       uuid;
  v_other_cohort uuid;
  v_student      uuid;
  v_unit_a       uuid;   -- 'ZZ SMOKE Unit A' in the student's cohort
  v_unit_b       uuid;   -- 'ZZ SMOKE Unit B' in the student's cohort
  v_unit_c       uuid;   -- 'ZZ SMOKE Unit C' in the student's cohort
  v_unit_d       uuid;   -- 'ZZ SMOKE Unit D' - the one allowed planned successor
  v_unit_e       uuid;   -- 'ZZ SMOKE Unit E' - used to prove a SECOND successor is rejected
  v_unit_other   uuid;   -- 'ZZ SMOKE Other-Cohort Unit' in the OTHER cohort
  v_key          text;
  v_count        integer;
BEGIN
  -- ── Fixtures (synthetic; rolled back with everything else) ────────────────
  INSERT INTO public.cohorts (name, status) VALUES ('ZZ SMOKE TEST COHORT', 'Archived')
    RETURNING id INTO v_cohort;
  INSERT INTO public.cohorts (name, status) VALUES ('ZZ SMOKE TEST OTHER COHORT', 'Archived')
    RETURNING id INTO v_other_cohort;

  INSERT INTO public.units (unit_name, cohort_id, total_slots)
    VALUES ('ZZ SMOKE Unit A', v_cohort, 1) RETURNING id INTO v_unit_a;
  INSERT INTO public.units (unit_name, cohort_id, total_slots)
    VALUES ('ZZ SMOKE Unit B', v_cohort, 1) RETURNING id INTO v_unit_b;
  INSERT INTO public.units (unit_name, cohort_id, total_slots)
    VALUES ('ZZ SMOKE Unit C', v_cohort, 1) RETURNING id INTO v_unit_c;
  INSERT INTO public.units (unit_name, cohort_id, total_slots)
    VALUES ('ZZ SMOKE Unit D', v_cohort, 1) RETURNING id INTO v_unit_d;
  INSERT INTO public.units (unit_name, cohort_id, total_slots)
    VALUES ('ZZ SMOKE Unit E', v_cohort, 1) RETURNING id INTO v_unit_e;
  INSERT INTO public.units (unit_name, cohort_id, total_slots)
    VALUES ('ZZ SMOKE Other-Cohort Unit', v_other_cohort, 1) RETURNING id INTO v_unit_other;

  INSERT INTO public.students (name, first_name, last_name, cohort_id)
    VALUES ('ZZ SMOKE Student', 'ZZ', 'Smoke', v_cohort) RETURNING id INTO v_student;

  -- ── Happy path: one primary + two ADDITIONAL CONCURRENT units, all live ───
  -- Every live row carries a real unit_id (chk_sua_live_requires_unit).
  INSERT INTO public.student_unit_assignments (student_id, cohort_id, unit_id, role, status)
    VALUES (v_student, v_cohort, v_unit_a, 'primary', 'active');
  INSERT INTO public.student_unit_assignments (student_id, cohort_id, unit_id, role, status)
    VALUES (v_student, v_cohort, v_unit_b, 'additional', 'active');
  INSERT INTO public.student_unit_assignments (student_id, cohort_id, unit_id, role, status)
    VALUES (v_student, v_cohort, v_unit_c, 'additional', 'active');

  SELECT count(*) INTO v_count FROM public.student_unit_assignments
   WHERE student_id = v_student AND status = 'active';
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: expected 3 concurrent live units, found %', v_count;
  END IF;
  RAISE NOTICE 'ok: three concurrent units (no cap exists)';

  -- unit_key was DERIVED by the trigger on every insert above.
  SELECT unit_key INTO v_key FROM public.student_unit_assignments
   WHERE student_id = v_student AND unit_id = v_unit_a;
  IF v_key <> 'ZZ SMOKE Unit A' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: unit_key not derived (got "%")', v_key;
  END IF;
  RAISE NOTICE 'ok: unit_key derived from the unit';

  -- ── Rejection 1: a SECOND ACTIVE PRIMARY is impossible ────────────────────
  -- Unit E carries no live row at this point, so the ONLY rule that can fire is
  -- the active-primary index (unit B would first trip the live-per-unit index,
  -- and both raise unique_violation - the confirmation must be unambiguous).
  BEGIN
    INSERT INTO public.student_unit_assignments (student_id, cohort_id, unit_id, role, status)
      VALUES (v_student, v_cohort, v_unit_e, 'primary', 'active');
    RAISE EXCEPTION 'SMOKE TEST FAILURE: second active primary was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ok: second active primary rejected (uq_sua_one_active_primary_per_student_cohort)';
  END;

  -- ── Rejection 2: CROSS-COHORT assignment (student pair fails) ─────────────
  BEGIN
    INSERT INTO public.student_unit_assignments (student_id, cohort_id, unit_id, role, status)
      VALUES (v_student, v_other_cohort, v_unit_other, 'additional', 'active');
    RAISE EXCEPTION 'SMOKE TEST FAILURE: cross-cohort assignment was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'ok: cross-cohort assignment rejected (fk_sua_student_cohort)';
  END;

  -- ── Rejection 3: a unit from ANOTHER cohort (unit pair fails) ─────────────
  BEGIN
    INSERT INTO public.student_unit_assignments (student_id, cohort_id, unit_id, role, status)
      VALUES (v_student, v_cohort, v_unit_other, 'additional', 'active');
    RAISE EXCEPTION 'SMOKE TEST FAILURE: other-cohort unit was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'ok: other-cohort unit rejected (fk_sua_unit_cohort)';
  END;

  -- ── Rejection 4: MISMATCHED unit identity (trigger) ───────────────────────
  BEGIN
    INSERT INTO public.student_unit_assignments (student_id, cohort_id, unit_id, unit_key, role, status)
      VALUES (v_student, v_cohort, v_unit_b, 'ZZ SMOKE Wrong Name', 'additional', 'planned');
    RAISE EXCEPTION 'SMOKE TEST FAILURE: mismatched unit_key was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF position('does not match unit' in SQLERRM) > 0 THEN
      RAISE NOTICE 'ok: mismatched unit_key rejected (trg_sua_enforce_unit_identity)';
    ELSE
      RAISE;   -- the SMOKE TEST FAILURE above, or an unexpected error: abort
    END IF;
  END;

  -- ── Rejection 5: a LIVE assignment without a unit row ─────────────────────
  BEGIN
    INSERT INTO public.student_unit_assignments (student_id, cohort_id, unit_key, role, status)
      VALUES (v_student, v_cohort, 'ZZ SMOKE Unit B', 'additional', 'planned');
    RAISE EXCEPTION 'SMOKE TEST FAILURE: live assignment without unit_id was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: live assignment without unit_id rejected (chk_sua_live_requires_unit)';
  END;

  -- ── Rejection 6: EXCESSIVE planned primaries (one successor only) ─────────
  -- Units D and E carry no live row, so the ONLY constraint in play is the
  -- planned-primary index (unit B/C would first trip the live-per-unit index).
  INSERT INTO public.student_unit_assignments (student_id, cohort_id, unit_id, role, status)
    VALUES (v_student, v_cohort, v_unit_d, 'primary', 'planned');   -- the one allowed successor
  BEGIN
    INSERT INTO public.student_unit_assignments (student_id, cohort_id, unit_id, role, status)
      VALUES (v_student, v_cohort, v_unit_e, 'primary', 'planned');
    RAISE EXCEPTION 'SMOKE TEST FAILURE: second planned primary was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ok: second planned primary rejected (uq_sua_one_planned_primary_per_student_cohort)';
  END;

  -- ── Rejection 6b: the SAME unit cannot be live twice ──────────────────────
  BEGIN
    INSERT INTO public.student_unit_assignments (student_id, cohort_id, unit_id, role, status)
      VALUES (v_student, v_cohort, v_unit_b, 'additional', 'planned');
    RAISE EXCEPTION 'SMOKE TEST FAILURE: duplicate live row for the same unit was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ok: duplicate live row for one unit rejected (uq_sua_one_live_row_per_student_unit)';
  END;

  -- ── Rejection 7: incoherent period ────────────────────────────────────────
  BEGIN
    UPDATE public.student_unit_assignments
       SET start_date = '2026-08-01', end_date = '2026-07-01'
     WHERE student_id = v_student AND unit_id = v_unit_a;
    RAISE EXCEPTION 'SMOKE TEST FAILURE: end_date before start_date was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: incoherent period rejected (chk_sua_period)';
  END;

  -- ── Rejection 8: history rows must carry ended_at ─────────────────────────
  BEGIN
    UPDATE public.student_unit_assignments
       SET status = 'ended'   -- without ended_at
     WHERE student_id = v_student AND unit_id = v_unit_c;
    RAISE EXCEPTION 'SMOKE TEST FAILURE: ended without ended_at was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: ended without ended_at rejected (chk_sua_ended_fields)';
  END;

  -- ── Blocked deletion: a SYNTHETIC unit with a LIVE assignment ─────────────
  -- Only the fixture unit (v_unit_b, live 'planned' successor above) is ever
  -- targeted; no production unit is touched.
  BEGIN
    DELETE FROM public.units WHERE id = v_unit_b;
    RAISE EXCEPTION 'SMOKE TEST FAILURE: deleting a unit with a live assignment succeeded';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: unit deletion blocked while an assignment is live (SET NULL vs chk_sua_live_requires_unit)';
  END;

  -- Ending the assignment releases the unit, and history keeps its unit_key.
  UPDATE public.student_unit_assignments
     SET status = 'ended', ended_at = now()
   WHERE student_id = v_student AND unit_id = v_unit_b;
  DELETE FROM public.units WHERE id = v_unit_b;

  SELECT unit_key INTO v_key FROM public.student_unit_assignments
   WHERE student_id = v_student AND status = 'ended' AND unit_id IS NULL;
  IF v_key IS DISTINCT FROM 'ZZ SMOKE Unit B' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: history lost its unit_key after unit deletion (got "%")', v_key;
  END IF;
  RAISE NOTICE 'ok: ended assignment released the unit; history kept unit_key with unit_id NULL';

  RAISE NOTICE 'ALL SMOKE TESTS PASSED';
END;
$$;

ROLLBACK;

-- Nothing persists. Confirm if desired:
--   SELECT count(*) FROM public.cohorts WHERE name LIKE 'ZZ SMOKE%';   -- expect: 0
-- =============================================================================
