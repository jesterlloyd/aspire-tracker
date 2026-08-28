-- =============================================================================
-- OUTREACH-ATTACHMENTS-1, PHASE 2 (DESIGN ONLY - NOT REQUIRED BY PHASE 1)
--
-- *** APPLY MANUALLY (Owner/Jester). Claude Code has applied NOTHING. ***
--
-- Phase 1 (Library-only attachments) shipped with NO schema change: it reuses
-- catalog_resources and the existing private 'aspire-catalog' bucket. This
-- migration is ONLY needed if you decide to also allow staff to attach an
-- ad-hoc local file that does not belong in the Resource Library.
--
-- WHY A SEPARATE HOME. An ad-hoc email attachment is not a library resource.
-- Putting one in catalog_resources would publish a private, one-off document
-- into the Catalog UI for every Owner/Admin/Interviewer, and it would never be
-- cleaned up. It equally must not be improvised into student-files or avatars,
-- whose RLS and lifecycle mean something else entirely.
--
-- PREREQUISITE (Owner, in the Supabase dashboard, BEFORE running this file):
--   Create a PRIVATE storage bucket named 'outreach-attachments'.
--   Public access OFF. No public policies. Server-mediated access only, the
--   same posture as 'aspire-catalog'.
--
-- RETENTION. These objects exist to be emailed once. They are not a record:
-- the email itself is the record, and notification_log already keeps the
-- filename, type and size. Rows here expire 30 days after upload, after which
-- a cleanup job deletes the object and the row. Nothing downstream depends on
-- them, because the bytes were delivered at send time.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS outreach_attachments (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Server-derived storage key inside the private 'outreach-attachments'
  -- bucket. Never supplied by the browser (the upload endpoint derives it,
  -- exactly as catalog-resource-upload.js does today).
  storage_path   text        NOT NULL UNIQUE,

  -- What the recipient will see, and what Sent History records.
  filename       text        NOT NULL,
  content_type   text        NOT NULL,
  size_bytes     bigint      NOT NULL,

  -- Who uploaded it. Only this person may attach it, so one staff member can
  -- never reference another's pending upload.
  uploaded_by    uuid        NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Set once the file has actually been emailed at least once. Retained for
  -- audit only; it is never re-sent from here.
  first_sent_at  timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '30 days'),

  -- Mirrors api/lib/outreachAttachments.js. Anything outside this list is
  -- refused by the server before upload and again before send.
  CONSTRAINT chk_outreach_attachment_type CHECK (content_type IN (
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png',
    'image/jpeg'
  )),

  -- 10 MB per file, matching the Phase 1 cap and catalog-resource-upload.js.
  CONSTRAINT chk_outreach_attachment_size CHECK (size_bytes > 0 AND size_bytes <= 10485760),

  CONSTRAINT chk_outreach_attachment_path CHECK (
    storage_path !~ '\.\.' AND storage_path !~ '^/' AND storage_path !~ '\\'
  )
);

CREATE INDEX IF NOT EXISTS idx_outreach_attachments_uploader
  ON outreach_attachments (uploaded_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_attachments_expiry
  ON outreach_attachments (expires_at);

-- Deny-all by default. Every read and write goes through a service-role
-- endpoint that has already verified the caller, so no policy grants the
-- authenticated role direct access. This mirrors the catalog posture.
ALTER TABLE outreach_attachments ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ── Verification (ONE row; run after applying) ───────────────────────────────
-- SELECT
--   (SELECT count(*) FROM information_schema.tables
--     WHERE table_name = 'outreach_attachments')                       AS table_created,
--   (SELECT relrowsecurity FROM pg_class
--     WHERE relname = 'outreach_attachments')                          AS rls_enabled,
--   (SELECT count(*) FROM pg_policies
--     WHERE tablename = 'outreach_attachments')                        AS policy_count,
--   (SELECT count(*) FROM information_schema.check_constraints
--     WHERE constraint_name LIKE 'chk_outreach_attachment%')           AS check_constraints;
-- Expected: table_created = 1, rls_enabled = true, policy_count = 0, check_constraints = 3.

-- ── Rollback ─────────────────────────────────────────────────────────────────
-- BEGIN;
--   DROP TABLE IF EXISTS outreach_attachments;
-- COMMIT;
-- (Also delete the 'outreach-attachments' bucket in the dashboard if abandoning
--  the feature entirely.)
