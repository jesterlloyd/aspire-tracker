// test/budgetPolish1.test.mjs
//
// BUDGET-POLISH-1 (Owner, 2026-09-29), five fixes to Program Budget:
//   1. Receipts: the header's Add receipts steps aside on the Receipts tab (the drop zone does it).
//   2. The year's line is the Settings band's subtitle, not a line of its own.
//   3. Receipts opens on Filed when nothing is waiting (first load only).
//   4. Summary: "How the budget works" is folded by default; By Category lists categories with spend.
//   5. The cost center can be changed; new rows and charges take the year's cost center.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const E = await import('../lib/server/budget/engine.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')
const TODAY = '2026-09-29'

async function world() {
  const pg = new PGlite()
  await pg.exec(read('test/fixtures/budgetReceiptsPrelude.sql'))
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('Jester Lloyd Bautista', 'j@x.org', 'owner', true) RETURNING *`)
  for (const m of ['20261009000000_program_budget_phase_a', '20261010000000_budget_subscription_approval', '20261011000000_budget_subscription_cells', '20261012000000_budget_expense_zero_quantity', '20261013000000_budget_receipts', '20261021000000_budget_v2_phase1', '20261022000000_budget_v2_phase2', '20261023000000_budget_v2_phase3', '20261024000000_budget_v2_phase4'])
    await pg.exec(runnable(read(`supabase/migrations/${m}.sql`)))
  await pg.exec(runnable(read('db/migrations/seed_program_budget_subscriptions_proposed.sql')))
  const db = pgliteRest(pg)
  await E.startYear(db, owner, { fy: 2027, total: 3500, cost_center: 'Nursing Education 8720000', plan: 'none', today: TODAY })
  return { pg, db, owner }
}

test('a new row and a subscription charge take the year’s cost center', async () => {
  const { db, owner } = await world()
  const row = await E.createExpense(db, owner, { fields: { expense_date: '2026-09-02', item: 'Badges', amount: 45 }, today: TODAY })
  assert.equal(row.cost_center, 'Nursing Education 8720000')
  const y = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  await E.decideProposal(db, owner, { id: y.subscriptions.find(s => s.name === 'Resend').id, decision: 'from_year_start', today: TODAY })
  const after = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  assert.ok(after.expenses.filter(e => e.item === 'Resend').every(e => e.cost_center === 'Nursing Education 8720000'))
})

test('the cost center changes, with this year’s rows, except in a closed month, and Budget history keeps both', async () => {
  const { pg, db, owner } = await world()
  const aug = await E.createExpense(db, owner, { fields: { expense_date: '2026-08-10', item: 'Aug', amount: 5 }, today: TODAY })
  const sep = await E.createExpense(db, owner, { fields: { expense_date: '2026-09-10', item: 'Sep', amount: 5 }, today: TODAY })
  const own = await E.createExpense(db, owner, { fields: { expense_date: '2026-09-11', item: 'Other', amount: 5, cost_center: 'Research 1234' }, today: TODAY })
  await E.closeMonth(db, owner, { fy: 2027, month: '2026-08', note: 'Closed.', today: TODAY })
  await assert.rejects(E.setCostCenter(db, owner, { fy: 2027, cost_center: '  ', today: TODAY }), /Enter the cost center/)
  const out = await E.setCostCenter(db, owner, { fy: 2027, cost_center: 'Nursing Education 8720001', today: TODAY })
  assert.equal(out.message, 'Cost center is Nursing Education 8720001. 1 row updated.')
  const cc = async (id) => (await pg.query(`SELECT cost_center FROM budget_expenses WHERE id = $1`, [id])).rows[0].cost_center
  assert.deepEqual([await cc(aug.id), await cc(sep.id), await cc(own.id)], ['Nursing Education 8720000', 'Nursing Education 8720001', 'Research 1234'])
  const y = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  assert.equal(y.budget.cost_center, 'Nursing Education 8720001')
  assert.equal(y.history[0].message, 'Cost center changed from Nursing Education 8720000 to Nursing Education 8720001, on 1 row.')
  const alone = await E.setCostCenter(db, owner, { fy: 2027, cost_center: 'Nursing Education 8720002', applyToRows: false, today: TODAY })
  assert.equal(alone.updated, 0)
})

test('the screens: one Add receipts, the year line in the band, Filed when empty, a lighter Summary', () => {
  const view = read('src/components/budget/ProgramBudgetView.jsx')
  assert.match(view, /tab !== 'receipts' && \(<>/)
  assert.match(view, /yearLineInBand \? <BudgetYearLine year=\{year\} canEdit=\{canEdit\} onWrite=\{onWrite\} \/> : undefined/)
  assert.match(view, /\{!yearLineInBand && \(\n\s+<div className="bud-head">/, 'the portal keeps its line')
  const panel = read('src/components/settings/ProgramBudgetPanel.jsx')
  assert.match(panel, /yearLineInBand/)
  assert.match(panel, /subtitle=\{yearLine \|\| 'One budget per fiscal year: its expenses, subscriptions and category plan\.'\}/)
  const line = read('src/components/budget/BudgetYearLine.jsx')
  assert.match(line, /set_cost_center/)
  assert.match(line, /Also update this year’s rows that show the old one/)
  // BUDGET-FIXES-1 changed this: Filed opens when the SELECTED year has filed receipts (item 1.4).
  assert.match(read('src/components/budget/BudgetReceipts.jsx'), /if \(!firstLoad\.current\) \{ firstLoad\.current = true; if \(!d\.waiting\.length && filedIn\(d, fy\)\) setView\('filed'\) \}/)
  const sum = read('src/components/budget/BudgetSummary.jsx')
  assert.match(sum, /localStorage\.getItem\(HOW_KEY\) === '1'/)
  assert.match(sum, /Show all \$\{s\.byCategory\.length\}/)
  assert.match(read('api/budget-staff.js'), /set_cost_center: \['action', 'fiscal_year', 'cost_center', 'apply_to_rows'\]/)
})
