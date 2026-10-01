-- db/audit/keith_knowledge_selfcheck_phase2_checks.sql
-- KEITH-KNOWLEDGE-SELFCHECK-1 Phase 2, 2026-10-01. Read-only. PRE before
-- supabase/migrations/20261029000000_keith_knowledge_selfcheck_phase2.sql, POST after, one section at a time.

-- ── PRE 1. Phase 1 is in, and what this adds is not ──────────────────────────────
SELECT
  to_regclass('public.keith_knowledge_gaps') IS NOT NULL AS phase1_gaps_table,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'knowledge_revisions' AND column_name = 'proposed_by') AS phase1_columns,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'keith_skills' AND column_name = 'run_mode') AS foundation_run_mode,
  to_regclass('public.keith_knowledge_checks') IS NULL AS checks_table_absent,
  NOT EXISTS (SELECT 1 FROM public.keith_skills WHERE slug = 'knowledge-self-check') AS skill_absent;
-- EXPECT: one row, all five true.

-- ── POST 1. The checks table, locked to the service role and never deleted ──────
SELECT c.relrowsecurity AS rls,
  (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'keith_knowledge_checks') AS policies,
  has_table_privilege('anon', 'public.keith_knowledge_checks', 'SELECT') AS anon_select,
  has_table_privilege('authenticated', 'public.keith_knowledge_checks', 'SELECT') AS authenticated_select,
  has_table_privilege('service_role', 'public.keith_knowledge_checks', 'INSERT') AS service_insert,
  has_table_privilege('service_role', 'public.keith_knowledge_checks', 'UPDATE') AS service_update,
  has_table_privilege('service_role', 'public.keith_knowledge_checks', 'DELETE') AS service_delete
FROM pg_class c WHERE c.oid = 'public.keith_knowledge_checks'::regclass;
-- EXPECT: rls true, policies 0, anon_select false, authenticated_select false, service_insert true,
--         service_update true, service_delete false.

-- ── POST 2. The skill, seeded off ────────────────────────────────────────────────
SELECT slug, status, enabled, run_mode, model_route, allowed_roles, required_data,
  io_contract->>'surface' AS surface, left(instruction_body, 60) AS starts
FROM public.keith_skills WHERE slug = 'knowledge-self-check';
-- EXPECT: knowledge-self-check, draft, false, on, quality, {}, {knowledge_center_read}, knowledge_center,
--         "You keep ASPIRE Intelligence's Knowledge Center current. ASP".
-- Then, to let "Check now" run: Settings > Keith > Skills > Knowledge Self-Check > Activate, Enable.
