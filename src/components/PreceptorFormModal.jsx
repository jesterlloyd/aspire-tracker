import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Camera } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { toLocalDateStr } from '../../shared/dateUtils.js'
import { safeWrite } from '../lib/safeWrite'
import { buildUnitOptions, optionLabel, resolveUnitName } from '../lib/preceptorUnitOptions'
import { uploadContactAvatar, CONTACT_AVATAR_HINT } from '../lib/contactAvatarUpload'
import {
  CUSTOM_TITLE, normalizeEmail, pickContactByEmail, titleChoices, buildContactPatch,
} from '../lib/preceptorContact'

const EMPTY_FORM = {
  full_name: '', email: '', unit_id: '', shift_type: 'Variable', phone: '', notes: '',
  role: '', role_custom: false, avatar_url: '',
}
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// PRECEPTOR-TITLE-PHOTO-1: Role/Title and photo are stored on the ASPIRE
// Connect contact with this email, not on the preceptor.
async function findContact(email) {
  const key = normalizeEmail(email)
  if (!key) return null
  const { data, error } = await supabase
    .from('contacts')
    .select('id, full_name, email, category, role, avatar_url')
    .ilike('email', key)
    .limit(5)
  if (error) throw error
  return pickContactByEmail(data, key)
}

async function postContact(token, body) {
  const res = await fetch('/api/contacts-upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (res.ok) return { ok: true, status: res.status }
  const json = await res.json().catch(() => ({}))
  return { ok: false, status: res.status, message: json.error }
}

// Called after every successful preceptor create/update. Creates the contact
// when none exists; otherwise writes only the title and photo the form changed.
// Failure is non-blocking: the preceptor is already saved.
async function syncPreceptorContact(preceptor, fields) {
  if (!preceptor?.email?.trim()) return { status: 'no_email' }
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return { status: 'error' }
    let contact = await findContact(preceptor.email)
    if (!contact) {
      const created = await postContact(session.access_token, {
        full_name:    preceptor.full_name,
        email:        normalizeEmail(preceptor.email),
        // CONTACTS-CANON-1: singular canonical category. The Cedars-Sinai
        // affiliation is derived server-side from the category.
        role:         fields.role || '',
        avatar_url:   fields.avatar_url || '',
        category:     'Preceptor',
        is_active:    true,
        notes:        'Imported from Rotations > Preceptors.',
        ...(preceptor.unit_name ? { unit_name: preceptor.unit_name } : {}),
        ...(preceptor.phone     ? { phone:     preceptor.phone     } : {}),
      })
      if (created.ok) return { status: 'created' }
      if (created.status !== 409) return { status: 'error', message: created.message }
      contact = await findContact(preceptor.email)   // created elsewhere since the lookup
      if (!contact) return { status: 'error' }
    }
    const patch = buildContactPatch(contact, fields)
    if (!patch) return { status: 'unchanged' }
    const updated = await postContact(session.access_token, patch)
    return updated.ok ? { status: 'updated' } : { status: 'error', message: updated.message }
  } catch {
    return { status: 'error' }
  }
}

