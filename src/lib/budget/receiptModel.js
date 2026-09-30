// src/lib/budget/receiptModel.js
//
// PROGRAM-BUDGET Phase B (BUDGET-B1, 2026-09-27): what Keith's reading of a receipt becomes.
// Pure: no DOM, no database. The server (lib/server/budget/receipts.js) validates Keith's
// answer here, the slip edits the draft built here, and Accept posts the rows built here, so
// the three can never disagree about a total.
//
//   parseReading(text, categories)   Keith's JSON, checked and cleaned (prompt B2). A category
//                                    outside the managed list is never kept.
//   draftFrom(proposal, opts)        the slip's starting state: tax, shipping and tip spread across
//                                    the lines by amount, the payment method from the card (B3).
//   rowsFrom(draft)                  one expense row per category (B2: "one row per category").
//   receiptPaper(proposal)           the DRAWN receipt on the slip (Owner, 2026-09-27: every slip
//                                    shows the same printed receipt, built from the reading; View
//                                    original opens the file itself). An address is never drawn.
//   filedName(...)                   FY27_2026-09-03_Amazon_112-7730158_$58.57.pdf (B6.3).

import { fiscalYearOfDate, fyShort, usd, paymentLabel } from './budgetModel.js'
import { VENDOR_LOGOS } from './vendorLogos.js'

export const DOCUMENT_TYPES = Object.freeze(['receipt', 'invoice', 'order_confirmation', 'card_statement', 'other'])
export const CONFIDENCE = Object.freeze(['high', 'medium', 'low'])
export const LINE_FLAGS = Object.freeze(['alcohol', 'logo_merchandise', 'stationery', 'gift', 'gift_card', 'equipment'])
export const RECEIPT_TYPES = Object.freeze({
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf', 'message/rfc822': 'eml',
})
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024
export const ATTENDEE_FIELDS = Object.freeze(['name', 'title', 'organization', 'relationship'])
export const MAX_LINES = 40

const cents = (n) => Math.round(Number(n) * 100)
const money = (n) => Math.round(Number(n) * 100) / 100
const num = (v) => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null }
const text = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const YMD = /^\d{4}-\d{2}-\d{2}$/

export class ReadingError extends Error {}

/** The one JSON object Keith returns, found even inside a stray code fence or a sentence. */
function jsonOf(raw) {
  const s = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a < 0 || b <= a) throw new ReadingError('Keith did not return a reading.')
  try { return JSON.parse(s.slice(a, b + 1)) } catch { throw new ReadingError('Keith’s reading was not valid JSON.') }
}

/**
 * Check and clean Keith's reading. `categories` are the managed names. Returns the proposal;
 * throws ReadingError when there is nothing usable (no lines and no total).
 */
