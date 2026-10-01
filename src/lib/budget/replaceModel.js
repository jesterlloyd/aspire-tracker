// src/lib/budget/replaceModel.js
//
// REPLACE-SHEET-1 (Owner, 2026-10-01: "when replacing a receipt, why wouldn't it replace the sheet line
// too? ... it should update it everywhere"). Accepting a replacement in To Review makes the Sheet say
// what the new file says: the rows the filed receipt posted take the replacement's reading (as the
// Owner edited it on the slip). This is the ONE rule for what changes, read by the slip (to show it
// before Accept) and by the server (to do it). Pure.
//
//   target   the filed receipt being replaced: { attached, rows: [{ id, row_label, category, item,
//            quantity, amount, date }] } (its live Sheet rows)
//   draft    the replacement slip's draft (vendor, date, order_number, lines)
//
// A receipt that POSTED its rows (one per category) is re-posted: a row whose category is still there
// is updated, a category that is gone has its row removed, a new category gets a new row. A receipt
// that was ATTACHED to a row that already existed (a subscription charge, a duplicate) only sets that
// row's amount: the row was never the receipt's to rewrite.

import { rowsFrom, draftTotal } from './receiptModel.js'
import { usd, dateText, fiscalYearOfDate } from './budgetModel.js'
import { monthKey, monthInfo } from './monthClose.js'

const money = (n) => Math.round((Number(n) || 0) * 100) / 100
const same = (a, b) => String(a ?? '') === String(b ?? '')

/** What still has to be filled in before a replacement can be accepted, in words. */
export function replacementBlocks(draft, target) {
  const out = []
  const d = draft || {}
  if (!(draftTotal(d) > 0)) out.push('Enter an amount.')
  if (target?.attached) return out
  if (!d.date) out.push('Enter the date.')
  if ((d.lines || []).some(l => !l.category)) out.push('Choose a category for every line.')
  if (!(d.lines || []).length) out.push('Add at least one line.')
  return out
}

/**
 * The changes accepting would make to the Sheet.
 * Returns { ops, before, after, changed }, ops in the order they are done:
 *   { kind: 'update', id, row_label, from, to, fields: ['amount', ...] }   (only rows that really change)
 *   { kind: 'add', to }                                                    (a category the old receipt did not have)
 *   { kind: 'remove', id, row_label, from }                                (a category the new one does not have)
 */
export function replacementPlan(draft, target) {
  const d = draft || {}
  const rows = target?.rows || []
  const before = money(rows.reduce((a, r) => a + (Number(r.amount) || 0), 0))
  const ops = []
  if (target?.attached) {
    const total = money(draftTotal(d))
    for (const [i, r] of rows.entries()) {
      // One attached row takes the total; a second (never expected) is left alone.
      if (i === 0 && money(r.amount) !== total) ops.push({ kind: 'update', id: r.id, row_label: r.row_label, from: { amount: money(r.amount) }, to: { amount: total, quantity: 1 }, fields: ['amount'] })
    }
    return { ops, before, after: ops.length ? money(before - money(rows[0].amount) + total) : before, changed: ops.length > 0 }
  }
  const next = rowsFrom(d).map(n => ({ category: n.category, item: n.item, quantity: n.quantity, amount: money(n.amount), description: n.description || '' }))
  const left = [...rows]
  const pairs = []
  // The same category first, then whatever is left in order: a single row whose category changed is
  // one row changing category, not one removed and one added.
  for (const n of next) {
    const i = left.findIndex(r => r.category === n.category)
    pairs.push({ n, r: i >= 0 ? left.splice(i, 1)[0] : null })
  }
  for (const p of pairs) if (!p.r && left.length) p.r = left.shift()
  for (const { n, r } of pairs) {
    if (!r) { ops.push({ kind: 'add', to: { ...n, date: d.date || '' } }); continue }
    const to = { amount: n.amount, quantity: n.quantity, item: n.item, category: n.category, date: d.date || r.date }
    const fields = ['amount', 'category', 'item', 'date', 'quantity'].filter(k => (k === 'amount' || k === 'quantity' ? money(r[k]) !== money(to[k]) : !same(r[k], to[k])))
    if (fields.length) ops.push({ kind: 'update', id: r.id, row_label: r.row_label, from: { amount: money(r.amount), category: r.category, item: r.item, date: r.date, quantity: r.quantity }, to: { ...to, description: n.description }, fields })
  }
  for (const r of left) ops.push({ kind: 'remove', id: r.id, row_label: r.row_label, from: { amount: money(r.amount), category: r.category, item: r.item } })
  return { ops, before, after: money(next.reduce((a, n) => a + n.amount, 0)), changed: ops.length > 0 }
}

/** The plan in words, one line per row, for the slip: "FY26 row 12: $48.93 becomes $26.45". */
export function planLines(plan) {
  const name = (o) => o.row_label || 'The row'
  return plan.ops.map(o => {
    if (o.kind === 'add') return `A new row is added: ${o.to.category || 'no category'}, ${usd(o.to.amount)}.`
    if (o.kind === 'remove') return `${name(o)} is removed (${o.from.category || 'no category'}, ${usd(o.from.amount)}).`
    const parts = []
    if (o.fields.includes('amount')) parts.push(`${usd(o.from.amount)} becomes ${usd(o.to.amount)}`)
    if (o.fields.includes('date')) parts.push(`${dateText(o.from.date)} becomes ${dateText(o.to.date)}`)
    if (o.fields.includes('category')) parts.push(`${o.from.category || 'no category'} becomes ${o.to.category}`)
    if (o.fields.includes('item') && !parts.length) parts.push(`the item becomes "${o.to.item}"`)
    if (o.fields.includes('quantity') && !parts.length) parts.push(`the quantity becomes ${o.to.quantity}`)
    return `${name(o)}: ${parts.join(', ')}.`
  })
}

/**
 * The closed months this replacement would write into: the months its rows are in now, and the month
 * of the new date. `closedByYear` maps a fiscal year to its closed month keys. Closing and reopening a
 * month is the Owner's own act, so a replacement never writes into a closed one; it names it instead.
 */
export function closedMonthsHit(draft, target, closedByYear = new Map()) {
  const dates = [...(target?.rows || []).map(r => r.date), ...(target?.attached ? [] : [draft?.date])].filter(Boolean)
  const out = new Map()
  for (const date of dates) {
    const fy = fiscalYearOfDate(date)
    const key = monthKey(date)
    const closed = closedByYear instanceof Map ? closedByYear.get(fy) : closedByYear?.[fy]
    if ((closed || []).includes(key) && !out.has(key)) out.set(key, { key, fy, name: monthInfo(key).name, year: monthInfo(key).year })
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key))
}
