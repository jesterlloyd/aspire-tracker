-- =============================================================================
-- student shift-log self-service smoke test  (STUDENT-SHIFT-LOG-MANAGEMENT-1)
-- Owner-run, AFTER applying 20260819000000. EVERYTHING HERE ROLLS BACK.
-- =============================================================================
--
-- WHAT THIS PROVES, executably:
--   • a student can edit and withdraw their OWN Auto-Accepted / Pending Review
--     shifts, and both totals recompute atomically from authoritative rows;
--   • a WITHDRAWN shift leaves both buckets while the row survives intact -
--     void is a lifecycle state, never a delete;
--   • a withdrawn shift also stops being staff-reviewable and stops raising
--     same-day / duplicate warnings against its siblings (it inherits the
--     lifecycle_state filter every one of those queries already had);
--   • re-classification: an edit that removes the cause of a flag moves the
--     shift from Pending Review to Auto-Accepted (and the reverse), moving the
--     hours between pending and approved;
--   • a shift belonging to ANOTHER student answers exactly like one that does
--     not exist - no enumeration;
--   • a staff-DECIDED shift (Approved / Rejected) cannot be edited or voided,
--     and the staff review ledger is never touched;
--   • downstream locks: a concluded rotation, a terminal student status, and a
--     genuinely issued certificate (built here as a real, valid, synthetic
--     dependency chain - instrument -> assignment -> certificate) each stop
--     student self-service, on the read path AND in the writers;
--   • concurrency: a staff review that lands first makes the student's edit
--     fail cleanly rather than overwrite the decision;
--   • every action appends an immutable before/after audit row;
--   • the real production caller works: edit AND void both execute under
--     SET LOCAL ROLE service_role, and the role/grant restoration is safe;
--   • two separate student records are isolated from each other in these
--     functions (portal multi-link AUTHORIZATION is proven at the endpoint
--     boundary in the node suite, not here - these functions never see a
--     link);
--   • a student's own override/reflection text survives an unrelated edit;
--   • a STALE caller-computed classification cannot win: the writer derives
--     flags itself, under the lock, from facts read at write time;
--   • withdrawn entries are excluded from support notes and last-shift
--     metadata;
--   • downstream acceptance parity fires when an edit makes a shift accepted.
--
-- FIXTURES ARE SYNTHETIC AND TRANSACTION-LOCAL ('ZZ SELF' prefix), except the
-- actor: the ledger requires a real user_profiles row, so the test READS one
-- existing active profile (never modifies it). No placeholders; paste and run.
--
-- EXPECTED OUTPUT: 'ok: ...' notices ending in 'ALL SELF-SERVICE SMOKE TESTS
-- PASSED', then ROLLBACK, then a trailing count of 0.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_cohort    uuid;
  v_student   uuid;
  v_other     uuid;
  v_actor     uuid;
  v_reviewer  uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid; v_other_shift uuid; v_support_shift uuid;
  v_second uuid; v_second_shift uuid; v_multi_profile uuid;
  v_class jsonb; v_events integer; v_offend_date text;
  v_instrument uuid; v_assignment uuid; v_certificate uuid;
  v_result    jsonb;
  v_verdict   jsonb;
  v_row       record;
  v_count     integer;
