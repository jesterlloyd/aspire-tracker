// api/shift-log/check-out.js
//
// POST /api/shift-log/check-out
//
// Completes an in_progress shift: validates the request, reuses the B1 lookup
// helper for student matching/eligibility, fetches the shift (explicit fields),
// verifies ownership, reproduces the LIVE ShiftLogPage.jsx exception-flag logic,
// derives status/review_reason, self-checks internal consistency, then calls the
// public.shift_log_check_out RPC (S.2.B3.A) for the atomic transition + totals
// recomputation, and returns a normalized response.
//
// Phase S.2.B3: DORMANT - no frontend caller. Testable via direct HTTP (curl).
// Logging never includes school_email, names, or free-text reflection fields.
//
// Response shapes (normalized across all three 200 paths):
//   200 success    : { completed: true,  shift, totals }
//   200 idempotent : { completed: false, shift, totals, message: 'Already checked out' }
//   400 validation : { error:'invalid_request', field, message, request_id }
//   403 not_eligible: { error:'not_eligible', reason, request_id }
//   404 not_found  : { error:'shift_not_found', request_id }
//   405 method     : { error:'method_not_allowed', request_id }
//   409 ambiguous  : { error:'conflict', reason:'ambiguous_student_email', request_id }
//   409 lifecycle  : { error:'shift_in_unexpected_state', current_lifecycle_state, request_id }
//   500 internal   : { error:'internal_error', request_id }

import { randomUUID } from 'crypto'
import supabaseAdmin from '../../lib/server/evaluation/supabase_admin.js'
import { lookupStudentByEmail } from '../lib/shiftLogLookup.js'
import { toLocalDateStr } from '../../shared/dateUtils.js'
import { isOutsideRotationWindow } from '../../src/lib/rotationWindow.js'
import { shiftMatchesAssignments, loadShiftAssignments } from '../lib/shiftUnitAssignments.js'

const VALID_SHIFT_TYPES = ['Day', 'Night', 'Mid']
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Explicit shared field list for ALL shift fetches (no select('*')).
const SHIFT_FIELDS = [
  'id', 'student_id', 'cohort_id', 'school_email', 'shift_date',
  'lifecycle_state', 'checked_in_at', 'checked_out_at', 'submitted_at',
  'total_hours', 'shift_type', 'unit_name', 'preceptor_name',
  'is_assigned_unit', 'unit_override_reason', 'is_assigned_preceptor', 'preceptor_override_note',
  'learning_highlight', 'support_needed', 'attestation', 'status', 'exception_flags', 'review_reason',
  'planned_unit_name', 'planned_preceptor_name', 'planned_shift_type', 'expected_hours',
].join(', ')

