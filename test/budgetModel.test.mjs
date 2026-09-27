// test/budgetModel.test.mjs
//
// PROGRAM-BUDGET Phase A (2026-09-27): the rules in src/lib/budget/budgetModel.js, the one
// module every Program Budget figure comes from. Dates are fixed so the test never depends on
// the day it runs.

import { test } from 'node:test'
import assert from 'node:assert/strict'

const M = await import('../src/lib/budget/budgetModel.js')
const TODAY = '2026-09-27'

test('fiscal years are the ending year, labelled short', () => {
  assert.equal(M.fiscalYearOfDate('2026-09-03'), 2027)
  assert.equal(M.fiscalYearOfDate('2026-03-15'), 2026)
  assert.equal(M.fyShort(2027), 'FY27')
  assert.equal(M.fyRangeText(2027), 'Jul 1, 2026 to Jun 30, 2027')
  assert.equal(M.dateText('2026-01-01', 'month'), 'Jan 2026')
  assert.equal(M.dateText('2026-09-03'), 'Sep 3, 2026')
})

test('a year is not started, current or closed, and closing is derived from the date', () => {
  assert.equal(M.yearState(null, 2027, TODAY), 'not_started')
  assert.equal(M.yearState({ started_at: '2026-07-02T00:00:00Z' }, 2027, TODAY), 'current')
  assert.equal(M.yearState({ started_at: '2025-07-01T00:00:00Z' }, 2026, TODAY), 'closed')
  assert.equal(M.yearState({ started_at: '2026-07-02T00:00:00Z' }, 2027, '2027-07-01'), 'closed', 'closes itself after June 30')
  assert.equal(M.yearElapsed(2026, TODAY), 1)
  assert.equal(M.yearElapsed(2028, TODAY), 0)
  assert.ok(Math.abs(M.yearElapsed(2027, TODAY) - 89 / 365) < 1e-9, 'Jul 1 to Sep 27 is 89 days of 365')
})

test('payment method decides the statuses, and a change resets an invalid status', () => {
  assert.deepEqual(M.statusesFor('p_card'), ['paid', 'void'])
  assert.deepEqual(M.statusesFor('personal_concur'), ['recorded', 'submitted', 'reimbursed', 'void'])
  assert.deepEqual(M.statusesFor('po_invoice'), ['recorded', 'paid', 'void'])
  assert.deepEqual(M.statusesFor(null), ['recorded', 'void'])
  assert.equal(M.defaultStatus('p_card'), 'paid')
  assert.equal(M.defaultStatus('personal_concur'), 'recorded')
  assert.equal(M.statusAfterPaymentChange('p_card', 'recorded'), 'paid')
  assert.equal(M.statusAfterPaymentChange('personal_concur', 'void'), 'void', 'a valid status is kept')
  assert.equal(M.statusAfterPaymentChange('po_invoice', 'submitted'), 'recorded')
  assert.deepEqual(M.STATUSES.map(s => [s.label, s.tone]), [['Recorded', 'blue'], ['Submitted', 'amber'], ['Paid', 'green'], ['Reimbursed', 'green'], ['Void', 'grey']])
})

