// src/components/budget/BudgetSheet.jsx
//
// PROGRAM-BUDGET A7: the expense ledger, on the shared Editable sheet (table canon section 1:
// the owner keeps these records by hand, so it is a spreadsheet, not a DataSheet). Columns in
// the prompt's order: Date, Item (frozen), Category, Brief description, Vendor, Order or
// invoice no., Payment, Qty, Unit cost, Spent ($), Status, Receipt, Cohort, Cost center, Notes,
// plus a hidden Month column so Group by can offer it.
//
// Category, Payment, Status and Cohort edit through selects, and Status offers only what the
// row's payment method allows. Unit cost is computed. Receipt is set by the system (Phase B).
// A closed year locks Date, Item, Category, Description, Vendor, Order no., Qty, Spent and Cost
// center; Payment, Status, Cohort and Notes stay editable so the owner can backfill them.
// Invariants 3, 5 and 6 hold here too: one number per column, status one word in a pill,
// missing an en dash.
import { useMemo } from 'react'
import { Check } from 'lucide-react'
import EditableSheet from '../sheet/EditableSheet'
import { Pill } from '../shared/DataSheet'
import { PAYMENT_METHODS, STATUSES, statusesFor, statusLabel, statusTone, paymentKey, statusKey, dateText, monthOf, pacificToday, fiscalYearRange } from '../../lib/budget/budgetModel'

const LEAD = { key: '@date', label: 'Date', type: 'date' }
const TONE = { green: 'ok', amber: 'warn', blue: 'info', grey: 'off' }
const LOCKED_WHEN_CLOSED = new Set(['@date', 'item', 'cat', 'description', 'vendor', 'order_number', 'qty', 'amount', 'cost_center'])
const NOT_EDITABLE = new Set(['unit', 'receipt', 'month'])
const GROUPABLE = new Set(['cat', 'month', 'pay', 'status', 'cohort'])
const DASH = <span className="bud-dash">–</span>
const DEFAULT_LAYOUT = {
  order: [], hidden: ['month'], widths: { item: 220, description: 280, cat: 180, order_number: 170 }, frozen: 1, groupBy: null, staffColumns: [],
  colFormats: { amount: { num: 'currency' }, unit: { num: 'currency' } }, summaries: { amount: 'sum', qty: 'sum' },
}

/** One expense as the grid's row: raw fields for editing, display text in `cells`. */
function sheetRow(e, cats, cohorts) {
  return {
    id: e.id, raw: e, format: e.cell_formats || {},
    cells: {
      item: e.item || '', cat: cats.get(e.category_id) || '', description: e.description || '', vendor: e.vendor || '',
      order_number: e.order_number || '', pay: e.paymentLabel || '', qty: e.quantity == null ? '' : String(e.quantity),
      amount: e.amount == null ? '' : String(e.amount), status: e.statusLabel || '', receipt: e.hasReceipt ? 'On file' : '',
      cohort: cohorts.get(e.cohort_id) || '', cost_center: e.cost_center || '', notes: e.notes || '',
      month: e.expense_date ? `${monthOf(e.expense_date)} ${e.expense_date.slice(0, 4)}` : '',
      ...(e.staff_values || {}),
    },
  }
}

const RAW_KEYS = { qty: 'quantity', amount: 'amount' }
const valueOf = (row, key) => (key === '@date' ? row.raw.expense_date : key in RAW_KEYS ? row.raw[RAW_KEYS[key]] : row.cells[key])
const shownOf = (row, key) => (key === '@date' ? dateText(row.raw.expense_date, row.raw.date_precision) : (row.cells[key] ?? ''))
const searchValues = (r) => [r.raw.item, r.raw.vendor, r.raw.order_number, r.raw.notes]

