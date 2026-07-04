// ACCOUNTS-ACCESS-PROFILE-BOARD-2B: centered Account Profile modal (NOT a DetailDrawer — heroes are
// reserved for people records). One profile-style modal with sections (no internal tabs):
//   A. Hero — avatar, name, email, role/status/interviewer-access badges, online dot, last login/action.
//   B. Account Access — Role, Interviewer access toggle, circular calendar-color swatches, edited in a
//      local draft with a DIRTY-ONLY save bar (Discard / Save changes). Save calls the SAME handlers
//      + payloads as the old Manage Access (onSaveAccess → /api/admin-users update_role /
//      toggle_interviewer / update_interviewer_color). Owner-protected + self-mutation guards preserved
//      (client here; server authoritative).
//   C. Recent Activity — READ-ONLY per-user query (activity_logs, last 30 days by user_name), 5 first +
//      Show more. No schema/endpoint change.
//   D. Account Actions — ONLY the actually-supported actions (Deactivate / Reactivate via onToggleActive).
//      Password reset / resend invite are NOT built (no backend exists).
import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Camera } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  ROLE_OPTIONS, ROLE_BADGE, INTERVIEWER_COLORS,
  displayRole, formatLoginDate, formatRelativeTime, UserInitials, HERO_AVATAR_RING,
} from './accountsShared'

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'
const DEFAULT_COLOR = '#1D2567'

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const PHOTO_MAX_BYTES = 2 * 1024 * 1024

