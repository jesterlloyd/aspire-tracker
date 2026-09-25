// src/components/forms/FormSheet.jsx
//
// FORM-SHEET-1 (2026-09-24, Owner: "monitor the results from an excel like or smartsheet like
// view"): Responses > Sheet. One row per submission, one column per question, read live from
// the answers every time it opens: search, filters, sort, show or hide columns, click a name
// for that person's full answers and PDF, and Export to Excel of exactly what is shown.
//
// FORM-SHEET-2 (Owner, 2026-09-24: Smartsheet's controls, "also edit their answers"): a
// toolbar over the grid formats the selected cells (bold, italic, underline, text colour, fill,
// alignment, wrap), groups rows by a column with counts, freezes columns, and adds staff
// columns (Lot assignment, Processed, Notes). Column widths drag, columns reorder by dragging
// their header, and every change saves itself. Double-click (or Enter) edits a cell: a staff
// column's value, or a CORRECTION to a submitted answer. A correction never changes the
// submission or its filed PDF; the cell is tagged Corrected with who, when and the original.
//
// Unlike the DataSheet canon, this grid SCROLLS sideways inside its own frame: a spreadsheet
// that drops columns to fit is not a spreadsheet. The header row, the name column and any
// frozen columns stay put while it scrolls.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight, Baseline, Bold, ChevronDown, ChevronRight, Eraser, Italic, PaintBucket, Plus, Underline, WrapText } from 'lucide-react'
import { cellMatches, CORRECTABLE_TYPES, groupSheetRows, isOtherValue, otherText, otherValue, SHEET_DEFAULT_INK, SHEET_FILLS, SHEET_INKS, SHEET_STAFF_TYPES } from '../../lib/forms/formModel'
import { formStaff } from './formsApi'

const BASE = [
  { key: '@school', label: 'School', base: true },
  { key: '@submitted', label: 'Submitted', base: true },
]
const W_DEFAULT = 160, W_NAME = 200
const stamp = (iso) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
const valueOf = (row, key) => key === '@name' ? row.name : key === '@school' ? row.school : key === '@submitted' ? row.submittedAt : row.cells[key]
const shown = (row, key) => key === '@submitted' ? stamp(row.submittedAt) : (valueOf(row, key) || '')
const fillHex = Object.fromEntries(SHEET_FILLS.map(f => [f.key, f.hex]))
const inkHex = Object.fromEntries(SHEET_INKS.map(f => [f.key, f.hex]))
const newStaffKey = () => `s_${Math.random().toString(36).slice(2, 10)}`

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

