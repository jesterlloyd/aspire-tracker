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
// A closed year is as editable as a current one (Owner, 2026-09-27: "allow me to edit it"; the
// prompt's closed-year locks are retired). Every change is logged; readers stay read-only.
// Invariants 3, 5 and 6 hold here too: one number per column, status one word in a pill,
// missing an en dash.
import { useMemo, useRef, useState } from 'react'
import { Check, Upload } from 'lucide-react'
import EditableSheet from '../sheet/EditableSheet'
import { BUDGET_TOOLS, withStage, withConcurColumn } from './budgetSheetTools'
import ReceiptOriginal from './ReceiptOriginal'
import KeithMark from '../keith/KeithMark'
import { Pill } from '../shared/DataSheet'
import { needsReceipt } from '../../lib/budget/receiptChecks'
import { rowPlanStatus, moveLimit } from '../../lib/budget/planModel'
import SurfaceCard from '../ui/SurfaceCard'
import { PAYMENT_METHODS, STAGES, stageOf, stageLabel, stageTone, stageChoices, paymentKey, dateText, monthOf, pacificToday, fiscalYearRange, usd } from '../../lib/budget/budgetModel'

const LEAD = { key: '@date', label: 'Date', type: 'date' }
const TONE = { green: 'ok', amber: 'warn', blue: 'info', grey: 'off' }
const NOT_EDITABLE = new Set(['unit', 'receipt', 'month', 'plan'])
// What Clear contents may empty: text and optional choices, never a date, an amount or a status.
const CLEARABLE = new Set(['description', 'vendor', 'order_number', 'cost_center', 'notes', 'cat', 'pay', 'cohort', 'tag'])
const GROUPABLE = new Set(['cat', 'month', 'pay', 'stage', 'cohort', 'tag'])

const DASH = <span className="bud-dash">–</span>
// BUDGET-V2 item 12: a posted row with no receipt reads Missing (an imported FY26 row, dated only
// to the month, never does). Over $25 on Personal (Concur) it is also a reimbursement requirement.
const missingReceipt = (e) => !e.hasReceipt && e.state !== 'expected' && e.date_precision !== 'month' && e.status !== 'void'
// BUDGET-CONCUR-1 (Owner, 2026-09-30): the Submitted to Concur checkbox is the row's Stage, not a column
// of its own. Ticked means Submitted to Concur or later; ticking sets Submitted, unticking puts it back.
// Only a Personal (Concur) purchase that has posted has one, and a Reimbursed row keeps its tick (its
// Stage takes it back). Keyed concur_done: 'concur' was the retired Concur column, which withStage drops.
const concurDone = (e) => ['submitted', 'reimbursed'].includes(e.status)
const concurApplies = (e) => e.payment_method === 'personal_concur' && e.state !== 'expected' && e.status !== 'void'
const MISSING_FILTER = [{ key: 'missing-receipt', label: 'Missing receipt', test: (r) => missingReceipt(r.raw) }]
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
      amount: e.amount == null ? '' : String(e.amount), stage: stageLabel(stageOf(e)), receipt: e.hasReceipt ? 'On file' : '',
      cohort: cohorts.get(e.cohort_id) || '', cost_center: e.cost_center || '', notes: e.notes || '',
      tag: e.tag === 'platform' ? 'Platform' : '', concur_done: concurDone(e) ? 'Yes' : '',
      month: e.expense_date ? `${monthOf(e.expense_date)} ${e.expense_date.slice(0, 4)}` : '',
      ...(e.staff_values || {}),
    },
  }
}

const RAW_KEYS = { qty: 'quantity', amount: 'amount' }
const valueOf = (row, key) => (key === '@date' ? row.raw.expense_date : key in RAW_KEYS ? row.raw[RAW_KEYS[key]] : row.cells[key])
const shownOf = (row, key) => (key === '@date' ? dateText(row.raw.expense_date, row.raw.date_precision) : (row.cells[key] ?? ''))
const searchValues = (r) => [r.raw.item, r.raw.vendor, r.raw.order_number, r.raw.notes]

