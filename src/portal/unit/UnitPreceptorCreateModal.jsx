import { useMemo, useState } from 'react'
import { createUnitPreceptor } from './unitLeaderApi'
import { createUnitPreceptorCreationController } from './unitPreceptorCreation'

const SHIFTS = ['Day', 'Night', 'Mid', 'Variable']

function messageFor(result) {
  if (result.error === 'submission_in_progress') return 'This preceptor is already being submitted.'
  if (result.status === 409) return 'A preceptor with this email already exists.'
  if (result.status === 403 || result.status === 404) return 'You are not authorized to create a preceptor under that unit.'
  if (result.status === 400) return 'Check the preceptor details and try again.'
  return 'The preceptor could not be created. Please try again.'
}

export default function UnitPreceptorCreateModal({ unitKeys, onClose, onCreated }) {
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', unit_key: '', shift: 'Variable' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const controller = useMemo(() => createUnitPreceptorCreationController({ create: createUnitPreceptor }), [])

  const set = (key, value) => setForm(current => ({ ...current, [key]: value }))

  const submit = async (event) => {
    event.preventDefault()
    if (saving) return
    if (!form.full_name.trim() || !form.email.trim() || !form.unit_key || !form.shift) {
      setError('Name, email, unit, and shift are required.')
      return
    }

    setSaving(true)
    setError(null)
    const result = await controller.submit({
      full_name: form.full_name.trim(),
      email: form.email.trim().toLowerCase(),
      phone: form.phone.trim() || null,
      unit_key: form.unit_key,
      shift: form.shift,
    })
    if (!result.ok) {
      setSaving(false)
      setError(messageFor(result))
      return
    }
    onCreated?.(result.data?.result || null)
  }

  const close = () => {
    if (saving) return
    controller.reset()
    onClose?.()
  }

  return (
    <div className="ptl-modal-backdrop" role="presentation" onMouseDown={close}>
      <div className="ptl-modal ptl-prec-create" role="dialog" aria-modal="true"
        aria-labelledby="ul-create-preceptor-title" onMouseDown={event => event.stopPropagation()}>
        <div className="ptl-modal-head">
          <h2 id="ul-create-preceptor-title">Add preceptor</h2>
          <button type="button" className="ptl-icon-btn" onClick={close} disabled={saving}
            aria-label="Close add preceptor form">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="ptl-modal-body ptl-form-grid">
            {error && <p className="ptl-notice ptl-notice-error ptl-field-wide" role="alert">{error}</p>}
            <div className="ptl-field">
              <label className="ptl-label" htmlFor="ul-prec-name">Full name</label>
              <input id="ul-prec-name" className="ptl-input ptl-input-full" required maxLength={120}
                autoFocus value={form.full_name} onChange={event => set('full_name', event.target.value)} />
            </div>
            <div className="ptl-field">
              <label className="ptl-label" htmlFor="ul-prec-email">Email</label>
              <input id="ul-prec-email" className="ptl-input ptl-input-full" type="email" required maxLength={254}
                value={form.email} onChange={event => set('email', event.target.value)} />
            </div>
            <div className="ptl-field">
              <label className="ptl-label" htmlFor="ul-prec-phone">Phone <span className="ptl-muted">(optional)</span></label>
              <input id="ul-prec-phone" className="ptl-input ptl-input-full" type="tel" maxLength={40}
                value={form.phone} onChange={event => set('phone', event.target.value)} />
            </div>
            <div className="ptl-field">
              <label className="ptl-label" htmlFor="ul-prec-unit">Home unit</label>
              <select id="ul-prec-unit" className="ptl-input ptl-input-full" required value={form.unit_key}
                onChange={event => set('unit_key', event.target.value)}>
                <option value="">Select an authorized unit</option>
                {unitKeys.map(unit => <option key={unit} value={unit}>{unit}</option>)}
              </select>
            </div>
            <div className="ptl-field">
              <label className="ptl-label" htmlFor="ul-prec-shift">Shift</label>
              <select id="ul-prec-shift" className="ptl-input ptl-input-full" required value={form.shift}
                onChange={event => set('shift', event.target.value)}>
                {SHIFTS.map(shift => <option key={shift} value={shift}>{shift}</option>)}
              </select>
            </div>
          </div>
          <div className="ptl-modal-actions">
            <button type="button" className="ptl-btn-outline" onClick={close} disabled={saving}>Cancel</button>
            <button type="submit" className="ptl-btn" disabled={saving}>
              {saving ? 'Creating' : 'Create preceptor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
