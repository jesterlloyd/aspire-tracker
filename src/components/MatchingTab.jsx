import { useState, useEffect, useRef, useMemo } from 'react'
import EmbedUnitCard from './EmbedUnitCard'
import StudentMatchCard from './StudentMatchCard'
import UnitSetupPanel from './UnitSetupPanel'
import ImportUnitsCSV from './ImportUnitsCSV'
import { UNIT_DIVISION_MAP, ASPIRE_STATUS_SORT_ORDER } from '../lib/constants'
import MatchingBanner from './MatchingBanner'
import StatCard from './StatCard'
import StatusLegendPopover from './StatusLegendPopover'
import EmptyState from './EmptyState'
import { Layers, Clock, Users, MapPin, Star, TrendingUp, UserX, ClipboardList } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export const getInterviewStatus = (s) => {
  if (s.auto_recommendation === 'Recommend')
    return { label: 'Recommended',     color: '#166534', bg: '#f0fdf4' }
  if (s.auto_recommendation === 'Do Not Recommend')
    return { label: 'Not Recommended', color: '#991b1b', bg: '#fef2f2' }
  if (parseFloat(s.avg_composite_score) > 0)
    return { label: 'Rubric Submitted',color: '#1e40af', bg: '#eff6ff' }
  if (s.interview_scheduled_date)
    return { label: 'Scheduled',       color: '#92400e', bg: '#fffbeb' }
  return null
}

