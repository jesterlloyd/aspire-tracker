// loadedUpdatedAt — optional OCC guard: the updated_at value the caller had when
// they last loaded this student.  When supplied, the API adds
// .eq('updated_at', loadedUpdatedAt) to the WHERE clause; a 409 response means
// another user (or tab) saved while this user was editing.
//
// WS1e-A1: /api/student-update now requires a server-verified staff Bearer token.
// All callers route through this helper, so we forward the current session token
// centrally here (rather than per component). Authorization is decided server-side.
import { supabase } from './supabase'

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export async function updateStudent(studentId, fields, loadedUpdatedAt) {
  const res = await fetch('/api/student-update', {
    method:  'POST',
    headers: await authHeaders(),
    body:    JSON.stringify({
      action: 'update',
      student_id: studentId,
      fields,
      loaded_updated_at: loadedUpdatedAt || null,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 409) {
    const err = new Error('CONFLICT')
    err.conflict = true
    err.currentUpdatedAt = data.current_updated_at
    throw err
  }
  if (!res.ok) throw new Error(data.message || data.error || 'Update failed')
  return data.data  // full updated row including fresh updated_at
}

// WS1e-A2: the ONLY client path for preceptor/shift assignment. Accepts only the
// two approved fields (matched_preceptor / shift_assigned); never a generic object.
export async function updatePreceptorAssignment(studentId, fields) {
  const body = { action: 'update_preceptor_assignment', student_id: studentId }
  if (fields && fields.matched_preceptor !== undefined) body.matched_preceptor = fields.matched_preceptor
  if (fields && fields.shift_assigned     !== undefined) body.shift_assigned     = fields.shift_assigned
  if (body.matched_preceptor === undefined && body.shift_assigned === undefined) {
    throw new Error('No preceptor/shift fields to update')
  }
  const res = await fetch('/api/student-update', {
    method:  'POST',
    headers: await authHeaders(),
    body:    JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || data.error || 'Preceptor assignment failed')
  return data
}

export async function updateStudentStatus(studentId, status, declineReason) {
  const res = await fetch('/api/student-update', {
    method:  'POST',
    headers: await authHeaders(),
    body:    JSON.stringify({ action: 'update_status', student_id: studentId, status, decline_reason: declineReason || null }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || data.error || 'Status update failed')
  return data.data
}

export async function logStudentEvent(studentId, cohortId, eventType, notes, createdBy) {
  const res = await fetch('/api/student-update', {
    method:  'POST',
    headers: await authHeaders(),
    body:    JSON.stringify({ action: 'log_event', student_id: studentId, cohort_id: cohortId, event_type: eventType, notes: notes || '', created_by: createdBy || 'System' }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || data.error || 'Event log failed')
  return true
}
