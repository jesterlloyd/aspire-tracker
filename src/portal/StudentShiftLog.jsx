// src/portal/StudentShiftLog.jsx
//
// STUDENT-SHIFT-TAB-1 (Owner decision, 2026-09-05): the Shift Log INSIDE the Student
// Portal. Check in, check out, and log a past shift with the SESSION as identity: no
// email entry, no leaving the portal. The screens are the public /shift-log lifecycle's
// own views, fed through a transport that carries the portal token to
// /api/portal/my-shift-lifecycle, which resolves the student from the token and runs
// the public handlers unchanged.
//
// What is deliberately NOT here: the email entry screen, "Use a different email" and
// "Try a different email" (the session is the identity), and any student identifier in
// the URL or the request beyond the server's own allowlist answer for an account that
// holds several records.
import { useState, useCallback, useEffect, useMemo } from 'react'
import CheckInView from '../components/shift-log-lifecycle/CheckInView'
import CheckOutView from '../components/shift-log-lifecycle/CheckOutView'
import LifecycleResultView from '../components/shift-log-lifecycle/LifecycleResultView'
import ShiftLogPage from '../components/ShiftLogPage'
import { getStudentPreferredGreetingName } from '../lib/studentNameFormatters'
import { postShiftLifecycle, shiftLifecycleTransport } from '../lib/myShiftLifecycleApi'
import { useRegisterPortalRefresh } from './PortalRefresh'
import { LoadingState, EmptyState } from './unit/UnitLeaderChrome'
import { useReportPortalFailure, ACCESS_FAILURE } from './portalAccessSignal'

