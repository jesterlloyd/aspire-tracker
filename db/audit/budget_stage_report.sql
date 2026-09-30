-- BUDGET-FIXES-1 release 2: the State / Status / Concur report (read-only), run by the Owner 2026-09-30.
-- Result: 29 rows, all Personal (Concur), Posted and Recorded: FY26 15 with a receipt; FY27 12 with a
-- receipt and 2 without. Under one Stage: 27 Receipt attached, 2 Posted; 29 before and after. No
-- conflicts. Concur was Status in other words, so Stage replaced all three columns with no migration.
-- Re-run it any time to see how the stages are spread and to spot a row that skips its receipt.
WITH r AS (
  SELECT b.fiscal_year AS fy, COALESCE(e.payment_method, 'none') AS payment, e.state, e.status,
         (e.receipt_file_id IS NOT NULL) AS has_receipt
  FROM public.budget_expenses e JOIN public.budgets b ON b.id = e.budget_id
  WHERE e.deleted_at IS NULL AND b.program = 'ASPIRE'
), s AS (
  SELECT *, CASE
      WHEN status = 'void' THEN 'Void'
      WHEN state = 'expected' THEN 'Expected'
      WHEN payment = 'p_card' THEN CASE WHEN has_receipt THEN 'Reimbursed or Paid' ELSE 'Posted' END
      WHEN status IN ('reimbursed', 'paid') THEN 'Reimbursed or Paid'
      WHEN status = 'submitted' THEN 'Submitted to Concur'
      WHEN has_receipt THEN 'Receipt attached'
      ELSE 'Posted' END AS stage,
    CASE
      WHEN state = 'expected' AND status NOT IN ('recorded', 'paid') THEN 'expected but ' || status
      WHEN status IN ('submitted', 'reimbursed') AND NOT has_receipt AND state = 'posted' THEN 'skips receipt'
      ELSE '' END AS note
  FROM r
)
SELECT fy, payment, state, status, has_receipt, stage, note, COUNT(*) AS rows
FROM s GROUP BY 1, 2, 3, 4, 5, 6, 7
UNION ALL
SELECT NULL, 'ALL ROWS', NULL, NULL, NULL, NULL, NULL, COUNT(*) FROM s
ORDER BY 1 NULLS LAST, 2, 6;