test('charge dates step from the anchor and clamp to the end of a short month', () => {
  const monthly = { anchor_date: '2026-01-31', billing: 'monthly', start_date: '2026-01-01', end_date: null }
  assert.deepEqual(M.chargesIn(monthly, '2026-01-01', '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  const leap = { anchor_date: '2024-02-29', billing: 'annual', start_date: '2024-01-01', end_date: null }
  assert.deepEqual(M.chargesIn(leap, '2024-01-01', '2028-12-31'), ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'])
  const bounded = { anchor_date: '2026-07-20', billing: 'monthly', start_date: '2026-08-01', end_date: '2026-10-19' }
  assert.deepEqual(M.chargesIn(bounded, '2026-01-01', '2027-06-30'), ['2026-08-20', '2026-09-20'], 'only between start and end')
  assert.equal(M.nextCharge({ anchor_date: '2026-10-15', billing: 'annual', start_date: '2023-10-15' }, TODAY), '2026-10-15')
})

const survey = { id: 's1', name: 'Survey platform', plan: 'Team plan', vendor: 'Survey vendor', billing: 'annual', amount: 600, anchor_date: '2026-10-15', start_date: '2023-10-15', end_date: null, auto_renew: true, payment_method: 'p_card', category_id: 'tech' }
const design = { id: 's2', name: 'Design tool', plan: 'Pro', billing: 'monthly', amount: 15, anchor_date: '2026-10-03', start_date: '2025-01-03', end_date: null, auto_renew: true, payment_method: 'p_card', category_id: 'mkt' }
const usage = { id: 's3', name: 'Keith model usage', billing: 'usage', amount: 120, anchor_date: '2026-10-01', start_date: '2026-01-01', end_date: null, auto_renew: true, payment_method: 'personal_concur', category_id: 'tech' }

test('committed spend is every charge from tomorrow to June 30, and only in a current year', () => {
  const c = M.committedSpend([survey, design, usage], 2027, 'current', TODAY)
  // survey: Oct 15 (600). design: Oct..Jun = 9 x 15 = 135. usage: Oct..Jun = 9 x 120 = 1080.
  assert.equal(c.total, 1815)
  assert.equal(c.byMonth.Oct, 735)
  assert.equal(c.byMonth.Jun, 135)
  assert.equal(M.committedSpend([survey], 2026, 'closed', TODAY).total, 0)
  assert.equal(M.committedSpend([survey], 2027, 'not_started', TODAY).total, 0)
  assert.equal(M.perYear(design, TODAY), 180)
  assert.equal(M.perYear(survey, TODAY), 600)
  assert.equal(M.perYear(usage, TODAY), 1440)
})

test('an annual plan renewing within 45 days is a decision until kept, cancelled or snoozed', () => {
  assert.deepEqual(M.pendingRenewal(survey, TODAY), { date: '2026-10-15', days: 18 })
  assert.equal(M.subscriptionStatus(survey, TODAY).label, 'Renews soon')
  assert.equal(M.pendingRenewal(design, TODAY), null, 'monthly plans never ask')
  assert.equal(M.pendingRenewal({ ...survey, renewal_kept_for: '2026-10-15' }, TODAY), null, 'Keep answers this renewal')
  assert.ok(M.pendingRenewal({ ...survey, renewal_kept_for: '2025-10-15' }, TODAY), 'last year’s Keep does not answer this one')
  assert.equal(M.renewalsToDecide([{ ...survey, renewal_remind_after: '2026-10-04' }], TODAY).length, 0, 'Remind me in 7 days hides it')
  assert.equal(M.renewalsToDecide([{ ...survey, renewal_remind_after: '2026-10-04' }], '2026-10-04').length, 1, 'and it comes back')
  const cancel = M.cancelAtRenewal(survey, TODAY)
  assert.deepEqual(cancel, { end_date: '2026-10-14', auto_renew: false })
  const cancelled = { ...survey, ...cancel }
  assert.equal(M.subscriptionStatus(cancelled, TODAY).label, 'Ending')
  assert.equal(M.subscriptionStatus(cancelled, '2026-10-14').label, 'Cancelled')
  assert.equal(M.committedSpend([cancelled], 2027, 'current', TODAY).total, 0, 'a cancelled renewal is no longer committed')
})

test('charges post once per date, only into started years, from July 1 to today', () => {
  const posted = new Set(['2026-07-03'])
  assert.deepEqual(M.chargesToPost(design, [2027], posted, TODAY).map(x => x.date), ['2026-08-03', '2026-09-03'])
  assert.deepEqual(M.chargesToPost(design, [], new Set(), TODAY), [], 'a year that has not started posts nothing')
  const row = M.chargeExpense(design, '2026-09-03')
  assert.deepEqual([row.item, row.quantity, row.amount, row.status, row.source, row.charge_date, row.description], ['Design tool', 1, 15, 'paid', 'subscription', '2026-09-03', 'Pro subscription'])
  assert.equal(M.chargeExpense(usage, '2026-09-01').status, 'recorded')
})

// The FY26 workbook's Expense Report, as the seed imports it (month precision; Jan-Mar are 2026).
const CATS = [{ id: 'sup', name: 'Supplies & Materials' }, { id: 'prn', name: 'Printing & Copying' }, { id: 'mkt', name: 'Marketing' }]
const FY26 = [
  ['2026-01-01', 'sup', 1, 11.71], ['2026-01-01', 'sup', 1, 30.27], ['2026-01-01', 'sup', 3, 33.52], ['2026-02-01', 'sup', 3, 25.14],
  ['2026-03-01', 'prn', 1, 67.5], ['2026-03-01', 'sup', 3, 72.3], ['2026-03-01', 'sup', 40, 350], ['2026-03-01', 'sup', 100, 30],
  ['2026-03-01', 'sup', 40, 400], ['2026-03-01', 'sup', 40, 600],
].map(([d, c, q, a], i) => ({ id: `e${i}`, expense_date: d, date_precision: 'month', category_id: c, quantity: q, amount: a, status: null }))

test('the Summary of the imported FY26 year matches the workbook', () => {
  const s = M.budgetSummary({ fy: 2026, budget: { total: 40000, started_at: '2025-07-01T00:00:00Z' }, expenses: FY26, categories: CATS, today: TODAY })
  assert.equal(s.state, 'closed')
  assert.equal(s.spent, 1620.44)
  assert.equal(s.remaining, 38379.56)
  assert.equal(s.committed, 0)
  assert.equal(s.expenseCount, 10)
  assert.deepEqual(s.byMonth.filter(m => m.spent).map(m => [m.month, m.spent]), [['Jan', 75.5], ['Feb', 25.14], ['Mar', 1519.8]])
  assert.equal(s.byCategory.find(c => c.id === 'sup').spent, 1552.94)
  assert.equal(s.largestCategory, 'Supplies & Materials')
  assert.equal(s.evenPace, 3333.33)
  assert.deepEqual(s.costPerStudent, { state: 'untagged' })
  assert.equal(s.hasPlan, false)
})

test('void rows are not spend, and cost per student needs a roster size', () => {
  const ex = [{ id: 'a', expense_date: '2026-09-03', amount: 100, quantity: 1, status: 'paid', cohort_id: 'c1', category_id: 'sup' },
    { id: 'b', expense_date: '2026-09-04', amount: 50, quantity: 1, status: 'void', cohort_id: 'c1', category_id: 'sup' },
    { id: 'c', expense_date: '2026-09-05', amount: 30, quantity: 1, status: 'recorded', cohort_id: 'c2', category_id: 'sup' }]
  const base = { fy: 2027, budget: { total: 40000, started_at: '2026-07-01T00:00:00Z' }, expenses: ex, categories: CATS, today: TODAY }
  assert.equal(M.budgetSummary(base).spent, 130)
  assert.deepEqual(M.budgetSummary({ ...base, roster: new Map([['c1', { name: 'Fall 2026', size: 40 }]]) }).costPerStudent,
    { state: 'ok', cohortId: 'c1', cohort: 'Fall 2026', size: 40, spend: 100, value: 2.5 })
  assert.equal(M.budgetSummary({ ...base, roster: new Map([['c1', { name: 'Fall 2026', size: null }]]) }).costPerStudent.state, 'size_pending')
  const months = M.budgetSummary(base).byMonth
  assert.equal(months.find(m => m.month === 'Sep').future, false)
  assert.equal(months.find(m => m.month === 'Oct').future, true, 'future months fade')
})

test('leadership and Admin see a category plan only once it is saved, and only the saved figures', () => {
  const allocations = [{ category_id: 'sup', amount: 6000, saved_amount: null }]
  const base = { fy: 2027, budget: { total: 40000, started_at: '2026-07-01T00:00:00Z', plan_saved_at: null }, categories: CATS, allocations, today: TODAY }
  assert.equal(M.budgetSummary({ ...base, viewer: 'owner' }).byCategory[0].allocated, 6000, 'the owner sees the draft')
  assert.equal(M.budgetSummary({ ...base, viewer: 'reader' }).byCategory[0].allocated, null, 'a reader sees no draft')
  assert.equal(M.budgetSummary({ ...base, viewer: 'reader' }).hasPlan, false)
  const saved = { ...base, budget: { ...base.budget, plan_saved_at: '2026-09-01T00:00:00Z' }, allocations: [{ category_id: 'sup', amount: 7000, saved_amount: 6000 }] }
  assert.equal(M.budgetSummary({ ...saved, viewer: 'reader' }).byCategory[0].allocated, 6000, 'a later draft edit stays with the owner')
})

test('allocations split evenly to the cent and flag over-allocation', () => {
  const parts = M.splitEvenly(40000, 14)
  assert.equal(parts.length, 14)
  assert.equal(Math.round(parts.reduce((a, b) => a + b, 0) * 100), 4000000)
  assert.deepEqual(M.allocationTotals(40000, [30000, 12000]), { assigned: 42000, left: -2000, over: true })
  assert.equal(M.parseMoney('$1,250.50'), 1250.5)
  assert.equal(M.parseMoney('12.345'), null)
  assert.equal(M.budgetChangedMessage(40000, 42500), 'Budget changed from $40,000.00 to $42,500.00.')
  assert.equal(M.budgetSetMessage(40000, 'from the FY26 workbook'), 'Budget set to $40,000.00, from the FY26 workbook.')
})
