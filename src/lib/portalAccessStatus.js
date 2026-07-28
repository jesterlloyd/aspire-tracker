// ASPIRE-PORTAL-ACCESS-UI: pure, shared logic for the Accounts & Access
// directory. No React, no I/O, so both the browser (badges, filters) and the
// static tests import the same source of truth.
//
// A portal grant is one row from user_role_grants with its activation window.
// "Active" is defined exactly as in the Phase 2 migrations:
//   revoked_at IS NULL AND starts_at <= now AND (expires_at IS NULL OR > now)

export const PORTAL_ROLE_LABELS = {
  student: 'Student',
  unit_leader: 'Unit Leader',
  academic_partner: 'Academic Partner',
}

export const PORTAL_ROLE_OPTIONS = [
  { value: 'student', label: 'Student' },
  { value: 'unit_leader', label: 'Unit Leader' },
  { value: 'academic_partner', label: 'Academic Partner' },
]

// Text-labelled, accessible status styles (never color alone: each carries a label).
export const PORTAL_STATUS_STYLES = {
  active:    { label: 'Active',    bg: '#EDF2E2', color: '#166534', dot: '#3f9142' },
  scheduled: { label: 'Scheduled', bg: '#eef2fb', color: '#1D2567', dot: '#6b7fd7' },
  expired:   { label: 'Expired',   bg: '#FEF3C7', color: '#78350F', dot: '#d08700' },
  revoked:   { label: 'Revoked',   bg: '#f3f4f6', color: '#6b7280', dot: '#9ca3af' },
  // ACCOUNTS-ACCESS-DIRECTORY-2: server-derived status for grants whose auth
  // user has not accepted their invitation yet. Matches the interviewer gold
  // badge family; not produced by derivePortalStatus (see note below).
  pending:   { label: 'Pending',   bg: '#FCEFD4', color: '#7C5A1F', dot: '#d08700' },
}

export const EXPIRING_SOON_DAYS = 30

// Derive a grant's lifecycle status. `grant` carries starts_at, expires_at,
// revoked_at (ISO strings or null). `nowMs` is injectable for deterministic tests.
export function derivePortalStatus(grant, nowMs = Date.now()) {
  if (!grant) return 'revoked'
  if (grant.revoked_at) return 'revoked'
  const starts = grant.starts_at ? Date.parse(grant.starts_at) : null
  const expires = grant.expires_at ? Date.parse(grant.expires_at) : null
  if (expires != null && expires <= nowMs) return 'expired'
  if (starts != null && starts > nowMs) return 'scheduled'
  return 'active'
}

// True when the grant is currently active AND expires within `days`.
export function isExpiringSoon(grant, nowMs = Date.now(), days = EXPIRING_SOON_DAYS) {
  if (derivePortalStatus(grant, nowMs) !== 'active') return false
  if (!grant.expires_at) return false
  const expires = Date.parse(grant.expires_at)
  const horizon = nowMs + days * 24 * 60 * 60 * 1000
  return expires > nowMs && expires <= horizon
}

// One-line human scope summary for a portal access record (used in the table
// cell and card). Never exposes internal identifiers.
export function summarizeScope(record) {
  if (!record) return ''
  if (record.portal_role === 'student') {
    const s = (record.scope?.students || [])[0]
    if (!s) return 'No linked student'
    return [s.name, s.school, s.cohort].filter(Boolean).join(' · ')
  }
  if (record.portal_role === 'unit_leader') {
    const units = (record.scope?.units || []).map(u => u.unit_key).filter(Boolean)
    if (!units.length) return 'No units assigned'
    const head = units.slice(0, 2).join(', ')
    return units.length > 2 ? `${head} +${units.length - 2} more` : head
  }
  if (record.portal_role === 'academic_partner') {
    const schools = (record.scope?.schools || []).map(s => s.school_key).filter(Boolean)
    if (!schools.length) return 'No schools assigned'
    const head = schools.slice(0, 2).join(', ')
    return schools.length > 2 ? `${head} +${schools.length - 2} more` : head
  }
  return ''
}
