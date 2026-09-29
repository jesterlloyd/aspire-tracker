-- db/audit/budget_v2_phase1_checks.sql
-- BUDGET-V2 Phase 1 (correct numbers), 2026-09-29. Read-only. Run AFTER
-- supabase/migrations/20261021000000_budget_v2_phase1.sql, one section at a time.

-- ── 1. The new columns ───────────────────────────────────────────────────────────
SELECT table_name, column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND (table_name, column_name) IN (
  ('budget_receipts', 'held_subscription_id'), ('budget_receipts', 'held_charge_date'),
  ('budget_settings', 'remembered_cards'), ('budget_subscriptions', 'overlap_kept'))
ORDER BY 1, 2;
-- EXPECT: 4 rows. held_charge_date date YES; held_subscription_id uuid YES;
--         remembered_cards jsonb '[]'::jsonb NO; overlap_kept boolean false NO.

-- ── 2. The constraints ───────────────────────────────────────────────────────────
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname IN ('chk_budget_receipts_status', 'chk_budget_receipts_held', 'chk_budget_settings_cards', 'chk_budget_changes_action')
ORDER BY 1;
-- EXPECT: 4 rows. The status list includes 'held'; held requires both held_ columns; cards is an
--         array of at most 20; the action list ends with 'hold', 'release'.

-- ── 3. Nothing changed for existing rows ─────────────────────────────────────────
SELECT (SELECT count(*) FROM public.budget_receipts WHERE status = 'held') AS held,
       (SELECT count(*) FROM public.budget_subscriptions WHERE overlap_kept) AS kept,
       (SELECT remembered_cards FROM public.budget_settings WHERE program = 'ASPIRE') AS cards;
-- EXPECT: held 0, kept 0, cards [] (or NULL when no settings row exists yet).
