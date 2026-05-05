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

  const gpa      = student.cumulative_gpa
  const gpaBg    = gpa == null ? 'var(--sand)'  : gpa >= 3.5 ? '#dcfce7' : gpa >= 3.0 ? '#fef3c7' : 'var(--sand)'
  const gpaColor = gpa == null ? 'var(--raven)' : gpa >= 3.5 ? '#166534' : gpa >= 3.0 ? '#92400e' : 'var(--raven)'
  const gpaText  = gpa != null ? `GPA: ${parseFloat(gpa).toFixed(2)}` : 'GPA: N/A'

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <span style={{ background: gpaBg, color: gpaColor, fontSize: 12, fontWeight: 600, padding: '1px 7px', borderRadius: 4 }}>
            {gpaText}
          </span>
          <span className={`interview-pill ${pillClass}`}>{outcome}</span>
        </div>
      </div>
      <div className="smc-school">{student.school}</div>

      {student.shift_availability && (
        <div className="smc-shift">
          Shift: <strong>{student.shift_availability}</strong>
        </div>
      )}

      <div className="smc-pref-pills">
        <PrefPill rank="1st" name={student.unit_preference_1} />
        <PrefPill rank="2nd" name={student.unit_preference_2} />
        <PrefPill rank="3rd" name={student.unit_preference_3} />
      </div>

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

function PrefPill({ rank, name }) {
  return name
    ? <span className="smc-pref-pill"><span className="smc-pref-rank">{rank}:</span> {name}</span>
    : <span className="smc-pref-pill smc-pref-unset"><span className="smc-pref-rank">{rank}:</span> Not set</span>
}
