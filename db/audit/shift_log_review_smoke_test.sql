-- =============================================================================
-- shift_log_review smoke test  (SHIFT-LOG-REVIEW-1)
-- Owner-run, AFTER applying 20260818000000. EVERYTHING HERE ROLLS BACK.
-- =============================================================================
--
-- WHAT THIS PROVES, executably:
--   • approve-as-submitted moves a Pending Review shift into the approved
--     bucket and recomputes BOTH totals from authoritative rows;
--   • approval far beyond hours_required succeeds - required hours are a
--     completion threshold, not a maximum;
--   • an unacknowledged same-day or duplicate warning REFUSES the approval
--     (P0007) and leaves every row untouched; acknowledging it proceeds;
--   • adjust-and-approve replaces total_hours while the ledger preserves the
--     original value;
--   • reject removes the hours from pending WITHOUT deleting the row - the
--     shift survives as history with its submitted values intact;
--   • a second decision on the same shift is refused (P0001) - concurrent or
--     repeated decisions can never double-apply;
--   • invalid decisions, missing rationales, out-of-range adjustments, and
--     unauthorized reviewers are each refused with their own error code.
--
-- FIXTURES ARE SYNTHETIC AND TRANSACTION-LOCAL ('ZZ REVIEW' prefix), except
-- the reviewer: the ledger requires a real actor, so the test READS one
-- existing active Owner/Admin profile id (it never modifies that row, and the
-- audit rows referencing it roll back). No placeholders; paste and run as-is.
--
-- EXPECTED OUTPUT: 'ok: ...' notices ending in 'ALL REVIEW SMOKE TESTS
-- PASSED', then ROLLBACK, then a trailing count of 0.
-- =============================================================================

BEGIN;

-- ── 0. AUTHORIZATION POSTURE (config-level, executable) ──────────────────────
-- Source deletion is narrowed to active Owner/Admin. Provable from the
-- catalogs: no FOR ALL policy remains on either source table, the ONLY DELETE
-- policy is is_active_owner_or_admin() (which viewer/interviewer/co_lead can
-- never satisfy - the helper requires role IN ('owner','admin') AND active),
-- reads/writes keep the identical is_staff() predicate, and service_role has
-- no DELETE privilege while keeping SELECT/INSERT/UPDATE.
DO $$
DECLARE
  v_n integer;
  v_expr text;
BEGIN
  SELECT count(*) INTO v_n FROM pg_policy
   WHERE polrelid IN ('public.students'::regclass, 'public.student_shift_logs'::regclass)
     AND polcmd = '*';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: a FOR ALL policy still covers a source table (found %)', v_n;
  END IF;

  FOR v_expr IN
    SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
     WHERE polrelid IN ('public.students'::regclass, 'public.student_shift_logs'::regclass)
       AND polcmd = 'd'
  LOOP
    IF position('is_active_owner_or_admin' in v_expr) = 0 THEN
      RAISE EXCEPTION 'SMOKE TEST FAILURE: a DELETE policy is not Owner/Admin-gated (%)', v_expr;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_policy
   WHERE polrelid IN ('public.students'::regclass, 'public.student_shift_logs'::regclass)
     AND polcmd = 'd';
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: expected exactly one DELETE policy per source table (found %)', v_n;
  END IF;

  -- Reads and writes unchanged: r/a/w policies exist on both tables over is_staff().
  SELECT count(*) INTO v_n FROM pg_policy
   WHERE polrelid IN ('public.students'::regclass, 'public.student_shift_logs'::regclass)
     AND polcmd IN ('r', 'a', 'w')
     AND position('is_staff' in COALESCE(pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid))) > 0;
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: expected 6 unchanged is_staff read/write policies (found %)', v_n;
  END IF;

  IF has_table_privilege('service_role', 'public.students', 'DELETE')
     OR has_table_privilege('service_role', 'public.student_shift_logs', 'DELETE') THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: service_role still holds DELETE on a source table';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.students', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.student_shift_logs', 'INSERT') THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: service_role lost access it requires';
  END IF;

  RAISE NOTICE 'ok: source DELETE is Owner/Admin-only; reads/writes and service access unchanged';
END;
$$;

