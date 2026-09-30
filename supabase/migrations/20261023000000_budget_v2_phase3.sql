-- BUDGET-V2 Phase 3 (the plan stage), 2026-09-29. OWNER-GATED: do not apply from a session.
--
-- Reference: docs/mockups/program-budget-v2.html, items 14, 15 and 16. Owner decisions: Margo approves
-- CATEGORY totals; the owner may move money between categories without asking up to a limit (10% of
-- the receiving category's approved total, capped at $500 per move, both settings); Margo's approval
-- sits alongside Cedars-Sinai's official budget process (the app records it and exports a PDF); she
-- approves through a new budget_access level, 'approve', granted in Accounts & Access.
--
--   1. budget_plans            one version of a year's plan: draft, submitted, approved or sent back,
--                              the "Why this budget" note, and Margo's comment. Versions are kept.
--   2. budget_plan_items       the planned items: name, quantity x unit cost, a reason, a tag.
--   3. budget_plan_categories  per category: requested (frozen at submit) and approved (Margo's).
--   4. budget_plan_moves       a move between categories inside the owner's limit, logged.
--   5. budget_amendments       an amendment the owner asks Margo for, and her decision.
--   6. budget_settings         + move_limit_pct, move_limit_cap.
--   7. budget_receipts         + held_amendment_id: a receipt waits for Margo's amendment.
--   8. user_role_grants        budget_access + 'approve' (view, and decide plans and amendments).
--   9. budget_events           + the plan stage's kinds, and 'late_receipt'.
--
-- Additive, one transaction, safe to re-run. Either deploy order: before it runs, the Plan tab says
-- its update has not been applied and everything else works as it did.
-- Checks: db/audit/budget_v2_phase3_checks.sql. Rollback at the end of this file.

BEGIN;

-- ── 1-3. Plans, items, category totals ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.budget_plans (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES public.organizations(id) ON DELETE CASCADE,
  budget_id     uuid        NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  version       integer     NOT NULL,
  status        text        NOT NULL DEFAULT 'draft',
  note          text        NOT NULL DEFAULT '',
  comment       text        NOT NULL DEFAULT '',
  submitted_at  timestamptz,
  submitted_by  uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  decided_by    uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_budget_plans_version UNIQUE (budget_id, version),
  CONSTRAINT chk_budget_plans_status CHECK (status IN ('draft', 'submitted', 'approved', 'sent_back')),
  CONSTRAINT chk_budget_plans_text CHECK (length(note) <= 4000 AND length(comment) <= 2000)
);
CREATE INDEX IF NOT EXISTS idx_budget_plans_budget ON public.budget_plans (budget_id, version DESC);

CREATE TABLE IF NOT EXISTS public.budget_plan_items (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id        uuid        NOT NULL REFERENCES public.budget_plans(id) ON DELETE CASCADE,
  category_id    uuid        NOT NULL REFERENCES public.budget_categories(id),
  name           text        NOT NULL DEFAULT '',
  quantity       numeric(12,2) NOT NULL DEFAULT 1,
  unit_cost      numeric(12,2) NOT NULL DEFAULT 0,
  reason         text        NOT NULL DEFAULT '',
  tag            text,
  provenance_id  uuid,
  sort_order     integer     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_budget_plan_items CHECK (quantity >= 0 AND unit_cost >= 0 AND length(name) <= 200 AND length(reason) <= 500 AND (tag IS NULL OR tag = 'platform'))
);
CREATE INDEX IF NOT EXISTS idx_budget_plan_items_plan ON public.budget_plan_items (plan_id, sort_order);

CREATE TABLE IF NOT EXISTS public.budget_plan_categories (
  plan_id      uuid          NOT NULL REFERENCES public.budget_plans(id) ON DELETE CASCADE,
  category_id  uuid          NOT NULL REFERENCES public.budget_categories(id),
  requested    numeric(12,2) NOT NULL DEFAULT 0,
  approved     numeric(12,2),
  PRIMARY KEY (plan_id, category_id),
  CONSTRAINT chk_budget_plan_categories CHECK (requested >= 0 AND (approved IS NULL OR approved >= 0))
);

-- ── 4-5. Moves and amendments ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.budget_plan_moves (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id           uuid          NOT NULL REFERENCES public.budget_plans(id) ON DELETE CASCADE,
  from_category_id  uuid          NOT NULL REFERENCES public.budget_categories(id),
  to_category_id    uuid          NOT NULL REFERENCES public.budget_categories(id),
  amount            numeric(12,2) NOT NULL,
  reason            text          NOT NULL DEFAULT '',
  expense_id        uuid          REFERENCES public.budget_expenses(id) ON DELETE SET NULL,
  receipt_id        uuid          REFERENCES public.budget_receipts(id) ON DELETE SET NULL,
  created_by        uuid          REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT chk_budget_plan_moves CHECK (amount > 0 AND from_category_id <> to_category_id)
);

CREATE TABLE IF NOT EXISTS public.budget_amendments (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       uuid          NOT NULL REFERENCES public.budget_plans(id) ON DELETE CASCADE,
  category_id   uuid          NOT NULL REFERENCES public.budget_categories(id),
  amount        numeric(12,2) NOT NULL,
  reason        text          NOT NULL DEFAULT '',
  expense_id    uuid          REFERENCES public.budget_expenses(id) ON DELETE SET NULL,
  receipt_id    uuid          REFERENCES public.budget_receipts(id) ON DELETE SET NULL,
  status        text          NOT NULL DEFAULT 'pending',
  comment       text          NOT NULL DEFAULT '',
  requested_by  uuid          REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  requested_at  timestamptz   NOT NULL DEFAULT now(),
  decided_by    uuid          REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  CONSTRAINT chk_budget_amendments CHECK (amount > 0 AND status IN ('pending', 'approved', 'declined') AND length(comment) <= 2000)
);
CREATE INDEX IF NOT EXISTS idx_budget_amendments_plan ON public.budget_amendments (plan_id, status);

-- ── 6. The owner's move limit ────────────────────────────────────────────────────

ALTER TABLE public.budget_settings
  ADD COLUMN IF NOT EXISTS move_limit_pct numeric(5,2) NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS move_limit_cap numeric(12,2) NOT NULL DEFAULT 500;
ALTER TABLE public.budget_settings DROP CONSTRAINT IF EXISTS chk_budget_settings_limits;
ALTER TABLE public.budget_settings
  ADD CONSTRAINT chk_budget_settings_limits CHECK (move_limit_pct BETWEEN 0 AND 100 AND move_limit_cap >= 0);

-- ── 7. A receipt waiting for an amendment ────────────────────────────────────────

ALTER TABLE public.budget_receipts
  ADD COLUMN IF NOT EXISTS held_amendment_id uuid REFERENCES public.budget_amendments(id) ON DELETE SET NULL;
ALTER TABLE public.budget_receipts DROP CONSTRAINT IF EXISTS chk_budget_receipts_held;
ALTER TABLE public.budget_receipts
  ADD CONSTRAINT chk_budget_receipts_held CHECK (status <> 'held' OR (held_subscription_id IS NOT NULL AND held_charge_date IS NOT NULL) OR held_amendment_id IS NOT NULL);

-- ── 8. Margo's level ─────────────────────────────────────────────────────────────

ALTER TABLE public.user_role_grants
  DROP CONSTRAINT IF EXISTS user_role_grants_budget_access_check;
ALTER TABLE public.user_role_grants
  ADD CONSTRAINT user_role_grants_budget_access_check
  CHECK (budget_access IN ('none', 'view', 'approve') AND (role = 'nursing_academic' OR budget_access = 'none'));
COMMENT ON COLUMN public.user_role_grants.budget_access IS
  'Nursing Education & Leadership Program Budget tab: none, view or approve. View is read-only. Approve is view, plus deciding a submitted plan and the owner''s amendment requests. Never receipts or drafts.';

-- ── 9. Budget history ────────────────────────────────────────────────────────────

ALTER TABLE public.budget_events DROP CONSTRAINT IF EXISTS chk_budget_events_kind;
ALTER TABLE public.budget_events
  ADD CONSTRAINT chk_budget_events_kind CHECK (kind IN ('budget_set', 'budget_changed', 'year_started', 'plan_saved', 'reconciled', 'month_closed', 'month_reopened',
    'late_receipt', 'proposal_requested', 'proposal_started', 'plan_submitted', 'plan_approved', 'plan_sent_back', 'plan_moved',
    'amendment_requested', 'amendment_approved', 'amendment_declined'));

-- ── RLS on, no browser access ────────────────────────────────────────────────────

DO $p3$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['budget_plans', 'budget_plan_items', 'budget_plan_categories', 'budget_plan_moves', 'budget_amendments'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
  END LOOP;
END
$p3$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Rollback (loses every plan, move and amendment; set any 'approve' grant back to 'view' first):
--   BEGIN;
--   UPDATE public.user_role_grants SET budget_access = 'view' WHERE budget_access = 'approve';
--   ALTER TABLE public.user_role_grants DROP CONSTRAINT IF EXISTS user_role_grants_budget_access_check;
--   ALTER TABLE public.user_role_grants ADD CONSTRAINT user_role_grants_budget_access_check
--     CHECK (budget_access IN ('none', 'view') AND (role = 'nursing_academic' OR budget_access = 'none'));
--   UPDATE public.budget_receipts SET status = 'review' WHERE status = 'held' AND held_subscription_id IS NULL;
--   ALTER TABLE public.budget_receipts DROP CONSTRAINT IF EXISTS chk_budget_receipts_held;
--   ALTER TABLE public.budget_receipts ADD CONSTRAINT chk_budget_receipts_held CHECK (status <> 'held' OR (held_subscription_id IS NOT NULL AND held_charge_date IS NOT NULL));
--   ALTER TABLE public.budget_receipts DROP COLUMN IF EXISTS held_amendment_id;
--   ALTER TABLE public.budget_settings DROP CONSTRAINT IF EXISTS chk_budget_settings_limits;
--   ALTER TABLE public.budget_settings DROP COLUMN IF EXISTS move_limit_cap, DROP COLUMN IF EXISTS move_limit_pct;
--   DROP TABLE IF EXISTS public.budget_amendments, public.budget_plan_moves, public.budget_plan_categories, public.budget_plan_items, public.budget_plans;
--   COMMIT;
-- (budget_events is append-only: the wider kind list stays while any plan event exists.)
