-- CATALOG-REVAMP-1 (Phase 1), 2026-09-23. OWNER-GATED: do not apply from a session.
--
-- What this adds, all additive:
--   1. catalog_resources: kind, version, version_updated_at, file_size_bytes,
--      moved_to_record_document_id, and a NOT VALID audience CHECK. The
--      featured flag is folded into pinned (is_featured is kept, unread).
--   2. catalog_categories: retired_at. 'forms' is retired (Forms is now an item
--      kind); 'student_onboarding' and 'school_documents' are added. Slugs are
--      never renamed.
--   3. record_documents + the private 'record-documents' bucket: the files that
--      live on a student's or a school's record (personal files moved out of
--      the Catalog now; filed forms and signed PDFs in later phases).
--   4. catalog_sends + catalog_send_recipients: the Catalog send log. Every send
--      goes out through Outreach (api/connect-send-bulk-message.js), which
--      writes these rows after the batch.
--
-- Nothing is deleted, renamed or rewritten beyond the pinned backfill and the
-- file-size backfill below. The app runs on both sides of this migration: every
-- reader treats a missing column or table (42703 / 42P01) as "not enabled yet".
--
-- Checks: db/audit/catalog_revamp_1_checks.sql (PRE before, POST after).
-- Rollback: at the end of this file.

BEGIN;

-- ── 1. catalog_resources ────────────────────────────────────────────────────────

ALTER TABLE catalog_resources
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'file',
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS version_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS file_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS moved_to_record_document_id uuid;

ALTER TABLE catalog_resources DROP CONSTRAINT IF EXISTS chk_catalog_resource_kind;
ALTER TABLE catalog_resources
  ADD CONSTRAINT chk_catalog_resource_kind CHECK (kind IN ('file', 'form', 'signature'));

ALTER TABLE catalog_resources DROP CONSTRAINT IF EXISTS chk_catalog_resource_version;
ALTER TABLE catalog_resources
  ADD CONSTRAINT chk_catalog_resource_version CHECK (version >= 1);

-- Audience is ONE value, stored in the existing text[] column as a one-element
-- array (or empty = not set, which the UI reads as Everyone). NOT VALID: new
-- writes are checked; rows already stored are not, so this cannot fail on data
-- the PRE check has not seen. POST 3 reports any row that would not validate.
ALTER TABLE catalog_resources DROP CONSTRAINT IF EXISTS chk_catalog_resource_audience;
ALTER TABLE catalog_resources
  ADD CONSTRAINT chk_catalog_resource_audience CHECK (
    cardinality(audience) <= 1
    AND audience <@ ARRAY['everyone', 'students', 'preceptors', 'schools', 'staff']::text[]
  ) NOT VALID;

COMMENT ON COLUMN catalog_resources.kind IS
  'CATALOG-REVAMP-1: file | form | signature. Phase 1 writes file only.';
COMMENT ON COLUMN catalog_resources.version IS
  'CATALOG-REVAMP-1: bumped by Upload new version; every send records the version it sent.';
COMMENT ON COLUMN catalog_resources.moved_to_record_document_id IS
  'CATALOG-REVAMP-1: set when a personal file was moved to a record (row is then inactive).';
COMMENT ON COLUMN catalog_resources.is_featured IS
  'RETIRED by CATALOG-REVAMP-1: folded into is_pinned. Kept for rollback; nothing reads it.';

-- Featured becomes Pinned: a featured row is pinned. Nothing is unpinned.
UPDATE catalog_resources SET is_pinned = true WHERE is_featured = true AND is_pinned = false;

-- File size, from the object the row already points at. Rows whose object is
-- missing keep NULL and the UI omits the size.
UPDATE catalog_resources r
   SET file_size_bytes = (o.metadata->>'size')::bigint
  FROM storage.objects o
 WHERE o.bucket_id = 'aspire-catalog'
   AND o.name = r.storage_path
   AND r.file_size_bytes IS NULL
   AND (o.metadata->>'size') ~ '^[0-9]+$';


