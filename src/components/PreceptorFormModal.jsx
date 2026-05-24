import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export default function PreceptorFormModal({ isOpen, onClose, onSaved, initialData = null, cohortId }) {
  const [form, setForm]   = useState({ full_name: '', email: '', unit_id: '', shift_type: 'Variable', phone: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const [units, setUnits]   = useState([])
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!isOpen) return

    async function loadUnits() {
      try {
        const { data, error } = await supabase.from('units').select('id, unit_name').order('unit_name')
        if (error) { console.error('[PreceptorFormModal] units query failed:', error); return }
        setUnits(data || [])
      } catch (err) {
        console.error('[PreceptorFormModal] units query threw:', err)
      }
    }

    loadUnits()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    if (initialData) {
      setForm({
        full_name:  initialData.full_name  || '',
        email:      initialData.email      || '',
        unit_id:    initialData.unit_id    || '',
        shift_type: initialData.shift_type || 'Variable',
        phone:      initialData.phone      || '',
        notes:      initialData.notes      || '',
      })
    } else {
      setForm({ full_name: '', email: '', unit_id: '', shift_type: 'Variable', phone: '', notes: '' })
    }
    setError(null)
  }, [isOpen, initialData])

  if (!isOpen) return null

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSubmit = async e => {
    e.preventDefault()
    console.log('[PreceptorFormModal] handleSubmit fired', { form, initialData, cohortId })

    if (!form.full_name.trim()) { setError('Full name is required.'); return }
    if (!form.email.trim())     { setError('Email is required.');     return }

    console.log('[PreceptorFormModal] validation passed, setSaving(true)')
    setSaving(true); setError(null)

    try {
      const unit    = units.find(u => u.id === form.unit_id)
      const payload = {
        full_name:  form.full_name.trim(),
        email:      form.email.trim().toLowerCase(),
        unit_id:    form.unit_id  || null,
        unit_name:  unit?.unit_name || null,
        shift_type: form.shift_type,
        phone:      form.phone.trim() || null,
        notes:      form.notes.trim() || null,
        is_active:  true,
      }
      console.log('[PreceptorFormModal] payload built', payload)
      console.log('[PreceptorFormModal] about to call supabase insert/update')

      let result
      if (initialData) {
        const { data, error: err } = await supabase.from('preceptors').update(payload).eq('id', initialData.id).select().single()
        result = { data, error: err }
      } else {
        const { data, error: err } = await supabase.from('preceptors').insert(payload).select().single()
        result = { data, error: err }
      }
      console.log('[PreceptorFormModal] supabase returned', result)

      if (result.error) {
        console.error('[PreceptorFormModal] save error:', result.error)
        if (result.error.code === '23505') {
          setError('A preceptor with this email already exists. Use the assignment panel to link them to a student instead.')
        } else {
          setError(result.error.message || 'Failed to save preceptor.')
        }
        return
      }

      console.log('[PreceptorFormModal] insert succeeded, id:', result.data?.id)

      // Create cohort participation record when adding a new preceptor with cohort context
      if (cohortId && !initialData && result.data) {
        console.log('[PreceptorFormModal] inserting cohort participation')
        const today = new Date().toISOString().split('T')[0]
        const { error: partErr } = await supabase.from('preceptor_cohort_participation').insert({
          preceptor_id: result.data.id,
          cohort_id:    cohortId,
          status:       'active',
          started_at:   today,
        })
        if (partErr) console.error('[PreceptorFormModal] cohort participation insert failed:', partErr)
      }

      console.log('[PreceptorFormModal] invalidating queries, calling callbacks')
      queryClient.invalidateQueries({ queryKey: ['preceptors'] })
      onSaved?.(result.data)
      onClose()
    } catch (err) {
      console.error('[PreceptorFormModal] unexpected error:', err)
      setError(err.message || 'An unexpected error occurred.')
    } finally {
      console.log('[PreceptorFormModal] finally block, setSaving(false)')
      setSaving(false)
    }
  }

  const emailWarn = form.email && !form.email.toLowerCase().includes('@cshs.org')

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={e => e.stopPropagation()} style={{ maxWidth: 480, width: '90vw' }}>
        <div className="modal-header">
          <h2>{initialData ? 'Edit Preceptor' : 'Add Preceptor'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="error-msg">{error}</div>}

            <div className="form-field">
              <label className="form-label">Full Name *</label>
              <input
                className="form-input"
                value={form.full_name}
                onChange={e => set('full_name', e.target.value)}
                placeholder="Jane Smith"
                autoFocus
              />
            </div>

            <div className="form-grid form-grid-2">
              <div className="form-field">
                <label className="form-label">Email *</label>
                <input
                  className="form-input"
                  type="email"
                  value={form.email}
                  onChange={e => set('email', e.target.value)}
                  placeholder="jane.smith@cshs.org"
                />
                {emailWarn && (
                  <div style={{ fontSize: 11, color: '#d97706', marginTop: 3 }}>
                    ⚠ Not a Cedars-Sinai email address
                  </div>
                )}
              </div>
              <div className="form-field">
                <label className="form-label">Phone</label>
                <input
                  className="form-input"
                  type="text"
                  maxLength={30}
                  value={form.phone}
                  onChange={e => set('phone', e.target.value)}
                  placeholder="(310) 555-0000"
                />
              </div>
            </div>

            <div className="form-grid form-grid-2">
              <div className="form-field">
                <label className="form-label">Unit</label>
                <select className="form-select" value={form.unit_id} onChange={e => set('unit_id', e.target.value)}>
                  <option value="">Select unit…</option>
                  {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">Shift Type</label>
                <select className="form-select" value={form.shift_type} onChange={e => set('shift_type', e.target.value)}>
                  {['Day', 'Night', 'Mid', 'Variable'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="form-field">
              <label className="form-label">Notes</label>
              <textarea
                className="form-textarea"
                rows={2}
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="Optional notes…"
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-outline-modal" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : initialData ? 'Save Changes' : 'Add Preceptor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