export default function PreceptorFormModal({ isOpen, onClose, onSaved, initialData = null, cohortId, units: unitsProp }) {
  const [form, setForm]   = useState(EMPTY_FORM)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)
  const [syncNote, setSyncNote] = useState(null)  // non-blocking contact sync feedback
  const [contact, setContact] = useState(null)
  const [contactState, setContactState] = useState('idle')  // idle | loading | ready | error
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [uploadErr, setUploadErr] = useState(null)
  const contactFieldsTouched = useRef(false)
  const fileRef = useRef(null)
  const [fetchedUnits, setFetchedUnits] = useState([])
  const queryClient = useQueryClient()

  // PRECEPTOR-UNIT-DROPDOWN-1: prefer the active cohort's units already loaded
  // by App - no second query at all on that path.
  const usingProvidedUnits = Array.isArray(unitsProp)

  useEffect(() => {
    if (!isOpen) return
    if (usingProvidedUnits) return   // nothing to fetch

    async function loadUnits() {
      try {
        // The leak was here: this query had no cohort filter, so it returned
        // the same physical unit once per cohort. Callers that cannot pass
        // units still get a correctly scoped list. Without a cohort there is
        // nothing safe to offer, so we ask for nothing.
        if (!cohortId) { setFetchedUnits([]); return }
        const { data, error } = await supabase
          .from('units')
          .select('id, unit_name, cohort_id')
          .eq('cohort_id', cohortId)
          .order('unit_name')
        if (error) { console.error('[PreceptorFormModal] units query failed:', error); return }
        setFetchedUnits(data || [])
      } catch (err) {
        console.error('[PreceptorFormModal] units query threw:', err)
      }
    }

    loadUnits()
  }, [isOpen, cohortId, usingProvidedUnits])

  // Options are rebuilt whenever the cohort or the edited preceptor changes, so
  // a cohort switch can never leave the previous cohort's units on screen.
  const { options: unitOptions, selectedId: resolvedUnitId, resolution } = buildUnitOptions(
    usingProvidedUnits ? unitsProp : fetchedUnits,
    cohortId,
    { unit_id: initialData?.unit_id, unit_name: initialData?.unit_name },
  )

  useEffect(() => {
    if (!isOpen) return
    if (initialData) {
      setForm({
        ...EMPTY_FORM,
        full_name:  initialData.full_name  || '',
        email:      initialData.email      || '',
        unit_id:    resolvedUnitId          || '',
        shift_type: initialData.shift_type || 'Variable',
        phone:      initialData.phone      || '',
        notes:      initialData.notes      || '',
      })
    } else {
      setForm(EMPTY_FORM)
    }
    contactFieldsTouched.current = false
    setContact(null)
    setContactState('idle')
    setError(null)
    setSyncNote(null)
    setUploadErr(null)
  }, [isOpen, initialData]) // eslint-disable-line react-hooks/exhaustive-deps

  // Look up the contact for the typed email. Its title and photo fill the form
  // until the user changes either, after which a later lookup never overwrites them.
  const emailKey = normalizeEmail(form.email)
  const emailUsable = EMAIL_SHAPE.test(emailKey)
  useEffect(() => {
    if (!isOpen || !emailUsable) { setContact(null); setContactState('idle'); return }
    let cancelled = false
    setContactState('loading')
    const timer = setTimeout(async () => {
      try {
        const found = await findContact(emailKey)
        if (cancelled) return
        setContact(found)
        setContactState('ready')
        if (!contactFieldsTouched.current) {
          const role = found?.role || ''
          const { options, allowsFreeText } = titleChoices(found, role)
          setForm(p => ({
            ...p,
            role,
            role_custom: Boolean(role) && !options.includes(role) && allowsFreeText,
            avatar_url: found?.avatar_url || '',
          }))
        }
      } catch {
        if (!cancelled) { setContact(null); setContactState('error') }
      }
    }, 350)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [isOpen, emailKey, emailUsable])

  // On the fetch path the units arrive AFTER the form has initialised, so the
  // resolved unit has to be adopted once they land. Done during render (React's
  // documented way to adjust state when inputs change) rather than in an
  // effect, and only while the field still holds the stored value, so a choice
  // the user just made is never overwritten.
  const [adoptedUnitKey, setAdoptedUnitKey] = useState(null)
  const adoptKey = initialData ? `${initialData.id}:${resolvedUnitId}` : null
  if (
    isOpen && adoptKey && adoptedUnitKey !== adoptKey &&
    resolvedUnitId && resolvedUnitId !== form.unit_id &&
    form.unit_id === (initialData.unit_id || '')
  ) {
    setAdoptedUnitKey(adoptKey)
    setForm(p => ({ ...p, unit_id: resolvedUnitId }))
  }

  if (!isOpen) return null

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const setContactField = (patch) => {
    contactFieldsTouched.current = true
    setForm(p => ({ ...p, ...patch }))
  }

  const { options: titleOptions, allowsFreeText, legacy: legacyTitle } = titleChoices(contact, form.role)
  const handleTitleSelect = (value) => {
    if (value === CUSTOM_TITLE) setContactField({ role_custom: true, role: '' })
    else setContactField({ role_custom: false, role: value })
  }

  async function handlePhotoUpload(e) {
    const file = e.target.files?.[0]
    if (e.target) e.target.value = ''
    if (!file) return
    setUploadErr(null)
    setUploadingPhoto(true)
    const { url, error: err } = await uploadContactAvatar(supabase, file, contact?.id)
    setUploadingPhoto(false)
    if (err) { setUploadErr(err); return }
    setContactField({ avatar_url: url })
  }

  const handleSubmit = async e => {
    e.preventDefault()
    if (!form.full_name.trim()) { setError('Full name is required.'); return }
    if (!form.email.trim())     { setError('Email is required.');     return }

    setSaving(true); setError(null)

    try {
      const payload = {
        full_name:  form.full_name.trim(),
        email:      form.email.trim().toLowerCase(),
        unit_id:    form.unit_id  || null,
        unit_name:  resolveUnitName(unitOptions, form.unit_id),
        shift_type: form.shift_type,
        phone:      form.phone.trim() || null,
        notes:      form.notes.trim() || null,
        is_active:  true,
      }

      let result
      if (initialData) {
        const { data, error: err } = await safeWrite(
          () => supabase.from('preceptors').update(payload).eq('id', initialData.id).select().single(),
          { name: 'update preceptor' }
        )
        result = { data, error: err }
      } else {
        const { data, error: err } = await safeWrite(
          () => supabase.from('preceptors').insert(payload).select().single(),
          { name: 'insert preceptor' }
        )
        result = { data, error: err }
      }

      if (result.error) {
        console.error('[PreceptorFormModal] save error:', result.error)
        if (result.error.code === '23505') {
          setError('A preceptor with this email already exists. Use the assignment panel to link them to a student instead.')
        } else {
          setError(result.error.message || 'Failed to save preceptor.')
        }
        return
      }

      // Create cohort participation record when adding a new preceptor with cohort context
      if (cohortId && !initialData && result.data) {
        // The LOCAL date, via the shared helper. The UTC-derived date is already
        // tomorrow after ~5pm Pacific, which would file started_at a day late.
        const today = toLocalDateStr()
        const { error: partErr } = await safeWrite(
          () => supabase.from('preceptor_cohort_participation').insert({
            preceptor_id: result.data.id,
            cohort_id:    cohortId,
            status:       'active',
            started_at:   today,
          }),
          { name: 'insert cohort participation' }
        )
        if (partErr) console.error('[PreceptorFormModal] cohort participation insert failed:', partErr)
      }

      // ── Auto-sync preceptor to ASPIRE Connect Contacts ────────────────────────
      // Non-blocking: preceptor is already saved. 409 = already in Contacts (fine).
      // Any other failure shows a brief warning and auto-closes - never blocks the save.
      if (result.data?.email) {
        const sync = await syncPreceptorContact(result.data, { role: form.role, avatar_url: form.avatar_url })
        queryClient.invalidateQueries({ queryKey: ['preceptor_contact_details'] })
        if (sync.status === 'error') {
          setSyncNote(`Preceptor saved. The title and photo were not saved to the contact${sync.message ? `: ${sync.message}` : '.'} You can set them in ASPIRE Connect > Contacts.`)
          queryClient.invalidateQueries({ queryKey: ['preceptors'] })
          onSaved?.(result.data)
          setSaving(false)
          setTimeout(onClose, 3000)
          return
        }
      }

      queryClient.invalidateQueries({ queryKey: ['preceptors'] })
      onSaved?.(result.data)
      onClose()
    } catch (err) {
      console.error('[PreceptorFormModal] unexpected error:', err)
      setError(err.message || 'An unexpected error occurred.')
    } finally {
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
            {syncNote && (
              <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '8px 12px', marginBottom: 8 }}>
                {syncNote}
              </div>
            )}

            {/* PRECEPTOR-TITLE-PHOTO-1: the photo leads the form like a contact
                card. Photo and Role/Title are the contact's, so both need an
                email to find or create that contact. */}
            <div className="preceptor-form-card" data-testid="preceptor-photo-card">
              <button
                type="button"
                className={`preceptor-form-photo-circle${form.avatar_url ? ' has-photo' : ''}`}
                data-testid="preceptor-photo-button"
                onClick={() => fileRef.current?.click()}
                disabled={!emailUsable || uploadingPhoto}
                aria-label={form.avatar_url ? 'Change photo' : 'Upload photo'}
              >
                {form.avatar_url && <img src={form.avatar_url} alt="" onError={e => { e.currentTarget.style.display = 'none' }} />}
                {!form.avatar_url && (uploadingPhoto
                  ? <span>Uploading…</span>
                  : <><Camera size={20} strokeWidth={1.75} aria-hidden="true" /><span>Upload Photo</span></>)}
              </button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
                data-testid="preceptor-photo-input" onChange={handlePhotoUpload} />
              {form.avatar_url && (
                <div className="preceptor-form-photo-links">
                  {uploadingPhoto ? <span>Uploading…</span> : (
                    <>
                      <button type="button" className="preceptor-form-link" onClick={() => fileRef.current?.click()}>Change</button>
                      <button type="button" className="preceptor-form-link"
                        onClick={() => { setContactField({ avatar_url: '' }); setUploadErr(null) }}>Remove</button>
                    </>
                  )}
                </div>
              )}
              {uploadErr && <div className="preceptor-form-error" role="alert">{uploadErr}</div>}
              <p className="preceptor-form-hint" data-testid="preceptor-contact-hint">
                {!emailUsable
                  ? 'Add an email to set a role/title or photo.'
                  : contactState === 'loading'
                    ? 'Looking up the ASPIRE Connect contact…'
                    : contact
                      ? `Role/Title and photo are saved on ${contact.full_name}'s ASPIRE Connect contact. ${CONTACT_AVATAR_HINT}.`
                      : `Role/Title and photo are saved to a new ASPIRE Connect contact. ${CONTACT_AVATAR_HINT}.`}
              </p>
            </div>

            <div className="form-grid form-grid-2">
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
              <div className="form-field">
                <label className="form-label" htmlFor="preceptor-title-select">Role/Title</label>
                <select
                  id="preceptor-title-select"
                  className="form-select"
                  data-testid="preceptor-title-select"
                  value={form.role_custom ? CUSTOM_TITLE : (form.role || '')}
                  onChange={e => handleTitleSelect(e.target.value)}
                  disabled={!emailUsable}
                >
                  <option value="">Not specified</option>
                  {titleOptions.map(t => <option key={t} value={t}>{t}</option>)}
                  {legacyTitle && !form.role_custom && <option value={legacyTitle}>{legacyTitle}</option>}
                  {allowsFreeText && <option value={CUSTOM_TITLE}>Other</option>}
                </select>
                {form.role_custom && (
                  <input
                    className="form-input preceptor-form-custom-title"
                    value={form.role}
                    onChange={e => setContactField({ role: e.target.value })}
                    placeholder="Type the role or title"
                    aria-label="Custom role or title"
                    maxLength={120}
                  />
                )}
              </div>
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
                <select className="form-select" data-testid="preceptor-unit-select" value={form.unit_id} onChange={e => set('unit_id', e.target.value)}>
                  <option value="">Select unit…</option>
                  {unitOptions.map(u => <option key={u.id} value={u.id}>{optionLabel(u)}</option>)}
                </select>
                {/* The stored unit is not one of this cohort's units. It is kept
                    exactly as saved so changing another field cannot alter it. */}
                {(resolution === 'legacy' || resolution === 'ambiguous') && (
                  <div data-testid="preceptor-unit-legacy-note"
                    style={{ marginTop: 6, fontSize: 11, lineHeight: 1.45, color: '#92400e' }}>
                    {resolution === 'ambiguous'
                      ? 'This preceptor’s saved unit is from another cohort, and more than one unit here shares its name. It is kept as saved rather than guessing which one to use.'
                      : 'This preceptor’s saved unit is not part of the active cohort. It is kept as saved unless you pick a different one.'}
                  </div>
                )}
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
            <button type="submit" className="btn btn-primary" disabled={saving || uploadingPhoto || !!syncNote}>
              {saving ? 'Saving…' : initialData ? 'Save Changes' : 'Add Preceptor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
