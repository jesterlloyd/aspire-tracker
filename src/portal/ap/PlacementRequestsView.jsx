// AP-PORTAL: the Academic Partner Placement Requests workspace (Phase 1).
//
// The authenticated counterpart of the public /school-form. It reuses the SAME canonical field
// definition, order, validation, and copy through src/lib/schoolPlacementForm.js, so the two
// surfaces cannot drift. Two modes:
//   - list: the school's submitted requests (read-only), grouped by authorized school + cohort.
//   - new:  a New Placement Request form. The school is prefilled/locked to the caller's
//           server-authorized school; the cohort and its password requirement are resolved exactly
//           like the public form (school_form_requires_password / verify_school_form_password RPCs,
//           verified before the form is shown).
//
// SUBMISSION IS NOT ENABLED in this phase. Recording the authenticated submitting profile needs a
// students column that does not exist yet; per the approved provenance rule the endpoint fails
// closed (503) rather than omit that identity, and this workspace disables the submit control with a
// truthful banner. Drafts, editing, withdrawal, Request a Change, and audit history are out of scope.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { LoadingState, EmptyState, ErrorState, DeniedState } from '../unit/UnitLeaderChrome'
import { useRegisterPortalRefresh } from '../PortalRefresh'
import { PortalHeaderScope, PortalHeaderControls } from '../PortalHeaderSlots'
import { getSchoolPlacementRequests, submitSchoolPlacementRequest } from './academicPartnerApi'
import { submissionCohortOptions } from './academicPartnerRoster'
import { toggleWeekday, isValidIsoDate } from '../../lib/availability'
import {
  PROGRAM_TYPES, WEEKDAYS, SCHOOL_PLACEMENT_TEXT,
  newStudentRow, emptyCoordinator, emptyRotation, emptyAvailability,
  validatePlacementForm, buildPlacementBody, placementSubmitLabel,
} from '../../lib/schoolPlacementForm'

const T = SCHOOL_PLACEMENT_TEXT

