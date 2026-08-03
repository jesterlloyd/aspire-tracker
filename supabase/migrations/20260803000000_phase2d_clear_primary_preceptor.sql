-- ============================================================================
-- PHASE 2D: canonical primary-preceptor CLEAR (R1) -- APPLIED 2026-08-03
-- ============================================================================
-- *** STATUS: APPLIED MANUALLY by the Owner in the Supabase SQL editor on    ***
-- *** 2026-08-03. V1-V3 verification PASSED, and                             ***
-- *** db/audit/preceptor_parity_check.sql returned 28 matches, zero mismatch ***
-- *** rows, and zero duplicate active-primary rows. V4 (per-student spot     ***
-- *** check + same-request replay) remains to run after the FIRST real       ***
-- *** revert-driven clear in production.                                     ***
-- *** Prerequisites Phase 2B (20260722000000) and Phase 2C (20260723000000)  ***
-- *** were already applied live. The read-only preflight is                  ***
-- *** db/audit/phase2d_clear_primary_preflight.sql; the PRECHECK block below ***
-- *** re-asserted the load-bearing facts transactionally during the apply.   ***
--
-- PRODUCT DECISION (Jester, 2026-08-03): reverting a student match ends the
-- primary preceptor relationship. A reverted student must not retain a hidden
-- canonical primary assignment.
--
-- ============================================================================
-- DEPENDENCY INVENTORY (everything this migration modifies or depends on)
-- ============================================================================
-- MODIFIES (2 objects, both additive to behavior):
--   1. public.preceptor_assignment_events
--        constraint preceptor_assignment_events_action_check: dropped and
--        re-added with 'clear_primary' added to the nine existing actions.
--        The PRECHECK asserts the live list is EXACTLY the expected nine
--        before replacing, so a drifted live list aborts the apply.
--   2. public.clear_primary_preceptor(uuid, uuid, text, boolean, boolean, text)
--        NEW function (CREATE OR REPLACE; no live function of this name is
--        expected). EXECUTE: service_role only.
--
-- DEPENDS ON (read/called/fired; NOT modified):
--   3. public.students (preceptor_id uuid FK -> preceptors.id; cohort_id;
--        matched_preceptor; preceptor_email) - the one UPDATE target.
--   4. TRIGGER trg_guard_students_preceptor_id ON public.students
--        BEFORE UPDATE OF preceptor_id -> guard_students_preceptor_id_change()
--        (2C, SECURITY INVOKER). Allows this RPC's update via the per-student
--        marker app.preceptor_change_authorized = <student uuid> AND a
--        privileged current_user (branch A).
--   5. TRIGGER trg_sync_primary_preceptor_mirror ON public.students
--        AFTER INSERT OR UPDATE OF preceptor_id -> sync_primary_preceptor_mirror()
--        (2B, SECURITY DEFINER). Its NULL branch performs ALL mirror cleanup:
--        soft-ends active role='primary' rows in student_preceptor_assignments
--        (status 'ended', end_date backfilled, never deleted), blanks
--        students.matched_preceptor / preceptor_email, and nulls the
--        current-cohort matches.preceptor_id ONLY when the student has exactly
--        one match row in that cohort.
--   6. public._preceptor_assert_actor_for_student(uuid, uuid, text, boolean, boolean)
--        (2C helper). Locks the student row FOR UPDATE, resolves the actor role
--        (returns the literal 'owner_admin' or 'unit_leader' in the 'role' key;
--        the PRECHECK asserts the 'owner_admin' literal), and enforces the
--        completed-rotation 90-day window with owner/admin force+confirm+reason
--        override.
--   7. public._preceptor_begin_request(text, uuid, text, text) and
--      public._preceptor_finish_request(text, jsonb) (2C helpers) over table
--      public.preceptor_assignment_requests (PK request_id, actor_profile_id,
--      rpc, fingerprint, result jsonb). begin_request itself raises MS400 on a
--      blank request id; this RPC ALSO rejects it explicitly at its boundary.
--   8. public.preceptor_assignment_events (2C audit table). Columns written:
--        actor_profile_id, actor_role, action, student_id, preceptor_id,
--        cohort_id, unit_key, assignment_role, old_value, new_value, reason,
--        was_override, correlation_id, request_id, metadata.
--   9. public._emit_staff_notifications(text, text, uuid, text, text, uuid,
--        uuid, text, text, text, text, text, boolean, text) (2C helper) over
--        table public.staff_notifications. Columns written per recipient:
--        correlation_id, recipient_profile_id, recipient_email, event_type,
--        actor_profile_id, actor_name, actor_role, student_id, preceptor_id,
--        unit_key, assignment_role, old_value, new_value, reason, was_override,
--        subject, dest_url, queue_status ('queued'), next_attempt_at.
--        Idempotent ON CONFLICT (correlation_id, recipient_profile_id).
--  10. public.preceptors (full_name lookup for the audit/notification text) and
--      public.matches (count only, for the same-cohort anomaly check).
--
-- WHAT IT DOES NOT DO
--   - It does not modify assign_primary_preceptor (its null rejection stands),
--     set_secondary_coverage_preceptor, create_unit_preceptor, either trigger,
--     any helper, or any RLS policy.
--   - It does not touch secondary or coverage assignments (the 2B clear branch
--     ends role='primary' rows only).
--   - It does not delete preceptor records, assignment history, events, or
--     notifications.
--   - It grants nothing to authenticated or anon: EXECUTE is service_role only,
--     reached exclusively through api/preceptor-assignment-manage.js
--     (server-verified Owner/Admin caller).
--
-- ALREADY-CLEAR CONTRACT: clearing a student whose preceptor_id is already NULL
-- returns ok/no_change and writes NO event or notification. Match revert calls
-- this for every reverted student, so the no-op path must be silent and cheap.
-- ============================================================================

