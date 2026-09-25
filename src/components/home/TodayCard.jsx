// HOME-1 (2026-09-24): Today, a card with two views on the app's canonical SegmentedPicker
// (the Placement Board | Preceptors | Activity control), opening on the view that has
// something in it (defaultTodayView).
//
// Schedule (default): today's planner items with the time or "All day" in mono, a bold
// title, a muted detail line and a type tag; the item in progress carries a 3px navy bar.
// On campus today: students with a shift today, grouped by shift with the canonical
// window times; the group in progress says "On shift now", a finished one "Ended". Each
// student row opens the profile; the footer opens Rotation > Activity.

import { useId, useState } from 'react'
import SegmentedPicker from '../shared/SegmentedPicker'
import { defaultTodayView } from '../../lib/home/todayModel'
import HomeCard, { CardLink } from './HomeCard'

export default function TodayCard({
  dateLabel, schedule = [], scheduleLoading = false, campus = { groups: [], count: 0 }, campusLoading = false,
  // `avatarFor(id)` is handed in by the page (it returns the StudentAvatar, or null for
  // initials), so this card never imports the Supabase client and renders without one.
  avatarFor = () => null, onNavigate, onOpenStudent, order,
}) {
  // null until the person picks; until then the view follows the data as it arrives.
  const [picked, setPicked] = useState(null)
  const tab = picked ?? defaultTodayView(schedule.length, campus.count)
  const uid = useId()
  const panels = { schedule: `${uid}-panel-schedule`, campus: `${uid}-panel-campus` }

  return (
    <HomeCard id="hm-today" title="Today" cap={dateLabel} material="notepad" order={order}
      right={<CardLink label="Open calendar" to="/interviews" onNavigate={onNavigate} />}
      rings   /* the Calendars' two chrome rings (plannerCalendar.css .pl-rings), decorative */
    >
      <div className="hm-today-picker">
        <SegmentedPicker
          ariaLabel="Today views"
          value={tab}
          onChange={setPicked}
          options={[
            { value: 'schedule', label: <>Schedule<span className="hm-seg-count">{schedule.length}</span></> },
            { value: 'campus', label: <>On campus today<span className="hm-seg-count">{campus.count}</span></> },
          ]}
        />
      </div>

      <div id={panels.schedule} role="region" aria-label="Today's schedule" hidden={tab !== 'schedule'} className="hm-agenda-panel">
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

      <div id={panels.campus} role="region" aria-label="On campus today" hidden={tab !== 'campus'} className="hm-campus-panel">
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
                  {avatarFor(s.id) || <span className="hm-av" aria-hidden="true">{s.initials}</span>}
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
