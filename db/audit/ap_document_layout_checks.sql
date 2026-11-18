-- AP-DOCUMENT-LAYOUT-1: PRE and POST checks for 20261208000000_ap_document_layout.sql. Read-only.

-- PRE: expect layout_table false, school_key_column true, clearance_base 6.
SELECT
  to_regclass('public.school_document_layout') IS NOT NULL AS layout_table,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'student_document_types' AND column_name = 'school_key') AS school_key_column,
  (SELECT COUNT(*) FROM public.student_document_types WHERE checklist = 'clearance' AND school_key IS NULL) AS clearance_base;

-- POST: expect layout_table true, layout_rls true, layout_rows 0, client_grants 0.
SELECT
  to_regclass('public.school_document_layout') IS NOT NULL AS layout_table,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.school_document_layout'::regclass) AS layout_rls,
  (SELECT COUNT(*) FROM public.school_document_layout) AS layout_rows,
  (SELECT COUNT(*) FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'school_document_layout'
       AND grantee IN ('anon', 'authenticated')) AS client_grants;
