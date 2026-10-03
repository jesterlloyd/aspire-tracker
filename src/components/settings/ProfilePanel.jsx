// TOPBAR-PROFILE-1 (2026-10-02): Settings > General > Profile. One card, three sections:
// Photo, Your details, Connect signature (#signature). It replaces the Email Signature page,
// whose fields were profile details, and takes the photo controls out of the profile menu.
// Reference: docs/mockups/topbar-profile.html.
//
// WHERE EACH VALUE LIVES (nothing new is stored):
//   - Display name is the account's name, user_profiles.full_name. It is written by the
//     self-only RPC update_my_profile (20261103000000_my_profile_name.sql, Owner-gated).
//     Before that migration the RPC does not exist; the save falls back to the signature
//     RPC and says the account name has not changed.
//   - Credentials, title, department, phone and the include switch are the signature's own
//     fields, in user_profiles.connect_signature, read by Connect exactly as before
//     (api/connect-send-direct-email.js, api/connect-send-bulk-message.js).
//   - Email is the sign-in email. Read-only.
//
// THE TWO NAMES. Connect signs with connect_signature.display_name, which could differ from
// the account name. A difference is shown, never resolved behind the person's back: the
// signature keeps its own name until the person edits the Display name field.
// db/audit/my_profile_name_conflicts.sql lists every account where the two differ.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { getAvatarUrl } from '../../lib/getAvatar'
import { useMyAvatar } from '../../hooks/useMyAvatar'
import { setUnsavedChanges, confirmLeave } from '../../lib/unsavedChanges'
import { connectSignatureImagePath, CONNECT_SIGNATURE_DEFAULT_AFFILIATION } from '../../lib/connectSignatureAssets'
import SurfaceCard from '../ui/SurfaceCard'
import SettingsPageHeader from './SettingsPageHeader'
import './profilePanel.css'

const ROLE_NAMES = { owner: 'Owner', admin: 'Admin', interviewer: 'Interviewer', viewer: 'Viewer' }

// The RPC is absent until its migration is applied: PostgREST answers PGRST202, Postgres 42883.
function isMissingFunction(error) {
  return error?.code === 'PGRST202' || error?.code === '42883'
}

function initialForm(profile) {
  const sig = (profile?.connect_signature && typeof profile.connect_signature === 'object') ? profile.connect_signature : {}
  return {
    display_name:      profile?.full_name || sig.display_name || '',
    credentials:       sig.credentials || '',
    title:             sig.title || '',
    department:        sig.department || '',
    phone:             sig.phone || '',
    signature_enabled: sig.signature_enabled !== false,
  }
}

function Field({ id, label, required, help, children }) {
  return (
    <div className="pf-field">
      <label htmlFor={id} className="pf-label">
        {label}{required && <span aria-hidden="true"> *</span>}
      </label>
      {children}
      {help && <span className="pf-help" id={`${id}-help`}>{help}</span>}
    </div>
  )
}

