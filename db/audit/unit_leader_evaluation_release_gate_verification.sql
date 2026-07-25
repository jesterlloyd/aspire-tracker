-- db/audit/unit_leader_evaluation_release_gate_verification.sql
-- ============================================================================
-- Post-application verification for
--   supabase/migrations/20260725000000_unit_leader_evaluation_release_gate.sql
--   (second Owner-review-corrected revision)
--
-- RUN ONLY AFTER Jester has manually applied the migration through the Owner SQL gate.
-- This branch NEVER runs it. Every statement is read-only or self-rolling-back.
-- Run each numbered block and compare to the "-> expect" comment.
-- ============================================================================

-- 0) SURFACE the exact live definition of the Owner/Admin authority helper, for review.
--    -> expect a body selecting from user_profiles WHERE auth_user_id = auth.uid()
--       AND role IN ('owner','admin') AND COALESCE(is_active,true)=true.
--    NOTE (governance): this is role + active-profile from the JWT. It does NOT consult
--    user_role_grants, because owner/admin are not represented there. Staff "revocation"
--    is is_active=false; grant expiration does not apply to staff. The Unit Leader READ
--    side DOES use has_active_role_grant('unit_leader') (revocation + expiration).
SELECT pg_get_functiondef('public.is_active_owner_or_admin()'::regprocedure);
SELECT
  prosrc ~ 'user_profiles'                       AS reads_user_profiles,
  prosrc ~ 'auth\.uid\(\)'                        AS uses_jwt,
  prosrc ~ 'is_active'                            AS checks_active
FROM pg_proc WHERE oid = 'public.is_active_owner_or_admin()'::regprocedure;

-- 1) All three tables exist with RLS enabled.
--    -> expect three rows, relrowsecurity = t
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('evaluation_response_unit_release',
                  'evaluation_response_unit_release_events',
                  'evaluation_unit_quantitative_keys')
ORDER BY relname;

-- 2) (Blocker 1) TABLE PRIVILEGE RESTRICTIONS.
--    2a) Events table: service_role may SELECT/INSERT but NOT UPDATE/DELETE/TRUNCATE.
--        -> expect t, t, f, f, f
SELECT
  has_table_privilege('service_role', 'public.evaluation_response_unit_release_events', 'SELECT')   AS ev_select,
  has_table_privilege('service_role', 'public.evaluation_response_unit_release_events', 'INSERT')   AS ev_insert,
  has_table_privilege('service_role', 'public.evaluation_response_unit_release_events', 'UPDATE')   AS ev_update,
  has_table_privilege('service_role', 'public.evaluation_response_unit_release_events', 'DELETE')   AS ev_delete,
  has_table_privilege('service_role', 'public.evaluation_response_unit_release_events', 'TRUNCATE') AS ev_truncate;
--    2b) Release table: service_role may SELECT/INSERT/UPDATE but NOT DELETE/TRUNCATE.
--        -> expect t, t, t, f, f
SELECT
  has_table_privilege('service_role', 'public.evaluation_response_unit_release', 'SELECT')   AS rel_select,
  has_table_privilege('service_role', 'public.evaluation_response_unit_release', 'INSERT')   AS rel_insert,
  has_table_privilege('service_role', 'public.evaluation_response_unit_release', 'UPDATE')   AS rel_update,
  has_table_privilege('service_role', 'public.evaluation_response_unit_release', 'DELETE')   AS rel_delete,
  has_table_privilege('service_role', 'public.evaluation_response_unit_release', 'TRUNCATE') AS rel_truncate;
--    2c) TRUNCATE-blocking triggers present (row triggers cannot block TRUNCATE).
--        -> expect trg_ul_eval_release_no_truncate and trg_ul_eval_events_no_truncate
SELECT tgname, tgrelid::regclass AS on_table
FROM pg_trigger
WHERE tgname LIKE 'trg_ul_eval_%no_truncate'
ORDER BY tgname;
--    2d) The response FK is ON DELETE RESTRICT (confdeltype 'r'), NEVER 'c' (CASCADE).
SELECT conname, confdeltype
FROM pg_constraint
WHERE conrelid = 'public.evaluation_response_unit_release'::regclass
  AND contype = 'f'
  AND confrelid = 'public.evaluation_responses'::regclass;
