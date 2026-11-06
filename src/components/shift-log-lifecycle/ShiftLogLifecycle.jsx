// ShiftLogLifecycle.jsx - top-level container for the /shift-log lifecycle.
// Routes Check In / Check Out / Log a Past Shift based on the B1 lookup result.
//
// Two ways in (SHIFT-LOG-REMEMBER-1, Owner, 2026-11-05):
//   * SIGNED IN. A phone that already holds a Student Portal session skips the
//     email entirely: the page asks /api/portal/my-shift-lifecycle (the portal
//     Shift Log tab's own endpoint, which resolves the student from the session
//     and delegates every write to the public handlers) and runs the same views
//     through its transport. Any refusal (no session, a staff account, no
//     student grant) falls back to email entry, silently.
//   * EMAIL. Everyone else enters a school email, as before. The last email that
//     found an eligible student is remembered on this device and filled in next
//     time (src/lib/shiftLogDevice.js), with Forget beside it.

import { useState, useCallback, useEffect, useMemo } from 'react'
import EmailEntryView from './EmailEntryView'
import CheckInView from './CheckInView'
import CheckOutView from './CheckOutView'
import LifecycleResultView from './LifecycleResultView'
import ShiftLogPage from '../ShiftLogPage'
import { useLookupStudent } from './useLookupStudent'
import { getStudentPreferredGreetingName } from '../../lib/studentNameFormatters'
import BackButton from '../BackButton'
import { supabase } from '../../lib/supabase'
import { postShiftLifecycle, shiftLifecycleTransport } from '../../lib/myShiftLifecycleApi'
import { readRememberedShiftEmail, rememberShiftEmail, forgetShiftEmail } from '../../lib/shiftLogDevice'

const F = 'Plus Jakarta Sans, sans-serif'

