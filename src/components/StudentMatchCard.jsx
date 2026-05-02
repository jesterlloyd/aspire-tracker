import { UNIT_AREAS } from '../lib/constants'
import { displayName } from '../lib/utils'

const PILL_CLASS = {
  'Pending Interview':        'pill-gray',
  'Accepted':                 'pill-green',
  'Accepted with Reservations': 'pill-yellow',
  'Declined':                 'pill-red',
}

export default function StudentMatchCard({
  student,
  units,
  isSelected,
  onSelect,
  isReadOnly,
  showBestFit,
}) {
  const outcome = student.interview_outcome || 'Pending Interview'
  const pillClass = PILL_CLASS[outcome] || 'pill-gray'

  const prefs = [
    student.unit_preference_1,
    student.unit_preference_2,
    student.unit_preference_3,
  ].filter(Boolean)

  // Best fit: first open unit matching a preference (or same clinical area)
  const bestFit = showBestFit
    ? (() => {
        for (const pref of prefs) {
          const u = units.find(u => u.unit_name === pref && u.slots_remaining > 0)
          if (u) return u.unit_name
        }
        for (const pref of prefs) {
          const area = UNIT_AREAS[pref]
          if (area) {
            const u = units.find(u => UNIT_AREAS[u.unit_name] === area && u.slots_remaining > 0)
            if (u) return u.unit_name
          }
        }
        return null
      })()
    : null

  return (
    <div
      className={[
        'student-match-card',
        isSelected ? 'smc-selected' : '',
        isReadOnly ? 'smc-readonly' : '',
      ].filter(Boolean).join(' ')}
      onClick={!isReadOnly ? () => onSelect(student) : undefined}
      role={!isReadOnly ? 'button' : undefined}
    >
      <div className="smc-top">
        <span className="smc-name">{displayName(student)}</span>
        <span className={`interview-pill ${pillClass}`}>{outcome}</span>
      </div>
      <div className="smc-school">{student.school}</div>

      {student.shift_availability && (
        <div className="smc-shift">
          Shift: <strong>{student.shift_availability}</strong>
        </div>
      )}

      {prefs.length > 0 && (
        <ol className="smc-prefs">
          {prefs.map((p, i) => (
            <li key={i} className="smc-pref-item">{p}</li>
          ))}
        </ol>
      )}

      {student.matched_unit_id && (
        <div className="smc-matched">✓ Matched</div>
      )}

      {bestFit && (
        <div className="smc-bestfit">
          Best fit: <strong>{bestFit}</strong>
        </div>
      )}
    </div>
  )
}
