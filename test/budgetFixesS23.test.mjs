// BUDGET-FIXES-1 sections 2 and 3 (Owner, 2026-09-29): a calmer Summary and a cleaner Plan tab.
//   2.1 How this works is a link beside the tabs, remembered per person; 2.2 the Summary's order;
//   2.3 no Cost per student tile until an expense has a cohort; 2.4 months close oldest first;
//   2.5 no Mark reconciled today, Last reconciled is the last closed month; 2.6 a budget change says
//   why. 3.1 a prior-year column only with data; 3.2 no empty item rows, one folded group of
//   categories with no request; 3.3 the Move Limit follows the plan.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const E = await import('../lib/server/budget/engine.js')
const UP = await import('../src/lib/userPreferences.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')
const TODAY = '2026-09-29'
const MIGRATIONS = ['20261009000000_program_budget_phase_a', '20261010000000_budget_subscription_approval', '20261011000000_budget_subscription_cells', '20261012000000_budget_expense_zero_quantity', '20261013000000_budget_receipts', '20261021000000_budget_v2_phase1', '20261022000000_budget_v2_phase2', '20261023000000_budget_v2_phase3']

async function world() {
  const pg = new PGlite()
  await pg.exec(read('test/fixtures/budgetReceiptsPrelude.sql'))
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('Jester Lloyd Bautista', 'j@x.org', 'owner', true) RETURNING *`)
  for (const m of MIGRATIONS) await pg.exec(runnable(read(`supabase/migrations/${m}.sql`)))
  await pg.exec(runnable(read('db/migrations/seed_program_budget_fy26.sql')))
  const db = pgliteRest(pg)
  await E.startYear(db, owner, { fy: 2027, total: 2000, cost_center: 'Nursing Education', plan: 'none', today: TODAY })
  return { pg, db, owner }
}

test('2.1 How this works is a per-person preference, folded by default, beside the tabs', () => {
  assert.deepEqual([...UP.USER_PREFERENCES[UP.BUDGET_HOW_IT_WORKS].values], ['closed', 'open'])
  assert.equal(UP.preferenceValue({}, UP.BUDGET_HOW_IT_WORKS), 'closed')
  const how = read('src/components/budget/BudgetHowItWorks.jsx')
  assert.match(how, /aria-expanded=\{open\}/)
  assert.match(how, />\{open \? 'Hide how this works' : 'How this works'\}<\/button>/)
  assert.doesNotMatch(how, /localStorage/, 'the account keeps it, not the browser')
  assert.match(read('src/components/budget/ProgramBudgetView.jsx'), /canEdit && year\.state === 'current'\n\s+\? <BudgetHowItWorks><SegmentedPicker/)
  assert.doesNotMatch(read('src/components/budget/BudgetSummary.jsx'), /<HowItWorks|How the budget works each month/)
})

test('2.2 and 2.3 the Summary order, and four tiles until an expense has a cohort', () => {
  const sum = read('src/components/budget/BudgetSummary.jsx')
  const body = sum.slice(sum.indexOf('  return (\n    <>'))
  const at = (s) => body.indexOf(s)
  assert.ok(at('{quiet}') < at('{basis}') && at('{basis}') < at('<BudgetClose') && at('<BudgetClose') < at('Monthly Spend') && at('Monthly Spend') < at('{history}'), 'FY28 line, tiles, Close, charts, note and history')
  assert.match(sum, /const showCps = cps\.state !== 'untagged'/)
  assert.match(sum, /className=\{showCps \? 'bud-basis' : 'bud-basis bud-basis-4'\}/)
  assert.doesNotMatch(sum, /Tag expenses to a cohort to see this/)
})

// MONTH-ANY-ORDER-1 (Owner, 2026-10-02: "I want to be able to close months in any order") reversed item
// 2.4: the card still opens on the oldest open month, but any month that has started can be closed.
test('2.4 reversed: months close in any order; the card still opens on the oldest open month', async () => {
  const { db, owner } = await world()
  let y = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  assert.equal(y.close.target, '2026-07')
  assert.equal((await E.closeMonth(db, owner, { fy: 2027, month: '2026-08', note: 'August first.', today: TODAY })).closed, '2026-08')
  y = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  assert.equal(y.close.target, '2026-07', 'July is still the oldest open month')
  assert.ok(y.close.checklists['2026-09'], 'every open month that has started can be chosen')
  await E.closeMonth(db, owner, { fy: 2027, month: '2026-07', note: 'Nothing posted.', today: TODAY })
  y = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  assert.equal(y.close.target, '2026-09')
  assert.deepEqual(y.close.months.slice(0, 3).map(m => [m.key, m.year]), [['2026-07', 2026], ['2026-08', 2026], ['2026-09', 2026]])
  // Found in the browser: with July the target, September (this month) read Upcoming.
  const MC = await import('../src/lib/budget/monthClose.js')
  assert.equal(MC.monthStatus('2026-09', { target: '2026-07', today: TODAY }).label, 'In progress')
  assert.equal(MC.monthStatus('2026-10', { target: '2026-07', today: TODAY }).label, 'Upcoming')
  const card = read('src/components/budget/BudgetClose.jsx')
  assert.match(card, /const canPick = \(key\) => !!checklists\[key\] \|\| !!months\.find\(m => m\.key === key\)\?\.closed_at/)
  assert.match(card, /Choose any month above to close or reopen it, in any order\./)
  assert.doesNotMatch(read('lib/server/budget/engine.js'), /close_in_order/)
})

test('2.5 Last reconciled is the last closed month, and Mark reconciled today is gone', () => {
  const sum = read('src/components/budget/BudgetSummary.jsx')
  assert.doesNotMatch(sum, /Mark reconciled today|mark_reconciled/)
  // OWNER-NOTE-RETIRE-1 (2026-10-03) moved it from the Owner Note card to the year line.
  assert.match(read('src/lib/budget/budgetModel.js'), /const last = \[\.\.\.\(year\?\.close\?\.months \|\| \[\]\)\]\.filter\(m => m\.closed_at\)\.pop\(\)/)
  assert.match(read('src/components/budget/BudgetYearLine.jsx'), /lastReconciled\(year\) \|\| 'No month closed yet'/)
})

test('2.6 a budget change needs a reason; History shows it, and older changes say none was recorded', async () => {
  const { pg, db, owner } = await world()
  await assert.rejects(E.setTotal(db, owner, { fy: 2027, total: 3500, today: TODAY }), /Say in one line why the budget is changing/)
  // A change made before reasons were asked for.
  const b = (await pg.query(`SELECT id FROM budgets WHERE fiscal_year = 2027`)).rows[0].id
  await pg.query(`INSERT INTO budget_events (budget_id, kind, message, old_value, new_value, actor_name) VALUES ($1, 'budget_changed', 'Budget changed from $40,000.00 to $2,000.00.', '{"total":40000}', '{"total":2000}', 'J')`, [b])
  await new Promise(r => setTimeout(r, 5))
  await E.setTotal(db, owner, { fy: 2027, total: 3500, reason: '  Platform costs   moved here. ', today: TODAY })
  await E.setCostCenter(db, owner, { fy: 2027, cost_center: 'Nursing Education 8720000', today: TODAY })
  const y = await E.loadYear(db, { fy: 2027, viewer: 'reader', today: TODAY })
  const by = Object.fromEntries(y.history.map(h => [h.message, h.reason]))
  assert.equal(by['Budget changed from $2,000.00 to $3,500.00.'], 'Platform costs moved here.')
  assert.equal(by['Budget changed from $40,000.00 to $2,000.00.'], 'No reason recorded.')
  assert.equal(by['Cost center changed from Nursing Education to Nursing Education 8720000.'], undefined, 'only a change to the amount asks why')
  assert.ok(!('new_value' in y.history[0]), 'the stored values stay on the server')
  const sum = read('src/components/budget/BudgetSummary.jsx')
  assert.match(sum, /aria-label="Reason for the change"/)
  assert.match(sum, /\{h\.reason && <span className="bud-hist-why">\{h\.reason\}<\/span>\}/)
  assert.match(read('api/budget-staff.js'), /set_total: \['action', 'fiscal_year', 'total', 'reason'\]/)
})

test('3.1 to 3.3 the Plan: prior years only with data, no empty rows, and the Move Limit by plan state', () => {
  const plan = read('src/components/budget/BudgetPlan.jsx')
  assert.match(plan, /const showPrior2 = cats\.some\(c => c\.prior2\)/)
  assert.match(plan, /\{showPrior2 && <span className="n" title=\{labels\.prior2\}>/)
  assert.match(plan, /const blankItem = \(i\) => !String\(i\?\.name \|\| ''\)\.trim\(\) && !\(Number\(i\?\.unit_cost\) > 0\)/)
  assert.doesNotMatch(plan, /c\.prior1 \|\| c\.prior2 \|\| c\.approved/, 'a prior year alone no longer lists a category')
  assert.match(plan, /\{unused\.length\} \{unused\.length === 1 \? 'category' : 'categories'\} with no request/)
  assert.doesNotMatch(plan, /Add items to another category/)
  assert.match(plan, /Move limit applies once Margo approves this plan\./)
  assert.match(plan, /\{owner && \(p\.live\n\s+\? <MoveLimit/)
  assert.match(plan, /<dl className="bud-limit-ro">/)
  assert.match(plan, /onClick=\{\(\) => setEditing\(true\)\}>Edit<\/button>/)
})
