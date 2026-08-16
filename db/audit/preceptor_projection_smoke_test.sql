-- =============================================================================
-- Preceptor projection smoke test  (PRECEPTOR-ASSIGNMENT-PROJECTION-1)
-- Owner-run, AFTER applying 20260820000000. EVERYTHING HERE ROLLS BACK.
-- =============================================================================
--
-- WHAT THIS PROVES, executably:
--   • all five shift cases project correctly: Day, Night, Mid, Variable, and a
--     preceptor with NO shift -> BLANK student shift (never inferred, never a
--     stale leftover);
--   • initial assignment, REPLACEMENT with a different preceptor, an edit to
--     the canonical preceptor record (name/email/shift), and CLEARING;
--   • the current-cohort match row follows under the single-match rule, and a
--     multi-match student is deliberately left untouched;
--   • secondary/coverage assignments never alter the primary projection;
--   • a STALE matches.preceptor_id cannot hijack the projection: editing the
--     stale preceptor leaves that match alone, while editing the student's
--     CANONICAL preceptor synchronizes it (including repairing the stale FK);
--   • clearing leaves nothing of the previous preceptor behind.
--
-- FIXTURES ARE SYNTHETIC AND TRANSACTION-LOCAL ('ZZ PROJ' prefix). Assignments
-- are made by writing students.preceptor_id directly (the same single column
-- assign_primary_preceptor() writes) so the trigger under test is exercised
-- without needing the RPC's actor/authorization fixtures; the marker below is
-- what the preceptor_id guard trigger requires.
--
-- EXPECTED OUTPUT: 'ok: ...' notices ending in 'ALL PROJECTION SMOKE TESTS
-- PASSED', then ROLLBACK, then a trailing count of 0.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_cohort  uuid;
  v_unit    uuid;
  v_student uuid;
  v_multi   uuid;
  v_p_day uuid; v_p_night uuid; v_p_mid uuid; v_p_var uuid; v_p_none uuid;
  v_match   uuid;
  v_stale_student uuid; v_stale_match uuid; v_p_stale uuid;
  v_row     record;
  v_count   integer;
