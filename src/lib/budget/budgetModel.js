// src/lib/budget/budgetModel.js
//
// PROGRAM-BUDGET Phase A (2026-09-27): every rule about the Program Budget, pure and tested
// without a browser. The screen, the leadership view, the server and the Excel export all read
// this module, so a figure means the same thing everywhere. Reference:
// docs/mockups/program-budget.html. Nothing is computed in JSX.
//
// Dates are YYYY-MM-DD strings compared as strings, in Pacific time (rotationCalendarDates.js).
// Fiscal years are the ENDING year, from lib/server/communityBenefit/compute.js: 2027 is FY27,
// July 1, 2026 to June 30, 2027. Those helpers are reused here, never restated.
import { fiscalYearOfDate, fiscalYearRange, currentFiscalYear } from '../../../lib/server/communityBenefit/compute.js'
import { addDays, pacificToday } from '../rotationCalendarDates.js'

export { fiscalYearOfDate, fiscalYearRange, currentFiscalYear, pacificToday }

export const PROGRAM = 'ASPIRE'
export const DEFAULT_TOTAL = 40000
export const DEFAULT_COST_CENTER = 'Nursing Education'
export const RENEWAL_WINDOW_DAYS = 45
export const REMIND_AFTER_DAYS = 7

/** The short label the budget shows: 2027 -> "FY27". */
export const fyShort = (fy) => `FY${String(fy).slice(-2)}`
/** "Jul 1, 2026 to Jun 30, 2027" */
export function fyRangeText(fy) {
  const r = fiscalYearRange(fy)
  return r ? `${dateText(r.start)} to ${dateText(r.end)}` : ''
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** The fiscal year's months, July first. */
export const FY_MONTHS = Object.freeze(['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'])
const parts = (ymd) => String(ymd).split('-').map(Number)
/** "Sep 3, 2026"; a month-precision date (an imported FY26 row) reads "Jan 2026". */
export function dateText(ymd, precision = 'day') {
  if (!ymd) return ''
  const [y, m, d] = parts(ymd)
  return precision === 'month' ? `${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ${d}, ${y}`
}
export const monthOf = (ymd) => MONTHS[parts(ymd)[1] - 1]

// ── Money ────────────────────────────────────────────────────────────────────────
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
export const money = (n) => round2(n)
/** "$1,620.44" */
export const usd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0)
/** "$1,250.50", "1250.5", "1,250" -> 1250.5; anything else -> null. */
export function parseMoney(text) {
  const t = String(text ?? '').replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  return round2(Number(t))
}
const sum = (xs) => round2(xs.reduce((a, b) => a + (Number(b) || 0), 0))

// ── Payment method and status (prompt A2) ───────────────────────────────────────
export const PAYMENT_METHODS = Object.freeze([
  { key: 'p_card', label: 'P-card' },
  { key: 'personal_concur', label: 'Personal (Concur)' },
  { key: 'po_invoice', label: 'PO or invoice' },
])
export const STATUSES = Object.freeze([
  { key: 'recorded', label: 'Recorded', tone: 'blue' },
  { key: 'submitted', label: 'Submitted', tone: 'amber' },
  { key: 'paid', label: 'Paid', tone: 'green' },
  { key: 'reimbursed', label: 'Reimbursed', tone: 'green' },
  { key: 'void', label: 'Void', tone: 'grey' },
])
const STATUS_PATHS = Object.freeze({
  p_card: ['paid', 'void'],
  personal_concur: ['recorded', 'submitted', 'reimbursed', 'void'],
  po_invoice: ['recorded', 'paid', 'void'],
  none: ['recorded', 'void'],
})
export const paymentLabel = (key) => PAYMENT_METHODS.find(p => p.key === key)?.label || ''
export const paymentKey = (label) => PAYMENT_METHODS.find(p => p.label === label || p.key === label)?.key || null
export const statusLabel = (key) => STATUSES.find(s => s.key === key)?.label || ''
export const statusKey = (label) => STATUSES.find(s => s.label === label || s.key === label)?.key || null
export const statusTone = (key) => STATUSES.find(s => s.key === key)?.tone || 'grey'
/** The statuses a payment method allows, in path order. */
export const statusesFor = (method) => STATUS_PATHS[method || 'none'] || STATUS_PATHS.none
/** A new row's status: Paid on a P-card, Recorded otherwise. */
export const defaultStatus = (method) => (method === 'p_card' ? 'paid' : 'recorded')
/** Changing the payment method keeps the status only if the new method allows it. */
export const statusAfterPaymentChange = (method, status) => (statusesFor(method).includes(status) ? status : defaultStatus(method))

