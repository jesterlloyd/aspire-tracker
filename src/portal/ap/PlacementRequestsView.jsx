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
import StatusPill from '../../components/StatusPill'
import StatusLegendPopover from '../../components/StatusLegendPopover'
import { LoadingState, EmptyState, ErrorState, DeniedState } from '../unit/UnitLeaderChrome'
import { useRegisterPortalRefresh } from '../PortalRefresh'
import { getSchoolPlacementRequests } from './academicPartnerApi'
import { cohortOptions, inCohortScope } from './academicPartnerRoster'
import { toggleWeekday, isValidIsoDate } from '../../lib/availability'
import {
  PROGRAM_TYPES, WEEKDAYS, SCHOOL_PLACEMENT_TEXT,
  newStudentRow, emptyCoordinator, emptyRotation, emptyAvailability,
  validatePlacementForm, placementSubmitLabel,
} from '../../lib/schoolPlacementForm'

const T = SCHOOL_PLACEMENT_TEXT

const fmtDate = (d) => {
  if (!d) return ''
  try {
    return new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return String(d) }
}
const displayName = (s) => `${s.preferred_first_name || s.first_name || ''} ${s.last_name || ''}`.trim()
const rotationText = (r) => (r?.start_date ? `${fmtDate(r.start_date)} to ${fmtDate(r.end_date)}` : '')

