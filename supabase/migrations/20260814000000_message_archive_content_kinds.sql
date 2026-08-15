-- =============================================================================
-- MESSAGE ARCHIVE: WIDEN content_kind TO EVERY ARCHIVABLE COMMUNICATION
-- =============================================================================
-- *** APPLY MANUALLY (Owner/Jester) in the Supabase SQL editor. Claude Code has ***
-- *** applied NOTHING. Run the whole file once, then the verification block at  ***
-- *** the bottom, THEN authorize the snapshot-writing code.                     ***
--
-- WHY
-- Sent History could not show a body for weekly digests or bulk manual emails,
-- and the reason was not the preview code: it was this table. content_kind is a
-- ONE-VALUE closed set, so those paths had nowhere to write. connect-send-bulk-message.js
-- says so in its own header ("NO message_archive write (content_kind CHECK does
-- not permit bulk manual email)"), and the shared writer hardcodes
-- 'manual_direct_email' to satisfy the constraint. Widening the set is the whole
-- schema change.
--
-- WHAT THIS DOES NOT DO, DELIBERATELY
--   * No new columns. subject, recipient, resend_email_id and sent_at all live on
--     notification_log, and this table's PRIMARY KEY *is* notification_log_id, so
--     every one of them is a join away. Copying them here would duplicate data
--     that can drift.
--   * No template_key / template_version columns. `metadata jsonb NOT NULL
--     DEFAULT '{}'` already exists with an object CHECK and already carries
--     per-write keys ({source, body_format}), so template identity goes there as
--     metadata.template_key / metadata.template_version. Nothing about the
--     current structure prevents it.
--   * No retention column. `created_at timestamptz NOT NULL DEFAULT now()` is
--     already present and is the archive-insert time, which is exactly the clock
--     a body-retention window should run on. The 24-month purge uses it.
--   * No RLS change. The table is already RLS-ENABLED WITH NO POLICIES, so only
--     service-role code can read or write it. This migration widens no access.
--
-- PRIVACY NOTE
-- After this, ASPIRE retains message BODIES at a materially larger scale: today
-- one manual-email table, afterwards every digest and bulk send. That is a
-- retention posture change, not just a storage one, which is why the 24-month
-- purge ships with it (db/maintenance/purge_message_archive.sql) and why
-- secure_link_email rows must be inserted only after the tokenized URL has been
-- irreversibly replaced and the resulting snapshot has verified clean. The
-- writer receives the sent body, but the database never receives the secret.
--
-- ROLLBACK: see the block at the bottom of this file.
-- =============================================================================

BEGIN;

ALTER TABLE public.message_archive
  DROP CONSTRAINT IF EXISTS chk_message_archive_content_kind;

ALTER TABLE public.message_archive
  ADD CONSTRAINT chk_message_archive_content_kind CHECK (content_kind IN (
    'manual_direct_email',        -- pre-existing; unchanged behaviour
    'manual_bulk_email',          -- ASPIRE Connect bulk composer
    'coordinator_weekly_digest',  -- api/cron/coordinator-weekly-digest.js
    'template_notification',      -- everything sent via sendNotification()
    'secure_link_email'           -- token ALREADY redacted before insert
  ));

COMMENT ON CONSTRAINT chk_message_archive_content_kind ON public.message_archive IS
  'Closed set of archivable communication kinds. secure_link_email rows must have '
  'their tokenized URL irreversibly replaced BEFORE insert; this table never stores '
  'a reusable secret.';

COMMIT;

-- ── VERIFICATION (run after; all four must hold) ─────────────────────────────
--
-- 1. The new constraint is present with all five kinds:
--      SELECT pg_get_constraintdef(oid)
--      FROM pg_constraint
--      WHERE conname = 'chk_message_archive_content_kind';
--
-- 2. Existing rows still satisfy it (expect 0):
--      SELECT count(*) FROM public.message_archive
--      WHERE content_kind NOT IN ('manual_direct_email','manual_bulk_email',
--        'coordinator_weekly_digest','template_notification','secure_link_email');
--
-- 3. An unknown kind is still rejected (expect ERROR 23514):
--      INSERT INTO public.message_archive (notification_log_id, content_kind, text_redacted)
--      VALUES (gen_random_uuid(), 'not_a_kind', 'x');
--
-- 4. RLS is still on with no policies (expect relrowsecurity = true, 0 policies):
--      SELECT relrowsecurity FROM pg_class WHERE relname = 'message_archive';
--      SELECT count(*) FROM pg_policies WHERE tablename = 'message_archive';
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- Reversible with no loss to the pre-existing manual-email archive. Delete the
-- newly-permitted rows first, then restore the original one-value constraint:
--
--   BEGIN;
--   DELETE FROM public.message_archive
--    WHERE content_kind <> 'manual_direct_email';
--   ALTER TABLE public.message_archive
--     DROP CONSTRAINT IF EXISTS chk_message_archive_content_kind;
--   ALTER TABLE public.message_archive
--     ADD CONSTRAINT chk_message_archive_content_kind
--     CHECK (content_kind IN ('manual_direct_email'));
--   COMMIT;
--
-- notification_log_id is the PK with ON DELETE CASCADE from notification_log, so
-- nothing orphans and no notification_log row is affected by the rollback.
-- =============================================================================
