-- BUDGET-V2 Phase 4 (clarity), 2026-09-29. OWNER-GATED: do not apply from a session.
--
-- Reference: docs/mockups/program-budget-v2.html, item 4. A Platform tag on subscriptions and expenses,
-- so the cost of the services that build and run ASPIRE Intelligence (Claude, Supabase, Vercel, Resend)
-- is reported apart from program spend and can be filtered in the Sheet.
--
--   1. budget_subscriptions.tag  NULL or 'platform'.
--   2. budget_expenses.tag       NULL or 'platform'. A subscription's charges carry its tag.
--   3. The Owner's five subscriptions (seed_program_budget_subscriptions_proposed.sql) are tagged
--      Platform, with any charges and Expected rows they have already posted. A row someone has already
--      tagged is left alone.
--
-- Additive, one transaction, safe to re-run. Either deploy order: before it runs, the Tag column and the
-- Platform card are simply not there. Checks: db/audit/budget_v2_phase4_checks.sql. Rollback at the end.

BEGIN;

ALTER TABLE public.budget_subscriptions ADD COLUMN IF NOT EXISTS tag text;
ALTER TABLE public.budget_subscriptions DROP CONSTRAINT IF EXISTS chk_budget_subscriptions_tag;
ALTER TABLE public.budget_subscriptions ADD CONSTRAINT chk_budget_subscriptions_tag CHECK (tag IS NULL OR tag = 'platform');

ALTER TABLE public.budget_expenses ADD COLUMN IF NOT EXISTS tag text;
ALTER TABLE public.budget_expenses DROP CONSTRAINT IF EXISTS chk_budget_expenses_tag;
ALTER TABLE public.budget_expenses ADD CONSTRAINT chk_budget_expenses_tag CHECK (tag IS NULL OR tag = 'platform');

UPDATE public.budget_subscriptions SET tag = 'platform'
WHERE program = 'ASPIRE' AND tag IS NULL
  AND name IN ('Claude Max', 'Supabase Pro', 'Vercel Pro', 'Resend', 'Claude Pro annual purchase');

UPDATE public.budget_expenses e SET tag = 'platform'
FROM public.budget_subscriptions s
WHERE e.subscription_id = s.id AND s.tag = 'platform' AND e.tag IS NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Rollback:
--   BEGIN;
--   ALTER TABLE public.budget_expenses DROP CONSTRAINT IF EXISTS chk_budget_expenses_tag;
--   ALTER TABLE public.budget_expenses DROP COLUMN IF EXISTS tag;
--   ALTER TABLE public.budget_subscriptions DROP CONSTRAINT IF EXISTS chk_budget_subscriptions_tag;
--   ALTER TABLE public.budget_subscriptions DROP COLUMN IF EXISTS tag;
--   COMMIT;
