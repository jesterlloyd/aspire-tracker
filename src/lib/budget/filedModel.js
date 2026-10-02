// src/lib/budget/filedModel.js
//
// RECEIPTS-REDESIGN-1 (Owner, 2026-10-01): the rules behind Receipts > Filed, the receipt modal and the
// Subscriptions month grid. They answer one question about every receipt: has it been submitted to
// Concur, and is it late? Pure, so the screens compute nothing. Reference:
// docs/mockups/receipts-redesign.html.
//
// A filed receipt arrives from the server (lib/server/budget/receipts.js filedReceipts) with:
//   concurState   'open' | 'submitted' | 'reimbursed' | null (null: none of its rows go to Concur)
//   paid          every row is on the P-card (it never needs Concur)
//   due           { deadline, daysLeft, timing: 'late' | 'soon' | 'ok' } while concurState is 'open',
//                 from the ONE 60-day rule (receiptChecks.concurTiming); null otherwise
//   submitted_at, reimbursed_at   the stored dates the stamps print
// Only Personal (Concur) receipts are counted anywhere: a P-card receipt never needs Concur.

import { usd, dateText, fiscalYearRange } from './budgetModel.js'
import { concurTiming, dueText } from './receiptChecks.js'
import { monthKey, monthInfo } from './monthClose.js'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const money = (n) => Math.round((Number(n) || 0) * 100) / 100
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const shortDate = (ymd) => { const [, m, d] = String(ymd || '').slice(0, 10).split('-').map(Number); return m && d ? `${MONTHS[m - 1].slice(0, 3)} ${d}` : '' }
/** A stored timestamp as the Pacific day it happened, "Oct 1, 2026". */
export const stampDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' }) : '')

/** Keith's draft asks for a confirmation when it carries a warning (Owner, 2026-10-01). */
export const needsPolicyConfirm = (guidance) => (guidance?.checks || []).some(c => c.tone === 'warn')

/** Where a receipt is: 'paid' (P-card), 'open', 'submitted', 'reimbursed', or null when it has no rows left. */
export function filedStage(r) {
  if (r?.concurState) return r.concurState
  return r?.paid ? 'paid' : null
}
const STAGE_WORD = { open: 'Not submitted', submitted: 'Submitted', reimbursed: 'Reimbursed', paid: 'Paid' }
export const stageWord = (r) => STAGE_WORD[filedStage(r)] || 'Not recorded'
/** A receipt is late only while it is open and past the limit. */
export const isLate = (r) => filedStage(r) === 'open' && r.due?.timing === 'late'
export const isSoon = (r) => filedStage(r) === 'open' && r.due?.timing === 'soon'

/** The chips under a card: its stage, then (Not submitted only) how long it has. */
export function stageChips(r) {
  const st = filedStage(r)
  if (!st) return []
  const out = [{ tone: st === 'open' ? 'open' : st === 'submitted' ? 'sub' : 'paid', text: STAGE_WORD[st] }]
  if (st === 'open' && r.due) out.push({ tone: r.due.timing === 'ok' ? 'due' : r.due.timing, text: dueText(r.due) })
  return out
}
/** The paper's mark: a stamp once submitted or reimbursed, a LATE tab while late. Decorative; the chips say it in words. */
export function paperMark(r, { big = false } = {}) {
  const st = filedStage(r)
  if (st === 'submitted') return { kind: 'stamp', tone: 'sub', word: 'SUBMITTED', date: stampDate(r.submitted_at).toUpperCase() }
  if (st === 'reimbursed') return { kind: 'stamp', tone: 'paid', word: 'REIMBURSED', date: stampDate(r.reimbursed_at).toUpperCase() }
  if (isLate(r)) return { kind: 'tab', tone: 'late', word: big ? `${-r.due.daysLeft} ${r.due.daysLeft === -1 ? 'DAY' : 'DAYS'} LATE` : 'LATE' }
  return null
}
/** The card's full name for a screen reader: "Vercel Inc., $20.00, Sep 1, 2026, not submitted, 30 days left". */
export function cardLabel(r) {
  const st = filedStage(r)
  return [r.vendor, usd(r.total), r.date ? dateText(r.date) : 'no date', ...(st ? [STAGE_WORD[st].toLowerCase()] : []), ...(st === 'open' && r.due ? [dueText(r.due).toLowerCase()] : [])].join(', ')
}

