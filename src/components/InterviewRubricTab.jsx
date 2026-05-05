import { useState } from 'react'
import { displayName } from '../lib/utils'
import RubricSession from './RubricSession'
import WeekCalendar from './WeekCalendar'
import ScheduleInterviewModal from './ScheduleInterviewModal'

const STATUS_CLASS = {
  'Form Sent':'badge-gray','Pending Outreach':'badge-pending',
  'Interviewed':'badge-purple','Accepted':'badge-green',
  'Active Rotation':'badge-teal','Completed':'badge-navy','Declined':'badge-red',
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

export default function InterviewRubricTab({
  students, rubrics, cohortId, onStudentUpdate, onRubricsChange, onManageInterviewers,
}) {
  const [selectedStudentId,   setSelectedStudentId]   = useState(null)
  const [showScheduleModal,   setShowScheduleModal]   = useState(false)
  const [search,              setSearch]              = useState('')
  const [sortBy,              setSortBy]              = useState('last_name')
  const [sortDir,             setSortDir]             = useState('asc')

  // ── Stats ──────────────────────────────────────────────────
  const total         = students.length
  const scheduled     = students.filter(s => s.interview_scheduled_date && getStudentIvStatus(s, rubrics) !== 'Completed').length
  const completed     = students.filter(s => getStudentIvStatus(s, rubrics) === 'Completed').length
  const inProgress    = students.filter(s => getStudentIvStatus(s, rubrics) === 'In Progress').length
  const notScheduled  = students.filter(s => !s.interview_scheduled_date).length
  const flagged       = students.filter(s => s.flagged_for_second_interview).length
  const recommended   = students.filter(s => s.auto_recommendation === 'Recommend').length

  const summaryStats = [
    { label:'Total',          value:total,        bg:'#ffffff', color:'#1d2567', border:'#d1d5db' },
    { label:'Scheduled',      value:scheduled,    bg:'#eff6ff', color:'#1d4ed8', border:'#bfdbfe' },
    { label:'Completed',      value:completed,    bg:'#dcfce7', color:'#166534', border:'#a7f3d0' },
    { label:'In Progress',    value:inProgress,   bg:'#fef3c7', color:'#92400e', border:'#fde68a' },
    { label:'Not Scheduled',  value:notScheduled, bg:'#f4f1ec', color:'#191919', border:'#d4cfc8' },
    { label:'Flagged',        value:flagged,       bg:'#ede9fe', color:'#5b21b6', border:'#ddd6fe' },
    { label:'Recommended',    value:recommended,  bg:'#f0fdf4', color:'#16a34a', border:'#bbf7d0' },
  ]

  // If student selected → session
  const selectedStudent = selectedStudentId ? students.find(s => s.id === selectedStudentId) : null
  if (selectedStudent) {
    return (
      <RubricSession
        student={selectedStudent}
        rubrics={rubrics}
        cohortId={cohortId}
        onBack={() => setSelectedStudentId(null)}
        onStudentUpdate={onStudentUpdate}
        onRubricsChange={onRubricsChange}
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
      av = (a.school||'').toLowerCase(); bv = (b.school||'').toLowerCase()
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

  return (
    <div className="rub-tab">
      {/* Week Calendar */}
      <WeekCalendar
        students={students}
        rubrics={rubrics}
        onOpenSession={id => setSelectedStudentId(id)}
        onSchedule={() => setShowScheduleModal(true)}
        onManageInterviewers={onManageInterviewers}
      />

      {/* Summary cards */}
      <div className="iv-summary">
        {summaryStats.map(s => (
          <div key={s.label} className="iv-stat-card" style={{ background:s.bg, borderColor:s.border }}>
            <div className="iv-stat-value" style={{ color:s.color }}>{s.value}</div>
            <div className="iv-stat-label" style={{ color:s.color }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="iv-toolbar">
        <input className="search-input" style={{ maxWidth:320 }} placeholder="Search by name or school…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <span className="iv-hint">Click any row to open the interview rubric session.</span>
      </div>

      {/* Table */}
      <div className="iv-table-wrap">
        <table className="iv-table">
          <thead>
            <tr>
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
              <tr><td colSpan={10} className="iv-empty">No students match the current search.</td></tr>
            ) : sorted.map(s => {
              const ivStatus = getStudentIvStatus(s, rubrics)
              const borderColor = ROW_BORDER[ivStatus] || '#d1d5db'
              const rubCount = rubrics.filter(r => r.student_id === s.id).length
              const avgScore = parseFloat(s.avg_composite_score) || 0
              const rec = s.auto_recommendation
              const recColor = rec === 'Recommend' ? '#166534' : rec === 'Recommend with Reservations' ? '#92400e' : rec ? '#991b1b' : null
              const recBg    = rec === 'Recommend' ? '#dcfce7' : rec === 'Recommend with Reservations' ? '#fef3c7' : rec ? '#fee2e2' : null

              return (
                <tr key={s.id} className="iv-row"
                  style={{ borderLeft:`4px solid ${borderColor}` }}
                  onClick={() => setSelectedStudentId(s.id)}>
                  <td className="iv-td iv-td-name">
                    {s.flagged_for_second_interview && <span style={{ marginRight:5 }}>🚩</span>}
                    {displayName(s)}
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
                    {s.status && <span className={`badge ${STATUS_CLASS[s.status]||'badge-gray'}`}>{s.status}</span>}
                  </td>
                  <td className="iv-td">
                    <span className={`iv-status-badge iv-status-${ivStatus === 'Completed' ? 'done' : ivStatus === 'In Progress' ? 'wip' : 'none'}`}>
                      {ivStatus}
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
                      <span style={{ fontSize:11, fontWeight:600, padding:'1px 7px', borderRadius:4, background:recBg, color:recColor, whiteSpace:'nowrap' }}>
                        {rec === 'Recommend' ? 'Recommend' : rec === 'Recommend with Reservations' ? 'With Reservations' : 'Do Not Recommend'}
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
