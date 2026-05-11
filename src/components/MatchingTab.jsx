import { useState } from 'react'
import EmbedUnitCard from './EmbedUnitCard'
import StudentMatchCard from './StudentMatchCard'
import UnitSetupPanel from './UnitSetupPanel'
import ImportUnitsCSV from './ImportUnitsCSV'
import { UNIT_DIVISION_MAP, ASPIRE_STATUS_SORT_ORDER } from '../lib/constants'
import StatCard from './StatCard'
import StatusLegendPopover from './StatusLegendPopover'
import { Layers, Clock, Users, MapPin, Star, TrendingUp, UserX } from 'lucide-react'

const POOL_ELIGIBLE_STATUSES = new Set([
  'Pending Outreach', 'Form Sent', 'Form Received', 'Interview Scheduled', 'Interviewed',
])

export default function MatchingTab({
  students, units, matches, cohortId,
  onMatch, onUnmatch, onUpdateMatch, onRefreshUnits, onDeleteUnit, highlightUnitId,
}) {
  const [selectedStudent,   setSelectedStudent]   = useState(null)
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
  const unmatchedAll    = students.filter(s => !s.matched_unit_id && POOL_ELIGIBLE_STATUSES.has(s.status))
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

  const handleStudentSelect = s => setSelectedStudent(prev => prev?.id === s.id ? null : s)

  const handleSlotClick = unit => {
    if (!selectedStudent) return
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

  const studentsCount  = students.length
  const matchedCount   = matchedStudents.length
  const unmatchedCount = unmatchedAll.length

  return (
    <div className="matching-tab embed-tab">

      {/* ── Summary banner ── */}
      <div className="stat-cards-row" style={{ padding:'12px 16px' }}>
        <StatCard value={totalSlots}    label="Total Slots"     icon={Layers}    colorScheme="nightfall" />
        <StatCard value={slotsRemaining} label="Slots Remaining" icon={Clock}    colorScheme="marina" />
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

      {/* ── Matching board ── */}
      <div className="embed-board">

        {/* ── Left: Units panel ── */}
        <div className="embed-units-panel">
          <div className="embed-units-header">
            <div className="embed-uh-left">
              <span className="embed-panel-title">Unit Pool</span>
            </div>
            <div className="embed-uh-right">
              <select className="embed-ctrl-select" value={divFilter} onChange={e => setDivFilter(e.target.value)}>
                <option value="">All Divisions</option>
                <option value="Surgical">Surgical</option>
                <option value="Medical">Medical</option>
                <option value="Critical Care">Critical Care</option>
                <option value="Specialty">Specialty</option>
              </select>
              <select className="embed-ctrl-select" value={sortMode} onChange={e => setSortMode(e.target.value)}>
                <option value="alpha">A–Z</option>
                <option value="division">By Division</option>
                <option value="most-available">Most Available</option>
              </select>
              <button className="btn btn-primary" style={{ fontSize:12, padding:'5px 11px' }} onClick={() => setShowUnitSetup(true)}>
                ⚙ Set Up Units
              </button>
              <button className="btn btn-outline-modal" style={{ fontSize:12, padding:'5px 11px', background:'#fff' }} onClick={exportCSV}>
                ↓ Export CSV
              </button>
            </div>
          </div>

          <div className="embed-units-body">
            {participating.length === 0 ? (
              <div className="state-box" style={{ margin:16 }}>
                <p>No participating units set up for this cohort.</p>
                <p style={{ fontSize:13, color:'#64748b', marginTop:6 }}>Click "Set Up Units" to get started.</p>
              </div>
            ) : (
              <div className="embed-unit-grid">
                {displayUnits.map(unit => (
                  <EmbedUnitCard
                    key={unit.id}
                    unit={unit}
                    matchedStudents={students.filter(s => s.matched_unit_id === unit.id)}
                    matches={matches}
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

        {/* ── Right: Student pool ── */}
        <div className="embed-students-panel">
          {/* Two-row header */}
          <div style={{ background:'#1D2567', padding:'10px 14px 8px', display:'flex', flexDirection:'column', gap:'8px', flexShrink:0 }}>
            {/* Row 1: Title + legend icon */}
            <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <span style={{ fontFamily:'DM Sans,sans-serif', fontWeight:700, fontSize:15, color:'#ffffff' }}>Student Pool</span>
              <StatusLegendPopover position="bottom-right" dark={true} />
            </div>
            {/* Row 2: Search + school filter + sort */}
            <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
              <input
                placeholder="Search by name…"
                value={poolSearch}
                onChange={e => setPoolSearch(e.target.value)}
                style={{ flex:1, minWidth:0, padding:'6px 10px', borderRadius:8, border:'none', background:'rgba(255,255,255,0.12)', color:'#ffffff', fontFamily:'DM Sans,sans-serif', fontSize:12, outline:'none' }}
              />
              <select value={poolSchool} onChange={e => setPoolSchool(e.target.value)}
                style={{ padding:'6px 8px', borderRadius:8, border:'none', background:'rgba(255,255,255,0.12)', color:'#ffffff', fontFamily:'DM Sans,sans-serif', fontSize:12, outline:'none', minWidth:90 }}>
                <option value="">All Schools</option>
                {poolSchools.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={poolSort} onChange={e => setPoolSort(e.target.value)} title="Sort student pool"
                style={{ padding:'6px 8px', borderRadius:8, border:'none', background:'rgba(255,255,255,0.12)', color:'#ffffff', fontFamily:'DM Sans,sans-serif', fontSize:12, outline:'none', minWidth:90 }}>
                <option value="last_name_asc">↑↓ Last Name A–Z</option>
                <option value="last_name_desc">↑↓ Last Name Z–A</option>
                <option value="school_asc">↑↓ School A–Z</option>
                <option value="gpa_desc">↑↓ GPA High–Low</option>
                <option value="score_desc">↑↓ Score High–Low</option>
                <option value="status">↑↓ ASPIRE Status</option>
              </select>
            </div>
          </div>

          <div className="embed-students-body">
            {filteredPool.length === 0 ? (
              <div className="pool-empty" style={{ padding:32, textAlign:'center' }}>
                {unmatchedAll.length === 0
                  ? 'All students have been matched.'
                  : 'No students match the current filter.'}
              </div>
            ) : (
              <div className="embed-student-list">
                {sortedPool.map(s => (
                  <StudentMatchCard
                    key={s.id}
                    student={s}
                    isSelected={selectedStudent?.id === s.id}
                    onSelect={handleStudentSelect}
                    isFading={fadingStudentIds.has(s.id)}
                    isFadingIn={fadeInStudentIds.has(s.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

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
