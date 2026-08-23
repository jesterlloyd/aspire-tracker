// api/shift-log/submit-past-shift.js
//
// WS1e-A0b: dedicated PUBLIC past-shift submission endpoint for the legacy
// "Log a Past Shift" form (ShiftLogPage). Extracts that public flow off the
// staff-oriented api/student-update.js.
//
// Source-of-truth model (Option 1 - direct completed insert + server recompute):
//   1. resolve the student by normalized school_email (non-Archived cohort),
//      requiring exactly one match (ambiguous → 409, none → 404)
//   2. validate the exact past-shift schema (reject unexpected/staff fields)
//   3. classify via the same server-side exception rules as the lifecycle
//   4. insert ONE completed student_shift_logs row (id = caller submission_id,
//      for request-level idempotency; PK conflict → idempotent success)
//   5. recompute approved_hours / pending_hours from ALL authoritative completed
//      shift rows (formula DUPLICATED from the shift_log_check_out RPC - must stay
//      synchronized until a shared recompute RPC is approved)
//   6. server-controlled status promotion (Placed → Active Rotation on first
//      auto-accepted shift) - never client-supplied
//   7. return the created shift + recomputed totals
//
// TRANSACTIONAL when 20260818000000 is applied: the insert and the totals
// recompute run inside public.submit_past_shift_log under the SAME per-student
// FOR UPDATE lock as shift_log_check_out and review_shift_log, so a past-shift
// submission can never interleave with a review decision (or a check-out) into
// stale approved_hours/pending_hours. Until that migration exists the endpoint
// FALLS BACK to the legacy lockless insert + recompute (a student-facing flow
// must not break while the migration is gated). Never computes totals from
// client-supplied previous totals.
//
// Does not touch a live in_progress shift (completed insert is unaffected by the
// one-open-shift partial unique index; recompute counts completed rows only).

import { createClient } from '@supabase/supabase-js'
import { toLocalDateStr } from '../../shared/dateUtils.js'
import { normalizeEmailForLookup, escapeLikePattern } from '../../src/lib/emailUtils.js'
import { isOutsideRotationWindow } from '../../src/lib/rotationWindow.js'
import { shiftMatchesAssignments, loadShiftAssignments } from '../lib/shiftUnitAssignments.js'
import { consumePublicRateLimit, SHIFT_WRITE_LIMITS, TOO_MANY_REQUESTS } from '../lib/publicRateLimit.js'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALID_SHIFT_TYPES = ['Day', 'Night', 'Mid']
// Terminal statuses for which logging a new past shift is inappropriate.
const TERMINAL_STATUSES = ['Completed', 'Not Proceeding']

const ALLOWED_BODY_KEYS = [
  'submission_id', 'school_email', 'shift_date', 'total_hours', 'shift_type',
  'unit_name', 'preceptor_name', 'is_assigned_unit', 'unit_override_reason',
  'is_assigned_preceptor', 'preceptor_override_note', 'attestation',
  'learning_highlight', 'support_needed',
]

function findUnexpectedKeys(object, allowedKeys) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return []
  return Object.keys(object).filter(k => !allowedKeys.includes(k))
}
const str = (v) => (typeof v === 'string' ? v.trim() : '')

