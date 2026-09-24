-- REVIEW FIRST: permanently remove every inactive Catalog row that has no form or
-- signature dependency. This preserves record_documents, including files already
-- moved to a student profile.
--
-- First run db/audit/catalog_cleanup_storage_manifest.sql and remove every object it
-- lists through the Supabase Storage API or Dashboard. Never delete storage.objects
-- with SQL. Run this WHOLE file in one execution. It uses no temporary tables.
-- Keep ROLLBACK for the review run. When the results are correct, change only the
-- final ROLLBACK to COMMIT and run the whole file again.

BEGIN;

-- Preview: everything currently removed, including moved personal files.
SELECT r.id, r.title, r.category, r.resource_type, r.storage_path,
       r.moved_to_record_document_id, r.created_at, r.updated_at
FROM public.catalog_resources r
WHERE r.is_active = false
ORDER BY r.updated_at, r.title;

-- Preview: these dependency-backed rows are preserved.
SELECT r.id, r.title,
       (SELECT count(*) FROM public.catalog_forms f WHERE f.catalog_resource_id = r.id) AS form_definitions,
       (SELECT count(*) FROM public.form_assignments a WHERE a.catalog_resource_id = r.id) AS form_assignments,
       (SELECT count(*) FROM public.sig_templates t WHERE t.catalog_resource_id = r.id) AS signature_templates,
       (SELECT count(*) FROM public.sig_requests q WHERE q.catalog_resource_id = r.id) AS signature_requests
FROM public.catalog_resources r
WHERE r.is_active = false
  AND (
    EXISTS (SELECT 1 FROM public.catalog_forms f WHERE f.catalog_resource_id = r.id)
    OR EXISTS (SELECT 1 FROM public.form_assignments a WHERE a.catalog_resource_id = r.id)
    OR EXISTS (SELECT 1 FROM public.sig_templates t WHERE t.catalog_resource_id = r.id)
    OR EXISTS (SELECT 1 FROM public.sig_requests q WHERE q.catalog_resource_id = r.id)
  )
ORDER BY r.title;

-- Preview: this must return zero rows before cleanup can continue.
SELECT r.id, r.title, o.bucket_id, o.name AS storage_path
FROM public.catalog_resources r
JOIN storage.objects o ON o.bucket_id = 'aspire-catalog' AND o.name = r.storage_path
WHERE r.is_active = false
  AND r.resource_type = 'internal_file'
  AND r.moved_to_record_document_id IS NULL
  AND r.storage_path !~ '^(form|sig-template):'
  AND NOT EXISTS (SELECT 1 FROM public.catalog_forms f WHERE f.catalog_resource_id = r.id)
  AND NOT EXISTS (SELECT 1 FROM public.form_assignments a WHERE a.catalog_resource_id = r.id)
  AND NOT EXISTS (SELECT 1 FROM public.sig_templates t WHERE t.catalog_resource_id = r.id)
  AND NOT EXISTS (SELECT 1 FROM public.sig_requests q WHERE q.catalog_resource_id = r.id)
ORDER BY r.title;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.catalog_resources r
    JOIN storage.objects o ON o.bucket_id = 'aspire-catalog' AND o.name = r.storage_path
    WHERE r.is_active = false
      AND r.resource_type = 'internal_file'
      AND r.moved_to_record_document_id IS NULL
      AND r.storage_path !~ '^(form|sig-template):'
      AND NOT EXISTS (SELECT 1 FROM public.catalog_forms f WHERE f.catalog_resource_id = r.id)
      AND NOT EXISTS (SELECT 1 FROM public.form_assignments a WHERE a.catalog_resource_id = r.id)
      AND NOT EXISTS (SELECT 1 FROM public.sig_templates t WHERE t.catalog_resource_id = r.id)
      AND NOT EXISTS (SELECT 1 FROM public.sig_requests q WHERE q.catalog_resource_id = r.id)
  ) THEN
    RAISE EXCEPTION 'Stop: Catalog Storage objects remain. Run catalog_cleanup_storage_manifest.sql and remove them through Storage first.';
  END IF;
END $$;

DELETE FROM public.catalog_resources r
WHERE r.is_active = false
  AND NOT EXISTS (SELECT 1 FROM public.catalog_forms f WHERE f.catalog_resource_id = r.id)
  AND NOT EXISTS (SELECT 1 FROM public.form_assignments a WHERE a.catalog_resource_id = r.id)
  AND NOT EXISTS (SELECT 1 FROM public.sig_templates t WHERE t.catalog_resource_id = r.id)
  AND NOT EXISTS (SELECT 1 FROM public.sig_requests q WHERE q.catalog_resource_id = r.id)
RETURNING r.id, r.title, r.moved_to_record_document_id;

-- Must return zero rows: any remaining inactive row must have a dependency.
SELECT r.id, r.title
FROM public.catalog_resources r
WHERE r.is_active = false
  AND NOT EXISTS (SELECT 1 FROM public.catalog_forms f WHERE f.catalog_resource_id = r.id)
  AND NOT EXISTS (SELECT 1 FROM public.form_assignments a WHERE a.catalog_resource_id = r.id)
  AND NOT EXISTS (SELECT 1 FROM public.sig_templates t WHERE t.catalog_resource_id = r.id)
  AND NOT EXISTS (SELECT 1 FROM public.sig_requests q WHERE q.catalog_resource_id = r.id);

ROLLBACK;
