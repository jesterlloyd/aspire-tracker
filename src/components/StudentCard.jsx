/**
 * StudentCard — unified card primitive for three display contexts.
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
 * Duration: CARD.hoverDuration. No instructional copy needed — the float IS the
 * affordance. Defined once here; identical across all three variants.
 *
 * KEYBOARD ACCESSIBILITY
 * tabIndex={0}, Enter/Space → onClick, visible focus ring via onFocus/onBlur state.
 *
 * PROPS
 * @param {Object}   student       — required; full student record from DB
 * @param {string}   variant       — required; 'profile' | 'on-campus' | 'interview'
 * @param {Function} onClick       — required; called on click or Enter/Space keypress
 * @param {Object}   [variantProps]— variant-specific data (see above)
 * @param {boolean}  [isSelected]  — optional; draws accent border (profile variant only)
 */

import { useState } from 'react'
import StudentAvatar from './StudentAvatar'
import { ASPIRE_STATUS_CONFIG } from '../lib/constants'
import { calculateProfileCompletion } from '../lib/profileCompletion'
import { CARD } from '../lib/designTokens'

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
function barColorFor(pct) {
  if (pct >= 100) return '#16a34a'   // sage
  if (pct >= 67)  return '#f59e0b'   // amber
  return '#E2569C'                    // rose
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
  if (!school) return '—'
  if (SCHOOL_SHORT[school]) return SCHOOL_SHORT[school]
  return school.length > 18 ? school.slice(0, 16) + '…' : school
}

/** Short status labels for the compact profile strip. */
const STATUS_SHORT = {
  'Pending Outreach':    'Outreach',
  'Form Sent':           'Form Sent',
  'Form Received':       'Form Received',
  'Interview Scheduled': 'Interview',
  'Interviewed':         'Interviewed',
  'Placed':              'Placed',
  'Active Rotation':     'In Rotation',
  'Completed':           'Completed',
  'Declined':            'Declined',
}

// ── Metadata strips ───────────────────────────────────────────────────────────

function ProfileStrip({ student }) {
  const cfg = student.status
    ? (ASPIRE_STATUS_CONFIG[student.status] || ASPIRE_STATUS_CONFIG['Pending Outreach'])
    : null
  return (
    <div style={{ padding: '8px 10px 10px', textAlign: 'center' }}>
      <div style={{
        fontSize: 10.5, color: '#9ca3af', ...F,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        marginBottom: 4,
      }}>
        {shortSchool(student.school)}
      </div>
      {cfg && (
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
          background: cfg.bg, color: cfg.text,
          border: `1px solid ${cfg.border}`, whiteSpace: 'nowrap', ...F,
        }}>
          {STATUS_SHORT[student.status] || student.status}
        </span>
      )}
    </div>
  )
}

function OnCampusStrip({ hoursCompleted, hoursRequired }) {
  const done = parseFloat(hoursCompleted) || 0
  const req  = parseFloat(hoursRequired)  || 200
  const pct  = Math.min(100, req > 0 ? (done / req) * 100 : 0)
  const barColor = barColorFor(pct)
  return (
    <div style={{ padding: '8px 12px 10px' }}>
      <div style={{
        fontSize: 12, fontWeight: 600, color: '#374151', ...F,
        textAlign: 'center', marginBottom: 5,
      }}>
        {done}h&thinsp;/&thinsp;{req}h
      </div>
      {/* Thin inline progress bar */}
      <div style={{ height: 3, background: '#e5e7eb', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 2,
          width: `${pct}%`,
          background: barColor,
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  )
}

function InterviewStrip({ interviewTime, interviewerName, interviewerColor }) {
  const initials = getInitials(interviewerName)
  const stripBg  = hexToRgba(interviewerColor || '#1D2567', CARD.tintOpacity)
  const chipBg   = hexToRgba(interviewerColor || '#1D2567', 0.18)
  const chipColor = interviewerColor || '#1D2567'
  return (
    <div style={{
      padding: '8px 10px 10px',
      background: stripBg,
      textAlign: 'center',
    }}>
      <div style={{
        fontSize: 13, fontWeight: 700, color: '#1D2567', ...F,
        marginBottom: 5,
      }}>
        {interviewTime}
      </div>
      {interviewerName && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 10, fontWeight: 700, ...F,
          padding: '2px 7px', borderRadius: 20,
          background: chipBg, color: chipColor,
          border: `1px solid ${hexToRgba(chipColor, 0.25)}`,
        }}>
          {initials}
          <span style={{ fontWeight: 500, opacity: 0.8 }}>
            {interviewerName.split(' ')[0]}
          </span>
        </span>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StudentCard({ student, variant, onClick, variantProps = {}, isSelected = false }) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)

  // Completion badge — profile variant only
  const showBadge = variant === 'profile'
  const completion = showBadge ? calculateProfileCompletion(student) : null
  const pct        = completion?.percentage ?? 0
  const badgeBg    = pct >= 100 ? '#16a34a' : pct >= 67 ? '#f59e0b' : '#E2569C'

  // Short display name
  const shortName = `${student.first_name || ''} ${(student.last_name || '')[0] || ''}.`.trim()

  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() }
  }

  // Card shell — dimensions, hover float, and selection ring all from tokens
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
      aria-label={`${student.first_name} ${student.last_name}`}
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
      {/* Avatar with optional completion badge */}
      <div style={{ position: 'relative', marginBottom: 8 }}>
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

      {/* Metadata strip — the only part that varies by variant */}
      <div style={{ width: '100%', marginTop: 2 }}>
        {variant === 'profile' && <ProfileStrip student={student} />}
        {variant === 'on-campus' && (
          <OnCampusStrip
            hoursCompleted={variantProps.hoursCompleted}
            hoursRequired={variantProps.hoursRequired}
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
