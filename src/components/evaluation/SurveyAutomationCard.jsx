import React, { useId } from 'react'

// SURVEY-UX-1 — Presentational-only collapsible card for a Survey Automation workflow.
// Renders the accordion header (survey name + recipient badge + five count chips + toggle)
// and shows `children` (the panel's existing body) when expanded. It holds NO detection,
// release, or send logic — the parent panel owns all of that and passes `counts`
// (its summary object), `expanded`, and `onToggle`.

const F = 'DM Sans, sans-serif'

// Header count chips, in fixed order. Each shows a number AND a text label (never color-only).
const CHIPS = [
  { key: 'due_sendable',        label: 'Ready to release', fg: '#166534', bg: '#EDF7F0' },
  { key: 'due_unsendable',      label: 'Needs attention',  fg: '#991b1b', bg: '#FEECEC' },
  { key: 'suppressed_existing', label: 'Suppressed',       fg: '#1D2567', bg: '#EEF1FB' },
  { key: 'ineligible_hours',    label: 'Ineligible hours', fg: '#92400e', bg: '#FBF5E8' },
  { key: 'not_due',             label: 'Not due',          fg: '#4A5560', bg: '#F4F3F1' },
]

export default function SurveyAutomationCard({ title, recipientLabel, counts = {}, expanded, onToggle, children }) {
  const baseId   = useId()
  const headerId = `${baseId}-header`
  const panelId  = `${baseId}-panel`

  return (
    <div style={{
      background: '#fff', border: '1px solid #e8e4dc', borderRadius: 12,
      overflow: 'hidden', marginBottom: 18, fontFamily: F,
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
          width: '100%', display: 'flex', alignItems: 'center', gap: 14,
          padding: '14px 18px', background: expanded ? '#f7f6f3' : '#fff', border: 'none',
          borderBottom: expanded ? '1px solid #e8e4dc' : 'none',
          cursor: 'pointer', textAlign: 'left', fontFamily: F,
        }}
      >
        {/* Chevron — rotates with state; aria-hidden (state conveyed by aria-expanded). */}
        <span aria-hidden="true" style={{
          flexShrink: 0, color: '#6b7280', fontSize: 13, width: 14,
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s',
        }}>▸</span>

        {/* Title + recipient badge */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#191919' }}>{title}</span>
          <span style={{
            fontSize: 11, fontWeight: 700, color: '#1D2567', background: '#EEF1FB',
            border: '1px solid #d7ddf5', borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap',
          }}>
            Recipient: {recipientLabel}
          </span>
        </span>

        {/* Count chips — pushed right; each shows number + label */}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {CHIPS.map(c => (
            <span key={c.key} style={{
              fontSize: 11, fontWeight: 600, color: c.fg, background: c.bg,
              borderRadius: 8, padding: '3px 9px', whiteSpace: 'nowrap',
            }}>
              <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{counts[c.key] ?? 0}</span>{' '}{c.label}
            </span>
          ))}
        </span>
      </button>

      {expanded && (
        <div id={panelId} role="region" aria-labelledby={headerId}>
          {children}
        </div>
      )}
    </div>
  )
}
