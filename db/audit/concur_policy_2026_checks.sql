-- CONCUR-POLICY-2026 checks for supabase/migrations/20261207000000_concur_policy_2026.sql.
-- Read-only. One statement: the CLI prints only the last statement's rows.
--
-- PRE (before applying), expect:
--   rule_deadline 60, rule_remind 45, rules 11, new_rules 0, prior_marked 0, gifts_new false
--   prepare_version 2, prepare_90 false, late_version 1, late_90 false
--   kb_state active, kb_effective 2024-01-01, kb_90 false, kb_barn false, kb_pending 0
-- POST (after applying), expect:
--   rule_deadline 90, rule_remind 75, rules 13, new_rules 2, prior_marked 7, gifts_new true
--   prepare_version 3, prepare_90 true, late_version 2, late_90 true
--   kb_state active, kb_effective 2026-11-01, kb_90 true, kb_barn true, kb_pending 0,
--   kb_version one higher than PRE

SELECT
  (SELECT (params->>'deadline_days')::int FROM public.budget_policy_rules WHERE key = 'concur_60_days') AS rule_deadline,
  (SELECT (params->>'remind_after_days')::int FROM public.budget_policy_rules WHERE key = 'concur_60_days') AS rule_remind,
  (SELECT count(*) FROM public.budget_policy_rules) AS rules,
  (SELECT count(*) FROM public.budget_policy_rules WHERE key IN ('meal_per_person', 'workday_meals')) AS new_rules,
  (SELECT count(*) FROM public.budget_policy_rules WHERE source LIKE 'Prior Business Expense Reimbursement Policy%') AS prior_marked,
  (SELECT label = 'Gifts are limited to four occasions' FROM public.budget_policy_rules WHERE key = 'gifts') AS gifts_new,
  (SELECT version FROM public.keith_skills WHERE slug = 'prepare-concur') AS prepare_version,
  (SELECT position('within 90 days' IN instruction_body) > 0 AND position('BARN' IN instruction_body) > 0 AND position('60 days' IN instruction_body) = 0
     FROM public.keith_skills WHERE slug = 'prepare-concur') AS prepare_90,
  (SELECT version FROM public.keith_skills WHERE slug = 'draft-late-note') AS late_version,
  (SELECT position('limit_days' IN instruction_body) > 0 AND position('60-day' IN instruction_body) = 0
     FROM public.keith_skills WHERE slug = 'draft-late-note') AS late_90,
  (SELECT state FROM public.knowledge_entries WHERE slug = 'business-expense-reimbursement-policy-concur') AS kb_state,
  (SELECT effective_date FROM public.knowledge_entries WHERE slug = 'business-expense-reimbursement-policy-concur') AS kb_effective,
  (SELECT current_version FROM public.knowledge_entries WHERE slug = 'business-expense-reimbursement-policy-concur') AS kb_version,
  (SELECT position('Within **90 days**' IN body) > 0 AND position('within 60 days' IN lower(body)) = 0
     FROM public.knowledge_entries WHERE slug = 'business-expense-reimbursement-policy-concur') AS kb_90,
  (SELECT position('BARN' IN body) > 0 FROM public.knowledge_entries WHERE slug = 'business-expense-reimbursement-policy-concur') AS kb_barn,
  (SELECT count(*) FROM public.knowledge_revisions r JOIN public.knowledge_entries e ON e.id = r.entry_id
    WHERE e.slug = 'business-expense-reimbursement-policy-concur') AS kb_pending;