export default function StudentShiftLog({ active = true, readOnlyPreview = false }) {
  const [phase, setPhase] = useState('loading')
  // 'loading' | 'pick_record' | 'no_email' | 'check_in' | 'check_out' | 'past_shift'
  // | 'check_in_success' | 'check_out_success' | 'check_out_already_completed'
  // | 'ineligible' | 'ambiguous' | 'network_error'
  const [studentId, setStudentId] = useState(null)
  const [records, setRecords] = useState([])
  const [studentData, setStudentData] = useState(null)
  const [resultData, setResultData] = useState(null)
  const [errorInfo, setErrorInfo] = useState(null)
  const reportFailure = useReportPortalFailure()

  // The truth about the student and any open shift comes from the server on every
  // (re)entry, so the tab always opens on the right screen: check-out when a shift
  // is in progress, check-in otherwise.
  const lookup = useCallback(async (id) => {
    // Keep the effect subscription itself free of synchronous state updates.
    await Promise.resolve()
    setPhase('loading')
    try {
      const res = await postShiftLifecycle('lookup', {}, { studentId: id })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 400 && data.error === 'student_required') { setRecords(data.students || []); setPhase('pick_record'); return }
        if (res.status === 409 && data.error === 'no_school_email') { setPhase('no_email'); return }
        // A refusal because this person's access ended is the shell's answer, not ours.
        const kind = reportFailure({ status: res.status, error: data.error })
        if (kind === ACCESS_FAILURE.ACCESS_ENDED) return
        setErrorInfo({ type: 'network', retryTo: 'lookup' }); setPhase('network_error'); return
      }
      setStudentId(data.student_id || id || null)
      if (!data.found && data.error === 'ambiguous_student_email') { setPhase('ambiguous'); return }
      if (!data.found) { setErrorInfo({ type: 'not_found' }); setPhase('ineligible'); return }
      if (!data.eligible) { setErrorInfo({ type: data.ineligible_reason }); setPhase('ineligible'); return }
      setStudentData({ ...data.student, open_shift: data.open_shift || null })
      setPhase(data.open_shift ? 'check_out' : 'check_in')
    } catch {
      setErrorInfo({ type: 'network', retryTo: 'lookup' }); setPhase('network_error')
    }
  }, [reportFailure])

  useEffect(() => {
    // The lookup is scheduled, not called, so the effect body itself sets no state.
    if (!active || readOnlyPreview) return undefined
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) lookup(null) })
    return () => { cancelled = true }
  }, [active, readOnlyPreview, lookup])

  // The shared portal Refresh re-reads the student and any open shift.
  const refresh = useCallback(() => lookup(studentId), [lookup, studentId])
  useRegisterPortalRefresh(refresh, active && !readOnlyPreview)

  const checkInTransport = useMemo(() => shiftLifecycleTransport('check_in', studentId), [studentId])
  const checkOutTransport = useMemo(() => shiftLifecycleTransport('check_out', studentId), [studentId])
  const pastShiftTransport = useMemo(() => shiftLifecycleTransport('past_shift', studentId), [studentId])

  if (readOnlyPreview) {
    return (
      <EmptyState
        title="Shift Log"
        detail="Shift logging is available to signed-in students. Owner/Admin preview is read-only because the preview does not impersonate the selected student."
      />
    )
  }

  const studentName = studentData ? getStudentPreferredGreetingName(studentData) : null
  const done = () => lookup(studentId)

  let inner
  if (phase === 'loading') {
    inner = <LoadingState label="Loading your Shift Log" />
  } else if (phase === 'pick_record') {
    inner = (
      <div className="ptl-card">
        <h2 className="ptl-card-title">Which Rotation?</h2>
        <p className="ptl-muted ptl-small">Your account holds more than one ASPIRE record. Choose the rotation you are logging for.</p>
        <div className="ptl-shift-tab-records">
          {records.map(r => (
            <button key={r.id} type="button" className="ptl-btn ptl-btn-sm" onClick={() => lookup(r.id)}>
              {r.cohort_name || 'Rotation'}
            </button>
          ))}
        </div>
      </div>
    )
  } else if (phase === 'no_email') {
    inner = (
      <EmptyState
        title="Shift Log"
        detail="Your record has no school email on file yet, which the Shift Log needs. Please contact the ASPIRE team."
      />
    )
  } else if (phase === 'past_shift') {
    inner = (
      <div>
        <button type="button" className="ptl-inline-link ptl-inline-btn ptl-shift-tab-back" onClick={() => setPhase('check_in')}>
          Back to check-in
        </button>
        <ShiftLogPage presetStudent={studentData} embedded transport={pastShiftTransport} />
      </div>
    )
  } else if (phase === 'check_in') {
    inner = (
      <CheckInView
        student={studentData}
        transport={checkInTransport}
        onSuccess={(shift) => { setResultData({ shift, studentName }); setPhase('check_in_success') }}
        onNetworkError={() => { setErrorInfo({ type: 'network', retryTo: 'check_in' }); setPhase('network_error') }}
        onPastShift={() => setPhase('past_shift')}
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
      />
    )
  } else {
    let variant = 'network_error'
    if (phase === 'check_in_success') variant = 'check_in_success'
    else if (phase === 'check_out_success') variant = resultData?.shift?.status === 'Pending Review' ? 'check_out_success_pending_review' : 'check_out_success_auto_accepted'
    else if (phase === 'check_out_already_completed') variant = 'check_out_already_completed'
    else if (phase === 'ineligible') variant = `ineligible_${errorInfo?.type || 'not_found'}`
    else if (phase === 'ambiguous') variant = 'ambiguous'

    const onRetry = errorInfo?.retryTo === 'lookup'
      ? () => lookup(studentId)
      : errorInfo?.retryTo
        ? () => setPhase(errorInfo.retryTo)
        : null

    inner = (
      <LifecycleResultView
        variant={variant}
        data={resultData || {}}
        onDone={done}
        onTryDifferentEmail={null}
        onRetry={onRetry}
      />
    )
  }

  return (
    <div className="ptl-shift-tab">
      <h1 className="ptl-visually-hidden">Shift Log</h1>
      {inner}
    </div>
  )
}