--        -> expect confdeltype = 'r' (RESTRICT), NEVER 'c'

-- 3) (Blocker 5) NO STABLE RESPONSE IDENTIFIER exposed.
--    3a) The release table has no public_token column. -> expect 0
SELECT count(*) AS public_token_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'evaluation_response_unit_release'
  AND column_name = 'public_token';
--    3b) No by-token/by-id detail RPC exists. -> expect 0
SELECT count(*) AS detail_functions
FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = 'ul_eval_response_detail';
--    3c) Read functions expose neither response_id nor a token. -> expect 0
SELECT count(*) AS read_fns_with_identifier
FROM pg_proc
WHERE pronamespace='public'::regnamespace
  AND proname IN ('ul_eval_dashboard_summary', 'ul_eval_response_list')
  AND (prosrc ~ '''response_id''' OR prosrc ~ 'public_token' OR prosrc ~ '''response_token''');

-- 4) (Blocker 6) SECURITY DEFINER expectations.
--    4a) The public API + trigger functions ARE SECURITY DEFINER with a fixed search_path.
--        -> expect prosecdef = t for all listed
SELECT proname, prosecdef, proconfig
FROM pg_proc
WHERE pronamespace='public'::regnamespace
  AND proname IN ('ul_eval_moderate_response','ul_eval_release_response','ul_eval_revoke_response',
                  'ul_eval_rerelease_response','ul_eval_dashboard_summary','ul_eval_response_list',
                  '_ul_eval_capture_snapshot','_ul_eval_guard_snapshot_immutable','_ul_eval_block_write')
ORDER BY proname;
--    4b) The PURE allowlist helper is intentionally NOT SECURITY DEFINER (invoker; runs as
--        the definer that calls it). -> expect prosecdef = f
SELECT proname, prosecdef
FROM pg_proc WHERE oid = 'public._ul_eval_safe_quantitative(text,jsonb)'::regprocedure;

-- 5) Grants: least privilege on functions.
--    5a) Lifecycle functions: anon must NOT execute. -> expect all f
SELECT
  has_function_privilege('anon', 'public.ul_eval_moderate_response(uuid,text)', 'EXECUTE') AS moderate_anon,
  has_function_privilege('anon', 'public.ul_eval_release_response(uuid)',        'EXECUTE') AS release_anon,
  has_function_privilege('anon', 'public.ul_eval_rerelease_response(uuid)',      'EXECUTE') AS rerelease_anon;
--    5b) Read functions: authenticated yes, anon no. -> expect t, f
SELECT
  has_function_privilege('authenticated', 'public.ul_eval_response_list(text,text,text)', 'EXECUTE') AS list_authed,
  has_function_privilege('anon',          'public.ul_eval_response_list(text,text,text)', 'EXECUTE') AS list_anon;
--    5c) The pure helper is not client-executable. -> expect f, f
SELECT
  has_function_privilege('authenticated', 'public._ul_eval_safe_quantitative(text,jsonb)', 'EXECUTE') AS helper_authed,
  has_function_privilege('anon',          'public._ul_eval_safe_quantitative(text,jsonb)', 'EXECUTE') AS helper_anon;

-- 6) (Blocker 3) ROW LOCKING + expected-state predicates in every lifecycle function.
--    -> expect for_update = 4, and expected-state guards present
SELECT
  count(*) FILTER (WHERE prosrc ~ 'FOR UPDATE')                        AS for_update,
  count(*) FILTER (WHERE prosrc ~ 'is_active_owner_or_admin\(\)')      AS authz
FROM pg_proc
WHERE pronamespace='public'::regnamespace
  AND proname IN ('ul_eval_moderate_response','ul_eval_release_response',
                  'ul_eval_revoke_response','ul_eval_rerelease_response');
SELECT
  (SELECT prosrc ~ 'not_releasable_state' FROM pg_proc WHERE oid='public.ul_eval_release_response(uuid)'::regprocedure)   AS release_expected_state,
  (SELECT prosrc ~ 'already_revoked'      FROM pg_proc WHERE oid='public.ul_eval_revoke_response(uuid)'::regprocedure)    AS revoke_idempotent,
  (SELECT prosrc ~ 'not_revoked'          FROM pg_proc WHERE oid='public.ul_eval_rerelease_response(uuid)'::regprocedure) AS rerelease_expected_state;

