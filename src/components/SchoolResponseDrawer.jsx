// src/components/SchoolResponseDrawer.jsx
// STAFF-SCHOOL-RESPONSE-VISIBILITY-1: read-only detail of one school placement submission
// (cohort_school_rotations row + its linked students), shown from At a Glance > Placement
// Requests. Follows the UnitResponseDrawer / DetailDrawer pattern: display only - no fetch here,
// no edit, no placement controls, no status writes. The caller owns the query; this component
// renders its result honestly (a failed load shows an error with Retry, never an empty response).
import { useEffect } from 'react'
import DetailDrawer from './ui/DetailDrawer'
import { canonicalRotationWindow } from '../lib/rotationWindow'
import {
  formatWeekdays, formatMinDays, formatBooleanYesNo, formatDates, formatText,
} from '../lib/availability'
import { collectAdditionalNotes } from '../lib/schoolResponseDisplay'
import { displayName } from '../lib/utils'

const F = 'DM Sans, sans-serif'
const PENDING_WINDOW = 'Pending coordinator/admin review'
const NOT_PROVIDED = 'Not provided'

function fmtDateTime(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

// Canonical YYYY-MM-DD -> Pacific long form ("May 4, 2026"); anchor at noon UTC to avoid a
// timezone day-shift (same approach as CohortBar).
function fmtDateLong(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric',
  }).format(new Date(ymd + 'T12:00:00Z'))
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
  const shown = value == null || value === '' || value === NOT_PROVIDED ? null : value
  return (
    <div style={{ display: 'flex', flexDirection: multiline ? 'column' : 'row', gap: multiline ? 4 : 10, fontSize: 13, fontFamily: F }}>
      <span style={{ color: '#9ca3af', minWidth: multiline ? undefined : 150, flexShrink: 0 }}>{label}</span>
      <span style={{ color: shown == null ? '#c4c8cf' : '#191919', lineHeight: 1.5, whiteSpace: multiline ? 'pre-wrap' : 'normal' }}>
        {shown == null ? NOT_PROVIDED : shown}
      </span>
    </div>
  )
}

export default function SchoolResponseDrawer({
  open, onClose, schoolName, response, students = [], loading = false, error = null, onRetry,
}) {
  // Keyboard dismissible (Escape), in addition to the DetailDrawer close button and backdrop.
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const window_ = canonicalRotationWindow(response)
  const sortedStudents = [...students].sort((a, b) => {
    const la = (a.last_name || a.name || '').toLowerCase()
    const lb = (b.last_name || b.name || '').toLowerCase()
    if (la !== lb) return la.localeCompare(lb)
    return (a.first_name || '').toLowerCase().localeCompare((b.first_name || '').toLowerCase())
  })
  const notes = collectAdditionalNotes(students)

  return (
    <DetailDrawer open={open} onClose={onClose} title={`${schoolName || 'School'}, School Form Response`}>
      {error ? (
        // Honest failure state: a failed response query is NEVER shown as an empty response.
        <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 12px', border: '1px solid #fca5a5', background: '#fef2f2', borderRadius: 8, fontFamily: F }}>
          <span style={{ fontSize: 13, color: '#991b1b', lineHeight: 1.5 }}>
            The school form response could not load. The Placement Requests list is unaffected.
          </span>
          {onRetry && (
            <button type="button" onClick={onRetry}
              style={{ alignSelf: 'flex-start', padding: '6px 14px', borderRadius: 7, border: '1px solid #d1d5db', background: '#fff', color: '#191919', fontFamily: F, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
              Retry
            </button>
          )}
        </div>
      ) : loading ? (
        <div style={{ fontSize: 13, color: '#6b7280', fontFamily: F }}>Loading school form response…</div>
      ) : !response ? (
        <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6, fontFamily: F }}>
          No school form response is on record for this school in the active cohort yet.
          Students may have been added manually or through the student intake form.
        </div>
      ) : (
        <>
          <Section title="Submission Details">
            <Row label="School / University" value={response.school_name} />
            <Row label="Placement coordinator" value={response.coordinator_name} />
            <Row label="Coordinator email" value={response.coordinator_email} />
            <Row label="First submitted" value={fmtDateTime(response.created_at)} />
            <Row label="Last updated" value={fmtDateTime(response.updated_at)} />
          </Section>

          <Section title="Rotation Window">
            {/* Sentinel or invalid dates show the pending message, never the raw sentinel date. */}
            <Row label="Rotation start date" value={window_ ? fmtDateLong(window_.start) : PENDING_WINDOW} />
            <Row label="Rotation end date" value={window_ ? fmtDateLong(window_.end) : PENDING_WINDOW} />
          </Section>

          <Section title="Rotation Availability">
            <Row label="Generally unavailable weekdays" value={formatWeekdays(response.unavailable_weekdays)} />
            <Row label="Minimum clinical days per week" value={formatMinDays(response.min_days_per_week)} />
            <Row label="Weekend rotations allowed" value={formatBooleanYesNo(response.weekends_allowed)} />
            <Row label="Night shifts allowed" value={formatBooleanYesNo(response.nights_allowed)} />
            <Row label="Blackout dates / academic breaks" value={formatDates(response.blackout_dates)} />
            <Row label="Scheduling notes" value={formatText(response.scheduling_notes)} multiline />
          </Section>

          <Section title="Students Submitted">
            {sortedStudents.length === 0 ? (
              <div style={{ fontSize: 13, color: '#c4c8cf', fontFamily: F }}>No students are linked to this response.</div>
            ) : sortedStudents.map(s => (
              <div key={s.id} style={{ padding: '10px 12px', border: '1px solid #f3f4f6', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#191919', fontFamily: F }}>{displayName(s)}</div>
                <Row label="School email" value={s.school_email} />
                <Row label="Phone" value={s.phone} />
                <Row label="Program type" value={s.program_type} />
                <Row label="Hours required" value={s.hours_required ? String(s.hours_required) : null} />
                <Row label="Estimated graduation" value={fmtDateLong(s.estimated_graduation_date) || formatText(s.estimated_graduation_date)} />
              </div>
            ))}
          </Section>

          <Section title="Additional Notes">
            {/* Legacy storage: the form's final additional-notes answer lives on each student row in
                students.coordinators. Identical values are deduplicated; DISTINCT recorded values are
                all shown rather than silently choosing one. */}
            {notes.length === 0 ? (
              <Row label="Notes for the ASPIRE team" value={null} multiline />
            ) : notes.length === 1 ? (
              <Row label="Notes for the ASPIRE team" value={notes[0]} multiline />
            ) : (
              notes.map((n, i) => (
                <Row key={i} label={`Recorded note ${i + 1} of ${notes.length}`} value={n} multiline />
              ))
            )}
          </Section>
        </>
      )}
    </DetailDrawer>
  )
}
