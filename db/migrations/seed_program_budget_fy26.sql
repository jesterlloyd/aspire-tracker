-- PROGRAM-BUDGET Phase A (BUDGET-A3), 2026-09-27. OWNER-GATED: do not apply from a session.
--
-- The FY26 import (prompt A3): the ten rows of the Expense Report sheet in
-- BNI_ASPIRE Program_Budget Tracker_FY2026.xlsx, into a CLOSED FY26 budget of $40,000.00.
-- Total $1,620.44. Apply AFTER supabase/migrations/20261009000000_program_budget_phase_a.sql.
--
-- As the workbook has them, and nothing more:
--   * Month only, no year: date_precision = 'month', the 1st of the month. Jan, Feb and Mar are
--     2026, because FY26 runs July 2025 to June 2026. The Sheet shows "Jan 2026".
--   * Payment method, status and receipt are left empty: the workbook has no data for them.
--     The owner can backfill Payment, Status, Cohort and Notes on the closed year.
--   * The "#VALUE!" in cell A1 of both sheets is ignored; the Annual Budget Tracker sheet is
--     not imported, because the Sheet's Group by Category or Month replaces it.
--   * started_at 2025-07-01 marks FY26 as a year that ran; it is closed because its June 30
--     has passed (the state is derived, never stored).
--
-- Idempotent: it does nothing if FY26 already exists. Checks: db/audit/program_budget_phase_a_checks.sql
-- (SEED 1 to 3). Rollback: end of file.

BEGIN;

DO $seed$
DECLARE
  v_owner uuid;
  v_owner_name text;
  v_budget uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.budgets WHERE program = 'ASPIRE' AND fiscal_year = 2026) THEN
    RAISE NOTICE 'FY26 already exists; nothing imported.';
    RETURN;
  END IF;

  SELECT id, COALESCE(NULLIF(full_name, ''), 'Owner') INTO v_owner, v_owner_name
    FROM public.user_profiles WHERE is_owner IS TRUE ORDER BY created_at LIMIT 1;

  INSERT INTO public.budgets (program, fiscal_year, total, cost_center, started_at, owner_note, created_by)
  VALUES ('ASPIRE', 2026, 40000.00, 'Nursing Education', '2025-07-01 00:00:00-07',
          'This is all ASPIRE spend for FY26. No ASPIRE costs went through other budgets.', v_owner)
  RETURNING id INTO v_budget;

  INSERT INTO public.budget_events (budget_id, kind, message, new_value, actor_profile_id, actor_name)
  VALUES (v_budget, 'budget_set', 'Budget set to $40,000.00, from the FY26 workbook.', '{"total": 40000.00}'::jsonb, v_owner, v_owner_name);

  INSERT INTO public.budget_expenses
    (budget_id, expense_date, date_precision, item, category_id, description, vendor, order_number, quantity, amount, cost_center, source, created_by)
  SELECT v_budget, r.d::date, 'month', r.item, c.id, r.descr, r.vendor, r.ord, r.qty, r.amt, 'Nursing Education', 'import', v_owner
  FROM (VALUES
    (1,  '2026-01-01', 'Cardstock for Student Badges', 'Supplies & Materials', 'Heavy cardstock used to print student identification badges for ASPIRE participants', 'Walmart', '',                    1,   11.71),
    (2,  '2026-01-01', 'Self-Laminating Pouches',      'Supplies & Materials', 'Laminating pouches used to protect student badges',                                     'Amazon',  '114-2621881-4457026', 1,   30.27),
    (3,  '2026-01-01', 'Self-Laminating Pouches',      'Supplies & Materials', 'Laminating pouches used to protect student badges',                                     'Amazon',  '113-4985467-8610640', 3,   33.52),
    (4,  '2026-02-01', 'Self-Laminating Pouches',      'Supplies & Materials', 'Laminating pouches used to protect student badges',                                     'Amazon',  '113-2454901-2790626', 3,   25.14),
    (5,  '2026-03-01', 'Printer Ink',                  'Printing & Copying',   'Replacement ink cartridges for orientation materials and badges',                        'Amazon',  '',                    1,   67.50),
    (6,  '2026-03-01', 'Badge Holders & Lanyards',     'Supplies & Materials', 'ID badge holders for student nurses during rotations',                                  'Amazon',  '',                    3,   72.30),
    (7,  '2026-03-01', 'Welcome Packet Notebooks',     'Supplies & Materials', 'Journaling notebooks for reflection during clinical rotation',                          'Amazon',  '',                    40, 350.00),
    (8,  '2026-03-01', 'Program Pens',                 'Supplies & Materials', 'Pens included in welcome packet',                                                       'Amazon',  '',                    100, 30.00),
    (9,  '2026-03-01', 'Tote Bags',                    'Supplies & Materials', 'ASPIRE welcome tote bags for participants',                                             'Amazon',  '',                    40, 400.00),
    (10, '2026-03-01', 'ASPIRE Program Shirts',        'Supplies & Materials', 'Orientation shirts with ASPIRE logo',                                                   'Amazon',  '',                    40, 600.00)
  ) AS r(n, d, item, cat, descr, vendor, ord, qty, amt)
  JOIN public.budget_categories c ON c.program = 'ASPIRE' AND c.name = r.cat
  ORDER BY r.n;

  IF (SELECT count(*) FROM public.budget_expenses WHERE budget_id = v_budget) <> 10
     OR (SELECT sum(amount) FROM public.budget_expenses WHERE budget_id = v_budget) <> 1620.44 THEN
    RAISE EXCEPTION 'FY26 import did not produce 10 rows totalling $1,620.44; nothing was imported.';
  END IF;
END
$seed$;

COMMIT;

-- ── Rollback (removes the FY26 import only; its Budget history row is append-only and stays
-- ── with the budget, so the budget row is kept and only emptied) ──
-- BEGIN;
--   DELETE FROM public.budget_expenses WHERE source = 'import'
--     AND budget_id = (SELECT id FROM public.budgets WHERE program = 'ASPIRE' AND fiscal_year = 2026);
-- COMMIT;
