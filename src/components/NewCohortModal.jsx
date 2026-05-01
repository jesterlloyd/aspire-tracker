import { useState } from 'react'
import { COHORT_STATUSES } from '../lib/constants'

const BLANK = { name: '', status: 'Active', start_date: '', end_date: '', notes: '' }

export default function NewCohortModal({ onSave, onClose }) {
  const [form, setForm]     = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSubmit = async e => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Cohort name is required.'); return }
    setSaving(true)
    setError(null)
    const err = await onSave(form)
    if (err) { setError(err.message || 'Failed to create cohort.'); setSaving(false) }
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>New Cohort</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="error-msg">{error}</div>}

            <div className="form-field">
              <label className="form-label">Cohort Name *</label>
              <input
                className="form-input"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="e.g. Fall 2026"
                autoFocus
              />
            </div>

            <div className="form-grid form-grid-3">
              <div className="form-field">
                <label className="form-label">Status</label>
                <select className="form-select" value={form.status} onChange={e => set('status', e.target.value)}>
                  {COHORT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">Start Date</label>
                <input className="form-input" value={form.start_date} onChange={e => set('start_date', e.target.value)} placeholder="e.g. September 1, 2026" />
              </div>
              <div className="form-field">
                <label className="form-label">End Date</label>
                <input className="form-input" value={form.end_date} onChange={e => set('end_date', e.target.value)} placeholder="e.g. December 15, 2026" />
              </div>
            </div>

            <div className="form-field">
              <label className="form-label">Notes</label>
              <textarea className="form-textarea" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-modal" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create Cohort'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
