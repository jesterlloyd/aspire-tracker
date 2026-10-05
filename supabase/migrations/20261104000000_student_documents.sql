-- STUDENT-DOCUMENTS-1 (résumé review build, Phase 2), 2026-10-04.
-- OWNER-GATED: do not apply from a session.
--
-- A student's application documents, with every version kept. Owner decisions, 2026-10-04:
--   - Staff upload, replace and read these in Residency > the alumnus's Documents, and the
--     student chart's résumé Replace keeps history too. Replacing never deletes: the old
--     file stays as an earlier version.
--   - The checklist is ONE NGRP list: Résumé, Personal Statement, Transcript, two Letters
--     of Recommendation (required), and BLS, ACLS, RN Licensure (optional, or "Not yet").
--   - The list lives in a table, not in component code, so it can change without a release.
--
-- WHAT THIS FILE DOES
--   1. student_document_types: the checklist, seeded with the eight types above.
--   2. student_documents: one row per student per type, pointing at its current version.
--   3. student_document_versions: one row per uploaded file. Never deleted by the app (no
--      DELETE grant), and a trigger refuses any UPDATE except Keith's check (Phase 3).
--      A student's deletion still cascades: referential actions do not need the grant.
--   4. The private bucket student-documents (10 MB).
--   Server-only, like every NGRP table: RLS on, no policies, nothing for anon or
--   authenticated. api/student-documents.js reads and writes as service_role.
--
-- The résumé's CURRENT file is still students.resume_url in student-files, because
-- Interviews, Keith, the Unit Leader portal and the chart all read it there. A version
-- is a separate copy in student-documents; the current one is mirrored to the canonical
-- path when it becomes current.
--
-- Additive, one transaction, safe to re-run. Either deploy order: before it runs, the
-- Documents drawer says it needs this update and the chart's Replace works as before.
-- Check and rollback at the end.

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.students') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: public.students is missing';
  END IF;
END
$pre$;

