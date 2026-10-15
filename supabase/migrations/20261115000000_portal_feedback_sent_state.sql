-- FEEDBACK-LOOP-1 (2026-10-14): a portal feedback delivery can be saved as sent.
--
-- portal_feedback_deliveries declared next_retry_at NOT NULL, and also
-- chk_portal_feedback_terminal_not_retryable, which requires next_retry_at IS NULL
-- for 'sent' and 'permanent_failure'. No row could satisfy both, so the worker's
-- final write failed every time, the row stayed 'processing' with attempt_count 0,
-- stale recovery handed it back every ten minutes, and Resend's 24-hour idempotency
-- window let one copy of the same email through each day (the Owner's report).
--
-- 1. next_retry_at may be NULL (it keeps its DEFAULT now() for new rows).
-- 2. The one delivery caught in the loop is closed as sent: its email has gone out
--    every day since 2026-10-09.

ALTER TABLE public.portal_feedback_deliveries
  ALTER COLUMN next_retry_at DROP NOT NULL;

UPDATE public.portal_feedback_deliveries
SET delivery_status = 'sent',
    attempt_count   = LEAST(GREATEST(attempt_count, 1), max_attempts),
    next_retry_at   = NULL,
    locked_at       = NULL,
    locked_by       = NULL,
    last_attempt_at = COALESCE(last_attempt_at, now()),
    sent_at         = COALESCE(sent_at, now()),
    updated_at      = now()
WHERE id = 'e35132c8-8693-4a9b-82f7-5aae94b2eef7'
  AND delivery_status IN ('processing', 'pending', 'retryable_failure');
