import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const PAGE_TITLE = 'ASPIRE Program: Student Information Form'

const EXP_ROLES = [
  'CNA', 'Medical Assistant', 'EMT', 'Phlebotomist',
  'Unit Secretary', 'Patient Care Technician', 'Other',
]

const CS_AFFILIATIONS = [
  'Current Employee', 'Former Employee', 'Volunteer', 'No prior affiliation',
]

const CS_WITH_DEPT = ['Current Employee', 'Former Employee', 'Volunteer']

const initForm = () => ({
  first_name: '', last_name: '', personal_email: '', phone: '',
  date_of_birth: '', ssn_last4: '', gender: '',
  has_prior_experience: null,
  exp_roles: Object.fromEntries(EXP_ROLES.map(r => [r, false])),
  exp_other_desc: '',
  cs_affiliation: '', cs_department: '', cs_role: '',
  unit_preference_1: '', unit_preference_2: '', unit_preference_3: '',
  additional_notes: '',
})

export default function StudentIntakeFormPage() {
  const [cohortId,      setCohortId]      = useState(null)
  const [cohortName,    setCohortName]    = useState('')
  const [open,          setOpen]          = useState(null)
  const [form,          setForm]          = useState(initForm())
  const [availableUnits, setAvailableUnits] = useState([])
  const [unitsLoaded,   setUnitsLoaded]   = useState(false)
  const [submitting,    setSubmitting]    = useState(false)
  const [submitted,     setSubmitted]     = useState(false)
  const [error,         setError]         = useState(null)

  // Load accepting cohort
  useEffect(() => {
    document.title = PAGE_TITLE
    supabase.from('cohorts').select('id, name').eq('accepting_submissions', true)
      .limit(1).single()
      .then(({ data }) => {
        if (data) { setCohortId(data.id); setCohortName(data.name); setOpen(true) }
        else setOpen(false)
      })
  }, [])

  // Load participating units for the active cohort
  useEffect(() => {
    if (!cohortId) return
    supabase.from('units')
      .select('unit_name')
      .eq('is_participating', true)
      .eq('cohort_id', cohortId)
      .order('unit_name')
      .then(({ data }) => {
        setAvailableUnits((data || []).map(u => u.unit_name))
        setUnitsLoaded(true)
      })
  }, [cohortId])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const toggleRole = r => setForm(p => ({ ...p, exp_roles: { ...p.exp_roles, [r]: !p.exp_roles[r] } }))

  const handleSubmit = async e => {
    e.preventDefault()

    if (!form.first_name.trim() || !form.last_name.trim() || !form.personal_email.trim() || !form.phone.trim()) {
      setError('Please fill in all required personal information fields.'); return
    }
    if (!form.date_of_birth) {
      setError('Please enter your date of birth.'); return
    }
    if (!/^\d{4}$/.test(form.ssn_last4.trim())) {
      setError('SSN last 4 digits must be exactly 4 numbers.'); return
    }
    if (form.has_prior_experience === null) {
      setError('Please indicate whether you have prior healthcare experience.'); return
    }
    if (!form.cs_affiliation) {
      setError('Please select your Cedars-Sinai affiliation status.'); return
    }

    setSubmitting(true)
    setError(null)

    const selectedRoles = Object.entries(form.exp_roles)
      .filter(([, v]) => v)
      .map(([k]) => k === 'Other' && form.exp_other_desc.trim() ? `Other (${form.exp_other_desc.trim()})` : k)
    const prior_healthcare_experience = form.has_prior_experience === false
      ? 'No prior experience'
      : selectedRoles.length > 0 ? selectedRoles.join(', ') : 'Yes (no roles specified)'

    const { error: err } = await supabase.from('student_intake_submissions').insert({
      first_name:                 form.first_name.trim(),
      last_name:                  form.last_name.trim(),
      personal_email:             form.personal_email.trim(),
      phone:                      form.phone.trim(),
      date_of_birth:              form.date_of_birth,
      ssn_last4:                  form.ssn_last4.trim(),
      gender:                     form.gender,
      prior_healthcare_experience,
      cs_affiliation:             form.cs_affiliation,
      cs_department:              form.cs_department.trim(),
      cs_role:                    form.cs_role.trim(),
      unit_preference_1:          form.unit_preference_1,
      unit_preference_2:          form.unit_preference_2,
      unit_preference_3:          form.unit_preference_3,
      additional_notes:           form.additional_notes.trim(),
      review_status:              'Pending',
      cohort_id:                  cohortId,
    })

    if (err) {
      setError('Something went wrong. Please try again or contact the ASPIRE team.')
      setSubmitting(false)
      return
    }
    setSubmitted(true)
  }

  if (open === null) return (
    <div className="uf-page">
      <div className="uf-card" style={{ textAlign: 'center', padding: '60px 40px' }}>
        <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />
        <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>
      </div>
    </div>
  )

  if (open === false) return (
    <div className="uf-page">
      <div className="uf-card" style={{ textAlign: 'center', padding: '56px 40px' }}>
        <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />
        <h2 className="uf-title" style={{ marginBottom: 12 }}>{PAGE_TITLE}</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.6 }}>
          This form is not currently accepting submissions. Please contact the ASPIRE team.
        </p>
      </div>
    </div>
  )

  if (submitted) return (
    <div className="uf-page">
      <div className="uf-card uf-card-confirm">
        <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />
        <div className="uf-confirm-icon">✓</div>
        <h2 className="uf-confirm-title">Thank you, {form.first_name}.</h2>
        <p className="uf-confirm-msg">
          Your information has been received. The ASPIRE team will follow up with next steps.
        </p>
      </div>
    </div>
  )

  return (
    <div className="uf-page">
      <div className="uf-card sf-card">
        <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />

        <div className="uf-header">
          <h1 className="uf-title">{PAGE_TITLE}</h1>
          {cohortName && <div className="uf-cohort-badge">{cohortName}</div>}
          <p className="uf-subtitle">
            Please complete this form to provide information needed for your clinical rotation at
            Cedars-Sinai. This form is intended for your use only and should not be shared.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="uf-form">
          {error && <div className="error-msg" style={{ marginBottom: 8 }}>{error}</div>}

          {/* ── Section 1: Personal Information ── */}
          <div className="uf-section">
            <div className="sf-section-title">Section 1: Personal Information</div>

            <div className="sf-row-2">
              <div className="uf-field">
                <label className="uf-label">First Name *</label>
                <input className="uf-input" value={form.first_name}
                  onChange={e => set('first_name', e.target.value)} placeholder="First" />
              </div>
              <div className="uf-field">
                <label className="uf-label">Last Name *</label>
                <input className="uf-input" value={form.last_name}
                  onChange={e => set('last_name', e.target.value)} placeholder="Last" />
              </div>
            </div>

            <div className="sf-row-2">
              <div className="uf-field">
                <label className="uf-label">Personal Email *</label>
                <input className="uf-input" type="email" value={form.personal_email}
                  onChange={e => set('personal_email', e.target.value)} placeholder="you@email.com" />
              </div>
              <div className="uf-field">
                <label className="uf-label">Phone Number *</label>
                <input className="uf-input" type="tel" value={form.phone}
                  onChange={e => set('phone', e.target.value)} placeholder="(555) 000-0000" />
              </div>
            </div>

            <div className="uf-field">
              <label className="uf-label">Date of Birth *</label>
              <input className="uf-input" type="date" value={form.date_of_birth}
                onChange={e => set('date_of_birth', e.target.value)}
                style={{ maxWidth: 220 }} />
            </div>

            <div className="uf-field">
              <label className="uf-label">Last 4 Digits of SSN *</label>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, lineHeight: 1.45 }}>
                This information is used solely for system access creation and is handled securely.
              </p>
              <input className="uf-input uf-input-sm" type="text" inputMode="numeric"
                maxLength={4} placeholder="••••"
                value={form.ssn_last4}
                onChange={e => set('ssn_last4', e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </div>

            <div className="uf-field">
              <label className="uf-label">Gender</label>
              <select className="uf-input" value={form.gender} onChange={e => set('gender', e.target.value)}
                style={{ maxWidth: 280 }}>
                <option value="">Select…</option>
                <option>Male</option>
                <option>Female</option>
                <option>Non-binary</option>
                <option>Prefer not to say</option>
                <option>Other</option>
              </select>
            </div>
          </div>

          {/* ── Section 2: Background and Affiliation ── */}
          <div className="uf-section">
            <div className="sf-section-title">Section 2: Background and Affiliation</div>

            <div className="uf-field">
              <label className="uf-label">Do you have prior healthcare experience? *</label>
              <div className="uf-radio-group">
                <label className="uf-radio-label">
                  <input type="radio" name="has_exp"
                    checked={form.has_prior_experience === true}
                    onChange={() => set('has_prior_experience', true)} />
                  <span>Yes</span>
                </label>
                <label className="uf-radio-label">
                  <input type="radio" name="has_exp"
                    checked={form.has_prior_experience === false}
                    onChange={() => set('has_prior_experience', false)} />
                  <span>No</span>
                </label>
              </div>
            </div>

            {form.has_prior_experience === true && (
              <>
                <div className="uf-field">
                  <label className="uf-label">If yes, what role(s)?</label>
                  <div className="uf-checkbox-group">
                    {EXP_ROLES.map(r => (
                      <label key={r} className="uf-check-label">
                        <input type="checkbox" checked={form.exp_roles[r]}
                          onChange={() => toggleRole(r)} />
                        <span>{r}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {form.exp_roles['Other'] && (
                  <div className="uf-field">
                    <label className="uf-label">If Other, please describe</label>
                    <input className="uf-input" value={form.exp_other_desc}
                      onChange={e => set('exp_other_desc', e.target.value)}
                      placeholder="Describe your experience…" />
                  </div>
                )}
              </>
            )}

            <div className="uf-field">
              <label className="uf-label">Current or prior Cedars-Sinai affiliation *</label>
              <div className="uf-radio-group">
                {CS_AFFILIATIONS.map(a => (
                  <label key={a} className="uf-radio-label">
                    <input type="radio" name="cs_affiliation"
                      checked={form.cs_affiliation === a}
                      onChange={() => set('cs_affiliation', a)} />
                    <span>{a}</span>
                  </label>
                ))}
              </div>
            </div>

            {CS_WITH_DEPT.includes(form.cs_affiliation) && (
              <div className="sf-row-2">
                <div className="uf-field">
                  <label className="uf-label">Department (optional)</label>
                  <input className="uf-input" value={form.cs_department}
                    onChange={e => set('cs_department', e.target.value)}
                    placeholder="e.g. 6 NW, Labor and Delivery, Radiology" />
                </div>
                <div className="uf-field">
                  <label className="uf-label">Role or Job Title (optional)</label>
                  <input className="uf-input" value={form.cs_role}
                    onChange={e => set('cs_role', e.target.value)}
                    placeholder="e.g. RN, Patient Care Tech, Volunteer" />
                </div>
              </div>
            )}
          </div>

          {/* ── Section 3: Unit Placement Preferences ── */}
          <div className="uf-section">
            <div className="sf-section-title">Section 3: Unit Placement Preferences</div>

            {unitsLoaded && availableUnits.length > 0 && (
              <div className="uf-info-box">
                The units listed below have confirmed their availability to host ASPIRE students for
                this rotation cycle. Units not listed have not opted in for this cycle or are still
                being confirmed. This list is updated as unit responses are received.
              </div>
            )}

            {!unitsLoaded ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Loading unit options…</p>
            ) : availableUnits.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.65 }}>
                Unit availability is still being finalized. You may submit the form now and update
                your preferences later.
              </p>
            ) : (
              <>
                <div className="uf-field">
                  <label className="uf-label">First Preference (optional)</label>
                  <select className="uf-input" value={form.unit_preference_1}
                    onChange={e => {
                      const v = e.target.value
                      setForm(p => ({
                        ...p,
                        unit_preference_1: v,
                        unit_preference_2: p.unit_preference_2 === v ? '' : p.unit_preference_2,
                        unit_preference_3: p.unit_preference_3 === v ? '' : p.unit_preference_3,
                      }))
                    }}>
                    <option value="">No preference</option>
                    {availableUnits.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>

                <div className="uf-field">
                  <label className="uf-label">Second Preference (optional)</label>
                  <select className="uf-input" value={form.unit_preference_2}
                    onChange={e => {
                      const v = e.target.value
                      setForm(p => ({
                        ...p,
                        unit_preference_2: v,
                        unit_preference_3: p.unit_preference_3 === v ? '' : p.unit_preference_3,
                      }))
                    }}>
                    <option value="">No preference</option>
                    {availableUnits
                      .filter(u => u !== form.unit_preference_1)
                      .map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>

                <div className="uf-field">
                  <label className="uf-label">Third Preference (optional)</label>
                  <select className="uf-input" value={form.unit_preference_3}
                    onChange={e => set('unit_preference_3', e.target.value)}>
                    <option value="">No preference</option>
                    {availableUnits
                      .filter(u => u !== form.unit_preference_1 && u !== form.unit_preference_2)
                      .map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </>
            )}
          </div>

          {/* ── Section 4: Additional Notes ── */}
          <div className="uf-section">
            <div className="sf-section-title">Section 4: Additional Notes</div>
            <div className="uf-field">
              <label className="uf-label">Is there anything else you would like the ASPIRE team to know? (optional)</label>
              <textarea className="uf-textarea" rows={4} value={form.additional_notes}
                onChange={e => set('additional_notes', e.target.value)}
                placeholder="Any additional information, accommodations needed, or context you'd like to share…" />
            </div>
          </div>

          <div className="uf-submit-row">
            <button type="submit" className="uf-submit-btn" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit Form'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
