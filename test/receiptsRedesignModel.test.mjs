// test/receiptsRedesignModel.test.mjs
//
// RECEIPTS-REDESIGN-1 (Owner, 2026-10-01): the pure rules behind Receipts > Filed, the receipt modal
// and the Subscriptions month grid (src/lib/budget/filedModel.js), and the ONE 60-day rule they read
// (receiptChecks.concurTiming). The day is fixed at 2026-10-01, the mockup's.

import { test } from 'node:test'
import assert from 'node:assert/strict'

const F = await import('../src/lib/budget/filedModel.js')
const C = await import('../src/lib/budget/receiptChecks.js')
const TODAY = '2026-10-01'
const RULE = { key: 'concur_60_days', enabled: true, params: { remind_after_days: 45, deadline_days: 60 } }
const due = (date) => C.concurTiming(date, RULE, TODAY)
const rc = (id, date, total, state, extra = {}) => ({ id, date, vendor: id, total, concurState: state, paid: false, due: state === 'open' ? due(date) : null, rows: [{ id: `row-${id}`, row_label: `FY27 row ${id}` }], ...extra })

test('the one 60-day rule: late past the deadline, soon at 14 days or fewer, and no deadline without the rule', () => {
  assert.deepEqual(due('2026-07-01'), { deadline: '2026-08-30', daysLeft: -32, timing: 'late' })
  assert.deepEqual(due('2026-08-06'), { deadline: '2026-10-05', daysLeft: 4, timing: 'soon' })
  assert.equal(due('2026-08-16').timing, 'soon', 'exactly 14 days left is soon')
  assert.equal(due('2026-08-17').timing, 'ok')
  assert.deepEqual(due('2026-09-01'), { deadline: '2026-10-31', daysLeft: 30, timing: 'ok' })
  assert.equal(C.concurTiming('2026-07-01', { ...RULE, enabled: false }, TODAY), null)
  assert.equal(C.concurTiming('2026-07-01', null, TODAY), null)
  assert.equal(C.concurDeadline('2026-07-01', { ...RULE, params: { deadline_days: 30 } }), '2026-07-31', 'the owner’s own number of days')
  assert.deepEqual([due('2026-07-01'), due('2026-08-06'), due('2026-08-02'), due('2026-09-01')].map(C.dueText), ['32 days late', 'Due in 4 days', 'Due today', '30 days left'])
  // The reminder still lists what it listed, now through the same deadline.
  const [row] = C.concurDue([{ expense_date: '2026-08-06', payment_method: 'personal_concur', status: 'recorded', state: 'posted' }], RULE, TODAY)
  assert.deepEqual([row.deadline, row.daysLeft], ['2026-10-05', 4])
})

test('a card says its stage, and how long it has only while it is not submitted', () => {
  assert.deepEqual(F.stageChips(rc('a', '2026-09-01', 20, 'open')), [{ tone: 'open', text: 'Not submitted' }, { tone: 'due', text: '30 days left' }])
  assert.deepEqual(F.stageChips(rc('a', '2026-08-06', 20, 'open')), [{ tone: 'open', text: 'Not submitted' }, { tone: 'soon', text: 'Due in 4 days' }])
  assert.deepEqual(F.stageChips(rc('a', '2026-07-01', 20, 'open')), [{ tone: 'open', text: 'Not submitted' }, { tone: 'late', text: '32 days late' }])
  assert.deepEqual(F.stageChips(rc('a', '2026-07-01', 20, 'submitted')), [{ tone: 'sub', text: 'Submitted' }])
  assert.deepEqual(F.stageChips(rc('a', '2026-07-01', 20, 'reimbursed')), [{ tone: 'paid', text: 'Reimbursed' }])
  assert.deepEqual(F.stageChips({ concurState: null, paid: true }), [{ tone: 'paid', text: 'Paid' }], 'a P-card receipt is Paid and never has a deadline')
  assert.equal(F.cardLabel({ ...rc('a', '2026-09-01', 20, 'open'), vendor: 'Vercel Inc.' }), 'Vercel Inc., $20.00, Sep 1, 2026, not submitted, 30 days left')
})

