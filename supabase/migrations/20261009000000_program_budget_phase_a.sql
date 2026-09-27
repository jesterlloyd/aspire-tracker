-- PROGRAM-BUDGET Phase A (BUDGET-A1), 2026-09-27. OWNER-GATED: do not apply from a session.
--
-- Replaces the ASPIRE budget workbook (BNI_ASPIRE_Program_Budget_Tracker_FY2026.xlsx) with
-- Settings > Program Budget. Reference: docs/mockups/program-budget.html. All additive.
--
--   1. budget_categories      the managed category list (the workbook's 14, seeded here).
--   2. budgets                one per program per fiscal year. A year's state is DERIVED, never
--                             stored: not started until started_at, closed once its June 30 has
--                             passed, current otherwise (the same rule as Overdue elsewhere).
--   3. budget_allocations     the category plan. `amount` is the owner's working draft;
--                             `saved_amount` is what leadership and Admin see, written only
--                             by Save plan.
--   4. budget_events          Budget history: budget set or changed, year started, plan saved.
--                             Append-only.
--   5. budget_subscriptions   recurring charges, tracked once (A9). Not per fiscal year.
--   6. budget_expenses        the ledger (the Sheet). A subscription charge is a row with
--                             subscription_id and charge_date, posted once per date.
--   7. budget_changes         every change to an expense, subscription or allocation, with the
--                             old and new values. Append-only.
--   8. budget_sheet_views     the Sheet's saved layout (order, widths, formats, grouping), per program.
--   9. user_role_grants.budget_access   'none' | 'view': which Nursing Education & Leadership
--                             grants see the Program Budgets tab. Modeled on contacts_access.
--
-- Who: only the Owner (user_profiles.is_owner) writes. Admin and granted leadership read
-- Summary, Sheet and Subscriptions, and Allocations once a plan is saved. Every table has RLS
-- ON and NO browser policy: reads and writes go through /api/budget-staff and
-- /api/portal/academics-budget with the service role, which decide what each caller sees, so
-- a draft allocation can never reach an Admin or leadership through a direct table read.
--
-- The app runs on both sides of this migration: a missing table reads as "Program Budget is
-- not enabled yet". The FY26 rows are a separate file (db/migrations/seed_program_budget_fy26.sql),
-- applied after this one. Checks: db/audit/program_budget_phase_a_checks.sql. Rollback: end of file.
--
-- Requires: 20260927000000_signatures_phase2.sql (organizations) and
-- 20261006000000_s23_append_only_event_tables.sql (append_only_refuse()).

BEGIN;

-- ── 1. Categories ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.budget_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES public.organizations(id) ON DELETE CASCADE,
  program     text        NOT NULL DEFAULT 'ASPIRE',
  name        text        NOT NULL,
  sort_order  integer     NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_budget_categories_name UNIQUE (program, name),
  CONSTRAINT chk_budget_categories_name CHECK (length(btrim(name)) BETWEEN 1 AND 60)
);

-- The workbook's dropdown, in its order, less the blank option at its end.
INSERT INTO public.budget_categories (program, name, sort_order) VALUES
  ('ASPIRE', 'Supplies & Materials', 1), ('ASPIRE', 'Technology & Software', 2),
  ('ASPIRE', 'Printing & Copying', 3), ('ASPIRE', 'Guest Speaker Fees', 4),
  ('ASPIRE', 'Room Reservations', 5), ('ASPIRE', 'Meals & Catering', 6),
  ('ASPIRE', 'Conferences', 7), ('ASPIRE', 'Travel & Lodging', 8),
  ('ASPIRE', 'Accreditation', 9), ('ASPIRE', 'Salaries', 10),
  ('ASPIRE', 'Training', 11), ('ASPIRE', 'Moving & Storage', 12),
  ('ASPIRE', 'Marketing', 13), ('ASPIRE', 'Miscellaneous', 14)
ON CONFLICT (program, name) DO NOTHING;

-- ── 2. Budgets ────────────────────────────────────────────────────────────────────

