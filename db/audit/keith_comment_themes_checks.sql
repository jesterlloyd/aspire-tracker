-- db/audit/keith_comment_themes_checks.sql
-- KEITH-THEMES-1, 2026-09-29. Read-only. PRE before
-- supabase/migrations/20261019000000_keith_comment_themes.sql, POST after, one section at a time.

-- ── PRE 1. What the migration needs is there, and what it adds is not ────────────
SELECT
  to_regclass('public.keith_provenance') IS NOT NULL AS keith_provenance,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'keith_skills' AND column_name = 'run_mode') AS run_mode,
  to_regprocedure('public.append_only_refuse()') IS NOT NULL AS append_only_refuse,
  to_regclass('public.comment_theme_versions') IS NULL AND to_regclass('public.comment_themes') IS NULL AND to_regclass('public.evaluation_theme_settings') IS NULL AS tables_absent,
  NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_role_grants' AND column_name = 'evaluation_themes_access') AS grant_column_absent,
  NOT EXISTS (SELECT 1 FROM public.keith_skills WHERE slug = 'theme-comments') AS skill_absent;
-- EXPECT: one row, all six true.

-- ── PRE 2. What Keith will have to read (read-only, counts only) ─────────────────
SELECT i.slug,
  count(r.assignment_id) FILTER (WHERE r.submitted_at IS NOT NULL) AS completed_responses,
  count(r.assignment_id) FILTER (WHERE r.submitted_at IS NOT NULL AND i.slug = 'post_rotation_evaluation'
    AND (r.responses->>'may_use_anonymized_comments') = 'true') AS consented_to_quotes
FROM public.evaluation_instruments i
LEFT JOIN public.evaluation_assignments a ON a.instrument_id = i.id
LEFT JOIN public.evaluation_responses r ON r.assignment_id = a.id
WHERE i.slug IN ('casey_fink_readiness_2024', 'preceptor_progress', 'student_preceptor_eval', 'post_rotation_evaluation')
GROUP BY i.slug ORDER BY i.slug;
-- EXPECT: up to four rows, for the record. consented_to_quotes is 0 everywhere but
--         post_rotation_evaluation: only that form asks, so only its comments are ever quoted to leadership.

-- ── POST 1. The three tables, locked to the service role ─────────────────────────
SELECT c.relname, c.relrowsecurity AS rls,
  (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies,
  has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select,
  has_table_privilege('service_role', c.oid, 'INSERT') AS svc_insert,
  has_table_privilege('service_role', c.oid, 'UPDATE') AS svc_update,
  has_table_privilege('service_role', c.oid, 'DELETE') AS svc_delete
FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
  AND c.relname IN ('comment_theme_versions', 'comment_themes', 'evaluation_theme_settings') ORDER BY 1;
-- EXPECT: 3 rows: rls true, policies 0, auth_select false, svc_insert true, svc_delete false;
--         svc_update false for comment_theme_versions (append-only), true for the other two.

-- ── POST 2. The floor, the grant column, the skill ───────────────────────────────
SELECT
  (SELECT privacy_floor FROM public.evaluation_theme_settings) AS privacy_floor,
  (SELECT count(*) FROM public.user_role_grants WHERE evaluation_themes_access <> 'none') AS grants_sharing_themes,
  s.slug, s.status, s.enabled, s.run_mode, s.model_route, s.allowed_roles, s.io_contract->>'surface' AS surface, left(s.instruction_body, 60) AS starts
FROM public.keith_skills s WHERE s.slug = 'theme-comments';
-- EXPECT: 3, 0, theme-comments, draft, false, shadow, quality, {admin}, evaluation_responses,
--         "You group the open-ended comments from ONE evaluation form, ".
-- Then, in Settings > Keith > Skills: Activate, then Enable. It stays in Shadow: Owner and Admin see
-- the themes on Evaluation > Responses; leadership sees nothing until the Owner chooses
-- "Share with leadership" there. Share the portal's Evaluation tab per person in Accounts & Access.