// ── Fiscal year state ────────────────────────────────────────────────────────────
/**
 * Derived, never stored: 'not_started' until the owner starts it, 'closed' once its June 30 has
 * passed, 'current' otherwise. A year with no row is not started.
 */
export function yearState(budget, fy, today = pacificToday()) {
  const r = fiscalYearRange(fy)
  if (r && today > r.end && budget?.started_at) return 'closed'
  if (!budget?.started_at) return 'not_started'
  return 'current'
}
export const STATE_CHIP = Object.freeze({ current: 'Current', closed: 'Closed', not_started: 'Not started' })

/** Share of the fiscal year elapsed through today, 0 to 1 (1 for a closed year, 0 before it starts). */
export function yearElapsed(fy, today = pacificToday()) {
  const r = fiscalYearRange(fy)
  if (!r) return 0
  if (today < r.start) return 0
  if (today > r.end) return 1
  const day = (ymd) => Date.UTC(...parts(ymd).map((v, i) => (i === 1 ? v - 1 : v)))
  return (day(today) - day(r.start) + 86400000) / (day(r.end) - day(r.start) + 86400000)
}

// ── Subscriptions (A9) ──────────────────────────────────────────────────────────
export const BILLING = Object.freeze([
  { key: 'monthly', label: 'Monthly' },
  { key: 'annual', label: 'Annual' },
  { key: 'usage', label: 'Usage-based' },
])
export const billingLabel = (key) => BILLING.find(b => b.key === key)?.label || ''

