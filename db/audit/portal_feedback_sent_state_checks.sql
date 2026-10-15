-- db/audit/portal_feedback_sent_state_checks.sql
-- FEEDBACK-LOOP-1: read-only checks for supabase/migrations/20261115000000_portal_feedback_sent_state.sql.
-- Run PRE before applying, POST after. Every statement is a SELECT.

-- ============================== PRE ==============================
-- PRE 1. next_retry_at is still NOT NULL and the terminal rule still exists (expect: 'NO', true).
SELECT
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'portal_feedback_deliveries' AND column_name = 'next_retry_at') AS next_retry_nullable,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_portal_feedback_terminal_not_retryable') AS terminal_rule_exists;

-- PRE 2. Delivery states (expect: one row, processing, the looping delivery).
SELECT id, delivery_status, attempt_count, sent_at
FROM public.portal_feedback_deliveries
ORDER BY created_at;

-- ============================== POST ==============================
-- POST 1. next_retry_at may be NULL now (expect: 'YES').
SELECT is_nullable AS next_retry_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'portal_feedback_deliveries' AND column_name = 'next_retry_at';

-- POST 2. Nothing is left processing or due (expect: 0, and the looping delivery sent with next_retry_at NULL).
SELECT
  (SELECT count(*) FROM public.portal_feedback_deliveries WHERE delivery_status IN ('pending', 'processing', 'retryable_failure')) AS open_deliveries,
  (SELECT delivery_status FROM public.portal_feedback_deliveries WHERE id = 'e35132c8-8693-4a9b-82f7-5aae94b2eef7') AS looping_delivery_status,
  (SELECT next_retry_at IS NULL FROM public.portal_feedback_deliveries WHERE id = 'e35132c8-8693-4a9b-82f7-5aae94b2eef7') AS looping_delivery_retry_cleared;