export default function AccountProfileModal({ user, isCurrentUser, online, onSaveAccess, onToggleActive, onUploadPhoto, canSendPasswordReset, onSendPasswordReset, onClose }) {
  const isOwner = !!user.is_owner
  const isInactive = user.is_active === false

  // Local access draft (seeded from the account; owner role is locked to 'owner').
  const original = useMemo(() => ({
    role: isOwner ? 'owner' : (user.role || 'viewer'),
    can_conduct_interviews: !!user.can_conduct_interviews,
    interviewer_color: user.interviewer_color || DEFAULT_COLOR,
  }), [user, isOwner])
  // Seeded once on mount (the modal mounts fresh per opened account), so a background refetch never
  // clobbers in-progress edits; Discard resets back to `original`.
  const [draft, setDraft] = useState(original)
  const [saving, setSaving] = useState(false)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetSending, setResetSending] = useState(false)
  const [resetError, setResetError] = useState('')
  const [visibleActivity, setVisibleActivity] = useState(5)
  const closeBtnRef = useRef(null)

  // ADMIN-AVATAR-UPLOAD-1: photo change is a discrete server action, kept OUT of the access
  // dirty-save bar. Owner / self / inactive targets have no affordance (server enforces the same).
  const canChangePhoto = !!onUploadPhoto && !isOwner && !isCurrentUser && !isInactive
  const photoInputRef = useRef(null)
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState('')
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')

  // Revoke the object URL when the preview changes or the modal unmounts (no leaks).
  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview) }, [photoPreview])

  const handlePhotoPick = (e) => {
    const file = e.target.files?.[0]
    if (e.target) e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    setPhotoError('')
    if (!PHOTO_TYPES.includes(file.type)) { setPhotoError('Please choose a JPG, PNG, or WebP image.'); return }
    if (file.size > PHOTO_MAX_BYTES)      { setPhotoError('Image must be under 2MB.'); return }
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  const cancelPhoto = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoFile(null); setPhotoPreview(''); setPhotoError('')
  }

  const handlePhotoUpload = async () => {
    if (!photoFile || photoUploading) return
    setPhotoUploading(true); setPhotoError('')
    try {
      const result = await onUploadPhoto?.(user, photoFile)
      if (result?.ok) {
        cancelPhoto() // refetched avatar_url now drives the hero/card; drop the local preview
      } else {
        setPhotoError(result?.error || 'Could not update the photo.')
      }
    } finally {
      setPhotoUploading(false)
    }
  }

  const dirty =
    draft.role !== original.role ||
    draft.can_conduct_interviews !== original.can_conduct_interviews ||
    draft.interviewer_color !== original.interviewer_color

  // Focus into the modal on open; Esc closes only when there are no unsaved changes.
  useEffect(() => {
    const t = setTimeout(() => closeBtnRef.current?.focus(), 30)
    const onKey = (e) => { if (e.key === 'Escape' && !dirty) onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey) }
  }, [dirty, onClose])

  // Recent activity — READ-ONLY, per-user, last 30 days. New (non-protected) query key.
  const { data: activity = [], isLoading: activityLoading } = useQuery({
    queryKey: ['account_activity', user.id],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase
        .from('activity_logs').select('*')
        .eq('user_name', user.full_name)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!user.full_name,
  })
  const lastAction = activity[0] || null

  const set = (field, value) => setDraft(d => ({ ...d, [field]: value }))
  const requestClose = () => { if (!dirty) onClose?.() /* else keep open; the save bar is the exit */ }

  const handleSave = async () => {
    setSaving(true)
    try {
      const ok = await onSaveAccess?.(user, draft) // same payloads as Manage Access
      if (ok !== false) onClose?.()
    } finally {
      setSaving(false)
    }
  }

  const handleSendReset = async () => {
    if (resetSending) return
    setResetSending(true); setResetError('')
    try {
      const result = await onSendPasswordReset?.(user)
      if (result?.ok) setConfirmReset(false)          // parent toast confirms success
      else setResetError(result?.error || 'Could not send password reset. Please try again.')
    } finally {
      setResetSending(false)
    }
  }

  const rb = isOwner ? ROLE_BADGE.owner : (ROLE_BADGE[user.role] || ROLE_BADGE.viewer)
  const label = { display: 'block', fontFamily: F, fontWeight: 600, fontSize: 12, color: '#374151', marginBottom: 6 }
  const sectionTitle = { fontFamily: F, fontWeight: 700, fontSize: 12.5, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }
  const canDeactivate = !isOwner && !isCurrentUser

  return (
    <div
      onClick={requestClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Account profile: ${user.full_name}`}
      style={{ position: 'fixed', inset: 0, zIndex: 2200, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: F, padding: 16 }}
    >
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: 'min(560px, 100%)', maxHeight: 'min(760px, 92vh)', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(16,24,40,0.24)', overflow: 'hidden' }}>

        {/* Close */}
        <button ref={closeBtnRef} type="button" onClick={requestClose} aria-label="Close"
          style={{ position: 'absolute', margin: 12, alignSelf: 'flex-end', background: 'rgba(255,255,255,0.7)', border: 'none', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#374151', zIndex: 1 }}>
          <X size={18} />
        </button>

        {/* Single scroll body */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {/* A. Hero — soft pastel-blue treatment aligned with the Student Profile / Contacts heroes. */}
          <div style={{ background: 'linear-gradient(160deg, #dceff8 0%, #f0f6fb 50%, #ffffff 100%)', padding: '32px 24px 22px', textAlign: 'center' }}>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              {photoPreview ? (
                <img src={photoPreview} alt="New profile photo preview"
                  style={{ width: 84, height: 84, borderRadius: '50%', objectFit: 'cover', ...HERO_AVATAR_RING }} />
              ) : (
                <UserInitials user={user} size={84} ring={HERO_AVATAR_RING} />
              )}
              {online && !photoPreview && <span title="Online now" style={{ position: 'absolute', bottom: 5, right: 5, width: 16, height: 16, borderRadius: '50%', background: '#10B981', border: '3px solid #fff' }} />}
              {canChangePhoto && !photoPreview && (
                <button type="button" onClick={() => photoInputRef.current?.click()}
                  title="Change photo" aria-label="Change photo"
                  style={{ position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: '50%', background: NAVY, border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', padding: 0, boxShadow: '0 1px 4px rgba(29,37,103,0.3)' }}>
                  <Camera size={14} />
                </button>
              )}
            </div>
            {canChangePhoto && (
              <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp"
                onChange={handlePhotoPick} style={{ display: 'none' }} />
            )}
            {canChangePhoto && (photoPreview || photoError) && (
              <div style={{ marginTop: 12 }}>
                {photoPreview && (
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <button type="button" onClick={cancelPhoto} disabled={photoUploading}
                      style={{ padding: '7px 16px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', fontFamily: F, fontSize: 12.5, fontWeight: 600, color: '#374151', cursor: photoUploading ? 'default' : 'pointer' }}>Cancel</button>
                    <button type="button" onClick={handlePhotoUpload} disabled={photoUploading}
                      style={{ padding: '7px 18px', border: 'none', borderRadius: 8, background: photoUploading ? '#e5e7eb' : NAVY, color: '#fff', fontFamily: F, fontSize: 12.5, fontWeight: 700, cursor: photoUploading ? 'default' : 'pointer' }}>{photoUploading ? 'Uploading…' : 'Save photo'}</button>
                  </div>
                )}
                {photoError && <div style={{ marginTop: 8, fontSize: 12, color: '#b91c1c' }}>{photoError}</div>}
              </div>
            )}
            <div style={{ fontSize: 20, fontWeight: 700, color: NAVY, marginTop: 12 }}>{user.full_name}{isCurrentUser && <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic', fontWeight: 400 }}> (you)</span>}</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{user.email}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginTop: 12 }}>
              <span style={{ background: rb.bg, color: rb.text, fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }}>{displayRole(user)}</span>
              <span style={{ background: isInactive ? '#F3F4F6' : '#EDF7F0', color: isInactive ? '#6B7280' : '#166534', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }}>{isInactive ? 'Inactive' : 'Active'}</span>
              {user.can_conduct_interviews && displayRole(user) !== 'Interviewer' && (
                <span title="Interviewer access" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#E0E7FF', color: '#3730A3', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }}>
                  Interviewer <span style={{ width: 8, height: 8, borderRadius: '50%', background: user.interviewer_color || DEFAULT_COLOR }} />
                </span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 10 }}>
              Last login: {formatLoginDate(user.last_login_at)}
              {lastAction && <> · Last action: {lastAction.description} ({formatRelativeTime(lastAction.created_at)})</>}
            </div>
            {isOwner && <div style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic', marginTop: 6 }}>Protected account</div>}
          </div>

          <div style={{ padding: '20px 24px 24px' }}>
            {/* B. Account Access */}
            <div style={{ marginBottom: 22 }}>
              <div style={sectionTitle}>Account Access</div>

              <div style={{ marginBottom: 14 }}>
                <label style={label}>App Role {isOwner && <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>(Owner role cannot be changed)</span>}</label>
                <select value={draft.role} disabled={isOwner}
                  onChange={e => set('role', e.target.value)}
                  style={{ width: '100%', height: 38, padding: '0 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontFamily: F, fontSize: 13, outline: 'none', opacity: isOwner ? 0.5 : 1, cursor: isOwner ? 'not-allowed' : 'pointer', background: '#fff' }}>
                  {isOwner
                    ? <option value="owner">Owner</option>
                    : ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label} — {r.description}</option>)}
                </select>
              </div>

              {draft.role !== 'viewer' && (
                <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontFamily: F, fontWeight: 600, fontSize: 12, color: '#374151' }}>Interviewer access</div>
                    <div style={{ fontFamily: F, fontSize: 11, color: '#9ca3af' }}>Appears in scheduling and rubric dropdowns</div>
                  </div>
                  {draft.role === 'interviewer' ? (
                    <span style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>Always on for Interviewers</span>
                  ) : (
                    <button type="button" aria-pressed={draft.can_conduct_interviews} aria-label="Interviewer access"
                      onClick={() => set('can_conduct_interviews', !draft.can_conduct_interviews)}
                      style={{ width: 40, height: 22, borderRadius: 11, border: 'none', background: draft.can_conduct_interviews ? NAVY : '#e5e7eb', position: 'relative', cursor: 'pointer', transition: 'background 0.2s ease', flexShrink: 0 }}>
                      <span style={{ position: 'absolute', top: 3, left: draft.can_conduct_interviews ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s ease', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                    </button>
                  )}
                </div>
              )}

              {(draft.can_conduct_interviews || draft.role === 'interviewer') && (
                <div>
                  <label style={{ ...label, marginBottom: 4 }}>Interview Calendar Color</label>
                  <div style={{ fontFamily: F, fontSize: 11, color: '#9ca3af', marginBottom: 10 }}>Used for availability blocks, interviewer legend, and calendar items.</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {INTERVIEWER_COLORS.map(c => {
                      const selected = (draft.interviewer_color || DEFAULT_COLOR) === c.hex
                      return (
                        <button key={c.hex} type="button" title={c.name} aria-label={`Interviewer color: ${c.name}`} aria-pressed={selected}
                          onClick={() => set('interviewer_color', c.hex)}
                          style={{ width: 30, height: 30, borderRadius: '50%', background: c.hex, cursor: 'pointer', padding: 0, border: '2px solid #ffffff', boxShadow: selected ? `0 0 0 2px ${NAVY}` : '0 0 0 1px #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'box-shadow 0.15s ease' }}>
                          {selected && <span style={{ color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* C. Recent Activity */}
            <div style={{ marginBottom: 22 }}>
              <div style={sectionTitle}>Recent Activity <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#9ca3af' }}>· last 30 days</span></div>
              {activityLoading ? (
                <div style={{ fontSize: 12.5, color: '#9ca3af' }}>Loading activity…</div>
              ) : activity.length === 0 ? (
                <div style={{ fontSize: 12.5, color: '#9ca3af', fontStyle: 'italic' }}>No recorded activity in the last 30 days.</div>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {activity.slice(0, visibleActivity).map(log => (
                      <div key={log.id} style={{ padding: '9px 12px', background: '#f9fafb', borderRadius: 10, border: '1px solid #f3f4f6' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontSize: 12.5, color: '#374151' }}>{log.description}</span>
                          <span style={{ fontSize: 10.5, color: '#9ca3af', whiteSpace: 'nowrap' }}>{formatRelativeTime(log.created_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {activity.length > visibleActivity && (
                    <button type="button" onClick={() => setVisibleActivity(v => v + 5)}
                      style={{ marginTop: 8, background: 'none', border: 'none', color: NAVY, fontFamily: F, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                      Show more ({activity.length - visibleActivity})
                    </button>
                  )}
                </>
              )}
            </div>

            {/* D. Account Actions — only truly-supported actions */}
            <div>
              <div style={sectionTitle}>Account Actions</div>
              {isOwner ? (
                <div style={{ fontSize: 12.5, color: '#9ca3af', fontStyle: 'italic' }}>No actions available for the protected Owner account.</div>
              ) : !canDeactivate ? (
                <div style={{ fontSize: 12.5, color: '#9ca3af', fontStyle: 'italic' }}>No actions available for your own account.</div>
              ) : isInactive ? (
                <button type="button" onClick={async () => { await onToggleActive?.(user.id, false); onClose?.() }}
                  style={{ padding: '8px 16px', border: '1px solid #86efac', borderRadius: 8, background: '#f0fdf4', color: '#166534', fontFamily: F, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                  Reactivate account
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
                  {canSendPasswordReset && onSendPasswordReset && (
                    <button type="button" onClick={() => { setResetError(''); setConfirmReset(true) }}
                      style={{ padding: '8px 16px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb', color: '#374151', fontFamily: F, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                      Send password reset
                    </button>
                  )}
                  <button type="button" onClick={() => setConfirmDeactivate(true)}
                    style={{ padding: '8px 16px', border: '1px solid #fecaca', borderRadius: 8, background: '#fff5f5', color: '#dc2626', fontFamily: F, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                    Deactivate account
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Dirty-only save bar */}
        {dirty && (
          <div style={{ flexShrink: 0, borderTop: '1px solid #eef0f2', background: '#fff', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>Unsaved changes</span>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => setDraft(original)}
                style={{ padding: '8px 16px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb', fontFamily: F, fontSize: 13, cursor: 'pointer' }}>Discard changes</button>
              <button type="button" onClick={handleSave} disabled={saving}
                style={{ padding: '8px 20px', border: 'none', borderRadius: 8, background: saving ? '#e5e7eb' : NAVY, color: '#fff', fontFamily: F, fontWeight: 700, fontSize: 13, cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving…' : 'Save changes'}</button>
            </div>
          </div>
        )}
      </div>

      {/* Send password reset confirm (nested, centered) */}
      {confirmReset && (
        <div onClick={e => { if (!resetSending) { e.stopPropagation(); setConfirmReset(false) } }}
          style={{ position: 'fixed', inset: 0, zIndex: 2400, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: '26px 24px', maxWidth: 380, width: '100%', boxShadow: '0 16px 48px rgba(0,0,0,0.2)' }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: NAVY, marginBottom: 10 }}>Send a password reset email to this user?</div>
            <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6, marginBottom: resetError ? 12 : 20 }}>
              {user.full_name} <span style={{ color: '#9ca3af' }}>({user.email})</span> will receive an email with a link to set a new password.
            </div>
            {resetError && (
              <div style={{ fontSize: 12.5, color: '#991b1b', background: '#fff1f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '8px 12px', marginBottom: 16 }}>{resetError}</div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" disabled={resetSending} onClick={() => setConfirmReset(false)} style={{ padding: '9px 18px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb', fontFamily: F, fontSize: 13, cursor: resetSending ? 'default' : 'pointer' }}>Cancel</button>
              <button type="button" disabled={resetSending} onClick={handleSendReset}
                style={{ padding: '9px 18px', border: 'none', borderRadius: 8, background: resetSending ? '#e5e7eb' : NAVY, color: '#fff', fontFamily: F, fontWeight: 700, fontSize: 13, cursor: resetSending ? 'default' : 'pointer' }}>{resetSending ? 'Sending…' : 'Send reset email'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Deactivate confirm (nested, centered) */}
      {confirmDeactivate && (
        <div onClick={e => { e.stopPropagation(); setConfirmDeactivate(false) }}
          style={{ position: 'fixed', inset: 0, zIndex: 2400, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: '26px 24px', maxWidth: 380, width: '100%', boxShadow: '0 16px 48px rgba(0,0,0,0.2)' }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: NAVY, marginBottom: 10 }}>Deactivate {user.full_name}?</div>
            <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6, marginBottom: 20 }}>They will no longer be able to log in. This can be reversed by an owner or admin.</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setConfirmDeactivate(false)} style={{ padding: '9px 18px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb', fontFamily: F, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button type="button" onClick={async () => { setConfirmDeactivate(false); await onToggleActive?.(user.id, true); onClose?.() }}
                style={{ padding: '9px 18px', border: 'none', borderRadius: 8, background: '#dc2626', color: '#fff', fontFamily: F, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Deactivate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
