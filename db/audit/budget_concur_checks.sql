-- BUDGET-CONCUR-1 checks, for supabase/migrations/20261026000000_budget_concur.sql. Read-only.

-- ── 1. The two columns and the skill ─────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'budget_receipts'
     AND column_name IN ('concur_guidance', 'concur_prepared_at')) AS concur_columns,
  (SELECT status || ' / ' || CASE WHEN enabled THEN 'enabled' ELSE 'disabled' END || ' / ' || run_mode
     FROM public.keith_skills WHERE slug = 'prepare-concur') AS skill;
-- Expect: 2, and "draft / disabled / on" until you turn it on in Settings > Keith > Skills.

-- ── 2. Is the reimbursement policy in the Knowledge Center? ──────────────────────
-- Keith searches active Knowledge Center entries for the policy. This lists the likely ones.
SELECT slug, title, state, updated_at::date AS updated
FROM public.knowledge_entries
WHERE (title ILIKE '%reimburs%' OR title ILIKE '%concur%' OR title ILIKE '%expense%' OR body ILIKE '%reimbursement policy%')
ORDER BY state, updated_at DESC
LIMIT 10;
-- Expect: at least one row with state 'active'. If none, or only drafts, Keith's drafts say the policy
-- was not found; publish the entry in Settings > Keith > Knowledge Center.