-- fiscal_year is the ENDING year, as lib/server/communityBenefit/compute.js labels it:
-- 2027 is FY27, July 1, 2026 to June 30, 2027.
CREATE TABLE IF NOT EXISTS public.budgets (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid          NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES public.organizations(id) ON DELETE CASCADE,
  program             text          NOT NULL DEFAULT 'ASPIRE',
  fiscal_year         integer       NOT NULL,
  total               numeric(12,2) NOT NULL,
  cost_center         text          NOT NULL DEFAULT 'Nursing Education',
  started_at          timestamptz,                      -- null: not started (the Start form shows)
  owner_note          text          NOT NULL DEFAULT '',
  last_reconciled_at  timestamptz,
  plan_saved_at       timestamptz,                      -- null until the first Save plan
  created_by          uuid          REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT uq_budgets_program_year UNIQUE (program, fiscal_year),
  CONSTRAINT chk_budgets_year CHECK (fiscal_year BETWEEN 2020 AND 2100),
  CONSTRAINT chk_budgets_total CHECK (total >= 0),
  CONSTRAINT chk_budgets_note CHECK (length(owner_note) <= 2000)
);

-- ── 3. Allocations ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.budget_allocations (
  budget_id     uuid          NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  category_id   uuid          NOT NULL REFERENCES public.budget_categories(id) ON DELETE RESTRICT,
  org_id        uuid          NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES public.organizations(id) ON DELETE CASCADE,
  amount        numeric(12,2) NOT NULL DEFAULT 0,       -- the owner's working draft
  saved_amount  numeric(12,2),                          -- what Save plan published; null before it
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (budget_id, category_id),
  CONSTRAINT chk_budget_allocations_amount CHECK (amount >= 0 AND (saved_amount IS NULL OR saved_amount >= 0))
);

-- ── 4. Budget history (append-only) ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.budget_events (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES public.organizations(id) ON DELETE CASCADE,
  budget_id         uuid        NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  kind              text        NOT NULL,
  message           text        NOT NULL,
  old_value         jsonb,
  new_value         jsonb,
  actor_profile_id  uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  actor_name        text        NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_budget_events_kind CHECK (kind IN ('budget_set', 'budget_changed', 'year_started', 'plan_saved', 'reconciled'))
);
CREATE INDEX IF NOT EXISTS idx_budget_events_budget ON public.budget_events (budget_id, created_at);

-- ── 5. Subscriptions (A9) ────────────────────────────────────────────────────────

-- Payment method and status, one vocabulary for expenses and subscriptions (prompt A2):
--   p_card           Paid, Void                       (default Paid)
--   personal_concur  Recorded, Submitted, Reimbursed, Void   (default Recorded)
--   po_invoice       Recorded, Paid, Void             (default Recorded)
--   (none)           Recorded, Void                   (default Recorded)
CREATE TABLE IF NOT EXISTS public.budget_subscriptions (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid          NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES public.organizations(id) ON DELETE CASCADE,
  program               text          NOT NULL DEFAULT 'ASPIRE',
  name                  text          NOT NULL,
  plan                  text          NOT NULL DEFAULT '',
  vendor                text          NOT NULL DEFAULT '',
  billing               text          NOT NULL,
  amount                numeric(12,2) NOT NULL,                 -- an estimate for usage billing
  anchor_date           date          NOT NULL,                 -- any real charge date
  start_date            date          NOT NULL,
  end_date              date,                                   -- null while active
  payment_method        text,
  category_id           uuid          REFERENCES public.budget_categories(id) ON DELETE RESTRICT,
  auto_renew            boolean       NOT NULL DEFAULT true,
  notes                 text          NOT NULL DEFAULT '',
  renewal_kept_for      date,         -- Keep: the renewal date the owner decided to keep
  renewal_remind_after  date,         -- Remind me in 7 days: the slip hides until then
  deleted_at            timestamptz,
  created_by            uuid          REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT chk_budget_subscriptions_billing CHECK (billing IN ('monthly', 'annual', 'usage')),
  CONSTRAINT chk_budget_subscriptions_amount CHECK (amount >= 0),
  CONSTRAINT chk_budget_subscriptions_dates CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT chk_budget_subscriptions_payment CHECK (payment_method IS NULL OR payment_method IN ('p_card', 'personal_concur', 'po_invoice')),
  CONSTRAINT chk_budget_subscriptions_name CHECK (length(btrim(name)) BETWEEN 1 AND 120)
);

