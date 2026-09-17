import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { createUnitPreceptor } from './unitLeaderApi'
import { createUnitPreceptorCreationController } from './unitPreceptorCreation'
import { CUSTOM_TITLE, titleChoices } from '../../lib/preceptorContact'
import { validateContactAvatar, CONTACT_AVATAR_HINT } from '../../lib/contactAvatarUpload'

const SHIFTS = ['Day', 'Night', 'Mid', 'Variable']
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function messageFor(result) {
  if (result.error === 'submission_in_progress') return 'This preceptor is already being submitted.'
  if (result.error === 'image_too_large') return 'The photo must be under 2 MB.'
  if (result.error === 'invalid_content_type' || result.error === 'image_type_mismatch' || result.error === 'invalid_image_data') {
    return 'The photo must be a JPEG, PNG, or WebP image.'
  }
  if (result.error === 'invalid_title') return 'The role or title must be 120 characters or fewer.'
  if (result.status === 409) return 'A preceptor with this email already exists.'
  if (result.status === 403 || result.status === 404) return 'You are not authorized to create a preceptor under that unit.'
  if (result.status === 400) return 'Check the preceptor details and try again.'
  return 'The preceptor could not be created. Please try again.'
}

// The contact-save outcome, when it needs saying. The preceptor is created either way.
function contactNoteFor(status) {
  if (status === 'error') return 'Preceptor added. The role/title and photo were not saved to the ASPIRE Connect contact. An Owner or Admin can set them in ASPIRE Connect > Contacts.'
  if (status === 'skipped') return 'Preceptor added. This email belongs to an ASPIRE Connect contact that is not a preceptor, so that contact was left unchanged.'
  return null
}

