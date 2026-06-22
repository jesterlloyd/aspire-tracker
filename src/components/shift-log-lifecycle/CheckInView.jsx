// CheckInView.jsx — check-in form, prefilled from the B1 eligible student.
// Planned unit & shift type required; planned preceptor OPTIONAL (B1's
// matched_preceptor can be null/blank — see A.5/B.4.A). All values editable.
import { useState } from 'react'
import { useCheckIn } from './useCheckIn'
import { getStudentPreferredGreetingName } from '../../lib/studentNameFormatters'

const F = 'DM Sans, sans-serif'
const SHIFT_TYPES = ['Day', 'Night', 'Mid']

const INPUT = {
  width: '100%', minHeight: 52, fontSize: 16, padding: '0 14px', borderRadius: 12,
  border: '1px solid #e5e7eb', fontFamily: F, outline: 'none', boxSizing: 'border-box', display: 'block',
}
const LABEL = { fontSize: 14, fontWeight: 600, color: 'var(--raven,#191919)', display: 'block', marginBottom: 6, fontFamily: F }
const BTN_PRIMARY = {
  width: '100%', minHeight: 52, fontSize: 16, fontWeight: 700, fontFamily: F,
  background: 'var(--nightfall,#1D2567)', color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer',
}
const LINK = { background: 'none', border: 'none', color: 'var(--nightfall,#1D2567)', fontSize: 14, fontFamily: F, cursor: 'pointer', textDecoration: 'underline', padding: 8 }

// STUDENT-PREFERRED-FIRST-NAME-1B: greet by preferred first name when set, falling back to legal
// first name, then the first token of the composed name, then 'there' (all handled by the helper).
export function deriveGreeting(student) {
  return `Hi ${getStudentPreferredGreetingName(student)},`
}

export default function CheckInView({ student, onSuccess, onNetworkError, onPastShift, onDifferentEmail }) {
  const { checkIn, submitting } = useCheckIn()
  const [expectedHours, setExpectedHours] = useState('12')
  const [plannedUnit, setPlannedUnit] = useState(student?.assigned_unit_name || '')
  const [plannedPreceptor, setPlannedPreceptor] = useState(student?.matched_preceptor || '')
  // SHIFT-LOG-ASSIGNED-SHIFT-DEFAULT: default to the student's assigned (preceptor) shift when the
  // server confidently resolved it; otherwise keep the existing 'Day' fallback. useState INITIALIZER
  // only — no effect re-syncs this, so a student's manual change is never overwritten after load.
  const defaultedFromAssignment = SHIFT_TYPES.includes(student?.assigned_shift_type)
  const [plannedShiftType, setPlannedShiftType] = useState(
    defaultedFromAssignment ? student.assigned_shift_type : 'Day'
  )
  const [error, setError] = useState(null)

  const hoursNum = Number(expectedHours)
  const hoursValid = Number.isFinite(hoursNum) && hoursNum >= 1 && hoursNum <= 13
  const unitValid = plannedUnit.trim() !== ''
  const canSubmit = hoursValid && unitValid && SHIFT_TYPES.includes(plannedShiftType) && !submitting

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!canSubmit) {
      if (!hoursValid) setError('Expected hours must be a number between 1 and 13.')
      else if (!unitValid) setError('Please enter the unit you are working.')
      return
    }
    const payload = {
      school_email: student.school_email,
      expected_hours: hoursNum,
      planned_unit_name: plannedUnit.trim(),
      planned_preceptor_name: plannedPreceptor.trim() || null,
      planned_shift_type: plannedShiftType,
    }
    const result = await checkIn(payload)
    if (result._networkError) { onNetworkError(); return }
    if ((result.status === 201 || result.status === 200) && result.data?.shift) {
      onSuccess(result.data.shift)
      return
    }
    setError("We couldn't start your shift. Please try again.")
  }

  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '24px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--nightfall,#1D2567)', margin: '0 0 4px', fontFamily: F }}>
        {deriveGreeting(student)}
      </h1>
      <p style={{ fontSize: 16, color: '#374151', margin: '0 0 20px', fontFamily: F }}>Ready to start your shift?</p>

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 14px', fontSize: 14, color: '#991b1b', marginBottom: 16, fontFamily: F }}>{error}</div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 18 }}>
          <label style={LABEL} htmlFor="ci-hours">Expected hours</label>
          <input id="ci-hours" style={INPUT} type="number" inputMode="decimal" step="0.5" min="1" max="13"
            value={expectedHours} onChange={(e) => setExpectedHours(e.target.value)} />
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={LABEL} htmlFor="ci-unit">Unit</label>
          <input id="ci-unit" style={INPUT} type="text" value={plannedUnit}
            onChange={(e) => setPlannedUnit(e.target.value)} placeholder="Unit you're working" />
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={LABEL} htmlFor="ci-preceptor">Preceptor <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span></label>
          <input id="ci-preceptor" style={INPUT} type="text" value={plannedPreceptor}
            onChange={(e) => setPlannedPreceptor(e.target.value)} placeholder="Preceptor name (optional)" />
        </div>

        <div style={{ marginBottom: 22 }}>
          <label style={LABEL}>Shift type</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {SHIFT_TYPES.map((t) => (
              <button key={t} type="button" onClick={() => setPlannedShiftType(t)}
                style={{
                  minHeight: 48, borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: F,
                  border: `2px solid ${plannedShiftType === t ? '#1D2567' : '#e5e7eb'}`,
                  background: plannedShiftType === t ? '#1D2567' : '#f9fafb',
                  color: plannedShiftType === t ? '#fff' : '#374151',
                }}>{t}</button>
            ))}
          </div>
          {defaultedFromAssignment && plannedShiftType === student.assigned_shift_type && (
            <div style={{ marginTop: 8, fontSize: 13, color: '#6b7280', fontFamily: F }}>
              Defaulted from your assigned shift — change if needed.
            </div>
          )}
        </div>

        <button style={{ ...BTN_PRIMARY, opacity: canSubmit ? 1 : 0.6 }} type="submit" disabled={!canSubmit}>
          {submitting ? 'Checking in…' : 'Check In'}
        </button>
      </form>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginTop: 16 }}>
        <button type="button" style={LINK} onClick={onPastShift}>Log a past shift instead</button>
        <button type="button" style={LINK} onClick={onDifferentEmail}>Use a different email</button>
      </div>
    </div>
  )
}
