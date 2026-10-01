// src/lib/budget/receiptChecks.js
//
// PROGRAM-BUDGET Phase B (BUDGET-B1, 2026-09-27): the checks a receipt slip runs before the
// owner decides (prompt B4). Pure: the server hands in what it knows (every expense, the year's
// state, the plan, the rules) and the slip and Accept both read the same answer, so a check the
// slip shows is the check Accept enforces.
//
// Each check is one line with a tone: 'block' (Accept waits for it), 'warn' (amber), 'info'
// (blue) or 'ok' (green). Owner decisions, 2026-09-27, from the Cedars-Sinai Business Expense
// Reimbursement Policy (effective January 1, 2024): only the meals rule blocks; every other rule
// warns; the reimbursement-only rules (60 days, prior fiscal year) apply to Personal (Concur)
// alone. The rules' words, tones and thresholds are the owner's (budget_policy_rules), and a
// rule is found here by its key.

import { fiscalYearOfDate, fyShort, usd, dateText, daysBetween, currentFiscalYear } from './budgetModel.js'
import { addDays } from '../rotationCalendarDates.js'
import { paymentFromCard, rowsFrom, draftTotal } from './receiptModel.js'
import { matchSubscriptionCharge, matchText, GUARDED } from './chargeMatch.js'
import { planCheck } from './planModel.js'

export const DUPLICATE_WINDOW_DAYS = 7
const lc = (s) => String(s || '').trim().toLowerCase()
const orderKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const cents = (n) => Math.round(Number(n) * 100)
const fill = (msg, vars) => String(msg || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m))

/**
 * The expense this receipt already is, if any (B4.1): the order number first, then the same
 * vendor, the same amount to the cent and a date within 7 days, across every fiscal year.
 * `expenses` are live rows ({ id, expense_date, vendor, amount, order_number, item, row_label }).
 */
export function findDuplicate(draft, expenses = []) {
  const live = expenses.filter(e => !e.deleted_at)
  const ord = orderKey(draft.order_number)
  if (ord.length >= 5) {
    const hit = live.find(e => orderKey(e.order_number) === ord)
    if (hit) return { expense: hit, by: 'order number' }
  }
  const total = cents(draftTotal(draft) || draft.total)
  const v = lc(draft.vendor)
  if (!v || !draft.date || !total) return null
  const hit = live.find(e => {
    const ev = lc(e.vendor)
    if (!ev || !(ev.includes(v) || v.includes(ev))) return false
    if (cents(e.amount) !== total) return false
    return Math.abs(daysBetween(e.expense_date, draft.date)) <= DUPLICATE_WINDOW_DAYS
  })
  return hit ? { expense: hit, by: 'vendor, amount and date' } : null
}

/**
 * Every check for one slip. `ctx`:
 *   expenses      live expense rows across every year (for duplicates)
 *   years         Map fy -> { state: 'current' | 'closed' | 'not_started', total, spent: { [category]: n },
 *                 plan: { [category]: n } | null }
 *   rules         budget_policy_rules rows
 *   pcardLast4    '' when none is on file
 *   rememberedCards [{ last4, method }] the owner asked to remember (BUDGET-V2 item 5)
 *   subscriptions every subscription row, for the charge match (BUDGET-V2 item 1)
 *   proposal      Keith's reading (document_type, tip, subtotal, card_last4, adds_up)
 *   duplicateFile the accepted receipt with the same file, if any
 *   today         YYYY-MM-DD
 * Returns { checks, duplicate, subMatch, fy, fyStarted, blocked, blockers, attachBlocked, attachBlockers }.
 */
