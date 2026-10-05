-- RESUME-REVIEW-1: checks for supabase/migrations/20261105000000_resume_reviews.sql.
-- Read-only. Run one section at a time.

-- PRE 1: is it already applied, and is its prerequisite? Expect versions_table true,
-- reviews_table false, skill_row false before; reviews_table and skill_row true after.
SELECT
  to_regclass('public.student_document_versions') IS NOT NULL AS versions_table,
  to_regclass('public.resume_reviews')            IS NOT NULL AS reviews_table,
  EXISTS (SELECT 1 FROM public.keith_skills WHERE slug = 'review-resume') AS skill_row;

-- POST 1: server-only, never deleted. Expect rls true, policies 0, service_delete false,
-- anon_select false, authenticated_select false.
SELECT c.relrowsecurity AS rls,
  (SELECT COUNT(*) FROM pg_policies p WHERE p.tablename = 'resume_reviews') AS policies,
  has_table_privilege('service_role', c.oid, 'DELETE') AS service_delete,
  has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
  has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select
FROM pg_class c WHERE c.oid = 'public.resume_reviews'::regclass;

-- POST 2: the skill. Expect review-resume, draft, false, on, quality, {owner,admin},
-- {student_resume_read}, residency_documents, starts_right true.
SELECT slug, status, enabled, run_mode, model_route, allowed_roles, required_data,
  io_contract->>'surface' AS surface,
  left(instruction_body, 38) = 'You review ONE résumé from a senior nu' AS starts_right
FROM public.keith_skills WHERE slug = 'review-resume';

-- AFTER ACTIVATING (Settings > Keith > Skills > Review Résumé > Activate > Enable).
-- Expect active, true.
SELECT status, enabled FROM public.keith_skills WHERE slug = 'review-resume';
