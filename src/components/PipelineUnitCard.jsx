import { useState } from 'react'
import { UNIT_DIVISION_MAP } from '../lib/constants'
import { displayName } from '../lib/utils'
import ConfirmDeleteModal from './ConfirmDeleteModal'

const DIV_BADGE = {
  'Surgical':      { bg: '#78350f', color: '#fde68a' },
  'Medical':       { bg: '#1d2567', color: '#9faff8' },
  'Critical Care': { bg: '#7f1d1d', color: '#fca5a5' },
  'Specialty':     { bg: '#365314', color: '#d9f99d' },
}

export default function PipelineUnitCard({
  unit, matchedStudents, selectedStudent, onDotClick, onUnmatch, onDelete,
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  const filledCount = matchedStudents.length
  const emptyCount  = Math.max(0, unit.total_slots - filledCount)
  const isFull      = emptyCount === 0

  const division = unit.division || UNIT_DIVISION_MAP[unit.unit_name] || 'Medical'
  const badge    = DIV_BADGE[division] || DIV_BADGE['Medical']

  const compat = selectedStudent
    ? (selectedStudent.unit_preference_1 === unit.unit_name ? 'green'
      : selectedStudent.unit_preference_2 === unit.unit_name ? 'yellow'
      : selectedStudent.unit_preference_3 === unit.unit_name ? 'blue'
      : null)
    : null

  const leftBorder = isFull ? '#9ca3af' : emptyCount === 1 ? '#ca8a04' : '#16a34a'
  const glow = compat === 'green'  ? '0 0 0 3px #16a34a'
             : compat === 'yellow' ? '0 0 0 3px #ca8a04'
             : compat === 'blue'   ? '0 0 0 3px #0369a1'
             : undefined
  const bgTint = compat === 'green'  ? '#f0fdf4'
               : compat === 'yellow' ? '#fefce8'
               : compat === 'blue'   ? '#eff6ff'
               : '#ffffff'

  return (
    <>
      <div className="pz-unit-card" style={{
        borderLeft: `4px solid ${leftBorder}`,
        background: bgTint,
        boxShadow: glow,
        opacity: selectedStudent && isFull ? 0.55 : 1,
      }}>
        {/* Header strip */}
        <div className="pzuc-header">
          <span className="pzuc-name" title={unit.unit_name}>{unit.unit_name}</span>
          <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
            <span className="pzuc-div-badge" style={{ background: badge.bg, color: badge.color }}>
              {division}
            </span>
            <button className="pzuc-del-btn" onClick={() => setConfirmDelete(true)} title="Delete unit">✕</button>
          </div>
        </div>

        {/* Dot row */}
        <div className="pz-dot-row">
          {matchedStudents.map(student => (
            <FilledDot key={student.id} student={student} onUnmatch={() => onUnmatch(student)} />
          ))}
          {Array.from({ length: emptyCount }).map((_, i) => (
            <EmptyDot
              key={i}
              hasSelected={!!selectedStudent}
              compat={compat}
              onClick={selectedStudent ? onDotClick : undefined}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="pzuc-footer">
          {unit.shift_preference && (
            <span className="pzuc-shift-pill">{unit.shift_preference}</span>
          )}
          {isFull && <span className="pzuc-full-pill">Full</span>}
          {unit.contact_person && (
            <span className="pzuc-contact">{unit.contact_person}</span>
          )}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDeleteModal
          title={`Delete ${unit.unit_name}?`}
          warning="This action cannot be undone. Any students matched to this unit will be returned to unmatched."
          onConfirm={() => { setConfirmDelete(false); onDelete?.() }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}

function FilledDot({ student, onUnmatch }) {
  const [hovered, setHovered] = useState(false)
  const first = (student.first_name || student.name || '').slice(0, 8)
  return (
    <div className="pz-dot-wrapper"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>
      <div
        className={`pz-dot pz-dot-filled${hovered ? ' pz-dot-hovered' : ''}`}
        onClick={hovered ? onUnmatch : undefined}
        title={`${displayName(student)} — hover + click to unmatch`}>
        {hovered && <span className="pz-dot-x">×</span>}
      </div>
      <span className="pz-dot-name">{first}</span>
    </div>
  )
}

function EmptyDot({ hasSelected, compat, onClick }) {
  return (
    <div className="pz-dot-wrapper">
      <div
        className={`pz-dot pz-dot-empty${hasSelected && compat ? ' pz-dot-pulsing' : ''}`}
        style={{ cursor: onClick ? 'pointer' : 'default' }}
        onClick={onClick}
        title={onClick ? 'Click to place student here' : 'Open slot'}
      />
      <span className="pz-dot-name" style={{ visibility:'hidden' }}>·</span>
    </div>
  )
}
