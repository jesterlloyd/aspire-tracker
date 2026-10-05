-- STUDENT-DOCUMENTS-1: checks for supabase/migrations/20261104000000_student_documents.sql.
-- Read-only. Run one section at a time.

-- PRE 1: is it already applied? Expect all false before, all true after.
SELECT
  to_regclass('public.student_document_types')    IS NOT NULL AS types_table,
  to_regclass('public.student_documents')         IS NOT NULL AS documents_table,
  to_regclass('public.student_document_versions') IS NOT NULL AS versions_table,
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'student-documents') AS bucket;

-- POST 1: the checklist. Expect 8 rows, five required, in this order:
-- resume, personal_statement, transcript, recommendation_1, recommendation_2, bls, acls, rn_license.
SELECT key, label, required, check_kind, max_pages, not_yet_label
FROM public.student_document_types ORDER BY sort_order;

-- POST 2: server-only, never deleted. Expect rls true and policies 0 on all three;
-- service_role delete false on documents and versions; anon and authenticated select false.
SELECT c.relname,
  c.relrowsecurity AS rls,
  (SELECT COUNT(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policies,
  has_table_privilege('service_role', c.oid, 'DELETE') AS service_delete,
  has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
  has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relname IN ('student_document_types', 'student_documents', 'student_document_versions')
ORDER BY c.relname;

-- POST 3: the append-only guard and a private bucket. Expect guard 1, bucket_public false, limit 10485760.
SELECT
  (SELECT COUNT(*) FROM pg_trigger WHERE tgname = 'trg_student_document_versions_guard') AS guard,
  (SELECT public FROM storage.buckets WHERE id = 'student-documents') AS bucket_public,
  (SELECT file_size_limit FROM storage.buckets WHERE id = 'student-documents') AS bucket_limit;
