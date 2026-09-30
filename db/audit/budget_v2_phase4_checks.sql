-- db/audit/budget_v2_phase4_checks.sql
-- BUDGET-V2 Phase 4 (clarity), 2026-09-29. Read-only. Run AFTER
-- supabase/migrations/20261024000000_budget_v2_phase4.sql, one section at a time.

-- ── 1. The Owner's five subscriptions are tagged Platform ────────────────────────
SELECT name, tag FROM public.budget_subscriptions WHERE program = 'ASPIRE' AND deleted_at IS NULL ORDER BY name;
-- EXPECT: Claude Max, Claude Pro annual purchase, Resend, Supabase Pro, Vercel Pro, each platform.

-- ── 2. Their charges carry the tag; nothing else is tagged ───────────────────────
SELECT (e.subscription_id IS NOT NULL) AS subscription_charge, e.tag, count(*) AS rows
FROM public.budget_expenses e WHERE e.deleted_at IS NULL GROUP BY 1, 2 ORDER BY 1, 2;
-- EXPECT: subscription_charge false with tag null (every other row); subscription_charge true with
--         tag platform (any charges posted so far; none if nothing is approved yet).
