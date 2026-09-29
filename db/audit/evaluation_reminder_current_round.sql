-- Read-only. Shows the round due NOW, not merely the highest historical round.
-- Historical rows are kept; a prior-invitation "sent" record is not current delivery.
WITH outstanding AS (
  SELECT a.id, a.student_id, i.slug, a.sent_at AS invitation_sent_at,
         a.status, a.revoked_at, a.expires_at,
         floor(extract(epoch FROM (now() - a.sent_at)) / 86400)::integer AS age_days
  FROM public.evaluation_assignments a
  JOIN public.evaluation_instruments i ON i.id = a.instrument_id
  WHERE a.respondent_type = 'student' AND a.completed_at IS NULL
    AND a.status <> 'completed'
), due AS (
  SELECT *, CASE WHEN age_days BETWEEN 7 AND 27
    THEN least(3, age_days / 7) ELSE NULL END AS due_round
  FROM outstanding
)
SELECT a.id AS assignment_id, a.student_id, a.slug AS evaluation,
       a.invitation_sent_at, a.expires_at, a.age_days, a.due_round,
       d.status AS due_round_status, d.sent_at AS due_round_sent_at,
       d.reason, d.attempts,
       CASE
         WHEN a.revoked_at IS NOT NULL THEN 'revoked'
         WHEN a.status NOT IN ('sent', 'opened', 'reminder_due') THEN 'not_live'
         WHEN a.expires_at <= now() THEN 'window_closed'
         WHEN a.due_round IS NULL THEN 'outside_reminder_age'
         WHEN d.sent_at >= a.invitation_sent_at THEN 'sent_for_current_invitation'
         WHEN d.sent_at < a.invitation_sent_at THEN 'sent_record_is_from_old_invitation'
         ELSE 'inspect_due_round_state'
       END AS interpretation
FROM due a
LEFT JOIN LATERAL (
  SELECT status, sent_at, reason, attempts
  FROM public.evaluation_reminder_deliveries d
  WHERE d.assignment_id = a.id AND d.reminder_number = a.due_round
  ORDER BY coalesce(d.first_attempted_at, d.sent_at, d.created_at) DESC, d.created_at DESC
  LIMIT 1
) d ON true
ORDER BY a.slug, a.invitation_sent_at DESC;