BEGIN;

-- ############################################################################
-- 0. PRECHECK: assert the live objects this migration replaces or relies on
--    are exactly what it expects. Any failure aborts the whole transaction.
-- ############################################################################
DO $precheck$
DECLARE
  v_def     text;
  v_actions text[];
BEGIN
  -- 0a. The events action CHECK exists and lists EXACTLY the nine known
  --     actions (no more, no fewer, not already containing clear_primary).
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conrelid = 'public.preceptor_assignment_events'::regclass
    AND conname  = 'preceptor_assignment_events_action_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'PRECHECK 0a FAILED: constraint preceptor_assignment_events_action_check not found; reconcile the live schema before applying';
  END IF;
  v_actions := ARRAY(SELECT DISTINCT (regexp_matches(v_def, '''([a-z_]+)''', 'g'))[1] ORDER BY 1);
  IF v_actions IS DISTINCT FROM ARRAY[
       'add_coverage','add_secondary','assign_primary','create_preceptor',
       'end_coverage','end_secondary','matches_anomaly','replace_coverage','replace_secondary'] THEN
    RAISE EXCEPTION 'PRECHECK 0a FAILED: live action list is % (from %); expected exactly the nine known actions. Reconcile before applying so no live value is silently dropped.', v_actions, v_def;
  END IF;

  -- 0b. The actor-assertion helper exists exactly once and returns the literal
  --     role value this RPC gates on.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = '_preceptor_assert_actor_for_student') <> 1 THEN
    RAISE EXCEPTION 'PRECHECK 0b FAILED: expected exactly one public._preceptor_assert_actor_for_student';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '_preceptor_assert_actor_for_student';
  IF position('''owner_admin''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'PRECHECK 0b FAILED: _preceptor_assert_actor_for_student does not contain the owner_admin role literal this RPC gates on';
  END IF;

  -- 0c. The request-idempotency helpers exist, and begin_request enforces a
  --     nonblank request id (this RPC also rejects blanks at its boundary).
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN ('_preceptor_begin_request', '_preceptor_finish_request')) <> 2 THEN
    RAISE EXCEPTION 'PRECHECK 0c FAILED: request-idempotency helpers missing';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '_preceptor_begin_request';
  IF position('a request id is required' IN v_def) = 0 THEN
    RAISE EXCEPTION 'PRECHECK 0c FAILED: _preceptor_begin_request no longer enforces a nonblank request id';
  END IF;

  -- 0d. Both triggers this path relies on exist on students and are enabled.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgrelid = 'public.students'::regclass
                   AND tgname = 'trg_guard_students_preceptor_id' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'PRECHECK 0d FAILED: 2C guard trigger trg_guard_students_preceptor_id missing or disabled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgrelid = 'public.students'::regclass
                   AND tgname = 'trg_sync_primary_preceptor_mirror' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'PRECHECK 0d FAILED: 2B sync trigger trg_sync_primary_preceptor_mirror missing or disabled';
  END IF;

  -- 0e. The notification fan-out helper exists.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = '_emit_staff_notifications') THEN
    RAISE EXCEPTION 'PRECHECK 0e FAILED: _emit_staff_notifications missing';
  END IF;
END;
$precheck$;

-- ############################################################################
-- 1. Allow the new audit action value (live list asserted by PRECHECK 0a).
-- ############################################################################
ALTER TABLE public.preceptor_assignment_events
  DROP CONSTRAINT IF EXISTS preceptor_assignment_events_action_check;
ALTER TABLE public.preceptor_assignment_events
  ADD CONSTRAINT preceptor_assignment_events_action_check CHECK (action IN (
    'assign_primary', 'clear_primary', 'add_secondary', 'add_coverage',
    'replace_secondary', 'replace_coverage', 'end_secondary', 'end_coverage',
    'create_preceptor', 'matches_anomaly'));

-- ############################################################################
-- 2. clear_primary_preceptor -- end the Primary relationship. Sets
--    students.preceptor_id to NULL and lets the Phase 2B trigger perform the
--    mirror cleanup. Idempotent on p_request_id AND on already-clear students.
-- ############################################################################
CREATE OR REPLACE FUNCTION public.clear_primary_preceptor(
  p_actor_profile_id uuid,
  p_student_id       uuid,
  p_reason           text    DEFAULT NULL,
  p_force            boolean DEFAULT false,
  p_confirm_override boolean DEFAULT false,
  p_request_id       text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_fp        text;
  v_claim     jsonb;
  v_authz     jsonb;
  v_role      text;
  v_override  boolean;
  v_cohort    uuid;
  v_unit_key  text;
  v_old       uuid;
  v_old_name  text;
  v_match_ct  int;
  v_corr      text;
  v_result    jsonb;
BEGIN
  IF p_actor_profile_id IS NULL OR p_student_id IS NULL THEN
    RAISE EXCEPTION 'missing required argument' USING ERRCODE = 'MS400';
  END IF;
  -- Explicit boundary contract: a nonblank request id is REQUIRED (the
  -- begin_request helper enforces this too; rejecting here makes the contract
  -- visible at the RPC surface and independent of helper internals).
  IF p_request_id IS NULL OR length(btrim(p_request_id)) = 0 THEN
    RAISE EXCEPTION 'a request id is required' USING ERRCODE = 'MS400';
  END IF;

  -- Idempotency: claim (or replay) BEFORE any mutation. A failed run rolls the claim back with it.
  v_fp := jsonb_build_object(
    'rpc', 'clear_primary_preceptor',
    'actor_profile_id', p_actor_profile_id,
    'action', 'clear',
    'student_id', p_student_id,
    'assignment_id', NULL,
    'preceptor_id', NULL,
    'role', 'primary',
    'reason', p_reason,
    'notes', NULL,
    'force', COALESCE(p_force, false),
    'confirm_override', COALESCE(p_confirm_override, false)
  )::text;
  v_claim := public._preceptor_begin_request(p_request_id, p_actor_profile_id, 'clear_primary_preceptor', v_fp);
  IF NOT (v_claim->>'claimed')::boolean THEN
    RETURN v_claim->'result';
  END IF;

  -- Same actor assertion as assign (row lock, 90-day window, override rules),
  -- then STRICTER role gate: clearing a Primary is an Owner/Admin action only.
  v_authz := public._preceptor_assert_actor_for_student(p_actor_profile_id, p_student_id, p_reason, p_force, p_confirm_override);
  v_role     := v_authz->>'role';
  v_override := (v_authz->>'was_override')::boolean;
  v_unit_key := v_authz->>'unit_key';
  v_cohort   := (v_authz->>'cohort_id')::uuid;
  IF v_role <> 'owner_admin' THEN
    RAISE EXCEPTION 'clearing a primary preceptor requires owner or admin authority' USING ERRCODE = 'MS403';
  END IF;

  SELECT s.preceptor_id INTO v_old FROM public.students s WHERE s.id = p_student_id;

  -- Already clear: succeed silently (no event, no notification, no update).
  IF v_old IS NULL THEN
    v_result := jsonb_build_object('ok', true, 'no_change', true, 'student_id', p_student_id,
                                   'old_preceptor_id', NULL, 'actor_role', v_role);
    PERFORM public._preceptor_finish_request(p_request_id, v_result);
    RETURN v_result;
  END IF;

  SELECT full_name INTO v_old_name FROM public.preceptors WHERE id = v_old;

  -- Per-student marker authorizes THIS one row change to the 2C guard; the 2B
  -- trigger's clear branch then soft-ends the active-primary row, clears the
  -- display mirrors, and nulls the single same-cohort match FK.
  PERFORM set_config('app.preceptor_change_authorized', p_student_id::text, true);
  UPDATE public.students SET preceptor_id = NULL WHERE id = p_student_id;
  PERFORM set_config('app.preceptor_change_authorized', '', true);

  v_corr := 'preceptor_clear:' || p_request_id;

  INSERT INTO public.preceptor_assignment_events
    (actor_profile_id, actor_role, action, student_id, preceptor_id, cohort_id, unit_key,
     assignment_role, old_value, new_value, reason, was_override, correlation_id, request_id, metadata)
  VALUES
    (p_actor_profile_id, v_role, 'clear_primary', p_student_id, v_old, v_cohort, v_unit_key,
     'primary', v_old_name, NULL, p_reason, v_override, v_corr, p_request_id,
     jsonb_build_object('old_preceptor_id', v_old, 'old_preceptor_name', v_old_name,
                        'new_preceptor_id', NULL, 'new_preceptor_name', NULL));

  PERFORM public._emit_staff_notifications(
    v_corr, 'preceptor_primary_cleared', p_actor_profile_id, v_role,
    (CASE WHEN v_override THEN 'Primary preceptor cleared (historical override)' ELSE 'Primary preceptor cleared' END),
    p_student_id, v_old, v_unit_key, 'primary', v_old_name, NULL, p_reason, v_override,
    '/students?student=' || p_student_id::text);

  -- matches anomaly: >1 same-cohort match rows => the 2B trigger left the match FK
  -- unsynced (possibly still pointing at the cleared preceptor). Record and notify
  -- without failing the clear, exactly as assign does.
  SELECT count(*) INTO v_match_ct FROM public.matches m
  WHERE m.student_id = p_student_id AND m.cohort_id = v_cohort;
  IF v_match_ct > 1 THEN
    INSERT INTO public.preceptor_assignment_events
      (actor_profile_id, actor_role, action, student_id, preceptor_id, cohort_id, unit_key,
       assignment_role, old_value, new_value, reason, correlation_id, request_id, metadata)
    VALUES
      (p_actor_profile_id, v_role, 'matches_anomaly', p_student_id, v_old, v_cohort, v_unit_key,
       'primary', v_old_name, NULL, p_reason, v_corr || ':anomaly', p_request_id,
       jsonb_build_object('same_cohort_match_rows', v_match_ct));
    PERFORM public._emit_staff_notifications(
      v_corr || ':anomaly', 'preceptor_match_anomaly', p_actor_profile_id, v_role,
      'Match record needs review (multiple same-cohort matches)',
      p_student_id, v_old, v_unit_key, 'primary', v_old_name, NULL, NULL, false,
      '/students?student=' || p_student_id::text);
  END IF;

  v_result := jsonb_build_object('ok', true, 'cleared', true, 'student_id', p_student_id,
                                 'old_preceptor_id', v_old, 'old_preceptor_name', v_old_name,
                                 'actor_role', v_role, 'was_override', v_override);
  PERFORM public._preceptor_finish_request(p_request_id, v_result);
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.clear_primary_preceptor(uuid, uuid, text, boolean, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_primary_preceptor(uuid, uuid, text, boolean, boolean, text) TO service_role;

COMMENT ON FUNCTION public.clear_primary_preceptor(uuid, uuid, text, boolean, boolean, text) IS
  'Phase 2D: the one supported path for ending a primary-preceptor relationship. Owner/Admin only, '
  'nonblank request id required, request-id idempotent, guard-marker compatible; sets '
  'students.preceptor_id to NULL so the Phase 2B trigger soft-ends the active-primary row, clears '
  'display mirrors, and nulls the single same-cohort match FK. Already-clear students return '
  'ok/no_change with no event or notification.';

COMMIT;

-- ############################################################################
-- VERIFICATION (run after COMMIT)
-- ############################################################################

-- V1. The function exists, is SECURITY DEFINER with a fixed search_path, and is
--     executable by service_role ONLY (expect one row; can_authenticated =
--     false, can_anon = false, can_service = true).
SELECT p.proname,
       p.prosecdef                                        AS security_definer,
       p.proconfig                                        AS config,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS can_authenticated,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS can_anon,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS can_service
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'clear_primary_preceptor';

-- V2. The events action CHECK now includes clear_primary alongside the nine
--     prior actions (expect the definition to list all ten).
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.preceptor_assignment_events'::regclass
  AND conname = 'preceptor_assignment_events_action_check';

-- V3. Nothing else changed: assign/set/create RPCs keep their grants
--     (expect 3 rows; can_authenticated false, can_service true).
SELECT p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS can_authenticated,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS can_service
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('assign_primary_preceptor', 'set_secondary_coverage_preceptor', 'create_unit_preceptor')
ORDER BY p.proname;

-- ############################################################################
-- V4. FIRST REAL CLEAR verification. After the first revert-driven clear in
--     production, set the two psql variables (or inline the literals) and run
--     V4a-V4g. :student_id = the reverted student; :request_id = the
--     request_id from the app call (visible in preceptor_assignment_events).
-- ############################################################################

-- V4a. Canonical field and display mirrors (expect: preceptor_id NULL,
--      matched_preceptor '', preceptor_email '').
-- SELECT s.preceptor_id, s.matched_preceptor, s.preceptor_email, s.cohort_id
--   FROM students s WHERE s.id = :'student_id';

-- V4b. Assignment history: zero ACTIVE primary rows; prior primary rows
--      soft-ended with an end_date; nothing deleted (history remains).
-- SELECT role, status, start_date, end_date, updated_at
--   FROM student_preceptor_assignments
--  WHERE student_id = :'student_id'
--  ORDER BY updated_at DESC;

-- V4c. Same-cohort match FK: with exactly one match row, preceptor_id must be
--      NULL. With more than one row, FKs are intentionally untouched and a
--      matches_anomaly event must exist instead (see V4d second query).
-- SELECT m.id, m.preceptor_id
--   FROM matches m JOIN students s ON s.id = m.student_id
--  WHERE m.student_id = :'student_id' AND m.cohort_id = s.cohort_id;

-- V4d. Audit events: EXACTLY ONE clear_primary event with the request's
--      correlation; the anomaly event exists only in the multi-match case.
-- SELECT count(*) AS clear_events
--   FROM preceptor_assignment_events
--  WHERE action = 'clear_primary'
--    AND correlation_id = 'preceptor_clear:' || :'request_id';   -- expect 1
-- SELECT count(*) AS anomaly_events
--   FROM preceptor_assignment_events
--  WHERE action = 'matches_anomaly'
--    AND correlation_id = 'preceptor_clear:' || :'request_id' || ':anomaly';

-- V4e. Notification correlation: one row per active owner/admin recipient
--      (excluding the actor), all created under the same correlation, each
--      queued or already sent by the worker.
-- SELECT recipient_profile_id, event_type, queue_status
--   FROM staff_notifications
--  WHERE correlation_id = 'preceptor_clear:' || :'request_id';
-- SELECT count(*) AS expected_recipients
--   FROM user_profiles up
--  WHERE (up.role IN ('owner','admin') OR up.is_owner IS TRUE)
--    AND COALESCE(up.is_active, true) = true
--    AND up.email IS NOT NULL AND btrim(up.email) <> ''
--    AND up.id <> (SELECT actor_profile_id FROM preceptor_assignment_events
--                   WHERE correlation_id = 'preceptor_clear:' || :'request_id' LIMIT 1);

-- V4f. Idempotency ledger: the request row holds the stored ok result.
-- SELECT request_id, rpc, result->>'ok' AS ok, result->>'cleared' AS cleared
--   FROM preceptor_assignment_requests
--  WHERE request_id = :'request_id';   -- expect rpc clear_primary_preceptor, ok true

-- V4g. Same-request replay idempotency (CONTROLLED; invokes the RPC but
--      mutates nothing by design: the begin-request replay branch returns the
--      stored result before any mutation). Capture the V4d/V4e counts, run the
--      replay with the SAME actor, student, and request id the app used, then
--      re-run V4d/V4e: every count must be unchanged and the returned jsonb
--      must equal the stored V4f result.
-- SELECT public.clear_primary_preceptor(
--   p_actor_profile_id => :'actor_profile_id',
--   p_student_id       => :'student_id',
--   p_reason           => 'match revert',
--   p_request_id       => :'request_id');

-- V5. Then run db/audit/preceptor_parity_check.sql (Owner SQL gate step 5):
--     expect match-only summary, zero detail rows, zero duplicates.
