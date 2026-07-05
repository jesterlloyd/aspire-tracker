import React from 'react'
import { Eye } from 'lucide-react'

// SURVEY-UX-3 - Presentational-only COMPACT SUMMARY CARD for a Survey Automation workflow.
// It is a selection control: clicking it selects this workflow, whose detail then renders in
// the shared full-width workspace below (it no longer expands dense content in place). Holds
// NO detection, release, or send logic - the parent passes `counts` (the workflow's reported
// summary), `selected`, and `onSelect`.

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'

// Count chips, in fixed order. Each shows a number AND a text label (never color-only).
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

export default function SurveyAutomationCard({ title, recipientLabel, counts = {}, selected, onSelect, onPreview, workspaceId }) {
  const statusLine = buildStatusLine(counts)

  // EVALUATION-RELEASE-PREVIEW-1: the card is a keyboard-operable selection control (div + role,
  // not a <button>) so it can safely contain the eye-icon preview button without nesting buttons.
  const activate = () => onSelect?.()
  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate() }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className="survey-summary-card"
      aria-expanded={!!selected}
      aria-controls={workspaceId}
      onClick={activate}
      onKeyDown={onKeyDown}
      style={{
        // EVALUATION-RELEASE-PREVIEW-1: match ASPIRE Connect > Automations cards - clean white card,
        // subtle border + shadow, no heavy dark outline. Selected state is soft: a faint tint plus a
        // subtle inset navy accent bar (no layout shift, no thick ring). Text ("Viewing details ▾")
        // also conveys selection, so state is never color-only.
        display: 'flex', flexDirection: 'column', gap: 10, width: '100%',
        padding: '16px 18px', textAlign: 'left', cursor: 'pointer', fontFamily: F,
        background: selected ? '#f7f9ff' : '#fff',
        border: '1px solid #e8e4dc', borderRadius: 14,
        boxShadow: selected
          ? '0 1px 3px rgba(25,25,25,0.06), inset 3px 0 0 0 #1D2567'
          : '0 1px 3px rgba(25,25,25,0.06)',
      }}
    >
      {/* Focus ring for keyboard users. */}
      <style>{`.survey-summary-card:focus-visible{outline:3px solid #93c5fd;outline-offset:2px;}`}</style>

      {/* Title + recipient badge, with the eye-icon preview affordance on the right (matches Automations). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#191919' }}>{title}</span>
          <span style={{
            fontSize: 11, fontWeight: 700, color: '#1D2567', background: '#EEF1FB',
            border: '1px solid #d7ddf5', borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap',
          }}>
            Recipient: {recipientLabel}
          </span>
        </div>
        {onPreview && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPreview() }}
            title="Preview email"
            aria-label="Preview email"
            style={{
              width: 36, height: 36, flexShrink: 0, display: 'inline-flex', alignItems: 'center',
              justifyContent: 'center', background: 'none', border: 'none', borderRadius: 8,
              cursor: 'pointer', color: '#9ca3af', padding: 0,
            }}
          >
            <Eye size={16} />
          </button>
        )}
      </div>

      {/* One-line status summary */}
      <div style={{ fontSize: 12.5, color: '#6b7280', lineHeight: 1.4 }}>{statusLine}</div>

      {/* Count chips - each shows number + label */}
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

      {/* Selection affordance - text conveys state (not color alone). */}
      <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, marginTop: 2 }}>
        {selected ? 'Viewing details below ▾' : 'View details →'}
      </div>
    </div>
  )
}
