// src/components/rotation/RotationStudentTable.jsx
//
// ROTATION-ACTIVITY-CALENDAR-1: the Rotation > Activity student list.
//
// Replaces the stacked progress CARDS with a table carrying the same columns the Unit
// Leader portal's "Your students" roster uses, so the two surfaces read the same way for
// the same data. It is a real <table>: the portal's is too, and a grid of divs would lose
// the column headers that make an eleven-column scan legible to a screen reader.
//
// NOT A PORT OF THE PORTAL'S MARKUP. That roster is styled with ptl-* classes from
// src/portal/portal.css, which is not reliably present in the staff bundle, so the styling
// here is the staff idiom (the same tokens the cards used). What is shared is the column
// set and the reading order, not a stylesheet.
//
// TWO DIFFERENCES FROM THE PORTAL'S ROSTER, both deliberate:
//   1. No Cohort column. Staff already pick one cohort in the header, so every row would
//      repeat it. A Unit Leader sees several cohorts at once and needs it.
//   2. An Actions column with View/Hide Hours, which expands the shared ClinicalHoursPanel
//      INCLUDING its review controls. A Unit Leader cannot review shifts; staff can, and
//      that panel is the only place a stranded Pending Review shift can be cleared.
//
// EXPANSION IS A SECOND ROW, not a nested table, so the hours panel gets the full width
// and the column grid above it stays intact.

import { getStudentPreferredFullName } from '../../lib/studentNameFormatters'
import StatusLegendPopover from '../StatusLegendPopover'
import { ASPIRE_STATUS_CONFIG } from '../../lib/constants'

const F = 'Plus Jakarta Sans, sans-serif'
const NAVY = '#1D2567'
const COLSPAN = 7

const td = { padding: '11px 12px', fontSize: 12.5, color: '#374151', verticalAlign: 'middle' }

function Badge({ label, tone }) {
  const tones = {
    sage:  { bg: '#eef6ee', color: '#2F7D5C', border: '#cfe6d6' },
    amber: { bg: '#fdf6ec', color: '#92400e', border: '#f0c9b0' },
    rose:  { bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' },
    green: { bg: '#ecfdf3', color: '#166534', border: '#bbf7d0' },
  }[tone] || { bg: '#f3f4f6', color: '#4b5563', border: '#e5e7eb' }
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, whiteSpace: 'nowrap',
      background: tones.bg, color: tones.color, border: `1px solid ${tones.border}`, fontFamily: F,
    }}>{label}</span>
  )
}

