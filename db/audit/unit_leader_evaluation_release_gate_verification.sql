-- db/audit/unit_leader_evaluation_release_gate_verification.sql
-- ============================================================================
-- Post-application verification for
--   supabase/migrations/20260725000000_unit_leader_evaluation_release_gate.sql
--
-- RUN THIS ONLY AFTER Jester has manually applied the migration through the Owner
-- SQL gate. This branch NEVER runs it. Every statement here is read-only or wrapped
-- in a rolled-back transaction; nothing persists. Run each numbered block and compare
-- to the "-> expect" comment.
-- ============================================================================

-- 1) Table exists with RLS enabled.
--    -> expect one row, relrowsecurity = t
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'evaluation_response_unit_release';

-- 2) All required columns exist.
--    -> expect 26 (all listed) present
SELECT count(*) AS present_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'evaluation_response_unit_release'
  AND column_name IN (
    'id','response_id','assignment_id','instrument_id','instrument_slug','timepoint',
    'hist_unit_id','hist_unit_key','hist_preceptor_id','hist_preceptor_label',
    'hist_cohort_id','hist_cohort_label','hist_rotation_id','hist_rotation_end',
    'unit_leader_eligible_at','snapshot_source','snapshot_captured_at',
    'release_state','moderation_state','quantitative_visible','free_text_visible',
    'released_at','released_by','revoked_at','revoked_by','updated_at'
  );

-- 3) Safety constraints present (approved-slug, free-text-hidden, released-visibility).
--    -> expect all three constraint names
SELECT conname
FROM pg_constraint
WHERE conrelid = 'public.evaluation_response_unit_release'::regclass
  AND conname IN (
    'chk_ul_eval_release_instrument_approved',
    'chk_ul_eval_free_text_hidden_first_release',
    'chk_ul_eval_released_visibility'
  )
ORDER BY conname;

-- 4) Every ul_eval_* / helper function is SECURITY DEFINER with a fixed search_path.
--    -> expect prosecdef = t and proconfig containing 'search_path=public, pg_catalog'
--       for all 9 functions
SELECT proname, prosecdef, proconfig
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND (proname LIKE 'ul_eval_%' OR proname LIKE '\_ul\_eval\_%')
ORDER BY proname;

-- 5) Grants: least privilege.
--    5a) Lifecycle (write) functions: authenticated must NOT execute. -> expect all f
SELECT
  has_function_privilege('authenticated', 'public.ul_eval_moderate_response(uuid,uuid,text)', 'EXECUTE') AS moderate_authed,
  has_function_privilege('authenticated', 'public.ul_eval_release_response(uuid,uuid)',       'EXECUTE') AS release_authed,
  has_function_privilege('authenticated', 'public.ul_eval_revoke_response(uuid,uuid)',        'EXECUTE') AS revoke_authed;
--    5b) Lifecycle functions: service_role MUST execute. -> expect all t
SELECT
  has_function_privilege('service_role', 'public.ul_eval_release_response(uuid,uuid)', 'EXECUTE') AS release_service,
  has_function_privilege('service_role', 'public.ul_eval_revoke_response(uuid,uuid)',  'EXECUTE') AS revoke_service;
--    5c) Read functions: authenticated executes, anon does not. -> expect t, f
SELECT
  has_function_privilege('authenticated', 'public.ul_eval_response_list(text,text,text)', 'EXECUTE') AS list_authed,
  has_function_privilege('anon',          'public.ul_eval_response_list(text,text,text)', 'EXECUTE') AS list_anon;

-- 6) Triggers present.
--    -> expect trg_ul_eval_guard_snapshot_immutable (BEFORE UPDATE on the release table)
--       and trg_ul_eval_capture_snapshot (AFTER INSERT on evaluation_responses)
SELECT tgname, tgrelid::regclass AS on_table, tgtype
FROM pg_trigger
WHERE tgname IN ('trg_ul_eval_guard_snapshot_immutable', 'trg_ul_eval_capture_snapshot')
ORDER BY tgname;

