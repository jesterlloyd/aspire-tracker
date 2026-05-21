-- Adds authenticated-role RLS policy on interview_rubrics.
--
-- The original migration (migration_interview_redesign.sql) only created a
-- policy for the anon role.  When users are logged in via Supabase Auth their
-- requests arrive as the authenticated role, which that policy does not cover.
-- Without this fix, every INSERT/UPDATE from a logged-in interviewer is
-- silently rejected by RLS — the error surfaces in Supabase logs but is
-- swallowed by the client-side save handler, so the interviewer never sees it.
--
-- Run this in the Supabase SQL Editor.

DROP POLICY IF EXISTS "authenticated_all_rubrics" ON interview_rubrics;

CREATE POLICY "authenticated_all_rubrics" ON interview_rubrics
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
