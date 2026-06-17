import React, { useId } from 'react'

// SURVEY-UX-1 / UX-2 — Presentational-only collapsible dashboard tile for a Survey
// Automation workflow. Renders the accordion header (survey name + recipient badge +
// one-line status summary + five count chips + toggle) and shows `children` (the panel's
// existing body) when expanded. It holds NO detection, release, or send logic — the parent
// panel owns all of that and passes `counts` (its summary object), `expanded`, `onToggle`.

const F = 'DM Sans, sans-serif'

// Header count chips, in fixed order. Each shows a number AND a text label (never color-only).
const CHIPS = [
  { key: 'due_sendable',        label: 'Ready to release', fg: '#166534', bg: '#EDF7F0' },
  { key: 'due_unsendable',      label: 'Needs attention',  fg: '#991b1b', bg: '#FEECEC' },
  { key: 'suppressed_existing', label: 'Suppressed',       fg: '#1D2567', bg: '#EEF1FB' },
  { key: 'ineligible_hours',    label: 'Ineligible hours', fg: '#92400e', bg: '#FBF5E8' },
  { key: 'not_due',             label: 'Not due',          fg: '#4A5560', bg: '#F4F3F1' },
]

// Build the one-line status summary from the same counts shown in the chips.
// Actionable → leads with Ready / Needs attention; otherwise "No action needed" plus the
// non-zero standing buckets (e.g. "No action needed · 2 suppressed · 56 not due").
function buildStatusLine(counts = {}) {
  const ready = counts.due_sendable || 0
  const needs = counts.due_unsendable || 0
  if (ready > 0 || needs > 0) {
    const parts = []
    if (ready > 0) parts.push(`${ready} ready to release`)
    if (needs > 0) parts.push(`${needs} needs attention`)
    return parts.join(' · ')
  }
  const parts = ['No action needed']
  const sup = counts.suppressed_existing || 0
  const ineligible = counts.ineligible_hours || 0
  const notDue = counts.not_due || 0
  if (sup > 0) parts.push(`${sup} suppressed`)
  if (ineligible > 0) parts.push(`${ineligible} ineligible hours`)
  if (notDue > 0) parts.push(`${notDue} not due`)
  return parts.join(' · ')
}

export default function SurveyAutomationCard({ title, recipientLabel, counts = {}, expanded, onToggle, children }) {
  const baseId   = useId()
  const headerId = `${baseId}-header`
  const panelId  = `${baseId}-panel`
  const statusLine = buildStatusLine(counts)

  return (
    <div style={{
      background: '#fff', border: '1px solid #e8e4dc', borderRadius: 14,
      boxShadow: '0 1px 3px rgba(25,25,25,0.06)', overflow: 'hidden', fontFamily: F,
    }}>
      {/* Focus ring for the header button (keyboard accessibility). */}
      <style>{`.survey-accordion-header:focus-visible{outline:3px solid #93c5fd;outline-offset:-3px;}`}</style>

      <button
        type="button"
        id={headerId}
        className="survey-accordion-header"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', flexDirection: 'column', gap: 10,
          padding: '16px 18px', background: expanded ? '#fbfaf8' : '#fff', border: 'none',
          borderBottom: expanded ? '1px solid #e8e4dc' : 'none',
          cursor: 'pointer', textAlign: 'left', fontFamily: F,
        }}
      >
        {/* Top row: title + recipient badge (left), chevron (right) */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#191919' }}>{title}</span>
            <span style={{
              fontSize: 11, fontWeight: 700, color: '#1D2567', background: '#EEF1FB',
              border: '1px solid #d7ddf5', borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap',
            }}>
              Recipient: {recipientLabel}
            </span>
          </span>
          {/* Chevron — rotates with state; aria-hidden (state conveyed by aria-expanded). */}
          <span aria-hidden="true" style={{
            flexShrink: 0, color: '#6b7280', fontSize: 14, lineHeight: 1, marginTop: 2,
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s',
          }}>▸</span>
        </div>

        {/* One-line status summary */}
        <div style={{ fontSize: 12.5, color: '#6b7280', lineHeight: 1.4 }}>{statusLine}</div>

        {/* Count chips — each shows number + label */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CHIPS.map(c => (
            <span key={c.key} style={{
              fontSize: 11, fontWeight: 600, color: c.fg, background: c.bg,
              borderRadius: 8, padding: '3px 9px', whiteSpace: 'nowrap',
            }}>
              <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{counts[c.key] ?? 0}</span>{' '}{c.label}
            </span>
          ))}
        </div>
      </button>

      {expanded && (
        <div id={panelId} role="region" aria-labelledby={headerId}>
          {children}
        </div>
      )}
    </div>
  )
}
