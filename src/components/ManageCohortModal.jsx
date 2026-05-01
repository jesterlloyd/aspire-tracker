import { useState } from 'react'
import { COHORT_STATUSES } from '../lib/constants'

export default function ManageCohortModal({ cohort, onSave, onClose }) {
  const [form, setForm]     = useState({ ...cohort })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSubmit = async e => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Cohort name is required.'); return }
    setSaving(true)
    setError(null)
    const err = await onSave(cohort.id, {
      name: form.name,
      status: form.status,
      start_date: form.start_date,
      end_date: form.end_date,
      notes: form.notes,
    })
    if (err) { setError(err.message || 'Failed to save.'); setSaving(false) }
    else onClose()
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit Cohort</h2>
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
                <input className="form-input" value={form.start_date || ''} onChange={e => set('start_date', e.target.value)} />
              </div>
              <div className="form-field">
                <label className="form-label">End Date</label>
                <input className="form-input" value={form.end_date || ''} onChange={e => set('end_date', e.target.value)} />
              </div>
            </div>

            <div className="form-field">
              <label className="form-label">Notes</label>
              <textarea className="form-textarea" rows={3} value={form.notes || ''} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-modal" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
