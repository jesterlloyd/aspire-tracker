-- BUDGET-FIXES-1 section 1 (numbers that disagree), 2026-09-29. OWNER-GATED: do not apply from a session.
--
-- Reference: budget-v2-fixes-prompt.md, items 1.1 and 1.2, with the Owner's answers of 2026-09-29.
--
--   1. budget_subscriptions.amount_pinned  An Amount the Owner typed by hand on a usage-based plan.
--                                          A pinned Amount is not moved by the receipts' average.
--   2. budget_events                       + kinds 'receipt_amount' and 'estimate_updated', so Budget
--                                          History shows both changes.
--   3. The correction. Every posted charge of a usage-based plan (Supabase Pro today) that already has
--      its receipt attached takes that receipt's total, which is what the app now does on attach.
--      Each change is logged in budget_changes and as a Budget History line.
--   4. Each usage-based plan that is not pinned takes the average of its last three receipted charges
--      (fewer if fewer exist) as its Amount, logged the same way, and its Expected rows follow.
--
-- Run section 1 of db/audit/budget_fixes_s1_checks.sql FIRST (read-only): it lists every row this
-- changes, with the old and new amounts and Spent before and after.
--
-- One transaction, no temporary tables (the SQL editor dropped them between statements on the first
-- try, 2026-09-29), safe to re-run: a row already at its receipt's total, or a plan already at its
-- average, is left alone. Either deploy order: before it runs the app still sets the amount on
-- attach, but cannot pin a typed Amount and writes no History line for these changes.
-- Checks: db/audit/budget_fixes_s1_checks.sql. Rollback at the end.

BEGIN;

-- ── 1. Pinned amounts ────────────────────────────────────────────────────────────

ALTER TABLE public.budget_subscriptions ADD COLUMN IF NOT EXISTS amount_pinned boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.budget_subscriptions.amount_pinned IS
  'Usage-based plans: true when the Owner typed the Amount by hand, so the average of the last three receipts does not replace it. Use average sets it back to false.';

-- ── 2. Budget History kinds ──────────────────────────────────────────────────────

ALTER TABLE public.budget_events DROP CONSTRAINT IF EXISTS chk_budget_events_kind;
ALTER TABLE public.budget_events
  ADD CONSTRAINT chk_budget_events_kind CHECK (kind IN ('budget_set', 'budget_changed', 'year_started', 'plan_saved', 'reconciled', 'month_closed', 'month_reopened',
    'late_receipt', 'proposal_requested', 'proposal_started', 'plan_submitted', 'plan_approved', 'plan_sent_back', 'plan_moved',
    'amendment_requested', 'amendment_approved', 'amendment_declined', 'receipt_amount', 'estimate_updated'));

-- ── 3. Posted usage-based charges take their receipt's total ─────────────────────
-- The total printed on the receipt, then Keith's reading, then the lines (a credit line is stored as
-- $0, so the lines alone can overstate it). No temporary tables: each statement stands alone, the
-- history is written first from the rows still to change, then the rows change, so a re-run finds
-- nothing left to do.

WITH pending AS (
  SELECT e.id AS expense_id, e.budget_id, s.name, COALESCE(e.charge_date, e.expense_date) AS charge_on, e.amount AS old_amount,
         ROUND(CASE
             WHEN jsonb_typeof(br.draft->'total') = 'number' AND (br.draft->>'total')::numeric > 0 THEN (br.draft->>'total')::numeric
             WHEN jsonb_typeof(br.proposal->'total') = 'number' AND (br.proposal->>'total')::numeric > 0 THEN (br.proposal->>'total')::numeric
             ELSE (SELECT SUM((l->>'amount')::numeric) FROM jsonb_array_elements(COALESCE(br.draft->'lines', '[]'::jsonb)) l)
           END, 2) AS new_amount
  FROM public.budget_receipts br
  JOIN public.budget_expenses e ON e.receipt_file_id = br.record_document_id
  JOIN public.budget_subscriptions s ON s.id = e.subscription_id
  WHERE br.status = 'accepted' AND br.attached AND br.record_document_id IS NOT NULL
    AND s.billing = 'usage' AND e.deleted_at IS NULL AND e.state = 'posted'
), todo AS (SELECT * FROM pending WHERE new_amount > 0 AND new_amount <> old_amount)
INSERT INTO public.budget_changes (entity, entity_id, budget_id, action, field, old_value, new_value, actor_name)
SELECT 'expense', expense_id, budget_id, 'update', 'amount', to_jsonb(old_amount), to_jsonb(new_amount), '' FROM todo;

