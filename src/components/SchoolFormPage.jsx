import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { PROGRAM_TYPES, SCHOOLS } from '../lib/constants'

const PAGE_TITLE = 'ASPIRE Program Student Placement Request Form'

const newStudent = () => ({
  _key: Date.now() + Math.random(),
  first_name: '', last_name: '', email: '', phone: '',
  program_type: '', term_dates: '', hours_required: '', estimated_graduation: '',
})

export default function SchoolFormPage() {
  const [cohortId,   setCohortId]   = useState(null)
  const [cohortName, setCohortName] = useState('')
  const [open,       setOpen]       = useState(null)

  const [coord, setCoord] = useState({ school: '', name: '', email: '', notes: '' })
  const [rows,  setRows]  = useState([newStudent()])

  const [submitting, setSubmitting] = useState(false)
  const [result,     setResult]     = useState(null) // { added: [], skipped: [] }
  const [error,      setError]      = useState(null)

  useEffect(() => {
    document.title = PAGE_TITLE
    supabase.from('cohorts').select('id, name').eq('accepting_submissions', true)
      .limit(1).single()
      .then(({ data }) => {
        if (data) { setCohortId(data.id); setCohortName(data.name); setOpen(true) }
        else setOpen(false)
      })
  }, [])

  const setC    = (k, v) => setCoord(p => ({ ...p, [k]: v }))
  const updRow  = (key, field, val) => setRows(prev => prev.map(r => r._key === key ? { ...r, [field]: val } : r))
  const addRow  = () => setRows(prev => [...prev, newStudent()])
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

    const added = []
    const skipped = []

    for (const r of rows) {
      const schoolEmail = r.email.trim()

      // Check for existing student with same school_email in this cohort
      const { data: existing } = await supabase.from('students')
        .select('id').eq('cohort_id', cohortId).eq('school_email', schoolEmail)
        .limit(1).maybeSingle()

      if (existing) {
        skipped.push(`${r.first_name.trim()} ${r.last_name.trim()}`)
        continue
      }

      const { error: insertErr } = await supabase.from('students').insert({
        name:                    `${r.first_name.trim()} ${r.last_name.trim()}`,
        first_name:              r.first_name.trim(),
        last_name:               r.last_name.trim(),
        school_email:            schoolEmail,
        phone:                   r.phone.trim(),
        school:                  coord.school.trim(),
        program_type:            r.program_type,
        term_dates:              r.term_dates.trim(),
        hours_required:          parseInt(r.hours_required) || 0,
        hours_completed:         0,
        estimated_graduation:    r.estimated_graduation.trim(),
        status:                  'Pending Outreach',
        interview_outcome:       'Pending Interview',
        ngrp_outcome:            'Pending',
        submitted_via:           'school_form',
        school_coordinator_name:  coord.name.trim(),
        school_coordinator_email: coord.email.trim(),
        aspire_cohort:           cohortName,
        gpa_verified:            false,
        bls_current:             false,
        health_cleared:          false,
        background_check:        false,
        coordinators:            coord.notes.trim(),
        cohort_id:               cohortId,
      })

      if (insertErr) {
        setError('Something went wrong while adding students. Please try again.')
        setSubmitting(false)
        return
      }
      added.push(`${r.first_name.trim()} ${r.last_name.trim()}`)
    }

    setResult({ added, skipped })
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
          Submissions are not currently open. Please contact the ASPIRE team for more information.
        </p>
      </div>
    </div>
  )

  if (result) return (
    <div className="uf-page">
      <div className="uf-card uf-card-confirm">
        <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />
        <div className="uf-confirm-icon">✓</div>
        <h2 className="uf-confirm-title">Thank you, {coord.school}.</h2>
        {result.added.length > 0 && (
          <p className="uf-confirm-msg">
            <strong>{result.added.length} student{result.added.length !== 1 ? 's' : ''} added
            </strong> to the ASPIRE Program for {cohortName}.
          </p>
        )}
        {result.skipped.length > 0 && (
          <p className="uf-confirm-msg" style={{ marginTop: 12, color: 'var(--text-secondary)', fontSize: 14 }}>
            <strong>{result.skipped.length} skipped</strong> (already on file):{' '}
            {result.skipped.join(', ')}
          </p>
        )}
        {result.added.length === 0 && result.skipped.length > 0 && (
          <p className="uf-confirm-msg" style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
            All submitted students were already in the system. Please contact the ASPIRE team if changes are needed.
          </p>
        )}
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
        </div>

        <form onSubmit={handleSubmit} className="uf-form">
          {error && <div className="error-msg" style={{ marginBottom: 8 }}>{error}</div>}

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
                  onChange={e => setC('name', e.target.value)} placeholder="First Last, Title" />
              </div>
              <div className="uf-field">
                <label className="uf-label">Your Email Address *</label>
                <input className="uf-input" type="email" value={coord.email}
                  onChange={e => setC('email', e.target.value)} placeholder="coordinator@school.edu" />
              </div>
            </div>
          </div>

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

                <div className="sf-row-2">
                  <div className="uf-field">
                    <label className="uf-label">First Name *</label>
                    <input className="uf-input" value={row.first_name}
                      onChange={e => updRow(row._key, 'first_name', e.target.value)} placeholder="First" />
                  </div>
                  <div className="uf-field">
                    <label className="uf-label">Last Name *</label>
                    <input className="uf-input" value={row.last_name}
                      onChange={e => updRow(row._key, 'last_name', e.target.value)} placeholder="Last" />
                  </div>
                </div>

                <div className="sf-row-2">
                  <div className="uf-field">
                    <label className="uf-label">School Email *</label>
                    <input className="uf-input" type="email" value={row.email}
                      onChange={e => updRow(row._key, 'email', e.target.value)}
                      placeholder="student@school.edu" />
                  </div>
                  <div className="uf-field">
                    <label className="uf-label">Phone (optional)</label>
                    <input className="uf-input" value={row.phone}
                      onChange={e => updRow(row._key, 'phone', e.target.value)} placeholder="(555) 000-0000" />
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
                      onChange={e => updRow(row._key, 'hours_required', e.target.value)} placeholder="e.g. 144" />
                  </div>
                </div>

                <div className="uf-field">
                  <label className="uf-label">Estimated Graduation Date</label>
                  <input className="uf-input" value={row.estimated_graduation}
                    onChange={e => updRow(row._key, 'estimated_graduation', e.target.value)}
                    placeholder="e.g. May 2027" />
                </div>
              </div>
            ))}

            <button type="button" className="sf-add-btn" onClick={addRow}>
              + Add Another Student
            </button>
          </div>

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