export default function PlacementRequestsView({ onNavigate }) {
  const [schools, setSchools] = useState(null)
  const [submissionEnabled, setSubmissionEnabled] = useState(false)
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  const [selectedSchoolKey, setSelectedSchoolKey] = useState(null)
  const [selectedCohortId, setSelectedCohortId]   = useState(null)   // the chosen submission cohort

  // Refresh re-reads the school + accepting-cohort context and the submission_enabled signal. It does
  // NOT discard an in-progress form: the form state lives in the child and Refresh only reloads
  // context. Registered only while this workspace is mounted (the Placement Requests section).
  useRegisterPortalRefresh(reload)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const res = await getSchoolPlacementRequests()
        if (cancelled) return
        if (!res.ok) { setError('We could not load your placement request workspace right now. Please try again shortly.'); setLoading(false); return }
        setSchools(res.data?.schools || [])
        setSubmissionEnabled(res.data?.submission_enabled === true)
      } catch {
        if (!cancelled) setError('We could not load your placement request workspace right now. Please try again shortly.')
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [reloadKey])

  if (loading) return <LoadingState label="Loading your placement request workspace" />
  if (error)   return <ErrorState detail={error} onRetry={reload} />
  if (!schools || schools.length === 0) {
    return (
      <DeniedState
        title="No school linked yet"
        detail="Your account is active, but no school is connected to it yet. The ASPIRE team connects your school, and you can submit placement requests here once it is in place."
      />
    )
  }

  // Submission-focused: the canonical accepting cohorts are the only valid targets. Default is the
  // nearest upcoming accepting cohort, so a closed Summer cohort never blocks an accepting Fall one.
  const school = schools.find(s => s.school_key === selectedSchoolKey) || schools[0]
  const { options: acceptingOptions, defaultId: acceptingDefault } = submissionCohortOptions(school.cohorts || [])
  const submissionCohortId = acceptingOptions.some(o => o.id === selectedCohortId) ? selectedCohortId : acceptingDefault
  const submissionCohort = (school.cohorts || []).find(c => c.id === submissionCohortId) || null

  const onSchoolChange = (key) => { setSelectedSchoolKey(key); setSelectedCohortId(null) }

  return (
    <div className="ptl-page ptl-ap-page">
      <div className="ptl-plr-head">
        <div>
          <h1 className="ptl-plr-title">Placement Requests</h1>
          <p className="ptl-muted ptl-small ptl-plr-lede">
            Submit your school's ASPIRE placement requests here. After you submit, follow each
            student's status, unit and preceptor assignment, rotation dates, and hours in the Students
            tab.
          </p>
        </div>
        <button type="button" className="ptl-btn-outline ptl-btn-sm ptl-plr-new" onClick={() => onNavigate?.('students')}>
          View students and statuses
        </button>
      </div>

      {/* School scope + the SUBMISSION cohort picker (accepting cohorts only) live in the header. */}
      <PortalHeaderScope>{schools.length === 1 ? <> · {school.school_key}</> : null}</PortalHeaderScope>
      <PortalHeaderControls>
        {schools.length > 1 && (
          <span className="ptl-header-ctl">
            <span className="ptl-header-ctl-label">School</span>
            <select aria-label="School" value={school.school_key} onChange={e => onSchoolChange(e.target.value)}>
              {schools.map(s => <option key={s.school_key} value={s.school_key}>{s.school_key}</option>)}
            </select>
          </span>
        )}
        {acceptingOptions.length > 1 && (
          <span className="ptl-header-ctl">
            <span className="ptl-header-ctl-label">Cohort</span>
            <select aria-label="Submission cohort" value={submissionCohortId || ''} onChange={e => setSelectedCohortId(e.target.value)}>
              {acceptingOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </span>
        )}
      </PortalHeaderControls>

      {submissionCohort ? (
        <NewPlacementRequest
          schoolKey={school.school_key}
          cohortId={submissionCohort.id}
          cohortName={submissionCohort.name}
          submissionEnabled={submissionEnabled}
          onViewStudents={() => onNavigate?.('students')}
        />
      ) : (
        <EmptyState
          title="No cohort is accepting requests right now"
          detail="New submissions open when the ASPIRE team activates a cohort for your school. You can still follow your current students in the Students tab."
        />
      )}
    </div>
  )
}