export default async function handler(req, res) {
  const requestId = `req_${randomUUID().slice(0, 8)}`
  const startTime = Date.now()

  if (req.method !== 'POST') {
    logRequest(requestId, 'method_not_allowed', null, null, Date.now() - startTime)
    return res.status(405).json({ error: 'method_not_allowed', request_id: requestId })
  }

  let body
  try {
    body = (req.body && typeof req.body === 'object') ? req.body : JSON.parse(req.body || '{}')
  } catch {
    return rejectInvalid(res, requestId, startTime, 'body', 'Invalid JSON')
  }

  // ── STAGE 1: Hard validation (mirrors live form) ───────────────────────────
  if (typeof body.school_email !== 'string' || body.school_email.trim() === '') {
    return rejectInvalid(res, requestId, startTime, 'school_email', 'school_email is required')
  }
  const schoolEmail = body.school_email.trim()

  if (typeof body.shift_id !== 'string' || !UUID_REGEX.test(body.shift_id)) {
    return rejectInvalid(res, requestId, startTime, 'shift_id', 'shift_id must be a valid UUID')
  }
  const shiftId = body.shift_id

  if (typeof body.total_hours !== 'number' || !Number.isFinite(body.total_hours)) {
    return rejectInvalid(res, requestId, startTime, 'total_hours', 'total_hours must be a number')
  }
  if (body.total_hours < 1 || body.total_hours > 13) {
    return rejectInvalid(res, requestId, startTime, 'total_hours', 'total_hours must be between 1 and 13')
  }
  const totalHours = body.total_hours

  if (typeof body.shift_type !== 'string' || !VALID_SHIFT_TYPES.includes(body.shift_type)) {
    return rejectInvalid(res, requestId, startTime, 'shift_type', 'shift_type must be one of Day, Night, Mid')
  }
  const shiftType = body.shift_type

  if (typeof body.unit_name !== 'string' || body.unit_name.trim() === '') {
    return rejectInvalid(res, requestId, startTime, 'unit_name', 'unit_name is required')
  }
  const unitName = body.unit_name.trim()

  if (typeof body.preceptor_name !== 'string' || body.preceptor_name.trim() === '') {
    return rejectInvalid(res, requestId, startTime, 'preceptor_name', 'preceptor_name is required')
  }
  const preceptorName = body.preceptor_name.trim()

  if (typeof body.is_assigned_unit !== 'boolean') {
    return rejectInvalid(res, requestId, startTime, 'is_assigned_unit', 'is_assigned_unit must be a boolean')
  }
  const isAssignedUnit = body.is_assigned_unit

  if (typeof body.is_assigned_preceptor !== 'boolean') {
    return rejectInvalid(res, requestId, startTime, 'is_assigned_preceptor', 'is_assigned_preceptor must be a boolean')
  }
  const isAssignedPreceptor = body.is_assigned_preceptor

  if (body.attestation !== true) {
    return rejectInvalid(res, requestId, startTime, 'attestation', 'attestation must be true')
  }

  // unit_override_reason required (non-empty) only when is_assigned_unit === false
  let unitOverrideReason = null
  if (!isAssignedUnit) {
    if (typeof body.unit_override_reason !== 'string' || body.unit_override_reason.trim() === '') {
      return rejectInvalid(res, requestId, startTime, 'unit_override_reason', 'unit_override_reason is required when is_assigned_unit is false')
    }
    unitOverrideReason = body.unit_override_reason.trim()
  }

  // preceptor_override_note optional (never required - matches live form)
  let preceptorOverrideNote = null
  if (typeof body.preceptor_override_note === 'string' && body.preceptor_override_note.trim() !== '') {
    preceptorOverrideNote = body.preceptor_override_note.trim()
  }

  let learningHighlight = null
  if (typeof body.learning_highlight === 'string' && body.learning_highlight.trim() !== '') {
    learningHighlight = body.learning_highlight.trim()
  }
  let supportNeeded = null
  if (typeof body.support_needed === 'string' && body.support_needed.trim() !== '') {
    supportNeeded = body.support_needed.trim()
  }

  // ── STAGE 2: Student lookup + eligibility (B1 helper, unchanged) ────────────
  let lookupResult
  try {
    lookupResult = await lookupStudentByEmail(schoolEmail)
  } catch (err) {
    logRequest(requestId, 'error', null, null, Date.now() - startTime, err.message)
    return res.status(500).json({ error: 'internal_error', request_id: requestId })
  }

  if (!lookupResult.found && lookupResult.error === 'ambiguous_student_email') {
    logRequest(requestId, 'ambiguous_email', null, null, Date.now() - startTime)
    return res.status(409).json({ error: 'conflict', reason: 'ambiguous_student_email', request_id: requestId })
  }
  if (!lookupResult.found && lookupResult.error === 'invalid_email') {
    return rejectInvalid(res, requestId, startTime, 'school_email', 'school_email is invalid')
  }
  if (!lookupResult.found) {
    logRequest(requestId, 'not_eligible', null, null, Date.now() - startTime, 'student_not_found')
    return res.status(403).json({ error: 'not_eligible', reason: 'student_not_found', request_id: requestId })
  }
  if (!lookupResult.eligible) {
    logRequest(requestId, 'not_eligible', lookupResult.student?.id || null, null, Date.now() - startTime, lookupResult.ineligible_reason)
    return res.status(403).json({ error: 'not_eligible', reason: lookupResult.ineligible_reason, request_id: requestId })
  }

  const student = lookupResult.student

  // ── STAGE 3: Fetch shift (explicit fields) + ownership ─────────────────────
  const { data: shift, error: fetchError } = await supabaseAdmin
    .from('student_shift_logs')
    .select(SHIFT_FIELDS)
    .eq('id', shiftId)
    .maybeSingle()

  if (fetchError) {
    logRequest(requestId, 'error', student.id, null, Date.now() - startTime, fetchError.message)
    return res.status(500).json({ error: 'internal_error', request_id: requestId })
  }
  if (!shift || shift.student_id !== student.id) {
    // shift missing OR belongs to another student → collapse to 404
    logRequest(requestId, shift ? 'ownership_mismatch' : 'shift_not_found', student.id, shiftId, Date.now() - startTime)
    return res.status(404).json({ error: 'shift_not_found', request_id: requestId })
  }

  // ── STAGE 4: Lifecycle handling ────────────────────────────────────────────
  if (shift.lifecycle_state === 'completed') {
    const totals = await fetchStudentTotals(student.id)
    if (totals === null) {
      logRequest(requestId, 'error', student.id, shiftId, Date.now() - startTime, 'totals_fetch_failed')
      return res.status(500).json({ error: 'internal_error', request_id: requestId })
    }
    logRequest(requestId, 'already_completed', student.id, shiftId, Date.now() - startTime)
    return res.status(200).json({ completed: false, shift: serializeShift(shift), totals: serializeTotals(totals), message: 'Already checked out' })
  }
  if (shift.lifecycle_state !== 'in_progress') {
    logRequest(requestId, 'unexpected_lifecycle_state', student.id, shiftId, Date.now() - startTime, shift.lifecycle_state)
    return res.status(409).json({ error: 'shift_in_unexpected_state', current_lifecycle_state: shift.lifecycle_state, request_id: requestId })
  }

  // ── STAGE 5: Student context + same-day approved hours (for flags) ─────────
  const studentContext = await fetchStudentContext(student.id)
  if (studentContext === null) {
    logRequest(requestId, 'error', student.id, shiftId, Date.now() - startTime, 'student_context_fetch_failed')
    return res.status(500).json({ error: 'internal_error', request_id: requestId })
  }
  const sameDayShifts = await fetchSameDayApprovedShifts(student.id, shift.shift_date, shiftId)
  if (sameDayShifts === null) {
    logRequest(requestId, 'error', student.id, shiftId, Date.now() - startTime, 'same_day_shifts_fetch_failed')
    return res.status(500).json({ error: 'internal_error', request_id: requestId })
  }
  const sameDayApprovedHours = sameDayShifts.reduce((sum, s) => sum + (parseFloat(s.total_hours) || 0), 0)

  // ── STAGE 6: Exception flags - reproduces live ShiftLogPage.jsx exactly ────
  const exceptionFlags = buildExceptionFlags({
    totalHours, preceptorName, unitName, isAssignedUnit,
    shiftDate: shift.shift_date, studentContext, sameDayApprovedHours,
  })

  // Status + review_reason per live form
  const status = exceptionFlags.length === 0 ? 'Auto-Accepted' : 'Pending Review'
  const reviewReason = exceptionFlags.length === 0 ? null : exceptionFlags.join('; ')

  // ── STAGE 7: Internal consistency self-check (must satisfy RPC P0008) ──────
  if (status === 'Auto-Accepted' && (exceptionFlags.length !== 0 || reviewReason !== null)) {
    logRequest(requestId, 'error', student.id, shiftId, Date.now() - startTime, 'internal_inconsistency_auto_accepted')
    return res.status(500).json({ error: 'internal_error', request_id: requestId })
  }
  if (status === 'Pending Review' && (exceptionFlags.length === 0 || !reviewReason || reviewReason.trim() === '')) {
    logRequest(requestId, 'error', student.id, shiftId, Date.now() - startTime, 'internal_inconsistency_pending_review')
    return res.status(500).json({ error: 'internal_error', request_id: requestId })
  }

  // ── STAGE 8: Call the atomic check-out RPC (16 params) ─────────────────────
  const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('shift_log_check_out', {
    p_shift_id: shiftId,
    p_student_id: student.id,
    p_total_hours: totalHours,
    p_shift_type: shiftType,
    p_unit_name: unitName,
    p_preceptor_name: preceptorName,
    p_is_assigned_unit: isAssignedUnit,
    p_unit_override_reason: unitOverrideReason,
    p_is_assigned_preceptor: isAssignedPreceptor,
    p_preceptor_override_note: preceptorOverrideNote,
    p_learning_highlight: learningHighlight,
    p_support_needed: supportNeeded,
    p_attestation: true,
    p_status: status,
    p_exception_flags: exceptionFlags,
    p_review_reason: reviewReason,
  })

  if (rpcError) {
    return handleRpcError(rpcError, res, requestId, student.id, shiftId, startTime)
  }

  // ── STAGE 9: Normalized success response ───────────────────────────────────
  if (!rpcResult || !rpcResult.shift || !rpcResult.totals) {
    logRequest(requestId, 'error', student.id, shiftId, Date.now() - startTime, 'rpc_returned_malformed_result')
    return res.status(500).json({ error: 'internal_error', request_id: requestId })
  }
  // ── Promote Placed → Active Rotation on first completed (auto-accepted) shift ──
  // Mirrors api/shift-log/submit-past-shift.js. The status guard makes this fire
  // exactly once: a subsequent check-out reads 'Active Rotation' and skips it.
  // Best-effort: the completed shift (RPC) is authoritative even if this fails.
  if (status === 'Auto-Accepted' && student.status === 'Placed') {
    try {
      await supabaseAdmin.from('students').update({ status: 'Active Rotation' }).eq('id', student.id)
      await supabaseAdmin.from('program_events').insert({
        student_id: student.id,
        cohort_id: student.cohort_id,
        event_type: 'status_change_active_rotation',
        event_date: toLocalDateStr(),
        notes: 'Status automatically promoted from Placed to Active Rotation on first completed shift.',
        created_by: 'Shift Log',
      })
    } catch { /* best-effort; the completed shift is authoritative */ }
  }

  logRequest(requestId, 'completed', student.id, shiftId, Date.now() - startTime)
  return res.status(200).json({
    completed: true,
    shift: serializeShift(rpcResult.shift),
    totals: serializeTotals(rpcResult.totals),
  })
}