function StatusPill({ status }) {
  const cfg = ASPIRE_STATUS_CONFIG[status] || ASPIRE_STATUS_CONFIG['Pending Outreach']
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, padding: '2px 9px', borderRadius: 20, whiteSpace: 'nowrap',
      background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}`, fontFamily: F,
    }}>{status}</span>
  )
}

function HoursCell({ apv, req, pct, lastLogText, noRecentLog }) {
  const barColor = pct >= 80 ? '#166534' : NAVY
  return (
    <div style={{ minWidth: 150 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#374151', marginBottom: 4 }}>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{apv} of {req || '-'}</span>
        <span style={{ fontWeight: 700, color: barColor }}>{Math.round(pct)}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 12, background: '#f3f4f6', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 12, background: barColor, transition: 'width 400ms ease' }} />
      </div>
      <div style={{ fontSize: 10.5, color: noRecentLog ? '#92400e' : '#9ca3af', marginTop: 4 }}>{lastLogText}</div>
    </div>
  )
}

function StudentRow({ card, expanded, onToggle, onOpenProfile, onSupportOpen, innerRef, highlighted, children }) {
  const { s, req, apv, pct, lastLog, daysSince, noRecentLog, missingPreceptor, onCampus,
          precName, unitName, complete, nearComplete, shift, school, range, supportNeeded,
          pendingReview } = card
  const name = getStudentPreferredFullName(s)
  const lastLogText = lastLog
    ? `Last log ${new Date(lastLog).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      + (daysSince != null ? ` · ${daysSince === 0 ? 'today' : `${daysSince}d ago`}` : '')
    : 'No shifts logged yet'

  const rowBg = highlighted ? '#f7f9ff' : expanded ? '#fbfaf8' : '#fff'

  return (
    <>
      <tr
        ref={innerRef}
        style={{
          background: rowBg,
          // Clear the sticky top nav + Rotation tab header when scrollIntoView lands here.
          scrollMarginTop: 88,
          boxShadow: highlighted ? `inset 3px 0 0 ${NAVY}` : 'none',
          transition: 'background 0.4s ease, box-shadow 0.4s ease',
        }}
      >
        <td style={{ ...td, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, fontFamily: F }}>{name}</div>
          {school && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{school}</div>}
          {(onCampus || missingPreceptor || noRecentLog || pendingReview > 0 || complete || nearComplete || supportNeeded > 0) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
              {onCampus && <Badge label="On campus now" tone="sage" />}
              {missingPreceptor && <Badge label="No preceptor" tone="rose" />}
              {noRecentLog && <Badge label="No recent log" tone="amber" />}
              {/* SHIFT-LOG-REVIEW-1: stranded hours are invisible until someone looks.
                  This badge is the per-student queue entry; expanding the row shows the
                  Review action on each Pending Review shift. */}
              {pendingReview > 0 && <Badge label={`Needs review · ${pendingReview}`} tone="amber" />}
              {complete ? <Badge label="Complete" tone="green" />
                : nearComplete ? <Badge label="Near complete" tone="amber" /> : null}
              {/* SUPPORT-NEEDED-VISIBILITY-1: opens the exact flagged shift rather than
                  only expanding the row and leaving the reader to hunt the table. */}
              {supportNeeded > 0 && (
                <button
                  type="button"
                  onClick={() => onSupportOpen ? onSupportOpen(s.id) : (!expanded && onToggle())}
                  title="Open the flagged shift's support request"
                  aria-label={`Support needed${supportNeeded > 1 ? ` (${supportNeeded} entries)` : ''}. Open the flagged shift.`}
                  style={{
                    fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, whiteSpace: 'nowrap',
                    background: '#FBF5E8', color: '#8B5E1A', border: '1px solid #f0c9b0',
                    fontFamily: F, cursor: 'pointer',
                  }}
                >
                  {supportNeeded > 1 ? `Support needed · ${supportNeeded}` : 'Support needed'}
                </button>
              )}
            </div>
          )}
        </td>
        <td style={td}><StatusPill status={s.status} /></td>
        <td style={td}>{precName || <span style={{ color: '#b91c1c' }}>Not assigned</span>}</td>
        <td style={td}>{shift || '-'}</td>
        <td style={{ ...td, whiteSpace: 'nowrap' }}>
          {range || '-'}
          {unitName && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{unitName}</div>}
        </td>
        <td style={td}>
          <HoursCell apv={apv} req={req} pct={pct} lastLogText={lastLogText} noRecentLog={noRecentLog} />
        </td>
        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
          <button
            onClick={onToggle}
            aria-expanded={expanded}
            style={{
              fontSize: 12, fontWeight: 600, color: NAVY, background: 'rgba(29,37,103,0.07)',
              border: '1px solid rgba(29,37,103,0.15)', borderRadius: 8, padding: '7px 12px',
              cursor: 'pointer', fontFamily: F, whiteSpace: 'nowrap',
            }}>
            {expanded ? 'Hide Hours ▴' : 'View Hours ▾'}
          </button>
          {onOpenProfile && (
            <div>
              <button
                onClick={() => onOpenProfile(s.id)}
                style={{
                  background: 'none', border: 'none', padding: '4px 0 0', cursor: 'pointer',
                  fontFamily: F, fontSize: 11, fontWeight: 600, color: '#9ca3af',
                }}>
                Profile →
              </button>
            </div>
          )}
        </td>
      </tr>
      {expanded && (
        <tr style={{ background: '#fbfaf8' }}>
          <td colSpan={COLSPAN} style={{ padding: '0 12px 14px' }}>{children}</td>
        </tr>
      )}
    </>
  )
}

/**
 * @param cards            the row models built by RotationActivity (one per student)
 * @param expandedId       which student's hours panel is open, or null
 * @param onToggle(id)     open/close a row
 * @param onOpenProfile    (studentId) opens the staff student drawer
 * @param onSupportOpen    (studentId) opens that student's flagged shift
 * @param rowRef(id, el)   registers the row element for scroll-into-view
 * @param highlightId      the row currently being flashed after a handoff
 * @param renderHours(card) the expanded panel for one row
 */
export default function RotationStudentTable({
  cards = [],
  expandedId = null,
  onToggle,
  onOpenProfile = null,
  onSupportOpen = null,
  rowRef = null,
  highlightId = null,
  renderHours,
}) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e8e4dc', borderRadius: 14,
      overflowX: 'auto', fontFamily: F,
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
        <caption style={{
          position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
          overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
        }}>
          Students placed or in active rotation for this cohort, with clinical hours progress
        </caption>
        <thead>
          <tr>
            <th scope="col" className="aspire-th">Student</th>
            <th scope="col" className="aspire-th">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                ASPIRE status<StatusLegendPopover position="bottom-left" />
              </span>
            </th>
            <th scope="col" className="aspire-th">Preceptor</th>
            <th scope="col" className="aspire-th">Shift</th>
            <th scope="col" className="aspire-th">Rotation</th>
            <th scope="col" className="aspire-th">Hours</th>
            <th scope="col" className="aspire-th aspire-th-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {cards.map(card => (
            <StudentRow
              key={card.s.id}
              card={card}
              expanded={expandedId === card.s.id}
              highlighted={highlightId === card.s.id}
              onToggle={() => onToggle(card.s.id)}
              onOpenProfile={onOpenProfile}
              onSupportOpen={onSupportOpen}
              innerRef={rowRef ? el => rowRef(card.s.id, el) : undefined}
            >
              {renderHours?.(card)}
            </StudentRow>
          ))}
        </tbody>
      </table>
    </div>
  )
}
