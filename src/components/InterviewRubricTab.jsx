import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/utils'
import StudentAvatar from './StudentAvatar'
import RubricSession from './RubricSession'
import InterviewCalendar from './InterviewCalendar'
import TodaysInterviews from './TodaysInterviews'
import { ASPIRE_STATUS_CONFIG } from '../lib/constants'
import ScoreFlag from './ScoreFlag'
import EmptyState from './EmptyState'
import { Users, CalendarCheck, BadgeCheck, CalendarX, Flag, ThumbsUp, ClipboardList } from 'lucide-react'
import { FilterKPICard } from './KPIBand'
import { useAuth } from '../contexts/AuthContext'

function IrAvatar({ student }) {
  return (
    <td className="iv-td" style={{ width:44, paddingLeft:12, paddingRight:4 }}>
      <StudentAvatar student={student} size={32} />
    </td>
  )
}

function getStudentIvStatus(student, rubrics) {
  const sRubrics = rubrics.filter(r => r.student_id === student.id)
  if (sRubrics.some(r => r.status === 'Completed'))   return 'Completed'
  if (sRubrics.some(r => r.status === 'In Progress')) return 'In Progress'
  if (student.interview_scheduled_date)               return 'Scheduled'
  return 'Not Scheduled'
}

// Teams invite lifecycle status — drives the repurposed "Interview Status" column
function getTeamsInviteStatus(student, sessions) {
  const session = (sessions || [])
    .filter(s => s.student_id === student.id)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0]

  if (!session) return { label: 'Not scheduled', tone: 'neutral' }
  if (session.status === 'cancelled' || session.status === 'Cancelled') return { label: 'Cancelled', tone: 'neutral' }
  if (session.status === 'completed' || session.status === 'Completed')  return { label: 'Completed',  tone: 'success' }
  if (session.teams_invite_sent_at || session.teams_meeting_booked)       return { label: 'Teams invite sent', tone: 'success' }
  if (session.self_scheduled || student.interview_scheduled_date)         return { label: 'Needs Teams invite', tone: 'attention' }
  return { label: 'Not scheduled', tone: 'neutral' }
}

function TeamsInvitePill({ student, sessions }) {
  const { label, tone } = getTeamsInviteStatus(student, sessions)
  const tones = {
    neutral:   { bg: '#F6F6F2', text: '#475467', border: 'rgba(29,37,103,0.10)' },
    attention: { bg: '#FCF3F7', text: '#930045', border: 'rgba(147,0,69,0.20)' },
    success:   { bg: '#EEF7F0', text: '#2F7D5C', border: 'rgba(47,125,92,0.20)' },
  }
  const t = tones[tone] || tones.neutral
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'3px 9px', borderRadius:999, background:t.bg, color:t.text, border:`1px solid ${t.border}`, fontSize:11, fontWeight:600, fontFamily:'DM Sans, sans-serif', whiteSpace:'nowrap' }}>
      {tone === 'attention' && (
        <span style={{ width:5, height:5, borderRadius:'50%', background:'#930045', animation:'pulse-dot 1.8s ease-in-out infinite', flexShrink:0 }} />
      )}
      {label}
    </span>
  )
}

