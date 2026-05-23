import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { usePresence } from '../contexts/PresenceContext';
import { supabase } from '../lib/supabase';
import { X, UserPlus, Mail, MoreVertical, RefreshCw } from 'lucide-react';

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLE_OPTIONS = [
  { value: 'admin',       label: 'Admin',       description: 'Full operational access' },
  { value: 'co-lead',     label: 'Co-Lead',     description: 'Placement + student management' },
  { value: 'interviewer', label: 'Interviewer',  description: 'Rubric and interview access' },
  { value: 'viewer',      label: 'Viewer',       description: 'Read-only dashboard' },
]

const ROLE_BADGE = {
  owner:       { bg: '#1D2567', text: '#ffffff' },
  admin:       { bg: '#065F46', text: '#ffffff' },
  'co-lead':   { bg: '#3730A3', text: '#ffffff' },
  interviewer: { bg: '#FCEFD4', text: '#7C5A1F' },
  viewer:      { bg: '#F1F5F9', text: '#475569' },
}

const INTERVIEWER_COLORS = [
  { name: 'Navy',     hex: '#1D2567' },
  { name: 'Emerald',  hex: '#065F46' },
  { name: 'Teal',     hex: '#0E7490' },
  { name: 'Gold',     hex: '#92400E' },
  { name: 'Plum',     hex: '#5B21B6' },
  { name: 'Rose',     hex: '#9F1239' },
  { name: 'Slate',    hex: '#3730A3' },
  { name: 'Forest',   hex: '#14532D' },
  { name: 'Burgundy', hex: '#7C2D2D' },
  { name: 'Sienna',   hex: '#9A3412' },
]

const ROLE_ORDER = { owner: 0, admin: 1, 'co-lead': 2, co_lead: 2, interviewer: 3, viewer: 4 }

