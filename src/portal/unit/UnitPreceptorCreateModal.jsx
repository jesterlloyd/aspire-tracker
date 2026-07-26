import { useEffect, useMemo, useState } from 'react'
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

// Unit Leader Add Preceptor. Presentation converges on the canonical main-app modal
// (PreceptorFormModal): same overlay, header, .form-* grid, and .modal-footer .btn pairing, so the
// two modals look identical. The write path stays Unit Leader specific: the caller-JWT portal RPC
// create_unit_preceptor, which authorizes against the leader's own unit scope (unitKeys) and accepts
// only full_name, email, unit_key, shift, phone. That RPC has no notes column, so the canonical
// Notes field is intentionally omitted here rather than shown and silently discarded.
export default function UnitPreceptorCreateModal({ unitKeys, onClose, onCreated }) {
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', unit_key: '', shift: 'Variable' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const controller = useMemo(() => createUnitPreceptorCreationController({ create: createUnitPreceptor }), [])

  const set = (key, value) => setForm(current => ({ ...current, [key]: value }))

  const close = () => {
    if (saving) return
    controller.reset()
    onClose?.()
  }

  // Escape closes, matching the portal's other dialogs.
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

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

  return (
    <div className="modal-overlay" onMouseDown={close}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ul-create-preceptor-title"
        style={{ maxWidth: 480, width: '90vw' }} onMouseDown={event => event.stopPropagation()}>
        <div className="modal-header">
          <h2 id="ul-create-preceptor-title">Add Preceptor</h2>
          <button className="modal-close" onClick={close} disabled={saving}
            aria-label="Close add preceptor form">×</button>
        </div>

        <form onSubmit={submit}>
          <div className="modal-body">
            {error && <div className="error-msg" role="alert">{error}</div>}

            <div className="form-field">
              <label className="form-label" htmlFor="ul-prec-name">Full Name *</label>
              <input id="ul-prec-name" className="form-input" required maxLength={120} autoFocus
                placeholder="Jane Smith"
                value={form.full_name} onChange={event => set('full_name', event.target.value)} />
            </div>

            <div className="form-grid form-grid-2">
              <div className="form-field">
                <label className="form-label" htmlFor="ul-prec-email">Email *</label>
                <input id="ul-prec-email" className="form-input" type="email" required maxLength={254}
                  placeholder="jane.smith@cshs.org"
                  value={form.email} onChange={event => set('email', event.target.value)} />
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="ul-prec-phone">Phone</label>
                <input id="ul-prec-phone" className="form-input" type="tel" maxLength={40}
                  placeholder="(310) 555-0000"
                  value={form.phone} onChange={event => set('phone', event.target.value)} />
              </div>
            </div>

            <div className="form-grid form-grid-2">
              <div className="form-field">
                <label className="form-label" htmlFor="ul-prec-unit">Unit</label>
                <select id="ul-prec-unit" className="form-select" required value={form.unit_key}
                  onChange={event => set('unit_key', event.target.value)}>
                  <option value="">Select unit…</option>
                  {unitKeys.map(unit => <option key={unit} value={unit}>{unit}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="ul-prec-shift">Shift Type</label>
                <select id="ul-prec-shift" className="form-select" required value={form.shift}
                  onChange={event => set('shift', event.target.value)}>
                  {SHIFTS.map(shift => <option key={shift} value={shift}>{shift}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-outline-modal" onClick={close} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Add Preceptor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
