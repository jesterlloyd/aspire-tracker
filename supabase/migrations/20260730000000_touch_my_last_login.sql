-- ============================================================================
-- ACCOUNTS-ACCESS-DIRECTORY-2: touch_my_last_login, a tracked once-per-session
-- last-login stamp for staff AND portal users
-- ============================================================================
-- get_my_profile is a dashboard-created RPC and is untracked in this repo (see
-- docs/security/PHASE_0A_ACCESS_AUDIT.md finding F8). Its live body is not
-- reproduced here, is not called differently by this migration, and this
-- migration does not alter it in any way.
--
-- This function is additive: it gives the application a small, deterministic,
-- server-controlled RPC that AuthContext (src/contexts/AuthContext.jsx) calls
-- exactly once per authenticated session, including a resumed session when the
-- app opens, for both staff and portal callers. AuthContext guards the call
-- with a ref so it is never sent on every render and never sent from
-- refreshUserProfile; this function adds a second, server-side guard so even a
-- misbehaving or duplicated client call cannot rewrite the timestamp
-- continuously: it only advances last_login_at when the caller's existing
-- value is null or older than 5 minutes.
--
-- The function updates ONLY the caller's own user_profiles row, resolved by
-- auth.uid(), and returns nothing. It follows the function-hardening pattern
-- established in
-- supabase/migrations/20260712000006_phase0b_wave_f1_function_execute_hardening.sql:
-- SECURITY DEFINER, a fixed search_path, PUBLIC and anon explicitly revoked,
-- and EXECUTE granted only to authenticated (plus service_role).
--
-- This migration awaits the Owner SQL gate (docs/security/OWNER_SQL_GATE.md)
-- and has not been applied to the live database. AuthContext already calls
-- this RPC and swallows any "function does not exist" error silently until it
-- is applied, so shipping the application code ahead of the gate is safe.
--
-- Idempotent and safely rerunnable (CREATE OR REPLACE, REVOKE, and GRANT are
-- all repeatable). Wrapped in a transaction.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.touch_my_last_login()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path = public
AS $function$
  UPDATE public.user_profiles
  SET last_login_at = now()
  WHERE auth_user_id = auth.uid()
    AND (last_login_at IS NULL OR last_login_at < now() - interval '5 minutes');
$function$;

REVOKE ALL ON FUNCTION public.touch_my_last_login() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_my_last_login() TO authenticated, service_role;

COMMIT;

-- ── Verification (read-only) ─────────────────────────────────────────────
--
-- 1. The function is SECURITY DEFINER with a fixed search_path:
--   SELECT p.proname, p.prosecdef, p.proconfig
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'touch_my_last_login';
--
-- 2. PUBLIC and anon have no EXECUTE; authenticated and service_role do
--    (expected exactly two rows: authenticated, service_role):
--   SELECT r.rolname
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
--   JOIN pg_roles r ON r.oid = a.grantee
--   WHERE n.nspname = 'public' AND p.proname = 'touch_my_last_login'
--     AND a.privilege_type = 'EXECUTE'
--   ORDER BY r.rolname;
--
-- 3. Smoke test after apply: a signed-in staff or portal user's first profile
--    load in a session advances user_profiles.last_login_at; calling it again
--    within 5 minutes does not change the value; a repeat login after the
--    5-minute window advances it again.

-- ── Rollback (INERT; for emergency recovery only) ────────────────────────
/*
BEGIN;
DROP FUNCTION IF EXISTS public.touch_my_last_login();
COMMIT;
*/
