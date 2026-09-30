-- BUDGET-FIXES-1 section 1 checks, for supabase/migrations/20261025000000_budget_fixes_s1.sql.
-- Run one section at a time. Section 1 is read-only and runs BEFORE the migration.

-- ── 1. PREVIEW (before): what the correction will change, and Spent before and after ──
-- One row per usage-based charge whose attached receipt says something different, then the plan's
-- new estimate, then FY27 Spent now and after.
WITH rows AS (
  SELECT s.name, COALESCE(e.charge_date, e.expense_date) AS charge_on, e.amount AS now_amount,
         ROUND((SELECT SUM((l->>'amount')::numeric) FROM jsonb_array_elements(COALESCE(br.draft->'lines', '[]'::jsonb)) l), 2) AS receipt_total,
         e.budget_id
  FROM public.budget_receipts br
  JOIN public.budget_expenses e ON e.receipt_file_id = br.record_document_id
  JOIN public.budget_subscriptions s ON s.id = e.subscription_id
  WHERE br.status = 'accepted' AND br.attached AND s.billing = 'usage' AND e.deleted_at IS NULL AND e.state = 'posted'
), fy27 AS (SELECT id FROM public.budgets WHERE program = 'ASPIRE' AND fiscal_year = 2027),
spent AS (
  SELECT SUM(amount) AS now_spent FROM public.budget_expenses
  WHERE budget_id = (SELECT id FROM fy27) AND deleted_at IS NULL AND status <> 'void' AND state <> 'expected'
)
SELECT 'row' AS what, name, charge_on::text AS on_date, now_amount, receipt_total AS new_amount FROM rows
UNION ALL
SELECT 'fy27 spent', 'now', NULL, (SELECT now_spent FROM spent), NULL
UNION ALL
SELECT 'fy27 spent', 'after', NULL, NULL,
       (SELECT now_spent FROM spent) + COALESCE((SELECT SUM(receipt_total - now_amount) FROM rows WHERE budget_id = (SELECT id FROM fy27) AND receipt_total > 0), 0)
ORDER BY what, on_date;
-- Expect: three Supabase Pro rows (Jul 29, Aug 29, Sep 29) at 17.50 now, and each receipt's total.
-- The Owner's figures were 28.52, 35.00 and 35.00; FY27 Spent 492.52 now, about 538.54 after.

-- ── 2. PREVIEW (before): the receipt count by fiscal year, and any with no date ──
SELECT CASE WHEN COALESCE(draft->>'date', proposal->>'date', '') = '' THEN 'no date'
            ELSE 'FY' || RIGHT((EXTRACT(YEAR FROM (COALESCE(draft->>'date', proposal->>'date'))::date + INTERVAL '6 months'))::int::text, 2) END AS fiscal_year,
       COUNT(*) AS filed
FROM public.budget_receipts WHERE status = 'accepted'
GROUP BY 1 ORDER BY 1;
-- Expect: FY26 15 and FY27 12 (27 in all). Any 'no date' row is counted in no year; say so.

-- ── 3. After: the column, the kinds, and the corrected rows ─────────────────────
SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'budget_subscriptions' AND column_name = 'amount_pinned') AS pinned_column,
  (SELECT pg_get_constraintdef(oid) LIKE '%estimate_updated%' FROM pg_constraint WHERE conname = 'chk_budget_events_kind') AS kinds_ok,
  (SELECT amount FROM public.budget_subscriptions WHERE program = 'ASPIRE' AND name = 'Supabase Pro' AND deleted_at IS NULL LIMIT 1) AS supabase_estimate,
  (SELECT SUM(amount) FROM public.budget_expenses WHERE budget_id = (SELECT id FROM public.budgets WHERE program = 'ASPIRE' AND fiscal_year = 2027)
     AND deleted_at IS NULL AND status <> 'void' AND state <> 'expected') AS fy27_spent;
-- Expect: 1, true, about 32.84, and the "after" figure from section 1.

-- ── 4. After: the Budget History lines it wrote ──────────────────────────────────
SELECT kind, message, created_at FROM public.budget_events
WHERE kind IN ('receipt_amount', 'estimate_updated') ORDER BY created_at, message;
-- Expect: one receipt_amount line per row in section 1, and one estimate_updated line for Supabase Pro.
