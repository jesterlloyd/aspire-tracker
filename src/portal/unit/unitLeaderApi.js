// src/portal/unit/unitLeaderApi.js
//
// UL-PORTAL: the browser data layer for the Unit Leader Portal.
//
// Every call is an authenticated fetch to a server endpoint that re-derives
// authorization from the caller's JWT. The browser NEVER sends a unit key as
// authority: it may send one only to NARROW an already-authorized set, and the
// server denies a unit outside scope rather than falling back to everything.
//
// No student file path, no signed URL, and no cohort id is ever constructed here.

import { supabase } from '../../lib/supabase'

// The empty placeholder used across the portal.
export const EMPTY = '-'

/** Bearer token for the signed-in portal user, or null when signed out. */
async function authHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : null
}

/**
 * One authenticated request. Returns { ok, status, data, error }.
 * Never throws for an expected denial, so callers can render a permission state
 * rather than an error state.
 */
export async function apiFetch(path, { method = 'GET', body = null, signal } = {}) {
  const headers = await authHeader()
  if (!headers) return { ok: false, status: 401, data: null, error: 'unauthenticated' }

  try {
    const res = await fetch(path, {
      method,
      signal,
      headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    let payload = null
    try { payload = await res.json() } catch { payload = null }
    if (!res.ok) {
      return { ok: false, status: res.status, data: payload, error: payload?.error || 'request_failed' }
    }
    return { ok: true, status: res.status, data: payload, error: null }
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, status: 0, data: null, error: 'aborted' }
    return { ok: false, status: 0, data: null, error: 'network_error' }
  }
}

/** A unit_key query string, only when narrowing to a single unit. */
function unitQuery(unitKey) {
  return unitKey && unitKey !== ALL_UNITS ? `?unit_key=${encodeURIComponent(unitKey)}` : ''
}

// The sentinel for the "All assigned units" view. It is never sent to the server:
// omitting unit_key IS the all-units request, so the server decides the full set.
export const ALL_UNITS = '__all__'

export const getRoster = (signal) =>
  apiFetch('/api/portal/unit-roster', { signal })

export const getPlacementRequests = (unitKey, signal) =>
  apiFetch(`/api/portal/unit-placement-requests${unitQuery(unitKey)}`, { signal })

export const respondToPlacement = (requestId, unitResponse, unitComment) =>
  apiFetch('/api/portal/unit-placement-requests', {
    method: 'POST',
    body: { request_id: requestId, unit_response: unitResponse, unit_comment: unitComment || '' },
  })

export const getCapacity = (unitKey, signal) =>
  apiFetch(`/api/portal/unit-capacity${unitQuery(unitKey)}`, { signal })

export const submitCapacity = (payload) =>
  apiFetch('/api/portal/unit-capacity', { method: 'POST', body: payload })

export const getMilestones = (unitKey, signal) =>
  apiFetch(`/api/portal/unit-milestones${unitQuery(unitKey)}`, { signal })

export const confirmMilestone = (studentId, milestone, comment) =>
  apiFetch('/api/portal/unit-milestones', {
    method: 'POST',
    body: { student_id: studentId, milestone, comment: comment || '' },
  })

export const getNominations = (unitKey, signal) =>
  apiFetch(`/api/portal/unit-preceptor-nominations${unitQuery(unitKey)}`, { signal })

export const nominatePreceptor = ({ studentId, preceptorId, proposedName, note }) =>
  apiFetch('/api/portal/unit-preceptor-nominations', {
    method: 'POST',
    body: {
      student_id: studentId,
      ...(preceptorId ? { preceptor_id: preceptorId } : {}),
      ...(proposedName ? { proposed_name: proposedName } : {}),
      note: note || '',
    },
  })

/** Report a Concern, or open a direct thread with a student. */
export const startUnitConversation = ({ destination, studentId, subject, category, body }) =>
  apiFetch('/api/portal/unit-messages-start', {
    method: 'POST',
    body: { destination, student_id: studentId, subject, category, body },
  })

/** A short-lived signed URL for one scoped student file. Never persisted. */
export const getStudentFileUrl = (studentId, kind) =>
  apiFetch('/api/portal/unit-student-file-access', {
    method: 'POST',
    body: { student_id: studentId, kind },
  })

// ── Presentation helpers ────────────────────────────────────────────────────

/** Any empty value renders as the standard placeholder. */
export const orDash = (v) =>
  v === null || v === undefined || v === '' ? EMPTY : v

/** A student's display name, preferring the preferred first name. */
export function studentName(s) {
  if (!s) return EMPTY
  const first = s.preferred_first_name || s.first_name || ''
  const last = s.last_name || ''
  const full = `${first} ${last}`.trim()
  return full || EMPTY
}

export const BUCKET_LABEL = {
  upcoming: 'Upcoming',
  active: 'Active rotation',
  completed: 'Recently completed',
}

export const ONBOARDING_LABEL = {
  ready: 'Ready',
  in_progress: 'In progress',
  not_started: 'Not started',
  needs_attention: 'Needs attention',
}

export const OUTSTANDING_LABEL = {
  badge: 'Badge',
  access: 'Access',
  orientation: 'Orientation',
  acknowledgment: 'Acknowledgment',
  other: 'Other requirement',
}

/**
 * ASPIRE authority wording, used wherever a Unit Leader action is recorded.
 * A Unit Leader response is never presented as a decision.
 */
export const ASPIRE_AUTHORITY_NOTE =
  'ASPIRE reviews and confirms this. Your response is recorded for the ASPIRE team.'