export function parseReading(raw, categories = []) {
  const o = jsonOf(raw)
  const names = new Map(categories.map(c => [String(c).toLowerCase(), c]))
  const unreadable = Array.isArray(o.unreadable_fields) ? o.unreadable_fields.map(x => text(x, 40)).filter(Boolean).slice(0, 20) : []
  const lines = (Array.isArray(o.lines) ? o.lines : []).slice(0, MAX_LINES).map((l, i) => {
    const amount = num(l?.amount)
    const quantity = num(l?.quantity)
    const known = names.get(String(l?.category || '').trim().toLowerCase())
    const confidence = CONFIDENCE.includes(l?.confidence) ? l.confidence : 'low'
    return {
      item: text(l?.item, 200) || `Item ${i + 1}`,
      quantity: quantity != null && quantity >= 0 ? money(quantity) : 1,
      amount: amount != null && amount >= 0 ? money(amount) : 0,
      // Never an invented category (prompt B2): an unknown one is left for the owner.
      category: known || null,
      confidence: known ? confidence : 'low',
      reason: known ? text(l?.reason, 200) : `Keith suggested "${text(l?.category, 60) || 'no category'}", which is not on the category list. Choose one.`,
      flags: (Array.isArray(l?.flags) ? l.flags : []).filter(f => LINE_FLAGS.includes(f)),
    }
  })
  const pick = (k) => { const n = num(o[k]); return n != null && n >= 0 ? money(n) : 0 }
  const subtotal = pick('subtotal'), tax = pick('tax'), shipping = pick('shipping'), tip = pick('tip')
  let total = pick('total')
  const lineSum = money(lines.reduce((a, l) => a + l.amount, 0))
  if (!total && lineSum) total = money(lineSum + tax + shipping + tip)
  if (!lines.length && !total) throw new ReadingError('Keith could not find any items or a total on this receipt.')
  const date = YMD.test(String(o.date || '')) ? String(o.date) : ''
  const last4 = String(o.card_last4 || '').replace(/\D/g, '').slice(-4)
  return {
    document_type: DOCUMENT_TYPES.includes(o.document_type) ? o.document_type : 'receipt',
    vendor: text(o.vendor, 120) || 'Unknown vendor',
    order_number: text(o.order_number, 80),
    date,
    date_confidence: CONFIDENCE.includes(o.date_confidence) ? o.date_confidence : (date ? 'medium' : 'low'),
    card_last4: last4.length === 4 ? last4 : '',
    subtotal: subtotal || lineSum, tax, shipping, tip, total,
    lines: lines.length ? lines : [{ item: text(o.vendor, 120) || 'Receipt', quantity: 1, amount: money(total - tax - shipping - tip), category: null, confidence: 'low', reason: 'Keith found a total but no items. Name the item and choose a category.', flags: [] }],
    unreadable_fields: date ? unreadable : [...new Set([...unreadable, 'date'])],
    has_shipping_address: o.has_shipping_address === true,
    // Keith is told to add up; when the parts do not, the slip says so rather than guessing which part is wrong.
    adds_up: Math.abs(cents(lineSum + tax + shipping + tip) - cents(total)) <= 1 || !lines.length,
  }
}

/**
 * Spread `extra` (tax + shipping + tip) across amounts in proportion, each share rounded to the
 * cent and any remainder cent on the largest line, so the lines add up to the receipt's total (prompt B2).
 */
export function spreadExtras(amounts, extra) {
  const base = amounts.map(cents)
  const add = cents(extra)
  const sum = base.reduce((a, b) => a + b, 0)
  if (!add) return base.map(c => c / 100)
  if (!sum) { const out = base.map(() => 0); out[0] = add; return out.map((c, i) => (base[i] + c) / 100) }
  // Each share rounded to the cent; whatever that leaves over (or under) goes on the largest line.
  const shares = base.map(c => Math.round((c * add) / sum))
  const largest = base.reduce((best, c, i) => (c > base[best] ? i : best), 0)
  shares[largest] += add - shares.reduce((a, b) => a + b, 0)
  return base.map((c, i) => (c + shares[i]) / 100)
}

/** The payment method from the card (B3). `pcardLast4` is the owner's, or empty when none is on file. */
export function paymentFromCard(cardLast4, pcardLast4, remembered = []) {
  if (!cardLast4) return { method: null, tone: 'info', text: 'No card number on the receipt. Choose the payment method.' }
  if (pcardLast4 && cardLast4 === pcardLast4) return { method: 'p_card', tone: 'ok', text: `Card ending ${cardLast4} is your P-card: P-card, Paid.` }
  // BUDGET-V2 item 5: a card the owner asked to remember reads as they said, on every receipt.
  const known = (remembered || []).find(c => c?.last4 === cardLast4)
  if (known) return { method: known.method, tone: 'ok', text: `Card ending ${cardLast4} is remembered as ${paymentLabel(known.method)}.`, remembered: true }
  if (!pcardLast4) return { method: null, tone: 'info', text: `Card ending ${cardLast4}. No P-card is on file, so choose the payment method.` }
  return { method: 'personal_concur', tone: 'info', text: `Card ending ${cardLast4} is not your P-card, so this is a personal purchase: Personal (Concur). Mark it Submitted to Concur when you file it there.` }
}

/**
 * BUDGET-V2 item 5: the other open receipts a remembered card would set, and so the count the
 * checkbox names ("Applies to 14 other receipts"). Open means waiting, snoozed or held; a receipt
 * already set to that method is not counted.
 */
