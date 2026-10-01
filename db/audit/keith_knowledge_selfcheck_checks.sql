-- db/audit/keith_knowledge_selfcheck_checks.sql
-- KEITH-KNOWLEDGE-SELFCHECK-1 Phase 1, 2026-09-30. Read-only. PRE before
-- supabase/migrations/20261028000000_keith_knowledge_selfcheck.sql, POST after, one section at a time.

-- ── PRE 1. What the migration needs is there, and what it adds is not ────────────
SELECT
  to_regclass('public.organizations') IS NOT NULL AS organizations,
  to_regclass('public.keith_knowledge_gaps') IS NULL AS gaps_table_absent,
  NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
    AND table_name IN ('knowledge_revisions', 'knowledge_entries') AND column_name IN ('proposed_by', 'evidence', 'proposal_evidence')) AS columns_absent;
-- EXPECT: one row, all three true.

-- ── PRE 2. The Knowledge Center as it stands (counts only) ────────────────────────
SELECT
  (SELECT count(*) FROM public.knowledge_entries) AS entries,
  (SELECT count(*) FROM public.knowledge_entries WHERE state = 'active') AS active,
  (SELECT count(*) FROM public.knowledge_revisions) AS pending_revisions;
-- EXPECT: one row, for the record. POST 3 must show the same three numbers.

-- ── POST 1. The gaps table, locked to the service role ───────────────────────────
SELECT c.relrowsecurity AS rls,
  (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'keith_knowledge_gaps') AS policies,
  has_table_privilege('anon', 'public.keith_knowledge_gaps', 'SELECT') AS anon_select,
  has_table_privilege('authenticated', 'public.keith_knowledge_gaps', 'SELECT') AS authenticated_select,
  has_table_privilege('service_role', 'public.keith_knowledge_gaps', 'INSERT') AS service_insert,
  has_table_privilege('service_role', 'public.keith_knowledge_gaps', 'DELETE') AS service_delete
FROM pg_class c WHERE c.oid = 'public.keith_knowledge_gaps'::regclass;
-- EXPECT: rls true, policies 0, anon_select false, authenticated_select false, service_insert true,
--         service_delete true (the 90-day cleanup deletes).

-- ── POST 2. The new columns and their checks ─────────────────────────────────────
SELECT table_name, column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('knowledge_revisions', 'knowledge_entries')
  AND column_name IN ('proposed_by', 'evidence', 'proposal_evidence')
ORDER BY table_name, column_name;
-- EXPECT: four rows. knowledge_entries proposal_evidence jsonb YES; knowledge_entries proposed_by text
--         'person'::text NO; knowledge_revisions evidence jsonb YES; knowledge_revisions proposed_by text
--         'person'::text NO.

-- ── POST 3. Nothing already there changed ────────────────────────────────────────
SELECT
  (SELECT count(*) FROM public.knowledge_entries) AS entries,
  (SELECT count(*) FROM public.knowledge_entries WHERE state = 'active') AS active,
  (SELECT count(*) FROM public.knowledge_revisions) AS pending_revisions,
  (SELECT count(*) FROM public.knowledge_entries WHERE proposed_by <> 'person')
    + (SELECT count(*) FROM public.knowledge_revisions WHERE proposed_by <> 'person') AS not_person;
-- EXPECT: the three numbers from PRE 2, and not_person 0.
