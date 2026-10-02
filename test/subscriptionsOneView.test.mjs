// test/subscriptionsOneView.test.mjs
//
// Owner, 2026-10-02. SUBSCRIPTIONS-ONE-VIEW-1: "I want to be able to see my subscriptions, when they are
// due, how much do they cost, track my concur status on them and see a visual of if they are going to be
// late ... preferable in one view not two", and "Portal gets less". SHEET-IS-EXPENSES-1: "Sheet doesn't
// really mean anything. Sheet is the view. Expenses are what it is." COST-CENTER-FIX-1: the cost center
// in the header "wouldn't stick".

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const F = await import('../src/lib/budget/filedModel.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const code = (s) => s.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
const subs = read('src/components/budget/BudgetSubscriptions.jsx')
const table = read('src/components/budget/SubscriptionMonths.jsx')

test('every plan has a row in the one table, charged this year or not', () => {
  const RULE = { key: 'concur_60_days', enabled: true, params: { deadline_days: 60 } }
  const subscriptions = [{ id: 'v', name: 'Vercel Pro', plan: 'Pro', billing: 'monthly', payment_method: 'personal_concur' }, { id: 'a', name: 'Claude Pro annual purchase', plan: 'Claude Pro', billing: 'annual', payment_method: 'personal_concur' }]
  const expenses = [{ id: 'v7', subscription_id: 'v', expense_date: '2026-07-01', amount: 20, status: 'recorded', payment_method: 'personal_concur', state: 'posted' }]
  const all = F.subscriptionGrid({ subscriptions, expenses, fy: 2027, today: '2026-10-02', rule: RULE, all: true })
  assert.deepEqual(all.rows.map(r => [r.vendor, r.charged, r.last]), [['Claude Pro annual purchase', false, null], ['Vercel Pro', true, 20]])
  assert.ok(Object.values(all.rows[0].cells).every(c => c.kind === 'none'), 'a plan not charged yet has empty months, not a missing row')
  assert.equal(all.perYear, 12, 'only a monthly Concur plan that IS charging counts toward the Concur entries')
  assert.equal(F.subscriptionGrid({ subscriptions, expenses, fy: 2027, today: '2026-10-02', rule: RULE }).rows.length, 1, 'without `all`, as before')
})

test('the Owner’s tab is one view: totals once, the one table, decisions when waiting, Edit plans folded', () => {
  const c = code(subs)
  assert.match(c, /className="bud-card bud-substrip" role="group" aria-label="Subscription totals"/)
  assert.doesNotMatch(c, /bud-basis-4|Monthly run rate/, 'the four tiles are gone')
  assert.match(c, /\{canEdit && <SubscriptionMonths year=\{year\} statusOf=\{statusOf\} onOpenReceipt=\{onOpenReceipt\} \/>\}/)
  assert.match(c, /const \[editOpen, setEditOpen\] = useState\(\(\) => subs\.length === 0\)/, 'folded, unless there is nothing yet to show')
  assert.match(c, /aria-expanded=\{editOpen\} onClick=\{\(\) => setEditOpen\(o => !o\)\}/)
  assert.ok(c.indexOf('<SubscriptionMonths') < c.indexOf('Renewals to decide') && c.indexOf('Renewals to decide') < c.indexOf('<EditableSheet'), 'the table, then decisions, then the editor')
  // The table: service, cost, next charge, the months, per year; a month total row; the late note only.
  for (const h of ['Service', 'Cost', 'Next charge', 'Per year']) assert.ok(table.includes(`>${h}</th>`), h)
  assert.match(table, /nextCharge\(s, today\)/)
  assert.match(table, /perYear\(s, today\)/)
  assert.match(table, /const late = gridNotes\(g\)\.find\(n => n\.tone === 'late'\)/)
  assert.doesNotMatch(code(table), /Every charge here repeats monthly|Last charge/)
})

test('leadership sees the totals and the Platform Cost statement only', () => {
  const c = code(subs)
  assert.match(c, /\{canEdit && prop\.count > 0 && \(\s*<section aria-label="Awaiting approval">/)
  assert.match(c, /\{!canEdit && plat\.count > 0 && \(\s*<SurfaceCard className="bud-card bud-platform">/, 'the Owner has the table instead')
  assert.match(c, /\{canEdit && \(\s*<section className="bud-editplans"/, 'no plan-by-plan list for a reader')
})

test('the tab is called Expenses, and so is every mention of it', () => {
  assert.match(read('src/components/budget/ProgramBudgetView.jsx'), /sheet: 'Expenses'/)
  for (const f of ['src/components/budget/ReceiptModal.jsx', 'src/components/budget/ReceiptSlip.jsx', 'src/components/budget/BudgetClose.jsx', 'src/components/budget/BudgetSubscriptions.jsx', 'src/lib/budget/filedModel.js']) {
    assert.doesNotMatch(code(read(f)).replace(/onShowInSheet/g, ''), /Show in Sheet|[Tt]he Sheet\b|'In the Sheet'/, f)
  }
  assert.match(read('src/components/budget/ReceiptModal.jsx'), />Show in Expenses<\/button>/)
  assert.equal(F.trackerSteps({ concurState: 'open', rows: [{ row_label: 'FY27 row 2' }], received_at: '2026-09-29T20:00:00Z' })[1].label, 'In Expenses')
})

test('the cost center editor is drawn where the header cannot clip it, and Enter saves', () => {
  const line = read('src/components/budget/BudgetYearLine.jsx')
  assert.match(line, /createPortal\(\(/)
  assert.match(line, /\), document\.body\)\}/)
  assert.match(line, /onKeyDown=\{e => \{ if \(e\.key === 'Enter'\) save\(\) \}\}/)
  assert.match(line, /if \(busy \|\| !draft\.trim\(\) \|\| draft\.trim\(\) === cc\) return/, 'Enter on an unchanged or empty value does nothing')
  assert.match(line, /!ref\.current\?\.contains\(e\.target\) && !pop\.current\?\.contains\(e\.target\)/, 'a click inside the popover is not a click away')
  const css = read('src/components/budget/budget.css')
  assert.match(css, /\.bud-cc-pop \{ position: fixed; z-index: 2500;/)
  assert.match(css, /\.bud-ccline \{ position: relative; \}/, 'its own name: .bud-cc is the Concur draft’s list')
  // The reason it was cut off is still true of the band, which is why the popover leaves it.
  assert.match(read('src/components/settings/settingsPageHeader.css'), /\.settings-page-sub \{[^}]*overflow: hidden;/)
})
