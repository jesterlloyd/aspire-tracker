-- REPLACE-REVIEW-1 (Budget Tracker > Receipts: a replacement goes through review), 2026-10-01.
-- OWNER-GATED: do not apply from a session.
--
--   budget_receipts.replaces_receipt_id   the filed receipt a new upload would take the place of.
--     Replace file no longer swaps the file at once: the new file is a slip in To Review, read by Keith
--     like any upload, and it takes the filed receipt's place only when the Owner accepts it there.
--     ON DELETE SET NULL: if the filed receipt is deleted meanwhile, the slip is an ordinary receipt
--     waiting for review.
--
-- Additive, one transaction, safe to re-run. Either deploy order: before it runs, Replace file says it
-- needs this update, and nothing else changes. Check at the end. Rollback at the end.

BEGIN;

ALTER TABLE public.budget_receipts
  ADD COLUMN IF NOT EXISTS replaces_receipt_id uuid REFERENCES public.budget_receipts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_budget_receipts_replaces ON public.budget_receipts (replaces_receipt_id) WHERE replaces_receipt_id IS NOT NULL;
COMMENT ON COLUMN public.budget_receipts.replaces_receipt_id IS
  'REPLACE-REVIEW-1: the filed receipt this upload would replace. It replaces it only when accepted in To Review.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Check (read-only):
--   SELECT COUNT(*) AS replaces_column FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'budget_receipts' AND column_name = 'replaces_receipt_id';
--   Expect 1.
--
-- Rollback:
--   BEGIN;
--   DROP INDEX IF EXISTS public.idx_budget_receipts_replaces;
--   ALTER TABLE public.budget_receipts DROP COLUMN IF EXISTS replaces_receipt_id;
--   COMMIT;
