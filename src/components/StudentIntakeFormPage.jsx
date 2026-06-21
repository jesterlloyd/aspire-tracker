import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { groupUnitNamesByDivision, getUnit, DIVISION_ORDER } from '../lib/unitCatalog'
import { WEEKDAYS, toggleWeekday, isValidIsoDate } from '../lib/availability'
// WS1e-A0: public intake submission now goes through the dedicated
// /api/student-intake-submit endpoint (was: proxyUpdateStudent + setAspireStatus
// + logEvent against the staff student-update path).

const PAGE_TITLE = 'ASPIRE Program: Student Information Form'

// Unit preference dropdown grouped by division with descriptive option labels.
// Stored value is always the canonical name (e.g., '5 SCCT'); description is display-only.
function UnitPreferenceSelect({ label, value, onChange, availableUnits, excludeValues, placeholder, optional }) {
  const filtered = availableUnits.filter(u => !excludeValues.includes(u))
  const grouped  = groupUnitNamesByDivision(filtered)
  const ordered  = DIVISION_ORDER.filter(d => grouped[d])
  if (grouped['Other']) ordered.push('Other')

  const selectedUnit = getUnit(value)

  return (
    <div className="uf-field">
      <label className="uf-label">{label}</label>
      <select className="uf-input" value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {ordered.map(division => (
          <optgroup key={division} label={division}>
            {grouped[division].map(unitName => {
              const entry = getUnit(unitName)
              return (
                <option key={unitName} value={unitName}>
                  {entry ? `${unitName} — ${entry.description}` : unitName}
                </option>
              )
            })}
          </optgroup>
        ))}
      </select>
      {value && selectedUnit && (
        <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{selectedUnit.description}</p>
      )}
    </div>
  )
}

const EXP_ROLES = [
  'CNA', 'Medical Assistant', 'EMT', 'Phlebotomist',
  'Unit Secretary', 'Patient Care Technician', 'Other',
]
const CS_AFFILIATIONS = ['Current Employee', 'Former Employee', 'Volunteer', 'No prior affiliation']
const CS_WITH_DEPT    = ['Current Employee', 'Former Employee', 'Volunteer']

const initForm = () => ({
  school_email: '',
  first_name: '', last_name: '', personal_email: '', phone: '',
  date_of_birth: '', ssn_last4: '', gender: '',
  cumulative_gpa: '', shift_availability: '',
  has_prior_experience: null,
  exp_roles: Object.fromEntries(EXP_ROLES.map(r => [r, false])),
  exp_other_desc: '',
  cs_affiliation: '', cs_department: '', cs_role: '',
  unit_preference_1: '', unit_preference_2: '', unit_preference_3: '',
  interest_statement: '',
  // AVAILABILITY-CANON-1B: student-owned rotation availability
  unavailable_weekdays: [],
  unavailable_weekdays_reason: '',
  personal_blackout_dates: [],
  weekends_available: null,
  nights_available: null,
  preferred_days: [],
  availability_notes: '',
  availability_ack: false,
})

const AVAILABILITY_ACK_TEXT =
  'I understand that ASPIRE will consider my availability when matching me to a unit and preceptor, ' +
  'but placement depends on unit capacity, preceptor availability, and clinical learning goals. ' +
  'I understand that failure to disclose recurring availability conflicts may delay matching or require coordinator review.'