-- 1. The checklist ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_document_types (
  key            text        PRIMARY KEY CHECK (key ~ '^[a-z0-9_]{2,40}$'),
  label          text        NOT NULL CHECK (btrim(label) <> '' AND char_length(label) <= 80),
  qualifier      text        CHECK (qualifier IS NULL OR char_length(qualifier) <= 80),
  required       boolean     NOT NULL DEFAULT false,
  -- What is checked on upload. pages: page count against max_pages. completion_date /
  -- expiry_date: a date staff confirm against the file. resume and signature: Keith (Phase 3).
  check_kind     text        NOT NULL CHECK (check_kind IN ('resume', 'pages', 'completion_date', 'expiry_date', 'signature')),
  max_pages      integer     CHECK (max_pages IS NULL OR max_pages BETWEEN 1 AND 50),
  -- Shown instead of None while it cannot exist yet ("After NCLEX").
  not_yet_label  text        CHECK (not_yet_label IS NULL OR char_length(not_yet_label) <= 40),
  sort_order     integer     NOT NULL,
  active         boolean     NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.student_document_types IS
  'STUDENT-DOCUMENTS-1: the NGRP application documents checklist. Edit here, not in code. Server-only.';

INSERT INTO public.student_document_types (key, label, qualifier, required, check_kind, max_pages, not_yet_label, sort_order) VALUES
  ('resume',             'Résumé',                      'With rotation hours',    true,  'resume',          NULL, NULL,          10),
  ('personal_statement', 'Personal Statement',          'Max 2 pages',            true,  'pages',           2,    NULL,          20),
  ('transcript',         'Transcript',                  'Official or unofficial', true,  'completion_date', NULL, NULL,          30),
  ('recommendation_1',   'Letter of Recommendation 1',  'Recommender role',       true,  'signature',       NULL, NULL,          40),
  ('recommendation_2',   'Letter of Recommendation 2',  'Recommender role',       true,  'signature',       NULL, NULL,          50),
  ('bls',                'BLS Card',                    'AHA',                    false, 'expiry_date',     NULL, NULL,          60),
  ('acls',               'ACLS Card',                   'If held',                false, 'expiry_date',     NULL, NULL,          70),
  ('rn_license',         'Proof of Licensure',          'California RN',          false, 'expiry_date',     NULL, 'After NCLEX', 80)
ON CONFLICT (key) DO NOTHING;

-- 2. One document per student per type ------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_documents (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  doc_type           text        NOT NULL REFERENCES public.student_document_types(key) ON UPDATE CASCADE,
  -- NULL for a résumé means the current file is the one on the student record that no
  -- version row holds yet (uploaded by the intake form, the portal, or before this build).
  current_version_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_documents_one_per_type UNIQUE (student_id, doc_type)
);
COMMENT ON TABLE public.student_documents IS
  'STUDENT-DOCUMENTS-1: a student''s document of one type and its current version. Server-only.';

-- 3. Every version, kept --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_document_versions (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id             uuid        NOT NULL REFERENCES public.student_documents(id) ON DELETE CASCADE,
  storage_bucket          text        NOT NULL CHECK (storage_bucket = 'student-documents'),
  storage_path            text        NOT NULL UNIQUE,
  file_name               text        NOT NULL CHECK (btrim(file_name) <> '' AND char_length(file_name) <= 200),
  content_type            text,
  size_bytes              bigint      CHECK (size_bytes IS NULL OR size_bytes >= 0),
  sha256                  text        CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  pages                   integer     CHECK (pages IS NULL OR pages >= 0),
  -- staff: uploaded in Documents. portal: by the student (a later phase). record: the file
  -- that was already on the student record, kept when something replaced it.
  uploaded_via            text        NOT NULL CHECK (uploaded_via IN ('staff', 'portal', 'record')),
  uploaded_by_profile_id  uuid,
  uploaded_at             timestamptz NOT NULL DEFAULT now(),
  -- The completion or expiration date, and who checked it against the file.
  doc_date                date,
  confirmed_by_profile_id uuid,
  confirmed_at            timestamptz,
  keith_check             jsonb,
  CONSTRAINT student_document_versions_date_confirmed CHECK (doc_date IS NULL OR confirmed_at IS NOT NULL)
);
COMMENT ON TABLE public.student_document_versions IS
  'STUDENT-DOCUMENTS-1: one uploaded file. Never deleted by the app; only keith_check may change. Server-only.';
CREATE INDEX IF NOT EXISTS idx_student_document_versions_document
  ON public.student_document_versions (document_id, uploaded_at DESC);

DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_documents_current_version_fk') THEN
    ALTER TABLE public.student_documents
      ADD CONSTRAINT student_documents_current_version_fk
      FOREIGN KEY (current_version_id) REFERENCES public.student_document_versions(id) ON DELETE SET NULL;
  END IF;
END
$fk$;

CREATE OR REPLACE FUNCTION public.student_document_versions_guard()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF (to_jsonb(NEW) - 'keith_check') IS DISTINCT FROM (to_jsonb(OLD) - 'keith_check') THEN
    RAISE EXCEPTION 'student_document_versions is append-only: only keith_check may change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_student_document_versions_guard ON public.student_document_versions;
CREATE TRIGGER trg_student_document_versions_guard
  BEFORE UPDATE ON public.student_document_versions
  FOR EACH ROW EXECUTE FUNCTION public.student_document_versions_guard();

-- 4. Server-only privileges, no DELETE ------------------------------------------
ALTER TABLE public.student_document_types    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_document_versions ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.student_document_types    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.student_documents         FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.student_document_versions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT                 ON TABLE public.student_document_types    TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.student_documents         TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.student_document_versions TO service_role;

REVOKE ALL ON FUNCTION public.student_document_versions_guard() FROM PUBLIC, anon, authenticated;

-- 5. The bucket -----------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('student-documents', 'student-documents', false, 10485760)
ON CONFLICT (id) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Check (read-only). Expect: 3 tables, 8 types, the guard trigger, a private bucket.
--   SELECT
--     (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'
--        AND table_name IN ('student_document_types', 'student_documents', 'student_document_versions')) AS tables,
--     (SELECT COUNT(*) FROM public.student_document_types) AS types,
--     (SELECT COUNT(*) FROM pg_trigger WHERE tgname = 'trg_student_document_versions_guard') AS guard,
--     (SELECT public FROM storage.buckets WHERE id = 'student-documents') AS bucket_public;
--   Expect tables 3, types 8, guard 1, bucket_public false.
--
-- Rollback (only while no document has been uploaded):
--   BEGIN;
--   DROP TABLE IF EXISTS public.student_document_versions CASCADE;
--   DROP TABLE IF EXISTS public.student_documents CASCADE;
--   DROP TABLE IF EXISTS public.student_document_types;
--   DROP FUNCTION IF EXISTS public.student_document_versions_guard();
--   DELETE FROM storage.buckets WHERE id = 'student-documents';
--   COMMIT;
