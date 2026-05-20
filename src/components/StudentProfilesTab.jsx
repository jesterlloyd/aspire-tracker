import { useState, useMemo, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import StudentListPanel from './StudentListPanel'
import StudentSidePanel from './StudentSidePanel'
import AccessTab from './AccessTab'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { FilterKPICard } from './KPIBand'
import ImportStudentsCSV from './ImportStudentsCSV'
import { Search, X, LayoutGrid, List, Info } from 'lucide-react'
import StatusLegendPopover from './StatusLegendPopover'
import { calculateProfileCompletion } from '../lib/profileCompletion'
import { getCsLinkStatus } from '../lib/utils'
import { ASPIRE_STATUS_SORT_ORDER } from '../lib/constants'
const ASPIRE_ORDER = ASPIRE_STATUS_SORT_ORDER

// ── Sorting ───────────────────────────────────────────────────────────────────
function sortStudentsList(students, sortBy) {
  return [...students].sort((a, b) => {
    const la = (a.last_name || a.name || '').toLowerCase()
    const lb = (b.last_name || b.name || '').toLowerCase()
    switch (sortBy) {
      case 'last_name_desc': return lb.localeCompare(la)
      case 'school_asc': { const sc=(a.school||'').localeCompare(b.school||''); return sc!==0?sc:la.localeCompare(lb) }
      case 'gpa_desc': { const ga=parseFloat(a.cumulative_gpa)||0,gb=parseFloat(b.cumulative_gpa)||0; return gb-ga||la.localeCompare(lb) }
      case 'gpa_asc':  { const ga=parseFloat(a.cumulative_gpa)||0,gb=parseFloat(b.cumulative_gpa)||0; return ga-gb||la.localeCompare(lb) }
      case 'status': { const ia=ASPIRE_ORDER.indexOf(a.status),ib=ASPIRE_ORDER.indexOf(b.status); return (ia<0?99:ia)-(ib<0?99:ib)||la.localeCompare(lb) }
      case 'completion_desc': { const pa=calculateProfileCompletion(a).percentage,pb=calculateProfileCompletion(b).percentage; return pb-pa||la.localeCompare(lb) }
      case 'completion_asc':  { const pa=calculateProfileCompletion(a).percentage,pb=calculateProfileCompletion(b).percentage; return pa-pb||la.localeCompare(lb) }
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
  const { userProfile, canEdit } = useAuth()
  const queryClient = useQueryClient()
  const [selectedStudentId, setSelectedStudentId] = useState(null)
  const [viewMode, setViewMode] = useState('list') // 'list' | 'grid'
  const [unifiedSearch, setUnifiedSearch] = useState('')
  const [sortBy, setSortBy] = useState('last_name_asc')
  const [activeStatusFilter, setActiveStatusFilter] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const prevFilterKey = useRef(null)

  // Open specific student from global search
  useEffect(() => {
    if (focusStudentId) { setSelectedStudentId(focusStudentId); onClearFocusStudent?.() }
  }, [focusStudentId]) // eslint-disable-line

  // Mark profile as read when student is selected
  useEffect(() => {
    if (!userProfile?.id || !selectedStudentId || !cohortId) return
    const markAsRead = async () => {
      await supabase.from('student_reads').upsert(
        { user_id: userProfile.id, student_id: selectedStudentId, last_viewed_at: new Date().toISOString() },
        { onConflict: 'user_id,student_id' }
      )
      queryClient.invalidateQueries({ queryKey: ['unread_students', cohortId, userProfile.id] })
    }
    markAsRead()
  }, [selectedStudentId, userProfile?.id, cohortId]) // eslint-disable-line

  // Pipeline counts — always computed against FULL cohort, not filtered
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

  // Filtered + sorted students
  const displayedStudents = useMemo(() => {
    let list = students
    if (unifiedSearch.trim()) {
      const q = unifiedSearch.trim().toLowerCase()
      list = list.filter(s => {
        const csLabel = (getCsLinkStatus(s) || '').toLowerCase()
        return (
          `${s.first_name||''} ${s.last_name||''}`.toLowerCase().includes(q) ||
          (s.school||'').toLowerCase().includes(q) ||
          (s.program_type||'').toLowerCase().includes(q) ||
          (s.school_email||'').toLowerCase().includes(q) ||
          (s.personal_email||'').toLowerCase().includes(q) ||
          (s.status||'').toLowerCase().includes(q) ||
          csLabel.includes(q) ||
          (s.unit_preference_1||'').toLowerCase().includes(q) ||
          (s.unit_preference_2||'').toLowerCase().includes(q) ||
          (s.unit_preference_3||'').toLowerCase().includes(q)
        )
      })
    }
    if (activeStatusFilter) {
      list = list.filter(s =>
        Array.isArray(activeStatusFilter)
          ? activeStatusFilter.includes(s.status)
          : s.status === activeStatusFilter
      )
    }
    return sortStudentsList(list, sortBy)
  }, [students, unifiedSearch, activeStatusFilter, sortBy]) // eslint-disable-line

  // Auto-select first student when filter changes and current selection drops out
  useEffect(() => {
    if (displayedStudents.length === 0) { setSelectedStudentId(null); return }
    const valid = displayedStudents.some(s => s.id === selectedStudentId)
    if (!valid) setSelectedStudentId(displayedStudents[0].id)
  }, [displayedStudents]) // eslint-disable-line — reads selectedStudentId as closure

  // Default to first student on initial load
  useEffect(() => {
    if (!selectedStudentId && displayedStudents.length > 0) {
      setSelectedStudentId(displayedStudents[0].id)
    }
  }, []) // eslint-disable-line — run once on mount

  const selectedStudent = selectedStudentId ? students.find(s => s.id === selectedStudentId) : null
  const selectedName = selectedStudent ? `${selectedStudent.first_name} ${selectedStudent.last_name}`.trim() : null

  const handleKpiClick = (filterValue) => {
    setActiveStatusFilter(prev =>
      JSON.stringify(prev) === JSON.stringify(filterValue) ? null : filterValue
    )
  }

  return (
    <div className="student-profiles-tab">

      {/* ── KPI filter strip (frozen) ── */}
      <div className="profiles-frozen">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(8, 1fr)', gap:10, marginBottom:14 }}>
          <FilterKPICard value={pipelineCounts.total}             label="Total"              sub="All students"          accent="nightfall"  active={activeStatusFilter === null}                                                         onClick={() => handleKpiClick(null)} />
          <FilterKPICard value={pipelineCounts.needsOutreach}     label="Needs Outreach"     sub="Pending + Form Sent"   accent="dawn"       active={JSON.stringify(activeStatusFilter)===JSON.stringify(['Pending Outreach','Form Sent'])} onClick={() => handleKpiClick(['Pending Outreach','Form Sent'])} />
          <FilterKPICard value={pipelineCounts.awaitingInterview} label="Awaiting Interview" sub="Form Received"         accent="periwinkle" active={activeStatusFilter === 'Form Received'}                                               onClick={() => handleKpiClick('Form Received')} />
          <FilterKPICard value={pipelineCounts.interviewed}       label="Interviewed"        sub="Ready to place"        accent="lavender"   active={activeStatusFilter === 'Interviewed'}                                                onClick={() => handleKpiClick('Interviewed')} />
          <FilterKPICard value={pipelineCounts.placed}            label="Placed"             sub="Unit assigned"         accent="sage"       active={activeStatusFilter === 'Placed'}                                                     onClick={() => handleKpiClick('Placed')} />
          <FilterKPICard value={pipelineCounts.activeRotation}    label="Active Rotation"    sub="In rotation"           accent="marina"     active={activeStatusFilter === 'Active Rotation'}                                            onClick={() => handleKpiClick('Active Rotation')} />
          <FilterKPICard value={pipelineCounts.completed}         label="Completed"          sub="Program done"          accent="sage"       active={activeStatusFilter === 'Completed'}                                                  onClick={() => handleKpiClick('Completed')} />
          <FilterKPICard value={pipelineCounts.declined}          label="Declined"           sub="Did not continue"      accent="chroma"     active={activeStatusFilter === 'Declined'}                                                   onClick={() => handleKpiClick('Declined')} />
        </div>

        {/* ── Unified toolbar: Profiles/CS-Link toggle + all controls in one row ── */}
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 12px', background:'var(--bg-card,#fff)', border:'1px solid var(--border-card,rgba(29,37,103,0.08))', borderRadius:10, marginBottom:10, flexWrap:'wrap' }}>

          {/* Profiles / CS-Link Access — segmented, matches List/Grid style */}
          <div style={{ display:'flex', borderRadius:7, border:'1px solid var(--border-input,rgba(29,37,103,0.10))', overflow:'hidden', flexShrink:0 }}>
            <button onClick={() => onViewChange('records')}
              style={{ height:32, padding:'0 13px', display:'flex', alignItems:'center', border:'none', cursor:'pointer', fontSize:12, fontFamily:'DM Sans,sans-serif', fontWeight:500,
                background: view==='records' ? 'var(--color-accent-primary,#1D2567)' : 'var(--bg-input,#fff)',
                color: view==='records' ? '#fff' : 'var(--text-secondary,#4A5560)', transition:'all 0.12s' }}>
              Profiles
            </button>
            <button onClick={() => onViewChange('access')}
              style={{ height:32, padding:'0 13px', display:'flex', alignItems:'center', border:'none', cursor:'pointer', fontSize:12, fontFamily:'DM Sans,sans-serif', fontWeight:500,
                background: view==='access' ? 'var(--color-accent-primary,#1D2567)' : 'var(--bg-input,#fff)',
                color: view==='access' ? '#fff' : 'var(--text-secondary,#4A5560)', transition:'all 0.12s' }}>
              CS-Link Access
            </button>
          </div>

          {/* Status legend popover */}
          <StatusLegendPopover position="bottom-left" />

          {/* Filter input — capped at 380px */}
          <div style={{ position:'relative', maxWidth:380, flexShrink:1, minWidth:120, width:'100%' }}>
            <Search size={13} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted,#9ca3af)' }} />
            <input
              value={unifiedSearch}
              onChange={e => setUnifiedSearch(e.target.value)}
              placeholder="Filter students…"
              style={{ width:'100%', paddingLeft:30, paddingRight:unifiedSearch?28:10, paddingTop:7, paddingBottom:7,
                border:'1px solid var(--border-input,rgba(29,37,103,0.10))', borderRadius:7,
                fontSize:12, fontFamily:'DM Sans,sans-serif', background:'var(--bg-input,#fff)',
                color:'var(--text-body,#191919)', outline:'none', boxSizing:'border-box' }}
            />
            {unifiedSearch && (
              <button onClick={() => setUnifiedSearch('')}
                style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text-muted,#9ca3af)', padding:0, display:'flex' }}>
                <X size={12} />
              </button>
            )}
          </div>

          {/* Sort */}
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            style={{ height:32, border:'1px solid var(--border-input,rgba(29,37,103,0.10))', borderRadius:7, padding:'0 8px', fontSize:12, fontFamily:'DM Sans,sans-serif', background:'var(--bg-input,#fff)', color:'var(--text-body,#191919)', outline:'none', cursor:'pointer', flexShrink:0 }}>
            <option value="last_name_asc">Last Name A–Z</option>
            <option value="last_name_desc">Last Name Z–A</option>
            <option value="school_asc">School A–Z</option>
            <option value="status">ASPIRE Status</option>
            <option value="completion_desc">Profile Complete ↓</option>
            <option value="completion_asc">Profile Complete ↑</option>
            <option value="gpa_desc">GPA High–Low</option>
            <option value="gpa_asc">GPA Low–High</option>
          </select>

          {/* Active KPI filter clear */}
          {activeStatusFilter && (
            <button onClick={() => setActiveStatusFilter(null)}
              style={{ display:'flex', alignItems:'center', gap:4, height:32, padding:'0 10px', borderRadius:7, border:'1px solid rgba(29,37,103,0.15)', background:'#f0f3ff', color:'#1D2567', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'DM Sans,sans-serif', flexShrink:0 }}>
              <X size={10} />
              {Array.isArray(activeStatusFilter) ? 'Clear filter' : activeStatusFilter}
            </button>
          )}

          {/* List / Grid view toggle — only visible in Profiles mode */}
          {view === 'records' && (
            <div style={{ display:'flex', borderRadius:7, border:'1px solid var(--border-input,rgba(29,37,103,0.10))', overflow:'hidden', flexShrink:0 }}>
              <button onClick={() => setViewMode('list')}
                style={{ height:32, padding:'0 12px', display:'flex', alignItems:'center', gap:6, border:'none', cursor:'pointer', fontSize:12, fontFamily:'DM Sans,sans-serif', fontWeight:500,
                  background: viewMode==='list' ? 'var(--color-accent-primary,#1D2567)' : 'var(--bg-input,#fff)',
                  color: viewMode==='list' ? '#fff' : 'var(--text-secondary,#4A5560)', transition:'all 0.12s' }}>
                <List size={13} /> List
              </button>
              <button onClick={() => setViewMode('grid')}
                style={{ height:32, padding:'0 12px', display:'flex', alignItems:'center', gap:6, border:'none', cursor:'pointer', fontSize:12, fontFamily:'DM Sans,sans-serif', fontWeight:500,
                  background: viewMode==='grid' ? 'var(--color-accent-primary,#1D2567)' : 'var(--bg-input,#fff)',
                  color: viewMode==='grid' ? '#fff' : 'var(--text-secondary,#4A5560)', transition:'all 0.12s' }}>
                <LayoutGrid size={13} /> Grid
              </button>
            </div>
          )}

          {/* Spacer */}
          <div style={{ flex:1, minWidth:8 }} />

          {/* Action buttons */}
          {canEdit && (
            <button onClick={() => setShowImport(true)} title="Import from CSV"
              style={{ height:32, padding:'0 10px', border:'1px solid var(--border-input,rgba(29,37,103,0.10))', borderRadius:7, fontSize:12, fontFamily:'DM Sans,sans-serif', background:'var(--bg-input,#fff)', color:'var(--text-body,#191919)', cursor:'pointer', flexShrink:0 }}>
              ↑ Import
            </button>
          )}
          {canEdit && onAddStudent && (
            <button onClick={onAddStudent} title="Add student"
              style={{ height:32, padding:'0 10px', border:'1px solid var(--border-input,rgba(29,37,103,0.10))', borderRadius:7, fontSize:12, fontFamily:'DM Sans,sans-serif', background:'var(--bg-input,#fff)', color:'var(--text-body,#191919)', cursor:'pointer', flexShrink:0 }}>
              + Add
            </button>
          )}
          {canEdit && onExportCSV && (
            <button onClick={onExportCSV} title="Export CSV"
              style={{ height:32, padding:'0 10px', border:'1px solid var(--border-input,rgba(29,37,103,0.10))', borderRadius:7, fontSize:12, fontFamily:'DM Sans,sans-serif', background:'var(--bg-input,#fff)', color:'var(--text-body,#191919)', cursor:'pointer', flexShrink:0 }}>
              ↓ Export
            </button>
          )}
        </div>
      </div>

      {/* ── Profiles: always-open split view ── */}
      {view === 'records' && (
        <div className="profiles-slide-container">
          {/* Left column: Cohort View card */}
          <div className="profiles-list-narrow">
            {/* Cohort View header (sticky) */}
            <div style={{ position:'sticky', top:0, zIndex:5, background:'var(--color-bg-elevated,#f9fafb)', borderBottom:'1px solid var(--border-card,rgba(29,37,103,0.08))', padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:'var(--text-heading,#191919)', lineHeight:1.2 }}>Student Cohort View</div>
                <div style={{ fontSize:11, color:'var(--text-muted,#9ca3af)', marginTop:2 }}>
                  {displayedStudents.length} student{displayedStudents.length!==1?'s':''} shown · KPI cards work as quick filters
                </div>
              </div>
              {selectedName && (
                <div style={{ fontSize:11, color:'var(--text-muted,#9ca3af)', textAlign:'right', flexShrink:0, marginLeft:8 }}>
                  Selected: <span style={{ color:'var(--color-accent-primary,#1D2567)', fontWeight:600 }}>{selectedName}</span>
                </div>
              )}
            </div>
            {/* List or Grid */}
            <div style={{ flex:1, overflowY:'auto', minHeight:0 }}>
              <StudentListPanel
                students={displayedStudents}
                allStudents={students}
                selectedStudentId={selectedStudentId}
                onSelect={id => setSelectedStudentId(id)}
                cohortId={cohortId}
                onRefresh={onRefresh}
                units={units}
                viewMode={viewMode}
              />
            </div>
          </div>

          {/* Right column: Drawer (always open) */}
          <div className="profiles-panel-slide" key={selectedStudentId || 'empty'}>
            {selectedStudent ? (
              <StudentSidePanel
                student={selectedStudent}
                sortedStudents={displayedStudents}
                onSelectStudent={setSelectedStudentId}
                onClose={() => {}} // no-op; drawer is always open
                onUpdate={onUpdate}
                onDelete={onDelete}
                units={units}
                toast={toast}
              />
            ) : (
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--text-muted,#9ca3af)', fontFamily:'DM Sans,sans-serif', padding:40, textAlign:'center' }}>
                <div style={{ fontSize:32, marginBottom:12, opacity:0.4 }}>👤</div>
                <div style={{ fontSize:14, fontWeight:600, marginBottom:6 }}>No student selected</div>
                <div style={{ fontSize:12 }}>Select a student from the list to view their profile</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CS-Link Access ── */}
      {view === 'access' && (
        <div className="profiles-scroll-area">
          <AccessTab students={students} onUpdate={onUpdate} focusStudentId={accessFocusId} />
        </div>
      )}

      {showImport && <ImportStudentsCSV cohortId={cohortId} onImported={onRefresh} onClose={() => setShowImport(false)} />}
    </div>
  )
}
