-- BUDGET-V2 Phase 2 (the monthly cycle), 2026-09-29. OWNER-GATED: do not apply from a session.
--
-- Reference: docs/mockups/program-budget-v2.html, items 11, 12 and 13.
--
--   1. budget_expenses.state  'expected' | 'posted'. An approved subscription's upcoming charges are
--                             Expected rows through June 30: they count toward committed, never
--                             toward Spent. On its date the row becomes Posted. Every existing row
--                             is Posted.
--   2. budget_months          one row per month the owner has closed: when, by whom, and the note
--                             leadership sees. A closed month's rows are locked until it is reopened.
--   3. budget_events          + kinds 'month_closed' and 'month_reopened', in Budget history.
--
-- Additive, one transaction, safe to re-run. Either deploy order: before it runs, the Sheet has no
-- Expected rows and the Close card says its update has not been applied.
-- Checks: db/audit/budget_v2_phase2_checks.sql. Rollback at the end of this file.

BEGIN;

-- ── 1. Expected and posted ───────────────────────────────────────────────────────

ALTER TABLE public.budget_expenses
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'posted';
ALTER TABLE public.budget_expenses DROP CONSTRAINT IF EXISTS chk_budget_expenses_state;
ALTER TABLE public.budget_expenses
  ADD CONSTRAINT chk_budget_expenses_state CHECK (state IN ('expected', 'posted') AND (state = 'posted' OR subscription_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_budget_expenses_expected ON public.budget_expenses (subscription_id, charge_date) WHERE state = 'expected';

-- ── 2. Closed months ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.budget_months (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES public.organizations(id) ON DELETE CASCADE,
  budget_id    uuid        NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  month        date        NOT NULL,
  closed_at    timestamptz,
  closed_by    uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  note         text        NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_budget_months UNIQUE (budget_id, month),
  CONSTRAINT chk_budget_months_first CHECK (EXTRACT(DAY FROM month) = 1),
  CONSTRAINT chk_budget_months_note CHECK (length(note) <= 2000)
);
ALTER TABLE public.budget_months ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.budget_months FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_months TO service_role;

-- ── 3. Budget history ────────────────────────────────────────────────────────────

ALTER TABLE public.budget_events DROP CONSTRAINT IF EXISTS chk_budget_events_kind;
ALTER TABLE public.budget_events
  ADD CONSTRAINT chk_budget_events_kind CHECK (kind IN ('budget_set', 'budget_changed', 'year_started', 'plan_saved', 'reconciled', 'month_closed', 'month_reopened'));

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Rollback (Expected rows are projections; they are removed first so no row is left unexplained):
--   BEGIN;
--   DELETE FROM public.budget_expenses WHERE state = 'expected' AND receipt_file_id IS NULL;
--   UPDATE public.budget_expenses SET state = 'posted' WHERE state = 'expected';
--   ALTER TABLE public.budget_events DROP CONSTRAINT IF EXISTS chk_budget_events_kind;
--   ALTER TABLE public.budget_events ADD CONSTRAINT chk_budget_events_kind CHECK (kind IN ('budget_set', 'budget_changed', 'year_started', 'plan_saved', 'reconciled'));
--   DROP TABLE IF EXISTS public.budget_months;
--   DROP INDEX IF EXISTS public.idx_budget_expenses_expected;
--   ALTER TABLE public.budget_expenses DROP CONSTRAINT IF EXISTS chk_budget_expenses_state;
--   ALTER TABLE public.budget_expenses DROP COLUMN IF EXISTS state;
--   COMMIT;
-- (The rollback cannot remove month_closed events: budget_events is append-only. Put the kind list
--  back only after confirming none exist.)
