// ASPIRE-PORTAL-ACCESS-UI: scalable Accounts & Access directory. Replaces the
// role-grouped profile-card board with a compact directory (Staff Access,
// Portal Access), summary counts, search + filters, pagination, three-dot row
// menus, and a right-side details drawer. Staff and portal access stay
// separate: staff invitations use InviteUserModal (/api/invite-user); portal
// access uses GrantPortalAccessModal (/api/invite-portal-user) and
// /api/revoke-portal-access. Portal data comes only from
// GET /api/list-portal-access; the browser never reads or writes the
// authorization tables directly.
//
// ACCOUNTS-ACCESS-DIRECTORY-2: the old three-tab tablist (Staff Access /
// Portal Access / Pending Invitations) is replaced with a two-way segmented
// control (Staff Access | Portal Access) - pending invitations are now just
// portal grants with status 'pending', filterable from the KPI row and the
// status select like any other status. The summary strip is now a row of
// clickable FilterKPICard cards (same primitive as Student Profiles), and
// both tables show an online-presence dot next to each identity avatar,
// sourced from onlineProfileIds (profile_id) - never the auth identifier.
import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus, ShieldPlus, Search, MoreVertical } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { usePresence } from '../../contexts/PresenceContext'
import { supabase } from '../../lib/supabase'
import StatusBadge from '../ui/StatusBadge'
import { FilterKPICard } from '../KPIBand'
import { UserInitials, displayRole, formatLoginDate, ROLE_OPTIONS, compareAccountsByName } from './accountsShared'
import { PORTAL_ROLE_LABELS, PORTAL_ROLE_OPTIONS, PORTAL_STATUS_STYLES, EXPIRING_SOON_DAYS, summarizeScope } from '../../lib/portalAccessStatus'
import InviteUserModal from './InviteUserModal'
import GrantPortalAccessModal from './GrantPortalAccessModal'
import AccountDetailsDrawer from './AccountDetailsDrawer'
import AccountProfileModal from './AccountProfileModal'

const F = 'DM Sans, sans-serif'
const DEFAULT_COLOR = '#1D2567'
const PAGE_SIZE = 25
const STAFF_ROLES = new Set(['owner', 'admin', 'co-lead', 'co_lead', 'interviewer', 'viewer'])

const STAFF_STATUS_STYLES = {
  active:   { label: 'Active',   bg: '#EDF2E2', color: '#166534', dot: '#3f9142' },
  disabled: { label: 'Disabled', bg: '#f3f4f6', color: '#6b7280', dot: '#9ca3af' },
}

function useIsNarrow(bp = 720) {
  const [narrow, setNarrow] = useState(typeof window !== 'undefined' ? window.innerWidth < bp : false)
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < bp)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [bp])
  return narrow
}

// ── Compact keyboard-accessible three-dot row menu ──────────────────────────
function RowMenu({ label, items }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef(null)
  const menuRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    setTimeout(() => menuRef.current?.querySelector('[role="menuitem"]')?.focus(), 10)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button ref={btnRef} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label}
        onClick={() => setOpen(o => !o)}
        style={{ background: 'none', border: '1px solid transparent', borderRadius: 8, cursor: 'pointer', color: '#6b7280', padding: 5, display: 'flex' }}
        onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}>
        <MoreVertical size={16} />
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label={label}
          style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, minWidth: 190, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 8px 28px rgba(16,24,40,0.14)', zIndex: 50, padding: 5 }}>
          {items.filter(Boolean).map((it, i) => (
            <button key={i} role="menuitem" type="button"
              onClick={() => { setOpen(false); it.onClick() }}
              style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, padding: '8px 10px', border: 'none', borderRadius: 7, background: 'none', cursor: 'pointer', fontFamily: F, fontSize: 13, color: it.danger ? '#b91c1c' : '#374151', textAlign: 'left' }}
              onFocus={e => e.currentTarget.style.background = '#f6f7f9'}
              onBlur={e => e.currentTarget.style.background = 'none'}
              onMouseEnter={e => e.currentTarget.style.background = '#f6f7f9'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ACCOUNTS-ACCESS-DIRECTORY-2: wraps UserInitials with a small online-presence
// dot. Presence is visually separate from the Access Status badge - it never
// replaces or changes the status badge, it just sits on the avatar corner.
// The caller decides "online" from onlineProfileIds (profile_id), never
// the auth identifier.
function PresenceAvatar({ user, size = 32, online }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <UserInitials user={user} size={size} />
      {online && (
        <span aria-hidden="true" title="Online now"
          style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: '50%', background: '#22c55e', border: '2px solid #fff' }} />
      )}
    </span>
  )
}

