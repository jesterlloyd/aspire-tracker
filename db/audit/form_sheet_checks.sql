-- db/audit/form_sheet_checks.sql
-- FORM-SHEET-2 (Responses > Sheet editing). READ-ONLY. Run each section on its own, in order.
-- PRE 1-2 before applying supabase/migrations/20260929000000_form_sheet.sql; POST 1-3 after.
-- Every section states what PASS looks like. Applying it adds three empty tables.


-- ── PRE 1. Nothing from this migration exists yet ──────────────────────────────
-- PASS: every value false.
SELECT
  to_regclass('public.form_sheet_views')        IS NOT NULL AS form_sheet_views_exists,
  to_regclass('public.form_sheet_cells')        IS NOT NULL AS form_sheet_cells_exists,
  to_regclass('public.form_answer_corrections') IS NOT NULL AS form_answer_corrections_exists,
  to_regprocedure('public.form_answer_corrections_append_only()') IS NOT NULL AS append_only_fn_exists;


-- ── PRE 2. What this migration depends on is in place ──────────────────────────
-- PASS: every value true (the Forms migration and the Signatures org helpers).
SELECT
  to_regclass('public.catalog_forms')                  IS NOT NULL AS catalog_forms,
  to_regclass('public.form_assignments')               IS NOT NULL AS form_assignments,
  to_regclass('public.organizations')                  IS NOT NULL AS organizations,
  to_regprocedure('public.sig_caller_org_id()')        IS NOT NULL AS org_helper,
  to_regprocedure('public.is_active_owner_or_admin()') IS NOT NULL AS owner_admin_fn;


-- ── POST 1. The three tables exist, with RLS on and org_id on each ─────────────
-- PASS: three rows, rls_on true and has_org_id true on every one.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_on,
       EXISTS (SELECT 1 FROM information_schema.columns i
               WHERE i.table_schema = 'public' AND i.table_name = c.relname AND i.column_name = 'org_id') AS has_org_id
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('form_sheet_views', 'form_sheet_cells', 'form_answer_corrections')
ORDER BY c.relname;


-- ── POST 2. One read policy per table, SELECT only, to authenticated ───────────
-- PASS: three rows, cmd SELECT, roles {authenticated}.
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('form_sheet_views', 'form_sheet_cells', 'form_answer_corrections')
ORDER BY tablename;


-- ── POST 3. Corrections are append-only, and everything starts empty ───────────
-- PASS: trigger_exists true, and all three counts 0.
SELECT
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_form_answer_corrections_append_only' AND NOT tgisinternal) AS trigger_exists,
  (SELECT count(*) FROM form_sheet_views)        AS views,
  (SELECT count(*) FROM form_sheet_cells)        AS cells,
  (SELECT count(*) FROM form_answer_corrections) AS corrections;
