// src/lib/keith/keithCheckinApi.js
//
// KEITH-CHECKIN-1: the browser's calls to /api/keith-checkin (queue, reopen, undo_reopen, set_mode).
// The session's access token goes as a bearer token; the server decides everything else.
import { supabase } from '../supabase'

export class KeithCheckinError extends Error {
  constructor(status, code, message) { super(message || 'Keith check-in request failed'); this.status = status; this.code = code }
}

export async function keithCheckin(action, params = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch('/api/keith-checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, ...params }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new KeithCheckinError(res.status, json?.error, json?.message)
  return json
}
