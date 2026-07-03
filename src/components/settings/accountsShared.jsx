/* eslint-disable react-refresh/only-export-components */
// (Intentionally exports shared constants/helpers alongside the small UserInitials avatar component so
// the board, profile modal, and invite popup share one source of truth. The disabled rule is a
// dev-only Fast-Refresh hint with no runtime/production impact.)
// ACCOUNTS-ACCESS-PROFILE-BOARD-2B: shared account constants + helpers used by the people board
// (UserManagement), the Account Profile modal, and the Invite popup. Extracted verbatim from
// UserManagement.jsx so the three surfaces stay in lock-step and avoid a circular import. Pure
// config/helpers — no data/API/behavior.
import { useState } from 'react'

export const ROLE_OPTIONS = [
  { value: 'admin',       label: 'Admin',       description: 'Full operational access' },
  { value: 'co-lead',     label: 'Co-Lead',     description: 'Placement + student management' },
  { value: 'interviewer', label: 'Interviewer',  description: 'Rubric and interview access' },
  { value: 'viewer',      label: 'Viewer',       description: 'Read-only dashboard' },
]

export const ROLE_BADGE = {
  owner:       { bg: '#1D2567', text: '#ffffff' },
  admin:       { bg: '#065F46', text: '#ffffff' },
  'co-lead':   { bg: '#3730A3', text: '#ffffff' },
  interviewer: { bg: '#FCEFD4', text: '#7C5A1F' },
  viewer:      { bg: '#F1F5F9', text: '#475569' },
}

export const INTERVIEWER_COLORS = [
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

export function formatLoginDate(dateStr) {
  if (!dateStr) return 'Never logged in'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function formatRelativeTime(dateStr) {
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

export function displayRole(user) {
  if (user.is_owner) return 'Owner'
  const r = user.role || 'viewer'
  return r.charAt(0).toUpperCase() + r.slice(1)
}

export function sortUsers(users) {
  return [...users].sort((a, b) => {
    const aActive = a.is_active !== false
    const bActive = b.is_active !== false
    if (aActive !== bActive) return aActive ? -1 : 1
    const ra = a.is_owner ? 0 : (ROLE_ORDER[a.role] ?? 99)
    const rb = b.is_owner ? 0 : (ROLE_ORDER[b.role] ?? 99)
    if (ra !== rb) return ra - rb
    return (a.full_name || '').localeCompare(b.full_name || '')
  })
}

export function groupUsers(users) {
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

// ACCOUNTS-ACCESS-PROFILE-BOARD-2B1: optional `ring` style (merged into the avatar) gives real photos
// AND initials a polished outline — a Nightfall ring on the board cards and a soft white hero ring in
// the profile modal, mirroring the Student Profiles avatar treatment. Image source/fallback unchanged.
export function UserInitials({ user, size = 40, ring = null }) {
  const [err, setErr] = useState(false)
  const initials = (user.full_name || '?').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
  const ringStyle = ring || {}
  if (user.avatar_url && !err) {
    return (
      <img src={user.avatar_url} alt={user.full_name}
        onError={() => setErr(true)}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, ...ringStyle }} />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: '#1D2567',
      flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'DM Sans, sans-serif', fontWeight: 700,
      fontSize: Math.round(size * 0.35) + 'px', color: '#ffffff', ...ringStyle,
    }}>{initials}</div>
  )
}

// Nightfall outline for board-card avatars (white gap + navy ring + soft lift).
export const CARD_AVATAR_RING = { border: '2px solid #ffffff', boxShadow: '0 0 0 2px #1D2567, 0 1px 4px rgba(29,37,103,0.18)' }
// Airy white ring for the profile-modal hero avatar (matches the Student Profile hero).
export const HERO_AVATAR_RING = { border: '4px solid #ffffff', boxShadow: '0 4px 18px rgba(29,37,103,0.16)' }