export const MATCH_QUALITY_CONFIG = {
  '1st':   { label: '★ 1st Choice Match', color: '#166534', bg: '#f0fdf4', border: '#86efac' },
  '2nd':   { label: '2nd Choice Match',   color: '#92400e', bg: '#fffbeb', border: '#fde68a' },
  '3rd':   { label: '3rd Choice Match',   color: '#1e40af', bg: '#eff6ff', border: '#bfdbfe' },
  'other': { label: 'Other Match',        color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
}

// Blacklist: exclude students who are already placed or finished
// (whitelist approach was too strict and excluded students with edge-case statuses)
const POOL_INELIGIBLE_STATUSES = new Set([
  'Placed', 'Active Rotation', 'Completed', 'Declined',
])

export default function MatchingTab({
  students, units, matches, cohortId,
  onMatch, onUnmatch, onUpdateMatch, onRefreshUnits, onDeleteUnit, highlightUnitId,
  toast,
}) {
  const [selectedStudent,   setSelectedStudent]   = useState(null)
  const cardRefs = useRef({})
  const [showUnitSetup,     setShowUnitSetup]     = useState(false)
  const [showImportUnits,   setShowImportUnits]   = useState(false)
  const [poolSearch,        setPoolSearch]        = useState('')
  const [poolSchool,        setPoolSchool]        = useState('')
  const [poolSort,          setPoolSort]          = useState('last_name_asc')
  const [divFilter,         setDivFilter]         = useState('')
  const [sortMode,          setSortMode]          = useState('alpha')
  const [fadingStudentIds,  setFadingStudentIds]  = useState(new Set())
  const [fadeInStudentIds,  setFadeInStudentIds]  = useState(new Set())

  const participating   = units.filter(u => u.is_participating)
  const totalSlots      = participating.reduce((s, u) => s + u.total_slots,     0)
  const slotsRemaining  = participating.reduce((s, u) => s + u.slots_remaining, 0)
  const unitsWithOpen   = participating.filter(u => u.slots_remaining > 0).length
  const matchedStudents = students.filter(s =>  s.matched_unit_id)
  // Pool only shows students who are unmatched AND have an eligible ASPIRE status
  // (excludes Placed, Active Rotation, Completed, Declined)
  const unmatchedAll    = students.filter(s => !s.matched_unit_id && !POOL_INELIGIBLE_STATUSES.has(s.status))
  const poolSchools     = [...new Set(students.map(s => s.school).filter(Boolean))].sort()

  const perfectMatches = matchedStudents.filter(s => {
    const u = units.find(u => u.id === s.matched_unit_id)
    return u && s.unit_preference_1 === u.unit_name
  }).length
  const secondChoiceMatches = matchedStudents.filter(s => {
    const u = units.find(u => u.id === s.matched_unit_id)
    return u && s.unit_preference_2 === u.unit_name
  }).length

  // Filter + sort units
  let displayUnits = [...participating]
  if (divFilter) {
    displayUnits = displayUnits.filter(u =>
      (u.division || UNIT_DIVISION_MAP[u.unit_name] || 'Medical') === divFilter
    )
  }
  if (sortMode === 'alpha') {
    displayUnits.sort((a, b) => a.unit_name.localeCompare(b.unit_name))
  } else if (sortMode === 'division') {
    displayUnits.sort((a, b) => {
      const da = a.division || UNIT_DIVISION_MAP[a.unit_name] || 'Medical'
      const db = b.division || UNIT_DIVISION_MAP[b.unit_name] || 'Medical'
      return da.localeCompare(db) || a.unit_name.localeCompare(b.unit_name)
    })
  } else if (sortMode === 'most-available') {
    displayUnits.sort((a, b) => b.slots_remaining - a.slots_remaining)
  }

  // Pool: include fading-out students temporarily for exit animation
  const poolBase = [
    ...unmatchedAll,
    ...students.filter(s => fadingStudentIds.has(s.id) && s.matched_unit_id),
  ]
  const filteredPool = poolBase.filter(s => {
    if (fadingStudentIds.has(s.id)) return true // always show during exit animation
    if (poolSearch && !`${s.first_name||''} ${s.last_name||''} ${s.name||''}`.toLowerCase().includes(poolSearch.toLowerCase())) return false
    if (poolSchool && s.school !== poolSchool) return false
    return true
  })

  // Sort the filtered pool while preserving fading students at original positions
  const sortedPool = [...filteredPool].sort((a, b) => {
    // Fading students stay sorted normally (they vanish in <300ms anyway)
    const la = (a.last_name || a.name || '').toLowerCase()
    const lb = (b.last_name || b.name || '').toLowerCase()
    switch (poolSort) {
      case 'last_name_desc': return lb.localeCompare(la)
      case 'school_asc':     return (a.school||'').localeCompare(b.school||'') || la.localeCompare(lb)
      case 'gpa_desc': {
        const ga = parseFloat(a.cumulative_gpa)||0, gb = parseFloat(b.cumulative_gpa)||0
        return gb - ga || la.localeCompare(lb)
      }
      case 'score_desc': {
        const sa = parseFloat(a.avg_composite_score)||0, sb = parseFloat(b.avg_composite_score)||0
        return sb - sa || la.localeCompare(lb)
      }
      case 'status': {
        const ia = ASPIRE_STATUS_SORT_ORDER.indexOf(a.status)
        const ib = ASPIRE_STATUS_SORT_ORDER.indexOf(b.status)
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || la.localeCompare(lb)
      }
      default: return la.localeCompare(lb) // last_name_asc
    }
  })

  const selectedIndex = useMemo(() =>
    sortedPool.findIndex(s => s.id === selectedStudent?.id),
  [sortedPool, selectedStudent?.id]) // eslint-disable-line

  useEffect(() => {
    if (selectedStudent?.id && cardRefs.current[selectedStudent.id]) {
      cardRefs.current[selectedStudent.id].scrollIntoView({ behavior:'smooth', block:'nearest' })
    }
  }, [selectedStudent?.id])

  const handlePrevStudent = () => {
    if (selectedIndex > 0) handleStudentSelect(sortedPool[selectedIndex - 1])
  }
  const handleNextStudent = () => {
    if (selectedIndex < sortedPool.length - 1) handleStudentSelect(sortedPool[selectedIndex + 1])
  }

  const getDisplayUnits = useMemo(() => {
    if (!selectedStudent) return { preferred: [], others: displayUnits, hasFocus: false }
    const prefNames = [
      selectedStudent.unit_preference_1,
      selectedStudent.unit_preference_2,
      selectedStudent.unit_preference_3,
    ].filter(Boolean)
    const preferred = prefNames.map(name => displayUnits.find(u => u.unit_name === name)).filter(Boolean)
    const prefSet   = new Set(prefNames)
    const others    = displayUnits.filter(u => !prefSet.has(u.unit_name))
    return { preferred, others, hasFocus: preferred.length > 0 }
  }, [displayUnits, selectedStudent]) // eslint-disable-line

  useEffect(() => {
    const onKey = (e) => {
      if (!selectedStudent) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault()
        if (selectedIndex < sortedPool.length - 1) handleStudentSelect(sortedPool[selectedIndex + 1])
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault()
        if (selectedIndex > 0) handleStudentSelect(sortedPool[selectedIndex - 1])
      }
      if (e.key === 'Escape') setSelectedStudent(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedStudent?.id, selectedIndex, sortedPool]) // eslint-disable-line

  const handleStudentSelect = s => setSelectedStudent(prev => prev?.id === s.id ? null : s)

  const handleSlotClick = unit => {
    if (!selectedStudent) return
    if (unit.slots_remaining <= 0) {
      toast?.warning('No slots available', 'This unit has no remaining open slots.')
      return
    }
    const id = selectedStudent.id
    // Start exit animation
    setFadingStudentIds(prev => new Set([...prev, id]))
    setTimeout(() => {
      setFadingStudentIds(prev => { const n = new Set(prev); n.delete(id); return n })
    }, 280)
    onMatch(selectedStudent, unit)
    setSelectedStudent(null)
  }

  const handleUnmatch = (student, unit) => {
    onUnmatch(student, unit)
    // Fade-in when student returns to pool
    const id = student.id
    setTimeout(() => {
      setFadeInStudentIds(prev => new Set([...prev, id]))
      setTimeout(() => {
        setFadeInStudentIds(prev => { const n = new Set(prev); n.delete(id); return n })
      }, 450)
    }, 80)
  }

  const exportCSV = () => {
    const headers = ['Student Name','School','School Email','Personal Email','Phone','Matched Unit','Match Quality','Preceptor Assigned','Shift Assigned','Unit Contact','Notes']
    const rows = matchedStudents.map(s => {
      const unit  = units.find(u => u.id === s.matched_unit_id)
      const match = matches.find(m => m.student_id === s.id)
      return [s.name, s.school, s.school_email, s.personal_email, s.phone,
        unit?.unit_name || '', match?.match_quality || s.match_quality || '',
        match?.preceptor_assigned || '', match?.shift_assigned || '',
        unit?.contact_person || '', match?.notes || '']
    })
    const csv = [headers,...rows].map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href=url; a.download=`aspire-matches-${new Date().toISOString().slice(0,10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const { canEdit } = useAuth()

  const studentMap = useMemo(() => {
    const map = {}
    ;(students || []).forEach(s => { map[s.id] = s })
    return map
  }, [students])

  // Non-editors see a lock screen
  if (!canEdit) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'400px', padding:'48px 24px', textAlign:'center' }}>
        <div style={{ width:'64px', height:'64px', borderRadius:'50%', background:'#f3f4f6', display:'flex', alignItems:'center', justifyContent:'center', marginBottom:'20px' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <div style={{ fontFamily:'DM Sans,sans-serif', fontWeight:700, fontSize:18, color:'#374151', marginBottom:10 }}>
          Placement decisions are made by the program leads.
        </div>
        <div style={{ fontFamily:'DM Sans,sans-serif', fontSize:14, color:'#9ca3af', lineHeight:1.7, maxWidth:'360px' }}>
          If you have a unit recommendation for a student, please include it in the interview rubric notes section. Jester and Krystal will review your recommendations during the placement process.
        </div>
      </div>
    )
  }

  const studentsCount  = students.length
  const matchedCount   = matchedStudents.length
  const unmatchedCount = unmatchedAll.length

  return (
    <div className="matching-tab embed-tab">

      {/* ── Summary banner ── */}
      <div className="stat-cards-row" style={{ padding:'6px 16px 12px' }}>
        <StatCard value={totalSlots}    label="Total Slots"     icon={Layers}    colorScheme="nightfall" />
        <StatCard value={slotsRemaining} label="Open Slots"      icon={Clock}    colorScheme="marina" />
        <StatCard value={studentsCount} label="Students"        icon={Users}     colorScheme="neutral" />
        <StatCard value={matchedCount}  label="Matched"         icon={MapPin}    colorScheme="green" />
        <StatCard value={perfectMatches} label="Perfect Matches" icon={Star}     colorScheme="darkgreen" />
        <StatCard value={secondChoiceMatches} label="2nd Choice" icon={TrendingUp} colorScheme="amber" />
        <StatCard
          value={unmatchedCount}
          label="Unmatched"
          icon={UserX}
          colorScheme={unmatchedCount > 0 ? 'amber' : 'green'}
        />
      </div>

      {/* ── Matching board: unified toolbar + subheader + panel bodies ── */}
      <style>{`.sp-search::placeholder { color: rgba(255,255,255,0.45); }`}</style>
      <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', border:'1px solid #e0e7ff', borderRadius:'14px', overflow:'hidden' }}>

        {/* ── Unified dark toolbar ── */}
        <div style={{ display:'flex', alignItems:'stretch', height:'88px', background:'linear-gradient(135deg, #1c2452 0%, #1D2567 100%)', flexShrink:0 }}>

          {/* Left half: Unit Pool (flex 58) */}
          <div style={{ flex:58, display:'flex', alignItems:'center', gap:'8px', padding:'0 16px', minWidth:0 }}>
            <span style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'14px', color:'#ffffff', flexShrink:0, marginRight:'2px' }}>Unit Pool</span>
            <select value={divFilter} onChange={e => setDivFilter(e.target.value)}
              style={{ height:'34px', background:'rgba(255,255,255,0.12)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:'8px', padding:'0 10px', fontFamily:'DM Sans', fontSize:'12px', color:'#ffffff', outline:'none', cursor:'pointer', flexShrink:0 }}>
              <option value="">All Divisions</option>
              <option value="Surgical">Surgical</option>
              <option value="Medical">Medical</option>
              <option value="Critical Care">Critical Care</option>
              <option value="Specialty">Specialty</option>
            </select>
            <select value={sortMode} onChange={e => setSortMode(e.target.value)}
              style={{ height:'34px', background:'rgba(255,255,255,0.12)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:'8px', padding:'0 10px', fontFamily:'DM Sans', fontSize:'12px', color:'#ffffff', outline:'none', cursor:'pointer', flexShrink:0 }}>
              <option value="alpha">A–Z</option>
              <option value="division">By Division</option>
              <option value="most-available">Most Available</option>
            </select>
            <div style={{ flex:1 }} />
            <button
              style={{ height:'34px', padding:'0 12px', background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.25)', borderRadius:'8px', fontFamily:'DM Sans', fontWeight:600, fontSize:'12px', color:'#ffffff', cursor:'pointer', display:'inline-flex', alignItems:'center', gap:'5px', whiteSpace:'nowrap', flexShrink:0, transition:'all 0.15s ease' }}
              onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.22)'}
              onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,0.15)'}
              onClick={() => setShowUnitSetup(true)}>
              ⚙ Set Up Units
            </button>
            <button
              style={{ height:'34px', padding:'0 12px', background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.25)', borderRadius:'8px', fontFamily:'DM Sans', fontWeight:600, fontSize:'12px', color:'#ffffff', cursor:'pointer', display:'inline-flex', alignItems:'center', gap:'5px', whiteSpace:'nowrap', flexShrink:0, transition:'all 0.15s ease' }}
              onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.22)'}
              onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,0.15)'}
              onClick={exportCSV}>
              ↓ Export CSV
            </button>
          </div>

          {/* Vertical divider */}
          <div style={{ width:'1px', background:'rgba(255,255,255,0.12)', flexShrink:0 }} />

          {/* Right half: Student Pool (flex 42) */}
          <div style={{ flex:42, display:'flex', alignItems:'center', gap:'8px', padding:'0 16px', minWidth:0 }}>
            <span style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'14px', color:'#ffffff', flexShrink:0, marginRight:'2px' }}>Student Pool</span>
            <input
              className="sp-search"
              value={poolSearch}
              onChange={e => setPoolSearch(e.target.value)}
              placeholder="Search..."
              style={{ flex:1, minWidth:'60px', height:'34px', background:'rgba(255,255,255,0.12)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:'8px', padding:'0 10px', fontFamily:'DM Sans', fontSize:'12px', color:'#ffffff', outline:'none', boxSizing:'border-box' }}
            />
            <select value={poolSchool} onChange={e => setPoolSchool(e.target.value)}
              style={{ height:'34px', background:'rgba(255,255,255,0.12)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:'8px', padding:'0 8px', fontFamily:'DM Sans', fontSize:'12px', color:'#ffffff', outline:'none', cursor:'pointer', flexShrink:0 }}>
              <option value="">All Schools</option>
              {poolSchools.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={poolSort} onChange={e => setPoolSort(e.target.value)} title="Sort student pool"
              style={{ height:'34px', background:'rgba(255,255,255,0.12)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:'8px', padding:'0 8px', fontFamily:'DM Sans', fontSize:'12px', color:'#ffffff', outline:'none', cursor:'pointer', flexShrink:0 }}>
              <option value="last_name_asc">Last Name A–Z</option>
              <option value="last_name_desc">Last Name Z–A</option>
              <option value="school_asc">School A–Z</option>
              <option value="gpa_desc">GPA High–Low</option>
              <option value="score_desc">Score High–Low</option>
              <option value="status">ASPIRE Status</option>
            </select>
          </div>
        </div>

        {/* ── Subheader strips: guidance/context (left) + count/pagination (right) ── */}
        <div style={{ display:'flex', background:'#f9fafb', borderBottom:'1px solid #e5e7eb', flexShrink:0 }}>
          {/* Left subheader: guidance when idle, brief focus indicator when active */}
          <div style={{ flex:58, height:'36px', display:'flex', alignItems:'center', padding:'0 16px', borderRight:'1px solid #e5e7eb', minWidth:0, overflow:'hidden' }}>
            {selectedStudent ? (
              <span style={{ fontFamily:'DM Sans', fontSize:'11px', color:'#6b7280', whiteSpace:'nowrap', fontStyle:'italic' }}>
                Unit pool reordered by preference · preferences highlighted below
              </span>
            ) : (
              <span style={{ fontFamily:'DM Sans', fontSize:'12px', color:'#9ca3af', fontStyle:'italic', whiteSpace:'nowrap' }}>
                Select a student from the Student Pool to view compatible units
              </span>
            )}
          </div>
          {/* Right subheader: count + legend icon + spacer + pagination */}
          <div style={{ flex:42, height:'36px', display:'flex', alignItems:'center', padding:'0 16px', minWidth:0, gap:'6px' }}>
            <span style={{ fontFamily:'DM Sans', fontSize:'12px', color:'#374151', flexShrink:0 }}>
              {selectedStudent
                ? `${selectedIndex + 1} of ${sortedPool.length}`
                : `${sortedPool.length} student${sortedPool.length !== 1 ? 's' : ''}`
              }
            </span>
            {/* View Status Legend — light context, portaled popover */}
            <StatusLegendPopover position="bottom-right" dark={false} />
            <div style={{ flex:1 }} />
            {sortedPool.length > 0 && (
              <div style={{ display:'flex', alignItems:'center', gap:'5px' }}>
                <button
                  onClick={handlePrevStudent}
                  disabled={!selectedStudent || selectedIndex <= 0}
                  title="Previous student"
                  style={{ width:'26px', height:'26px', background: (!selectedStudent || selectedIndex <= 0) ? '#f3f4f6' : '#e0e7ff', border:'1px solid #d1d5db', borderRadius:'6px', cursor:(selectedStudent && selectedIndex > 0) ? 'pointer' : 'default', display:'flex', alignItems:'center', justifyContent:'center', opacity:(!selectedStudent || selectedIndex <= 0) ? 0.4 : 1, transition:'all 0.15s ease' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#1D2567" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <button
                  onClick={handleNextStudent}
                  disabled={!selectedStudent || selectedIndex >= sortedPool.length - 1}
                  title="Next student"
                  style={{ width:'26px', height:'26px', background: (!selectedStudent || selectedIndex >= sortedPool.length - 1) ? '#f3f4f6' : '#e0e7ff', border:'1px solid #d1d5db', borderRadius:'6px', cursor:(selectedStudent && selectedIndex < sortedPool.length - 1) ? 'pointer' : 'default', display:'flex', alignItems:'center', justifyContent:'center', opacity:(!selectedStudent || selectedIndex >= sortedPool.length - 1) ? 0.4 : 1, transition:'all 0.15s ease' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#1D2567" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
                {selectedStudent && (
                  <span style={{ fontFamily:'DM Sans', fontSize:'10px', color:'#9ca3af', marginLeft:'2px', whiteSpace:'nowrap' }}>↑↓ · Esc</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Panel bodies (units left, students right) ── */}
        <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'row', overflow:'hidden' }}>

          {/* Left: Units panel */}
          <div className="embed-units-panel">
            <div className="embed-units-body">
              {/* MatchingBanner — compact card, only when student selected */}
              {selectedStudent && (
                <div style={{ padding:'12px 16px 0' }}>
                  <MatchingBanner
                    student={selectedStudent}
                    units={participating}
                    onClearSelection={() => setSelectedStudent(null)}
                  />
                </div>
              )}
              {participating.length === 0 ? (
                <EmptyState icon={<MapPin />}
                  heading="No units in the pool"
                  subtext="Use Set Up Units to add participating units and their available slots." />
              ) : (
                <div className="embed-unit-grid">
                  {getDisplayUnits.preferred.map(unit => (
                    <EmbedUnitCard
                      key={unit.id}
                      unit={unit}
                      matchedStudents={students.filter(s => s.matched_unit_id === unit.id)}
                      matches={matches}
                      studentMap={studentMap}
                      selectedStudent={selectedStudent}
                      onSlotClick={() => handleSlotClick(unit)}
                      onUnmatch={student => handleUnmatch(student, unit)}
                      onUpdateMatch={onUpdateMatch}
                      onDelete={() => onDeleteUnit(unit)}
                      isHighlighted={highlightUnitId === unit.id}
                    />
                  ))}
                  {getDisplayUnits.hasFocus && getDisplayUnits.others.length > 0 && (
                    <div style={{ display:'flex', alignItems:'center', gap:'10px', padding:'8px 4px', margin:'4px 0', gridColumn:'1 / -1' }}>
                      <div style={{ flex:1, height:'1px', background:'#e0e7ff' }} />
                      <span style={{ fontFamily:'DM Sans', fontWeight:600, fontSize:'10px', color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.06em', whiteSpace:'nowrap' }}>
                        Other Available Units
                      </span>
                      <div style={{ flex:1, height:'1px', background:'#e0e7ff' }} />
                    </div>
                  )}
                  {getDisplayUnits.others.map(unit => (
                    <EmbedUnitCard
                      key={unit.id}
                      unit={unit}
                      matchedStudents={students.filter(s => s.matched_unit_id === unit.id)}
                      matches={matches}
                      studentMap={studentMap}
                      selectedStudent={selectedStudent}
                      onSlotClick={() => handleSlotClick(unit)}
                      onUnmatch={student => handleUnmatch(student, unit)}
                      onUpdateMatch={onUpdateMatch}
                      onDelete={() => onDeleteUnit(unit)}
                      isHighlighted={highlightUnitId === unit.id}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Student pool */}
          <div className="embed-students-panel">
            <div className="embed-students-body">
              {filteredPool.length === 0 ? (
                unmatchedAll.length === 0
                  ? <EmptyState icon={<Star />}
                      heading="All students matched"
                      subtext="Every available student has been placed. Check the Student Profiles tab to review placements." />
                  : <EmptyState icon={<Users />}
                      heading="No students ready for matching"
                      subtext="Students appear here after completing their interview and being recommended for placement." />
              ) : (
                <div className="embed-student-list">
                  {sortedPool.map(s => (
                    <div key={s.id} ref={el => { cardRefs.current[s.id] = el }}>
                      <StudentMatchCard
                        student={s}
                        isSelected={selectedStudent?.id === s.id}
                        onSelect={handleStudentSelect}
                        isFading={fadingStudentIds.has(s.id)}
                        isFadingIn={fadeInStudentIds.has(s.id)}
                        units={participating}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>{/* end panel bodies */}
      </div>{/* end matching board wrapper */}

      {showUnitSetup && (
        <UnitSetupPanel cohortId={cohortId} currentUnits={units} students={students}
          onSaved={onRefreshUnits} onClose={() => setShowUnitSetup(false)} />
      )}
      {showImportUnits && (
        <ImportUnitsCSV cohortId={cohortId} onImported={onRefreshUnits}
          onClose={() => setShowImportUnits(false)} />
      )}
    </div>
  )
}
