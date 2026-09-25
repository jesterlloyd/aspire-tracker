// HOME-1 (2026-09-24): Today, a card with two tabs (an ARIA tablist).
//
// Schedule (default): today's planner items with the time or "All day" in mono, a bold
// title, a muted detail line and a type tag; the item in progress carries a 3px navy bar.
// On campus today: students with a shift today, grouped by shift with the canonical
// window times; the group in progress says "On shift now", a finished one "Ended". Each
// student row opens the profile; the footer opens Rotation > Activity.

import { useId, useRef, useState } from 'react'
import HomeCard, { CardLink } from './HomeCard'
import StudentAvatar from '../StudentAvatar'

export default function TodayCard({
  dateLabel, schedule = [], scheduleLoading = false, campus = { groups: [], count: 0 }, campusLoading = false,
  studentsById = new Map(), onNavigate, onOpenStudent, order,
}) {
  const [tab, setTab] = useState('schedule')
  const uid = useId()
  const tabsRef = useRef(null)
  const ids = { schedule: `${uid}-tab-schedule`, campus: `${uid}-tab-campus` }
  const panels = { schedule: `${uid}-panel-schedule`, campus: `${uid}-panel-campus` }

  const onTabKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = tab === 'schedule' ? 'campus' : 'schedule'
    setTab(next)
    tabsRef.current?.querySelector(`#${CSS.escape(ids[next])}`)?.focus()
  }

  return (
    <HomeCard id="hm-today" title="Today" cap={dateLabel} material="notepad" order={order}
      right={<CardLink label="Open calendar" to="/interviews" onNavigate={onNavigate} />}
    >
      <div className="hm-ttabs" role="tablist" aria-label="Today views" ref={tabsRef} onKeyDown={onTabKey}>
        <button type="button" role="tab" id={ids.schedule} aria-selected={tab === 'schedule'} aria-controls={panels.schedule} tabIndex={tab === 'schedule' ? 0 : -1} onClick={() => setTab('schedule')}>
          Schedule <b>{schedule.length}</b>
        </button>
        <button type="button" role="tab" id={ids.campus} aria-selected={tab === 'campus'} aria-controls={panels.campus} tabIndex={tab === 'campus' ? 0 : -1} onClick={() => setTab('campus')}>
          On campus today <b>{campus.count}</b>
        </button>
      </div>

      <div id={panels.schedule} role="tabpanel" aria-labelledby={ids.schedule} hidden={tab !== 'schedule'} className="hm-agenda-panel">
        {scheduleLoading ? (
          <div className="hm-agenda-empty" aria-busy="true"><span className="hm-sk hm-sk-row" /><span className="hm-sk hm-sk-row" /></div>
        ) : schedule.length === 0 ? (
          <p className="hm-agenda-empty">Nothing on the calendar today.</p>
        ) : (
          <ol className="hm-agenda">
            {schedule.map(r => (
              <li key={r.id} className={r.inProgress ? 'is-now' : ''}>
                <time className="hm-agenda-time">{r.time}</time>
                <button type="button" className="hm-agenda-body" onClick={() => onNavigate?.(r.to)}>
                  <span className="hm-agenda-t">{r.title}</span>
                  {r.meta ? <span className="hm-agenda-m">{r.meta}</span> : null}
                </button>
                <span className={`hm-tag hm-tag-${r.tone}`}>{r.tag}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div id={panels.campus} role="tabpanel" aria-labelledby={ids.campus} hidden={tab !== 'campus'} className="hm-campus-panel">
        {campusLoading ? (
          <div className="hm-agenda-empty" aria-busy="true"><span className="hm-sk hm-sk-row" /><span className="hm-sk hm-sk-row" /></div>
        ) : campus.groups.length === 0 ? (
          <p className="hm-agenda-empty">No shifts scheduled or logged today.</p>
        ) : campus.groups.map(g => (
          <ul key={g.key} className="hm-campus" aria-label={g.label}>
            <li className="hm-oc-h">
              <span>{g.label}</span>
              <span className={`hm-oc-state hm-oc-${g.state}`}>{g.state === 'live' ? 'On shift now' : g.state === 'ended' ? 'Ended' : g.state === 'later' ? 'Later today' : ''}</span>
            </li>
            {g.rows.map(s => (
              <li key={s.id}>
                <button type="button" className="hm-oc-row" onClick={() => onOpenStudent?.(s.id)}>
                  {studentsById.get(s.id)?.headshot_url
                    ? <StudentAvatar student={studentsById.get(s.id)} size={28} />
                    : <span className="hm-av" aria-hidden="true">{s.initials}</span>}
                  <span className="hm-oc-body"><span className="hm-oc-nm">{s.name}</span><span className="hm-oc-m">{s.meta}</span></span>
                  <span className="hm-oc-hours">{s.hours}</span>
                </button>
              </li>
            ))}
          </ul>
        ))}
        <div className="hm-campus-foot"><CardLink label="Open shift log" to="/rotation/activity" onNavigate={onNavigate} /></div>
      </div>
    </HomeCard>
  )
}
