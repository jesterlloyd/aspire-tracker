-- Checks for supabase/migrations/20260917000000_ngrp_reflections.sql
-- Read-only. Run each numbered section on its own in the Supabase SQL editor.

-- ── PRE 1: none of the four tables exist yet; the foundation does ───────────
-- Expect: runs, periods, tokens, submissions all NULL; candidates true, cycles true
SELECT to_regclass('public.ngrp_reflection_runs')        AS runs,
       to_regclass('public.ngrp_reflection_periods')     AS periods,
       to_regclass('public.ngrp_reflection_tokens')      AS tokens,
       to_regclass('public.ngrp_reflection_submissions') AS submissions,
       to_regclass('public.ngrp_candidates') IS NOT NULL AS candidates,
       to_regclass('public.ngrp_cycles') IS NOT NULL     AS cycles;

-- ── PRE 2: the audit check is the one 20260916 left (so the DROP hits it) ──
-- Expect: one row whose definition names not_selected and NOT reflection_started
SELECT conname, pg_get_constraintdef(oid) LIKE '%not_selected%' AS has_20260916,
       pg_get_constraintdef(oid) LIKE '%reflection_started%'     AS has_reflections
  FROM pg_constraint
 WHERE conrelid = 'public.ngrp_audit_events'::regclass
   AND conname = 'ngrp_audit_events_event_type_check';

-- ── POST 1: all four tables exist with RLS on ────────────────────────────────
-- Expect: four rows, rls = true
SELECT c.relname, c.relrowsecurity AS rls
  FROM pg_class c
 WHERE c.oid IN ('public.ngrp_reflection_runs'::regclass, 'public.ngrp_reflection_periods'::regclass,
                 'public.ngrp_reflection_tokens'::regclass, 'public.ngrp_reflection_submissions'::regclass)
 ORDER BY c.relname;

-- ── POST 2: service_role only, and submissions cannot be changed ─────────────
-- Expect exactly:
--   ngrp_reflection_periods     | service_role | INSERT,SELECT,UPDATE
--   ngrp_reflection_runs        | service_role | INSERT,SELECT,UPDATE
--   ngrp_reflection_submissions | service_role | INSERT,SELECT
--   ngrp_reflection_tokens      | service_role | INSERT,SELECT,UPDATE
SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public'
   AND table_name LIKE 'ngrp_reflection_%'
   AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
 GROUP BY table_name, grantee
 ORDER BY table_name, grantee;

-- ── POST 3: one run per resident, one period per number, one answer per period
-- Expect: three rows (the UNIQUE constraints on candidate_id, (run_id, period_number), period_id)
SELECT conrelid::regclass AS "table", conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE contype = 'u'
   AND conrelid IN ('public.ngrp_reflection_runs'::regclass, 'public.ngrp_reflection_periods'::regclass,
                    'public.ngrp_reflection_submissions'::regclass)
 ORDER BY 1, 2;

-- ── POST 4: the audit vocabulary kept everything and learned five ────────────
-- Expect: event_type_checks = 1, keeps_earlier = true, learns_new = true
SELECT count(*) AS event_type_checks,
       bool_or(pg_get_constraintdef(oid) LIKE '%hire_recorded%'
               AND pg_get_constraintdef(oid) LIKE '%not_proceeding_recorded%') AS keeps_earlier,
       bool_or(pg_get_constraintdef(oid) LIKE '%reflection_started%'
               AND pg_get_constraintdef(oid) LIKE '%reflection_sent%'
               AND pg_get_constraintdef(oid) LIKE '%reflection_opened%'
               AND pg_get_constraintdef(oid) LIKE '%reflection_submitted%'
               AND pg_get_constraintdef(oid) LIKE '%reflection_stopped%') AS learns_new
  FROM pg_constraint
 WHERE conrelid = 'public.ngrp_audit_events'::regclass
   AND pg_get_constraintdef(oid) LIKE '%event_type%';

-- ── POST 5: nothing recorded yet ─────────────────────────────────────────────
-- Expect: 0, 0, 0, 0
SELECT (SELECT count(*) FROM public.ngrp_reflection_runs)        AS runs,
       (SELECT count(*) FROM public.ngrp_reflection_periods)     AS periods,
       (SELECT count(*) FROM public.ngrp_reflection_tokens)      AS tokens,
       (SELECT count(*) FROM public.ngrp_reflection_submissions) AS submissions;
