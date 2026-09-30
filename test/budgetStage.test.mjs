// BUDGET-FIXES-1 release 2 (Owner, 2026-09-30): one Stage in place of the Sheet's State, Status and
// Concur. The report on production found 29 rows, all Personal (Concur), Posted and Recorded: Concur
// was Status in other words, and "Recorded" was Posted or Receipt attached by the receipt. Stage is
// read from what is stored and never stored itself, so no migration and no row count changes.
// Owner's rules: a P-card reads Posted until its receipt is on file; a row marked Submitted with no
// receipt reads Submitted to Concur, and the Receipt column still says Missing beside it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const M = await import('../src/lib/budget/budgetModel.js')
const { withStage } = await import('../src/components/budget/budgetSheetTools.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const row = (o) => ({ state: 'posted', status: 'recorded', payment_method: 'personal_concur', hasReceipt: false, ...o })
const label = (o) => M.stageLabel(M.stageOf(row(o)))

test('every row reads one of the six stages, from what is stored', () => {
  assert.equal(label({ state: 'expected' }), 'Expected')
  assert.equal(label({}), 'Posted')
  assert.equal(label({ hasReceipt: true }), 'Receipt attached')
  assert.equal(label({ status: 'submitted', hasReceipt: true }), 'Submitted to Concur')
  assert.equal(label({ status: 'reimbursed', hasReceipt: true }), 'Reimbursed or Paid')
  assert.equal(label({ payment_method: 'po_invoice', status: 'paid' }), 'Reimbursed or Paid')
  assert.equal(label({ status: 'void', hasReceipt: true }), 'Void')
  assert.equal(M.stageLabel(M.stageOf({ state: 'posted', status: 'recorded', receipt_file_id: 'x' })), 'Receipt attached', 'a stored row, before the view adds hasReceipt')
})

test('the Owner’s two rules: P-card waits for its receipt; Submitted with no receipt says so', () => {
  assert.equal(label({ payment_method: 'p_card', status: 'paid' }), 'Posted')
  assert.equal(label({ payment_method: 'p_card', status: 'paid', hasReceipt: true }), 'Reimbursed or Paid')
  assert.equal(label({ status: 'submitted' }), 'Submitted to Concur')
  assert.match(read('src/components/budget/BudgetSheet.jsx'), /if \(needsReceipt\(row\.raw\)\) return <span className="bud-rc-missing"/, 'Missing still shows beside it')
})

test('production today: 27 Receipt attached and 2 Posted, 29 before and after', () => {
  const rows = [...Array(15).fill(row({ hasReceipt: true })), ...Array(12).fill(row({ hasReceipt: true })), ...Array(2).fill(row({}))]
  const by = rows.reduce((m, r) => ({ ...m, [label(r)]: (m[label(r)] || 0) + 1 }), {})
  assert.deepEqual(by, { 'Receipt attached': 27, Posted: 2 })
})

test('the Stage cell offers only what fits the payment method, and saves the status', () => {
  const opts = (o) => M.stageChoices(row(o)).map(c => [c.label, c.status])
  assert.deepEqual(opts({ hasReceipt: true }), [['Receipt attached', 'recorded'], ['Submitted to Concur', 'submitted'], ['Reimbursed or Paid', 'reimbursed'], ['Void', 'void']])
  assert.deepEqual(opts({}), [['Posted', 'recorded'], ['Submitted to Concur', 'submitted'], ['Reimbursed or Paid', 'reimbursed'], ['Void', 'void']])
  assert.deepEqual(opts({ payment_method: 'po_invoice' }), [['Posted', 'recorded'], ['Reimbursed or Paid', 'paid'], ['Void', 'void']])
  assert.deepEqual(opts({ payment_method: 'p_card', status: 'paid' }), [['Posted', 'paid'], ['Void', 'void']])
  assert.deepEqual(opts({ payment_method: 'p_card', status: 'paid', hasReceipt: true }), [['Reimbursed or Paid', 'paid'], ['Void', 'void']])
})

test('a layout saved with State, Status and Concur keeps its place, width, hiding and grouping on Stage', () => {
  const saved = { order: ['item', 'amount', 'state', 'status', 'receipt', 'concur', 'notes'], hidden: ['month', 'concur'], widths: { status: 150 }, groupBy: 'status' }
  const out = withStage(saved)
  assert.deepEqual(out.order, ['item', 'amount', 'stage', 'receipt', 'notes'])
  assert.deepEqual(out.hidden, ['month'])
  assert.equal(out.widths.stage, 170, 'at least wide enough for Submitted to Concur')
  assert.equal(out.groupBy, 'stage')
  assert.deepEqual(withStage({ order: [], hidden: ['month'] }).order, [], 'a layout with no saved order is left to the natural order')
  assert.deepEqual(withStage({ order: ['status'], hidden: ['status'] }).hidden, ['stage'])
})

test('Stage is the word everywhere the Sheet’s statuses were named', () => {
  const sheet = read('src/components/budget/BudgetSheet.jsx')
  assert.match(sheet, /initialLayout=\{withStage\(/)
  assert.match(sheet, /case 'stage': return \{ status: stageChoices\(row\.raw\)\.find\(c => c\.label === v\)\?\.status \?\? null \}/)
  assert.match(read('lib/server/budget/engine.js'), /'Spent \(\$\)', 'Stage', 'Receipt',/, 'the Excel export')
  assert.match(read('src/components/budget/BudgetFiled.jsx'), /<dt>Stage<\/dt>/)
  assert.match(read('src/components/budget/BudgetClose.jsx'), />Mark all Submitted to Concur<\/button>/)
  const subs = read('src/components/budget/BudgetSubscriptions.jsx')
  assert.match(subs, /Each charge is Expected until its date, then Posted on the Sheet, marked Subscription\./)
  for (const f of ['src/components/budget/BudgetSubscriptions.jsx', 'src/components/budget/BudgetSummary.jsx', 'src/lib/budget/receiptModel.js', 'src/lib/budget/receiptChecks.js']) {
    assert.doesNotMatch(read(f).replace(/^\s*(\/\/|\*).*$/gm, ''), /Recorded or Paid|, Recorded\.|starts as Recorded|Mark them Submitted,/, f)
  }
})
