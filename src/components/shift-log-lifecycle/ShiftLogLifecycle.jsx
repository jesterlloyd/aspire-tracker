// ShiftLogLifecycle.jsx - top-level container for the /shift-log lifecycle.
// Routes Check In / Check Out / Log a Past Shift based on the B1 lookup result.
// Every visit starts at email entry (no localStorage/cookies; identity is the
// school email entered each time). No new auth.

import { useState, useCallback } from 'react'
import EmailEntryView from './EmailEntryView'
import CheckInView from './CheckInView'
import CheckOutView from './CheckOutView'
import LifecycleResultView from './LifecycleResultView'
import ShiftLogPage from '../ShiftLogPage'
import { useLookupStudent } from './useLookupStudent'
import { getStudentPreferredGreetingName } from '../../lib/studentNameFormatters'

const F = 'DM Sans, sans-serif'

export default function ShiftLogLifecycle() {
  const { lookup, loading: lookupLoading } = useLookupStudent()

  const [phase, setPhase] = useState('email_entry')
  // 'email_entry' | 'check_in' | 'check_out' | 'past_shift'
  // | 'check_in_success' | 'check_out_success' | 'check_out_already_completed'
  // | 'ineligible' | 'ambiguous' | 'network_error'
  const [emailInput, setEmailInput] = useState('')
  const [studentData, setStudentData] = useState(null)
  const [resultData, setResultData] = useState(null)
  const [errorInfo, setErrorInfo] = useState(null)

  const resetToEmailEntry = useCallback(() => {
    setPhase('email_entry')
    setEmailInput('')
    setStudentData(null)
    setResultData(null)
    setErrorInfo(null)
  }, [])

  const routeLookup = useCallback((r) => {
    if (r._networkError) { setErrorInfo({ type: 'network', retryTo: 'lookup' }); setPhase('network_error'); return }
    if (!r.found && r.error === 'ambiguous_student_email') { setPhase('ambiguous'); return }
    if (!r.found) { setErrorInfo({ type: 'not_found' }); setPhase('ineligible'); return }
    if (!r.eligible) { setErrorInfo({ type: r.ineligible_reason }); setStudentData(r.student); setPhase('ineligible'); return }
    setStudentData({ ...r.student, open_shift: r.open_shift || null })
    setPhase(r.open_shift ? 'check_out' : 'check_in')
  }, [])

  const handleEmailSubmit = useCallback(async (trimmedEmail) => {
    setEmailInput(trimmedEmail)
    const r = await lookup(trimmedEmail)
    routeLookup(r)
  }, [lookup, routeLookup])

  // Result screens greet by preferred first name (falls back to legal first / first token / 'there').
  const studentName = studentData ? getStudentPreferredGreetingName(studentData) : null

  // ── Past Shift: render the legacy form (its own shell), with a back link ────
  if (phase === 'past_shift') {
    return (
      <div data-theme-lock="light" style={{ position: 'relative' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--sand,#F4F1EC)', padding: '10px 16px' }}>
          <button onClick={() => setPhase('check_in')} style={{ background: 'none', border: 'none', color: 'var(--nightfall,#1D2567)', fontSize: 14, fontWeight: 600, fontFamily: F, cursor: 'pointer', padding: 8 }}>
            ← Back
          </button>
        </div>
        <ShiftLogPage initialSchoolEmail={emailInput} />
      </div>
    )
  }

  // ── Shell for all other phases ─────────────────────────────────────────────
  let inner = null
  if (phase === 'email_entry') {
    inner = <EmailEntryView email={emailInput} setEmail={setEmailInput} onSubmit={handleEmailSubmit} loading={lookupLoading} />
  } else if (phase === 'check_in') {
    inner = (
      <CheckInView
        student={studentData}
        onSuccess={(shift) => { setResultData({ shift, studentName }); setPhase('check_in_success') }}
        onNetworkError={() => { setErrorInfo({ type: 'network', retryTo: 'check_in' }); setPhase('network_error') }}
        onPastShift={() => setPhase('past_shift')}
        onDifferentEmail={resetToEmailEntry}
      />
    )
  } else if (phase === 'check_out') {
    inner = (
      <CheckOutView
        student={studentData}
        openShift={studentData?.open_shift}
        onSuccess={({ shift, totals }) => { setResultData({ shift, totals, studentName }); setPhase('check_out_success') }}
        onAlreadyCompleted={({ shift }) => { setResultData({ shift, studentName }); setPhase('check_out_already_completed') }}
        onNetworkError={() => { setErrorInfo({ type: 'network', retryTo: 'check_out' }); setPhase('network_error') }}
        onDifferentEmail={resetToEmailEntry}
      />
    )
  } else {
    // Result / terminal phases → LifecycleResultView
    let variant = 'network_error'
    if (phase === 'check_in_success') variant = 'check_in_success'
    else if (phase === 'check_out_success') variant = resultData?.shift?.status === 'Pending Review' ? 'check_out_success_pending_review' : 'check_out_success_auto_accepted'
    else if (phase === 'check_out_already_completed') variant = 'check_out_already_completed'
    else if (phase === 'ineligible') variant = `ineligible_${errorInfo?.type || 'not_found'}`
    else if (phase === 'ambiguous') variant = 'ambiguous'
    else if (phase === 'network_error') variant = 'network_error'

    const onRetry = errorInfo?.retryTo === 'lookup'
      ? () => handleEmailSubmit(emailInput)
      : errorInfo?.retryTo
        ? () => setPhase(errorInfo.retryTo)
        : null

    inner = (
      <LifecycleResultView
        variant={variant}
        data={resultData || {}}
        onDone={resetToEmailEntry}
        onTryDifferentEmail={resetToEmailEntry}
        onRetry={onRetry}
      />
    )
  }

  return (
    <div data-theme-lock="light" style={{ minHeight: '100vh', background: 'var(--sand,#F4F1EC)', padding: '24px 16px', fontFamily: F }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="36" />
        </div>
        {inner}
      </div>
    </div>
  )
}
