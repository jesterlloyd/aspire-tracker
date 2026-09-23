-- db/audit/catalog_revamp_1_checks.sql
-- CATALOG-REVAMP-1 (Phase 1). READ-ONLY. Run each section on its own, in order.
-- PRE 1-4 before applying supabase/migrations/20260926000000_catalog_revamp_1.sql;
-- POST 1-6 after. Every section states what PASS looks like.


-- ── PRE 1. Nothing from this migration exists yet ──────────────────────────────
-- PASS: every value false (a true means a partial earlier run; stop and report).
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'catalog_resources' AND column_name = 'kind')        AS kind_exists,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'catalog_categories' AND column_name = 'retired_at') AS retired_at_exists,
  to_regclass('public.record_documents')        IS NOT NULL AS record_documents_exists,
  to_regclass('public.catalog_sends')           IS NOT NULL AS catalog_sends_exists,
  to_regclass('public.catalog_send_recipients') IS NOT NULL AS catalog_send_recipients_exists,
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'record-documents') AS bucket_exists;


-- ── PRE 2. What the pinned backfill will change (keep this output: it is the rollback list) ──
-- Rows listed here are featured and NOT pinned; the migration pins them.
SELECT id, slug, title, is_featured, is_pinned, is_active
  FROM catalog_resources
 WHERE is_featured = true AND is_pinned = false
 ORDER BY title;


-- ── PRE 3. Audience values in use today ─────────────────────────────────────────
-- The migration's audience CHECK is NOT VALID, so nothing here can fail it. Any row
-- listed means a value the new UI does not know; it reads as Everyone until edited.
SELECT id, slug, title, audience
  FROM catalog_resources
 WHERE NOT (cardinality(audience) <= 1
            AND audience <@ ARRAY['everyone', 'students', 'preceptors', 'schools', 'staff']::text[])
 ORDER BY title;


-- ── PRE 4. Categories and the rows in 'forms' (the reassignment worklist) ──────
SELECT c.slug, c.display_name, c.sort_order,
       (SELECT count(*) FROM catalog_resources r WHERE r.category = c.slug)                      AS rows_total,
       (SELECT count(*) FROM catalog_resources r WHERE r.category = c.slug AND r.is_active)      AS rows_active
  FROM catalog_categories c
 ORDER BY c.sort_order;


-- ── POST 1. The new columns and tables ─────────────────────────────────────────
-- PASS: five catalog_resources columns, retired_at, three tables, the bucket (public = false).
SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND ((table_name = 'catalog_resources'  AND column_name IN ('kind', 'version', 'version_updated_at', 'file_size_bytes', 'moved_to_record_document_id'))
     OR (table_name = 'catalog_categories' AND column_name = 'retired_at'))
 ORDER BY table_name, column_name;

SELECT to_regclass('public.record_documents')        AS record_documents,
       to_regclass('public.catalog_sends')           AS catalog_sends,
       to_regclass('public.catalog_send_recipients') AS catalog_send_recipients,
       (SELECT public FROM storage.buckets WHERE id = 'record-documents') AS bucket_public;


-- ── POST 2. Backfills ───────────────────────────────────────────────────────────
-- PASS: featured_not_pinned = 0; every row kind 'file' and version 1;
-- sized = the number of internal files whose object exists.
SELECT
  count(*) FILTER (WHERE is_featured AND NOT is_pinned)                  AS featured_not_pinned,
  count(*) FILTER (WHERE kind <> 'file')                                 AS non_file_rows,
  count(*) FILTER (WHERE version <> 1)                                   AS non_v1_rows,
  count(*) FILTER (WHERE resource_type = 'internal_file')                AS internal_files,
  count(*) FILTER (WHERE resource_type = 'internal_file' AND file_size_bytes IS NOT NULL) AS sized
  FROM catalog_resources;


-- ── POST 3. Audience rows the NOT VALID check would reject ──────────────────────
-- PASS: the same rows as PRE 3 (none new). Empty means the check could be VALIDATEd later.
SELECT id, slug, title, audience
  FROM catalog_resources
 WHERE NOT (cardinality(audience) <= 1
            AND audience <@ ARRAY['everyone', 'students', 'preceptors', 'schools', 'staff']::text[]);


-- ── POST 4. Categories ──────────────────────────────────────────────────────────
-- PASS: nine rows; 'forms' has retired_at set; the two new slugs present, not retired.
SELECT slug, display_name, sort_order, retired_at IS NOT NULL AS retired
  FROM catalog_categories
 ORDER BY sort_order;


-- ── POST 5. Policies on the new tables ─────────────────────────────────────────
-- PASS: exactly one SELECT policy per table, none for INSERT/UPDATE/DELETE, RLS on.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_on, p.polname, p.polcmd
  FROM pg_class c
  LEFT JOIN pg_policy p ON p.polrelid = c.oid
 WHERE c.relname IN ('record_documents', 'catalog_sends', 'catalog_send_recipients')
 ORDER BY c.relname, p.polname;


-- ── POST 6. Constraints on catalog_resources ────────────────────────────────────
-- PASS: chk_catalog_resource_kind, chk_catalog_resource_version (validated),
-- chk_catalog_resource_audience (convalidated = false), fk_catalog_resources_moved_record.
SELECT conname, contype, convalidated
  FROM pg_constraint
 WHERE conrelid = 'public.catalog_resources'::regclass
   AND conname IN ('chk_catalog_resource_kind', 'chk_catalog_resource_version',
                   'chk_catalog_resource_audience', 'fk_catalog_resources_moved_record')
 ORDER BY conname;
