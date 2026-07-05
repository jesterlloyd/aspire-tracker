import { useState } from 'react'
import { displayName } from '../lib/utils'
import InterviewSession from './InterviewSession'
import StatCard from './StatCard'
import { Users, BadgeCheck, Loader, CalendarX, ThumbsUp, TrendingUp, UserX } from 'lucide-react'

const STATUS_CLASS = {
  'Form Sent':'badge-gray','Pending Outreach':'badge-pending',
  'Interviewed':'badge-purple','Accepted':'badge-green',
  'Active Rotation':'badge-teal','Completed':'badge-navy','Declined':'badge-red',
}
const REC_CLASS = {
  'Recommend': { bg:'#dcfce7', color:'#166534' },
  'Recommend with Reservations': { bg:'#fef3c7', color:'#92400e' },
  'Do Not Recommend at This Time': { bg:'#fee2e2', color:'#991b1b' },
}
const REC_SHORT = {
  'Recommend': 'Recommend',
  'Recommend with Reservations': 'With Reservations',
  'Do Not Recommend at This Time': 'Do Not Recommend',
}

export default function InterviewTab({ students, interviews, cohortId, onStudentUpdate, onInterviewsChange }) {
  const [selectedStudentId, setSelectedStudentId] = useState(null)
  const [search,  setSearch]  = useState('')
  const [sortBy,  setSortBy]  = useState('last_name')
  const [sortDir, setSortDir] = useState('asc')

  // Map interview records by student_id
  const ivMap = Object.fromEntries(interviews.map(iv => [iv.student_id, iv]))

  // Stats
  const total           = students.length
  const completed       = interviews.filter(iv => iv.status === 'Completed').length
  const inProgress      = interviews.filter(iv => iv.status === 'In Progress').length
  const notYet          = students.filter(s => !ivMap[s.id]).length
  const recommended     = interviews.filter(iv => iv.overall_recommendation === 'Recommend').length
  const withReserv      = interviews.filter(iv => iv.overall_recommendation === 'Recommend with Reservations').length
  const notRecommended  = interviews.filter(iv => iv.overall_recommendation === 'Do Not Recommend at This Time').length


  // If a student is selected, show InterviewSession
  const selectedStudent = selectedStudentId ? students.find(s => s.id === selectedStudentId) : null
  if (selectedStudent) {
    return (
      <InterviewSession
        student={selectedStudent}
        cohortId={cohortId}
        onBack={() => setSelectedStudentId(null)}
        onStudentUpdate={onStudentUpdate}
        onInterviewsChange={onInterviewsChange}
      />
    )
  }

  // Filter + sort
  const toggleSort = field => {
    if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortDir('asc') }
  }

  const filtered = students.filter(s => {
    if (!search) return true
    const q = search.toLowerCase()
    return displayName(s).toLowerCase().includes(q) || (s.school || '').toLowerCase().includes(q)
  })

  const sorted = [...filtered].sort((a, b) => {
    let av, bv
    const ivA = ivMap[a.id], ivB = ivMap[b.id]
    if (sortBy === 'last_name') {
      av = (a.last_name || a.name || '').toLowerCase()
      bv = (b.last_name || b.name || '').toLowerCase()
    } else if (sortBy === 'school') {
      av = (a.school || '').toLowerCase()
      bv = (b.school || '').toLowerCase()
    } else if (sortBy === 'iv_status') {
      av = ivA ? (ivA.status === 'Completed' ? 0 : 1) : 2
      bv = ivB ? (ivB.status === 'Completed' ? 0 : 1) : 2
      return sortDir === 'asc' ? av - bv : bv - av
    } else if (sortBy === 'score') {
      av = ivA?.composite_score || 0
      bv = ivB?.composite_score || 0
      return sortDir === 'asc' ? av - bv : bv - av
    } else {
      av = ''; bv = ''
    }
    const cmp = (av < bv ? -1 : av > bv ? 1 : 0)
    return sortDir === 'asc' ? cmp : -cmp
  })

  const SortIcon = ({ field }) =>
    sortBy === field
      ? <span style={{ marginLeft: 3 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
      : <span style={{ marginLeft: 3, opacity: 0.3 }}>↕</span>

  return (
    <div className="interview-tab">
      {/* Summary banner */}
      <div className="stat-cards-row" style={{ padding:'12px 16px' }}>
        <StatCard value={total}          label="Total Students"      icon={Users}      colorScheme="neutral" />
        <StatCard value={completed}      label="Completed"           icon={BadgeCheck} colorScheme="green" />
        <StatCard value={inProgress}     label="In Progress"         icon={Loader}     colorScheme="amber" />
        <StatCard value={notYet}         label="Not Yet Interviewed" icon={CalendarX}  colorScheme="neutral" />
        <StatCard value={recommended}    label="Recommended"         icon={ThumbsUp}   colorScheme="darkgreen" />
        <StatCard value={withReserv}     label="With Reservations"   icon={TrendingUp} colorScheme="amber" />
        <StatCard value={notRecommended} label="Not Recommended"     icon={UserX}      colorScheme="red" />
      </div>

      {/* Search */}
      <div className="iv-toolbar">
        <input className="search-input" style={{ maxWidth: 320 }}
          placeholder="Search by name or school…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <span className="iv-hint">Click any row to open the interview session.</span>
      </div>

      {/* Table */}
      <div className="iv-table-wrap">
        <table className="iv-table">
          <thead>
            <tr>
              <th className="iv-th iv-sortable" onClick={() => toggleSort('last_name')}>
                Student Name <SortIcon field="last_name" />
              </th>
              <th className="iv-th iv-sortable" onClick={() => toggleSort('school')}>
                School <SortIcon field="school" />
              </th>
              <th className="iv-th">ASPIRE Status</th>
              <th className="iv-th iv-sortable" onClick={() => toggleSort('iv_status')}>
                Interview Status <SortIcon field="iv_status" />
              </th>
              <th className="iv-th iv-sortable" onClick={() => toggleSort('score')}>
                Score <SortIcon field="score" />
              </th>
              <th className="iv-th">Recommendation</th>
              <th className="iv-th">Interviewer</th>
              <th className="iv-th">Date</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={8} className="iv-empty">No students match the current search.</td></tr>
            ) : sorted.map(s => {
              const iv = ivMap[s.id]
              const ivStatus = iv ? iv.status : 'No Interview'
              const rec = iv?.overall_recommendation
              const recStyle = rec ? REC_CLASS[rec] : null

              return (
                <tr key={s.id} className="iv-row" onClick={() => setSelectedStudentId(s.id)}>
                  <td className="iv-td iv-td-name">{displayName(s)}</td>
                  <td className="iv-td iv-td-school">{s.school || '-'}</td>
                  <td className="iv-td">
                    {s.status && <span className={`badge ${STATUS_CLASS[s.status] || 'badge-gray'}`}>{s.status}</span>}
                  </td>
                  <td className="iv-td">
                    <span className={`iv-status-badge iv-status-${ivStatus === 'Completed' ? 'done' : ivStatus === 'In Progress' ? 'wip' : 'none'}`}>
                      {ivStatus}
                    </span>
                  </td>
                  <td className="iv-td iv-td-score">
                    {iv?.composite_score > 0 ? `${iv.composite_score}/15` : '-'}
                  </td>
                  <td className="iv-td">
                    {recStyle && rec && (
                      <span className="iv-rec-badge" style={{ background: recStyle.bg, color: recStyle.color }}>
                        {REC_SHORT[rec]}
                      </span>
                    )}
                  </td>
                  <td className="iv-td" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {iv?.interviewer_name || '-'}
                  </td>
                  <td className="iv-td" style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {iv?.interview_date || '-'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
