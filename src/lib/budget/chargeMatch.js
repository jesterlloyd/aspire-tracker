// src/lib/budget/chargeMatch.js
//
// BUDGET-V2 Phase 1, item 1 (2026-09-29): a receipt for a subscription charge is that charge, not
// a new expense. Accepting a Resend receipt as a one-time row and then approving Resend posted the
// same $20.00 twice. This decides, for one receipt, which subscription charge it is and what the
// owner can do with it. Pure: the slip, the fold, Hold all and the server's Accept read the same
// answer, so a match the slip shows is the match Accept enforces.
//
// A match is the same vendor (budgetModel.sameVendor, so "Anthropic" is "Anthropic, PBC"), a
// scheduled charge within MATCH_WINDOW_DAYS of the receipt's date, and the same amount to the cent.
// A usage-based plan's amount is an estimate, so it matches on vendor and date alone (Owner,
// 2026-09-29), and the nearer amount wins between two plans from one vendor.
//
// The kinds:
//   attach    approved, and the charge counts: attach the receipt to that charge's row.
//   hold      awaiting approval: hold the receipt until the plan is approved.
//   filed     the charge's row already has a receipt: this may be a second copy.
//   uncounted approved from a later day, so this charge does not count. Posting it as one-time is
//             the only way to count it, so nothing is refused.

import { chargesIn, isApproved, isProposed, countsFrom, sameVendor, daysBetween, dateText, usd, APPROVAL } from './budgetModel.js'
import { addDays } from '../rotationCalendarDates.js'

export const MATCH_WINDOW_DAYS = 3
const cents = (n) => Math.round(Number(n) * 100)
const shortDate = (ymd) => dateText(ymd).replace(/, \d{4}$/, '')
const total = (draft) => {
  const lines = (draft?.lines || []).reduce((a, l) => a + (Number(l.amount) || 0), 0)
  return Math.round((lines || Number(draft?.total) || 0) * 100) / 100
}

/**
 * The subscription charge this receipt is, or null. `subs` are subscription rows (any approval
 * state; declined and deleted ones never match). `expenses` are live rows with subscription_id and
 * charge_date, so a posted charge is found by its plan and date.
 */
export function matchSubscriptionCharge(draft, subs = [], expenses = []) {
  const date = draft?.date
  const amount = total(draft)
  if (!date || !amount || !draft?.vendor) return null
  const found = []
  for (const s of subs) {
    if (s.deleted_at || s.approval_state === APPROVAL.declined) continue
    if (!sameVendor(draft.vendor, s.vendor) && !sameVendor(draft.vendor, s.name)) continue
    const usage = s.billing === 'usage'
    if (!usage && Math.abs(cents(amount) - cents(s.amount)) > 1) continue
    const dates = chargesIn(s, addDays(date, -MATCH_WINDOW_DAYS), addDays(date, MATCH_WINDOW_DAYS))
    if (!dates.length) continue
    const charge = [...dates].sort((a, b) => Math.abs(daysBetween(a, date)) - Math.abs(daysBetween(b, date)))[0]
    found.push({ s, charge, usage, gap: Math.abs(cents(amount) - cents(s.amount)), days: Math.abs(daysBetween(charge, date)) })
  }
  if (!found.length) return null
  found.sort((a, b) => a.gap - b.gap || a.days - b.days)
  const { s, charge, usage } = found[0]
  const row = expenses.find(e => !e.deleted_at && e.subscription_id === s.id && e.charge_date === charge) || null
  let kind
  if (isProposed(s)) kind = 'hold'
  else if (!isApproved(s)) return null
  else if (charge < countsFrom(s)) kind = 'uncounted'
  else if (row?.receipt_file_id) kind = 'filed'
  else kind = 'attach'
  return {
    kind, usage, charge_date: charge, amount: Number(s.amount),
    subscription: { id: s.id, name: s.name, approval_state: s.approval_state || APPROVAL.approved, counts_from: countsFrom(s) },
    expense: row ? { id: row.id, row_label: row.row_label || null } : null,
  }
}

/** The kinds that must not become a new row without the owner saying so (Post as one-time instead). */
export const GUARDED = new Set(['attach', 'hold', 'filed'])

/** The slip's check line for a match. */
export function matchText(m) {
  if (!m) return ''
  const name = m.subscription.name
  const head = `Matches the ${name} subscription charge on ${shortDate(m.charge_date)} (${usd(m.amount)}${m.usage ? ', estimated' : ''}).`
  const twice = 'Posting it as a new row would count this charge twice.'
  const usage = m.usage ? ` ${name} is usage-based, so the row keeps its estimate; correct the amount in the Sheet if it differs.` : ''
  if (m.kind === 'hold') return `${head} ${twice} ${name} is awaiting approval, so hold this receipt until you approve it.`
  if (m.kind === 'attach') return `${head} ${twice} Attach it to that charge.${usage}`
  if (m.kind === 'filed') return `${head} That charge already has its receipt, so this may be a second copy.`
  return `${head} ${name} was approved from ${dateText(m.subscription.counts_from)}, so this charge does not count. Post it as one-time to count it.`
}
