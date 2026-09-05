// src/lib/myShiftLifecycleApi.js
//
// STUDENT-SHIFT-TAB-1: the portal's transport for the Shift Log tab. Every call
// carries the session token, and the server resolves the student from it. The
// browser never sends a school email (it is stripped here as well as ignored
// there) and never a student id it did not receive from the server's own
// allowlist answer for an account that holds several records.
import { supabase } from './supabase'

const ENDPOINT = '/api/portal/my-shift-lifecycle'

async function bearer() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token || null
}

// Raw POST returning the fetch Response (or throwing), so the lifecycle hooks
// keep their own status handling exactly as on the public page.
export async function postShiftLifecycle(action, payload = {}, { signal, studentId } = {}) {
  const token = await bearer()
  if (!token) throw new Error('unauthorized')
  const { school_email: dropped, ...rest } = payload || {}
  void dropped
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...(studentId ? { student_id: studentId } : {}), ...rest }),
    signal,
  })
}

// The transport shape the shift-log lifecycle hooks and ShiftLogPage accept in
// place of their public fetch.
export function shiftLifecycleTransport(action, studentId) {
  return { send: (payload, signal) => postShiftLifecycle(action, payload, { signal, studentId }) }
}
