// api/portal/my-shift-log-manage.js
//
// STUDENT-SHIFT-LOG-MANAGEMENT-1: a signed-in student corrects or withdraws
// their OWN shift log.
//
// POST { action: 'edit' | 'void' | 'eligibility', shift_id, reason?, ...intake }
//
// AUTHORIZATION. The portal JWT is the only identity. verifyPortalCaller
// resolves it to a user_profiles row, an ACTIVE 'student' role grant is
// required, and the caller's COMPLETE set of active student links is the
// allowlist. An account linked to more than one student/rotation record is
// fully supported: the shift is resolved first, then its student_id must be a
// member of that allowlist. A shift id outside the allowlist is answered
// exactly like one that does not exist (404 not_found), so ids cannot be
// probed for existence.
//
// CLASSIFICATION IS NOT THE CALLER'S. The endpoint sends only the student's
// own intake values; exception flags, status, and review_reason are derived
// inside the transaction by student_shift_classify(), from facts read AFTER
// the student row is locked. A stale client (or a racing sibling shift) can
// therefore never influence the stored classification, and a classifier
// failure aborts the edit rather than yielding an empty flag set.
//
// The mutation is ONE service-role transaction taking the SAME per-student
// FOR UPDATE lock as check-out, staff review, and past-shift submission.
//
// WITHDRAW IS NOT A DELETE. It sets lifecycle_state='voided', which every
// recompute, the staff-review decidability gate, and the duplicate/same-day
// warning queries already filter on.
//
// DOWNSTREAM PARITY. An edit that newly makes a shift Auto-Accepted applies
// exactly the submission/staff-approval semantics (first accepted shift,
// Placed -> Active Rotation, rotation_start, rotation_end). An edit or
// withdrawal that drops approved hours back below the requirement appends a
// non-destructive correction event rather than leaving a stale threshold
// claim - nothing is ever rewritten or deleted.
//
// Responses (stable keys, never a raw DB message):
//   200 { success, result }            - edit/void
//   200 { success, eligibility }       - action 'eligibility'
//   400 invalid_request | invalid_field
//   401 unauthorized | 403 forbidden | 405 method_not_allowed
//   404 not_found                 - unknown id OR outside the caller's allowlist
//   409 not_editable { reason }
//   503 migration_required
//   500 internal_error

import {
  verifyPortalCaller,
  getServiceDb,
  hasActiveRoleGrant,
  getActiveStudentLinks,
} from '../lib/portalAuth.js'
import { applyEditAcceptanceDownstream, recordHoursThresholdCorrection } from '../lib/studentShiftEffects.js'
import { toLocalDateStr } from '../../shared/dateUtils.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALID_SHIFT_TYPES = ['Day', 'Night', 'Mid']
const ACTIONS = ['edit', 'void', 'eligibility']

// Exactly the intake fields a student may supply. Anything else is rejected
// outright, so status, exception_flags, review_reason, admin_notes,
// reviewed_by, lifecycle_state, student_id, cohort_id, school_email, and
// attestation can never arrive from a client.
const ALLOWED_KEYS = new Set([
  'action', 'shift_id', 'reason',
  'shift_date', 'total_hours', 'unit_name', 'is_assigned_unit', 'unit_override_reason',
  'preceptor_name', 'is_assigned_preceptor', 'preceptor_override_note', 'shift_type',
  'learning_highlight', 'support_needed',
])

