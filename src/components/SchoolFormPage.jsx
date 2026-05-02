import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { PROGRAM_TYPES, SCHOOLS } from '../lib/constants'

const newStudent = () => ({
  _key: Date.now() + Math.random(),
  first_name: '', last_name: '', email: '', phone: '', program_type: '', term_dates: '', hours_required: '',
})

export default function SchoolFormPage() {
  const [cohortId,   setCohortId]   = useState(null)
  const [cohortName, setCohortName] = useState('')
  const [open,       setOpen]       = useState(null)

  const [coord, setCoord] = useState({ school: '', name: '', email: '', notes: '' })
  const [rows,  setRows]  = useState([newStudent()])

  const [submitting, setSubmitting] = useState(false)
  const [submitted,  setSubmitted]  = useState(false)
  const [error,      setError]      = useState(null)

  useEffect(() => {
    supabase.from('cohorts').select('id, name').eq('accepting_submissions', true)
      .limit(1).single()
      .then(({ data }) => {
        if (data) { setCohortId(data.id); setCohortName(data.name); setOpen(true) }
        else setOpen(false)
      })
  }, [])

  const setC = (k, v) => setCoord(p => ({ ...p, [k]: v }))
  const updRow = (key, field, val) =>
    setRows(prev => prev.map(r => r._key === key ? { ...r, [field]: val } : r))
  const addRow    = () => setRows(prev => [...prev, newStudent()])
  const removeRow = key => setRows(prev => prev.filter(r => r._key !== key))

  const handleSubmit = async e => {
    e.preventDefault()
    if (!coord.school.trim() || !coord.name.trim() || !coord.email.trim()) {
      setError('Please fill in your school and contact information.'); return
    }
    const invalid = rows.find(r => !r.first_name?.trim() || !r.last_name?.trim() || !r.email.trim())
    if (invalid) { setError('Each student requires a first name, last name, and email.'); return }

    setSubmitting(true)
    setError(null)

    const records = rows.map(r => ({
      school:            coord.school.trim(),
      coordinator_name:  coord.name.trim(),
      coordinator_email: coord.email.trim(),
      student_name:      `${r.first_name.trim()} ${r.last_name.trim()}`,
      first_name:        r.first_name.trim(),
      last_name:         r.last_name.trim(),
      student_email:     r.email.trim(),
      student_phone:     r.phone.trim(),
      program_type:      r.program_type,
      term_dates:        r.term_dates.trim(),
      hours_required:    parseInt(r.hours_required) || 0,
      notes:             coord.notes.trim(),
      review_status:     'Pending',
      cohort_id:         cohortId,
    }))

    const { error: err } = await supabase.from('student_submissions').insert(records)
    if (err) { setError('Something went wrong. Please try again.'); setSubmitting(false); return }
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
        <h2 className="uf-title" style={{ marginBottom: 12 }}>ASPIRE Tracker: Student Placement Request</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.6 }}>
          Submissions are not currently open. Please contact the ASPIRE team for more information.
        </p>
      </div>
    </div>
  )

  if (submitted) return (
    <div className="uf-page">
      <div className="uf-card uf-card-confirm">
        <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />
        <div className="uf-confirm-icon">✓</div>
        <h2 className="uf-confirm-title">Thank you, {coord.school}.</h2>
        <p className="uf-confirm-msg">
          Your students have been submitted for the ASPIRE Program. The ASPIRE team will be in touch regarding next steps.
        </p>
      </div>
    </div>
  )

  return (
    <div className="uf-page">
      <div className="uf-card sf-card">
        <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />

        <div className="uf-header">
          <h1 className="uf-title">ASPIRE Tracker: Student Placement Request</h1>
          {cohortName && <div className="uf-cohort-badge">{cohortName}</div>}
          <p className="uf-subtitle">
            Please complete this form to submit your students for consideration in the upcoming
            ASPIRE rotation at Cedars-Sinai.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="uf-form">
          {error && <div className="error-msg" style={{ marginBottom: 8 }}>{error}</div>}

          {/* School / Coordinator info */}
          <div className="uf-section">
            <div className="sf-section-title">School Information</div>
            <div className="uf-field">
              <label className="uf-label">School or University Name *</label>
              <select className="uf-input" value={coord.school} onChange={e => setC('school', e.target.value)}>
                <option value="">Select your school…</option>
                {SCHOOLS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="sf-row-2">
              <div className="uf-field">
                <label className="uf-label">Your Name (Placement Coordinator) *</label>
                <input className="uf-input" value={coord.name}
                  onChange={e => setC('name', e.target.value)}
                  placeholder="First Last, Title" />
              </div>
              <div className="uf-field">
                <label className="uf-label">Your Email Address *</label>
                <input className="uf-input" type="email" value={coord.email}
                  onChange={e => setC('email', e.target.value)}
                  placeholder="coordinator@school.edu" />
              </div>
            </div>
          </div>

          {/* Student rows */}
          <div className="uf-section">
            <div className="sf-section-title">Students</div>

            {rows.map((row, idx) => (
              <div key={row._key} className="sf-student-block">
                <div className="sf-student-header">
                  <span className="sf-student-num">Student {idx + 1}</span>
                  {rows.length > 1 && (
                    <button type="button" className="sf-remove-btn" onClick={() => removeRow(row._key)}>
                      Remove
                    </button>
                  )}
                </div>

                {/* First + Last name side by side */}
                <div className="sf-row-2">
                  <div className="uf-field">
                    <label className="uf-label">First Name *</label>
                    <input className="uf-input" value={row.first_name}
                      onChange={e => updRow(row._key, 'first_name', e.target.value)}
                      placeholder="First" />
                  </div>
                  <div className="uf-field">
                    <label className="uf-label">Last Name *</label>
                    <input className="uf-input" value={row.last_name}
                      onChange={e => updRow(row._key, 'last_name', e.target.value)}
                      placeholder="Last" />
                  </div>
                </div>

                <div className="sf-row-2">
                  <div className="uf-field">
                    <label className="uf-label">Student Email *</label>
                    <input className="uf-input" type="email" value={row.email}
                      onChange={e => updRow(row._key, 'email', e.target.value)}
                      placeholder="student@school.edu" />
                  </div>
                  <div className="uf-field">
                    <label className="uf-label">Phone (optional)</label>
                    <input className="uf-input" value={row.phone}
                      onChange={e => updRow(row._key, 'phone', e.target.value)}
                      placeholder="(555) 000-0000" />
                  </div>
                </div>

                <div className="sf-row-3">
                  <div className="uf-field">
                    <label className="uf-label">Program Type</label>
                    <select className="uf-input" value={row.program_type}
                      onChange={e => updRow(row._key, 'program_type', e.target.value)}>
                      <option value="">Select…</option>
                      {PROGRAM_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="uf-field">
                    <label className="uf-label">Term Dates</label>
                    <input className="uf-input" value={row.term_dates}
                      onChange={e => updRow(row._key, 'term_dates', e.target.value)}
                      placeholder="e.g. Jun 1 – Aug 7, 2026" />
                  </div>
                  <div className="uf-field">
                    <label className="uf-label">Hours Required</label>
                    <input className="uf-input" type="number" min="0" value={row.hours_required}
                      onChange={e => updRow(row._key, 'hours_required', e.target.value)}
                      placeholder="e.g. 144" />
                  </div>
                </div>
              </div>
            ))}

            <button type="button" className="sf-add-btn" onClick={addRow}>
              + Add Another Student
            </button>
          </div>

          {/* Notes */}
          <div className="uf-section">
            <div className="uf-field">
              <label className="uf-label">Additional notes for the ASPIRE team (optional)</label>
              <textarea className="uf-textarea" rows={3} value={coord.notes}
                onChange={e => setC('notes', e.target.value)}
                placeholder="Any special scheduling needs, course requirements, or information we should know" />
            </div>
          </div>

          <div className="uf-submit-row">
            <button type="submit" className="uf-submit-btn" disabled={submitting}>
              {submitting ? 'Submitting…' : `Submit ${rows.length} Student${rows.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
