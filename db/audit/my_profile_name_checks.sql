-- db/audit/my_profile_name_checks.sql
--
-- TOPBAR-PROFILE-1: checks for supabase/migrations/20261103000000_my_profile_name.sql.
-- Read-only. Run ONE section at a time in the Supabase SQL Editor.
--
-- Order: PRE 1. If it says applied = false, run the migration once, then POST 1 to 3.
-- If PRE 1 says applied = true, do not run the migration again (it is safe to, but there is
-- no reason to); go straight to POST 1 to 3.

-- ── PRE 1: is the function already there? ─────────────────────────────────────────────────
SELECT to_regprocedure('public.update_my_profile(text, jsonb)') IS NOT NULL AS applied;

-- ── POST 1: the function exists, runs as its owner, and pins its search_path ──────────────
-- Expect one row: security_definer = true, config contains search_path=public.
SELECT p.oid::regprocedure AS function,
       p.prosecdef        AS security_definer,
       p.proconfig        AS config
  FROM pg_proc p
 WHERE p.oid = to_regprocedure('public.update_my_profile(text, jsonb)');

-- ── POST 2: who may call it ───────────────────────────────────────────────────────────────
-- Expect: authenticated = true, anon = false, public = false.
SELECT has_function_privilege('authenticated', 'public.update_my_profile(text, jsonb)', 'EXECUTE') AS authenticated,
       has_function_privilege('anon',          'public.update_my_profile(text, jsonb)', 'EXECUTE') AS anon,
       EXISTS (
         SELECT 1
           FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          WHERE p.oid = to_regprocedure('public.update_my_profile(text, jsonb)')
            AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
       ) AS public;

-- ── POST 3: full_name is still NOT writable by a raw client update ────────────────────────
-- Expect: false. The function above is the only self-service path to the name.
SELECT has_column_privilege('authenticated', 'public.user_profiles', 'full_name', 'UPDATE') AS raw_client_can_write_full_name;
