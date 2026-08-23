import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import CohortAccessCard from './CohortAccessCard'
import { toLocalDateStr } from '../lib/designTokens'
import { toggleWeekday, isValidIsoDate } from '../lib/availability'
import {
  PROGRAM_TYPES, SCHOOLS, WEEKDAYS,
  PLACEMENT_PAGE_TITLE, SCHOOL_PLACEMENT_TEXT,
  newStudentRow, validatePlacementForm, collectPlacementSoftWarnings,
  buildPlacementBody, placementSubmitLabel,
} from '../lib/schoolPlacementForm'

const PAGE_TITLE = PLACEMENT_PAGE_TITLE
const JESTER_EMAIL = 'JesterLloyd.Bautista@cshs.org'
const T = SCHOOL_PLACEMENT_TEXT

// Per-student row factory (canonical shared definition).
const newStudent = newStudentRow

// pageState: 'loading' | 'unavailable' | 'password' | 'verified'
export default function SchoolFormPage() {
  const [cohortId,   setCohortId]   = useState(null)
  const [cohortName, setCohortName] = useState('')
  const [pageState,  setPageState]  = useState('loading')

  // Password gate
  const [pwdInput,    setPwdInput]    = useState('')
  const [pwdError,    setPwdError]    = useState(null)
  const [pwdChecking, setPwdChecking] = useState(false)

  // Coordinator info
  const [coord, setCoord] = useState({ school: '', name: '', email: '', notes: '' })

  // Rotation dates (new submission-level fields)
  const [rotation, setRotation] = useState({ start_date: '', end_date: '' })
  const [rotError,  setRotError]  = useState(null) // hard validation message inline on the fields

  // AVAILABILITY-CANON-1B: coordinator-owned, school-wide availability constraints.
  const [avail, setAvail] = useState({
    unavailable_weekdays: [],
    min_days_per_week: '',
    weekends_allowed: null,
    nights_allowed: null,
    blackout_dates: [],
    scheduling_notes: '',
  })
  const [blackoutInput, setBlackoutInput] = useState('')
  const setA = (k, v) => setAvail(p => ({ ...p, [k]: v }))

  // Student rows
  const [rows, setRows] = useState([newStudent()])

  const [submitting,  setSubmitting]  = useState(false)
  const [result,      setResult]      = useState(null)
  const [error,       setError]       = useState(null)

  // Soft-warning confirmation modal state
  // { lines: string[], onConfirm: () => void }
  const [warnModal, setWarnModal] = useState(null)

  useEffect(() => {
    document.title = 'ASPIRE Intelligence'
    const init = async () => {
      const { data } = await supabase
        .from('cohorts').select('id, name')
        .eq('accepting_submissions', true)
        .limit(1).single()

      if (!data) { setPageState('unavailable'); return }

      setCohortId(data.id)
      setCohortName(data.name)

      try {
        const { data: requiresPwd } = await supabase
          .rpc('school_form_requires_password', { p_cohort_id: data.id })
        setPageState(requiresPwd ? 'password' : 'unavailable')
      } catch {
        setPageState('unavailable')
      }
    }
    init()
  }, [])

  const setC    = (k, v) => setCoord(p => ({ ...p, [k]: v }))
  const updRow  = (key, field, val) => setRows(prev => prev.map(r => r._key === key ? { ...r, [field]: val } : r))
  const addRow  = () => setRows(prev => [...prev, newStudent()])
  const removeRow = key => setRows(prev => prev.filter(r => r._key !== key))

  // Core submit logic (called after all validations pass)
  const doSubmit = async () => {
    setSubmitting(true)
    setError(null)
    setWarnModal(null)
    try {
      const res = await fetch('/api/school-form-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // S-08: the password is now verified SERVER-side before anything is written.
        // The coordinator already typed it to reach this form, so this simply sends
        // what the page is holding; nothing new is asked of them. An empty string is
        // correct and harmless for a cohort that has no password set.
        body: JSON.stringify({
          ...buildPlacementBody({
            cohortId, cohortName, coordinator: coord, rotation, availability: avail, students: rows,
          }),
          password: pwdInput.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        setSubmitting(false)
        return
      }
      setResult({ added: data.added || [], updated: data.updated || [], skipped: data.skipped || [] })
    } catch {
      setError('Network error. Please check your connection and try again.')
    }
    setSubmitting(false)
  }

  const handleSubmit = async e => {
    e.preventDefault()
    setError(null)
    setRotError(null)

    // Hard validation (canonical, shared with the authenticated portal surface). Rotation errors
    // render inline on the date fields; every other scope shows at the top of the form.
    const invalid = validatePlacementForm({ coordinator: coord, rotation, students: rows, cohortId })
    if (invalid) {
      if (invalid.scope === 'rotation') setRotError(invalid.message)
      else setError(invalid.message)
      return
    }

    // Soft warnings (collect all, then show as one confirmation).
    const softWarnings = collectPlacementSoftWarnings({ rotation, students: rows }, toLocalDateStr())
    if (softWarnings.length > 0) {
      setWarnModal({ lines: softWarnings, onConfirm: doSubmit })
      return
    }

    doSubmit()
  }

  // ── State: Loading ─────────────────────────────────────────────────────────
  if (pageState === 'loading') return (
    <div className="uf-page">
      <div className="uf-card" style={{ textAlign: 'center', padding: '60px 40px' }}>
        <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />
        <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>
      </div>
    </div>
  )

  // ── State: Unavailable ─────────────────────────────────────────────────────
  if (pageState === 'unavailable') return (
    <div className="uf-page">
      <div className="uf-card" style={{ textAlign: 'center', padding: '56px 40px' }}>
        <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />
        <h2 style={{ fontFamily: 'DM Sans, sans-serif', fontWeight: 700, fontSize: 24,
          color: 'var(--nightfall)', marginBottom: 16 }}>Form Unavailable</h2>
        <p style={{ fontFamily: 'DM Sans, sans-serif', fontWeight: 400, fontSize: 15,
          color: '#6b7280', lineHeight: 1.6, marginBottom: 8 }}>
          The ASPIRE school submission form is not currently accepting registrations.
        </p>
        <p style={{ fontFamily: 'DM Sans, sans-serif', fontWeight: 400, fontSize: 15,
          color: '#6b7280', lineHeight: 1.6 }}>
          If you believe this is an error, please contact the ASPIRE team at{' '}
          <a href={`mailto:${JESTER_EMAIL}`} target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--nightfall)', textDecoration: 'underline' }}>{JESTER_EMAIL}</a>.
        </p>
      </div>
    </div>
  )

  // ── State: Password ────────────────────────────────────────────────────────
  // The centered access card is the shared CohortAccessCard (converged with the authenticated Academic
  // Partner gate). The full-screen .uf-page shell + Cedars-Sinai logo stay here, on the public page
  // only; the verify RPC and page-state transition are unchanged.
  if (pageState === 'password') return (
    <div className="uf-page">
      <CohortAccessCard
        logo={<img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />}
        title="School Coordinator Access"
        intro="Please enter the cohort password provided by the ASPIRE team."
        value={pwdInput}
        onChange={e => { setPwdInput(e.target.value); setPwdError(null) }}
        error={pwdError}
        busy={pwdChecking}
        submitLabel="Access Form"
        onSubmit={async e => {
          e.preventDefault()
          if (!pwdInput.trim()) return
          setPwdChecking(true)
          setPwdError(null)
          try {
            const { data: ok, error: rpcErr } = await supabase
              .rpc('verify_school_form_password', {
                p_cohort_id: cohortId,
                p_entered_password: pwdInput.trim(),
              })
            if (rpcErr) throw rpcErr
            if (ok) { setPageState('verified') }
            else { setPwdError('Incorrect password. Please check with the ASPIRE team.'); setPwdInput('') }
          } catch {
            setPwdError('Unable to verify at this time. Please try again.')
          }
          setPwdChecking(false)
        }}
      />
    </div>
  )

  // ── Confirmation ───────────────────────────────────────────────────────────
  if (result) return (
    <div className="uf-page">
      <div className="uf-card uf-card-confirm">
        <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />
        <div className="uf-confirm-icon">&#10003;</div>
        <h2 className="uf-confirm-title">Thank you, {coord.school}.</h2>
        {result.added.length > 0 && (
          <p className="uf-confirm-msg">
            <strong>{result.added.length} student{result.added.length !== 1 ? 's' : ''} added</strong>
            {' '}to ASPIRE for {cohortName}.
          </p>
        )}
        {result.updated?.length > 0 && (
          <p className="uf-confirm-msg" style={{ marginTop: 12, color: 'var(--text-secondary)', fontSize: 14 }}>
            <strong>{result.updated.length} existing student{result.updated.length !== 1 ? 's' : ''} updated</strong>{' '}
            with the latest placement details.
          </p>
        )}
        {result.skipped.length > 0 && (
          <p className="uf-confirm-msg" style={{ marginTop: 12, color: 'var(--text-secondary)', fontSize: 14 }}>
            <strong>{result.skipped.length} skipped</strong> (incomplete rows):{' '}
            {result.skipped.join(', ')}
          </p>
        )}
        {result.added.length === 0 && (result.updated?.length || 0) === 0 && result.skipped.length > 0 && (
          <p className="uf-confirm-msg" style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
            No students could be added or updated. Please contact the ASPIRE team if changes are needed.
          </p>
        )}
      </div>
    </div>
  )

  // ── Main Form ──────────────────────────────────────────────────────────────
  return (
    <div className="uf-page">
      {/* Soft-warning confirmation modal */}
      {warnModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div style={{
            background: '#fff', borderRadius: 14, maxWidth: 460, width: '100%',
            padding: '28px 28px 22px', fontFamily: 'DM Sans, sans-serif',
            boxShadow: '0 20px 50px rgba(0,0,0,0.18)',
          }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#1D2567', marginBottom: 14 }}>
              Please review before submitting
            </div>
            <ul style={{ margin: '0 0 20px', paddingLeft: 18, fontSize: 14, color: '#374151', lineHeight: 1.7 }}>
              {warnModal.lines.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setWarnModal(null)}
                style={{ flex: 1, height: 42, borderRadius: 9, border: '1px solid #e5e7eb',
                  background: '#f9fafb', fontFamily: 'DM Sans', fontWeight: 600, fontSize: 14,
                  cursor: 'pointer', color: '#374151' }}>
                Go back
              </button>
              <button
                onClick={() => warnModal.onConfirm()}
                style={{ flex: 1, height: 42, borderRadius: 9, border: 'none',
                  background: '#1D2567', fontFamily: 'DM Sans', fontWeight: 700, fontSize: 14,
                  cursor: 'pointer', color: '#fff' }}>
                Submit anyway
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="uf-card sf-card">
        <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />

        <div className="uf-header">
          <h1 className="uf-title">{PAGE_TITLE}</h1>
          {cohortName && <div className="uf-cohort-badge">{cohortName}</div>}
        </div>

        <form onSubmit={handleSubmit} className="uf-form">
          {error && <div className="error-msg" style={{ marginBottom: 8 }}>{error}</div>}

          {/* Section 1: School Information */}
          <div className="uf-section">
            <div className="sf-section-title">{T.schoolSectionTitle}</div>
            <div className="uf-field">
              <label className="uf-label">{T.schoolLabel}</label>
              <select className="uf-input" value={coord.school} onChange={e => setC('school', e.target.value)}>
                <option value="">{T.schoolPlaceholder}</option>
                {SCHOOLS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="sf-row-2">
              <div className="uf-field">
                <label className="uf-label">{T.coordinatorNameLabel}</label>
                <input className="uf-input" value={coord.name}
                  onChange={e => setC('name', e.target.value)} placeholder={T.coordinatorNamePlaceholder} />
              </div>
              <div className="uf-field">
                <label className="uf-label">{T.coordinatorEmailLabel}</label>
                <input className="uf-input" type="email" value={coord.email}
                  onChange={e => setC('email', e.target.value)} placeholder={T.coordinatorEmailPlaceholder} />
              </div>
            </div>
          </div>

          {/* Section 2: Rotation Dates (new) */}
          <div className="uf-section">
            <div className="sf-section-title">{T.rotationSectionTitle}</div>
            <p style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#6b7280',
              lineHeight: 1.6, margin: '0 0 16px' }}>
              {T.rotationIntro}
            </p>
            {rotError && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
                padding: '10px 14px', marginBottom: 12,
                fontFamily: 'DM Sans', fontSize: 13, color: '#991b1b' }}>
                {rotError}
              </div>
            )}
            <div className="sf-row-2">
              <div className="uf-field">
                <label className="uf-label">{T.rotationStartLabel}</label>
                <input className="uf-input" type="date"
                  value={rotation.start_date}
                  onChange={e => { setRotation(p => ({ ...p, start_date: e.target.value })); setRotError(null) }}
                  style={{ colorScheme: 'light' }} />
              </div>
              <div className="uf-field">
                <label className="uf-label">{T.rotationEndLabel}</label>
                <input className="uf-input" type="date"
                  value={rotation.end_date}
                  onChange={e => { setRotation(p => ({ ...p, end_date: e.target.value })); setRotError(null) }}
                  style={{ colorScheme: 'light' }} />
              </div>
            </div>
          </div>

          {/* Section 2b: Rotation Availability (AVAILABILITY-CANON-1B) */}
          <div className="uf-section">
            <div className="sf-section-title">{T.availabilitySectionTitle}</div>
            <p style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#6b7280',
              lineHeight: 1.6, margin: '0 0 16px' }}>
              {T.availabilityIntro}
            </p>

            <div className="uf-field">
              <label className="uf-label">
                {T.unavailableWeekdaysLabel}
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {WEEKDAYS.map(day => {
                  const on = avail.unavailable_weekdays.includes(day)
                  return (
                    <button type="button" key={day}
                      onClick={() => setA('unavailable_weekdays', toggleWeekday(avail.unavailable_weekdays, day))}
                      style={{ padding: '6px 12px', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 13,
                        fontWeight: 600, cursor: 'pointer',
                        background: on ? '#1D2567' : '#fff', color: on ? '#fff' : '#374151',
                        border: `1px solid ${on ? '#1D2567' : '#d1d5db'}` }}>
                      {day}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="sf-row-3">
              <div className="uf-field">
                <label className="uf-label">{T.minDaysLabel}</label>
                <input className="uf-input" type="number" min="1" max="7"
                  value={avail.min_days_per_week}
                  onChange={e => setA('min_days_per_week', e.target.value)} placeholder={T.minDaysPlaceholder} />
              </div>
              <div className="uf-field">
                <label className="uf-label">{T.weekendsAllowedLabel}</label>
                <select className="uf-input"
                  value={avail.weekends_allowed === null ? '' : (avail.weekends_allowed ? 'yes' : 'no')}
                  onChange={e => setA('weekends_allowed', e.target.value === '' ? null : e.target.value === 'yes')}>
                  <option value="">{T.triStatePlaceholder}</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div className="uf-field">
                <label className="uf-label">{T.nightsAllowedLabel}</label>
                <select className="uf-input"
                  value={avail.nights_allowed === null ? '' : (avail.nights_allowed ? 'yes' : 'no')}
                  onChange={e => setA('nights_allowed', e.target.value === '' ? null : e.target.value === 'yes')}>
                  <option value="">{T.triStatePlaceholder}</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
            </div>

            <div className="uf-field">
              <label className="uf-label">{T.blackoutLabel}</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input className="uf-input" type="date" value={blackoutInput}
                  onChange={e => setBlackoutInput(e.target.value)} style={{ colorScheme: 'light', maxWidth: 200 }} />
                <button type="button" className="sf-add-btn" style={{ marginTop: 0 }}
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
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {avail.blackout_dates.map(d => (
                    <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px',
                      borderRadius: 16, background: '#f1f5f9', color: '#374151', fontSize: 12, fontFamily: 'DM Sans' }}>
                      {d}
                      <button type="button" onClick={() => setA('blackout_dates', avail.blackout_dates.filter(x => x !== d))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontWeight: 700, padding: 0 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="uf-field">
              <label className="uf-label">{T.schedulingNotesLabel}</label>
              <textarea className="uf-textarea" rows={2} value={avail.scheduling_notes}
                onChange={e => setA('scheduling_notes', e.target.value)}
                placeholder={T.schedulingNotesPlaceholder} />
            </div>
          </div>

          {/* Section 3: Students */}
          <div className="uf-section">
            <div className="sf-section-title">{T.studentsSectionTitle}</div>

            {rows.map((row, idx) => (
              <div key={row._key} className="sf-student-block">
                <div className="sf-student-header">
                  <span className="sf-student-num">{T.studentLabelPrefix} {idx + 1}</span>
                  {rows.length > 1 && (
                    <button type="button" className="sf-remove-btn" onClick={() => removeRow(row._key)}>
                      {T.removeLabel}
                    </button>
                  )}
                </div>

                <div className="sf-row-2">
                  <div className="uf-field">
                    <label className="uf-label">{T.firstNameLabel}</label>
                    <input className="uf-input" value={row.first_name}
                      onChange={e => updRow(row._key, 'first_name', e.target.value)} placeholder={T.firstNamePlaceholder} />
                  </div>
                  <div className="uf-field">
                    <label className="uf-label">{T.lastNameLabel}</label>
                    <input className="uf-input" value={row.last_name}
                      onChange={e => updRow(row._key, 'last_name', e.target.value)} placeholder={T.lastNamePlaceholder} />
                  </div>
                </div>

                <div className="sf-row-2">
                  <div className="uf-field">
                    <label className="uf-label">{T.schoolEmailLabel}</label>
                    <input className="uf-input" type="email" value={row.email}
                      onChange={e => updRow(row._key, 'email', e.target.value)}
                      placeholder={T.schoolEmailPlaceholder} />
                  </div>
                  <div className="uf-field">
                    <label className="uf-label">{T.phoneLabel}</label>
                    <input className="uf-input" value={row.phone}
                      onChange={e => updRow(row._key, 'phone', e.target.value)} placeholder={T.phonePlaceholder} />
                  </div>
                </div>

                <div className="sf-row-3">
                  <div className="uf-field">
                    <label className="uf-label">{T.programTypeLabel}</label>
                    <select className="uf-input" value={row.program_type}
                      onChange={e => updRow(row._key, 'program_type', e.target.value)}>
                      <option value="">{T.programTypePlaceholder}</option>
                      {PROGRAM_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="uf-field">
                    <label className="uf-label">{T.hoursRequiredLabel}</label>
                    <input className="uf-input" type="text" inputMode="numeric" pattern="[0-9]*"
                      value={row.hours_required}
                      onChange={e => updRow(row._key, 'hours_required', e.target.value)}
                      placeholder={T.hoursRequiredPlaceholder} />
                  </div>
                  <div className="uf-field">
                    <label className="uf-label">{T.estimatedGraduationLabel}</label>
                    <input className="uf-input" type="date"
                      value={row.estimated_graduation_date}
                      onChange={e => updRow(row._key, 'estimated_graduation_date', e.target.value)}
                      style={{ colorScheme: 'light' }} />
                  </div>
                </div>
              </div>
            ))}

            <button type="button" className="sf-add-btn" onClick={addRow}>
              {T.addStudentLabel}
            </button>
          </div>

          {/* Section 4: Additional Notes */}
          <div className="uf-section">
            <div className="uf-field">
              <label className="uf-label">{T.additionalNotesLabel}</label>
              <textarea className="uf-textarea" rows={3} value={coord.notes}
                onChange={e => setC('notes', e.target.value)}
                placeholder={T.additionalNotesPlaceholder} />
            </div>
          </div>

          <div className="uf-submit-row">
            <button type="submit" className="uf-submit-btn" disabled={submitting}>
              {submitting ? 'Submitting...' : placementSubmitLabel(rows.length)}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
