-- Checks for supabase/migrations/20260920000000_ngrp_mentorship_session_details.sql
-- Read-only. Run each numbered section on its own in the Supabase SQL editor.

-- ── PRE 1: the table exists; none of the five columns does yet ───────────────
-- Expect: entries true, session_format false, duration_minutes false, topics false,
--         next_steps false, logged_by false
SELECT to_regclass('public.ngrp_support_entries') IS NOT NULL AS entries,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                AND table_name = 'ngrp_support_entries' AND column_name = 'session_format')   AS session_format,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                AND table_name = 'ngrp_support_entries' AND column_name = 'duration_minutes') AS duration_minutes,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                AND table_name = 'ngrp_support_entries' AND column_name = 'topics')           AS topics,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                AND table_name = 'ngrp_support_entries' AND column_name = 'next_steps')       AS next_steps,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                AND table_name = 'ngrp_support_entries' AND column_name = 'logged_by')        AS logged_by;

-- ── PRE 2: what is on record before the change ───────────────────────────────
-- Expect: two counts (any numbers). Write them down; POST 4 must match.
SELECT count(*)                                                   AS entries,
       count(*) FILTER (WHERE activity = 'mentorship_session')    AS mentorship_sessions
  FROM public.ngrp_support_entries;

-- ── POST 1: the five columns ─────────────────────────────────────────────────
-- Expect five rows:
--   duration_minutes | integer | YES | (null)
--   logged_by        | text    | NO  | 'aspire_team'::text
--   next_steps       | text    | YES | (null)
--   session_format   | text    | YES | (null)
--   topics           | text    | YES | (null)
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'ngrp_support_entries'
   AND column_name IN ('session_format', 'duration_minutes', 'topics', 'next_steps', 'logged_by')
 ORDER BY column_name;

-- ── POST 2: the CHECKs ───────────────────────────────────────────────────────
-- Expect six rows: chk_ngrp_support_session_details (activity = mentorship_session
-- OR all four session fields NULL), plus one CHECK each for duration_minutes
-- (5 to 480), logged_by (aspire_team, mentor, resident), next_steps (2000),
-- session_format (in_person, virtual, phone) and topics (2000)
SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid = 'public.ngrp_support_entries'::regclass
   AND contype = 'c'
   AND (conname = 'chk_ngrp_support_session_details'
     OR pg_get_constraintdef(oid) LIKE '%session_format%'
     OR pg_get_constraintdef(oid) LIKE '%duration_minutes%'
     OR pg_get_constraintdef(oid) LIKE '%topics%'
     OR pg_get_constraintdef(oid) LIKE '%next_steps%'
     OR pg_get_constraintdef(oid) LIKE '%logged_by%')
 ORDER BY conname;

-- ── POST 3: still no DELETE for anyone ───────────────────────────────────────
-- Expect exactly one row: ngrp_support_entries | service_role | INSERT,SELECT,UPDATE
SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public'
   AND table_name = 'ngrp_support_entries'
   AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
 GROUP BY table_name, grantee;

-- ── POST 4: nothing lost, everything reads as logged by the ASPIRE team ──────
-- Expect: entries and mentorship_sessions equal to PRE 2; logged_by_team equal to
--         entries; with_details 0
SELECT count(*)                                                   AS entries,
       count(*) FILTER (WHERE activity = 'mentorship_session')    AS mentorship_sessions,
       count(*) FILTER (WHERE logged_by = 'aspire_team')          AS logged_by_team,
       count(*) FILTER (WHERE session_format IS NOT NULL OR topics IS NOT NULL) AS with_details
  FROM public.ngrp_support_entries;
