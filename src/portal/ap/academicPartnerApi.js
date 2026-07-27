// src/portal/ap/academicPartnerApi.js
//
// AP-PORTAL: the browser data layer for the Academic Partner Portal's authenticated file access.
//
// Every call is an authenticated fetch to a server endpoint that re-derives authorization from the
// caller's JWT. The browser NEVER sends a school key as authority: the server derives the caller's
// authorized schools from user_school_scopes and denies a student outside that set. No student file
// path and no signed URL is ever constructed here; the server returns short-lived signed URLs and
// the client only ever displays them.

import { supabase } from '../../lib/supabase'

/** Bearer token for the signed-in portal user, or null when signed out. */
async function authHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : null
}

/**
 * One authenticated request. Returns { ok, status, data, error }. Never throws for an expected
 * denial, so callers can leave initials showing rather than surfacing an error.
 */
async function apiFetch(path, { method = 'POST', body = null, signal } = {}) {
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

/**
 * Batch signed URLs for many school-scoped students at once, so a roster of N students signs its
 * photos in ONE request. The server resolves the authorized set once for the whole batch, so the
 * security property is identical to a single call; only the number of round trips changes. Bounded
 * at 100 per the endpoint. Never persisted, never a raw path.
 */
export const getSchoolStudentFileUrlsBatch = (items, signal) =>
  apiFetch('/api/portal/school-student-file-access', { method: 'POST', body: { items }, signal })

/**
 * The authenticated school's submitted placement requests, grouped by authorized school. School
 * scope is derived server-side from user_school_scopes; the browser sends no school identifier.
 */
export const getSchoolPlacementRequests = (signal) =>
  apiFetch('/api/portal/school-placement-requests', { method: 'GET', signal })

/**
 * Submit a new placement request. The server re-derives and re-validates the school, cohort, and
 * (when required) the cohort password, and derives the submitting identity from the caller's
 * profile. NOTE: submission is currently gated on a provenance schema change and returns 503
 * submission_not_enabled until that migration is applied; the workspace disables its submit control
 * accordingly.
 */
export const submitSchoolPlacementRequest = (payload, signal) =>
  apiFetch('/api/portal/school-placement-requests', { method: 'POST', body: payload, signal })
