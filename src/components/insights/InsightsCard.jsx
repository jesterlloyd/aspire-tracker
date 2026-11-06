// ASPIRE-INSIGHTS-1: the two pieces every Insights surface is built from, the card a chart sits
// in (Table view, CSV, hover tips, fill to the row) and the headline tile. The full page and each
// portal's At a Glance section render these same components, so they cannot drift apart.

import { useMemo, useRef, useState } from 'react'
import DataSheet from '../shared/DataSheet'
import { toCsv, csvFileName } from '../../lib/insights/insightsView'
import { useBox } from './useWidth'

function downloadCsv(id, columns, rows) {
  const blob = new Blob([toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = csvFileName(id)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/**
 * table: { columns: [{ key, label, align? }], rows: [{ id, ...cells }] }. The same rows build the
 * Table view and the CSV, so the two cannot disagree.
 */
export function ChartCard({ id, title, sub, span = 12, table, note, legend, nat, children }) {
  const [asTable, setAsTable] = useState(false)
  const [bodyRef, box] = useBox()
  const width = box.w
  const [tip, setTip] = useState(null)
  const cardRef = useRef(null)
  const hasTable = Boolean(table?.columns?.length)
  const fill = Boolean(nat) && !(asTable && hasTable)

  const onMove = e => {
    const t = e.target.closest?.('[data-tip]')
    if (!t) { if (tip) setTip(null); return }
    const box = cardRef.current.getBoundingClientRect()
    setTip({ text: t.getAttribute('data-tip'), x: e.clientX - box.left + 14, y: e.clientY - box.top + 14 })
  }
  const onFocus = e => {
    const t = e.target.closest?.('[data-tip]')
    if (!t) return
    const box = cardRef.current.getBoundingClientRect()
    const r = t.getBoundingClientRect()
    setTip({ text: t.getAttribute('data-tip'), x: r.left - box.left + 12, y: r.bottom - box.top + 6 })
  }

  const columns = useMemo(() => (table?.columns || []).map((c, i) => ({
    key: c.key, label: c.label, align: c.align || (i ? 'right' : undefined),
    min: i ? 72 : 140, grow: i ? 0.7 : 2, priority: i < 3 ? 1 : 2,
    sortValue: row => row[`${c.key}__sort`] ?? row[c.key],
  })), [table])

  return (
    <section className={`ins-sheet ins-card ins-c${span}`} id={`ins-${id}`} aria-labelledby={`ins-h-${id}`} ref={cardRef}>
      <div className="ins-ch">
        <div className="ins-ct">
          <h2 id={`ins-h-${id}`}>{title}</h2>
          {sub && <p className="ins-sub">{sub}</p>}
        </div>
        {hasTable && (
          <div className="ins-acts">
            <button type="button" className="ins-act" aria-pressed={asTable} onClick={() => setAsTable(v => !v)}>Table</button>
            <button type="button" className="ins-act"
              onClick={() => downloadCsv(id, table.columns, table.rows.map(r => table.columns.map(c => r[`${c.key}__csv`] ?? r[c.key])))}>CSV</button>
          </div>
        )}
      </div>
      {/* A chart with a natural height fills the card: the body grows to the row, reserves that
          height, and the drawing is laid inside it at the measured size. */}
      <div className={`ins-body${fill ? ' ins-body-fill' : ''}`} ref={bodyRef} style={fill ? { minHeight: nat(width) } : undefined}
        onPointerMove={onMove} onPointerLeave={() => setTip(null)} onFocus={onFocus} onBlur={() => setTip(null)}>
        {asTable && hasTable
          ? <DataSheet level="plain" columns={columns} rows={table.rows} rowKey={r => r.id} aria-label={`${title}, table`} pageRows={50} />
          : fill ? <div className="ins-plot">{children(width, Math.max(nat(width), box.h))}</div> : children(width, 0)}
      </div>
      {legend && !asTable && (
        <div className="ins-legend">
          {legend.map(([name, color]) => <span key={name}><i style={{ background: color }} aria-hidden="true" />{name}</span>)}
        </div>
      )}
      {note && <p className="ins-note">{note}</p>}
      {tip && <div className="ins-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
    </section>
  )
}

/** The app's KPI card, at rest: a figure, not a filter, so it is not a button and does not lift. */
export function Tile({ k, v, d, hero, empty, accent = 'nightfall' }) {
  return (
    <div className={`ins-tile ins-a-${accent}${hero ? ' ins-hero' : ''}${empty ? ' ins-empty' : ''}`}>
      <div className="ins-tv">{v}</div>
      <div className="ins-tk">{k}</div>
      <div className="ins-td">{d || ' '}</div>
    </div>
  )
}
