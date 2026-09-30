// src/components/sheet/EditableSheet.jsx
//
// BUDGET-SHEET-0a (2026-09-27): the Editable sheet, lifted out of the Forms Sheet unchanged so
// Program Budget's expense ledger can reuse it (table canon section 1: an Editable sheet is not
// a DataSheet). This file is the grid; a host (src/components/forms/FormSheet.jsx today) loads
// the rows, names its columns and decides what a cell means through the props below. The
// markup, classes and behaviour are the Forms Sheet's own, so forms.css styles both.
//
// FORM-SHEET-1 (2026-09-24, Owner: "monitor the results from an excel like or smartsheet like
// view"): search, filters, sort, show or hide columns. The host's Export to Excel exports
// exactly what the grid shows (EXPORT-ONE-1: the grid hands its view up through `viewRef`).
//
// FORM-SHEET-2 (Owner, 2026-09-24: Smartsheet's controls): a toolbar formats the selection
// (bold, italic, underline, text colour, fill, alignment, wrap), groups rows by a column,
// freezes columns, and adds staff columns. Headers drag to reorder and their edges resize;
// every change saves itself. Double-click (or Enter) edits a cell: a staff column's value, or
// whatever the host allows for its own columns (the Forms Sheet's CORRECTION).
//
// FORM-SHEET-3 (Owner, 2026-09-24: "the grids really look like sheets not tables", and
// Smartsheet's sum, $, decimals and dates): a grid with row numbers and gridlines on every
// cell; clicking a column header or a row number selects the whole column or row; $, %, the
// thousands comma, decimal places and date formats change how numbers and dates LOOK (a whole
// column's format is kept on the column, so rows that arrive later wear it too); a summary row
// under the grid sums, averages, counts, or finds the min or max of each column.
//
// Unlike the DataSheet canon, this grid SCROLLS sideways inside its own frame: a spreadsheet
// that drops columns to fit is not a spreadsheet. The header, the row numbers, the lead column
// and any frozen columns stay put while it scrolls.
//
// Props (the host's side of the contract):
//   initialRows      [{ id, cells: { key: text }, format: { key: format } }], plus anything the
//                    host's own callbacks read. The grid owns them from here (remount to reload).
//   initialLayout    { order, hidden, widths, frozen, groupBy, staffColumns, colFormats, summaries }
//   lead             { key, label, type? }: the first, always-frozen column (the Forms Sheet's Name).
//   columns          [{ key, label, type, options?, base?, earlier? }] after the lead; staff
//                    columns are added from the layout.
//   editable         false makes the whole grid view-only.
//   valueOf(row, key) / shownOf(row, key)   the raw value, and its text before any format.
//   plainKeys        keys whose text never takes a number or date format.
//   searchValues(row)  the host's own fields the search reads, beside every cell.
//   ungroupable      keys offered neither as a group nor as a filter.
//   unsummable       keys with no Σ: a column whose values do not add up (a price that is monthly on
//                    one row and annual on the next). A saved summary on one is ignored.
//   defaultSort, defaultFilterKey
//   saveLayout(layout), saveCells(updates)   updates are [{ rowId, key, value } | { rowId, key, format }].
//   canEditColumn(col)   may a host (non-staff) column be edited?
//   draftOf(row, col), commitEdit(row, col, editing, { patchRows })   a host column's edit.
//   renderCell(row, col, text)   a host's own cell content, or undefined for the grid's.
//   cellClass(row, col), cellTitle(row, col)
//   countsInTotals(row)  false keeps a row out of the Σ row and group subtotals (a Void expense).
//   tools            which toolbar groups show: { text, align, clear, newColumn }, all on by default.
//                    Program Budget keeps number and date formats only (BUDGET-V2 item 9).
//   emptyState       what an empty sheet shows in place of its ten blank rows (a message, the next action).
//   tail             { label, rows } shown read-only below the sheet, under their own heading, and never
//                    in the Σ row, a selection, a group or a sort (Program Budget's Expected charges).
//                    Hidden while a search or filter is on.
//   editorLabel(row, col), editorExtras({ col, row, editing, setEditing, keys }), saveLabel(col)
//   labels           { notice, searchPlaceholder, searchLabel, count(shown, total), emptyNote,
//                      noMatch, frameLabel, help, readOnlyEdit, newColumnHint, locked }
//   notify, viewRef
//   initialSearch    what the search box holds when the grid mounts (Program Budget's Show in Sheet).
//   quickFilters     [{ key, label, test(row) }]: one-click filters the host names (MISSING-RECEIPT-1:
//                    Program Budget's Missing receipt). A chip with its count, shown while any row passes.
//   initialQuick     the quick filter that is on when the grid mounts.
//
// BUDGET-SHEET-0b (2026-09-27), for Program Budget's ledger. Every one is opt-in; a host that
// passes none (the Forms Sheet) gets the grid exactly as it was.
//   column.compute(row)      a computed column (Unit cost = Spent / Qty): read-only, sorts, sums.
//   column.optionsFor(row)   a dropdown whose options depend on the row (Status follows Payment).
//   column.type 'check'      a host checkbox: a click toggles it and saves through commitEdit ('Yes' or '').
//   column.required          a dropdown with no (blank) choice (Status is always one of its options).
//   isLocked(row, col)       a cell that may not be edited (a closed year's Date, Item, Spent...).
//   groupSubtotals           keys summed on every group row, beside its count.
//   onAddRow()               resolves to the new row; the grid appends it.
//   onDeleteRows(rows)       deletes the rows whose numbers are selected; canDeleteRow(row) may refuse one.
//   canClear(col)            may Clear contents empty this host column (staff columns always clear).
//
// SHEET-MENU-1 (Owner, 2026-09-27: "right clicking ... actions just like in smartsheet or excel"):
// a right-click (or the Menu key, or Shift+F10) opens a menu on a cell, a row number or a column
// header: Edit, Copy, Paste (a block pasted from Excel lands across the cells), Clear, the text
// formats, Insert and Delete row where the host allows rows, and Sort, Filter by this value, Group
// by, Freeze through, Hide and Delete column. Cmd/Ctrl+C and Cmd/Ctrl+V do the same from the keyboard.
// Every edit goes through the same path as a double-click edit, so a host's rules still decide.
//
// SHEET-DRAG-1: press and drag across cells (or down the row numbers) to select a range, as in a
// spreadsheet; the toolbar and the menu then act on all of it. A column header still drags to move
// the column, so a range of columns is Shift-click.
//
// SHEET-LIVE-1 (Owner, 2026-09-27: "couldn't it be like a real sheet where I just click the cell,
// change the value ... just like in Microsoft Excel saved to OneDrive where it autosaves?"). A cell
// is edited IN the cell: select it and type (the key replaces the value), or double-click, Enter or
// F2 (the value stays). Enter saves and moves down, Tab saves and moves right, Escape puts it back,
// and clicking away saves. A dropdown saves the moment a choice is picked. Nothing asks to be
// confirmed; every save shows "Saved" where "All changes saved" sits, and a refused one says why
// and puts the cell back. The floating editor with a Save button stays only where a host needs more
// than the value (the Forms Sheet's correction and its reason) or a list of ticks.
//   column.note              why a calculated column cannot be typed in, said when someone tries.
//   formulas                 true lets a number cell take a formula (src/lib/sheet/sheetFormula.js):
//                            "=" then arithmetic, SUM AVERAGE MIN MAX ROUND ABS, and [Column] for a
//                            cell in the same row. The result is saved as the value and the formula is
//                            kept on the cell's format as `fx`, so editing shows the formula again and a
//                            change to a cell it reads works it out again.
// A selection of more than one cell is tinted AND outlined around its edge, as Excel draws a range.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight, ArrowDownUp, Baseline, Bold, Check, ChevronDown, ChevronRight, Eraser, Italic, PaintBucket, Plus, Trash2, Underline, WrapText } from 'lucide-react'
import {
  cellMatches, DATE_FORMATS, displayValue, formatNumber, groupSheetRows, isOtherValue, mergeFormat, otherText, otherValue,
  SHEET_DEFAULT_INK, SHEET_FILLS, SHEET_INKS, SHEET_STAFF_TYPES, summarize, SUMMARY_FNS,
} from '../../lib/sheet/sheetModel'
import { formulaRefs, isFormula, tryFormula, FORMULA_MAX } from '../../lib/sheet/sheetFormula'
import Tooltip from '../ui/Tooltip'

const W_DEFAULT = 160, W_LEAD = 200, W_ROWNUM = 44
const fillHex = Object.fromEntries(SHEET_FILLS.map(f => [f.key, f.hex]))
const inkHex = Object.fromEntries(SHEET_INKS.map(f => [f.key, f.hex]))
const SheetTip = ({ label, children }) => <Tooltip label={label} placement="top">{children}</Tooltip>
const newStaffKey = () => `s_${Math.random().toString(36).slice(2, 10)}`
const NONE = new Set()
const NO_KEYS = []

/** Inline style for a formatted cell. A fill carries its own dark ink, so it reads in dark mode. */
function cellStyle(f, width) {
  const st = { width, maxWidth: width, minWidth: width }
  if (!f) return st
  if (f.b) st.fontWeight = 700
  if (f.i) st.fontStyle = 'italic'
  if (f.u) st.textDecoration = 'underline'
  if (f.fill) { st.background = fillHex[f.fill]; st.color = SHEET_DEFAULT_INK }
  if (f.ink) st.color = inkHex[f.ink]
  if (f.align) st.textAlign = f.align
  if (f.wrap) { st.whiteSpace = 'pre-wrap'; st.overflow = 'visible' }
  return st
}