async function editReady(db) {
  const { data, error } = await db.rpc('student_shift_edit_ready')
  if (error) return false // PGRST202 (migration absent) or anything else: not ready
  return data === true
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  // ── 1. Identity: JWT -> profile -> active student grant -> linked students ──
  const auth = await verifyPortalCaller(req)
  if (!auth.authenticated) return res.status(auth.status).json({ error: auth.reason })

  const db = getServiceDb()
  const profileId = auth.profile.id
  if (!(await hasActiveRoleGrant(db, profileId, 'student'))) {
    return res.status(403).json({ error: 'forbidden' })
  }
  // The COMPLETE allowlist. An account may legitimately hold several student
  // records (a repeat rotation, a second placement); all of them are theirs.
  const studentIds = await getActiveStudentLinks(db, profileId)
  if (studentIds.length === 0) return res.status(403).json({ error: 'forbidden' })

  try {
    const body = req.body || {}
    const unexpected = Object.keys(body).filter(k => !ALLOWED_KEYS.has(k))
    if (unexpected.length > 0) return res.status(400).json({ error: 'invalid_request' })

    const action = String(body.action || '')
    const shiftId = String(body.shift_id || '')
    if (!ACTIONS.includes(action) || !UUID_RE.test(shiftId)) {
      return res.status(400).json({ error: 'invalid_request' })
    }
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null

    // Fail closed until the migration is applied: a change whose audit row and
    // locked recompute cannot happen must not half-happen.
    if (!(await editReady(db))) {
      return res.status(503).json({
        error: 'migration_required',
        detail: 'Apply 20260819000000_student_shift_log_self_service before managing shift logs.',
      })
    }

    // ── 2. Resolve the shift, THEN authorize it against the allowlist ───────
    // Ownership is decided here, never by a client-supplied student id. A row
    // outside the allowlist is indistinguishable from a missing one.
    const { data: shiftRow, error: shiftErr } = await db
      .from('student_shift_logs')
      .select('id, student_id, unit_name')
      .eq('id', shiftId)
      .maybeSingle()
    if (shiftErr) return res.status(500).json({ error: 'internal_error' })
    if (!shiftRow || !studentIds.includes(shiftRow.student_id)) {
      return res.status(404).json({ error: 'not_found' })
    }
    const studentId = shiftRow.student_id

    // ── 3. The authoritative eligibility verdict (also served on its own) ───
    const { data: verdict, error: verdictErr } = await db.rpc('student_shift_edit_eligibility', {
      p_shift_id: shiftId,
      p_student_id: studentId,
    })
    if (verdictErr) return res.status(500).json({ error: 'internal_error' })
    if (!verdict || verdict.reason === 'not_found') return res.status(404).json({ error: 'not_found' })

    if (action === 'eligibility') {
      return res.status(200).json({ success: true, eligibility: verdict })
    }
    if (verdict.editable !== true) {
      return res.status(409).json({ error: 'not_editable', reason: verdict.reason })
    }

    // The pre-change student snapshot the downstream effects need (the
    // promotion checks the PRE-change status, as submission does).
    const { data: student, error: studentErr } = await db
      .from('students')
      .select('id, cohort_id, status, hours_required')
      .eq('id', studentId)
      .maybeSingle()
    if (studentErr || !student) return res.status(500).json({ error: 'internal_error' })

    // ── 4a. WITHDRAW ────────────────────────────────────────────────────────
    if (action === 'void') {
      const { data: result, error } = await db.rpc('student_void_shift_log', {
        p_shift_id: shiftId,
        p_student_id: studentId,
        p_actor_profile_id: profileId,
        p_reason: reason,
      })
      if (error) return mapRpcError(error, res)
      await recordHoursThresholdCorrection(db, student, result)
      return res.status(200).json({ success: true, result })
    }

    // ── 4b. EDIT: validate the student's OWN values; classification is the
    //       database's job, under the lock. ─────────────────────────────────
    const shiftDate = String(body.shift_date || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(shiftDate)) return res.status(400).json({ error: 'invalid_field' })
    if (shiftDate > toLocalDateStr()) return res.status(400).json({ error: 'invalid_field' })

    const totalHours = Number(body.total_hours)
    if (!Number.isFinite(totalHours) || totalHours < 1 || totalHours > 13) {
      return res.status(400).json({ error: 'invalid_field' })
    }
    const shiftType = String(body.shift_type || '')
    if (!VALID_SHIFT_TYPES.includes(shiftType)) return res.status(400).json({ error: 'invalid_field' })

    const unitName = String(body.unit_name || '').trim()
    if (!unitName) return res.status(400).json({ error: 'invalid_field' })
    if (typeof body.is_assigned_unit !== 'boolean' || typeof body.is_assigned_preceptor !== 'boolean') {
      return res.status(400).json({ error: 'invalid_field' })
    }
    const unitOverrideReason = String(body.unit_override_reason || '').trim()
    if (body.is_assigned_unit === false && !unitOverrideReason) {
      return res.status(400).json({ error: 'invalid_field' })
    }
    const preceptorName = String(body.preceptor_name || '').trim()
    // Preserved independently of the checkbox, so toggling one field never
    // silently erases a note the student wrote.
    const preceptorOverrideNote = String(body.preceptor_override_note || '').trim()
    const learningHighlight = String(body.learning_highlight || '').slice(0, 2000)
    const supportNeeded = String(body.support_needed || '').slice(0, 2000)

    const { data: result, error } = await db.rpc('student_edit_shift_log', {
      p_shift_id: shiftId,
      p_student_id: studentId,
      p_actor_profile_id: profileId,
      p_shift_date: shiftDate,
      p_total_hours: totalHours,
      p_unit_name: unitName,
      p_is_assigned_unit: body.is_assigned_unit,
      p_unit_override_reason: unitOverrideReason,
      p_preceptor_name: preceptorName,
      p_is_assigned_preceptor: body.is_assigned_preceptor,
      p_preceptor_override_note: preceptorOverrideNote,
      p_shift_type: shiftType,
      p_learning_highlight: learningHighlight,
      p_support_needed: supportNeeded,
      p_reason: reason,
    })
    if (error) return mapRpcError(error, res)

    // ── 5. Downstream parity, both directions (best-effort, never blocking) ─
    await applyEditAcceptanceDownstream(db, student, { unit_name: unitName }, result)
    await recordHoursThresholdCorrection(db, student, result)

    return res.status(200).json({ success: true, result })
  } catch (err) {
    console.error('[my-shift-log-manage] unexpected error:', err?.message)
    return res.status(500).json({ error: 'internal_error' })
  }
}

// P000x -> stable client keys. A lost race against a staff review surfaces as
// 409 not_editable, never as a silent overwrite.
function mapRpcError(error, res) {
  const code = error?.code
  const msg = String(error?.message || '')
  if (code === 'P0002') return res.status(404).json({ error: 'not_found' })
  if (code === 'P0001') {
    const reason = (msg.split('shift_not_editable:')[1] || '').trim() || 'not_editable'
    return res.status(409).json({ error: 'not_editable', reason })
  }
  if (code === 'P0006') return res.status(400).json({ error: 'invalid_field' })
  console.error('[my-shift-log-manage] rpc failed', { code })
  return res.status(500).json({ error: 'internal_error' })
}