WITH pending AS (
  SELECT e.id AS expense_id, e.budget_id, s.name, COALESCE(e.charge_date, e.expense_date) AS charge_on, e.amount AS old_amount,
         ROUND(CASE
             WHEN jsonb_typeof(br.draft->'total') = 'number' AND (br.draft->>'total')::numeric > 0 THEN (br.draft->>'total')::numeric
             WHEN jsonb_typeof(br.proposal->'total') = 'number' AND (br.proposal->>'total')::numeric > 0 THEN (br.proposal->>'total')::numeric
             ELSE (SELECT SUM((l->>'amount')::numeric) FROM jsonb_array_elements(COALESCE(br.draft->'lines', '[]'::jsonb)) l)
           END, 2) AS new_amount
  FROM public.budget_receipts br
  JOIN public.budget_expenses e ON e.receipt_file_id = br.record_document_id
  JOIN public.budget_subscriptions s ON s.id = e.subscription_id
  WHERE br.status = 'accepted' AND br.attached AND br.record_document_id IS NOT NULL
    AND s.billing = 'usage' AND e.deleted_at IS NULL AND e.state = 'posted'
), todo AS (SELECT * FROM pending WHERE new_amount > 0 AND new_amount <> old_amount)
INSERT INTO public.budget_events (budget_id, kind, message, old_value, new_value, actor_name)
SELECT budget_id, 'receipt_amount',
       format('%s charge on %s set to %s from its receipt (was %s est.).', name, to_char(charge_on, 'Mon FMDD, YYYY'),
              to_char(new_amount, 'FM$999,990.00'), to_char(old_amount, 'FM$999,990.00')),
       jsonb_build_object('amount', old_amount, 'expense', expense_id), jsonb_build_object('amount', new_amount, 'expense', expense_id), ''
FROM todo;

WITH pending AS (
  SELECT e.id AS expense_id, e.budget_id, s.name, COALESCE(e.charge_date, e.expense_date) AS charge_on, e.amount AS old_amount,
         ROUND(CASE
             WHEN jsonb_typeof(br.draft->'total') = 'number' AND (br.draft->>'total')::numeric > 0 THEN (br.draft->>'total')::numeric
             WHEN jsonb_typeof(br.proposal->'total') = 'number' AND (br.proposal->>'total')::numeric > 0 THEN (br.proposal->>'total')::numeric
             ELSE (SELECT SUM((l->>'amount')::numeric) FROM jsonb_array_elements(COALESCE(br.draft->'lines', '[]'::jsonb)) l)
           END, 2) AS new_amount
  FROM public.budget_receipts br
  JOIN public.budget_expenses e ON e.receipt_file_id = br.record_document_id
  JOIN public.budget_subscriptions s ON s.id = e.subscription_id
  WHERE br.status = 'accepted' AND br.attached AND br.record_document_id IS NOT NULL
    AND s.billing = 'usage' AND e.deleted_at IS NULL AND e.state = 'posted'
), todo AS (SELECT * FROM pending WHERE new_amount > 0 AND new_amount <> old_amount)
UPDATE public.budget_expenses e SET amount = t.new_amount, quantity = 1, updated_at = now()
FROM todo t WHERE e.id = t.expense_id;

-- ── 4. Each usage-based plan's estimate: the average of its last three receipts ──

WITH last3 AS (
  SELECT e.subscription_id, e.amount,
         ROW_NUMBER() OVER (PARTITION BY e.subscription_id ORDER BY COALESCE(e.charge_date, e.expense_date) DESC) AS n
  FROM public.budget_expenses e
  WHERE e.receipt_file_id IS NOT NULL AND e.deleted_at IS NULL AND e.status <> 'void' AND e.state <> 'expected'
), avg3 AS (
  SELECT s.id AS subscription_id, s.name, s.amount AS old_amount, ROUND(AVG(l.amount), 2) AS new_amount, COUNT(*) AS receipts,
         string_agg(to_char(l.amount, 'FM$999,990.00'), ', ' ORDER BY l.n) AS amounts
  FROM public.budget_subscriptions s
  JOIN last3 l ON l.subscription_id = s.id AND l.n <= 3
  WHERE s.billing = 'usage' AND s.deleted_at IS NULL AND NOT s.amount_pinned
  GROUP BY s.id, s.name, s.amount
), todo AS (SELECT * FROM avg3 WHERE new_amount <> old_amount)
INSERT INTO public.budget_changes (entity, entity_id, budget_id, action, field, old_value, new_value, actor_name)
SELECT 'subscription', subscription_id, NULL, 'update', 'amount', to_jsonb(old_amount), to_jsonb(new_amount), '' FROM todo;