-- 7) (Blocker 2) MISSING-PRECEPTOR INELIGIBILITY: release/re-release require a resolved
--    evaluated preceptor. -> expect both t
SELECT
  (SELECT prosrc ~ 'hist_preceptor_id IS NULL' FROM pg_proc WHERE oid='public.ul_eval_release_response(uuid)'::regprocedure)   AS release_checks_preceptor,
  (SELECT prosrc ~ 'hist_preceptor_id IS NULL' FROM pg_proc WHERE oid='public.ul_eval_rerelease_response(uuid)'::regprocedure) AS rerelease_checks_preceptor;
--    Reads also require a resolved preceptor. -> expect 2
SELECT count(*) AS reads_require_preceptor
FROM pg_proc
WHERE pronamespace='public'::regnamespace
  AND proname IN ('ul_eval_dashboard_summary','ul_eval_response_list')
  AND prosrc ~ 'hist_preceptor_id IS NOT NULL';

-- 8) (Blocker 4) EXACT ITEM ALLOWLIST.
--    8a) The allowlist table exists and is seeded with the fixed numeric paths. -> expect >= 5
SELECT count(*) AS seeded_allowlist_paths FROM public.evaluation_unit_quantitative_keys;
--    8b) The section CHECK forbids free-text/identifying sections. -> expect the constraint
SELECT conname FROM pg_constraint
WHERE conrelid='public.evaluation_unit_quantitative_keys'::regclass AND conname='chk_uqk_safe_section';
--    8c) The extractor JOINS the allowlist (no generic 'all numeric' scan). -> expect t
SELECT prosrc ~ 'evaluation_unit_quantitative_keys' AS helper_uses_allowlist
FROM pg_proc WHERE oid='public._ul_eval_safe_quantitative(text,jsonb)'::regprocedure;
--    8d) No allowlist row targets a free-text / identifying section. -> expect 0
SELECT count(*) AS unsafe_allowlist_rows
FROM public.evaluation_unit_quantitative_keys
WHERE NOT (
  (instrument_slug='student_preceptor_eval'
     AND json_path[1] IN ('preceptor_support','learning_environment','psychological_safety','overall_experience'))
  OR
  (instrument_slug='preceptor_progress'
     AND json_path[1] IN ('developmental_feedback','readiness_endorsement'))
);

-- 9) Triggers present: capture, immutability, append-only, block-writes.
--    -> expect capture (AFTER INSERT), guard (BEFORE UPDATE), events no-update/delete,
--       and the two no_truncate triggers
SELECT tgname, tgrelid::regclass AS on_table
FROM pg_trigger
WHERE tgname LIKE 'trg_ul_eval_%'
ORDER BY tgname;

-- 10) Backfill outcome. -> at apply time expect ONLY ('backfill_unverified','ineligible').
SELECT snapshot_source, release_state, count(*)
FROM public.evaluation_response_unit_release
GROUP BY 1, 2 ORDER BY 1, 2;

-- 11) Approved-instruments-only invariant. -> expect 0
SELECT count(*) AS non_approved_rows
FROM public.evaluation_response_unit_release
WHERE instrument_slug NOT IN ('student_preceptor_eval', 'preceptor_progress');

-- 12) Snapshot immutability (self-rolling-back). A forbidden snapshot update MUST raise;
--     if it succeeds, a HARD, un-swallowed assert_failure aborts (rolling back the write).
--     -> expect NOTICE 'immutability_enforced' or 'no_rows_to_test'; never 'IMMUTABILITY GUARD FAILED'
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT response_id INTO v_id FROM public.evaluation_response_unit_release LIMIT 1;
  IF v_id IS NULL THEN RAISE NOTICE 'no_rows_to_test'; RETURN; END IF;
  BEGIN
    UPDATE public.evaluation_response_unit_release
      SET hist_unit_key = hist_unit_key || '_x' WHERE response_id = v_id;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'immutability_enforced'; RETURN;
  END;
  RAISE EXCEPTION 'IMMUTABILITY GUARD FAILED: forbidden snapshot update succeeded for %', v_id
    USING ERRCODE = 'assert_failure';
