-- Checks for supabase/migrations/20260918000000_ngrp_resident_schedule.sql
-- Read-only. Run each numbered section on its own in the Supabase SQL editor.

-- ── PRE 1: the table does not exist; the column does not; the foundation does
-- Expect: schedule_days NULL, shift_exists false, outcomes true, candidates true
SELECT to_regclass('public.ngrp_resident_schedule_days') AS schedule_days,
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'ngrp_residency_outcomes'
                  AND column_name = 'shift') AS shift_exists,
       to_regclass('public.ngrp_residency_outcomes') IS NOT NULL AS outcomes,
       to_regclass('public.ngrp_candidates') IS NOT NULL         AS candidates;

-- ── POST 1: the table exists with RLS on ─────────────────────────────────────
-- Expect: one row, rls = true
SELECT c.relname, c.relrowsecurity AS rls
  FROM pg_class c
 WHERE c.oid = 'public.ngrp_resident_schedule_days'::regclass;

-- ── POST 2: service_role may read, add and DELETE marks; nobody else anything ─
-- Expect exactly: ngrp_resident_schedule_days | service_role | DELETE,INSERT,SELECT
SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public'
   AND table_name = 'ngrp_resident_schedule_days'
   AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
 GROUP BY table_name, grantee
 ORDER BY grantee;

-- ── POST 3: one mark per resident per day, and the shift vocabularies ────────
-- Expect: three rows - uq_ngrp_resident_schedule_day (UNIQUE (candidate_id, on_date)),
--         the schedule shift CHECK naming Day, Night, Mid,
--         the outcomes shift CHECK naming Day, Night, Mid, Variable
SELECT conrelid::regclass AS "table", conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE (conrelid = 'public.ngrp_resident_schedule_days'::regclass AND contype IN ('u', 'c') AND pg_get_constraintdef(oid) LIKE '%shift%')
    OR (conrelid = 'public.ngrp_resident_schedule_days'::regclass AND conname = 'uq_ngrp_resident_schedule_day')
    OR (conrelid = 'public.ngrp_residency_outcomes'::regclass AND pg_get_constraintdef(oid) LIKE '%shift%')
 ORDER BY 1, 2;

-- ── POST 4: the column exists, nullable text ─────────────────────────────────
-- Expect: one row, data_type = text, is_nullable = YES
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'ngrp_residency_outcomes' AND column_name = 'shift';

-- ── POST 5: nothing recorded yet ─────────────────────────────────────────────
-- Expect: 0, 0
SELECT (SELECT count(*) FROM public.ngrp_resident_schedule_days)                      AS marks,
       (SELECT count(*) FROM public.ngrp_residency_outcomes WHERE shift IS NOT NULL) AS shifts_recorded;