const ROW_BORDER = {
  'Completed':     '#16a34a',
  'In Progress':   '#ca8a04',
  'Scheduled':     '#1d2567',
  'Not Scheduled': '#d1d5db',
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

export default function InterviewRubricTab({
  students, rubrics, cohortId, cohort,
  sessions = [], slots = [],
  onStudentUpdate, onRubricsChange, onRefreshStudents, onManageInterviewers, onUpdateSession, onRefreshSlots,
  toast,
}) {
  const { canInterview, isViewer, userProfile } = useAuth()
  const [selectedStudentId, setSelectedStudentId] = useState(null)
  const [sortBy,            setSortBy]            = useState('last_name')
  const [sortDir,           setSortDir]           = useState('asc')
  const [activeFilter,      setActiveFilter]      = useState(null)
  const [refreshKey,        setRefreshKey]        = useState(0)
  const [calendarCollapsed,    setCalendarCollapsed]    = useState(false)
  const [calendarInterviewers, setCalendarInterviewers] = useState([])

  // Schedule scope: 'mine' | 'all'
  // Owners, Admins, and Co-Leads default to 'all'; Interviewers default to 'mine'
  const [scheduleScope, setScheduleScope] = useState(() => {
    if (userProfile?.is_owner) return 'all'
    if (userProfile?.role === 'admin') return 'all'
    if (userProfile?.role === 'co-lead' || userProfile?.role === 'co_lead') return 'all'
    return 'mine'
  })

  const triggerRefresh = useCallback(() => setRefreshKey(k => k + 1), [])

  // Re-fetch students and rubrics whenever triggerRefresh fires
  useEffect(() => {
    if (refreshKey === 0) return
    onRefreshStudents?.()
    onRubricsChange?.()
  }, [refreshKey]) // eslint-disable-line

  // Track whether the user is inside RubricSession (actively editing a rubric).
  // Used by the realtime handler to avoid triggering state refreshes that could
  // race with in-progress form edits and cause apparent data loss.
  const editingRubricRef = useRef(false)
  useEffect(() => {
    editingRubricRef.current = !!selectedStudentId
  }, [selectedStudentId])

  // ── Real-time subscriptions ───────────────────────────────────────────────
  // interview_rubrics: refresh the results table when any rubric changes,
  //   BUT only when the user is viewing the list (not actively editing).
  //   Firing onRubricsChange during an active edit session caused a re-render
  //   storm (once from persist() itself + once from realtime), creating race
  //   conditions and excessive re-renders during 30-minute interview sessions.
  // interview_sessions: when a booking is created/updated/cancelled,
  //   trigger a full refresh so the calendar remounts with fresh data.
  useEffect(() => {
    if (!cohortId) return
    const rubChannel = supabase
      .channel(`rubrics_cohort_${cohortId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'interview_rubrics', filter: `cohort_id=eq.${cohortId}` },
        () => {
          // While an interviewer is filling out a rubric, suppress realtime-driven
          // refreshes for this table — persist() already calls onRubricsChange()
          // after each successful save, so the list stays up to date when the user
          // navigates back.
          if (editingRubricRef.current) return
          onRubricsChange?.()
          // onRefreshStudents intentionally omitted: rubric changes do not affect
          // the students array (avg scores are recalculated inside handleMarkComplete
          // and written via onStudentUpdate, not by a separate student fetch).
        }
      )
      .subscribe()
    const sessChannel = supabase
      .channel(`sessions_cohort_${cohortId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'interview_sessions', filter: `cohort_id=eq.${cohortId}` },
        () => { triggerRefresh() }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(rubChannel)
      supabase.removeChannel(sessChannel)
    }
  }, [cohortId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCardClick = (key) => setActiveFilter(prev => prev === key ? null : key)

  // ── Stats ──────────────────────────────────────────────────
  const total         = students.length
  const scheduled     = students.filter(s => s.status === 'Interview Scheduled').length
  const completed     = students.filter(s => getStudentIvStatus(s, rubrics) === 'Completed').length
  // inProgress count retained in case needed elsewhere; card removed from filter UI
  const notScheduled  = students.filter(s => !s.interview_scheduled_date).length
  const flagged       = students.filter(s => s.flagged_for_second_interview).length
  const recommended   = students.filter(s => s.auto_recommendation === 'Recommend').length


  // If student selected → session (viewers see read-only, interviewers get full form)
  const selectedStudent = selectedStudentId ? students.find(s => s.id === selectedStudentId) : null
  if (selectedStudent) {
    if (isViewer) {
      // Viewers: back to list, no rubric form
      return (
        <div style={{ padding:'32px', textAlign:'center', color:'#9ca3af', fontFamily:'DM Sans,sans-serif' }}>
          <div style={{ fontSize:14, marginBottom:12 }}>Rubric submission requires Interviewer access or above.</div>
          <button onClick={() => setSelectedStudentId(null)}
            style={{ background:'#1D2567', color:'#fff', border:'none', borderRadius:8, padding:'8px 18px', fontFamily:'DM Sans,sans-serif', fontWeight:600, cursor:'pointer' }}>
            ← Back to list
          </button>
        </div>
      )
    }
    return (
      <RubricSession
        student={selectedStudent}
        rubrics={rubrics}
        cohortId={cohortId}
        onBack={() => setSelectedStudentId(null)}
        onStudentUpdate={onStudentUpdate}
        onRubricsChange={onRubricsChange}
        toast={toast}
      />
    )
  }

  // ── Sort/filter ────────────────────────────────────────────
  const toggleSort = field => {
    if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortDir('asc') }
  }
  const SortIcon = ({ field }) =>
    sortBy === field
      ? <span style={{ marginLeft:3 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
      : <span style={{ marginLeft:3, opacity:0.3 }}>↕</span>

  const baseStudents = activeFilter
    ? students.filter(s => {
        if (activeFilter === 'scheduled')     return s.status === 'Interview Scheduled'
        if (activeFilter === 'completed')     return getStudentIvStatus(s, rubrics) === 'Completed'
        if (activeFilter === 'in_progress')   return getStudentIvStatus(s, rubrics) === 'In Progress'
        if (activeFilter === 'not_scheduled') return !s.interview_scheduled_date
        if (activeFilter === 'flagged')       return !!s.flagged_for_second_interview
        if (activeFilter === 'recommended')   return s.auto_recommendation === 'Recommend'
        return true
      })
    : students

  const sorted = [...baseStudents].sort((a, b) => {
    const ivStatusOrder = { Completed:0, 'In Progress':1, Scheduled:2, 'Not Scheduled':3 }
    const teamsStatusOrder = { 'Needs Teams invite':1, 'Teams invite sent':2, Completed:3, 'Not scheduled':4, Cancelled:5 }
    let av, bv
    if (sortBy === 'last_name') {
      av = (a.last_name || a.name || '').toLowerCase(); bv = (b.last_name || b.name || '').toLowerCase()
    } else if (sortBy === 'school') {
      const sc = (a.school||'').toLowerCase().localeCompare((b.school||'').toLowerCase())
      if (sc !== 0) return sortDir === 'asc' ? sc : -sc
      av = (a.last_name || a.name || '').toLowerCase(); bv = (b.last_name || b.name || '').toLowerCase()
    } else if (sortBy === 'iv_status') {
      av = teamsStatusOrder[getTeamsInviteStatus(a, sessions).label] ?? 9
      bv = teamsStatusOrder[getTeamsInviteStatus(b, sessions).label] ?? 9
      return sortDir === 'asc' ? av - bv : bv - av
    } else if (sortBy === 'score') {
      av = parseFloat(a.avg_composite_score)||0; bv = parseFloat(b.avg_composite_score)||0
      return sortDir === 'asc' ? av - bv : bv - av
    } else { av=''; bv='' }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

  return (
    <div className="rub-tab-month">

      <TodaysInterviews
        cohortId={cohortId}
        onStartRubric={(arg) => {
          if (arg?.student?.id) setSelectedStudentId(arg.student.id)
          else if (arg?.students?.id) setSelectedStudentId(arg.students.id)
        }}
      />
      {/* Availability Calendar with collapse toggle */}
      <div style={{ marginBottom: '8px' }}>
        {/* Calendar controls row: toggle + interviewer legend pill */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          marginBottom: calendarCollapsed ? '0' : '12px',
        }}>
          {/* Show Calendar / Focus Table View toggle */}
          <button
            onClick={() => setCalendarCollapsed(p => !p)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              height: '34px', padding: '0 14px', flexShrink: 0,
              background: calendarCollapsed ? '#1D2567' : '#f3f4ff',
              border: `1px solid ${calendarCollapsed ? '#1D2567' : '#e0e7ff'}`,
              borderRadius: '8px', cursor: 'pointer',
              fontFamily: 'DM Sans', fontWeight: 600, fontSize: '12px',
              color: calendarCollapsed ? '#ffffff' : '#1D2567',
              transition: 'all 0.2s ease',
            }}
          >
            {calendarCollapsed ? (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <rect x="3" y="4" width="18" height="18" rx="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                Show Calendar
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="8" y1="6" x2="21" y2="6"/>
                  <line x1="8" y1="12" x2="21" y2="12"/>
                  <line x1="8" y1="18" x2="21" y2="18"/>
                  <line x1="3" y1="6" x2="3.01" y2="6"/>
                  <line x1="3" y1="12" x2="3.01" y2="12"/>
                  <line x1="3" y1="18" x2="3.01" y2="18"/>
                </svg>
                Focus Table View
              </>
            )}
          </button>

          {/* Interviewer legend pill — same height, scrollable if many names */}
          {!calendarCollapsed && calendarInterviewers.length > 0 && (
            <div style={{
              height: '34px', flex: 1, display: 'inline-flex', alignItems: 'center', gap: '14px',
              padding: '0 14px', background: '#F5F7FB', border: '1px solid #E5E7EB',
              borderRadius: '999px', fontFamily: 'DM Sans', fontSize: '12px',
              overflowX: 'auto', scrollbarWidth: 'thin', whiteSpace: 'nowrap',
            }}>
              <span style={{ fontWeight: 600, color: '#1D2567', paddingRight: '8px', borderRight: '1px solid #E5E7EB', flexShrink: 0 }}>
                Interviewers
              </span>
              {calendarInterviewers.map(p => {
                const parts = (p.full_name || '').trim().split(' ')
                const shortName = parts.length >= 2
                  ? `${parts[0]} ${parts[parts.length - 1][0]}.`
                  : parts[0] || '—'
                return (
                  <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: p.interviewer_color || '#1D2567', display: 'inline-block', flexShrink: 0 }} />
                    <span style={{ color: '#374151', fontWeight: 500 }}>{shortName}</span>
                  </span>
                )
              })}
            </div>
          )}

          {/* Schedule scope toggle */}
          {!calendarCollapsed && (
            <div style={{ display:'flex', alignItems:'center', background:'#F4F1EC', borderRadius:8, padding:2, fontFamily:'DM Sans, sans-serif', border:'1px solid rgba(29,37,103,0.06)', flexShrink:0 }}>
              {[
                { key:'mine', label:'My schedule' },
                { key:'all',  label:"Everyone's schedule" },
              ].map(({ key, label }) => (
                <button key={key} onClick={() => setScheduleScope(key)} style={{
                  padding:'5px 12px', fontSize:12, fontWeight:500, borderRadius:6, border:'none',
                  background: scheduleScope === key ? '#fff' : 'transparent',
                  color: scheduleScope === key ? '#1D2567' : '#475467',
                  boxShadow: scheduleScope === key ? '0 1px 2px rgba(29,37,103,0.06)' : 'none',
                  cursor:'pointer', transition:'all 0.15s', whiteSpace:'nowrap',
                }}>{label}</button>
              ))}
            </div>
          )}
        </div>
        <div style={{
          overflow: 'hidden',
          maxHeight: calendarCollapsed ? '0' : '900px',
          opacity: calendarCollapsed ? 0 : 1,
          transition: 'max-height 0.3s ease, opacity 0.2s ease',
        }}>
          <InterviewCalendar
            key={`cal-${cohortId}-${refreshKey}`}
            cohortId={cohortId}
            activeCohort={cohort}
            onDataChanged={triggerRefresh}
            onInterviewersLoaded={setCalendarInterviewers}
            scheduleScope={scheduleScope}
          />
        </div>
      </div>

      {/* 6 filter cards — color story: Nightfall=anchor, Marina=in motion, Sage=positive, Dawn=needs action, Chroma=alert */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap:10, padding:'12px 16px' }}>
        <FilterKPICard value={total}        label="Total"         accent="nightfall"  active={activeFilter === null}            onClick={() => setActiveFilter(null)} />
        <FilterKPICard value={scheduled}    label="Scheduled"     accent="marina"     active={activeFilter === 'scheduled'}    onClick={() => handleCardClick('scheduled')} />
        <FilterKPICard value={completed}    label="Completed"     accent="sage"       active={activeFilter === 'completed'}    onClick={() => handleCardClick('completed')} />
        <FilterKPICard value={notScheduled} label="Not Scheduled" accent="dawn"       active={activeFilter === 'not_scheduled'} onClick={() => handleCardClick('not_scheduled')} />
        <FilterKPICard value={flagged}      label="Flagged"       accent="chroma"     active={activeFilter === 'flagged'}      onClick={() => handleCardClick('flagged')} />
        <FilterKPICard value={recommended}  label="Recommended"   accent="sage"       active={activeFilter === 'recommended'}  onClick={() => handleCardClick('recommended')} />
      </div>

      {/* Student list */}
      <div className="rub-scroll-area-month" style={{ marginTop: '8px' }}>
        {activeFilter && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '7px 14px', marginBottom: '8px',
            background: '#f0f3ff', borderRadius: '8px',
            border: '1px solid #e0e7ff',
          }}>
            <span style={{ fontFamily: 'DM Sans', fontWeight: 600, fontSize: '12px', color: '#1D2567' }}>
              Showing: {activeFilter.replace('_', ' ')}
            </span>
            <button onClick={() => setActiveFilter(null)} style={{
              background: 'none', border: 'none',
              fontFamily: 'DM Sans', fontSize: '12px',
              color: '#6b7280', cursor: 'pointer',
              textDecoration: 'underline', padding: 0,
            }}>Clear filter</button>
          </div>
        )}

        <div className="iv-table-wrap">
        <table className="iv-table">
          <thead style={{ position:'sticky', top:0, zIndex:10 }}>
            <tr>
              <th className="iv-th" style={{ width:44, padding:'10px 4px 10px 12px' }} />
              <th className="iv-th iv-sortable" onClick={() => toggleSort('last_name')}>Student Name <SortIcon field="last_name" /></th>
              <th className="iv-th iv-sortable" onClick={() => toggleSort('school')}>School <SortIcon field="school" /></th>
              <th className="iv-th">Scheduled</th>
              <th className="iv-th">Interviewers</th>
              <th className="iv-th">ASPIRE Status</th>
              <th className="iv-th iv-sortable" onClick={() => toggleSort('iv_status')}>Teams Invite <SortIcon field="iv_status" /></th>
              <th className="iv-th">Rubrics</th>
              <th className="iv-th iv-sortable" onClick={() => toggleSort('score')}>Avg Score <SortIcon field="score" /></th>
              <th className="iv-th" style={{ position:'relative', whiteSpace:'nowrap' }}>
                Auto Result
                <span className="iv-th-info" title="Calculated automatically from the average composite score across all submitted rubrics. ≥12 = Recommend, 8–11 = Recommend with Reservations, &lt;8 = Do Not Recommend.">ℹ</span>
              </th>
              <th className="iv-th">Flag</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={11} style={{ padding: 0, border: 'none' }}>
                <EmptyState compact icon={<ClipboardList />}
                  heading="No interview records yet"
                  subtext="Interview records appear here after students are added to the cohort and interviews are scheduled." />
              </td></tr>
            ) : sorted.map(s => {
              const ivStatus = getStudentIvStatus(s, rubrics)
              const borderColor = ROW_BORDER[ivStatus] || '#d1d5db'
              const studentRubs = rubrics.filter(r => r.student_id === s.id)
              const rubCount = studentRubs.length
              const hasIncomplete = studentRubs.some(r =>
                r.status === 'In Progress' &&
                (!r.cj_score || !r.pp_score || !r.ga_score || !r.individual_recommendation)
              )
              // Compute avg directly from rubric rows so it shows even before student record is recalculated
              const scoredRubs = studentRubs.filter(r => (r.composite_score || 0) > 0)
              const avgScore = scoredRubs.length > 0
                ? scoredRubs.reduce((sum, r) => sum + (r.composite_score || 0), 0) / scoredRubs.length
                : 0
              const rec = s.auto_recommendation
              const recColor = rec === 'Recommend' ? '#166534' : rec === 'Recommend with Reservations' ? '#92400e' : rec ? '#991b1b' : null
              const recBg    = rec === 'Recommend' ? '#dcfce7' : rec === 'Recommend with Reservations' ? '#fef3c7' : rec ? '#fee2e2' : null

              return (
                <tr key={s.id} className="iv-row"
                  style={{ borderLeft:`4px solid ${borderColor}` }}
                  onClick={() => setSelectedStudentId(s.id)}>
                  <IrAvatar student={s} />
                  <td className="iv-td iv-td-name">
                    {s.flagged_for_second_interview && <span style={{ marginRight:5 }}>🚩</span>}
                    {displayName(s)}
                    {s.status === 'Form Received' && (
                      <button title="Send scheduling link"
                        onClick={e => { e.stopPropagation(); const a = document.createElement('a'); a.href = buildSchedulingMailto(s); a.click() }}
                        style={{ marginLeft:6, background:'none', border:'none', cursor:'pointer', fontSize:13, color:'#6b7280', padding:'0 2px', verticalAlign:'middle' }}>
                        ✉
                      </button>
                    )}
                  </td>
                  <td className="iv-td iv-td-school">{s.school || '—'}</td>
                  <td className="iv-td" style={{ fontSize:12, color:'var(--text-secondary)', whiteSpace:'nowrap' }}>
                    {s.interview_scheduled_date
                      ? `${s.interview_scheduled_date}${s.interview_scheduled_time ? ' ' + s.interview_scheduled_time : ''}`
                      : '—'}
                  </td>
                  <td className="iv-td" style={{ fontSize:12, color:'var(--text-secondary)' }}>
                    {(() => {
                      const names = studentRubs
                        .filter(r => r.interviewer_name)
                        .map(r => r.interviewer_name)
                        .filter((n, i, arr) => arr.indexOf(n) === i)
                      if (names.length === 0) return '—'
                      return names.map(n => {
                        const parts = n.split(' ').filter(Boolean)
                        return parts.length >= 2 ? `${parts[0][0]}${parts[parts.length-1][0]}`.toUpperCase() : n.slice(0,2).toUpperCase()
                      }).join(', ')
                    })()}
                  </td>
                  <td className="iv-td">
                    {s.status && (() => { const cfg = ASPIRE_STATUS_CONFIG[s.status] || ASPIRE_STATUS_CONFIG['Pending Outreach']; return <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:20, background:cfg.bg, color:cfg.text, border:`1px solid ${cfg.border}`, whiteSpace:'nowrap' }}>{s.status}</span> })()}
                  </td>
                  <td className="iv-td">
                    <TeamsInvitePill student={s} sessions={sessions} />
                  </td>
                  <td className="iv-td" style={{ fontSize:13, fontWeight:600, color:'var(--nightfall)', textAlign:'center' }}>
                    {rubCount || '—'}
                  </td>
                  <td className="iv-td iv-td-score">
                    {avgScore > 0 ? (
                      <div>
                        <div style={{ fontSize:12, fontWeight:600 }}>{avgScore.toFixed(1)}/15</div>
                        <div style={{ height:4, background:'#e5e7eb', borderRadius:2, marginTop:3, width:60 }}>
                          <div style={{ height:4, background:'#1d2567', borderRadius:2, width:`${(avgScore/15)*100}%` }} />
                        </div>
                      </div>
                    ) : '—'}
                  </td>
                  <td className="iv-td">
                    {rec && recColor && (
                      <span style={{ display:'inline-flex', alignItems:'center', gap:3 }}>
                        <span style={{ fontSize:11, fontWeight:600, padding:'1px 7px', borderRadius:4, background:recBg, color:recColor, whiteSpace:'nowrap' }}>
                          {rec === 'Recommend' ? 'Recommend' : rec === 'Recommend with Reservations' ? 'With Reservations' : 'Do Not Recommend'}
                        </span>
                        <ScoreFlag message={s.score_flag ? s.score_flag_message : ''} />
                      </span>
                    )}
                  </td>
                  <td className="iv-td" style={{ textAlign:'center' }}>
                    {s.flagged_for_second_interview ? '🚩' : ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      </div>{/* end student list */}

    </div>
  )
}