test('the paper’s mark: a stamp with the STORED date, or a LATE tab; nothing on an on-time open receipt', () => {
  assert.deepEqual(F.paperMark(rc('a', '2026-07-01', 20, 'open')), { kind: 'tab', tone: 'late', word: 'LATE' })
  assert.equal(F.paperMark(rc('a', '2026-07-01', 20, 'open'), { big: true }).word, '32 DAYS LATE')
  assert.equal(F.paperMark(rc('a', '2026-09-01', 20, 'open')), null)
  assert.deepEqual(F.paperMark(rc('a', '2026-07-01', 20, 'submitted', { submitted_at: '2026-09-12T18:00:00Z' })), { kind: 'stamp', tone: 'sub', word: 'SUBMITTED', date: 'SEP 12, 2026' })
  assert.deepEqual(F.paperMark(rc('a', '2026-07-01', 20, 'reimbursed', { reimbursed_at: '2026-09-20T18:00:00Z' })), { kind: 'stamp', tone: 'paid', word: 'REIMBURSED', date: 'SEP 20, 2026' })
  assert.equal(F.paperMark(rc('a', '2026-07-01', 20, 'submitted')).date, '', 'no stored date, no date: never today’s')
  assert.equal(F.stampDate('2026-10-01T05:00:00Z'), 'Sep 30, 2026', 'the Pacific day')
})

test('the status strip counts only Personal (Concur) receipts and names where the late ones are', () => {
  const list = [
    rc('j1', '2026-07-01', 20, 'open'), rc('j2', '2026-07-03', 100, 'open'),
    rc('a1', '2026-08-01', 20, 'open'), rc('a2', '2026-08-06', 10, 'open'), rc('a3', '2026-08-20', 35, 'submitted'),
    rc('s1', '2026-09-01', 20, 'open'), rc('s2', '2026-09-16', 20, 'reimbursed'),
    { id: 'p', date: '2026-09-02', vendor: 'P-card', total: 50, concurState: null, paid: true, due: null, rows: [] },
  ]
  const s = F.filedStats(list)
  assert.deepEqual([s.count, s.total], [8, 275])
  assert.deepEqual([s.concur, s.submitted, s.pct], [7, 2, 29], 'the P-card receipt is not in the Concur count')
  assert.deepEqual([s.late, s.lateWhere], [3, 'All of July, 1 from August'])
  assert.deepEqual([s.soon, s.soonNext], [1, '2026-10-05'])
  assert.deepEqual(F.filedStats([]), { count: 0, total: 0, concur: 0, submitted: 0, pct: 0, late: 0, lateWhere: '', soon: 0, soonNext: null })
})

test('a folder shows its progress, its late and due-soon counts, and where a month’s batch starts', () => {
  const entries = [rc('a1', '2026-08-01', 20, 'open'), rc('a2', '2026-08-06', 10, 'open'), rc('a4', '2026-08-10', 10, 'open'), rc('a3', '2026-08-20', 35, 'submitted')].map(receipt => ({ receipt, part: null }))
  const s = F.folderSummary(entries)
  assert.deepEqual([s.concur, s.submitted, s.open, s.pct, s.late, s.soon, s.soonBy, s.nextDue, s.allSubmitted], [4, 1, 3, 25, 1, 2, '2026-10-09', '2026-09-30', false])
  assert.deepEqual(s.openIds, ['a1', 'a2', 'a4'], 'oldest first: the batch starts with the receipt closest to its limit')
  assert.deepEqual(F.folderChips(s), [{ tone: 'late', text: '1 late' }, { tone: 'soon', text: '2 due by Oct 9' }])
  const done = F.folderSummary([{ receipt: rc('x', '2026-09-01', 20, 'reimbursed') }])
  assert.deepEqual([done.allSubmitted, done.openIds, F.folderChips(done)], [true, [], []])
  // A receipt split across two category folders is one receipt.
  assert.equal(F.folderSummary([{ receipt: entries[0].receipt }, { receipt: entries[0].receipt }]).concur, 1)
})

