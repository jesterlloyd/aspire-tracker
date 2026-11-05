-- STUDIO-2: PRE and POST checks for 20261130000000_studio_audiences.sql. Read-only.
-- PRE: studio_designs exists; neither new table does yet.
-- POST: both tables exist, RLS on, no policy, only service_role holds privileges, and neither
--       holds a row yet.

SELECT
  to_regclass('public.studio_designs')       IS NOT NULL AS designs_present,
  to_regclass('public.studio_sends')         IS NOT NULL AS sends_present,
  to_regclass('public.program_news_optouts') IS NOT NULL AS optouts_present,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname IN ('studio_sends', 'program_news_optouts') AND c.relrowsecurity) AS rls_on,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('studio_sends', 'program_news_optouts')) AS policies,
  (SELECT string_agg(DISTINCT grantee, ',') FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name IN ('studio_sends', 'program_news_optouts')) AS grantees;