/** "All of July, 2 from August": where the late receipts are, oldest month first. */
function lateMonths(receipts) {
  const by = new Map()
  for (const r of receipts.filter(x => x.concurState)) {
    const k = monthKey(r.date)
    if (!by.has(k)) by.set(k, { all: 0, late: 0 })
    const m = by.get(k); m.all += 1; if (isLate(r)) m.late += 1
  }
  const parts = [...by.entries()].filter(([, m]) => m.late).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, m]) => (m.late === m.all && m.all > 1 ? `All of ${MONTHS[Number(k.slice(5)) - 1]}` : `${m.late} from ${MONTHS[Number(k.slice(5)) - 1]}`))
  return parts.join(', ')
}

/** The status strip, for the receipts of the selected fiscal year. */
export function filedStats(receipts = []) {
  const concur = receipts.filter(r => r.concurState)
  const submitted = concur.filter(r => r.concurState !== 'open').length
  const late = concur.filter(isLate)
  const soon = concur.filter(isSoon).sort((a, b) => a.due.deadline.localeCompare(b.due.deadline))
  return {
    count: receipts.length, total: money(receipts.reduce((a, r) => a + (Number(r.total) || 0), 0)),
    concur: concur.length, submitted, pct: concur.length ? Math.round((submitted / concur.length) * 100) : 0,
    late: late.length, lateWhere: lateMonths(receipts),
    soon: soon.length, soonNext: soon[0]?.due.deadline || null,
  }
}

/**
 * One folder's line: how many of its Personal (Concur) receipts are submitted, how many are late or due
 * soon, the next deadline, and the first receipt still to submit (where Submit [Month] to Concur starts).
 */
export function folderSummary(entries = []) {
  const receipts = [...new Map(entries.map(e => [e.receipt.id, e.receipt])).values()]
  const concur = receipts.filter(r => r.concurState)
  const open = concur.filter(r => r.concurState === 'open').sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const soon = open.filter(isSoon)
  const dues = open.map(r => r.due?.deadline).filter(Boolean).sort()
  return {
    concur: concur.length, submitted: concur.length - open.length, open: open.length,
    pct: concur.length ? Math.round(((concur.length - open.length) / concur.length) * 100) : 0,
    late: open.filter(isLate).length, soon: soon.length, soonBy: soon.map(r => r.due.deadline).sort().pop() || null,
    nextDue: dues[0] || null, allSubmitted: concur.length > 0 && open.length === 0,
    openIds: open.map(r => r.id),
  }
}
/** "2 late", "2 due by Oct 15": the folder's chips. */
export function folderChips(s) {
  const out = []
  if (s.late) out.push({ tone: 'late', text: `${s.late} late` })
  if (s.soon) out.push({ tone: 'soon', text: `${s.soon} due by ${shortDate(s.soonBy)}` })
  return out
}

/**
 * The modal's stage tracker. Received, In the Sheet, Submitted to Concur, Reimbursed; a P-card receipt
 * ends in one Paid step. Each step: { label, detail, state: 'done' | 'current' | 'todo' }.
 */
export function trackerSteps(r) {
  const st = filedStage(r)
  const rows = r.rows || []
  const steps = [
    { label: 'Received', detail: [shortDate(String(r.received_at || '').slice(0, 10)) || stampDate(r.received_at), r.read_by_keith ? 'by Keith' : ''].filter(Boolean).join(' '), done: true },
    { label: 'In Expenses', detail: rows.length ? rows.map(x => x.row_label).filter(Boolean).slice(0, 2).join(', ') + (rows.length > 2 ? ` and ${rows.length - 2} more` : '') : 'Rows deleted', done: rows.length > 0 },
  ]
  if (st === 'paid' || !st) steps.push({ label: 'Paid', detail: st === 'paid' ? 'P-card' : 'Not recorded', done: st === 'paid' })
  else {
    steps.push({ label: 'Submitted to Concur', detail: st === 'open' ? 'Not yet' : stampDate(r.submitted_at) || 'Marked', done: st !== 'open' })
    steps.push({ label: 'Reimbursed', detail: st === 'reimbursed' ? stampDate(r.reimbursed_at) || 'Marked' : 'Not yet', done: st === 'reimbursed' })
  }
  const first = steps.findIndex(s => !s.done)
  return steps.map((s, i) => ({ label: s.label, detail: s.detail, state: s.done ? 'done' : i === first ? 'current' : 'todo' }))
}

