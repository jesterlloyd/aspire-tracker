-- Checks for supabase/migrations/20260914000000_ngrp_support.sql
-- Read-only. Run each numbered section on its own in the Supabase SQL editor.

-- ── PRE 1: the two tables do not exist yet; the foundation does ──────────────
-- Expect: entries = NULL, mentors = NULL, candidates = true, cycles = true
SELECT to_regclass('public.ngrp_support_entries')   AS entries,
       to_regclass('public.ngrp_resident_mentors')  AS mentors,
       to_regclass('public.ngrp_candidates') IS NOT NULL AS candidates,
       to_regclass('public.ngrp_cycles') IS NOT NULL     AS cycles;

-- ── POST 1: both tables exist with RLS on ────────────────────────────────────
-- Expect: two rows, rls = true
SELECT c.relname, c.relrowsecurity AS rls
  FROM pg_class c
 WHERE c.oid IN ('public.ngrp_support_entries'::regclass, 'public.ngrp_resident_mentors'::regclass)
 ORDER BY c.relname;

-- ── POST 2: service_role only, and no DELETE ─────────────────────────────────
-- Expect exactly:
--   ngrp_resident_mentors | service_role | INSERT,SELECT,UPDATE
--   ngrp_support_entries  | service_role | INSERT,SELECT,UPDATE
SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public'
   AND table_name IN ('ngrp_support_entries', 'ngrp_resident_mentors')
   AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
 GROUP BY table_name, grantee
 ORDER BY table_name, grantee;

-- ── POST 3: the one-live-entry rule exists ───────────────────────────────────
-- Expect: one row
SELECT indexname FROM pg_indexes
 WHERE schemaname = 'public' AND indexname = 'uq_ngrp_support_entry_live';

-- ── POST 4: nothing recorded yet ─────────────────────────────────────────────
-- Expect: 0, 0
SELECT (SELECT count(*) FROM public.ngrp_support_entries)  AS entries,
       (SELECT count(*) FROM public.ngrp_resident_mentors) AS mentors;