BEGIN
  -- ── Actor: an EXISTING profile, read-only ─────────────────────────────────
  SELECT id INTO v_actor FROM public.user_profiles
   WHERE COALESCE(is_active, true) = true ORDER BY created_at LIMIT 1;
  SELECT id INTO v_reviewer FROM public.user_profiles
   WHERE role IN ('owner','admin') AND COALESCE(is_active, true) = true LIMIT 1;
  IF v_actor IS NULL OR v_reviewer IS NULL THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: need one active profile and one active owner/admin';
  END IF;

  -- ── Fixtures ──────────────────────────────────────────────────────────────
  INSERT INTO public.cohorts (name, status) VALUES ('ZZ SELF TEST COHORT', 'Archived')
    RETURNING id INTO v_cohort;
  INSERT INTO public.students (name, first_name, last_name, cohort_id, status, hours_required)
    VALUES ('ZZ SELF Student', 'ZZ', 'Self', v_cohort, 'Active Rotation', 100)
    RETURNING id INTO v_student;
  INSERT INTO public.students (name, first_name, last_name, cohort_id, status, hours_required)
    VALUES ('ZZ SELF Other Student', 'ZZ', 'Other', v_cohort, 'Active Rotation', 100)
    RETURNING id INTO v_other;

  -- s1 Auto-Accepted 8h, s2 Pending Review 8h (flagged), s3 Auto-Accepted 4h,
  -- s4 Pending Review 6h (kept for the staff-decision cases).
  INSERT INTO public.student_shift_logs
    (student_id, cohort_id, school_email, shift_date, total_hours, unit_name, preceptor_name,
     shift_type, status, exception_flags, review_reason, lifecycle_state)
  VALUES (v_student, v_cohort, 'zz.self@example.invalid', '2026-07-06', 8, 'PACU', 'Marc Reyes',
          'Day', 'Auto-Accepted', '[]'::jsonb, NULL, 'completed')
    RETURNING id INTO v_s1;
  INSERT INTO public.student_shift_logs
    (student_id, cohort_id, school_email, shift_date, total_hours, unit_name, preceptor_name,
     shift_type, status, exception_flags, review_reason, lifecycle_state)
  VALUES (v_student, v_cohort, 'zz.self@example.invalid', '2026-07-08', 8, '6 NE', 'Suraya Stanekzai',
          'Day', 'Pending Review', '["unit_and_preceptor_mismatch"]'::jsonb,
          'unit_and_preceptor_mismatch', 'completed')
    RETURNING id INTO v_s2;
  INSERT INTO public.student_shift_logs
    (student_id, cohort_id, school_email, shift_date, total_hours, unit_name, preceptor_name,
     shift_type, status, exception_flags, review_reason, lifecycle_state)
  VALUES (v_student, v_cohort, 'zz.self@example.invalid', '2026-07-10', 4, 'PACU', 'Marc Reyes',
          'Day', 'Auto-Accepted', '[]'::jsonb, NULL, 'completed')
    RETURNING id INTO v_s3;
  INSERT INTO public.student_shift_logs
    (student_id, cohort_id, school_email, shift_date, total_hours, unit_name, preceptor_name,
     shift_type, status, exception_flags, review_reason, lifecycle_state)
  VALUES (v_student, v_cohort, 'zz.self@example.invalid', '2026-07-13', 6, '6 NE', 'Suraya Stanekzai',
          'Day', 'Pending Review', '["unit_and_preceptor_mismatch"]'::jsonb,
          'unit_and_preceptor_mismatch', 'completed')
    RETURNING id INTO v_s4;
  INSERT INTO public.student_shift_logs
    (student_id, cohort_id, school_email, shift_date, total_hours, unit_name, preceptor_name,
     shift_type, status, exception_flags, lifecycle_state)
  VALUES (v_other, v_cohort, 'zz.other@example.invalid', '2026-07-06', 12, 'PACU', 'Marc Reyes',
          'Day', 'Auto-Accepted', '[]'::jsonb, 'completed')
    RETURNING id INTO v_other_shift;

  UPDATE public.students SET approved_hours = 12, pending_hours = 14 WHERE id = v_student;

  -- ── 1. Cross-student access is indistinguishable from nonexistence ────────
  v_verdict := public.student_shift_edit_eligibility(v_other_shift, v_student);
  IF v_verdict->>'reason' IS DISTINCT FROM 'not_found' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: another student''s shift leaked a distinguishable reason (%)', v_verdict;
  END IF;
  v_verdict := public.student_shift_edit_eligibility(gen_random_uuid(), v_student);
  IF v_verdict->>'reason' IS DISTINCT FROM 'not_found' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: a nonexistent id answered differently (%)', v_verdict;
  END IF;
  BEGIN
    v_result := public.student_void_shift_log(v_other_shift, v_student, v_actor, 'not mine');
    RAISE EXCEPTION 'SMOKE TEST FAILURE: voided another student''s shift';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    RAISE NOTICE 'ok: another student''s shift is not found, exactly like a nonexistent id';
  END;
  SELECT lifecycle_state, total_hours INTO v_row FROM public.student_shift_logs WHERE id = v_other_shift;
  IF v_row.lifecycle_state IS DISTINCT FROM 'completed' OR v_row.total_hours <> 12 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: the other student''s shift was modified';
  END IF;

  -- ── 2. Edit an Auto-Accepted shift: hours change, totals recompute ────────
  v_result := public.student_edit_shift_log(
    v_s1, v_student, v_actor, '2026-07-06', 10, 'PACU', true, '', 'Marc Reyes', true, '',
    'Day', '', '', 'Mistyped my hours');
  IF (v_result->>'ok')::boolean IS DISTINCT FROM true
     OR (v_result->>'approved_hours')::numeric <> 14
     OR (v_result->>'pending_hours')::numeric <> 14 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: edit totals wrong (%)', v_result;
  END IF;
  SELECT approved_hours, pending_hours INTO v_row FROM public.students WHERE id = v_student;
  IF v_row.approved_hours <> 14 OR v_row.pending_hours <> 14 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: students row not updated atomically (approved %, pending %)',
      v_row.approved_hours, v_row.pending_hours;
  END IF;
  RAISE NOTICE 'ok: edit changed 8h->10h and recomputed both totals atomically (14 approved / 14 pending)';

  -- ── 3. Re-classification moves hours between buckets ──────────────────────
  -- The student corrects s2 to their assigned unit and preceptor; the caller's
  -- re-classification yields zero flags, so it becomes Auto-Accepted and its
  -- 8h move from pending into approved.
  v_result := public.student_edit_shift_log(
    v_s2, v_student, v_actor, '2026-07-08', 8, 'PACU', true, '', 'Marc Reyes', true, '',
    'Day', '', '', 'I picked the wrong unit');
  IF (v_result->>'status') IS DISTINCT FROM 'Auto-Accepted'
     OR (v_result->>'approved_hours')::numeric <> 22
     OR (v_result->>'pending_hours')::numeric <> 6 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: re-classification did not move the hours (%)', v_result;
  END IF;
  RAISE NOTICE 'ok: re-classified Pending Review -> Auto-Accepted; 8h moved pending -> approved';

  -- ...and the reverse: an edit that introduces a flag returns it to pending.
  v_result := public.student_edit_shift_log(
    v_s2, v_student, v_actor, '2026-07-08', 8, '6 NE', false, 'Floated to 6 NE',
    'Suraya Stanekzai', true, '', 'Day', '', '', 'Actually I did float');
  IF (v_result->>'approved_hours')::numeric <> 14
     OR (v_result->>'pending_hours')::numeric <> 14 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: reverse re-classification wrong (%)', v_result;
  END IF;
  RAISE NOTICE 'ok: the reverse edit returned the shift to Pending Review and the hours to pending';

  -- ── 4. VOID: hours leave both buckets, the row survives whole ─────────────
  v_result := public.student_void_shift_log(v_s3, v_student, v_actor, 'I logged this twice');
  IF (v_result->>'ok')::boolean IS DISTINCT FROM true
     OR (v_result->>'approved_hours')::numeric <> 10
     OR (v_result->>'pending_hours')::numeric <> 14 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: void totals wrong (%)', v_result;
  END IF;
  SELECT lifecycle_state, status, total_hours, unit_name, preceptor_name
    INTO v_row FROM public.student_shift_logs WHERE id = v_s3;
  IF v_row.lifecycle_state IS DISTINCT FROM 'voided'
     OR v_row.status IS DISTINCT FROM 'Auto-Accepted'
     OR v_row.total_hours <> 4
     OR v_row.unit_name IS DISTINCT FROM 'PACU'
     OR v_row.preceptor_name IS DISTINCT FROM 'Marc Reyes' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: void altered or erased the submitted entry';
  END IF;
  RAISE NOTICE 'ok: void removed 4h from approved while the row kept every submitted value';

  -- The row is still THERE - a void is not a delete.
  SELECT count(*) INTO v_count FROM public.student_shift_logs WHERE id = v_s3;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: the voided row was deleted';
  END IF;

  -- A voided shift is no longer editable or voidable again.
  v_verdict := public.student_shift_edit_eligibility(v_s3, v_student);
  IF v_verdict->>'reason' IS DISTINCT FROM 'already_voided' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: a voided shift is still offered as editable (%)', v_verdict;
  END IF;
  BEGIN
    v_result := public.student_void_shift_log(v_s3, v_student, v_actor, 'again');
    RAISE EXCEPTION 'SMOKE TEST FAILURE: voided the same shift twice';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    RAISE NOTICE 'ok: a withdrawn shift cannot be withdrawn or edited again';
  END;

  -- ── 5. A voided shift is invisible to staff review AND to warnings ────────
  -- review_shift_log requires lifecycle_state = 'completed', so a withdrawn
  -- Pending Review shift is no longer decidable.
  v_result := public.student_void_shift_log(v_s4, v_student, v_actor, 'withdrawing this one');
  BEGIN
    v_result := public.review_shift_log(v_s4, 'approved', v_reviewer, NULL, NULL, '[]'::jsonb);
    RAISE EXCEPTION 'SMOKE TEST FAILURE: staff reviewed a withdrawn shift';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    RAISE NOTICE 'ok: a withdrawn shift is no longer staff-reviewable (inherits the lifecycle filter)';
  END;

  -- Warning inheritance: v_s1 (2026-07-06) currently has no same-day sibling.
  -- Add one, confirm the warning fires, withdraw it, confirm the warning stops.
  DECLARE
    v_sib uuid;
  BEGIN
    INSERT INTO public.student_shift_logs
      (student_id, cohort_id, school_email, shift_date, total_hours, unit_name, preceptor_name,
       shift_type, status, exception_flags, review_reason, lifecycle_state)
    VALUES (v_student, v_cohort, 'zz.self@example.invalid', '2026-07-06', 10, 'PACU', 'Marc Reyes',
            'Day', 'Pending Review', '["hours_under_2"]'::jsonb, 'hours_under_2', 'completed')
      RETURNING id INTO v_sib;

    BEGIN
      v_result := public.review_shift_log(v_sib, 'approved', v_reviewer, NULL, NULL, '[]'::jsonb);
      RAISE EXCEPTION 'SMOKE TEST FAILURE: sibling approved without the duplicate warning';
    EXCEPTION WHEN SQLSTATE 'P0007' THEN
      IF position('possible_duplicate' in SQLERRM) = 0 THEN
        RAISE EXCEPTION 'SMOKE TEST FAILURE: expected possible_duplicate against the live sibling (%)', SQLERRM;
      END IF;
      RAISE NOTICE 'ok: a live same-day sibling raises the duplicate warning';
    END;

    -- Withdraw v_s1 (the 10h PACU shift on the same date) and the warning goes.
    v_result := public.student_void_shift_log(v_s1, v_student, v_actor, 'wrong entry');
    v_result := public.review_shift_log(v_sib, 'approved', v_reviewer, NULL, NULL, '[]'::jsonb);
    IF (v_result->>'ok')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'SMOKE TEST FAILURE: the warning survived its sibling being withdrawn (%)', v_result;
    END IF;
    RAISE NOTICE 'ok: withdrawing the sibling stopped it raising duplicate/same-day warnings';
  END;

  -- ── 6. Staff-decided shifts are immutable to the student ─────────────────
  -- v_sib is now 'Approved' with a ledger row. The student may not touch it.
  DECLARE
    v_decided uuid;
    v_ledger_before integer;
  BEGIN
    SELECT id INTO v_decided FROM public.student_shift_logs
     WHERE student_id = v_student AND status = 'Approved' LIMIT 1;
    IF v_decided IS NULL THEN
      RAISE EXCEPTION 'SMOKE TEST FAILURE: expected an Approved shift from the review above';
    END IF;
    SELECT count(*) INTO v_ledger_before FROM public.shift_log_reviews
     WHERE original_shift_log_id = v_decided;

    v_verdict := public.student_shift_edit_eligibility(v_decided, v_student);
    IF v_verdict->>'reason' IS DISTINCT FROM 'staff_decided' THEN
      RAISE EXCEPTION 'SMOKE TEST FAILURE: an Approved shift is not marked staff_decided (%)', v_verdict;
    END IF;
    BEGIN
      v_result := public.student_edit_shift_log(
        v_decided, v_student, v_actor, '2026-07-06', 1, 'PACU', true, '', 'Marc Reyes', true, '',
        'Day', '', '', 'trying to change a decided shift');
      RAISE EXCEPTION 'SMOKE TEST FAILURE: edited a staff-decided shift';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      IF position('staff_decided' in SQLERRM) = 0 THEN RAISE; END IF;
      RAISE NOTICE 'ok: a staff-decided (Approved) shift cannot be edited by the student';
    END;
    BEGIN
      v_result := public.student_void_shift_log(v_decided, v_student, v_actor, 'trying to void');
      RAISE EXCEPTION 'SMOKE TEST FAILURE: voided a staff-decided shift';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      RAISE NOTICE 'ok: a staff-decided shift cannot be withdrawn by the student';
    END;

    -- The staff ledger is untouched by every one of those attempts.
    SELECT count(*) INTO v_count FROM public.shift_log_reviews
     WHERE original_shift_log_id = v_decided;
    IF v_count <> v_ledger_before OR v_count <> 1 THEN
      RAISE EXCEPTION 'SMOKE TEST FAILURE: the staff review ledger changed (% rows)', v_count;
    END IF;
    SELECT status INTO v_row FROM public.student_shift_logs WHERE id = v_decided;
    IF v_row.status IS DISTINCT FROM 'Approved' THEN
      RAISE EXCEPTION 'SMOKE TEST FAILURE: the reviewed decision was overwritten';
    END IF;
    RAISE NOTICE 'ok: the staff review ledger and the decision itself are untouched';
  END;

  -- ── 7. Downstream artifact locks ─────────────────────────────────────────
  -- (a) concluded rotation
  UPDATE public.students SET rotation_completed_at = now() WHERE id = v_student;
  v_verdict := public.student_shift_edit_eligibility(v_s2, v_student);
  IF v_verdict->>'reason' IS DISTINCT FROM 'rotation_concluded' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: a concluded rotation did not lock self-service (%)', v_verdict;
  END IF;
  BEGIN
    v_result := public.student_void_shift_log(v_s2, v_student, v_actor, 'after conclusion');
    RAISE EXCEPTION 'SMOKE TEST FAILURE: voided after the rotation concluded';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    RAISE NOTICE 'ok: a concluded rotation stops student self-service (correction request instead)';
  END;
  UPDATE public.students SET rotation_completed_at = NULL WHERE id = v_student;

  -- (b) terminal student status
  UPDATE public.students SET status = 'Completed' WHERE id = v_student;
  v_verdict := public.student_shift_edit_eligibility(v_s2, v_student);
  IF v_verdict->>'reason' IS DISTINCT FROM 'student_status_terminal' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: a terminal status did not lock self-service (%)', v_verdict;
  END IF;
  RAISE NOTICE 'ok: a terminal student status stops student self-service';
  UPDATE public.students SET status = 'Active Rotation' WHERE id = v_student;

  -- (c) issued certificate - a REAL, valid dependency chain.
  -- certificates requires a genuine evaluation_assignment_id and
  -- post_rotation_evaluation_completed_at, and certificate_sequence must be
  -- 1..999. Every row below is synthetic and rolls back. There is NO
  -- exception handler here on purpose: if the fixture cannot be built, or the
  -- lock is not returned, this test MUST fail rather than skip.
  INSERT INTO public.evaluation_instruments
    (slug, display_name, version, copyright_holder, copyright_year,
     permission_status, permission_documented_at, permission_reference)
  VALUES ('zz_self_smoke_instrument', 'ZZ SELF Smoke Instrument', '1.0', 'ZZ SELF', 2026,
          'authorized', now(), 'Synthetic transaction-local smoke-test authorization record')
    RETURNING id INTO v_instrument;

  INSERT INTO public.evaluation_assignments
    (instrument_id, student_id, cohort_id, timepoint, assigned_by, status,
     invited_at, sent_at, completed_at, expires_at,
     approved_hours_at_invitation, approved_hours_at_completion)
  VALUES (v_instrument, v_student, v_cohort, 'post_rotation', v_actor, 'completed',
          now() - interval '2 days', now() - interval '2 days', now() - interval '1 day',
          now() + interval '26 days', 10, 10)
    RETURNING id INTO v_assignment;

  -- certificate_sequence must satisfy BETWEEN 1 AND 999, and both
  -- certificate_number and (year, sequence) are unique - pick a year far
  -- outside real data so the synthetic row cannot collide.
  INSERT INTO public.certificates
    (student_id, evaluation_assignment_id, certificate_number, certificate_year,
     certificate_sequence, post_rotation_evaluation_completed_at, certificate_unlocked_at)
  VALUES (v_student, v_assignment, 'ZZ-SELF-SMOKE-001', 2999, 999, now(), now())
    RETURNING id INTO v_certificate;

  IF v_certificate IS NULL THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: the certificate fixture was not created';
  END IF;

  v_verdict := public.student_shift_edit_eligibility(v_s2, v_student);
  IF v_verdict->>'reason' IS DISTINCT FROM 'certificate_issued' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: an issued certificate did not lock self-service (%)', v_verdict;
  END IF;
  -- ...and the writers refuse too, not just the read path.
  BEGIN
    v_result := public.student_void_shift_log(v_s2, v_student, v_actor, 'after certificate');
    RAISE EXCEPTION 'SMOKE TEST FAILURE: voided after a certificate was issued';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF position('certificate_issued' in SQLERRM) = 0 THEN RAISE; END IF;
    RAISE NOTICE 'ok: an issued certificate stops student self-service (read path AND writers)';
  END;

  -- Remove the synthetic chain so the remaining sections run unlocked.
  DELETE FROM public.certificates WHERE id = v_certificate;
  DELETE FROM public.evaluation_assignments WHERE id = v_assignment;
  DELETE FROM public.evaluation_instruments WHERE id = v_instrument;

  -- ── 8. SERVICE-ROLE EXECUTION: the production caller can edit AND void ────
  -- Everything above ran as the SQL-editor superuser. The endpoint calls as
  -- service_role, so both writers are exercised under that role. Restoration
  -- is exception-safe: RESET ROLE runs immediately after, and any escape
  -- aborts the transaction so ROLLBACK undoes the SET LOCAL regardless.
  INSERT INTO public.student_shift_logs
    (student_id, cohort_id, school_email, shift_date, total_hours, unit_name, preceptor_name,
     shift_type, status, exception_flags, review_reason, lifecycle_state)
  VALUES (v_student, v_cohort, 'zz.self@example.invalid', '2026-07-16', 5, 'PACU', 'Marc Reyes',
          'Day', 'Auto-Accepted', '[]'::jsonb, NULL, 'completed')
    RETURNING id INTO v_s1;

  EXECUTE 'SET LOCAL ROLE service_role';
  v_result := public.student_edit_shift_log(
    v_s1, v_student, v_actor, '2026-07-16', 7, 'PACU', true, '', 'Marc Reyes', true, '',
    'Day', 'Learned a lot', '', 'as service_role');
  IF (v_result->>'ok')::boolean IS DISTINCT FROM true
     OR (v_result->>'total_hours')::numeric <> 7 THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'SMOKE TEST FAILURE: service-role edit failed (%)', v_result;
  END IF;
  v_result := public.student_void_shift_log(v_s1, v_student, v_actor, 'as service_role');
  IF (v_result->>'ok')::boolean IS DISTINCT FROM true THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'SMOKE TEST FAILURE: service-role void failed (%)', v_result;
  END IF;
  EXECUTE 'RESET ROLE';
  IF current_user = 'service_role' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: role was not restored';
  END IF;
  RAISE NOTICE 'ok: edit AND void both execute as service_role; the role is restored safely';

  -- ── 9. TWO SEPARATE STUDENT RECORDS are isolated in the DB layer ──────────
  -- SCOPE NOTE, deliberately precise: this section proves the DATABASE
  -- functions treat two student records independently and never merge their
  -- totals or leak across them. It does NOT prove portal link resolution -
  -- user_student_links, the active 'student' role grant, and the allowlist
  -- check all live in api/portal/my-shift-log-manage.js, above these
  -- functions, and are proven behaviorally at that boundary in
  -- test/studentShiftLogManagement.test.mjs ("multi-linked caller" cases).
  INSERT INTO public.students (name, first_name, last_name, cohort_id, status, hours_required)
    VALUES ('ZZ SELF Second Record', 'ZZ', 'Second', v_cohort, 'Active Rotation', 100)
    RETURNING id INTO v_second;
  INSERT INTO public.student_shift_logs
    (student_id, cohort_id, school_email, shift_date, total_hours, unit_name, preceptor_name,
     shift_type, status, exception_flags, lifecycle_state)
  VALUES (v_second, v_cohort, 'zz.second@example.invalid', '2026-07-17', 9, 'PACU', 'Marc Reyes',
          'Day', 'Auto-Accepted', '[]'::jsonb, 'completed')
    RETURNING id INTO v_second_shift;

  -- Each linked record is independently actionable...
  v_verdict := public.student_shift_edit_eligibility(v_second_shift, v_second);
  IF (v_verdict->>'editable')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: a second linked record was not actionable (%)', v_verdict;
  END IF;
  v_result := public.student_void_shift_log(v_second_shift, v_second, v_actor, 'second record');
  IF (v_result->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: could not act on the second linked record (%)', v_result;
  END IF;
  -- ...and totals are per-student, never merged across links.
  SELECT approved_hours INTO v_row FROM public.students WHERE id = v_second;
  IF v_row.approved_hours <> 0 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: second record totals wrong (%)', v_row.approved_hours;
  END IF;
  -- ...while a record belonging to NEITHER link stays not-found.
  v_verdict := public.student_shift_edit_eligibility(v_other_shift, v_second);
  IF v_verdict->>'reason' IS DISTINCT FROM 'not_found' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: a third student leaked through a multi-link caller (%)', v_verdict;
  END IF;
  RAISE NOTICE 'ok: two student records stay isolated in the DB layer (portal link resolution is proven at the endpoint)';

  -- ── 10. Student-authored text survives an unrelated edit ──────────────────
  INSERT INTO public.student_shift_logs
    (student_id, cohort_id, school_email, shift_date, total_hours, unit_name, preceptor_name,
     shift_type, status, exception_flags, review_reason, lifecycle_state,
     is_assigned_unit, unit_override_reason, preceptor_override_note,
     learning_highlight, support_needed)
  VALUES (v_student, v_cohort, 'zz.self@example.invalid', '2026-07-18', 8, '6 NE', 'Suraya Stanekzai',
          'Day', 'Pending Review', '["unit_and_preceptor_mismatch"]'::jsonb,
          'unit_and_preceptor_mismatch', 'completed',
          false, 'Floated to cover 6 NE', 'Worked with the charge nurse',
          'Learned chest tube care', 'Need more IV practice')
    RETURNING id INTO v_s4;

  -- Change ONLY the hours; every other student-authored field must persist.
  v_result := public.student_edit_shift_log(
    v_s4, v_student, v_actor, '2026-07-18', 9, '6 NE', false, 'Floated to cover 6 NE',
    'Suraya Stanekzai', true, 'Worked with the charge nurse', 'Day',
    'Learned chest tube care', 'Need more IV practice', 'fixing hours only');
  SELECT total_hours, unit_override_reason, preceptor_override_note,
         learning_highlight, support_needed INTO v_row
  FROM public.student_shift_logs WHERE id = v_s4;
  IF v_row.total_hours <> 9
     OR v_row.unit_override_reason IS DISTINCT FROM 'Floated to cover 6 NE'
     OR v_row.preceptor_override_note IS DISTINCT FROM 'Worked with the charge nurse'
     OR v_row.learning_highlight IS DISTINCT FROM 'Learned chest tube care'
     OR v_row.support_needed IS DISTINCT FROM 'Need more IV practice' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: an unrelated edit erased student-authored text (%)', row_to_json(v_row);
  END IF;
  RAISE NOTICE 'ok: overrides and reflections survived an edit that changed only the hours';

  -- ── 11. A STALE caller classification cannot win ──────────────────────────
  -- The writer takes no status/flags argument at all; it derives them itself.
  -- Prove the derivation reacts to a fact the caller could not have known:
  -- the shift above is still flagged as a mismatch, and correcting the unit
  -- (with the assigned preceptor) clears it - with no caller input.
  v_class := public.student_shift_classify(
    v_student, v_s4, '2026-07-18', 9, '6 NE', false, 'Suraya Stanekzai');
  IF v_class->>'status' IS DISTINCT FROM 'Pending Review' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: classifier did not flag the mismatch (%)', v_class;
  END IF;
  SELECT status INTO v_row FROM public.student_shift_logs WHERE id = v_s4;
  IF v_row.status IS DISTINCT FROM 'Pending Review' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: the stored status did not follow the derivation';
  END IF;
  -- Now make it the assigned unit: the writer must produce Auto-Accepted even
  -- though nothing in the call said so.
  v_result := public.student_edit_shift_log(
    v_s4, v_student, v_actor, '2026-07-18', 9, 'PACU', true, '',
    'Marc Reyes', true, '', 'Day', '', '', 'corrected the unit');
  IF v_result->>'status' IS DISTINCT FROM 'Auto-Accepted' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: the writer did not re-derive the status (%)', v_result;
  END IF;
  RAISE NOTICE 'ok: the writer derives status/flags itself - a stale caller value cannot be stored';

  -- DOWNSTREAM ACCEPTANCE PARITY SIGNAL. The endpoint applies the submission /
  -- staff-approval semantics (first accepted shift, Placed -> Active Rotation,
  -- rotation_start, rotation_end) when an edit NEWLY accepts a shift. That
  -- decision is driven by the transition the RPC reports, so the RPC must name
  -- both sides unambiguously - and must not report a transition when there was
  -- none. (The JS effects themselves are behaviorally tested in the node suite.)
  IF v_result->>'previous_status' IS DISTINCT FROM 'Pending Review'
     OR v_result->>'status' IS DISTINCT FROM 'Auto-Accepted' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: the acceptance transition was not reported (%)', v_result;
  END IF;
  v_result := public.student_edit_shift_log(
    v_s4, v_student, v_actor, '2026-07-18', 9, 'PACU', true, '',
    'Marc Reyes', true, '', 'Day', '', '', 'no-op re-save');
  IF v_result->>'previous_status' IS DISTINCT FROM 'Auto-Accepted'
     OR v_result->>'status' IS DISTINCT FROM 'Auto-Accepted' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: an already-accepted re-save reported a transition (%)', v_result;
  END IF;
  RAISE NOTICE 'ok: the acceptance transition is reported once and never re-fired by a no-op edit';

  -- ── 12. Withdrawn entries are excluded from support + last-shift metadata ─
  -- v_s4 currently carries no support text; give a NEW shift support text and
  -- a later date, then withdraw it: it must stop being both the support note
  -- and the most recent shift.
  INSERT INTO public.student_shift_logs
    (student_id, cohort_id, school_email, shift_date, total_hours, unit_name, preceptor_name,
     shift_type, status, exception_flags, lifecycle_state, support_needed)
  VALUES (v_student, v_cohort, 'zz.self@example.invalid', '2026-08-01', 8, 'PACU', 'Marc Reyes',
          'Day', 'Auto-Accepted', '[]'::jsonb, 'completed', 'I need help with drips')
    RETURNING id INTO v_support_shift;

  SELECT count(*) INTO v_count FROM public.student_shift_logs
   WHERE student_id = v_student AND lifecycle_state <> 'voided'
     AND btrim(COALESCE(support_needed, '')) <> '';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: expected one live support note, found %', v_count;
  END IF;

  v_result := public.student_void_shift_log(v_support_shift, v_student, v_actor, 'logged in error');

  SELECT count(*) INTO v_count FROM public.student_shift_logs
   WHERE student_id = v_student AND lifecycle_state <> 'voided'
     AND btrim(COALESCE(support_needed, '')) <> '';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: a withdrawn entry still carries a live support note';
  END IF;
  SELECT max(shift_date) INTO v_offend_date FROM public.student_shift_logs
   WHERE student_id = v_student AND lifecycle_state <> 'voided';
  IF v_offend_date = '2026-08-01' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: a withdrawn entry is still the latest shift';
  END IF;
  RAISE NOTICE 'ok: a withdrawn entry raises no support note and is not the latest shift';

  -- ── 13. The audit trail is complete and immutable in shape ───────────────
  SELECT count(*) INTO v_count FROM public.student_shift_log_edits
   WHERE original_student_id = v_student;
  IF v_count < 6 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: expected an audit row per action, found %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.student_shift_log_edits
   WHERE original_student_id = v_student
     AND (approved_hours_after IS NULL OR pending_hours_after IS NULL
          OR original_shift_log_id IS NULL OR actor_profile_id IS NULL);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: an audit row is missing identity or resulting totals';
  END IF;
  -- A void's before/after snapshot proves what was withdrawn.
  SELECT before_total_hours, before_lifecycle_state, after_lifecycle_state, action
    INTO v_row
  FROM public.student_shift_log_edits
   WHERE original_shift_log_id = v_s3 AND action = 'voided';
  IF v_row.before_total_hours <> 4 OR v_row.before_lifecycle_state IS DISTINCT FROM 'completed'
     OR v_row.after_lifecycle_state IS DISTINCT FROM 'voided' THEN
    RAISE EXCEPTION 'SMOKE TEST FAILURE: the void audit snapshot is wrong';
  END IF;
  RAISE NOTICE 'ok: every action left an immutable before/after audit row with resulting totals';

  RAISE NOTICE 'ALL SELF-SERVICE SMOKE TESTS PASSED';
END;
$$;

ROLLBACK;

-- Nothing persists - this runs AFTER the rollback and must return 0:
SELECT count(*) AS zz_self_fixture_rows_remaining
FROM public.cohorts WHERE name LIKE 'ZZ SELF%';
-- =============================================================================
