// test/editableSheet.test.mjs
//
// BUDGET-SHEET-0a/0b (2026-09-27): the Editable sheet, shared by the Forms Sheet and Program
// Budget's expense ledger (table canon section 1). 0b added what the ledger needs: computed
// columns, per-cell locks, rows the owner adds and deletes, subtotals on group rows, options
// that follow the row, and a workbook of more than one worksheet. Every one is opt-in, so a
// host that passes none (the Forms Sheet) renders exactly as before; the last test holds that.
//
// Rendered with Vite's ssrLoadModule and react-dom/server, like homePageRender. No .env needed.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'test-anon-key'

let vite, EditableSheet
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
  EditableSheet = (await vite.ssrLoadModule('/src/components/sheet/EditableSheet.jsx')).default
})
after(async () => { await vite?.close() })

const { xlsxBook, xlsxFor } = await import('../lib/server/sheet/xlsx.js')
const formsXlsx = await import('../lib/server/forms/xlsx.js')

const unzip = (buf) => {
  const out = {}
  let i = 0
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const m = buf.readUInt16LE(i + 8), cs = buf.readUInt32LE(i + 18), nl = buf.readUInt16LE(i + 26), xl = buf.readUInt16LE(i + 28)
    const name = buf.slice(i + 30, i + 30 + nl).toString()
    const d = buf.slice(i + 30 + nl + xl, i + 30 + nl + xl + cs)
    out[name] = (m === 8 ? inflateRawSync(d) : d).toString()
    i += 30 + nl + xl + cs
  }
  return out
}

// A ledger-shaped host: Item leads, Spent and Qty are the host's, Unit cost is computed.
const ROWS = [
  { id: 'e1', cells: { cat: 'Supplies & Materials', qty: '40', spent: '400', pay: 'P-card', status: 'Paid' }, format: {}, closed: true },
  { id: 'e2', cells: { cat: 'Supplies & Materials', qty: '2', spent: '25', pay: 'Personal (Concur)', status: 'Recorded' }, format: {}, closed: false },
  { id: 'e3', cells: { cat: 'Printing & Copying', qty: '1', spent: '67.5', pay: '', status: 'Recorded' }, format: {}, closed: false },
]
ROWS.forEach((r, i) => { r.item = ['Tote Bags', 'Pens', 'Printer Ink'][i] })
const num = (v) => (v === '' || v == null ? null : Number(v))
const COLUMNS = [
  { key: 'cat', label: 'Category', type: 'choice', options: ['Supplies & Materials', 'Printing & Copying'] },
  { key: 'qty', label: 'Qty', type: 'number' },
  { key: 'unit', label: 'Unit cost', type: 'number', compute: (r) => { const q = num(r.cells.qty), s = num(r.cells.spent); return q && s != null ? Math.round((s / q) * 100) / 100 : null } },
  { key: 'spent', label: 'Spent ($)', type: 'number' },
  { key: 'pay', label: 'Payment', type: 'choice', options: ['P-card', 'Personal (Concur)'] },
  { key: 'status', label: 'Status', type: 'choice', options: ['Paid', 'Recorded', 'Submitted', 'Reimbursed', 'Void'], optionsFor: (r) => (r.cells.pay === 'P-card' ? ['Paid', 'Void'] : ['Recorded', 'Submitted', 'Reimbursed', 'Void']) },
]
const LAYOUT = { order: [], hidden: [], widths: {}, frozen: 0, groupBy: null, staffColumns: [], colFormats: { unit: { num: 'currency' }, spent: { num: 'currency' } }, summaries: { spent: 'sum' } }
const base = (over = {}) => ({
  initialRows: ROWS, initialLayout: LAYOUT, lead: { key: '@item', label: 'Item' }, columns: COLUMNS, editable: true,
  valueOf: (r, k) => (k === '@item' ? r.item : r.cells[k]), shownOf: (r, k) => (k === '@item' ? r.item : (r.cells[k] || '')),
  plainKeys: new Set(['@item']), defaultSort: { key: '@item', dir: 'asc' }, defaultFilterKey: 'cat',
  saveLayout: async () => {}, saveCells: async () => {}, canEditColumn: () => true, commitEdit: async () => {},
  labels: { count: (n) => `${n} expenses` },
  ...over,
})
const html = (props) => renderToStaticMarkup(React.createElement(EditableSheet, props))

test('a computed column shows its value in the column format, and is read-only', () => {
  const out = html(base())
  assert.match(out, /data-cell="e2\|unit"[^>]*class="[^"]*fs-computed[^"]*"[^>]*>\$12\.50</, 'Unit cost = Spent / Qty, formatted as currency')
  assert.match(out, /data-cell="e1\|unit"[^>]*>\$10\.00</)
  assert.match(out, /data-cell="e3\|unit"[^>]*>\$67\.50</)
})

