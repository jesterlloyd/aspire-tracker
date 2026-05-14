import { useState, useMemo, useEffect } from 'react'
import Dashboard from './Dashboard'
import StudentListPanel from './StudentListPanel'
import StudentSidePanel from './StudentSidePanel'
import AccessTab from './AccessTab'

import { ASPIRE_STATUS_SORT_ORDER } from '../lib/constants'
import { useLastSynced } from '../hooks/useLastSynced'
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
  onExportCSV, onAddStudent,
  focusStudentId, onClearFocusStudent,
  toast,
}) {
  const [selectedStudentId, setSelectedStudentId] = useState(null)
  const { markSynced: markProfilesSynced, display: profilesSyncDisplay } = useLastSynced()

  // Mark synced whenever students data arrives
  useEffect(() => { if (students.length >= 0) markProfilesSynced() }, [students]) // eslint-disable-line

  // Open specific student from global search
  useEffect(() => {
    if (focusStudentId) {
      setSelectedStudentId(focusStudentId)
      onClearFocusStudent?.()
    }
  }, [focusStudentId]) // eslint-disable-line
  const [localSearch,       setLocalSearch]       = useState('')
  const [filterSchool,      setFilterSchool]      = useState('')
  const [filterStatus,      setFilterStatus]      = useState('')
  const [sortBy,            setSortBy]            = useState('last_name_asc')
  const [needsAttention,    setNeedsAttention]    = useState(false)
  const [activeCardFilter,  setActiveCardFilter]  = useState(null)

  const CARD_FILTER_FNS = {
    matched:    s => !!s.matched_unit_id,
    Placed:     s => s.status === 'Placed',
    ngrp_hired: s => s.ngrp_outcome === 'Hired',
  }
  const CARD_FILTER_LABELS = {
    matched:    'Students Placed',
    Placed:     'Placed',
    ngrp_hired: 'NGRP Hired',
  }

  const handleCardFilter = (key) => setActiveCardFilter(prev => prev === key ? null : key)

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
    if (activeCardFilter && CARD_FILTER_FNS[activeCardFilter]) {
      list = list.filter(CARD_FILTER_FNS[activeCardFilter])
    }
    return sortStudentsList(list, sortBy)
  }, [students, localSearch, filterSchool, filterStatus, sortBy, needsAttention, activeCardFilter]) // eslint-disable-line

  const selectedStudent = selectedStudentId ? students.find(s => s.id === selectedStudentId) : null
  const panelStudent    = selectedStudent

  // Escape key closes panel
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') setSelectedStudentId(null) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="student-profiles-tab">

      {/* Frozen: summary cards + view toggle */}
      <div className="profiles-frozen">
        <Dashboard students={students} activeFilter={activeCardFilter} onFilterChange={handleCardFilter} />
        {activeCardFilter && (
          <div style={{ display:'flex', alignItems:'center', gap:'10px', padding:'7px 14px', marginBottom:'4px', background:'#f0f3ff', borderRadius:'8px', border:'1px solid #e0e7ff' }}>
            <span style={{ fontFamily:'DM Sans', fontWeight:600, fontSize:'12px', color:'#1D2567' }}>
              Showing: {CARD_FILTER_LABELS[activeCardFilter] || activeCardFilter}
            </span>
            <button onClick={() => setActiveCardFilter(null)} style={{ background:'none', border:'none', fontFamily:'DM Sans', fontSize:'12px', color:'#6b7280', cursor:'pointer', textDecoration:'underline', padding:0 }}>
              Clear filter
            </button>
            <span style={{ fontFamily:'DM Sans', fontSize:'11px', color:'#9ca3af', marginLeft:'auto' }}>
              {filteredSorted.length} student{filteredSorted.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}
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

      {/* Profiles: full-width list, panel slides in on selection */}
      {view === 'records' && (
        <div className={panelStudent ? 'profiles-slide-container' : 'profiles-full-container'}>
          <div className={panelStudent ? 'profiles-list-narrow' : 'profiles-list-full'}>
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
              onExportCSV={onExportCSV}
              onAddStudent={onAddStudent}
              syncDisplay={profilesSyncDisplay}
              compressed={!!panelStudent}
            />
          </div>
          {panelStudent && (
            <div className="profiles-panel-slide" key={panelStudent.id}>
              <StudentSidePanel
                student={panelStudent}
                sortedStudents={filteredSorted}
                onSelectStudent={setSelectedStudentId}
                onClose={() => setSelectedStudentId(null)}
                onUpdate={onUpdate}
                onDelete={onDelete}
                units={units}
                toast={toast}
              />
            </div>
          )}
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
