import { useState } from 'react'
import PipelineUnitCard from './PipelineUnitCard'
import StudentMatchCard from './StudentMatchCard'
import UnitSetupPanel from './UnitSetupPanel'
import ImportUnitsCSV from './ImportUnitsCSV'

export default function MatchingTab({
  students, units, matches, cohortId,
  onMatch, onUnmatch, onUpdateMatch, onRefreshUnits, onDeleteUnit,
}) {
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [showUnitSetup,   setShowUnitSetup]   = useState(false)
  const [showImportUnits, setShowImportUnits] = useState(false)
  const [poolSearch,      setPoolSearch]      = useState('')
  const [poolSchool,      setPoolSchool]      = useState('')

  const participating   = units.filter(u => u.is_participating)
  const totalSlots      = participating.reduce((s, u) => s + u.total_slots,     0)
  const slotsRemaining  = participating.reduce((s, u) => s + u.slots_remaining, 0)
  const unitsWithOpen   = participating.filter(u => u.slots_remaining > 0).length
  const matchedStudents = students.filter(s =>  s.matched_unit_id)
  const unmatchedAll    = students.filter(s => !s.matched_unit_id)
  const poolSchools     = [...new Set(students.map(s => s.school).filter(Boolean))].sort()

  const filteredPool = unmatchedAll.filter(s => {
    if (poolSearch && !`${s.first_name||''} ${s.last_name||''} ${s.name||''}`.toLowerCase().includes(poolSearch.toLowerCase())) return false
    if (poolSchool && s.school !== poolSchool) return false
    return true
  })

  const perfectMatches = matchedStudents.filter(s => {
    const u = units.find(u => u.id === s.matched_unit_id)
    return u && s.unit_preference_1 === u.unit_name
  }).length
  const secondChoiceMatches = matchedStudents.filter(s => {
    const u = units.find(u => u.id === s.matched_unit_id)
    return u && s.unit_preference_2 === u.unit_name
  }).length

  const handleStudentSelect = s => setSelectedStudent(prev => prev?.id === s.id ? null : s)

  const handleDotClick = unit => {
    if (!selectedStudent) return
    onMatch(selectedStudent, unit)
    setSelectedStudent(null)
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
    const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href=url; a.download=`aspire-matches-${new Date().toISOString().slice(0,10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const summaryStats = [
    { label: 'Total Slots',     value: totalSlots,             bg: '#ffffff', color: '#1d2567', border: '#d1d5db' },
    { label: 'Slots Remaining', value: slotsRemaining,         bg: '#dceff8', color: '#1d2567', border: '#b8d8eb' },
    { label: 'Students',        value: students.length,        bg: '#f4f1ec', color: '#191919', border: '#d4cfc8' },
    { label: 'Matched',         value: matchedStudents.length, bg: '#dcfce7', color: '#166534', border: '#a7f3d0' },
    { label: 'Perfect Matches', value: perfectMatches,         bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
    { label: '2nd Choice',      value: secondChoiceMatches,    bg: '#fefce8', color: '#ca8a04', border: '#fde68a' },
    { label: 'Unmatched',       value: unmatchedAll.length,    bg: '#fef3c7', color: '#92400e', border: '#fde68a' },
  ]

  return (
    <div className="matching-tab pipeline-board">

      {/* ── Summary banner ── */}
      <div className="match-summary pipeline-banner">
        {summaryStats.map(s => (
          <div key={s.label} className="match-stat-card" style={{ background: s.bg, borderColor: s.border }}>
            <div className="match-stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="match-stat-label" style={{ color: s.color }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Pipeline zones ── */}
      <div className="pipeline-zones-container">

        {/* ── Zone 1: Unit Board ── */}
        <div className="pipeline-zone pipeline-units-zone">
          <div className="pipeline-zone-header">
            <div className="pzh-left">
              <span className="pzh-title">Units</span>
              <span className="pzh-badge" style={{ background:'var(--marina)', color:'var(--nightfall)' }}>
                {totalSlots} slots available
              </span>
              <span className="pzh-badge" style={{ background:'#dcfce7', color:'#166534' }}>
                {unitsWithOpen} open
              </span>
            </div>
            <div className="pzh-right">
              <button className="btn btn-primary" style={{ fontSize:12, padding:'5px 12px' }} onClick={() => setShowUnitSetup(true)}>
                ⚙ Set Up Units
              </button>
              <button className="btn btn-outline-modal" style={{ fontSize:12, padding:'5px 12px', background:'#fff' }} onClick={() => setShowImportUnits(true)}>
                ↑ Import CSV
              </button>
              <button className="btn btn-outline-modal" style={{ fontSize:12, padding:'5px 12px', background:'#fff' }} onClick={exportCSV}>
                ↓ Export Matches
              </button>
            </div>
          </div>

          <div className="pipeline-zone-body">
            {participating.length === 0 ? (
              <div className="state-box" style={{ margin:16 }}>
                <p>No participating units set up for this cohort.</p>
                <p style={{ fontSize:13, color:'#64748b', marginTop:6 }}>
                  Click "Set Up Units" to get started.
                </p>
              </div>
            ) : (
              <div className="pipeline-unit-grid">
                {participating.map(unit => (
                  <PipelineUnitCard
                    key={unit.id}
                    unit={unit}
                    matchedStudents={students.filter(s => s.matched_unit_id === unit.id)}
                    selectedStudent={selectedStudent}
                    onDotClick={() => handleDotClick(unit)}
                    onUnmatch={student => onUnmatch(student, unit)}
                    onDelete={() => onDeleteUnit(unit)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Divider ── */}
        <div className="pipeline-divider">
          <span className="pipeline-divider-label">▲ Units &nbsp;&nbsp; ▼ Students</span>
        </div>

        {/* ── Zone 2: Student Pool ── */}
        <div className="pipeline-zone pipeline-students-zone">
          <div className="pipeline-zone-header pipeline-zone-header-dark">
            <span className="pzh-title-light">Student Pool</span>
            <div className="pzh-search-group">
              <input
                className="pipeline-search-input"
                placeholder="Search by name…"
                value={poolSearch}
                onChange={e => setPoolSearch(e.target.value)}
              />
              <select
                className="pipeline-school-select"
                value={poolSchool}
                onChange={e => setPoolSchool(e.target.value)}
              >
                <option value="">All Schools</option>
                {poolSchools.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <span className="pzh-count-light">
              {filteredPool.length !== unmatchedAll.length
                ? `Showing ${filteredPool.length} of ${unmatchedAll.length}`
                : `${unmatchedAll.length} unmatched`}
            </span>
          </div>

          <div className="pipeline-zone-body">
            {selectedStudent && (
              <div className="pipeline-selection-banner">
                <span>
                  Placing <strong>{selectedStudent.first_name || selectedStudent.name}</strong> — click an empty dot on a unit above
                </span>
                <button className="btn-cancel-select" onClick={() => setSelectedStudent(null)}>Cancel</button>
              </div>
            )}
            <div className="pipeline-student-grid">
              {filteredPool.length === 0 ? (
                <div className="pool-empty" style={{ gridColumn:'1/-1' }}>
                  {unmatchedAll.length === 0
                    ? 'All students have been matched.'
                    : 'No students match the current filter.'}
                </div>
              ) : (
                filteredPool.map(s => (
                  <StudentMatchCard
                    key={s.id}
                    student={s}
                    units={units}
                    isSelected={selectedStudent?.id === s.id}
                    onSelect={handleStudentSelect}
                  />
                ))
              )}
            </div>
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