test('the tracker: four steps for Concur, one Paid step for the P-card, the current one marked', () => {
  const base = { received_at: '2026-09-29T20:00:00Z', read_by_keith: true }
  const open = F.trackerSteps({ ...rc('2', '2026-09-01', 20, 'open'), ...base })
  assert.deepEqual(open.map(s => [s.label, s.state]), [['Received', 'done'], ['In the Sheet', 'done'], ['Submitted to Concur', 'current'], ['Reimbursed', 'todo']])
  assert.deepEqual([open[0].detail, open[1].detail, open[2].detail], ['Sep 29 by Keith', 'FY27 row 2', 'Not yet'])
  const sub = F.trackerSteps({ ...rc('2', '2026-09-01', 20, 'submitted', { submitted_at: '2026-10-01T19:00:00Z' }), ...base })
  assert.deepEqual(sub.map(s => s.state), ['done', 'done', 'done', 'current'])
  assert.equal(sub[2].detail, 'Oct 1, 2026')
  assert.deepEqual(F.trackerSteps({ ...rc('2', '2026-09-01', 20, 'reimbursed'), ...base }).map(s => s.state), ['done', 'done', 'done', 'done'])
  const paid = F.trackerSteps({ ...base, concurState: null, paid: true, rows: [{ row_label: 'FY27 row 9' }] })
  assert.deepEqual(paid.map(s => [s.label, s.state]), [['Received', 'done'], ['In the Sheet', 'done'], ['Paid', 'done']])
})

test('the deadline card is shown only before submission, in three tones', () => {
  assert.deepEqual(F.deadlineNote(rc('a', '2026-07-01', 20, 'open')), { tone: 'late', strong: '32 days past the 60-day limit.', text: 'It was due Aug 30, 2026. Concur may ask why it\'s late.' })
  assert.deepEqual(F.deadlineNote(rc('a', '2026-08-06', 20, 'open')), { tone: 'soon', strong: 'Submit by Oct 5, 2026.', text: '4 days left under the 60-day limit.' })
  assert.equal(F.deadlineNote(rc('a', '2026-09-01', 20, 'open')).tone, 'ok')
  assert.equal(F.deadlineNote(rc('a', '2026-07-01', 20, 'submitted')), null)
  assert.equal(F.deadlineNote({ concurState: null, paid: true }), null)
})

test('the Concur checklist is Keith’s draft in Concur’s order, and Copy all is labeled lines', () => {
  const g = { report_name: 'ASPIRE Platform Infrastructure - September 2026', expense_type: 'Miscellaneous', date: '2026-09-01', amount: 20, vendor: 'Vercel Inc.', description: 'Vercel Pro', business_purpose: 'Runs the app.', attendees: [], checks: [{ tone: 'warn', text: 'Confirm the purpose.' }] }
  const f = F.concurFields(g)
  assert.deepEqual(f.map(x => x.label), ['Report name', 'Expense type', 'Transaction date', 'Amount', 'Vendor', 'Description', 'Business purpose'])
  assert.deepEqual([f[2].value, f[3].value], ['Sep 1, 2026', '$20.00'])
  assert.equal(F.copyAllText(f).split('\n')[3], 'Amount: $20.00')
  assert.deepEqual(F.concurFields(null), [])
  assert.equal(F.needsPolicyConfirm(g), true)
  assert.equal(F.needsPolicyConfirm({ checks: [{ tone: 'info', text: 'x' }] }), false)
  assert.equal(F.needsPolicyConfirm(null), false, 'no draft, no confirmation to give')
})

test('the footer’s one button follows the stage, and waits for the policy tick when there is one', () => {
  const warn = { checks: [{ tone: 'warn', text: 'Confirm.' }] }
  const open = rc('a', '2026-09-01', 20, 'open', { concur: warn })
  assert.deepEqual(F.footerState(open), { action: 'submit', label: 'Mark submitted to Concur', disabled: true, hint: 'Confirm the business purpose above to continue.', tone: 'warn' })
  assert.deepEqual(F.footerState(open, { confirmed: true }), { action: 'submit', label: 'Mark submitted to Concur', disabled: false, hint: 'The Sheet’s Stage and Submitted to Concur box update too.', tone: '' })
  assert.equal(F.footerState(rc('a', '2026-09-01', 20, 'open')).disabled, false, 'no warning, nothing to confirm')
  assert.equal(F.footerState(open, { confirmed: true, batch: true, isLast: false }).label, 'Mark submitted and go to next')
  assert.equal(F.footerState(open, { confirmed: true, batch: true, isLast: true }).label, 'Mark submitted to Concur')
  const sub = F.footerState(rc('a', '2026-09-01', 20, 'submitted', { submitted_at: '2026-10-01T19:00:00Z' }))
  assert.deepEqual([sub.action, sub.label, sub.hint], ['reimburse', 'Mark reimbursed', 'Submitted Oct 1, 2026. Mark it reimbursed when the money arrives.'])
  const paid = rc('a', '2026-09-01', 20, 'reimbursed', { reimbursed_at: '2026-10-02T19:00:00Z' })
  assert.deepEqual([F.footerState(paid, { isLast: false }).label, F.footerState(paid).label, F.footerState(paid).tone, F.footerState(paid).hint], ['Next receipt', 'Done', 'good', 'Reimbursed Oct 2, 2026. This receipt is complete.'])
  assert.equal(F.footerState({ concurState: null, paid: true }).action, 'done', 'a P-card receipt never shows a Concur action')
})