export default function StudentIntakeFormPage() {
  const [cohortId,       setCohortId]       = useState(null)
  const [cohortName,     setCohortName]     = useState('')
  const [open,           setOpen]           = useState(null)
  const [form,           setForm]           = useState(initForm())
  const [availableUnits, setAvailableUnits] = useState([])  // canonical unit names from DB
  const [unitsLoaded,    setUnitsLoaded]    = useState(false)
  const [resumeFile,     setResumeFile]     = useState(null)
  const [headshotFile,   setHeadshotFile]   = useState(null)
  const resumeInputRef   = useRef(null)
  const headshotInputRef = useRef(null)
  const [submitting,     setSubmitting]     = useState(false)
  const [submitted,      setSubmitted]      = useState(false)
  const [error,          setError]          = useState(null)
  const [blackoutInput,  setBlackoutInput]  = useState('')  // AVAILABILITY-CANON-1B: pending blackout date

  useEffect(() => {
    document.title = 'ASPIRE Intelligence'
    supabase.from('cohorts').select('id, name').eq('accepting_submissions', true)
      .limit(1).single()
      .then(({ data }) => {
        if (data) { setCohortId(data.id); setCohortName(data.name); setOpen(true) }
        else setOpen(false)
      })
  }, [])

  useEffect(() => {
    if (!cohortId) return
    supabase.from('units').select('unit_name')
      .eq('is_participating', true).eq('cohort_id', cohortId).order('unit_name')
      .then(({ data }) => {
        setAvailableUnits((data || []).map(u => u.unit_name))
        setUnitsLoaded(true)
      })
  }, [cohortId])

  const set        = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const toggleRole = r => setForm(p => ({ ...p, exp_roles: { ...p.exp_roles, [r]: !p.exp_roles[r] } }))

  const handleSubmit = async e => {
    e.preventDefault()

    if (!form.school_email.trim()) {
      setError('Please enter your school email address.'); return
    }
    if (!form.first_name.trim() || !form.last_name.trim() || !form.personal_email.trim() || !form.phone.trim()) {
      setError('Please fill in all required personal information fields.'); return
    }
    if (!form.date_of_birth) { setError('Please enter your date of birth.'); return }
    if (!/^\d{4}$/.test(form.ssn_last4.trim())) {
      setError('SSN last 4 digits must be exactly 4 numbers.'); return
    }
    if (form.has_prior_experience === null) {
      setError('Please indicate whether you have prior healthcare experience.'); return
    }
    if (!form.cs_affiliation) {
      setError('Please select your Cedars-Sinai affiliation status.'); return
    }
    if (CS_WITH_DEPT.includes(form.cs_affiliation)) {
      if (!form.cs_department.trim()) {
        setError('Please enter your department.'); return
      }
      if (!form.cs_role.trim()) {
        setError('Please enter your role or job title.'); return
      }
    }
    if (!form.unit_preference_1) {
      setError('Please select at least your first unit preference.'); return
    }
    if (!form.cumulative_gpa || isNaN(parseFloat(form.cumulative_gpa))) {
      setError('Please enter your cumulative GPA.'); return
    }
    if (!form.shift_availability) {
      setError('Please select your shift preference.'); return
    }
    if (!form.interest_statement.trim() || form.interest_statement.trim().length < 50) {
      setError('Please share why you are interested in Cedars-Sinai (at least 50 characters).'); return
    }
    if (!form.availability_ack) {
      setError('Please acknowledge the availability statement before submitting.'); return
    }

    setSubmitting(true)
    setError(null)

    // Step 1: Get the accepting cohort fresh at submit time
    const { data: acceptingCohort } = await supabase
      .from('cohorts')
      .select('id')
      .eq('accepting_submissions', true)
      .maybeSingle()

    if (!acceptingCohort) {
      setError('This form is not currently accepting submissions. Please contact the ASPIRE team.')
      setSubmitting(false)
      return
    }

    // Step 2: Look up student by school_email (case-insensitive, trimmed)
    const cleanEmail = form.school_email.trim().toLowerCase()

    const { data: studentBySchool } = await supabase
      .from('students')
      .select('*')
      .eq('cohort_id', acceptingCohort.id)
      .ilike('school_email', cleanEmail)
      .maybeSingle()

    // Step 3: If not found by school_email, try personal_email as fallback
    let foundStudent = studentBySchool
    if (!foundStudent) {
      const { data: studentByPersonal } = await supabase
        .from('students')
        .select('*')
        .eq('cohort_id', acceptingCohort.id)
        .ilike('personal_email', cleanEmail)
        .maybeSingle()
      foundStudent = studentByPersonal
    }

    // Step 4: If still not found, show the error message
    if (!foundStudent) {
      setError('We could not find your information in our system for the current cycle. Please contact the ASPIRE team to confirm your school email on file.')
      setSubmitting(false)
      return
    }

    // Step 5: Proceed with updating the found student record
    const studentId     = foundStudent.id
    const activeCohortId = acceptingCohort.id

    // Upload files if provided
    let resume_url = ''
    let headshot_url = ''

    if (resumeFile) {
      const ext = resumeFile.name.split('.').pop()
      const path = `${activeCohortId}/${studentId}/resume.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('student-files').upload(path, resumeFile, { upsert: true, contentType: resumeFile.type })
      if (!uploadErr) {
        const { data: urlData } = supabase.storage.from('student-files').getPublicUrl(path)
        resume_url = urlData.publicUrl
      }
    }
    if (headshotFile) {
      const ext = headshotFile.name.split('.').pop()
      const path = `${activeCohortId}/${studentId}/headshot.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('student-files').upload(path, headshotFile, { upsert: true, contentType: headshotFile.type })
      if (!uploadErr) {
        const { data: urlData } = supabase.storage.from('student-files').getPublicUrl(path)
        headshot_url = urlData.publicUrl
      }
    }

    const selectedRoles = Object.entries(form.exp_roles)
      .filter(([, v]) => v)
      .map(([k]) => k === 'Other' && form.exp_other_desc.trim() ? `Other (${form.exp_other_desc.trim()})` : k)
    const prior_healthcare_experience = form.has_prior_experience === false
      ? 'No prior experience'
      : selectedRoles.length > 0 ? selectedRoles.join(', ') : 'Yes (no roles specified)'

    // WS1e-A0: submit via the dedicated public intake endpoint. The student is
    // re-resolved server-side by school_email within the accepting cohort; the
    // server sets submitted_via, status='Form Received', and logs the event.
    // (studentId/activeCohortId above are used only for the file-upload paths.)
    const payload = {
      school_email:               cleanEmail,
      first_name:                 form.first_name.trim(),
      last_name:                  form.last_name.trim(),
      personal_email:             form.personal_email.trim(),
      phone:                      form.phone.trim(),
      date_of_birth:              form.date_of_birth,
      ssn_last4:                  form.ssn_last4.trim(),
      gender:                     form.gender,
      cs_affiliation:             form.cs_affiliation,
      cs_department:              form.cs_department.trim(),
      cs_role:                    form.cs_role.trim(),
      prior_healthcare_experience,
      unit_preference_1:          form.unit_preference_1,
      unit_preference_2:          form.unit_preference_2,
      unit_preference_3:          form.unit_preference_3,
      cumulative_gpa:             form.cumulative_gpa,
      shift_availability:         form.shift_availability,
      interest_statement:         form.interest_statement.trim(),
      // AVAILABILITY-CANON-1B: student-owned availability
      unavailable_weekdays:        form.unavailable_weekdays,
      unavailable_weekdays_reason: form.unavailable_weekdays_reason.trim(),
      personal_blackout_dates:     form.personal_blackout_dates,
      weekends_available:          form.weekends_available,
      nights_available:            form.nights_available,
      preferred_days:              form.preferred_days,
      availability_notes:          form.availability_notes.trim(),
      availability_ack:            form.availability_ack,
      ...(resume_url   && { resume_url }),
      ...(headshot_url && { headshot_url }),
    }

    try {
      const res = await fetch('/api/student-intake-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.message || 'Something went wrong. Please try again or contact the ASPIRE team.')
        setSubmitting(false)
        return
      }
    } catch (submitErr) {
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

            <div className="uf-field">
              <label className="uf-label">School or University Email Address *</label>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Enter the email address your school coordinator used to register you with the ASPIRE Program.
              </p>
              <input className="uf-input" type="email" value={form.school_email}
                onChange={e => set('school_email', e.target.value)}
                placeholder="yourname@school.edu" />
            </div>

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
                onChange={e => set('date_of_birth', e.target.value)} />
            </div>

            <div className="uf-field">
              <label className="uf-label">Last 4 Digits of SSN *</label>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, lineHeight: 1.45 }}>
                This information is used solely for system access creation and is handled securely.
              </p>
              <input className="uf-input uf-input-sm" type="text" inputMode="numeric"
                maxLength={4} placeholder="••••" value={form.ssn_last4}
                onChange={e => set('ssn_last4', e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </div>

            <div className="uf-field">
              <label className="uf-label">Gender</label>
              <select className="uf-input" value={form.gender} onChange={e => set('gender', e.target.value)}
  >
                <option value="">Select…</option>
                <option>Male</option><option>Female</option>
                <option>Non-binary</option><option>Prefer not to say</option><option>Other</option>
              </select>
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              <div className="uf-field">
                <label className="uf-label">Cumulative GPA (on a 4.0 scale) *</label>
                <input className="uf-input" type="text" inputMode="decimal" pattern="[0-9.]*"
                  value={form.cumulative_gpa}
                  onChange={e => set('cumulative_gpa', e.target.value)}
                  placeholder="e.g. 3.75" />
              </div>
              <div className="uf-field">
                <label className="uf-label">Shift Preference *</label>
                <select className="uf-input" value={form.shift_availability}
                  onChange={e => set('shift_availability', e.target.value)}
                >
                  <option value="">Select…</option>
                  <option value="Day Shift Preferred">Day Shift Preferred</option>
                  <option value="Night Shift Preferred">Night Shift Preferred</option>
                  <option value="No Preference">No Preference</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── Section 2: Background and Affiliation ── */}
          <div className="uf-section">
            <div className="sf-section-title">Section 2: Background and Affiliation</div>

            <div className="uf-field">
              <label className="uf-label">Do you have prior healthcare experience? *</label>
              <div className="uf-radio-group">
                <label className="uf-radio-label">
                  <input type="radio" name="has_exp" checked={form.has_prior_experience === true}
                    onChange={() => set('has_prior_experience', true)} /><span>Yes</span>
                </label>
                <label className="uf-radio-label">
                  <input type="radio" name="has_exp" checked={form.has_prior_experience === false}
                    onChange={() => set('has_prior_experience', false)} /><span>No</span>
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
                        <input type="checkbox" checked={form.exp_roles[r]} onChange={() => toggleRole(r)} />
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
                    <input type="radio" name="cs_affiliation" checked={form.cs_affiliation === a}
                      onChange={() => set('cs_affiliation', a)} /><span>{a}</span>
                  </label>
                ))}
              </div>
            </div>

            {CS_WITH_DEPT.includes(form.cs_affiliation) && (
              <div className="sf-row-2">
                <div className="uf-field">
                  <label className="uf-label">Department *</label>
                  <input className="uf-input" value={form.cs_department}
                    onChange={e => set('cs_department', e.target.value)}
                    placeholder="e.g. 6 NW, Labor and Delivery, Radiology" />
                </div>
                <div className="uf-field">
                  <label className="uf-label">Role or Job Title *</label>
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
                <UnitPreferenceSelect
                  label="First Preference *"
                  value={form.unit_preference_1}
                  onChange={v => setForm(p => ({
                    ...p, unit_preference_1: v,
                    unit_preference_2: p.unit_preference_2 === v ? '' : p.unit_preference_2,
                    unit_preference_3: p.unit_preference_3 === v ? '' : p.unit_preference_3,
                  }))}
                  availableUnits={availableUnits}
                  excludeValues={[]}
                  placeholder="Select a unit…"
                />
                <UnitPreferenceSelect
                  label="Second Preference (optional)"
                  value={form.unit_preference_2}
                  onChange={v => setForm(p => ({
                    ...p, unit_preference_2: v,
                    unit_preference_3: p.unit_preference_3 === v ? '' : p.unit_preference_3,
                  }))}
                  availableUnits={availableUnits}
                  excludeValues={[form.unit_preference_1].filter(Boolean)}
                  placeholder="No preference"
                  optional
                />
                <UnitPreferenceSelect
                  label="Third Preference (optional)"
                  value={form.unit_preference_3}
                  onChange={v => set('unit_preference_3', v)}
                  availableUnits={availableUnits}
                  excludeValues={[form.unit_preference_1, form.unit_preference_2].filter(Boolean)}
                  placeholder="No preference"
                  optional
                />
              </>
            )}
          </div>

          {/* ── Section 4: Documents ── */}
          <div className="uf-section">
            <div className="sf-section-title">Section 4: Documents (Optional)</div>
            <div className="doc-section">

              {/* Resume */}
              <div className="doc-upload-area">
                <div className="doc-area-label">Resume</div>
                <input ref={resumeInputRef} type="file" style={{ display: 'none' }}
                  accept=".pdf,.doc,.docx"
                  onChange={e => {
                    const f = e.target.files[0]
                    if (f && f.size > 10 * 1024 * 1024) { setError('Resume must be under 10MB.'); return }
                    setResumeFile(f || null)
                  }} />
                {resumeFile ? (
                  <div className="doc-existing-file">
                    <span className="doc-file-link">📄 {resumeFile.name}</span>
                    <button type="button" className="doc-replace-btn"
                      onClick={() => { setResumeFile(null); if (resumeInputRef.current) resumeInputRef.current.value = '' }}>
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="doc-upload-zone" onClick={() => resumeInputRef.current?.click()}>
                    <span className="doc-zone-icon">📄</span>
                    <span className="doc-zone-text">Upload Resume (PDF or Word, max 10MB)</span>
                    <button type="button" className="doc-zone-btn"
                      onClick={e => { e.stopPropagation(); resumeInputRef.current?.click() }}>
                      Choose File
                    </button>
                  </div>
                )}
              </div>

              {/* Headshot */}
              <div className="doc-upload-area">
                <div className="doc-area-label">Headshot</div>
                <input ref={headshotInputRef} type="file" style={{ display: 'none' }}
                  accept=".jpg,.jpeg,.png"
                  onChange={e => {
                    const f = e.target.files[0]
                    if (f && f.size > 5 * 1024 * 1024) { setError('Headshot must be under 5MB.'); return }
                    setHeadshotFile(f || null)
                  }} />
                {headshotFile ? (
                  <div className="doc-existing-file">
                    <span className="doc-file-link">🖼 {headshotFile.name}</span>
                    <button type="button" className="doc-replace-btn"
                      onClick={() => { setHeadshotFile(null); if (headshotInputRef.current) headshotInputRef.current.value = '' }}>
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="doc-upload-zone" onClick={() => headshotInputRef.current?.click()}>
                    <span className="doc-zone-icon">🖼</span>
                    <span className="doc-zone-text">Upload Headshot (JPG or PNG, max 5MB)</span>
                    <button type="button" className="doc-zone-btn"
                      onClick={e => { e.stopPropagation(); headshotInputRef.current?.click() }}>
                      Choose File
                    </button>
                  </div>
                )}
              </div>

            </div>
          </div>

          {/* ── Rotation Availability (AVAILABILITY-CANON-1B) ── */}
          <div className="uf-section">
            <div className="sf-section-title">Rotation Availability</div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 16px' }}>
              This helps ASPIRE identify possible scheduling conflicts before matching you with a
              preceptor. Your availability is considered during matching but cannot be guaranteed.
            </p>

            <div className="uf-field">
              <label className="uf-label">
                Which weekdays are you unavailable to rotate (class, work, or other commitments)?
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {WEEKDAYS.map(day => {
                  const on = form.unavailable_weekdays.includes(day)
                  return (
                    <button type="button" key={day}
                      onClick={() => set('unavailable_weekdays', toggleWeekday(form.unavailable_weekdays, day))}
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

            <div className="uf-field">
              <label className="uf-label">Briefly explain your recurring unavailable days (optional)</label>
              <input className="uf-input" value={form.unavailable_weekdays_reason}
                onChange={e => set('unavailable_weekdays_reason', e.target.value)}
                placeholder="e.g. Class on Mondays and Tuesdays" />
            </div>

            <div className="uf-field">
              <label className="uf-label">Any personal blackout dates during your rotation window? (optional)</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input className="uf-input" type="date" value={blackoutInput}
                  onChange={e => setBlackoutInput(e.target.value)} style={{ colorScheme: 'light', maxWidth: 200 }} />
                <button type="button" className="sf-add-btn" style={{ marginTop: 0 }}
                  onClick={() => {
                    if (isValidIsoDate(blackoutInput) && !form.personal_blackout_dates.includes(blackoutInput)) {
                      set('personal_blackout_dates', [...form.personal_blackout_dates, blackoutInput])
                    }
                    setBlackoutInput('')
                  }}>
                  + Add date
                </button>
              </div>
              {form.personal_blackout_dates.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {form.personal_blackout_dates.map(d => (
                    <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px',
                      borderRadius: 16, background: '#f1f5f9', color: '#374151', fontSize: 12, fontFamily: 'DM Sans' }}>
                      {d}
                      <button type="button" onClick={() => set('personal_blackout_dates', form.personal_blackout_dates.filter(x => x !== d))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontWeight: 700, padding: 0 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="sf-row-2">
              <div className="uf-field">
                <label className="uf-label">Available for weekend shifts?</label>
                <select className="uf-input"
                  value={form.weekends_available === null ? '' : (form.weekends_available ? 'yes' : 'no')}
                  onChange={e => set('weekends_available', e.target.value === '' ? null : e.target.value === 'yes')}>
                  <option value="">Select…</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div className="uf-field">
                <label className="uf-label">Available for night shifts?</label>
                <select className="uf-input"
                  value={form.nights_available === null ? '' : (form.nights_available ? 'yes' : 'no')}
                  onChange={e => set('nights_available', e.target.value === '' ? null : e.target.value === 'yes')}>
                  <option value="">Select…</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
            </div>

            <div className="uf-field">
              <label className="uf-label">Preferred rotation days (optional)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {WEEKDAYS.map(day => {
                  const on = form.preferred_days.includes(day)
                  return (
                    <button type="button" key={day}
                      onClick={() => set('preferred_days', toggleWeekday(form.preferred_days, day))}
                      style={{ padding: '6px 12px', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 13,
                        fontWeight: 600, cursor: 'pointer',
                        background: on ? '#16a34a' : '#fff', color: on ? '#fff' : '#374151',
                        border: `1px solid ${on ? '#16a34a' : '#d1d5db'}` }}>
                      {day}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="uf-field">
              <label className="uf-label">Anything else ASPIRE should know about your availability? (optional)</label>
              <textarea className="uf-textarea" rows={2} value={form.availability_notes}
                onChange={e => set('availability_notes', e.target.value)}
                placeholder="Share any other scheduling considerations." />
            </div>

            <div className="uf-field">
              <label className="uf-check-label" style={{ alignItems: 'flex-start', gap: 10 }}>
                <input type="checkbox" checked={form.availability_ack}
                  onChange={e => set('availability_ack', e.target.checked)} style={{ marginTop: 3 }} />
                <span style={{ fontSize: 13, lineHeight: 1.55 }}>{AVAILABILITY_ACK_TEXT} <span style={{ color: '#ef4444' }}>*</span></span>
              </label>
            </div>
          </div>

          {/* ── Your Interest ── */}
          <div className="uf-section">
            <div className="sf-section-title">Your Interest</div>
            <div className="uf-field">
              <label className="uf-label">Why are you interested in completing your senior rotation at Cedars-Sinai? *</label>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Minimum 50 characters required.
              </p>
              <textarea className="uf-textarea" rows={5} value={form.interest_statement}
                onChange={e => set('interest_statement', e.target.value)}
                placeholder="Share what draws you to Cedars-Sinai and what you hope to gain from this experience." />
              <p style={{ fontSize: 12, color: form.interest_statement.length >= 50 ? '#16a34a' : 'var(--text-secondary)', marginTop: 4 }}>
                {form.interest_statement.length} / 50 minimum
              </p>
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