function getDb() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role credentials')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// Local YYYY-MM-DD → Date (matches ShiftLogPage parseLD; avoids tz rollover).
function parseLocalDate(s) {
  if (!s) return null
  const [y, m, d] = String(s).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

// Exception classification - duplicated from ShiftLogPage.buildExceptionFlags /
// the check-out endpoint. Must stay synchronized with that logic.
async function buildExceptionFlags(db, ctx) {
  const { totalHours, preceptorName, unitName, isAssignedUnit, shiftDate, student } = ctx
  const flags = []
  if (totalHours > 13) flags.push('hours_over_13')
  if (totalHours < 2) flags.push('hours_under_2')

  // STUDENT-PROFILE-CANON-1C: outside_rotation_dates is computed from the canonical
  // coordinator-owned rotation window (cohort_school_rotations via the embedded `rotation`),
  // NOT the legacy free-text students.term_dates. Sentinel/unavailable windows never flag.
  if (isOutsideRotationWindow(shiftDate, student?.rotation)) flags.push('outside_rotation_dates')

  // Same-day already-credited hours (completed Auto-Accepted/Approved) + this shift.
  const { data: sameDay } = await db
    .from('student_shift_logs')
    .select('total_hours')
    .eq('student_id', student.id)
    .eq('shift_date', shiftDate)
    .eq('lifecycle_state', 'completed')
    .in('status', ['Auto-Accepted', 'Approved'])
  const dailySum = (sameDay || []).reduce((s, r) => s + (parseFloat(r.total_hours) || 0), 0) + totalHours
  if (dailySum > 24) flags.push('daily_hours_exceed_24')

  if (!preceptorName.trim()) flags.push('missing_preceptor')
  if (!['Placed', 'Active Rotation'].includes(student?.status)) flags.push('pre_placement_log')

  // unit_and_preceptor_mismatch: unrecognized unit AND different preceptor.
  // MULTI-UNIT-STUDENT-PLACEMENTS-2: "recognized" means ANY assignment whose
  // dated window covers THIS shift's date, canonically named ('6NE' is '6 NE') -
  // which is exactly what lets Emi's ended 6 NE assignment (Jul 8 - Aug 6)
  // still validate her past shifts from that window. Students with no
  // assignment rows keep the pre-existing single-unit compare.
  if (!isAssignedUnit) {
    const assignments = await loadShiftAssignments(db, student.id)
    let unitRecognized
    if (Array.isArray(assignments) && assignments.length > 0) {
      unitRecognized = shiftMatchesAssignments(assignments, { shiftDate, unitName })
    } else {
      let assignedUnitName = ''
      if (student.matched_unit_id) {
        const { data: unit } = await db.from('units').select('unit_name').eq('id', student.matched_unit_id).maybeSingle()
        assignedUnitName = unit?.unit_name || ''
      }
      unitRecognized = unitName.trim() === String(assignedUnitName || '').trim()
    }
    const preceptorDiffers = preceptorName.trim() !== String(student.matched_preceptor || '').trim()
    if (!unitRecognized && preceptorDiffers) flags.push('unit_and_preceptor_mismatch')
  }
  return flags
}

// Recompute formula - DUPLICATED from shift_log_check_out RPC (must stay in sync).
async function recomputeTotals(db, studentId) {
  const { data: approvedRows } = await db
    .from('student_shift_logs').select('total_hours')
    .eq('student_id', studentId).eq('lifecycle_state', 'completed')
    .in('status', ['Auto-Accepted', 'Approved'])
  const { data: pendingRows } = await db
    .from('student_shift_logs').select('total_hours')
    .eq('student_id', studentId).eq('lifecycle_state', 'completed')
    .eq('status', 'Pending Review')
  const approved = (approvedRows || []).reduce((s, r) => s + (parseFloat(r.total_hours) || 0), 0)
  const pending  = (pendingRows  || []).reduce((s, r) => s + (parseFloat(r.total_hours) || 0), 0)
  await db.from('students').update({ approved_hours: approved, pending_hours: pending }).eq('id', studentId)
  return { approved_hours: approved, pending_hours: pending }
}

// SHIFT-LOG-REVIEW-1: exact-replay resolution for a REVIEWED submission id.
// A review may have ADJUSTED total_hours, so the stored row no longer equals
// the original payload on hours alone. The replay is idempotent ONLY when the
// incoming hours equal the IMMUTABLE original preserved in shift_log_reviews
// (original_total_hours, keyed by original_shift_log_id) - never for an
// arbitrary new value. Resolved entirely server-side; the browser never reads
// the ledger. Exported for tests.
export async function reviewedReplayMatches(db, { submissionId, incomingHours, matchesWithHours }) {
  const { data: audit, error } = await db
    .from('shift_log_reviews')
    .select('original_total_hours')
    .eq('original_shift_log_id', submissionId)
    .maybeSingle()
  if (error || !audit) return false // no audit row -> nothing vouches for the difference
  const original = parseFloat(audit.original_total_hours)
  if (!Number.isFinite(original) || original !== incomingHours) return false
  return matchesWithHours === true
}

// SHIFT-LOG-REVIEW-1: the atomic path. Insert + totals recompute in ONE
// transaction behind the shared per-student FOR UPDATE lock. Classification
// contract (behaviorally tested): PGRST202 (function absent - migration not
// applied) is the ONLY outcome that may select the legacy lockless path;
// every other error fails the request safely; success returns the RPC result.
// Exported for tests.
export async function atomicSubmit(db, payload) {
  const { data, error } = await db.rpc('submit_past_shift_log', payload)
  if (error) {
    if (error.code === 'PGRST202') return { missing: true }
    return { error }
  }
  return { result: data }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (!(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'internal_error' })
  }

  const requestId = `req_${Math.random().toString(36).slice(2, 10)}`

  // S-09 / S-11: identity here is a school email with no token, so the throttle is
  // what stops an anonymous caller probing addresses or flooding writes. Fails
  // closed, and runs before the body is even parsed.
  // Uses this file's own lazy client, not the shared module-level one: the env
  // check above has already run, and importing the shared client would make this
  // module unloadable without credentials.
  if (!(await consumePublicRateLimit(getDb(), req, SHIFT_WRITE_LIMITS))) {
    return res.status(429).json({ error: 'rate_limited', message: TOO_MANY_REQUESTS })
  }
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}

  // ── Exact-schema enforcement ────────────────────────────────────────────────
  const unexpected = findUnexpectedKeys(body, ALLOWED_BODY_KEYS)
  if (unexpected.length > 0) {
    return res.status(400).json({ error: 'invalid_request', field: unexpected[0], message: 'Unexpected field.' })
  }

  // ── Idempotency key ─────────────────────────────────────────────────────────
  const submissionId = str(body.submission_id)
  if (!submissionId || !UUID_REGEX.test(submissionId)) {
    return res.status(400).json({ error: 'invalid_request', field: 'submission_id' })
  }

  // ── Hard validation (mirrors legacy form) ───────────────────────────────────
  const schoolEmail = str(body.school_email)
  if (!schoolEmail || !schoolEmail.includes('@') || !schoolEmail.includes('.')) {
    return res.status(400).json({ error: 'invalid_request', field: 'school_email' })
  }
  const shiftDate = str(body.shift_date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shiftDate)) {
    return res.status(400).json({ error: 'invalid_request', field: 'shift_date', message: 'Expected YYYY-MM-DD.' })
  }
  if (shiftDate > toLocalDateStr()) {
    return res.status(400).json({ error: 'invalid_request', field: 'shift_date', message: 'Shift date cannot be in the future.' })
  }
  const totalHours = Number(body.total_hours)
  if (!Number.isFinite(totalHours) || totalHours < 1 || totalHours > 13) {
    return res.status(400).json({ error: 'invalid_request', field: 'total_hours', message: 'Hours must be between 1 and 13.' })
  }
  const shiftType = str(body.shift_type)
  if (!VALID_SHIFT_TYPES.includes(shiftType)) {
    return res.status(400).json({ error: 'invalid_request', field: 'shift_type' })
  }
  const unitName = str(body.unit_name)
  if (!unitName) return res.status(400).json({ error: 'invalid_request', field: 'unit_name' })
  const preceptorName = str(body.preceptor_name)
  if (typeof body.is_assigned_unit !== 'boolean') return res.status(400).json({ error: 'invalid_request', field: 'is_assigned_unit' })
  if (typeof body.is_assigned_preceptor !== 'boolean') return res.status(400).json({ error: 'invalid_request', field: 'is_assigned_preceptor' })
  const isAssignedUnit = body.is_assigned_unit
  if (body.attestation !== true) return res.status(400).json({ error: 'invalid_request', field: 'attestation', message: 'You must confirm the attestation.' })
  let unitOverrideReason = null
  if (!isAssignedUnit) {
    unitOverrideReason = str(body.unit_override_reason)
    if (!unitOverrideReason) return res.status(400).json({ error: 'invalid_request', field: 'unit_override_reason', message: 'Please explain why you worked a different unit.' })
  }
  const preceptorOverrideNote = (body.is_assigned_preceptor === false && str(body.preceptor_override_note)) ? str(body.preceptor_override_note) : null
  const learningHighlight = str(body.learning_highlight) || null
  const supportNeeded = str(body.support_needed) || null

  const db = getDb()

  // ── Resolve the student by school_email across non-Archived cohorts ─────────
  // Legacy model (no accepting_submissions gate); ambiguity-safe (require one).
  // Forgiving match: normalized (case/whitespace/zero-width), wildcards escaped,
  // then a JS normalized-equality confirm so no % / _ over-match selects a wrong
  // student.
  const cleanEmail = normalizeEmailForLookup(schoolEmail)
  const { data: rows, error: lookupErr } = await db
    .from('students')
    .select('id, cohort_id, status, matched_preceptor, matched_unit_id, hours_required, school_email, cohorts:cohort_id ( status ), rotation:cohort_school_rotation_id ( rotation_start_date, rotation_end_date )')
    .ilike('school_email', escapeLikePattern(cleanEmail))
  if (lookupErr) return res.status(500).json({ error: 'internal_error' })
  const eligible = (rows || [])
    .filter(r => normalizeEmailForLookup(r.school_email) === cleanEmail)
    .filter(r => (r.cohorts?.status || '') !== 'Archived')
  const byId = new Map()
  eligible.forEach(r => byId.set(r.id, r))
  const ids = [...byId.keys()]
  if (ids.length === 0) {
    return res.status(404).json({ error: 'not_found', message: 'We could not find your email in the current ASPIRE cohort. Please check the spelling or contact the ASPIRE team.' })
  }
  if (ids.length > 1) {
    console.log('[submit-past-shift] ambiguous student match', { request_id: requestId, matchCount: ids.length })
    return res.status(409).json({ error: 'ambiguous_student', message: 'We could not uniquely identify your record. Please contact the ASPIRE team.' })
  }
  const student = byId.get(ids[0])

  // ── Eligibility: reject terminal statuses (preserve active range incl. Placed)
  if (TERMINAL_STATUSES.includes(student.status)) {
    return res.status(403).json({ error: 'not_eligible', message: 'Shift logging is not available for your current status. Please contact the ASPIRE team.' })
  }

  // ── Payload-consistency check for a reused submission_id ────────────────────
  // Compares ONLY client-provided fields (normalized). Server-derived fields
  // (status, exception_flags, review_reason, submitted_at, lifecycle_state) are
  // intentionally excluded - they don't appear in the request.
  const COMPARE_SELECT = 'id, student_id, cohort_id, school_email, shift_date, total_hours, shift_type, unit_name, preceptor_name, is_assigned_unit, unit_override_reason, is_assigned_preceptor, preceptor_override_note, attestation, learning_highlight, support_needed, status, review_reason'
  const nstr = (v) => (v == null ? '' : String(v).trim())
  const samePayload = (row) =>
    row.student_id === student.id &&
    row.cohort_id === student.cohort_id &&
    nstr(row.school_email).toLowerCase() === nstr(student.school_email).toLowerCase() &&
    nstr(row.shift_date) === shiftDate &&
    Number(row.total_hours) === totalHours &&
    nstr(row.shift_type) === shiftType &&
    nstr(row.unit_name) === unitName &&
    nstr(row.preceptor_name) === preceptorName &&
    row.is_assigned_unit === isAssignedUnit &&
    nstr(row.unit_override_reason) === nstr(unitOverrideReason) &&
    row.is_assigned_preceptor === body.is_assigned_preceptor &&
    nstr(row.preceptor_override_note) === nstr(preceptorOverrideNote) &&
    row.attestation === true &&
    nstr(row.learning_highlight) === nstr(learningHighlight) &&
    nstr(row.support_needed) === nstr(supportNeeded)

  // ── Idempotent re-submit: a row already exists with this submission_id ──────
  const { data: existingShift } = await db
    .from('student_shift_logs')
    .select(COMPARE_SELECT)
    .eq('id', submissionId)
    .maybeSingle()
  if (existingShift) {
    // A row whose review ADJUSTED the hours no longer equals the original
    // payload on total_hours alone. That difference is acceptable ONLY when
    // the incoming hours equal the IMMUTABLE original recorded in the review
    // ledger - an arbitrary new hours value on a reused id is a conflict, and
    // a replay never changes the reviewed status or the adjusted hours.
    const reviewed = ['Approved', 'Rejected'].includes(existingShift.status || '')
    const replayMatches = samePayload(existingShift)
      || (reviewed && await reviewedReplayMatches(db, {
        submissionId,
        incomingHours: totalHours,
        matchesWithHours: samePayload({ ...existingShift, total_hours: totalHours }),
      }))
    if (existingShift.student_id !== student.id || !replayMatches) {
      console.log('[submit-past-shift] submission_id reuse mismatch', { request_id: requestId })
      return res.status(409).json({ error: 'conflict', message: 'This submission could not be processed. Please refresh and try again.' })
    }
    // Re-affirm authoritative totals UNDER the shared student lock: the RPC is
    // exists-first, so a row that has since been REVIEWED (Approved/Rejected)
    // replays idempotently - no insert, no status change, locked recompute.
    // ONLY PGRST202 (migration absent) may fall back to the legacy lockless
    // recompute; any other RPC error fails the request - it never silently
    // downgrades to an unserialized totals write.
    const atomic = await atomicSubmit(db, {
      p_id: submissionId, p_student_id: student.id, p_cohort_id: student.cohort_id,
      p_school_email: student.school_email, p_shift_date: existingShift.shift_date,
      p_total_hours: existingShift.total_hours, p_unit_name: existingShift.unit_name,
      p_is_assigned_unit: existingShift.is_assigned_unit, p_unit_override_reason: existingShift.unit_override_reason,
      p_preceptor_name: existingShift.preceptor_name, p_is_assigned_preceptor: existingShift.is_assigned_preceptor,
      p_preceptor_override_note: existingShift.preceptor_override_note, p_shift_type: existingShift.shift_type,
      p_learning_highlight: existingShift.learning_highlight, p_support_needed: existingShift.support_needed,
      p_status: existingShift.status, p_exception_flags: [], p_review_reason: existingShift.review_reason,
    })
    if (atomic.error) {
      console.log('[submit-past-shift] idempotent totals refresh failed', { request_id: requestId, errorCode: atomic.error.code })
      return res.status(500).json({ error: 'internal_error' })
    }
    const totals = atomic.missing
      ? await recomputeTotals(db, student.id) // pre-migration behavior, unchanged
      : { approved_hours: parseFloat(atomic.result?.approved_hours) || 0, pending_hours: parseFloat(atomic.result?.pending_hours) || 0 }
    return res.status(200).json({ success: true, idempotent: true, shift: existingShift, totals })
  }

  // ── Classify (server-side) ──────────────────────────────────────────────────
  const flags = await buildExceptionFlags(db, { totalHours, preceptorName, unitName, isAssignedUnit, shiftDate, student })
  const status = flags.length > 0 ? 'Pending Review' : 'Auto-Accepted'
  const reviewReason = flags.length > 0 ? flags.join('; ') : null

  // ── Record the shift + recompute totals ATOMICALLY (shared student lock) ────
  // public.submit_past_shift_log (20260818000000) inserts the completed row and
  // recomputes BOTH totals inside one transaction, serialized on the same
  // per-student FOR UPDATE as review_shift_log and shift_log_check_out. A retry
  // race collapses inside the RPC (ON CONFLICT DO NOTHING + inserted=false).
  // If the migration is not applied yet, fall back to the legacy path below.
  let shift
  let totals
  const atomic = await atomicSubmit(db, {
    p_id: submissionId, p_student_id: student.id, p_cohort_id: student.cohort_id,
    p_school_email: student.school_email, p_shift_date: shiftDate,
    p_total_hours: totalHours, p_unit_name: unitName,
    p_is_assigned_unit: isAssignedUnit, p_unit_override_reason: unitOverrideReason,
    p_preceptor_name: preceptorName, p_is_assigned_preceptor: body.is_assigned_preceptor,
    p_preceptor_override_note: preceptorOverrideNote, p_shift_type: shiftType,
    p_learning_highlight: learningHighlight, p_support_needed: supportNeeded,
    p_status: status, p_exception_flags: flags, p_review_reason: reviewReason,
  })
  if (atomic.error) {
    console.log('[submit-past-shift] atomic submit failed', { request_id: requestId, errorCode: atomic.error.code })
    return res.status(500).json({ error: 'internal_error' })
  }
  if (!atomic.missing) {
    const r = atomic.result || {}
    if (r.inserted === false) {
      // Race: a concurrent retry landed this submission_id first. Same contract
      // as the legacy 23505 branch: equal payload -> idempotent, else conflict.
      const raceRow = r.shift || null
      if (raceRow && raceRow.student_id === student.id && samePayload(raceRow)) {
        return res.status(200).json({
          success: true, idempotent: true, shift: raceRow,
          totals: { approved_hours: r.approved_hours, pending_hours: r.pending_hours },
        })
      }
      console.log('[submit-past-shift] race submission_id reuse mismatch', { request_id: requestId })
      return res.status(409).json({ error: 'conflict', message: 'This submission could not be processed. Please refresh and try again.' })
    }
    const row = r.shift || {}
    shift = { id: row.id, status: row.status, review_reason: row.review_reason, shift_date: row.shift_date, total_hours: row.total_hours, unit_name: row.unit_name }
    totals = { approved_hours: parseFloat(r.approved_hours) || 0, pending_hours: parseFloat(r.pending_hours) || 0 }
  } else {
    // ── LEGACY fallback (migration 20260818000000 not applied): lockless
    //    insert + client-side recompute, byte-for-byte the pre-atomic behavior.
    // ── Insert ONE completed shift row (id = submission_id) ─────────────────────
    const { data: inserted, error: insertErr } = await db
      .from('student_shift_logs')
      .insert({
        id: submissionId,
        student_id: student.id,
        cohort_id: student.cohort_id,
        school_email: student.school_email,
        shift_date: shiftDate,
        total_hours: totalHours,
        unit_name: unitName,
        is_assigned_unit: isAssignedUnit,
        unit_override_reason: unitOverrideReason,
        preceptor_name: preceptorName,
        is_assigned_preceptor: body.is_assigned_preceptor,
        preceptor_override_note: preceptorOverrideNote,
        shift_type: shiftType,
        learning_highlight: learningHighlight,
        support_needed: supportNeeded,
        attestation: true,
        lifecycle_state: 'completed',
        status,
        exception_flags: flags,
        review_reason: reviewReason,
        submitted_at: new Date().toISOString(),
      })
      .select('id, status, review_reason, shift_date, total_hours, unit_name')
      .single()

    if (insertErr) {
      // Race: another retry inserted this submission_id between our check and insert.
      if (insertErr.code === '23505') {
        const { data: raceRow } = await db
          .from('student_shift_logs').select(COMPARE_SELECT)
          .eq('id', submissionId).maybeSingle()
        if (raceRow && raceRow.student_id === student.id && samePayload(raceRow)) {
          const totals = await recomputeTotals(db, student.id)
          return res.status(200).json({ success: true, idempotent: true, shift: raceRow, totals })
        }
        console.log('[submit-past-shift] race submission_id reuse mismatch', { request_id: requestId })
        return res.status(409).json({ error: 'conflict', message: 'This submission could not be processed. Please refresh and try again.' })
      }
      console.log('[submit-past-shift] insert failed', { request_id: requestId, errorCode: insertErr.code })
      return res.status(500).json({ error: 'internal_error' })
    }
    shift = inserted
    // totals stay unset here - recomputed below, after the events, exactly as before
  }

  // ── Server-controlled status promotion + rotation events (auto-accepted only)
  if (status === 'Auto-Accepted') {
    const { data: acceptedShifts } = await db
      .from('student_shift_logs').select('id')
      .eq('student_id', student.id).eq('lifecycle_state', 'completed')
      .in('status', ['Auto-Accepted', 'Approved']).limit(2)
    const isFirstShift = acceptedShifts && acceptedShifts.length === 1

    if (isFirstShift) {
      await logEventOnce(db, student.id, student.cohort_id, 'rotation_start', `[Auto-logged] First shift logged: ${unitName}`)
      if (student.status === 'Placed') {
        await db.from('students').update({ status: 'Active Rotation' }).eq('id', student.id)
        await logEventOnce(db, student.id, student.cohort_id, 'status_change_active_rotation', 'Status automatically promoted from Placed to Active Rotation on first approved shift.')
      }
    }
  }

  // ── Authoritative totals: already recomputed under the lock by the atomic
  //    RPC; the legacy fallback recomputes here, exactly as before ────────────
  if (!totals) totals = await recomputeTotals(db, student.id)

  // rotation_end when required hours met (after recompute)
  if (status === 'Auto-Accepted') {
    const hoursReq = parseFloat(student.hours_required || 0)
    if (hoursReq > 0 && totals.approved_hours >= hoursReq) {
      await logEventOnce(db, student.id, student.cohort_id, 'rotation_end', `[Auto-logged] Required hours met: ${totals.approved_hours}/${hoursReq} hrs`)
    }
  }

  console.log('[submit-past-shift] shift recorded', { request_id: requestId, cohortId: student.cohort_id, shiftStatus: status })
  return res.status(200).json({ success: true, shift, totals })
}

// Insert a program_events row once (deduped by student + cohort + type). Server
// label only; non-transactional with the shift insert (best-effort).
async function logEventOnce(db, studentId, cohortId, eventType, notes) {
  try {
    const { data: existing } = await db
      .from('program_events').select('id')
      .eq('student_id', studentId).eq('cohort_id', cohortId).eq('event_type', eventType)
      .limit(1).maybeSingle()
    if (existing) return
    await db.from('program_events').insert({
      student_id: studentId, cohort_id: cohortId, event_type: eventType,
      event_date: toLocalDateStr(), notes, created_by: 'Shift Log',
    })
  } catch { /* best-effort; shift row is authoritative */ }
}
