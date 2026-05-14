import { useState, useMemo, useEffect } from 'react'
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
  const [localSearch,      setLocalSearch]      = useState('')
  const [filterSchool,     setFilterSchool]     = useState('')
  const [filterStatus,     setFilterStatus]     = useState('')
  const [sortBy,           setSortBy]           = useState('last_name_asc')
  const [needsAttention,   setNeedsAttention]   = useState(false)
  const [activeStatusFilter, setActiveStatusFilter] = useState(null)

  const handleCardClick = (filterValue) => {
    if (filterValue === null) { setActiveStatusFilter(null); return }
    setActiveStatusFilter(prev =>
      JSON.stringify(prev) === JSON.stringify(filterValue) ? null : filterValue
    )
  }

  const pipelineCounts = useMemo(() => ({
    total:             students.length,
    needsOutreach:     students.filter(s => ['Pending Outreach','Form Sent'].includes(s.status)).length,
    awaitingInterview: students.filter(s => s.status === 'Form Received').length,
    interviewed:       students.filter(s => s.status === 'Interviewed').length,
    placed:            students.filter(s => s.status === 'Placed').length,
    activeRotation:    students.filter(s => s.status === 'Active Rotation').length,
    completed:         students.filter(s => s.status === 'Completed').length,
    declined:          students.filter(s => s.status === 'Declined').length,
  }), [students])

  const displayedStudents = useMemo(() => {
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
    if (activeStatusFilter) {
      list = list.filter(s =>
        Array.isArray(activeStatusFilter)
          ? activeStatusFilter.includes(s.status)
          : s.status === activeStatusFilter
      )
    }
    return sortStudentsList(list, sortBy)
  }, [students, localSearch, filterSchool, filterStatus, sortBy, needsAttention, activeStatusFilter]) // eslint-disable-line

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

      {/* Frozen: pipeline cards + view toggle */}
      <div className="profiles-frozen">
        {/* Pipeline dashboard cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(110px, 1fr))', gap:'10px', marginBottom:'16px' }}>
          {[
            { label:'Total',             count: pipelineCounts.total,             filter: null,                              color:'#1D2567', bg:'#f0f3ff', border:'#e0e7ff', note:'All students'       },
            { label:'Needs Outreach',    count: pipelineCounts.needsOutreach,     filter: ['Pending Outreach','Form Sent'],   color:'#92400e', bg:'#fffbeb', border:'#fde68a', note:'Pending + Form Sent' },
            { label:'Awaiting Interview',count: pipelineCounts.awaitingInterview, filter: 'Form Received',                   color:'#1e40af', bg:'#eff6ff', border:'#bfdbfe', note:'Form Received'       },
            { label:'Interviewed',       count: pipelineCounts.interviewed,       filter: 'Interviewed',                     color:'#5b21b6', bg:'#f5f3ff', border:'#ddd6fe', note:'Ready to place'      },
            { label:'Placed',            count: pipelineCounts.placed,            filter: 'Placed',                          color:'#065f46', bg:'#f0fdf4', border:'#bbf7d0', note:'Unit assigned'       },
            { label:'Active Rotation',   count: pipelineCounts.activeRotation,    filter: 'Active Rotation',                 color:'#0e7490', bg:'#f0fdfa', border:'#99f6e4', note:'In rotation'         },
            { label:'Completed',         count: pipelineCounts.completed,         filter: 'Completed',                       color:'#166534', bg:'#f0fdf4', border:'#86efac', note:'Program done'        },
            { label:'Declined',          count: pipelineCounts.declined,          filter: 'Declined',                        color:'#991b1b', bg:'#fef2f2', border:'#fecaca', note:'Did not continue'    },
          ].map(card => {
            const isActive      = card.filter !== null && JSON.stringify(activeStatusFilter) === JSON.stringify(card.filter)
            const isActiveTotal = card.filter === null && activeStatusFilter === null
            const lit = isActive || isActiveTotal
            return (
              <div
                key={card.label}
                onClick={() => handleCardClick(card.filter)}
                style={{
                  background: lit ? card.color : card.bg,
                  border: `1px solid ${lit ? card.color : card.border}`,
                  borderRadius:'12px', padding:'12px 14px', cursor:'pointer',
                  transition:'all 0.15s ease', position:'relative',
                  transform: lit ? 'translateY(-2px)' : 'none',
                  boxShadow: lit ? `0 4px 12px ${card.color}33` : '0 1px 3px rgba(0,0,0,0.04)',
                }}
                onMouseEnter={e => { if (!lit) { e.currentTarget.style.transform='translateY(-1px)'; e.currentTarget.style.boxShadow=`0 3px 8px ${card.color}22` } }}
                onMouseLeave={e => { if (!lit) { e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='0 1px 3px rgba(0,0,0,0.04)' } }}
              >
                <div style={{ fontFamily:'DM Sans', fontWeight:800, fontSize:'24px', lineHeight:1, color: lit ? '#ffffff' : card.color, marginBottom:'4px' }}>
                  {card.count}
                </div>
                <div style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'11px', color: lit ? 'rgba(255,255,255,0.9)' : card.color, lineHeight:1.2 }}>
                  {card.label}
                </div>
                <div style={{ fontFamily:'DM Sans', fontSize:'9px', color: lit ? 'rgba(255,255,255,0.65)' : '#9ca3af', marginTop:'2px' }}>
                  {card.note}
                </div>
                {lit && <div style={{ position:'absolute', top:'8px', right:'8px', width:'6px', height:'6px', borderRadius:'50%', background:'rgba(255,255,255,0.6)' }} />}
              </div>
            )
          })}
        </div>

        {/* Active filter bar */}
        {activeStatusFilter && (
          <div style={{ display:'flex', alignItems:'center', gap:'10px', padding:'7px 14px', marginBottom:'12px', background:'#f0f3ff', borderRadius:'8px', border:'1px solid #e0e7ff' }}>
            <span style={{ fontFamily:'DM Sans', fontWeight:600, fontSize:'12px', color:'#1D2567' }}>
              Showing: {Array.isArray(activeStatusFilter) ? activeStatusFilter.join(' + ') : activeStatusFilter}
            </span>
            <button onClick={() => setActiveStatusFilter(null)} style={{ background:'none', border:'none', fontFamily:'DM Sans', fontSize:'12px', color:'#6b7280', cursor:'pointer', textDecoration:'underline', padding:0 }}>
              Clear filter
            </button>
            <span style={{ fontFamily:'DM Sans', fontSize:'11px', color:'#9ca3af', marginLeft:'auto' }}>
              {displayedStudents.length} student{displayedStudents.length !== 1 ? 's' : ''}
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
              students={displayedStudents}
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
                sortedStudents={displayedStudents}
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
