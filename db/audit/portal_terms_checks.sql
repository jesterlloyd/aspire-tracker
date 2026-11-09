-- db/audit/portal_terms_checks.sql
-- PORTAL-TERMS-1. Read-only checks for supabase/migrations/20261206000000_portal_terms.sql.
-- Run one section at a time with: supabase db query --linked -f <a file holding that section>

-- PRE 1: nothing exists yet, and the two helpers the policies read do (expect 0, 0, 2).
SELECT
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'portal_terms_acceptances') AS table_present,
  (SELECT count(*) FROM pg_proc WHERE proname = 'accept_portal_terms') AS function_present,
  (SELECT count(*) FROM pg_proc WHERE proname IN ('portal_profile_id', 'is_active_owner_or_admin')) AS helpers_present;

-- POST 1: the table, RLS on, two read policies (expect 1, true, 2).
SELECT
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'portal_terms_acceptances') AS table_present,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.portal_terms_acceptances'::regclass) AS rls_on,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'portal_terms_acceptances') AS policies;

-- POST 2: authenticated may only SELECT; anon nothing (expect one row: authenticated, SELECT).
SELECT grantee, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'portal_terms_acceptances'
   AND grantee IN ('anon', 'authenticated')
 ORDER BY grantee, privilege_type;

-- POST 3: the function is SECURITY DEFINER and executable by authenticated only (expect true, true, false).
SELECT p.prosecdef AS security_definer,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
  FROM pg_proc p WHERE p.proname = 'accept_portal_terms';

-- POST 4: the update trigger is present (expect 1).
SELECT count(*) AS no_update_trigger FROM pg_trigger WHERE tgname = 'trg_portal_terms_no_update';

-- REPORT (any time): who has accepted the current version, newest first.
-- SELECT up.full_name, up.email, a.terms_version, a.portal_roles, a.accepted_at
--   FROM public.portal_terms_acceptances a JOIN public.user_profiles up ON up.id = a.profile_id
--  ORDER BY a.accepted_at DESC LIMIT 100;
