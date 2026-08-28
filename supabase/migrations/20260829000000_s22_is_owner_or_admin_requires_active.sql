-- ============================================================================
-- S-22: is_owner_or_admin() must require an ACTIVE profile
-- ============================================================================
-- APPLY MANUALLY (Owner/Jester) in the Supabase SQL Editor, as ONE COMPLETE
-- BLOCK. Single transaction. Run the PRE-APPLY section of
-- db/audit/s22_is_owner_or_admin_preflight_and_verification.sql first, one
-- numbered section at a time.
--
-- WHAT IS WRONG
-- public.is_owner_or_admin() checks the caller's ROLE and nothing else:
--
--   SELECT EXISTS (SELECT 1 FROM public.user_profiles
--                  WHERE auth_user_id = auth.uid()
--                    AND role IN ('owner', 'admin'));
--
-- It does not consult is_active. S-05 closed this gap at the ENDPOINT layer:
-- 41 JWT-verified endpoints now refuse a deactivated caller, and deactivation
-- bans the Supabase Auth identity. This is the DATABASE layer, where the same
-- gap survives. A deactivated Owner or Admin holding a still-valid access token
-- reaches PostgREST directly from the browser and passes every policy and RPC
-- guard built on this predicate.
--
-- That is not theoretical. src/App.jsx routes a staff profile to /aggregate
-- regardless of is_active, so the staff application renders for a deactivated
-- admin and issues its normal browser reads. Of the tables gated by this
-- predicate, the browser reads activity_logs, evaluation_assignments,
-- certificates, and support_request_reads directly, and calls
-- get_all_user_profiles() and complete_disposition_followup() as RPCs.
--
-- WHY THIS FIXES IT BY REDEFINITION RATHER THAN BY REWRITING CALL SITES
-- Fifteen policies across fourteen tables and five functions call this
-- predicate in repository SQL. The original audit counted SEVEN RPCs, two more
-- than this repository contains, which means there are almost certainly
-- dashboard-created references that cannot be enumerated from the repository at
-- all. This project has already been bitten twice by exactly that: the
-- out-of-band catch-all policy on interviewers that 20260822030000 dropped, and
-- the anon read policy on unit_leaders (S-18). Both were created in the
-- dashboard and neither is visible from this repository.
--
-- Rewriting the call sites I can see would fix only those, and would leave any
-- reference I cannot see still trusting a deactivated account. Redefining the
-- predicate fixes EVERY reference at once, known and unknown, with no policy
-- churn and no risk of missing one. It is the fail-safe direction.
--
-- The new body delegates to is_active_owner_or_admin() rather than repeating
-- its logic, so there is exactly one implementation of "an active owner or
-- admin" to audit, and the two names cannot drift apart later.
--
-- WHAT ELSE DIFFERS BETWEEN THE TWO HELPERS
-- Only two things, and both are addressed here:
--   1. The is_active check (the finding).
--   2. EXECUTE grants. is_owner_or_admin() was granted to `authenticated`
--      only; is_active_owner_or_admin() is granted to `authenticated,
--      service_role`. The grant below adds service_role for parity. This is a
--      superset and cannot remove access from any current caller.
-- Everything else is identical: both are SECURITY DEFINER, STABLE, LANGUAGE
-- sql, with SET search_path = public, pg_catalog, and both are REVOKEd from
-- PUBLIC and anon.
--
-- WHAT THIS CHANGES FOR A LEGITIMATE USER
-- Nothing. An ACTIVE Owner or Admin evaluates identically before and after.
-- Only a deactivated one is affected, and every application path already
-- refuses that account; this closes the direct-to-database path that did not.
--
-- Service-role callers are unaffected either way: service_role bypasses RLS
-- entirely, so no server endpoint depends on these policies.
--
-- This migration changes ONE FUNCTION BODY and ONE GRANT. It creates no table,
-- drops no policy, and writes no row.
-- ============================================================================

BEGIN;

-- One implementation. is_owner_or_admin() becomes a thin, deprecated alias so
-- that every existing reference, including any created outside this repository,
-- inherits the active requirement without being touched.
CREATE OR REPLACE FUNCTION public.is_owner_or_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT public.is_active_owner_or_admin();
$$;

COMMENT ON FUNCTION public.is_owner_or_admin() IS
  'DEPRECATED ALIAS (S-22). Delegates to is_active_owner_or_admin(). It once '
  'checked role only, so a deactivated Owner or Admin passed every policy and '
  'RPC built on it. Kept rather than dropped because references created outside '
  'this repository cannot be enumerated from it; redefining fixes those too. '
  'New objects should call is_active_owner_or_admin() directly.';

-- Parity with is_active_owner_or_admin(). A superset of the previous grants:
-- nothing that could call this before loses the ability to.
REVOKE ALL ON FUNCTION public.is_owner_or_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_owner_or_admin() TO authenticated, service_role;

COMMIT;


-- ── Verification ─────────────────────────────────────────────────────────────
-- See db/audit/s22_is_owner_or_admin_preflight_and_verification.sql, POST-APPLY
-- section. Run each numbered section separately.


-- ============================================================================
-- ROLLBACK (INERT). Restores the role-only body.
-- Save the PRE 1 output before applying; if it reports any attribute differing
-- from the statement below, use the PRE 1 restore_sql column instead, which is
-- generated from the live catalog verbatim.
--
-- Reintroduces the finding by design: for emergency recovery only.
-- ============================================================================
/*
BEGIN;
CREATE OR REPLACE FUNCTION public.is_owner_or_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE auth_user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;
COMMIT;
*/