export function receiptsOnCard(slips = [], last4, method, exceptId = null) {
  if (!last4) return []
  return slips.filter(s => s.id !== exceptId && s.draft && s.proposal?.card_last4 === last4 && s.draft.payment_method !== method)
}

let lineSeq = 0
const lineId = () => `l${Date.now().toString(36)}${(lineSeq++).toString(36)}`

/** The slip's starting state. The owner edits this; Accept posts it. */
export function draftFrom(proposal, { pcardLast4 = '', rememberedCards = [] } = {}) {
  const p = proposal
  const extra = money((p.tax || 0) + (p.shipping || 0) + (p.tip || 0))
  const spread = spreadExtras(p.lines.map(l => l.amount), extra)
  const pay = paymentFromCard(p.card_last4, pcardLast4, rememberedCards)
  return {
    vendor: p.vendor, order_number: p.order_number, date: p.date, total: p.total,
    lines: p.lines.map((l, i) => ({ id: lineId(), item: l.item, category: l.category, quantity: l.quantity, amount: spread[i], base: l.amount, confidence: l.confidence, reason: l.reason, flags: l.flags, set_by_owner: false })),
    payment_method: pay.method,
    cohort_id: null,
    business_purpose: '',
    attendees: [],
  }
}

/** A line's category changed by the owner (B5): High, "Category set by you." */
export function setLineCategory(draft, id, category) {
  return { ...draft, lines: draft.lines.map(l => (l.id === id ? { ...l, category, confidence: 'high', reason: 'Category set by you.', set_by_owner: true } : l)) }
}

export const draftTotal = (draft) => money((draft?.lines || []).reduce((a, l) => a + (Number(l.amount) || 0), 0))
/**
 * BUDGET-FIXES-1: what the receipt says it cost, for a charge that takes its receipt's amount. The
 * total printed on the receipt, then Keith's reading of it, then the lines. The lines alone can
 * overstate it: a credit line is stored as $0 (the July Supabase invoice added to $55.14 against a
 * $28.52 total).
 */
export function statedTotal(draft, proposal) {
  if (Number(draft?.total) > 0) return money(draft.total)
  if (Number(proposal?.total) > 0) return money(proposal.total)
  return draftTotal(draft)
}

/** Clean attendees: every row that has a name, each field trimmed. */
export function cleanAttendees(list) {
  return (Array.isArray(list) ? list : []).slice(0, 60)
    .map(a => Object.fromEntries(ATTENDEE_FIELDS.map(k => [k, text(a?.[k], 120)])))
    .filter(a => a.name)
}

/**
 * One expense row per category, in the order its first line appears. One line keeps its item and
 * quantity; several become "First item and 2 more" at quantity 1, every item listed in the
 * description, so the ledger reads the way the FY26 workbook did.
 */
export function rowsFrom(draft) {
  const groups = new Map()
  for (const l of draft.lines || []) {
    const k = l.category || ''
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(l)
  }
  return [...groups.entries()].map(([category, lines]) => {
    const amount = money(lines.reduce((a, l) => a + (Number(l.amount) || 0), 0))
    if (lines.length === 1) return { category: category || null, item: lines[0].item, quantity: Number(lines[0].quantity) || 1, amount, description: '', lines }
    return {
      category: category || null, item: `${lines[0].item} and ${lines.length - 1} more`, quantity: 1, amount,
      description: lines.map(l => `${l.item}${Number(l.quantity) > 1 ? ` x${l.quantity}` : ''}`).join('; ').slice(0, 1000), lines,
    }
  })
}

const safe = (s) => String(s || '').normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

/** FY27_2026-09-03_Amazon_112-7730158_$58.57.pdf: {FY}_{date}_{vendor}_{order, first two segments}_${total}.{ext} */
export function filedName({ date, vendor, order_number: order, total, contentType }) {
  const fy = date ? fiscalYearOfDate(date) : null
  const ord = safe(String(order || '').split('-').slice(0, 2).join('-'))
  const parts = [fy ? fyShort(fy) : 'FY', date || 'undated', safe(vendor).slice(0, 40) || 'Vendor', ord, `$${money(total).toFixed(2)}`].filter(Boolean)
  return `${parts.join('_')}.${RECEIPT_TYPES[contentType] || 'pdf'}`
}

