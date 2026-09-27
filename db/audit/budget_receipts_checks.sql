-- db/audit/budget_receipts_checks.sql
-- BUDGET-B1 (PROGRAM-BUDGET Phase B), 2026-09-27. Read-only. Run AFTER
-- supabase/migrations/20261013000000_budget_receipts.sql, one section at a time.

-- ── 1. The four new tables exist, RLS on, no browser grants ──────────────────────
SELECT c.relname, c.relrowsecurity AS rls,
       (SELECT count(*) FROM information_schema.role_table_grants g WHERE g.table_schema = 'public' AND g.table_name = c.relname AND g.grantee IN ('anon', 'authenticated')) AS browser_grants
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('budget_receipts', 'budget_policy_rules', 'budget_category_corrections', 'budget_settings')
ORDER BY 1;
-- EXPECT: 4 rows, rls = true, browser_grants = 0 on every row.

-- ── 2. The eleven policy rules, only the meals rule blocking ─────────────────────
SELECT key, tone, applies_to, enabled FROM public.budget_policy_rules ORDER BY sort_order;
-- EXPECT: 11 rows. meals_documentation block/all; concur_60_days and prior_fiscal_year and
--         software_equipment_concur warn/personal_concur; every other rule warn/all; all enabled.

-- ── 3. Keith's skill: seeded, draft, disabled, quality route, kept out of chat ───
SELECT slug, status, enabled, model_route, allowed_roles, required_data, io_contract->>'surface' AS surface
FROM public.keith_skills WHERE slug = 'read-receipt';
-- EXPECT: 1 row: read-receipt, draft, false, quality, {}, {budget_receipt_read}, program_budget.
-- Then turn it on in Settings > Keith > Skills (Activate, then Enable).

-- ── 4. record_documents takes a budget receipt, read by the Owner only ───────────
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public.record_documents'::regclass AND conname IN ('chk_record_documents_subject', 'chk_record_documents_source') ORDER BY 1;
-- EXPECT: the source list ends with 'budget_receipt'; the subject CHECK has three branches.
SELECT policyname, qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'record_documents';
-- EXPECT: one policy, record_documents_owner_admin_read, whose qual has the budget_receipt
--         branch requiring is_owner = true.

-- ── 5. The expense columns ───────────────────────────────────────────────────────
SELECT column_name, data_type, column_default FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'budget_expenses' AND column_name IN ('business_purpose', 'attendees') ORDER BY 1;
-- EXPECT: attendees jsonb '[]'::jsonb; business_purpose text ''::text.
