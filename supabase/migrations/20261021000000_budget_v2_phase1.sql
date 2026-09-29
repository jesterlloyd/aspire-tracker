-- BUDGET-V2 Phase 1 (correct numbers), 2026-09-29. OWNER-GATED: do not apply from a session.
--
-- Reference: docs/mockups/program-budget-v2.html, items 1, 3 and 5.
--
--   1. budget_receipts        + status 'held', + held_subscription_id, + held_charge_date. A receipt
--                             for a charge of a subscription awaiting approval waits here, and
--                             attaches to its charge when the owner approves the plan (item 1).
--   2. budget_settings        + remembered_cards: [{ "last4": "2002", "method": "personal_concur" }].
--                             The last four digits and the payment method, never more (item 5).
--   3. budget_subscriptions   + overlap_kept: the owner kept two plans from one vendor running at
--                             once, so the overlap check stops asking (item 3).
--   4. budget_changes         + actions 'hold' and 'release' for the audit chain.
--
-- Additive, one transaction, safe to re-run. Either deploy order: before it runs, Hold and Keep
-- both say their update has not been applied, and every other screen works as it did.
-- Checks: db/audit/budget_v2_phase1_checks.sql. Rollback at the end of this file.

BEGIN;

-- ── 1. Held receipts ─────────────────────────────────────────────────────────────

ALTER TABLE public.budget_receipts
  ADD COLUMN IF NOT EXISTS held_subscription_id uuid REFERENCES public.budget_subscriptions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS held_charge_date date;
ALTER TABLE public.budget_receipts DROP CONSTRAINT IF EXISTS chk_budget_receipts_status;
ALTER TABLE public.budget_receipts
  ADD CONSTRAINT chk_budget_receipts_status CHECK (status IN ('uploading', 'reading', 'review', 'failed', 'snoozed', 'held', 'accepted', 'rejected'));
ALTER TABLE public.budget_receipts DROP CONSTRAINT IF EXISTS chk_budget_receipts_held;
ALTER TABLE public.budget_receipts
  ADD CONSTRAINT chk_budget_receipts_held CHECK (status <> 'held' OR (held_subscription_id IS NOT NULL AND held_charge_date IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_budget_receipts_held ON public.budget_receipts (held_subscription_id) WHERE status = 'held';

-- ── 2. Remembered cards ──────────────────────────────────────────────────────────

ALTER TABLE public.budget_settings
  ADD COLUMN IF NOT EXISTS remembered_cards jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.budget_settings DROP CONSTRAINT IF EXISTS chk_budget_settings_cards;
ALTER TABLE public.budget_settings
  ADD CONSTRAINT chk_budget_settings_cards CHECK (jsonb_typeof(remembered_cards) = 'array' AND jsonb_array_length(remembered_cards) <= 20);

-- ── 3. The overlap check ─────────────────────────────────────────────────────────

ALTER TABLE public.budget_subscriptions
  ADD COLUMN IF NOT EXISTS overlap_kept boolean NOT NULL DEFAULT false;

-- ── 4. The audit chain ───────────────────────────────────────────────────────────

ALTER TABLE public.budget_changes DROP CONSTRAINT IF EXISTS chk_budget_changes_action;
ALTER TABLE public.budget_changes
  ADD CONSTRAINT chk_budget_changes_action CHECK (action IN ('create', 'update', 'delete', 'post', 'upload', 'read', 'accept', 'attach', 'snooze', 'reject', 'undo', 'hold', 'release'));

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Rollback (only after every held receipt is released or rejected):
--   BEGIN;
--   ALTER TABLE public.budget_changes DROP CONSTRAINT IF EXISTS chk_budget_changes_action;
--   ALTER TABLE public.budget_changes ADD CONSTRAINT chk_budget_changes_action CHECK (action IN ('create', 'update', 'delete', 'post', 'upload', 'read', 'accept', 'attach', 'snooze', 'reject', 'undo'));
--   ALTER TABLE public.budget_subscriptions DROP COLUMN IF EXISTS overlap_kept;
--   ALTER TABLE public.budget_settings DROP CONSTRAINT IF EXISTS chk_budget_settings_cards;
--   ALTER TABLE public.budget_settings DROP COLUMN IF EXISTS remembered_cards;
--   DROP INDEX IF EXISTS public.idx_budget_receipts_held;
--   ALTER TABLE public.budget_receipts DROP CONSTRAINT IF EXISTS chk_budget_receipts_held;
--   ALTER TABLE public.budget_receipts DROP CONSTRAINT IF EXISTS chk_budget_receipts_status;
--   ALTER TABLE public.budget_receipts ADD CONSTRAINT chk_budget_receipts_status CHECK (status IN ('uploading', 'reading', 'review', 'failed', 'snoozed', 'accepted', 'rejected'));
--   ALTER TABLE public.budget_receipts DROP COLUMN IF EXISTS held_charge_date, DROP COLUMN IF EXISTS held_subscription_id;
--   COMMIT;
