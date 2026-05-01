import { useState, useRef } from 'react'
import { getCompatibility } from '../lib/constants'

const COMPAT_TITLE = {
  green:  'Top preference match',
  yellow: 'Same clinical area',
  gray:   'No preference overlap',
}

export default function UnitCard({
  unit,
  matchedStudents,
  matches,
  selectedStudent,
  onSlotClick,
  onUnmatch,
  onUpdateMatch,
}) {
  const [showConsiderations, setShowConsiderations] = useState(false)

  const filledCount = matchedStudents.length
  const emptyCount  = Math.max(0, unit.total_slots - filledCount)
  const compat      = selectedStudent ? getCompatibility(selectedStudent, unit.unit_name) : null

  return (
    <div className={`unit-card${compat ? ` uc-compat-${compat}` : ''}`}>
      {/* Header */}
      <div className="uc-header">
        <div className="uc-name-row">
          <span className="uc-name">{unit.unit_name}</span>
          {compat && (
            <span
              className={`compat-dot dot-${compat}`}
              title={COMPAT_TITLE[compat]}
            />
          )}
        </div>
        <div className="uc-contact">{unit.contact_person}</div>
        <div className="uc-meta">
          <span className="shift-pill">{unit.shift_preference}</span>
          <span className="slot-count">
            {unit.slots_remaining} of {unit.total_slots} open
          </span>
        </div>
      </div>

      {/* Preceptors */}
      {unit.preceptors && (
        <div className="uc-preceptors">
          <span className="uc-preceptors-label">Preceptors:</span> {unit.preceptors}
        </div>
      )}

      {/* Collapsible considerations */}
      {unit.considerations && (
        <div className="uc-considerations">
          <button
            className="considerations-toggle"
            onClick={() => setShowConsiderations(p => !p)}
          >
            {showConsiderations ? '▾' : '▸'} Considerations
          </button>
          {showConsiderations && (
            <p className="considerations-text">{unit.considerations}</p>
          )}
        </div>
      )}

      {/* Slots */}
      <div className="slot-list">
        {matchedStudents.map(student => {
          const match = matches.find(
            m => m.student_id === student.id && m.unit_id === unit.id
          )
          return (
            <FilledSlot
              key={student.id}
              student={student}
              match={match}
              onUnmatch={() => onUnmatch(student)}
              onUpdateMatch={onUpdateMatch}
            />
          )
        })}
        {Array.from({ length: emptyCount }).map((_, i) => (
          <EmptySlot
            key={i}
            hasSelected={!!selectedStudent}
            compat={compat}
            onClick={selectedStudent ? onSlotClick : undefined}
          />
        ))}
      </div>
    </div>
  )
}

function FilledSlot({ student, match, onUnmatch, onUpdateMatch }) {
  const [preceptor, setPreceptor] = useState(match?.preceptor_assigned || '')
  const [shift,     setShift]     = useState(match?.shift_assigned     || '')
  const timerRef = useRef(null)

  const savePreceptor = val => {
    setPreceptor(val)
    if (!match) return
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(
      () => onUpdateMatch(match.id, match.student_id, { preceptor_assigned: val }),
      600
    )
  }

  const saveShift = val => {
    setShift(val)
    if (match) onUpdateMatch(match.id, match.student_id, { shift_assigned: val })
  }

  return (
    <div className="slot slot-filled">
      <div className="slot-filled-header">
        <span className="slot-student-name">{student.name}</span>
        <button className="unmatch-btn" onClick={onUnmatch} title="Remove match">
          ✕
        </button>
      </div>
      <input
        className="slot-preceptor-input"
        placeholder="Assign preceptor…"
        value={preceptor}
        onChange={e => savePreceptor(e.target.value)}
      />
      <select
        className="slot-shift-select"
        value={shift}
        onChange={e => saveShift(e.target.value)}
      >
        <option value="">Shift…</option>
        <option value="Day">Day</option>
        <option value="Night">Night</option>
        <option value="Midshift">Midshift</option>
        <option value="Either">Either</option>
      </select>
    </div>
  )
}

function EmptySlot({ hasSelected, compat, onClick }) {
  const ready = hasSelected && !!onClick
  return (
    <div
      className={`slot slot-empty${ready ? ' slot-ready' : ''}`}
      onClick={ready ? onClick : undefined}
    >
      {ready
        ? <span className="slot-ready-text">{compat === 'green' ? '★ Place here' : 'Place here'}</span>
        : <span className="slot-open-text">Open slot</span>}
    </div>
  )
}
