-- db/audit/program_budget_phase_a_checks.sql
--
-- PROGRAM-BUDGET Phase A. Read-only. Run ONE numbered section at a time in the Supabase SQL
-- editor and send back its output.
--
--   PRE 1-2   before  supabase/migrations/20261009000000_program_budget_phase_a.sql
--   POST 1-5  after it
--   SEED 1-3  after   db/migrations/seed_program_budget_fy26.sql

-- ── PRE 1: what the migration needs is present (expect four true) ────────────────────
SELECT
  to_regclass('public.organizations') IS NOT NULL                                   AS organizations,
  to_regclass('public.cohorts') IS NOT NULL                                         AS cohorts,
  to_regclass('public.user_role_grants') IS NOT NULL                                AS user_role_grants,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'append_only_refuse')               AS append_only_refuse;

-- ── PRE 2: nothing of it exists yet (expect zero rows) ───────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('budget_categories', 'budgets', 'budget_allocations', 'budget_events',
  'budget_subscriptions', 'budget_expenses', 'budget_changes', 'budget_sheet_views')
UNION ALL
SELECT 'user_role_grants.budget_access' FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'user_role_grants' AND column_name = 'budget_access';

-- ── POST 1: eight tables, RLS on, no browser policy (expect 8 rows, rls true, policies 0) ──
SELECT c.relname AS table_name, c.relrowsecurity AS rls,
  (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('budget_categories', 'budgets', 'budget_allocations', 'budget_events',
  'budget_subscriptions', 'budget_expenses', 'budget_changes', 'budget_sheet_views')
ORDER BY 1;

-- ── POST 2: anon and authenticated hold nothing; service_role holds CRUD (expect zero rows) ──
SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
  AND table_name IN ('budget_categories', 'budgets', 'budget_allocations', 'budget_events',
    'budget_subscriptions', 'budget_expenses', 'budget_changes', 'budget_sheet_views');

-- ── POST 3: the two history tables are append-only (expect 4 rows) ───────────────────
SELECT event_object_table, trigger_name, action_timing, string_agg(event_manipulation, ', ') AS events
FROM information_schema.triggers
WHERE event_object_schema = 'public' AND event_object_table IN ('budget_events', 'budget_changes')
GROUP BY 1, 2, 3 ORDER BY 1, 2;
SELECT tgrelid::regclass AS table_name, tgname FROM pg_trigger
WHERE tgrelid IN ('public.budget_events'::regclass, 'public.budget_changes'::regclass) AND tgname LIKE '%no_truncate';

-- ── POST 4: the fourteen workbook categories, in order (expect 14 rows) ──────────────
SELECT sort_order, name FROM public.budget_categories WHERE program = 'ASPIRE' ORDER BY sort_order;

-- ── POST 5: every existing grant reads 'none' until the Owner grants the tab (expect one row: none) ──
SELECT budget_access, count(*) FROM public.user_role_grants GROUP BY 1;

-- ── SEED 1: FY26 exists, started, $40,000.00, with its note and one history line ────
SELECT b.fiscal_year, b.total, b.started_at, b.owner_note,
  (SELECT string_agg(e.message, ' | ') FROM public.budget_events e WHERE e.budget_id = b.id) AS history
FROM public.budgets b WHERE b.program = 'ASPIRE' AND b.fiscal_year = 2026;

-- ── SEED 2: ten rows totalling $1,620.44 (expect 10 and 1620.44) ────────────────────
SELECT count(*) AS rows, sum(amount) AS total FROM public.budget_expenses e
JOIN public.budgets b ON b.id = e.budget_id WHERE b.program = 'ASPIRE' AND b.fiscal_year = 2026 AND e.deleted_at IS NULL;

-- ── SEED 3: the rows themselves, as the Sheet will show them ─────────────────────────
SELECT to_char(e.expense_date, 'Mon YYYY') AS month, e.item, c.name AS category, e.vendor, e.order_number, e.quantity, e.amount
FROM public.budget_expenses e JOIN public.budgets b ON b.id = e.budget_id LEFT JOIN public.budget_categories c ON c.id = e.category_id
WHERE b.program = 'ASPIRE' AND b.fiscal_year = 2026 ORDER BY e.expense_date, e.created_at;
