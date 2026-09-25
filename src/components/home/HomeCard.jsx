// HOME-1 (2026-09-24): one card head for every section of the home page.
//
// A card is `.snap` (the canon's full-width section card) plus `.hm-card`, so its corner,
// edge and margins are the tokens; the material it wears in Classic is a second class the
// page's stylesheet keys on (`hm-folder`, `hm-notepad`, `hm-report`, `hm-sheet`, `hm-tape`)
// and turns off under :root[data-style="modern"]. Titles are Title Case; captions are
// sentences or figures.

import { ArrowRight } from 'lucide-react'

export function CardLink({ label, to, onNavigate, className = '' }) {
  return (
    <button type="button" className={`hm-link ${className}`.trim()} onClick={() => onNavigate?.(to)}>
      {label} <ArrowRight size={13} aria-hidden="true" />
    </button>
  )
}

export default function HomeCard({ id, title, cap, right, material = '', className = '', children, order, hidden = false, headExtra = null, rings = false, clip = false }) {
  if (hidden) return null
  const hid = `${id}-h`
  return (
    <section
      id={id}
      className={`snap hm-card ${material ? `hm-${material}` : ''} ${className}`.trim()}
      aria-labelledby={hid}
      data-sec={id}
      style={order != null ? { order } : undefined}
    >
      {rings && <span className="pl-rings" aria-hidden="true"><i /><i /></span>}
      {clip && <span className="hm-clip" aria-hidden="true" />}
      <div className="hm-card-h">
        <h2 id={hid} className="hm-card-title">{title}</h2>
        {cap ? <span className="hm-card-cap">{cap}</span> : null}
        {right ? <div className="hm-card-r">{right}</div> : null}
      </div>
      {headExtra}
      {children}
    </section>
  )
}