-- ── 2. catalog_categories ───────────────────────────────────────────────────────

ALTER TABLE catalog_categories ADD COLUMN IF NOT EXISTS retired_at timestamptz;

COMMENT ON COLUMN catalog_categories.retired_at IS
  'CATALOG-REVAMP-1: a retired category is hidden from pickers; rows that still use it stay valid (FK) until reassigned.';

INSERT INTO catalog_categories (slug, display_name, description, sort_order) VALUES
  ('student_onboarding', 'Student Onboarding', 'Paperwork a student completes before or at the start of a rotation.', 80),
  ('school_documents',   'School Documents',   'Documents exchanged with academic partners.',                          90)
ON CONFLICT (slug) DO NOTHING;

UPDATE catalog_categories SET retired_at = now() WHERE slug = 'forms' AND retired_at IS NULL;


-- ── 3. record_documents + bucket ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS record_documents (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type   text        NOT NULL,
  student_id     uuid        REFERENCES students(id) ON DELETE CASCADE,
  school_name    text,                       -- operative school name (src/lib/schoolIdentity.js)
  title          text        NOT NULL,
  file_name      text        NOT NULL,
  storage_path   text        NOT NULL UNIQUE, -- in the private 'record-documents' bucket
  content_type   text,
  size_bytes     bigint,
  source         text        NOT NULL,
  source_ref     uuid,                        -- e.g. the catalog_resources row a file moved from
  is_demo        boolean     NOT NULL DEFAULT false,
  created_by     uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_record_documents_subject CHECK (
    (subject_type = 'student' AND student_id IS NOT NULL AND school_name IS NULL)
    OR (subject_type = 'school' AND school_name IS NOT NULL AND student_id IS NULL)
  ),
  CONSTRAINT chk_record_documents_source CHECK (
    source IN ('catalog_move', 'staff_upload', 'form_submission', 'signature')
  )
);

CREATE INDEX IF NOT EXISTS idx_record_documents_student ON record_documents (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_record_documents_school  ON record_documents (school_name, created_at DESC);

ALTER TABLE record_documents ENABLE ROW LEVEL SECURITY;

-- Owner/Admin read. No client write policy: every write is the service role,
-- through an endpoint that verifies the caller. Files open through a signed URL
-- minted by /api/record-document-open, never through the table.
DROP POLICY IF EXISTS "record_documents_owner_admin_read" ON record_documents;
CREATE POLICY "record_documents_owner_admin_read"
  ON record_documents FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid()
        AND role IN ('owner', 'admin')
        AND is_active IS DISTINCT FROM false
    )
  );

ALTER TABLE catalog_resources DROP CONSTRAINT IF EXISTS fk_catalog_resources_moved_record;
ALTER TABLE catalog_resources
  ADD CONSTRAINT fk_catalog_resources_moved_record
  FOREIGN KEY (moved_to_record_document_id) REFERENCES record_documents (id) ON DELETE SET NULL;

-- Private bucket, no storage.objects policy: only the service role reads or writes it.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('record-documents', 'record-documents', false, 10485760)
ON CONFLICT (id) DO NOTHING;


-- ── 4. The send log ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS catalog_sends (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id       uuid        NOT NULL REFERENCES catalog_resources(id) ON DELETE CASCADE,
  resource_version  integer     NOT NULL DEFAULT 1,
  channel           text        NOT NULL DEFAULT 'outreach_email',
  batch_id          uuid        NOT NULL UNIQUE,   -- the Outreach batch; also on every notification_log row
  subject           text,
  audience_labels   text[]      NOT NULL DEFAULT '{}',  -- what the sender picked, e.g. 'Fall 2026 cohort'
  sent_count        integer     NOT NULL DEFAULT 0,
  failed_count      integer     NOT NULL DEFAULT 0,
  skipped_count     integer     NOT NULL DEFAULT 0,
  is_demo           boolean     NOT NULL DEFAULT false,
  sent_by           uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,
  sent_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_catalog_sends_channel CHECK (channel IN ('outreach_email'))
);