export default function BudgetSheet({ year, canEdit, onWrite, focus = null, receiptCount = 0, onGo = null, onUpload = null }) {
  const uploadRef = useRef(null)
  const [original, setOriginal] = useState(null)   // Phase B: the filed receipt, opened from its row
  const openReceipt = async (row) => {
    setOriginal({ slip: { file_name: row.raw.item || 'Receipt' }, loading: true })
    try { setOriginal({ slip: { file_name: row.raw.item || 'Receipt' }, ...(await onWrite.call('expense_receipt', { expense_id: row.id })) }) } catch (e) { setOriginal(null); onWrite.notify(e.message, 'err') }
  }
  const cats = useMemo(() => new Map(year.categories.map(c => [c.id, c.name])), [year.categories])
  const catIds = useMemo(() => new Map(year.categories.map(c => [c.name, c.id])), [year.categories])
  const cohorts = useMemo(() => new Map(year.cohorts.map(c => [c.id, c.name])), [year.cohorts])
  const cohortIds = useMemo(() => new Map(year.cohorts.map(c => [c.name, c.id])), [year.cohorts])
  // BUDGET-V2 item 12: Expected charges sit below the sheet, not counted as spent yet.
  const rows = useMemo(() => year.expenses.filter(e => e.state !== 'expected').map(e => sheetRow(e, cats, cohorts)), [year.expenses, cats, cohorts])
  const expectedRows = useMemo(() => year.expenses.filter(e => e.state === 'expected').map(e => sheetRow(e, cats, cohorts)), [year.expenses, cats, cohorts])
  // BUDGET-V2 item 13: a closed month's rows are locked until it is reopened on the Summary.
  const closedMonths = useMemo(() => new Set((year.close?.months || []).filter(m => m.closed_at).map(m => m.key)), [year.close])
  const inClosed = (row) => closedMonths.has(String(row.raw.expense_date || '').slice(0, 7))
  // BUDGET-V2 item 16: each posted row's place in the approved plan, and the two paths when it is over.
  const live = year.plan?.live || null
  const planMaps = useMemo(() => (live ? {
    effective: new Map(Object.entries(live.effective)), approved: new Map(Object.entries(live.approved)),
  } : null), [live])
  const planRows = useMemo(() => rowPlanStatus(year.expenses, planMaps, { pending: new Set((year.plan?.amendments || []).filter(a => a.status === 'pending' && a.expense_id).map(a => a.expense_id)) }), [year.expenses, planMaps, year.plan])
  const [fix, setFix] = useState(null)   // { row, over }
  const columns = useMemo(() => [
    { key: 'item', label: 'Item', type: 'text' },
    { key: 'cat', label: 'Category', type: 'choice', options: year.categories.map(c => c.name) },
    { key: 'description', label: 'Brief description', type: 'text' },
    { key: 'vendor', label: 'Vendor', type: 'text' },
    { key: 'order_number', label: 'Order or invoice no.', type: 'text' },
    { key: 'pay', label: 'Payment', type: 'choice', options: PAYMENT_METHODS.map(p => p.label) },
    { key: 'qty', label: 'Qty', type: 'number' },
    { key: 'unit', label: 'Unit cost', type: 'number', compute: (r) => r.raw.unitCost, note: 'Unit cost is worked out: Spent divided by Qty. Change Spent or Qty instead.' },
    { key: 'amount', label: 'Spent ($)', type: 'number' },
    { key: 'stage', label: 'Stage', type: 'choice', required: true, options: STAGES.map(x => x.label), optionsFor: (r) => stageChoices(r.raw).map(c => c.label),
      note: 'Stage follows the row: Expected until the charge’s date, Posted, then Receipt attached once a receipt is filed. Choose Submitted to Concur, Reimbursed or Paid, or Void as it moves on. Only Posted and later count as spent.' },
    { key: 'receipt', label: 'Receipt', type: 'text', note: 'The Receipt column fills in when a receipt is filed for the row. Upload sends one to Receipts to be read.' },
    { key: 'concur_done', label: 'Submitted to Concur', type: 'check', note: 'Tick it when you submit the purchase in Concur. It is the Stage: ticked is Submitted to Concur.' },
    ...(year.tagsEnabled ? [{ key: 'tag', label: 'Tag', type: 'choice', options: ['Platform'] }] : []),
    { key: 'cohort', label: 'Cohort', type: 'choice', options: year.cohorts.map(c => c.name) },
    { key: 'cost_center', label: 'Cost center', type: 'text' },
    { key: 'notes', label: 'Notes', type: 'paragraph' },
    { key: 'month', label: 'Month', type: 'text', compute: (r) => r.cells.month, note: 'Month follows the Date.' },
    ...(live ? [{ key: 'plan', label: 'Plan', type: 'text', compute: (r) => planRows.get(r.id)?.text || '', note: 'Plan compares each row with its category’s approved total. Over it, move money inside your limit or ask Margo.' }] : []),
  ], [year.categories, year.cohorts, year.tagsEnabled, live, planRows])
  const ungroupable = useMemo(() => new Set(columns.map(c => c.key).filter(k => !GROUPABLE.has(k))), [columns])

  const editable = canEdit && year.state !== 'not_started'
  // The field an edit writes, and the value it sends.
  const toPatch = (col, draft, row) => {
    const v = typeof draft === 'string' ? draft.trim() : draft
    switch (col.key) {
      case '@date': return { expense_date: v }
      case 'cat': return { category_id: v ? catIds.get(v) || null : null }
      case 'pay': return { payment_method: v ? paymentKey(v) : null }
      case 'stage': return { status: stageChoices(row.raw).find(c => c.label === v)?.status ?? null }
      case 'concur_done': return { status: v ? 'submitted' : 'recorded' }
      case 'tag': return { tag: v === 'Platform' ? 'platform' : null }
      case 'cohort': return { cohort_id: v ? cohortIds.get(v) || null : null }
      case 'qty': return { quantity: v }
      default: return { [col.key]: v }
    }
  }
  // An imported row has no status yet; its editor opens on the method's first choice.
  const draftOf = (row, col) => (col.key === '@date' ? row.raw.expense_date
    : col.key in RAW_KEYS ? String(row.raw[RAW_KEYS[col.key]] ?? '')
      : row.cells[col.key])
  const commitEdit = async (row, col, editing, { patchRows }) => {
    const out = await onWrite.call('expense_update', { id: row.id, patch: toPatch(col, editing.draft, row) })
    const next = sheetRow({ ...out.expense, keith_provenance_id: row.raw.keith_provenance_id }, cats, cohorts)
    patchRows(x => (x.id === row.id ? { ...next, format: x.format } : x))
    onWrite.changed()
  }
  const range = fiscalYearRange(year.fy)
  const today = pacificToday()
  const newDate = today >= range.start && today <= range.end ? today : range.start

  return (
    <>
    {original && <ReceiptOriginal original={original} onClose={() => setOriginal(null)} />}
    {fix && <PlanFix fix={fix} year={year} maps={planMaps} onWrite={onWrite} onClose={() => setFix(null)} />}
    {/* BUDGET-CONCUR-1: the Receipt cell's Upload; the files go to Receipts > To Review. */}
    {onUpload && <input ref={uploadRef} type="file" accept="image/*,application/pdf,.pdf,.eml,message/rfc822,.heic,.heif" multiple hidden
      onChange={e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) onUpload(f) }} />}
    <EditableSheet
      key={`${year.fy}-${focus?.at || ''}-${rows.length ? 'rows' : 'empty'}`}
      initialSearch={focus?.search || ''}   // RECEIPT-ORGANIZER-1: Filed > Show in Sheet opens the Sheet searched for the receipt
      // MISSING-RECEIPT-1: Personal (Concur) over $25 with no receipt on file (policy p.2).
      quickFilters={MISSING_FILTER} initialQuick={focus?.filter || null}
      initialRows={rows}
      initialLayout={withConcurColumn(withStage({ ...DEFAULT_LAYOUT, ...(year.layout || {}) }))}
      lead={LEAD}
      columns={columns}
      editable={editable}
      valueOf={valueOf} shownOf={shownOf} searchValues={searchValues} ungroupable={ungroupable}
      defaultSort={{ key: '@date', dir: 'asc' }} defaultFilterKey="cat"
      // A saved format or layout refreshes the page's copy of the year, so leaving the tab and coming
      // back shows it (SUB-CELLS-1: the owner's formats seemed not to stick).
      saveLayout={async (layout) => { await onWrite.call('sheet_layout', { layout }); onWrite.changed() }}
      saveCells={async (updates) => { await onWrite.call('sheet_cells', { updates }); onWrite.changed() }}
      canEditColumn={(col) => !NOT_EDITABLE.has(col.key)}
      canClear={(col) => CLEARABLE.has(col.key)}
      draftOf={draftOf} commitEdit={commitEdit}
      groupSubtotals={['amount']}
      // BUDGET-V2: a Void row stays visible, struck through, and counts nowhere, the Σ row included.
      countsInTotals={(r) => r.raw.status !== 'void'}
      tools={BUDGET_TOOLS}
      emptyState={<>
        <b>No {year.label} expenses yet</b>
        <span>{canEdit && receiptCount ? `${receiptCount} ${receiptCount === 1 ? 'receipt is' : 'receipts are'} waiting in Receipts. Accepting one adds its row here. ` : ''}{editable ? 'You can also add a row by hand.' : ''}</span>
        {editable && <span className="bud-empty-acts">
          {receiptCount > 0 && onGo && <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" onClick={() => onGo('receipts')}>Review receipts</button>}
          <button type="button" className="bud-btn bud-btn-sm" onClick={async () => { try { await onWrite.call('expense_create', { fields: { expense_date: newDate } }); onWrite.changed() } catch (e) { onWrite.notify(e.message, 'err') } }}>+ Add a row</button>
        </span>}
      </>}
      tail={{ label: 'Expected · not counted as spent yet', rows: expectedRows, summary: `${expectedRows.length} ${expectedRows.length === 1 ? 'charge' : 'charges'} · ${usd(expectedRows.reduce((a, r) => a + (Number(r.raw.amount) || 0), 0))}` }}
      isLocked={(row, col) => inClosed(row) || (col.key === 'stage' && row.raw.state === 'expected') || (col.key === 'concur_done' && (!concurApplies(row.raw) || row.raw.status === 'reimbursed'))}
      cellClass={(r) => (r.raw.status === 'void' ? 'bud-void' : undefined)}
      formulas
      onAddRow={canEdit && year.state !== 'not_started' ? async () => { const out = await onWrite.call('expense_create', { fields: { expense_date: newDate } }); onWrite.changed(); return sheetRow(out.expense, cats, cohorts) } : undefined}
      onDeleteRows={canEdit ? async (list) => { await onWrite.call('expense_delete', { ids: list.map(r => r.id) }); onWrite.changed() } : undefined}
      renderCell={(row, col, text) => {
        // KEITH-FOUNDATION-1: a row a receipt created carries the Keith mark after its item, in the state
        // it had at accept. The server sends the provenance id to the Owner only.
        if (col.key === 'item') return <>{text || DASH}{row.raw.subscription_id && <span className="bud-subtag">Subscription</span>}{canEdit && row.raw.keith_provenance_id && <span className="bud-keith"><KeithMark provenanceId={row.raw.keith_provenance_id} /></span>}</>
        if (col.key === 'stage') { const st = stageOf(row.raw); return <Pill tone={TONE[stageTone(st)]}>{stageLabel(st)}</Pill> }
        if (col.key === 'plan') {
          const st = planRows.get(row.id)
          if (!st) return DASH
          if (st.key === 'within') return <Pill tone="ok">Within</Pill>
          if (st.key === 'pending') return <Pill tone="info">Waiting for Margo</Pill>
          return canEdit && st.key === 'over'
            ? <button type="button" className="bud-rc bud-rc-open bud-plan-over" onClick={() => setFix({ row, over: st.over })}>{st.text}</button>
            : <Pill tone="warn">{st.text}</Pill>
        }
        if (col.key === 'tag') return row.raw.tag === 'platform' ? <span className="bud-tag">Platform</span> : DASH
        if (col.key === 'concur_done') return concurApplies(row.raw) ? undefined : DASH
        if (col.key === 'receipt') {
          if (row.raw.state === 'expected') return DASH
          if (!row.raw.hasReceipt) {
            // BUDGET-CONCUR-1: Upload sends the file to Receipts > To Review, where Keith reads and matches it.
            const up = onUpload && canEdit ? <button type="button" className="bud-rc-up" onMouseDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); uploadRef.current?.click() }}><Upload size={12} aria-hidden="true" />Upload</button> : null
            if (needsReceipt(row.raw)) return <span className="bud-rc-cell"><span className="bud-rc-missing" title="A receipt is required for reimbursement over $25">Missing</span>{up}</span>
            return missingReceipt(row.raw) ? <span className="bud-rc-cell"><span className="bud-rc-missing" title={row.raw.notes ? `No receipt. Note: ${row.raw.notes}` : 'No receipt on file yet. Upload one, or add a note.'}>Missing</span>{up}</span> : (up || DASH)
          }
          // The Owner opens the filed original; everyone else learns only that one is on file (decision 5).
          return canEdit
            ? <button type="button" className="bud-rc bud-rc-open" title="View the original receipt" onClick={() => openReceipt(row)}><Check size={13} aria-hidden="true" />On file</button>
            : <span className="bud-rc" title="Receipt on file (the file is not shared)"><Check size={13} aria-hidden="true" />On file</span>
        }
        if (col.staff) return undefined
        return text === '' || text == null ? DASH : undefined
      }}
      labels={{
        searchPlaceholder: 'Search items, vendors, order numbers and notes', searchLabel: 'Search the expenses',
        count: (n, total) => (n === total ? `${n} ${n === 1 ? 'expense' : 'expenses'}` : `${n} of ${total}`),
        emptyNote: 'No expenses in this year.',
        noMatch: 'No expenses match.', frameLabel: `Expenses, ${year.label}. Arrow keys move, Enter edits.`,
        readOnlyEdit: canEdit ? `${year.label} has not started.` : 'This view is read-only.',
        locked: (row, col) => (inClosed(row) ? 'This row’s month is closed. Reopen it on the Summary to change its rows.' : col.key === 'stage' ? 'An Expected charge becomes Posted on its date.'
          : col.key === 'concur_done' ? (row.raw.status === 'reimbursed' ? 'Reimbursed. Change its Stage to take that back.' : 'Only a Personal (Concur) purchase that has posted goes to Concur.') : ''),
        newColumnHint: 'A column of your own, like Approved by or PO number. Leadership sees it read-only.',
        help: canEdit ? 'Click a cell and type to change it; Enter or Tab saves, Escape puts it back, and every change saves itself. Qty and Spent take a formula: type = then a calculation, like =[Qty]*12.50. Unit cost is Spent divided by Qty. Group by Category or Month for the Annual Budget Tracker view; Export to Excel writes both sheets.' : 'Read-only. Use Export to Excel to work with the figures.',
      }}
      notify={onWrite.notify}
    />
    </>
  )
}

