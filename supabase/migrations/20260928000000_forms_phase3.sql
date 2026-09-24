-- FORMS-PHASE3 (ASPIRE Catalog Phase 3), 2026-09-24. OWNER-GATED: do not apply from a session.
--
-- Fillable forms in the Catalog: a builder, versions, one personal link per person, a PDF of
-- every submission filed to the person's record, and reminders. All additive.
--
--   1. catalog_forms           one row per form: its working draft, settings, current version.
--   2. catalog_form_versions   every published version, frozen. A submission keeps the version
--                              it was answered on; new links use the latest.
--   3. form_assignments        one person's copy: who, which version, due date, link hash,
--                              sent / opened / submitted, reminders.
--   4. form_submissions        the answers, the generated PDF and where it was filed.
--   5. The private 'form-files' bucket: File upload answers and PDFs that have no record.
--
-- Every table has org_id (SIGNATURES-PHASE2's organizations table) and a read policy for
-- Owner/Admin of the caller's organization. Writes are the service role only, through
-- /api/form-staff and /api/form-respond. The app runs on both sides of this migration: a
-- missing table reads as "Forms are not enabled yet".
--
-- Requires: 20260926000000_catalog_revamp_1.sql (catalog kind 'form', record_documents
-- source 'form_submission') and 20260927000000_signatures_phase2.sql (organizations,
-- sig_caller_org_id()). Checks: db/audit/forms_phase3_checks.sql. Rollback: end of file.

BEGIN;

-- ── 1. Forms ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS catalog_forms (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES organizations(id) ON DELETE CASCADE,
  catalog_resource_id uuid        UNIQUE REFERENCES catalog_resources(id) ON DELETE SET NULL,
  starter_key         text        UNIQUE,                    -- 'scrubex-request-form', ... (starter forms only)
  status              text        NOT NULL DEFAULT 'draft',  -- draft: never published
  draft               jsonb       NOT NULL DEFAULT '{"title":"Untitled form","description":"","questions":[]}'::jsonb,
  settings            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  current_version     integer     NOT NULL DEFAULT 0,        -- 0 until the first publish
  draft_dirty         boolean     NOT NULL DEFAULT true,     -- the draft differs from current_version
  created_by          uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,
  updated_by          uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_catalog_forms_status CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT chk_catalog_forms_draft CHECK (jsonb_typeof(draft) = 'object' AND jsonb_typeof(draft->'questions') = 'array'),
  CONSTRAINT chk_catalog_forms_settings CHECK (jsonb_typeof(settings) = 'object')
);

CREATE TABLE IF NOT EXISTS catalog_form_versions (
  form_id       uuid        NOT NULL REFERENCES catalog_forms(id) ON DELETE CASCADE,
  version       integer     NOT NULL,
  org_id        uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES organizations(id) ON DELETE CASCADE,
  definition    jsonb       NOT NULL,
  settings      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  published_by  uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,
  published_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (form_id, version),
  CONSTRAINT chk_catalog_form_versions_version CHECK (version >= 1),
  CONSTRAINT chk_catalog_form_versions_def CHECK (jsonb_typeof(definition) = 'object' AND jsonb_typeof(definition->'questions') = 'array')
);

-- A published version is frozen: submissions point at it and must keep reading what the
-- respondent saw.
CREATE OR REPLACE FUNCTION public.catalog_form_versions_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'catalog_form_versions rows are frozen; publish a new version instead';
END
$$;

DROP TRIGGER IF EXISTS trg_catalog_form_versions_frozen ON catalog_form_versions;
CREATE TRIGGER trg_catalog_form_versions_frozen BEFORE UPDATE ON catalog_form_versions
  FOR EACH ROW EXECUTE FUNCTION public.catalog_form_versions_frozen();

-- ── 2. Assignments and submissions ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS form_assignments (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES organizations(id) ON DELETE CASCADE,
  form_id             uuid        NOT NULL REFERENCES catalog_forms(id) ON DELETE CASCADE,
  form_version        integer     NOT NULL,
  catalog_resource_id uuid        REFERENCES catalog_resources(id) ON DELETE SET NULL,
  batch_id            uuid        NOT NULL,                  -- one Send; its rows share it
  audience_label      text,
  student_id          uuid        REFERENCES students(id) ON DELETE SET NULL,
  contact_id          uuid        REFERENCES contacts(id) ON DELETE SET NULL,
  school_name         text,
  name                text        NOT NULL,
  email               text        NOT NULL,
  token_hash          text        UNIQUE,                    -- SHA-256 of the HMAC link token
  link_version        integer     NOT NULL DEFAULT 1,
  status              text        NOT NULL DEFAULT 'sent',
  due_at              timestamptz,
  reminder_rule       text        NOT NULL DEFAULT 'every_3_days',
  sender_id           uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,
  sender_name         text,
  sender_email        text,
  subject             text,
  message             text,
  sent_at             timestamptz,
  opened_at           timestamptz,
  submitted_at        timestamptz,
  closed_at           timestamptz,
  voided_at           timestamptz,
  last_reminded_at    timestamptz,
  reminder_count      integer     NOT NULL DEFAULT 0,
  delivery_ok         boolean,                               -- the mail service accepted the last send
  is_demo             boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_form_assignments_status CHECK (status IN ('sent', 'opened', 'submitted', 'closed', 'voided')),
  CONSTRAINT chk_form_assignments_reminder CHECK (reminder_rule IN ('every_3_days', 'once_before_due', 'off')),
  CONSTRAINT chk_form_assignments_email CHECK (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'),
  CONSTRAINT fk_form_assignments_version FOREIGN KEY (form_id, form_version) REFERENCES catalog_form_versions(form_id, version)
);
CREATE INDEX IF NOT EXISTS idx_form_assignments_form ON form_assignments (form_id, status);
CREATE INDEX IF NOT EXISTS idx_form_assignments_resource ON form_assignments (catalog_resource_id);
CREATE INDEX IF NOT EXISTS idx_form_assignments_student ON form_assignments (student_id);
CREATE INDEX IF NOT EXISTS idx_form_assignments_open ON form_assignments (status, due_at) WHERE status IN ('sent', 'opened');

CREATE TABLE IF NOT EXISTS form_submissions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES organizations(id) ON DELETE CASCADE,
  assignment_id       uuid        NOT NULL UNIQUE REFERENCES form_assignments(id) ON DELETE CASCADE,
  form_id             uuid        NOT NULL REFERENCES catalog_forms(id) ON DELETE CASCADE,
  form_version        integer     NOT NULL,
  answers             jsonb       NOT NULL,
  pdf_bucket          text,
  pdf_path            text,
  record_document_id  uuid        REFERENCES record_documents(id) ON DELETE SET NULL,
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  ip                  text,
  user_agent          text,
  is_demo             boolean     NOT NULL DEFAULT false,
  CONSTRAINT chk_form_submissions_answers CHECK (jsonb_typeof(answers) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_form_submissions_form ON form_submissions (form_id, submitted_at);

-- ── 3. Row Level Security: Owner/Admin read, nobody writes from the browser ─────────

ALTER TABLE catalog_forms         ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_form_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_assignments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_submissions      ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['catalog_forms', 'catalog_form_versions', 'form_assignments', 'form_submissions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner_admin_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (org_id = public.sig_caller_org_id() AND public.is_active_owner_or_admin())',
      t || '_owner_admin_read', t);
  END LOOP;
END
$$;

-- ── 4. Storage: uploads and PDFs with no record to file to ───────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('form-files', 'form-files', false, 10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Rollback (run as one block; loses every form, its versions, assignments and answers) ──
-- BEGIN;
--   DROP TABLE IF EXISTS form_submissions, form_assignments;
--   DROP TRIGGER IF EXISTS trg_catalog_form_versions_frozen ON catalog_form_versions;
--   DROP TABLE IF EXISTS catalog_form_versions, catalog_forms;
--   DROP FUNCTION IF EXISTS public.catalog_form_versions_frozen();
--   -- Catalog items of kind 'form' are left in place; remove them in the Catalog.
--   -- The bucket is left in place on purpose: delete its objects by hand first if it must go.
-- COMMIT;
