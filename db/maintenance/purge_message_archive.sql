-- =============================================================================
-- MESSAGE ARCHIVE: 24-MONTH BODY RETENTION PURGE
-- =============================================================================
-- *** DRY RUN FIRST. Nothing here is scheduled, and Claude Code has executed    ***
-- *** nothing. STEP 1 is read-only; STEP 2 deletes. Run STEP 1, read the counts, ***
-- *** and only then decide.                                                     ***
--
-- WHY 24 MONTHS
-- Owner decision 2026-08-14, PENDING CONFIRMATION AGAINST CEDARS-SINAI RETENTION
-- POLICY before this is ever run in production. Do not schedule it until that
-- confirmation exists.
--
-- WHAT IS PURGED, AND WHAT IS NOT
-- This deletes the BODY SNAPSHOT only. notification_log is untouched, so the
-- record that a message was sent - recipient, subject, status, timestamps,
-- resend_email_id - survives a purge in full. A purged row simply returns to the
-- "body not available" preview state, which the preview endpoint already handles
-- as a first-class outcome rather than an error.
--
-- WHICH CLOCK
-- message_archive.created_at (timestamptz NOT NULL DEFAULT now()) is the
-- archive-insert time and is the correct retention clock: it is when ASPIRE began
-- holding the body. notification_log.sent_at is when the mail left, which can
-- differ for a backfilled or late-archived row. No new column was needed.
-- =============================================================================

-- ── STEP 1: DRY RUN (read-only) ──────────────────────────────────────────────
-- What would be deleted, by kind, with the oldest/newest dates in scope.
SELECT
  a.content_kind,
  count(*)                          AS rows_to_purge,
  min(a.created_at)::date           AS oldest,
  max(a.created_at)::date           AS newest,
  pg_size_pretty(sum(
    coalesce(octet_length(a.html_redacted), 0) +
    coalesce(octet_length(a.text_redacted), 0)
  )::bigint)                        AS body_bytes
FROM public.message_archive a
WHERE a.created_at < now() - interval '24 months'
GROUP BY a.content_kind
ORDER BY rows_to_purge DESC;

-- Totals, and what REMAINS afterwards (the safety number: this should be large).
SELECT
  count(*) FILTER (WHERE created_at <  now() - interval '24 months') AS would_purge,
  count(*) FILTER (WHERE created_at >= now() - interval '24 months') AS would_keep,
  count(*)                                                            AS total_rows
FROM public.message_archive;

-- Confirm no notification_log row loses its record (expect would_purge rows here
-- to still exist in notification_log afterwards - this is informational).
SELECT count(*) AS log_rows_with_archive_in_scope
FROM public.message_archive a
JOIN public.notification_log n ON n.id = a.notification_log_id
WHERE a.created_at < now() - interval '24 months';

-- ── STEP 2: PURGE (destructive - run only after reading STEP 1) ──────────────
-- Bounded and re-runnable. RETURNING gives the exact deleted count for the log.
--
-- BEGIN;
--   WITH purged AS (
--     DELETE FROM public.message_archive
--      WHERE created_at < now() - interval '24 months'
--      RETURNING notification_log_id, content_kind
--   )
--   SELECT content_kind, count(*) AS purged_rows
--   FROM purged GROUP BY content_kind ORDER BY purged_rows DESC;
--   -- Inspect the result, then COMMIT (or ROLLBACK to abort with nothing lost).
-- COMMIT;
--
-- ── POST-PURGE VERIFICATION ─────────────────────────────────────────────────
--   -- 1. Nothing older than the window survives (expect 0):
--   SELECT count(*) FROM public.message_archive
--    WHERE created_at < now() - interval '24 months';
--   -- 2. The send record itself is intact (expect the pre-purge total):
--   SELECT count(*) FROM public.notification_log;
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- A committed purge is NOT reversible: the bodies are gone by design, which is
-- the point of a retention window. Reversibility comes from running STEP 2
-- inside the transaction above and using ROLLBACK before COMMIT. Take a backup
-- of message_archive first if the deletion set is larger than expected.
-- =============================================================================
