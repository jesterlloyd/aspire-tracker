// src/components/ShiftReviewModal.jsx
//
// SHIFT-LOG-REVIEW-1: the Owner/Admin decision surface for ONE Pending Review
// shift. Shows everything the reviewer needs BEFORE any confirmation:
//
//   • the submitted values and the stored exception flags + review reason;
//   • assignment context: the student's unit assignments (live and historical,
//     because an ended assignment window still validates shifts inside it)
//     and the matched preceptor;
//   • every other shift on the same day, with an overlap / possible-duplicate
//     warning that requires an explicit checkbox before the decision buttons
//     act - deliberate confirmation, never silent approval, never a
//     prohibition;
//   • the resulting approved total for the chosen decision. Exceeding required
//     hours is called out as informational only - it never blocks.
//
// Decisions: Approve as submitted / Adjust hours and approve / Reject.
// Rationale is required for adjust and reject. The browser only ever calls the
// protected endpoint; the atomic status change, audit row, and totals
// recompute all happen in the service-role RPC.

import { useState, useEffect } from 'react'
import { decideShiftReview } from '../lib/shiftReviewApi'
import { listStudentUnitAssignments } from '../lib/studentUnitAssignmentsApi'
import { shiftStatusChip } from '../lib/shiftStatusChips'
import { computeReviewWarnings, WARNING_COPY } from '../lib/shiftReviewWarnings'

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'

const flagChip = {
  display: 'inline-block', fontSize: 10, fontWeight: 600, padding: '2px 8px',
  borderRadius: 999, background: '#FEF3C7', color: '#78350F', border: '1px solid #fde68a',
  fontFamily: F, marginRight: 4, marginBottom: 2,
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 12, fontFamily: F }}>
      <span style={{ color: '#6b7280', minWidth: 118, fontWeight: 600 }}>{label}</span>
      <span style={{ color: '#191919', flex: 1 }}>{children}</span>
    </div>
  )
}

