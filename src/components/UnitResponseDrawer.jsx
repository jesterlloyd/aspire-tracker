// src/components/UnitResponseDrawer.jsx
// UNIT-FORM-RESPONSE-VISIBILITY: read-only detail of one /unit-form submission (unit_cohort_responses
// row), shown from Aggregate > Placement Capacity. No fetch, no edit, no resend/contact - display only.
import DetailDrawer from './ui/DetailDrawer'

const F = 'Plus Jakarta Sans, sans-serif'

// Humanize the stored enum/boolean answers for display.
const ENUM_LABELS = {
  successful: 'Successful',
  mixed: 'Mixed',
  would_not_hire_again: 'Would not hire again',
  not_sure: 'Not sure',
  yes: 'Yes',
  no: 'No',
  maybe: 'Maybe',
}
function humanize(v) {
  if (v === true) return 'Yes'
  if (v === false) return 'No'
  if (v == null || v === '') return null
  return ENUM_LABELS[v] || String(v)
}

function fmtDateTime(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 8, fontFamily: F }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{children}</div>
    </div>
  )
}

// One label/value row. `value` of null/'' renders the "Not provided" fallback. `multiline` for free text.
function Row({ label, value, multiline }) {
  const shown = value == null || value === '' ? null : value
  return (
    <div style={{ display: 'flex', flexDirection: multiline ? 'column' : 'row', gap: multiline ? 4 : 10, fontSize: 13, fontFamily: F }}>
      <span style={{ color: '#9ca3af', minWidth: multiline ? undefined : 150, flexShrink: 0 }}>{label}</span>
      <span style={{ color: shown == null ? '#c4c8cf' : '#191919', lineHeight: 1.5, whiteSpace: multiline ? 'pre-wrap' : 'normal' }}>
        {shown == null ? 'Not provided' : shown}
      </span>
    </div>
  )
}

export default function UnitResponseDrawer({ open, onClose, response }) {
  if (!open || !response) return null
  const r = response
  const status = r.response_status
  const willHost = status === 'submitted_hosting' ? 'Yes'
    : status === 'submitted_not_hosting' ? 'No'
    : 'Pending'

  return (
    <DetailDrawer open={open} onClose={onClose} title={`${r.unit_name || 'Unit'}, Unit Form Response`}>
      <Section title="Submission Details">
        <Row label="Unit / Department" value={r.unit_name} />
        <Row label="Submitted by" value={r.submitted_by_name} />
        <Row label="Role" value={r.submitted_by_role} />
        <Row label="Email" value={r.submitted_by_email} />
        <Row label="First submitted" value={fmtDateTime(r.submitted_at)} />
        <Row label="Last updated" value={fmtDateTime(r.last_updated_at)} />
        {r.submission_count > 1 && (
          <div style={{ fontSize: 12, color: '#6b7280', fontFamily: F }}>Updated {r.submission_count} times</div>
        )}
      </Section>

      <Section title="Hosting & Capacity">
        <Row label="Will host this cohort" value={willHost} />
        <Row label="Capacity" value={status === 'pending' ? null : `${r.slots_offered ?? 0} student${r.slots_offered === 1 ? '' : 's'}`} />
        <Row label="Shift availability" value={r.shift_preference} />
        <Row label="Preferred preceptors" value={r.preferred_preceptors} multiline />
      </Section>

      {status === 'submitted_not_hosting' && (
        <Section title="Not Hosting">
          <Row label="Reason not hosting" value={r.reason_for_zero} multiline />
        </Section>
      )}

      <Section title="ASPIRE / Hiring Experience">
        <Row label="Plans to hire new-grad RNs (NGRP)" value={humanize(r.hiring_new_grads_ngrp)} />
        {r.hiring_new_grads_ngrp === false && (
          <Row label="Reason not hiring" value={r.hiring_new_grads_reason} multiline />
        )}
        <Row label="Has hired ASPIRE alumni" value={humanize(r.has_hired_aspire_alumni)} />
        <Row label="Hiring outcome" value={humanize(r.aspire_alumni_outcome)} />
        <Row label="Would consider ASPIRE alumni" value={humanize(r.would_consider_aspire_alumni)} />
        <Row label="ASPIRE alumni notes" value={r.aspire_alumni_notes} multiline />
      </Section>

      <Section title="Additional Notes">
        <Row label="Other considerations / requirements" value={r.considerations} multiline />
      </Section>
    </DetailDrawer>
  )
}