// The New Placement Request flow for a specific accepting cohort (chosen by the parent from the
// canonical accepting-cohort list). It determines the cohort's password requirement, gates behind
// verification when required, then renders the shared-definition form. The final submit is enabled
// from the server's submission_enabled signal; the server independently re-authorizes and re-verifies
// regardless. Success shows added/updated/skipped counts; recoverable errors keep the form intact.
function NewPlacementRequest({ schoolKey, cohortId, cohortName, submissionEnabled, onViewStudents }) {
  const [gate, setGate] = useState('checking')  // 'checking' | 'password' | 'open'
  const [pwdInput, setPwdInput]     = useState('')
  const [pwdError, setPwdError]     = useState(null)
  const [pwdChecking, setPwdChecking] = useState(false)
  // The verified cohort password, kept ONLY in transient component state so it can be re-verified on
  // the final POST. Never persisted to storage, never logged.
  const [verifiedPassword, setVerifiedPassword] = useState('')

  // Form state (canonical shared shapes). The school is locked to the caller's authorized school.
  const [coord, setCoord] = useState(() => ({ ...emptyCoordinator(), school: schoolKey }))
  const [rotation, setRotation] = useState(emptyRotation)
  const [avail, setAvail] = useState(emptyAvailability)
  const [blackoutInput, setBlackoutInput] = useState('')
  const [rows, setRows] = useState([newStudentRow()])
  const [formError, setFormError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)  // { added, updated, skipped } on success

  const setC = (k, v) => setCoord(p => ({ ...p, [k]: v }))
  const setA = (k, v) => setAvail(p => ({ ...p, [k]: v }))
  const updRow = (key, field, val) => setRows(prev => prev.map(r => r._key === key ? { ...r, [field]: val } : r))
  const addRow = () => setRows(prev => [...prev, newStudentRow()])
  const removeRow = (key) => setRows(prev => prev.filter(r => r._key !== key))

  // When the submission cohort changes, reset ONLY the cohort-dependent password verification (the
  // gate + entered/verified password); typed form data (coordinator, rotation, students) is preserved.
  // This is the "adjust state during render" pattern (not a setState-in-effect), so the reset is
  // applied before the password-requirement effect runs.
  const [prevCohortId, setPrevCohortId] = useState(cohortId)
  if (cohortId !== prevCohortId) {
    setPrevCohortId(cohortId)
    setGate('checking'); setVerifiedPassword(''); setPwdInput(''); setPwdError(null)
  }

  // Determine the cohort's password requirement. On an RPC error we fall open to the form; the server
  // re-verifies the password on submit, so a required-password cohort is still enforced there.
  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const { data: requiresPwd } = await supabase.rpc('school_form_requires_password', { p_cohort_id: cohortId })
        if (!cancelled) setGate(requiresPwd ? 'password' : 'open')
      } catch { if (!cancelled) setGate('open') }
    }
    init()
    return () => { cancelled = true }
  }, [cohortId])

  const verifyPassword = async (e) => {
    e.preventDefault()
    if (!pwdInput.trim()) return
    setPwdChecking(true); setPwdError(null)
    try {
      const { data: ok, error: rpcErr } = await supabase.rpc('verify_school_form_password', {
        p_cohort_id: cohortId, p_entered_password: pwdInput.trim(),
      })
      if (rpcErr) throw rpcErr
      if (ok) { setVerifiedPassword(pwdInput.trim()); setGate('open') }
      else { setPwdError('Incorrect password. Please check with the ASPIRE team.'); setPwdInput('') }
    } catch { setPwdError('Unable to verify at this time. Please try again.') }
    setPwdChecking(false)
  }

  const validation = useMemo(
    () => validatePlacementForm({ coordinator: coord, rotation, students: rows, cohortId }),
    [coord, rotation, rows, cohortId],
  )

  // Final submission. Validates client-side (shared rules), then POSTs the canonical body plus the
  // transient verified password. The server independently re-authorizes the school/cohort, re-verifies
  // the password, and gates on provenance readiness. On a recoverable failure the form is preserved.
  const doSubmit = async () => {
    if (submitting) return
    setFormError(null)
    if (validation) { setFormError(validation.message); return }
    setSubmitting(true)
    const payload = buildPlacementBody({ cohortId, cohortName, coordinator: coord, rotation, availability: avail, students: rows })
    if (verifiedPassword) payload.password = verifiedPassword
    const res = await submitSchoolPlacementRequest(payload)
    setSubmitting(false)
    if (res.ok) {
      setResult({
        added: res.data?.added || [], updated: res.data?.updated || [], skipped: res.data?.skipped || [],
      })
      return
    }
    // Truthful, non-technical messages by failure kind; the form values are kept intact.
    if (res.status === 503) setFormError('Online submission is not enabled yet. The ASPIRE team is finalizing it; please try again later.')
    else if (res.error === 'password_required' || res.error === 'password_invalid') { setFormError('The cohort password could not be verified. Please reopen the form and re-enter it.'); setGate('password'); setVerifiedPassword('') }
    else if (res.status === 403) setFormError('This school or cohort is not in your access scope.')
    else setFormError('That request could not be submitted right now. Your entries are preserved; please try again.')
  }

  if (gate === 'checking') return <LoadingState label="Preparing the request form" />
  if (gate === 'password') {
    return (
      <div className="ptl-plr-embed">
        <div className="ptl-card ptl-plr-gate">
          <h2 className="ptl-card-title">Cohort access</h2>
          <p className="ptl-muted">Enter the cohort password provided by the ASPIRE team to open the request form for {cohortName}.</p>
          <form onSubmit={verifyPassword} className="ptl-plr-gate-form">
            <input type="password" className="ptl-input ptl-input-full" value={pwdInput}
              onChange={e => { setPwdInput(e.target.value); setPwdError(null) }}
              placeholder="Enter cohort password" autoFocus
              style={pwdError ? { borderColor: 'var(--cs-red, #dc1e34)' } : undefined} />
            {pwdError && <p className="ptl-plr-gate-error" role="alert">{pwdError}</p>}
            <button type="submit" className="ptl-btn" disabled={pwdChecking || !pwdInput.trim()}>
              {pwdChecking ? 'Verifying…' : 'Access form'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // Success confirmation with added / updated / skipped counts. No duplicate roster: the partner
  // follows each student's status in the Students tab.
  if (result) {
    const n = (arr) => (arr || []).length
    return (
      <div className="ptl-plr-embed">
        <div className="ptl-card ptl-plr-form-card">
          <h2 className="ptl-card-title">Thank you.</h2>
          {n(result.added) > 0 && (
            <p className="ptl-plr-confirm"><b>{n(result.added)} student{n(result.added) !== 1 ? 's' : ''} added</b> to ASPIRE for {cohortName}.</p>
          )}
          {n(result.updated) > 0 && (
            <p className="ptl-plr-confirm ptl-muted"><b>{n(result.updated)} existing student{n(result.updated) !== 1 ? 's' : ''} updated</b> with the latest placement details.</p>
          )}
          {n(result.skipped) > 0 && (
            <p className="ptl-plr-confirm ptl-muted"><b>{n(result.skipped)} skipped</b> (incomplete rows): {result.skipped.join(', ')}</p>
          )}
          <button type="button" className="ptl-btn ptl-plr-back" onClick={onViewStudents}>View students and statuses</button>
        </div>
      </div>
    )
  }

  // gate === 'open': the shared-definition form. The submit control is enabled only when the server
  // reports submission is enabled (the provenance migration is applied); the server gates regardless.
  return (
    <div className="ptl-plr-embed">
      <div className="ptl-card ptl-plr-form-card">
        <div className="ptl-plr-form-head">
          <h2 className="ptl-card-title">New Placement Request</h2>
          {cohortName && <span className="ptl-ap-cohort-badge">{cohortName}</span>}
        </div>

        {!submissionEnabled && (
          <div className="ptl-plr-gated-banner" role="status">
            Online submission is being finalized with the ASPIRE team and is not enabled yet. You can
            prepare this request, but the submit button stays disabled until submissions are activated.
          </div>
        )}

        <form className="ptl-plr-form" onSubmit={e => e.preventDefault()}>
          {/* School Information */}
          <div className="ptl-plr-section">
            <div className="ptl-plr-section-title">{T.schoolSectionTitle}</div>
            <div className="ptl-ap-field">
              <label className="ptl-label">{T.schoolLabel}</label>
              <input className="ptl-input ptl-input-full" value={coord.school} disabled aria-disabled="true" />
            </div>
            <div className="ptl-plr-row-2">
              <div className="ptl-ap-field">
                <label className="ptl-label">{T.coordinatorNameLabel}</label>
                <input className="ptl-input ptl-input-full" value={coord.name}
                  onChange={e => setC('name', e.target.value)} placeholder={T.coordinatorNamePlaceholder} />
              </div>
              <div className="ptl-ap-field">
                <label className="ptl-label">{T.coordinatorEmailLabel}</label>
                <input className="ptl-input ptl-input-full" type="email" value={coord.email}
                  onChange={e => setC('email', e.target.value)} placeholder={T.coordinatorEmailPlaceholder} />
              </div>
            </div>
          </div>

          {/* Rotation Dates */}
          <div className="ptl-plr-section">
            <div className="ptl-plr-section-title">{T.rotationSectionTitle}</div>
            <p className="ptl-muted ptl-small">{T.rotationIntro}</p>
            <div className="ptl-plr-row-2">
              <div className="ptl-ap-field">
                <label className="ptl-label">{T.rotationStartLabel}</label>
                <input className="ptl-input ptl-input-full" type="date" value={rotation.start_date}
                  onChange={e => setRotation(p => ({ ...p, start_date: e.target.value }))} style={{ colorScheme: 'light' }} />
              </div>
              <div className="ptl-ap-field">
                <label className="ptl-label">{T.rotationEndLabel}</label>
                <input className="ptl-input ptl-input-full" type="date" value={rotation.end_date}
                  onChange={e => setRotation(p => ({ ...p, end_date: e.target.value }))} style={{ colorScheme: 'light' }} />
              </div>
            </div>
          </div>

          {/* Rotation Availability */}
          <div className="ptl-plr-section">
            <div className="ptl-plr-section-title">{T.availabilitySectionTitle}</div>
            <p className="ptl-muted ptl-small">{T.availabilityIntro}</p>
            <div className="ptl-ap-field">
              <label className="ptl-label">{T.unavailableWeekdaysLabel}</label>
              <div className="ptl-plr-weekdays">
                {WEEKDAYS.map(day => {
                  const on = avail.unavailable_weekdays.includes(day)
                  return (
                    <button type="button" key={day} className={`ptl-plr-day${on ? ' ptl-plr-day-on' : ''}`}
                      onClick={() => setA('unavailable_weekdays', toggleWeekday(avail.unavailable_weekdays, day))}>
                      {day}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="ptl-plr-row-3">
              <div className="ptl-ap-field">
                <label className="ptl-label">{T.minDaysLabel}</label>
                <input className="ptl-input ptl-input-full" type="number" min="1" max="7" value={avail.min_days_per_week}
                  onChange={e => setA('min_days_per_week', e.target.value)} placeholder={T.minDaysPlaceholder} />
              </div>
              <div className="ptl-ap-field">
                <label className="ptl-label">{T.weekendsAllowedLabel}</label>
                <select className="ptl-select ptl-input-full"
                  value={avail.weekends_allowed === null ? '' : (avail.weekends_allowed ? 'yes' : 'no')}
                  onChange={e => setA('weekends_allowed', e.target.value === '' ? null : e.target.value === 'yes')}>
                  <option value="">{T.triStatePlaceholder}</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div className="ptl-ap-field">
                <label className="ptl-label">{T.nightsAllowedLabel}</label>
                <select className="ptl-select ptl-input-full"
                  value={avail.nights_allowed === null ? '' : (avail.nights_allowed ? 'yes' : 'no')}
                  onChange={e => setA('nights_allowed', e.target.value === '' ? null : e.target.value === 'yes')}>
                  <option value="">{T.triStatePlaceholder}</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
            </div>
            <div className="ptl-ap-field">
              <label className="ptl-label">{T.blackoutLabel}</label>
              <div className="ptl-plr-blackout">
                <input className="ptl-input" type="date" value={blackoutInput}
                  onChange={e => setBlackoutInput(e.target.value)} style={{ colorScheme: 'light', maxWidth: 200 }} />
                <button type="button" className="ptl-btn-outline ptl-btn-sm"
                  onClick={() => {
                    if (isValidIsoDate(blackoutInput) && !avail.blackout_dates.includes(blackoutInput)) {
                      setA('blackout_dates', [...avail.blackout_dates, blackoutInput])
                    }
                    setBlackoutInput('')
                  }}>
                  {T.addDateLabel}
                </button>
              </div>
              {avail.blackout_dates.length > 0 && (
                <div className="ptl-plr-chips">
                  {avail.blackout_dates.map(d => (
                    <span key={d} className="ptl-plr-chip">
                      {d}
                      <button type="button" aria-label={`Remove ${d}`}
                        onClick={() => setA('blackout_dates', avail.blackout_dates.filter(x => x !== d))}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="ptl-ap-field">
              <label className="ptl-label">{T.schedulingNotesLabel}</label>
              <textarea className="ptl-input ptl-input-full" rows={2} value={avail.scheduling_notes}
                onChange={e => setA('scheduling_notes', e.target.value)} placeholder={T.schedulingNotesPlaceholder} />
            </div>
          </div>

          {/* Students */}
          <div className="ptl-plr-section">
            <div className="ptl-plr-section-title">{T.studentsSectionTitle}</div>
            {rows.map((row, idx) => (
              <div key={row._key} className="ptl-plr-student">
                <div className="ptl-plr-student-head">
                  <span className="ptl-plr-student-num">{T.studentLabelPrefix} {idx + 1}</span>
                  {rows.length > 1 && (
                    <button type="button" className="ptl-btn-quiet ptl-btn-sm" onClick={() => removeRow(row._key)}>{T.removeLabel}</button>
                  )}
                </div>
                <div className="ptl-plr-row-2">
                  <div className="ptl-ap-field">
                    <label className="ptl-label">{T.firstNameLabel}</label>
                    <input className="ptl-input ptl-input-full" value={row.first_name}
                      onChange={e => updRow(row._key, 'first_name', e.target.value)} placeholder={T.firstNamePlaceholder} />
                  </div>
                  <div className="ptl-ap-field">
                    <label className="ptl-label">{T.lastNameLabel}</label>
                    <input className="ptl-input ptl-input-full" value={row.last_name}
                      onChange={e => updRow(row._key, 'last_name', e.target.value)} placeholder={T.lastNamePlaceholder} />
                  </div>
                </div>
                <div className="ptl-plr-row-2">
                  <div className="ptl-ap-field">
                    <label className="ptl-label">{T.schoolEmailLabel}</label>
                    <input className="ptl-input ptl-input-full" type="email" value={row.email}
                      onChange={e => updRow(row._key, 'email', e.target.value)} placeholder={T.schoolEmailPlaceholder} />
                  </div>
                  <div className="ptl-ap-field">
                    <label className="ptl-label">{T.phoneLabel}</label>
                    <input className="ptl-input ptl-input-full" value={row.phone}
                      onChange={e => updRow(row._key, 'phone', e.target.value)} placeholder={T.phonePlaceholder} />
                  </div>
                </div>
                <div className="ptl-plr-row-3">
                  <div className="ptl-ap-field">
                    <label className="ptl-label">{T.programTypeLabel}</label>
                    <select className="ptl-select ptl-input-full" value={row.program_type}
                      onChange={e => updRow(row._key, 'program_type', e.target.value)}>
                      <option value="">{T.programTypePlaceholder}</option>
                      {PROGRAM_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="ptl-ap-field">
                    <label className="ptl-label">{T.hoursRequiredLabel}</label>
                    <input className="ptl-input ptl-input-full" type="text" inputMode="numeric" pattern="[0-9]*"
                      value={row.hours_required} onChange={e => updRow(row._key, 'hours_required', e.target.value)} placeholder={T.hoursRequiredPlaceholder} />
                  </div>
                  <div className="ptl-ap-field">
                    <label className="ptl-label">{T.estimatedGraduationLabel}</label>
                    <input className="ptl-input ptl-input-full" type="date" value={row.estimated_graduation_date}
                      onChange={e => updRow(row._key, 'estimated_graduation_date', e.target.value)} style={{ colorScheme: 'light' }} />
                  </div>
                </div>
              </div>
            ))}
            <button type="button" className="ptl-btn-outline ptl-btn-sm" onClick={addRow}>{T.addStudentLabel}</button>
          </div>

          {/* Additional Notes */}
          <div className="ptl-plr-section">
            <div className="ptl-ap-field">
              <label className="ptl-label">{T.additionalNotesLabel}</label>
              <textarea className="ptl-input ptl-input-full" rows={3} value={coord.notes}
                onChange={e => setC('notes', e.target.value)} placeholder={T.additionalNotesPlaceholder} />
            </div>
          </div>

          {formError && <div className="ptl-plr-gate-error" role="alert">{formError}</div>}

          <div className="ptl-plr-submit-row">
            {/* Enabled only when the server reports submission is enabled (the migration is applied);
                the server re-authorizes, re-verifies the password, and gates on readiness regardless. */}
            <button type="button" className="ptl-btn" disabled={!submissionEnabled || submitting}
              title={submissionEnabled ? undefined : 'Submissions are not enabled yet'}
              onClick={doSubmit}>
              {submitting ? 'Submitting…' : placementSubmitLabel(rows.length)}
            </button>
            {!submissionEnabled && <span className="ptl-muted ptl-small">Submission activation pending.</span>}
          </div>
        </form>
      </div>
    </div>
  )
}
