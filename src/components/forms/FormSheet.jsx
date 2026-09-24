// src/components/forms/FormSheet.jsx
//
// FORM-SHEET-1 (2026-09-24, Owner: "monitor the results from an excel like or smartsheet like
// view"): Responses > Sheet. One row per submission, one column per question, read live from
// the answers every time it opens. Search, filters (a choice column filters by its options,
// "Other" by any Other answer; any other column by text), sort on every header, show or hide
// columns, click a row for that person's full answers and PDF, and Export to Excel of exactly
// what is shown.
//
// Unlike the DataSheet canon, this grid SCROLLS sideways inside its own frame: a form can ask
// twenty questions, and a spreadsheet that drops columns to fit is not a spreadsheet. The name
// column and the header row stay put while it scrolls.
import { useEffect, useMemo, useRef, useState } from 'react'
import { cellMatches } from '../../lib/forms/formModel'
import SortHeader from '../shared/SortHeader'
import { formStaff } from './formsApi'

const BASE = [
  { key: '@school', label: 'School' },
  { key: '@submitted', label: 'Submitted' },
]
const stamp = (iso) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
const valueOf = (row, key) => key === '@name' ? row.name : key === '@school' ? row.school : key === '@submitted' ? row.submittedAt : row.cells[key]

export default function FormSheet({ formId, onOpen, notify }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState([])            // [{ key, value }]
  const [adding, setAdding] = useState(null)            // { key, value } while a filter is being built
  const [sort, setSort] = useState({ key: '@submitted', dir: 'desc' })
  const [hidden, setHidden] = useState(() => new Set())
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let live = true
    formStaff('sheet', { id: formId }).then(r => { if (live) setData(r) }).catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [formId])

  // The Columns menu closes on a click elsewhere or Escape, like any menu.
  const menuRef = useRef(null)
  useEffect(() => {
    if (!columnsOpen) return undefined
    const away = (e) => { if (!menuRef.current?.contains(e.target)) setColumnsOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setColumnsOpen(false) }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [columnsOpen])

  const allColumns = useMemo(() => [...BASE, ...(data?.columns || [])], [data])
  const columns = allColumns.filter(c => !hidden.has(c.key))
  const columnOf = (key) => allColumns.find(c => c.key === key)

  const rows = useMemo(() => {
    if (!data) return []
    const cols = [...BASE, ...data.columns]
    const needle = search.trim().toLowerCase()
    const out = data.rows.filter(r => {
      if (needle && ![r.name, r.email, r.school, ...Object.values(r.cells)].some(v => String(v || '').toLowerCase().includes(needle))) return false
      return filters.every(f => cellMatches(cols.find(c => c.key === f.key), valueOf(r, f.key), f.value))
    })
    const sign = sort.dir === 'asc' ? 1 : -1
    return out.sort((a, b) => {
      const x = valueOf(a, sort.key) || '', y = valueOf(b, sort.key) || ''
      if (!x && y) return 1
      if (x && !y) return -1
      return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) * sign
    })
  }, [data, search, filters, sort])

  const onSort = (key) => setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  const toggleColumn = (key) => setHidden(h => { const n = new Set(h); if (n.has(key)) n.delete(key); else n.add(key); return n })

  const exportXlsx = async () => {
    setExporting(true)
    try {
      const r = await formStaff('sheet_xlsx', { id: formId, rowIds: rows.map(x => x.id), columnKeys: columns.filter(c => !c.key.startsWith('@')).map(c => c.key) })
      const bytes = Uint8Array.from(atob(r.xlsx), ch => ch.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url; a.download = r.fileName; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
    } catch (e) { notify?.(e.message, 'err') } finally { setExporting(false) }
  }

  if (error) return <p className="fm-err" role="alert">{error}</p>
  if (!data) return <p className="fm-hint">Loading the answers…</p>
  if (!data.rows.length) return <div className="fm-card fs-empty"><p className="fm-hint">No one has submitted this form yet. Answers appear here as they come in.</p></div>

  const addCol = adding ? columnOf(adding.key) : null
  return (
    <div className="fs">
      <div className="fs-tools">
        <input className="fs-search" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search names and answers" aria-label="Search the answers" />
        <button type="button" className="fm-btn fm-sm" onClick={() => setAdding({ key: data.columns[0]?.key || '@school', value: '' })}>Add a filter</button>
        <div className="fs-colmenu" ref={menuRef}>
          <button type="button" className="fm-btn fm-sm" aria-expanded={columnsOpen} onClick={() => setColumnsOpen(o => !o)}>Columns{hidden.size ? ` (${hidden.size} hidden)` : ''}</button>
          {columnsOpen && (
            <div className="fs-pop" role="group" aria-label="Show columns">
              {allColumns.map(c => (
                <label key={c.key} className="fs-popitem"><input type="checkbox" checked={!hidden.has(c.key)} onChange={() => toggleColumn(c.key)} /><span>{c.label}{c.earlier ? ' (earlier version)' : ''}</span></label>
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
            {allColumns.filter(c => c.key !== '@submitted').map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          {addCol?.options
            ? <select aria-label="Value" value={adding.value} onChange={e => setAdding(a => ({ ...a, value: e.target.value }))}>
                <option value="">Choose…</option>{addCol.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            : <input aria-label="Contains" placeholder="Contains…" value={adding.value} onChange={e => setAdding(a => ({ ...a, value: e.target.value }))} />}
          <button type="button" className="fm-btn fm-sm fm-pri" disabled={!adding.value} onClick={() => { setFilters(f => [...f, adding]); setAdding(null) }}>Apply</button>
          <button type="button" className="fm-link" onClick={() => setAdding(null)}>Cancel</button>
        </div>
      )}
      {filters.length > 0 && (
        <div className="fm-chips" role="group" aria-label="Filters">
          {filters.map((f, i) => (
            <span key={`${f.key}-${i}`} className="fs-filter">{columnOf(f.key)?.label}: {f.value}
              <button type="button" aria-label={`Remove the filter ${columnOf(f.key)?.label}: ${f.value}`} onClick={() => setFilters(fs => fs.filter((_, j) => j !== i))}>×</button></span>
          ))}
          <button type="button" className="fm-link" onClick={() => setFilters([])}>Show all</button>
        </div>
      )}

      <div className="fm-card fs-frame" tabIndex={0} aria-label="Answers, one row per person">
        <table className="fs-table">
          <thead><tr>
            <SortHeader sortKey="@name" sortBy={sort.key} sortDir={sort.dir} onSort={onSort} thClassName="aspire-th fs-th fs-sticky">Name</SortHeader>
            {columns.map(c => (
              <SortHeader key={c.key} sortKey={c.key} sortBy={sort.key} sortDir={sort.dir} onSort={onSort} thClassName={`aspire-th fs-th${c.earlier ? ' fs-earlier' : ''}`}>{c.earlier ? `${c.label} (earlier)` : c.label}</SortHeader>
            ))}
          </tr></thead>
          <tbody>
            {!rows.length && <tr><td className="fs-none" colSpan={columns.length + 1}>No answers match. <button type="button" className="fm-link" onClick={() => { setFilters([]); setSearch('') }}>Show all</button></td></tr>}
            {rows.map(r => (
              <tr key={r.id} className="fs-row" onClick={() => onOpen?.({ id: r.id, name: r.name, email: r.email })}>
                <th scope="row" className="fs-sticky fs-name"><button type="button" className="fs-open" onClick={(e) => { e.stopPropagation(); onOpen?.({ id: r.id, name: r.name, email: r.email }) }}>{r.name || r.email}</button><small>{r.email}</small></th>
                {columns.map(c => <td key={c.key} className={c.key === '@submitted' ? 'fs-when' : undefined}>{c.key === '@submitted' ? stamp(r.submittedAt) : (valueOf(r, c.key) || '')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