// A File as { content_type, data_base64 } for the JSON request.
function readPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      const comma = text.indexOf(',')
      resolve({ content_type: file.type, data_base64: comma === -1 ? '' : text.slice(comma + 1) })
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// Unit Leader Add Preceptor. Presentation converges on the canonical main-app modal
// (PreceptorFormModal): same overlay, header, photo card, .form-* grid, and .modal-footer .btn
// pairing, so the two modals look identical. The write path stays Unit Leader specific: the
// portal endpoint's create_preceptor action runs the scoped create_unit_preceptor RPC, which
// authorizes against the leader's own unit scope (unitKeys) and accepts only full_name, email,
// unit_key, shift, phone. That RPC has no notes column, so the canonical Notes field is
// intentionally omitted here rather than shown and silently discarded.
//
// UL-PRECEPTOR-TITLE-PHOTO-1: Role/Title and photo are saved on the preceptor's ASPIRE Connect
// contact, as in the main app, but by the server after the scoped create succeeds (a Unit Leader
// has no contacts or Storage write). The photo is previewed locally and sent with the create, so
// nothing is uploaded for a preceptor that is never added. A leader cannot read contacts, so the
// form does not pre-fill an existing contact's title or photo; blank fields never clear them.
export default function UnitPreceptorCreateModal({ unitKeys, onClose, onCreated }) {
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', unit_key: '', shift: 'Variable', role: '', role_custom: false,
  })
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState('')
  const [photoError, setPhotoError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [contactNote, setContactNote] = useState(null)
  const fileRef = useRef(null)
  const controller = useMemo(() => createUnitPreceptorCreationController({ create: createUnitPreceptor }), [])

  const set = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const emailUsable = EMAIL_SHAPE.test(form.email.trim().toLowerCase())
  const { options: titleOptions, allowsFreeText } = titleChoices(null, form.role)

  // The local preview URL is released when it is replaced and when the modal closes.
  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview) }, [photoPreview])

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

  const handleTitleSelect = (value) => {
    if (value === CUSTOM_TITLE) setForm(current => ({ ...current, role_custom: true, role: '' }))
    else setForm(current => ({ ...current, role_custom: false, role: value }))
  }

  const choosePhoto = (event) => {
    const file = event.target.files?.[0]
    if (event.target) event.target.value = ''
    if (!file) return
    const invalid = validateContactAvatar(file)
    if (invalid) { setPhotoError(invalid); return }
    setPhotoError(null)
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  const removePhoto = () => {
    setPhotoFile(null)
    setPhotoPreview('')
    setPhotoError(null)
  }

  const submit = async (event) => {
    event.preventDefault()
    if (saving) return
    if (!form.full_name.trim() || !form.email.trim() || !form.unit_key || !form.shift) {
      setError('Name, email, unit, and shift are required.')
      return
    }

    setSaving(true)
    setError(null)
    let photo = null
    if (photoFile) {
      try {
        photo = await readPhoto(photoFile)
      } catch {
        setSaving(false)
        setError('The photo could not be read. Choose it again.')
        return
      }
    }
    const result = await controller.submit({
      full_name: form.full_name.trim(),
      email: form.email.trim().toLowerCase(),
      phone: form.phone.trim() || null,
      unit_key: form.unit_key,
      shift: form.shift,
      role: form.role.trim() || null,
      photo,
    })
    if (!result.ok) {
      setSaving(false)
      setError(messageFor(result))
      return
    }
    const note = contactNoteFor(result.data?.contact_sync)
    if (note) {
      setContactNote(note)
      setTimeout(() => onCreated?.(result.data?.result || null), 3000)
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
            {contactNote && (
              <div role="status" style={{
                fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a',
                borderRadius: 'var(--aspire-radius-control)', padding: '8px 12px', marginBottom: 8,
              }}>{contactNote}</div>
            )}

            {/* UL-PRECEPTOR-TITLE-PHOTO-1: the photo leads the form like a contact card, the same
                card as the main app. Photo and Role/Title belong to the contact, so both need an email. */}
            <div className="preceptor-form-card" data-testid="ul-preceptor-photo-card">
              <button
                type="button"
                className={`preceptor-form-photo-circle${photoPreview ? ' has-photo' : ''}`}
                onClick={() => fileRef.current?.click()}
                disabled={!emailUsable || saving}
                aria-label={photoPreview ? 'Change photo' : 'Upload photo'}
              >
                {photoPreview && <img src={photoPreview} alt="" />}
                {!photoPreview && <><Camera size={20} strokeWidth={1.75} aria-hidden="true" /><span>Upload Photo</span></>}
              </button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
                data-testid="ul-preceptor-photo-input" onChange={choosePhoto} />
              {photoPreview && (
                <div className="preceptor-form-photo-links">
                  <button type="button" className="preceptor-form-link" disabled={saving} onClick={() => fileRef.current?.click()}>Change</button>
                  <button type="button" className="preceptor-form-link" disabled={saving} onClick={removePhoto}>Remove</button>
                </div>
              )}
              {photoError && <div className="preceptor-form-error" role="alert">{photoError}</div>}
              <p className="preceptor-form-hint">
                {emailUsable
                  ? `Role/Title and photo are saved to the preceptor's ASPIRE Connect contact. ${CONTACT_AVATAR_HINT}.`
                  : 'Add an email to set a role/title or photo.'}
              </p>
            </div>

            <div className="form-grid form-grid-2">
              <div className="form-field">
                <label className="form-label" htmlFor="ul-prec-name">Full Name *</label>
                <input id="ul-prec-name" className="form-input" required maxLength={120} autoFocus
                  placeholder="Jane Smith"
                  value={form.full_name} onChange={event => set('full_name', event.target.value)} />
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="ul-prec-title">Role/Title</label>
                <select id="ul-prec-title" className="form-select" disabled={!emailUsable}
                  value={form.role_custom ? CUSTOM_TITLE : (form.role || '')}
                  onChange={event => handleTitleSelect(event.target.value)}>
                  <option value="">Not specified</option>
                  {titleOptions.map(title => <option key={title} value={title}>{title}</option>)}
                  {allowsFreeText && <option value={CUSTOM_TITLE}>Other</option>}
                </select>
                {form.role_custom && (
                  <input className="form-input preceptor-form-custom-title" maxLength={120}
                    placeholder="Type the role or title" aria-label="Custom role or title"
                    value={form.role} onChange={event => set('role', event.target.value)} />
                )}
              </div>
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
            <button type="submit" className="btn btn-primary" disabled={saving || Boolean(contactNote)}>
              {saving ? 'Saving…' : 'Add Preceptor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
