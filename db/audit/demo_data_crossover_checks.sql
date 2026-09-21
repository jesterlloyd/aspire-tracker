-- db/audit/demo_data_crossover_checks.sql
--
-- DEMO-DATA-2: READ ONLY. Nothing here creates, alters, or deletes anything.
--
-- Until DEMO-DATA-2, sendNotification built its own Resend client, so the demo recipient
-- guard never saw its sends, and the crons swept demo rows along with real ones. The code
-- shows the path; only the send log can show whether anything actually went out. Run one
-- section at a time and send back each result set.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Sends addressed to a demo person, by type and outcome.
--    EXPECT: rows only for types the demo itself triggered. "held" counts the ones the
--    mailer stopped; "to_provider" counts the ones that reached Resend. A clockout_reminder
--    row with to_provider > 0 is the hourly sweep reaching the two seeded open shifts.
-- ─────────────────────────────────────────────────────────────────────
SELECT
  notification_type,
  status,
  count(*)                                                        AS rows,
  count(*) FILTER (WHERE resend_email_id LIKE 'demo_held_%')      AS held,
  count(*) FILTER (WHERE resend_email_id NOT LIKE 'demo_held_%')  AS to_provider,
  min(sent_at)                                                    AS first_sent,
  max(sent_at)                                                    AS last_sent
FROM notification_log
WHERE recipient_email ILIKE '%@demo.aspire.invalid'
GROUP BY notification_type, status
ORDER BY notification_type, status;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Real people emailed ABOUT a demo student (an interviewer's reminder, an internal
--    alert, a coordinator notice).
--    EXPECT: zero rows. Any row is a real inbox that received a fabricated name.
-- ─────────────────────────────────────────────────────────────────────
SELECT
  nl.notification_type,
  nl.recipient_email,
  count(*)        AS rows,
  max(nl.sent_at) AS last_sent
FROM notification_log nl
JOIN students s ON s.id = nl.student_id
WHERE s.is_demo
  AND nl.recipient_email NOT ILIKE '%@demo.aspire.invalid'
GROUP BY nl.notification_type, nl.recipient_email
ORDER BY last_sent DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Demo contacts filed under the Unit Leader category, and the units they name.
--    EXPECT: the three seeded Nurse Managers (6 NE, 5 North, 7 North). Their titles are not
--    lead titles, which is why no real routing picked them before DEMO-DATA-2 scoped it.
--    A row with Associate Director, Director or Executive Director would have been able to.
-- ─────────────────────────────────────────────────────────────────────
SELECT full_name, role, unit_name, related_units, is_active
FROM contacts
WHERE is_demo
  AND category IN ('Unit Leader', 'Unit Leadership')
ORDER BY unit_name, full_name;
