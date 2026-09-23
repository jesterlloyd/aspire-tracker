-- db/audit/signatures_phase2_checks.sql
-- SIGNATURES-PHASE2 (ASPIRE Catalog Phase 2). READ-ONLY. Run each section on its own, in order.
-- PRE 1-3 before applying supabase/migrations/20260927000000_signatures_phase2.sql;
-- POST 1-7 after. Every section states what PASS looks like.
-- Applying the migration turns NOTHING on: catalog.signatures is created 'off'.


-- ── PRE 1. Nothing from this migration exists yet ──────────────────────────────
-- PASS: every value false. A true on organizations or feature_flags means a table of that
-- name already exists with a shape this migration did not write: STOP and report, because
-- CREATE TABLE IF NOT EXISTS would silently keep the old one.
SELECT
  to_regclass('public.organizations')        IS NOT NULL AS organizations_exists,
  to_regclass('public.feature_flags')        IS NOT NULL AS feature_flags_exists,
  to_regclass('public.sig_settings')         IS NOT NULL AS sig_settings_exists,
  to_regclass('public.sig_disclosures')      IS NOT NULL AS sig_disclosures_exists,
  to_regclass('public.sig_templates')        IS NOT NULL AS sig_templates_exists,
  to_regclass('public.sig_bulk_sends')       IS NOT NULL AS sig_bulk_sends_exists,
  to_regclass('public.sig_requests')         IS NOT NULL AS sig_requests_exists,
  to_regclass('public.sig_request_signers')  IS NOT NULL AS sig_request_signers_exists,
  to_regclass('public.sig_field_values')     IS NOT NULL AS sig_field_values_exists,
  to_regclass('public.sig_events')           IS NOT NULL AS sig_events_exists,
  to_regprocedure('public.sig_caller_org_id()') IS NOT NULL AS caller_org_fn_exists,
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'signature-documents') AS bucket_exists;


-- ── PRE 2. What this migration depends on is in place ──────────────────────────
-- PASS: every value true. The Catalog Phase 1 objects (kind 'signature', record_documents
-- with source 'signature', the record-documents bucket) and the two role helpers the
-- read policies call. sha256_builtin needs Postgres 11 or later.
SELECT
  to_regprocedure('public.is_staff()')                  IS NOT NULL AS is_staff_fn,
  to_regprocedure('public.is_active_owner_or_admin()')  IS NOT NULL AS owner_admin_fn,
  to_regprocedure('pg_catalog.sha256(bytea)')           IS NOT NULL AS sha256_builtin,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_catalog_resource_kind'
          AND pg_get_constraintdef(oid) LIKE '%signature%')         AS kind_allows_signature,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_record_documents_source'
          AND pg_get_constraintdef(oid) LIKE '%signature%')         AS record_source_allows_signature,
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'record-documents') AS record_bucket;


-- ── PRE 3. Postgres version (for the record) ───────────────────────────────────
SELECT current_setting('server_version') AS server_version;


-- ═══ Apply the migration here, as one block. Expect "Success. No rows returned." ═══


-- ── POST 1. Every table exists, carries org_id, and has RLS on ──────────────────
-- PASS: ten rows; has_org_id true on all but organizations (whose id IS the org);
-- rls true on all ten.
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls,
       EXISTS (SELECT 1 FROM information_schema.columns i
               WHERE i.table_schema = 'public' AND i.table_name = c.relname AND i.column_name = 'org_id') AS has_org_id
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('organizations', 'feature_flags', 'sig_settings', 'sig_disclosures', 'sig_templates',
                     'sig_bulk_sends', 'sig_requests', 'sig_request_signers', 'sig_field_values', 'sig_events')
 ORDER BY c.relname;


-- ── POST 2. Policies: read-only, and only what the migration wrote ─────────────
-- PASS: every row cmd = SELECT, roles {authenticated}. No INSERT, UPDATE or DELETE policy
-- on any of these tables (writes are the service role's, through the endpoints).
SELECT tablename, policyname, cmd, roles
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('organizations', 'feature_flags', 'sig_settings', 'sig_disclosures', 'sig_templates',
                     'sig_bulk_sends', 'sig_requests', 'sig_request_signers', 'sig_field_values', 'sig_events')
 ORDER BY tablename, policyname;


-- ── POST 3. The flag is OFF, and the seeded rows are the defaults ──────────────
-- PASS: one flag row, state 'off'. One settings row: seal_provider 'env_p12',
-- tsa_url 'http://timestamp.digicert.com', current_disclosure_version '1.0',
-- code_ttl_minutes 10, code_max_attempts 5. One disclosure row, version '1.0'.
SELECT key, state, updated_at FROM feature_flags
 WHERE org_id = 'a5f1e000-0000-4000-8000-000000000001';
SELECT seal_provider, seal_provider_config, tsa_url, tsa_name, time_zone, current_disclosure_version,
       code_ttl_minutes, code_max_attempts
  FROM sig_settings WHERE org_id = 'a5f1e000-0000-4000-8000-000000000001';
SELECT version, title, created_at FROM sig_disclosures
 WHERE org_id = 'a5f1e000-0000-4000-8000-000000000001' ORDER BY version;


-- ── POST 4. The audit log's three triggers are in force ────────────────────────
-- PASS: three rows: trg_sig_events_append_only, trg_sig_events_chain, trg_sig_events_no_truncate.
SELECT tgname, pg_get_triggerdef(oid) AS definition
  FROM pg_trigger
 WHERE tgrelid = 'public.sig_events'::regclass AND NOT tgisinternal
 ORDER BY tgname;


-- ── POST 5. The bucket is private, PDF only, 25 MB ─────────────────────────────
-- PASS: public false, file_size_limit 26214400, allowed_mime_types {application/pdf}.
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'signature-documents';


-- ── POST 6. Nothing was written to existing data ───────────────────────────────
-- PASS: zero signature items in the Catalog, zero requests, zero events.
SELECT
  (SELECT count(*) FROM catalog_resources WHERE kind = 'signature') AS signature_items,
  (SELECT count(*) FROM sig_requests)                               AS requests,
  (SELECT count(*) FROM sig_events)                                 AS events;


-- ── POST 7. The browser client cannot write (grants) ───────────────────────────
-- PASS: no row lists anon, and authenticated holds SELECT only. (Supabase's default
-- grants may list authenticated with more privileges; the absence of a write POLICY in
-- POST 2 is what refuses the write under RLS. Report the output either way.)
SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public'
   AND table_name IN ('feature_flags', 'sig_settings', 'sig_requests', 'sig_request_signers', 'sig_events')
   AND grantee IN ('anon', 'authenticated')
 GROUP BY table_name, grantee
 ORDER BY table_name, grantee;


-- ═══ Later, and only by the Owner: turning the feature on ═══
-- These are WRITES, listed here so they are never improvised. Not part of the checks.
--   Owner only, for testing in production:
--     UPDATE feature_flags SET state = 'owner', updated_at = now()
--      WHERE org_id = 'a5f1e000-0000-4000-8000-000000000001' AND key = 'catalog.signatures';
--   Everyone (after Legal and IT sign-off): the same with state = 'on'.
--   Off again: state = 'off'.
