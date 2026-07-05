/**
 * StudentCard - unified card primitive for three display contexts.
 *
 * PURPOSE
 * Renders a student as a clickable photo/avatar card with variant-specific
 * metadata below the name. All three variants share identical dimensions,
 * avatar size, name typography, hover animation, and keyboard behavior.
 * Only the metadata strip changes.
 *
 * This component is designed as a foundational primitive intended for absorption
 * into a future <EntityCard> design-system abstraction. All dimensions and colors
 * reference CARD tokens from designTokens.js; there are no magic numbers here.
 * A single token change propagates to all three contexts simultaneously.
 *
 * VARIANTS
 *
 * 'profile'
 *   Metadata strip: school shorthand + ASPIRE status pill.
 *   Completion % badge in the avatar corner (sage/amber/rose by completeness).
 *   Used in: Student Profiles → Grid View.
 *
 * 'on-campus'
 *   Metadata strip: "Xh / Yh" text with a thin colored progress bar.
 *   Bar color: rose (<67%), amber (67-99%), sage (≥100%).
 *   No completion badge (the bar is the progress signal).
 *   variantProps required: { hoursCompleted: number, hoursRequired: number }
 *   Used in: Aggregate → On Campus Today section.
 *
 * 'interview'
 *   Metadata strip: interview time ("11:00 AM") + interviewer initials chip ("JG").
 *   Strip background tinted with interviewerColor at CARD.tintOpacity.
 *   No completion badge.
 *   variantProps required: { interviewTime, interviewerName, interviewerColor }
 *   Used in: Interview Room → Interviews Today section.
 *
 * HOVER BEHAVIOR
 * On mouse-enter: smooth translateY lift of CARD.hoverLiftPx + shadow expansion.
 * Duration: CARD.hoverDuration. No instructional copy needed - the float IS the
 * affordance. Defined once here; identical across all three variants.
 *
 * KEYBOARD ACCESSIBILITY
 * tabIndex={0}, Enter/Space → onClick, visible focus ring via onFocus/onBlur state.
 *
 * PROPS
 * @param {Object}   student       - required; full student record from DB
 * @param {string}   variant       - required; 'profile' | 'on-campus' | 'interview'
 * @param {Function} onClick       - required; called on click or Enter/Space keypress
 * @param {Object}   [variantProps]- variant-specific data (see above)
 * @param {boolean}  [isSelected]  - optional; draws accent border (profile variant only)
 */

import { useState } from 'react'
import StudentAvatar from './StudentAvatar'
import { ASPIRE_STATUS_CONFIG } from '../lib/constants'
import { calculateProfileCompletion } from '../lib/profileCompletion'
import { CARD } from '../lib/designTokens'
import { DISPOSITION_TYPES, DISPOSITION_PILL_COLORS } from '../lib/dispositions'
import { formatSchoolProgram } from '../lib/displayFormatters'
import { shiftBadge } from '../lib/shiftStatus'
import { getStudentPreferredFirstName, getStudentPreferredFullName } from '../lib/studentNameFormatters'

// SHIFT-VIS-1: tone → pill colors for the On Campus Now shift badge.
const SHIFT_BADGE_TONES = {
  day:         { bg: '#D1EFD8', color: '#166534' },
  night:       { bg: '#EDE9FE', color: '#5B21B6' },
  mid:         { bg: '#DCEFF8', color: '#1D2567' },
  variable:    { bg: '#E8EAF2', color: '#1D2567' },
  unspecified: { bg: '#F1EFEA', color: '#6b7280' },
}

// ── Token-derived style constants ─────────────────────────────────────────────