export function receiptChecks(draft, ctx = {}) {
  const { expenses = [], years = new Map(), rules = [], pcardLast4 = '', rememberedCards = [], subscriptions = [], proposal = {}, duplicateFile = null, today } = ctx
  const checks = []
  const add = (key, tone, text, extra = {}) => checks.push({ key, tone, text, ...extra })
  const method = draft.payment_method || null
  const fy = draft.date ? fiscalYearOfDate(draft.date) : null
  const year = fy ? years.get(fy) : null
  const fyStarted = !!year && (year.state === 'current' || year.state === 'closed')
  const rows = rowsFrom(draft)

  // What Accept cannot do without.
  if (!draft.date) add('date', 'block', 'Enter the receipt’s date: it decides the fiscal year.')
  if (draft.lines.some(l => !l.category)) add('category', 'block', 'Choose a category for every line.')
  if (!draft.lines.length) add('lines', 'block', 'Add at least one line.')

  // BUDGET-V2 item 1: a subscription charge first. A receipt for a charge is that charge, and a row
  // the charge already posted is that charge's row, not a duplicate to attach to by row number.
  const subMatch = matchSubscriptionCharge(draft, subscriptions, expenses)
  if (subMatch) add('sub_match', subMatch.kind === 'uncounted' ? 'info' : 'warn', matchText(subMatch), { subMatch })
  const guarded = !!subMatch && GUARDED.has(subMatch.kind)

  // B4.1 Duplicate.
  let duplicate = findDuplicate(draft, expenses)
  if (duplicate && subMatch?.expense && duplicate.expense.id === subMatch.expense.id) duplicate = null
  if (duplicate && guarded) duplicate = null
  if (duplicate) {
    const e = duplicate.expense
    add('duplicate', 'warn', `Matches ${e.row_label} (${e.item || 'no item'}, ${usd(e.amount)}, ${dateText(e.expense_date, e.date_precision)}) by ${duplicate.by}. Attach this receipt to that row instead of adding a new one.`, { attachTo: e.id })
  }
  if (duplicateFile) add('duplicate_file', 'warn', `This same file was already accepted on ${dateText(String(duplicateFile.decided_at || '').slice(0, 10))}.`)

  // B4.2 Fiscal year not started.
  if (fy && !fyStarted) add('not_started', 'block', `${fyShort(fy)} hasn’t started. Start ${fyShort(fy)} to post this receipt.`, { startYear: fy })
  // BUDGET-V2 (Owner, 2026-09-29: "it should not refuse it ... file it for record purposes but notate
  // that the date has passed"): a receipt dated in a closed month is filed and marked late, never refused.
  const month = String(draft.date || '').slice(0, 7)
  if (month && (year?.closedMonths || []).includes(month)) {
    const name = new Date(`${month}-15T12:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
    add('closed_month', 'warn', `Dated in ${name}, which is closed. It is filed for the record and marked as received after ${name} closed; Budget history notes it.`, { late: { fy, month, name } })
  }

  // B4.3 Split.
  if (rows.length > 1) add('split', 'info', `Split into ${rows.length} rows because the items fall in different categories.`)

  // The parts and the total.
  if (proposal.adds_up === false) add('adds_up', 'warn', `The items, tax and shipping Keith read do not add up to the ${usd(proposal.total)} total. Check the amounts against the original.`)
  else if (proposal.total && cents(draftTotal(draft)) !== cents(proposal.total) && !duplicate) add('total', 'warn', `The lines add up to ${usd(draftTotal(draft))}; the receipt says ${usd(proposal.total)}.`)

  // BUDGET-V2 item 16: one plan line. Within the approved category total it posts; over it, the owner
  // moves money inside the agreed limit or asks Margo for an amendment; with no approved plan it counts
  // against the year's total. Keyed by category NAME here (the slip's lines carry names).
  if (fyStarted && !duplicate && !guarded) {
    const p = year.approvedPlan
    const arg = p ? {
      effective: new Map(Object.entries(p.effective)), approved: new Map(Object.entries(p.approved)),
      spent: new Map(Object.entries(year.spent || {})), names: new Map(Object.keys(p.effective).map(k => [k, k])), limits: p.limits,
    } : null
    const res = planCheck(rows.filter(r => r.category).map(r => ({ category_id: r.category, amount: r.amount })), arg, { total: year.total })
    add('plan', res.tone, res.text, { plan: res, ...(res.key === 'over' ? { blocksAdd: true } : {}) })
  }

  // B4.5 Payment.
  if (!duplicate) {
    const pay = paymentFromCard(proposal.card_last4, pcardLast4, rememberedCards)
    if (method === pay.method || !method) add('payment', pay.tone, pay.text)
    if (method === 'personal_concur' && pay.method !== 'personal_concur') add('payment_concur', 'info', 'Personal (Concur): mark it Submitted to Concur when you file it there.')
  }

  // B4.6 Privacy (Owner, 2026-09-27: no blurring; the original is the Owner's alone).
  add('privacy', 'ok', 'Filed privately: only you can open the original. The drawn receipt never shows an address.')

  // B4.7 Policy.
  const ruleOf = (key) => rules.find(r => r.key === key && r.enabled !== false)
  const applies = (r) => r && (r.applies_to !== 'personal_concur' || method === 'personal_concur')
  const policy = (r, violated, vars = {}, okText = null) => {
    if (!applies(r)) return
    if (violated) add(`rule:${r.key}`, r.tone === 'block' ? 'block' : r.tone === 'info' ? 'info' : 'warn', fill(r.message, vars), { rule: r.key })
    else if (okText) add(`rule:${r.key}`, 'ok', okText, { rule: r.key })
  }
  const inCats = (r, fallback) => { const cats = new Set((r?.params?.categories || fallback).map(lc)); return draft.lines.filter(l => cats.has(lc(l.category))) }

  const meals = ruleOf('meals_documentation')
  if (meals && inCats(meals, ['Meals & Catering']).length) {
    const need = []
    if (!String(draft.business_purpose || '').trim()) need.push('business purpose')
    if (!(draft.attendees || []).some(a => String(a?.name || '').trim())) need.push('attendee list')
    const n = (draft.attendees || []).filter(a => String(a?.name || '').trim()).length
    policy(meals, need.length > 0, {}, `Business purpose and ${n} ${n === 1 ? 'attendee' : 'attendees'} recorded.`)
    if (need.length) checks[checks.length - 1].needs = need
  }

  const late = ruleOf('concur_60_days')
  if (late && draft.date && today) {
    const days = daysBetween(draft.date, today)
    const deadline = concurDeadline(draft.date, late)
    policy(late, days >= (Number(late.params?.remind_after_days) || 45), { deadline: dateText(deadline), days: String(days) })
  }

  const prior = ruleOf('prior_fiscal_year')
  if (prior && fy && today) policy(prior, fy < currentFiscalYear(new Date(`${today}T12:00:00-07:00`)), { fy: fyShort(fy) })

  const tip = ruleOf('tip_over_20')
  if (tip && proposal.tip > 0 && proposal.subtotal > 0) {
    const pct = (proposal.tip / proposal.subtotal) * 100
    policy(tip, pct > (Number(tip.params?.limit_pct) || 20), { pct: `${pct.toFixed(1)}%` })
  }

  const flagged = (...fs) => draft.lines.some(l => (l.flags || []).some(f => fs.includes(f)))
  policy(ruleOf('alcohol'), flagged('alcohol'))
  const cater = ruleOf('catering_over_500')
  if (cater) {
    const limit = Number(cater.params?.limit) || 500
    policy(cater, inCats(cater, ['Meals & Catering']).reduce((a, l) => a + Number(l.amount || 0), 0) > limit, { limit: usd(limit) })
  }
  const soft = ruleOf('software_equipment_concur')
  if (soft) policy(soft, inCats(soft, ['Technology & Software']).length > 0 || flagged('equipment'))
  policy(ruleOf('logo_merchandise'), flagged('logo_merchandise'))
  policy(ruleOf('stationery'), flagged('stationery'))
  policy(ruleOf('gifts'), flagged('gift', 'gift_card'))
  policy(ruleOf('card_statement'), proposal.document_type === 'card_statement')

  // Posting new rows waits for every block. Attaching to the duplicate's row posts nothing new, so
  // only the date stops it (the meals documentation then lives on the row it attaches to).
  const blockers = checks.filter(c => c.tone === 'block' || c.blocksAdd)
  const attachBlockers = blockers.filter(c => c.key === 'date')
  return {
    checks, duplicate, subMatch, fy, fyStarted,
    blocked: blockers.length > 0, blockers: blockers.map(b => b.text),
    attachBlocked: attachBlockers.length > 0, attachBlockers: attachBlockers.map(b => b.text),
  }
}

/**
 * RECEIPTS-REDESIGN-1 (Owner, 2026-10-01): the ONE 60-day rule. The deadline is the expense date plus
 * the owner's `deadline_days` (budget_policy_rules 'concur_60_days', 60 unless changed); a disabled or
 * absent rule means no deadline. Timing: 'late' past it, 'soon' with SOON_DAYS or fewer left, else 'ok'.
 * The check on a slip, the Concur reminder, Keith's Concur draft, the Filed chips and stamps and the
 * Subscriptions grid all read this.
 */
export const SOON_DAYS = 14
export function concurDeadline(date, rule) {
  if (!rule || rule.enabled === false || !date) return null
  return addDays(String(date).slice(0, 10), Number(rule.params?.deadline_days) || 60)
}
export function concurTiming(date, rule, today) {
  const deadline = concurDeadline(date, rule)
  if (!deadline || !today) return null
  const daysLeft = daysBetween(today, deadline)
  return { deadline, daysLeft, timing: daysLeft < 0 ? 'late' : daysLeft <= SOON_DAYS ? 'soon' : 'ok' }
}
/** "32 days late", "Due today", "Due in 5 days", "30 days left". */
export function dueText(t) {
  if (!t) return ''
  const d = t.daysLeft
  if (d < 0) return `${-d} ${d === -1 ? 'day' : 'days'} late`
  if (d === 0) return 'Due today'
  return t.timing === 'soon' ? `Due in ${d} ${d === 1 ? 'day' : 'days'}` : `${d} days left`
}

/**
 * The Concur reminder (Owner, 2026-09-27): a Personal (Concur) expense still Recorded
 * `remind_after_days` after its date needs submitting before `deadline_days`. Returns the
 * expenses due, soonest deadline first, with the deadline and days left.
 */
export function concurDue(expenses = [], rule, today) {
  if (!rule || rule.enabled === false || !today) return []
  const after = Number(rule.params?.remind_after_days) || 45
  return expenses
    .filter(e => !e.deleted_at && e.state !== 'expected' && e.payment_method === 'personal_concur' && e.status === 'recorded' && e.date_precision !== 'month' && e.expense_date)
    .map(e => ({ expense: e, age: daysBetween(e.expense_date, today), deadline: concurDeadline(e.expense_date, rule) }))
    .filter(x => x.age >= after)
    .map(x => ({ ...x, daysLeft: daysBetween(today, x.deadline) }))
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
}

/**
 * MISSING-RECEIPT-1 (Owner, 2026-09-27; Business Expense Reimbursement Policy p.2: "Amounts greater
 * than $25 require a receipt for reimbursement"). A Personal (Concur) expense over $25, still Recorded
 * or Submitted, with no receipt on file. Reimbursement only, like the policy's other reimbursement
 * rules (Owner, 2026-09-27). Reads either expense shape: the server row (receipt_file_id) or the
 * Sheet's (hasReceipt).
 */
export const RECEIPT_REQUIRED_OVER = 25
const AWAITING = new Set(['recorded', 'submitted'])
export const needsReceipt = (e, over = RECEIPT_REQUIRED_OVER) => !!e && !e.deleted_at && e.state !== 'expected'
  && e.payment_method === 'personal_concur' && AWAITING.has(e.status)
  && Number(e.amount) > over && !(e.receipt_file_id || e.hasReceipt)