export default function ShiftReviewModal({ shift, student, allLogs = [], onClose, onDecided }) {
  const [decision, setDecision] = useState('approved')   // 'approved' | 'adjusted' | 'rejected'
  const [adjustedHours, setAdjustedHours] = useState('')
  const [rationale, setRationale] = useState('')
  const [ackWarnings, setAckWarnings] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [assignments, setAssignments] = useState(null)

  useEffect(() => {
    if (!student?.id) return undefined
    let cancelled = false
    listStudentUnitAssignments(student.id).then(r => {
      if (!cancelled) setAssignments(r.ok ? r.assignments : [])
    })
    return () => { cancelled = true }
  }, [student?.id])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!shift) return null

  const { warnings, sameDayLogs } = computeReviewWarnings(shift, allLogs)
  const flags = Array.isArray(shift.exception_flags) ? shift.exception_flags : []

  const submittedHours = parseFloat(shift.total_hours || 0)
  const adjNum = parseFloat(adjustedHours)
  const effectiveHours = decision === 'adjusted' && Number.isFinite(adjNum) ? adjNum : submittedHours
  const currentApproved = parseFloat(student?.approved_hours || 0)
  const required = parseFloat(student?.hours_required || 0)
  const resultingApproved = decision === 'rejected' ? currentApproved : currentApproved + effectiveHours
  const exceedsRequired = required > 0 && resultingApproved > required

  const rationaleRequired = decision !== 'approved'
  const rationaleMissing = rationaleRequired && !rationale.trim()
  const adjustedInvalid = decision === 'adjusted' && !(Number.isFinite(adjNum) && adjNum > 0 && adjNum <= 13)
  const needsAck = decision !== 'rejected' && warnings.length > 0 && !ackWarnings
  const blocked = busy || rationaleMissing || adjustedInvalid || needsAck

  const submit = async () => {
    setBusy(true); setNotice(null)
    const r = await decideShiftReview({
      shift_id: shift.id,
      decision,
      rationale: rationale.trim() || undefined,
      adjusted_hours: decision === 'adjusted' ? adjNum : undefined,
      acknowledged_warnings: ackWarnings ? warnings : [],
    })
    setBusy(false)
    if (!r.ok) {
      if (r.error === 'migration_required') {
        setNotice('The shift review migration (20260818000000) is not applied yet. Ask the Owner to run it first.')
      } else if (r.error === 'already_decided') {
        setNotice(`This shift was already decided (now ${r.current_status || 'not pending'}). Refresh to see the outcome.`)
      } else if (r.error === 'warnings_not_acknowledged') {
        setNotice(`Confirmation required for: ${(r.warnings || []).join(', ')}. Tick the acknowledgement to proceed.`)
      } else {
        setNotice(`Decision failed: ${r.error}`)
      }
      return
    }
    onDecided?.(r.result)
    onClose()
  }

  const decisionBtn = (value, label, color) => (
    <label key={value} style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 7,
      border: `1.5px solid ${decision === value ? color : '#e5e7eb'}`,
      background: decision === value ? `${color}12` : '#fff',
      cursor: 'pointer', fontSize: 12, fontWeight: 600, color: decision === value ? color : '#374151', fontFamily: F,
    }}>
      <input type="radio" name="review-decision" value={value} checked={decision === value}
        onChange={() => setDecision(value)} style={{ accentColor: color }} />
      {label}
    </label>
  )

  const chip = shiftStatusChip(shift.status)

  return (
    <div className="modal-overlay" onMouseDown={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div role="dialog" aria-modal="true" aria-label="Review shift"
        data-testid="shift-review-modal"
        onMouseDown={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, maxWidth: 660, width: '92vw', maxHeight: '88vh', overflowY: 'auto', padding: 18, fontFamily: F }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15, color: NAVY }}>Review shift</h3>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: chip.bg, color: chip.text, fontWeight: 600 }}>{chip.label}</span>
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#6b7280' }}>×</button>
        </div>

        {/* Submitted values - preserved verbatim regardless of the decision */}
        <div data-testid="review-submitted" style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #eef0f4', marginBottom: 8 }}>
          <Row label="Date">{shift.shift_date}</Row>
          <Row label="Submitted hours">{shift.total_hours}h ({shift.shift_type || 'Day'})</Row>
          <Row label="Unit">{shift.unit_name || '-'}</Row>
          <Row label="Preceptor">{shift.preceptor_name || '-'}</Row>
          {(flags.length > 0 || shift.review_reason) && (
            <Row label="Exception flags">
              <span data-testid="review-flags">
                {flags.map(f => <span key={f} style={flagChip}>{f}</span>)}
                {flags.length === 0 && (shift.review_reason || '-')}
              </span>
            </Row>
          )}
          {shift.review_reason && <Row label="Review reason">{shift.review_reason}</Row>}
        </div>

        {/* Assignment / preceptor context */}
        <div data-testid="review-context" style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #eef0f4', marginBottom: 8 }}>
          <Row label="Matched preceptor">{student?.matched_preceptor || '-'}</Row>
          <Row label="Unit assignments">
            {assignments === null ? 'Loading…' : assignments.length === 0 ? 'None recorded' : (
              <span>
                {assignments.map(a => (
                  <span key={a.id} style={{ display: 'block' }}>
                    {a.unit_key} · {a.role} · {a.status}
                    {(a.start_date || a.end_date) ? ` (${a.start_date || '…'} → ${a.end_date || '…'})` : ''}
                  </span>
                ))}
              </span>
            )}
          </Row>
        </div>

        {/* Same-day shifts + deliberate warning acknowledgement */}
        {sameDayLogs.length > 0 && (
          <div data-testid="review-warnings" style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #f0c9b0', background: '#FBF5E8', marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#8B5E1A', marginBottom: 4 }}>
              Same-day shifts on {shift.shift_date}
            </div>
            {sameDayLogs.map(l => (
              <div key={l.id} style={{ fontSize: 11.5, color: '#4b5563', marginBottom: 2 }}>
                {l.unit_name || '-'} · {l.total_hours}h · {l.preceptor_name || '-'} · {l.status}
              </div>
            ))}
            <div style={{ fontSize: 11.5, color: '#8B5E1A', margin: '6px 0' }}>
              {warnings.map(w => <div key={w}>• {WARNING_COPY[w]}</div>)}
            </div>
            {decision !== 'rejected' && (
              <label style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 12, fontWeight: 600, color: '#78350F', cursor: 'pointer' }}>
                <input type="checkbox" data-testid="review-ack" checked={ackWarnings}
                  onChange={e => setAckWarnings(e.target.checked)} style={{ marginTop: 2 }} />
                I reviewed the same-day shifts above and confirm this decision is intentional.
              </label>
            )}
          </div>
        )}

        {/* Decision */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {decisionBtn('approved', 'Approve as submitted', '#166534')}
          {decisionBtn('adjusted', 'Adjust and approve', NAVY)}
          {decisionBtn('rejected', 'Reject', '#b91c1c')}
        </div>

        {decision === 'adjusted' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
            Approved hours
            <input type="number" step="0.25" min="0.25" max="13" value={adjustedHours}
              data-testid="review-adjusted-hours"
              onChange={e => setAdjustedHours(e.target.value)}
              style={{ width: 90, padding: '5px 8px', border: '1.5px solid #e5e7eb', borderRadius: 6, fontSize: 12, fontFamily: F }} />
            <span style={{ fontWeight: 400, color: '#6b7280' }}>(submitted: {shift.total_hours}h - the original is preserved in the audit record)</span>
          </label>
        )}

        <textarea
          data-testid="review-rationale"
          value={rationale}
          onChange={e => setRationale(e.target.value)}
          placeholder={rationaleRequired ? 'Rationale (required for adjust and reject)' : 'Rationale (optional)'}
          rows={2}
          style={{ width: '100%', boxSizing: 'border-box', padding: '7px 9px', border: `1.5px solid ${rationaleMissing ? '#f0c9b0' : '#e5e7eb'}`, borderRadius: 7, fontSize: 12, fontFamily: F, marginBottom: 8, resize: 'vertical' }}
        />

        {/* Resulting totals - required hours are a threshold, not a maximum */}
        <div data-testid="review-resulting" style={{ fontSize: 12, color: '#374151', padding: '7px 9px', borderRadius: 7, background: '#F8FAFF', border: '1px solid #c3cdf0', marginBottom: 10 }}>
          {decision === 'rejected' ? (
            <>Rejecting removes {submittedHours}h from pending hours. The shift is kept as history and counts toward nothing. Approved total stays <b>{currentApproved}h</b>.</>
          ) : (
            <>Resulting approved total: <b>{Number.isFinite(resultingApproved) ? resultingApproved : '…'}h</b>
              {required > 0 ? ` of ${required}h required.` : '.'}
              {exceedsRequired && ' Exceeds required hours - allowed; required hours are a completion threshold, not a maximum.'}
            </>
          )}
        </div>

        {notice && (
          <div data-testid="review-notice" style={{ fontSize: 11.5, padding: '7px 9px', borderRadius: 7, marginBottom: 8, background: '#FBF5E8', border: '1px solid #f0c9b0', color: '#8B5E1A' }}>
            {notice}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy}
            style={{ padding: '6px 13px', borderRadius: 7, fontSize: 12, fontWeight: 600, fontFamily: F, border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={blocked} data-testid="review-confirm"
            title={needsAck ? 'Acknowledge the same-day warning first' : undefined}
            style={{
              padding: '6px 13px', borderRadius: 7, fontSize: 12, fontWeight: 700, fontFamily: F,
              border: 'none', cursor: blocked ? 'not-allowed' : 'pointer', color: '#fff',
              background: decision === 'rejected' ? '#b91c1c' : NAVY, opacity: blocked ? 0.55 : 1,
            }}>
            {decision === 'approved' ? 'Approve shift' : decision === 'adjusted' ? 'Adjust & approve' : 'Reject shift'}
          </button>
        </div>
      </div>
    </div>
  )
}
