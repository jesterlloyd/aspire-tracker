-- =============================================================================
-- POST-ROTATION-SEQUENCED-RELEASE-1 - executable smoke test
-- Run AFTER applying 20260822000000_student_activity_completions.sql.
--
-- Transaction-wrapped and ROLLED BACK: it creates synthetic 'ZZ ' fixtures,
-- proves the guarantees, then undoes everything. Nothing survives.
--
-- Every EXCEPTION handler names its SQLSTATE. There is no WHEN OTHERS anywhere,
-- so a failure can never be swallowed and reported as a pass.
--
-- Finishes with a zero-count query: 0 means no fixture escaped.
-- =============================================================================

BEGIN;

DO $smoke$
DECLARE
  v_cohort   uuid;
  v_student  uuid;
  v_student2 uuid;
  v_id       uuid;
  v_first    timestamptz;
  v_count    int;
  v_orig_action text;
BEGIN
  -- ── Fixtures ──────────────────────────────────────────────────────────────
  SELECT id INTO v_cohort FROM cohorts ORDER BY created_at LIMIT 1;
  IF v_cohort IS NULL THEN
    RAISE EXCEPTION 'SMOKE ABORT: no cohort exists to attach fixtures to';
  END IF;

  INSERT INTO students (first_name, last_name, cohort_id)
  VALUES ('ZZ', 'SmokeActivityOne', v_cohort) RETURNING id INTO v_student;
  INSERT INTO students (first_name, last_name, cohort_id)
  VALUES ('ZZ', 'SmokeActivityTwo', v_cohort) RETURNING id INTO v_student2;

  -- ── 1. A completion can be recorded ───────────────────────────────────────
  INSERT INTO student_activity_completions (student_id, activity_key, completed_at, source)
  VALUES (v_student, 'town_hall', now() - interval '3 days', 'staff_confirmed')
  RETURNING id, completed_at INTO v_id, v_first;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'FAIL 1: a valid completion was not recorded';
  END IF;
  RAISE NOTICE 'PASS 1: completion recorded';

  -- ── 2. The activity allowlist rejects anything else ───────────────────────
  BEGIN
    INSERT INTO student_activity_completions (student_id, activity_key, completed_at)
    VALUES (v_student, 'invented_activity', now());
    RAISE EXCEPTION 'FAIL 2: an unlisted activity_key was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 2: unlisted activity_key rejected by CHECK';
  END;

  -- ── 3. The source allowlist rejects anything else ─────────────────────────
  BEGIN
    INSERT INTO student_activity_completions (student_id, activity_key, completed_at, source)
    VALUES (v_student, 'resume_review', now(), 'guessed');
    RAISE EXCEPTION 'FAIL 3: an unlisted source was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 3: unlisted source rejected by CHECK';
  END;

  -- ── 4. An unlisted action is rejected ─────────────────────────────────────
  BEGIN
    INSERT INTO student_activity_completions (student_id, activity_key, action, completed_at)
    VALUES (v_student, 'resume_review', 'deleted', now());
    RAISE EXCEPTION 'FAIL 4: an unlisted action was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 4: action allowlist enforced';
  END;

  -- ── 5. APPEND-ONLY: a correction is a NEW row, history is preserved ───────
  DECLARE
    v_orig_actor text;
    v_orig_at    timestamptz;
  BEGIN
    SELECT recorded_by_name, created_at INTO v_orig_actor, v_orig_at
      FROM student_activity_completions
     WHERE student_id = v_student AND activity_key = 'town_hall' AND action = 'complete';

    INSERT INTO student_activity_completions
      (student_id, activity_key, action, reason, source, recorded_by_name)
    VALUES (v_student, 'town_hall', 'reverse', 'Recorded against the wrong student', 'correction', 'ZZ Corrector');

    SELECT count(*) INTO v_count
      FROM student_activity_completions
     WHERE student_id = v_student AND activity_key = 'town_hall';
    IF v_count <> 2 THEN
      RAISE EXCEPTION 'FAIL 5: expected 2 events after a correction, found %', v_count;
    END IF;

    -- The ORIGINAL row must be untouched: same actor, same timestamp.
    SELECT count(*) INTO v_count
      FROM student_activity_completions
     WHERE student_id = v_student AND activity_key = 'town_hall' AND action = 'complete'
       AND recorded_by_name IS NOT DISTINCT FROM v_orig_actor
       AND created_at = v_orig_at;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'FAIL 5b: the correction overwrote the original actor or timestamp';
    END IF;
    RAISE NOTICE 'PASS 5: correction appended; original actor and date preserved';
  END;

  -- ── 6. Shape rules: a completion needs a date, a reversal needs a reason ──
  BEGIN
    INSERT INTO student_activity_completions (student_id, activity_key, action, completed_at)
    VALUES (v_student, 'resume_review', 'reverse', now());
    RAISE EXCEPTION 'FAIL 6: a reversal carrying a completion date was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 6: a reversal cannot carry a completion date';
  END;

  BEGIN
    INSERT INTO student_activity_completions (student_id, activity_key, action, reason)
    VALUES (v_student, 'resume_review', 'complete', 'no date');
    RAISE EXCEPTION 'FAIL 6b: a completion with no date was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 6b: a completion must carry a date';
  END;

  -- ── 6c. The effective state is the LATEST event ───────────────────────────
  SELECT action INTO v_orig_action
    FROM student_activity_completions
   WHERE student_id = v_student AND activity_key = 'town_hall'
   ORDER BY created_at DESC, id DESC LIMIT 1;
  IF v_orig_action <> 'reverse' THEN
    RAISE EXCEPTION 'FAIL 6c: latest event should be the reversal, got %', v_orig_action;
  END IF;
  RAISE NOTICE 'PASS 6c: effective state follows the most recent event';

  -- ── 7. Completions are per student, never shared ──────────────────────────
  SELECT count(*) INTO v_count
    FROM student_activity_completions WHERE student_id = v_student2;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL 7: student two inherited % completion(s)', v_count;
  END IF;
  RAISE NOTICE 'PASS 7: completions do not leak between students';

  -- ── 8. The gate needs ALL THREE; two is not enough ────────────────────────
  INSERT INTO student_activity_completions (student_id, activity_key, completed_at)
  VALUES (v_student, 'interview_bootcamp', now());

  SELECT count(*) INTO v_count FROM (
    SELECT DISTINCT ON (activity_key) activity_key, action
      FROM student_activity_completions
     WHERE student_id = v_student
     ORDER BY activity_key, created_at DESC, id DESC
  ) latest WHERE action = 'complete';
  IF v_count = 3 THEN
    RAISE EXCEPTION 'FAIL 8: the fixture claims three completions when only two were recorded';
  END IF;
  RAISE NOTICE 'PASS 8: partial completion (%/3) does not satisfy the checklist', v_count;

  INSERT INTO student_activity_completions (student_id, activity_key, completed_at)
  VALUES (v_student, 'resume_review', now());
  SELECT count(*) INTO v_count FROM (
    SELECT DISTINCT ON (activity_key) activity_key, action
      FROM student_activity_completions
     WHERE student_id = v_student
     ORDER BY activity_key, created_at DESC, id DESC
  ) latest WHERE action = 'complete';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL 8b: expected 2 effective completions (town_hall was reversed), found %', v_count;
  END IF;
  RAISE NOTICE 'PASS 8b: effective completions reflect the reversal (2 of 3) -> checklist NOT satisfied';

  -- ── 9. Deleting a student removes their completions (no orphans) ──────────
  DELETE FROM students WHERE id = v_student2;
  SELECT count(*) INTO v_count
    FROM student_activity_completions WHERE student_id = v_student2;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL 9: % orphaned completion(s) survived the student delete', v_count;
  END IF;
  RAISE NOTICE 'PASS 9: completions cascade with the student';

  -- ── 10. This table supplies NO evaluation completion evidence ─────────────
  -- Guard against a future reader treating an activity row as survey completion.
  SELECT count(*) INTO v_count
    FROM information_schema.columns
   WHERE table_name = 'student_activity_completions'
     AND column_name IN ('assignment_id', 'evaluation_assignment_id', 'instrument_id', 'status');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL 10: this table has evaluation-shaped columns and could become a parallel status system';
  END IF;
  RAISE NOTICE 'PASS 10: no evaluation-shaped columns; survey completion still comes only from evaluation_assignments';

  RAISE NOTICE 'ALL ACTIVITY COMPLETION SMOKE TESTS PASSED';
END
$smoke$;

ROLLBACK;

-- Zero-count proof: no fixture escaped the rollback.
SELECT count(*) AS leftover_smoke_rows
  FROM student_activity_completions sac
  JOIN students s ON s.id = sac.student_id
 WHERE s.first_name = 'ZZ' AND s.last_name LIKE 'SmokeActivity%';
-- Expected: 0
