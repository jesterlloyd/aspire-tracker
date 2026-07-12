-- ============================================================================
-- Phase 0A live-state audit (READ ONLY)
-- ============================================================================
-- Companion to docs/security/PHASE_0A_ACCESS_AUDIT.md.
--
-- HOW TO RUN: paste this ENTIRE file into the Supabase SQL editor and run it
-- as one block. Every statement is a SELECT against system catalogs. It
-- changes nothing, takes no locks of consequence, and is safe to run against
-- production at any time. Return all seven result sets.
--
-- Supabase SQL editor shows one result grid per statement; use the result
-- tabs, or run sections one at a time if preferred. Both are safe.
-- ============================================================================

-- 1. RLS enablement per table (public schema).
--    Expect rowsecurity = true everywhere; any false row is a finding.
SELECT
  n.nspname  AS schema,
  c.relname  AS table_name,
  c.relrowsecurity   AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;

-- 2. Every policy in public and storage schemas.
--    This is the core evidence: confirms or clears findings F1 through F6,
--    and reveals any dashboard-created policies the repository cannot see.
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual        AS using_expression,
  with_check  AS with_check_expression
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;

-- 3. Table privileges held by anon, authenticated, and PUBLIC.
--    Confirms the default-grant baseline assumption in audit section 5.
SELECT
  grantee,
  table_name,
  string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
GROUP BY grantee, table_name
ORDER BY table_name, grantee;

-- 4. Every function in public: security mode and ACL.
--    proacl IS NULL means default privileges, which include EXECUTE for
--    PUBLIC (and therefore anon). Flag any SECURITY DEFINER row whose ACL is
--    NULL or grants anon/authenticated unexpectedly. Resolves finding F8.
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security_mode,
  COALESCE(array_to_string(p.proacl, E'\n'), '(default: PUBLIC has EXECUTE)') AS acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname;

-- 5. Storage buckets: public flag. Resolves finding F7 together with the
--    storage.objects policies from section 2.
SELECT id, name, public, created_at
FROM storage.buckets
ORDER BY name;

-- 6. Identity invariant behind read-receipt policies (finding F9).
--    Expect mismatched = 0. Any other value means support_request_reads
--    policies and student_reads/session_reads policies disagree about what a
--    user id is, and one of the two features is silently broken.
SELECT
  count(*) FILTER (WHERE id <> auth_user_id) AS mismatched,
  count(*)                                   AS total_profiles
FROM public.user_profiles;

-- 7. Realtime publication membership. Tables here stream changes to clients
--    subject to RLS; confirms exposure surface for anon-visible tables.
SELECT pubname, schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;