/** The anchor date moved by n months (or n years for an annual plan), clamped to the month's last day. */
function stepFrom(anchor, billing, n) {
  const [y0, m0, d] = parts(anchor)
  const months = (m0 - 1) + (billing === 'annual' ? 12 * n : n)
  const y = y0 + Math.floor(months / 12)
  const m = ((months % 12) + 12) % 12 + 1
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`
}

/**
 * Every charge date of a subscription between from and to (inclusive). A charge counts only
 * between the start and end dates. Usage-based plans charge monthly, at the estimate.
 */
export function chargesIn(sub, from, to) {
  if (!sub?.anchor_date || !from || !to || from > to) return []
  let i = 0
  while (stepFrom(sub.anchor_date, sub.billing, i) >= from) i--
  const out = []
  for (let n = 0; n < 600; n++, i++) {
    const k = stepFrom(sub.anchor_date, sub.billing, i)
    if (k > to) break
    if (k >= from && k >= sub.start_date && (!sub.end_date || k <= sub.end_date)) out.push(k)
  }
  return out
}
export const nextCharge = (sub, today = pacificToday()) => chargesIn(sub, addDays(today, 1), addDays(today, 3700))[0] || null
export const daysBetween = (a, b) => Math.round((Date.UTC(...parts(b).map((v, i) => (i === 1 ? v - 1 : v))) - Date.UTC(...parts(a).map((v, i) => (i === 1 ? v - 1 : v)))) / 86400000)
export const isActiveSub = (sub, today = pacificToday()) => !sub.deleted_at && (!sub.end_date || sub.end_date > today)
/** What a plan costs a month: an annual plan spread over twelve. */
export const monthlyEquivalent = (sub) => (sub.billing === 'annual' ? Number(sub.amount) / 12 : Number(sub.amount))
export const perYear = (sub, today = pacificToday()) => (isActiveSub(sub, today) ? round2(monthlyEquivalent(sub) * 12) : 0)

/** The renewal the owner has to decide: an annual plan renewing within 45 days, undecided. */
export function pendingRenewal(sub, today = pacificToday()) {
  if (sub.billing !== 'annual' || sub.end_date || sub.deleted_at || !sub.auto_renew) return null
  const n = nextCharge(sub, today)
  if (!n || daysBetween(today, n) > RENEWAL_WINDOW_DAYS) return null
  if (sub.renewal_kept_for === n) return null
  return { date: n, days: daysBetween(today, n) }
}
/** Active (green), Renews soon (amber), Ending (amber), Cancelled (grey). */
export function subscriptionStatus(sub, today = pacificToday()) {
  if (sub.end_date && sub.end_date <= today) return { label: 'Cancelled', tone: 'grey' }
  if (sub.end_date) return { label: 'Ending', tone: 'amber' }
  if (pendingRenewal(sub, today)) return { label: 'Renews soon', tone: 'amber' }
  return { label: 'Active', tone: 'green' }
}
/** Renewals to decide, soonest first, less any the owner asked to be reminded of later. */
export function renewalsToDecide(subs, today = pacificToday()) {
  return subs.map(s => ({ sub: s, renewal: pendingRenewal(s, today) }))
    .filter(x => x.renewal && (!x.sub.renewal_remind_after || x.sub.renewal_remind_after <= today))
    .sort((a, b) => a.renewal.date.localeCompare(b.renewal.date))
}
/** Cancel at renewal: the plan ends the day before it would renew, and stops renewing. */
export function cancelAtRenewal(sub, today = pacificToday()) {
  const n = pendingRenewal(sub, today)?.date || nextCharge(sub, today)
  return n ? { end_date: addDays(n, -1), auto_renew: false } : null
}

/**
 * Committed spend: every charge from tomorrow to the fiscal year's end. A closed year has none,
 * and neither does a year that has not started.
 */
export function committedSpend(subs, fy, state, today = pacificToday()) {
  if (state !== 'current') return { total: 0, byMonth: {}, byCategory: {} }
  const r = fiscalYearRange(fy)
  const byMonth = {}, byCategory = {}
  let total = 0
  for (const s of subs) {
    if (s.deleted_at) continue
    for (const k of chargesIn(s, addDays(today, 1), r.end)) {
      const m = monthOf(k)
      byMonth[m] = round2((byMonth[m] || 0) + Number(s.amount))
      byCategory[s.category_id || ''] = round2((byCategory[s.category_id || ''] || 0) + Number(s.amount))
      total = round2(total + Number(s.amount))
    }
  }
  return { total, byMonth, byCategory }
}
export const dueByYearEnd = (sub, fy, state, today = pacificToday()) => committedSpend([sub], fy, state, today).total

/**
 * The charges a subscription still has to post: every charge date up to today that falls in a
 * STARTED fiscal year and has no row yet. The unique index on (subscription_id, charge_date)
 * makes posting safe to run any number of times; this only decides what to try.
 */
export function chargesToPost(sub, startedYears, postedDates, today = pacificToday()) {
  if (sub.deleted_at) return []
  const out = []
  for (const fy of startedYears) {
    const r = fiscalYearRange(fy)
    if (!r) continue
    for (const k of chargesIn(sub, r.start, today < r.end ? today : r.end)) if (!postedDates.has(k)) out.push({ date: k, fiscal_year: fy })
  }
  return out
}
/** The expense row a subscription charge posts. */
export function chargeExpense(sub, date) {
  return {
    expense_date: date, date_precision: 'day', item: sub.name, category_id: sub.category_id || null,
    description: sub.plan ? `${sub.plan} subscription` : 'Subscription', vendor: sub.vendor || '',
    quantity: 1, amount: round2(sub.amount), payment_method: sub.payment_method || null,
    status: defaultStatus(sub.payment_method), subscription_id: sub.id, charge_date: date, source: 'subscription',
  }
}

// ── Expenses ─────────────────────────────────────────────────────────────────────
/** Void rows are not spend. A deleted row is gone. */
export const counts = (e) => !e.deleted_at && e.status !== 'void'
export const unitCost = (e) => (Number(e.quantity) > 0 ? round2(Number(e.amount) / Number(e.quantity)) : null)

// ── Summary (A6) ─────────────────────────────────────────────────────────────────
/**
 * Everything the Summary shows for one fiscal year.
 * categories: [{ id, name }]; allocations: [{ category_id, amount, saved_amount }];
 * roster: Map cohort_id -> { name, size } (size null when unknown).
 * `planned` picks the allocation the viewer may see: the draft for the owner, the saved plan
 * for everyone else (null before the first save).
 */
export function budgetSummary({ fy, budget, expenses = [], categories = [], allocations = [], subs = [], roster = new Map(), viewer = 'owner', today = pacificToday() }) {
  const state = yearState(budget, fy, today)
  const rows = expenses.filter(counts)
  const total = Number(budget?.total) || 0
  const spent = sum(rows.map(e => e.amount))
  const committed = committedSpend(subs, fy, state, today)
  const remaining = round2(total - spent)
  const planSaved = !!budget?.plan_saved_at
  const planFor = (a) => (viewer === 'owner' ? Number(a.amount) || 0 : (planSaved && a.saved_amount != null ? Number(a.saved_amount) : null))
  const plan = new Map(allocations.map(a => [a.category_id, planFor(a)]))
  const hasPlan = [...plan.values()].some(v => v != null && v > 0)

  const byMonth = FY_MONTHS.map(m => ({ month: m, spent: 0, scheduled: committed.byMonth[m] || 0 }))
  for (const e of rows) { const b = byMonth[FY_MONTHS.indexOf(monthOf(e.expense_date))]; if (b) b.spent = round2(b.spent + Number(e.amount)) }
  const r = fiscalYearRange(fy)
  const monthStart = (i) => { const [y] = parts(r.start); const m = ((6 + i) % 12) + 1; const yy = i < 6 ? y : y + 1; return `${yy}-${String(m).padStart(2, '0')}-01` }
  byMonth.forEach((b, i) => { b.future = state === 'current' && monthStart(i) > today })

  const byCategory = categories.map(c => {
    const s = sum(rows.filter(e => e.category_id === c.id).map(e => e.amount))
    const allocated = plan.get(c.id) ?? null
    return { id: c.id, name: c.name, spent: s, share: spent ? s / spent : 0, allocated, remaining: allocated == null ? null : round2(allocated - s), used: allocated ? s / allocated : null }
  })
  const uncategorised = sum(rows.filter(e => !e.category_id).map(e => e.amount))
  const largest = [...byCategory].sort((a, b) => b.spent - a.spent)[0]

  // Cost per student: the cohort with the most tagged spend, total / its roster size.
  const tagged = new Map()
  for (const e of rows) if (e.cohort_id) tagged.set(e.cohort_id, round2((tagged.get(e.cohort_id) || 0) + Number(e.amount)))
  let costPerStudent = { state: 'untagged' }
  if (tagged.size) {
    const [cohortId, cohortSpend] = [...tagged].sort((a, b) => b[1] - a[1])[0]
    const c = roster.get(cohortId)
    costPerStudent = c?.size ? { state: 'ok', cohortId, cohort: c.name, size: c.size, spend: cohortSpend, value: round2(cohortSpend / c.size) }
      : { state: 'size_pending', cohortId, cohort: c?.name || '', spend: cohortSpend }
  }

  return {
    fy, label: fyShort(fy), state, total, spent, remaining,
    committed: committed.total, remainingAfterCommitted: round2(remaining - committed.total),
    used: total ? spent / total : 0, elapsed: yearElapsed(fy, today),
    expenseCount: rows.length, withReceipts: rows.filter(e => e.receipt_file_id).length,
    evenPace: round2(total / 12), byMonth, byCategory, uncategorised, hasPlan, planSaved,
    largestCategory: largest && largest.spent > 0 ? largest.name : null, costPerStudent,
  }
}

// ── Allocations (A8) ────────────────────────────────────────────────────────────
export function allocationTotals(total, amounts) {
  const assigned = sum(amounts)
  const left = round2((Number(total) || 0) - assigned)
  return { assigned, left, over: left < 0 }
}
/** Split the budget evenly across categories; the leftover cents go to the first ones. */
export function splitEvenly(total, n) {
  if (!n) return []
  const cents = Math.round((Number(total) || 0) * 100)
  const base = Math.floor(cents / n), extra = cents - base * n
  return Array.from({ length: n }, (_, i) => (base + (i < extra ? 1 : 0)) / 100)
}

// ── Budget history lines ─────────────────────────────────────────────────────────
export const budgetChangedMessage = (from, to) => `Budget changed from ${usd(from)} to ${usd(to)}.`
export const budgetSetMessage = (to, how = '') => `Budget set to ${usd(to)}${how ? `, ${how}` : ''}.`
