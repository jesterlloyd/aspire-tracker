-- db/audit/budget_v2_phase3_checks.sql
-- BUDGET-V2 Phase 3 (the plan stage), 2026-09-29. Read-only. Run AFTER
-- supabase/migrations/20261023000000_budget_v2_phase3.sql, one section at a time.

-- ── 1. The five new tables, private to the server ───────────────────────────────
SELECT c.relname, c.relrowsecurity AS rls,
       (SELECT count(*) FROM information_schema.role_table_grants g WHERE g.table_schema = 'public' AND g.table_name = c.relname AND g.grantee IN ('anon', 'authenticated')) AS browser_grants
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('budget_plans', 'budget_plan_items', 'budget_plan_categories', 'budget_plan_moves', 'budget_amendments')
ORDER BY 1;
-- EXPECT: 5 rows, rls true, browser_grants 0.

-- ── 2. The move limit, Margo's level, and a receipt waiting for an amendment ─────
SELECT
  (SELECT string_agg(column_name || '=' || column_default, ', ' ORDER BY column_name) FROM information_schema.columns WHERE table_name = 'budget_settings' AND column_name IN ('move_limit_pct', 'move_limit_cap')) AS limits,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'user_role_grants_budget_access_check') AS budget_access,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'budget_receipts' AND column_name = 'held_amendment_id') AS held_amendment;
-- EXPECT: limits move_limit_cap=500, move_limit_pct=10; budget_access lists 'none', 'view', 'approve';
--         held_amendment 1.

-- ── 3. Budget history's kinds, and nothing planned yet ───────────────────────────
SELECT (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'chk_budget_events_kind') AS kinds,
       (SELECT count(*) FROM public.budget_plans) AS plans;
-- EXPECT: the kinds end with 'amendment_approved', 'amendment_declined'; plans 0.
