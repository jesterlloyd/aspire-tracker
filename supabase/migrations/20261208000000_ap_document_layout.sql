-- AP-DOCUMENT-LAYOUT-1 (Owner, 2026-11-17): a school orders the columns of its Documents sheet and
-- hides ASPIRE's items it does not collect. ASPIRE's list is shared by every school, so a school
-- never deletes one of its items; it hides it from its own sheet. A school's own items are still
-- removed by retiring them (student_document_types.active = false), as before.
--
-- One row per school and document. A document with no row keeps its default place and shows.
-- Server-only, like the tables it extends: the portal writes through
-- api/portal/school-student-records.js (`layout_set`), which checks the school is the caller's and
-- every key is ASPIRE's or that school's own. PRE/POST: db/audit/ap_document_layout_checks.sql.

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.student_document_types') IS NULL THEN RAISE EXCEPTION 'PRECHECK FAILED: student_document_types is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'student_document_types' AND column_name = 'school_key') THEN
    RAISE EXCEPTION 'PRECHECK FAILED: student_document_types.school_key is missing (20261204000000 first)';
  END IF;
END
$pre$;

CREATE TABLE IF NOT EXISTS public.school_document_layout (
  school_key            text        NOT NULL CHECK (length(school_key) BETWEEN 1 AND 200),
  doc_type              text        NOT NULL REFERENCES public.student_document_types(key) ON DELETE CASCADE,
  sort_order            integer     NOT NULL CHECK (sort_order BETWEEN 0 AND 10000),
  hidden                boolean     NOT NULL DEFAULT false,
  updated_by_profile_id uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_key, doc_type)
);
COMMENT ON TABLE public.school_document_layout IS
  'AP-DOCUMENT-LAYOUT-1: a school''s order and hidden columns on its Documents sheet. Server-only.';

ALTER TABLE public.school_document_layout ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.school_document_layout FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.school_document_layout TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Rollback (loses only schools' column order and hidden choices):
--   DROP TABLE IF EXISTS public.school_document_layout;
