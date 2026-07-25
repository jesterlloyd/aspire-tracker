-- db/audit/unit_leader_evaluation_release_gate_verification.sql
-- ============================================================================
-- Post-application verification for
--   supabase/migrations/20260725000000_unit_leader_evaluation_release_gate.sql
--   (Owner-review-corrected revision)
--
-- RUN THIS ONLY AFTER Jester has manually applied the migration through the Owner
-- SQL gate. This branch NEVER runs it. Every statement is read-only or wrapped in a
-- rolled-back transaction; nothing persists. Run each numbered block and compare to the
-- "-> expect" comment.
-- ============================================================================

-- 1) Both tables exist with RLS enabled.
--    -> expect two rows, relrowsecurity = t for each
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('evaluation_response_unit_release',
                  'evaluation_response_unit_release_events')
ORDER BY relname;

-- 2) The opaque token column exists and is UNIQUE; response_id is UNIQUE + RESTRICT.
--    -> expect public_token present; a unique index on public_token; FK is 'r' (RESTRICT)
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'evaluation_response_unit_release'
  AND column_name IN ('public_token', 'response_id');
SELECT conname, confdeltype                    -- confdeltype 'r' = RESTRICT, 'c' = CASCADE
FROM pg_constraint
WHERE conrelid = 'public.evaluation_response_unit_release'::regclass
  AND contype = 'f'
  AND confrelid = 'public.evaluation_responses'::regclass;
--    -> expect confdeltype = 'r' (RESTRICT), NEVER 'c'

-- 3) Safety constraints present.
--    -> expect all three
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
SELECT proname, prosecdef, proconfig
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND (proname LIKE 'ul_eval_%' OR proname LIKE '\_ul\_eval\_%')
ORDER BY proname;

-- 5) Grants: least privilege.
--    5a) Lifecycle (write) functions: anon must NOT execute. -> expect all f
SELECT
  has_function_privilege('anon', 'public.ul_eval_moderate_response(uuid,text)', 'EXECUTE') AS moderate_anon,
  has_function_privilege('anon', 'public.ul_eval_release_response(uuid)',        'EXECUTE') AS release_anon,
  has_function_privilege('anon', 'public.ul_eval_revoke_response(uuid)',         'EXECUTE') AS revoke_anon,
  has_function_privilege('anon', 'public.ul_eval_rerelease_response(uuid)',      'EXECUTE') AS rerelease_anon;
--    5b) Read functions: authenticated executes, anon does not. -> expect t, f
SELECT
  has_function_privilege('authenticated', 'public.ul_eval_response_list(text,text,text)', 'EXECUTE') AS list_authed,
  has_function_privilege('anon',          'public.ul_eval_response_list(text,text,text)', 'EXECUTE') AS list_anon,
  has_function_privilege('authenticated', 'public.ul_eval_response_detail(text)',         'EXECUTE') AS detail_authed;

-- 6) Owner/Admin authorization is the authoritative active model, from the JWT.
--    Every lifecycle function body references is_active_owner_or_admin() and NOT a raw
--    user_profiles.role read or a passed actor id.
--    -> expect authz_ok = 4 (one per lifecycle function), bespoke_role_read = 0
SELECT count(*) FILTER (WHERE prosrc LIKE '%is_active_owner_or_admin()%') AS authz_ok,
       count(*) FILTER (WHERE prosrc ~ 'user_profiles[^;]*role[[:space:]]+IN') AS bespoke_role_read
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('ul_eval_moderate_response', 'ul_eval_release_response',
                  'ul_eval_revoke_response', 'ul_eval_rerelease_response');

-- 7) Read functions enforce the active role-grant model + full defense-in-depth predicates.
--    -> expect all four counters = 3 (one per read function)
SELECT
  count(*) FILTER (WHERE prosrc LIKE '%has_active_role_grant(''unit_leader'')%')      AS grant_checked,
  count(*) FILTER (WHERE prosrc LIKE '%moderation_state = ''cleared''%')              AS moderation_checked,
  count(*) FILTER (WHERE prosrc LIKE '%quantitative_visible = true%')                 AS visibility_checked,
  count(*) FILTER (WHERE prosrc LIKE '%snapshot_source IN (''submission_trigger'', ''backfill_verified'')%') AS snapshot_checked
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('ul_eval_dashboard_summary', 'ul_eval_response_list', 'ul_eval_response_detail');

-- 8) Reads never return a raw response_id: no read function's OUTPUT names response_id.
--    (rel.response_id may appear only in a JOIN condition r.id = rel.response_id.)
--    -> expect 0
SELECT count(*) AS read_fns_exposing_response_id
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('ul_eval_dashboard_summary', 'ul_eval_response_list', 'ul_eval_response_detail')
  AND prosrc ~ '''response_id''';        -- a jsonb/TABLE output key literally named response_id

-- 9) Triggers present: immutability, capture, append-only.
--    -> expect all three
SELECT tgname, tgrelid::regclass AS on_table
FROM pg_trigger
WHERE tgname IN ('trg_ul_eval_guard_snapshot_immutable',
                 'trg_ul_eval_capture_snapshot',
                 'trg_ul_eval_events_append_only')
ORDER BY tgname;

-- 10) Backfill outcome. -> at apply time expect ONLY ('backfill_unverified','ineligible').
SELECT snapshot_source, release_state, count(*)
FROM public.evaluation_response_unit_release
GROUP BY 1, 2
ORDER BY 1, 2;

