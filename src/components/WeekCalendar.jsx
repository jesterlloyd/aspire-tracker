import { useState } from 'react'
import { displayName } from '../lib/utils'
import EditScheduleModal from './EditScheduleModal'

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

const SCHOOL_ACRONYMS = {
  'Azusa Pacific University': 'APU',
  'Cal State LA': 'CSULA',
  'California State University, Los Angeles': 'CSULA',
  'Cal State Long Beach': 'CSULB',
  'California State University, Long Beach': 'CSULB',
  'Cal State Northridge': 'CSUN',
  'California State University, Northridge': 'CSUN',
  'UCLA': 'UCLA',
  'University of California, Los Angeles': 'UCLA',
  'West Coast University Anaheim': 'WCU-A',
  'West Coast University, Orange County': 'WCU-A',
  'West Coast University North Hollywood': 'WCU-NH',
  'West Coast University, North Hollywood': 'WCU-NH',
}

function interviewerInitials(assignedStr) {
  if (!assignedStr || !assignedStr.trim()) return null
  const names = assignedStr.split(',').map(n => n.trim()).filter(Boolean)
  if (names.length === 0) return null
  const initials = n => {
    const parts = n.split(' ').filter(Boolean)
    // Use first letter of first word + first letter of last word
    return parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)
  }
  if (names.length === 1) return initials(names[0]).toUpperCase()
  if (names.length === 2) return `${initials(names[0])}, ${initials(names[1])}`.toUpperCase()
  return `${initials(names[0])} +${names.length - 1}`.toUpperCase()
}

export default function WeekCalendar({ students, rubrics, onOpenRubric, onSchedule, onManageInterviewers, onStudentUpdate }) {
  const [weekOffset,     setWeekOffset]     = useState(0)
  const [editingStudent, setEditingStudent] = useState(null)
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
        <div style={{ display:'flex', gap:8 }}>
          {onManageInterviewers && (
            <button className="btn btn-outline-modal" style={{ fontSize:12, padding:'5px 12px', background:'#fff' }}
              onClick={onManageInterviewers}>
              👥 Manage Interviewers
            </button>
          )}
          <button className="btn btn-outline-modal" style={{ fontSize:12, padding:'5px 12px', background:'#fff' }}
            onClick={onSchedule}>
            + Schedule Interview
          </button>
        </div>
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
                  const acronym  = SCHOOL_ACRONYMS[s.school] || null
                  const ivInits  = interviewerInitials(s.interview_assigned_interviewers)
                  return (
                    <div key={s.id} className="week-cal-block"
                      style={{ background: c.bg, color: c.color }}
                      onClick={() => setEditingStudent(s)}
                      title={`${displayName(s)} · ${s.school || ''} · ${s.interview_scheduled_time || ''} — Click to edit schedule`}>
                      <div className="week-cal-block-name">{last}{last && first ? ', ' : ''}{first}</div>
                      <div className="week-cal-block-meta">
                        {acronym && (
                          <span className="week-cal-school-pill">{acronym}</span>
                        )}
                        {ivInits && (
                          <span className="week-cal-iv-pill">{ivInits}</span>
                        )}
                        {s.interview_scheduled_time && (
                          <span className="week-cal-block-time">{s.interview_scheduled_time}</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      {editingStudent && (
        <EditScheduleModal
          student={editingStudent}
          onClose={() => setEditingStudent(null)}
          onSaved={async () => { if (onStudentUpdate) await onStudentUpdate(); setEditingStudent(null) }}
          onOpenRubric={id => { setEditingStudent(null); onOpenRubric && onOpenRubric(id) }}
        />
      )}
    </div>
  )
}