/** The deadline card, shown only before submission: its tone and words. */
export function deadlineNote(r) {
  if (filedStage(r) !== 'open' || !r.due) return null
  const d = r.due
  if (d.timing === 'late') return { tone: 'late', strong: `${-d.daysLeft} ${d.daysLeft === -1 ? 'day' : 'days'} past the 60-day limit.`, text: `It was due ${dateText(d.deadline)}. Concur may ask why it's late.` }
  return { tone: d.timing === 'soon' ? 'soon' : 'ok', strong: `Submit by ${dateText(d.deadline)}.`, text: `${d.daysLeft === 0 ? 'Due today' : plural(d.daysLeft, 'day') + ' left'} under the 60-day limit.` }
}

/** The Concur checklist's rows from Keith's saved draft, in Concur's own order. Empty values are left out. */
export function concurFields(g) {
  if (!g) return []
  return [
    ['report', 'Report name', g.report_name],
    ['type', 'Expense type', g.expense_type],
    ['date', 'Transaction date', g.date ? dateText(g.date) : ''],
    ['amount', 'Amount', g.amount != null ? usd(g.amount) : ''],
    ['vendor', 'Vendor', g.vendor],
    ['desc', 'Description', g.description],
    ['purpose', 'Business purpose', g.business_purpose],
    ['attendees', 'Attendees', (g.attendees || []).join('; ')],
  ].filter(f => f[2]).map(([key, label, value]) => ({ key, label, value: String(value) }))
}
/** Copy all: the fields as labeled lines. */
export const copyAllText = (fields) => fields.map(f => `${f.label}: ${f.value}`).join('\n')

/**
 * The footer: one hint and one primary button that follows the stage.
 *   action: 'submit' | 'reimburse' | 'next' | 'done' | null (a P-card receipt has only next or done)
 */
export function footerState(r, { confirmed = false, batch = false, isLast = true } = {}) {
  const st = filedStage(r)
  const onward = isLast ? { action: 'done', label: 'Done' } : { action: 'next', label: 'Next receipt' }
  if (st === 'open') {
    const wait = needsPolicyConfirm(r.concur) && !confirmed
    return {
      action: 'submit', label: batch && !isLast ? 'Mark submitted and go to next' : 'Mark submitted to Concur', disabled: wait,
      hint: wait ? 'Confirm the business purpose above to continue.' : 'The Stage and Submitted to Concur box in Expenses update too.', tone: wait ? 'warn' : '',
    }
  }
  if (st === 'submitted') return { action: 'reimburse', label: 'Mark reimbursed', disabled: false, hint: `Submitted${r.submitted_at ? ` ${stampDate(r.submitted_at)}` : ''}. Mark it reimbursed when the money arrives.`, tone: '' }
  if (st === 'reimbursed') return { ...onward, disabled: false, hint: `Reimbursed${r.reimbursed_at ? ` ${stampDate(r.reimbursed_at)}` : ''}. This receipt is complete.`, tone: 'good' }
  return { ...onward, disabled: false, hint: st === 'paid' ? 'Paid on the P-card. It never goes to Concur.' : 'This receipt’s rows are no longer in Expenses.', tone: st === 'paid' ? 'good' : '' }
}

// ── Subscriptions month grid ──────────────────────────────────────────────────────

const KIND_WORD = { late: 'late', soon: 'due soon', ok: 'on time', submitted: 'submitted', reimbursed: 'reimbursed', paid: 'paid', expected: 'expected', none: 'no charge' }
export const cellWord = (kind) => KIND_WORD[kind] || ''
const WORST = ['late', 'soon', 'ok', 'submitted', 'reimbursed', 'paid', 'expected']

/** One charge's status: its Concur stage, or how long it has under the ONE 60-day rule. */
function chargeKind(e, rule, today) {
  if (e.state === 'expected') return 'expected'
  if (e.payment_method !== 'personal_concur') return 'paid'
  if (e.status === 'reimbursed') return 'reimbursed'
  if (e.status === 'submitted') return 'submitted'
  return concurTiming(e.expense_date, rule, today)?.timing || 'ok'
}

