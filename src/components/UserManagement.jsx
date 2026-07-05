// ACCOUNTS-ACCESS-PROFILE-BOARD-2B: Settings → Accounts & Access is now a visual PEOPLE BOARD.
// The board renders login accounts as cozy, hover-lift profile cards grouped by role; the whole card
// is the entry point - clicking (or Enter/Space) opens the centered AccountProfileModal, which holds
// the access controls (Role / Interviewer access / calendar color, dirty-save), per-user recent activity,
// and supported account actions. The old inline invite form, Users/Activity tabs, summary pills,
// filter chips, per-card Manage Access / View Activity / three-dot menu, and the Manage Access drawer
// are removed. Invite lives in the page header (AccountsAccessPanel → InviteUserModal). All real
// handlers/payloads are preserved: get_all_user_profiles read, and /api/admin-users update_role /
// toggle_active / toggle_interviewer / update_interviewer_color with the same bodies + invalidations.
import { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { usePresence } from '../contexts/PresenceContext';
import { supabase } from '../lib/supabase';
import { X } from 'lucide-react';
import { CARD } from '../lib/designTokens';
import { ROLE_BADGE, displayRole, formatLoginDate, columnizeUsers, UserInitials, CARD_AVATAR_RING } from './settings/accountsShared';
import AccountProfileModal from './settings/AccountProfileModal';

const F = 'DM Sans, sans-serif'
const DEFAULT_COLOR = '#1D2567'

// ── Cozy interactive profile card - hover lift via the shared CARD tokens / StudentCard recipe. ──
function ProfileCard({ user, online, onOpen }) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const isOwner = !!user.is_owner
  const isInactive = user.is_active === false
  const rb = isOwner ? ROLE_BADGE.owner : (ROLE_BADGE[user.role] || ROLE_BADGE.viewer)
  const boxShadow = focused ? CARD.focusRing : hovered ? CARD.shadowHover : CARD.shadowRest
  const open = (e) => onOpen(user, e.currentTarget)
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open profile for ${user.full_name}`}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e) } }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        background: isInactive ? '#fafafa' : '#fff',
        border: '1px solid rgba(29,37,103,0.08)',
        borderRadius: CARD.radius,
        boxShadow,
        cursor: 'pointer',
        outline: 'none',
        padding: '16px',
        display: 'flex', flexDirection: 'column', gap: 10,
        transition: `transform ${CARD.hoverDuration} ease, box-shadow ${CARD.hoverDuration} ease`,
        transform: hovered && !focused ? `translateY(${CARD.hoverLiftPx}px)` : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <UserInitials user={user} size={48} ring={CARD_AVATAR_RING} />
          {online && <span title="Online now" style={{ position: 'absolute', bottom: 0, right: 0, width: 13, height: 13, borderRadius: '50%', background: '#10B981', border: '2px solid #fff', boxShadow: '0 0 0 1px rgba(29,37,103,0.15)' }} />}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#1D2567', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.full_name}</div>
          <div style={{ fontSize: 12, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ background: rb.bg, color: rb.text, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20 }}>{displayRole(user)}</span>
        {isInactive && <span style={{ background: '#F3F4F6', color: '#6B7280', fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20 }}>Inactive</span>}
        {/* Interviewer-access badge - shown only when it ADDS meaning (not when the role badge already
            reads "Interviewer"), so there's never a duplicate Interviewer badge. */}
        {user.can_conduct_interviews && displayRole(user) !== 'Interviewer' && (
          <span title="Interviewer access" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#E0E7FF', color: '#3730A3', fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 20 }}>
            Interviewer <span style={{ width: 7, height: 7, borderRadius: '50%', background: user.interviewer_color || DEFAULT_COLOR }} />
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: '#9ca3af' }}>Last login: {formatLoginDate(user.last_login_at)}</div>
    </div>
  )
}

// WS2.2: reusable inline content. Rendered by AccountsAccessPanel (Settings → Accounts & Access) and
// by the legacy UserManagement modal wrapper below (kept for rollback; no live importer).
export function UserManagementContent({ onRequestClose }) {
  const { canEdit, userProfile } = useAuth()
  const { onlineUserIds } = usePresence()
  const queryClient = useQueryClient()

  const [selectedUser, setSelectedUser] = useState(null)
  const [saveToast,    setSaveToast]    = useState(null)
  const triggerElRef = useRef(null)

  // User list - org-wide, get_all_user_profiles (unchanged).
  const { data: users = [], isLoading: loading, error: usersErrorObj } = useQuery({
    queryKey: ['people_access_users'],
    queryFn: async () => {
      const { data, error: rpcError } = await supabase.rpc('get_all_user_profiles')
      if (rpcError) throw rpcError
      return data || []
    },
    enabled: !!canEdit,
  })
  const error = usersErrorObj?.message ?? null

  const refetch = () => queryClient.invalidateQueries({ queryKey: ['people_access_users'] })

  const showToast = (msg, type = 'success') => {
    setSaveToast({ msg, type })
    setTimeout(() => setSaveToast(null), 3500)
  }

  // Admin proxy - forwards the Supabase access token; server authorizes (unchanged).
  const adminProxy = async (body) => {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    const res = await fetch('/api/admin-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { console.error('admin-users error:', data.error || data.message); return false }
    return true
  }

  // Save access - SAME payloads/invalidations as the old Manage Access saveDraft (role /
  // toggle_interviewer / update_interviewer_color). Owner role demotion blocked; server authoritative.
  const saveAccess = async (u, draft) => {
    if (u.is_owner && draft.role !== 'owner') {
      showToast('There must always be at least one Owner.', 'error'); return false
    }
    const calls = []
    if (!u.is_owner) {
      const origRole = u.role || 'viewer'
      if (draft.role !== origRole && draft.role !== 'owner') {
        calls.push(adminProxy({ action: 'update_role', user_id: u.id, role: draft.role }))
      }
    }
    if (draft.can_conduct_interviews !== !!u.can_conduct_interviews) {
      calls.push(adminProxy({ action: 'toggle_interviewer', user_id: u.id, can_conduct_interviews: draft.can_conduct_interviews }))
    }
    if (draft.interviewer_color !== (u.interviewer_color || DEFAULT_COLOR)) {
      calls.push(adminProxy({ action: 'update_interviewer_color', user_id: u.id, interviewer_color: draft.interviewer_color }))
    }
    await Promise.all(calls)
    showToast('Saved successfully.')
    queryClient.invalidateQueries({ queryKey: ['people_access_users'] })
    if (draft.can_conduct_interviews !== !!u.can_conduct_interviews ||
        draft.interviewer_color !== (u.interviewer_color || DEFAULT_COLOR)) {
      queryClient.invalidateQueries({ queryKey: ['interviewers_active'] })
      queryClient.invalidateQueries({ queryKey: ['interview_calendar'] })
    }
    return true
  }

  const handleToggleActive = async (userId, currentActive) => {
    await adminProxy({ action: 'toggle_active', user_id: userId, is_active: !currentActive })
    refetch()
  }

  // ADMIN-PASSWORD-RESET-1: dispatch a reset email to another user via the gated admin action.
  // Server resolves the target's stored email and reuses the proven self-service reset flow.
  const sendPasswordReset = async (u) => {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    const res = await fetch('/api/admin-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action: 'send_password_reset', user_id: u.id }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error('admin-users send_password_reset error:', body.error || body.message)
      return { ok: false, error: body.message || 'Could not send password reset. Please try again.' }
    }
    showToast('Password reset email sent.')
    return { ok: true }
  }

  // ADMIN-AVATAR-UPLOAD-1: owner/admin sets another user's photo via the gated server endpoint.
  // Separate from the role/interviewer/color dirty-save flow. The file is sent as base64 JSON; the
  // server validates + uploads with the service role (the client never touches Storage cross-user).
  const uploadPhoto = async (u, file) => {
    const toBase64 = (f) => new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result).split(',')[1] || '')
      r.onerror = () => reject(new Error('read_failed'))
      r.readAsDataURL(f)
    })
    try {
      const data_base64 = await toBase64(file)
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/admin-avatar-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ user_id: u.id, content_type: file.type, data_base64 }),
      })
      const bodyJson = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error('admin-avatar-upload error:', bodyJson.error || bodyJson.message)
        return { ok: false, error: bodyJson.message || 'Could not update the photo.' }
      }
      showToast('Profile photo updated.')
      queryClient.invalidateQueries({ queryKey: ['people_access_users'] })
      return { ok: true, avatar_url: bodyJson.avatar_url }
    } catch {
      return { ok: false, error: 'Could not update the photo.' }
    }
  }

  if (!canEdit) return null // server authorization is still the real gate

  const columns = columnizeUsers(users)
  const openProfile = (u, el) => { triggerElRef.current = el || null; setSelectedUser(u) }
  const closeProfile = () => { setSelectedUser(null); if (triggerElRef.current?.focus) triggerElRef.current.focus() }
  // Keep the open modal in sync with fresh data after a refetch.
  const selectedFresh = selectedUser ? (users.find(u => u.id === selectedUser.id) || selectedUser) : null

  // Reset eligibility mirrors the server gate exactly (not owner, not self, active; admin callers
  // limited to interviewer/viewer targets) so the UX only offers what the endpoint will allow.
  const callerIsOwner = userProfile?.is_owner === true
  const canSendPasswordReset = !!selectedFresh
    && !selectedFresh.is_owner
    && selectedFresh.id !== userProfile?.id
    && selectedFresh.is_active !== false
    && (callerIsOwner || ['interviewer', 'viewer'].includes(selectedFresh.role))

  return (
    <div style={{ background: '#ffffff', padding: '20px 24px', fontFamily: F }}>
      {/* Toast */}
      {saveToast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 2500, padding: '10px 18px', borderRadius: 10, fontFamily: F, fontSize: 13, fontWeight: 600, background: saveToast.type === 'error' ? '#fee2e2' : '#f0fdf4', color: saveToast.type === 'error' ? '#991b1b' : '#166534', border: `1px solid ${saveToast.type === 'error' ? '#fca5a5' : '#86efac'}`, boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
          {saveToast.msg}
        </div>
      )}

      {/* Optional close - only when opened via the (dead) legacy modal wrapper. */}
      {onRequestClose && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button onClick={onRequestClose} aria-label="Close" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#6b7280' }}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 24px', color: '#9ca3af', fontSize: 13 }}>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          <div style={{ width: 24, height: 24, border: '2px solid #e5e7eb', borderTopColor: '#1D2567', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
          Loading users…
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div style={{ background: '#fff1f2', border: '1px solid #fca5a5', borderRadius: 12, padding: 20, textAlign: 'center' }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#991b1b', marginBottom: 8 }}>Unable to load users</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 14 }}>{error}</div>
          <button onClick={refetch} style={{ padding: '8px 20px', border: 'none', borderRadius: 8, background: '#1D2567', color: '#fff', fontFamily: F, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && users.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 24px', color: '#9ca3af', fontSize: 13 }}>No users found.</div>
      )}

      {/* People board - vertical classification columns (OWNER / ADMINS / INTERVIEWERS / GUESTS),
          side-by-side on wide screens, stacking on narrow. Empty columns are dropped. */}
      {!loading && !error && users.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 16, alignItems: 'start' }}>
          {columns.map(col => (
            <div key={col.key}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: F, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6B7280', marginBottom: 10 }}>
                {col.label}
                <span style={{ fontWeight: 600, fontSize: 10.5, color: '#9ca3af' }}>{col.users.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {col.users.map(u => (
                  <ProfileCard key={u.id} user={u} online={onlineUserIds.has(u.auth_user_id)} onOpen={openProfile} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Account Profile modal */}
      {selectedFresh && (
        <AccountProfileModal
          user={selectedFresh}
          isCurrentUser={selectedFresh.id === userProfile?.id}
          online={onlineUserIds.has(selectedFresh.auth_user_id)}
          onSaveAccess={saveAccess}
          onToggleActive={handleToggleActive}
          onUploadPhoto={uploadPhoto}
          canSendPasswordReset={canSendPasswordReset}
          onSendPasswordReset={sendPasswordReset}
          onClose={closeProfile}
        />
      )}
    </div>
  )
}

// WS2.2: legacy modal/drawer wrapper - kept for rollback; no live importer.
export default function UserManagement({ isOpen, onClose }) {
  const { canEdit } = useAuth()
  if (!isOpen || !canEdit) return null
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1998 }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '560px', overflowY: 'auto', background: '#fff', boxShadow: '-8px 0 32px rgba(29,37,103,0.18)', zIndex: 1999 }}>
        <UserManagementContent onRequestClose={onClose} />
      </div>
    </>
  )
}