CREATE INDEX IF NOT EXISTS idx_catalog_sends_resource ON catalog_sends (resource_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS catalog_send_recipients (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id             uuid        NOT NULL REFERENCES catalog_sends(id) ON DELETE CASCADE,
  recipient_type      text        NOT NULL,
  student_id          uuid        REFERENCES students(id) ON DELETE SET NULL,
  contact_id          uuid        REFERENCES contacts(id) ON DELETE SET NULL,
  school_name         text,
  name                text,
  email               text        NOT NULL,
  status              text        NOT NULL,
  reason              text,
  notification_log_id uuid,
  resend_message_id   text,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_catalog_send_recipients_type   CHECK (recipient_type IN ('student', 'contact', 'manual')),
  CONSTRAINT chk_catalog_send_recipients_status CHECK (status IN ('sent', 'skipped', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_catalog_send_recipients_send    ON catalog_send_recipients (send_id);
CREATE INDEX IF NOT EXISTS idx_catalog_send_recipients_student ON catalog_send_recipients (student_id) WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_catalog_send_recipients_school  ON catalog_send_recipients (school_name) WHERE school_name IS NOT NULL;

ALTER TABLE catalog_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_send_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "catalog_sends_owner_admin_read" ON catalog_sends;
CREATE POLICY "catalog_sends_owner_admin_read"
  ON catalog_sends FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid()
        AND role IN ('owner', 'admin')
        AND is_active IS DISTINCT FROM false
    )
  );

DROP POLICY IF EXISTS "catalog_send_recipients_owner_admin_read" ON catalog_send_recipients;
CREATE POLICY "catalog_send_recipients_owner_admin_read"
  ON catalog_send_recipients FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid()
        AND role IN ('owner', 'admin')
        AND is_active IS DISTINCT FROM false
    )
  );

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Rollback (run as one block; loses the send log and record documents) ──────
--
-- BEGIN;
--   ALTER TABLE catalog_resources DROP CONSTRAINT IF EXISTS fk_catalog_resources_moved_record;
--   DROP TABLE IF EXISTS catalog_send_recipients;
--   DROP TABLE IF EXISTS catalog_sends;
--   DROP TABLE IF EXISTS record_documents;
--   -- The bucket is left in place on purpose: delete its objects by hand first if it must go.
--   UPDATE catalog_categories SET retired_at = NULL WHERE slug = 'forms';
--   -- Leave the two new categories if any row uses them; otherwise:
--   DELETE FROM catalog_categories c WHERE c.slug IN ('student_onboarding', 'school_documents')
--     AND NOT EXISTS (SELECT 1 FROM catalog_resources r WHERE r.category = c.slug);
--   ALTER TABLE catalog_categories DROP COLUMN IF EXISTS retired_at;
--   ALTER TABLE catalog_resources DROP CONSTRAINT IF EXISTS chk_catalog_resource_audience;
--   ALTER TABLE catalog_resources DROP CONSTRAINT IF EXISTS chk_catalog_resource_version;
--   ALTER TABLE catalog_resources DROP CONSTRAINT IF EXISTS chk_catalog_resource_kind;
--   ALTER TABLE catalog_resources
--     DROP COLUMN IF EXISTS moved_to_record_document_id,
--     DROP COLUMN IF EXISTS file_size_bytes,
--     DROP COLUMN IF EXISTS version_updated_at,
--     DROP COLUMN IF EXISTS version,
--     DROP COLUMN IF EXISTS kind;
--   -- The pinned backfill is not reversed: is_featured is untouched, so
--   -- "UPDATE catalog_resources SET is_pinned = false WHERE is_featured" restores
--   -- the old state only for rows that were not pinned before; check PRE 2 first.
-- COMMIT;