test('the Sigma row sums the host column over the rows shown', () => {
  assert.match(html(base()), /<b>\$492\.50<\/b>/, '400 + 25 + 67.50')
})

test('a locked cell says so, and only where the host locks it', () => {
  const out = html(base({ isLocked: (r, c) => r.closed && ['qty', 'spent'].includes(c.key) }))
  assert.match(out, /data-cell="e1\|spent"[^>]*class="[^"]*fs-locked/)
  assert.doesNotMatch(out, /data-cell="e2\|spent"[^>]*class="[^"]*fs-locked/)
  assert.doesNotMatch(out, /data-cell="e1\|pay"[^>]*class="[^"]*fs-locked/, 'Payment stays editable on a closed year')
  assert.doesNotMatch(html(base({ editable: false, isLocked: () => true })), /fs-locked/, 'a view-only sheet marks nothing: everything is locked')
})

test('a group row carries a subtotal per requested column, in its format', () => {
  const out = html(base({ initialLayout: { ...LAYOUT, groupBy: 'cat' }, groupSubtotals: ['spent'] }))
  assert.match(out, /<b>Supplies &amp; Materials<\/b><span>2<\/span><span class="fs-groupsum">Spent \(\$\) <b>\$425\.00<\/b><\/span>/)
  assert.match(out, /<b>Printing &amp; Copying<\/b><span>1<\/span><span class="fs-groupsum">Spent \(\$\) <b>\$67\.50<\/b><\/span>/)
})

test('rows can be added and deleted only when the host allows it, and delete waits for a row selection', () => {
  const out = html(base({ onAddRow: async () => null, onDeleteRows: async () => {} }))
  assert.match(out, /<\/svg> Row<\/button>/)
  assert.match(out, /<button type="button" class="fm-btn fm-sm" disabled="" title="Select rows by their numbers first"><svg[^]*?<\/svg> Delete row<\/button>/, 'nothing selected, so Delete is off, and says why')
  assert.doesNotMatch(html(base({ onAddRow: async () => null, editable: false })), /<button type="button" class="fm-btn fm-sm"><svg[^>]*>.*?<\/svg> Row/, 'a view-only sheet cannot add rows')
})

test('without the 0b props the grid draws none of them (the Forms Sheet case)', () => {
  const out = html(base({ columns: COLUMNS.map(({ compute, optionsFor, ...c }) => c).filter(c => c.key !== 'unit'), initialLayout: { ...LAYOUT, groupBy: 'cat' } }))
  for (const mark of ['fs-computed', 'fs-locked', 'fs-groupsum', 'Delete row', '</svg> Row</button>']) assert.ok(!out.includes(mark), mark)
})

