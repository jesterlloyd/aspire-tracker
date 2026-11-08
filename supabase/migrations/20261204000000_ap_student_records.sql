-- AP-STUDENT-RECORDS-1 (Owner, 2026-11-08): Academic Partners keep part of their students' records.
--
--   1. students.expected_graduation: a new answer the school keeps (and may set for a whole cohort).
--   2. student_record_corrections: every correction a school makes, append-only. The first row per
--      student and field holds what the student answered, so the original is never lost.
--   3. The clearance checklist: student_document_types gains `checklist` ('ngrp' | 'clearance') and
--      `school_key` (NULL = ASPIRE's base list; a school's own optional items carry its key).
--      Existing rows become 'ngrp', so the Residency checklist is unchanged. A new check_kind 'file'
--      (no date) and a new uploaded_via 'school'.
--
-- Server-only, like the tables it extends. PRE/POST: db/audit/ap_student_records_checks.sql.
-- The BASE CLEARANCE LIST in section 4 is a proposal for the Owner to edit before applying.

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.students') IS NULL THEN RAISE EXCEPTION 'PRECHECK FAILED: public.students is missing'; END IF;
  IF to_regclass('public.student_document_types') IS NULL THEN RAISE EXCEPTION 'PRECHECK FAILED: student_document_types is missing (20261104000000 first)'; END IF;
END
$pre$;

-- 1. Expected graduation -----------------------------------------------------------
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS expected_graduation date;
COMMENT ON COLUMN public.students.expected_graduation IS
  'AP-STUDENT-RECORDS-1: the expected graduation date, kept by the student''s school.';

-- 2. Corrections, append-only -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_record_corrections (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id             uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  field                  text        NOT NULL CHECK (field IN ('school_email', 'cumulative_gpa', 'expected_graduation')),
  old_value              text,
  new_value              text,
  -- one: this student. cohort: one of several rows written together for a whole cohort.
  scope                  text        NOT NULL DEFAULT 'one' CHECK (scope IN ('one', 'cohort')),
  batch_id               uuid,
  school_key             text,
  corrected_by_profile_id uuid       NOT NULL,
  corrected_by_name      text,
  is_demo                boolean     NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.student_record_corrections IS
  'AP-STUDENT-RECORDS-1: corrections a school made to a student''s answers. Append-only. Server-only.';
CREATE INDEX IF NOT EXISTS idx_student_record_corrections_student
  ON public.student_record_corrections (student_id, created_at);

ALTER TABLE public.student_record_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.student_record_corrections FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.student_record_corrections TO service_role;

-- 3. The clearance checklist on the documents tables --------------------------------
ALTER TABLE public.student_document_types ADD COLUMN IF NOT EXISTS checklist text NOT NULL DEFAULT 'ngrp';
ALTER TABLE public.student_document_types ADD COLUMN IF NOT EXISTS school_key text;
ALTER TABLE public.student_document_types ADD COLUMN IF NOT EXISTS created_by_profile_id uuid;

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_document_types_checklist_check') THEN
    ALTER TABLE public.student_document_types
      ADD CONSTRAINT student_document_types_checklist_check CHECK (checklist IN ('ngrp', 'clearance'));
  END IF;
  -- A school's own item is clearance-only and optional.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_document_types_school_item_check') THEN
    ALTER TABLE public.student_document_types
      ADD CONSTRAINT student_document_types_school_item_check
      CHECK (school_key IS NULL OR (checklist = 'clearance' AND required = false));
  END IF;
END
$c$;

ALTER TABLE public.student_document_types DROP CONSTRAINT IF EXISTS student_document_types_check_kind_check;
ALTER TABLE public.student_document_types ADD CONSTRAINT student_document_types_check_kind_check
  CHECK (check_kind IN ('resume', 'pages', 'completion_date', 'expiry_date', 'signature', 'file'));

ALTER TABLE public.student_document_versions DROP CONSTRAINT IF EXISTS student_document_versions_uploaded_via_check;
ALTER TABLE public.student_document_versions ADD CONSTRAINT student_document_versions_uploaded_via_check
  CHECK (uploaded_via IN ('staff', 'portal', 'record', 'school'));

CREATE INDEX IF NOT EXISTS idx_student_document_types_checklist
  ON public.student_document_types (checklist, school_key);

-- Schools add and retire their own items through the server.
GRANT INSERT, UPDATE ON TABLE public.student_document_types TO service_role;

-- 4. ASPIRE's base clearance list (PROPOSED: edit before applying) --------------------
INSERT INTO public.student_document_types (key, label, qualifier, required, check_kind, sort_order, checklist) VALUES
  ('clr_immunizations', 'Immunization Records', 'MMR, varicella, hepatitis B, Tdap', true, 'file',        110, 'clearance'),
  ('clr_tb',            'TB Screening',         'Within the last 12 months',        true, 'expiry_date', 120, 'clearance'),
  ('clr_flu',           'Influenza Vaccine',    'Current season',                   true, 'expiry_date', 130, 'clearance'),
  ('clr_bls',           'BLS Card',             'American Heart Association',       true, 'expiry_date', 140, 'clearance'),
  ('clr_background',    'Background Check',     NULL,                               true, 'file',        150, 'clearance'),
  ('clr_drug_screen',   'Drug Screen',          NULL,                               true, 'file',        160, 'clearance')
ON CONFLICT (key) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Rollback (only while no school has corrected a record or uploaded a clearance file):
--   BEGIN;
--   DELETE FROM public.student_document_types WHERE checklist = 'clearance';
--   ALTER TABLE public.student_document_types DROP CONSTRAINT IF EXISTS student_document_types_school_item_check;
--   ALTER TABLE public.student_document_types DROP CONSTRAINT IF EXISTS student_document_types_checklist_check;
--   ALTER TABLE public.student_document_types DROP COLUMN IF EXISTS created_by_profile_id;
--   ALTER TABLE public.student_document_types DROP COLUMN IF EXISTS school_key;
--   ALTER TABLE public.student_document_types DROP COLUMN IF EXISTS checklist;
--   DROP TABLE IF EXISTS public.student_record_corrections;
--   ALTER TABLE public.students DROP COLUMN IF EXISTS expected_graduation;
--   COMMIT;
