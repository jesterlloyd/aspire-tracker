// src/lib/evaluationReviewApi.js
//
// Browser data layer for the Owner/Admin Unit Leader evaluation Review & Release console.
// Every call attaches the Supabase session access token as a Bearer header; the server
// verifies Owner/Admin and the database RPCs re-check is_active_owner_or_admin() via
// auth.uid(). Returns { ok, status, data, error } and never throws on an expected denial,
// mirroring the portal apiFetch contract so callers render a message instead of crashing.

import { supabase } from './supabase'

async function authHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : null
}

async function request(path, { method = 'GET', body = null, signal } = {}) {
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
      return { ok: false, status: res.status, data: payload, error: payload?.error || payload?.status || 'request_failed' }
    }
    return { ok: true, status: res.status, data: payload, error: null }
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, status: 0, data: null, error: 'aborted' }
    return { ok: false, status: 0, data: null, error: 'network_error' }
  }
}

/** Owner/Admin: the Unit Leader evaluation release queue, filtered. */
export function getReviewQueue(filters = {}, signal) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) { if (v) q.set(k, v) }
  const qs = q.toString()
  return request(`/api/evaluation-unit-release-queue${qs ? `?${qs}` : ''}`, { signal })
}

/**
 * Owner/Admin: a single lifecycle action on one exact response.
 * action: 'moderate' | 'release' | 'revoke' | 'rerelease'. decision ('cleared'|'blocked')
 * is required for 'moderate'. The server returns the RPC's exact status.
 */
export function postReleaseAction({ action, responseId, decision } = {}) {
  return request('/api/evaluation-unit-release-action', {
    method: 'POST',
    body: { action, response_id: responseId, ...(decision ? { decision } : {}) },
  })
}
