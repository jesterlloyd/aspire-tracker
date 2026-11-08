-- AP-STUDENT-RECORDS-1: PRE and POST checks for 20261204000000_ap_student_records.sql. Read-only.

-- PRE: expect graduation_column false, corrections_table false, checklist_column false,
--      ngrp_types 8 (or the current count), clr_keys_taken 0, check_kind_constraint 1, via_constraint 1.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'students' AND column_name = 'expected_graduation') AS graduation_column,
  to_regclass('public.student_record_corrections') IS NOT NULL AS corrections_table,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'student_document_types' AND column_name = 'checklist') AS checklist_column,
  (SELECT COUNT(*) FROM public.student_document_types) AS ngrp_types,
  (SELECT COUNT(*) FROM public.student_document_types WHERE key LIKE 'clr\_%') AS clr_keys_taken,
  (SELECT COUNT(*) FROM pg_constraint WHERE conname = 'student_document_types_check_kind_check') AS check_kind_constraint,
  (SELECT COUNT(*) FROM pg_constraint WHERE conname = 'student_document_versions_uploaded_via_check') AS via_constraint;

-- POST: expect graduation_column true, corrections_table true, corrections_rls true,
--       ngrp_types unchanged, clearance_base 6, client_grants 0.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'students' AND column_name = 'expected_graduation') AS graduation_column,
  to_regclass('public.student_record_corrections') IS NOT NULL AS corrections_table,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.student_record_corrections'::regclass) AS corrections_rls,
  (SELECT COUNT(*) FROM public.student_document_types WHERE checklist = 'ngrp') AS ngrp_types,
  (SELECT COUNT(*) FROM public.student_document_types WHERE checklist = 'clearance' AND school_key IS NULL) AS clearance_base,
  (SELECT COUNT(*) FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name IN ('student_record_corrections', 'student_document_types')
       AND grantee IN ('anon', 'authenticated')) AS client_grants;
