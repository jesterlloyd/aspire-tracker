/**
 * StudentMatchingCard - a student in the Placement Board's Student Pool.
 *
 * PLACEMENT-BOARD-FELT-1 (2026-09-17): a white paper note on cream leather.
 * Owner decision on content: the mockup's note (avatar, name, school, shift
 * chip, top 3) PLUS the cues that gate a placement decision - the
 * not-interviewed exception warning, the availability readiness badge, and
 * "Full" after any choice that has no open slot. ASPIRE status and GPA left the
 * note; they still sort the pool.
 *
 * Styling lives in src/components/placement/placementBoard.css (pb-note-*),
 * which reads the material and card tokens. No radius or gap is written here.
 *
 * PROPS
 * @param {Object}   student      - student record (full, including preferences)
 * @param {boolean}  isSelected   - selected for placement (navy outline, lifted)
 * @param {Function} onSelect     - (student) → void
 * @param {boolean}  isReadOnly   - no selection and no dragging
 * @param {boolean}  isFading     - leaving the pool after a placement
 * @param {boolean}  isFadingIn   - arriving back in the pool
 * @param {boolean}  isDimmed     - outside the focused unit's groups
 * @param {boolean}  isPending    - its unmatch is held in the Undo window: shown, not actionable
 * @param {Array}    units        - participating units, for Full after a choice
 * @param {Array}    matches      - live placements, for Full after a choice
 * @param {Object}   focusedUnit  - the unit the pool is grouped for; adds the #N pick chip
 * @param {Object}   rotation     - the student's cohort_school_rotations row
 * @param {boolean}  needsException - not yet interviewed: placing is an approved exception
 * @param {Function} onDragStart / onDragEnd - drag a note onto a board
 */

import StudentAvatar from './StudentAvatar'
import { unitOpenSlots } from '../lib/placementDisplay'
import { getAvailabilityReadiness } from '../lib/availability'
import { getStudentPreferredFullName } from '../lib/studentNameFormatters'
import { preferenceRankOf, RANK_TONE } from '../lib/placementBoardView'

/** Open slots for a unit name, or null when the unit is not in the pool. */
function getOpenCount(unitName, units, matches) {
  if (!unitName || !units?.length) return null
  const u = units.find(unit => unit.unit_name === unitName)
  return u != null ? unitOpenSlots(u, matches) : null
}

function shiftPreferenceChip(shiftAvailability) {
  const sa = shiftAvailability
  if (!sa || !sa.trim())              return 'Shift not specified'
  if (sa === 'Day Shift Preferred')   return '☀ Day'
  if (sa === 'Night Shift Preferred') return '☾ Night'
  if (sa === 'No Preference')         return '☀ / ☾ Flexible'
  return 'Verify shift'
}

export default function StudentMatchingCard({
  student, isSelected, onSelect, isReadOnly,
  isFading, isFadingIn, isDimmed = false, isPending = false,
  units, matches, focusedUnit, rotation,
  needsException = false,
  onDragStart, onDragEnd,
}) {
  const name = getStudentPreferredFullName(student)
  const interactive = !isReadOnly && !isPending
  const pickRank = focusedUnit ? preferenceRankOf(student, focusedUnit.unit_name) : null

  const prefs = [1, 2, 3]
    .map(rank => ({ rank, unitName: student[`unit_preference_${rank}`] }))
    .filter(p => p.unitName && p.unitName.trim())

  const readiness = getAvailabilityReadiness({ student, rotation })

  const classes = [
    'student-match-card', 'paper-note', 'pb-note', 'pb-pool-note',
    isSelected ? 'pb-note-selected' : '',
    isDimmed   ? 'pb-note-dimmed'   : '',
    isPending  ? 'pb-note-pending'  : '',
    interactive ? 'pb-note-interactive' : '',
    isFading   ? 'smc-exit'  : '',
    isFadingIn ? 'smc-enter' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={classes}
      data-pb-note=""
      data-student-id={student.id}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? !!isSelected : undefined}
      aria-label={`${name}${student.school ? `, ${student.school}` : ''}${isPending ? ', returning to the pool' : ''}`}
      draggable={interactive && !!onDragStart}
      onDragStart={interactive && onDragStart ? (e) => onDragStart(e, student) : undefined}
      onDragEnd={interactive && onDragEnd ? onDragEnd : undefined}
      onClick={interactive ? () => onSelect(student) : undefined}
      onKeyDown={interactive ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(student) }
      } : undefined}
    >
      {/* PLACEMENT-POOL-READINESS-1: shown in the broader "All eligible
          students" mode, where a not-yet-interviewed student is visible and
          placing them is an approved exception. It does not depend on whether
          a unit happens to be selected. */}
      {needsException && (
        <div
          data-testid="card-not-interviewed"
          title="Placing this student requires an approved exception"
          className="pb-chip pb-chip-warn"
        >
          Not interviewed · exception required
        </div>
      )}

      <div className="pb-note-id">
        <StudentAvatar student={student} size={40} />
        <div className="pb-note-id-text">
          <div className="pb-note-name">{name}</div>
          {student.school && <div className="pb-note-school material-soft">{student.school}</div>}
        </div>
      </div>

      <div className="pb-note-chips">
        <span className="pb-chip">{shiftPreferenceChip(student.shift_availability)}</span>
        {/* AVAILABILITY-CANON-1D readiness badge (readiness/review only). Privacy-safe:
            the tooltip shows structural facts, never free text. */}
        <span className={`pb-chip pb-chip-ready-${readiness.level || 'pending'}`} title={readiness.facts.join(' · ')}>
          {readiness.label}
        </span>
        {pickRank && (
          <span className={`pb-chip pb-chip-rank-${RANK_TONE[pickRank]}`} data-testid="pool-pick-chip">
            #{pickRank} pick
          </span>
        )}
      </div>

      {prefs.length > 0 && (
        <div className="pb-note-top3" aria-label="Top 3 units">
          {prefs.map(({ rank, unitName }, i) => {
            const open = getOpenCount(unitName, units, matches)
            return (
              <span key={rank}>
                {i > 0 && ' · '}
                {rank}. {unitName}{open === 0 ? ' (Full)' : ''}
              </span>
            )
          })}
        </div>
      )}

      {isPending && (
        <div className="pb-note-pending-caption material-soft">
          Returning to the pool. Undo is in the message below.
        </div>
      )}
    </div>
  )
}
