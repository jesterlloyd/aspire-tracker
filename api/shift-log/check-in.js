// api/shift-log/check-in.js
//
// POST /api/shift-log/check-in
// Body: { school_email (required), expected_hours?, planned_unit_name?,
//         planned_preceptor_name?, planned_shift_type? }
//
// Creates an in_progress shift log row for an eligible Active Rotation student.
// Reuses the B1 lookup helper (lookupStudentByEmail) for student matching +
// eligibility, without modifying its contract.
//
// Phase S.2.B2: DORMANT - no frontend caller. Testable via direct HTTP (curl).
//
// Idempotency / one-open-shift:
//   - Layer 1: if the lookup already reports an open shift, return it (200).
//   - Layer 2: insert a truthful in_progress row.
//   - Layer 3: if the S.2.A partial unique index races (SQLSTATE 23505), refetch
//     the existing open shift and return it (200).
//
// Truthful in_progress row: final completed-shift fields are explicitly NULL so
// they do NOT inherit column defaults; assignment indicators are NULL (unknown
// until check-out, NOT false); preceptor_id is never name-matched.
//
// Logging never includes school_email, full_name, or planned_* values.

import { randomUUID } from 'crypto'
import supabaseAdmin from '../../lib/server/evaluation/supabase_admin.js'
import { lookupStudentByEmail } from '../lib/shiftLogLookup.js'

const VALID_SHIFT_TYPES = ['Day', 'Night', 'Mid', 'Variable']

// Columns returned for the created/existing shift (explicit; no select('*')).
const SHIFT_SELECT =
  'id, student_id, cohort_id, shift_date, lifecycle_state, checked_in_at, expected_hours, planned_unit_name, planned_preceptor_name, planned_shift_type, school_email'

