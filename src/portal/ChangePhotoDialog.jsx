// PROFILE-MENU-AVATARS-1: self-service profile photo for portal users, opened
// from the shared profile menu. One dialog, two modes bound to the canonical
// store the server writes for the caller's role:
//   mode="headshot" (student)      -> POST /api/portal/my-avatar updates the
//                                     canonical students.headshot_url (replace
//                                     only; the headshot is a required intake
//                                     document and cannot be removed).
//   mode="profile" (UL / AP)       -> the same endpoint updates
//                                     user_profiles.avatar_url and mirrors the
//                                     matching Connect contact; Remove offered.
// Client-side validation mirrors the server rules; the server re-validates
// (fixed type map, decoded size, magic bytes) and derives the storage path
// itself, so nothing here is trusted.
import { useState, useRef, useEffect } from 'react'
import { Camera } from 'lucide-react'
import { supabase } from '../lib/supabase'

const RULES = {
  headshot: { types: ['image/jpeg', 'image/png'], maxBytes: 5 * 1024 * 1024, accept: 'image/jpeg,image/png', typeLabel: 'JPG or PNG', sizeLabel: '5MB' },
  profile:  { types: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 2 * 1024 * 1024, accept: 'image/jpeg,image/png,image/webp', typeLabel: 'JPG, PNG, or WebP', sizeLabel: '2MB' },
}

export default function ChangePhotoDialog({ mode = 'profile', hasPhoto = false, onClose, onSaved }) {
  const rules = RULES[mode] || RULES.profile
  const [picked, setPicked] = useState(null) // { dataUrl, contentType, name }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)
  const panelRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.() }
    document.addEventListener('keydown', onKey)
    setTimeout(() => panelRef.current?.querySelector('button')?.focus(), 10)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const pickFile = (e) => {
    setError('')
    const file = e.target.files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    if (!rules.types.includes(file.type)) { setError(`Please choose a ${rules.typeLabel} image.`); return }
    if (file.size > rules.maxBytes) { setError(`The image must be under ${rules.sizeLabel}.`); return }
    const reader = new FileReader()
    reader.onload = () => setPicked({ dataUrl: String(reader.result), contentType: file.type, name: file.name })
    reader.onerror = () => setError('Could not read that file. Please try another image.')
    reader.readAsDataURL(file)
  }

  const post = async (body) => {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    const res = await fetch('/api/portal/my-avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, data }
  }

  const save = async () => {
    if (!picked || busy) return
    setBusy(true); setError('')
    try {
      const { ok, data } = await post({ content_type: picked.contentType, data_base64: picked.dataUrl })
      if (!ok) { setError(data.message || 'Could not save your photo. Please try again.'); return }
      onSaved?.(data)
      onClose?.()
    } catch {
      setError('Could not save your photo. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const { ok, data } = await post({ action: 'remove' })
      if (!ok) { setError(data.message || 'Could not remove your photo. Please try again.'); return }
      onSaved?.(data)
      onClose?.()
    } catch {
      setError('Could not remove your photo. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="ptl-photo-backdrop" onClick={() => !busy && onClose?.()} />
      <div ref={panelRef} className="ptl-photo-dialog" role="dialog" aria-modal="true" aria-label="Change your photo">
        <h2 className="ptl-photo-title"><Camera size={17} aria-hidden="true" /> Change Photo</h2>
        <p className="ptl-photo-hint">
          {mode === 'headshot'
            ? `Your photo appears on your profile, rosters, and your hospital badge. ${RULES.headshot.typeLabel}, under ${RULES.headshot.sizeLabel}.`
            : `Your photo appears in your portal and to the ASPIRE team. ${RULES.profile.typeLabel}, under ${RULES.profile.sizeLabel}.`}
        </p>
        <div className="ptl-photo-preview" aria-hidden="true">
          {picked
            ? <img src={picked.dataUrl} alt="" />
            : <span className="ptl-photo-preview-empty"><Camera size={22} /></span>}
        </div>
        <input ref={fileRef} type="file" accept={rules.accept} onChange={pickFile} style={{ display: 'none' }} />
        {error && <div className="ptl-photo-error" role="alert">{error}</div>}
        <div className="ptl-photo-actions">
          <button type="button" className="ptl-photo-choose" disabled={busy} onClick={() => fileRef.current?.click()}>
            {picked ? 'Choose a different image' : 'Choose an image'}
          </button>
          <button type="button" className="ptl-photo-save" disabled={!picked || busy} onClick={save}>
            {busy ? 'Saving…' : 'Save photo'}
          </button>
        </div>
        <div className="ptl-photo-footrow">
          {mode === 'profile' && hasPhoto && (
            <button type="button" className="ptl-photo-remove" disabled={busy} onClick={remove}>Remove photo</button>
          )}
          <button type="button" className="ptl-photo-cancel" disabled={busy} onClick={() => onClose?.()}>Cancel</button>
        </div>
      </div>
    </>
  )
}
