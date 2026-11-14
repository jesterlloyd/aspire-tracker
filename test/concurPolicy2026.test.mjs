// test/concurPolicy2026.test.mjs
//
// CONCUR-POLICY-2026 (Owner, 2026-11-13): Budget Tracker and Keith follow the Cedars-Sinai Expense
// Reimbursement Policy effective November 1, 2026. The deadline is 90 days, no screen types the
// number, and the migration carries the rules, both Keith skills and the Knowledge Center entry.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const C = await import('../src/lib/budget/receiptChecks.js')
const F = await import('../src/lib/budget/filedModel.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const RULE = { key: 'concur_60_days', enabled: true, tone: 'warn', applies_to: 'personal_concur', message: 'Submit this in Concur by {deadline}.', params: { remind_after_days: 75, deadline_days: 90 } }

test('the deadline is 90 days, and 90 is the fallback when a rule carries no number', () => {
  assert.equal(C.DEFAULT_DEADLINE_DAYS, 90)
  assert.equal(C.DEFAULT_REMIND_AFTER_DAYS, 75)
  assert.equal(C.concurDeadline('2026-11-01', RULE), '2027-01-30', 'the Vercel receipt of Nov 1 is due Jan 30')
  assert.equal(C.concurDeadline('2026-11-01', { key: 'concur_60_days', params: {} }), '2027-01-30')
  assert.deepEqual(C.concurTiming('2026-11-01', RULE, '2026-11-13'), { deadline: '2027-01-30', daysLeft: 78, days: 90, timing: 'ok' })
  assert.equal(C.concurDeadline('2026-11-01', { ...RULE, enabled: false }), null)
})

test('the words name the rule’s own limit', () => {
  const r = (date) => ({ id: 'a', date, concurState: 'open', paid: false, due: C.concurTiming(date, RULE, '2026-11-13'), rows: [{ id: 'x' }] })
  assert.equal(F.deadlineNote(r('2026-11-01')).text, '78 days left under the 90-day limit.')
  assert.equal(F.deadlineNote(r('2026-08-01')).strong, '14 days past the 90-day limit.')
  const g = F.subscriptionGrid({ subscriptions: [], expenses: [], receipts: [], fy: 2027, today: '2026-11-13', rule: RULE })
  assert.equal(g.limitDays, 90)
  assert.equal(F.gridNotes({ late: 1, lateMonths: ['July'], limitDays: 90 })[0].strong, '1 charge is past the 90-day limit.')
})

test('the reminder starts at day 75', () => {
  const e = (date) => ({ id: date, expense_date: date, payment_method: 'personal_concur', status: 'recorded', amount: 20 })
  const due = C.concurDue([e('2026-08-30'), e('2026-09-15')], RULE, '2026-11-13')
  assert.deepEqual(due.map(x => [x.expense.id, x.deadline, x.daysLeft]), [['2026-08-30', '2026-11-28', 15]])
})

test('meals: $25 a person warns, and a routine workday meal is named', () => {
  const rules = [
    { key: 'meal_per_person', tone: 'warn', applies_to: 'all', message: '{each} each for {people} attendees; the limit is {limit}.', params: { limit: 25, categories: ['Meals & Catering'] } },
    { key: 'workday_meals', tone: 'info', applies_to: 'personal_concur', message: 'Routine workday meals are generally not reimbursable.', params: { categories: ['Meals & Catering'] } },
  ]
  const draft = (amount, n, method = 'personal_concur') => ({
    date: '2026-11-05', vendor: 'Cafe', payment_method: method, business_purpose: 'Preceptor training',
    lines: [{ item: 'Lunch', category: 'Meals & Catering', amount }], attendees: Array.from({ length: n }, (_, i) => ({ name: `Person ${i + 1}` })),
  })
  const keys = (d) => C.receiptChecks(d, { rules, today: '2026-11-13' }).checks.filter(c => c.rule).map(c => [c.rule, c.tone, c.text])
  assert.deepEqual(keys(draft(120, 4)), [
    ['meal_per_person', 'warn', '$30.00 each for 4 attendees; the limit is $25.00.'],
    ['workday_meals', 'info', 'Routine workday meals are generally not reimbursable.'],
  ])
  assert.deepEqual(keys(draft(100, 4)).map(k => k[0]), ['workday_meals'], '$25 each is within the limit')
  assert.deepEqual(keys(draft(120, 0)).map(k => k[0]), ['workday_meals'], 'no attendees named: nothing to divide by')
  assert.deepEqual(keys(draft(100, 4, 'p_card')), [], 'the workday reminder is reimbursement only')
  const supplies = { ...draft(120, 4), lines: [{ item: 'Pouches', category: 'Supplies', amount: 120 }] }
  assert.deepEqual(keys(supplies), [], 'not a meal')
})

test('no screen or model types the old limit', () => {
  const files = ['src/lib/budget/filedModel.js', 'src/lib/budget/receiptChecks.js', 'lib/server/budget/concur.js',
    ...readdirSync(new URL('../src/components/budget/', import.meta.url)).filter(f => /\.jsx?$/.test(f) && !/ \d\./.test(f)).map(f => `src/components/budget/${f}`)]
  for (const f of files) {
    const code = read(f).split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    assert.doesNotMatch(code, /60[- ]days?\b|January 1, 2024/, f)
  }
  assert.match(read('src/components/budget/BudgetReceipts.jsx'), /Expense Reimbursement Policy \(effective November 1, 2026\)/)
})

test('the migration carries the rules, both skills and the Knowledge Center entry', () => {
  const sql = read('supabase/migrations/20261207000000_concur_policy_2026.sql')
  assert.match(sql, /"deadline_days": 90, "remind_after_days": 75/)
  assert.match(sql, /WHERE key = 'concur_60_days'/, 'the key never changes')
  for (const k of ['meal_per_person', 'workday_meals']) assert.ok(sql.includes(`('${k}'`), k)
  assert.match(sql, /ON CONFLICT \(key\) DO NOTHING/)
  const [, prepare] = sql.match(/\$pc\$([\s\S]*?)\$pc\$/)
  const [, late] = sql.match(/\$ln\$([\s\S]*?)\$ln\$/)
  const [, policy] = sql.match(/\$policy\$([\s\S]*?)\$policy\$/)
  assert.match(prepare, /BARN/); assert.match(prepare, /within 90 days/); assert.doesNotMatch(prepare, /60 days/)
  assert.match(prepare, /only as an "info" check/, 'a prior-policy number is never stated as current')
  assert.match(late, /limit_days/); assert.equal(late.split('[REASON]').length > 1, true); assert.doesNotMatch(late, /60-day/)
  assert.match(policy, /Within \*\*90 days\*\*/); assert.match(policy, /BARN/); assert.match(policy, /\[\[Budget Tracker\]\]/)
  assert.doesNotMatch(policy, /within 60 days/i)
  for (const text of [prepare, late, policy]) assert.doesNotMatch(text, /—/, 'no em dashes')
  assert.match(sql, /governance_apply_knowledge_revision/, 'the entry changes as a governed version')
  assert.match(sql, /keith_skill_versions/)
  assert.match(read('lib/server/budget/concur.js'), /limit_days: t\.days/, 'the late note is told the limit')
})