DO $$
DECLARE
  v_cohort    uuid;
  v_student   uuid;
  v_reviewer  uuid;
  v_s1 uuid; v_s2 uuid; v_s2b uuid; v_s3 uuid; v_s3b uuid; v_s4 uuid; v_s5 uuid;
  v_s6 uuid; v_s7 uuid;
  v_audit_s1 bigint;
  v_result    jsonb;
  v_row       record;
  v_count     integer;
BEGIN
  -- ── Reviewer: an EXISTING active Owner/Admin profile, read-only ───────────
  SELECT id INTO v_reviewer
  FROM public.user_profiles
  WHERE role IN ('owner', 'admin') AND COALESCE(is_active, true) = true
  ORDER BY role  -- 'admin' < 'owner'; any active row works
  LIMIT 1;
  IF v_reviewer IS NULL THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: no active owner/admin profile exists to act as reviewer';
  END IF;

  -- ── Fixtures (synthetic; rolled back with everything else) ────────────────
  INSERT INTO public.cohorts (name, status) VALUES ('ZZ REVIEW TEST COHORT', 'Archived')
    RETURNING id INTO v_cohort;
  INSERT INTO public.students (name, first_name, last_name, cohort_id, status, hours_required)
    VALUES ('ZZ REVIEW Student', 'ZZ', 'Review', v_cohort, 'Active Rotation', 12)
    RETURNING id INTO v_student;

  -- Five Pending Review shifts + two accepted neighbours that create the
  -- same-day / duplicate conditions (the Emi shape: 6 NE, mismatch-flagged,
  -- with same-day overlaps on July 15 and July 19).
  INSERT INTO public.student_shift_logs
    (student_id, cohort_id, school_email, shift_date, total_hours, unit_name, preceptor_name,
     shift_type, status, exception_flags, review_reason, lifecycle_state)
  VALUES
    (v_student, v_cohort, 'zz.review@example.invalid', '2026-07-12', 8, '6 NE', 'Suraya Stanekzai',
     'Day', 'Pending Review', '["unit_and_preceptor_mismatch"]'::jsonb, 'unit_and_preceptor_mismatch', 'completed')
    RETURNING id INTO v_s1;
  INSERT INTO public.student_shift_logs
    (student_id, cohort_id, school_email, shift_date, total_hours, unit_name, preceptor_name,
     shift_type, status, exception_flags, review_reason, lifecycle_state)
  VALUES
    (v_student, v_cohort, 'zz.review@example.invalid', '2026-07-15', 8, '6 NE', 'Suraya Stanekzai',
     'Day', 'Pending Review', '["unit_and_preceptor_mismatch"]'::jsonb, 'unit_and_preceptor_mismatch', 'completed')
    RETURNING id INTO v_s2;
  INSERT INTO public.student_shift_logs
    (student_id, cohort_id, school_email, shift_date, total_hours, unit_name, preceptor_name,
     shift_type, status, exception_flags, lifecycle_state)
  VALUES
    (v_student, v_cohort, 'zz.review@example.invalid', '2026-07-15', 8, 'PACU', 'Alex Chen',
     'Day', 'Auto-Accepted', '[]'::jsonb, 'completed')
    RETURNING id INTO v_s2b;
  INSERT INTO public.student_shift_logs
    (student_id, cohort_id, school_email, shift_date, total_hours, unit_name, preceptor_name,
     shift_type, status, exception_flags, review_reason, lifecycle_state)
  VALUES
    (v_student, v_cohort, 'zz.review@example.invalid', '2026-07-19', 8, '6 NE', 'Suraya Stanekzai',
     'Day', 'Pending Review', '["unit_and_preceptor_mismatch"]'::jsonb, 'unit_and_preceptor_mismatch', 'completed')
    RETURNING id INTO v_s3;
  -- Deliberately the compact '6NE' spelling: the duplicate detection must
  -- recognize it as the SAME unit as v_s3's '6 NE' (canonical unit_name_key).
  INSERT INTO public.student_shift_logs
    (student_id, cohort_id, school_email, shift_date, total_hours, unit_name, preceptor_name,
     shift_type, status, exception_flags, lifecycle_state)
  VALUES
    (v_student, v_cohort, 'zz.review@example.invalid', '2026-07-19', 8, '6NE', 'Alex Chen',
     'Day', 'Auto-Accepted', '[]'::jsonb, 'completed')
    RETURNING id INTO v_s3b;
  INSERT INTO public.student_shift_logs
    (student_id, cohort_id, school_email, shift_date, total_hours, unit_name, preceptor_name,
     shift_type, status, exception_flags, review_reason, lifecycle_state)
  VALUES
    (v_student, v_cohort, 'zz.review@example.invalid', '2026-07-22', 4, '6 NE', 'Suraya Stanekzai',
     'Day', 'Pending Review', '["unit_and_preceptor_mismatch"]'::jsonb, 'unit_and_preceptor_mismatch', 'completed')
    RETURNING id INTO v_s4;
  INSERT INTO public.student_shift_logs
    (student_id, cohort_id, school_email, shift_date, total_hours, unit_name, preceptor_name,
     shift_type, status, exception_flags, review_reason, lifecycle_state)
  VALUES
    (v_student, v_cohort, 'zz.review@example.invalid', '2026-07-25', 2, '6 NE', 'Suraya Stanekzai',
     'Day', 'Pending Review', '["hours_under_2"]'::jsonb, 'hours_under_2', 'completed')
    RETURNING id INTO v_s5;

  -- ── 1. Approve-as-submitted (no warnings on 2026-07-12) ───────────────────
  v_result := public.review_shift_log(v_s1, 'approved', v_reviewer, NULL, NULL, '[]'::jsonb);
  IF (v_result->>'ok')::boolean IS DISTINCT FROM true
     OR v_result->>'new_status' IS DISTINCT FROM 'Approved' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: approve-as-submitted refused (%)', v_result;
  END IF;
  SELECT approved_hours, pending_hours INTO v_row FROM public.students WHERE id = v_student;
  IF v_row.approved_hours <> 24 OR v_row.pending_hours <> 22 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: totals after approve wrong (approved %, pending %)',
      v_row.approved_hours, v_row.pending_hours;
  END IF;
  -- 24 approved > 12 required: crossing the threshold did NOT block anything.
  RAISE NOTICE 'ok: approve moved 8h pending->approved; 24 approved exceeds 12 required without blocking';

  -- ── 2. Unacknowledged same-day warning refuses the approval ───────────────
  BEGIN
    v_result := public.review_shift_log(v_s2, 'approved', v_reviewer, NULL, NULL, '[]'::jsonb);
    RAISE EXCEPTION 'SMOKE TEST FAILURE: same-day approval succeeded without acknowledgement';
  EXCEPTION WHEN SQLSTATE 'P0007' THEN
    IF position('same_day_shift' in SQLERRM) = 0 THEN
      RAISE EXCEPTION 'SMOKE TEST FAILURE: P0007 did not name the missing warning (%)', SQLERRM;
    END IF;
    RAISE NOTICE 'ok: unacknowledged same-day warning refused (P0007 named same_day_shift)';
  END;
  SELECT status INTO v_row FROM public.student_shift_logs WHERE id = v_s2;
  IF v_row.status IS DISTINCT FROM 'Pending Review' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: refused approval still changed the shift (status %)', v_row.status;
  END IF;
  SELECT count(*) INTO v_count FROM public.shift_log_reviews WHERE shift_log_id = v_s2;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: refused approval still wrote an audit row';
  END IF;
  RAISE NOTICE 'ok: refusal left the shift and the ledger untouched';

  -- ── 3. Acknowledged same-day warning proceeds deliberately ────────────────
  v_result := public.review_shift_log(v_s2, 'approved', v_reviewer, NULL, NULL, '["same_day_shift"]'::jsonb);
  IF (v_result->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: acknowledged approval refused (%)', v_result;
  END IF;
  SELECT approved_hours, pending_hours INTO v_row FROM public.students WHERE id = v_student;
  IF v_row.approved_hours <> 32 OR v_row.pending_hours <> 14 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: totals after acknowledged approve wrong (approved %, pending %)',
      v_row.approved_hours, v_row.pending_hours;
  END IF;
  RAISE NOTICE 'ok: acknowledged same-day approval proceeded (deliberate, not silent, not prohibited)';

  -- ── 4. Duplicate warning must ALSO be acknowledged; adjust preserves original
  BEGIN
    v_result := public.review_shift_log(v_s3, 'adjusted', v_reviewer, 'Trim to actual hours', 6, '["same_day_shift"]'::jsonb);
    RAISE EXCEPTION 'SMOKE TEST FAILURE: duplicate approval succeeded acknowledging only same_day_shift';
  EXCEPTION WHEN SQLSTATE 'P0007' THEN
    IF position('possible_duplicate' in SQLERRM) = 0 THEN
      RAISE EXCEPTION 'SMOKE TEST FAILURE: P0007 did not name possible_duplicate (%)', SQLERRM;
    END IF;
    RAISE NOTICE 'ok: duplicate warning enforced independently - and ''6NE'' matched ''6 NE'' (canonical unit identity)';
  END;

  v_result := public.review_shift_log(v_s3, 'adjusted', v_reviewer, 'Trim to actual hours', 6,
    '["same_day_shift","possible_duplicate"]'::jsonb);
  IF (v_result->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: fully acknowledged adjust refused (%)', v_result;
  END IF;
  SELECT status, total_hours INTO v_row FROM public.student_shift_logs WHERE id = v_s3;
  IF v_row.status IS DISTINCT FROM 'Approved' OR v_row.total_hours <> 6 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: adjust did not land (status %, hours %)', v_row.status, v_row.total_hours;
  END IF;
  SELECT original_total_hours, adjusted_total_hours, rationale INTO v_row
  FROM public.shift_log_reviews WHERE shift_log_id = v_s3;
  IF v_row.original_total_hours <> 8 OR v_row.adjusted_total_hours <> 6
     OR v_row.rationale <> 'Trim to actual hours' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: ledger lost the original/adjusted values (orig %, adj %)',
      v_row.original_total_hours, v_row.adjusted_total_hours;
  END IF;
  SELECT approved_hours, pending_hours INTO v_row FROM public.students WHERE id = v_student;
  IF v_row.approved_hours <> 38 OR v_row.pending_hours <> 6 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: totals after adjust wrong (approved %, pending %)',
      v_row.approved_hours, v_row.pending_hours;
  END IF;
  RAISE NOTICE 'ok: adjust-and-approve landed 6h; the ledger preserved the original 8h and the rationale';

  -- ── 5. Reject drains pending but PRESERVES the shift as history ───────────
  v_result := public.review_shift_log(v_s4, 'rejected', v_reviewer, 'Duplicate of an already-approved shift', NULL, '[]'::jsonb);
  IF (v_result->>'ok')::boolean IS DISTINCT FROM true
     OR v_result->>'new_status' IS DISTINCT FROM 'Rejected' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: reject refused (%)', v_result;
  END IF;
  SELECT status, total_hours, unit_name INTO v_row FROM public.student_shift_logs WHERE id = v_s4;
  IF v_row.status IS DISTINCT FROM 'Rejected' OR v_row.total_hours <> 4 OR v_row.unit_name <> '6 NE' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: rejected shift was altered or lost (status %, hours %)',
      v_row.status, v_row.total_hours;
  END IF;
  SELECT approved_hours, pending_hours INTO v_row FROM public.students WHERE id = v_student;
  IF v_row.approved_hours <> 38 OR v_row.pending_hours <> 2 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: totals after reject wrong (approved %, pending %)',
      v_row.approved_hours, v_row.pending_hours;
  END IF;
  RAISE NOTICE 'ok: reject drained 4h from pending, entered no bucket, and preserved the row as history';

  -- ── 6. A second decision can never double-apply ───────────────────────────
  BEGIN
    v_result := public.review_shift_log(v_s4, 'approved', v_reviewer, NULL, NULL, '[]'::jsonb);
    RAISE EXCEPTION 'SMOKE TEST FAILURE: second decision on a decided shift succeeded';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    -- Our own failure marker is also P0001 - discriminate on the message.
    IF position('SMOKE TEST FAILURE' in SQLERRM) > 0 THEN
      RAISE;
    END IF;
    RAISE NOTICE 'ok: repeated decision refused (P0001 shift_not_pending_review)';
  END;

  -- ── 7. Input rejections, each with its own code ───────────────────────────
  BEGIN
    v_result := public.review_shift_log(v_s5, 'obliterated', v_reviewer, 'x', NULL, '[]'::jsonb);
    RAISE EXCEPTION 'SMOKE TEST FAILURE: invalid decision accepted';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN
    RAISE NOTICE 'ok: invalid decision refused (P0003)';
  END;
  BEGIN
    v_result := public.review_shift_log(v_s5, 'rejected', v_reviewer, '   ', NULL, '[]'::jsonb);
    RAISE EXCEPTION 'SMOKE TEST FAILURE: reject without rationale accepted';
  EXCEPTION WHEN SQLSTATE 'P0004' THEN
    RAISE NOTICE 'ok: reject without rationale refused (P0004)';
  END;
  BEGIN
    v_result := public.review_shift_log(v_s5, 'approved', v_reviewer, NULL, 5, '[]'::jsonb);
    RAISE EXCEPTION 'SMOKE TEST FAILURE: adjusted hours on a plain approval accepted';
  EXCEPTION WHEN SQLSTATE 'P0005' THEN
    RAISE NOTICE 'ok: adjusted hours outside an adjust decision refused (P0005)';
  END;
  BEGIN
    v_result := public.review_shift_log(v_s5, 'adjusted', v_reviewer, 'x', 0, '[]'::jsonb);
    RAISE EXCEPTION 'SMOKE TEST FAILURE: zero adjusted hours accepted';
  EXCEPTION WHEN SQLSTATE 'P0005' THEN
    RAISE NOTICE 'ok: zero adjusted hours refused (P0005)';
  END;
  BEGIN
    v_result := public.review_shift_log(v_s5, 'approved', gen_random_uuid(), NULL, NULL, '[]'::jsonb);
    RAISE EXCEPTION 'SMOKE TEST FAILURE: unknown reviewer accepted';
  EXCEPTION WHEN SQLSTATE 'P0006' THEN
    RAISE NOTICE 'ok: unknown reviewer refused (P0006)';
  END;

  -- ── 8. Atomic past-shift submission: same lock, exact totals, idempotent ──
  -- State entering: approved 38, pending 2.
  v_s6 := gen_random_uuid();
  v_result := public.submit_past_shift_log(
    v_s6, v_student, v_cohort, 'zz.review@example.invalid', '2026-07-27', 3,
    '6 NE', false, 'Floated', 'Suraya Stanekzai', true, '', 'Day', '', '',
    'Pending Review', '["outside_rotation_dates"]'::jsonb, 'outside_rotation_dates');
  IF (v_result->>'inserted')::boolean IS DISTINCT FROM true
     OR (v_result->>'approved_hours')::numeric <> 38
     OR (v_result->>'pending_hours')::numeric <> 5 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: atomic submit wrong (%)', v_result;
  END IF;
  RAISE NOTICE 'ok: atomic past-shift submit inserted and recomputed exact totals under the lock';

  -- A retried submission is a no-op: same row back, nothing double-applied.
  v_result := public.submit_past_shift_log(
    v_s6, v_student, v_cohort, 'zz.review@example.invalid', '2026-07-27', 3,
    '6 NE', false, 'Floated', 'Suraya Stanekzai', true, '', 'Day', '', '',
    'Pending Review', '["outside_rotation_dates"]'::jsonb, 'outside_rotation_dates');
  IF (v_result->>'inserted')::boolean IS DISTINCT FROM false
     OR (v_result->>'approved_hours')::numeric <> 38
     OR (v_result->>'pending_hours')::numeric <> 5 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: idempotent retry double-applied (%)', v_result;
  END IF;
  RAISE NOTICE 'ok: retried submission is idempotent (inserted=false, totals unchanged)';

  -- Only intake statuses may enter through this path.
  BEGIN
    v_result := public.submit_past_shift_log(
      gen_random_uuid(), v_student, v_cohort, 'zz.review@example.invalid', '2026-07-28', 3,
      '6 NE', true, '', 'Suraya Stanekzai', true, '', 'Day', '', '',
      'Approved', '[]'::jsonb, NULL);
    RAISE EXCEPTION 'SMOKE TEST FAILURE: submit accepted a non-intake status';
  EXCEPTION WHEN SQLSTATE 'P0006' THEN
    RAISE NOTICE 'ok: past-shift submit refuses non-intake statuses (P0006)';
  END;

  -- ── 9. A submission cannot evade review warning detection ─────────────────
  -- A second same-day shift lands through the SAME serialized path, spelled
  -- '6ne': the later review of v_s6 must still see it - as a same-day shift
  -- AND as a possible duplicate (same canonical unit, same hours).
  v_s7 := gen_random_uuid();
  v_result := public.submit_past_shift_log(
    v_s7, v_student, v_cohort, 'zz.review@example.invalid', '2026-07-27', 3,
    '6ne', true, '', 'Alex Chen', true, '', 'Day', '', '',
    'Auto-Accepted', '[]'::jsonb, NULL);
  IF (v_result->>'approved_hours')::numeric <> 41 OR (v_result->>'pending_hours')::numeric <> 5 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: totals after concurrent-path submit wrong (%)', v_result;
  END IF;

  BEGIN
    v_result := public.review_shift_log(v_s6, 'approved', v_reviewer, NULL, NULL, '[]'::jsonb);
    RAISE EXCEPTION 'SMOKE TEST FAILURE: review missed the serialized same-day submission';
  EXCEPTION WHEN SQLSTATE 'P0007' THEN
    IF position('possible_duplicate' in SQLERRM) = 0 OR position('same_day_shift' in SQLERRM) = 0 THEN
      RAISE EXCEPTION 'SMOKE TEST FAILURE: review did not flag the ''6ne'' submission as duplicate+same-day (%)', SQLERRM;
    END IF;
    RAISE NOTICE 'ok: a serialized submission cannot evade detection - ''6ne'' flagged as duplicate of ''6 NE''';
  END;

  v_result := public.review_shift_log(v_s6, 'approved', v_reviewer, NULL, NULL,
    '["same_day_shift","possible_duplicate"]'::jsonb);
  IF (v_result->>'approved_hours')::numeric <> 44 OR (v_result->>'pending_hours')::numeric <> 2 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: totals after interleaved review wrong (%)', v_result;
  END IF;
  RAISE NOTICE 'ok: review + submission serialized into exact totals (44 approved / 2 pending)';

  -- ── 10. A REVIEWED submission id replays idempotently - never P0006 ───────
  -- v_s6 is now 'Approved' (step 9). A student's retry of the ORIGINAL intake
  -- payload must succeed idempotently: no insert, no status change, totals
  -- recomputed under the lock and unchanged.
  v_result := public.submit_past_shift_log(
    v_s6, v_student, v_cohort, 'zz.review@example.invalid', '2026-07-27', 3,
    '6 NE', false, 'Floated', 'Suraya Stanekzai', true, '', 'Day', '', '',
    'Pending Review', '["outside_rotation_dates"]'::jsonb, 'outside_rotation_dates');
  IF (v_result->>'inserted')::boolean IS DISTINCT FROM false
     OR v_result->'shift'->>'status' IS DISTINCT FROM 'Approved'
     OR (v_result->>'approved_hours')::numeric <> 44
     OR (v_result->>'pending_hours')::numeric <> 2 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: reviewed (Approved) resubmission not idempotent (%)', v_result;
  END IF;
  RAISE NOTICE 'ok: resubmitting an APPROVED id is idempotent - status kept, totals locked and unchanged';

  v_result := public.submit_past_shift_log(
    v_s4, v_student, v_cohort, 'zz.review@example.invalid', '2026-07-22', 4,
    '6 NE', false, 'Floated', 'Suraya Stanekzai', true, '', 'Day', '', '',
    'Pending Review', '["unit_and_preceptor_mismatch"]'::jsonb, 'unit_and_preceptor_mismatch');
  IF (v_result->>'inserted')::boolean IS DISTINCT FROM false
     OR v_result->'shift'->>'status' IS DISTINCT FROM 'Rejected'
     OR (v_result->>'approved_hours')::numeric <> 44
     OR (v_result->>'pending_hours')::numeric <> 2 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: reviewed (Rejected) resubmission not idempotent (%)', v_result;
  END IF;
  RAISE NOTICE 'ok: resubmitting a REJECTED id is idempotent - status kept, nothing re-entered any bucket';

  -- ── 11. An ADJUSTED row replays only its ORIGINAL; storage never mutates ──
  -- v_s3 was adjusted 8h -> 6h. Replaying the ORIGINAL 8h payload at the RPC
  -- layer is a no-op that returns the stored row exactly as the review left
  -- it: status 'Approved', hours 6, totals untouched. (The endpoint's
  -- 200-vs-409 arbitration against the ledger original is proven in the node
  -- behavioral tests; here we prove the DB layer can never be mutated by a
  -- replay.)
  v_result := public.submit_past_shift_log(
    v_s3, v_student, v_cohort, 'zz.review@example.invalid', '2026-07-19', 8,
    '6 NE', false, 'Floated', 'Suraya Stanekzai', true, '', 'Day', '', '',
    'Pending Review', '["unit_and_preceptor_mismatch"]'::jsonb, 'unit_and_preceptor_mismatch');
  IF (v_result->>'inserted')::boolean IS DISTINCT FROM false
     OR v_result->'shift'->>'status' IS DISTINCT FROM 'Approved'
     OR (v_result->'shift'->>'total_hours')::numeric <> 6
     OR (v_result->>'approved_hours')::numeric <> 44
     OR (v_result->>'pending_hours')::numeric <> 2 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: adjusted-row replay mutated something (%)', v_result;
  END IF;
  RAISE NOTICE 'ok: replaying the adjusted shift left the stored 6h and Approved status untouched';

  -- ── 12. SERVICE-ROLE EXECUTION: the production caller can decide ──────────
  -- Everything above ran as the SQL-editor superuser; the production caller is
  -- service_role. NOTE (verified in production): PostgreSQL does NOT require
  -- the inserting role to hold privileges on an IDENTITY column's linked
  -- sequence - identity generation happens internally, and table INSERT alone
  -- governs whether a row can be appended. Revoking sequence USAGE/SELECT is
  -- therefore NOT a valid negative control (the deny-all sequence posture is
  -- still pinned by the catalog checks in the migration's verification block).
  -- The permission that actually governs recording a decision is INSERT on
  -- shift_log_reviews - so that is what this control removes, transactionally.
  EXECUTE 'REVOKE INSERT ON public.shift_log_reviews FROM service_role';
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    v_result := public.review_shift_log(v_s5, 'rejected', v_reviewer, 'Logged in error - under 2 hours', NULL, '[]'::jsonb);
    RAISE EXCEPTION 'SMOKE TEST FAILURE: review succeeded WITHOUT the ledger INSERT grant';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: NEGATIVE CONTROL - without ledger INSERT, service_role cannot record a decision';
  END;
  -- Restoration is exception-safe by construction: it runs IMMEDIATELY after
  -- the probe, before any assertion that could abort - and if anything above
  -- escapes anyway (including the unexpected-success failure marker), the
  -- whole transaction aborts and ROLLBACK undoes both the revoke and the
  -- SET LOCAL role, so no path can leave the grant or the role altered.
  EXECUTE 'RESET ROLE';
  EXECUTE 'GRANT INSERT ON public.shift_log_reviews TO service_role';

  -- The refused decision rolled back WHOLE: the shift is still pending, the
  -- totals are untouched, and no ledger row exists for it.
  SELECT status INTO v_row FROM public.student_shift_logs WHERE id = v_s5;
  IF v_row.status IS DISTINCT FROM 'Pending Review' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: the privilege-refused decision half-applied (status %)', v_row.status;
  END IF;
  SELECT approved_hours, pending_hours INTO v_row FROM public.students WHERE id = v_student;
  IF v_row.approved_hours <> 44 OR v_row.pending_hours <> 2 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: the refused decision moved totals (approved %, pending %)',
      v_row.approved_hours, v_row.pending_hours;
  END IF;
  SELECT count(*) INTO v_count FROM public.shift_log_reviews WHERE original_shift_log_id = v_s5;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: the refused decision still wrote a ledger row';
  END IF;
  RAISE NOTICE 'ok: the refused decision left the shift pending, totals unchanged, and no ledger row';

  -- Now the real thing: a full decision executed AS service_role, proving the
  -- production caller can lock, decide, generate the identity, and recompute.
  EXECUTE 'SET LOCAL ROLE service_role';
  v_result := public.review_shift_log(v_s5, 'rejected', v_reviewer, 'Logged in error - under 2 hours', NULL, '[]'::jsonb);
  EXECUTE 'RESET ROLE';
  IF (v_result->>'ok')::boolean IS DISTINCT FROM true
     OR v_result->>'new_status' IS DISTINCT FROM 'Rejected'
     OR (v_result->>'approved_hours')::numeric <> 44
     OR (v_result->>'pending_hours')::numeric <> 0 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: service-role decision failed (%)', v_result;
  END IF;
  SELECT count(*) INTO v_count FROM public.shift_log_reviews WHERE original_shift_log_id = v_s5;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: service-role decision left no audit row';
  END IF;
  RAISE NOTICE 'ok: a full decision executed AS service_role - the production caller generates identities';

  -- ── 13. DELETION DURABILITY: review history outlives its sources ──────────
  SELECT id INTO v_audit_s1 FROM public.shift_log_reviews WHERE shift_log_id = v_s1;
  IF v_audit_s1 IS NULL THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: no audit row found for the approved shift';
  END IF;

  DELETE FROM public.student_shift_logs WHERE id = v_s1;
  SELECT shift_log_id, original_shift_log_id, original_student_id, original_total_hours,
         original_status, original_unit_name, original_preceptor_name, original_review_reason,
         student_name INTO v_row
  FROM public.shift_log_reviews WHERE id = v_audit_s1;
  IF v_row.shift_log_id IS NOT NULL
     OR v_row.original_shift_log_id IS DISTINCT FROM v_s1
     OR v_row.original_student_id IS DISTINCT FROM v_student
     OR v_row.original_total_hours <> 8
     OR v_row.original_status IS DISTINCT FROM 'Pending Review'
     OR v_row.original_unit_name IS DISTINCT FROM '6 NE'
     OR v_row.original_preceptor_name IS DISTINCT FROM 'Suraya Stanekzai'
     OR v_row.original_review_reason IS DISTINCT FROM 'unit_and_preceptor_mismatch'
     OR v_row.student_name IS DISTINCT FROM 'ZZ REVIEW Student' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: deleting the reviewed shift damaged its audit row';
  END IF;
  RAISE NOTICE 'ok: deleting the reviewed shift kept its FULL identity - which shift, which student, which unit/preceptor, and why';

  DELETE FROM public.students WHERE id = v_student;
  SELECT count(*) INTO v_count FROM public.shift_log_reviews
  WHERE student_name = 'ZZ REVIEW Student';
  IF v_count <> 6 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: deleting the student destroyed audit rows (found % of 6)', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.shift_log_reviews
  WHERE student_name = 'ZZ REVIEW Student' AND student_id IS NOT NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: a surviving audit row still holds a live link to the deleted student';
  END IF;
  -- The IMMUTABLE identity is untouched by both deletions: every surviving row
  -- still says exactly which student was reviewed.
  SELECT count(*) INTO v_count FROM public.shift_log_reviews
  WHERE original_student_id = v_student;
  IF v_count <> 6 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: immutable student identity lost after deletion (found % of 6)', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.shift_log_reviews
  WHERE original_student_id = v_student AND original_shift_log_id IS NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: an immutable shift identity is missing';
  END IF;
  RAISE NOTICE 'ok: deleting the student (cascading every shift) left all 6 audit rows fully identifiable';

  -- ── 14. The ledger holds exactly the six decisions, with resulting totals ─
  SELECT count(*) INTO v_count FROM public.shift_log_reviews
  WHERE student_name = 'ZZ REVIEW Student'
    AND (approved_hours_after IS NULL OR pending_hours_after IS NULL);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: an audit row is missing its resulting totals';
  END IF;
  RAISE NOTICE 'ok: append-only ledger holds all six decisions with resulting totals';

  RAISE NOTICE 'ALL REVIEW SMOKE TESTS PASSED';
END;
$$;

ROLLBACK;

-- Nothing persists - this runs AFTER the rollback and must return 0:
SELECT count(*) AS zz_review_fixture_rows_remaining
FROM public.cohorts WHERE name LIKE 'ZZ REVIEW%';
-- =============================================================================
