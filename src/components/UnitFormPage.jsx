import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function UnitFormPage() {
  const [cohortId,   setCohortId]    = useState(null)
  const [cohortName, setCohortName]  = useState('')
  const [open,       setOpen]        = useState(null) // null=loading, true=open, false=closed
  const [form,       setForm]        = useState({
    unit_name:        '',
    contact_person:   '',
    contact_email:    '',
    is_participating: null,
    total_slots:      '',
    shift_day:        false,
    shift_night:      false,
    shift_either:     false,
    preceptors:       '',
    considerations:   '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted,  setSubmitted]  = useState(false)
  const [error,      setError]      = useState(null)

  useEffect(() => {
    supabase
      .from('cohorts')
      .select('id, name')
      .eq('accepting_submissions', true)
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) { setCohortId(data.id); setCohortName(data.name); setOpen(true) }
        else setOpen(false)
      })
  }, [])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const shiftPref = [
    form.shift_day    && 'Day Shift',
    form.shift_night  && 'Night Shift',
    form.shift_either && 'Either',
  ].filter(Boolean).join(', ')

  const handleSubmit = async e => {
    e.preventDefault()
    if (!form.unit_name.trim() || !form.contact_person.trim() || !form.contact_email.trim()) {
      setError('Please fill in all required fields.')
      return
    }
    if (form.is_participating === null) {
      setError('Please indicate whether your unit will be participating.')
      return
    }
    setSubmitting(true)
    setError(null)

    const { error: err } = await supabase.from('unit_submissions').insert({
      unit_name:        form.unit_name.trim(),
      contact_person:   form.contact_person.trim(),
      contact_email:    form.contact_email.trim(),
      is_participating: form.is_participating,
      total_slots:      form.is_participating ? (parseInt(form.total_slots) || 0) : 0,
      shift_preference: form.is_participating ? shiftPref : '',
      preceptors:       form.is_participating ? form.preceptors.trim() : '',
      considerations:   form.is_participating ? form.considerations.trim() : '',
      review_status:    'Pending',
      cohort_id:        cohortId,
    })

    if (err) { setError('Something went wrong. Please try again.'); setSubmitting(false); return }
    setSubmitted(true)
  }

  if (open === null) {
    return (
      <div className="uf-page">
        <div className="uf-card" style={{ textAlign: 'center', padding: '60px 40px' }}>
          <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />
          <p style={{ color: 'var(--raven-muted)' }}>Loading…</p>
        </div>
      </div>
    )
  }

  if (open === false) {
    return (
      <div className="uf-page">
        <div className="uf-card" style={{ textAlign: 'center', padding: '56px 40px' }}>
          <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />
          <h2 className="uf-title" style={{ marginBottom: 12 }}>ASPIRE Tracker: Unit Availability Form</h2>
          <p style={{ color: 'var(--raven-muted)', fontSize: 15, lineHeight: 1.6 }}>
            Submissions are not currently open. Please contact the ASPIRE team for more information.
          </p>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="uf-page">
        <div className="uf-card uf-card-confirm">
          <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />
          <div className="uf-confirm-icon">✓</div>
          <h2 className="uf-confirm-title">Thank you, {form.unit_name}.</h2>
          <p className="uf-confirm-msg">
            Your response has been received. The ASPIRE team will follow up with next steps.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="uf-page">
      <div className="uf-card">
        <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />
        <div className="uf-header">
          <h1 className="uf-title">ASPIRE Tracker: Unit Availability Form</h1>
          {cohortName && <div className="uf-cohort-badge">{cohortName}</div>}
          <p className="uf-subtitle">
            Thank you for your interest in hosting ASPIRE students. Please complete this form
            to indicate your unit's availability for the upcoming rotation.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="uf-form">
          {error && <div className="error-msg" style={{ margin: '0 0 8px' }}>{error}</div>}

          <div className="uf-section">
            <div className="uf-field">
              <label className="uf-label">Unit or Department Name *</label>
              <input className="uf-input" value={form.unit_name}
                onChange={e => set('unit_name', e.target.value)}
                placeholder="e.g. 6 NW, Labor and Delivery, NICU" />
            </div>
            <div className="uf-field">
              <label className="uf-label">Your Name and Title *</label>
              <input className="uf-input" value={form.contact_person}
                onChange={e => set('contact_person', e.target.value)}
                placeholder="e.g. Jane Smith, RN, Nurse Manager" />
            </div>
            <div className="uf-field">
              <label className="uf-label">Your Email Address *</label>
              <input className="uf-input" type="email" value={form.contact_email}
                onChange={e => set('contact_email', e.target.value)}
                placeholder="you@cedars-sinai.org" />
            </div>
          </div>

          <div className="uf-section">
            <div className="uf-field">
              <label className="uf-label">Will your unit be participating this cycle? *</label>
              <div className="uf-radio-group">
                <label className="uf-radio-label">
                  <input type="radio" name="participating"
                    checked={form.is_participating === true}
                    onChange={() => set('is_participating', true)} />
                  <span>Yes, we would like to participate</span>
                </label>
                <label className="uf-radio-label">
                  <input type="radio" name="participating"
                    checked={form.is_participating === false}
                    onChange={() => set('is_participating', false)} />
                  <span>No, we are unable to participate this cycle</span>
                </label>
              </div>
            </div>
          </div>

          {form.is_participating === true && (
            <>
              <div className="uf-section">
                <div className="uf-field">
                  <label className="uf-label">Number of students you can host *</label>
                  <input className="uf-input uf-input-sm" type="number" min="1" max="10"
                    value={form.total_slots} onChange={e => set('total_slots', e.target.value)}
                    placeholder="1–10" />
                </div>
              </div>
              <div className="uf-section">
                <div className="uf-field">
                  <label className="uf-label">Shift preference (select all that apply)</label>
                  <div className="uf-checkbox-group">
                    {[['shift_day','Day Shift'],['shift_night','Night Shift'],['shift_either','Either']].map(([k,l]) => (
                      <label key={k} className="uf-check-label">
                        <input type="checkbox" checked={form[k]} onChange={e => set(k, e.target.checked)} />
                        <span>{l}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="uf-section">
                <div className="uf-field">
                  <label className="uf-label">Preceptor names (optional)</label>
                  <textarea className="uf-textarea" rows={3} value={form.preceptors}
                    onChange={e => set('preceptors', e.target.value)}
                    placeholder="List names of RNs interested in precepting, if known" />
                </div>
                <div className="uf-field">
                  <label className="uf-label">Special considerations or requirements (optional)</label>
                  <textarea className="uf-textarea" rows={3} value={form.considerations}
                    onChange={e => set('considerations', e.target.value)}
                    placeholder="e.g. scheduling requirements, dress code, skill level preferences" />
                </div>
              </div>
            </>
          )}

          <div className="uf-submit-row">
            <button type="submit" className="uf-submit-btn"
              disabled={submitting || form.is_participating === null}>
              {submitting ? 'Submitting…' : 'Submit Form'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
