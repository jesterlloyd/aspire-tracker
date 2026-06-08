// CheckOutView.jsx — check-out form, prefilled from the open in_progress shift.
// Client validation mirrors the B3 endpoint's hard validation.
import { useState } from 'react'
import { useCheckOut } from './useCheckOut'
import { deriveGreeting } from './CheckInView'

const F = 'DM Sans, sans-serif'
const SHIFT_TYPES = ['Day', 'Night', 'Mid']

const INPUT = {
  width: '100%', minHeight: 52, fontSize: 16, padding: '0 14px', borderRadius: 12,
  border: '1px solid #e5e7eb', fontFamily: F, outline: 'none', boxSizing: 'border-box', display: 'block',
}
const TEXTAREA = { ...INPUT, minHeight: 74, padding: '12px 14px', resize: 'vertical', lineHeight: 1.5 }
const LABEL = { fontSize: 14, fontWeight: 600, color: 'var(--raven,#191919)', display: 'block', marginBottom: 6, fontFamily: F }
const BTN_PRIMARY = {
  width: '100%', minHeight: 52, fontSize: 16, fontWeight: 700, fontFamily: F,
  background: 'var(--nightfall,#1D2567)', color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer',
}
const LINK = { background: 'none', border: 'none', color: 'var(--nightfall,#1D2567)', fontSize: 14, fontFamily: F, cursor: 'pointer', textDecoration: 'underline', padding: 8 }

function fmtCheckedInAt(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function YesNo({ label, value, onChange, id }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={LABEL}>{label}</label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[['Yes', true], ['No', false]].map(([txt, val]) => (
          <button key={txt} type="button" id={`${id}-${txt}`} onClick={() => onChange(val)}
            style={{
              minHeight: 48, borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: F,
              border: `2px solid ${value === val ? '#1D2567' : '#e5e7eb'}`,
              background: value === val ? '#1D2567' : '#f9fafb',
              color: value === val ? '#fff' : '#374151',
            }}>{txt}</button>
        ))}
      </div>
    </div>
  )
}

