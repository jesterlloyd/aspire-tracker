-- READ ONLY: list every Supabase Storage object blocking the two Catalog cleanup
-- scripts. This file changes nothing and can be run repeatedly.
--
-- Delete the returned objects through Supabase Dashboard > Storage (or the Storage
-- API), then rerun the two cleanup scripts. Never DELETE from storage.objects in SQL:
-- that removes metadata but leaves the physical object orphaned.

-- 1. Removed Catalog items that are dependency-safe but still have a stored file.
WITH removed AS (
  SELECT r.*
  FROM public.catalog_resources r
  WHERE r.is_active = false
    AND NOT EXISTS (SELECT 1 FROM public.catalog_forms f WHERE f.catalog_resource_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM public.form_assignments a WHERE a.catalog_resource_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM public.sig_templates t WHERE t.catalog_resource_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM public.sig_requests q WHERE q.catalog_resource_id = r.id)
)
SELECT 'removed_catalog_item' AS cleanup_group,
       r.id AS related_id,
       r.title AS related_title,
       o.bucket_id,
       o.name AS storage_path
FROM removed r
JOIN storage.objects o
  ON o.bucket_id = 'aspire-catalog' AND o.name = r.storage_path
WHERE r.resource_type = 'internal_file'
  AND r.moved_to_record_document_id IS NULL
  AND r.storage_path !~ '^(form|sig-template):'
ORDER BY r.title, o.name;

-- 2. Form and signature test activity for Jester's email.
WITH target_email AS (
  SELECT 'jesterlloyd.bautista@cshs.org'::text AS email
),
form_ids AS (
  SELECT a.id
  FROM public.form_assignments a, target_email t
  WHERE lower(btrim(a.email)) = t.email
),
signature_ids AS (
  SELECT DISTINCT s.request_id AS id
  FROM public.sig_request_signers s, target_email t
  WHERE lower(btrim(s.email)) = t.email
),
paths AS (
  SELECT 'form_submission_pdf'::text AS cleanup_group,
         s.assignment_id AS related_id,
         o.bucket_id,
         o.name AS storage_path
  FROM storage.objects o
  JOIN public.form_submissions s ON s.pdf_bucket = o.bucket_id AND s.pdf_path = o.name
  JOIN form_ids x ON x.id = s.assignment_id

  UNION ALL

  SELECT 'form_uploaded_answer', x.id, o.bucket_id, o.name
  FROM storage.objects o
  JOIN form_ids x ON o.bucket_id = 'form-files' AND o.name LIKE 'uploads/' || x.id::text || '/%'

  UNION ALL

  SELECT 'form_record_copy', s.assignment_id, o.bucket_id, o.name
  FROM storage.objects o
  JOIN public.record_documents d ON o.bucket_id = 'record-documents' AND o.name = d.storage_path
  JOIN public.form_submissions s ON s.record_document_id = d.id
  JOIN form_ids x ON x.id = s.assignment_id

  UNION ALL

  SELECT 'signature_request_document', q.id, o.bucket_id, o.name
  FROM storage.objects o
  JOIN public.sig_requests q ON o.bucket_id = 'signature-documents' AND o.name IN (q.document_path, q.sealed_path)
  JOIN signature_ids x ON x.id = q.id
  WHERE NOT EXISTS (SELECT 1 FROM public.sig_templates t WHERE t.source_path = o.name)
    AND NOT EXISTS (
      SELECT 1
      FROM public.sig_requests keep
      WHERE keep.id <> q.id
        AND keep.id NOT IN (SELECT id FROM signature_ids)
        AND o.name IN (keep.document_path, keep.sealed_path)
    )

  UNION ALL

  SELECT 'signature_record_copy', d.source_ref, o.bucket_id, o.name
  FROM storage.objects o
  JOIN public.record_documents d ON o.bucket_id = 'record-documents' AND o.name = d.storage_path
  JOIN signature_ids x ON d.source = 'signature' AND d.source_ref = x.id
)
SELECT DISTINCT cleanup_group, related_id, bucket_id, storage_path
FROM paths
ORDER BY bucket_id, storage_path, cleanup_group;

-- 3. Safety preview: a returned row is a signature request the cleanup intentionally
-- blocks because another person's signature activity is on the same request.
WITH target_email AS (
  SELECT 'jesterlloyd.bautista@cshs.org'::text AS email
),
signature_ids AS (
  SELECT DISTINCT s.request_id AS id
  FROM public.sig_request_signers s, target_email t
  WHERE lower(btrim(s.email)) = t.email
)
SELECT q.id AS request_id,
       q.title,
       other.name AS other_signer_name,
       other.email AS other_signer_email
FROM public.sig_requests q
JOIN signature_ids x ON x.id = q.id
JOIN public.sig_request_signers other ON other.request_id = q.id
CROSS JOIN target_email t
WHERE lower(btrim(other.email)) <> t.email
ORDER BY q.title, other.order_index;
