// test/budgetV2Phase2.test.mjs
//
// BUDGET-V2 Phase 2 (2026-09-29), the monthly cycle. Reference: docs/mockups/program-budget-v2.html.
//   12. An approved subscription's upcoming charges are Expected rows: committed, never Spent. On
//       its date a row becomes Posted and counts. The Sheet has State and Concur columns.
//   11. Every slip asks Match or add? (tested in budgetReceiptsUi.test.mjs); a receipt dated in a
//       closed month asks for the month to be reopened first.
//   13. A month closes from a checklist (or with a note), locks its rows, is logged, and the Action
//       Center asks from the 5th.
// The rules are pure and tested here; the lifecycle runs on PGlite with the real migrations and the
// Owner's own subscriptions.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const M = await import('../src/lib/budget/budgetModel.js')
const MC = await import('../src/lib/budget/monthClose.js')
const K = await import('../src/lib/budget/receiptChecks.js')
const NY = await import('../src/lib/home/needsYouModel.js')
const QM = await import('../src/lib/actionCenter/queueModel.js')
const R = await import('../lib/server/budget/receipts.js')
const E = await import('../lib/server/budget/engine.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')
const TODAY = '2026-09-29'

// ── The month-close rules ────────────────────────────────────────────────────────

// BUDGET-FIXES-1 item 2.4 changed this (Owner, 2026-09-29): months close in order, so the card is for
// the OLDEST open month that has ended or is in the window.
test('the card is for the oldest open month that has ended or is in the window', () => {
  const none = new Set()
  assert.deepEqual(MC.fyMonths(2027).map(m => m.key).slice(0, 3), ['2026-07', '2026-08', '2026-09'])
  assert.equal(MC.closeTarget(2027, none, '2026-09-29'), '2026-07', 'July first, whatever month it is')
  assert.equal(MC.closeTarget(2027, new Set(['2026-07', '2026-08']), '2026-09-29'), '2026-09', 'from the 25th: this month, once the earlier ones are closed')
  assert.equal(MC.closeTarget(2027, new Set(['2026-07', '2026-08']), '2026-10-03'), '2026-09', 'through the 10th: last month')
  assert.equal(MC.closeTarget(2027, new Set(['2026-07', '2026-08']), '2026-10-15'), '2026-09', 'after the window, while September is open')
  assert.equal(MC.closeTarget(2027, new Set(['2026-09']), '2026-10-15'), '2026-07', 'a later month closed out of order does not skip July')
  assert.equal(MC.closeTarget(2027, new Set(['2026-07', '2026-08', '2026-09']), '2026-10-15'), null, 'nothing to close mid-month')
  assert.equal(MC.closeTarget(2027, new Set(['2026-07']), '2026-09-15'), '2026-08', 'mid-September: August has ended and is open')
  assert.equal(MC.closeTarget(2027, none, '2026-07-12'), null, 'the first month of the year, before its window')
  const st = (k, today = '2026-09-29') => MC.monthStatus(k, { closed: new Set(['2026-07']), target: '2026-09', today }).label
  assert.deepEqual([st('2026-07'), st('2026-08'), st('2026-09'), st('2026-10')], ['Closed', 'Not closed', 'Closing', 'Upcoming'])
})