/**
 * The month-by-month grid of recurring charges for a fiscal year: one row per subscription with a
 * charge this year, one column per month so far, then the next month as Expected.
 *   subscriptions  [{ id, name, plan }]   expenses  the year's Sheet rows   receipts  the year's filed receipts
 * Returns { months, next, rows: [{ id, vendor, plan, cells: { [monthKey]: cell }, last, monthly }],
 *           totals: { [monthKey]: n }, total, late, lateMonths: [name], concurMonthly, perYear }.
 * A cell: { amount, kind, word, receiptId, expenseIds, label }.
 */
export function subscriptionGrid({ subscriptions = [], expenses = [], receipts = [], fy, today, rule = null, all = false } = {}) {
  const range = fiscalYearRange(fy)
  if (!range || !today) return { months: [], next: null, rows: [], totals: {}, total: 0, late: 0, lateMonths: [], concurMonthly: 0, perYear: 0 }
  const upto = today < range.end ? today : range.end
  const months = []
  for (let k = monthKey(range.start); k <= monthKey(upto); k = nextKey(k)) months.push(monthInfo(k))
  const next = monthKey(upto) < monthKey(range.end) ? monthInfo(nextKey(monthKey(upto))) : null
  const receiptOf = new Map()
  for (const r of receipts) for (const row of r.rows || []) receiptOf.set(row.id, r.id)
  const charges = expenses.filter(e => e.subscription_id && !e.deleted_at && e.status !== 'void' && e.expense_date >= range.start && e.expense_date <= range.end)
  const rows = []
  for (const s of subscriptions) {
    const own = charges.filter(e => e.subscription_id === s.id)
    const posted = own.filter(e => e.state !== 'expected')
    // SUBSCRIPTIONS-ONE-VIEW-1: with `all`, a plan with no charge yet this year still has its row.
    if (!posted.length && !all) continue
    const cells = {}
    for (const m of months) {
      const here = posted.filter(e => monthKey(e.expense_date) === m.key)
      if (!here.length) { cells[m.key] = { amount: null, kind: 'none', word: KIND_WORD.none, receiptId: null, expenseIds: [], label: `${s.name}, ${m.name}, no charge` }; continue }
      const kinds = here.map(e => chargeKind(e, rule, today))
      const kind = WORST.find(k => kinds.includes(k))
      const amount = money(here.reduce((a, e) => a + (Number(e.amount) || 0), 0))
      cells[m.key] = {
        amount, kind, word: KIND_WORD[kind], expenseIds: here.map(e => e.id), receiptId: here.map(e => receiptOf.get(e.id)).find(Boolean) || null,
        label: `${s.name}, ${m.name}, ${usd(amount)}, ${KIND_WORD[kind]}`,
      }
    }
    const last = [...posted].sort((a, b) => String(b.expense_date).localeCompare(String(a.expense_date)))[0]
    rows.push({ id: s.id, vendor: s.name, plan: s.plan || '', cells, last: last ? money(last.amount) : null, monthly: s.billing !== 'annual', concur: (last?.payment_method || s.payment_method) === 'personal_concur', charged: posted.length > 0 })
  }
  rows.sort((a, b) => a.vendor.localeCompare(b.vendor) || a.plan.localeCompare(b.plan))
  const totals = Object.fromEntries(months.map(m => [m.key, money(rows.reduce((a, r) => a + (r.cells[m.key].amount || 0), 0))]))
  const lateCells = rows.flatMap(r => months.filter(m => r.cells[m.key].kind === 'late').map(m => m))
  const concurMonthly = rows.filter(r => r.monthly && r.concur && r.charged).length
  return {
    months, next, rows, totals, total: money(Object.values(totals).reduce((a, n) => a + n, 0)),
    late: lateCells.length, lateMonths: [...new Map(lateCells.map(m => [m.key, m.name])).values()],
    concurMonthly, perYear: concurMonthly * 12,
  }
}
function nextKey(key) { const [y, m] = key.split('-').map(Number); const t = y * 12 + (m - 1) + 1; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}` }

/** The grid's two notes: what is late and in what order to clear it, and what moving to Purchasing would end. */
export function gridNotes(g) {
  const out = []
  if (g.late) {
    const [first, second] = g.lateMonths
    out.push({ tone: 'late', strong: `${plural(g.late, 'charge is', 'charges are')} past the 60-day limit.`, text: `Submit ${first} as one report today${second ? `, then ${second}` : ''}.` })
  }
  if (g.perYear) out.push({ tone: 'plain', strong: 'Every charge here repeats monthly.', text: `Moving them to Purchasing or a department card would end about ${g.perYear} Concur entries a year.` })
  return out
}
