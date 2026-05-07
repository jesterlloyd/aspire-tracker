import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/utils'
import EditScheduleModal from './EditScheduleModal'


const DAYS_WEEK = ['Mon','Tue','Wed','Thu','Fri']
const DAYS_ALL  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

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

function getMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1)
  const lastDay  = new Date(year, month + 1, 0)
  const startDow = firstDay.getDay() // 0=Sun
  const daysBack = startDow === 0 ? 6 : startDow - 1
  const start = new Date(firstDay)
  start.setDate(firstDay.getDate() - daysBack)
  const endDow = lastDay.getDay()
  const daysForward = endDow === 0 ? 0 : 7 - endDow
  const end = new Date(lastDay)
  end.setDate(lastDay.getDate() + daysForward)
  const days = []
  const cur = new Date(start)
  while (cur <= end) { days.push(new Date(cur)); cur.setDate(cur.getDate() + 1) }
  return days
}

// Use local date components to avoid UTC-offset day shifts
function fmtDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseLocalDate(dateStr) {
  if (!dateStr) return null
  const [y, mo, d] = dateStr.split('-').map(Number)
  return new Date(y, mo - 1, d)
}

function fmtTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ampm}`
}

function blockColor(student, rubrics) {
  const sRubrics = rubrics.filter(r => r.student_id === student.id)
  if (sRubrics.some(r => r.status === 'Completed'))   return { bg:'#dcfce7', color:'#166534', label:'Completed' }
  if (sRubrics.some(r => r.status === 'In Progress')) return { bg:'#fef3c7', color:'#92400e', label:'In Progress' }
  return { bg:'#dceff8', color:'#1d2567', label:'Scheduled' }
}

const SCHOOL_ACRONYMS = {
  'Azusa Pacific University':'APU','Cal State LA':'CSULA','California State University, Los Angeles':'CSULA',
  'Cal State Long Beach':'CSULB','California State University, Long Beach':'CSULB',
  'Cal State Northridge':'CSUN','California State University, Northridge':'CSUN',
  'UCLA':'UCLA','University of California, Los Angeles':'UCLA',
  'West Coast University Anaheim':'WCU-A','West Coast University, Orange County':'WCU-A',
  'West Coast University North Hollywood':'WCU-NH','West Coast University, North Hollywood':'WCU-NH',
}

function getInitials(fullName) {
  const parts = fullName.trim().split(' ').filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return (parts[0]?.[0] || '').toUpperCase()
}

function getInterviewerDisplay(s) {
  if (!s || !s.trim()) return ''
  const names = s.split(',').map(n => n.trim()).filter(Boolean)
  if (!names.length) return ''
  if (names.length === 1) return getInitials(names[0])
  if (names.length === 2) return `${getInitials(names[0])}, ${getInitials(names[1])}`
  return `${getInitials(names[0])} +${names.length - 1}`
}

function buildSchedulingMailto(student) {
  const to = student.school_email || ''
  const subject = 'Schedule Your ASPIRE Interview'
  const body = `Dear ${student.first_name || 'ASPIRE Student'},

Thank you for completing your ASPIRE Student Profile. The next step in the process is to schedule your interview with the Nursing Professional Development team.

Please use the link below to view available times and select one that works for your schedule:

https://aspire-tracker.vercel.app/interview-schedule

When prompted, enter your school email address to access your scheduling page.

Your interview will be conducted via Microsoft Teams. The meeting link will be sent to you separately after you book your slot.

If you have any questions, please don't hesitate to reach out.

