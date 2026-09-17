/**
 * StudentMatchingCard - a student in the Placement Board's Student Pool.
 *
 * PLACEMENT-BOARD-FELT-1 (2026-09-17): a white paper note on cream leather.
 * Owner decisions on content, in order:
 *   - avatar, name, school, shift chip, and the top 3 stacked down the right side
 *     with "Full" after any choice that has no open slot;
 *   - the ASPIRE Status pill on every note. It is the pool's readiness indicator now
 *     that the readiness filter is gone, which is why the amber "exception required"
 *     chip retired: the confirmation dialog is still the guard;
 *   - the availability pill ONLY when it warrants a look (Review / Highly restricted).
 *     Confirmed and pending say nothing a placement decision needs.
 * GPA is not on the note.
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
 * @param {Function} onDragStart / onDragEnd - drag a note onto a board
 */

import StudentAvatar from './StudentAvatar'
import { ASPIRE_STATUS_CONFIG } from '../lib/constants'
import { DISPOSITION_TYPES, DISPOSITION_PILL_COLORS } from '../lib/dispositions'
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
  onDragStart, onDragEnd,
}) {
  const name = getStudentPreferredFullName(student)
  const interactive = !isReadOnly && !isPending
  const pickRank = focusedUnit ? preferenceRankOf(student, focusedUnit.unit_name) : null

  const prefs = [1, 2, 3]
    .map(rank => ({ rank, unitName: student[`unit_preference_${rank}`] }))
    .filter(p => p.unitName && p.unitName.trim())

  // AVAILABILITY-CANON-1D, shown only when it changes a decision.
  const readiness = getAvailabilityReadiness({ student, rotation })
  const availabilityWarning = readiness.level === 'review' || readiness.level === 'restricted'

  // The ASPIRE Status pill, in the canonical colours the legend explains. A
  // Not Proceeding student cannot reach this pool, but the disposition mapping is
  // kept so the pill never renders a status without its own colour.
  const dispositionType = student.status === 'Not Proceeding' ? student.active_disposition?.disposition_type : null
  const statusStyle = student.status
    ? (dispositionType
        ? (DISPOSITION_PILL_COLORS[dispositionType] || DISPOSITION_PILL_COLORS['not_selected'])
        : (ASPIRE_STATUS_CONFIG[student.status] || ASPIRE_STATUS_CONFIG['Pending Outreach']))
    : null
  const statusLabel = dispositionType ? (DISPOSITION_TYPES[dispositionType] || student.status) : student.status

  const classes = [
    // Deliberately NOT .student-match-card: that legacy rule paints its own
    // background, border and radius, and in dark mode it repainted the paper.
    'paper-note', 'pb-note', 'pb-pool-note',
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
      <div className="pb-note-main">
        <div className="pb-note-left">
          <div className="pb-note-id">
            <StudentAvatar student={student} size={40} />
            <div className="pb-note-id-text">
              <div className="pb-note-name">{name}</div>
              {student.school && <div className="pb-note-school material-soft">{student.school}</div>}
            </div>
          </div>

          <div className="pb-note-chips">
            {statusStyle && (
              <span
                className="pb-chip pb-chip-status"
                data-testid="pool-status-pill"
                style={{ background: statusStyle.bg, color: statusStyle.text, borderColor: statusStyle.border }}
              >
                {statusLabel}
              </span>
            )}
            <span className="pb-chip">{shiftPreferenceChip(student.shift_availability)}</span>
            {availabilityWarning && (
              /* Privacy-safe: the tooltip shows structural facts, never free text. */
              <span
                className={`pb-chip pb-chip-ready-${readiness.level}`}
                data-testid="pool-availability-warning"
                title={readiness.facts.join(' · ')}
              >
                {readiness.label}
              </span>
            )}
            {pickRank && (
              <span className={`pb-chip pb-chip-rank-${RANK_TONE[pickRank]}`} data-testid="pool-pick-chip">
                #{pickRank} pick
              </span>
            )}
          </div>
        </div>

        {prefs.length > 0 && (
          <ol className="pb-note-top3" aria-label="Top 3 units">
            {prefs.map(({ rank, unitName }) => {
              const open = getOpenCount(unitName, units, matches)
              return (
                <li key={rank} className="pb-note-top3-row">
                  <span className="pb-note-top3-rank" aria-hidden="true">{rank}.</span>
                  <span className="pb-note-top3-unit">{unitName}{open === 0 ? ' (Full)' : ''}</span>
                </li>
              )
            })}
          </ol>
        )}
      </div>

      {isPending && (
        <div className="pb-note-pending-caption material-soft">
          Returning to the pool. Undo is in the message below.
        </div>
      )}
    </div>
  )
}
