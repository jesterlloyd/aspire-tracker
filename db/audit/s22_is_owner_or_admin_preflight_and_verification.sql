-- ============================================================================
-- S-22: read-only PRE-APPLY and POST-APPLY queries
-- ============================================================================
-- READ ONLY. Nothing here writes, and nothing exposes a secret or any PII.
--
-- Run the PRE-APPLY section BEFORE applying
-- supabase/migrations/20260829000000_s22_is_owner_or_admin_requires_active.sql,
-- and the POST-APPLY section after.
--
-- RUN EACH NUMBERED SECTION SEPARATELY. The Supabase SQL Editor returns only one
-- result set when several SELECT statements are submitted together. The
-- migration itself is the opposite: one transaction, run as ONE complete block.
--
-- PRE 2 IS THE ONE THAT MATTERS MOST. It enumerates every LIVE dependency on
-- is_owner_or_admin(), including objects created in the dashboard that this
-- repository cannot see. The original audit counted seven RPCs; the repository
-- contains five, so at least two references are expected to be invisible here.
-- Record its output: it is the only complete inventory that will ever exist.
-- ============================================================================


-- ############################################################################
-- PRE-APPLY (run BEFORE the migration)
-- ############################################################################

-- ── PRE 1: both helpers as they exist live, with a restore statement ────────
-- SAVE THIS RESULT SET. The migration's inert rollback is written from the
-- definition below; restore_sql here is generated from the live catalog and is
-- authoritative if the two ever differ.
--
-- Expected NOW: two rows. is_owner_or_admin has a body checking role only, with
-- NO reference to is_active. is_active_owner_or_admin checks role AND
-- COALESCE(is_active, true) = true. Both prosecdef = true, provolatile = 's',
-- proconfig containing search_path=public, pg_catalog.
--
-- If is_owner_or_admin's body ALREADY mentions is_active, stop: someone has
-- changed it out-of-band and the finding may already be closed. Run alone.
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid)          AS arguments,
  p.prosecdef                                        AS security_definer,
  p.provolatile                                      AS volatility,
  p.proconfig                                        AS config,
  (pg_get_functiondef(p.oid) ILIKE '%is_active%')    AS body_mentions_is_active,
  pg_get_functiondef(p.oid)                          AS restore_sql
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('is_owner_or_admin', 'is_active_owner_or_admin')
ORDER BY p.proname;

-- ── PRE 2: EVERY live policy that references is_owner_or_admin() ───────────
-- THE COMPLETE INVENTORY. The repository contains fifteen such policies across
-- fourteen tables (user_role_grants, user_student_links, user_unit_scopes,
-- user_school_scopes, released_reports, student_dispositions, activity_logs,
-- certificates, student_disposition_followups, evaluation_instruments,
-- evaluation_assignments, evaluation_responses, evaluation_reminders, and
-- support_request_reads which has two).
--
-- ANY ROW HERE THAT IS NOT ONE OF THOSE was created out-of-band and is a
-- reference this repository does not know about. Record it. It is also proof of
-- why the migration redefines the predicate rather than rewriting call sites:
-- a rewrite would have missed exactly these. Run alone.
SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  qual        AS using_expression,
  with_check  AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual ILIKE '%is_owner_or_admin%' OR with_check ILIKE '%is_owner_or_admin%')
ORDER BY tablename, policyname;

-- ── PRE 3: EVERY live function whose body calls is_owner_or_admin() ────────
-- The repository contains five: get_all_user_profiles, add_interviewer,
-- update_interviewer_color, update_interviewer_email, and
-- complete_disposition_followup. The audit counted SEVEN RPCs, so expect up to
-- two more here that exist only in the dashboard. Each extra one is a guard
-- that has been trusting a deactivated account and that no one has been able to
-- see. Run alone.
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef                               AS security_definer
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname NOT IN ('is_owner_or_admin')
  AND pg_get_functiondef(p.oid) ILIKE '%is_owner_or_admin%'
ORDER BY p.proname;

-- ── PRE 4: current EXECUTE grants on both helpers ──────────────────────────
-- Expected NOW: is_owner_or_admin granted to `authenticated` only;
-- is_active_owner_or_admin granted to `authenticated` and `service_role`.
-- The migration brings the first into line with the second. Neither should show
-- anon or PUBLIC. Run alone.
SELECT routine_name, grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public'
  AND routine_name IN ('is_owner_or_admin', 'is_active_owner_or_admin')
