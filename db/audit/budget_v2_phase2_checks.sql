-- db/audit/budget_v2_phase2_checks.sql
-- BUDGET-V2 Phase 2 (the monthly cycle), 2026-09-29. Read-only. Run AFTER
-- supabase/migrations/20261022000000_budget_v2_phase2.sql, one section at a time.

-- ── 1. The state column, and every existing row Posted ──────────────────────────
SELECT state, count(*) AS rows FROM public.budget_expenses GROUP BY state ORDER BY state;
-- EXPECT: one row, posted, with every expense (none expected until the daily run or an approval).

-- ── 2. The closed-months table, private to the server ───────────────────────────
SELECT c.relrowsecurity AS rls,
       (SELECT count(*) FROM information_schema.role_table_grants g WHERE g.table_schema = 'public' AND g.table_name = 'budget_months' AND g.grantee IN ('anon', 'authenticated')) AS browser_grants,
       (SELECT count(*) FROM public.budget_months) AS months
FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = 'budget_months';
-- EXPECT: rls true, browser_grants 0, months 0.

-- ── 3. The constraints ───────────────────────────────────────────────────────────
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname IN ('chk_budget_expenses_state', 'chk_budget_months_first', 'chk_budget_events_kind')
ORDER BY 1;
-- EXPECT: 3 rows. state is expected or posted, and only a subscription charge may be expected;
--         a month is its first day; the event kinds end with 'month_closed', 'month_reopened'.
