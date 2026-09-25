// HOME-1 (2026-09-24): Needs you, one queue across every module.
//
// `sources` is one entry per module the viewer may use: { key, status, group, retry },
// status 'loading' | 'error' | 'ready'. A loading source shows a skeleton, a failed one
// says so with a Retry link and never blocks the others, a ready source with nothing in
// it is hidden. Every row is a real <button> that opens its source screen; no row carries
// a decision (table canon §2). Paired banding is the sheet's own `--band`.

import { useState } from 'react'
import { PenLine, MessageSquare, Send, ListChecks, CalendarDays, Kanban, Check } from 'lucide-react'
import HomeCard, { CardLink } from './HomeCard'
import { orderGroups, needsYouSummary, filterChips, nextFilter, visibleGroups, rowsFor } from '../../lib/home/needsYouModel'

const ICON = { signatures: PenLine, messages: MessageSquare, reviewRelease: Send, formsDocs: ListChecks, interviews: CalendarDays, placement: Kanban }
const NAMES = { signatures: 'Signatures', messages: 'Messages', reviewRelease: 'Review & Release', formsDocs: 'Forms and documents', interviews: 'Interviews', placement: 'Placement and rotation' }

export function Pill({ tone = 'grey', children, className = '' }) {
  return <span className={`hm-pill hm-pill-${tone} ${className}`.trim()}>{children}</span>
}

export default function NeedsYou({ sources = [], onNavigate, updatedLabel = 'just now', order }) {
  const [filter, setFilter] = useState('all')
  const [live, setLive] = useState('')

  const ready = sources.filter(s => s.status === 'ready')
  const loading = sources.filter(s => s.status === 'loading')
  const failed = sources.filter(s => s.status === 'error')
  const groups = orderGroups(ready.map(s => s.group))
  const summary = needsYouSummary(groups)
  const chips = filterChips(groups)
  const allEmpty = loading.length === 0 && failed.length === 0 && groups.length === 0
  const shown = visibleGroups(groups, filter)

  const pick = (key, label) => {
    const next = nextFilter(filter, key)
    setFilter(next)
    setLive(next === 'all' ? 'Showing all areas' : `Showing ${label}`)
  }

  return (
    <HomeCard id="hm-needs" title="Needs you" material="folder" order={order}
      cap={allEmpty ? null : summary.caption}
      right={<span className="hm-card-cap">Updated {updatedLabel}</span>}
    >
      <p className="sr-only" aria-live="polite">{live}</p>

      {!allEmpty && groups.length > 0 && (
        <div className="hm-filters" aria-label="Filter by area">
          {chips.map(c => (
            <button key={c.key} type="button" className="hm-fchip" aria-pressed={filter === c.key} onClick={() => pick(c.key, c.label)}>
              {c.label} <b>{c.count}</b>
            </button>
          ))}
        </div>
      )}

      {allEmpty ? (
        <div className="hm-caught" role="status">
          <div className="hm-caught-ok" aria-hidden="true"><Check size={22} /></div>
          <h3>All caught up</h3>
          <p>Nothing across signatures, messages, forms, surveys, interviews or placement needs you right now.</p>
        </div>
      ) : (
        <div className="hm-groups" data-count={Math.min(3, shown.length + (filter === 'all' ? loading.length + failed.length : 0))}>
          {shown.map((g, gi) => {
            const I = ICON[g.key] || Check
            const cellCount = shown.length + (filter === 'all' ? loading.length + failed.length : 0)
            const { rows, more, wide } = rowsFor(g, cellCount)
            return (
              <div key={g.key} className={`hm-grp hm-grp-${gi % 2 ? 'odd' : 'even'}${wide ? ' hm-grp-wide' : ''}`}>
                <div className="hm-grp-h">
                  <span className="hm-gi" aria-hidden="true"><I size={15} /></span>
                  <div className="hm-grp-name">
                    <h3>{g.name}</h3>
                    <div className="hm-grp-sub">{g.sub}</div>
                  </div>
                  <div className="hm-cnt">{g.pills.map((p, i) => <Pill key={i} tone={p.tone}>{p.text}</Pill>)}</div>
                </div>
                <ul className="hm-rows">
                  {rows.map((r, i) => (
                    <li key={r.id} data-band={i % 4 < 2 ? 1 : 0}>
                      <button type="button" className="hm-row" title={r.title} onClick={() => onNavigate?.(r.to)}>
                        <span className="hm-row-t">{r.title}</span>
                        <span className="hm-row-m">{r.meta}</span>
                        <Pill tone={r.pill.tone} className="hm-row-pill">{r.pill.text}</Pill>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="hm-grp-more">
                  <CardLink label={more > 0 ? `${g.open.label} (${more} more)` : g.open.label} to={g.open.to} onNavigate={onNavigate} />
                </div>
              </div>
            )
          })}
          {filter === 'all' && loading.map(s => (
            <div key={`sk-${s.key}`} className="hm-grp hm-grp-skeleton" aria-busy="true" aria-label={`Loading ${NAMES[s.key] || s.key}`}>
              <div className="hm-grp-h"><span className="hm-gi hm-sk" /><div className="hm-grp-name"><span className="hm-sk hm-sk-t" /><span className="hm-sk hm-sk-s" /></div></div>
              <div className="hm-sk hm-sk-row" /><div className="hm-sk hm-sk-row" /><div className="hm-sk hm-sk-row" />
            </div>
          ))}
          {filter === 'all' && failed.map(s => (
            <div key={`err-${s.key}`} className="hm-grp hm-grp-error" role="alert">
              <div className="hm-grp-h">
                <div className="hm-grp-name"><h3>Couldn&rsquo;t load {NAMES[s.key] || s.key}</h3>
                  <div className="hm-grp-sub">The rest of the queue is unaffected.</div></div>
              </div>
              <button type="button" className="hm-link" onClick={() => s.retry?.()}>Retry</button>
            </div>
          ))}
        </div>
      )}
    </HomeCard>
  )
}
