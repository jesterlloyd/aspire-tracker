import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/utils'
import { ASPIRE_STATUS_CONFIG } from '../lib/constants'
import EditScheduleModal from './EditScheduleModal'
import AvailabilityManagerModal from './AvailabilityManagerModal'

const DAYS_WEEK = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function getWeekDates(offset = 0) {
  const today = new Date()
  const dow = today.getDay()
  const sun = new Date(today)
  sun.setDate(today.getDate() - dow + offset * 7)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sun); d.setDate(sun.getDate() + i); return d
  })
}

function getMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1)
  const lastDay  = new Date(year, month + 1, 0)
  const daysBack    = firstDay.getDay()        // Sunday-first: 0=Sun no padding
  const daysForward = lastDay.getDay() === 6 ? 0 : 6 - lastDay.getDay()
  const start = new Date(firstDay); start.setDate(firstDay.getDate() - daysBack)
  const end   = new Date(lastDay);  end.setDate(lastDay.getDate() + daysForward)
  const days = []; const cur = new Date(start)
  while (cur <= end) { days.push(new Date(cur)); cur.setDate(cur.getDate() + 1) }
  return days
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function parseLocalDate(s) {
  if (!s || typeof s !== 'string') return null
  const p = s.split('-'); if (p.length !== 3) return null
  const [y,m,d] = p.map(Number); if (isNaN(y)||isNaN(m)||isNaN(d)) return null
  return new Date(y, m-1, d)
}
function fmtTime(t) {
  if (!t) return ''
  const [h,m] = t.split(':').map(Number); const ampm = h>=12?'PM':'AM'
  return `${h%12||12}:${String(m).padStart(2,'0')} ${ampm}`
}

function blockColor(student, rubrics) {
  const r = rubrics.filter(r => r.student_id === student.id)
  if (r.some(r => r.status === 'Completed'))   return { bg:'#dcfce7', color:'#166534' }
  if (r.some(r => r.status === 'In Progress')) return { bg:'#fef3c7', color:'#92400e' }
  return { bg:'#dceff8', color:'#1d2567' }
}

const SCHOOL_ACRONYMS = {
  'Azusa Pacific University':'APU','Cal State LA':'CSULA','California State University, Los Angeles':'CSULA',
  'Cal State Long Beach':'CSULB','California State University, Long Beach':'CSULB',
  'Cal State Northridge':'CSUN','California State University, Northridge':'CSUN',
  'UCLA':'UCLA','University of California, Los Angeles':'UCLA',
  'West Coast University Anaheim':'WCU-A','West Coast University, Orange County':'WCU-A',
  'West Coast University North Hollywood':'WCU-NH','West Coast University, North Hollywood':'WCU-NH',
}

function getInitials(n) {
  const p = n.trim().split(' ').filter(Boolean)
  return p.length >= 2 ? (p[0][0]+p[p.length-1][0]).toUpperCase() : (p[0]?.[0]||'').toUpperCase()
}
function getInterviewerDisplay(s) {
  if (!s?.trim()) return ''
  const names = s.split(',').map(n=>n.trim()).filter(Boolean)
  if (!names.length) return ''
  if (names.length === 1) return getInitials(names[0])
  if (names.length === 2) return `${getInitials(names[0])}, ${getInitials(names[1])}`
  return `${getInitials(names[0])} +${names.length-1}`
}

