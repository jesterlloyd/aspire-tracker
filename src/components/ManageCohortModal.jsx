import { useState } from 'react'
import { COHORT_STATUSES } from '../lib/constants'
import { Eye, EyeOff } from 'lucide-react'

export default function ManageCohortModal({ cohort, onSave, onClose }) {
  const [form, setForm]         = useState({ ...cohort })
  const [saving, setSaving]     = useState(false)
  const [error,  setError]      = useState(null)
  const [showPwd, setShowPwd]   = useState(false)

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSubmit = async e => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Cohort name is required.'); return }
    setSaving(true)
    setError(null)
    const err = await onSave(cohort.id, {
      name:                  form.name,
      status:                form.status,
      start_date:            form.start_date,
      end_date:              form.end_date,
      notes:                 form.notes,
      accepting_submissions: !!form.accepting_submissions,
      school_form_password:  form.school_form_password || '',
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

            {/* School Form Password */}
            <div className="form-field">
              <label className="form-label">School Form Password</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  className="form-input"
                  type={showPwd ? 'text' : 'password'}
                  value={form.school_form_password || ''}
                  onChange={e => set('school_form_password', e.target.value)}
                  placeholder="Set a password for school coordinators"
                  style={{ paddingRight: 40 }}
                />
                <button type="button" onClick={() => setShowPwd(p => !p)}
                  style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', display: 'flex', alignItems: 'center', padding: 0 }}>
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4, lineHeight: 1.5 }}>
                Required. Share this password with authorized school placement coordinators each cohort cycle. The form is locked for everyone until a password is set.
              </div>
            </div>

            {/* Accepting submissions toggle */}
            <label className={`cohort-toggle-row${form.accepting_submissions ? ' toggle-on' : ''}`}>
              <input
                type="checkbox"
                className="toggle-checkbox"
                checked={!!form.accepting_submissions}
                onChange={e => set('accepting_submissions', e.target.checked)}
              />
              <div>
                <div className="toggle-title">Accepting submissions</div>
                <div className="toggle-desc">
                  Turn on to accept unit and school coordinator form submissions for this cohort.
                  Only one cohort can be active at a time — enabling here will disable it on any other cohort.
                </div>
              </div>
            </label>
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
