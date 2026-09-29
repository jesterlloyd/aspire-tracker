-- db/audit/keith_placement_suggestions_checks.sql
-- KEITH-PLACEMENT-1, 2026-09-29. Read-only. PRE before
-- supabase/migrations/20261018000000_keith_placement_suggestions.sql, POST after, one section at a time.

-- ── PRE 1. What the migration needs is there, and what it adds is not ────────────
SELECT
  to_regclass('public.keith_provenance') IS NOT NULL AS keith_provenance,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'keith_skills' AND column_name = 'run_mode') AS run_mode,
  to_regprocedure('public.append_only_refuse()') IS NOT NULL AS append_only_refuse,
  to_regclass('public.placement_suggestions') IS NULL AS suggestions_absent,
  NOT EXISTS (SELECT 1 FROM public.keith_skills WHERE slug = 'explain-placement') AS skill_absent,
  to_regclass('public.preceptors') IS NOT NULL AND to_regclass('public.units') IS NOT NULL AND to_regclass('public.students') IS NOT NULL AS referenced_tables;
-- EXPECT: one row, all six true.

-- ── PRE 2. What Keith will have to work with (read-only) ─────────────────────────
SELECT
  (SELECT count(*) FROM public.preceptors WHERE is_active IS NOT FALSE AND unit_id IS NOT NULL) AS active_preceptors_on_a_unit,
  (SELECT count(*) FROM public.preceptors WHERE is_active IS NOT FALSE AND unit_id IS NULL) AS active_preceptors_without_a_unit,
  (SELECT count(*) FROM public.students WHERE status = 'Interviewed' AND matched_unit_id IS NULL AND is_demo IS NOT TRUE) AS students_ready_to_suggest;
-- EXPECT: numbers, for the record. A unit with no active preceptor on it can never be suggested
--         (the preceptor rule), so active_preceptors_without_a_unit is worth a look.

-- ── POST 1. The two tables, locked to the service role ───────────────────────────
SELECT c.relname, c.relrowsecurity AS rls,
  (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies,
  has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select,
  has_table_privilege('service_role', c.oid, 'INSERT') AS svc_insert,
  has_table_privilege('service_role', c.oid, 'DELETE') AS svc_delete
FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('placement_suggestion_runs', 'placement_suggestions') ORDER BY 1;
-- EXPECT: 2 rows: rls true, policies 0, auth_select false, svc_insert true, svc_delete false.

-- ── POST 2. The skill: draft, disabled, in shadow, kept out of chat ──────────────
SELECT slug, status, enabled, run_mode, model_route, io_contract->>'surface' AS surface, left(instruction_body, 60) AS starts
FROM public.keith_skills WHERE slug = 'explain-placement';
-- EXPECT: explain-placement, draft, false, shadow, default, placement_board,
--         "You compare ONE nursing student with ONE hospital unit and O".
-- Then, in Settings > Keith > Skills: Activate, then Enable. It stays in Shadow: every hour Keith
-- computes suggestions quietly and the board shows only the comparison.
