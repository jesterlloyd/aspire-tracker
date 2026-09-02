/**
 * StudentMatchingCard - matching-context card, visual sibling to StudentCard.
 *
 * DESIGN CONTRACT
 * This component is part of the same design family as StudentCard. All visual
 * properties (radius, shadow, hover, typography, colors, spacing) reference the
 * same shared CARD tokens. A StudentCard and a StudentMatchingCard placed side by
 * side must read as siblings - same design DNA, different content purpose.
 *
 * DO NOT add one-off visual values here. Every border, shadow, spacing, and color
 * must come from the shared tokens in designTokens.js. That's the unification
 * mechanism: shared tokens, not identical structure.
 *
 * CONTENT DIFFERS from StudentCard:
 * StudentCard - compact grid card (avatar + short name + school·prog + variant strip)
 * StudentMatchingCard - horizontal workspace card with full name + preferences + availability
 *
 * PROPS
 * @param {Object}   student     - student record (full, including preferences)
 * @param {boolean}  isSelected  - whether this student is currently selected for matching
 * @param {Function} onSelect    - (student) → void
 * @param {boolean}  isReadOnly  - disables click interaction
 * @param {boolean}  isFading    - triggers CSS exit animation when student is matched
 * @param {boolean}  isFadingIn  - triggers CSS enter animation when student returns to pool
 * @param {Array}    units       - participating unit records, used for availability display
 * @param {Object}   focusedUnit - unit currently focused; highlights preference tier
 */

import { useState } from 'react'
import StudentAvatar from './StudentAvatar'
import { unitOpenSlots } from '../lib/placementDisplay'
import { CARD } from '../lib/designTokens'
import { formatSchoolProgram } from '../lib/displayFormatters'
import { ASPIRE_STATUS_CONFIG } from '../lib/constants'
import { DISPOSITION_TYPES, DISPOSITION_PILL_COLORS } from '../lib/dispositions'
import { getAvailabilityReadiness } from '../lib/availability'
import { getStudentPreferredFullName } from '../lib/studentNameFormatters'

// ── Preference tier colors (matches the strip used in MatchingTab focus banner) ─
const ORDINAL_COLOR = { 1: '#059669', 2: '#B5895A', 3: '#7C8FD9' }
const ORDINAL_LABEL = { 1: '1st', 2: '2nd', 3: '3rd' }

const KNOWN_UNIT_SHIFTS   = ['Day Shift', 'Night Shift', 'Either / No Preference']
const KNOWN_STUDENT_PREFS = ['Day Shift Preferred', 'Night Shift Preferred', 'No Preference']

const TIER_BADGE = {
  1: { bg: '#059669', label: '1st Choice' },
  2: { bg: '#B5895A', label: '2nd Choice' },
  3: { bg: '#7C8FD9', label: '3rd Choice' },
}

const F = 'DM Sans, sans-serif'

/**
 * Returns open slots for a unit name from the participating units array.
 * ASPIRE-CHART one capacity source: live match count vs configured total
 * (lib/placementDisplay), the same calculation the placement guard uses.
 * Returns null if the unit is not in the pool (hides the indicator rather
 * than showing a misleading value - per design spec).
 */
function getOpenCount(unitName, units, matches) {
  if (!unitName || !units?.length) return null
  const u = units.find(u => u.unit_name === unitName)
  return u != null ? unitOpenSlots(u, matches) : null
}