/**
 * The drawn receipt: [{ text } | { left, right } | { rule: true }], each with `hl` when Keith
 * could not read that part clearly and `strong` for the total. Built from the reading only, so
 * every slip looks the same whatever was photographed.
 */
export function receiptPaper(p) {
  if (!p) return []
  const bad = new Set(p.unreadable_fields || [])
  const out = [{ text: p.vendor, head: true, hl: bad.has('vendor') }]
  if (p.order_number) out.push({ text: `Order #${p.order_number}`, hl: bad.has('order_number') })
  out.push({ text: p.date ? new Date(`${p.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'Date unreadable', hl: bad.has('date') || !p.date })
  out.push({ rule: true })
  p.lines.forEach((l, i) => {
    out.push({ left: l.item, right: usd(l.amount), hl: bad.has(`lines[${i}].amount`) || bad.has(`lines[${i}].item`) })
    if (Number(l.quantity) > 1) out.push({ text: `Qty ${l.quantity}`, sub: true })
  })
  out.push({ rule: true })
  out.push({ left: 'Subtotal', right: usd(p.subtotal), hl: bad.has('subtotal') })
  if (p.tax) out.push({ left: 'Tax', right: usd(p.tax), hl: bad.has('tax') })
  if (p.shipping) out.push({ left: 'Shipping', right: usd(p.shipping), hl: bad.has('shipping') })
  if (p.tip) out.push({ left: 'Tip', right: usd(p.tip), hl: bad.has('tip') })
  out.push({ left: 'Total', right: usd(p.total), strong: true, hl: bad.has('total') || !p.adds_up })
  if (p.card_last4) out.push({ left: 'Card', right: `•••• ${p.card_last4}` })
  if (p.has_shipping_address) out.push({ left: 'Ship to:', redacted: true })
  return out
}

// ── RECEIPT-ORGANIZER-1 (Owner, 2026-09-27) ─────────────────────────────────────

// Names a receipt prints that are not the brand's own (a card statement's descriptor, a parent name).
const VENDOR_ALIASES = Object.freeze({ amzn: 'amazon', 'amzn-mktp': 'amazon', 'amazon-marketplace': 'amazon', 'the-home-depot': 'home-depot', michaels: 'michaels-stores', 'costco-wholesale': 'costco', 'fedex-office': 'fedex', 'walmart-supercenter': 'walmart', 'open-ai': 'openai', xai: 'grok-xai', 'x-ai': 'grok-xai' })
const vendorSlug = (v) => String(v || '').toLowerCase().normalize('NFKD')
  .replace(/\.(com|net|org|co|io)\b/g, ' ').replace(/\b(inc|llc|ltd|corp|corporation|co|company|stores?|pbc)\b\.?/g, ' ')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/**
 * The printed logo for a vendor, or null: public/vendor-logos/<slug>.png when one is on file
 * (src/lib/budget/vendorLogos.js, written by scripts/prepare_vendor_logos.py). Matched on the name
 * less case, punctuation, ".com" and "Inc."; then an alias; then a logo whose name starts with it
 * ("Michaels" finds michaels-stores); then the first word ("Amazon Business" finds amazon).
 */
export function vendorLogo(vendor, logos = VENDOR_LOGOS) {
  const s = vendorSlug(vendor)
  if (!s) return null
  const have = new Set(logos)
  const first = s.split('-')[0]
  const hit = [s, VENDOR_ALIASES[s], logos.find(l => l.startsWith(`${s}-`)), VENDOR_ALIASES[first], first.length >= 3 ? first : null].find(c => c && have.has(c))
  return hit ? `/vendor-logos/${hit}.png` : null
}

export const FILED_GROUPS = Object.freeze([
  { key: 'month', label: 'Month' }, { key: 'category', label: 'Category' }, { key: 'vendor', label: 'Vendor' }, { key: 'status', label: 'Stage' },
])
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const monthLabel = (ymd) => { const [y, m] = String(ymd || '').split('-').map(Number); return y && m ? `${MONTHS[m - 1]} ${y}` : 'No date' }

/**
 * Filed receipts in folders (the organizer). `receipts` are rows from the server's filed list:
 * { id, date, vendor, total, rows: [{ category, amount, status }] }. Grouped by month (newest first),
 * category, vendor or status (alphabetical). A receipt split across categories sits in each of its
 * category folders with `part`, what it spent there, so every folder adds up to its own spend.
 * `query` searches vendor, order number and every item.
 */
export function filedFolders(receipts = [], { groupBy = 'month', query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase()
  const list = receipts.filter(r => !q || [r.vendor, r.order_number, ...(r.items || [])].join(' ').toLowerCase().includes(q))
  const folders = new Map()
  const put = (key, sort, entry) => { if (!folders.has(key)) folders.set(key, { key, sort, entries: [] }); folders.get(key).entries.push(entry) }
  for (const r of list) {
    if (groupBy === 'category') {
      const by = new Map()
      for (const row of r.rows || []) by.set(row.category || 'Uncategorized', money((by.get(row.category || 'Uncategorized') || 0) + (Number(row.amount) || 0)))
      if (!by.size) by.set('Uncategorized', r.total)
      for (const [cat, amt] of by) put(cat, cat, { receipt: r, part: by.size > 1 ? amt : null })
    } else if (groupBy === 'vendor') put(r.vendor || 'Unknown vendor', String(r.vendor || '').toLowerCase(), { receipt: r, part: null })
    else if (groupBy === 'status') { const st = r.rows?.[0]?.stageLabel || 'Not recorded'; put(st, st, { receipt: r, part: null }) }
    else put(monthLabel(r.date), `~${9999 - Number(String(r.date || '0000').slice(0, 4))}-${String(99 - Number(String(r.date || '').slice(5, 7) || 0)).padStart(2, '0')}`, { receipt: r, part: null })
  }
  return [...folders.values()]
    .map(f => ({ ...f, entries: f.entries.sort((a, b) => String(b.receipt.date).localeCompare(String(a.receipt.date))), total: money(f.entries.reduce((a, e) => a + (e.part ?? e.receipt.total), 0)) }))
    .sort((a, b) => a.sort.localeCompare(b.sort))
    .map(f => ({ key: f.key, count: f.entries.length, total: f.total, entries: f.entries }))
}

/** The short state a folded slip shows (To Review): what it needs, or that it is ready. */
export function slipState(result, rowCount) {
  if (!result) return { tone: 'info', text: 'Reading' }
  if (result.duplicate) return { tone: 'warn', text: `Matches ${result.duplicate.expense.row_label}` }
  // BUDGET-V2 item 1: a subscription charge says whose, and what it waits for.
  const m = result.subMatch
  if (m && m.kind !== 'uncounted') return { tone: 'warn', text: m.kind === 'hold' ? `Matches ${m.subscription.name} · awaiting approval` : m.kind === 'filed' ? `${m.subscription.name} charge has its receipt` : `Matches ${m.subscription.name}` }
  if (result.checks.some(c => c.key === 'plan' && c.plan?.key === 'over')) return { tone: 'warn', text: 'Over the approved plan' }
  const block = result.checks.find(c => c.tone === 'block')
  if (block) {
    if (block.key === 'rule:meals_documentation') return { tone: 'warn', text: 'Needs purpose and attendees' }
    if (block.key === 'not_started') return { tone: 'warn', text: `Start ${block.text.match(/FY\d\d/)?.[0] || 'the year'}` }
    if (block.key === 'category') return { tone: 'warn', text: 'Needs a category' }
    if (block.key === 'date') return { tone: 'warn', text: 'Needs a date' }
    return { tone: 'warn', text: 'Needs you' }
  }
  const warns = result.checks.filter(c => c.tone === 'warn').length
  return { tone: warns ? 'warn' : 'info', text: `${rowCount} ${rowCount === 1 ? 'row' : 'rows'} · ${warns ? `${warns} ${warns === 1 ? 'warning' : 'warnings'}` : 'ready'}` }
}
