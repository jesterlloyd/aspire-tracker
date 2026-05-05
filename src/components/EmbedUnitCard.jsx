import { useState, useRef } from 'react'
import { UNIT_DIVISION_MAP } from '../lib/constants'
import { displayName } from '../lib/utils'

const COMPAT_LABEL = {
  green:  { text: '★ 1st Choice', color: '#16a34a' },
  yellow: { text: '★ 2nd Choice', color: '#ca8a04' },
  blue:   { text: '★ 3rd Choice', color: '#0369a1' },
}

export default function EmbedUnitCard({
  unit, matchedStudents, matches, selectedStudent,
  onSlotClick, onUnmatch, onUpdateMatch, onDelete,
}) {
  const [confirmUnmatch, setConfirmUnmatch] = useState(null) // student object
  const [confirmDelete,  setConfirmDelete]  = useState(false)

  const filledCount = matchedStudents.length
  const emptyCount  = Math.max(0, unit.total_slots - filledCount)
  const isFull      = emptyCount === 0

  const compat = selectedStudent
    ? (selectedStudent.unit_preference_1 === unit.unit_name ? 'green'
      : selectedStudent.unit_preference_2 === unit.unit_name ? 'yellow'
      : selectedStudent.unit_preference_3 === unit.unit_name ? 'blue'
      : null)
    : null

  const glow = compat === 'green'  ? '0 0 0 3px #16a34a'
             : compat === 'yellow' ? '0 0 0 3px #ca8a04'
             : compat === 'blue'   ? '0 0 0 3px #0369a1'
             : undefined
  const bgTint = compat === 'green'  ? '#f0fdf4'
               : compat === 'yellow' ? '#fefce8'
               : compat === 'blue'   ? '#eff6ff'
               : '#ffffff'

  const compatInfo = compat ? COMPAT_LABEL[compat] : null

  const fillBadge = isFull
    ? <span className="euc-fill-badge euc-fill-full">Full</span>
    : <span className="euc-fill-badge euc-fill-open">{emptyCount} of {unit.total_slots} open</span>

  return (
    <>
      <div className="euc-card" style={{
        background: bgTint,
        boxShadow: glow,
        opacity: selectedStudent && isFull ? 0.5 : 1,
      }}>
        {/* Header */}
        <div className="euc-header">
          <span className="euc-name" title={unit.unit_name}>{unit.unit_name}</span>
          <div className="euc-header-right">
            {compatInfo && (
              <span className="euc-compat-label" style={{ color: compatInfo.color }}>
                {compatInfo.text}
              </span>
            )}
            {fillBadge}
            <button className="euc-del-btn" onClick={() => setConfirmDelete(true)} title="Delete unit">✕</button>
          </div>
        </div>

        {/* Slots */}
        <div className="euc-slots">
          {matchedStudents.map(student => {
            const match = matches.find(m => m.student_id === student.id && m.unit_id === unit.id)
            return (
              <FilledSlotPill
                key={student.id}
                student={student}
                match={match}
                unit={unit}
                onUnmatch={() => setConfirmUnmatch(student)}
                onUpdateMatch={onUpdateMatch}
              />
            )
          })}
          {Array.from({ length: emptyCount }).map((_, i) => (
            <EmptySlotPill
              key={i}
              selectedStudent={selectedStudent}
              compat={compat}
              onClick={selectedStudent ? onSlotClick : undefined}
            />
          ))}
        </div>
      </div>

      {/* Unmatch confirmation */}
      {confirmUnmatch && (
        <div className="modal-overlay" onClick={() => setConfirmUnmatch(null)}>
          <div className="modal confirm-delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Unmatch Student</h2>
              <button className="modal-close" onClick={() => setConfirmUnmatch(null)}>×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-delete-warning">
                Unmatch <strong>{displayName(confirmUnmatch)}</strong> from <strong>{unit.unit_name}</strong>? Their preceptor and shift assignment will also be cleared.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline-modal" onClick={() => setConfirmUnmatch(null)}>Cancel</button>
              <button className="btn btn-destructive-filled" onClick={() => { onUnmatch(confirmUnmatch); setConfirmUnmatch(null) }}>
                Yes, Unmatch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(false)}>
          <div className="modal confirm-delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Delete {unit.unit_name}?</h2>
              <button className="modal-close" onClick={() => setConfirmDelete(false)}>×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-delete-warning">This action cannot be undone. Any students matched to this unit will be returned to unmatched.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline-modal" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="btn btn-destructive-filled" onClick={() => { setConfirmDelete(false); onDelete?.() }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function FilledSlotPill({ student, match, unit, onUnmatch, onUpdateMatch }) {
  const [preceptor, setPreceptor] = useState(match?.preceptor_assigned || '')
  const [shift,     setShift]     = useState(match?.shift_assigned     || '')
  const timerRef = useRef(null)

  const quality = student.unit_preference_1 === unit.unit_name ? 'top'
    : student.unit_preference_2 === unit.unit_name ? '2nd'
    : student.unit_preference_3 === unit.unit_name ? '3rd'
    : null

  const qBadge = quality === 'top' ? { text:'★ 1st', bg:'#dcfce7', color:'#166534' }
    : quality === '2nd' ? { text:'★ 2nd', bg:'#fef3c7', color:'#92400e' }
    : quality === '3rd' ? { text:'★ 3rd', bg:'#eff6ff', color:'#0369a1' }
    : null

  const savePreceptor = val => {
    setPreceptor(val)
    if (!match) return
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onUpdateMatch(match.id, student.id, { preceptor_assigned: val }), 500)
  }
  const saveShift = val => {
    setShift(val)
    if (match) onUpdateMatch(match.id, student.id, { shift_assigned: val })
  }

  return (
    <div className="euc-slot-filled">
      <div className="euc-sf-top">
        <div className="euc-sf-left">
          {qBadge && (
            <span className="euc-quality-star" style={{ background: qBadge.bg, color: qBadge.color }}>
              {qBadge.text}
            </span>
          )}
          <span className="euc-sf-name">{displayName(student)}</span>
        </div>
        <button className="euc-sf-unmatch" onClick={onUnmatch} title="Unmatch student">×</button>
      </div>
      <div className="euc-sf-row">
        <span className="euc-sf-lbl">Preceptor:</span>
        <input
          className="euc-sf-input"
          value={preceptor}
          onChange={e => savePreceptor(e.target.value)}
          placeholder="Assign preceptor…"
          onClick={e => e.stopPropagation()}
        />
      </div>
      <div className="euc-sf-row">
        <span className="euc-sf-lbl">Shift:</span>
        <select className="euc-sf-select" value={shift} onChange={e => saveShift(e.target.value)} onClick={e => e.stopPropagation()}>
          <option value="">—</option>
          <option value="Day">Day</option>
          <option value="Night">Night</option>
          <option value="Either">Either</option>
          <option value="Day and Night">Day and Night</option>
        </select>
      </div>
    </div>
  )
}

function EmptySlotPill({ selectedStudent, compat, onClick }) {
  const [showTip, setShowTip] = useState(false)
  const isReady = !!selectedStudent && !!onClick

  const tipQuality = compat === 'green'  ? 'Perfect match'
                   : compat === 'yellow' ? '2nd choice'
                   : compat === 'blue'   ? '3rd choice'
                   : ''

  return (
    <div style={{ position: 'relative' }}
      onMouseEnter={() => isReady && setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}>
      <div
        className={`euc-slot-empty${isReady ? ' euc-slot-ready' : ''}`}
        onClick={isReady ? onClick : undefined}>
        {isReady
          ? `Match ${displayName(selectedStudent)} here →`
          : '+ Open Slot'}
      </div>
      {showTip && (
        <div className="euc-slot-tooltip">
          <div>Match {displayName(selectedStudent)} here</div>
          {tipQuality && <div style={{ fontSize:10, opacity:0.8, marginTop:2 }}>{tipQuality}</div>}
        </div>
      )}
    </div>
  )
}