export default function BudgetSheet({ year, canEdit, onWrite }) {
  const closed = year.state === 'closed'
  const cats = useMemo(() => new Map(year.categories.map(c => [c.id, c.name])), [year.categories])
  const catIds = useMemo(() => new Map(year.categories.map(c => [c.name, c.id])), [year.categories])
  const cohorts = useMemo(() => new Map(year.cohorts.map(c => [c.id, c.name])), [year.cohorts])
  const cohortIds = useMemo(() => new Map(year.cohorts.map(c => [c.name, c.id])), [year.cohorts])
  const rows = useMemo(() => year.expenses.map(e => sheetRow(e, cats, cohorts)), [year.expenses, cats, cohorts])
  const columns = useMemo(() => [
    { key: 'item', label: 'Item', type: 'text' },
    { key: 'cat', label: 'Category', type: 'choice', options: year.categories.map(c => c.name) },
    { key: 'description', label: 'Brief description', type: 'text' },
    { key: 'vendor', label: 'Vendor', type: 'text' },
    { key: 'order_number', label: 'Order or invoice no.', type: 'text' },
    { key: 'pay', label: 'Payment', type: 'choice', options: PAYMENT_METHODS.map(p => p.label) },
    { key: 'qty', label: 'Qty', type: 'number' },
    { key: 'unit', label: 'Unit cost', type: 'number', compute: (r) => r.raw.unitCost },
    { key: 'amount', label: 'Spent ($)', type: 'number' },
    { key: 'status', label: 'Status', type: 'choice', required: true, options: STATUSES.map(s => s.label), optionsFor: (r) => statusesFor(r.raw.payment_method).map(statusLabel) },
    { key: 'receipt', label: 'Receipt', type: 'text' },
    { key: 'cohort', label: 'Cohort', type: 'choice', options: year.cohorts.map(c => c.name) },
    { key: 'cost_center', label: 'Cost center', type: 'text' },
    { key: 'notes', label: 'Notes', type: 'paragraph' },
    { key: 'month', label: 'Month', type: 'text', compute: (r) => r.cells.month },
  ], [year.categories, year.cohorts])
  const ungroupable = useMemo(() => new Set(columns.map(c => c.key).filter(k => !GROUPABLE.has(k))), [columns])

  const editable = canEdit && year.state !== 'not_started'
  // The field an edit writes, and the value it sends.
  const toPatch = (col, draft) => {
    const v = typeof draft === 'string' ? draft.trim() : draft
    switch (col.key) {
      case '@date': return { expense_date: v }
      case 'cat': return { category_id: v ? catIds.get(v) || null : null }
      case 'pay': return { payment_method: v ? paymentKey(v) : null }
      case 'status': return { status: v ? statusKey(v) : null }
      case 'cohort': return { cohort_id: v ? cohortIds.get(v) || null : null }
      case 'qty': return { quantity: v }
      default: return { [col.key]: v }
    }
  }
  // An imported row has no status yet; its editor opens on the method's first choice.
  const draftOf = (row, col) => (col.key === '@date' ? row.raw.expense_date
    : col.key in RAW_KEYS ? String(row.raw[RAW_KEYS[col.key]] ?? '')
      : col.key === 'status' && !row.cells.status ? statusLabel(statusesFor(row.raw.payment_method)[0])
        : row.cells[col.key])
  const commitEdit = async (row, col, editing, { patchRows }) => {
    const out = await onWrite.call('expense_update', { id: row.id, patch: toPatch(col, editing.draft) })
    const next = sheetRow(out.expense, cats, cohorts)
    patchRows(x => (x.id === row.id ? { ...next, format: x.format } : x))
    onWrite.changed()
  }
  const range = fiscalYearRange(year.fy)
  const today = pacificToday()
  const newDate = today >= range.start && today <= range.end ? today : range.start

  return (
    <EditableSheet
      key={year.fy}
      initialRows={rows}
      initialLayout={{ ...DEFAULT_LAYOUT, ...(year.layout || {}) }}
      lead={LEAD}
      columns={columns}
      editable={editable}
      valueOf={valueOf} shownOf={shownOf} searchValues={searchValues} ungroupable={ungroupable}
      defaultSort={{ key: '@date', dir: 'asc' }} defaultFilterKey="cat"
      saveLayout={(layout) => onWrite.call('sheet_layout', { layout })}
      saveCells={(updates) => onWrite.call('sheet_cells', { updates })}
      canEditColumn={(col) => !NOT_EDITABLE.has(col.key)}
      draftOf={draftOf} commitEdit={commitEdit}
      isLocked={(row, col) => closed && LOCKED_WHEN_CLOSED.has(col.key)}
      groupSubtotals={['amount']}
      onAddRow={canEdit && year.state === 'current' ? async () => { const out = await onWrite.call('expense_create', { fields: { expense_date: newDate } }); onWrite.changed(); return sheetRow(out.expense, cats, cohorts) } : undefined}
      onDeleteRows={canEdit && !closed ? async (list) => { await onWrite.call('expense_delete', { ids: list.map(r => r.id) }); onWrite.changed() } : undefined}
      canDeleteRow={() => !closed}
      renderCell={(row, col, text) => {
        if (col.key === 'item') return <>{text || DASH}{row.raw.subscription_id && <span className="bud-subtag">Subscription</span>}</>
        if (col.key === 'status') return row.raw.status ? <Pill tone={TONE[statusTone(row.raw.status)]}>{statusLabel(row.raw.status)}</Pill> : DASH
        if (col.key === 'receipt') return row.raw.hasReceipt ? <span className="bud-rc" title={canEdit ? 'Receipt on file' : 'Receipt on file (the file is not shared)'}><Check size={13} aria-hidden="true" />On file</span> : DASH
        if (col.staff) return undefined
        return text === '' || text == null ? DASH : undefined
      }}
      labels={{
        searchPlaceholder: 'Search items, vendors, order numbers and notes', searchLabel: 'Search the expenses',
        count: (n, total) => (n === total ? `${n} ${n === 1 ? 'expense' : 'expenses'}` : `${n} of ${total}`),
        emptyNote: year.state === 'current' && canEdit ? 'No expenses yet. Add a row, or add receipts once receipt intake arrives.' : 'No expenses in this year.',
        noMatch: 'No expenses match.', frameLabel: `Expenses, ${year.label}. Arrow keys move, Enter edits.`,
        readOnlyEdit: canEdit ? `${year.label} has not started.` : 'This view is read-only.',
        locked: `${year.label} is closed. Only Payment, Status, Cohort and Notes can change.`,
        newColumnHint: 'A column of your own, like Approved by or PO number. Leadership sees it read-only.',
        help: canEdit ? 'Double-click or Enter edits a cell. Unit cost is Spent divided by Qty. Group by Category or Month for the Annual Budget Tracker view; Export to Excel writes both sheets.' : 'Read-only. Use Export to Excel to work with the figures.',
      }}
      notify={onWrite.notify}
    />
  )
}