BEGIN
  -- ── Fixtures ──────────────────────────────────────────────────────────────
  INSERT INTO public.cohorts (name, status) VALUES ('ZZ PROJ TEST COHORT', 'Archived')
    RETURNING id INTO v_cohort;
  INSERT INTO public.units (unit_name, cohort_id, total_slots)
    VALUES ('ZZ PROJ Unit', v_cohort, 5) RETURNING id INTO v_unit;

  INSERT INTO public.preceptors (full_name, email, shift_type, is_active, unit_id)
    VALUES ('ZZ PROJ Day Preceptor', 'zz.day@example.invalid', 'Day', true, v_unit)
    RETURNING id INTO v_p_day;
  INSERT INTO public.preceptors (full_name, email, shift_type, is_active, unit_id)
    VALUES ('ZZ PROJ Night Preceptor', 'zz.night@example.invalid', 'Night', true, v_unit)
    RETURNING id INTO v_p_night;
  INSERT INTO public.preceptors (full_name, email, shift_type, is_active, unit_id)
    VALUES ('ZZ PROJ Mid Preceptor', 'zz.mid@example.invalid', 'Mid', true, v_unit)
    RETURNING id INTO v_p_mid;
  INSERT INTO public.preceptors (full_name, email, shift_type, is_active, unit_id)
    VALUES ('ZZ PROJ Variable Preceptor', 'zz.var@example.invalid', 'Variable', true, v_unit)
    RETURNING id INTO v_p_var;
  -- Explicit NULL shift: the CHECK allows NULL, and this must project to blank.
  INSERT INTO public.preceptors (full_name, email, shift_type, is_active, unit_id)
    VALUES ('ZZ PROJ No-Shift Preceptor', 'zz.none@example.invalid', NULL, true, v_unit)
    RETURNING id INTO v_p_none;

  INSERT INTO public.students (name, first_name, last_name, cohort_id, status, matched_unit_id,
                               matched_preceptor, preceptor_email, shift_assigned)
    VALUES ('ZZ PROJ Student', 'ZZ', 'Proj', v_cohort, 'Placed', v_unit,
            'STALE TYPED NAME', 'stale@example.invalid', 'Midshift')
    RETURNING id INTO v_student;

  INSERT INTO public.matches (student_id, unit_id, cohort_id, preceptor_assigned, shift_assigned)
    VALUES (v_student, v_unit, v_cohort, 'STALE MATCH NAME', 'Either')
    RETURNING id INTO v_match;

  -- ── 1. Initial assignment: Day ────────────────────────────────────────────
  PERFORM set_config('app.preceptor_change_authorized', v_student::text, true);
  UPDATE public.students SET preceptor_id = v_p_day WHERE id = v_student;
  PERFORM set_config('app.preceptor_change_authorized', '', true);

  SELECT matched_preceptor, preceptor_email, shift_assigned INTO v_row
    FROM public.students WHERE id = v_student;
  IF v_row.matched_preceptor IS DISTINCT FROM 'ZZ PROJ Day Preceptor'
     OR v_row.preceptor_email IS DISTINCT FROM 'zz.day@example.invalid'
     OR v_row.shift_assigned IS DISTINCT FROM 'Day' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: initial assignment did not project (%)', row_to_json(v_row);
  END IF;
  RAISE NOTICE 'ok: initial assignment projected name, email, and Day shift (stale typed values replaced)';

  -- The single current-cohort match followed too.
  SELECT preceptor_id, preceptor_assigned, shift_assigned INTO v_row
    FROM public.matches WHERE id = v_match;
  IF v_row.preceptor_id IS DISTINCT FROM v_p_day
     OR v_row.preceptor_assigned IS DISTINCT FROM 'ZZ PROJ Day Preceptor'
     OR v_row.shift_assigned IS DISTINCT FROM 'Day' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: the single match row did not follow (%)', row_to_json(v_row);
  END IF;
  RAISE NOTICE 'ok: the single current-cohort match projected its FK, preceptor name, and shift';

  -- An active primary assignment row exists exactly once.
  SELECT count(*) INTO v_count FROM public.student_preceptor_assignments
   WHERE student_id = v_student AND cohort_id = v_cohort AND role = 'primary' AND status = 'active';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: expected exactly one active primary, found %', v_count;
  END IF;

  -- ── 2. Every shift value, including blank ─────────────────────────────────
  DECLARE
    v_case record;
  BEGIN
    FOR v_case IN
      SELECT * FROM (VALUES
        (v_p_night, 'ZZ PROJ Night Preceptor', 'Night'),
        (v_p_mid,   'ZZ PROJ Mid Preceptor',   'Mid'),
        (v_p_var,   'ZZ PROJ Variable Preceptor', 'Variable'),
        (v_p_none,  'ZZ PROJ No-Shift Preceptor', '')
      ) AS t(pid, pname, pshift)
    LOOP
      PERFORM set_config('app.preceptor_change_authorized', v_student::text, true);
      UPDATE public.students SET preceptor_id = v_case.pid WHERE id = v_student;
      PERFORM set_config('app.preceptor_change_authorized', '', true);

      SELECT matched_preceptor, shift_assigned INTO v_row
        FROM public.students WHERE id = v_student;
      IF v_row.matched_preceptor IS DISTINCT FROM v_case.pname
         OR v_row.shift_assigned IS DISTINCT FROM v_case.pshift THEN
        RAISE EXCEPTION 'SMOKE TEST FAILURE: % projected wrong (name %, shift %)',
          v_case.pname, v_row.matched_preceptor, v_row.shift_assigned;
      END IF;
      SELECT shift_assigned INTO v_row FROM public.matches WHERE id = v_match;
      IF v_row.shift_assigned IS DISTINCT FROM v_case.pshift THEN
        RAISE EXCEPTION 'SMOKE TEST FAILURE: match shift for % is %', v_case.pname, v_row.shift_assigned;
      END IF;
    END LOOP;
  END;
  RAISE NOTICE 'ok: Night, Mid, Variable all project verbatim; a preceptor with NO shift projects BLANK';

  -- Replacement never leaves the previous preceptor behind.
  SELECT matched_preceptor, preceptor_email, shift_assigned INTO v_row
    FROM public.students WHERE id = v_student;
  IF v_row.matched_preceptor LIKE '%Variable%' OR v_row.preceptor_email LIKE '%var%'
     OR COALESCE(v_row.shift_assigned, '') <> '' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: replacement left previous preceptor data (%)', row_to_json(v_row);
  END IF;
  RAISE NOTICE 'ok: replacement fully overwrote the previous preceptor name, email, and shift';

  -- ── 3. An edit to the CANONICAL preceptor record reaches linked students ──
  UPDATE public.preceptors
     SET full_name = 'ZZ PROJ Renamed Preceptor',
         email     = 'zz.renamed@example.invalid',
         shift_type = 'Night'
   WHERE id = v_p_none;

  SELECT matched_preceptor, preceptor_email, shift_assigned INTO v_row
    FROM public.students WHERE id = v_student;
  IF v_row.matched_preceptor IS DISTINCT FROM 'ZZ PROJ Renamed Preceptor'
     OR v_row.preceptor_email IS DISTINCT FROM 'zz.renamed@example.invalid'
     OR v_row.shift_assigned IS DISTINCT FROM 'Night' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: a preceptor-record edit did not reach the linked student (%)', row_to_json(v_row);
  END IF;
  SELECT preceptor_assigned, shift_assigned INTO v_row FROM public.matches WHERE id = v_match;
  IF v_row.preceptor_assigned IS DISTINCT FROM 'ZZ PROJ Renamed Preceptor'
     OR v_row.shift_assigned IS DISTINCT FROM 'Night' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: the match row did not follow the preceptor edit (%)', row_to_json(v_row);
  END IF;
  RAISE NOTICE 'ok: renaming / re-emailing / re-shifting the preceptor followed through to the student AND the match';

  -- Clearing the preceptor's shift blanks the student's shift.
  UPDATE public.preceptors SET shift_type = NULL WHERE id = v_p_none;
  SELECT shift_assigned INTO v_row FROM public.students WHERE id = v_student;
  IF COALESCE(v_row.shift_assigned, '') <> '' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: removing the preceptor shift left % behind', v_row.shift_assigned;
  END IF;
  RAISE NOTICE 'ok: removing the preceptor''s shift blanked the student''s shift';

  -- ── 4. Secondary / coverage never touch the primary projection ───────────
  INSERT INTO public.student_preceptor_assignments
    (student_id, preceptor_id, cohort_id, role, status)
  VALUES (v_student, v_p_day, v_cohort, 'secondary', 'active');

  SELECT matched_preceptor, shift_assigned INTO v_row FROM public.students WHERE id = v_student;
  IF v_row.matched_preceptor IS DISTINCT FROM 'ZZ PROJ Renamed Preceptor'
     OR COALESCE(v_row.shift_assigned, '') <> '' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: a secondary assignment altered the primary projection (%)', row_to_json(v_row);
  END IF;
  -- Editing that SECONDARY preceptor's record must not touch this student either.
  UPDATE public.preceptors SET shift_type = 'Mid' WHERE id = v_p_day;
  SELECT shift_assigned INTO v_row FROM public.students WHERE id = v_student;
  IF COALESCE(v_row.shift_assigned, '') <> '' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: a SECONDARY preceptor edit changed the student shift to %', v_row.shift_assigned;
  END IF;
  RAISE NOTICE 'ok: secondary/coverage assignments never alter the primary name or shift';

  -- ── 4b. A STALE match FK must not let the wrong preceptor win ────────────
  -- The match row still points at an OLD preceptor while the student is
  -- canonically linked to another. Editing the STALE preceptor must not touch
  -- this match; editing the CANONICAL one must fix it, FK included.
  -- A preceptor used ONLY by this case, so renaming it cannot disturb any
  -- other section's expectations.
  INSERT INTO public.preceptors (full_name, email, shift_type, is_active, unit_id)
    VALUES ('ZZ PROJ Stale Preceptor', 'zz.stale@example.invalid', 'Night', true, v_unit)
    RETURNING id INTO v_p_stale;
  INSERT INTO public.students (name, first_name, last_name, cohort_id, status, matched_unit_id)
    VALUES ('ZZ PROJ Stale Student', 'ZZ', 'Stale', v_cohort, 'Placed', v_unit)
    RETURNING id INTO v_stale_student;
  -- Canonically linked to the MID preceptor...
  PERFORM set_config('app.preceptor_change_authorized', v_stale_student::text, true);
  UPDATE public.students SET preceptor_id = v_p_mid WHERE id = v_stale_student;
  PERFORM set_config('app.preceptor_change_authorized', '', true);
  -- ...but the match row carries a STALE FK to the NIGHT preceptor. (Created
  -- after the assignment so the mirror does not immediately correct it, which
  -- is exactly the real-world shape this guards against.)
  INSERT INTO public.matches (student_id, unit_id, cohort_id, preceptor_id, preceptor_assigned, shift_assigned)
    VALUES (v_stale_student, v_unit, v_cohort, v_p_stale, 'STALE FK NAME', 'Night')
    RETURNING id INTO v_stale_match;

  -- Editing the STALE preceptor (Night) must leave this match untouched.
  UPDATE public.preceptors SET full_name = 'ZZ PROJ Stale RENAMED' WHERE id = v_p_stale;
  SELECT preceptor_id, preceptor_assigned, shift_assigned INTO v_row
    FROM public.matches WHERE id = v_stale_match;
  IF v_row.preceptor_id IS DISTINCT FROM v_p_stale
     OR v_row.preceptor_assigned IS DISTINCT FROM 'STALE FK NAME'
     OR v_row.shift_assigned IS DISTINCT FROM 'Night' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: editing a STALE-FK preceptor rewrote a match that is not theirs (%)', row_to_json(v_row);
  END IF;
  RAISE NOTICE 'ok: editing the stale-FK preceptor did NOT touch the match (projection follows the student, not the match FK)';

  -- Editing the CANONICAL preceptor (Mid) must synchronize it, FK included.
  UPDATE public.preceptors SET full_name = 'ZZ PROJ Mid CANONICAL', shift_type = 'Mid' WHERE id = v_p_mid;
  SELECT preceptor_id, preceptor_assigned, shift_assigned INTO v_row
    FROM public.matches WHERE id = v_stale_match;
  IF v_row.preceptor_id IS DISTINCT FROM v_p_mid
     OR v_row.preceptor_assigned IS DISTINCT FROM 'ZZ PROJ Mid CANONICAL'
     OR v_row.shift_assigned IS DISTINCT FROM 'Mid' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: the canonical preceptor edit did not synchronize the match (%)', row_to_json(v_row);
  END IF;
  RAISE NOTICE 'ok: editing the CANONICAL preceptor synchronized the match and repaired its stale FK';

  -- ── 5. Multi-match students are deliberately skipped ─────────────────────
  INSERT INTO public.students (name, first_name, last_name, cohort_id, status, matched_unit_id)
    VALUES ('ZZ PROJ Multi Student', 'ZZ', 'Multi', v_cohort, 'Placed', v_unit)
    RETURNING id INTO v_multi;
  INSERT INTO public.matches (student_id, unit_id, cohort_id, preceptor_assigned, shift_assigned)
    VALUES (v_multi, v_unit, v_cohort, 'UNTOUCHED A', 'Either');
  INSERT INTO public.matches (student_id, unit_id, cohort_id, preceptor_assigned, shift_assigned)
    VALUES (v_multi, v_unit, v_cohort, 'UNTOUCHED B', 'Either');

  PERFORM set_config('app.preceptor_change_authorized', v_multi::text, true);
  UPDATE public.students SET preceptor_id = v_p_night WHERE id = v_multi;
  PERFORM set_config('app.preceptor_change_authorized', '', true);

  -- The STUDENT projection still happens...
  SELECT matched_preceptor, shift_assigned INTO v_row FROM public.students WHERE id = v_multi;
  IF v_row.matched_preceptor IS DISTINCT FROM 'ZZ PROJ Night Preceptor'
     OR v_row.shift_assigned IS DISTINCT FROM 'Night' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: multi-match student lost its OWN projection (%)', row_to_json(v_row);
  END IF;
  -- ...but NEITHER match row is touched.
  SELECT count(*) INTO v_count FROM public.matches
   WHERE student_id = v_multi AND preceptor_assigned IN ('UNTOUCHED A', 'UNTOUCHED B')
     AND shift_assigned = 'Either' AND preceptor_id IS NULL;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: a multi-match row was modified (untouched rows found: %)', v_count;
  END IF;
  RAISE NOTICE 'ok: a multi-match student projects onto the student but NEITHER match row (safety rule intact)';

  -- ── 6. Clearing leaves nothing behind ────────────────────────────────────
  PERFORM set_config('app.preceptor_change_authorized', v_student::text, true);
  UPDATE public.students SET preceptor_id = NULL WHERE id = v_student;
  PERFORM set_config('app.preceptor_change_authorized', '', true);

  SELECT matched_preceptor, preceptor_email, shift_assigned INTO v_row
    FROM public.students WHERE id = v_student;
  IF COALESCE(v_row.matched_preceptor, '') <> '' OR COALESCE(v_row.preceptor_email, '') <> ''
     OR COALESCE(v_row.shift_assigned, '') <> '' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: clearing left preceptor data behind (%)', row_to_json(v_row);
  END IF;
  SELECT preceptor_id, preceptor_assigned, shift_assigned INTO v_row FROM public.matches WHERE id = v_match;
  IF v_row.preceptor_id IS NOT NULL OR COALESCE(v_row.preceptor_assigned, '') <> ''
     OR COALESCE(v_row.shift_assigned, '') <> '' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: clearing left match data behind (%)', row_to_json(v_row);
  END IF;
  SELECT count(*) INTO v_count FROM public.student_preceptor_assignments
   WHERE student_id = v_student AND cohort_id = v_cohort AND role = 'primary' AND status = 'active';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: an active primary survived the clear';
  END IF;
  -- History is preserved, not deleted.
  SELECT count(*) INTO v_count FROM public.student_preceptor_assignments
   WHERE student_id = v_student AND status = 'ended';
  IF v_count < 1 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: historical assignment rows were deleted rather than ended';
  END IF;
  RAISE NOTICE 'ok: clearing removed the name, email, shift, and match projection while KEEPING history';

  -- ── 7. The shift rule itself ─────────────────────────────────────────────
  IF public.preceptor_projected_shift('Day') <> 'Day'
     OR public.preceptor_projected_shift('Night') <> 'Night'
     OR public.preceptor_projected_shift('Mid') <> 'Mid'
     OR public.preceptor_projected_shift('Variable') <> 'Variable'
     OR public.preceptor_projected_shift(NULL) <> ''
     OR public.preceptor_projected_shift('') <> ''
     OR public.preceptor_projected_shift('  Day  ') <> 'Day'
     OR public.preceptor_projected_shift('Evenings') <> ''
     OR public.preceptor_projected_shift('Midshift') <> '' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: the shift rule is wrong';
  END IF;
  RAISE NOTICE 'ok: the shift rule passes the canonical four, blanks NULL/blank/unknown, and never guesses';

  RAISE NOTICE 'ALL PROJECTION SMOKE TESTS PASSED';
END;
$$;

ROLLBACK;

-- Nothing persists - this runs AFTER the rollback and must return 0:
SELECT count(*) AS zz_proj_fixture_rows_remaining
FROM public.cohorts WHERE name LIKE 'ZZ PROJ%';
-- =============================================================================
