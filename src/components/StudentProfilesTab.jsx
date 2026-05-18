import { useState, useMemo, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import StudentListPanel from './StudentListPanel'
import StudentSidePanel from './StudentSidePanel'
import AccessTab from './AccessTab'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { FilterKPICard } from './KPIBand'

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
  onExportCSV, onAddStudent,
  focusStudentId, onClearFocusStudent,
  toast,
}) {
  const { userProfile } = useAuth()
  const queryClient = useQueryClient()
  const [selectedStudentId, setSelectedStudentId] = useState(null)

  // Open specific student from global search
  useEffect(() => {
    if (focusStudentId) {
      setSelectedStudentId(focusStudentId)
      onClearFocusStudent?.()
    }
  }, [focusStudentId]) // eslint-disable-line

  // Mark profile as read whenever a student is selected (not on hover/scroll)
  useEffect(() => {
    if (!userProfile?.id || !selectedStudentId || !cohortId) return
    const markAsRead = async () => {
      await supabase
        .from('student_reads')
        .upsert(
          { user_id: userProfile.id, student_id: selectedStudentId, last_viewed_at: new Date().toISOString() },
          { onConflict: 'user_id,student_id' }
        )
      queryClient.invalidateQueries({ queryKey: ['unread_students', cohortId, userProfile.id] })
    }
    markAsRead()
  }, [selectedStudentId, userProfile?.id, cohortId]) // eslint-disable-line
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
        {/* Pipeline filter cards — color story: Nightfall=all, Dawn=needs attention, Sage=positive, Chroma=alert */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(8, 1fr)', gap:10, marginBottom:16 }}>
          <FilterKPICard value={pipelineCounts.total}             label="Total"              sub="All students"          accent="nightfall"  active={activeStatusFilter === null}                                                         onClick={() => handleCardClick(null)} />
          <FilterKPICard value={pipelineCounts.needsOutreach}     label="Needs Outreach"     sub="Pending + Form Sent"   accent="dawn"       active={JSON.stringify(activeStatusFilter) === JSON.stringify(['Pending Outreach','Form Sent'])} onClick={() => handleCardClick(['Pending Outreach','Form Sent'])} />
          <FilterKPICard value={pipelineCounts.awaitingInterview} label="Awaiting Interview" sub="Form Received"         accent="periwinkle" active={activeStatusFilter === 'Form Received'}                                               onClick={() => handleCardClick('Form Received')} />
          <FilterKPICard value={pipelineCounts.interviewed}       label="Interviewed"        sub="Ready to place"        accent="lavender"   active={activeStatusFilter === 'Interviewed'}                                                onClick={() => handleCardClick('Interviewed')} />
          <FilterKPICard value={pipelineCounts.placed}            label="Placed"             sub="Unit assigned"         accent="sage"       active={activeStatusFilter === 'Placed'}                                                     onClick={() => handleCardClick('Placed')} />
          <FilterKPICard value={pipelineCounts.activeRotation}    label="Active Rotation"    sub="In rotation"           accent="marina"     active={activeStatusFilter === 'Active Rotation'}                                            onClick={() => handleCardClick('Active Rotation')} />
          <FilterKPICard value={pipelineCounts.completed}         label="Completed"          sub="Program done"          accent="sage"       active={activeStatusFilter === 'Completed'}                                                  onClick={() => handleCardClick('Completed')} />
          <FilterKPICard value={pipelineCounts.declined}          label="Declined"           sub="Did not continue"      accent="chroma"     active={activeStatusFilter === 'Declined'}                                                   onClick={() => handleCardClick('Declined')} />
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
