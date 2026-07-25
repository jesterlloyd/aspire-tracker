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

// Canonical unit-availability submission: the portal counterpart of the public
// /unit-form. Writes units + unit_cohort_responses through the same server helper, so a
// Unit Leader's response appears in the staff At a Glance -> Placement Capacity view. The
// server derives the submitter name and email from the profile, so the body carries none.
export const submitParticipation = (body) =>
  apiFetch('/api/portal/unit-participation-submit', { method: 'POST', body })

export const getMilestones = (unitKey, signal) =>
  apiFetch(`/api/portal/unit-milestones${unitQuery(unitKey)}`, { signal })

export const confirmMilestone = (studentId, milestone, comment) =>
  apiFetch('/api/portal/unit-milestones', {
    method: 'POST',
    body: { student_id: studentId, milestone, comment: comment || '' },
  })

export const getNominations = (unitKey, signal) =>
  apiFetch(`/api/portal/unit-preceptor-nominations${unitQuery(unitKey)}`, { signal })

export const getUnitPreceptors = (signal) =>
  apiFetch('/api/portal/unit-preceptors', { signal })

export const createUnitPreceptor = ({ full_name, email, phone, unit_key, shift, requestId }) =>
  apiFetch('/api/portal/unit-preceptor-manage', {
    method: 'POST',
    body: {
      action: 'create_preceptor',
      request_id: requestId,
      full_name,
      email,
      phone,
      unit_key,
      shift,
    },
  })

export const mutateUnitPreceptorAssignment = ({
  action, op, role, student_id, preceptor_id, assignment_id, request_id,
}) => apiFetch('/api/portal/unit-preceptor-manage', {
  method: 'POST',
  body: { action, op, role, student_id, preceptor_id, assignment_id, request_id },
})

/** Report a Concern, or open a direct thread with a student. */
export const startUnitConversation = ({ destination, studentId, subject, category, body }) =>
  apiFetch('/api/portal/unit-messages-start', {
    method: 'POST',
    body: { destination, student_id: studentId, subject, category, body },
  })

export const getNotifications = (unitKey, signal) =>
  apiFetch(`/api/portal/unit-notifications${unitQuery(unitKey)}`, { signal })

export const setNotificationPreference = (alertType, emailEnabled) =>
  apiFetch('/api/portal/unit-notifications', {
    method: 'POST',
    body: { alert_type: alertType, email_enabled: emailEnabled },
  })

/**
 * Rotation activity for the calendar: completed and in-progress shifts only.
 *
 * The server bounds this to a rolling 90 days and refuses a future range, because there
 * is no forward schedule to return. It also enforces the safe-field allowlist, so no
 * support narrative, internal note, or review metadata can arrive here.
 */
export const getShiftActivity = ({ from, to } = {}, signal) => {
  const q = new URLSearchParams()
  if (from) q.set('from', from)
  if (to) q.set('to', to)
  const qs = q.toString()
  return apiFetch(`/api/portal/unit-shift-activity${qs ? `?${qs}` : ''}`, { signal })
}

/**
 * Unit Leader evaluations: a released, unit-scoped, quantitative-only summary plus an
 * anonymous response list for one approved instrument. instrument is required (one of the
 * two approved slugs). unit_key narrows to a single authorized unit; ALL_UNITS (or omitting
 * it) means All Assigned Units. The server derives and enforces scope; this can only narrow.
 * The response carries no identity, timestamps, free text, ids, or stable tokens.
 */
export const getUnitEvaluations = ({ instrument, timepoint, unitKey } = {}, signal) => {
  const q = new URLSearchParams()
  if (instrument) q.set('instrument', instrument)
  if (timepoint) q.set('timepoint', timepoint)
  if (unitKey && unitKey !== ALL_UNITS) q.set('unit_key', unitKey)
  const qs = q.toString()
  return apiFetch(`/api/portal/unit-evaluations${qs ? `?${qs}` : ''}`, { signal })
}

/**
 * The approved detail record for ONE scoped student.
 *
 * The student id is an IDENTIFIER, not authority: the server re-derives the unit
 * from the student's own placement and answers 404 for anything out of scope, so
 * calling this with an arbitrary id cannot widen what the caller may see.
 */
export const getStudentDetail = (studentId, signal) =>
  apiFetch(`/api/portal/unit-student-detail?student_id=${encodeURIComponent(studentId)}`, { signal })

/** A short-lived signed URL for one scoped student file. Never persisted. */
export const getStudentFileUrl = (studentId, kind) =>
  apiFetch('/api/portal/unit-student-file-access', {
    method: 'POST',
    body: { student_id: studentId, kind },
  })

/**
 * Batch signed URLs for many scoped students at once, so a roster of N students
 * signs its photos in ONE request instead of N. The server resolves the authorized
 * set once for the whole batch, so the security property is identical to the single
 * call; only the number of round trips changes. Bounded at 100 per the endpoint.
 * Never persisted, never a raw path.
 */
export const getStudentFileUrlsBatch = (items, signal) =>
  apiFetch('/api/portal/unit-student-file-access', {
    method: 'POST',
    body: { items },
    signal,
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

/** 'changes_requested' -> 'Changes requested'. Text stays the meaning carrier. */
export function sentenceCase(value) {
  const text = String(value || '').replace(/_/g, ' ').trim()
  return text ? text[0].toUpperCase() + text.slice(1) : text
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
