-- REVIEW FIRST: remove form assignments/submissions and single-recipient signature
-- requests for JesterLloyd.Bautista@cshs.org (case-insensitive).
--
-- Form definitions and signature templates are preserved. A signature request with
-- another signer is blocked. First run catalog_cleanup_storage_manifest.sql and remove
-- every listed object through the Supabase Storage API or Dashboard. Never delete
-- storage.objects with SQL. Run this WHOLE file in one execution. It uses no temporary
-- tables. Keep ROLLBACK for review; change only the final ROLLBACK to COMMIT when ready.

BEGIN;

-- Preview form activity and submitted answers that will be deleted.
SELECT a.id, a.form_id, a.form_version, a.name, a.email, a.status,
       a.sent_at, a.submitted_at, s.id AS submission_id,
       s.pdf_bucket, s.pdf_path, s.record_document_id
FROM public.form_assignments a
LEFT JOIN public.form_submissions s ON s.assignment_id = a.id
WHERE lower(btrim(a.email)) = 'jesterlloyd.bautista@cshs.org'
ORDER BY a.created_at;

-- Preview signature activity. Only requests where Jester is a signer are selected.
SELECT q.id, q.title, q.status, q.sender_email, q.sent_at, q.completed_at,
       q.document_path, q.sealed_path,
       string_agg(s.name || ' <' || s.email || '>', ', ' ORDER BY s.order_index) AS signers
FROM public.sig_requests q
JOIN public.sig_request_signers s ON s.request_id = q.id
WHERE EXISTS (
  SELECT 1
  FROM public.sig_request_signers mine
  WHERE mine.request_id = q.id
    AND lower(btrim(mine.email)) = 'jesterlloyd.bautista@cshs.org'
)
GROUP BY q.id
ORDER BY q.created_at;

DO $$
DECLARE
  target_email constant text := 'jesterlloyd.bautista@cshs.org';
  form_ids uuid[];
  signature_ids uuid[];
  bulk_ids uuid[];
BEGIN
  SELECT coalesce(array_agg(a.id), ARRAY[]::uuid[])
    INTO form_ids
  FROM public.form_assignments a
  WHERE lower(btrim(a.email)) = target_email;

  SELECT coalesce(array_agg(DISTINCT s.request_id), ARRAY[]::uuid[])
    INTO signature_ids
  FROM public.sig_request_signers s
  WHERE lower(btrim(s.email)) = target_email;

  SELECT coalesce(array_agg(DISTINCT q.parent_bulk_id) FILTER (WHERE q.parent_bulk_id IS NOT NULL), ARRAY[]::uuid[])
    INTO bulk_ids
  FROM public.sig_requests q
  WHERE q.id = ANY(signature_ids);

  IF EXISTS (
    SELECT 1
    FROM public.sig_request_signers s
    WHERE s.request_id = ANY(signature_ids)
      AND lower(btrim(s.email)) <> target_email
  ) THEN
    RAISE EXCEPTION 'Stop: at least one selected signature request has another signer. Review it before deleting test activity.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM storage.objects o
    JOIN public.form_submissions s ON s.pdf_bucket = o.bucket_id AND s.pdf_path = o.name
    WHERE s.assignment_id = ANY(form_ids)

    UNION ALL

    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'form-files'
      AND EXISTS (
        SELECT 1 FROM unnest(form_ids) id
        WHERE o.name LIKE 'uploads/' || id::text || '/%'
      )

    UNION ALL

    SELECT 1
    FROM storage.objects o
    JOIN public.record_documents d ON o.bucket_id = 'record-documents' AND o.name = d.storage_path
    JOIN public.form_submissions s ON s.record_document_id = d.id
    WHERE s.assignment_id = ANY(form_ids)

    UNION ALL

    SELECT 1
    FROM storage.objects o
    JOIN public.sig_requests q ON o.bucket_id = 'signature-documents' AND o.name IN (q.document_path, q.sealed_path)
    WHERE q.id = ANY(signature_ids)
      AND NOT EXISTS (SELECT 1 FROM public.sig_templates t WHERE t.source_path = o.name)
      AND NOT EXISTS (
        SELECT 1
        FROM public.sig_requests keep
        WHERE keep.id <> q.id
          AND NOT (keep.id = ANY(signature_ids))
          AND o.name IN (keep.document_path, keep.sealed_path)
      )

    UNION ALL

    SELECT 1
    FROM storage.objects o
    JOIN public.record_documents d ON o.bucket_id = 'record-documents' AND o.name = d.storage_path
    WHERE d.source = 'signature' AND d.source_ref = ANY(signature_ids)
  ) THEN
    RAISE EXCEPTION 'Stop: form or signature Storage objects remain. Run catalog_cleanup_storage_manifest.sql and remove them through Storage first.';
  END IF;

  DELETE FROM public.record_documents d
  WHERE d.id IN (
    SELECT s.record_document_id
    FROM public.form_submissions s
    WHERE s.assignment_id = ANY(form_ids) AND s.record_document_id IS NOT NULL
  );

  DELETE FROM public.record_documents d
  WHERE d.source = 'signature' AND d.source_ref = ANY(signature_ids);

  -- Assignments cascade to their submissions. Form definitions/versions stay.
  DELETE FROM public.form_assignments a WHERE a.id = ANY(form_ids);

  -- Signature events are append-only during normal operation. Temporarily disable only
  -- the DELETE guard for the reviewed request IDs and always restore it.
  IF cardinality(signature_ids) > 0 THEN
    EXECUTE 'ALTER TABLE public.sig_events DISABLE TRIGGER trg_sig_events_append_only';
    BEGIN
      DELETE FROM public.sig_events e WHERE e.request_id = ANY(signature_ids);
    EXCEPTION WHEN OTHERS THEN
      EXECUTE 'ALTER TABLE public.sig_events ENABLE TRIGGER trg_sig_events_append_only';
      RAISE;
    END;
    EXECUTE 'ALTER TABLE public.sig_events ENABLE TRIGGER trg_sig_events_append_only';

    DELETE FROM public.sig_requests q WHERE q.id = ANY(signature_ids);
    DELETE FROM public.sig_bulk_sends b
    WHERE b.id = ANY(bulk_ids)
      AND NOT EXISTS (SELECT 1 FROM public.sig_requests q WHERE q.parent_bulk_id = b.id);
  END IF;
END $$;

-- Both must return zero rows.
SELECT a.id
FROM public.form_assignments a
WHERE lower(btrim(a.email)) = 'jesterlloyd.bautista@cshs.org';

SELECT q.id
FROM public.sig_requests q
WHERE EXISTS (
  SELECT 1
  FROM public.sig_request_signers s
  WHERE s.request_id = q.id
    AND lower(btrim(s.email)) = 'jesterlloyd.bautista@cshs.org'
);

ROLLBACK;