ORDER BY routine_name, grantee;

-- ── PRE 5: how many accounts this actually changes ─────────────────────────
-- Sizes the blast radius without naming anyone. NO email, name, or id is
-- selected.
--
-- `deactivated_staff` is the number of accounts that will STOP passing these
-- policies. Expected: small, and every one of them is an account someone
-- deliberately switched off. If it is 0, the migration is purely preventative
-- and changes nothing today. `active_staff` must be non-zero, or the migration
-- would lock everyone out; treat 0 as a stop condition. Run alone.
SELECT
  count(*) FILTER (WHERE COALESCE(is_active, true) = true)  AS active_staff,
  count(*) FILTER (WHERE is_active = false)                 AS deactivated_staff
FROM public.user_profiles
WHERE role IN ('owner', 'admin');


-- ############################################################################
-- POST-APPLY (run AFTER the migration)
-- ############################################################################

-- ── POST 1: the predicate now requires an active profile ───────────────────
-- PASS: one row, body_mentions_is_active = true, and delegates_to_active = true
-- (the body is the one-line delegation, not a copied predicate). Run alone.
SELECT
  p.proname,
  (pg_get_functiondef(p.oid) ILIKE '%is_active%')                    AS body_mentions_is_active,
  (pg_get_functiondef(p.oid) ILIKE '%is_active_owner_or_admin()%')   AS delegates_to_active,
  p.prosecdef                                                        AS security_definer,
  p.provolatile                                                      AS volatility,
  p.proconfig                                                        AS config
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname = 'is_owner_or_admin';

-- ── POST 2: the two helpers now agree for the CURRENT session ──────────────
-- Run this signed in as an ACTIVE Owner or Admin in the SQL Editor.
-- PASS: both columns true, and agree = true.
--
-- Note the SQL Editor may run as a role for which auth.uid() is null, in which
-- case both return false and agree is still true. That is a valid pass: the
-- property under test is that the two now answer identically. Run alone.
SELECT
  public.is_owner_or_admin()                                    AS legacy_alias,
  public.is_active_owner_or_admin()                             AS canonical,
  (public.is_owner_or_admin() = public.is_active_owner_or_admin()) AS agree;

-- ── POST 3: every dependency is unchanged ──────────────────────────────────
-- PASS: byte-identical to PRE 2. The migration touched no policy, so the same
-- rows in the same order must come back. A difference means something other
-- than this migration ran. Run alone.
SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  qual        AS using_expression,
  with_check  AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual ILIKE '%is_owner_or_admin%' OR with_check ILIKE '%is_owner_or_admin%')
ORDER BY tablename, policyname;

-- ── POST 4: grants are now at parity, and still exclude anon and PUBLIC ────
-- PASS: is_owner_or_admin now shows BOTH `authenticated` and `service_role`,
-- matching is_active_owner_or_admin. Neither shows anon or PUBLIC. Run alone.
SELECT routine_name, grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public'
  AND routine_name IN ('is_owner_or_admin', 'is_active_owner_or_admin')
ORDER BY routine_name, grantee;

-- ── POST 5: no other definition of the predicate was left behind ───────────
-- PASS: exactly one row. An overload with different argument types would be a
-- second implementation that the redefinition above did not reach. Run alone.
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname = 'is_owner_or_admin';


-- ############################################################################
-- FOLLOW-UP, NOT PART OF THIS MIGRATION
-- ############################################################################
-- Once PRE 2 and PRE 3 have produced the complete live inventory, the remaining
-- tidy-up is to point those references at is_active_owner_or_admin() directly
-- and retire the alias. That is deliberately NOT bundled here: it is policy
-- churn across fourteen-plus tables for no additional security, since after
-- this migration both names mean the same thing. Do it only if the duplicate
-- name is judged to be a maintenance risk in its own right, and do it from the
-- PRE 2 and PRE 3 output rather than from the repository, which is incomplete.
--
-- Do NOT drop is_owner_or_admin() while any dependency remains. Postgres will
-- refuse (policies create dependencies), which is a useful safety net rather
-- than an obstacle, but the attempt will fail loudly rather than quietly.
