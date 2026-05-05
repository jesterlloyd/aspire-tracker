import { useState } from 'react'
import { displayName } from '../lib/utils'

const DAYS = ['Mon','Tue','Wed','Thu','Fri']

function getWeekDates(offset = 0) {
  const today = new Date()
  const dow = today.getDay()
  const toMon = dow === 0 ? -6 : 1 - dow
  const mon = new Date(today)
  mon.setDate(today.getDate() + toMon + offset * 7)
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(mon)
    d.setDate(mon.getDate() + i)
    return d
  })
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10)
}

function blockColor(student, rubrics) {
  const sRubrics = rubrics.filter(r => r.student_id === student.id)
  if (sRubrics.some(r => r.status === 'Completed'))    return { bg: '#dcfce7', color: '#166534', label: 'Completed' }
  if (sRubrics.some(r => r.status === 'In Progress'))  return { bg: '#fef3c7', color: '#92400e', label: 'In Progress' }
  return { bg: '#dceff8', color: '#1d2567', label: 'Scheduled' }
}

export default function WeekCalendar({ students, rubrics, onOpenSession, onSchedule }) {
  const [weekOffset, setWeekOffset] = useState(0)
  const dates = getWeekDates(weekOffset)

  const start = dates[0]
  const end   = dates[4]
  const label = `${start.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${end.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`

  const scheduledStudents = students.filter(s => s.interview_scheduled_date)

  return (
    <div className="week-cal">
      <div className="week-cal-header">
        <div className="week-cal-nav">
          <button className="week-cal-arrow" onClick={() => setWeekOffset(o => o - 1)}>‹</button>
          <span className="week-cal-label">{label}</span>
          <button className="week-cal-arrow" onClick={() => setWeekOffset(o => o + 1)}>›</button>
          <button className="week-cal-arrow" onClick={() => setWeekOffset(0)} title="Today" style={{ fontSize:11 }}>Today</button>
        </div>
        <button className="btn btn-outline-modal" style={{ fontSize:12, padding:'5px 12px', background:'#fff' }}
          onClick={onSchedule}>
          + Schedule Interview
        </button>
      </div>

      <div className="week-cal-grid">
        {dates.map((d, i) => {
          const dateStr = fmtDate(d)
          const isToday = fmtDate(new Date()) === dateStr
          const dayStudents = scheduledStudents.filter(s => s.interview_scheduled_date === dateStr)
            .sort((a, b) => (a.interview_scheduled_time || '').localeCompare(b.interview_scheduled_time || ''))

          return (
            <div key={i} className={`week-cal-col${isToday ? ' week-cal-today' : ''}`}>
              <div className="week-cal-day-label">
                <span className="week-cal-day-name">{DAYS[i]}</span>
                <span className="week-cal-day-num">{d.getDate()}</span>
              </div>
              <div className="week-cal-blocks">
                {dayStudents.length === 0 ? (
                  <div className="week-cal-empty">No interviews</div>
                ) : dayStudents.map(s => {
                  const c = blockColor(s, rubrics)
                  const last  = s.last_name  || ''
                  const first = s.first_name || ''
                  return (
                    <div key={s.id} className="week-cal-block"
                      style={{ background: c.bg, color: c.color }}
                      onClick={() => onOpenSession(s.id)}
                      title={`${displayName(s)} · ${s.interview_scheduled_time || ''}`}>
                      <div className="week-cal-block-name">{last}{last && first ? ', ' : ''}{first}</div>
                      {s.interview_scheduled_time && (
                        <div className="week-cal-block-time">{s.interview_scheduled_time}</div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
