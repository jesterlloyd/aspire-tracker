-- REVIEW ONLY. This script always rolls back. Remove ROLLBACK only after the
-- classification summary has been reviewed and an explicit production change
-- window is approved.
BEGIN;

WITH candidates AS (
  SELECT l.id, l.student_id, l.cohort_id, btrim(l.support_needed) AS reply,
         md5(btrim(l.support_needed)) AS fingerprint
    FROM public.student_shift_logs l
   WHERE btrim(COALESCE(l.support_needed, '')) <> ''
     AND NOT EXISTS (
       SELECT 1 FROM public.support_checkin_events e WHERE e.shift_log_id = l.id
     )
), classified AS (
  SELECT c.*, x.classification, x.status, x.rule_key
    FROM candidates c
    CROSS JOIN LATERAL public.classify_support_checkin(c.reply) x
), inserted AS (
  INSERT INTO public.support_checkin_events
    (shift_log_id, student_id, cohort_id, reply_fingerprint, classification, status, rule_key)
  SELECT id, student_id, cohort_id, fingerprint, classification, status, 'backfill_' || rule_key
    FROM classified
   WHERE classification IN ('urgent', 'decline', 'request', 'needs_look')
  ON CONFLICT (shift_log_id, reply_fingerprint, status, rule_key) DO NOTHING
  RETURNING classification, status
)
SELECT
  count(*) FILTER (WHERE classification = 'decline' AND status = 'closed_auto') AS closed_as_declines,
  count(*) FILTER (WHERE classification = 'needs_look') AS marked_needs_a_look,
  count(*) FILTER (WHERE classification IN ('urgent', 'request')) AS stayed_open
FROM inserted;

ROLLBACK;
