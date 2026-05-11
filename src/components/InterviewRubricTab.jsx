import { useState, useRef, useEffect } from 'react'
import { displayName } from '../lib/utils'
import RubricSession from './RubricSession'
import WeekCalendar from './WeekCalendar'
import ScheduleInterviewModal from './ScheduleInterviewModal'

import { ASPIRE_STATUS_CONFIG } from '../lib/constants'
import ScoreFlag from './ScoreFlag'
import StatCard from './StatCard'
import EmptyState from './EmptyState'
import { Users, CalendarCheck, BadgeCheck, Loader, CalendarX, Flag, ThumbsUp, ClipboardList } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

// Circular avatar for the IR student list table
function IrAvatar({ student }) {
  const [err, setErr] = useState(false)
  const initials = `${(student.first_name||'')[0]||''}${(student.last_name||'')[0]||''}`.toUpperCase() || '?'
  return (
    <td className="iv-td" style={{ width:44, paddingLeft:12, paddingRight:4 }}>
      {student.headshot_url && !err
        ? <img src={student.headshot_url} alt="" onError={() => setErr(true)}
            style={{ width:32, height:32, borderRadius:'50%', objectFit:'cover', display:'block', flexShrink:0 }} />
        : <div style={{ width:32, height:32, borderRadius:'50%', background:'#1d2567', color:'#fff',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:12, fontWeight:700, flexShrink:0 }}>{initials}</div>
      }
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
  students, rubrics, cohortId,
  sessions = [], slots = [],
  onStudentUpdate, onRubricsChange, onRefreshStudents, onManageInterviewers, onUpdateSession, onRefreshSlots,
  toast,
}) {
  const { canInterview, isViewer } = useAuth()
  const [selectedStudentId,   setSelectedStudentId]   = useState(null)
  const [showScheduleModal,   setShowScheduleModal]   = useState(false)
  const [search,              setSearch]              = useState('')
  const [sortBy,              setSortBy]              = useState('last_name')
  const [sortDir,             setSortDir]             = useState('asc')
  // Calendar view mode lifted here so the tab container layout can respond
  const [calMode,             setCalMode]             = useState('week')
  const [showScrollHint,      setShowScrollHint]      = useState(true)
  const summaryRef = useRef(null)

  // Hide scroll hint once user has scrolled past the summary cards (month mode only)
  useEffect(() => {
    if (calMode !== 'month' || !summaryRef.current) return
    setShowScrollHint(true) // reset on entering month mode
    const observer = new IntersectionObserver(
      ([entry]) => setShowScrollHint(entry.isIntersecting),
      { threshold: 0.1 }
    )
    observer.observe(summaryRef.current)
    return () => observer.disconnect()
  }, [calMode])

  // ── Stats ──────────────────────────────────────────────────
  const total         = students.length
  const scheduled     = students.filter(s => s.interview_scheduled_date && getStudentIvStatus(s, rubrics) !== 'Completed').length
  const completed     = students.filter(s => getStudentIvStatus(s, rubrics) === 'Completed').length
  const inProgress    = students.filter(s => getStudentIvStatus(s, rubrics) === 'In Progress').length
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

  const filtered = students.filter(s => {
    if (!search) return true
    const q = search.toLowerCase()
    return displayName(s).toLowerCase().includes(q) || (s.school||'').toLowerCase().includes(q)
  })
  const sorted = [...filtered].sort((a, b) => {
    const ivStatusOrder = { Completed:0, 'In Progress':1, Scheduled:2, 'Not Scheduled':3 }
    let av, bv
    if (sortBy === 'last_name') {
      av = (a.last_name || a.name || '').toLowerCase(); bv = (b.last_name || b.name || '').toLowerCase()
    } else if (sortBy === 'school') {
      const sc = (a.school||'').toLowerCase().localeCompare((b.school||'').toLowerCase())
      if (sc !== 0) return sortDir === 'asc' ? sc : -sc
      av = (a.last_name || a.name || '').toLowerCase(); bv = (b.last_name || b.name || '').toLowerCase()
    } else if (sortBy === 'iv_status') {
      av = ivStatusOrder[getStudentIvStatus(a, rubrics)] ?? 9; bv = ivStatusOrder[getStudentIvStatus(b, rubrics)] ?? 9
      return sortDir === 'asc' ? av - bv : bv - av
    } else if (sortBy === 'score') {
      av = parseFloat(a.avg_composite_score)||0; bv = parseFloat(b.avg_composite_score)||0
      return sortDir === 'asc' ? av - bv : bv - av
    } else { av=''; bv='' }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

  const isMonth = calMode === 'month'

  return (
    <div className={isMonth ? 'rub-tab-month' : 'rub-tab'}>

      {/* Calendar + summary cards — frozen in week, flows in month */}
      <div className={isMonth ? '' : 'rub-frozen'}>
        <WeekCalendar
          students={students}
          rubrics={rubrics}
          cohortId={cohortId}
          sessions={sessions}
          slots={slots}
          onOpenRubric={id => setSelectedStudentId(id)}
          onSchedule={() => setShowScheduleModal(true)}
          onManageInterviewers={onManageInterviewers}
          onStudentUpdate={onRefreshStudents || onRubricsChange}
          onUpdateSession={onUpdateSession}
          onRefreshSlots={onRefreshSlots}
          calMode={calMode}
          onCalModeChange={setCalMode}
        />
        <div ref={summaryRef} className="stat-cards-row" style={{ padding:'12px 16px' }}>
          <StatCard value={total}        label="Total"         icon={Users}         colorScheme="neutral" />
          <StatCard value={scheduled}    label="Scheduled"     icon={CalendarCheck} colorScheme="indigo" />
          <StatCard value={completed}    label="Completed"     icon={BadgeCheck}    colorScheme="green" />
          <StatCard value={inProgress}   label="In Progress"   icon={Loader}        colorScheme="amber" />
          <StatCard value={notScheduled} label="Not Scheduled" icon={CalendarX}     colorScheme="neutral" />
          <StatCard value={flagged}      label="Flagged"       icon={Flag}          colorScheme="red" />
          <StatCard value={recommended}  label="Recommended"   icon={ThumbsUp}      colorScheme="darkgreen" />
        </div>
        {/* Scroll hint — only in month mode, hides after scrolling past summary */}
        {isMonth && showScrollHint && (
          <div style={{ textAlign:'center', padding:'10px 0 4px', fontSize:12, color:'#9ca3af', userSelect:'none' }}>
            ↓ Scroll down to see student list
          </div>
        )}
      </div>

      {/* Student list — independent scroll in week, natural flow in month */}
      <div className={isMonth ? 'rub-scroll-area-month' : 'rub-scroll-area'}>
        <div className="iv-toolbar">
          <input className="search-input" style={{ maxWidth:320 }} placeholder="Search by name or school…"
            value={search} onChange={e => setSearch(e.target.value)} />
          <span className="iv-hint">Click any row to open the interview rubric session.</span>
        </div>

        <div className="iv-table-wrap">
        <table className="iv-table">
          <thead style={!isMonth ? { position:'sticky', top:0, zIndex:10 } : {}}>
            <tr>
              <th className="iv-th" style={{ width:44, padding:'10px 4px 10px 12px' }} />
              <th className="iv-th iv-sortable" onClick={() => toggleSort('last_name')}>Student Name <SortIcon field="last_name" /></th>
              <th className="iv-th iv-sortable" onClick={() => toggleSort('school')}>School <SortIcon field="school" /></th>
              <th className="iv-th">Scheduled</th>
              <th className="iv-th">Interviewers</th>
              <th className="iv-th">ASPIRE Status</th>
              <th className="iv-th iv-sortable" onClick={() => toggleSort('iv_status')}>Interview Status <SortIcon field="iv_status" /></th>
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
              const rubCount = rubrics.filter(r => r.student_id === s.id).length
              const hasIncomplete = rubrics.some(r =>
                r.student_id === s.id && r.status === 'In Progress' &&
                (!r.cj_score || !r.pp_score || !r.ga_score || !r.individual_recommendation)
              )
              const avgScore = parseFloat(s.avg_composite_score) || 0
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
                    {s.interview_assigned_interviewers
                      ? s.interview_assigned_interviewers.split(',').map(n => n.trim()).filter(Boolean).map(n => {
                          const parts = n.split(' ').filter(Boolean)
                          return parts.length >= 2 ? `${parts[0][0]}${parts[parts.length-1][0]}`.toUpperCase() : n.slice(0,2).toUpperCase()
                        }).join(', ')
                      : '—'}
                  </td>
                  <td className="iv-td">
                    {s.status && (() => { const cfg = ASPIRE_STATUS_CONFIG[s.status] || ASPIRE_STATUS_CONFIG['Pending Outreach']; return <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:20, background:cfg.bg, color:cfg.text, border:`1px solid ${cfg.border}`, whiteSpace:'nowrap' }}>{s.status}</span> })()}
                  </td>
                  <td className="iv-td">
                    <span style={{ display:'inline-flex', alignItems:'center', gap:5 }}>
                      <span className={`iv-status-badge iv-status-${ivStatus === 'Completed' ? 'done' : ivStatus === 'In Progress' ? 'wip' : 'none'}`}>
                        {ivStatus}
                      </span>
                      {ivStatus === 'In Progress' && hasIncomplete && (
                        <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:4, background:'#fef3c7', color:'#92400e', whiteSpace:'nowrap' }}>
                          Incomplete
                        </span>
                      )}
                    </span>
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
      </div>{/* end rub-scroll-area */}

      {showScheduleModal && (
        <ScheduleInterviewModal
          students={students}
          onClose={() => setShowScheduleModal(false)}
          onSaved={() => { onRubricsChange(); setShowScheduleModal(false) }}
        />
      )}
    </div>
  )
}