export default function ProfilePanel() {
  const { userProfile, refreshUserProfile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { uploading, fileInputRef, handleAvatarUpload, handleAvatarRemove } = useMyAvatar()

  const saved = useMemo(() => initialForm(userProfile), [userProfile])
  const [form, setForm] = useState(saved)
  const [nameTouched, setNameTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(null) // null | { ok, msg }

  // A fresh profile (after a save, or a late load) resets the form to what is stored.
  useEffect(() => { setForm(saved); setNameTouched(false) }, [saved])

  const dirty = Object.keys(saved).some(k => form[k] !== saved[k])
  useEffect(() => {
    setUnsavedChanges(dirty ? 'Profile' : null)
    if (!dirty) return undefined
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])
  useEffect(() => () => setUnsavedChanges(null), [])

  // /settings/general/signature redirects to #signature; land on that section.
  useEffect(() => {
    if (location.hash === '#signature') document.getElementById('signature')?.scrollIntoView({ block: 'start' })
  }, [location.hash])

  if (!userProfile) return null

  const email = userProfile.email || ''
  const accountName = (userProfile.full_name || '').trim()
  const sig = (userProfile.connect_signature && typeof userProfile.connect_signature === 'object') ? userProfile.connect_signature : {}
  const signatureName = String(sig.display_name || '').trim()
  const namesDiffer = Boolean(signatureName && accountName && signatureName !== accountName)
  const roleName = userProfile.is_owner ? 'Owner' : (ROLE_NAMES[userProfile.role] || 'Viewer')

  const set = (k, v) => {
    setForm(p => ({ ...p, [k]: v }))
    if (k === 'display_name') setNameTouched(true)
    setStatus(null)
  }

  const handleSave = async () => {
    const name = form.display_name.trim()
    if (!name) { setStatus({ ok: false, msg: 'Display name is required.' }); return }
    setSaving(true); setStatus(null)
    // The signature keeps its own name while the two differ and the field was not edited.
    const signatureDisplayName = namesDiffer && !nameTouched ? signatureName : name
    const p_signature = {
      display_name:      signatureDisplayName,
      credentials:       form.credentials.trim(),
      title:             form.title.trim(),
      department:        form.department.trim(),
      phone:             form.phone.trim(),
      signature_enabled: !!form.signature_enabled,
    }
    try {
      let accountRenamed = true
      let { error } = await supabase.rpc('update_my_profile', { p_full_name: name, p_signature })
      if (error && isMissingFunction(error)) {
        accountRenamed = false
        ;({ error } = await supabase.rpc('update_my_connect_signature', { p_signature }))
      }
      if (error) { setStatus({ ok: false, msg: error.message || 'Could not save your profile.' }); setSaving(false); return }
      setUnsavedChanges(null)
      await refreshUserProfile?.()
      setStatus(!accountRenamed && name !== accountName
        ? { ok: true, msg: 'Saved. Your Connect signature uses the new name; your account name has not changed yet, because account name editing is not switched on.' }
        : { ok: true, msg: 'Profile saved.' })
    } catch (e) {
      setStatus({ ok: false, msg: e.message || 'Could not save your profile.' })
    }
    setSaving(false)
  }

  const openUsersAccess = async () => {
    if (await confirmLeave()) navigate('/settings/users')
  }

  // SIGNATURE-PREVIEW-PARITY-1: the preview mirrors the SENT block from
  // lib/server/connect/emailTemplates.js signatureBlock, as the Email Signature page did.
  const affiliation = form.department.trim() || CONNECT_SIGNATURE_DEFAULT_AFFILIATION
  const sigImagePath = connectSignatureImagePath(email)
  const previewName = (namesDiffer && !nameTouched ? signatureName : form.display_name.trim()) || '-'

  return (
    <section aria-labelledby="settings-profile-heading">
      <SettingsPageHeader
        id="settings-profile-heading"
        title="Profile"
        subtitle="How you appear to your team. Your Connect signature is built from these details."
      />
      <SurfaceCard className="pf-card" padding={0}>
        {/* 1. Photo: the profile menu's handlers, unchanged (useMyAvatar). */}
        <div className="pf-sec">
          <h3 className="pf-h">Photo</h3>
          <div className="pf-photo">
            <span className="pf-avatar">
              <img src={getAvatarUrl(userProfile)} alt={`Your photo, ${accountName}`} />
            </span>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp"
              onChange={handleAvatarUpload} hidden aria-hidden="true" tabIndex={-1} />
            <div className="pf-photo-actions">
              <button type="button" className="pf-btn" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? 'Uploading…' : userProfile.avatar_url ? 'Change photo' : 'Upload photo'}
              </button>
              {userProfile.avatar_url && !uploading && (
                <button type="button" className="pf-btn pf-btn-quiet" onClick={handleAvatarRemove}>Remove photo</button>
              )}
            </div>
          </div>
        </div>

        {/* 2. Your details. */}
        <div className="pf-sec">
          <h3 className="pf-h">Your Details</h3>
          <div className="pf-grid">
            <Field id="pf-name" label="Display name" required
              help={namesDiffer && !nameTouched ? `Your Connect signature signs as “${signatureName}”. Edit this name and save to use one name for both.` : 'Shown on messages, signatures and outreach.'}>
              <input id="pf-name" className="pf-input" value={form.display_name} required aria-required="true"
                aria-describedby="pf-name-help" maxLength={120} autoComplete="name"
                onChange={e => set('display_name', e.target.value)} />
            </Field>
            <Field id="pf-cred" label="Credentials">
              <input id="pf-cred" className="pf-input" value={form.credentials} maxLength={120} placeholder="e.g. DNP, RN, NPD-BC"
                onChange={e => set('credentials', e.target.value)} />
            </Field>
            <Field id="pf-title" label="Title">
              <input id="pf-title" className="pf-input" value={form.title} maxLength={120} placeholder="e.g. ASPIRE Co-Lead"
                autoComplete="organization-title" onChange={e => set('title', e.target.value)} />
            </Field>
            <Field id="pf-dept" label="Department">
              <input id="pf-dept" className="pf-input" value={form.department} maxLength={160} placeholder={CONNECT_SIGNATURE_DEFAULT_AFFILIATION}
                onChange={e => set('department', e.target.value)} />
            </Field>
            <Field id="pf-email" label="Email" help="Your sign-in email. It can’t be changed here.">
              <input id="pf-email" className="pf-input" value={email} readOnly aria-describedby="pf-email-help" />
            </Field>
            <Field id="pf-phone" label="Phone">
              <input id="pf-phone" className="pf-input" type="tel" value={form.phone} maxLength={40} placeholder="e.g. 310-248-8964"
                autoComplete="tel" onChange={e => set('phone', e.target.value)} />
            </Field>
          </div>
          <p className="pf-role">
            Role: <strong>{roleName}</strong>{' · '}
            {isAdmin
              ? <button type="button" className="pf-link" onClick={openUsersAccess}>Managed in Users &amp; Access</button>
              : <span>Managed by an Owner or Admin</span>}
          </p>
        </div>

        {/* 3. Connect signature. */}
        <div className="pf-sec">
          <h3 className="pf-h" id="signature">Connect Signature</h3>
          <p className="pf-hint">Used on emails you write in ASPIRE Connect. Automated program emails (reminders, notifications) do not use it.</p>
          <label className="pf-check">
            <input type="checkbox" checked={form.signature_enabled} onChange={e => set('signature_enabled', e.target.checked)} />
            Include my signature on emails I write in Connect
          </label>
          <div className="pf-preview" aria-live="polite">
            <div className="pf-preview-label">Preview</div>
            {form.signature_enabled ? (
              <>
                <div className="pf-preview-off">Kind regards,</div>
                {sigImagePath && (
                  <img src={sigImagePath} alt="" aria-hidden="true" width={160} height={60} className="pf-preview-hand" />
                )}
                <div><strong className="pf-preview-name">{previewName}{form.credentials.trim() ? `, ${form.credentials.trim()}` : ''}</strong></div>
                {form.title.trim() && <div>{form.title.trim()}</div>}
                <div>{affiliation}</div>
                {email && (
                  <div className="pf-preview-contact"><a href={`mailto:${email}`}>{email}</a>{form.phone.trim() ? ` | Office: ${form.phone.trim()}` : ''}</div>
                )}
              </>
            ) : (
              // The truth about "off": the email is not unsigned. resolveSenderSignature falls
              // back to a default block (a seeded one for the program leads, else name and role).
              <span className="pf-preview-none">Your Connect emails will use the default signature instead.</span>
            )}
          </div>
        </div>

        <div className="pf-foot">
          {status && (
            <span role="status" className={status.ok ? 'pf-status pf-status-ok' : 'pf-status pf-status-bad'}>{status.msg}</span>
          )}
          {!status && <span className="pf-saved" aria-live="polite">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>}
          <button type="button" className="pf-save" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </SurfaceCard>
    </section>
  )
}
