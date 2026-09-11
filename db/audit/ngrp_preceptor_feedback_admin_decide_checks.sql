-- Checks for supabase/migrations/20260913000000_ngrp_preceptor_feedback_admin_decide.sql
-- Read-only. Run each numbered section on its own in the Supabase SQL editor.

-- ── PRE 1: the function exists and is still Owner-only ───────────────────────
-- Expect: exists = true, owner_only = true, admits_admin = false
SELECT to_regprocedure('public.ngrp_pf_decide_tx(uuid, uuid, text, text, text)') IS NOT NULL AS exists,
       position('is_owner IS TRUE AND COALESCE(is_active, true) = true' IN p.prosrc) > 0 AS owner_only,
       position('role IN (''owner'', ''admin'')' IN p.prosrc) > 0 AS admits_admin
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'ngrp_pf_decide_tx';

-- ── POST 1: the function now admits the Owner or an Admin ────────────────────
-- Expect: admits_admin = true, still_security_definer = true
SELECT position('role IN (''owner'', ''admin'')' IN p.prosrc) > 0 AS admits_admin,
       p.prosecdef AS still_security_definer
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'ngrp_pf_decide_tx';

-- ── POST 2: still runs for service_role only ─────────────────────────────────
-- Expect: anon = false, authenticated = false, service_role = true
SELECT has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_role
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'ngrp_pf_decide_tx';

-- ── POST 3: who can now decide (information only) ────────────────────────────
SELECT full_name, role, is_owner
  FROM public.user_profiles
 WHERE (is_owner IS TRUE OR role IN ('owner', 'admin')) AND COALESCE(is_active, true) = true
 ORDER BY is_owner DESC, full_name;