-- 7) Backfill outcome. -> at apply time expect ONLY ('backfill_unverified','ineligible').
SELECT snapshot_source, release_state, count(*)
FROM public.evaluation_response_unit_release
GROUP BY 1, 2
ORDER BY 1, 2;

-- 8) Approved-instruments-only invariant: no release row for a non-approved instrument.
--    -> expect 0
SELECT count(*) AS non_approved_rows
FROM public.evaluation_response_unit_release
WHERE instrument_slug NOT IN ('student_preceptor_eval', 'preceptor_progress');

-- 9) Snapshot immutability (negative test, self-rolling-back). Attempts to mutate a
--    snapshot column on any existing row; the guard trigger must raise. If there are no
--    rows yet, it reports 'no_rows_to_test'.
--    -> expect NOTICE 'immutability_enforced' (or 'no_rows_to_test'); never 'MUTATED'
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT response_id INTO v_id FROM public.evaluation_response_unit_release LIMIT 1;
  IF v_id IS NULL THEN
    RAISE NOTICE 'no_rows_to_test';
    RETURN;
  END IF;
  BEGIN
    UPDATE public.evaluation_response_unit_release
      SET hist_unit_key = hist_unit_key || '_x'
      WHERE response_id = v_id;
    RAISE EXCEPTION 'MUTATED: immutability guard did NOT fire';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'immutability_enforced';
  END;
  -- Roll back any incidental change from this test.
  RAISE EXCEPTION 'rollback_verification_block' USING ERRCODE = 'raise_exception';
EXCEPTION
  WHEN raise_exception THEN NULL;  -- swallow the deliberate rollback signal
END $$;

-- 10) Base tables untouched: evaluation_responses still owner/admin SELECT, service writes.
--     -> expect the original policy present, no new authenticated write grant
SELECT polname
FROM pg_policy
WHERE polrelid = 'public.evaluation_responses'::regclass
ORDER BY polname;

-- ============================================================================
-- MANUAL BEHAVIORAL CHECKS (run against real released data; each needs a live
-- Unit Leader session or an Owner/Admin actor id). These cannot be verified from
-- static SQL alone.
-- ----------------------------------------------------------------------------
-- A) 7-day delay: pick a response whose rotation ended < 7 days ago, moderate it
--    cleared, then attempt release as an Owner/Admin:
--      SELECT public.ul_eval_release_response('<owner_profile_id>'::uuid, '<response_id>'::uuid);
--    -> expect {"status":"not_yet_eligible", ...}. After eligibility passes, expect success.
-- B) Owner/Admin-only: call ul_eval_release_response with a Unit Leader profile id.
--    -> expect {"status":"not_authorized"}. (And a Unit Leader session cannot EXECUTE the
--       function at all, per check 5a.)
-- C) Released required / revoked excluded: as a Unit Leader session, call
--      SELECT * FROM public.ul_eval_response_list('student_preceptor_eval', NULL, NULL);
--    -> expect only released, un-revoked, eligible rows in the caller's units. Revoke one
--       (Owner/Admin) and re-run -> it disappears immediately.
-- D) Scope cannot widen: as a single-unit Unit Leader, call the list with
--    p_unit_key set to a unit you are NOT granted. -> expect zero rows (never widened).
-- E) All Assigned Units: as a multi-unit Unit Leader with p_unit_key = NULL, expect rows
--    only from your explicitly granted active units (revoked/expired scopes excluded).
-- F) No identity / no free text: inspect the 'quantitative' jsonb in the list/detail
--    output -> only numeric keys; no names, emails, timestamps, or comment strings.
-- G) No count suppression: a unit with exactly one eligible released response returns
--    released_response_count = 1 and a one-key average. -> expect the single result shown,
--    never hidden.
-- H) Historical stability: note a released response's unit_key, then (in a rolled-back
--    transaction) change the student's matched_unit_id and re-run the list.
--    -> expect the response still attributed to the ORIGINAL hist_unit_key.
-- I) Staff Evaluation Dashboard and Student evaluation submission: unchanged. Submit a
--    test student_preceptor_eval response -> a release row appears with
--    snapshot_source='submission_trigger', release_state='pending'; the staff dashboard
--    reads evaluation_responses exactly as before.
-- ============================================================================