export default function StudentMatchingCard({
  student, isSelected, onSelect, isReadOnly,
  isFading, isFadingIn, units, matches, focusedUnit, rotation,
  needsException = false,
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)

  const classes = [
    'student-match-card',            // preserves existing CSS animations
    isFading   ? 'smc-exit'  : '',
    isFadingIn ? 'smc-enter' : '',
  ].filter(Boolean).join(' ')

  // ── Derived state ───────────────────────────────────────────────────────────
  const smcDispType = student.status === 'Not Proceeding' ? student.active_disposition?.disposition_type : null
  const statusCfg = student.status
    ? (smcDispType
        ? (DISPOSITION_PILL_COLORS[smcDispType] || DISPOSITION_PILL_COLORS['not_selected'])
        : (ASPIRE_STATUS_CONFIG[student.status] || ASPIRE_STATUS_CONFIG['Pending Outreach']))
    : null
  const statusLabel = smcDispType ? (DISPOSITION_TYPES[smcDispType] || student.status) : student.status

  // Choice tier vs. currently focused unit (1–3 = preference rank, null = not focused)
  const choiceTier = focusedUnit
    ? (student.unit_preference_1 === focusedUnit.unit_name ? 1
      : student.unit_preference_2 === focusedUnit.unit_name ? 2
      : student.unit_preference_3 === focusedUnit.unit_name ? 3
      : null)
    : null

  const prefs = [
    { rank: 1, unitName: student.unit_preference_1 },
    { rank: 2, unitName: student.unit_preference_2 },
    { rank: 3, unitName: student.unit_preference_3 },
  ].filter(p => p.unitName && p.unitName.trim())

  const gpaVal = parseFloat(student.cumulative_gpa)
  const hasGpa = !isNaN(gpaVal) && gpaVal > 0

  // ── Token-derived styles ────────────────────────────────────────────────────
  const boxShadow = focused
    ? CARD.focusRing
    : isSelected
    ? '0 4px 16px rgba(29,37,103,0.15)'
    : hovered
    ? CARD.shadowHover
    : CARD.shadowRest

  const transform = isSelected
    ? 'none'
    : hovered
    ? `translateY(${CARD.hoverLiftPx}px)`
    : 'none'

  return (
    <div
      className={classes}
      role={!isReadOnly ? 'button' : undefined}
      tabIndex={!isReadOnly ? 0 : undefined}
      aria-label={`${student.first_name} ${student.last_name}`}
      onClick={!isReadOnly ? () => onSelect(student) : undefined}
      onKeyDown={!isReadOnly ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(student) }
      } : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        display:      'flex',
        flexDirection:'column',
        gap:          8,
        background:   isSelected ? '#f8faff' : '#ffffff',
        // Border uses same token logic as StudentCard selected state
        border:       isSelected
          ? `2px solid #1D2567`
          : `1px solid rgba(29,37,103,0.08)`,
        borderRadius: CARD.radius,
        padding:      '12px 14px',
        cursor:       isReadOnly ? 'default' : 'pointer',
        transition:   `transform ${CARD.hoverDuration} ease, box-shadow ${CARD.hoverDuration} ease`,
        transform,
        boxShadow,
        outline:      'none',
        fontFamily:   F,
        userSelect:   'none',
        position:     'relative',
      }}
    >
      {/* PLACEMENT-POOL-READINESS-1: shown in the broader "All eligible
          students" mode, where a not-yet-interviewed student is visible and
          placing them is an approved exception. Deliberately OUTSIDE the
          focusedUnit block below: the warning must not depend on whether a
          unit happens to be selected. */}
      {needsException && (
        <div
          data-testid="card-not-interviewed"
          title="Placing this student requires an approved exception"
          style={{
            alignSelf: 'flex-start',
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 10, fontWeight: 700, fontFamily: F,
            padding: '3px 9px', borderRadius: 20,
            background: '#FEF3C7', color: '#92400e', border: '1px solid #fde68a',
          }}
        >
          Not interviewed · exception required
        </div>
      )}

      {/* ── Tier header chip + shift compatibility cue - shown when a unit filter is active ── */}
      {focusedUnit && (() => {
        const chipStyle = choiceTier === 1
          ? { bg:'#D1FAE5', color:'#065F46' }
          : choiceTier === 2
          ? { bg:'#FCEFD4', color:'#7C5A1F' }
          : choiceTier === 3
          ? { bg:'#E0E7FF', color:'#3730A3' }
          : null
        const unitShift    = focusedUnit.shift_preference
        const studentShift = student.shift_availability
        let cueLabel, cueStyle
        if (!unitShift || !unitShift.trim() || !studentShift || !studentShift.trim()) {
          cueLabel = 'Confirm shift'
          cueStyle = { background: '#FAFAFA', color: '#6B7280', border: '1px dashed #D1D5DB' }
        } else if (!KNOWN_UNIT_SHIFTS.includes(unitShift) || !KNOWN_STUDENT_PREFS.includes(studentShift)) {
          cueLabel = 'Confirm shift'
          cueStyle = { background: '#FAFAFA', color: '#6B7280', border: '1px dashed #D1D5DB' }
        } else if (unitShift === 'Either / No Preference') {
          cueLabel = '☀ / ☾ Flexible'
          cueStyle = { background: '#F3F4F6', color: '#6B7280', border: '1px solid #E5E7EB' }
        } else if (studentShift === 'No Preference') {
          cueLabel = '☀ / ☾ Flexible'
          cueStyle = { background: '#F3F4F6', color: '#6B7280', border: '1px solid #E5E7EB' }
        } else if (
          (unitShift === 'Day Shift' && studentShift === 'Day Shift Preferred') ||
          (unitShift === 'Night Shift' && studentShift === 'Night Shift Preferred')
        ) {
          cueLabel = '✓ Shift match'
          cueStyle = { background: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0' }
        } else {
          cueLabel = '⚠ Shift mismatch'
          cueStyle = { background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' }
        }
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
            {chipStyle && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 10, fontWeight: 700, fontFamily: F,
                padding: '3px 9px', borderRadius: 20,
                background: chipStyle.bg, color: chipStyle.color,
              }}>
                {TIER_BADGE[choiceTier].label} for {focusedUnit.unit_name}
              </div>
            )}
            <div style={{
              display: 'inline-flex', alignItems: 'center',
              fontSize: 10, fontWeight: 500, fontFamily: F,
              padding: '2px 8px', borderRadius: 20,
              background: cueStyle.background, color: cueStyle.color, border: cueStyle.border,
            }}>
              {cueLabel}
            </div>
          </div>
        )
      })()}

      {/* ── Top row: avatar + identity + selected pill ─────────────────── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 0 }}>
        {/* Avatar - 48px, same circular treatment and fallback as StudentCard */}
        <StudentAvatar student={student} size={48} style={{ flexShrink: 0, marginTop: 1 }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Full name (not short form - matching context needs the full name) */}
          <div style={{
            fontWeight: 700, fontSize: 13, color: '#1D2567', fontFamily: F,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            lineHeight: 1.25, marginBottom: 2,
          }}>
            {getStudentPreferredFullName(student)}
          </div>

          {/* School · Program - same utility and typography as StudentCard */}
          {(() => {
            const sp = formatSchoolProgram(student.school, student.program_type)
            return sp ? (
              <div style={{
                fontSize: 10.5, fontWeight: 500, color: '#9ca3af', fontFamily: F,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                marginBottom: 4,
              }}>
                {sp}
              </div>
            ) : null
          })()}

          {/* Status pills - cap at 2-3 to avoid overflow */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {statusCfg && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                background: statusCfg.bg, color: statusCfg.text,
                border: `1px solid ${statusCfg.border}`, whiteSpace: 'nowrap', fontFamily: F,
              }}>
                {statusLabel}
              </span>
            )}
            {hasGpa && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                background: '#f0fdf4', color: '#166534', fontFamily: F, whiteSpace: 'nowrap',
              }}>
                GPA {gpaVal.toFixed(2)}
              </span>
            )}
            {/* Small inline tier pill - shown only when NO unit filter is active.
                When focusedUnit is set, the header chip above the card already
                carries this information; rendering it here too is redundant. */}
            {choiceTier != null && !focusedUnit && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                background: TIER_BADGE[choiceTier].bg, color: '#fff', fontFamily: F, whiteSpace: 'nowrap',
              }}>
                {TIER_BADGE[choiceTier].label}
              </span>
            )}
          </div>
        </div>

        {/* Selected indicator - top-right chip */}
        {isSelected && (
          <span style={{
            flexShrink: 0, fontSize: 9, fontWeight: 700, fontFamily: F,
            padding: '2px 7px', borderRadius: 10,
            background: '#e0e7ff', color: '#1D2567',
            alignSelf: 'flex-start', marginTop: 1,
          }}>
            Selected
          </span>
        )}
      </div>

      {/* Shift preference + AVAILABILITY-CANON-1D readiness badge (readiness/review only - NOT
          preceptor compatibility). Privacy-safe: tooltip shows structural facts, never free text. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {(() => {
          const sa = student.shift_availability
          const s = { display: 'inline-flex', alignItems: 'center', fontSize: 10, fontWeight: 500, color: '#6B7280', border: '1px solid #E5E7EB', borderRadius: 20, padding: '2px 8px', background: '#F9FAFB', whiteSpace: 'nowrap', fontFamily: F }
          if (!sa || !sa.trim())              return <span style={s}>Pref: Not specified</span>
          if (sa === 'Day Shift Preferred')   return <span style={s}>Pref: ☀ Day</span>
          if (sa === 'Night Shift Preferred') return <span style={s}>Pref: ☾ Night</span>
          if (sa === 'No Preference')         return <span style={s}>Pref: ☀ / ☾ Flexible</span>
          return <span style={s}>Pref: Verify</span>
        })()}
        {(() => {
          const readiness = getAvailabilityReadiness({ student, rotation })
          const tone = {
            confirmed:  { bg: '#F0FDF4', color: '#166534', border: '#BBF7D0' },
            pending:    { bg: '#F9FAFB', color: '#6B7280', border: '#E5E7EB' },
            review:     { bg: '#FFFBEB', color: '#92400E', border: '#FDE68A' },
            restricted: { bg: '#FEF2F2', color: '#991B1B', border: '#FECACA' },
          }[readiness.level] || { bg: '#F9FAFB', color: '#6B7280', border: '#E5E7EB' }
          return (
            <span
              title={readiness.facts.join(' · ')}
              style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10, fontWeight: 600,
                color: tone.color, border: `1px solid ${tone.border}`, borderRadius: 20,
                padding: '2px 8px', background: tone.bg, whiteSpace: 'nowrap', fontFamily: F }}>
              {readiness.label}
            </span>
          )
        })()}
      </div>

      {/* ── Preference rows ─────────────────────────────────────────────── */}
      {prefs.length > 0 && (
        <div style={{
          borderTop: '1px solid rgba(29,37,103,0.05)',
          paddingTop: 7,
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          {prefs.map(({ rank, unitName }) => {
            const open = getOpenCount(unitName, units, matches)
            const isFull = open === 0
            return (
              <div key={rank} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  fontSize: 8, fontWeight: 700, color: ORDINAL_COLOR[rank],
                  width: 20, flexShrink: 0, fontFamily: F,
                }}>
                  {ORDINAL_LABEL[rank]}
                </span>
                <span style={{
                  fontSize: 11, fontWeight: 500, color: '#374151', fontFamily: F,
                  flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {unitName}
                </span>
                {open !== null && (
                  <span style={{
                    fontSize: 10, fontWeight: 600, flexShrink: 0, fontFamily: F,
                    color: isFull ? '#9ca3af' : '#16a34a',
                  }}>
                    {isFull ? 'Full' : `${open} open`}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