/**
 * BUDGET-V2 item 16: a posted row over its category's approved total. Move the part that is over from
 * a category with room (inside the agreed limit), or ask Margo to raise the category.
 */
function PlanFix({ fix, year, maps, onWrite, onClose }) {
  const { row, over } = fix
  const cat = row.raw.category_id
  const names = new Map(year.categories.map(c => [c.id, c.name]))
  const spent = new Map(year.summary.byCategory.map(c => [c.id, c.spent]))
  const limit = moveLimit(maps.approved.get(cat) || 0, year.plan.limits)
  const sources = [...maps.effective].filter(([id]) => id !== cat).map(([id, eff]) => ({ id, name: names.get(id) || '', room: Math.round((eff - (spent.get(id) || 0)) * 100) / 100 })).filter(s => s.room >= over).sort((a, b) => b.room - a.room)
  const canMove = over <= limit && sources.length > 0
  const [from, setFrom] = useState(sources[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const go = async (action, payload) => { setBusy(true); if (await onWrite.run(action, { fiscal_year: year.fy, expense_id: row.id, ...payload })) onClose(); setBusy(false) }
  return (
    <div className="bud-fixwrap" role="dialog" aria-modal="true" aria-labelledby="bud-fix-h" onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <SurfaceCard className="bud-card bud-fix">
        <h2 id="bud-fix-h">Outside the Approved Plan</h2>
        <p className="bud-sub">{row.raw.item || 'This row'} ({usd(row.raw.amount)}) takes {names.get(cat) || 'its category'} {usd(over)} over its approved total.</p>
        {canMove ? (
          <div className="bud-plan-paths">
            <span className="bud-hint">Move {usd(over)} from</span>
            <select className="bud-input" aria-label="Move from" value={from} onChange={e => setFrom(e.target.value)} autoFocus>{sources.map(s => <option key={s.id} value={s.id}>{s.name} ({usd(s.room)} left)</option>)}</select>
            <button type="button" className="bud-btn bud-btn-pri bud-btn-sm" disabled={busy} onClick={() => go('plan_move', { from, to: cat, amount: over, reason: `For ${row.raw.item || 'a row'} on ${row.raw.expense_date}.` })}>Move</button>
          </div>
        ) : <p className="bud-hint">{over > limit ? `A move of ${usd(over)} is over your limit of ${usd(limit)} for this category.` : `No category has ${usd(over)} to spare.`}</p>}
        <div className="bud-close-acts">
          <button type="button" className="bud-btn bud-btn-sm" disabled={busy} onClick={() => go('plan_amend', { category_id: cat, amount: over, reason: `For ${row.raw.item || 'a row'} (${usd(row.raw.amount)}) on ${row.raw.expense_date}.` })}>Ask Margo for an amendment</button>
          <button type="button" className="bud-btn bud-btn-txt bud-btn-sm" onClick={onClose}>Cancel</button>
        </div>
      </SurfaceCard>
    </div>
  )
}