WITH last3 AS (
  SELECT e.subscription_id, e.amount,
         ROW_NUMBER() OVER (PARTITION BY e.subscription_id ORDER BY COALESCE(e.charge_date, e.expense_date) DESC) AS n
  FROM public.budget_expenses e
  WHERE e.receipt_file_id IS NOT NULL AND e.deleted_at IS NULL AND e.status <> 'void' AND e.state <> 'expected'
), avg3 AS (
  SELECT s.id AS subscription_id, s.name, s.amount AS old_amount, ROUND(AVG(l.amount), 2) AS new_amount, COUNT(*) AS receipts,
         string_agg(to_char(l.amount, 'FM$999,990.00'), ', ' ORDER BY l.n) AS amounts
  FROM public.budget_subscriptions s
  JOIN last3 l ON l.subscription_id = s.id AND l.n <= 3
  WHERE s.billing = 'usage' AND s.deleted_at IS NULL AND NOT s.amount_pinned
  GROUP BY s.id, s.name, s.amount
), todo AS (SELECT * FROM avg3 WHERE new_amount <> old_amount)
INSERT INTO public.budget_events (budget_id, kind, message, old_value, new_value, actor_name)
SELECT bu.id, 'estimate_updated',
       format('%s estimate set to %s a month from %s, %s.', t.name, to_char(t.new_amount, 'FM$999,990.00'), to_char(t.old_amount, 'FM$999,990.00'),
              CASE WHEN t.receipts = 1 THEN 'its last receipt' ELSE format('the average of its last %s receipts (%s)', t.receipts, t.amounts) END),
       jsonb_build_object('amount', t.old_amount), jsonb_build_object('amount', t.new_amount), ''
FROM todo t
JOIN public.budgets bu ON bu.program = 'ASPIRE'
  AND bu.fiscal_year = EXTRACT(YEAR FROM ((now() AT TIME ZONE 'America/Los_Angeles')::date + INTERVAL '6 months'))::int;

WITH last3 AS (
  SELECT e.subscription_id, e.amount,
         ROW_NUMBER() OVER (PARTITION BY e.subscription_id ORDER BY COALESCE(e.charge_date, e.expense_date) DESC) AS n
  FROM public.budget_expenses e
  WHERE e.receipt_file_id IS NOT NULL AND e.deleted_at IS NULL AND e.status <> 'void' AND e.state <> 'expected'
), avg3 AS (
  SELECT s.id AS subscription_id, s.name, s.amount AS old_amount, ROUND(AVG(l.amount), 2) AS new_amount, COUNT(*) AS receipts,
         string_agg(to_char(l.amount, 'FM$999,990.00'), ', ' ORDER BY l.n) AS amounts
  FROM public.budget_subscriptions s
  JOIN last3 l ON l.subscription_id = s.id AND l.n <= 3
  WHERE s.billing = 'usage' AND s.deleted_at IS NULL AND NOT s.amount_pinned
  GROUP BY s.id, s.name, s.amount
), todo AS (SELECT * FROM avg3 WHERE new_amount <> old_amount)
UPDATE public.budget_subscriptions s SET amount = t.new_amount, updated_at = now()
FROM todo t WHERE s.id = t.subscription_id;

-- Expected charges still to come follow the plan, as the app's daily run would.
UPDATE public.budget_expenses e SET amount = s.amount, updated_at = now()
FROM public.budget_subscriptions s
WHERE e.subscription_id = s.id AND s.billing = 'usage' AND s.deleted_at IS NULL
  AND e.state = 'expected' AND e.receipt_file_id IS NULL AND e.deleted_at IS NULL AND e.amount <> s.amount;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Rollback (the corrected amounts stay: they are what the receipts say; put one back in the Sheet):
--   BEGIN;
--   ALTER TABLE public.budget_events DROP CONSTRAINT IF EXISTS chk_budget_events_kind;
--   ALTER TABLE public.budget_events ADD CONSTRAINT chk_budget_events_kind CHECK (kind IN ('budget_set', 'budget_changed', 'year_started', 'plan_saved', 'reconciled', 'month_closed', 'month_reopened',
--     'late_receipt', 'proposal_requested', 'proposal_started', 'plan_submitted', 'plan_approved', 'plan_sent_back', 'plan_moved',
--     'amendment_requested', 'amendment_approved', 'amendment_declined'));
--   ALTER TABLE public.budget_subscriptions DROP COLUMN IF EXISTS amount_pinned;
--   COMMIT;
-- (The kind list cannot drop 'receipt_amount' or 'estimate_updated' once a row uses them: budget_events
-- is append-only. Keep them in the list if any exist.)