test('the Forms Sheet passes none of the ledger props', () => {
  const src = readFileSync(new URL('../src/components/forms/FormSheet.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /isLocked|groupSubtotals|onAddRow|onDeleteRows|canDeleteRow|compute:|optionsFor/)
})

test('a workbook can hold several worksheets, each with its own filter', () => {
  const files = unzip(xlsxBook([
    { sheetName: 'Expense Report', header: ['Item', 'Spent ($)'], rows: [['Pens', { n: 25 }], ['Ink', { n: 67.5 }]] },
    { sheetName: 'Annual Budget Tracker', header: ['Category', 'Jul'], rows: [['Supplies', { n: 425 }]] },
  ]))
  assert.ok(files['xl/worksheets/sheet1.xml'] && files['xl/worksheets/sheet2.xml'])
  assert.match(files['xl/workbook.xml'], /<sheet name="Expense Report" sheetId="1" r:id="rId1"\/><sheet name="Annual Budget Tracker" sheetId="2" r:id="rId2"\/>/)
  assert.match(files['xl/workbook.xml'], /localSheetId="0"[^>]*>'Expense Report'!\$A\$1:\$B\$3</)
  assert.match(files['xl/workbook.xml'], /localSheetId="1"[^>]*>'Annual Budget Tracker'!\$A\$1:\$B\$2</)
  assert.match(files['xl/_rels/workbook.xml.rels'], /Id="rId3"[^>]*Target="styles\.xml"/)
  assert.match(files['[Content_Types].xml'], /sheet2\.xml/)
})

test('a group row can carry subtotals as real numbers in their format', () => {
  const xml = unzip(xlsxFor({ header: ['Item', 'Spent ($)'], rows: [{ group: 'Supplies', count: 2, subtotals: { 1: { n: 425, f: { nf: '"$"#,##0.00' } } } }, ['Tote Bags', { n: 400 }], ['Pens', { n: 25 }]] }))
  assert.match(xml['xl/worksheets/sheet1.xml'], /<c r="B2" s="\d+"><v>425<\/v><\/c>/)
  assert.match(xml['xl/styles.xml'], /formatCode="&quot;\$&quot;#,##0\.00"/)
})

test('the forms writer is the shared writer', () => {
  assert.equal(formsXlsx.xlsxFor, xlsxFor)
  assert.equal(formsXlsx.xlsxBook, xlsxBook)
})

// SHEET-MENU-1 (Owner, 2026-09-27: "right clicking ... actions just like in smartsheet or excel").
// The menu is behaviour a server render cannot click, so the wiring is pinned in the source; a
// browser harness drove it on all three sheets when it shipped.
test('a right-click opens the sheet menu on a cell, a row number or a column header', () => {
  const src = readFileSync(new URL('../src/components/sheet/EditableSheet.jsx', import.meta.url), 'utf8')
  assert.match(src, /onContextMenu=\{e => openMenu\(e, 'col', 0, ci\)\}/)
  assert.match(src, /onContextMenu=\{e => openMenu\(e, 'row', r, 0\)\}/)
  assert.match(src, /onContextMenu=\{e => \{ if \(!isEditing\) openMenu\(e, 'cell', r, c\) \}\}/)
  assert.match(src, /e\.key === 'ContextMenu' \|\| \(e\.shiftKey && e\.key === 'F10'\)/, 'the Menu key and Shift+F10 open it from the keyboard')
  assert.match(src, /role="menu" aria-label="Sheet actions"/)
  assert.match(src, /role="menuitem"/)
  for (const label of ['Edit cell', 'Copy', 'Paste', 'Clear contents', 'Clear formatting', 'Insert row', 'Sort A to Z', 'Sort Z to A', 'Group by this column', 'Freeze through this column', 'Hide column', 'Delete column']) {
    assert.ok(src.includes(`'${label}'`), label)
  }
  assert.match(src, /onPaste=\{e =>/, 'Cmd/Ctrl+V pastes a block from the native paste event')
  assert.match(src, /if \(e\.button === 2 \|\| isEditing/, 'a right-click inside the selection keeps it')
})

test('Clear contents never touches a submitted form answer', () => {
  const forms = readFileSync(new URL('../src/components/forms/FormSheet.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(forms, /canClear/, 'the Forms Sheet clears its staff columns only')
  const budget = readFileSync(new URL('../src/components/budget/BudgetSheet.jsx', import.meta.url), 'utf8')
  // BUDGET-V2 item 4 (2026-09-29): Tag is an optional choice, so it clears too.
  assert.match(budget, /const CLEARABLE = new Set\(\['description', 'vendor', 'order_number', 'cost_center', 'notes', 'cat', 'pay', 'cohort', 'tag'\]\)/, 'never a date, an amount or a status')
})

test('a row menu offers row actions only, and the menu keeps the rest of the grid', () => {
  const html = renderToStaticMarkup(React.createElement(EditableSheet, base({ onAddRow: async () => null, onDeleteRows: async () => {} })))
  assert.doesNotMatch(html, /fs-menu/, 'nothing is open until a right-click')
  const src = readFileSync(new URL('../src/components/sheet/EditableSheet.jsx', import.meta.url), 'utf8')
  assert.match(src, /if \(col && ctx\.kind !== 'row'\)/)
})

// SHEET-DRAG-1 (Owner, 2026-09-27: "drag to highlight multiple cells").
test('a press and drag across cells or row numbers selects the range', () => {
  const src = readFileSync(new URL('../src/components/sheet/EditableSheet.jsx', import.meta.url), 'utf8')
  assert.match(src, /onMouseEnter=\{\(\) => \{ if \(dragRef\.current\?\.kind === 'cell'\) setSel/)
  assert.match(src, /onMouseEnter=\{\(\) => \{ if \(dragRef\.current\?\.kind === 'row'\) selectRows\(r, true\) \}\}/)
  assert.match(src, /document\.addEventListener\('mouseup', end\)/, 'letting go anywhere ends the drag')
  const css = readFileSync(new URL('../src/components/forms/forms.css', import.meta.url), 'utf8')
  assert.match(css, /\.fs-frame\.fs-dragging, \.fs-frame\.fs-dragging \* \{ user-select: none;/)
  assert.match(readFileSync(new URL('../src/components/budget/BudgetSubscriptions.jsx', import.meta.url), 'utf8'), /saveCells=\{async \(updates\) => \{ await onWrite\.call\('sheet_cells', \{ updates, sheet: 'subscriptions' \}\); onWrite\.changed\(\) \}\}/, 'the Subscriptions sheet saves its cells')
})

