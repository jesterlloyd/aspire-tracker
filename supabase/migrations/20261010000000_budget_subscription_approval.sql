-- SUB-APPROVAL-1 (PROGRAM-BUDGET), 2026-09-27. OWNER-GATED: do not apply from a session.
--
-- Owner, 2026-09-27: "add it so I can present it to Margo using the platform, but do not put it
-- against the budget yet." A subscription can be PROPOSED: shown on the Subscriptions tab with
-- what it would cost, and counted against nothing (no charge posts, nothing is committed, no
-- renewal is asked) until the owner approves it, from the start of the year or from the day of
-- approval. Additive, one transaction, safe to re-run.
--
--   approval_state  'approved' (every existing row, as before) | 'proposed' | 'declined'
--   approved_at     when it was approved
--   post_from       the first day its charges count; null means its start date
--
-- Either deploy order: before this runs, every subscription reads as approved, exactly as now.
-- Requires 20261009000000_program_budget_phase_a.sql (applied 2026-09-27).
-- Checks: db/audit/budget_subscription_approval_checks.sql. Rollback: end of file.

BEGIN;

ALTER TABLE public.budget_subscriptions
  ADD COLUMN IF NOT EXISTS approval_state text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS post_from date;

ALTER TABLE public.budget_subscriptions DROP CONSTRAINT IF EXISTS chk_budget_subscriptions_approval;
ALTER TABLE public.budget_subscriptions
  ADD CONSTRAINT chk_budget_subscriptions_approval CHECK (approval_state IN ('proposed', 'approved', 'declined'));

COMMENT ON COLUMN public.budget_subscriptions.approval_state IS
  'proposed: shown with its cost, counted against nothing. approved: its charges post from post_from (or its start). declined: kept for the record.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Rollback (every subscription reads as approved again) ──
-- BEGIN;
--   ALTER TABLE public.budget_subscriptions DROP CONSTRAINT IF EXISTS chk_budget_subscriptions_approval;
--   ALTER TABLE public.budget_subscriptions DROP COLUMN IF EXISTS post_from, DROP COLUMN IF EXISTS approved_at, DROP COLUMN IF EXISTS approval_state;
-- COMMIT;