export default function FormSheet({ formId, onOpen, notify }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [layout, setLayout] = useState(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState([])
  const [adding, setAdding] = useState(null)
  const [sort, setSort] = useState({ key: '@submitted', dir: 'desc' })
  const [menu, setMenu] = useState(null)              // 'columns' | 'ink' | 'fill' | 'newcol'
  const [sel, setSel] = useState(null)                // { anchor: { r, c }, focus: { r, c } } in visible-grid indexes
  const [editing, setEditing] = useState(null)        // { rowId, key, draft, reason }
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [save, setSave] = useState('saved')           // saved | saving | error
  const [exporting, setExporting] = useState(false)
  const [dragCol, setDragCol] = useState(null)
  const [newCol, setNewCol] = useState({ label: '', type: 'text', options: '' })
  const frameRef = useRef(null)
  const toolRef = useRef(null)
  const layoutTimer = useRef(null)

  useEffect(() => {
    let live = true
    formStaff('sheet', { id: formId }).then(r => { if (!live) return; setData(r); setLayout(r.layout || { order: [], hidden: [], widths: {}, frozen: 0, groupBy: null, staffColumns: [] }) })
      .catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [formId])

  // Menus close on a click elsewhere or Escape.
  useEffect(() => {
    if (!menu) return undefined
    const away = (e) => { if (!toolRef.current?.contains(e.target) && !e.target.closest?.('.fs-colmenu')) setMenu(null) }
    const esc = (e) => { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [menu])

  const editable = !!data?.editable
  const staffColumns = useMemo(() => layout?.staffColumns || [], [layout])
  const allColumns = useMemo(() => [...BASE, ...(data?.columns || []), ...staffColumns.map(c => ({ ...c, staff: true }))], [data, staffColumns])
  const columnOf = useCallback((key) => allColumns.find(c => c.key === key), [allColumns])

  // Order: the saved order first, then any column not in it, in its natural place.
  const ordered = useMemo(() => {
    if (!layout) return allColumns
    const pos = new Map(layout.order.map((k, i) => [k, i]))
    const at = (c) => (pos.has(c.key) ? pos.get(c.key) : 1000 + allColumns.indexOf(c))
    return [...allColumns].sort((a, b) => at(a) - at(b))
  }, [allColumns, layout])
  const hidden = useMemo(() => new Set(layout?.hidden || []), [layout])
  const columns = useMemo(() => ordered.filter(c => !hidden.has(c.key)), [ordered, hidden])
  const width = (key) => layout?.widths?.[key] || (key === '@name' ? W_NAME : W_DEFAULT)

  // ── Rows: search, filters, sort ──
  const rows = useMemo(() => {
    if (!data) return []
    const needle = search.trim().toLowerCase()
    const out = data.rows.filter(r => {
      if (needle && ![r.name, r.email, r.school, ...Object.values(r.cells)].some(v => String(v || '').toLowerCase().includes(needle))) return false
      return filters.every(f => cellMatches(allColumns.find(c => c.key === f.key), valueOf(r, f.key), f.value))
    })
    const sign = sort.dir === 'asc' ? 1 : -1
    return out.sort((a, b) => {
      const x = valueOf(a, sort.key) || '', y = valueOf(b, sort.key) || ''
      if (!x && y) return 1
      if (x && !y) return -1
      return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) * sign
    })
  }, [data, search, filters, sort, allColumns])
  const groups = useMemo(() => (layout?.groupBy ? groupSheetRows(rows, layout.groupBy, (r, k) => shown(r, k)) : null), [rows, layout])
  const visibleRows = useMemo(() => (groups ? groups.flatMap(g => (collapsed.has(g.label) ? [] : g.rows)) : rows), [groups, rows, collapsed])
  const gridCols = useMemo(() => [{ key: '@name', label: 'Name', base: true }, ...columns], [columns])

  // ── Saving ──
  const changeLayout = (fn) => {
    setLayout(l => {
      const next = fn(l)
      if (editable) {
        clearTimeout(layoutTimer.current)
        setSave('saving')
        layoutTimer.current = setTimeout(async () => {
          try { await formStaff('sheet_layout', { id: formId, layout: next }); setSave('saved') } catch (e) { setSave('error'); notify?.(e.message, 'err') }
        }, 600)
      }
      return next
    })
  }
  const patchRows = (fn) => setData(d => ({ ...d, rows: d.rows.map(fn) }))
  const saveCells = async (updates) => {
    if (!editable || !updates.length) return
    setSave('saving')
    try { await formStaff('sheet_cells', { id: formId, updates }); setSave('saved') } catch (e) { setSave('error'); notify?.(e.message, 'err') }
  }

  // ── Selection ──
  const range = useMemo(() => {
    if (!sel) return null
    return { r0: Math.min(sel.anchor.r, sel.focus.r), r1: Math.max(sel.anchor.r, sel.focus.r), c0: Math.min(sel.anchor.c, sel.focus.c), c1: Math.max(sel.anchor.c, sel.focus.c) }
  }, [sel])
  const selectedCells = useMemo(() => {
    if (!range) return []
    const out = []
    for (let r = range.r0; r <= range.r1; r++) for (let c = range.c0; c <= range.c1; c++) {
      const row = visibleRows[r], col = gridCols[c]
      if (row && col) out.push({ row, col })
    }
    return out
  }, [range, visibleRows, gridCols])
  const isSelected = (r, c) => !!range && r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1
  const firstFormat = selectedCells[0] ? (selectedCells[0].row.format?.[selectedCells[0].col.key] || {}) : {}

  const applyFormat = (patch) => {
    if (!selectedCells.length) { notify?.('Select a cell first.'); return }
    const updates = []
    const changed = new Map()
    for (const { row, col } of selectedCells) {
      const cur = row.format?.[col.key] || {}
      const next = patch === null ? {} : { ...cur, ...patch }
      for (const k of Object.keys(next)) if (next[k] === false || next[k] == null) delete next[k]
      const empty = !Object.keys(next).length
      if (!changed.has(row.id)) changed.set(row.id, {})
      changed.get(row.id)[col.key] = empty ? undefined : next
      updates.push({ assignmentId: row.id, key: col.key, format: empty ? null : next })
    }
    patchRows(r => (changed.has(r.id) ? { ...r, format: Object.fromEntries(Object.entries({ ...r.format, ...changed.get(r.id) }).filter(([, v]) => v)) } : r))
    saveCells(updates)
  }
  const toggle = (k) => applyFormat({ [k]: !firstFormat[k] })

  // ── Editing ──
  const canEdit = (col) => editable && (col.staff || (!col.base && CORRECTABLE_TYPES.includes(col.type)))
  const commitStaff = (row, col, value) => {
    patchRows(r => (r.id === row.id ? { ...r, cells: { ...r.cells, [col.key]: value } } : r))
    saveCells([{ assignmentId: row.id, key: col.key, value }])
  }
  // The editor floats above the page (position: fixed) at its cell, so the grid's scrolling
  // frame never clips it; it follows the cell while the frame scrolls.
  const anchorOf = (rowId, key) => {
    const el = frameRef.current?.querySelector(`[data-cell="${rowId}|${key}"]`)
    const r = el?.getBoundingClientRect()
    return r ? { top: r.top, left: r.left, width: r.width } : null
  }
  const startEdit = (row, col) => {
    if (!canEdit(col)) { if (!editable && !col.base) notify?.('Editing needs the database update the Owner applies.'); return }
    if (col.staff && col.type === 'check') { commitStaff(row, col, row.cells[col.key] ? '' : 'Yes'); return }
    const raw = col.staff ? (row.cells[col.key] || '') : row.answers?.[col.key]
    setEditing({ rowId: row.id, key: col.key, draft: raw ?? (col.type === 'checkboxes' ? [] : ''), reason: '', anchor: anchorOf(row.id, col.key) })
  }
  const followEditor = () => { if (editing) setEditing(e => (e ? { ...e, anchor: anchorOf(e.rowId, e.key) } : e)) }
  const commitEdit = async () => {
    if (!editing) return
    const row = data.rows.find(r => r.id === editing.rowId), col = columnOf(editing.key)
    if (!row || !col) { setEditing(null); return }
    if (col.staff) { commitStaff(row, col, String(editing.draft ?? '')); setEditing(null); frameRef.current?.focus({ preventScroll: true }); return }
    setSave('saving')
    try {
      const r = await formStaff('sheet_correct', { id: formId, assignment_id: row.id, question_id: col.key, value: editing.draft, reason: editing.reason })
      const text = Array.isArray(r.value) ? r.value.join('; ') : col.type === 'date' && r.value ? String(r.value).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$2/$3/$1') : String(r.value ?? '')
      const original = row.corrected?.[col.key] ? row.corrected[col.key].original : row.answers?.[col.key]
      const back = JSON.stringify(r.value ?? null) === JSON.stringify(original ?? null)
      patchRows(x => {
        if (x.id !== row.id) return x
        const corrected = { ...x.corrected }
        if (back) delete corrected[col.key]; else corrected[col.key] = { by: 'you', at: new Date().toISOString(), original: original ?? null, reason: editing.reason }
        return { ...x, cells: { ...x.cells, [col.key]: text }, answers: { ...x.answers, [col.key]: r.value }, corrected }
      })
      setSave('saved'); setEditing(null); frameRef.current?.focus({ preventScroll: true })
      notify?.(back ? 'Put back to what they submitted.' : 'Corrected in the Sheet. Their submitted answer and PDF are unchanged.')
    } catch (e) { setSave('error'); notify?.(e.message, 'err') }
  }

  // ── Keyboard: arrows move, Enter edits, Cmd/Ctrl+B/I/U format, Delete clears a staff value ──
  const onKey = (e) => {
    if (editing || !sel) return
    const move = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]
    if (move) {
      e.preventDefault()
      const r = Math.max(0, Math.min(visibleRows.length - 1, sel.focus.r + move[0])), c = Math.max(0, Math.min(gridCols.length - 1, sel.focus.c + move[1]))
      setSel(s => (e.shiftKey ? { ...s, focus: { r, c } } : { anchor: { r, c }, focus: { r, c } }))
      return
    }
    if (e.key === 'Enter') { e.preventDefault(); const row = visibleRows[sel.focus.r], col = gridCols[sel.focus.c]; if (row && col) startEdit(row, col); return }
    if ((e.metaKey || e.ctrlKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) { e.preventDefault(); toggle(e.key.toLowerCase()); return }
    if ((e.key === 'Delete' || e.key === 'Backspace') && editable) {
      const staff = selectedCells.filter(x => x.col.staff && x.row.cells[x.col.key])
      if (!staff.length) return
      e.preventDefault()
      const ids = new Map(staff.map(x => [`${x.row.id}|${x.col.key}`, true]))
      patchRows(r => ({ ...r, cells: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, ids.has(`${r.id}|${k}`) ? '' : v])) }))
      saveCells(staff.map(x => ({ assignmentId: x.row.id, key: x.col.key, value: '' })))
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
    if (!dragCol || dragCol === target || target === '@name') return
    const keys = ordered.map(c => c.key).filter(k => k !== dragCol)
    keys.splice(keys.indexOf(target), 0, dragCol)
    changeLayout(l => ({ ...l, order: keys }))
    setDragCol(null)
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
  }

  // ── Export ──
  const exportXlsx = async () => {
    setExporting(true)
    try {
      const r = await formStaff('sheet_xlsx', { id: formId, rowIds: rows.map(x => x.id), columnKeys: columns.map(c => c.key), groupBy: layout?.groupBy || null })
      const bytes = Uint8Array.from(atob(r.xlsx), ch => ch.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url; a.download = r.fileName; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
    } catch (e) { notify?.(e.message, 'err') } finally { setExporting(false) }
  }

  if (error) return <p className="fm-err" role="alert">{error}</p>
  if (!data || !layout) return <p className="fm-hint">Loading the answers…</p>
  if (!data.rows.length) return <div className="fm-card fs-empty"><p className="fm-hint">No one has submitted this form yet. Answers appear here as they come in.</p></div>

  // Frozen columns: the name plus up to three more stay put; each one's left edge is the sum of those before it.
  const lefts = {}
  gridCols.slice(0, 1 + (layout.frozen || 0)).reduce((x, c) => { lefts[c.key] = x; return x + width(c.key) }, 0)
  const stickyStyle = (key, z = 1) => (key in lefts ? { position: 'sticky', left: lefts[key], zIndex: z } : null)
  const addCol = adding ? columnOf(adding.key) : null
  const off = !editable
  const rowIndex = new Map(visibleRows.map((r, i) => [r.id, i]))

  return (
    <div className="fs">
      {!editable && <p className="fm-note" role="status">Formatting, staff columns and corrections need a database update the Owner applies (20260929000000_form_sheet.sql). Until then you can view, filter, sort and export.</p>}

      {/* The Smartsheet row: formatting on the left, the grid's own tools on the right. */}
      <div className="fs-toolbar" ref={toolRef} role="toolbar" aria-label="Sheet tools">
        <div className="fs-tgroup">
          <button type="button" className="fs-tb" aria-pressed={!!firstFormat.b} disabled={off} onClick={() => toggle('b')} title="Bold (Cmd/Ctrl+B)" aria-label="Bold"><Bold size={15} /></button>
          <button type="button" className="fs-tb" aria-pressed={!!firstFormat.i} disabled={off} onClick={() => toggle('i')} title="Italic (Cmd/Ctrl+I)" aria-label="Italic"><Italic size={15} /></button>
          <button type="button" className="fs-tb" aria-pressed={!!firstFormat.u} disabled={off} onClick={() => toggle('u')} title="Underline (Cmd/Ctrl+U)" aria-label="Underline"><Underline size={15} /></button>
          <span className="fs-tpop">
            <button type="button" className="fs-tb" disabled={off} aria-expanded={menu === 'ink'} onClick={() => setMenu(m => (m === 'ink' ? null : 'ink'))} title="Text colour" aria-label="Text colour">
              <Baseline size={15} /><i className="fs-swatchbar" style={{ background: firstFormat.ink ? inkHex[firstFormat.ink] : 'currentColor' }} /></button>
            {menu === 'ink' && (
              <div className="fs-palette" role="group" aria-label="Text colour">
                <button type="button" className="fs-auto" onClick={() => { applyFormat({ ink: null }); setMenu(null) }}>Automatic</button>
                {SHEET_INKS.map(c => <button key={c.key} type="button" className="fs-chip" title={c.label} aria-label={c.label} style={{ background: c.hex }} onClick={() => { applyFormat({ ink: c.key }); setMenu(null) }} />)}
              </div>
            )}
          </span>
          <span className="fs-tpop">
            <button type="button" className="fs-tb" disabled={off} aria-expanded={menu === 'fill'} onClick={() => setMenu(m => (m === 'fill' ? null : 'fill'))} title="Fill colour" aria-label="Fill colour">
              <PaintBucket size={15} /><i className="fs-swatchbar" style={{ background: firstFormat.fill ? fillHex[firstFormat.fill] : 'transparent' }} /></button>
            {menu === 'fill' && (
              <div className="fs-palette" role="group" aria-label="Fill colour">
                <button type="button" className="fs-auto" onClick={() => { applyFormat({ fill: null }); setMenu(null) }}>No fill</button>
                {SHEET_FILLS.map(c => <button key={c.key} type="button" className="fs-chip" title={c.label} aria-label={c.label} style={{ background: c.hex }} onClick={() => { applyFormat({ fill: c.key }); setMenu(null) }} />)}
              </div>
            )}
          </span>
        </div>
        <div className="fs-tgroup">
          {[['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]].map(([a, Icon]) => (
            <button key={a} type="button" className="fs-tb" aria-pressed={firstFormat.align === a} disabled={off} onClick={() => applyFormat({ align: firstFormat.align === a ? null : a })} title={`Align ${a}`} aria-label={`Align ${a}`}><Icon size={15} /></button>
          ))}
          <button type="button" className="fs-tb" aria-pressed={!!firstFormat.wrap} disabled={off} onClick={() => toggle('wrap')} title="Wrap text" aria-label="Wrap text"><WrapText size={15} /></button>
          <button type="button" className="fs-tb" disabled={off} onClick={() => applyFormat(null)} title="Clear formatting" aria-label="Clear formatting"><Eraser size={15} /></button>
        </div>
        <div className="fs-tgroup">
          <label className="fs-tsel"><span>Group by</span>
            <select value={layout.groupBy || ''} onChange={e => { setCollapsed(new Set()); setSel(null); changeLayout(l => ({ ...l, groupBy: e.target.value || null })) }}>
              <option value="">None</option>
              {ordered.filter(c => c.key !== '@submitted').map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select></label>
          <label className="fs-tsel"><span>Freeze</span>
            <select value={layout.frozen || 0} onChange={e => changeLayout(l => ({ ...l, frozen: Number(e.target.value) }))}>
              <option value={0}>Name</option><option value={1}>Name + 1</option><option value={2}>Name + 2</option><option value={3}>Name + 3</option>
            </select></label>
          <span className="fs-tpop">
            <button type="button" className="fm-btn fm-sm" disabled={off} aria-expanded={menu === 'newcol'} onClick={() => setMenu(m => (m === 'newcol' ? null : 'newcol'))}><Plus size={14} aria-hidden="true" /> Column</button>
            {menu === 'newcol' && (
              <div className="fs-pop fs-newcol" role="group" aria-label="New staff column">
                <p className="fm-hint">A column for your team, like Lot assignment or Processed. Students never see it.</p>
                <input autoFocus aria-label="Column name" placeholder="Column name" value={newCol.label} maxLength={60} onChange={e => setNewCol(c => ({ ...c, label: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') addStaffColumn() }} />
                <select aria-label="Column type" value={newCol.type} onChange={e => setNewCol(c => ({ ...c, type: e.target.value }))}>{SHEET_STAFF_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
                {newCol.type === 'choice' && <input aria-label="Options" placeholder="Options, separated by commas" value={newCol.options} onChange={e => setNewCol(c => ({ ...c, options: e.target.value }))} />}
                <button type="button" className="fm-btn fm-sm fm-pri" disabled={!newCol.label.trim()} onClick={addStaffColumn}>Add column</button>
              </div>
            )}
          </span>
        </div>
        <span className={`fs-save${save === 'error' ? ' fs-save-bad' : ''}`} aria-live="polite">{off ? 'View only' : save === 'saving' ? 'Saving…' : save === 'error' ? 'Not saved' : 'All changes saved'}</span>
      </div>

      <div className="fs-tools">
        <input className="fs-search" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search names and answers" aria-label="Search the answers" />
        <button type="button" className="fm-btn fm-sm" onClick={() => setAdding({ key: data.columns[0]?.key || '@school', value: '' })}>Add a filter</button>
        <div className="fs-colmenu">
          <button type="button" className="fm-btn fm-sm" aria-expanded={menu === 'columns'} onClick={() => setMenu(m => (m === 'columns' ? null : 'columns'))}>Columns{hidden.size ? ` (${hidden.size} hidden)` : ''}</button>
          {menu === 'columns' && (
            <div className="fs-pop" role="group" aria-label="Show columns">
              {ordered.map(c => (
                <label key={c.key} className="fs-popitem"><input type="checkbox" checked={!hidden.has(c.key)} onChange={() => changeLayout(l => ({ ...l, hidden: hidden.has(c.key) ? l.hidden.filter(k => k !== c.key) : [...l.hidden, c.key] }))} /><span>{c.label}{c.earlier ? ' (earlier version)' : ''}{c.staff ? ' · staff' : ''}</span></label>
              ))}
            </div>
          )}
        </div>
        <span className="fs-count">{rows.length === data.rows.length ? `${rows.length} ${rows.length === 1 ? 'response' : 'responses'}` : `${rows.length} of ${data.rows.length}`}</span>
        <button type="button" className="fm-btn fm-sm fm-pri" onClick={exportXlsx} disabled={exporting || !rows.length}>{exporting ? 'Exporting…' : 'Export to Excel'}</button>
      </div>

      {adding && (
        <div className="fs-addfilter" role="group" aria-label="New filter">
          <select aria-label="Column" value={adding.key} onChange={e => setAdding({ key: e.target.value, value: '' })}>
            {ordered.filter(c => c.key !== '@submitted').map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
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

      <div className="fm-card fs-frame" ref={frameRef} tabIndex={0} onKeyDown={onKey} onScroll={followEditor} aria-label="Answers, one row per person. Arrow keys move, Enter edits.">
        <table className="fs-table fs-fixed">
          <colgroup>{gridCols.map(c => <col key={c.key} style={{ width: width(c.key) }} />)}</colgroup>
          <thead><tr>
            {gridCols.map(c => {
              const active = sort.key === c.key
              return (
                <th key={c.key} scope="col" className={`aspire-th fs-th${c.earlier ? ' fs-earlier' : ''}${c.staff ? ' fs-staff' : ''}${dragCol && dragCol !== c.key && c.key !== '@name' ? ' fs-dropok' : ''}`}
                  style={{ ...cellStyle(null, width(c.key)), ...stickyStyle(c.key, 4) }}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  draggable={c.key !== '@name'} onDragStart={e => { setDragCol(c.key); try { e.dataTransfer.setData('text/plain', c.key) } catch { /* Firefox needs data */ } }} onDragEnd={() => setDragCol(null)}
                  onDragOver={e => { if (dragCol) e.preventDefault() }} onDrop={e => { e.preventDefault(); dropColumn(c.key) }}>
                  <button type="button" className="fs-sortbtn" onClick={() => setSort(s => (s.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' }))}
                    aria-label={`Sort by ${c.label}`}>{c.earlier ? `${c.label} (earlier)` : c.label}{active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button>
                  {c.staff && editable && <button type="button" className="fs-colx" title="Delete this staff column" aria-label={`Delete the column ${c.label}`} onClick={() => removeStaffColumn(c.key)}>×</button>}
                  <span className="fs-resize" onMouseDown={e => startResize(e, c.key)} aria-hidden="true" />
                </th>
              )
            })}
          </tr></thead>
          <tbody>
            {!rows.length && <tr><td className="fs-none" colSpan={gridCols.length}>No answers match. <button type="button" className="fm-link" onClick={() => { setFilters([]); setSearch('') }}>Show all</button></td></tr>}
            {(groups || [{ label: null, rows }]).map(g => (
              <GroupBlock key={g.label ?? '@all'} group={g} grouped={!!groups} collapsed={collapsed.has(g.label)} colSpan={gridCols.length}
                onToggle={() => { setSel(null); setCollapsed(s => { const n = new Set(s); if (n.has(g.label)) n.delete(g.label); else n.add(g.label); return n }) }}>
                {!collapsed.has(g.label) && g.rows.map(row => {
                  const r = rowIndex.get(row.id)
                  return (
                    <tr key={row.id} className="fs-row">
                      {gridCols.map((col, c) => {
                        const f = row.format?.[col.key]
                        const corr = row.corrected?.[col.key]
                        const isEditing = editing && editing.rowId === row.id && editing.key === col.key
                        const Cell = col.key === '@name' ? 'th' : 'td'
                        return (
                          <Cell key={col.key} data-cell={`${row.id}|${col.key}`} scope={col.key === '@name' ? 'row' : undefined} style={{ ...cellStyle(f, width(col.key)), ...stickyStyle(col.key) }}
                            className={`fs-cell${col.key === '@name' ? ' fs-name' : ''}${isSelected(r, c) ? ' fs-sel' : ''}${corr ? ' fs-corrected' : ''}${col.key === '@submitted' ? ' fs-when' : ''}${isEditing ? ' fs-editing' : ''}`}
                            onMouseDown={e => { if (isEditing) return; if (e.shiftKey) e.preventDefault(); frameRef.current?.focus({ preventScroll: true }); setSel(s => (e.shiftKey && s ? { ...s, focus: { r, c } } : { anchor: { r, c }, focus: { r, c } })) }}
                            onDoubleClick={() => startEdit(row, col)}
                            title={corr ? `Corrected by ${corr.by || 'staff'} on ${stamp(corr.at)}. Submitted: ${corr.original == null ? '(blank)' : Array.isArray(corr.original) ? corr.original.join('; ') : corr.original}${corr.reason ? `. Why: ${corr.reason}` : ''}` : undefined}>
                            {isEditing
                              ? <Editor col={col} editing={editing} setEditing={setEditing} onSave={commitEdit} onCancel={() => { setEditing(null); frameRef.current?.focus({ preventScroll: true }) }} name={row.name} />
                              : col.key === '@name'
                                ? <><button type="button" className="fs-open" onClick={() => onOpen?.({ id: row.id, name: row.name, email: row.email })}>{row.name || row.email}</button><small>{row.email}</small></>
                                : col.staff && col.type === 'check'
                                  ? <span className="fs-check" aria-label={row.cells[col.key] ? 'Checked' : 'Not checked'}>{row.cells[col.key] ? '✓' : ''}</span>
                                  : <>{shown(row, col.key)}{corr && <span className="fs-corrtag">Corrected</span>}</>}
                          </Cell>
                        )
                      })}
                    </tr>
                  )
                })}
              </GroupBlock>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fm-hint fs-help">Click a cell to select it, Shift-click to select a range, double-click or press Enter to edit. Drag a header to move a column, drag its right edge to resize. Corrections change the Sheet and the Excel export; each person&apos;s submitted answers and filed PDF stay as they sent them.</p>
    </div>
  )
}

function GroupBlock({ group, grouped, collapsed, colSpan, onToggle, children }) {
  if (!grouped) return children
  return (
    <>
      <tr className="fs-grouprow">
        <td colSpan={colSpan}>
          <button type="button" className="fs-groupbtn" aria-expanded={!collapsed} onClick={onToggle}>
            {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            <b>{group.label}</b><span>{group.rows.length}</span>
          </button>
        </td>
      </tr>
      {children}
    </>
  )
}

/** The in-cell editor: a staff value, or a correction to a submitted answer. */
function Editor({ col, editing, setEditing, onSave, onCancel, name }) {
  const set = (draft) => setEditing(e => ({ ...e, draft }))
  const keys = (e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } if (e.key === 'Enter' && !e.shiftKey && col.type !== 'paragraph') { e.preventDefault(); onSave() } }
  const hasOther = (col.options || []).includes('Other')
  const opts = (col.options || []).filter(o => o !== 'Other')
  let control
  if (!col.staff && (col.type === 'choice' || col.type === 'dropdown')) {
    const isOther = isOtherValue(editing.draft)
    control = (<>
      <select autoFocus value={isOther ? '__other' : (editing.draft || '')} onChange={e => set(e.target.value === '__other' ? otherValue('') : e.target.value)} onKeyDown={keys}>
        <option value="">(blank)</option>{opts.map(o => <option key={o} value={o}>{o}</option>)}{hasOther && <option value="__other">Other…</option>}
      </select>
      {isOther && <input value={otherText(editing.draft)} placeholder="Other" onChange={e => set(otherValue(e.target.value))} onKeyDown={keys} />}
    </>)
  } else if (col.type === 'checkboxes') {
    const list = Array.isArray(editing.draft) ? editing.draft : []
    control = <div className="fs-checks">{opts.map(o => <label key={o}><input type="checkbox" checked={list.includes(o)} onChange={e => set(e.target.checked ? [...list, o] : list.filter(x => x !== o))} />{o}</label>)}</div>
  } else if (col.type === 'paragraph') control = <textarea autoFocus rows={4} value={editing.draft || ''} onChange={e => set(e.target.value)} onKeyDown={keys} />
  else if (col.type === 'date') control = <input autoFocus type="date" value={editing.draft || ''} onChange={e => set(e.target.value)} onKeyDown={keys} />
  else if (col.type === 'number') control = <input autoFocus type="number" value={editing.draft ?? ''} onChange={e => set(e.target.value)} onKeyDown={keys} />
  else if (col.staff && col.type === 'choice') control = <select autoFocus value={editing.draft || ''} onChange={e => set(e.target.value)} onKeyDown={keys}><option value="">(blank)</option>{(col.options || []).map(o => <option key={o} value={o}>{o}</option>)}</select>
  else control = <input autoFocus value={editing.draft || ''} onChange={e => set(e.target.value)} onKeyDown={keys} />
  const a = editing.anchor
  const box = a ? { position: 'fixed', top: Math.max(8, a.top - 2), left: Math.max(8, Math.min(a.left - 2, window.innerWidth - 316)) } : null
  return (
    <div className="fs-editor" style={box || undefined} onMouseDown={e => e.stopPropagation()} onFocus={e => { if (e.target.tagName === 'INPUT' && e.target.type === 'text' && !e.target.dataset.seen) { e.target.dataset.seen = '1'; e.target.select() } }}
      role="group" aria-label={col.staff ? `Edit ${col.label}` : `Correct ${name}'s answer to ${col.label}`}>
      {control}
      {!col.staff && <>
        <input className="fs-reason" value={editing.reason} maxLength={500} placeholder="Why (optional)" onChange={e => setEditing(x => ({ ...x, reason: e.target.value }))} onKeyDown={keys} />
        <small>Changes the Sheet only. {name}&apos;s submitted answer and PDF stay as sent.</small>
      </>}
      <span className="fs-edacts"><button type="button" className="fm-btn fm-sm fm-pri" onClick={onSave}>{col.staff ? 'Save' : 'Correct'}</button><button type="button" className="fm-link" onClick={onCancel}>Cancel</button></span>
    </div>
  )
}