// ── FIX 1: Unified block popover used by both week and month views ──────────
function InterviewBlockPopover({ student, session, position, onClose, onEditSchedule, onTeamsToggle }) {
  const isBooked = !!session?.teams_meeting_booked
  const cfg = ASPIRE_STATUS_CONFIG[student.status] || { bg:'#f3f4f6', text:'#6b7280', border:'#d1d5db' }
  return (
    <div
      style={{
        position:'fixed', top:position.top, left:position.left,
        width:320, maxHeight:480, overflowY:'auto',
        background:'var(--pearl)', border:'1px solid #e5e7eb',
        borderRadius:12, boxShadow:'0 8px 24px rgba(0,0,0,0.12)',
        zIndex:200, animation:'cal-popover-in 150ms ease',
      }}
      onClick={e => e.stopPropagation()}>
      {/* Close */}
      <button onClick={onClose}
        style={{ position:'absolute', top:10, right:12, background:'none', border:'none',
          fontSize:18, cursor:'pointer', color:'var(--text-secondary)', lineHeight:1, zIndex:1 }}>×</button>

      {/* Student name + school */}
      <div style={{ padding:'14px 40px 10px 16px' }}>
        <div style={{ fontSize:16, fontWeight:700, color:'var(--nightfall)' }}>
          {student.last_name}{student.last_name && student.first_name ? ', ' : ''}{student.first_name}
        </div>
        <div style={{ fontSize:13, color:'#6b7280', marginTop:3 }}>
          {student.school}{student.program_type ? ` · ${student.program_type}` : ''}
        </div>
        {/* Interview details */}
        <div style={{ fontSize:13, color:'var(--raven)', marginTop:8, lineHeight:1.5 }}>
          {student.interview_scheduled_date}
          {student.interview_scheduled_time ? ` · ${fmtTime(student.interview_scheduled_time)}` : ''}
          {student.interview_duration_minutes ? ` · ${student.interview_duration_minutes} min` : ''}
          {student.interview_assigned_interviewers ? ` · ${student.interview_assigned_interviewers}` : ''}
        </div>
        {/* ASPIRE Status pill */}
        {student.status && (
          <span style={{ display:'inline-block', marginTop:8, fontSize:11, fontWeight:700,
            padding:'2px 9px', borderRadius:20, background:cfg.bg, color:cfg.text,
            border:`1px solid ${cfg.border}` }}>
            {student.status}
          </span>
        )}
      </div>

      <div style={{ height:1, background:'#e5e7eb', margin:'4px 0' }} />

      {/* Teams Meeting Booked */}
      <label style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'10px 16px', cursor:'pointer' }}>
        <span style={{ fontSize:13, fontWeight:600, color:'var(--raven)' }}>Teams Meeting Booked</span>
        <input type="checkbox" checked={isBooked}
          onChange={e => onTeamsToggle(student, e.target.checked)}
          style={{ width:16, height:16, cursor:'pointer', accentColor:'#16a34a' }} />
      </label>

      <div style={{ height:1, background:'#e5e7eb', margin:'4px 0' }} />

      {/* Edit Schedule button */}
      <div style={{ padding:'10px 16px 14px' }}>
        <button onClick={() => { onClose(); onEditSchedule(student) }}
          style={{ width:'100%', padding:'8px 14px', fontSize:13, fontWeight:600,
            background:'var(--pearl)', border:'1.5px solid var(--nightfall)',
            color:'var(--nightfall)', borderRadius:6, cursor:'pointer' }}>
          Edit Schedule
        </button>
      </div>
    </div>
  )
}

// ── Pill used by BOTH week and month views ────────────────────────────────────
function InterviewPill({ student, session, rubrics, onClick }) {
  const c       = blockColor(student, rubrics)
  const acronym = SCHOOL_ACRONYMS[student.school] || null
  const ivInits = getInterviewerDisplay(student.interview_assigned_interviewers)
  const needsDot = !session?.teams_meeting_booked
  return (
    <div className="cal-iv-pill" style={{ position:'relative', background:c.bg, color:c.color }}
      onClick={onClick}>
      {needsDot && (
        <span style={{ position:'absolute', top:-3, right:-3, width:8, height:8,
          borderRadius:'50%', background:'#dc1e34', border:'1.5px solid #fff',
          display:'block', zIndex:2 }} />
      )}
      <div className="cal-iv-pill-name">{student.last_name}</div>
      <div className="cal-iv-pill-meta">
        {acronym  && <span>{acronym}</span>}
        {ivInits  && <span>{ivInits}</span>}
        {student.interview_scheduled_time && <span>{student.interview_scheduled_time}</span>}
      </div>
    </div>
  )
}