END $$;

-- 13) Append-only audit: UPDATE, DELETE, and TRUNCATE must all raise.
--     -> expect NOTICE 'append_only_enforced' or 'no_events_yet'; never 'APPEND-ONLY FAILED'
DO $$
DECLARE v_eid uuid; v_blocked int := 0;
BEGIN
  SELECT id INTO v_eid FROM public.evaluation_response_unit_release_events LIMIT 1;
  IF v_eid IS NULL THEN RAISE NOTICE 'no_events_yet'; RETURN; END IF;
  BEGIN UPDATE public.evaluation_response_unit_release_events SET notes='x' WHERE id=v_eid;
  EXCEPTION WHEN check_violation THEN v_blocked := v_blocked + 1; END;
  BEGIN DELETE FROM public.evaluation_response_unit_release_events WHERE id=v_eid;
  EXCEPTION WHEN check_violation THEN v_blocked := v_blocked + 1; END;
  BEGIN TRUNCATE public.evaluation_response_unit_release_events;
  EXCEPTION WHEN check_violation THEN v_blocked := v_blocked + 1; END;
  IF v_blocked = 3 THEN RAISE NOTICE 'append_only_enforced';
  ELSE RAISE EXCEPTION 'APPEND-ONLY FAILED: events table accepted UPDATE/DELETE/TRUNCATE'
    USING ERRCODE = 'assert_failure';
  END IF;
END $$;

-- 14) Release table DELETE and TRUNCATE are blocked (self-rolling-back).
--     -> expect NOTICE 'release_delete_truncate_blocked' or 'no_rows_to_test'
DO $$
DECLARE v_id uuid; v_blocked int := 0;
BEGIN
  SELECT response_id INTO v_id FROM public.evaluation_response_unit_release LIMIT 1;
  IF v_id IS NULL THEN RAISE NOTICE 'no_rows_to_test'; RETURN; END IF;
  BEGIN DELETE FROM public.evaluation_response_unit_release WHERE response_id=v_id;
  EXCEPTION WHEN check_violation THEN v_blocked := v_blocked + 1; END;
  BEGIN TRUNCATE public.evaluation_response_unit_release;
  EXCEPTION WHEN check_violation THEN v_blocked := v_blocked + 1; END;
  IF v_blocked = 2 THEN RAISE NOTICE 'release_delete_truncate_blocked';
  ELSE RAISE EXCEPTION 'RELEASE DELETE/TRUNCATE NOT BLOCKED' USING ERRCODE = 'assert_failure';
  END IF;
END $$;

-- 15) Base tables untouched: evaluation_responses still owner/admin SELECT.
SELECT polname FROM pg_policy
WHERE polrelid='public.evaluation_responses'::regclass ORDER BY polname;

-- ============================================================================
-- MANUAL BEHAVIORAL CHECKS (real data + a live Unit Leader session / an authenticated
-- Owner/Admin session). Cannot be verified from static SQL alone.
-- ----------------------------------------------------------------------------
-- A) Active role-grant enforcement (revocation/expiration of the unit_leader grant zeroes
--    reads). B) Blocked-response invisibility. C) Audit preservation (4 events, then
--    UPDATE/DELETE/TRUNCATE all fail). D) No stable identifier in ul_eval_response_list.
-- E) Exact allowlist: quantitative keys equal ONLY the curated paths; a numeric answer at
--    a NON-allowlisted path does NOT appear until curated into
--    evaluation_unit_quantitative_keys. F) Re-release policy (explicit; revoked_at kept).
-- G) Missing evaluated preceptor: submit a student_preceptor_eval whose evaluated_target
--    .preceptor_id is absent/invalid -> the release row has hist_preceptor_id NULL and
--    ul_eval_release_response returns {"status":"snapshot_incomplete"}.
-- H) Concurrency: two simultaneous ul_eval_release_response calls on one response -> the
--    second returns 'already_released' (FOR UPDATE serialization); exactly one 'release'
--    audit event exists.
-- I) 7-day delay; Owner/Admin-only; All Assigned Units; no count suppression; historical
--    unit stability (unchanged from prior review).
-- ============================================================================