export default async function handler(req, res) {
  const requestId = `req_${randomUUID().slice(0, 8)}`
  const startTime = Date.now()

  if (req.method !== 'POST') {
    logRequest(requestId, 'method_not_allowed', null, null, Date.now() - startTime)
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  let body
  try {
    body = (req.body && typeof req.body === 'object') ? req.body : JSON.parse(req.body || '{}')
  } catch {
    logRequest(requestId, 'validation_failed', null, null, Date.now() - startTime, 'invalid_json')
    return res.status(400).json({ error: 'invalid_request', message: 'Invalid JSON', request_id: requestId })
  }

  // ── Required: school_email (trimmed; whitespace-only is invalid) ────────────
  const schoolEmail = typeof body.school_email === 'string' ? body.school_email.trim() : ''
  if (!schoolEmail) {
    logRequest(requestId, 'validation_failed', null, null, Date.now() - startTime, 'school_email_missing')
    return res.status(400).json({ error: 'invalid_request', field: 'school_email', message: 'school_email is required', request_id: requestId })
  }

  // ── Optional: expected_hours - STRICT JSON number, 1..24 (no string coercion) ─
  let validatedExpectedHours = null
  if (body.expected_hours !== undefined && body.expected_hours !== null) {
    if (
      typeof body.expected_hours !== 'number' ||
      !Number.isFinite(body.expected_hours) ||
      body.expected_hours < 1 ||
      body.expected_hours > 24
    ) {
      logRequest(requestId, 'validation_failed', null, null, Date.now() - startTime, 'expected_hours_invalid')
      return res.status(400).json({ error: 'invalid_request', field: 'expected_hours', message: 'expected_hours must be a number between 1 and 24', request_id: requestId })
    }
    validatedExpectedHours = body.expected_hours
  }

  // ── Optional: planned_shift_type (enum) ─────────────────────────────────────
  let validatedPlannedShiftType = null
  if (body.planned_shift_type !== undefined && body.planned_shift_type !== null && body.planned_shift_type !== '') {
    if (typeof body.planned_shift_type !== 'string' || !VALID_SHIFT_TYPES.includes(body.planned_shift_type)) {
      logRequest(requestId, 'validation_failed', null, null, Date.now() - startTime, 'planned_shift_type_invalid')
      return res.status(400).json({ error: 'invalid_request', field: 'planned_shift_type', message: 'planned_shift_type must be one of Day, Night, Mid, Variable', request_id: requestId })
    }
    validatedPlannedShiftType = body.planned_shift_type
  }

  // ── Optional: planned_unit_name (string ≤200) ───────────────────────────────
  let validatedPlannedUnitName = null
  if (body.planned_unit_name !== undefined && body.planned_unit_name !== null && body.planned_unit_name !== '') {
    if (typeof body.planned_unit_name !== 'string' || body.planned_unit_name.length > 200) {
      logRequest(requestId, 'validation_failed', null, null, Date.now() - startTime, 'planned_unit_name_invalid')
      return res.status(400).json({ error: 'invalid_request', field: 'planned_unit_name', message: 'planned_unit_name must be a string up to 200 characters', request_id: requestId })
    }
    const trimmed = body.planned_unit_name.trim()
    if (trimmed !== '') validatedPlannedUnitName = trimmed
  }

  // ── Optional: planned_preceptor_name (string ≤200) ──────────────────────────
  let validatedPlannedPreceptorName = null
  if (body.planned_preceptor_name !== undefined && body.planned_preceptor_name !== null && body.planned_preceptor_name !== '') {
    if (typeof body.planned_preceptor_name !== 'string' || body.planned_preceptor_name.length > 200) {
      logRequest(requestId, 'validation_failed', null, null, Date.now() - startTime, 'planned_preceptor_name_invalid')
      return res.status(400).json({ error: 'invalid_request', field: 'planned_preceptor_name', message: 'planned_preceptor_name must be a string up to 200 characters', request_id: requestId })
    }
    const trimmed = body.planned_preceptor_name.trim()
    if (trimmed !== '') validatedPlannedPreceptorName = trimmed
  }

  // ── Student lookup + eligibility (B1 helper, reused as-is) ───────────────────
  let lookupResult
  try {
    lookupResult = await lookupStudentByEmail(schoolEmail)
  } catch (err) {
    logRequest(requestId, 'error', null, null, Date.now() - startTime, err.message)
    return res.status(500).json({ error: 'internal_error', request_id: requestId })
  }

  // Helper-reported invalid email → 400 (NOT a 403 eligibility outcome).
  if (!lookupResult.found && lookupResult.error === 'invalid_email') {
    logRequest(requestId, 'validation_failed', null, null, Date.now() - startTime, 'invalid_email')
    return res.status(400).json({ error: 'invalid_request', field: 'school_email', message: 'school_email is required', request_id: requestId })
  }

  // Duplicate registered emails → conflict; never create a shift, never expose a profile.
  if (!lookupResult.found && lookupResult.error === 'ambiguous_student_email') {
    logRequest(requestId, 'ambiguous_email', null, null, Date.now() - startTime)
    return res.status(409).json({ error: 'conflict', reason: 'ambiguous_student_email', request_id: requestId })
  }

  // No matching student.
  if (!lookupResult.found) {
    logRequest(requestId, 'not_eligible', null, null, Date.now() - startTime, 'student_not_found')
    return res.status(403).json({ error: 'not_eligible', reason: 'student_not_found', request_id: requestId })
  }

  // Found but ineligible (cohort_archived | not_active_rotation).
  if (!lookupResult.eligible) {
    logRequest(requestId, 'not_eligible', lookupResult.student?.id || null, null, Date.now() - startTime, lookupResult.ineligible_reason)
    return res.status(403).json({ error: 'not_eligible', reason: lookupResult.ineligible_reason, request_id: requestId })
  }

  const student = lookupResult.student

  // Layer 1: existing open shift → idempotent return.
  if (lookupResult.open_shift) {
    logRequest(requestId, 'existing_open_shift', student.id, lookupResult.open_shift.id, Date.now() - startTime)
    return res.status(200).json({ created: false, shift: toCheckInShift(lookupResult.open_shift, student), message: 'Already checked in' })
  }

  // Server-generated timestamps.
  const now = new Date()
  const checkedInAt = now.toISOString()        // UTC instant for timestamptz
  const shiftDate = pacificDateString(now)     // Pacific YYYY-MM-DD

  // Truthful in_progress row - explicit NULLs override column defaults.
  const insertPayload = {
    student_id:   student.id,
    cohort_id:    student.cohort_id,
    school_email: student.school_email,  // canonical form from lookup

    lifecycle_state: 'in_progress',
    checked_in_at:   checkedInAt,
    shift_date:      shiftDate,

    // Planned values (populated only if provided)
    expected_hours:         validatedExpectedHours,
    planned_unit_name:      validatedPlannedUnitName,
    planned_preceptor_name: validatedPlannedPreceptorName,
    planned_shift_type:     validatedPlannedShiftType,

    // Final completed-shift fields - explicit NULL (no inherited defaults)
    total_hours:    null,
    status:         null,   // overrides default 'approved'
    unit_name:      null,   // overrides default ''
    preceptor_name: null,   // overrides default ''
    shift_type:     null,   // overrides default 'Day'
    attestation:    false,  // no attestation at check-in

    // Assignment indicators are UNKNOWN at check-in - NULL, not false.
    is_assigned_unit:        null,
    is_assigned_preceptor:   null,
    unit_override_reason:    null,
    preceptor_override_note: null,

    // Never name-match a preceptor.
    preceptor_id: null,

    // Reflection/review fields - filled at check-out or by a reviewer.
    learning_highlight: null,
    support_needed:     null,
    admin_notes:        null,
    review_reason:      null,
    reviewed_by:        null,
    reviewed_at:        null,
    checked_out_at:     null,
  }

  // Layer 2: insert.
  try {
    const { data: insertedShift, error: insertError } = await supabaseAdmin
      .from('student_shift_logs')
      .insert(insertPayload)
      .select(SHIFT_SELECT)
      .single()

    if (insertError) {
      // Layer 3: race on the one-open-shift partial unique index.
      if (insertError.code === '23505') {
        const { data: existingShifts, error: refetchError } = await supabaseAdmin
          .from('student_shift_logs')
          .select(SHIFT_SELECT)
          .eq('student_id', student.id)
          .eq('lifecycle_state', 'in_progress')
          .limit(1)

        if (refetchError || !existingShifts || existingShifts.length === 0) {
          logRequest(requestId, 'race_refetch_failed', student.id, null, Date.now() - startTime, refetchError?.message || 'refetch_empty')
          return res.status(500).json({ error: 'internal_error', request_id: requestId })
        }

        logRequest(requestId, 'unique_violation_handled', student.id, existingShifts[0].id, Date.now() - startTime)
        return res.status(200).json({ created: false, shift: toCheckInShift(existingShifts[0], student), message: 'Already checked in' })
      }
      throw insertError
    }

    logRequest(requestId, 'created', student.id, insertedShift.id, Date.now() - startTime)
    return res.status(201).json({ created: true, shift: toCheckInShift(insertedShift, student) })
  } catch (err) {
    logRequest(requestId, 'error', student.id, null, Date.now() - startTime, err.message)
    return res.status(500).json({ error: 'internal_error', request_id: requestId })
  }
}

// Normalize the returned shift to an identical shape across all success paths
// (newly created 201, pre-existing open shift 200, race-refetch 200). The B1
// helper's open_shift omits student_id/cohort_id/school_email/lifecycle_state;
// fill those from the resolved student so the contract is always complete.
function toCheckInShift(row, student) {
  return {
    id:                     row.id,
    student_id:             row.student_id || student.id,
    cohort_id:              row.cohort_id || student.cohort_id,
    school_email:           row.school_email || student.school_email,
    shift_date:             row.shift_date,
    lifecycle_state:        row.lifecycle_state || 'in_progress',
    checked_in_at:          row.checked_in_at,
    expected_hours:         row.expected_hours ?? null,
    planned_unit_name:      row.planned_unit_name ?? null,
    planned_preceptor_name: row.planned_preceptor_name ?? null,
    planned_shift_type:     row.planned_shift_type ?? null,
  }
}

// Pacific (America/Los_Angeles) YYYY-MM-DD, DST-aware via ICU. No fixed offset.
function pacificDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

// PII-free structured log line.
function logRequest(requestId, outcome, studentId, shiftId, duration, errorMessage) {
  const parts = [`[shift-log/check-in]`, `req=${requestId}`, `outcome=${outcome}`]
  if (studentId) parts.push(`student=${studentId}`)
  if (shiftId) parts.push(`shift=${shiftId}`)
  parts.push(`duration=${duration}ms`)
  if (errorMessage) parts.push(`error="${errorMessage}"`)
  console.log(parts.join(' '))
}