// ── Exception flags - faithful reproduction of ShiftLogPage.jsx buildExceptionFlags ──
// Live order preserved (drives review_reason). At check-out:
//   - hours_over_13 & missing_preceptor are unreachable (hard-validated upstream)
//   - pre_placement_log won't fire (eligibility already required 'Active Rotation')
//   - isDiffUnit maps to !is_assigned_unit (the student's final assignment answer)
function buildExceptionFlags(ctx) {
  const { totalHours, preceptorName, unitName, isAssignedUnit, shiftDate, studentContext, sameDayApprovedHours } = ctx
  const flags = []

  if (totalHours > 13) flags.push('hours_over_13')
  if (totalHours < 2)  flags.push('hours_under_2')

  // STUDENT-PROFILE-CANON-1C: outside_rotation_dates is computed from the canonical
  // coordinator-owned rotation window (cohort_school_rotations via the embedded `rotation`),
  // NOT the legacy free-text students.term_dates. Sentinel/unavailable windows never flag.
  if (isOutsideRotationWindow(shiftDate, studentContext?.rotation)) {
    flags.push('outside_rotation_dates')
  }

  if ((sameDayApprovedHours + totalHours) > 24) flags.push('daily_hours_exceed_24')

  if (!preceptorName.trim()) flags.push('missing_preceptor')

  if (!['Placed', 'Active Rotation'].includes(studentContext?.status)) flags.push('pre_placement_log')

  // unit_and_preceptor_mismatch - the live form's compound rule, with the unit
  // half now MULTI-UNIT AWARE (MULTI-UNIT-STUDENT-PLACEMENTS-2):
  //   (1) student worked a different unit (is_assigned_unit === false),
  //   (2) the unit is NOT one ASPIRE assigned for THIS SHIFT'S DATE - any
  //       planned/active/ended assignment whose window covers the date counts,
  //       with canonical name matching ('6NE' is '6 NE'), AND
  //   (3) the preceptor differs from matched_preceptor.
  // Students with no assignment rows keep the exact pre-existing single-unit
  // string compare, so single-unit behavior is unchanged.
  if (!isAssignedUnit) {
    const assignments = studentContext?.unit_assignments
    const unitRecognized = Array.isArray(assignments) && assignments.length > 0
      ? shiftMatchesAssignments(assignments, { shiftDate, unitName })
      : unitName.trim() === String(studentContext?.assigned_unit_name || '').trim()
    const preceptorDiffers = preceptorName.trim() !== String(studentContext?.matched_preceptor || '').trim()
    if (!unitRecognized && preceptorDiffers) flags.push('unit_and_preceptor_mismatch')
  }

  return flags
}

