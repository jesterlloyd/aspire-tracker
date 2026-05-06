import { useState, useMemo } from 'react'
import Dashboard from './Dashboard'
import StudentListPanel from './StudentListPanel'
import StudentSidePanel from './StudentSidePanel'
import AccessTab from './AccessTab'

import { ASPIRE_STATUS_SORT_ORDER } from '../lib/constants'
const ASPIRE_ORDER = ASPIRE_STATUS_SORT_ORDER

function sortStudentsList(students, sortBy) {
  return [...students].sort((a, b) => {
    const la = (a.last_name || a.name || '').toLowerCase()
    const lb = (b.last_name || b.name || '').toLowerCase()
    switch (sortBy) {
      case 'last_name_desc': return lb.localeCompare(la)
      case 'school_asc': {
        const sc = (a.school||'').localeCompare(b.school||'')
        return sc !== 0 ? sc : la.localeCompare(lb)
      }
      case 'gpa_desc': {
        const ga = parseFloat(a.cumulative_gpa)||0, gb = parseFloat(b.cumulative_gpa)||0
        return gb - ga || la.localeCompare(lb)
      }
      case 'status': {
        const ia = ASPIRE_ORDER.indexOf(a.status), ib = ASPIRE_ORDER.indexOf(b.status)
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || la.localeCompare(lb)
      }
      case 'needs_attention': {
        const na = (!a.personal_email?.trim() || a.cumulative_gpa == null || !a.unit_preference_1?.trim()) ? 0 : 1
        const nb = (!b.personal_email?.trim() || b.cumulative_gpa == null || !b.unit_preference_1?.trim()) ? 0 : 1
        return na - nb || la.localeCompare(lb)
      }
      default: return la.localeCompare(lb)
    }
  })
}

export default function StudentProfilesTab({
  students, units, cohortId,
  onUpdate, onDelete, onRefresh, onSwitchToAccess,
  view, onViewChange,
  accessFocusId,
}) {
  const [selectedStudentId, setSelectedStudentId] = useState(null)
  const [localSearch,       setLocalSearch]       = useState('')
  const [filterSchool,      setFilterSchool]      = useState('')
  const [filterStatus,      setFilterStatus]      = useState('')
  const [sortBy,            setSortBy]            = useState('last_name_asc')
  const [needsAttention,    setNeedsAttention]    = useState(false)

  const filteredSorted = useMemo(() => {
    let list = students
    if (localSearch) {
      const q = localSearch.toLowerCase()
      list = list.filter(s =>
        `${s.first_name||''} ${s.last_name||''} ${s.name||''}`.toLowerCase().includes(q) ||
        (s.school_email||'').toLowerCase().includes(q) ||
        (s.personal_email||'').toLowerCase().includes(q)
      )
    }
    if (filterSchool)  list = list.filter(s => s.school === filterSchool)
    if (filterStatus)  list = list.filter(s => s.status === filterStatus)
    if (needsAttention) list = list.filter(s =>
      !s.personal_email?.trim() || s.cumulative_gpa == null || !s.unit_preference_1?.trim()
    )
    return sortStudentsList(list, sortBy)
  }, [students, localSearch, filterSchool, filterStatus, sortBy, needsAttention])

  const selectedStudent = selectedStudentId ? students.find(s => s.id === selectedStudentId) : null

  // If selected student is no longer in filtered list, keep them in panel but allow close
  const panelStudent = selectedStudent

  return (
    <div className="student-profiles-tab">

      {/* Frozen: summary cards + view toggle */}
      <div className="profiles-frozen">
        <Dashboard students={students} />
        <div className="profiles-view-toggle">
          <button
            className={`profiles-toggle-btn${view === 'records' ? ' active' : ''}`}
            onClick={() => onViewChange('records')}
            aria-label="Profiles view">
            Profiles
          </button>
          <button
            className={`profiles-toggle-btn${view === 'access' ? ' active' : ''}`}
            onClick={() => onViewChange('access')}
            aria-label="CS-Link Access view">
            CS-Link Access
          </button>
        </div>
      </div>

      {/* Profiles: two-column split */}
      {view === 'records' && (
        <div className="profiles-split">
          <div className="profiles-list-col">
            <StudentListPanel
              students={filteredSorted}
              allStudents={students}
              selectedStudentId={selectedStudentId}
              onSelect={id => setSelectedStudentId(prev => prev === id ? null : id)}
              localSearch={localSearch}       setLocalSearch={setLocalSearch}
              filterSchool={filterSchool}     setFilterSchool={setFilterSchool}
              filterStatus={filterStatus}     setFilterStatus={setFilterStatus}
              sortBy={sortBy}                 setSortBy={setSortBy}
              needsAttention={needsAttention} setNeedsAttention={setNeedsAttention}
              cohortId={cohortId}
              onRefresh={onRefresh}
            />
          </div>
          <div className="profiles-detail-col">
            {panelStudent ? (
              <StudentSidePanel
                student={panelStudent}
                sortedStudents={filteredSorted}
                onSelectStudent={setSelectedStudentId}
                onClose={() => setSelectedStudentId(null)}
                onUpdate={onUpdate}
                onDelete={onDelete}
                units={units}
              />
            ) : (
              <div className="profiles-empty-panel">
                <div style={{ fontSize:40, marginBottom:12, opacity:0.25 }}>👤</div>
                <div style={{ fontSize:14, color:'#9ca3af', fontWeight:400 }}>
                  Select a student to view their profile
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CS-Link Access: full width */}
      {view === 'access' && (
        <div className="profiles-scroll-area">
          <AccessTab
            students={students}
            onUpdate={onUpdate}
            focusStudentId={accessFocusId}
          />
        </div>
      )}
    </div>
  )
}
