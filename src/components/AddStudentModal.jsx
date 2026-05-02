import { useState } from 'react'
import { SCHOOLS, SCHOOL_DEFAULTS, ASPIRE_STATUSES, COHORTS } from '../lib/constants'

const BLANK = {
  first_name: '', last_name: '', name: '',
  school_email: '', personal_email: '', phone: '',
  school: '', aspire_cohort: 'Summer 2026', term_dates: '',
  hours_required: 0, hours_completed: 0, unit: '', preceptor_name: '',
  status: 'Form Sent', ngrp_cohort_target: '', ngrp_outcome: 'Pending',
  gpa_verified: false, bls_current: false, health_cleared: false,
  background_check: false, coordinators: '', notes: '',
}

export default function AddStudentModal({ cohortId, onAdd, onClose }) {
  const [form,   setForm]   = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSchoolChange = school => {
    const d = SCHOOL_DEFAULTS[school] || {}
    setForm(p => ({
      ...p, school,
      term_dates:     d.term_dates     ?? p.term_dates,
      hours_required: d.hours_required ?? p.hours_required,
      coordinators:   d.coordinators   ?? p.coordinators,
    }))
  }

  const handleSubmit = async e => {
    e.preventDefault()
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError('First name and last name are required.')
      return
    }
    if (!cohortId) { setError('No active cohort. Create one first.'); return }
    setSaving(true); setError(null)
    const err = await onAdd({
      ...form,
      name: `${form.first_name.trim()} ${form.last_name.trim()}`,
      cohort_id: cohortId,
    })
    if (err) { setError(err.message || 'Failed to add student.'); setSaving(false) }
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add New Student</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="error-msg">{error}</div>}

            {/* First + Last name side by side */}
            <div className="form-grid form-grid-2">
              <div className="form-field">
                <label className="form-label">First Name *</label>
                <input className="form-input" value={form.first_name}
                  onChange={e => set('first_name', e.target.value)}
                  placeholder="First" autoFocus />
              </div>
              <div className="form-field">
                <label className="form-label">Last Name *</label>
                <input className="form-input" value={form.last_name}
                  onChange={e => set('last_name', e.target.value)}
                  placeholder="Last" />
              </div>
            </div>

            <div className="form-field">
              <label className="form-label">School Email</label>
              <input className="form-input" value={form.school_email}
                onChange={e => set('school_email', e.target.value)}
                placeholder="student@school.edu" />
            </div>

            <div className="form-grid form-grid-2">
              <div className="form-field">
                <label className="form-label">School</label>
                <select className="form-select" value={form.school} onChange={e => handleSchoolChange(e.target.value)}>
                  <option value="">Select school…</option>
                  {SCHOOLS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">ASPIRE Cohort</label>
                <select className="form-select" value={form.aspire_cohort} onChange={e => set('aspire_cohort', e.target.value)}>
                  {COHORTS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div className="form-grid form-grid-3">
              <div className="form-field">
                <label className="form-label">Term Dates</label>
                <input className="form-input" value={form.term_dates}
                  onChange={e => set('term_dates', e.target.value)}
                  placeholder="Auto-filled by school" />
              </div>
              <div className="form-field">
                <label className="form-label">Hours Required</label>
                <input className="form-input" type="number" min="0"
                  value={form.hours_required || ''}
                  onChange={e => set('hours_required', parseInt(e.target.value) || 0)} />
              </div>
              <div className="form-field">
                <label className="form-label">Initial Status</label>
                <select className="form-select" value={form.status} onChange={e => set('status', e.target.value)}>
                  {ASPIRE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {form.coordinators && (
              <div className="form-field">
                <label className="form-label">School Coordinators (auto-filled)</label>
                <textarea className="form-textarea" rows={2} value={form.coordinators}
                  onChange={e => set('coordinators', e.target.value)} />
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-modal" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Adding…' : 'Add Student'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