test('the Subscriptions grid: every plan and month so far with its status, the next month Expected, and the two notes', () => {
  const exp = (id, sub, date, amount, status = 'recorded', extra = {}) => ({ id, subscription_id: sub, expense_date: date, amount, status, payment_method: 'personal_concur', state: 'posted', ...extra })
  const subscriptions = [{ id: 'v', name: 'Vercel', plan: 'Pro', billing: 'monthly' }, { id: 'r', name: 'Resend', plan: 'Transactional Pro', billing: 'monthly' }, { id: 'z', name: 'Zoom', plan: 'Annual', billing: 'annual' }, { id: 'n', name: 'Never charged', plan: '', billing: 'monthly' }]
  const expenses = [
    exp('v7', 'v', '2026-07-01', 20), exp('v8', 'v', '2026-08-01', 20, 'submitted'), exp('v9', 'v', '2026-09-01', 20),
    exp('r7', 'r', '2026-07-16', 20, 'reimbursed'), exp('r8', 'r', '2026-08-16', 20), exp('r9', 'r', '2026-09-16', 20),
    exp('z8', 'z', '2026-08-10', 150, 'paid', { payment_method: 'p_card' }),
    exp('v10', 'v', '2026-10-01', 20, 'recorded', { state: 'expected' }),
    exp('old', 'v', '2026-06-01', 20), exp('gone', 'v', '2026-09-02', 99, 'recorded', { deleted_at: 'x' }),
  ]
  const receipts = [{ id: 'rc-v7', rows: [{ id: 'v7' }] }]
  const g = F.subscriptionGrid({ subscriptions, expenses, receipts, fy: 2027, today: TODAY, rule: RULE })
  assert.deepEqual(g.months.map(m => m.short), ['Jul', 'Aug', 'Sep', 'Oct'])
  assert.equal(g.next.short, 'Nov')
  assert.deepEqual(g.rows.map(r => r.vendor), ['Resend', 'Vercel', 'Zoom'], 'a plan with no charge this year has no row')
  const kinds = (id) => g.months.map(m => g.rows.find(r => r.id === id).cells[m.key].kind)
  assert.deepEqual(kinds('v'), ['late', 'submitted', 'ok', 'none'], 'an Expected charge is not a cell yet')
  assert.deepEqual(kinds('r'), ['reimbursed', 'soon', 'ok', 'none'])
  assert.deepEqual(kinds('z'), ['none', 'paid', 'none', 'none'], 'a P-card charge is Paid, never late')
  const cell = g.rows.find(r => r.id === 'v').cells['2026-07']
  assert.deepEqual([cell.amount, cell.receiptId, cell.label], [20, 'rc-v7', 'Vercel, July, $20.00, late'])
  assert.deepEqual([g.totals['2026-07'], g.totals['2026-08'], g.totals['2026-09'], g.total], [40, 190, 40, 270])
  assert.deepEqual([g.late, g.lateMonths, g.concurMonthly, g.perYear], [1, ['July'], 2, 24])
  assert.deepEqual(F.gridNotes(g), [
    { tone: 'late', strong: '1 charge is past the 60-day limit.', text: 'Submit July as one report today.' },
    { tone: 'plain', strong: 'Every charge here repeats monthly.', text: 'Moving them to Purchasing or a department card would end about 24 Concur entries a year.' },
  ])
  assert.deepEqual(F.subscriptionGrid({ subscriptions, expenses, fy: 2027, today: '2027-06-30', rule: RULE }).next, null, 'the last month of the year has no next')
  for (const k of ['late', 'soon', 'ok', 'submitted', 'reimbursed', 'paid']) assert.ok(F.cellWord(k), `${k} has a word: never colour alone`)
})
