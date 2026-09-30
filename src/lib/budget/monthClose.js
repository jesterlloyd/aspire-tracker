// src/lib/budget/monthClose.js
//
// BUDGET-V2 Phase 2, item 13 (2026-09-29): closing a month. Reference: the Summary's "Close
// September" card in docs/mockups/program-budget-v2.html. Pure: the Summary card, the server's
// Close, the Action Center's reminder and the receipt slip's closed-month check read these rules,
// so what the card says is ready is what Close accepts.
//
// The monthly cycle is Expect, Post, Match or add, Submit, Close. A month is closed when the owner
// says so from its checklist (or with a note leadership sees); a closed month's rows are locked
// until it is reopened, and both are logged in Budget history.

import { fiscalYearRange, usd, dateText } from './budgetModel.js'

export const WINDOW_FROM_DAY = 25     // the card appears from the 25th of the month...
export const WINDOW_TO_DAY = 10       // ...through the 10th of the next,
export const REMIND_DAY = 5           // and the Action Center asks on the 5th.
const NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n) => String(n).padStart(2, '0')
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** "2026-09" for any date in September 2026. */
export const monthKey = (ymd) => String(ymd || '').slice(0, 7)
/** { key, name: 'September', short: 'Sep', label: 'Sep 2026', start, end } */
export function monthInfo(key) {
  const [y, m] = key.split('-').map(Number)
  return { key, year: y, name: NAMES[m - 1], short: SHORT[m - 1], label: `${SHORT[m - 1]} ${y}`, start: `${key}-01`, end: `${key}-${pad(lastDay(y, m))}` }
}
const shift = (key, n) => { const [y, m] = key.split('-').map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}` }
/** The twelve months of a fiscal year, July first. */
export function fyMonths(fy) {
  const r = fiscalYearRange(fy)
  return r ? Array.from({ length: 12 }, (_, i) => monthInfo(shift(monthKey(r.start), i))) : []
}
/** The 5th of the month after, when the Action Center starts asking. */
export const dueDate = (key) => `${shift(key, 1)}-${pad(REMIND_DAY)}`

/**
 * The month the card is for, or null: the OLDEST month still open that has ended or is in the window
 * (the 25th through the 10th). Months close in order (BUDGET-FIXES-1 item 2.4, Owner 2026-09-29), so
 * with July open the card closes July, whatever month it is now.
 */
export function closeTarget(fy, closed = new Set(), today) {
  const months = fyMonths(fy)
  const day = Number(String(today).slice(8, 10))
  const win = day >= WINDOW_FROM_DAY ? monthKey(today) : day <= WINDOW_TO_DAY ? shift(monthKey(today), -1) : null
  const open = months.filter(m => !closed.has(m.key) && (m.end < today || m.key === win))
  return open.length ? open[0].key : null
}

/**
 * Closed, Closing (the month being closed), Not closed (ended and open), In progress (this month,
 * waiting its turn: months close in order, BUDGET-FIXES-1 item 2.4), Upcoming.
 */
export function monthStatus(key, { closed = new Set(), target = null, today }) {
  if (closed.has(key)) return { key: 'closed', label: 'Closed', tone: 'ok' }
  if (key === target) return { key: 'closing', label: 'Closing', tone: 'warn' }
  if (monthInfo(key).end < today) return { key: 'not_closed', label: 'Not closed', tone: 'off' }
  if (monthInfo(key).start <= today) return { key: 'in_progress', label: 'In progress', tone: 'off' }
  return { key: 'upcoming', label: 'Upcoming', tone: 'off' }
}

/**
 * The strip across the top of the card: every month from July to the one after the target (so the
 * next month shows Upcoming), each with its posted total and, for a month still to come, what is
 * expected.
 */
export function monthStrip(fy, { expenses = [], closed = new Set(), target, today }) {
  const months = fyMonths(fy)
  const last = target ? months.findIndex(m => m.key === target) + 1 : months.findIndex(m => m.end >= today)
  return months.slice(0, Math.max(1, Math.min(months.length, last + 1))).map(m => {
    const rows = expenses.filter(e => !e.deleted_at && e.status !== 'void' && monthKey(e.expense_date) === m.key)
    const posted = sum(rows.filter(e => e.state !== 'expected').map(e => e.amount))
    const expected = sum(rows.filter(e => e.state === 'expected').map(e => e.amount))
    return { ...m, posted, expected, status: monthStatus(m.key, { closed, target, today }) }
  })
}
const sum = (xs) => Math.round(xs.reduce((a, b) => a + (Number(b) || 0), 0) * 100) / 100
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const list = (xs, n = 3) => (xs.length > n ? `${xs.slice(0, n).join(', ')} and ${xs.length - n} more` : xs.join(', '))

/**
 * The four checks, for one month:
 *   posted   every subscription charge dated in the month has posted (none still Expected);
 *   receipts every posted row has a receipt, or a note saying why not;
 *   review   no receipt dated in the month is waiting (to review, snoozed or held);
 *   concur   no Personal (Concur) purchase in the month is still Recorded.
 * `expenses` are the year's rows (with state, receipt, notes); `receipts` are the waiting slips
 * ({ id, status, vendor, date }).
 */
export function closeChecklist(key, { expenses = [], receipts = [] } = {}) {
  const m = monthInfo(key)
  const rows = expenses.filter(e => !e.deleted_at && e.status !== 'void' && monthKey(e.expense_date) === key)
  const expected = rows.filter(e => e.state === 'expected')
  const posted = rows.filter(e => e.state !== 'expected')
  const charges = posted.filter(e => e.subscription_id)
  const bare = posted.filter(e => !(e.receipt_file_id || e.hasReceipt) && !String(e.notes || '').trim())
  const noted = posted.filter(e => !(e.receipt_file_id || e.hasReceipt) && String(e.notes || '').trim())
  const waiting = receipts.filter(r => monthKey(r.date) === key)
  const concur = posted.filter(e => e.payment_method === 'personal_concur' && e.status === 'recorded')
  const items = [
    expected.length
      ? { key: 'posted', ok: false, title: `${plural(expected.length, `${m.name} charge`)} not posted yet`, detail: list(expected.map(e => `${e.item}, ${dateText(e.expense_date).replace(/, \d{4}$/, '')}`)) }
      : { key: 'posted', ok: true, title: charges.length ? `${plural(charges.length, `${m.name} charge`)} posted` : `No ${m.name} subscription charges`, detail: charges.length ? list([...new Set(charges.map(e => e.item))]) : 'Nothing was scheduled' },
    bare.length
      ? { key: 'receipts', ok: false, title: `${plural(bare.length, `${m.name} expense`)} with no receipt or note`, detail: list(bare.map(e => `${e.item || e.vendor || 'Expense'} ${usd(e.amount)}`)), ids: bare.map(e => e.id) }
      : { key: 'receipts', ok: true, title: posted.length ? `Every ${m.name} expense has a receipt${noted.length ? ' or a note' : ''}` : `No ${m.name} expenses`, detail: posted.length ? `${posted.length - noted.length} of ${posted.length} with receipts${noted.length ? `, ${noted.length} with a note` : ''}` : 'Nothing posted' },
    waiting.length
      ? { key: 'review', ok: false, title: `${plural(waiting.length, `${m.name} receipt`)} still to review`, detail: list(waiting.map(r => `${r.vendor || 'Receipt'}, ${dateText(r.date).replace(/, \d{4}$/, '')}${r.status === 'held' ? ' (held for approval)' : ''}`)) }
      : { key: 'review', ok: true, title: `No ${m.name} receipts left to review`, detail: 'To Review is clear for this month' },
    concur.length
      ? { key: 'concur', ok: false, title: `${plural(concur.length, 'personal purchase')} not submitted to Concur yet`, detail: `${usd(sum(concur.map(e => e.amount)))} · ${m.name}`, ids: concur.map(e => e.id) }
      : { key: 'concur', ok: true, title: 'Personal purchases submitted to Concur', detail: posted.some(e => e.payment_method === 'personal_concur') ? 'Every one is Submitted or Reimbursed' : 'None this month' },
  ]
  return { month: m, items, ready: items.every(i => i.ok) }
}

/**
 * The Action Center's reminder: from the 5th of the next month, the OLDEST month that has ended and
 * is still open ("Close July"), with how many later months wait behind it. Null when none.
 */
export function closeReminder(fy, closed = new Set(), today) {
  const due = fyMonths(fy).filter(m => m.end < today && dueDate(m.key) <= today && !closed.has(m.key))
  if (!due.length) return null
  const m = due[0]   // the oldest: months close in order (item 2.4)
  return { month: m.key, name: m.name, label: m.label, due: dueDate(m.key), later: due.length - 1 }
}

/** A closed month's message for a row that falls in it. */
export const closedMessage = (key) => `${monthInfo(key).name} ${monthInfo(key).year} is closed. Reopen it on the Summary to change its rows.`
/** Is this date in a closed month? */
export const inClosedMonth = (ymd, closed = new Set()) => !!ymd && closed.has(monthKey(ymd))
