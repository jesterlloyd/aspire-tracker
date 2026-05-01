import { useState } from 'react'
import UnitCard from './UnitCard'
import StudentMatchCard from './StudentMatchCard'

export default function MatchingTab({ students, units, matches, onMatch, onUnmatch, onUpdateMatch }) {
  const [selectedStudent, setSelectedStudent] = useState(null)

  const participating   = units.filter(u => u.is_participating)
  const totalSlots      = participating.reduce((s, u) => s + u.total_slots,     0)
  const slotsRemaining  = participating.reduce((s, u) => s + u.slots_remaining, 0)

  const matchedStudents = students.filter(s =>  s.matched_unit_id)
  const unmatchedAll    = students.filter(s => !s.matched_unit_id && s.interview_outcome !== 'Declined')
  const activeUnmatched = unmatchedAll.filter(s => s.interview_outcome !== 'Accepted with Reservations')
  const waitlisted      = students.filter(s => !s.matched_unit_id && s.interview_outcome === 'Accepted with Reservations')
  const declined        = students.filter(s =>  s.interview_outcome === 'Declined')

  const handleStudentSelect = student =>
    setSelectedStudent(prev => prev?.id === student.id ? null : student)

  const handleSlotClick = unit => {
    if (!selectedStudent) return
    onMatch(selectedStudent, unit)
    setSelectedStudent(null)
  }

  const exportCSV = () => {
    const headers = [
      'Student Name', 'School', 'School Email', 'Personal Email', 'Phone',
      'Matched Unit', 'Preceptor Assigned', 'Shift Assigned', 'Unit Contact', 'Notes',
    ]
    const rows = matchedStudents.map(s => {
      const unit  = units.find(u => u.id === s.matched_unit_id)
      const match = matches.find(m => m.student_id === s.id)
      return [
        s.name, s.school, s.school_email, s.personal_email, s.phone,
        unit?.unit_name        || '',
        match?.preceptor_assigned || '',
        match?.shift_assigned     || '',
        unit?.contact_person   || '',
        match?.notes           || '',
      ]
    })
    const csv = [headers, ...rows]
      .map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `aspire-matches-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const summaryStats = [
    { label: 'Total Slots',        value: totalSlots,             color: '#1a3a6b' },
    { label: 'Slots Remaining',    value: slotsRemaining,         color: '#0d9488' },
    { label: 'Students',           value: students.length,        color: '#64748b' },
    { label: 'Matched',            value: matchedStudents.length, color: '#16a34a' },
    { label: 'Unmatched',          value: activeUnmatched.length, color: '#2563eb' },
    { label: 'Waitlisted',         value: waitlisted.length,      color: '#ca8a04' },
    { label: 'Declined',           value: declined.length,        color: '#dc2626' },
  ]

  return (
    <div className="matching-tab">

      {/* ── Section 1: Summary ── */}
      <div className="match-summary">
        {summaryStats.map(s => (
          <div key={s.label} className="match-stat-card">
            <div className="match-stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="match-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Selection hint banner ── */}
      {selectedStudent && (
        <div className="selection-banner">
          <span>
            Placing <strong>{selectedStudent.name}</strong> —
            click an open slot on any unit card below
          </span>
          <button className="btn-cancel-select" onClick={() => setSelectedStudent(null)}>
            Cancel
          </button>
        </div>
      )}

      {/* ── Section 2: Matching Board ── */}
      <div className="matching-board">
        {/* Left: unit cards */}
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
              />
            ))}
          </div>
        </div>

        {/* Right: student pool */}
        <div className="board-students-col">
          <div className="board-col-label">
            Student Pool{' '}
            <span className="board-col-count">({unmatchedAll.length} available)</span>
          </div>
          <div className="students-pool">
            {unmatchedAll.length === 0 ? (
              <div className="pool-empty">All students matched or declined.</div>
            ) : (
              unmatchedAll.map(s => (
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

      {/* ── Section 3: Holding Areas ── */}
      <div className="holding-areas">
        <HoldingSection
          title="Unmatched Students"
          subtitle="Accepted or Pending Interview — not yet placed"
          students={activeUnmatched}
          units={units}
          selectedStudent={selectedStudent}
          onSelect={handleStudentSelect}
          emptyMessage="No unmatched students."
        />
        <HoldingSection
          title="Waitlisted Students"
          subtitle="Accepted with Reservations — awaiting placement"
          students={waitlisted}
          units={units}
          selectedStudent={selectedStudent}
          onSelect={handleStudentSelect}
          showBestFit
          emptyMessage="No waitlisted students."
        />
        <HoldingSection
          title="Declined"
          subtitle="Not pursuing placement at this time"
          students={declined}
          units={units}
          selectedStudent={null}
          onSelect={() => {}}
          isReadOnly
          emptyMessage="No declined students."
        />
      </div>

      {/* ── Section 4: Export ── */}
      <div className="match-export-row">
        <button className="btn btn-primary" onClick={exportCSV}>
          ↓ Export Matches CSV
        </button>
        <span className="export-hint">
          {matchedStudents.length} student{matchedStudents.length !== 1 ? 's' : ''} matched
        </span>
      </div>

    </div>
  )
}

function HoldingSection({
  title, subtitle, students, units,
  selectedStudent, onSelect,
  showBestFit, isReadOnly, emptyMessage,
}) {
  return (
    <div className="holding-section">
      <div className="holding-header">
        <div>
          <span className="holding-title">{title}</span>
          {subtitle && <span className="holding-subtitle"> — {subtitle}</span>}
        </div>
        <span className="holding-count">{students.length}</span>
      </div>
      <div className="holding-cards">
        {students.length === 0 ? (
          <div className="holding-empty">{emptyMessage}</div>
        ) : (
          students.map(s => (
            <StudentMatchCard
              key={s.id}
              student={s}
              units={units}
              isSelected={selectedStudent?.id === s.id}
              onSelect={onSelect}
              isReadOnly={isReadOnly}
              showBestFit={showBestFit}
            />
          ))
        )}
      </div>
    </div>
  )
}