export default function WeekCalendar({
  students, rubrics, cohortId,
  sessions = [], slots = [],
  onOpenRubric, onSchedule, onManageInterviewers, onStudentUpdate, onUpdateSession,
}) {
  const [calMode,        setCalMode]        = useState('week')
  const [weekOffset,     setWeekOffset]     = useState(0)
  const [monthDate,      setMonthDate]      = useState(() => { const n=new Date(); return {year:n.getFullYear(),month:n.getMonth()} })
  const [editingStudent, setEditingStudent] = useState(null)
  const [showAvailMgr,   setShowAvailMgr]   = useState(false)
  // FIX 1: unified block popover
  const [blockPopover,   setBlockPopover]   = useState(null) // { student, position }
  const blockPopoverRef  = useRef(null)

  const scheduledStudents = students.filter(s => s.interview_scheduled_date)

  // Close block popover on outside click
  useEffect(() => {
    if (!blockPopover) return
    const handler = e => {
      if (blockPopoverRef.current && !blockPopoverRef.current.contains(e.target))
        setBlockPopover(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [blockPopover])

  const dates     = getWeekDates(weekOffset)
  const monthDays = getMonthGrid(monthDate.year, monthDate.month)
  const weekLabel = `${dates[0].toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${dates[6].toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`
  const monthLabel = new Date(monthDate.year, monthDate.month, 1).toLocaleDateString('en-US',{month:'long',year:'numeric'})

  const prevMonth = () => setMonthDate(p=>{const m=p.month-1; return m<0?{year:p.year-1,month:11}:{...p,month:m}})
  const nextMonth = () => setMonthDate(p=>{const m=p.month+1; return m>11?{year:p.year+1,month:0}:{...p,month:m}})
  const goToday   = () => { if(calMode==='week') setWeekOffset(0); else {const n=new Date();setMonthDate({year:n.getFullYear(),month:n.getMonth()})} }
  const todayStr  = fmtDate(new Date())

  const getSessionForStudent = id => sessions.find(s => s.student_id === id) || null

  const handleTeamsToggle = async (student, checked) => {
    const session = getSessionForStudent(student.id)
    if (session) {
      await supabase.from('interview_sessions').update({ teams_meeting_booked: checked }).eq('id', session.id)
    } else {
      await supabase.from('interview_sessions').insert({
        student_id: student.id, cohort_id: cohortId, session_number: 1, teams_meeting_booked: checked,
      })
    }
    if (onUpdateSession) onUpdateSession(student.id, { teams_meeting_booked: checked })
    // Optimistically update the in-memory record so the dot disappears immediately
    setBlockPopover(prev => prev ? { ...prev, session: { ...(prev.session||{}), teams_meeting_booked: checked } } : null)
  }

  // FIX 1: compute popover position near the clicked block
  const handleBlockClick = (student, e) => {
    e.stopPropagation()
    if (blockPopover?.student.id === student.id) { setBlockPopover(null); return }
    const rect   = e.currentTarget.getBoundingClientRect()
    const calEl  = document.querySelector('.week-cal')
    const calRect = calEl ? calEl.getBoundingClientRect() : rect
    const popW = 320, popMaxH = 480, margin = 8
    const isRightHalf = (rect.left + rect.width/2) > (calRect.left + calRect.width/2)
    let left, top
    if (!isRightHalf && rect.right + margin + popW <= window.innerWidth) {
      left = rect.right + margin; top = rect.top
    } else if (isRightHalf && rect.left - margin - popW >= 0) {
      left = rect.left - margin - popW; top = rect.top
    } else {
      left = rect.left; top = rect.bottom + margin
    }
    left = Math.max(margin, Math.min(left, window.innerWidth  - popW    - margin))
    top  = Math.max(margin, Math.min(top,  window.innerHeight - popMaxH - margin))
    setBlockPopover({ student, position: { top, left }, session: getSessionForStudent(student.id) })
  }

  return (
    <div className="week-cal">
      {/* Header */}
      <div className="week-cal-header">
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ display:'flex', border:'1px solid var(--border)', borderRadius:6, overflow:'hidden' }}>
            {['week','month'].map(m => (
              <button key={m} onClick={() => setCalMode(m)}
                style={{ padding:'4px 12px', fontSize:12, fontWeight:600, border:'none', cursor:'pointer',
                  background: calMode===m?'var(--nightfall)':'#fff',
                  color: calMode===m?'#fff':'var(--text-secondary)' }}>
                {m==='week'?'Week':'Month'}
              </button>
            ))}
          </div>
          <div className="week-cal-nav">
            <button className="week-cal-arrow" onClick={()=>calMode==='week'?setWeekOffset(o=>o-1):prevMonth()}>‹</button>
            <span className="week-cal-label">{calMode==='week'?weekLabel:monthLabel}</span>
            <button className="week-cal-arrow" onClick={()=>calMode==='week'?setWeekOffset(o=>o+1):nextMonth()}>›</button>
            <button className="week-cal-arrow" onClick={goToday} style={{fontSize:11}}>Today</button>
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {onManageInterviewers && (
            <button className="btn btn-outline-modal" style={{fontSize:12,padding:'5px 12px',background:'#fff'}}
              onClick={onManageInterviewers}>👥 Manage Interviewers</button>
          )}
          <button className="btn btn-outline-modal" style={{fontSize:12,padding:'5px 12px',background:'#fff'}}
            onClick={()=>setShowAvailMgr(true)}>📅 Manage Availability</button>
          <button className="btn btn-outline-modal" style={{fontSize:12,padding:'5px 12px',background:'#fff'}}
            onClick={onSchedule}>+ Schedule Interview</button>
        </div>
      </div>

      {/* Week view — 7 columns Sun–Sat */}
      {calMode === 'week' && (
        <div className="week-cal-grid week-cal-grid-7">
          {dates.map((d, i) => {
            const dateStr  = fmtDate(d)
            const isToday  = todayStr === dateStr
            const dayStuds = scheduledStudents.filter(s => s.interview_scheduled_date === dateStr)
              .sort((a,b) => (a.interview_scheduled_time||'').localeCompare(b.interview_scheduled_time||''))
            return (
              <div key={i} className={`week-cal-col${isToday?' week-cal-today':''}`}>
                <div className="week-cal-day-label">
                  <span className="week-cal-day-name">{DAYS_WEEK[i]}</span>
                  <span className="week-cal-day-num">{d.getDate()}</span>
                </div>
                <div className="week-cal-blocks">
                  {dayStuds.length === 0
                    ? <div className="week-cal-empty">No interviews</div>
                    : dayStuds.map(s => (
                        <InterviewPill key={s.id} student={s} session={getSessionForStudent(s.id)} rubrics={rubrics}
                          onClick={e => handleBlockClick(s, e)} />
                      ))
                  }
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Month view — Sun-first */}
      {calMode === 'month' && (
        <>
          <div className="month-cal-header-row">
            {DAYS_WEEK.map(d => <div key={d} className="month-cal-dow">{d}</div>)}
          </div>
          <div className="month-cal-grid">
            {monthDays.map((d, i) => {
              const dateStr    = fmtDate(d)
              const isToday    = todayStr === dateStr
              const inMonth    = d.getMonth() === monthDate.month
              const isPast     = dateStr < todayStr
              const interviews = scheduledStudents.filter(s => s.interview_scheduled_date === dateStr)
              const openSlots  = slots.filter(sl => sl.slot_date === dateStr && !sl.is_booked)
              return (
                <div key={i} className="month-cal-day" style={{ opacity: !inMonth || isPast ? 0.45 : 1 }}>
                  <div className="month-cal-day-num-wrap">
                    <span className={`month-cal-day-num${isToday?' month-cal-today-num':''}`}>{d.getDate()}</span>
                  </div>
                  {/* FIX 2: same pill content as week view */}
                  {interviews.map(s => (
                    <InterviewPill key={s.id} student={s} session={getSessionForStudent(s.id)} rubrics={rubrics}
                      onClick={e => handleBlockClick(s, e)} />
                  ))}
                  {openSlots.slice(0,1).map(sl => (
                    <div key={sl.id} className="month-cal-slot-pill">
                      {fmtTime(sl.slot_time)} {sl.interviewer_name ? getInitials(sl.interviewer_name) : ''}
                    </div>
                  ))}
                  {openSlots.length > 1 && (
                    <div className="month-cal-slot-pill" style={{color:'#9ca3af'}}>+{openSlots.length-1} open</div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* FIX 1: unified block popover — same content in both views */}
      {blockPopover && (
        <div ref={blockPopoverRef}>
          <InterviewBlockPopover
            student={blockPopover.student}
            session={blockPopover.session ?? getSessionForStudent(blockPopover.student.id)}
            position={blockPopover.position}
            onClose={() => setBlockPopover(null)}
            onEditSchedule={s => setEditingStudent(s)}
            onTeamsToggle={handleTeamsToggle}
          />
        </div>
      )}

      {editingStudent && (
        <EditScheduleModal
          student={editingStudent}
          onClose={() => setEditingStudent(null)}
          onSaved={async () => { if(onStudentUpdate) await onStudentUpdate(); setEditingStudent(null) }}
          onOpenRubric={id => { setEditingStudent(null); onOpenRubric && onOpenRubric(id) }}
        />
      )}
      {showAvailMgr && cohortId && (
        <AvailabilityManagerModal cohortId={cohortId} onClose={() => setShowAvailMgr(false)} />
      )}
    </div>
  )
}
