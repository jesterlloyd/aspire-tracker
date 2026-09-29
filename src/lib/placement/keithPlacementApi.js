// src/lib/placement/keithPlacementApi.js
//
// KEITH-PLACEMENT-1: the browser's calls to /api/keith-placement. The session's access token goes as a
// bearer token; the server decides everything else.
import { supabase } from '../supabase'

export class KeithPlacementError extends Error {
  constructor(status, code, message) { super(message || 'The suggestion request failed.'); this.status = status; this.code = code }
}

export async function keithPlacement(action, params = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch('/api/keith-placement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, ...params }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new KeithPlacementError(res.status, json?.error, json?.message)
  return json
}

/** Set the suggested preceptor as the student's primary, through the audited endpoint the board's own modal uses. */
export async function assignPrimaryPreceptor(studentId, preceptorId) {
  const { data: { session } } = await supabase.auth.getSession()
  const requestId = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)
  const res = await fetch('/api/preceptor-primary-assign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify({ requestId, studentId, preceptorId }),
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error(j.error || 'The preceptor could not be assigned.')
  }
}