test('the checklist names what is left, and a note or a receipt answers a missing receipt', () => {
  const rows = [
    { id: 'a', expense_date: '2026-09-01', item: 'Claude Max', amount: 100, state: 'posted', subscription_id: 's1', payment_method: 'personal_concur', status: 'recorded', receipt_file_id: 'd1' },
    { id: 'b', expense_date: '2026-09-16', item: 'Resend', amount: 20, state: 'posted', subscription_id: 's2', payment_method: 'personal_concur', status: 'submitted' },
    { id: 'c', expense_date: '2026-09-29', item: 'Supabase Pro', amount: 17.5, state: 'expected', subscription_id: 's3', payment_method: 'personal_concur', status: 'recorded' },
    { id: 'd', expense_date: '2026-09-02', item: 'Badges', amount: 45, state: 'posted', payment_method: 'po_invoice', status: 'recorded', notes: 'Invoice requested' },
    { id: 'v', expense_date: '2026-09-05', item: 'Void', amount: 300, state: 'posted', status: 'void' },
    { id: 'x', expense_date: '2026-08-01', item: 'August', amount: 10, state: 'posted', payment_method: 'personal_concur', status: 'recorded' },
  ]
  const receipts = [{ id: 'r', status: 'held', vendor: 'Vercel', date: '2026-09-01' }, { id: 'r2', status: 'review', vendor: 'Staples', date: '2026-08-12' }]
  const list = MC.closeChecklist('2026-09', { expenses: rows, receipts })
  const by = Object.fromEntries(list.items.map(i => [i.key, i]))
  assert.equal(list.ready, false)
  assert.deepEqual([by.posted.ok, by.posted.title, by.posted.detail], [false, '1 September charge not posted yet', 'Supabase Pro, Sep 29'])
  assert.deepEqual([by.receipts.ok, by.receipts.title, by.receipts.ids], [false, '1 September expense with no receipt or note', ['b']], 'the badges have a note; the void row is not counted')
  assert.deepEqual([by.review.ok, by.review.detail], [false, 'Vercel, Sep 1 (held for approval)'], 'a held receipt is still waiting')
  assert.deepEqual([by.concur.ok, by.concur.ids, by.concur.detail], [false, ['a'], '$100.00 · September'])
  const done = MC.closeChecklist('2026-09', {
    expenses: rows.filter(r => r.id !== 'c').map(r => ({ ...r, receipt_file_id: r.receipt_file_id || (r.id === 'b' ? 'd2' : null), status: r.status === 'recorded' && r.payment_method === 'personal_concur' ? 'submitted' : r.status })),
    receipts: [],
  })
  assert.equal(done.ready, true)
  assert.deepEqual(done.items.map(i => i.title), ['2 September charges posted', 'Every September expense has a receipt or a note', 'No September receipts left to review', 'Personal purchases submitted to Concur'])
})

// BUDGET-FIXES-1 item 2.4 changed this: the reminder names the OLDEST due month and how many wait behind it.
test('the Action Center asks on the 5th for the oldest open month, and says how many later ones wait', () => {
  assert.equal(MC.closeReminder(2027, new Set(), '2026-10-04').month, '2026-07', 'July first')
  assert.equal(MC.closeReminder(2027, new Set(['2026-07']), '2026-10-04').month, '2026-08', 'before the 5th, September is not due yet; August is')
  assert.deepEqual(MC.closeReminder(2027, new Set(['2026-07', '2026-08']), '2026-10-05'), { month: '2026-09', name: 'September', label: 'Sep 2026', due: '2026-10-05', later: 0 })
  assert.deepEqual(MC.closeReminder(2027, new Set(), '2026-10-05'), { month: '2026-07', name: 'July', label: 'Jul 2026', due: '2026-08-05', later: 2 })
  assert.equal(MC.closeReminder(2027, new Set(['2026-07', '2026-08', '2026-09']), '2026-10-20'), null)
  const g = NY.budgetGroup({ close: MC.closeReminder(2027, new Set(), '2026-10-05'), now: Date.parse('2026-10-05T12:00:00') })
  assert.deepEqual(g.rows.map(r => [r.chip, r.title, r.pill.text, r.to]), [['Close', 'Close July', 'Close month', '/settings/budget?tab=summary']])
  assert.match(g.rows[0].meta, /due Aug 5, 2026 · 2 later months also open/)
  assert.equal(g.open.to, '/settings/budget?tab=summary')
  assert.ok(read('src/lib/actionCenter/queueModel.js').includes("'Receipt', 'Renew', 'Close']"), 'Close is a chip, last')
  assert.equal(typeof QM.chipCounts, 'function')
})

test('an Expected row counts nowhere but committed: not in Spent, the Concur reminder or Missing receipt', () => {
  const expected = { amount: 20, state: 'expected', status: 'recorded', payment_method: 'personal_concur', expense_date: '2026-06-16', date_precision: 'day' }
  assert.equal(M.counts(expected), false)
  assert.equal(M.counts({ ...expected, state: 'posted' }), true)
  assert.equal(K.needsReceipt({ ...expected, amount: 100 }), false)
  assert.deepEqual(K.concurDue([expected], { params: { remind_after_days: 1, deadline_days: 60 } }, '2026-09-29'), [])
})

// Owner, 2026-09-29: "it should not refuse it. it should just file it for record purposes but notate that
// the date has passed". The Phase 2 block became a warning, and the rows carry the note.
test('a receipt dated in a closed month is filed and marked late, never refused', () => {
  const years = new Map([[2027, { state: 'current', total: 40000, spent: {}, plan: null, closedMonths: ['2026-09'] }]])
  const d = { vendor: 'Staples', date: '2026-09-12', total: 86.4, lines: [{ id: 'l', item: 'Supplies', category: 'Supplies & Materials', quantity: 1, amount: 86.4 }], payment_method: 'personal_concur', business_purpose: '', attendees: [] }
  const out = K.receiptChecks(d, { years, today: TODAY })
  const c = out.checks.find(x => x.key === 'closed_month')
  assert.equal(c.tone, 'warn')
  assert.equal(c.text, 'Dated in September, which is closed. It is filed for the record and marked as received after September closed; Budget history notes it.')
  assert.deepEqual(c.late, { fy: 2027, month: '2026-09', name: 'September' })
  assert.ok(!out.blocked && !out.attachBlocked)
  assert.equal(K.receiptChecks({ ...d, date: '2026-10-02' }, { years, today: TODAY }).blocked, false)
})