export default function CheckOutView({ student, openShift, onSuccess, onAlreadyCompleted, onNetworkError, onDifferentEmail }) {
  const { checkOut, submitting } = useCheckOut()
  const [totalHours, setTotalHours] = useState(openShift?.expected_hours != null ? String(openShift.expected_hours) : '')
  const [shiftType, setShiftType] = useState(openShift?.planned_shift_type && SHIFT_TYPES.includes(openShift.planned_shift_type) ? openShift.planned_shift_type : 'Day')
  const [unitName, setUnitName] = useState(openShift?.planned_unit_name || '')
  const [preceptorName, setPreceptorName] = useState(openShift?.planned_preceptor_name || '')
  const [isAssignedUnit, setIsAssignedUnit] = useState(null)
  const [unitOverrideReason, setUnitOverrideReason] = useState('')
  const [isAssignedPreceptor, setIsAssignedPreceptor] = useState(null)
  const [preceptorOverrideNote, setPreceptorOverrideNote] = useState('')
  const [learningHighlight, setLearningHighlight] = useState('')
  const [supportNeeded, setSupportNeeded] = useState('')
  const [attestation, setAttestation] = useState(false)
  const [error, setError] = useState(null)

  const hoursNum = Number(totalHours)
  const hoursValid = Number.isFinite(hoursNum) && hoursNum >= 1 && hoursNum <= 13
  const overrideReasonValid = isAssignedUnit !== false || unitOverrideReason.trim() !== ''
  const canSubmit =
    hoursValid &&
    SHIFT_TYPES.includes(shiftType) &&
    unitName.trim() !== '' &&
    preceptorName.trim() !== '' &&
    isAssignedUnit !== null &&
    isAssignedPreceptor !== null &&
    overrideReasonValid &&
    attestation === true &&
    !submitting

  const checkedIn = fmtCheckedInAt(openShift?.checked_in_at)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!canSubmit) {
      if (!hoursValid) setError('Hours worked must be between 1 and 13.')
      else if (unitName.trim() === '') setError('Please enter the unit.')
      else if (preceptorName.trim() === '') setError('Please enter the preceptor.')
      else if (isAssignedUnit === null) setError('Please answer whether this was your assigned unit.')
      else if (!overrideReasonValid) setError('Please explain why you worked a different unit.')
      else if (isAssignedPreceptor === null) setError('Please answer whether this was your assigned preceptor.')
      else if (!attestation) setError('Please confirm the attestation before submitting.')
      return
    }
    const payload = {
      school_email: student.school_email,
      shift_id: openShift.id,
      total_hours: hoursNum,
      shift_type: shiftType,
      unit_name: unitName.trim(),
      preceptor_name: preceptorName.trim(),
      is_assigned_unit: isAssignedUnit,
      unit_override_reason: isAssignedUnit === false ? unitOverrideReason.trim() : null,
      is_assigned_preceptor: isAssignedPreceptor,
      preceptor_override_note: isAssignedPreceptor === false && preceptorOverrideNote.trim() ? preceptorOverrideNote.trim() : null,
      learning_highlight: learningHighlight.trim() || null,
      support_needed: supportNeeded.trim() || null,
      attestation: true,
    }
    const result = await checkOut(payload)
    if (result._networkError) { onNetworkError(); return }
    const { status, data } = result
    if (status === 200 && data?.completed === true) { onSuccess({ shift: data.shift, totals: data.totals }); return }
    if (status === 200 && data?.completed === false) { onAlreadyCompleted({ shift: data.shift }); return }
    if (status === 400 && data?.message) { setError(data.message); return }
    setError("We couldn't finish your shift. Please try again.")
  }

  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '24px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--nightfall,#1D2567)', margin: '0 0 4px', fontFamily: F }}>
        {deriveGreeting(student)}
      </h1>
      <p style={{ fontSize: 16, color: '#374151', margin: '0 0 8px', fontFamily: F }}>Ready to finish your shift?</p>
      {checkedIn && (
        <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px', fontFamily: F }}>Checked in {checkedIn}</p>
      )}

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 14px', fontSize: 14, color: '#991b1b', marginBottom: 16, fontFamily: F }}>{error}</div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 18 }}>
          <label style={LABEL} htmlFor="co-hours">Hours worked</label>
          <input id="co-hours" style={INPUT} type="number" inputMode="decimal" step="0.5" min="1" max="13"
            value={totalHours} onChange={(e) => setTotalHours(e.target.value)} placeholder="e.g. 12" />
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={LABEL}>Shift type</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {SHIFT_TYPES.map((t) => (
              <button key={t} type="button" onClick={() => setShiftType(t)}
                style={{
                  minHeight: 48, borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: F,
                  border: `2px solid ${shiftType === t ? '#1D2567' : '#e5e7eb'}`,
                  background: shiftType === t ? '#1D2567' : '#f9fafb',
                  color: shiftType === t ? '#fff' : '#374151',
                }}>{t}</button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={LABEL} htmlFor="co-unit">Unit</label>
          <input id="co-unit" style={INPUT} type="text" value={unitName} onChange={(e) => setUnitName(e.target.value)} />
        </div>

        <YesNo id="co-au" label="Was this your assigned unit?" value={isAssignedUnit} onChange={setIsAssignedUnit} />
        {isAssignedUnit === false && (
          <div style={{ marginBottom: 18 }}>
            <label style={LABEL} htmlFor="co-unit-reason">Why a different unit?</label>
            <textarea id="co-unit-reason" style={TEXTAREA} rows={2} value={unitOverrideReason}
              onChange={(e) => setUnitOverrideReason(e.target.value)} placeholder="e.g. floated with my preceptor" />
          </div>
        )}

        <div style={{ marginBottom: 18 }}>
          <label style={LABEL} htmlFor="co-preceptor">Preceptor</label>
          <input id="co-preceptor" style={INPUT} type="text" value={preceptorName} onChange={(e) => setPreceptorName(e.target.value)} />
        </div>

        <YesNo id="co-ap" label="Was this your assigned preceptor?" value={isAssignedPreceptor} onChange={setIsAssignedPreceptor} />
        {isAssignedPreceptor === false && (
          <div style={{ marginBottom: 18 }}>
            <label style={LABEL} htmlFor="co-prec-note">Note <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span></label>
            <textarea id="co-prec-note" style={TEXTAREA} rows={2} value={preceptorOverrideNote}
              onChange={(e) => setPreceptorOverrideNote(e.target.value)} placeholder="Anything we should know?" />
          </div>
        )}

        <div style={{ marginBottom: 18 }}>
          <label style={LABEL} htmlFor="co-learn">Learning highlight <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span></label>
          <textarea id="co-learn" style={TEXTAREA} rows={3} value={learningHighlight}
            onChange={(e) => setLearningHighlight(e.target.value)} placeholder="What did you learn or practice today?" />
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={LABEL} htmlFor="co-support">Support needed <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span></label>
          <textarea id="co-support" style={TEXTAREA} rows={3} value={supportNeeded}
            onChange={(e) => setSupportNeeded(e.target.value)} placeholder="Any concerns or support you need?" />
        </div>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 22, cursor: 'pointer', fontFamily: F }}>
          <input type="checkbox" checked={attestation} onChange={(e) => setAttestation(e.target.checked)}
            style={{ width: 22, height: 22, marginTop: 2, flexShrink: 0, accentColor: 'var(--nightfall,#1D2567)' }} />
          <span style={{ fontSize: 15, color: 'var(--raven,#191919)', lineHeight: 1.5 }}>
            I confirm that the hours logged above are accurate to the best of my knowledge.
          </span>
        </label>

        <button style={{ ...BTN_PRIMARY, opacity: canSubmit ? 1 : 0.6 }} type="submit" disabled={!canSubmit}>
          {submitting ? 'Checking out…' : 'Check Out'}
        </button>
      </form>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
        <button type="button" style={LINK} onClick={onDifferentEmail}>Use a different email</button>
      </div>
    </div>
  )
}
