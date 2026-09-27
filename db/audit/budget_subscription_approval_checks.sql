-- db/audit/budget_subscription_approval_checks.sql
--
-- SUB-APPROVAL-1. Read-only. Run ONE numbered section at a time.
--   POST 1  after supabase/migrations/20261010000000_budget_subscription_approval.sql
--   SEED 1  after db/migrations/seed_program_budget_subscriptions_proposed.sql

-- ── POST 1: the three columns exist (expect 3 rows: approval_state default approved, approved_at, post_from) ──
SELECT column_name, data_type, column_default FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'budget_subscriptions' AND column_name IN ('approval_state', 'approved_at', 'post_from')
ORDER BY column_name;

-- ── SEED 1: the five proposals, and no charge posted for any of them (expect 5 rows, charges 0) ──
SELECT s.name, s.billing, s.amount, s.anchor_date, s.start_date, s.end_date, s.payment_method, s.approval_state,
  (SELECT count(*) FROM public.budget_expenses e WHERE e.subscription_id = s.id) AS charges
FROM public.budget_subscriptions s WHERE s.program = 'ASPIRE' AND s.deleted_at IS NULL ORDER BY s.created_at;