Warm regards,
Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN
Brawerman Nursing Institute | Cedars-Sinai Medical Center
JesterLloyd.Bautista@cshs.org | 310-248-8964`
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export default function WeekCalendar({
  students, rubrics, cohortId,
  sessions = [], slots = [],
  onOpenRubric, onSchedule, onManageInterviewers, onStudentUpdate, onUpdateSession,
}) {
  const [calMode,           setCalMode]           = useState('week')
  const [weekOffset,        setWeekOffset]        = useState(0)
  const [monthDate,         setMonthDate]         = useState(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() } })
  const [editingStudent,    setEditingStudent]    = useState(null)
  const [selectedDay,       setSelectedDay]       = useState(null) // Day Detail Panel

  const scheduledStudents = students.filter(s => s.interview_scheduled_date)

  // ── Week view ─────────────────────────────────────────────
  const dates = getWeekDates(weekOffset)
  const start = dates[0], end = dates[4]
  const weekLabel = `${start.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${end.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`

  // ── Month view ────────────────────────────────────────────
  const monthDays = getMonthGrid(monthDate.year, monthDate.month)
  const monthLabel = new Date(monthDate.year, monthDate.month, 1)
    .toLocaleDateString('en-US', { month:'long', year:'numeric' })

  const prevMonth = () => setMonthDate(p => {
    const m = p.month - 1
    return m < 0 ? { year: p.year - 1, month: 11 } : { ...p, month: m }
  })
  const nextMonth = () => setMonthDate(p => {
    const m = p.month + 1
    return m > 11 ? { year: p.year + 1, month: 0 } : { ...p, month: m }
  })
  const goToday = () => {
    if (calMode === 'week') setWeekOffset(0)
    else { const n = new Date(); setMonthDate({ year: n.getFullYear(), month: n.getMonth() }) }
  }

  const todayStr = fmtDate(new Date()) // local date string, no UTC shift

  // ── Day Detail Panel data ─────────────────────────────────
  const dayStudents = selectedDay
    ? scheduledStudents.filter(s => s.interview_scheduled_date === selectedDay)
        .sort((a, b) => (a.interview_scheduled_time || '').localeCompare(b.interview_scheduled_time || ''))
    : []
  const daySlots = selectedDay
    ? slots.filter(sl => sl.slot_date === selectedDay && !sl.is_booked)
        .sort((a, b) => a.slot_time.localeCompare(b.slot_time))
    : []

  const getSessionForStudent = (studentId) =>
    sessions.find(s => s.student_id === studentId) || null

  const handleTeamsToggle = async (student, checked) => {
    const session = getSessionForStudent(student.id)
    if (session) {
      await supabase.from('interview_sessions').update({ teams_meeting_booked: checked }).eq('id', session.id)
    } else {
      await supabase.from('interview_sessions').insert({
        student_id: student.id, cohort_id: cohortId,
        session_number: 1, teams_meeting_booked: checked,
      })
    }
    if (onUpdateSession) onUpdateSession(student.id, { teams_meeting_booked: checked })
  }

  const handleSendSchedulingLink = (student) => {
    const a = document.createElement('a')
    a.href = buildSchedulingMailto(student)
    a.click()
  }

  return (
    <div className="week-cal">
      {/* ── Header ── */}
      <div className="week-cal-header">
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {/* Week/Month toggle */}
          <div style={{ display:'flex', border:'1px solid var(--border)', borderRadius:6, overflow:'hidden' }}>
            {['week','month'].map(m => (
              <button key={m} onClick={() => setCalMode(m)}
                style={{
                  padding:'4px 12px', fontSize:12, fontWeight:600, border:'none', cursor:'pointer',
                  background: calMode === m ? 'var(--nightfall)' : '#fff',
                  color: calMode === m ? '#fff' : 'var(--text-secondary)',
                }}>
                {m === 'week' ? 'Week' : 'Month'}
              </button>
            ))}
          </div>
          {/* Navigation */}
          <div className="week-cal-nav">
            <button className="week-cal-arrow" onClick={() => calMode === 'week' ? setWeekOffset(o => o - 1) : prevMonth()}>‹</button>
            <span className="week-cal-label">{calMode === 'week' ? weekLabel : monthLabel}</span>
            <button className="week-cal-arrow" onClick={() => calMode === 'week' ? setWeekOffset(o => o + 1) : nextMonth()}>›</button>
            <button className="week-cal-arrow" onClick={goToday} title="Today" style={{ fontSize:11 }}>Today</button>
          </div>
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

      {/* ── Week view grid ── */}
      {calMode === 'week' && (
        <div className="week-cal-grid">
          {dates.map((d, i) => {
            const dateStr = fmtDate(d)
            const isToday = todayStr === dateStr
            const dayStudents = scheduledStudents.filter(s => s.interview_scheduled_date === dateStr)
              .sort((a, b) => (a.interview_scheduled_time || '').localeCompare(b.interview_scheduled_time || ''))
            return (
              <div key={i} className={`week-cal-col${isToday ? ' week-cal-today' : ''}`}>
                <div className="week-cal-day-label">
                  <span className="week-cal-day-name">{DAYS_WEEK[i]}</span>
                  <span className="week-cal-day-num">{d.getDate()}</span>
                </div>
                <div className="week-cal-blocks">
                  {dayStudents.length === 0 ? (
                    <div className="week-cal-empty">No interviews</div>
                  ) : dayStudents.map(s => {
                    const c = blockColor(s, rubrics)
                    const acronym = SCHOOL_ACRONYMS[s.school] || null
                    const ivInits = getInterviewerDisplay(s.interview_assigned_interviewers)
                    return (
                      <div key={s.id} className="week-cal-block"
                        style={{ background: c.bg, color: c.color }}
                        onClick={() => setEditingStudent(s)}
                        title={`${displayName(s)} · ${s.school || ''} · ${s.interview_scheduled_time || ''}`}>
                        <div className="week-cal-block-name">
                          {s.last_name}{s.last_name && s.first_name ? ', ' : ''}{s.first_name}
                        </div>
                        <div className="week-cal-block-meta">
                          {acronym && <span className="week-cal-school-pill">{acronym}</span>}
                          {ivInits && <span className="week-cal-iv-pill">{ivInits}</span>}
                          {s.interview_scheduled_time && <span className="week-cal-block-time">{s.interview_scheduled_time}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Month view grid ── */}
      {calMode === 'month' && (
        <div style={{ position:'relative' }}>
          <div className="month-cal-header-row">
            {DAYS_ALL.map(d => <div key={d} className="month-cal-dow">{d}</div>)}
          </div>
          <div className="month-cal-grid">
            {monthDays.map((d, i) => {
              const dateStr   = fmtDate(d)
              const isToday   = today === dateStr
              const inMonth   = d.getMonth() === monthDate.month
              const isPast    = dateStr < todayStr
              const interviews = scheduledStudents.filter(s => s.interview_scheduled_date === dateStr)
              const daySlots  = slots.filter(sl => sl.slot_date === dateStr && !sl.is_booked)
              const isSelected = selectedDay === dateStr
              return (
                <div key={i} className={`month-cal-day${isSelected ? ' month-cal-day-sel' : ''}`}
                  style={{ opacity: !inMonth || isPast ? 0.45 : 1 }}
                  onClick={() => setSelectedDay(prev => prev === dateStr ? null : dateStr)}>
                  <div className="month-cal-day-num-wrap">
                    <span className={`month-cal-day-num${isToday ? ' month-cal-today-num' : ''}`}>
                      {d.getDate()}
                    </span>
                  </div>
                  {/* Interview pills */}
                  {interviews.slice(0, 2).map(s => {
                    const c = blockColor(s, rubrics)
                    return (
                      <div key={s.id} className="month-cal-pill"
                        style={{ background: c.bg, color: c.color }}>
                        {s.last_name} {s.interview_scheduled_time || ''}
                      </div>
                    )
                  })}
                  {interviews.length > 2 && (
                    <div className="month-cal-pill" style={{ background:'#f3f4f6', color:'#6b7280' }}>
                      +{interviews.length - 2} more
                    </div>
                  )}
                  {/* Available slot pills */}
                  {daySlots.slice(0, 1).map(sl => (
                    <div key={sl.id} className="month-cal-slot-pill">
                      {fmtTime(sl.slot_time)} {sl.interviewer_name ? getInitials(sl.interviewer_name) : ''}
                    </div>
                  ))}
                  {daySlots.length > 1 && (
                    <div className="month-cal-slot-pill" style={{ color:'#9ca3af' }}>
                      +{daySlots.length - 1} open
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Day Detail Panel ── */}
          {selectedDay && (
            <div className="day-detail-panel" onClick={e => e.stopPropagation()}>
              <div className="day-detail-header">
                <div style={{ fontSize:18, fontWeight:700, color:'var(--nightfall)' }}>
                  {parseLocalDate(selectedDay)?.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' })}
                </div>
                <button onClick={() => setSelectedDay(null)}
                  style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'var(--text-secondary)' }}>×</button>
              </div>

              <div className="day-detail-body">
                {/* Scheduled Interviews */}
                <div className="day-detail-section-title">Scheduled Interviews</div>
                {dayStudents.length === 0
                  ? <p style={{ fontSize:13, color:'#9ca3af', margin:'6px 0 14px' }}>No interviews scheduled for this day.</p>
                  : dayStudents.map(s => {
                      const session   = getSessionForStudent(s.id)
                      const isBooked  = !!session?.teams_meeting_booked
                      return (
                        <div key={s.id} className="day-detail-entry"
                          style={{ borderLeft: isBooked ? '3px solid #16a34a' : '3px solid var(--border)' }}>
                          <div style={{ fontSize:14, fontWeight:600, color:'var(--nightfall)' }}>
                            {displayName(s)}
                          </div>
                          <div style={{ fontSize:12, color:'var(--text-secondary)', marginTop:2 }}>
                            {s.school} · {fmtTime(s.interview_scheduled_time)}
                            {s.interview_duration_minutes ? ` (${s.interview_duration_minutes} min)` : ''}
                            {s.interview_assigned_interviewers ? ` · ${s.interview_assigned_interviewers}` : ''}
                          </div>
                          <label style={{ display:'flex', alignItems:'center', gap:6, marginTop:6, fontSize:12, cursor:'pointer' }}>
                            <input type="checkbox" checked={isBooked}
                              onChange={e => handleTeamsToggle(s, e.target.checked)} />
                            <span style={{ color: isBooked ? '#166534' : 'var(--text-secondary)' }}>
                              {isBooked ? '✓ Teams Meeting Booked' : 'Teams Meeting Booked'}
                            </span>
                          </label>
                        </div>
                      )
                    })
                }

                {/* Available Slots */}
                <div className="day-detail-section-title" style={{ marginTop:14 }}>Available Slots</div>
                {daySlots.length === 0
                  ? <p style={{ fontSize:13, color:'#9ca3af', margin:'6px 0' }}>No open slots for this day.</p>
                  : daySlots.map(sl => (
                      <div key={sl.id} className="day-detail-slot">
                        <span style={{ fontSize:13, fontWeight:500, color:'var(--nightfall)' }}>{fmtTime(sl.slot_time)}</span>
                        <span style={{ fontSize:12, color:'var(--text-secondary)' }}> · {sl.duration_minutes} min</span>
                        {sl.interviewer_name && <span style={{ fontSize:12, color:'var(--text-secondary)' }}> · {sl.interviewer_name}</span>}
                      </div>
                    ))
                }
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
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
