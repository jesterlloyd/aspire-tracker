// test/budgetReceiptsUi.test.mjs
//
// PROGRAM-BUDGET Phase B (BUDGET-B3/B4, 2026-09-27): the Receipts tab and the Action Center.
// The slip is rendered with Vite's ssrLoadModule and react-dom/server (no .env needed); the
// browser behaviour (drop, upload, read, accept, undo) was verified in a harness against the real
// engine. Owner, 2026-09-27: the slip DRAWS its receipt from Keith's reading, and View original
// opens the uploaded file.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'test-anon-key'

const M = await import('../src/lib/budget/receiptModel.js')
const Y = await import('../src/lib/home/needsYouModel.js')
const Q = await import('../src/lib/actionCenter/queueModel.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const CATS = ['Supplies & Materials', 'Printing & Copying', 'Meals & Catering', 'Miscellaneous']

let vite, Slip
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
  Slip = (await vite.ssrLoadModule('/src/components/budget/ReceiptSlip.jsx')).default
})
after(async () => { await vite?.close() })

const reading = (over = {}) => M.parseReading(JSON.stringify({
  document_type: 'receipt', vendor: 'Amazon', order_number: '112-7730158-4402217', date: '2026-09-03', card_last4: '4417',
  subtotal: 53.49, tax: 5.08, shipping: 0, tip: 0, total: 58.57, has_shipping_address: true, unreadable_fields: [],
  lines: [
    { item: 'Copy Paper, 5-Ream Case', quantity: 1, amount: 38.99, category: 'Printing & Copying', confidence: 'high', reason: 'Paper for printed orientation packets.' },
    { item: 'Name Badge Labels', quantity: 2, amount: 14.50, category: 'Supplies & Materials', confidence: 'medium', reason: 'Badges for orientation.' },
  ],
  ...over,
}), CATS)
const context = (over = {}) => ({
  expenses: [], rules: [{ key: 'meals_documentation', tone: 'block', applies_to: 'all', message: 'A business meal needs its business purpose and a list of every attendee.', params: { categories: ['Meals & Catering'] }, enabled: true }],
  years: new Map([[2026, { state: 'closed', total: 40000, spent: {}, plan: null }], [2027, { state: 'current', total: 40000, spent: {}, plan: null }]]),
  pcardLast4: '', today: '2026-09-27', categories: CATS.map(n => ({ id: n, name: n })), ...over,
})
const html = (slip, ctx = context()) => renderToStaticMarkup(React.createElement(Slip, {
  slip, context: ctx, categories: CATS, cohorts: [{ id: 'c1', name: 'Fall 2026' }], busy: false,
  onDraft() {}, onAccept() {}, onSnooze() {}, onReject() {}, onRead() {}, onDiscard() {}, onOriginal() {}, onStartYear() {},
}))
const slipOf = (p, over = {}) => ({ id: 'r1', status: 'review', file_name: 'IMG_4471.jpg', content_type: 'image/jpeg', proposal: p, draft: M.draftFrom(p), ...over })