// Local YYYY-MM-DD → Date (matches ShiftLogPage's parseLD; avoids tz rollover)
function parseLocalDate(s) {
  if (!s) return null
  const [y, m, d] = String(s).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

function rejectInvalid(res, requestId, startTime, field, message) {
  logRequest(requestId, 'validation_failed', null, null, Date.now() - startTime, `${field}: ${message}`)
  return res.status(400).json({ error: 'invalid_request', field, message, request_id: requestId })
}

function serializeShift(s) {
  return {
    id: s.id, student_id: s.student_id, cohort_id: s.cohort_id, school_email: s.school_email,
    shift_date: s.shift_date, lifecycle_state: s.lifecycle_state,
    checked_in_at: s.checked_in_at, checked_out_at: s.checked_out_at, submitted_at: s.submitted_at,
    total_hours: s.total_hours, shift_type: s.shift_type, unit_name: s.unit_name, preceptor_name: s.preceptor_name,
    is_assigned_unit: s.is_assigned_unit, unit_override_reason: s.unit_override_reason,
    is_assigned_preceptor: s.is_assigned_preceptor, preceptor_override_note: s.preceptor_override_note,
    learning_highlight: s.learning_highlight, support_needed: s.support_needed, attestation: s.attestation,
    status: s.status, exception_flags: s.exception_flags, review_reason: s.review_reason,
    planned_unit_name: s.planned_unit_name, planned_preceptor_name: s.planned_preceptor_name,
    planned_shift_type: s.planned_shift_type, expected_hours: s.expected_hours,
  }
}

function serializeTotals(t) {
  return { approved_hours: t.approved_hours, pending_hours: t.pending_hours }
}

async function fetchStudentTotals(studentId) {
  const { data, error } = await supabaseAdmin
    .from('students')
    .select('approved_hours, pending_hours')
    .eq('id', studentId)
    .maybeSingle()
  if (error || !data) return null
  return data
}

// Student-context fields the live flag logic references (exact column names),
// plus the assigned unit NAME resolved from matched_unit_id. The live form reads
// the assigned unit via units.unit_name by matched_unit_id (NOT planned_unit_name),
// so we mirror that source here. B1 helper is left unchanged.
async function fetchStudentContext(studentId) {
  const { data, error } = await supabaseAdmin
    .from('students')
    .select('status, matched_preceptor, matched_unit_id, rotation:cohort_school_rotation_id ( rotation_start_date, rotation_end_date )')
    .eq('id', studentId)
    .maybeSingle()
  if (error || !data) return null

  let assignedUnitName = null
  if (data.matched_unit_id) {
    const { data: unit, error: unitError } = await supabaseAdmin
      .from('units')
      .select('unit_name')
      .eq('id', data.matched_unit_id)
      .maybeSingle()
    // A query failure must NOT be treated as "no assigned unit" - that could
    // wrongly trigger unit_and_preceptor_mismatch. Surface it as a hard error
    // (caller returns a safe 500). Successful query with no row → null (live-form behavior).
    if (unitError) return null
    assignedUnitName = unit?.unit_name || null
  }

  // MULTI-UNIT-STUDENT-PLACEMENTS-2: every assignment row, so the mismatch flag
  // can recognize any unit ASPIRE assigned for the shift's date. A load failure
  // returns null and the flag falls back to the single assigned-unit compare -
  // failing toward pre-existing behavior, never toward a false flag.
  const unitAssignments = await loadShiftAssignments(supabaseAdmin, studentId)

  return { ...data, assigned_unit_name: assignedUnitName, unit_assignments: unitAssignments }
}

// Same-day accepted/approved completed shifts, excluding the current shift.
async function fetchSameDayApprovedShifts(studentId, shiftDate, excludeShiftId) {
  const { data, error } = await supabaseAdmin
    .from('student_shift_logs')
    .select('total_hours')
    .eq('student_id', studentId)
    .eq('shift_date', shiftDate)
    .eq('lifecycle_state', 'completed')
    .in('status', ['Auto-Accepted', 'Approved'])
    .neq('id', excludeShiftId)
  if (error) return null
  return data || []
}

async function handleRpcError(rpcError, res, requestId, studentId, shiftId, startTime) {
  const errCode = rpcError.code
  const errMessage = rpcError.message || ''

  // P0001: shift_not_in_progress (race / ownership / already completed)
  if (errCode === 'P0001' || errMessage.includes('shift_not_in_progress')) {
    const { data: refetch, error: refetchError } = await supabaseAdmin
      .from('student_shift_logs')
      .select(SHIFT_FIELDS)
      .eq('id', shiftId)
      .maybeSingle()

    if (refetchError || !refetch) {
      logRequest(requestId, 'race_refetch_failed', studentId, shiftId, Date.now() - startTime, refetchError?.message || 'refetch_empty')
      return res.status(500).json({ error: 'internal_error', request_id: requestId })
    }
    if (refetch.student_id !== studentId) {
      logRequest(requestId, 'rpc_ownership_mismatch', studentId, shiftId, Date.now() - startTime)
      return res.status(404).json({ error: 'shift_not_found', request_id: requestId })
    }
    if (refetch.lifecycle_state === 'completed') {
      const totals = await fetchStudentTotals(studentId)
      if (totals === null) {
        logRequest(requestId, 'race_totals_fetch_failed', studentId, shiftId, Date.now() - startTime)
        return res.status(500).json({ error: 'internal_error', request_id: requestId })
      }
      logRequest(requestId, 'race_handled_completed', studentId, shiftId, Date.now() - startTime)
      return res.status(200).json({ completed: false, shift: serializeShift(refetch), totals: serializeTotals(totals), message: 'Already checked out' })
    }
    logRequest(requestId, 'race_handled_other_state', studentId, shiftId, Date.now() - startTime, refetch.lifecycle_state)
    return res.status(409).json({ error: 'shift_in_unexpected_state', current_lifecycle_state: refetch.lifecycle_state, request_id: requestId })
  }

  // P0002: student_not_found (race between lookup and RPC)
  if (errCode === 'P0002' || errMessage.includes('student_not_found')) {
    logRequest(requestId, 'rpc_student_not_found', studentId, shiftId, Date.now() - startTime)
    return res.status(404).json({ error: 'shift_not_found', request_id: requestId })
  }

  // P0003-P0009: contract violations → endpoint bug
  if (['P0003', 'P0004', 'P0005', 'P0006', 'P0007', 'P0008', 'P0009'].includes(errCode)) {
    logRequest(requestId, 'rpc_contract_violation', studentId, shiftId, Date.now() - startTime, `${errCode}: ${errMessage}`)
    return res.status(500).json({ error: 'internal_error', request_id: requestId })
  }

  logRequest(requestId, 'rpc_unknown_error', studentId, shiftId, Date.now() - startTime, `${errCode}: ${errMessage}`)
  return res.status(500).json({ error: 'internal_error', request_id: requestId })
}

// PII-free structured log line.
function logRequest(requestId, outcome, studentId, shiftId, duration, errorMessage) {
  const parts = [`[shift-log/check-out]`, `req=${requestId}`, `outcome=${outcome}`]
  if (studentId) parts.push(`student=${studentId}`)
  if (shiftId) parts.push(`shift=${shiftId}`)
  parts.push(`duration=${duration}ms`)
  if (errorMessage) parts.push(`error="${errorMessage}"`)
  console.log(parts.join(' '))
}
