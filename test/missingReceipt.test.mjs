// test/missingReceipt.test.mjs
//
// MISSING-RECEIPT-1 (Owner, 2026-09-27): the Business Expense Reimbursement Policy (p.2) requires a
// receipt over $25. A Personal (Concur) expense over $25, still Recorded or Submitted, with no receipt
// on file reads "Missing" on the Sheet, has a Missing receipt quick filter, and is a Receipt item in
// the Action Center (unless the 45-day Concur item already names it).

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'test-anon-key'

const C = await import('../src/lib/budget/receiptChecks.js')
const Y = await import('../src/lib/home/needsYouModel.js')
const Q = await import('../src/lib/actionCenter/queueModel.js')
const E = await import('../lib/server/budget/engine.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')
const TODAY = '2026-09-27'

test('the rule: Personal (Concur), over $25, Recorded or Submitted, no receipt on file', () => {
  const base = { payment_method: 'personal_concur', status: 'recorded', amount: 67.5, receipt_file_id: null }
  assert.equal(C.needsReceipt(base), true)
  assert.equal(C.needsReceipt({ ...base, status: 'submitted' }), true)
  assert.equal(C.needsReceipt({ ...base, amount: 25 }), false, 'exactly $25 does not need one')
  assert.equal(C.needsReceipt({ ...base, amount: 25.01 }), true)
  assert.equal(C.needsReceipt({ ...base, receipt_file_id: 'doc' }), false)
  assert.equal(C.needsReceipt({ ...base, hasReceipt: true }), false, 'the Sheet row shape')
  for (const status of ['reimbursed', 'void']) assert.equal(C.needsReceipt({ ...base, status }), false, status)
  for (const payment_method of ['p_card', 'po_invoice', null]) assert.equal(C.needsReceipt({ ...base, payment_method }), false, String(payment_method))
  assert.equal(C.needsReceipt({ ...base, deleted_at: '2026-09-01' }), false)
  assert.equal(C.RECEIPT_REQUIRED_OVER, 25)
})

