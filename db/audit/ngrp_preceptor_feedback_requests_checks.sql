-- Checks for supabase/migrations/20260912000000_ngrp_preceptor_feedback_requests.sql
-- Read-only. Run each numbered section on its own in the Supabase SQL editor.

-- ── PRE 1: the two tables do not exist yet ───────────────────────────────────
-- Expect: requests = NULL, events = NULL
SELECT to_regclass('public.ngrp_preceptor_feedback_requests')      AS requests,
       to_regclass('public.ngrp_preceptor_feedback_access_events') AS events;

-- ── PRE 2: what the migration depends on is present ──────────────────────────
-- Expect: all three true
SELECT to_regclass('public.ngrp_candidates') IS NOT NULL      AS candidates_table,
       to_regclass('public.evaluation_responses') IS NOT NULL AS evaluation_responses_table,
       to_regprocedure('public._emit_staff_notifications(text, text, uuid, text, text, uuid, uuid, text, text, text, text, text, boolean, text)') IS NOT NULL AS emitter;

-- ── PRE 3: existing indexes on evaluation_responses (information only) ───────
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'evaluation_responses'
 ORDER BY indexname;

-- ── PRE 4: preceptor feedback on file today (information only) ───────────────
SELECT count(*) AS submissions, count(DISTINCT student_id) AS students
  FROM public.evaluation_responses
 WHERE form_type = 'preceptor_progress' AND submitted_at IS NOT NULL;

-- ── POST 1: both tables exist with RLS on ────────────────────────────────────
-- Expect: two rows, rls = true
SELECT c.relname, c.relrowsecurity AS rls
  FROM pg_class c
 WHERE c.oid IN ('public.ngrp_preceptor_feedback_requests'::regclass,
                 'public.ngrp_preceptor_feedback_access_events'::regclass)
 ORDER BY c.relname;

-- ── POST 2: table privileges are service_role only ───────────────────────────
-- Expect exactly:
--   ngrp_preceptor_feedback_access_events | service_role | INSERT,SELECT
--   ngrp_preceptor_feedback_requests      | service_role | INSERT,SELECT,UPDATE
SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public'
   AND table_name IN ('ngrp_preceptor_feedback_requests', 'ngrp_preceptor_feedback_access_events')
   AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
 GROUP BY table_name, grantee
 ORDER BY table_name, grantee;

-- ── POST 3: the two functions run for service_role only ──────────────────────
-- Expect: two rows, anon = false, authenticated = false, service_role = true
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_role
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('ngrp_pf_request_tx', 'ngrp_pf_decide_tx')
 ORDER BY p.proname;

-- ── POST 4: the open-request rule and the lookup index exist ─────────────────
-- Expect: two rows
SELECT indexname
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND indexname IN ('uq_ngrp_pf_requests_open', 'idx_evaluation_responses_form_type_student')
 ORDER BY indexname;

-- ── POST 5: nothing recorded yet ─────────────────────────────────────────────
-- Expect: 0, 0
SELECT (SELECT count(*) FROM public.ngrp_preceptor_feedback_requests)      AS requests,
       (SELECT count(*) FROM public.ngrp_preceptor_feedback_access_events) AS events;
