-- RECEIPTS-REDESIGN-1 checks, for supabase/migrations/20261101000000_receipts_redesign.sql. Read-only.

-- ── 1. The columns, the history kinds and the skill ──────────────────────────────
SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'budget_expenses'
     AND column_name IN ('concur_submitted_at', 'concur_submitted_by', 'reimbursed_at', 'reimbursed_by')) AS expense_columns,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'budget_receipts'
     AND column_name IN ('policy_confirmed_at', 'policy_confirmed_by', 'late_note')) AS receipt_columns,
  (SELECT pg_get_constraintdef(oid) LIKE '%concur_submitted%' FROM pg_constraint WHERE conname = 'chk_budget_events_kind') AS history_kinds,
  (SELECT status || ' / ' || CASE WHEN enabled THEN 'enabled' ELSE 'disabled' END || ' / ' || array_to_string(allowed_roles, ',')
     FROM public.keith_skills WHERE slug = 'draft-late-note') AS skill;
-- Expect: 4, 3, true, and "draft / disabled / owner" until you turn it on in Settings > Keith > Skills.

-- ── 2. Rows already marked, and the dates they were given ────────────────────────
SELECT status, COUNT(*) AS n_rows, COUNT(concur_submitted_at) AS with_submitted_date, COUNT(reimbursed_at) AS with_reimbursed_date
FROM public.budget_expenses
WHERE deleted_at IS NULL AND payment_method = 'personal_concur' AND status IN ('submitted', 'reimbursed')
GROUP BY status ORDER BY status;
-- Expect: every Submitted row with a submitted date, and every Reimbursed row with a reimbursed date,
-- unless it was imported already in that status (then it has no change to take a date from: its
-- stamp shows no date). No rows at all is fine too: nothing has been marked yet.