export default function ShiftLogLifecycle() {
  const { lookup, loading: lookupLoading } = useLookupStudent()

  const [phase, setPhase] = useState('session_check')
  // 'session_check' | 'pick_record' | 'email_entry' | 'check_in' | 'check_out' | 'past_shift'
  // | 'check_in_success' | 'check_out_success' | 'check_out_already_completed'
  // | 'ineligible' | 'ambiguous' | 'network_error'
  const [emailInput, setEmailInput] = useState(() => readRememberedShiftEmail())
  const [remembered, setRemembered] = useState(() => readRememberedShiftEmail())
  // 'session' while the signed-in portal path is in use, else 'email'.
  const [mode, setMode] = useState('email')
  const [studentId, setStudentId] = useState(null)
  const [records, setRecords] = useState([])
  const [studentData, setStudentData] = useState(null)
  const [resultData, setResultData] = useState(null)
  const [errorInfo, setErrorInfo] = useState(null)

  const resetToEmailEntry = useCallback(() => {
    setMode('email')
    setStudentId(null)
    setPhase('email_entry')
    setEmailInput(readRememberedShiftEmail())
    setStudentData(null)
    setResultData(null)
    setErrorInfo(null)
  }, [])

  const routeLookup = useCallback((r) => {
    if (r._networkError) { setErrorInfo({ type: 'network', retryTo: 'lookup' }); setPhase('network_error'); return }
    if (!r.found && r.error === 'ambiguous_student_email') { setPhase('ambiguous'); return }
    if (!r.found) { setErrorInfo({ type: 'not_found' }); setPhase('ineligible'); return }
    // S-09: an ineligible answer no longer carries a student object, and never needed
    // to: all three ineligible screens render a banner and a contact block, nothing
    // about the person. Only the reason is kept, which is what picks the right screen.
    if (!r.eligible) { setErrorInfo({ type: r.ineligible_reason }); setPhase('ineligible'); return }
    setStudentData({ ...r.student, open_shift: r.open_shift || null })
    setPhase(r.open_shift ? 'check_out' : 'check_in')
  }, [])

  const handleEmailSubmit = useCallback(async (trimmedEmail) => {
    setEmailInput(trimmedEmail)
    const r = await lookup(trimmedEmail)
    // Remember only an email that found a student who can log shifts.
    if (r?.found && r.eligible) { rememberShiftEmail(trimmedEmail); setRemembered(trimmedEmail) }
    routeLookup(r)
  }, [lookup, routeLookup])

  const handleForget = useCallback(() => {
    forgetShiftEmail()
    setRemembered('')
    setEmailInput('')
  }, [])

  // The signed-in path. Resolves to true when the session answered for a
  // student; false sends the visitor to email entry.
  const sessionLookup = useCallback(async (id = null) => {
    try {
      const { data } = await supabase.auth.getSession()
      if (!data?.session?.access_token) return false
      const res = await postShiftLifecycle('lookup', {}, { studentId: id })
      const body = await res.json().catch(() => ({}))
      if (res.status === 400 && body.error === 'student_required' && Array.isArray(body.students) && body.students.length) {
        setMode('session'); setRecords(body.students); setPhase('pick_record'); return true
      }
      if (!res.ok) return false
      setMode('session')
      setStudentId(body.student_id || id || null)
      routeLookup(body)
      return true
    } catch {
      return false
    }
  }, [routeLookup])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(async () => {
      const ok = await sessionLookup(null)
      if (!cancelled && !ok) setPhase('email_entry')
    })
    return () => { cancelled = true }
  }, [sessionLookup])

  const inSession = mode === 'session'
  const checkInTransport = useMemo(() => (inSession ? shiftLifecycleTransport('check_in', studentId) : null), [inSession, studentId])
  const checkOutTransport = useMemo(() => (inSession ? shiftLifecycleTransport('check_out', studentId) : null), [inSession, studentId])
  const pastShiftTransport = useMemo(() => (inSession ? shiftLifecycleTransport('past_shift', studentId) : null), [inSession, studentId])

  // "Done" returns a signed-in student to their own fresh lookup, and everyone
  // else to email entry.
  const finish = useCallback(async () => {
    if (inSession && (await sessionLookup(studentId))) return
    resetToEmailEntry()
  }, [inSession, sessionLookup, studentId, resetToEmailEntry])

  // Result screens greet by preferred first name (falls back to legal first / first token / 'there').
  const studentName = studentData ? getStudentPreferredGreetingName(studentData) : null

  // ── Past Shift: render the legacy form (its own shell), with a back link ────
  if (phase === 'past_shift') {
    return (
      <div data-theme-lock="light" style={{ position: 'relative' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--sand,#F4F1EC)', padding: '10px 16px' }}>
          <BackButton label="Back to check-in" onClick={() => setPhase('check_in')} />
        </div>
        {inSession
          ? <ShiftLogPage presetStudent={studentData} transport={pastShiftTransport} />
          : <ShiftLogPage initialSchoolEmail={emailInput} />}
      </div>
    )
  }

  // ── Shell for all other phases ─────────────────────────────────────────────
  let inner
  if (phase === 'session_check') {
    inner = <p role="status" style={{ textAlign: 'center', color: '#4b5563', fontSize: 15, fontFamily: F }}>Loading…</p>
  } else if (phase === 'pick_record') {
    inner = (
      <div style={{ background: '#fff', borderRadius: 'var(--aspire-radius-card, 12px)', padding: '28px 24px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)', fontFamily: F }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--nightfall,#1D2567)', textAlign: 'center', margin: '0 0 8px' }}>Which Rotation?</h1>
        <p style={{ fontSize: 15, color: '#4b5563', textAlign: 'center', margin: '0 0 20px', lineHeight: 1.6 }}>
          Your account holds more than one ASPIRE record. Choose the rotation you are logging for.
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          {records.map(r => (
            <button key={r.id} type="button" onClick={() => sessionLookup(r.id)}
              style={{ minHeight: 48, fontSize: 16, fontWeight: 700, fontFamily: F, background: 'var(--nightfall,#1D2567)', color: '#fff', border: 'none', borderRadius: 'var(--aspire-radius-control, 10px)', cursor: 'pointer' }}>
              {r.cohort_name || 'Rotation'}
            </button>
          ))}
        </div>
        <button type="button" onClick={resetToEmailEntry}
          style={{ display: 'block', margin: '16px auto 0', background: 'none', border: 'none', color: 'var(--nightfall,#1D2567)', textDecoration: 'underline', fontSize: 14, fontFamily: F, cursor: 'pointer' }}>
          Use a different email
        </button>
      </div>
    )
  } else if (phase === 'email_entry') {
    inner = (
      <EmailEntryView
        email={emailInput}
        setEmail={setEmailInput}
        onSubmit={handleEmailSubmit}
        loading={lookupLoading}
        remembered={remembered}
        onForget={handleForget}
      />
    )
  } else if (phase === 'check_in') {
    inner = (
      <CheckInView
        student={studentData}
        transport={checkInTransport}
        onSuccess={(shift) => { setResultData({ shift, studentName }); setPhase('check_in_success') }}
        onNetworkError={() => { setErrorInfo({ type: 'network', retryTo: 'check_in' }); setPhase('network_error') }}
        onPastShift={() => setPhase('past_shift')}
        onDifferentEmail={resetToEmailEntry}
        differentEmailLabel={inSession ? 'Not you? Use an email instead' : 'Use a different email'}
      />
    )
  } else if (phase === 'check_out') {
    inner = (
      <CheckOutView
        student={studentData}
        openShift={studentData?.open_shift}
        transport={checkOutTransport}
        onSuccess={({ shift, totals }) => { setResultData({ shift, totals, studentName }); setPhase('check_out_success') }}
        onAlreadyCompleted={({ shift }) => { setResultData({ shift, studentName }); setPhase('check_out_already_completed') }}
        onNetworkError={() => { setErrorInfo({ type: 'network', retryTo: 'check_out' }); setPhase('network_error') }}
        onDifferentEmail={resetToEmailEntry}
        differentEmailLabel={inSession ? 'Not you? Use an email instead' : 'Use a different email'}
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
      ? (inSession ? () => finish() : () => handleEmailSubmit(emailInput))
      : errorInfo?.retryTo
        ? () => setPhase(errorInfo.retryTo)
        : null

    inner = (
      <LifecycleResultView
        variant={variant}
        data={resultData || {}}
        onDone={finish}
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