-- ── 6. Expenses (the Sheet) ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.budget_expenses (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid          NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES public.organizations(id) ON DELETE CASCADE,
  budget_id        uuid          NOT NULL REFERENCES public.budgets(id) ON DELETE RESTRICT,   -- derived from expense_date by the API
  expense_date     date          NOT NULL,
  date_precision   text          NOT NULL DEFAULT 'day',   -- 'month': imported FY26 rows, shown "Jan 2026"
  item             text          NOT NULL DEFAULT '',
  category_id      uuid          REFERENCES public.budget_categories(id) ON DELETE RESTRICT,
  description      text          NOT NULL DEFAULT '',
  vendor           text          NOT NULL DEFAULT '',
  order_number     text          NOT NULL DEFAULT '',      -- an Amazon order number or an invoice number
  payment_method   text,
  status           text,                                   -- null only on imported rows (the workbook had none)
  quantity         numeric(10,2) NOT NULL DEFAULT 1,       -- unit cost is computed, never stored
  amount           numeric(12,2) NOT NULL DEFAULT 0,
  cohort_id        uuid          REFERENCES public.cohorts(id) ON DELETE SET NULL,
  cost_center      text          NOT NULL DEFAULT 'Nursing Education',
  notes            text          NOT NULL DEFAULT '',
  receipt_file_id  uuid,                                   -- Phase B: the filed receipt
  subscription_id  uuid          REFERENCES public.budget_subscriptions(id) ON DELETE SET NULL,
  charge_date      date,                                   -- the subscription charge this row posts
  source           text          NOT NULL DEFAULT 'manual',
  cell_formats     jsonb         NOT NULL DEFAULT '{}'::jsonb,   -- the Sheet's per-cell formatting
  staff_values     jsonb         NOT NULL DEFAULT '{}'::jsonb,   -- values in the owner's own + Columns
  deleted_at       timestamptz,                            -- a deleted row stays for its history
  created_by       uuid          REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT chk_budget_expenses_precision CHECK (date_precision IN ('day', 'month')),
  CONSTRAINT chk_budget_expenses_source CHECK (source IN ('manual', 'import', 'subscription', 'receipt')),
  CONSTRAINT chk_budget_expenses_quantity CHECK (quantity > 0),
  CONSTRAINT chk_budget_expenses_amount CHECK (amount >= 0),
  CONSTRAINT chk_budget_expenses_payment CHECK (payment_method IS NULL OR payment_method IN ('p_card', 'personal_concur', 'po_invoice')),
  -- A status must be one the payment method allows (prompt A2). An imported row may have neither.
  -- COALESCE, because a comparison with a NULL method is NULL and a CHECK lets NULL through.
  CONSTRAINT chk_budget_expenses_status CHECK (
    status IS NULL
    OR CASE COALESCE(payment_method, 'none')
         WHEN 'p_card'          THEN status IN ('paid', 'void')
         WHEN 'personal_concur' THEN status IN ('recorded', 'submitted', 'reimbursed', 'void')
         WHEN 'po_invoice'      THEN status IN ('recorded', 'paid', 'void')
         WHEN 'none'            THEN status IN ('recorded', 'void')
         ELSE false
       END
  ),
  CONSTRAINT chk_budget_expenses_formats CHECK (jsonb_typeof(cell_formats) = 'object' AND jsonb_typeof(staff_values) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_budget_expenses_budget ON public.budget_expenses (budget_id, expense_date) WHERE deleted_at IS NULL;
-- One posted row per subscription charge date, so posting can run any number of times.
CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_expenses_charge ON public.budget_expenses (subscription_id, charge_date) WHERE subscription_id IS NOT NULL AND charge_date IS NOT NULL;

-- ── 7. Change log (append-only) ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.budget_changes (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity            text        NOT NULL,
  entity_id         uuid        NOT NULL,            -- no FK: a change outlives what it changed
  budget_id         uuid,
  action            text        NOT NULL,
  field             text,
  old_value         jsonb,
  new_value         jsonb,
  actor_profile_id  uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  actor_name        text        NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_budget_changes_entity CHECK (entity IN ('expense', 'subscription', 'allocation')),
  CONSTRAINT chk_budget_changes_action CHECK (action IN ('create', 'update', 'delete', 'post'))
);
CREATE INDEX IF NOT EXISTS idx_budget_changes_entity ON public.budget_changes (entity, entity_id, created_at);

-- ── 8. The Sheet's layout ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.budget_sheet_views (
  program     text        PRIMARY KEY,
  org_id      uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES public.organizations(id) ON DELETE CASCADE,
  sheet       text        NOT NULL DEFAULT 'expenses',
  layout      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_by  uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_budget_sheet_views_layout CHECK (jsonb_typeof(layout) = 'object')
);

-- ── 9. Leadership: the budget_access grant flag ──────────────────────────────────

ALTER TABLE public.user_role_grants
  ADD COLUMN IF NOT EXISTS budget_access text NOT NULL DEFAULT 'none';
ALTER TABLE public.user_role_grants
  DROP CONSTRAINT IF EXISTS user_role_grants_budget_access_check;
ALTER TABLE public.user_role_grants
  ADD CONSTRAINT user_role_grants_budget_access_check
  CHECK (budget_access IN ('none', 'view') AND (role = 'nursing_academic' OR budget_access = 'none'));
COMMENT ON COLUMN public.user_role_grants.budget_access IS
  'Nursing Education & Leadership Program Budgets tab: none or view. View is read-only: Summary, Sheet, Subscriptions, and Allocations once saved. Never receipts, the review queue or draft allocations.';

-- ── 10. Append-only, RLS on, no browser access ───────────────────────────────────

DROP TRIGGER IF EXISTS trg_budget_events_append_only ON public.budget_events;
CREATE TRIGGER trg_budget_events_append_only BEFORE UPDATE OR DELETE ON public.budget_events
  FOR EACH ROW EXECUTE FUNCTION public.append_only_refuse();
DROP TRIGGER IF EXISTS trg_budget_events_no_truncate ON public.budget_events;
CREATE TRIGGER trg_budget_events_no_truncate BEFORE TRUNCATE ON public.budget_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_refuse();
DROP TRIGGER IF EXISTS trg_budget_changes_append_only ON public.budget_changes;
CREATE TRIGGER trg_budget_changes_append_only BEFORE UPDATE OR DELETE ON public.budget_changes
  FOR EACH ROW EXECUTE FUNCTION public.append_only_refuse();
DROP TRIGGER IF EXISTS trg_budget_changes_no_truncate ON public.budget_changes;
CREATE TRIGGER trg_budget_changes_no_truncate BEFORE TRUNCATE ON public.budget_changes
  FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_refuse();

DO $pb$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['budget_categories', 'budgets', 'budget_allocations', 'budget_events', 'budget_subscriptions',
                           'budget_expenses', 'budget_changes', 'budget_sheet_views'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
  END LOOP;
END
$pb$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Rollback (run as one block; loses every budget, expense, subscription and its history) ──
-- BEGIN;
--   ALTER TABLE public.user_role_grants DROP CONSTRAINT IF EXISTS user_role_grants_budget_access_check;
--   ALTER TABLE public.user_role_grants DROP COLUMN IF EXISTS budget_access;
--   DROP TABLE IF EXISTS public.budget_sheet_views, public.budget_changes, public.budget_expenses,
--     public.budget_subscriptions, public.budget_events, public.budget_allocations, public.budgets,
--     public.budget_categories;
-- COMMIT;