const F = { family: 'DM Sans, sans-serif' }

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a 6-char hex color + opacity fraction → rgba() string. */
function hexToRgba(hex, opacity) {
  const h = (hex || '#1D2567').replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r},${g},${b},${opacity})`
}

/** "Jennifer Gidaya" → "JG" */
function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Progress bar color by completion percentage. */
// ON-CAMPUS-NOW-UX-2B: tone for the accumulated-hours avatar ring + badge. Low progress is
// branded indigo (NOT grey) so a just-started student still reads as on-track, not inactive.
function hoursBadgeColor(pct) {
  if (pct >= 100) return '#15803d'   // strong green - required hours met/exceeded
  if (pct >= 80)  return '#16a34a'   // green - near completion
  if (pct >= 40)  return '#f59e0b'   // amber - moderate progress
  return '#4f46e5'                    // indigo (branded) - low / just starting
}

/** Abbreviate school names to fit the compact card width. */
const SCHOOL_SHORT = {
  'Azusa Pacific University':             'APU',
  'Cal State Long Beach':                 'Cal State LB',
  'California State University Long Beach': 'Cal State LB',
  'Cal State Northridge':                 'Cal State NR',
  'West Coast University Anaheim':        'WCU Anaheim',
  'West Coast University North Hollywood':'WCU NoHo',
}
function shortSchool(school) {
  if (!school) return '-'
  if (SCHOOL_SHORT[school]) return SCHOOL_SHORT[school]
  return school.length > 18 ? school.slice(0, 16) + '…' : school
}

/** Short status labels for the compact profile strip. */
const STATUS_SHORT = {
  'Pending Outreach':    'Outreach',
  'Form Sent':           'Form Sent',
  'Form Received':       'Form Received',
  'Interview Scheduled': 'Interview Scheduled',
  'Interviewed':         'Interviewed',
  'Placed':              'Placed',
  'Active Rotation':     'In Rotation',
  'Completed':           'Completed',
  'Declined':            'Declined',
  'Not Proceeding':      'Not Proceeding',
}

// ── Metadata strips ───────────────────────────────────────────────────────────

function ProfileStrip({ student }) {
  // When Not Proceeding with an active disposition, show the precise disposition
  // type pill instead of the generic status pill.
  const dispType = student.active_disposition?.disposition_type
  if (student.status === 'Not Proceeding' && dispType) {
    const colors = DISPOSITION_PILL_COLORS[dispType] || DISPOSITION_PILL_COLORS['not_selected']
    return (
      <div style={{ padding: '8px 10px 10px', textAlign: 'center', minHeight: 30 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
          background: colors.bg, color: colors.text,
          border: `1px solid ${colors.border}`,
          display: 'inline-block', maxWidth: '100%',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          ...F,
        }}>
          {DISPOSITION_TYPES[dispType] || dispType}
        </span>
      </div>
    )
  }

  const cfg = student.status
    ? (ASPIRE_STATUS_CONFIG[student.status] || ASPIRE_STATUS_CONFIG['Pending Outreach'])
    : null
  return (
    <div style={{ padding: '8px 10px 10px', textAlign: 'center', minHeight: 30 }}>
      {cfg && (
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
          background: cfg.bg, color: cfg.text,
          border: `1px solid ${cfg.border}`,
          display: 'inline-block', maxWidth: '100%',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          ...F,
        }}>
          {STATUS_SHORT[student.status] || student.status}
        </span>
      )}
    </div>
  )
}

// ON-CAMPUS-NOW-UX-2: compact strip - accumulated hours moved to the avatar badge and the
// horizontal progress bar removed, so the card is shorter/squarer. Shift type + unit share one
// centered row; open duration + overdue warning are preserved.
function OnCampusStrip({ shiftType, openShift, openDur, overdue, unit }) {
  // SHIFT-VIS-1: shift badge from the actual shift type (null → "Shift not specified").
  const { label: shiftLabel, tone } = shiftBadge(shiftType)
  const badgeTone = SHIFT_BADGE_TONES[tone] || SHIFT_BADGE_TONES.unspecified
  return (
    <div style={{ padding: '2px 10px 8px' }}>
      {/* Shift badge + current unit - one centered row to keep the card compact. */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
          background: badgeTone.bg, color: badgeTone.color, whiteSpace: 'nowrap', ...F,
        }}>
          {shiftLabel}
        </span>
        {unit && (
          <span style={{
            fontSize: 10.5, fontWeight: 600, color: '#475467', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110, ...F,
          }}>
            {unit}
          </span>
        )}
      </div>
      {/* Open-shift duration + hedged overdue - true open (in_progress) rows only */}
      {openShift && (
        <div style={{ textAlign: 'center', marginTop: 4 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: '#475467', ...F }}>Open {openDur}</div>
          {overdue && (
            <div style={{ fontSize: 10, fontWeight: 600, color: '#92400e', marginTop: 1, ...F }}>
              Clock-out may be overdue
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** "Krystal Rodriguez" → "Krystal R." - matches student short name format */
function shortInterviewerName(name) {
  if (!name) return ''
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

function InterviewStrip({ interviewTime, interviewerName, interviewerColor }) {
  const chipBg    = hexToRgba(interviewerColor || '#1D2567', 0.14)
  const chipColor = interviewerColor || '#1D2567'
  return (
    // Strip background is always neutral - color lives only in the pill,
    // consistent with profile (status pill) and on-campus (progress bar) variants.
    <div style={{ padding: '8px 10px 10px', textAlign: 'center' }}>
      <div style={{
        fontSize: 13, fontWeight: 700, color: '#1D2567', ...F,
        marginBottom: 5,
      }}>
        {interviewTime}
      </div>
      {interviewerName && (
        <span style={{
          display: 'inline-flex', alignItems: 'center',
          fontSize: 10, fontWeight: 700, ...F,
          padding: '2px 8px', borderRadius: 20,
          background: chipBg, color: chipColor,
          border: `1px solid ${hexToRgba(chipColor, 0.25)}`,
        }}>
          {shortInterviewerName(interviewerName)}
        </span>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StudentCard({ student, variant, onClick, variantProps = {}, isSelected = false }) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)

  // Completion badge - profile variant only
  const showBadge = variant === 'profile'
  const completion = showBadge ? calculateProfileCompletion(student) : null
  const pct        = completion?.percentage ?? 0
  const badgeBg    = pct >= 100 ? '#16a34a' : pct >= 67 ? '#f59e0b' : '#E2569C'

  // Short display name - STUDENT-PREFERRED-FIRST-NAME-1B: preferred first name + last initial.
  const shortName = `${getStudentPreferredFirstName(student)} ${(student.last_name || '')[0] || ''}.`.trim()

  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() }
  }

  // Card shell - dimensions, hover float, and selection ring all from tokens
  const boxShadow = focused
    ? CARD.focusRing
    : isSelected
    ? '0 4px 16px rgba(29,37,103,0.18)'
    : hovered
    ? CARD.shadowHover
    : CARD.shadowRest

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={getStudentPreferredFullName(student)}
      onClick={onClick}
      onKeyDown={handleKey}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        paddingTop: 16,
        borderRadius: CARD.radius,
        background: '#fff',
        border: isSelected
          ? '2px solid #1D2567'
          : '1px solid rgba(29,37,103,0.08)',
        cursor: 'pointer',
        outline: 'none',
        transition: `transform ${CARD.hoverDuration} ease, box-shadow ${CARD.hoverDuration} ease`,
        transform: isSelected
          ? 'scale(1.03)'
          : hovered
          ? `translateY(${CARD.hoverLiftPx}px)`
          : 'none',
        boxShadow,
        overflow: 'hidden',
        fontFamily: F.family,
        userSelect: 'none',
      }}
    >
      {/* Avatar with optional badge. ON-CAMPUS-NOW-UX-2B: on-campus cards wrap the avatar in a
          conic-gradient HOURS PROGRESS RING (branded-indigo base at 0% → green when complete) and
          show a compact hours pill at the lower-right corner, mirroring the Student Profiles grid
          completion badge. Profile/interview variants are unchanged. */}
      <div style={{ position: 'relative', marginBottom: 8 }}>
        {variant === 'on-campus' ? (() => {
          const done = parseFloat(variantProps.hoursCompleted) || 0
          const req  = parseFloat(variantProps.hoursRequired)  || 200
          const hp   = req > 0 ? Math.min(100, (done / req) * 100) : 0
          const RING = 4 // ring thickness (px)
          return (
            <div style={{
              width: CARD.avatarSize + RING * 2, height: CARD.avatarSize + RING * 2,
              borderRadius: '50%', padding: RING, boxSizing: 'border-box',
              // ON-CAMPUS-NOW-UX-2C: standard circular-progress convention - the fill starts at
              // 12 o'clock (conic-gradient default) and wraps CLOCKWISE toward 100% (50% = halfway).
              // Avatar and hours pill are NOT rotated. Track (remainder) is a faint branded navy,
              // visible as a subtle base ring at 0%.
              background: `conic-gradient(${hoursBadgeColor(hp)} ${hp}%, rgba(29,37,103,0.12) ${hp}% 100%)`,
            }}>
              <StudentAvatar
                student={student}
                size={CARD.avatarSize}
                style={{ border: '2px solid #fff', boxShadow: '0 2px 8px rgba(29,37,103,0.12)' }}
              />
            </div>
          )
        })() : (
          <StudentAvatar
            student={student}
            size={CARD.avatarSize}
            style={{
              border: isSelected
                ? '3px solid #1D2567'
                : '3px solid #fff',
              boxShadow: '0 2px 8px rgba(29,37,103,0.12)',
            }}
          />
        )}
        {showBadge && (
          <span style={{
            position: 'absolute', bottom: -2, right: -2,
            background: badgeBg, color: '#fff',
            fontSize: 9, fontWeight: 800,
            padding: '1px 5px', borderRadius: 8, lineHeight: 1.4,
            boxShadow: '0 1px 3px rgba(0,0,0,0.20)',
            fontFamily: F.family,
          }}>
            {pct}%
          </span>
        )}
        {variant === 'on-campus' && (() => {
          const done = parseFloat(variantProps.hoursCompleted) || 0
          const req  = parseFloat(variantProps.hoursRequired)  || 200
          const hp   = req > 0 ? Math.min(100, (done / req) * 100) : 0
          const fmt  = (n) => Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10)
          return (
            // Lower-right corner, partly outside the ring - mirrors the grid completion badge.
            <span style={{
              position: 'absolute', bottom: -3, right: -6,
              background: hoursBadgeColor(hp), color: '#fff',
              fontSize: 9, fontWeight: 800,
              padding: '1px 6px', borderRadius: 9, lineHeight: 1.4,
              boxShadow: '0 1px 3px rgba(0,0,0,0.22)', whiteSpace: 'nowrap',
              fontFamily: F.family,
            }}>
              {fmt(done)}/{fmt(req)}h
            </span>
          )
        })()}
      </div>

      {/* Short name */}
      <div style={{
        fontSize: 12, fontWeight: 700, color: '#191919',
        textAlign: 'center',
        maxWidth: 128, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        lineHeight: 1.3, marginBottom: 2, paddingInline: 6,
        fontFamily: F.family,
      }}>
        {shortName}
      </div>

      {/* School · Program - constant across all variants */}
      {(() => {
        const schoolProg = formatSchoolProgram(student.school, student.program_type)
        return schoolProg ? (
          <div style={{
            fontSize: 10, fontWeight: 500, color: '#9ca3af',
            textAlign: 'center',
            maxWidth: 128, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            lineHeight: 1.3, marginBottom: 3, paddingInline: 6,
            fontFamily: F.family,
          }}>
            {schoolProg}
          </div>
        ) : null
      })()}

      {/* Metadata strip - the only part that varies by variant */}
      <div style={{ width: '100%', marginTop: 2 }}>
        {variant === 'profile' && <ProfileStrip student={student} />}
        {variant === 'on-campus' && (
          <OnCampusStrip
            shiftType={variantProps.shiftType}
            openShift={variantProps.openShift}
            openDur={variantProps.openDur}
            overdue={variantProps.overdue}
            unit={variantProps.unit}
          />
        )}
        {variant === 'interview' && (
          <InterviewStrip
            interviewTime={variantProps.interviewTime}
            interviewerName={variantProps.interviewerName}
            interviewerColor={variantProps.interviewerColor}
          />
        )}
      </div>
    </div>
  )
}
