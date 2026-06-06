-- =============================================================================
-- Communication History Phase A1: notification_log consistency migration
-- Migration: 20260605000000_notification_log_consistency
-- =============================================================================
--
-- Adds a nullable `recipient_type` column to notification_log and backfills
-- inconsistencies in the top-level contact_id, student_id, and recipient_type
-- values from existing metadata. Grounded in the Phase A0 inspection of every
-- writer/reader of notification_log.
--
-- Phase A0 confirmed:
--   - contact_id, student_id, subject ALREADY exist as top-level columns
--     (no promotion needed here).
--   - batch_id and idempotency_key have zero data and no writers
--     (intentionally NOT added in this migration).
--   - Some writers (notably direct_message_sent) store contact_id / student_id /
--     recipient_type only inside metadata, leaving the top-level columns null.
--   - All A0 orphan-integrity checks returned 0.
--
-- Design decisions:
--   - Additive only. No DROP, no DELETE. Existing columns are not modified.
--   - Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, and
--     every UPDATE is guarded by `WHERE <col> IS NULL` so re-running never
--     overwrites a value already present.
--   - metadata is read but NEVER written — the jsonb column is fully preserved.
--   - All metadata-to-uuid casts are regex-guarded to prevent cast errors on
--     any malformed value.
--   - No foreign key constraints are added (deferred to a future migration if
--     desired; the existing contact_id/student_id FKs are untouched).
--
-- recipient_type backfill — EXPECTED OUTCOME (not "every row gets a value"):
--   - Rows with contact evidence  -> 'contact'
--   - Rows with student evidence  -> 'student'
--   - Rows where the recipient type cannot be safely determined -> remain NULL.
--   NULL is the CORRECT, accepted result for legacy / system / form notification
--   rows (e.g. form_received, unit_form_received, internal_team or test rows)
--   that do not clearly map to a single Contact or Student. Do not expect a
--   non-null recipient_type for those rows.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute.
-- Test against a preview branch before applying to Production.
-- =============================================================================

-- ── Step 1: Add nullable recipient_type column ───────────────────────────────
ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS recipient_type text;

-- ── Step 2: Backfill top-level contact_id from metadata.contact_id ───────────
-- Only where the column is null, the metadata key exists, and the value is a
-- valid uuid (regex-guarded to prevent cast errors). Guarded so re-runs are safe.
UPDATE notification_log
SET contact_id = (metadata->>'contact_id')::uuid
WHERE contact_id IS NULL
  AND metadata ? 'contact_id'
  AND (metadata->>'contact_id') ~ '^[0-9a-fA-F-]{36}$';

-- ── Step 3: Backfill top-level student_id from metadata.student_id ───────────
-- Same guards as contact_id.
UPDATE notification_log
SET student_id = (metadata->>'student_id')::uuid
WHERE student_id IS NULL
  AND metadata ? 'student_id'
  AND (metadata->>'student_id') ~ '^[0-9a-fA-F-]{36}$';

-- ── Step 4: Backfill recipient_type using priority logic ─────────────────────
-- Priority:
--   1) metadata.recipient_type if explicitly present (the only writer of this is
--      direct_message_sent, which records 'contact' or 'student');
--   2) 'contact' if a contact_id is known (column now backfilled, or valid in metadata);
--   3) 'student' if a student_id is known (column now backfilled, or valid in metadata);
--   4) otherwise leave NULL — unknown / system / form / test rows that do not
--      map to a single Contact or Student. NULL here is expected and acceptable.
-- Only touches rows where recipient_type IS NULL, so re-running is a no-op.
UPDATE notification_log
SET recipient_type = CASE
  WHEN metadata->>'recipient_type' IS NOT NULL
    THEN metadata->>'recipient_type'
  WHEN contact_id IS NOT NULL
    OR (metadata ? 'contact_id'
        AND (metadata->>'contact_id') ~ '^[0-9a-fA-F-]{36}$')
    THEN 'contact'
  WHEN student_id IS NOT NULL
    OR (metadata ? 'student_id'
        AND (metadata->>'student_id') ~ '^[0-9a-fA-F-]{36}$')
    THEN 'student'
  ELSE NULL
END
WHERE recipient_type IS NULL;

-- ── Step 5: Partial index on recipient_type for filtered lookups ─────────────
-- Partial (WHERE NOT NULL) keeps the index small and skips the many NULL rows.
CREATE INDEX IF NOT EXISTS idx_notification_log_recipient_type
  ON notification_log(recipient_type)
  WHERE recipient_type IS NOT NULL;

-- End of migration