const CHIP_FILTERS = [
  { key: 'all',          label: 'All Users' },
  { key: 'active',       label: 'Active' },
  { key: 'interviewers', label: 'Interviewers' },
  { key: 'inactive',     label: 'Inactive' },
  { key: 'owners_admins',label: 'Owners/Admins' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatLoginDate(dateStr) {
  if (!dateStr) return 'Never logged in'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return null
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins  <  2) return 'Just now'
  if (hours <  1) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days  === 1) return 'Yesterday'
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function displayRole(user) {
  if (user.is_owner) return 'Owner'
  const r = user.role || 'viewer'
  return r.charAt(0).toUpperCase() + r.slice(1)
}

function sortUsers(users) {
  return [...users].sort((a, b) => {
    // Inactive always at the bottom
    const aActive = a.is_active !== false
    const bActive = b.is_active !== false
    if (aActive !== bActive) return aActive ? -1 : 1
    // Owner first, then by role hierarchy
    const ra = a.is_owner ? 0 : (ROLE_ORDER[a.role] ?? 99)
    const rb = b.is_owner ? 0 : (ROLE_ORDER[b.role] ?? 99)
    if (ra !== rb) return ra - rb
    // Alphabetical within same role
    return (a.full_name || '').localeCompare(b.full_name || '')
  })
}

function groupUsers(users) {
  const groups = [
    { key: 'owner',        label: 'Owner',             users: [] },
    { key: 'admins',       label: 'Admins & Co-Leads', users: [] },
    { key: 'interviewers', label: 'Interviewers',      users: [] },
    { key: 'viewers',      label: 'Viewers',           users: [] },
    { key: 'inactive',     label: 'Inactive',          users: [] },
  ]
  users.forEach(u => {
    if (u.is_active === false)       { groups[4].users.push(u); return }
    if (u.is_owner)                  { groups[0].users.push(u); return }
    const r = u.role || 'viewer'
    if (r === 'admin' || r === 'co-lead' || r === 'co_lead') { groups[1].users.push(u); return }
    if (r === 'interviewer')         { groups[2].users.push(u); return }
    groups[3].users.push(u)
  })
  return groups.filter(g => g.users.length > 0)
}

function UserInitials({ user, size = 40 }) {
  const [err, setErr] = useState(false)
  const initials = (user.full_name || '?').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
  if (user.avatar_url && !err) {
    return (
      <img src={user.avatar_url} alt={user.full_name}
        onError={() => setErr(true)}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: '#1D2567',
      flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'DM Sans, sans-serif', fontWeight: 700,
      fontSize: Math.round(size * 0.35) + 'px', color: '#ffffff',
    }}>{initials}</div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UserManagement({ isOpen, onClose }) {
  const { isOwner, isAdmin, canEdit, userProfile } = useAuth()
  const { onlineUserIds } = usePresence()
  const queryClient = useQueryClient()

  // ── Data via TanStack Query ──────────────────────────────────────────────────

  // User list — org-wide, no cohortId.
  // enabled depends only on canEdit, NOT on isOpen. The conditional render in
  // App.jsx ({showUserManagement && <UserManagement />}) already guarantees this
  // component is only mounted when open, so isOpen is always true on mount.
  // Including isOpen in enabled introduced a race with the auth context: on the
  // very first render after mount, userProfile can still be null, making
  // canEdit false, which makes enabled false, which makes TQ set isLoading=true
  // without ever firing a network request (perpetual "Loading users..." state).
  const {
    data:      users = [],
    isLoading: loading,
    error:     usersErrorObj,
    refetch:   refetchUsers,
  } = useQuery({
    queryKey: ['people_access_users'],
    queryFn: async () => {
      const { data, error: rpcError } = await supabase.rpc('get_all_user_profiles')
      if (rpcError) throw rpcError
      return data || []
    },
    enabled: !!canEdit,
  })
  const error = usersErrorObj?.message ?? null

  // Activity log — org-wide, fetched lazily when drawer is open
  const { data: activityLogs = [] } = useQuery({
    queryKey: ['activity_logs'],
    queryFn: async () => {
      const { data } = await supabase
        .from('activity_logs').select('*')
        .order('created_at', { ascending: false }).limit(200)
      return data || []
    },
    enabled: !!canEdit,  // same fix: isOpen is redundant with conditional render
  })

  const [activeView,     setActiveView]     = useState('users')
  const [activityFilter, setActivityFilter] = useState(null)

  // ── Invite ──────────────────────────────────────────────────────────────────
  const [inviteMode,    setInviteMode]    = useState(false)
  const [inviteData,    setInviteData]    = useState({ email: '', full_name: '', role: 'interviewer' })
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteResult,  setInviteResult]  = useState(null)

  // ── Filter chip (replaces search + 3 dropdowns) ─────────────────────────────
  const [chipFilter, setChipFilter] = useState('all')

  // ── Card UX ──────────────────────────────────────────────────────────────────
  const [expandedUserId,    setExpandedUserId]    = useState(null)
  const [editDrafts,        setEditDrafts]        = useState({})
  const [menuOpenId,        setMenuOpenId]        = useState(null)
  const [deactivateConfirm, setDeactivateConfirm] = useState(null)
  const [saving,            setSaving]            = useState(false)
  const [saveToast,         setSaveToast]         = useState(null)

  const menuRef = useRef(null)

  // ── Close menu on outside click ──────────────────────────────────────────────
  useEffect(() => {
    if (!menuOpenId) return
    const handler = e => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpenId(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpenId])

  // ── Reset UI state on drawer open (fetching handled by useQuery above) ─────────
  useEffect(() => {
    if (!isOpen) return
    setChipFilter('all')
    setExpandedUserId(null)
  }, [isOpen])

  // ── Manual refresh — invalidates both user list and activity log ──────────────
  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['people_access_users'] })
    queryClient.invalidateQueries({ queryKey: ['activity_logs'] })
  }, [queryClient])

  // ── Admin proxy ───────────────────────────────────────────────────────────────
  const adminProxy = async (body) => {
    const res = await fetch('/api/admin-users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) { console.error('admin-users error:', data.error); return false }
    return true
  }

  const showToast = (msg, type = 'success') => {
    setSaveToast({ msg, type })
    setTimeout(() => setSaveToast(null), 3500)
  }

  // ── Invite ────────────────────────────────────────────────────────────────────
  const handleInvite = async () => {
    if (!inviteData.email || !inviteData.full_name || !inviteData.role) return
    setInviteLoading(true); setInviteResult(null)
    try {
      const res = await fetch('/api/invite-user', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inviteData),
      })
      const data = await res.json()
      if (res.ok) {
        setInviteResult({ success: true, message: `Invitation sent to ${inviteData.email}` })
        setInviteData({ email: '', full_name: '', role: 'interviewer' })
        refetch()
      } else {
        setInviteResult({ success: false, message: data.error })
      }
    } catch (err) { setInviteResult({ success: false, message: err.message }) }
    setInviteLoading(false)
  }

  const handleToggleActive = async (userId, currentActive) => {
    await adminProxy({ action: 'toggle_active', user_id: userId, is_active: !currentActive })
    refetch()
  }

  // ── Last-action map ───────────────────────────────────────────────────────────
  const lastActionByName = useMemo(() => {
    const map = {}
    activityLogs.forEach(log => {
      if (log.user_name && !map[log.user_name]) map[log.user_name] = log
    })
    return map
  }, [activityLogs])

  // ── Summary counts (only from loaded data, never stale) ───────────────────────
  const totalUsers       = users.length
  const activeCount      = users.filter(u => u.is_active !== false).length
  const interviewerCount = users.filter(u => u.can_conduct_interviews).length
  const ownerCount       = users.filter(u => u.is_owner).length
  const onlineCount      = users.filter(u => onlineUserIds.has(u.auth_user_id)).length

  // ── Sort + filter (chip operates on sorted list, never mutates source) ────────
  const sortedUsers = useMemo(() => sortUsers(users), [users])

  const filteredUsers = useMemo(() => {
    switch (chipFilter) {
      case 'active':        return sortedUsers.filter(u => u.is_active !== false)
      case 'interviewers':  return sortedUsers.filter(u => u.can_conduct_interviews)
      case 'inactive':      return sortedUsers.filter(u => u.is_active === false)
      case 'owners_admins': return sortedUsers.filter(u => u.is_owner || u.role === 'admin')
      default:              return sortedUsers
    }
  }, [sortedUsers, chipFilter])

  const groupedUsers = useMemo(() => groupUsers(filteredUsers), [filteredUsers])

  // ── Manage Access ─────────────────────────────────────────────────────────────
  const openManageAccess = (u) => {
    if (expandedUserId === u.id) { setExpandedUserId(null); return }
    setExpandedUserId(u.id)
    setEditDrafts(p => ({
      ...p,
      [u.id]: {
        role:                   u.is_owner ? 'owner' : (u.role || 'viewer'),
        can_conduct_interviews: !!u.can_conduct_interviews,
        interviewer_color:      u.interviewer_color || '#1D2567',
      },
    }))
  }

  const updateDraft = (userId, field, value) =>
    setEditDrafts(p => ({ ...p, [userId]: { ...p[userId], [field]: value } }))

  const saveDraft = async (u) => {
    const draft = editDrafts[u.id]
    if (!draft) return

    // Owner protection: block role demotion
    if (u.is_owner && draft.role !== 'owner') {
      showToast('There must always be at least one Owner.', 'error'); return
    }

    // Guard: prevent creating zero owners (edge case for admin demoting owner)
    const wouldRemoveOwner = !u.is_owner && false // not applicable here, but guard kept

    setSaving(true)
    const calls = []

    // For owner's own card: only allow interview settings
    const isOwnerCard = u.is_owner
    if (!isOwnerCard) {
      const origRole = u.role || 'viewer'
      if (draft.role !== origRole && draft.role !== 'owner') {
        calls.push(adminProxy({ action: 'update_role', user_id: u.id, role: draft.role }))
      }
    }
    if (draft.can_conduct_interviews !== !!u.can_conduct_interviews) {
      calls.push(adminProxy({ action: 'toggle_interviewer', user_id: u.id, can_conduct_interviews: draft.can_conduct_interviews }))
    }
    if (draft.interviewer_color !== (u.interviewer_color || '#1D2567')) {
      calls.push(adminProxy({ action: 'update_interviewer_color', user_id: u.id, interviewer_color: draft.interviewer_color }))
    }
    await Promise.all(calls)
    setSaving(false)
    setExpandedUserId(null)
    showToast('Saved successfully.')
    queryClient.invalidateQueries({ queryKey: ['people_access_users'] })
    // If interview capability or color changed, keep Interview Room in sync
    if (draft.can_conduct_interviews !== !!u.can_conduct_interviews ||
        draft.interviewer_color !== (u.interviewer_color || '#1D2567')) {
      queryClient.invalidateQueries({ queryKey: ['interviewers_active'] })
      queryClient.invalidateQueries({ queryKey: ['interview_calendar'] })
    }
  }

  // ── Guard ─────────────────────────────────────────────────────────────────────
  if (!isOpen || !canEdit) return null

  const inputStyle = {
    width: '100%', padding: '8px 12px', border: '1px solid #e5e7eb',
    borderRadius: '8px', fontFamily: 'DM Sans, sans-serif', fontSize: '13px',
    outline: 'none', boxSizing: 'border-box', height: '36px',
  }
  const controlStyle = { ...inputStyle, cursor: 'pointer' }

  const isFiltersActive = chipFilter !== 'all'

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1998 }} />

      {/* Toast */}
      {saveToast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 2500, padding: '10px 18px', borderRadius: '10px', fontFamily: 'DM Sans', fontSize: '13px', fontWeight: 600, background: saveToast.type === 'error' ? '#fee2e2' : '#f0fdf4', color: saveToast.type === 'error' ? '#991b1b' : '#166534', border: `1px solid ${saveToast.type === 'error' ? '#fca5a5' : '#86efac'}`, boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
          {saveToast.msg}
        </div>
      )}

      {/* Deactivate confirmation */}
      {deactivateConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '28px 24px', maxWidth: '380px', width: '90%', boxShadow: '0 16px 48px rgba(0,0,0,0.2)' }}>
            <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: '16px', color: '#1D2567', marginBottom: '10px' }}>
              Deactivate {deactivateConfirm.full_name}?
            </div>
            <div style={{ fontFamily: 'DM Sans', fontSize: '13px', color: '#6b7280', lineHeight: 1.6, marginBottom: '20px' }}>
              They will no longer be able to log in. This can be reversed by an owner or admin.
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setDeactivateConfirm(null)}
                style={{ padding: '9px 18px', border: '1px solid #e5e7eb', borderRadius: '8px', background: '#f9fafb', fontFamily: 'DM Sans', fontSize: '13px', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={() => { handleToggleActive(deactivateConfirm.id, true); setDeactivateConfirm(null) }}
                style={{ padding: '9px 18px', border: 'none', borderRadius: '8px', background: '#dc2626', color: '#fff', fontFamily: 'DM Sans', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drawer */}
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '560px', background: '#ffffff', boxShadow: '-8px 0 32px rgba(29,37,103,0.18)', zIndex: 1999, display: 'flex', flexDirection: 'column', fontFamily: 'DM Sans, sans-serif' }}>

        {/* Header */}
        <div style={{ background: 'linear-gradient(180deg, #1c2452 0%, #141928 100%)', padding: '20px 24px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '18px', color: '#ffffff', fontFamily: 'DM Sans' }}>People & Access</div>
            <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.55)', marginTop: '3px', fontFamily: 'DM Sans' }}>
              Manage app users, roles, interviewer access, and activity.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Manual refresh button */}
            <button onClick={refetch} disabled={loading} title="Refresh user list"
              style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: loading ? 'default' : 'pointer', color: '#ffffff', opacity: loading ? 0.5 : 1, transition: 'all 0.15s ease' }}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.background = 'rgba(255,255,255,0.18)' }}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}>
              <RefreshCw size={14} style={{ animation: loading ? 'spin 0.8s linear infinite' : 'none' }} />
            </button>
            <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#ffffff', flexShrink: 0 }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tabs — count hidden while loading to prevent flicker */}
        <div style={{ display: 'flex', borderBottom: '1px solid #f3f4f6', padding: '0 24px', flexShrink: 0 }}>
          {[
            { id: 'users',    label: loading ? 'Users…' : `Users (${totalUsers})` },
            { id: 'activity', label: 'Activity Log' },
          ].map(tab => (
            <button key={tab.id} onClick={() => { setActiveView(tab.id); if (tab.id !== 'activity') setActivityFilter(null) }}
              style={{ padding: '12px 16px', background: 'none', border: 'none', borderBottom: `2px solid ${activeView === tab.id ? '#1D2567' : 'transparent'}`, fontFamily: 'DM Sans', fontWeight: activeView === tab.id ? 700 : 400, fontSize: '13px', color: activeView === tab.id ? '#1D2567' : '#6b7280', cursor: 'pointer', marginBottom: '-1px' }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Summary strip */}
        <div style={{ background: '#F4F1EC', padding: '0 24px', height: '36px', display: 'flex', alignItems: 'center', gap: '4px', fontFamily: 'DM Sans', fontSize: '13px', color: '#6b7280', flexShrink: 0, borderBottom: '1px solid #e5e7eb' }}>
          {loading ? (
            <span style={{ fontStyle: 'italic' }}>Loading users…</span>
          ) : error ? (
            <span style={{ color: '#dc2626' }}>⚠ Failed to load</span>
          ) : (
            <>
              <span>{totalUsers} users</span>
              <span style={{ margin: '0 4px' }}>·</span>
              <span>{activeCount} active</span>
              <span style={{ margin: '0 4px' }}>·</span>
              <span>{interviewerCount} interviewer{interviewerCount !== 1 ? 's' : ''}</span>
              <span style={{ margin: '0 4px' }}>·</span>
              <span>{ownerCount} owner{ownerCount !== 1 ? 's' : ''}</span>
              {onlineCount > 0 && (
                <>
                  <span style={{ margin: '0 4px' }}>·</span>
                  <span style={{ color: '#065F46', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#10B981' }} />
                    {onlineCount} online
                  </span>
                </>
              )}
            </>
          )}
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* ── USERS VIEW ── */}
          {activeView === 'users' && (
            <>
              {/* Invite button / form */}
              {!inviteMode ? (
                <button onClick={() => setInviteMode(true)}
                  style={{ width: '100%', padding: '10px', background: '#1D2567', border: 'none', borderRadius: '10px', fontFamily: 'DM Sans', fontWeight: 700, fontSize: '13px', color: '#ffffff', cursor: 'pointer', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <UserPlus size={15} /> Invite New User
                </button>
              ) : (
                <div style={{ background: '#f8faff', border: '1px solid #e0e7ff', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
                  <div style={{ fontWeight: 700, fontSize: '13px', color: '#1D2567', marginBottom: '12px' }}>Invite New User</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <input placeholder="Full name" value={inviteData.full_name}
                      onChange={e => setInviteData(p => ({ ...p, full_name: e.target.value }))} style={inputStyle} />
                    <input placeholder="Email address" type="email" value={inviteData.email}
                      onChange={e => setInviteData(p => ({ ...p, email: e.target.value }))} style={inputStyle} />
                    <select value={inviteData.role}
                      onChange={e => setInviteData(p => ({ ...p, role: e.target.value }))} style={controlStyle}>
                      {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label} — {r.description}</option>)}
                    </select>
                    {inviteResult && (
                      <div style={{ padding: '8px 12px', borderRadius: '8px', fontSize: '12px', background: inviteResult.success ? '#f0fdf4' : '#fff1f2', border: `1px solid ${inviteResult.success ? '#86efac' : '#fca5a5'}`, color: inviteResult.success ? '#166534' : '#991b1b' }}>
                        {inviteResult.message}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => { setInviteMode(false); setInviteResult(null) }}
                        style={{ flex: 1, padding: '9px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', fontFamily: 'DM Sans', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
                      <button onClick={handleInvite} disabled={inviteLoading || !inviteData.email || !inviteData.full_name}
                        style={{ flex: 2, padding: '9px', border: 'none', borderRadius: '8px', background: inviteLoading ? '#e5e7eb' : '#1D2567', fontFamily: 'DM Sans', fontWeight: 700, fontSize: '13px', color: '#ffffff', cursor: inviteLoading ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                        <Mail size={13} /> {inviteLoading ? 'Sending…' : 'Send Invitation'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Filter chips */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
                {CHIP_FILTERS.map(chip => {
                  const isActive = chipFilter === chip.key
                  return (
                    <button key={chip.key} onClick={() => setChipFilter(chip.key)}
                      style={{ height: '30px', padding: '0 14px', borderRadius: '999px', border: `1px solid ${isActive ? '#1D2567' : '#E5E7EB'}`, background: isActive ? '#1D2567' : '#ffffff', fontFamily: 'DM Sans', fontWeight: 500, fontSize: '12px', color: isActive ? '#ffffff' : '#1D2567', cursor: 'pointer', transition: 'all 0.15s ease', whiteSpace: 'nowrap' }}>
                      {chip.label}
                    </button>
                  )
                })}
              </div>

              {/* ── Loading state ── */}
              {loading && (
                <div style={{ textAlign: 'center', padding: '40px 24px', color: '#9ca3af', fontSize: '13px' }}>
                  <div style={{ width: '24px', height: '24px', border: '2px solid #e5e7eb', borderTopColor: '#1D2567', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
                  Loading users…
                </div>
              )}

              {/* ── Error state ── */}
              {!loading && error && (
                <div style={{ background: '#fff1f2', border: '1px solid #fca5a5', borderRadius: '12px', padding: '20px', textAlign: 'center' }}>
                  <div style={{ fontFamily: 'DM Sans', fontWeight: 600, fontSize: '14px', color: '#991b1b', marginBottom: '8px' }}>Unable to load users</div>
                  <div style={{ fontFamily: 'DM Sans', fontSize: '12px', color: '#6b7280', marginBottom: '14px' }}>{error}</div>
                  <button onClick={refetch}
                    style={{ padding: '8px 20px', border: 'none', borderRadius: '8px', background: '#1D2567', color: '#fff', fontFamily: 'DM Sans', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                    Retry
                  </button>
                </div>
              )}

              {/* ── Empty states ── */}
              {!loading && !error && users.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 24px', color: '#9ca3af', fontSize: '13px' }}>No users found.</div>
              )}
              {!loading && !error && users.length > 0 && filteredUsers.length === 0 && isFiltersActive && (
                <div style={{ textAlign: 'center', padding: '40px 24px', color: '#9ca3af', fontSize: '13px' }}>No users match the current filter.</div>
              )}

              {/* ── User list with group headers ── */}
              {!loading && !error && filteredUsers.length > 0 && (
                <div>
                  {groupedUsers.map(group => (
                    <div key={group.key}>
                      {/* Group header */}
                      <div style={{ fontFamily: 'DM Sans', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6B7280', marginTop: '24px', marginBottom: '8px' }}>
                        {group.label}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {group.users.map(u => {
                          const isCurrentUser = u.id === userProfile?.id
                          const isExpanded    = expandedUserId === u.id
                          const draft         = editDrafts[u.id]
                          const lastLog       = lastActionByName[u.full_name]
                          const isOwnerUser   = !!u.is_owner

                          return (
                            <div key={u.id} style={{ border: '1px solid #E5E7EB', borderRadius: '12px', background: u.is_active === false ? '#fafafa' : '#ffffff', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', overflow: 'hidden' }}>

                              {/* Card body */}
                              <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                                <div style={{ position: 'relative', flexShrink: 0 }}>
                                  <UserInitials user={u} size={40} />
                                  {onlineUserIds.has(u.auth_user_id) && (
                                    <span title="Online now" style={{
                                      position: 'absolute', bottom: -2, right: -2,
                                      width: 12, height: 12, borderRadius: '50%',
                                      background: '#10B981', border: '2px solid #ffffff',
                                      boxShadow: '0 0 0 1px rgba(0,0,0,0.05)',
                                    }} />
                                  )}
                                </div>

                                {/* Identity */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '3px' }}>
                                    <span style={{ fontWeight: 600, fontSize: '14px', color: '#1D2567' }}>{u.full_name}</span>
                                    {isCurrentUser && <span style={{ fontSize: '10px', color: '#9ca3af', fontStyle: 'italic' }}>(you)</span>}
                                    <span style={{ background: isOwnerUser ? '#1D2567' : (ROLE_BADGE[u.role] || ROLE_BADGE.viewer).bg, color: isOwnerUser ? '#ffffff' : (ROLE_BADGE[u.role] || ROLE_BADGE.viewer).text, fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px' }}>
                                      {displayRole(u)}
                                    </span>
                                    {u.is_active === false && (
                                      <span style={{ background: '#F3F4F6', color: '#6B7280', fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px' }}>Inactive</span>
                                    )}
                                    {u.can_conduct_interviews && (
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#E0E7FF', color: '#3730A3', fontSize: '10px', fontWeight: 500, padding: '2px 8px', borderRadius: '20px' }}>
                                        Can Interview
                                        <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: u.interviewer_color || '#1D2567', flexShrink: 0 }} />
                                      </span>
                                    )}
                                  </div>

                                  <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '3px' }}>{u.email}</div>

                                  {/* Owner protection label */}
                                  {isOwnerUser && (
                                    <div style={{ fontSize: '11px', color: '#9ca3af', fontStyle: 'italic', marginBottom: '3px' }}>Protected account</div>
                                  )}

                                  {/* Interviewer access scope helper */}
                                  {u.role === 'interviewer' && !isOwnerUser && (
                                    <div style={{ fontSize: '11px', color: '#9ca3af', lineHeight: 1.5, marginBottom: '2px' }}>
                                      <span style={{ color: '#6b7280' }}>Access:</span> Aggregate, Student Profiles, Interview Room<br />
                                      <span style={{ color: '#6b7280' }}>Restricted:</span> Embed, People &amp; Access
                                    </div>
                                  )}

                                  <div style={{ fontSize: '11px', color: '#9ca3af' }}>Last login: {formatLoginDate(u.last_login_at)}</div>
                                  {lastLog ? (
                                    <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      Last action: {lastLog.description} · {formatRelativeTime(lastLog.created_at)}
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: '11px', color: '#d1d5db', marginTop: '2px' }}>No recorded activity</div>
                                  )}
                                </div>

                                {/* Three-dot menu — hidden for owners (except their own card) */}
                                {(!isOwnerUser || isCurrentUser) && !isOwnerUser && (
                                  <div style={{ position: 'relative', flexShrink: 0 }} ref={menuOpenId === u.id ? menuRef : null}>
                                    <button onClick={() => setMenuOpenId(menuOpenId === u.id ? null : u.id)}
                                      style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: '6px', width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#6b7280' }}>
                                      <MoreVertical size={14} />
                                    </button>
                                    {menuOpenId === u.id && (
                                      <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', background: '#ffffff', border: '1px solid #E5E7EB', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100, minWidth: '180px', overflow: 'hidden' }}>
                                        {[
                                          { label: 'Send password reset', action: () => setMenuOpenId(null) },
                                          { label: 'Resend invite',        action: () => setMenuOpenId(null) },
                                        ].map(item => (
                                          <button key={item.label} onClick={item.action}
                                            style={{ width: '100%', padding: '10px 14px', background: 'none', border: 'none', fontFamily: 'DM Sans', fontSize: '13px', color: '#374151', cursor: 'pointer', textAlign: 'left' }}
                                            onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                                            {item.label}
                                          </button>
                                        ))}
                                        <div style={{ height: '1px', background: '#f3f4f6', margin: '2px 0' }} />
                                        {u.is_active !== false ? (
                                          <button onClick={() => { setDeactivateConfirm(u); setMenuOpenId(null) }}
                                            style={{ width: '100%', padding: '10px 14px', background: 'none', border: 'none', fontFamily: 'DM Sans', fontSize: '13px', color: '#dc2626', cursor: 'pointer', textAlign: 'left', fontWeight: 600 }}
                                            onMouseEnter={e => e.currentTarget.style.background = '#fff1f2'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                                            Deactivate user
                                          </button>
                                        ) : (
                                          <button onClick={() => { handleToggleActive(u.id, false); setMenuOpenId(null) }}
                                            style={{ width: '100%', padding: '10px 14px', background: 'none', border: 'none', fontFamily: 'DM Sans', fontSize: '13px', color: '#166534', cursor: 'pointer', textAlign: 'left', fontWeight: 600 }}
                                            onMouseEnter={e => e.currentTarget.style.background = '#f0fdf4'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                                            Reactivate user
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Action buttons */}
                              <div style={{ padding: '0 16px 12px', display: 'flex', gap: '8px' }}>
                                {/* Show Manage Access for: non-owner non-current users, OR the current user (even if owner) */}
                                {((!isOwnerUser && !isCurrentUser) || isCurrentUser) && (
                                  <button onClick={() => openManageAccess(u)}
                                    style={{ padding: '7px 14px', border: '1px solid #1D2567', borderRadius: '8px', background: 'none', fontFamily: 'DM Sans', fontWeight: 600, fontSize: '12px', color: '#1D2567', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                    Manage Access {isExpanded ? '▲' : '▾'}
                                  </button>
                                )}
                                <button
                                  onClick={() => { setActiveView('activity'); setActivityFilter(u.full_name) }}
                                  style={{ padding: '7px 14px', border: '1px solid #e5e7eb', borderRadius: '8px', background: 'none', fontFamily: 'DM Sans', fontSize: '12px', color: '#6b7280', cursor: 'pointer' }}>
                                  View Activity
                                </button>
                              </div>

                              {/* Expandable Manage Access panel */}
                              {isExpanded && draft && (
                                <div style={{ borderTop: '1px solid #F3F4F6', background: '#FAFBFF', padding: '16px' }}>

                                  {/* App Role — disabled for Owner */}
                                  <div style={{ marginBottom: '14px' }}>
                                    <label style={{ display: 'block', fontFamily: 'DM Sans', fontWeight: 600, fontSize: '12px', color: '#374151', marginBottom: '6px' }}>
                                      App Role {isOwnerUser && <span style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 400 }}>(Owner role cannot be changed)</span>}
                                    </label>
                                    <select value={draft.role} disabled={isOwnerUser}
                                      onChange={e => updateDraft(u.id, 'role', e.target.value)}
                                      style={{ ...controlStyle, width: '100%', opacity: isOwnerUser ? 0.5 : 1, cursor: isOwnerUser ? 'not-allowed' : 'pointer' }}>
                                      {isOwnerUser
                                        ? <option value="owner">Owner</option>
                                        : ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label} — {r.description}</option>)
                                      }
                                    </select>
                                  </div>

                                  {/* Can Conduct Interviews toggle */}
                                  {draft.role !== 'viewer' && (
                                    <div style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                      <div>
                                        <div style={{ fontFamily: 'DM Sans', fontWeight: 600, fontSize: '12px', color: '#374151' }}>Can Conduct Interviews</div>
                                        <div style={{ fontFamily: 'DM Sans', fontSize: '11px', color: '#9ca3af' }}>Appears in scheduling dropdowns</div>
                                      </div>
                                      {draft.role === 'interviewer' ? (
                                        <span style={{ fontSize: '11px', color: '#9ca3af', fontStyle: 'italic' }}>Always on for Interviewers</span>
                                      ) : (
                                        <button onClick={() => updateDraft(u.id, 'can_conduct_interviews', !draft.can_conduct_interviews)}
                                          style={{ width: '40px', height: '22px', borderRadius: '11px', border: 'none', background: draft.can_conduct_interviews ? '#1D2567' : '#e5e7eb', position: 'relative', cursor: 'pointer', transition: 'background 0.2s ease', flexShrink: 0 }}>
                                          <div style={{ position: 'absolute', top: '3px', left: draft.can_conduct_interviews ? '21px' : '3px', width: '16px', height: '16px', borderRadius: '50%', background: '#ffffff', transition: 'left 0.2s ease', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                                        </button>
                                      )}
                                    </div>
                                  )}

                                  {/* Interview Calendar Color */}
                                  {(draft.can_conduct_interviews || draft.role === 'interviewer') && (
                                    <div style={{ marginBottom: '16px' }}>
                                      <div style={{ fontFamily: 'DM Sans', fontWeight: 600, fontSize: '12px', color: '#374151', marginBottom: '4px' }}>Interview Calendar Color</div>
                                      <div style={{ fontFamily: 'DM Sans', fontSize: '11px', color: '#9ca3af', marginBottom: '10px' }}>
                                        Used for availability blocks, interviewer legend, and calendar items.
                                      </div>
                                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                        {INTERVIEWER_COLORS.map(c => {
                                          const selected = (draft.interviewer_color || '#1D2567') === c.hex
                                          return (
                                            <div key={c.hex} onClick={() => updateDraft(u.id, 'interviewer_color', c.hex)}
                                              style={{ width: '56px', cursor: 'pointer', border: selected ? '2px solid #1D2567' : '1px solid #E5E7EB', borderRadius: '8px', padding: '6px 4px', textAlign: 'center', background: '#fff', transition: 'border 0.15s ease' }}>
                                              <div style={{ width: '24px', height: '24px', background: c.hex, borderRadius: '4px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                {selected && <span style={{ color: '#fff', fontSize: '13px', fontWeight: 700 }}>✓</span>}
                                              </div>
                                              <div style={{ fontFamily: 'DM Sans', fontWeight: 500, fontSize: '10px', color: '#6b7280', marginTop: '4px', lineHeight: 1.2 }}>{c.name}</div>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    </div>
                                  )}

                                  {/* Save / Cancel */}
                                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                    <button onClick={() => setExpandedUserId(null)}
                                      style={{ padding: '8px 16px', border: '1px solid #e5e7eb', borderRadius: '8px', background: '#f9fafb', fontFamily: 'DM Sans', fontSize: '13px', cursor: 'pointer' }}>
                                      Cancel
                                    </button>
                                    <button onClick={() => saveDraft(u)} disabled={saving}
                                      style={{ padding: '8px 20px', border: 'none', borderRadius: '8px', background: saving ? '#e5e7eb' : '#1D2567', color: '#fff', fontFamily: 'DM Sans', fontWeight: 700, fontSize: '13px', cursor: saving ? 'default' : 'pointer' }}>
                                      {saving ? 'Saving…' : 'Save'}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── ACTIVITY VIEW ── */}
          {activeView === 'activity' && (
            <div>
              {activityFilter && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', marginBottom: '12px', background: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
                  <span style={{ fontFamily: 'DM Sans', fontSize: '12px', color: '#1e40af' }}>
                    Showing activity for: <strong>{activityFilter}</strong>
                  </span>
                  <button onClick={() => setActivityFilter(null)}
                    style={{ background: 'none', border: 'none', fontFamily: 'DM Sans', fontSize: '12px', color: '#6b7280', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                    Clear filter
                  </button>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {activityLogs
                  .filter(log => !activityFilter || log.user_name === activityFilter)
                  .map(log => (
                    <div key={log.id} style={{ padding: '10px 14px', background: '#f9fafb', borderRadius: '10px', border: '1px solid #f3f4f6' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <span style={{ fontWeight: 600, fontSize: '12px', color: '#374151' }}>{log.user_name || 'System'}</span>
                        <span style={{ fontSize: '10px', color: '#9ca3af', whiteSpace: 'nowrap' }}>
                          {new Date(log.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{log.description}</div>
                      {log.user_role && <span style={{ fontSize: '10px', color: '#9ca3af', fontStyle: 'italic' }}>{log.user_role}</span>}
                    </div>
                  ))
                }
                {activityLogs.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '48px 24px', color: '#9ca3af', fontSize: '13px' }}>No activity logged yet.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