test('the slip draws the receipt from the reading, with View original beside it, never the photo', () => {
  const out = html(slipOf(reading()))
  // RECEIPT-ORGANIZER-1: the paper names its size, and Amazon's logo prints at its top.
  assert.match(out, /class="bud-rcpt bud-rcpt-lg bud-rcpt-logo" role="img" aria-label="Receipt as Keith read it: Amazon, \$58\.57"/)
  assert.match(out, /Order #112-7730158-4402217/)
  assert.match(out, /<span>Total<\/span><span>\$58\.57<\/span>/)
  assert.match(out, /class="bud-rcpt-bar" aria-label="address not shown"/)
  // The only image on the slip is the printed logo (RECEIPT-ORGANIZER-1); the photo is only in View original.
  assert.deepEqual(out.match(/<img[^>]*>/g), ['<img src="/vendor-logos/amazon.png" alt="" loading="lazy" draggable="false"/>'])
  assert.match(out, /View original/)
  assert.match(out, /IMG_4471\.jpg/)
  // KEITH-FOUNDATION-1 replaced the "Read by Keith" label with the Keith mark, which reads its state
  // from provenance and draws nothing without a staff viewer and a record (test/keithMark.test.mjs).
  assert.doesNotMatch(out, /Read by Keith/)
  assert.match(out, /High confidence<\/span>Paper for printed orientation packets\./)
  assert.match(out, /Split into 2 rows because the items fall in different categories\./)
  assert.match(out, /Card ending 4417\. No P-card is on file, so choose the payment method\./)
  assert.match(out, /Files to <code>Program Budget › FY27 › Receipts › FY27_2026-09-03_Amazon_112-7730158_\$58\.57\.jpg<\/code>/)
  // Date, vendor and order are Keith's reading, shown in the header; Edit opens them.
  assert.match(out, /aria-expanded="false">Edit<\/button>/)
  assert.doesNotMatch(out, /<span>Vendor<\/span>/)
  assert.match(out, />Accept 2 rows<\/button>/)
})

test('a meal shows its purpose and attendee fields and Accept waits for them', () => {
  const p = reading({ vendor: 'Beverly Grove Catering', lines: [{ item: 'Lunch', quantity: 1, amount: 53.49, category: 'Meals & Catering', confidence: 'high', reason: 'Lunch.' }] })
  const out = html(slipOf(p))
  assert.match(out, /<legend>Business meal<\/legend>/)
  assert.match(out, /Business purpose/)
  for (const h of ['Name', 'Title', 'Organization', 'Business relationship']) assert.match(out, new RegExp(`<span>${h}</span>`))
  assert.match(out, /class="bud-check bud-check-block"><svg[^>]*lucide-octagon-alert[\s\S]*?<span>A business meal needs its business purpose/)
  assert.match(out, /disabled="" title="A business meal needs[^"]*">Accept and post<\/button>/, 'the mockup\u2019s label')
  assert.ok(out.indexOf('bud-checks') < out.indexOf('<legend>Business meal</legend>'), 'the meal fields follow the checks, as in the mockup')
})

test('a duplicate offers Attach to its row, and Add as a new row still waits for every block', () => {
  const dup = { id: 'e4', expense_date: '2026-02-10', date_precision: 'month', vendor: 'Amazon', amount: 25.14, order_number: '112-7730158-4402217', item: 'Self-Laminating Pouches', row_label: 'FY26 row 4' }
  const out = html(slipOf(reading()), context({ expenses: [dup] }))
  assert.match(out, />Attach to FY26 row 4<\/button>/)
  assert.match(out, /Matches FY26 row 4 \(Self-Laminating Pouches, \$25\.14, Feb 2026\) by order number/)
  assert.doesNotMatch(out, /aria-label="Lines"/, 'an attach posts no lines')
  const meal = reading({ lines: [{ item: 'Lunch', quantity: 1, amount: 53.49, category: 'Meals & Catering', confidence: 'high', reason: 'Lunch.' }] })
  const both = html(slipOf(meal), context({ expenses: [dup] }))
  assert.match(both, /disabled="" title="A business meal needs[^"]*">Add as a new row<\/button>/)
})

test('a year that has not started turns Accept into Start FY', () => {
  const out = html(slipOf(reading({ date: '2027-07-02' })))
  assert.match(out, />Start FY28<\/button>/)
  assert.doesNotMatch(out, />Accept/)
})

test('reading and failed slips keep the paper blank and say what is happening', () => {
  assert.match(html({ id: 'r2', status: 'reading', file_name: 'lunch.pdf', content_type: 'application/pdf' }), /Keith is reading lunch\.pdf…/)
  const failed = html({ id: 'r3', status: 'failed', file_name: 'blurry.jpg', content_type: 'image/jpeg', read_error: 'Keith took too long to read this receipt. Read it again.' })
  assert.match(failed, /role="alert">Keith took too long/)
  assert.match(failed, />Read again<\/button>/)
  assert.match(failed, />Remove<\/button>/)
})

test('the Receipts tab and Add receipts are the Owner’s only, in the prompt’s tab order', () => {
  const view = read('src/components/budget/ProgramBudgetView.jsx')
  assert.match(view, /if \(canEdit\) t\.push\(\{ value: 'receipts'/)
  assert.match(view, /const t = \[\{ value: 'summary'[^\n]*\{ value: 'subscriptions', label: 'Subscriptions' \}\]\n\s+if \(canEdit\) t\.push\(\{ value: 'receipts'[^\n]*\n\s+if \(canEdit \|\| year\.budget\?\.plan_saved_at\) t\.push\(\{ value: 'allocations'/)
  assert.match(view, /\{canEdit && \(<>\n\s+<button type="button" className="bud-btn" onClick=\{\(\) => addRef\.current\?\.click\(\)\}><ReceiptText/)
  assert.match(view, /current === 'receipts' && canEdit &&/)
  // The Sheet's receipt mark opens the original for the Owner only.
  assert.match(read('src/components/budget/BudgetSheet.jsx'), /return canEdit\n\s+\? <button type="button" className="bud-rc bud-rc-open"/)
  // Owner, 2026-09-27 ("make it like the mockup"): the slips are cards on the page in both styles,
  // with no pressboard (7475d14f put them on one in Classic).
  const css = read('src/components/budget/budget.css')
  assert.doesNotMatch(css, /\.bud-rboard|--aspire-pressboard/)
  assert.doesNotMatch(read('src/components/budget/BudgetReceipts.jsx'), /bud-rboard/)
  assert.match(css, /\.bud-files code \{[^}]*color: var\(--bud-teal\); background: var\(--bud-teal-soft\)/, 'the mockup\u2019s teal filing path')
})

test('the Action Center: receipts to Review, Concur to Submit, renewals to Renew, each its own chip', () => {
  const now = Date.parse('2026-09-27T19:00:00Z')
  const g = Y.budgetGroup({
    now,
    receipts: [{ id: 'r1', vendor: 'Amazon', total: 58.57, rows: 2, categories: ['Printing & Copying', 'Supplies & Materials'], created_at: '2026-09-26T19:00:00Z' }],
    concur: [{ id: 'e1', item: 'Printer ink', vendor: 'Staples', amount: 67.5, deadline: '2026-10-02', daysLeft: 5, hasReceipt: false }],
    renewals: [],
  })
  assert.equal(g.sub, 'Receipts to review, Concur to submit')
  const receipt = g.rows.find(r => r.id === 'receipt:r1')
  assert.deepEqual([receipt.title, receipt.meta, receipt.chip, receipt.pill, receipt.to], ['Amazon · $58.57', '2 rows proposed · Printing & Copying, Supplies & Materials', 'Review', { text: 'Review', tone: 'amber' }, '/settings/budget?tab=receipts'])
  const concur = g.rows.find(r => r.id === 'concur:e1')
  assert.equal(concur.meta, 'Personal (Concur), still Recorded · submit by Oct 2, 2026 · no receipt on file (required over $25)')
  assert.deepEqual(concur.pill, { text: 'Due in 5 days', tone: 'red' })
  const items = Q.normalizeHomeQueue({ groups: [g], now })
  assert.deepEqual(items.map(i => [i.key, i.chip, i.personal]).sort(), [['concur:e1', 'Submit', true], ['receipt:r1', 'Review', true]])
  assert.equal(items.find(i => i.key === 'concur:e1').ageLabel, 'Due in 5 days')
  assert.deepEqual(items.find(i => i.key === 'receipt:r1').actions.map(a => a.key), ['open', 'snooze'], 'Accept stays on the slip (prompt B7)')
  assert.deepEqual(Q.chipCounts(items), [{ chip: 'Review', count: 1 }, { chip: 'Submit', count: 1 }])
})