const th = { textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#6b7280', padding: '10px 12px', position: 'sticky', top: 0, background: '#fbfbfc', borderBottom: '1px solid #eceef2', zIndex: 1 }
const td = { padding: '11px 12px', fontSize: 13, color: '#191919', borderBottom: '1px solid #f3f4f6', verticalAlign: 'middle' }

function LoadingRows() {
  return <div style={{ padding: '36px 16px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
    <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    <div style={{ width: 22, height: 22, border: '2px solid #e5e7eb', borderTopColor: '#1D2567', borderRadius: '50%', animation: 'spin .8s linear infinite', margin: '0 auto 10px' }} />
    Loading…
  </div>
}
function ErrorState({ onRetry }) {
  return <div style={{ padding: '28px 16px', textAlign: 'center' }}>
    <div style={{ fontSize: 13.5, color: '#991b1b', marginBottom: 10 }}>Something went wrong loading this list.</div>
    <button onClick={onRetry} style={{ padding: '7px 16px', border: 'none', borderRadius: 8, background: '#1D2567', color: '#fff', fontFamily: F, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Retry</button>
  </div>
}
function EmptyState({ text }) {
  return <div style={{ padding: '36px 16px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>{text}</div>
}

export default function AccountsDirectory() {
  const { isAdmin, userProfile } = useAuth()
  const { onlineProfileIds } = usePresence()
  const queryClient = useQueryClient()
  const isNarrow = useIsNarrow()

  const [tab, setTab] = useState('staff') // staff | portal
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [expiringOnly, setExpiringOnly] = useState(false)
  const [staffLimit, setStaffLimit] = useState(PAGE_SIZE)
  const [portalLimit, setPortalLimit] = useState(PAGE_SIZE)

  const [inviteStaffOpen, setInviteStaffOpen] = useState(false)
  const [grantOpen, setGrantOpen] = useState(false)
  const [grantInitial, setGrantInitial] = useState(null)
  const [drawer, setDrawer] = useState(null) // { kind, record }
  const [staffEdit, setStaffEdit] = useState(null)
  const [toast, setToast] = useState(null)
  const triggerRef = useRef(null)

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3200) }

  // ── Staff data (unchanged source + payloads) ─────────────────────────────
  const { data: allUsers = [], isLoading: staffLoading, error: staffErr } = useQuery({
    queryKey: ['people_access_users'],
    queryFn: async () => { const { data, error } = await supabase.rpc('get_all_user_profiles'); if (error) throw error; return data || [] },
    enabled: !!isAdmin,
  })
  const refetchStaff = () => queryClient.invalidateQueries({ queryKey: ['people_access_users'] })

  // ── Portal data (secure endpoint; never reads authz tables in-browser) ────
  const portalQuery = useQuery({
    queryKey: ['portal_access_list', search, roleFilter, statusFilter, tab],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const params = new URLSearchParams({ limit: '500' })
      if (search) params.set('search', search)
      if (tab === 'portal' && roleFilter) params.set('role', roleFilter)
      if (tab === 'portal' && statusFilter) params.set('status', statusFilter)
      const res = await fetch(`/api/list-portal-access?${params.toString()}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!res.ok) throw new Error('list_failed')
      return res.json()
    },
    enabled: !!isAdmin,
  })
  const refetchPortal = () => queryClient.invalidateQueries({ queryKey: ['portal_access_list'] })
  const refetchAll = () => { refetchStaff(); refetchPortal() }

  // ── Staff mutations (verbatim payloads preserved from UserManagement) ─────
  const adminProxy = async (body) => {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    const res = await fetch('/api/admin-users', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { console.error('admin-users error:', data.error || data.message); return false }
    return true
  }
  const saveAccess = async (u, draft) => {
    if (u.is_owner && draft.role !== 'owner') { showToast('There must always be at least one Owner.', 'error'); return false }
    const calls = []
    if (!u.is_owner) {
      const origRole = u.role || 'viewer'
      if (draft.role !== origRole && draft.role !== 'owner') calls.push(adminProxy({ action: 'update_role', user_id: u.id, role: draft.role }))
    }
    if (draft.can_conduct_interviews !== !!u.can_conduct_interviews) calls.push(adminProxy({ action: 'toggle_interviewer', user_id: u.id, can_conduct_interviews: draft.can_conduct_interviews }))
    if (draft.interviewer_color !== (u.interviewer_color || DEFAULT_COLOR)) calls.push(adminProxy({ action: 'update_interviewer_color', user_id: u.id, interviewer_color: draft.interviewer_color }))
    await Promise.all(calls)
    showToast('Saved successfully.')
    queryClient.invalidateQueries({ queryKey: ['people_access_users'] })
    if (draft.can_conduct_interviews !== !!u.can_conduct_interviews || draft.interviewer_color !== (u.interviewer_color || DEFAULT_COLOR)) {
      queryClient.invalidateQueries({ queryKey: ['interviewers_active'] })
      queryClient.invalidateQueries({ queryKey: ['interview_calendar'] })
    }
    return true
  }
  const handleToggleActive = async (userId, currentActive) => { await adminProxy({ action: 'toggle_active', user_id: userId, is_active: !currentActive }); refetchStaff() }
  const sendPasswordReset = async (u) => {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    const res = await fetch('/api/admin-users', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: 'send_password_reset', user_id: u.id }) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: body.message || 'Could not send password reset. Please try again.' }
    showToast('Password reset email sent.'); return { ok: true }
  }
  const uploadPhoto = async (u, file) => {
    const toBase64 = (f) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = () => reject(new Error('read_failed')); r.readAsDataURL(f) })
    try {
      const data_base64 = await toBase64(file)
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/admin-avatar-upload', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ user_id: u.id, content_type: file.type, data_base64 }) })
      const bodyJson = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, error: bodyJson.message || 'Could not update the photo.' }
      showToast('Profile photo updated.'); queryClient.invalidateQueries({ queryKey: ['people_access_users'] })
      return { ok: true, avatar_url: bodyJson.avatar_url }
    } catch { return { ok: false, error: 'Could not update the photo.' } }
  }

  // ── Derived collections ──────────────────────────────────────────────────
  // SETTINGS-UNIFIED-DESIGN-1: both directories sort alphabetically by name
  // (compareAccountsByName) - this replaces the previous implicit RPC/granted_at
  // ordering for staff and portal accounts alike.
  const staffUsers = (() => {
    const s = search.trim().toLowerCase()
    return allUsers
      .filter(u => u.is_owner || STAFF_ROLES.has(u.role) || (u.role && u.role !== 'portal'))
      .filter(u => u.role !== 'portal')
      .filter(u => !roleFilter || (roleFilter === 'owner' ? u.is_owner : (!u.is_owner && (u.role === roleFilter))))
      .filter(u => !statusFilter || (statusFilter === 'active' ? u.is_active !== false : u.is_active === false))
      .filter(u => !s || `${u.full_name || ''} ${u.email || ''}`.toLowerCase().includes(s))
      .sort(compareAccountsByName)
  })()

  const portalData = portalQuery.data || { accounts: [], counts: {} }
  // ACCOUNTS-ACCESS-DIRECTORY-2: expiringOnly is a client-side filter on
  // r.expiring_soon (server-computed flag), applied before pagination slicing.
  const portalAccounts = (portalData.accounts || []).filter(r => !expiringOnly || r.expiring_soon === true).sort(compareAccountsByName)

  const openDrawer = (kind, record, el) => { triggerRef.current = el || null; setDrawer({ kind, record }) }
  const closeDrawer = () => setDrawer(null)

  const selectedStaffFresh = staffEdit ? (allUsers.find(u => u.id === staffEdit.id) || staffEdit) : null
  const callerIsOwner = userProfile?.is_owner === true
  const canReset = !!selectedStaffFresh && !selectedStaffFresh.is_owner && selectedStaffFresh.id !== userProfile?.id && selectedStaffFresh.is_active !== false && (callerIsOwner || ['interviewer', 'viewer'].includes(selectedStaffFresh.role))

  const counts = {
    staff: allUsers.filter(u => u.role !== 'portal').length,
    portal: portalData.counts?.portal_users ?? 0,
    pending: portalData.counts?.pending ?? 0,
    expiring: portalData.counts?.expiring_soon ?? 0,
  }

  const openGrant = (initial = null) => { setGrantInitial(initial); setGrantOpen(true) }

  // Segmented-control tab switch: full reset, same as switching Student
  // Profiles' Profiles/CS-Link toggle - filters from one tab rarely make
  // sense in the other.
  const switchTab = (t) => { setTab(t); setRoleFilter(''); setStatusFilter(''); setExpiringOnly(false) }

  if (!isAdmin) return (
    <div style={{ fontSize: 13, color: '#6b7280' }}>You don’t have access to Accounts &amp; Access.</div>
  )

  // Context-aware filter options.
  const roleFilterOptions = tab === 'portal'
    ? PORTAL_ROLE_OPTIONS
    : [{ value: 'owner', label: 'Owner' }, ...ROLE_OPTIONS.filter(r => r.value !== 'co-lead').map(r => ({ value: r.value, label: r.label })), { value: 'co-lead', label: 'Co-Lead' }]
  const statusFilterOptions = tab === 'portal'
    ? [{ value: 'pending', label: 'Pending' }, { value: 'active', label: 'Active' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'expired', label: 'Expired' }, { value: 'revoked', label: 'Revoked' }]
    : [{ value: 'active', label: 'Active' }, { value: 'disabled', label: 'Disabled' }]

  return (
    <section aria-labelledby="accounts-directory-heading">
      {toast && (
        <div role="status" style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 2600, padding: '10px 18px', borderRadius: 10, fontFamily: F, fontSize: 13, fontWeight: 600, background: toast.type === 'error' ? '#fee2e2' : '#f0fdf4', color: toast.type === 'error' ? '#991b1b' : '#166534', border: `1px solid ${toast.type === 'error' ? '#fca5a5' : '#86efac'}`, boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>{toast.msg}</div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ minWidth: 0, flex: '1 1 360px' }}>
          <h2 id="accounts-directory-heading" style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: '#191919' }}>Accounts &amp; Access</h2>
          <p style={{ margin: 0, fontSize: 13.5, color: '#6b7280' }}>Manage staff accounts and scoped portal access.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setInviteStaffOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', background: '#fff', border: '1px solid #d5d9e2', borderRadius: 8, fontFamily: F, fontWeight: 600, fontSize: 13, color: '#1D2567', cursor: 'pointer', whiteSpace: 'nowrap' }}><UserPlus size={15} /> Invite Staff User</button>
          <button type="button" onClick={() => openGrant(null)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', background: '#1D2567', border: 'none', borderRadius: 8, fontFamily: F, fontWeight: 600, fontSize: 13, color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}><ShieldPlus size={15} /> Grant Portal Access</button>
        </div>
      </div>

      {/* Filter KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
        <FilterKPICard value={counts.staff} label="Staff" sub="Staff accounts" accent="nightfall"
          active={tab === 'staff'}
          onClick={() => switchTab('staff')} />
        <FilterKPICard value={counts.portal} label="Portal Users" sub="Active portal access" accent="marina"
          active={tab === 'portal' && statusFilter !== 'pending' && !expiringOnly}
          onClick={() => switchTab('portal')} />
        <FilterKPICard value={counts.pending} label="Pending Invitations" sub="Awaiting first sign-in" accent="dawn"
          active={tab === 'portal' && statusFilter === 'pending'}
          onClick={() => { setTab('portal'); setExpiringOnly(false); setStatusFilter(f => f === 'pending' ? '' : 'pending') }} />
        <FilterKPICard value={counts.expiring} label="Expiring Soon" sub={`Within ${EXPIRING_SOON_DAYS} days`} accent="chroma"
          active={tab === 'portal' && expiringOnly}
          onClick={() => { setTab('portal'); setStatusFilter(''); setExpiringOnly(e => !e) }} />
      </div>

      {/* Unified toolbar: Staff/Portal segmented control + search + filters, one row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'var(--bg-card,#fff)', border: '1px solid var(--border-card,rgba(29,37,103,0.08))', borderRadius: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', borderRadius: 7, border: '1px solid var(--border-input,rgba(29,37,103,0.10))', overflow: 'hidden', flexShrink: 0 }}>
          <button type="button" onClick={() => switchTab('staff')}
            style={{ height: 32, padding: '0 13px', display: 'flex', alignItems: 'center', border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: F, fontWeight: 500,
              background: tab === 'staff' ? 'var(--color-accent-primary,#1D2567)' : 'var(--bg-input,#fff)',
              color: tab === 'staff' ? '#fff' : 'var(--text-secondary,#4A5560)', transition: 'all 0.12s' }}>
            Staff Access
          </button>
          <button type="button" onClick={() => switchTab('portal')}
            style={{ height: 32, padding: '0 13px', display: 'flex', alignItems: 'center', border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: F, fontWeight: 500,
              background: tab === 'portal' ? 'var(--color-accent-primary,#1D2567)' : 'var(--bg-input,#fff)',
              color: tab === 'portal' ? '#fff' : 'var(--text-secondary,#4A5560)', transition: 'all 0.12s' }}>
            Portal Access
          </button>
        </div>

        <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 200 }}>
          <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search accounts by name or email" aria-label="Search accounts"
            style={{ width: '100%', padding: '9px 12px 9px 32px', border: '1px solid #e5e7eb', borderRadius: 8, fontFamily: F, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} aria-label="Filter by role" style={{ padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontFamily: F, fontSize: 13, cursor: 'pointer', background: '#fff' }}>
          <option value="">All roles</option>
          {roleFilterOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label="Filter by status" style={{ padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontFamily: F, fontSize: 13, cursor: 'pointer', background: '#fff' }}>
          <option value="">All statuses</option>
          {statusFilterOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div style={{ border: '1px solid #eceef2', borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
        {tab === 'staff' && (
          <StaffPanel isNarrow={isNarrow} loading={staffLoading} error={staffErr} users={staffUsers} limit={staffLimit} onMore={() => setStaffLimit(l => l + PAGE_SIZE)}
            onlineProfileIds={onlineProfileIds}
            onRetry={refetchStaff}
            onView={(u, el) => openDrawer('staff', u, el)}
            onEdit={(u) => setStaffEdit(u)}
            onToggleActive={handleToggleActive}
            onResetPw={sendPasswordReset} />
        )}
        {tab === 'portal' && (
          <PortalPanel isNarrow={isNarrow} loading={portalQuery.isLoading} error={portalQuery.error}
            accounts={portalAccounts} limit={portalLimit} onMore={() => setPortalLimit(l => l + PAGE_SIZE)}
            onlineProfileIds={onlineProfileIds}
            onRetry={refetchPortal}
            onView={(r, el) => openDrawer('portal', r, el)}
            onRenew={(r) => openGrant(r)}
            onRevoke={(r, el) => openDrawer('portal', r, el)}
            onGrantFirst={() => openGrant(null)} />
        )}
      </div>

      {/* Modals + drawer */}
      {inviteStaffOpen && <InviteUserModal onClose={() => setInviteStaffOpen(false)} onInvited={refetchStaff} />}
      {grantOpen && <GrantPortalAccessModal initial={grantInitial} onClose={() => { setGrantOpen(false); setGrantInitial(null) }} onGranted={() => { refetchPortal(); showToast('Portal access updated.') }} />}
      {drawer && (
        <AccountDetailsDrawer kind={drawer.kind} record={drawer.record} returnFocusRef={triggerRef}
          onClose={closeDrawer}
          onEditStaff={(u) => { closeDrawer(); setStaffEdit(u) }}
          onRenewPortal={(r) => { closeDrawer(); openGrant(r) }}
          onRevoked={() => { refetchPortal(); showToast('Portal access revoked.') }} />
      )}
      {selectedStaffFresh && (
        <AccountProfileModal user={selectedStaffFresh} isCurrentUser={selectedStaffFresh.id === userProfile?.id}
          online={onlineProfileIds.has(selectedStaffFresh.id)} onSaveAccess={saveAccess} onToggleActive={handleToggleActive} onUploadPhoto={uploadPhoto}
          canSendPasswordReset={canReset} onSendPasswordReset={sendPasswordReset} onClose={() => setStaffEdit(null)} />
      )}
    </section>
  )
}

// ── Staff tab ────────────────────────────────────────────────────────────────
function StaffPanel({ isNarrow, loading, error, users, limit, onMore, onlineProfileIds, onRetry, onView, onEdit, onToggleActive, onResetPw }) {
  if (loading) return <LoadingRows />
  if (error) return <ErrorState onRetry={onRetry} />
  if (!users.length) return <EmptyState text="No staff accounts match your search." />
  const page = users.slice(0, limit)
  const menu = (u) => [
    { label: 'View account', onClick: () => onView(u) },
    { label: 'Edit staff access', onClick: () => onEdit(u) },
    !u.is_owner && { label: u.is_active === false ? 'Enable account' : 'Disable account', danger: u.is_active !== false, onClick: () => onToggleActive(u.id, u.is_active !== false) },
  ]
  return (
    <div id="panel-staff">
      {isNarrow ? (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {page.map(u => (
            <AccountCard key={u.id} onOpen={(el) => onView(u, el)} avatar={<PresenceAvatar user={u} size={40} online={onlineProfileIds.has(u.id)} />}
              title={u.full_name} subtitle={u.email}
              badges={[<StatusBadge key="s" value={u.is_active === false ? 'disabled' : 'active'} colorMap={STAFF_STATUS_STYLES} />, <span key="r" style={{ fontSize: 11.5, fontWeight: 600, color: '#4b5563' }}>{displayRole(u)}</span>]}
              meta={`Last login: ${formatLoginDate(u.last_login_at)}`}
              menu={<RowMenu label={`Actions for ${u.full_name}`} items={menu(u)} />} />
          ))}
          <LoadMore shown={page.length} total={users.length} onMore={onMore} />
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead><tr><th style={th}>Name</th><th style={th}>Staff role</th><th style={th}>Interviewer</th><th style={th}>Status</th><th style={th}>Last login</th><th style={{ ...th, textAlign: 'right' }}>Actions</th></tr></thead>
            <tbody>
              {page.map(u => (
                <tr key={u.id} tabIndex={0} onClick={(e) => onView(u, e.currentTarget)} onKeyDown={(e) => { if (e.key === 'Enter') onView(u, e.currentTarget) }} style={{ cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#fafbfc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={td}><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><PresenceAvatar user={u} size={32} online={onlineProfileIds.has(u.id)} /><div style={{ minWidth: 0 }}><div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.full_name}</div><div style={{ fontSize: 11.5, color: '#9ca3af' }}>{u.email}</div></div></div></td>
                  <td style={td}>{displayRole(u)}</td>
                  <td style={td}>{u.can_conduct_interviews ? 'Yes' : 'No'}</td>
                  <td style={td}><StatusBadge value={u.is_active === false ? 'disabled' : 'active'} colorMap={STAFF_STATUS_STYLES} /></td>
                  <td style={{ ...td, color: '#6b7280' }}>{formatLoginDate(u.last_login_at)}</td>
                  <td style={{ ...td, textAlign: 'right' }} onClick={e => e.stopPropagation()}><RowMenu label={`Actions for ${u.full_name}`} items={menu(u)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <LoadMore shown={page.length} total={users.length} onMore={onMore} />
        </div>
      )}
    </div>
  )
}

// ── Portal tab ───────────────────────────────────────────────────────────────
function PortalPanel({ isNarrow, loading, error, accounts, limit, onMore, onlineProfileIds, onRetry, onView, onRenew, onRevoke, onGrantFirst }) {
  if (loading) return <LoadingRows />
  if (error) return <ErrorState onRetry={onRetry} />
  if (!accounts.length) return (
    <div style={{ padding: '32px 16px', textAlign: 'center' }}>
      <div style={{ color: '#9ca3af', fontSize: 13, marginBottom: 12 }}>No portal access has been granted yet.</div>
      <button onClick={onGrantFirst} style={{ padding: '8px 16px', border: 'none', borderRadius: 8, background: '#1D2567', color: '#fff', fontFamily: F, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Grant Portal Access</button>
    </div>
  )
  const page = accounts.slice(0, limit)
  const menu = (r) => [
    { label: 'View access', onClick: () => onView(r) },
    { label: 'Renew / edit access', onClick: () => onRenew(r) },
    r.status !== 'revoked' && { label: 'Revoke access', danger: true, onClick: () => onRevoke(r) },
  ]
  return (
    <div id="panel-portal">
      {isNarrow ? (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {page.map(r => (
            <AccountCard key={r.grant_id} onOpen={(el) => onView(r, el)} avatar={<PresenceAvatar user={r} size={40} online={onlineProfileIds.has(r.user_profile_id)} />}
              title={r.full_name} subtitle={r.email}
              badges={[<StatusBadge key="s" value={r.status} colorMap={PORTAL_STATUS_STYLES} />, <span key="r" style={{ fontSize: 11.5, fontWeight: 600, color: '#4b5563' }}>{PORTAL_ROLE_LABELS[r.portal_role]}</span>]}
              meta={`${summarizeScope(r)} · Last login: ${formatLoginDate(r.last_login_at)}`}
              menu={<RowMenu label={`Actions for ${r.full_name}`} items={menu(r)} />} />
          ))}
          <LoadMore shown={page.length} total={accounts.length} onMore={onMore} />
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead><tr><th style={th}>Name</th><th style={th}>Portal role</th><th style={th}>Assigned scope</th><th style={th}>Status</th><th style={th}>Last login</th><th style={th}>Expiration</th><th style={{ ...th, textAlign: 'right' }}>Actions</th></tr></thead>
            <tbody>
              {page.map(r => (
                <tr key={r.grant_id} tabIndex={0} onClick={(e) => onView(r, e.currentTarget)} onKeyDown={(e) => { if (e.key === 'Enter') onView(r, e.currentTarget) }} style={{ cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#fafbfc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={td}><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><PresenceAvatar user={r} size={32} online={onlineProfileIds.has(r.user_profile_id)} /><div style={{ minWidth: 0 }}><div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.full_name}</div><div style={{ fontSize: 11.5, color: '#9ca3af' }}>{r.email}</div></div></div></td>
                  <td style={td}>{PORTAL_ROLE_LABELS[r.portal_role]}</td>
                  <td style={{ ...td, color: '#4b5563', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summarizeScope(r)}</td>
                  <td style={td}><StatusBadge value={r.status} colorMap={PORTAL_STATUS_STYLES} /></td>
                  <td style={{ ...td, color: '#6b7280' }}>{formatLoginDate(r.last_login_at)}</td>
                  <td style={{ ...td, color: '#6b7280' }}>{r.expires_at ? new Date(r.expires_at).toLocaleDateString() : '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }} onClick={e => e.stopPropagation()}><RowMenu label={`Actions for ${r.full_name}`} items={menu(r)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <LoadMore shown={page.length} total={accounts.length} onMore={onMore} />
        </div>
      )}
    </div>
  )
}

function AccountCard({ avatar, title, subtitle, badges, meta, menu, onOpen }) {
  return (
    <div style={{ border: '1px solid #eceef2', borderRadius: 12, padding: 12, background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <button type="button" onClick={(e) => onOpen(e.currentTarget)} aria-label={`Open ${title}`} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
          {avatar}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: '#191919', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
            <div style={{ fontSize: 12, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</div>
          </div>
        </button>
        {menu}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 9 }}>{badges}</div>
      {meta && <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 7 }}>{meta}</div>}
    </div>
  )
}

function LoadMore({ shown, total, onMore }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', fontSize: 12, color: '#9ca3af' }}>
      <span>Showing {Math.min(shown, total)} of {total}</span>
      {shown < total && <button onClick={onMore} style={{ padding: '6px 14px', border: '1px solid #d5d9e2', borderRadius: 8, background: '#fff', fontFamily: F, fontWeight: 600, fontSize: 12.5, color: '#1D2567', cursor: 'pointer' }}>Load more</button>}
    </div>
  )
}
