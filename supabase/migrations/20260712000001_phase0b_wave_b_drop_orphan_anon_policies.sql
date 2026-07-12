-- ============================================================================
-- PHASE 0B, WAVE B: drop orphan anon policies (NO workflow dependency)
-- ============================================================================
-- Owner instructions: run this ENTIRE file as one block in the Supabase SQL
-- editor. Prerequisite: none (independent of Wave A). Every policy dropped
-- here was verified in the Phase 0A audit to have NO public-page dependency:
-- the public routes that touch these tables do so through service-role API
-- endpoints, never with the anon key. Staff access is unaffected (staff use
-- the authenticated role). All statements are idempotent.
--
-- Finding: F1 in docs/security/PHASE_0A_ACCESS_AUDIT.md.
-- Revert: db/audit/phase0b_reverts.sql, section Wave B (reintroduces the
-- vulnerability; use only if a production workflow proves to depend on one).
-- ============================================================================

-- students: legacy public-intake INSERT path, retired when /student-form moved
-- to api/student-intake-submit.js. (students' anon_all is Wave D, not here.)
DROP POLICY IF EXISTS "anon_insert_students" ON public.students;

-- Interview data: rubrics, sessions, legacy interviews, interviewer roster.
DROP POLICY IF EXISTS "anon_all_rubrics" ON public.interview_rubrics;
DROP POLICY IF EXISTS "anon_all_sessions" ON public.interview_sessions;
DROP POLICY IF EXISTS "Allow anon select on interviews" ON public.interviews;
DROP POLICY IF EXISTS "Allow anon insert on interviews" ON public.interviews;
DROP POLICY IF EXISTS "Allow anon update on interviews" ON public.interviews;
DROP POLICY IF EXISTS "Allow anon select on interviewers" ON public.interviewers;
DROP POLICY IF EXISTS "Allow anon insert on interviewers" ON public.interviewers;
DROP POLICY IF EXISTS "Allow anon update on interviewers" ON public.interviewers;

-- Interview self-scheduling (public page books via api/interview-book.js).
DROP POLICY IF EXISTS "anon_all_blocks" ON public.interview_availability_blocks;
DROP POLICY IF EXISTS "anon_all_slots" ON public.interview_slots;

-- Shift logs (public flow is api/shift-log/*; contains support_needed text).
DROP POLICY IF EXISTS "anon_all_shift_logs" ON public.student_shift_logs;

-- Placement and analytics.
DROP POLICY IF EXISTS "anon_all" ON public.matches;
DROP POLICY IF EXISTS "Anon full access on ngrp_outcomes" ON public.ngrp_outcomes;
DROP POLICY IF EXISTS "Anon full access on cohort_snapshots" ON public.cohort_snapshots;

-- Program event history (anon could previously read, write, AND delete).
DROP POLICY IF EXISTS "Anon read access on program_events" ON public.program_events;
DROP POLICY IF EXISTS "Anon insert access on program_events" ON public.program_events;
DROP POLICY IF EXISTS "Anon update access on program_events" ON public.program_events;
DROP POLICY IF EXISTS "Anon delete access on program_events" ON public.program_events;

-- Belt and braces: revoke anon table privileges so a future permissive policy
-- cannot silently re-expose these tables to the public key.
REVOKE ALL ON public.interview_rubrics            FROM anon;
REVOKE ALL ON public.interview_sessions           FROM anon;
REVOKE ALL ON public.interviews                   FROM anon;
REVOKE ALL ON public.interviewers                 FROM anon;
REVOKE ALL ON public.interview_availability_blocks FROM anon;
REVOKE ALL ON public.interview_slots              FROM anon;
REVOKE ALL ON public.student_shift_logs           FROM anon;
REVOKE ALL ON public.matches                      FROM anon;
REVOKE ALL ON public.ngrp_outcomes                FROM anon;
REVOKE ALL ON public.cohort_snapshots             FROM anon;
REVOKE ALL ON public.program_events               FROM anon;

-- Verification (expected: zero rows):
--   SELECT tablename, policyname FROM pg_policies
--   WHERE schemaname = 'public' AND 'anon' = ANY(roles)
--     AND tablename IN ('students','interview_rubrics','interview_sessions',
--       'interviews','interviewers','interview_availability_blocks',
--       'interview_slots','student_shift_logs','matches','ngrp_outcomes',
--       'cohort_snapshots','program_events')
--     AND policyname <> 'anon_all';  -- students anon_all remains until Wave D
--
-- Post-wave smoke test: /interview-schedule lookup and booking, /shift-log
-- check-in, and the staff interviews and rotation tabs must all still work.
