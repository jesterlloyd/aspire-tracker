import { useState } from 'react'
import UnitCard from './UnitCard'
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
  const matchedStudents = students.filter(s =>  s.matched_unit_id)
  const unmatchedAll    = students.filter(s => !s.matched_unit_id)
  const poolSchools     = [...new Set(students.map(s => s.school).filter(Boolean))].sort()
  const filteredPool    = unmatchedAll.filter(s => {
    if (poolSearch && !`${s.first_name || ''} ${s.last_name || ''} ${s.name || ''}`.toLowerCase().includes(poolSearch.toLowerCase())) return false
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

  const handleSlotClick = unit => {
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
    <div className="matching-tab">

      {/* ── Summary ── */}
      <div className="match-summary">
        {summaryStats.map(s => (
          <div key={s.label} className="match-stat-card" style={{ background: s.bg, borderColor: s.border }}>
            <div className="match-stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="match-stat-label" style={{ color: s.color }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Unit management toolbar ── */}
      <div className="matching-toolbar">
        <div className="matching-toolbar-left">
          <button className="btn btn-primary" onClick={() => setShowUnitSetup(true)}>
            ⚙ Set Up Units
          </button>
          <button className="btn btn-outline-modal" style={{ background: '#fff' }} onClick={() => setShowImportUnits(true)}>
            ↑ Import Units from CSV
          </button>
        </div>
        {participating.length === 0 && (
          <span className="toolbar-hint">No participating units yet. Set up units to start matching.</span>
        )}
      </div>

      {/* ── Selection banner ── */}
      {selectedStudent && (
        <div className="selection-banner">
          <span>Placing <strong>{selectedStudent.name}</strong> — click an open slot on any unit card</span>
          <button className="btn-cancel-select" onClick={() => setSelectedStudent(null)}>Cancel</button>
        </div>
      )}

      {/* ── Matching Board ── */}
      {participating.length > 0 ? (
        <div className="matching-board">
          <div className="board-units-col">
            <div className="board-col-label">
              Clinical Units <span className="board-col-count">({participating.length})</span>
            </div>
            <div className="units-grid">
              {participating.map(unit => (
                <UnitCard
                  key={unit.id}
                  unit={unit}
                  matchedStudents={students.filter(s => s.matched_unit_id === unit.id)}
                  matches={matches}
                  selectedStudent={selectedStudent}
                  onSlotClick={() => handleSlotClick(unit)}
                  onUnmatch={student => onUnmatch(student, unit)}
                  onUpdateMatch={onUpdateMatch}
                  onDelete={() => onDeleteUnit(unit)}
                />
              ))}
            </div>
          </div>
          <div className="board-students-col">
            <div className="board-col-label">
              Student Pool <span className="board-col-count">({unmatchedAll.length} unmatched)</span>
            </div>
            <div className="pool-filter-row">
              <input className="pool-search-input" placeholder="Search by student name…"
                value={poolSearch} onChange={e => setPoolSearch(e.target.value)} />
              <select className="pool-school-select" value={poolSchool} onChange={e => setPoolSchool(e.target.value)}>
                <option value="">All Schools</option>
                {poolSchools.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="students-pool">
              {filteredPool.length === 0
                ? <div className="pool-empty">{unmatchedAll.length === 0 ? 'All students have been matched.' : 'No students match the current filter.'}</div>
                : filteredPool.map(s => (
                    <StudentMatchCard
                      key={s.id} student={s} units={units}
                      isSelected={selectedStudent?.id === s.id}
                      onSelect={handleStudentSelect}
                    />
                  ))
              }
            </div>
          </div>
        </div>
      ) : (
        <div className="state-box">
          <p>No participating units set up for this cohort.</p>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>
            Click "Set Up Units" above to choose which units are participating this cohort.
          </p>
        </div>
      )}

      {/* ── Export ── */}
      <div className="match-export-row">
        <button className="btn btn-primary" onClick={exportCSV}>↓ Export Matches CSV</button>
        <span className="export-hint">{matchedStudents.length} student{matchedStudents.length !== 1 ? 's' : ''} matched</span>
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
