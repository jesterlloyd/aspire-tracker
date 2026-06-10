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

// WS1e-A3a: the ONLY client path for manual interview scheduling. Sends only the
// exact scheduling contract; server sets status='Interview Scheduled'.
export async function updateInterviewSchedule(studentId, schedule) {
  const res = await fetch('/api/student-update', {
    method:  'POST',
    headers: await authHeaders(),
    body:    JSON.stringify({
      action: 'update_interview_schedule',
      student_id: studentId,
      interview_scheduled_date:        schedule.interview_scheduled_date,
      interview_scheduled_time:        schedule.interview_scheduled_time,
      interview_duration_minutes:      schedule.interview_duration_minutes,
      interview_assigned_interviewers: schedule.interview_assigned_interviewers,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || data.error || 'Scheduling failed')
  return data
}

export async function clearInterviewSchedule(studentId) {
  const res = await fetch('/api/student-update', {
    method:  'POST',
    headers: await authHeaders(),
    body:    JSON.stringify({ action: 'update_interview_schedule', student_id: studentId, clear: true }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || data.error || 'Clear schedule failed')
  return data
}

// WS1e-A4: explicit staff-domain helpers. Each sends only its action + the
// supplied fields (partial updates supported); the server validates and authorizes.
function domainHelper(action) {
  return async (studentId, fields) => {
    const res = await fetch('/api/student-update', {
      method:  'POST',
      headers: await authHeaders(),
      body:    JSON.stringify({ action, student_id: studentId, ...fields }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || data.error || `${action} failed`)
    return data
  }
}
export const updateContact      = domainHelper('update_contact')
export const updateProfile      = domainHelper('update_profile')
export const updateRequirements = domainHelper('update_requirements')
export const updateCslink       = domainHelper('update_cslink')
export const updateNgrp         = domainHelper('update_ngrp')
export const updateBadge        = domainHelper('update_badge')
export const updateNotes        = domainHelper('update_notes')

// WS1e-A4: administrative status override (Owner/Admin), recognized enum only.
export async function updateStatus(studentId, status, declineReason) {
  const body = { action: 'update_student_status', student_id: studentId, status }
  if (declineReason !== undefined) body.decline_reason = declineReason
  const res = await fetch('/api/student-update', {
    method:  'POST',
    headers: await authHeaders(),
    body:    JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || data.error || 'Status update failed')
  return data
}

// WS1e-A3b: unified rubric-outcome persistence (Owner/Admin/Interviewer). Sends
// only the supplied rubric fields (partial updates supported); server validates.
export async function saveInterviewOutcome(studentId, fields) {
  const res = await fetch('/api/student-update', {
    method:  'POST',
    headers: await authHeaders(),
    body:    JSON.stringify({ action: 'save_interview_outcome', student_id: studentId, ...fields }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || data.error || 'Save interview outcome failed')
  return data
}

// WS1e-A3b: manual single-field interview_outcome override (Owner/Admin only).
export async function updateInterviewOutcome(studentId, interviewOutcome) {
  const res = await fetch('/api/student-update', {
    method:  'POST',
    headers: await authHeaders(),
    body:    JSON.stringify({ action: 'update_interview_outcome', student_id: studentId, interview_outcome: interviewOutcome }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || data.error || 'Update interview outcome failed')
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
