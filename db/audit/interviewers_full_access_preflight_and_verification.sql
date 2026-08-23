-- ============================================================================
-- DROP "Full access on interviewers": read-only PRE-APPLY and POST-APPLY queries
-- ============================================================================
-- READ ONLY. Nothing here writes, and nothing exposes a secret.
--
-- Run the PRE-APPLY section BEFORE applying
-- supabase/migrations/20260822030000_drop_interviewers_full_access_policy.sql,
-- and the POST-APPLY section after.
--
-- RUN EACH NUMBERED SECTION SEPARATELY. The Supabase SQL Editor returns only one
-- result set when several SELECT statements are submitted together. The
-- migration itself is the opposite: one transaction, run as ONE complete block.
-- ============================================================================


-- ############################################################################
-- PRE-APPLY (run BEFORE the migration)
-- ############################################################################

-- ── PRE 1: the policy as it exists live, with its exact restore statement ───
-- SAVE THIS RESULT SET. The migration's inert rollback is written from the
-- reported definition; restore_sql here is generated from the live catalog and
-- is authoritative if the two ever differ. Expected NOW: exactly one row, with
-- cmd = 'ALL', permissive = 'PERMISSIVE', roles containing public, and both
-- expressions equal to 'true'. Run alone.
SELECT
  p.policyname,
  p.cmd,
  p.permissive,
  p.roles,
  p.qual        AS using_expression,
  p.with_check  AS with_check_expression,
  format(
    'CREATE POLICY %I ON public.interviewers AS %s FOR %s TO %s%s%s;',
    p.policyname,
    p.permissive,
    p.cmd,
    (SELECT string_agg(CASE WHEN r = 'public' THEN 'PUBLIC' ELSE quote_ident(r) END, ', ')
       FROM unnest(p.roles::text[]) AS r),
    CASE WHEN p.qual       IS NULL THEN '' ELSE ' USING (' || p.qual || ')' END,
    CASE WHEN p.with_check IS NULL THEN '' ELSE ' WITH CHECK (' || p.with_check || ')' END
  )             AS restore_sql
FROM pg_policies p
WHERE p.schemaname = 'public'
  AND p.tablename  = 'interviewers'
  AND p.policyname = 'Full access on interviewers';

-- ── PRE 2: every policy on interviewers, so the full picture is recorded ────
-- Expected NOW: the row above plus either staff_all_interviewers (if the Wave E
-- split is not yet applied) or the four interviewers_* policies (if it is).
-- Anything else is a second out-of-band policy: review it before proceeding.
-- Run alone.
SELECT policyname, cmd, permissive, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'interviewers'
ORDER BY policyname;

-- ── PRE 3: who actually holds table privileges on interviewers ──────────────
-- This is what bounds the policy's real effect. Expected NOW: anon holds
-- NOTHING (Wave B revoked it), authenticated and service_role hold the Supabase
-- defaults. If anon appears here, Wave B was not applied and the exposure is
-- wider than the migration header states. Run alone.
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'interviewers'
ORDER BY grantee, privilege_type;

-- ── PRE 4: SIBLING HUNT. any other out-of-band permissive policy in public ──
-- A dashboard-created policy on one table suggests there may be others. This
-- lists every PERMISSIVE policy in the public schema whose USING or WITH CHECK
-- is the bare constant true, or whose roles include public, on any table. Each
-- row wants a human decision. Expected: ideally 0 rows beyond policies this
-- repository created deliberately (for example the anon SELECT USING (true)
-- on cohorts, units, and unit_leaders, which the security audit already
-- recorded). Run alone.
SELECT
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check,
  CASE
    WHEN 'public' = ANY (roles::text[])                                    THEN 'TO public'
    WHEN qual = 'true' OR with_check = 'true'                              THEN 'USING/WITH CHECK (true)'
  END AS why_listed
FROM pg_policies
WHERE schemaname = 'public'
  AND permissive = 'PERMISSIVE'
  AND (
    'public' = ANY (roles::text[])
    OR qual = 'true'
    OR with_check = 'true'
  )
ORDER BY tablename, policyname;

-- ── PRE 5: confirm nothing in the database references the policy ───────────
-- Policies cannot be depended on by other objects, so this is a catalog sanity
-- check that the name resolves to exactly one policy and nothing else shares
-- it on another table. Expected: 1 row, tablename = interviewers. Run alone.
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE policyname = 'Full access on interviewers';


-- ############################################################################
-- POST-APPLY (run AFTER the migration)
-- ############################################################################

-- ── POST 1: the policy is gone ─────────────────────────────────────────────
-- PASS: 0 rows. Run alone.
SELECT policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'interviewers'
  AND policyname = 'Full access on interviewers';

-- ── POST 2: no USING (true) or TO public policy remains on interviewers ────
-- PASS: 0 rows. This is the property that makes the Wave E writer policies
-- effective: with no permissive catch-all left to OR against, each command is
-- governed by its own policy. Run alone.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'interviewers'
  AND (
    'public' = ANY (roles::text[])
    OR qual = 'true'
    OR with_check = 'true'
  );

-- ── POST 3: the remaining policy set is exactly the expected one ───────────
-- PASS, if the Wave E split IS applied: four rows, interviewers_staff_select
-- (SELECT, is_staff), interviewers_writer_insert / _update / _delete
-- (is_active_staff_writer).
-- PASS, if the Wave E split is NOT yet applied: one row, staff_all_interviewers
-- (ALL, is_staff).
-- Any other row is unexpected. Run alone.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'interviewers'
ORDER BY cmd, policyname;

-- ── POST 4: table privileges are unchanged ─────────────────────────────────
-- PASS: identical to PRE 3. The migration touched no grant. Run alone.
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'interviewers'
ORDER BY grantee, privilege_type;

-- ── POST 5: row count is unchanged ─────────────────────────────────────────
-- PASS: the same count as before applying (record it from a quick count first
-- if you want a hard comparison). The migration cannot change this; the check
-- exists so the claim "drops no data" is verified rather than asserted. Run
-- alone.
SELECT count(*) AS interviewer_rows FROM public.interviewers;