export default function PlacementRequestsView() {
  const [schools, setSchools] = useState(null)
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  const [selectedSchoolKey, setSelectedSchoolKey] = useState(null)
  const [selectedCohortId, setSelectedCohortId]   = useState(null)
  const [mode, setMode] = useState('list')  // 'list' | 'new'

  // The shared portal Refresh re-fetches the submitted-request list without discarding an
  // in-progress form (a new-request draft is only started from the list, and Refresh acts on the
  // list). Registered only while this workspace is mounted (the Placement Requests section).
  useRegisterPortalRefresh(reload)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const res = await getSchoolPlacementRequests()
        if (cancelled) return
        if (!res.ok) { setError('We could not load your placement requests right now. Please try again shortly.'); setLoading(false); return }
        setSchools(res.data?.schools || [])
      } catch {
        if (!cancelled) setError('We could not load your placement requests right now. Please try again shortly.')
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [reloadKey])

  if (loading) return <LoadingState label="Loading your placement requests" />
  if (error)   return <ErrorState detail={error} onRetry={reload} />
  if (!schools || schools.length === 0) {
    return (
      <DeniedState
        title="No school linked yet"
        detail="Your account is active, but no school is connected to it yet. The ASPIRE team connects your school, and your placement requests will appear here once it is in place."
      />
    )
  }

  const school = schools.find(s => s.school_key === selectedSchoolKey) || schools[0]
  const requests = school.requests || []
  const { options, defaultId, currentIds } = cohortOptions(requests)
  const cohortId = options.some(o => o.id === selectedCohortId) ? selectedCohortId : defaultId
  const cohortLabel = options.find(o => o.id === cohortId)?.label || 'All Cohorts'
  const scoped = requests.filter(s => inCohortScope(s, cohortId, currentIds))

  const onSchoolChange = (key) => { setSelectedSchoolKey(key); setSelectedCohortId(null) }

  if (mode === 'new') {
    return (
      <NewPlacementRequest
        schoolKey={school.school_key}
        onBack={() => setMode('list')}
      />
    )
  }

  return (
    <div className="ptl-page ptl-ap-page">
      <div className="ptl-plr-head">
        <div>
          <h1 className="ptl-plr-title">Placement Requests</h1>
          <p className="ptl-muted ptl-small ptl-plr-lede">
            Submit and track your school's ASPIRE placement requests. Each request enters the ASPIRE
            pathway and appears with its current status once the team begins outreach.
          </p>
        </div>
        <button type="button" className="ptl-btn ptl-plr-new" onClick={() => setMode('new')}>
          New Placement Request
        </button>
      </div>

      <section className="ptl-ap-controls">
        {schools.length === 1 && <p className="ptl-unit-context ptl-ap-schoolline">School · <b>{school.school_key}</b></p>}
        <div className="ptl-ap-pickers">
          {schools.length > 1 && (
            <div className="ptl-ap-field">
              <label className="ptl-label" htmlFor="plr-school">School</label>
              <select id="plr-school" className="ptl-select" value={school.school_key} onChange={e => onSchoolChange(e.target.value)}>
                {schools.map(s => <option key={s.school_key} value={s.school_key}>{s.school_key}</option>)}
              </select>
            </div>
          )}
          <div className="ptl-ap-field">
            <label className="ptl-label" htmlFor="plr-cohort">Cohort</label>
            <select id="plr-cohort" className="ptl-select" value={cohortId} onChange={e => setSelectedCohortId(e.target.value)}>
              {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </section>

      {requests.length === 0 ? (
        <EmptyState title="No placement requests yet" detail="When you submit a placement request, it will appear here with its current ASPIRE status." />
      ) : scoped.length === 0 ? (
        <EmptyState title={`No requests in ${cohortLabel}`} detail="Choose a different cohort to see more of your school's requests." />
      ) : (
        <div className="ptl-card ptl-ap-roster">
          <div className="ptl-table-wrap">
            <table className="ptl-table ptl-ap-table">
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Cohort</th>
                  <th scope="col">
                    <span className="am-sort-th-inner">
                      ASPIRE status
                      <StatusLegendPopover showStaffDetail={false} />
                    </span>
                  </th>
                  <th scope="col">Requested rotation</th>
                  <th scope="col">Confirmed unit</th>
                  <th scope="col">Primary preceptor</th>
                  <th scope="col">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {scoped.map(s => (
                  <tr key={s.id}>
                    <td><span className="ptl-ap-student-name">{displayName(s)}</span></td>
                    <td>{s.cohort?.name || ''}</td>
                    <td><StatusPill status={s.status} /></td>
                    <td>{rotationText(s.rotation) || <span className="ptl-muted">Not set</span>}</td>
                    <td>{s.unit_name || <span className="ptl-muted">Not yet confirmed</span>}</td>
                    <td>{s.preceptor_name || <span className="ptl-muted">Not assigned</span>}</td>
                    <td>{s.submitted_at ? fmtDate(s.submitted_at) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ptl-muted ptl-small">
            Status and unit updates come from the ASPIRE team as each request moves through the
            pathway. Interview scores, evaluation content, and internal notes stay with the team.
          </p>
        </div>
      )}
    </div>
  )
}

// The New Placement Request flow: resolve the accepting cohort and its password requirement exactly
// like the public form, then render the shared-definition form. Submission is gated (see file top).
function NewPlacementRequest({ schoolKey, onBack }) {
  const [gate, setGate] = useState('loading')  // 'loading' | 'unavailable' | 'password' | 'open'
  const [cohortId, setCohortId]     = useState(null)
  const [cohortName, setCohortName] = useState('')
  const [pwdInput, setPwdInput]     = useState('')
  const [pwdError, setPwdError]     = useState(null)
  const [pwdChecking, setPwdChecking] = useState(false)

  // Form state (canonical shared shapes). The school is locked to the caller's authorized school.
  const [coord, setCoord] = useState(() => ({ ...emptyCoordinator(), school: schoolKey }))
  const [rotation, setRotation] = useState(emptyRotation)
  const [avail, setAvail] = useState(emptyAvailability)
  const [blackoutInput, setBlackoutInput] = useState('')
  const [rows, setRows] = useState([newStudentRow()])
  const [formError, setFormError] = useState(null)

  const setC = (k, v) => setCoord(p => ({ ...p, [k]: v }))
  const setA = (k, v) => setAvail(p => ({ ...p, [k]: v }))
  const updRow = (key, field, val) => setRows(prev => prev.map(r => r._key === key ? { ...r, [field]: val } : r))
  const addRow = () => setRows(prev => [...prev, newStudentRow()])
  const removeRow = (key) => setRows(prev => prev.filter(r => r._key !== key))

  useEffect(() => {
    let cancelled = false
    async function init() {
      const { data } = await supabase.from('cohorts').select('id, name').eq('accepting_submissions', true).limit(1).single()
      if (cancelled) return
      if (!data) { setGate('unavailable'); return }
      setCohortId(data.id); setCohortName(data.name)
      try {
        const { data: requiresPwd } = await supabase.rpc('school_form_requires_password', { p_cohort_id: data.id })
        setGate(requiresPwd ? 'password' : 'open')
      } catch { setGate('unavailable') }
    }
    init()
    return () => { cancelled = true }
  }, [])

  const verifyPassword = async (e) => {
    e.preventDefault()
    if (!pwdInput.trim()) return
    setPwdChecking(true); setPwdError(null)
    try {
      const { data: ok, error: rpcErr } = await supabase.rpc('verify_school_form_password', {
        p_cohort_id: cohortId, p_entered_password: pwdInput.trim(),
      })
      if (rpcErr) throw rpcErr
      if (ok) setGate('open')
      else { setPwdError('Incorrect password. Please check with the ASPIRE team.'); setPwdInput('') }
    } catch { setPwdError('Unable to verify at this time. Please try again.') }
    setPwdChecking(false)
  }

  const validation = useMemo(
    () => validatePlacementForm({ coordinator: coord, rotation, students: rows, cohortId }),
    [coord, rotation, rows, cohortId],
  )

  const backBtn = (
    <button type="button" className="ptl-btn-outline ptl-btn-sm ptl-plr-back" onClick={onBack}>
      ← Back to requests
    </button>
  )

  if (gate === 'loading') return <LoadingState label="Preparing the request form" />
  if (gate === 'unavailable') {
    return (
      <div className="ptl-page ptl-ap-page">
        {backBtn}
        <EmptyState
          title="Submissions are not open"
          detail="A cohort is not currently accepting placement requests. The ASPIRE team opens submissions when a cohort is ready."
        />
      </div>
    )
  }
  if (gate === 'password') {
    return (
      <div className="ptl-page ptl-ap-page">
        {backBtn}
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

  // gate === 'open': the shared-definition form. Submission is gated (disabled) this phase.
  return (
    <div className="ptl-page ptl-ap-page">
      {backBtn}
      <div className="ptl-card ptl-plr-form-card">
        <div className="ptl-plr-form-head">
          <h2 className="ptl-card-title">New Placement Request</h2>
          {cohortName && <span className="ptl-ap-cohort-badge">{cohortName}</span>}
        </div>

        <div className="ptl-plr-gated-banner" role="status">
          Online submission is being finalized with the ASPIRE team and is not enabled yet. You can
          prepare this request, but the submit button stays disabled until submissions are activated.
        </div>

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
            {/* Submission is intentionally disabled this phase (provenance gate). The button reflects
                client validation so the prepared request is clearly complete or not. */}
            <button type="button" className="ptl-btn" disabled
              title="Submissions are not enabled yet"
              onClick={() => setFormError(validation ? validation.message : null)}>
              {placementSubmitLabel(rows.length)}
            </button>
            <span className="ptl-muted ptl-small">Submission activation pending.</span>
          </div>
        </form>
      </div>
    </div>
  )
}
