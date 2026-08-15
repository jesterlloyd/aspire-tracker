-- db/maintenance/audit_bulk_send_incident_20260814.sql
--
-- BULK-EXACT-RECIPIENTS-1 (P0) - READ-ONLY incident audit.
-- Incident: the Aug 14, 2026 ~5:08 PM PDT bulk send "Welcome to ASPIRE!
-- You're Invited: ASPIRE Orientation - Monday, August 17, 2026" reached 12
-- recipients when exactly 6 were reviewed.
--
-- Run in the Supabase SQL editor. SELECTs only - nothing here writes,
-- updates, or deletes. Timestamps are UTC (5:08 PM PDT = 00:08 UTC Aug 15).

-- ── 1. Find the incident batch. Expect ONE batch_id with 12 rows. ───────────
SELECT metadata->>'batch_id'                          AS batch_id,
       count(*)                                       AS recipients,
       min(sent_at)                                   AS first_send,
       max(sent_at)                                   AS last_send,
       max(subject)                                   AS subject
FROM   notification_log
WHERE  notification_type = 'bulk_message_sent'
AND    sent_at BETWEEN '2026-08-14T23:30:00Z' AND '2026-08-15T01:00:00Z'
GROUP  BY 1
ORDER  BY first_send;

-- ── 2. Per-recipient provenance for the incident batch. ────────────────────
-- recipient_source tells you which selection path carried each recipient:
--   'student' = Students checkbox OR a student typeahead chip
--   'contact' = Contacts checkbox
--   'manual'  = Paste · Type raw entry
-- email_source ('school'|'personal') is recorded for students only.
-- Substitute the batch_id from query 1.
SELECT sent_at,
       recipient_name,
       recipient_email,
       metadata->>'recipient_source' AS source_path,
       metadata->>'email_source'     AS email_source,
       metadata->>'recipient_id'     AS recipient_id,
       metadata->>'template_key'     AS template_key
FROM   notification_log
WHERE  notification_type = 'bulk_message_sent'
AND    metadata->>'batch_id' = '<BATCH_ID_FROM_QUERY_1>'
ORDER  BY sent_at;

-- ── 3. Student-status check for the batch's student recipients. ────────────
-- Confirms which recipient was 'Not Proceeding' at audit time (status may
-- have changed since the send; notification_log does not snapshot status).
SELECT s.first_name, s.last_name, s.school, s.status,
       nl.recipient_email, nl.sent_at
FROM   notification_log nl
JOIN   students s ON s.id = nl.student_id
WHERE  nl.notification_type = 'bulk_message_sent'
AND    nl.metadata->>'batch_id' = '<BATCH_ID_FROM_QUERY_1>'
ORDER  BY s.last_name;

-- ── 4. Was any part of the audience a leftover from an EARLIER batch? ──────
-- Lists every prior bulk batch (last 30 days) that included any of the
-- incident batch's recipients - evidence for the restored-draft mechanism.
SELECT metadata->>'batch_id' AS earlier_batch,
       min(sent_at)          AS sent_at,
       count(*)              AS overlapping_recipients,
       array_agg(recipient_email ORDER BY recipient_email) AS emails
FROM   notification_log
WHERE  notification_type = 'bulk_message_sent'
AND    sent_at < '2026-08-14T23:30:00Z'
AND    sent_at > '2026-07-15T00:00:00Z'
AND    lower(recipient_email) IN (
         SELECT lower(recipient_email)
         FROM   notification_log
         WHERE  notification_type = 'bulk_message_sent'
         AND    metadata->>'batch_id' = '<BATCH_ID_FROM_QUERY_1>'
       )
GROUP  BY 1
ORDER  BY sent_at DESC;