export default function EditableSheet({
  initialRows, initialLayout, lead, columns: hostColumns, editable = false,
  valueOf, shownOf, plainKeys = NONE, searchValues = () => [], ungroupable = NONE, unsummable = NONE,
  defaultSort, defaultFilterKey,
  saveLayout, saveCells: saveHostCells,
  canEditColumn = () => false, draftOf = () => '', commitEdit: commitHostEdit,
  renderCell, cellClass, cellTitle, editorLabel, editorExtras, saveLabel,
  labels = {}, notify, viewRef,
  isLocked, groupSubtotals = NO_KEYS, onAddRow, onDeleteRows, canDeleteRow = () => true, canClear = () => false,
  formulas = false, initialSearch = '', quickFilters = NO_KEYS, initialQuick = null, countsInTotals = null, tail = null,
  tools = ALL_TOOLS, emptyState = null,
}) {
  const tl = { ...ALL_TOOLS, ...tools }
  const [data, setData] = useState(() => ({ rows: initialRows }))
  const [layout, setLayout] = useState(initialLayout)
  const [search, setSearch] = useState(initialSearch)
  const [quick, setQuick] = useState(initialQuick)
  const [filters, setFilters] = useState([])
  const [adding, setAdding] = useState(null)
  const [sort, setSort] = useState(defaultSort)
  const [menu, setMenu] = useState(null)              // 'columns' | 'ink' | 'fill' | 'newcol'
  const [sel, setSel] = useState(null)                // { anchor, focus, whole?: 'col' | 'row' | 'all' } in visible-grid indexes
  const [editing, setEditing] = useState(null)        // { rowId, key, draft, reason, anchor }
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [save, setSave] = useState('saved')           // saved | saving | error
  const [flash, setFlash] = useState(0)               // SHEET-LIVE-1: bumps on every save, so "Saved" shows for a moment
  const [pending, setPending] = useState(() => new Map())   // 'rowId|key' -> the text being saved, shown until it lands
  const flashTimer = useRef(null)
  const [dragCol, setDragCol] = useState(null)
  const [newCol, setNewCol] = useState({ label: '', type: 'text', options: '' })
  const [ctx, setCtx] = useState(null)                // the right-click menu: { x, y, kind: 'cell' | 'row' | 'col', r, c }
  const frameRef = useRef(null)
  const toolRef = useRef(null)
  const layoutTimer = useRef(null)
  // SHEET-DRAG-1 (Owner, 2026-09-27: "I should be able to drag to highlight multiple cells"): a press
  // on a cell or a row number starts a range; moving over others extends it; letting go ends it.
  const dragRef = useRef(null)
  useEffect(() => {
    const end = () => { if (dragRef.current) { dragRef.current = null; frameRef.current?.classList.remove('fs-dragging') } }
    document.addEventListener('mouseup', end)
    return () => document.removeEventListener('mouseup', end)
  }, [])
  const startDrag = (kind) => { dragRef.current = { kind }; frameRef.current?.classList.add('fs-dragging') }

  // Menus close on a click elsewhere or Escape.
  useEffect(() => {
    if (!menu) return undefined
    const away = (e) => { if (!toolRef.current?.contains(e.target) && !e.target.closest?.('.fs-colmenu')) setMenu(null) }
    const esc = (e) => { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [menu])

  const staffColumns = useMemo(() => layout?.staffColumns || [], [layout])
  const allColumns = useMemo(() => [...hostColumns, ...staffColumns.map(c => ({ ...c, staff: true }))], [hostColumns, staffColumns])
  const columnOf = useCallback((key) => allColumns.find(c => c.key === key), [allColumns])
  // A computed column answers for itself; every other value is the host's.
  const colByKey = useMemo(() => new Map(allColumns.map(c => [c.key, c])), [allColumns])
  const val = useCallback((row, key) => { const c = colByKey.get(key); return c?.compute ? c.compute(row) : valueOf(row, key) }, [colByKey, valueOf])
  const shown = useCallback((row, key) => {
    const c = colByKey.get(key)
    if (!c?.compute) return shownOf(row, key)
    const v = c.compute(row)
    return v == null ? '' : String(v)
  }, [colByKey, shownOf])

  // Order: the saved order first, then any column not in it, in its natural place.
  const ordered = useMemo(() => {
    if (!layout) return allColumns
    const pos = new Map(layout.order.map((k, i) => [k, i]))
    const at = (c) => (pos.has(c.key) ? pos.get(c.key) : 1000 + allColumns.indexOf(c))
    return [...allColumns].sort((a, b) => at(a) - at(b))
  }, [allColumns, layout])
  const hidden = useMemo(() => new Set(layout?.hidden || []), [layout])
  const columns = useMemo(() => ordered.filter(c => !hidden.has(c.key)), [ordered, hidden])
  const width = (key) => layout?.widths?.[key] || (key === lead.key ? W_LEAD : W_DEFAULT)
  const fmtOf = (row, key) => mergeFormat(layout?.colFormats?.[key], row.format?.[key])
  const textOf = (row, key) => (plainKeys.has(key) ? shown(row, key) : displayValue(shown(row, key), fmtOf(row, key)))

  // ── Rows: search, filters, sort ──
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const q = quick ? quickFilters.find(f => f.key === quick) : null
    const out = data.rows.filter(r => {
      if (q && !q.test(r)) return false
      if (needle && ![...searchValues(r), ...Object.values(r.cells)].some(v => String(v || '').toLowerCase().includes(needle))) return false
      return filters.every(f => cellMatches(allColumns.find(c => c.key === f.key), val(r, f.key), f.value))
    })
    const sign = sort.dir === 'asc' ? 1 : -1
    return out.sort((a, b) => {
      const x = val(a, sort.key) ?? '', y = val(b, sort.key) ?? ''
      const bx = x === '', by = y === ''   // blank sorts last either way; a computed 0 is not blank
      if (bx && !by) return 1
      if (!bx && by) return -1
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign   // a real number sorts as one
      return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) * sign
    })
  }, [data, search, filters, sort, allColumns, searchValues, val, quick, quickFilters])
  const groups = useMemo(() => (layout?.groupBy ? groupSheetRows(rows, layout.groupBy, (r, k) => shown(r, k)) : null), [rows, layout, shown])
  const visibleRows = useMemo(() => (groups ? groups.flatMap(g => (collapsed.has(g.label) ? [] : g.rows)) : rows), [groups, rows, collapsed])
  const gridCols = useMemo(() => [{ base: true, ...lead }, ...columns], [lead, columns])   // a host may give its lead a type (the budget's Date)

  // ── Saving ──
  const changeLayout = (fn) => {
    setLayout(l => {
      const next = fn(l)
      if (editable) {
        clearTimeout(layoutTimer.current)
        setSave('saving')
        layoutTimer.current = setTimeout(async () => {
          try { await saveLayout(next); saved() } catch (e) { setSave('error'); notify?.(e.message, 'err') }
        }, 600)
      }
      return next
    })
  }
  const patchRows = (fn) => setData(d => ({ ...d, rows: d.rows.map(fn) }))
  const saved = () => {
    setSave('saved'); setFlash(n => n + 1)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(0), 1800)
  }
  useEffect(() => () => clearTimeout(flashTimer.current), [])
  const saveCells = async (updates) => {
    if (!editable || !updates.length) return
    setSave('saving')
    try { await saveHostCells(updates); saved() } catch (e) { setSave('error'); notify?.(e.message, 'err') }
  }

  // ── Selection: cells, a range, whole columns (header), whole rows (row number), everything (corner) ──
  const lastRow = Math.max(0, visibleRows.length - 1), lastCol = gridCols.length - 1
  const range = useMemo(() => {
    if (!sel) return null
    return { r0: Math.min(sel.anchor.r, sel.focus.r), r1: Math.max(sel.anchor.r, sel.focus.r), c0: Math.min(sel.anchor.c, sel.focus.c), c1: Math.max(sel.anchor.c, sel.focus.c) }
  }, [sel])
  const selectCols = (c, extend) => setSel(s => (extend && s?.whole === 'col' ? { ...s, focus: { r: lastRow, c } } : { anchor: { r: 0, c }, focus: { r: lastRow, c }, whole: 'col' }))
  const selectRows = (r, extend) => setSel(s => (extend && s?.whole === 'row' ? { ...s, focus: { r, c: lastCol } } : { anchor: { r, c: 0 }, focus: { r, c: lastCol }, whole: 'row' }))
  const selectAll = () => setSel({ anchor: { r: 0, c: 0 }, focus: { r: lastRow, c: lastCol }, whole: 'all' })
  const selectedCells = useMemo(() => {
    if (!range) return []
    const out = []
    for (let r = range.r0; r <= range.r1; r++) for (let c = range.c0; c <= range.c1; c++) {
      const row = visibleRows[r], col = gridCols[c]
      if (row && col) out.push({ row, col })
    }
    return out
  }, [range, visibleRows, gridCols])
  const wholeCols = sel && (sel.whole === 'col' || sel.whole === 'all') && range ? gridCols.slice(range.c0, range.c1 + 1) : null
  const isSelected = (r, c) => !!range && r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1
  // SHEET-LIVE-1 (Owner: "highlight AND outline all that's selected"): the range's outer edge is drawn.
  const edgesOf = (r, c) => (!range ? '' : `${r === range.r0 ? ' fs-et' : ''}${r === range.r1 ? ' fs-eb' : ''}${c === range.c0 ? ' fs-el' : ''}${c === range.c1 ? ' fs-er' : ''}`)
  // Like a spreadsheet: the range is tinted and only the active cell carries the ring.
  const isActive = (r, c) => !!sel && !sel.whole && sel.focus.r === r && sel.focus.c === c
  const multi = !!range && (sel.whole || range.r1 > range.r0 || range.c1 > range.c0)
  const firstFormat = wholeCols ? (layout?.colFormats?.[wholeCols[0].key] || {}) : selectedCells[0] ? (fmtOf(selectedCells[0].row, selectedCells[0].col.key) || {}) : {}

  /** Apply a format patch. A whole column keeps it on the column; any other selection on its cells. */
  const applyFormat = (patch) => {
    if (!sel) { notify?.('Select a cell, a column or a row first.'); return }
    const merge = (cur) => {
      const next = patch === null ? (cur?.fx ? { fx: cur.fx } : {}) : { ...(cur || {}), ...patch }   // a formula is content, not formatting
      for (const k of Object.keys(next)) if (next[k] === false || next[k] == null) delete next[k]
      return Object.keys(next).length ? next : null
    }
    if (wholeCols) {
      changeLayout(l => {
        const colFormats = { ...(l.colFormats || {}) }
        for (const c of wholeCols) { const f = merge(colFormats[c.key]); if (f) colFormats[c.key] = f; else delete colFormats[c.key] }
        return { ...l, colFormats }
      })
      if (patch === null) {
        // Clear formatting on a column clears its cells too, as a spreadsheet does.
        const updates = []
        // A cell's formula stays: it is what the cell holds, not how it looks.
        const keep = (f) => (f?.fx ? { fx: f.fx } : null)
        for (const row of data.rows) for (const c of wholeCols) if (row.format?.[c.key]) updates.push({ rowId: row.id, key: c.key, format: keep(row.format[c.key]) })
        const keys = new Set(wholeCols.map(c => c.key))
        patchRows(r => ({ ...r, format: Object.fromEntries(Object.entries(r.format || {}).map(([k, f]) => [k, keys.has(k) ? keep(f) : f]).filter(([, f]) => f)) }))
        saveCells(updates)
      }
      return
    }
    const updates = []
    const changed = new Map()
    for (const { row, col } of selectedCells) {
      const next = merge(row.format?.[col.key])
      if (!changed.has(row.id)) changed.set(row.id, {})
      changed.get(row.id)[col.key] = next || undefined
      updates.push({ rowId: row.id, key: col.key, format: next })
    }
    patchRows(r => (changed.has(r.id) ? { ...r, format: Object.fromEntries(Object.entries({ ...r.format, ...changed.get(r.id) }).filter(([, v]) => v)) } : r))
    saveCells(updates)
  }
  const toggle = (k) => applyFormat({ [k]: !firstFormat[k] })
  const setDecimals = (delta) => {
    const base = Number.isInteger(firstFormat.dec) ? firstFormat.dec : (firstFormat.num === 'currency' ? 2 : 0)
    applyFormat({ dec: Math.max(0, Math.min(4, base + delta)) })
  }

  // ── Editing ── SHEET-LIVE-1: in the cell, saved as soon as it is left.
  const canEdit = (col) => editable && !col.compute && (col.staff || canEditColumn(col))
  const locked = (row, col) => !!isLocked?.(row, col)
  const usesPanel = (col) => col.type === 'checkboxes' || (!col.staff && !!editorExtras)
  const takesFormula = (col) => formulas && col.type === 'number' && !col.compute
  const commitStaff = (row, col, value) => {
    patchRows(r => (r.id === row.id ? { ...r, cells: { ...r.cells, [col.key]: value } } : r))
    saveCells([{ rowId: row.id, key: col.key, value }])
  }
  // The floating editor sits above the page (position: fixed) at its cell, so the grid's scrolling
  // frame never clips it; it follows the cell while the frame scrolls.
  const anchorOf = (rowId, key) => {
    const el = frameRef.current?.querySelector(`[data-cell="${rowId}|${key}"]`)
    const r = el?.getBoundingClientRect()
    return r ? { top: r.top, left: r.left, width: r.width } : null
  }
  const rawOf = (row, col) => (col.staff ? (row.cells[col.key] || '') : draftOf(row, col))
  /** Open a cell. `seed` is a key typed on a selected cell: it replaces the value, as in a spreadsheet. */
  const startEdit = (row, col, seed) => {
    if (!canEdit(col)) {
      if (!editable) { if (!col.base && labels.readOnlyEdit) notify?.(labels.readOnlyEdit) }
      else if (col.note) notify?.(col.note)
      return
    }
    if (locked(row, col)) { const msg = typeof labels.locked === 'function' ? labels.locked(row, col) : labels.locked; if (msg) notify?.(msg); return }
    if (col.staff && col.type === 'check') { commitStaff(row, col, row.cells[col.key] ? '' : 'Yes'); return }
    // BUDGET-CONCUR-1: a host column can be a checkbox too; a click saves through the host at once.
    if (!col.staff && col.type === 'check') { saveHostValue(row, col, row.cells[col.key] ? '' : 'Yes').catch(e => notify?.(e.message, 'err')); return }
    const fx = takesFormula(col) ? row.format?.[col.key]?.fx : null
    const raw = fx || rawOf(row, col)
    const typed = typeof seed === 'string' && !usesPanel(col) && !['date', 'choice', 'dropdown'].includes(col.type)
    setEditing({ rowId: row.id, key: col.key, draft: typed ? seed : (raw ?? (col.type === 'checkboxes' ? [] : '')), original: raw ?? '', reason: '', panel: usesPanel(col), anchor: anchorOf(row.id, col.key) })
  }
  const followEditor = () => { if (editing?.panel) setEditing(e => (e ? { ...e, anchor: anchorOf(e.rowId, e.key) } : e)) }
  const refocus = () => frameRef.current?.focus({ preventScroll: true })
  const moveSel = (dr, dc) => setSel(s => {
    if (!s) return s
    const r = Math.max(0, Math.min(lastRow, s.focus.r + dr)), c = Math.max(0, Math.min(lastCol, s.focus.c + dc))
    return { anchor: { r, c }, focus: { r, c } }
  })
  const pend = (id, text) => setPending(m => { const n = new Map(m); if (text == null) n.delete(id); else n.set(id, text); return n })

  /** Work a formula out against the row. `over` replaces cells the row is about to change. */
  const formulaResult = (row, col, text, over = {}) => {
    const byLabel = new Map(allColumns.map(c => [c.label.toLowerCase(), c]))
    if (formulaRefs(text).some(n => n.toLowerCase() === col.label.toLowerCase())) return { error: `A formula in ${col.label} cannot read ${col.label} itself.` }
    return tryFormula(text, (name) => {
      const c = byLabel.get(String(name).toLowerCase())
      if (!c) return undefined
      return c.key in over ? over[c.key] : val(row, c.key)
    })
  }
  /** Save one host cell through the host, then any formula in the same row that reads it. */
  const saveHostValue = async (row, col, value, fx) => {
    const id = `${row.id}|${col.key}`
    pend(id, String(value))
    try {
      await commitHostEdit(row, col, { rowId: row.id, key: col.key, draft: value, reason: '' }, { patchRows })
      const cur = row.format?.[col.key] || null
      if (takesFormula(col) && (cur?.fx || null) !== (fx || null)) {
        const next = { ...(cur || {}) }
        if (fx) next.fx = fx; else delete next.fx
        const f = Object.keys(next).length ? next : null
        patchRows(r => (r.id === row.id ? { ...r, format: Object.fromEntries(Object.entries({ ...r.format, [col.key]: f }).filter(([, v]) => v)) } : r))
        await saveHostCells([{ rowId: row.id, key: col.key, format: f }])
      }
      await recalcRow(row, { [col.key]: Number.isFinite(Number(value)) && String(value).trim() !== '' ? Number(value) : value }, new Set([col.key]))
      return true
    } finally { pend(id, null) }
  }
  // A change works out again every formula in the same row that reads the changed column (a few deep).
  const recalcRow = async (row, over, seen) => {
    if (!formulas || seen.size > 6) return
    const changedLabels = new Set([...seen].map(k => colByKey.get(k)?.label?.toLowerCase()).filter(Boolean))
    for (const c of allColumns) {
      const fx = row.format?.[c.key]?.fx
      if (!fx || seen.has(c.key) || !takesFormula(c)) continue
      if (!formulaRefs(fx).some(n => changedLabels.has(n.toLowerCase()))) continue
      const res = formulaResult(row, c, fx, over)
      if (res.error) { notify?.(`${c.label}: ${res.error}`, 'err'); continue }
      if (c.staff) { commitStaff(row, c, String(res.value)); continue }
      await commitHostEdit(row, c, { rowId: row.id, key: c.key, draft: String(res.value), reason: '' }, { patchRows })
      seen.add(c.key)
      await recalcRow(row, { ...over, [c.key]: res.value }, seen)
    }
  }
  /** Save the open cell. `move` is where the selection goes next: [rows, cols], or null to stay. */
  // `draft` is the value to save when it cannot wait for a render (a dropdown saves as it changes).
  const commitEdit = async (move = null, draft) => {
    const ed = editing && draft !== undefined ? { ...editing, draft } : editing
    if (!ed) return
    const row = data.rows.find(r => r.id === ed.rowId), col = columnOf(ed.key)
    if (!row || !col) { setEditing(null); return }
    const done = () => { setEditing(null); refocus(); if (move) moveSel(move[0], move[1]) }
    // The panel keeps the old shape: it stays open until its save lands.
    if (ed.panel) {
      if (col.staff) { commitStaff(row, col, String(ed.draft ?? '')); done(); return }
      setSave('saving')
      try { await commitHostEdit(row, col, ed, { patchRows }); saved(); done() } catch (e) { setSave('error'); notify?.(e.message, 'err') }
      return
    }
    let value = typeof ed.draft === 'string' ? ed.draft : String(ed.draft ?? '')
    let fx = null
    if (takesFormula(col) && isFormula(value)) {
      if (value.length > FORMULA_MAX) { setEditing(e => ({ ...e, error: 'This formula is too long.' })); return }
      const res = formulaResult(row, col, value)
      // The cell stays open and says why, and so does the page's notice (the cell's note can sit at the frame's edge).
      if (res.error) { setEditing(e => ({ ...e, error: res.error })); notify?.(`${col.label}: ${res.error}`, 'err'); return }
      fx = value.trim(); value = String(res.value)
    }
    const hadFx = !!row.format?.[col.key]?.fx
    if (!fx && !hadFx && value === String(ed.original ?? '')) { done(); return }   // nothing changed
    if (fx && fx === row.format?.[col.key]?.fx) { done(); return }
    done()
    if (col.staff) {
      commitStaff(row, col, value)
      if (takesFormula(col)) { const cur = row.format?.[col.key] || {}; const next = { ...cur }; if (fx) next.fx = fx; else delete next.fx; const f = Object.keys(next).length ? next : null; patchRows(r => (r.id === row.id ? { ...r, format: { ...r.format, [col.key]: f || undefined } } : r)); saveCells([{ rowId: row.id, key: col.key, format: f }]) }
      await recalcRow(row, { [col.key]: value }, new Set([col.key]))
      return
    }
    setSave('saving')
    try { await saveHostValue(row, col, value, fx); saved() }
    catch (e) { setSave('error'); notify?.(`${col.label} was not saved: ${e.message}`, 'err') }
  }
  const cancelEdit = () => { setEditing(null); refocus() }

  // ── Keyboard: arrows move, Enter edits, Cmd/Ctrl+B/I/U format, Cmd/Ctrl+A selects all, Delete clears staff values ──
  const onKey = (e) => {
    if (editing || ctx) return
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return }
    if (!sel) return
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); openMenuFromKeys(); return }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); return }
    const move = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]
    if (move) {
      e.preventDefault()
      const r = Math.max(0, Math.min(lastRow, sel.focus.r + move[0])), c = Math.max(0, Math.min(lastCol, sel.focus.c + move[1]))
      setSel(s => (e.shiftKey ? { anchor: s.anchor, focus: { r, c } } : { anchor: { r, c }, focus: { r, c } }))
      return
    }
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); const row = visibleRows[sel.focus.r], col = gridCols[sel.focus.c]; if (row && col) startEdit(row, col); return }
    if (e.key === 'Tab') { e.preventDefault(); moveSel(0, e.shiftKey ? -1 : 1); return }
    // SHEET-LIVE-1: typing on a selected cell starts editing it with that key, as in a spreadsheet.
    if (editable && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const row = visibleRows[sel.focus.r], col = gridCols[sel.focus.c]
      if (row && col) { e.preventDefault(); startEdit(row, col, e.key) }
      return
    }
    if (tl.text && (e.metaKey || e.ctrlKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) { e.preventDefault(); toggle(e.key.toLowerCase()); return }
    // Delete clears what Clear contents clears: staff values always, host columns the host allows.
    if ((e.key === 'Delete' || e.key === 'Backspace') && editable) {
      const cl = clearable()
      if (!cl.staff.length && !cl.host.length) return
      e.preventDefault()
      clearSelection()
    }
  }

  // ── Columns: resize, reorder, staff columns ──
  const startResize = (e, key) => {
    e.preventDefault(); e.stopPropagation()
    const x0 = e.clientX, w0 = width(key)
    const at = (ev) => Math.min(640, Math.max(60, w0 + ev.clientX - x0))
    const moveTo = (ev) => setLayout(l => ({ ...l, widths: { ...l.widths, [key]: at(ev) } }))
    const up = (ev) => { document.removeEventListener('mousemove', moveTo); document.removeEventListener('mouseup', up); changeLayout(l => ({ ...l, widths: { ...l.widths, [key]: at(ev) } })) }
    document.addEventListener('mousemove', moveTo); document.addEventListener('mouseup', up)
  }
  const dropColumn = (target) => {
    if (!dragCol || dragCol === target || target === lead.key) return
    const keys = ordered.map(c => c.key).filter(k => k !== dragCol)
    keys.splice(keys.indexOf(target), 0, dragCol)
    changeLayout(l => ({ ...l, order: keys }))
    setDragCol(null); setSel(null)
  }
  const addStaffColumn = () => {
    if (!newCol.label.trim()) return
    const col = { key: newStaffKey(), label: newCol.label.trim(), type: newCol.type, ...(newCol.type === 'choice' ? { options: newCol.options.split(',').map(x => x.trim()).filter(Boolean) } : {}) }
    changeLayout(l => ({ ...l, staffColumns: [...l.staffColumns, col] }))
    setNewCol({ label: '', type: 'text', options: '' }); setMenu(null)
  }
  const removeStaffColumn = (key) => {
    if (!window.confirm('Delete this column and everything typed in it?')) return
    changeLayout(l => ({ ...l, staffColumns: l.staffColumns.filter(c => c.key !== key), order: l.order.filter(k => k !== key), hidden: l.hidden.filter(k => k !== key) }))
    setSel(null)
  }

  // ── The right-click menu (SHEET-MENU-1) ──
  const cellEditable = (row, col) => !!row && !!col && canEdit(col) && !locked(row, col)
  const inRange = (r, c) => !!range && r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1
  const openMenu = (e, kind, r, c) => {
    e.preventDefault()
    if (editing) return
    frameRef.current?.focus({ preventScroll: true })
    // Like a spreadsheet: a right-click inside the selection keeps it; outside, it selects what was clicked.
    if (kind === 'cell' && !inRange(r, c)) setSel({ anchor: { r, c }, focus: { r, c } })
    if (kind === 'row' && !(sel?.whole === 'row' && inRange(r, 0))) selectRows(r, false)
    if (kind === 'col' && !((sel?.whole === 'col' || sel?.whole === 'all') && inRange(0, c))) selectCols(c, false)
    setCtx({ x: e.clientX, y: e.clientY, kind, r, c })
  }
  const openMenuFromKeys = () => {
    if (!sel) return
    const row = visibleRows[sel.focus.r], col = gridCols[sel.focus.c]
    const el = row && col && frameRef.current?.querySelector(`[data-cell="${row.id}|${col.key}"]`)
    const b = el?.getBoundingClientRect()
    if (b) setCtx({ x: b.left + 12, y: b.bottom - 4, kind: 'cell', r: sel.focus.r, c: sel.focus.c })
  }
  const closeMenu = () => { setCtx(null); frameRef.current?.focus({ preventScroll: true }) }
  const blockText = () => {
    if (!range) return ''
    const lines = []
    for (let r = range.r0; r <= range.r1; r++) {
      const row = visibleRows[r]
      if (!row) continue
      const cells = []
      for (let c = range.c0; c <= range.c1; c++) { const col = gridCols[c]; cells.push(col ? String(textOf(row, col.key) ?? '').replace(/[\t\n]/g, ' ') : '') }
      lines.push(cells.join('\t'))
    }
    return lines.join('\n')
  }
  const copySelection = async () => {
    const text = blockText()
    try { await navigator.clipboard.writeText(text); notify?.(range && (range.r1 > range.r0 || range.c1 > range.c0) ? 'Copied the selected cells.' : 'Copied.') }
    catch { notify?.('Copy needs clipboard permission in this browser.', 'err') }
  }
  /** Paste a block (tab and newline separated, as Excel and Sheets copy it) from the active cell. */
  const pasteBlock = async (text) => {
    if (!sel || !editable) return
    const lines = String(text || '').replace(/\r/g, '').replace(/\n$/, '').split('\n').map(l => l.split('\t'))
    const staffUpdates = [], hostEdits = []
    let skipped = 0
    lines.forEach((cells, i) => cells.forEach((value, j) => {
      const row = visibleRows[sel.focus.r + i], col = gridCols[sel.focus.c + j]
      if (!row || !col) return
      if (!cellEditable(row, col) || (col.staff && col.type === 'check')) { skipped++; return }
      if (col.staff) staffUpdates.push({ row, col, value })
      else hostEdits.push({ row, col, value })
    }))
    if (staffUpdates.length) {
      const byKey = new Map(staffUpdates.map(u => [`${u.row.id}|${u.col.key}`, u.value]))
      patchRows(r => ({ ...r, cells: Object.fromEntries(Object.entries({ ...r.cells, ...Object.fromEntries(staffUpdates.filter(u => u.row.id === r.id).map(u => [u.col.key, u.value])) })) }))
      saveCells(staffUpdates.map(u => ({ rowId: u.row.id, key: u.col.key, value: byKey.get(`${u.row.id}|${u.col.key}`) })))
    }
    let failed = 0
    if (hostEdits.length) {
      setSave('saving')
      for (const h of hostEdits) {
        try {
          let value = h.value, fx = null
          if (takesFormula(h.col) && isFormula(value)) { const res = formulaResult(h.row, h.col, value); if (res.error) throw new Error(res.error); fx = value.trim(); value = String(res.value) }
          await saveHostValue(h.row, h.col, value, fx)
        } catch (err) { failed++; if (failed === 1) notify?.(err.message, 'err') }
      }
      if (failed) setSave('error'); else saved()
    }
    const done = staffUpdates.length + hostEdits.length - failed
    if (done || skipped) notify?.(`Pasted ${done} ${done === 1 ? 'cell' : 'cells'}${skipped ? `; ${skipped} ${skipped === 1 ? 'cell is' : 'cells are'} not editable` : ''}.`)
  }
  const pasteFromClipboard = async () => {
    try { await pasteBlock(await navigator.clipboard.readText()) }
    catch { notify?.('Paste needs clipboard permission in this browser. Cmd/Ctrl+V works on the grid.', 'err') }
  }
  const clearable = () => ({
    staff: selectedCells.filter(x => x.col.staff && x.row.cells[x.col.key] && !locked(x.row, x.col)),
    host: selectedCells.filter(x => !x.col.staff && canClear(x.col) && cellEditable(x.row, x.col) && String(x.row.cells[x.col.key] ?? '') !== ''),
  })
  const clearSelection = () => {
    const { staff, host } = clearable()
    if (staff.length) {
      const ids = new Set(staff.map(x => `${x.row.id}|${x.col.key}`))
      patchRows(r => ({ ...r, cells: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, ids.has(`${r.id}|${k}`) ? '' : v])) }))
      saveCells(staff.map(x => ({ rowId: x.row.id, key: x.col.key, value: '' })))
    }
    if (host.length) (async () => {
      setSave('saving')
      let failed = 0
      for (const x of host) { try { await commitHostEdit(x.row, x.col, { rowId: x.row.id, key: x.col.key, draft: '', reason: '' }, { patchRows }) } catch (err) { failed++; if (failed === 1) notify?.(err.message, 'err') } }
      if (failed) setSave('error'); else saved()
    })()
    if (!staff.length && !host.length) notify?.('Nothing here can be cleared.')
  }
  const menuRows = () => (range ? visibleRows.slice(range.r0, range.r1 + 1) : [])
  const deleteMenuRows = async () => {
    const list = menuRows().filter(r => canDeleteRow(r))
    if (!list.length) { notify?.('These rows cannot be deleted.'); return }
    if (!window.confirm(list.length === 1 ? 'Delete this row?' : `Delete these ${list.length} rows?`)) return
    setSave('saving')
    try {
      await onDeleteRows(list)
      const gone = new Set(list.map(r => r.id))
      setData(d => ({ ...d, rows: d.rows.filter(r => !gone.has(r.id)) }))
      setSel(null); saved()
    } catch (e) { setSave('error'); notify?.(e.message, 'err') }
  }
  const menuItems = () => {
    if (!ctx) return []
    const col = gridCols[ctx.c], row = visibleRows[ctx.r]
    const items = []
    const add = (label, run, { disabled = false, hint, danger } = {}) => items.push({ label, run, disabled, hint, danger })
    const sep = () => { if (items.length && items[items.length - 1] !== 'sep') items.push('sep') }
    if (ctx.kind === 'cell') {
      add('Edit cell', () => startEdit(row, col), { disabled: !cellEditable(row, col), hint: 'Enter' })
      add('Copy', copySelection, { hint: '⌘C' })
      add('Paste', pasteFromClipboard, { disabled: !editable, hint: '⌘V' })
      const cl = clearable()
      add('Clear contents', clearSelection, { disabled: !editable || !(cl.staff.length + cl.host.length), hint: 'Delete' })
      if (tl.text || tl.clear) sep()
      if (tl.text) {
        add('Bold', () => toggle('b'), { disabled: off, hint: '⌘B' })
        add('Italic', () => toggle('i'), { disabled: off, hint: '⌘I' })
        add('Underline', () => toggle('u'), { disabled: off, hint: '⌘U' })
      }
      if (tl.clear) add('Clear formatting', () => applyFormat(null), { disabled: off })
    }
    if (ctx.kind === 'row') add('Copy row', copySelection, { hint: '⌘C' })
    if (ctx.kind !== 'col' && (onAddRow || onDeleteRows)) {
      sep()
      if (onAddRow) add('Insert row', addRow, { disabled: off })
      if (onDeleteRows) { const n = menuRows().length; add(n > 1 ? `Delete ${n} rows` : 'Delete row', deleteMenuRows, { disabled: off || !n, danger: true }) }
    }
    if (col && ctx.kind !== 'row') {
      sep()
      add('Sort A to Z', () => setSort({ key: col.key, dir: 'asc' }))
      add('Sort Z to A', () => setSort({ key: col.key, dir: 'desc' }))
      if (ctx.kind === 'cell' && row && !ungroupable.has(col.key)) {
        const v = String(shownOf(row, col.key) ?? '').trim()
        add(v ? `Filter by "${v.length > 24 ? `${v.slice(0, 24)}…` : v}"` : 'Filter by this value', () => { setFilters(f => [...f, { key: col.key, value: v }]); setSel(null) }, { disabled: !v })
      }
      if (!ungroupable.has(col.key) && col.key !== lead.key) {
        const grouped = layout.groupBy === col.key
        add(grouped ? 'Remove grouping' : 'Group by this column', () => { setCollapsed(new Set()); setSel(null); changeLayout(l => ({ ...l, groupBy: grouped ? null : col.key })) })
      }
      if (ctx.c <= 3) add(ctx.c === 0 ? `Freeze ${lead.label} only` : 'Freeze through this column', () => changeLayout(l => ({ ...l, frozen: ctx.c })))
      if (col.key !== lead.key) add('Hide column', () => { setSel(null); changeLayout(l => ({ ...l, hidden: [...new Set([...(l.hidden || []), col.key])] })) })
      if (col.staff && editable) add('Delete column', () => removeStaffColumn(col.key), { danger: true })
    }
    while (items[items.length - 1] === 'sep') items.pop()
    return items
  }

  // ── Export ── EXPORT-ONE-1: the host's one Export to Excel button asks the grid what it
  // shows (the filtered, sorted rows and the visible columns in order), so it exports that.
  useEffect(() => {
    if (!viewRef) return undefined
    viewRef.current = () => ({ rowIds: rows.map(x => x.id), columnKeys: columns.map(c => c.key), groupBy: layout?.groupBy || null })
    return () => { viewRef.current = null }
  }, [viewRef, rows, columns, layout])

  // SHEET-EMPTY-1 (Owner, 2026-09-24): with no rows the grid is still a sheet: the header,
  // blank numbered rows and the tools, so staff can set it up (columns, formats, Σ) before
  // the first row arrives.
  const none = !data.rows.length

  // Frozen columns: the row numbers, the lead column and up to three more stay put.
  const lefts = {}
  gridCols.slice(0, 1 + (layout.frozen || 0)).reduce((x, c) => { lefts[c.key] = x; return x + width(c.key) }, W_ROWNUM)
  const stickyStyle = (key, z = 1) => (key in lefts ? { position: 'sticky', left: lefts[key], zIndex: z } : null)
  const addCol = adding ? columnOf(adding.key) : null
  const off = !editable
  const rowIndex = new Map(visibleRows.map((r, i) => [r.id, i]))
  const numberText = (key, v) => {
    const f = layout.colFormats?.[key]
    return f && (f.num || f.dec != null || f.comma) ? formatNumber(v, f) : formatNumber(v, { dec: Number.isInteger(v) ? 0 : 2, comma: true })
  }
  const summaryOf = (col) => {
    const fn = layout.summaries?.[col.key]
    if (!fn) return ''
    const v = summarize((countsInTotals ? rows.filter(countsInTotals) : rows).map(r => val(r, col.key)), fn)
    if (v == null) return '-'
    if (fn === 'count' || fn === 'counta') return String(v)
    return numberText(col.key, v)
  }
  // BUDGET-SHEET-0b: a group row's subtotals, in the column's own number format.
  const subtotalsOf = (group) => groupSubtotals.filter(k => colByKey.has(k)).map(k => {
    const v = summarize((countsInTotals ? group.rows.filter(countsInTotals) : group.rows).map(r => val(r, k)), 'sum')
    return { key: k, label: colByKey.get(k).label, text: v == null ? '\u2013' : numberText(k, v) }
  })
  // BUDGET-SHEET-0b: rows the host lets the owner add and delete. Delete acts on whole rows,
  // selected by their numbers, so a stray cell selection never removes anything.
  const pickedRows = sel?.whole === 'row' && range ? visibleRows.slice(range.r0, range.r1 + 1) : []
  const canDelete = pickedRows.length > 0 && pickedRows.every(r => canDeleteRow(r))
  const addRow = async () => {
    setSave('saving')
    try {
      const row = await onAddRow()
      if (row) setData(d => ({ ...d, rows: [...d.rows, row] }))
      saved()
    } catch (e) { setSave('error'); notify?.(e.message, 'err') }
  }
  const deleteRows = async () => {
    if (!canDelete) return
    const n = pickedRows.length
    if (!window.confirm(n === 1 ? 'Delete this row?' : `Delete these ${n} rows?`)) return
    setSave('saving')
    try {
      await onDeleteRows(pickedRows)
      const gone = new Set(pickedRows.map(r => r.id))
      setData(d => ({ ...d, rows: d.rows.filter(r => !gone.has(r.id)) }))
      setSel(null); saved()
    } catch (e) { setSave('error'); notify?.(e.message, 'err') }
  }

  return (
    <div className="fs">
      {!editable && labels.notice && <p className="fm-note" role="status">{labels.notice}</p>}

      {/* The Smartsheet row: text formatting, number and date formats, then the grid's own tools. */}
      <div className="fs-toolbar" ref={toolRef} role="toolbar" aria-label="Sheet tools">
        {tl.text && <div className="fs-tgroup">
          <SheetTip label="Bold (Cmd/Ctrl+B)"><button type="button" className="fs-tb" aria-pressed={!!firstFormat.b} disabled={off} onClick={() => toggle('b')} aria-label="Bold"><Bold size={15} /></button></SheetTip>
          <SheetTip label="Italic (Cmd/Ctrl+I)"><button type="button" className="fs-tb" aria-pressed={!!firstFormat.i} disabled={off} onClick={() => toggle('i')} aria-label="Italic"><Italic size={15} /></button></SheetTip>
          <SheetTip label="Underline (Cmd/Ctrl+U)"><button type="button" className="fs-tb" aria-pressed={!!firstFormat.u} disabled={off} onClick={() => toggle('u')} aria-label="Underline"><Underline size={15} /></button></SheetTip>
          <span className="fs-tpop">
            <SheetTip label="Text colour"><button type="button" className="fs-tb" disabled={off} aria-expanded={menu === 'ink'} onClick={() => setMenu(m => (m === 'ink' ? null : 'ink'))} aria-label="Text colour">
              <Baseline size={15} /><i className="fs-swatchbar" style={{ background: firstFormat.ink ? inkHex[firstFormat.ink] : 'currentColor' }} /></button>
            </SheetTip>
            {menu === 'ink' && (
              <div className="fs-palette" role="group" aria-label="Text colour">
                <button type="button" className="fs-auto" onClick={() => { applyFormat({ ink: null }); setMenu(null) }}>Automatic</button>
                {SHEET_INKS.map(c => <SheetTip key={c.key} label={c.label}><button type="button" className="fs-chip" aria-label={c.label} style={{ background: c.hex }} onClick={() => { applyFormat({ ink: c.key }); setMenu(null) }} /></SheetTip>)}
              </div>
            )}
          </span>
          <span className="fs-tpop">
            <SheetTip label="Fill colour"><button type="button" className="fs-tb" disabled={off} aria-expanded={menu === 'fill'} onClick={() => setMenu(m => (m === 'fill' ? null : 'fill'))} aria-label="Fill colour">
              <PaintBucket size={15} /><i className="fs-swatchbar" style={{ background: firstFormat.fill ? fillHex[firstFormat.fill] : 'transparent' }} /></button>
            </SheetTip>
            {menu === 'fill' && (
              <div className="fs-palette" role="group" aria-label="Fill colour">
                <button type="button" className="fs-auto" onClick={() => { applyFormat({ fill: null }); setMenu(null) }}>No fill</button>
                {SHEET_FILLS.map(c => <SheetTip key={c.key} label={c.label}><button type="button" className="fs-chip" aria-label={c.label} style={{ background: c.hex }} onClick={() => { applyFormat({ fill: c.key }); setMenu(null) }} /></SheetTip>)}
              </div>
            )}
          </span>
        </div>}
        {tl.align && <div className="fs-tgroup">
          {[['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]].map(([a, Icon]) => (
            <SheetTip key={a} label={`Align ${a}`}><button type="button" className="fs-tb" aria-pressed={firstFormat.align === a} disabled={off} onClick={() => applyFormat({ align: firstFormat.align === a ? null : a })} aria-label={`Align ${a}`}><Icon size={15} /></button></SheetTip>
          ))}
          <SheetTip label="Wrap text"><button type="button" className="fs-tb" aria-pressed={!!firstFormat.wrap} disabled={off} onClick={() => toggle('wrap')} aria-label="Wrap text"><WrapText size={15} /></button></SheetTip>
        </div>}
        <div className="fs-tgroup">
          <SheetTip label="Currency ($)"><button type="button" className="fs-tb fs-tbtext" aria-pressed={firstFormat.num === 'currency'} disabled={off} onClick={() => applyFormat({ num: firstFormat.num === 'currency' ? null : 'currency' })} aria-label="Currency">$</button></SheetTip>
          <SheetTip label="Percent (%)"><button type="button" className="fs-tb fs-tbtext" aria-pressed={firstFormat.num === 'percent'} disabled={off} onClick={() => applyFormat({ num: firstFormat.num === 'percent' ? null : 'percent' })} aria-label="Percent">%</button></SheetTip>
          <SheetTip label="Thousands separator (1,000)"><button type="button" className="fs-tb fs-tbtext" aria-pressed={!!firstFormat.comma} disabled={off} onClick={() => toggle('comma')} aria-label="Thousands separator">,</button></SheetTip>
          <SheetTip label="Fewer decimal places"><button type="button" className="fs-tb fs-tbtext" disabled={off} onClick={() => setDecimals(-1)} aria-label="Fewer decimal places">.0<sub>←</sub></button></SheetTip>
          <SheetTip label="More decimal places"><button type="button" className="fs-tb fs-tbtext" disabled={off} onClick={() => setDecimals(1)} aria-label="More decimal places">.00<sub>→</sub></button></SheetTip>
          <label className="fs-tsel fs-tsel-sm"><span className="fm-sr">Date format</span>
            <SheetTip label="Date format"><select disabled={off} value={firstFormat.date || ''} onChange={e => applyFormat({ date: e.target.value || null })}>
              <option value="">Date format</option>{DATE_FORMATS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select></SheetTip></label>
          {tl.clear && <SheetTip label="Clear formatting"><button type="button" className="fs-tb" disabled={off} onClick={() => applyFormat(null)} aria-label="Clear formatting"><Eraser size={15} /></button></SheetTip>}
        </div>
        <div className="fs-tgroup">
          <label className="fs-tsel"><span>Group by</span>
            <select value={layout.groupBy || ''} onChange={e => { setCollapsed(new Set()); setSel(null); changeLayout(l => ({ ...l, groupBy: e.target.value || null })) }}>
              <option value="">None</option>
              {ordered.filter(c => !ungroupable.has(c.key)).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select></label>
          <label className="fs-tsel"><span>Freeze</span>
            <select value={layout.frozen || 0} onChange={e => changeLayout(l => ({ ...l, frozen: Number(e.target.value) }))}>
              <option value={0}>{lead.label}</option><option value={1}>{lead.label} + 1</option><option value={2}>{lead.label} + 2</option><option value={3}>{lead.label} + 3</option>
            </select></label>
          {tl.newColumn && <span className="fs-tpop">
            <button type="button" className="fm-btn fm-sm" disabled={off} aria-expanded={menu === 'newcol'} onClick={() => setMenu(m => (m === 'newcol' ? null : 'newcol'))}><Plus size={14} aria-hidden="true" /> Column</button>
            {menu === 'newcol' && (
              <div className="fs-pop fs-newcol" role="group" aria-label="New staff column">
                {labels.newColumnHint && <p className="fm-hint">{labels.newColumnHint}</p>}
                <input autoFocus aria-label="Column name" placeholder="Column name" value={newCol.label} maxLength={60} onChange={e => setNewCol(c => ({ ...c, label: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') addStaffColumn() }} />
                <select aria-label="Column type" value={newCol.type} onChange={e => setNewCol(c => ({ ...c, type: e.target.value }))}>{SHEET_STAFF_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
                {newCol.type === 'choice' && <input aria-label="Options" placeholder="Options, separated by commas" value={newCol.options} onChange={e => setNewCol(c => ({ ...c, options: e.target.value }))} />}
                <button type="button" className="fm-btn fm-sm fm-pri" disabled={!newCol.label.trim()} onClick={addStaffColumn}>Add column</button>
              </div>
            )}
          </span>}
          {onAddRow && <button type="button" className="fm-btn fm-sm" disabled={off} onClick={addRow}><Plus size={14} aria-hidden="true" /> Row</button>}
          {onDeleteRows && (
            <button type="button" className="fm-btn fm-sm" disabled={off || !canDelete} title={canDelete ? undefined : 'Select rows by their numbers first'} onClick={deleteRows}><Trash2 size={14} aria-hidden="true" /> {pickedRows.length > 1 ? `Delete ${pickedRows.length} rows` : 'Delete row'}</button>
          )}
        </div>
        {/* SHEET-LIVE-1: every save says so here for a moment ("Saved"), then settles on "All changes saved". */}
        <span className={`fs-save${save === 'error' ? ' fs-save-bad' : ''}${save === 'saved' && flash ? ' fs-save-flash' : ''}`} aria-live="polite">
          {off ? 'View only' : save === 'saving' ? 'Saving…' : save === 'error' ? 'Not saved' : flash ? <><Check size={13} aria-hidden="true" /> Saved</> : 'All changes saved'}</span>
      </div>

      <div className="fs-tools">
        <input className="fs-search" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={labels.searchPlaceholder} aria-label={labels.searchLabel} />
        <button type="button" className="fm-btn fm-sm" onClick={() => setAdding({ key: defaultFilterKey, value: '' })}>Add a filter</button>
        {quickFilters.map(f => {
          const n = data.rows.filter(f.test).length
          if (!n && quick !== f.key) return null
          return (
            <button key={f.key} type="button" className={`fm-btn fm-sm fs-quick${quick === f.key ? ' fs-quick-on' : ''}`} aria-pressed={quick === f.key}
              onClick={() => { setQuick(q => (q === f.key ? null : f.key)); setSel(null) }}>{f.label}<span className="fs-quick-n">{n}</span></button>
          )
        })}
        <div className="fs-colmenu">
          <button type="button" className="fm-btn fm-sm" aria-expanded={menu === 'columns'} onClick={() => setMenu(m => (m === 'columns' ? null : 'columns'))}>Columns{hidden.size ? ` (${hidden.size} hidden)` : ''}</button>
          {menu === 'columns' && (
            <div className="fs-pop" role="group" aria-label="Show columns">
              {ordered.map(c => (
                <label key={c.key} className="fs-popitem"><input type="checkbox" checked={!hidden.has(c.key)} onChange={() => { setSel(null); changeLayout(l => ({ ...l, hidden: hidden.has(c.key) ? l.hidden.filter(k => k !== c.key) : [...l.hidden, c.key] })) }} /><span>{c.label}{c.earlier ? ' (earlier version)' : ''}{c.staff ? ' · staff' : ''}</span></label>
              ))}
            </div>
          )}
        </div>
        <span className="fs-count">{labels.count?.(rows.length, data.rows.length)}</span>
      </div>

      {adding && (
        <div className="fs-addfilter" role="group" aria-label="New filter">
          <select aria-label="Column" value={adding.key} onChange={e => setAdding({ key: e.target.value, value: '' })}>
            {ordered.filter(c => !ungroupable.has(c.key)).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          {addCol?.options
            ? <select aria-label="Value" value={adding.value} onChange={e => setAdding(a => ({ ...a, value: e.target.value }))}>
                <option value="">Choose…</option>{addCol.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            : <input aria-label="Contains" placeholder="Contains…" value={adding.value} onChange={e => setAdding(a => ({ ...a, value: e.target.value }))} />}
          <button type="button" className="fm-btn fm-sm fm-pri" disabled={!adding.value} onClick={() => { setFilters(f => [...f, adding]); setAdding(null); setSel(null) }}>Apply</button>
          <button type="button" className="fm-link" onClick={() => setAdding(null)}>Cancel</button>
        </div>
      )}
      {filters.length > 0 && (
        <div className="fm-chips" role="group" aria-label="Filters">
          {filters.map((f, i) => (
            <span key={`${f.key}-${i}`} className="fs-filter">{columnOf(f.key)?.label}: {f.value}
              <button type="button" aria-label={`Remove the filter ${columnOf(f.key)?.label}: ${f.value}`} onClick={() => { setFilters(fs => fs.filter((_, j) => j !== i)); setSel(null) }}>×</button></span>
          ))}
          <button type="button" className="fm-link" onClick={() => { setFilters([]); setSel(null) }}>Show all</button>
        </div>
      )}

      {none && labels.emptyNote && !emptyState && <p className="fm-hint fs-emptynote" role="status">{labels.emptyNote}</p>}
      {/* An empty sheet says what to do next, once, in place of blank rows (BUDGET-V2 item 6). */}
      {none && emptyState && <div className="fs-empty" role="status">{emptyState}</div>}
      <div className="fs-frame" ref={frameRef} hidden={none && !!emptyState && !(tail?.rows?.length > 0)} tabIndex={0} onKeyDown={onKey} onScroll={() => { followEditor(); if (ctx) setCtx(null) }} aria-label={labels.frameLabel}
        onPaste={e => { if (editing || !editable || !sel) return; e.preventDefault(); pasteBlock(e.clipboardData?.getData('text/plain') || '') }}>
        <table className="fs-table fs-fixed fs-grid">
          <colgroup><col style={{ width: W_ROWNUM }} />{gridCols.map(c => <col key={c.key} style={{ width: width(c.key) }} />)}</colgroup>
          <thead><tr>
            <th className="fs-corner" scope="col"><button type="button" className="fs-cornerbtn" onClick={selectAll} aria-label="Select everything" title="Select everything" /></th>
            {gridCols.map((c, ci) => {
              const active = sort.key === c.key
              const colSel = !!range && (sel.whole === 'col' || sel.whole === 'all') && ci >= range.c0 && ci <= range.c1
              return (
                <th key={c.key} scope="col" className={`fs-th${c.earlier ? ' fs-earlier' : ''}${c.staff ? ' fs-staff' : ''}${colSel ? ' fs-colsel' : ''}${dragCol && dragCol !== c.key && c.key !== lead.key ? ' fs-dropok' : ''}`}
                  style={{ ...cellStyle(null, width(c.key)), ...stickyStyle(c.key, 4) }}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  onMouseDown={e => { if (e.button === 2 || e.target.closest('button, .fs-resize')) return; if (e.shiftKey) e.preventDefault(); frameRef.current?.focus({ preventScroll: true }); selectCols(ci, e.shiftKey) }}
                  onContextMenu={e => openMenu(e, 'col', 0, ci)}
                  draggable={c.key !== lead.key} onDragStart={e => { setDragCol(c.key); try { e.dataTransfer.setData('text/plain', c.key) } catch { /* Firefox needs data */ } }} onDragEnd={() => setDragCol(null)}
                  onDragOver={e => { if (dragCol) e.preventDefault() }} onDrop={e => { e.preventDefault(); dropColumn(c.key) }}>
                  <span className="fs-thlabel" title={c.label}>{c.earlier ? `${c.label} (earlier)` : c.label}</span>
                  <button type="button" className={`fs-sortbtn${active ? ' fs-sortbtn-on' : ''}`} onClick={() => setSort(s => (s.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' }))}
                    aria-label={`Sort by ${c.label}${active ? (sort.dir === 'asc' ? ', now ascending' : ', now descending') : ''}`} title="Sort">{active ? (sort.dir === 'asc' ? '↑' : '↓') : <ArrowDownUp size={12} />}</button>
                  {c.staff && editable && <button type="button" className="fs-colx" title="Delete this staff column" aria-label={`Delete the column ${c.label}`} onClick={() => removeStaffColumn(c.key)}>×</button>}
                  <span className="fs-resize" onMouseDown={e => startResize(e, c.key)} aria-hidden="true" />
                </th>
              )
            })}
          </tr></thead>
          <tbody>
            {none && !emptyState && BLANK_ROWS.map(n => (
              <tr key={`blank-${n}`} className="fs-row fs-blank" aria-hidden="true">
                <th className="fs-rownum" style={{ position: 'sticky', left: 0, zIndex: 2 }}>{n}</th>
                {gridCols.map(col => <td key={col.key} className="fs-cell" style={{ ...cellStyle(null, width(col.key)), ...stickyStyle(col.key) }} />)}
              </tr>
            ))}
            {!none && !rows.length && <tr><td className="fs-none" colSpan={gridCols.length + 1}>{labels.noMatch} <button type="button" className="fm-link" onClick={() => { setFilters([]); setSearch('') }}>Show all</button></td></tr>}
            {(groups || [{ label: null, rows }]).map(g => (
              <GroupBlock key={g.label ?? '@all'} group={g} grouped={!!groups} collapsed={collapsed.has(g.label)} colSpan={gridCols.length + 1} subtotals={groups ? subtotalsOf(g) : NO_KEYS}
                onToggle={() => { setSel(null); setCollapsed(s => { const n = new Set(s); if (n.has(g.label)) n.delete(g.label); else n.add(g.label); return n }) }}>
                {!collapsed.has(g.label) && g.rows.map(row => {
                  const r = rowIndex.get(row.id)
                  const rowSel = !!range && sel.whole === 'row' && r >= range.r0 && r <= range.r1
                  return (
                    <tr key={row.id} className="fs-row">
                      <th scope="row" className={`fs-rownum${rowSel ? ' fs-rowsel' : ''}`} style={{ position: 'sticky', left: 0, zIndex: 2 }}
                        onMouseDown={e => { if (e.button === 2) return; e.preventDefault(); frameRef.current?.focus({ preventScroll: true }); selectRows(r, e.shiftKey); startDrag('row') }}
                        onMouseEnter={() => { if (dragRef.current?.kind === 'row') selectRows(r, true) }}
                        onContextMenu={e => openMenu(e, 'row', r, 0)}>{r + 1}</th>
                      {gridCols.map((col, c) => {
                        const f = fmtOf(row, col.key)
                        const isEditing = editing && editing.rowId === row.id && editing.key === col.key
                        const isLead = col.key === lead.key
                        const Cell = isLead ? 'th' : 'td'
                        const extra = [cellClass?.(row, col), col.compute ? 'fs-computed' : '', editable && locked(row, col) ? 'fs-locked' : ''].filter(Boolean).join(' ')
                        const pend = pending.get(`${row.id}|${col.key}`)
                        const text = pend != null ? (plainKeys.has(col.key) ? pend : displayValue(pend, f)) : textOf(row, col.key)
                        const own = isEditing || pend != null ? undefined : renderCell?.(row, col, text)
                        const fx = formulas && f?.fx
                        const inline = isEditing && !editing.panel
                        return (
                          <Cell key={col.key} data-cell={`${row.id}|${col.key}`} scope={isLead ? 'row' : undefined} style={{ ...cellStyle(f, width(col.key)), ...stickyStyle(col.key) }}
                            className={`fs-cell${isLead ? ' fs-name' : ''}${isActive(r, c) ? ' fs-sel' : ''}${multi && isSelected(r, c) ? ` fs-inrange${edgesOf(r, c)}` : ''}${extra ? ` ${extra}` : ''}${isEditing ? ' fs-editing' : ''}${inline ? ' fs-inline-on' : ''}${fx ? ' fs-hasfx' : ''}${pend != null ? ' fs-pending' : ''}`}
                            onMouseDown={e => { if (e.button === 2 || isEditing || e.target.closest('a, button')) return; if (e.shiftKey) e.preventDefault(); frameRef.current?.focus({ preventScroll: true }); setSel(s => (e.shiftKey && s ? { anchor: s.anchor, focus: { r, c } } : { anchor: { r, c }, focus: { r, c } })); if (!e.shiftKey) startDrag('cell') }}
                            onMouseEnter={() => { if (dragRef.current?.kind === 'cell') setSel(s => (s && !s.whole ? { anchor: s.anchor, focus: { r, c } } : s)) }}
                            onContextMenu={e => { if (!isEditing) openMenu(e, 'cell', r, c) }}
                            onDoubleClick={() => startEdit(row, col)}
                            title={fx ? `${fx}${cellTitle?.(row, col) ? `\n${cellTitle(row, col)}` : ''}` : cellTitle?.(row, col)}>
                            {inline
                              ? <InlineEditor col={col} row={row} editing={editing} setEditing={setEditing} formula={takesFormula(col)}
                                  onCommit={commitEdit} onCancel={cancelEdit} label={editorLabel?.(row, col) || `Edit ${col.label}`} />
                              : isEditing
                              ? <Editor col={col} row={row} editing={editing} setEditing={setEditing} onSave={() => commitEdit()} onCancel={cancelEdit}
                                  label={editorLabel?.(row, col) || `Edit ${col.label}`} saveLabel={saveLabel?.(col) || 'Save'}
                                  extras={col.staff ? null : editorExtras?.({ col, row, editing, setEditing })} />
                              : own !== undefined
                                ? own
                                : col.staff && col.type === 'check'
                                  ? <span className="fs-check" aria-label={row.cells[col.key] ? 'Checked' : 'Not checked'}>{row.cells[col.key] ? '✓' : ''}</span>
                                  : !col.staff && col.type === 'check'
                                    ? <button type="button" role="checkbox" aria-checked={!!row.cells[col.key]} aria-label={`${col.label}: ${row.cells[col.key] ? 'checked' : 'not checked'}`}
                                        className={`fs-hostcheck${row.cells[col.key] ? ' on' : ''}`} disabled={!cellEditable(row, col)}
                                        onMouseDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); startEdit(row, col) }}>{row.cells[col.key] ? '✓' : ''}</button>
                                    : text}
                          </Cell>
                        )
                      })}
                    </tr>
                  )
                })}
              </GroupBlock>
            ))}
          </tbody>
          {tail?.rows?.length > 0 && !search.trim() && !filters.length && !quick && (
            <tbody className="fs-tail">
              <tr className="fs-tailhead"><th scope="rowgroup" colSpan={gridCols.length + 1}><span style={{ position: 'sticky', left: 12 }}>{tail.label}</span></th></tr>
              {tail.rows.map(row => (
                <tr key={row.id} className="fs-row fs-tailrow">
                  <th scope="row" className="fs-rownum" style={{ position: 'sticky', left: 0, zIndex: 2 }} aria-label="Not counted" />
                  {gridCols.map(col => {
                    const isLead = col.key === lead.key
                    const Cell = isLead ? 'th' : 'td'
                    const text = textOf(row, col.key)
                    const own = renderCell?.(row, col, text)
                    return (
                      <Cell key={col.key} scope={isLead ? 'row' : undefined} className={`fs-cell${isLead ? ' fs-name' : ''}${cellClass?.(row, col) ? ` ${cellClass(row, col)}` : ''}`}
                        style={{ ...cellStyle(fmtOf(row, col.key), width(col.key)), ...stickyStyle(col.key) }}>
                        {own !== undefined ? own : text}
                      </Cell>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          )}
          <tfoot>
            <tr className="fs-sumrow">
              <th scope="row" className="fs-rownum fs-sumlabel" style={{ position: 'sticky', left: 0, zIndex: 3 }} title="Summary of the rows shown">Σ</th>
              {gridCols.map(c => (
                <td key={c.key} style={{ ...cellStyle(null, width(c.key)), ...stickyStyle(c.key, 3) }}>
                  {c.key === lead.key
                    ? <span className="fs-sumhint">Summary</span>
                    : unsummable.has(c.key) ? null : (<span className="fs-sumcell">
                        <select className={layout.summaries?.[c.key] ? 'fs-sumon' : undefined} aria-label={`Summary of ${c.label}`} value={layout.summaries?.[c.key] || ''} disabled={off}
                          onChange={e => changeLayout(l => { const summaries = { ...(l.summaries || {}) }; if (e.target.value) summaries[c.key] = e.target.value; else delete summaries[c.key]; return { ...l, summaries } })}>
                          <option value="">{layout.summaries?.[c.key] ? 'None' : '·'}</option>{SUMMARY_FNS.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
                        </select>
                        <b>{summaryOf(c)}</b>
                      </span>)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {/* The items are built here so each carries this render's state; their handlers read the
          frame ref only when an item is chosen, never while rendering. */}
      {/* eslint-disable-next-line react-hooks/refs */}
      {ctx && <SheetMenu x={ctx.x} y={ctx.y} items={menuItems()} onClose={closeMenu} />}
      {labels.help && <p className="fm-hint fs-help">{labels.help}</p>}
    </div>
  )
}

// The blank rows an empty Sheet shows under its header, numbered like a spreadsheet's.
const BLANK_ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const ALL_TOOLS = Object.freeze({ text: true, align: true, clear: true, newColumn: true })

function GroupBlock({ group, grouped, collapsed, colSpan, subtotals, onToggle, children }) {
  if (!grouped) return children
  return (
    <>
      <tr className="fs-grouprow">
        <td colSpan={colSpan}>
          <button type="button" className="fs-groupbtn" aria-expanded={!collapsed} onClick={onToggle}>
            {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            <b>{group.label}</b><span>{group.rows.length}</span>
            {subtotals.map(t => <span key={t.key} className="fs-groupsum">{t.label} <b>{t.text}</b></span>)}
          </button>
        </td>
      </tr>
      {children}
    </>
  )
}

/**
 * SHEET-LIVE-1: the editor that IS the cell. Enter saves and moves down, Tab saves and moves right
 * (Shift goes back), Escape puts the value back, and leaving the cell saves. A dropdown saves the
 * moment a choice is picked. A formula that cannot be worked out keeps the cell open and says why.
 */
function InlineEditor({ col, row, editing, setEditing, formula, onCommit, onCancel, label }) {
  const done = useRef(false)
  const ref = useRef(null)
  const set = (draft) => setEditing(e => ({ ...e, draft, error: null }))
  const finish = (move, draft) => { if (done.current) return; done.current = true; onCommit(move, draft) }
  const cancel = () => { if (done.current) return; done.current = true; onCancel() }
  // A formula that needs fixing leaves the cell open: let the next Enter try again.
  useEffect(() => { if (editing.error) done.current = false }, [editing.error])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: true })
    if (el.tagName === 'INPUT' && el.type === 'text') { const n = el.value.length; try { el.setSelectionRange(n, n) } catch { /* not a text input */ } }
    if (el.tagName === 'SELECT' || el.type === 'date') { try { el.showPicker?.() } catch { /* needs a user gesture in some browsers */ } }
  }, [])
  const keys = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel() }
    else if (e.key === 'Enter' && !(col.type === 'paragraph' && e.shiftKey)) { e.preventDefault(); finish([e.shiftKey ? -1 : 1, 0]) }
    else if (e.key === 'Tab') { e.preventDefault(); finish([0, e.shiftKey ? -1 : 1]) }
    e.stopPropagation()
  }
  const blur = () => { if (!editing.error) finish(null) }
  const options = (col.optionsFor ? col.optionsFor(row) : col.options) || []
  const common = { ref, onKeyDown: keys, onBlur: blur, 'aria-label': label, className: 'fs-inline' }
  let control
  if (col.type === 'choice' || col.type === 'dropdown') {
    const opts = options.filter(o => o !== 'Other')
    control = (
      <select {...common} value={editing.draft || ''} onChange={e => finish(null, e.target.value)}>
        {!col.required && <option value="">(blank)</option>}
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
        {editing.draft && !opts.includes(editing.draft) && <option value={editing.draft}>{editing.draft}</option>}
      </select>
    )
  } else if (col.type === 'date') control = <input {...common} type="date" value={editing.draft || ''} onChange={e => set(e.target.value)} />
  else if (col.type === 'paragraph') control = <textarea {...common} className="fs-inline fs-inline-area" rows={3} value={editing.draft || ''} onChange={e => set(e.target.value)} />
  else control = <input {...common} type="text" inputMode={col.type === 'number' && !formula ? 'decimal' : undefined} spellCheck={col.type !== 'number'} value={editing.draft ?? ''} onChange={e => set(e.target.value)} />
  return (
    <span className="fs-inline-wrap" onMouseDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
      {control}
      {editing.error && <span className="fs-inline-err" role="alert">{editing.error}</span>}
    </span>
  )
}

/** The in-cell editor: a staff value, or whatever edit the host allows for its own column. */
function Editor({ col, row, editing, setEditing, onSave, onCancel, label, saveLabel, extras }) {
  const set = (draft) => setEditing(e => ({ ...e, draft }))
  const keys = (e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } if (e.key === 'Enter' && !e.shiftKey && col.type !== 'paragraph') { e.preventDefault(); onSave() } }
  const options = (col.optionsFor ? col.optionsFor(row) : col.options) || []
  const hasOther = options.includes('Other')
  const opts = options.filter(o => o !== 'Other')
  let control
  if (!col.staff && (col.type === 'choice' || col.type === 'dropdown')) {
    const isOther = isOtherValue(editing.draft)
    control = (<>
      <select autoFocus value={isOther ? '__other' : (editing.draft || '')} onChange={e => set(e.target.value === '__other' ? otherValue('') : e.target.value)} onKeyDown={keys}>
        {!col.required && <option value="">(blank)</option>}{opts.map(o => <option key={o} value={o}>{o}</option>)}{hasOther && <option value="__other">Other…</option>}
      </select>
      {isOther && <input value={otherText(editing.draft)} placeholder="Other" onChange={e => set(otherValue(e.target.value))} onKeyDown={keys} />}
    </>)
  } else if (col.type === 'checkboxes') {
    const list = Array.isArray(editing.draft) ? editing.draft : []
    control = <div className="fs-checks">{opts.map(o => <label key={o}><input type="checkbox" checked={list.includes(o)} onChange={e => set(e.target.checked ? [...list, o] : list.filter(x => x !== o))} />{o}</label>)}</div>
  } else if (col.type === 'paragraph') control = <textarea autoFocus rows={4} value={editing.draft || ''} onChange={e => set(e.target.value)} onKeyDown={keys} />
  else if (col.type === 'date') control = <input autoFocus type="date" value={editing.draft || ''} onChange={e => set(e.target.value)} onKeyDown={keys} />
  else if (col.type === 'number') control = <input autoFocus type="number" step="any" value={editing.draft ?? ''} onChange={e => set(e.target.value)} onKeyDown={keys} />
  else if (col.staff && col.type === 'choice') control = <select autoFocus value={editing.draft || ''} onChange={e => set(e.target.value)} onKeyDown={keys}><option value="">(blank)</option>{options.map(o => <option key={o} value={o}>{o}</option>)}</select>
  else control = <input autoFocus value={editing.draft || ''} onChange={e => set(e.target.value)} onKeyDown={keys} />
  const a = editing.anchor
  const box = a ? { position: 'fixed', top: Math.max(8, a.top - 2), left: Math.max(8, Math.min(a.left - 2, window.innerWidth - 316)) } : null
  return (
    <div className="fs-editor" style={box || undefined} onMouseDown={e => e.stopPropagation()} onFocus={e => { if (e.target.tagName === 'INPUT' && e.target.type === 'text' && !e.target.dataset.seen) { e.target.dataset.seen = '1'; e.target.select() } }}
      role="group" aria-label={label}>
      {control}
      {typeof extras === 'function' ? extras(keys) : extras}
      <span className="fs-edacts"><button type="button" className="fm-btn fm-sm fm-pri" onClick={onSave}>{saveLabel}</button><button type="button" className="fm-link" onClick={onCancel}>Cancel</button></span>
    </div>
  )
}

/** The right-click menu: a real menu (role, arrow keys, Escape), placed at the pointer inside the window. */
function SheetMenu({ x, y, items, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: x, top: y })
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const b = el.getBoundingClientRect()
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - b.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - b.height - 8)) })
    el.querySelector('[role="menuitem"]:not([aria-disabled="true"])')?.focus()
    const away = (e) => { if (!el.contains(e.target)) onClose() }
    const gone = () => onClose()
    document.addEventListener('mousedown', away)
    window.addEventListener('resize', gone)
    window.addEventListener('blur', gone)
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('resize', gone); window.removeEventListener('blur', gone) }
  }, [x, y, onClose])
  const keys = (e) => {
    const list = [...ref.current.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])')]
    const at = list.indexOf(document.activeElement)
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(at + 1) % list.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(at - 1 + list.length) % list.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus() }
  }
  return (
    <div ref={ref} className="fs-menu" role="menu" aria-label="Sheet actions" style={{ position: 'fixed', ...pos }} onKeyDown={keys} onContextMenu={e => e.preventDefault()}>
      {items.map((it, i) => (it === 'sep'
        ? <div key={`sep-${i}`} className="fs-menu-sep" role="separator" />
        : (
          <button key={it.label} type="button" role="menuitem" className={`fs-menu-item${it.danger ? ' fs-menu-danger' : ''}`} aria-disabled={it.disabled || undefined} tabIndex={-1}
            onClick={() => { if (it.disabled) return; onClose(); it.run() }}>
            <span>{it.label}</span>{it.hint && <kbd>{it.hint}</kbd>}
          </button>
        )))}
    </div>
  )
}
