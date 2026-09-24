-- db/audit/forms_phase3_checks.sql
-- FORMS-PHASE3 (ASPIRE Catalog Phase 3). READ-ONLY. Run each section on its own, in order.
-- PRE 1-2 before applying supabase/migrations/20260928000000_forms_phase3.sql;
-- POST 1-5 after. Every section states what PASS looks like.
-- Applying it adds empty tables and a private bucket; the Catalog shows Forms once they exist.


-- ── PRE 1. Nothing from this migration exists yet ──────────────────────────────
-- PASS: every value false.
SELECT
  to_regclass('public.catalog_forms')          IS NOT NULL AS catalog_forms_exists,
  to_regclass('public.catalog_form_versions')  IS NOT NULL AS catalog_form_versions_exists,
  to_regclass('public.form_assignments')       IS NOT NULL AS form_assignments_exists,
  to_regclass('public.form_submissions')       IS NOT NULL AS form_submissions_exists,
  to_regprocedure('public.catalog_form_versions_frozen()') IS NOT NULL AS frozen_fn_exists,
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'form-files') AS bucket_exists;


-- ── PRE 2. What this migration depends on is in place ──────────────────────────
-- PASS: every value true. The Signatures migration (organizations, the org helper) and
-- Catalog Phase 1 (kind 'form', record_documents source 'form_submission').
SELECT
  to_regclass('public.organizations')                    IS NOT NULL AS organizations,
  to_regprocedure('public.sig_caller_org_id()')          IS NOT NULL AS org_helper,
  to_regprocedure('public.is_active_owner_or_admin()')   IS NOT NULL AS owner_admin_fn,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_catalog_resource_kind'
          AND pg_get_constraintdef(oid) LIKE '%form%')                 AS kind_allows_form,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_record_documents_source'
          AND pg_get_constraintdef(oid) LIKE '%form_submission%')      AS record_source_allows_form,
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'record-documents') AS record_bucket;


-- ═══ Apply the migration here, as one block. Expect "Success. No rows returned." ═══


-- ── POST 1. Every table exists, carries org_id, and has RLS on ──────────────────
-- PASS: four rows, rls true and has_org_id true on all four.
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls,
       EXISTS (SELECT 1 FROM information_schema.columns i
               WHERE i.table_schema = 'public' AND i.table_name = c.relname AND i.column_name = 'org_id') AS has_org_id
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('catalog_forms', 'catalog_form_versions', 'form_assignments', 'form_submissions')
 ORDER BY c.relname;


-- ── POST 2. Policies: read-only, Owner/Admin only ──────────────────────────────
-- PASS: four rows, every one cmd = SELECT, roles {authenticated}.
SELECT tablename, policyname, cmd, roles
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('catalog_forms', 'catalog_form_versions', 'form_assignments', 'form_submissions')
 ORDER BY tablename, policyname;


-- ── POST 3. A published version is frozen ──────────────────────────────────────
-- PASS: one row, trg_catalog_form_versions_frozen.
SELECT tgname FROM pg_trigger
 WHERE tgrelid = 'public.catalog_form_versions'::regclass AND NOT tgisinternal
 ORDER BY tgname;


-- ── POST 4. The bucket is private, 10 MB ───────────────────────────────────────
-- PASS: public false, file_size_limit 10485760.
SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'form-files';


-- ── POST 5. Nothing was written to existing data ───────────────────────────────
-- PASS: every count 0 (the starter forms are added from the Catalog afterwards).
SELECT
  (SELECT count(*) FROM catalog_forms)    AS forms,
  (SELECT count(*) FROM form_assignments) AS assignments,
  (SELECT count(*) FROM form_submissions) AS submissions;
