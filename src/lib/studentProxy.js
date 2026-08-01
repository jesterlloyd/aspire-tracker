// /api/student-update accepts ONLY explicit, server-validated actions (WS1e-A5
// removed the generic `update` action). Every helper forwards the staff Bearer
// token; authorization is decided server-side from the verified caller profile.
import { supabase } from './supabase'

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
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
// STUDENT-PORTAL-PROFILE-1: Owner/Admin correction of the student-sourced availability block.
export const updateStudentAvailability = domainHelper('update_student_availability')

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
