-- SHEET-LIVE-1 (PROGRAM-BUDGET), 2026-09-27. OWNER-GATED: do not apply from a session.
--
-- Owner, 2026-09-27: changing a quantity to zero on the FY26 Sheet was refused ("Quantity must be
-- more than zero"). A row can keep its line with nothing bought (a returned or cancelled order), so
-- a quantity of zero is allowed; a negative one is still refused. Unit cost is computed, never
-- stored, and reads as a dash when the quantity is zero.
-- One transaction, safe to re-run. Either deploy order: until it runs, a zero quantity is refused
-- with a sentence naming this update, and nothing else changes.
-- Requires 20261009000000_program_budget_phase_a.sql (applied). Rollback: end of file.

BEGIN;

ALTER TABLE public.budget_expenses DROP CONSTRAINT IF EXISTS chk_budget_expenses_quantity;
ALTER TABLE public.budget_expenses
  ADD CONSTRAINT chk_budget_expenses_quantity CHECK (quantity >= 0);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Rollback (fails while any row has a quantity of zero; set those to 1 first) ──
-- BEGIN;
--   ALTER TABLE public.budget_expenses DROP CONSTRAINT IF EXISTS chk_budget_expenses_quantity;
--   ALTER TABLE public.budget_expenses ADD CONSTRAINT chk_budget_expenses_quantity CHECK (quantity > 0);
-- COMMIT;