-- 11) Approved-instruments-only invariant: no release row for a non-approved instrument.
--     -> expect 0
SELECT count(*) AS non_approved_rows
FROM public.evaluation_response_unit_release
WHERE instrument_slug NOT IN ('student_preceptor_eval', 'preceptor_progress');

-- 12) Snapshot immutability (CORRECTED negative test). A forbidden snapshot update MUST
--     raise; if it somehow succeeds, this block raises a HARD assert_failure that aborts
--     the transaction (rolling back the bad write) and is NOT swallowed. If there are no
--     rows yet, it reports 'no_rows_to_test'.
--     -> expect NOTICE 'immutability_enforced' (or 'no_rows_to_test');
--        a guard failure aborts with 'IMMUTABILITY GUARD FAILED' and is clearly visible.
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
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'immutability_enforced';
      RETURN;                              -- success path: nothing was written
  END;
  -- Reached only if the forbidden UPDATE SUCCEEDED. Abort hard and visibly; the raised
  -- exception rolls back the bad write. This errcode is intentionally NOT caught anywhere.
  RAISE EXCEPTION 'IMMUTABILITY GUARD FAILED: forbidden snapshot update succeeded for %', v_id
    USING ERRCODE = 'assert_failure';
END $$;

-- 13) Append-only audit: UPDATE and DELETE on the events table must both raise.
--     -> expect NOTICE 'append_only_enforced' (or 'no_events_yet'); never 'MUTATED'/'DELETED'
DO $$
DECLARE v_eid uuid; v_blocked int := 0;
BEGIN
  SELECT id INTO v_eid FROM public.evaluation_response_unit_release_events LIMIT 1;
  IF v_eid IS NULL THEN
    RAISE NOTICE 'no_events_yet';
    RETURN;
  END IF;
  BEGIN
    UPDATE public.evaluation_response_unit_release_events SET notes = 'x' WHERE id = v_eid;
  EXCEPTION WHEN check_violation THEN v_blocked := v_blocked + 1;
  END;
  BEGIN
    DELETE FROM public.evaluation_response_unit_release_events WHERE id = v_eid;
  EXCEPTION WHEN check_violation THEN v_blocked := v_blocked + 1;
  END;
  IF v_blocked = 2 THEN
    RAISE NOTICE 'append_only_enforced';
  ELSE
    RAISE EXCEPTION 'APPEND-ONLY FAILED: events table accepted UPDATE or DELETE'
      USING ERRCODE = 'assert_failure';
  END IF;
END $$;

-- 14) Base tables untouched: evaluation_responses still owner/admin SELECT, service writes.
--     -> expect the original owner/admin SELECT policy present, no new authenticated write
SELECT polname
FROM pg_policy
WHERE polrelid = 'public.evaluation_responses'::regclass
ORDER BY polname;

-- ============================================================================
-- MANUAL BEHAVIORAL CHECKS (real data + a live Unit Leader session / an authenticated
-- Owner/Admin session). These cannot be verified from static SQL alone.
-- ----------------------------------------------------------------------------
-- A) Active role-grant enforcement: as a Unit Leader whose grant is then revoked or
--    expired (user_role_grants.revoked_at / expires_at), re-run
--      SELECT * FROM public.ul_eval_response_list('student_preceptor_eval', NULL, NULL);
--    -> expect rows before, ZERO rows after revocation/expiry.
-- B) Blocked-response invisibility: release a response, confirm the Unit Leader sees it,
--    then (Owner/Admin) SELECT public.ul_eval_moderate_response('<response_id>'::uuid,'blocked');
--    Re-run the list. -> expect the response disappears IMMEDIATELY.
-- C) Audit preservation: run moderate(cleared) -> release -> revoke -> re_release for one
--    response, then
--      SELECT event_type, prior_release_state, new_release_state, decision, actor_profile_id
--      FROM public.evaluation_response_unit_release_events
--      WHERE response_id = '<response_id>' ORDER BY created_at;
--    -> expect 4 rows in order (moderate, release, revoke, re_release), none overwritten.
--    Then attempt UPDATE/DELETE on any event row -> expect an error (append-only).
-- D) No raw UUID exposure: inspect ul_eval_response_list output. -> expect a response_token
--    (32-char opaque string), NEVER a response_id UUID. Fetch detail with that token:
--      SELECT public.ul_eval_response_detail('<response_token>');  -> returns that response.
--    Passing a real response_id UUID as the token -> expect NULL.
-- E) Allowlisted quantitative keys: inspect the 'quantitative' jsonb. For
--    student_preceptor_eval, keys are only 'preceptor_support.*','learning_environment.*',
--    'psychological_safety.*','overall_experience.*' (never 'narrative.*','evaluated_target.*',
--    'attestation.*'); for preceptor_progress, only 'developmental_feedback.*',
--    'readiness_endorsement.*' (never 'confidential_team_comments.*'). All values numeric.
-- F) Re-release policy: revoke a response, then call ul_eval_release_response on it.
--    -> expect {"status":"revoked_requires_explicit_rerelease"} (ordinary release refuses).
--    Then ul_eval_rerelease_response -> success, and the row's revoked_at is STILL set
--    (history preserved), with a 're_release' audit event.
-- G) Scope cannot widen; All Assigned Units; 7-day delay; owner/admin-only; no count
--    suppression; historical unit stability: as in the prior review (unchanged).
-- H) Preceptor attribution: for a preceptor_progress response, hist_preceptor_id equals the
--    assignment's respondent_preceptor_id (NOT students.preceptor_id). For a
--    student_preceptor_eval response, hist_preceptor_id IS NULL. Neither is ever returned
--    to a Unit Leader.
-- ============================================================================