// ── The lifecycle, on Postgres ───────────────────────────────────────────────────

const MIGRATIONS = ['20261009000000_program_budget_phase_a', '20261010000000_budget_subscription_approval', '20261011000000_budget_subscription_cells', '20261012000000_budget_expense_zero_quantity', '20261013000000_budget_receipts', '20261021000000_budget_v2_phase1']
async function world({ phase2 = true } = {}) {
  const pg = new PGlite()
  await pg.exec(read('test/fixtures/budgetReceiptsPrelude.sql'))
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('Jester Lloyd Bautista', 'j@x.org', 'owner', true) RETURNING *`)
  for (const m of MIGRATIONS) await pg.exec(runnable(read(`supabase/migrations/${m}.sql`)))
  if (phase2) { const sql = runnable(read('supabase/migrations/20261022000000_budget_v2_phase2.sql')); await pg.exec(sql); await pg.exec(sql) }
  await pg.exec(runnable(read('db/migrations/seed_program_budget_fy26.sql')))
  await pg.exec(runnable(read('db/migrations/seed_program_budget_subscriptions_proposed.sql')))
  const db = pgliteRest(pg)
  await E.startYear(db, owner, { fy: 2027, total: 40000, cost_center: 'Nursing Education', plan: 'none', today: TODAY })
  const subId = async (name) => (await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })).subscriptions.find(s => s.name === name).id
  return { pg, db, owner, subId }
}
const year = (db, today = TODAY, viewer = 'owner') => E.loadYear(db, { fy: 2027, viewer, today })

test('the migration adds state and closed months, keeps every row Posted, and runs twice', async () => {
  const { pg } = await world()
  await assert.rejects(pg.exec(`INSERT INTO budget_expenses (budget_id, expense_date, item, amount, state) SELECT id, '2026-09-01', 'x', 1, 'expected' FROM budgets WHERE fiscal_year = 2027`), /chk_budget_expenses_state/, 'only a subscription charge can be Expected')
  assert.deepEqual((await pg.query(`SELECT DISTINCT state FROM budget_expenses`)).rows, [{ state: 'posted' }], 'the FY26 rows are Posted')
  await assert.rejects(pg.exec(`INSERT INTO budget_months (budget_id, month) SELECT id, '2026-09-02' FROM budgets WHERE fiscal_year = 2027`), /chk_budget_months_first/)
  await assert.rejects(pg.exec(`INSERT INTO budget_events (budget_id, kind, message) SELECT id, 'month_gone', 'x' FROM budgets WHERE fiscal_year = 2027`), /chk_budget_events_kind/)
})

test('approving a plan posts what is due and expects the rest; Expected is committed, never Spent', async () => {
  const { db, owner, subId } = await world()
  await E.decideProposal(db, owner, { id: await subId('Resend'), decision: 'from_year_start', today: TODAY })
  let y = await year(db)
  const resend = y.expenses.filter(e => e.item === 'Resend')
  assert.deepEqual(resend.filter(e => e.state === 'posted').map(e => e.expense_date), ['2026-07-16', '2026-08-16', '2026-09-16'])
  assert.deepEqual(resend.filter(e => e.state === 'expected').map(e => e.expense_date), ['2026-10-16', '2026-11-16', '2026-12-16', '2027-01-16', '2027-02-16', '2027-03-16', '2027-04-16', '2027-05-16', '2027-06-16'])
  assert.deepEqual([y.summary.spent, y.summary.committed, y.summary.expenseCount], [60, 180, 3])

  // On its date the Expected row posts, once.
  await E.postDueCharges(db, { today: '2026-10-16' })
  await E.postDueCharges(db, { today: '2026-10-16' })
  y = await year(db, '2026-10-16')
  assert.equal(y.expenses.find(e => e.expense_date === '2026-10-16').state, 'posted')
  assert.equal(y.expenses.filter(e => e.item === 'Resend').length, 12, 'no row twice')
  assert.equal(y.summary.spent, 80)

  // An Expected row is the plan's to change, not the Sheet's.
  const next = y.expenses.find(e => e.expense_date === '2026-11-16')
  await assert.rejects(E.updateExpense(db, owner, { id: next.id, patch: { amount: 5 }, today: '2026-10-16' }), /Expected/)
  // Ending the plan takes the charges it will no longer make.
  await E.updateSubscription(db, owner, { id: await subId('Resend'), patch: { end_date: '2026-12-31' }, today: '2026-10-16' })
  y = await year(db, '2026-10-16')
  assert.deepEqual(y.expenses.filter(e => e.item === 'Resend' && e.state === 'expected').map(e => e.expense_date), ['2026-11-16', '2026-12-16'])
  // A new amount reaches the Expected rows, not the posted ones.
  await E.updateSubscription(db, owner, { id: await subId('Resend'), patch: { amount: 25 }, today: '2026-10-16' })
  y = await year(db, '2026-10-16')
  assert.deepEqual(y.expenses.filter(e => e.item === 'Resend').map(e => e.amount), [20, 20, 20, 20, 25, 25])
})

test('before the Phase 2 update nothing is Expected and charges post as they did', async () => {
  const { db, owner, subId } = await world({ phase2: false })
  await E.decideProposal(db, owner, { id: await subId('Resend'), decision: 'from_year_start', today: TODAY })
  const y = await year(db)
  assert.equal(y.expenses.filter(e => e.item === 'Resend').length, 3)
  assert.deepEqual(y.close, { enabled: false })
  await assert.rejects(E.closeMonth(db, owner, { fy: 2027, month: '2026-09', note: 'x', today: TODAY }), /20261022000000_budget_v2_phase2\.sql/)
})

test('September closes from its checklist or with a note, locks its rows, and reopens', async () => {
  const { pg, db, owner, subId } = await world()
  await E.decideProposal(db, owner, { id: await subId('Resend'), decision: 'from_year_start', today: TODAY })
  let y = await year(db)
  // BUDGET-FIXES-1 item 2.4 changed this: July comes first, and September waits for it.
  assert.equal(y.close.target, '2026-07')
  assert.equal(y.close.due, '2026-08-05')
  await assert.rejects(E.closeMonth(db, owner, { fy: 2027, month: '2026-09', note: 'x', today: TODAY }), (e) => e.code === 'close_in_order' && e.message === 'Close July first. Months close in order, oldest first.')
  for (const m of ['2026-07', '2026-08']) await E.closeMonth(db, owner, { fy: 2027, month: m, note: 'Closed in order.', today: TODAY })
  y = await year(db)
  assert.equal(y.close.target, '2026-09')
  assert.equal(y.close.due, '2026-10-05')
  assert.deepEqual(y.close.months.slice(0, 4).map(m => [m.key, m.posted, m.expected, !!m.closed_at]), [['2026-07', 20, 0, true], ['2026-08', 20, 0, true], ['2026-09', 20, 0, false], ['2026-10', 0, 20, false]])
  const sep = y.close.checklists['2026-09']
  assert.deepEqual(sep.items.map(i => i.ok), [true, false, true, false], 'the Resend charge has no receipt and is not submitted')
  assert.equal((await year(db, TODAY, 'reader')).close.checklists, undefined, 'a reader never sees the checklist')

  await assert.rejects(E.closeMonth(db, owner, { fy: 2027, month: '2026-09', today: TODAY }), (e) => e.code === 'not_ready' && /no receipt or note/.test(e.message))
  const marked = await E.markConcurSubmitted(db, owner, { fy: 2027, month: '2026-09', today: TODAY })
  assert.equal(marked.submitted, 1)
  const out = await E.closeMonth(db, owner, { fy: 2027, month: '2026-09', note: 'Resend receipt requested from the vendor.', today: TODAY })
  assert.equal(out.message, 'September closed with your note. Leadership sees it.')

  y = await year(db)
  assert.ok(y.close.months.find(m => m.key === '2026-09').closed_at)
  assert.equal(y.close.target, null, 'every month to date is closed')
  assert.ok(y.budget.last_reconciled_at, 'Last reconciled is updated')
  assert.equal(y.history[0].message, 'September 2026 closed with a note: Resend receipt requested from the vendor.')
  const reader = await year(db, TODAY, 'reader')
  assert.equal(reader.close.months.find(m => m.key === '2026-09').note, 'Resend receipt requested from the vendor.', 'leadership sees the note')

  // Locked: no edit, delete or new row in September; October is open.
  const row = y.expenses.find(e => e.expense_date === '2026-09-16')
  await assert.rejects(E.updateExpense(db, owner, { id: row.id, patch: { notes: 'x' }, today: TODAY }), (e) => e.code === 'month_closed' && e.message === 'September 2026 is closed. Reopen it on the Summary to change its rows.')
  await assert.rejects(E.deleteExpenses(db, owner, { ids: [row.id] }), /closed/)
  await assert.rejects(E.createExpense(db, owner, { fields: { expense_date: '2026-09-20', item: 'Late', amount: 5 }, today: TODAY }), /closed/)
  await assert.rejects(E.updateExpense(db, owner, { id: y.expenses.find(e => e.expense_date === '2026-08-16').id, patch: { expense_date: '2026-09-02' }, today: TODAY }), /closed/, 'nor can a row move into it')
  const ctx = await R.checksContext(db, TODAY)
  assert.deepEqual(ctx.years.get(2027).closedMonths, ['2026-07', '2026-08', '2026-09'], 'a receipt dated in a closed month is filed late')

  await assert.rejects(E.closeMonth(db, owner, { fy: 2027, month: '2026-09', note: 'again', today: TODAY }), /already closed/)
  const re = await E.reopenMonth(db, owner, { fy: 2027, month: '2026-09', today: TODAY })
  assert.equal(re.message, 'September reopened. Its rows can change again.')
  await E.updateExpense(db, owner, { id: row.id, patch: { notes: 'Receipt on the way' }, today: TODAY })
  y = await year(db)
  assert.equal(y.history[0].message, 'September 2026 reopened.')
  assert.deepEqual(y.close.checklists['2026-09'].items.map(i => i.ok), [true, true, true, true], 'the note answers the missing receipt')
  await E.closeMonth(db, owner, { fy: 2027, month: '2026-09', today: TODAY })
  assert.equal((await year(db)).history[0].message, 'September 2026 closed and reconciled.')
  assert.equal((await pg.query(`SELECT count(*)::int AS n FROM budget_events WHERE kind IN ('month_closed', 'month_reopened')`)).rows[0].n, 5, 'July, August, and September three times')
})

test('the Action Center hears about the month from the 5th', async () => {
  const { db, owner } = await world()
  assert.equal((await E.closeQueue(db, { today: '2026-09-29' })).month, '2026-07', 'the oldest open month (item 2.4)')
  assert.deepEqual(await E.closeQueue(db, { today: '2026-10-05' }), { month: '2026-07', name: 'July', label: 'Jul 2026', due: '2026-08-05', later: 2 })
  for (const m of ['2026-07', '2026-08', '2026-09']) await E.closeMonth(db, owner, { fy: 2027, month: m, note: 'Nothing posted.', today: '2026-10-05' })
  assert.equal(await E.closeQueue(db, { today: '2026-10-05' }), null)
})

test('the API names each new action, Owner-only, and the queue carries the close reminder', () => {
  const api = read('api/budget-staff.js')
  for (const a of ['month_close', 'month_reopen', 'concur_mark_submitted']) assert.match(api, new RegExp(`${a}: \\['action', 'fiscal_year', 'month'`), a)
  assert.match(api, /close: await E\.closeQueue\(db, day\)/)
  assert.match(api, /const READS = new Set\(\['status', 'load', 'export', 'renewals'\]\)/)
  assert.match(read('src/lib/home/homeLoaders.js'), /close: q\?\.close \|\| null/)
})

test('the Sheet shows Stage, Missing, closed-month locks, and Expected rows below it', () => {
  const sheet = read('src/components/budget/BudgetSheet.jsx')
  assert.match(sheet, /tail=\{\{ label: 'Expected · not counted as spent yet', rows: expectedRows \}\}/)
  // BUDGET-FIXES-1 release 2 changed this: one Stage column replaced State, Status and Concur.
  assert.match(sheet, /\{ key: 'stage', label: 'Stage', type: 'choice'/)
  assert.doesNotMatch(sheet, /key: '(state|concur|status)', label:/)
  assert.match(sheet, /isLocked=\{\(row, col\) => inClosed\(row\) \|\| \(col\.key === 'stage' && row\.raw\.state === 'expected'\)\}/)
  const es = read('src/components/sheet/EditableSheet.jsx')
  assert.match(es, /tail\?\.rows\?\.length > 0 && !search\.trim\(\) && !filters\.length && !quick/)
  assert.match(read('src/components/budget/BudgetSummary.jsx'), /<BudgetClose year=\{year\} canEdit=\{canEdit\} onWrite=\{onWrite\} onGo=\{onGo\} \/>/)
})