test('the server lists them oldest first, on Postgres', async () => {
  const pg = new PGlite()
  await pg.exec(read('test/fixtures/budgetReceiptsPrelude.sql'))
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('Jester Lloyd Bautista', 'j@x.org', 'owner', true) RETURNING *`)
  for (const m of ['20261009000000_program_budget_phase_a', '20261010000000_budget_subscription_approval', '20261011000000_budget_subscription_cells', '20261012000000_budget_expense_zero_quantity', '20261013000000_budget_receipts'])
    await pg.exec(runnable(read(`supabase/migrations/${m}.sql`)))
  await pg.exec(runnable(read('db/migrations/seed_program_budget_fy26.sql')))
  const db = pgliteRest(pg)
  await E.startYear(db, owner, { fy: 2027, total: 40000, cost_center: 'Nursing Education', plan: 'none', today: TODAY })
  const add = (fields) => E.createExpense(db, owner, { fields: { payment_method: 'personal_concur', ...fields }, today: TODAY })
  await add({ expense_date: '2026-09-18', item: 'Printer ink', vendor: 'Staples', amount: 67.5 })
  await add({ expense_date: '2026-08-02', item: 'Tote bags', vendor: 'Amazon', amount: 400 })
  await add({ expense_date: '2026-09-20', item: 'Pens', vendor: 'Target', amount: 12.4 })
  await add({ expense_date: '2026-09-21', item: 'Lanyards', amount: 72.3, payment_method: 'p_card' })
  const filed = await add({ expense_date: '2026-09-22', item: 'Paper', amount: 41 })
  await pg.query(`UPDATE budget_expenses SET receipt_file_id = gen_random_uuid() WHERE id = $1`, [filed.id])
  assert.deepEqual((await E.missingReceiptQueue(db)).map(m => [m.item, m.amount, m.statusLabel]), [['Tote bags', 400, 'Recorded'], ['Printer ink', 67.5, 'Recorded']])
})

test('the Action Center lists them as Receipt, and not twice beside the Concur reminder', () => {
  const now = Date.parse('2026-09-27T19:00:00Z')
  const missing = [
    { id: 'a', item: 'Tote bags', vendor: 'Amazon', amount: 400, date: '2026-08-02', statusLabel: 'Recorded' },
    { id: 'b', item: 'Printer ink', vendor: 'Staples', amount: 67.5, date: '2026-09-18', statusLabel: 'Submitted' },
  ]
  const concur = [{ id: 'a', item: 'Tote bags', vendor: 'Amazon', amount: 400, deadline: '2026-10-01', daysLeft: 4, hasReceipt: false }]
  const g = Y.budgetGroup({ missing, concur, now })
  assert.deepEqual(g.rows.map(r => r.id), ['concur:a', 'missing:b'], 'a Concur row already names its missing receipt')
  const row = g.rows.find(r => r.id === 'missing:b')
  assert.deepEqual([row.chip, row.title, row.meta, row.pill, row.to], ['Receipt', 'Printer ink · $67.50', 'Personal (Concur) · Submitted · Sep 18, 2026 · a receipt is required over $25', { text: 'No receipt', tone: 'amber' }, '/settings/budget?tab=sheet&filter=missing-receipt'])
  assert.equal(g.sub, 'Concur to submit, receipts missing')
  const alone = Y.budgetGroup({ missing, now })
  assert.equal(alone.open.to, '/settings/budget?tab=sheet&filter=missing-receipt')
  const items = Q.normalizeHomeQueue({ groups: [alone], now })
  assert.deepEqual(items.map(i => [i.chip, i.ageLabel, i.personal]), [['Receipt', 'No receipt', true], ['Receipt', 'No receipt', true]])
  assert.deepEqual(Q.chipCounts(items), [{ chip: 'Receipt', count: 2 }])
})

let vite, Sheet
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
  Sheet = (await vite.ssrLoadModule('/src/components/sheet/EditableSheet.jsx')).default
})
after(async () => { await vite?.close() })

test('a quick filter is a chip with its count, and when on it shows only its rows', () => {
  const rows = [
    { id: 'r1', cells: { item: 'Ink' }, format: {}, need: true },
    { id: 'r2', cells: { item: 'Pens' }, format: {}, need: false },
    { id: 'r3', cells: { item: 'Totes' }, format: {}, need: true },
  ]
  const html = (props = {}) => renderToStaticMarkup(React.createElement(Sheet, {
    initialRows: rows, initialLayout: { order: [], hidden: [], widths: {}, frozen: 0, groupBy: null, staffColumns: [], colFormats: {}, summaries: {} },
    lead: { key: '@n', label: 'Name' }, columns: [{ key: 'item', label: 'Item', type: 'text' }], editable: true,
    valueOf: (r, k) => r.cells[k], shownOf: (r, k) => r.cells[k] ?? '', defaultSort: { key: 'item', dir: 'asc' }, labels: {},
    quickFilters: [{ key: 'missing-receipt', label: 'Missing receipt', test: (r) => r.need }], ...props,
  }))
  const off = html()
  assert.match(off, /class="fm-btn fm-sm fs-quick" aria-pressed="false">Missing receipt<span class="fs-quick-n">2<\/span><\/button>/)
  assert.equal((off.match(/data-cell="r\d\|item"/g) || []).length, 3)
  const on = html({ initialQuick: 'missing-receipt' })
  assert.match(on, /fs-quick fs-quick-on" aria-pressed="true"/)
  assert.deepEqual(on.match(/data-cell="(r\d)\|item"/g), ['data-cell="r1|item"', 'data-cell="r3|item"'])
  assert.doesNotMatch(html({ quickFilters: [{ key: 'x', label: 'Nothing', test: () => false }] }), /Nothing/, 'no chip while no row passes')
})

test('the budget Sheet wears it: Missing in the Receipt cell, the filter, and the Action Center deep link', () => {
  const sheet = read('src/components/budget/BudgetSheet.jsx')
  // BUDGET-V2 item 12 (2026-09-29): every posted row with no receipt reads Missing, so the filter shows
  // them all; the over-$25 Personal (Concur) rows keep their reimbursement wording in the cell.
  assert.match(sheet, /const MISSING_FILTER = \[\{ key: 'missing-receipt', label: 'Missing receipt', test: \(r\) => missingReceipt\(r\.raw\) \}\]/)
  // BUDGET-CONCUR-1 changed this: Missing sits beside the Upload link, in one cell.
  assert.match(sheet, /if \(needsReceipt\(row\.raw\)\) return <span className="bud-rc-cell"><span className="bud-rc-missing" title="A receipt is required for reimbursement over \$25">Missing<\/span>\{up\}<\/span>/)
  assert.match(sheet, /quickFilters=\{MISSING_FILTER\} initialQuick=\{focus\?\.filter \|\| null\}/)
  assert.match(sheet, /return missingReceipt\(row\.raw\) \? <span className="bud-rc-cell"><span className="bud-rc-missing"[^>]*>Missing<\/span>\{up\}<\/span> : \(up \|\| DASH\)/)
  assert.match(read('src/components/budget/ProgramBudgetView.jsx'), /get\('filter'\); return f === 'missing-receipt' \? \{ filter: f, at: 0 \} : null/)
  // BUDGET-LOAD-SPEED-1 changed this: the queue's reads go out together, missing among them.
  assert.match(read('api/budget-staff.js'), /E\.missingReceiptQueue\(db\)/)
})
