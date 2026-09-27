-- SUB-CELLS-1 (PROGRAM-BUDGET), 2026-09-27. OWNER-GATED: do not apply from a session.
--
-- Owner, 2026-09-27: "why are my changes in the sheet not sticking? I changed the date format and
-- when I left and returned, my changes weren't applied." A format set on cells of the Subscriptions
-- sheet had nowhere to be kept: subscriptions had no per-cell columns (only a whole column's format,
-- kept in the sheet's layout, survived). This gives a subscription what an expense already has.
-- Additive, one transaction, safe to re-run. Either deploy order: until it runs, the Subscriptions
-- sheet says per-cell formatting needs this update, and nothing else changes.
-- Requires 20261009000000_program_budget_phase_a.sql (applied). Rollback: end of file.

BEGIN;

ALTER TABLE public.budget_subscriptions
  ADD COLUMN IF NOT EXISTS cell_formats jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS staff_values jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.budget_subscriptions DROP CONSTRAINT IF EXISTS chk_budget_subscriptions_cells;
ALTER TABLE public.budget_subscriptions
  ADD CONSTRAINT chk_budget_subscriptions_cells CHECK (jsonb_typeof(cell_formats) = 'object' AND jsonb_typeof(staff_values) = 'object');

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Rollback (per-cell formats and + Column values on subscriptions are lost) ──
-- BEGIN;
--   ALTER TABLE public.budget_subscriptions DROP CONSTRAINT IF EXISTS chk_budget_subscriptions_cells;
--   ALTER TABLE public.budget_subscriptions DROP COLUMN IF EXISTS staff_values, DROP COLUMN IF EXISTS cell_formats;
-- COMMIT;
