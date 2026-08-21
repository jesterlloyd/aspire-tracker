/* global process */
// api/portal/my-profile.js
//
// STUDENT-PORTAL-PROFILE-1: the student's canonical self-service profile.
//
// GET  -> the student's own submitted /student-form answers, lock state, and the
//         cohort's participating units (for the preference dropdowns), so the portal
//         renders the profile without any direct table access.
// POST { action:'save' } -> updates the SAME canonical students row the staff app
//         uses. Never an insert; a duplicate row is structurally impossible here.
//
// Authorization mirrors student-summary.js / update-profile.js exactly: verified JWT
// -> user_profiles -> ACTIVE 'student' role grant -> ACTIVE user_student_links. A
// student may read and write ONLY their own linked record. Academic Partners and
// Unit Leaders have no route into this endpoint (no student grant -> 403).
//
// Server-enforced rules the browser can never bypass:
//   - Field allowlist: STUDENT_EDITABLE_FIELDS (src/lib/studentProfileFields.js).
//     Staff-owned fields are not merely ignored - an unexpected key is a 400, the
//     same exact-schema posture as student-intake-submit.
//   - Lock: isStudentProfileLocked (shared canonical condition). Locked -> 423-style
//     403 { error:'profile_locked' }; the student keeps read access via GET.
//   - Submission gate: 'save' exists only AFTER first submission (submitted_via =
//     'student_form'). Before that, the portal submits through the canonical public
//     intake endpoint, so there is exactly one first-submission path.
//   - Stale writes: expected_updated_at is REQUIRED; the UPDATE is conditioned on
//     updated_at matching, so a newer staff (or other-tab) change is never silently
//     overwritten -> 409 { error:'stale_write' }.
//   - Explicit clearing only: a field changes only when its key is present in the
//     body. Required-on-save fields reject empty values instead of clearing.
//
// Audit: every save inserts an activity_logs row (the student's own user_profiles
// identity, role 'student', source surface, CHANGED FIELD NAMES ONLY - values are
// deliberately not stored; ssn_last4/date_of_birth must not sit in audit text).

import { verifyPortalCaller, getServiceDb, hasActiveRoleGrant, getActiveStudentLinks } from '../lib/portalAuth.js'
import { isStudentProfileLocked, PROFILE_LOCKED_MESSAGE } from '../../src/lib/studentProfileLock.js'
import { STUDENT_EDITABLE_FIELDS, REQUIRED_ON_SAVE, INTEREST_STATEMENT_MIN } from '../../src/lib/studentProfileFields.js'
import { sanitizeWeekdays, sanitizeIsoDates, coerceBoolOrNull } from '../../src/lib/availability.js'
import { STUDENT_FORM_ACK_VERSION } from '../../src/lib/studentFormAck.js'
// The SAME documents rule the public intake endpoint enforces (its named export).
import { checkDocumentsRequired } from '../student-intake-submit.js'
import { toLocalDateStr } from '../../shared/dateUtils.js'
// S-03: a stored file reference must be the canonical path for THIS student.
import { validateStoredFileRefForStudent } from '../../lib/server/studentFiles.js'

// Everything GET returns about the student. The editable set, plus read-only context
// the profile view needs (identity binding, lock inputs, provenance, documents-on-file,
// acknowledgment record). Staff-only columns (scores, notes, flags, hours, placement
// internals) are structurally absent.
const PROFILE_SELECT = [
  'id', 'cohort_id', 'school', 'school_email', 'status', 'interview_scheduled_date',
  'submitted_via', 'updated_at', 'resume_url', 'headshot_url',
  'availability_ack', 'student_form_privacy_ack_name', 'student_form_privacy_ack_at',
  ...STUDENT_EDITABLE_FIELDS,
].join(', ')

const str = (v) => (typeof v === 'string' ? v.trim() : '')
const isYMD = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Per-field validate + normalize for the 'save' patch. Returns { value } or { error }.
// Mirrors the intake endpoint's rules field-for-field so a portal edit can never store
// a value the original submission could not have. Exported for the functional tests
// (same pattern as student-intake-submit's checkDocumentsRequired).
export function normalizeField(key, raw) {
  switch (key) {
    case 'first_name':
    case 'last_name': {
      const v = str(raw)
      if (!v || v.length > 120) return { error: 'Required, up to 120 characters.' }
      return { value: v }
    }
    case 'preferred_first_name': {
      const v = str(raw)
      if (v.length > 60) return { error: 'Preferred name is too long.' }
      return { value: v || null }
    }
    case 'personal_email': {
      const v = str(raw).toLowerCase()
      if (!v || v.length > 200 || !EMAIL_RE.test(v)) return { error: 'Enter a valid email address.' }
      return { value: v }
    }
    case 'phone': {
      const v = str(raw)
      if (!v || v.length > 40) return { error: 'Enter a valid phone number.' }
      return { value: v }
    }
    case 'date_of_birth': {
      const v = str(raw)
      if (!isYMD(v)) return { error: 'Enter a valid date.' }
      return { value: v }
    }
    case 'ssn_last4': {
      const v = str(raw)
      if (!/^\d{4}$/.test(v)) return { error: 'SSN last 4 must be 4 digits.' }
      return { value: v }
    }
    case 'gender': {
      const v = str(raw)
      if (v.length > 50) return { error: 'Invalid value.' }
      return { value: v }
    }
    case 'cs_affiliation': {
      const v = str(raw)
      if (!['Current Employee', 'Former Employee', 'Volunteer', 'No prior affiliation'].includes(v)) {
        return { error: 'Select your Cedars-Sinai affiliation.' }
      }
      return { value: v }
    }
    case 'cs_department':
    case 'cs_role': {
      const v = str(raw)
      if (v.length > 120) return { error: 'Too long.' }
      return { value: v }
    }
    case 'prior_healthcare_experience': {
      const v = str(raw)
      if (!v || v.length > 500) return { error: 'Required.' }
      return { value: v }
    }
    case 'unit_preference_1': {
      const v = str(raw)
      if (!v || v.length > 120) return { error: 'Select at least your first unit preference.' }
      return { value: v }
    }
    case 'unit_preference_2':
    case 'unit_preference_3': {
      const v = str(raw)
      if (v.length > 120) return { error: 'Invalid unit.' }
      return { value: v }
    }
    case 'cumulative_gpa': {
      const n = Number(raw)
      if (!Number.isFinite(n) || n < 0 || n > 4.5) return { error: 'Enter a valid GPA.' }
      return { value: n }
    }
    case 'shift_availability': {
      const v = str(raw)
      if (!['Day Shift Preferred', 'Night Shift Preferred', 'No Preference'].includes(v)) {
        return { error: 'Select your shift preference.' }
      }
      return { value: v }
    }
    case 'interest_statement': {
      const v = str(raw)
      if (v.length < INTEREST_STATEMENT_MIN || v.length > 5000) {
        return { error: `Share at least ${INTEREST_STATEMENT_MIN} characters.` }
      }
      return { value: v }
    }
    case 'unavailable_weekdays':      return { value: sanitizeWeekdays(raw) }
    case 'preferred_days':            return { value: sanitizeWeekdays(raw) }
    case 'personal_blackout_dates':   return { value: sanitizeIsoDates(raw) }
    case 'weekends_available':        return { value: coerceBoolOrNull(raw) }
    case 'nights_available':          return { value: coerceBoolOrNull(raw) }
    case 'unavailable_weekdays_reason': return { value: str(raw).slice(0, 500) }
    case 'availability_notes':          return { value: str(raw).slice(0, 1000) }
    default: return { error: 'This field cannot be edited.' }
  }
}

async function resolveCaller(req, res, db) {
  const auth = await verifyPortalCaller(req)
  if (!auth.authenticated) {
    const status = auth.status === 403 ? 403 : 401
    res.status(status).json({ error: status === 403 ? 'forbidden' : 'unauthorized' })
    return null
  }
  const isStudent = await hasActiveRoleGrant(db, auth.profile.id, 'student')
  if (!isStudent) { res.status(403).json({ error: 'forbidden' }); return null }
  const studentIds = await getActiveStudentLinks(db, auth.profile.id)
  if (studentIds.length === 0) { res.status(403).json({ error: 'forbidden' }); return null }
  return { auth, studentIds }
}

// Resolve the target student id from an optional body/query value against the caller's
// links: an id outside the caller's links is a 403 (never a lookup on someone else).
function resolveTargetId(requested, studentIds, res) {
  const wanted = str(requested)
  if (wanted) {
    if (!studentIds.includes(wanted)) { res.status(403).json({ error: 'forbidden' }); return null }
    return wanted
  }
  if (studentIds.length === 1) return studentIds[0]
  res.status(400).json({ error: 'invalid_request', field: 'student_id', message: 'Please specify which record.' })
  return null
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) {
    return res.status(500).json({ error: 'internal_error' })
  }

  const db = getServiceDb()
  const caller = await resolveCaller(req, res, db)
  if (!caller) return

  // ── GET: the profile + lock state + unit options ──────────────────────────────────
  if (req.method === 'GET') {
    const targetId = resolveTargetId(req.query?.student_id, caller.studentIds, res)
    if (!targetId) return

    const { data: student, error: sErr } = await db
      .from('students').select(PROFILE_SELECT).eq('id', targetId).maybeSingle()
    if (sErr) return res.status(500).json({ error: 'internal_error' })
    if (!student) return res.status(404).json({ error: 'not_found' })

    // Participating units for the student's OWN cohort (portal never queries tables).
    let units = []
    if (student.cohort_id) {
      const { data: unitRows } = await db
        .from('units').select('unit_name')
        .eq('is_participating', true).eq('cohort_id', student.cohort_id).order('unit_name')
      units = (unitRows || []).map(u => u.unit_name)
    }
    let cohortName = ''
    if (student.cohort_id) {
      const { data: cohort } = await db.from('cohorts').select('name').eq('id', student.cohort_id).maybeSingle()
      cohortName = cohort?.name || ''
    }

    const locked = isStudentProfileLocked(student)
    return res.status(200).json({
      student,
      submitted: student.submitted_via === 'student_form',
      locked,
      locked_message: locked ? PROFILE_LOCKED_MESSAGE : null,
      available_units: units,
      cohort_name: cohortName,
      // Presence only - the portal never receives a raw storage path to render.
      documents: { resume_on_file: !!str(student.resume_url), headshot_on_file: !!str(student.headshot_url) },
    })
  }

  // ── POST: 'save' (edit after submission) or 'submit' (authenticated first submission)
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const action = body.action
  if (action !== 'save' && action !== 'submit') {
    return res.status(400).json({ error: 'invalid_request', field: 'action', message: 'Operation not permitted.' })
  }

  // Exact schema. 'submit' additionally accepts the first-submission-only fields
  // (documents just uploaded through the portal signer, and the two acknowledgments).
  const SUBMIT_ONLY_KEYS = ['resume_url', 'headshot_url', 'availability_ack', 'privacy_ack', 'privacy_ack_name']
  const ALLOWED_KEYS = ['action', 'student_id', 'expected_updated_at', ...STUDENT_EDITABLE_FIELDS,
    ...(action === 'submit' ? SUBMIT_ONLY_KEYS : [])]
  const unexpected = Object.keys(body).filter(k => !ALLOWED_KEYS.includes(k))
  if (unexpected.length > 0) {
    return res.status(400).json({ error: 'invalid_request', field: unexpected[0], message: 'This field cannot be edited.' })
  }

  const targetId = resolveTargetId(body.student_id, caller.studentIds, res)
  if (!targetId) return

  const expectedUpdatedAt = str(body.expected_updated_at)
  if (!expectedUpdatedAt) {
    return res.status(400).json({ error: 'invalid_request', field: 'expected_updated_at', message: 'Missing concurrency token.' })
  }

  const { data: student, error: sErr } = await db
    .from('students')
    .select('id, cohort_id, status, interview_scheduled_date, submitted_via, updated_at, first_name, last_name, cs_cedars_status, resume_url, headshot_url')
    .eq('id', targetId).maybeSingle()
  if (sErr) return res.status(500).json({ error: 'internal_error' })
  if (!student) return res.status(404).json({ error: 'not_found' })

  // 'save' exists only after the first submission; 'submit' only before it. (Owner
  // refinement: the authenticated first submission does NOT require the public
  // intake acceptance gate - the student link IS the authority. /student-form and
  // its email-bound gate are unchanged.)
  if (action === 'save' && student.submitted_via !== 'student_form') {
    return res.status(409).json({ error: 'not_submitted', message: 'Submit your profile first.' })
  }
  if (action === 'submit' && student.submitted_via === 'student_form') {
    return res.status(409).json({ error: 'already_submitted', message: 'Your profile is already submitted. Use Save Changes to update it.' })
  }

  // The canonical lock, enforced where it cannot be bypassed (both actions).
  if (isStudentProfileLocked(student)) {
    return res.status(403).json({ error: 'profile_locked', message: PROFILE_LOCKED_MESSAGE })
  }

  // 'submit' must be a complete profile: every required field present, not merely
  // the provided subset an edit may send.
  if (action === 'submit') {
    for (const key of [...REQUIRED_ON_SAVE, 'interest_statement']) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) {
        return res.status(400).json({ error: 'invalid_request', field: key, message: 'This field is required.' })
      }
    }
  }

  // Build the patch from PROVIDED keys only (explicit clearing; omitted = untouched).
  const patch = {}
  for (const key of STUDENT_EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue
    // Required fields may be replaced, never emptied.
    if (REQUIRED_ON_SAVE.includes(key)) {
      const rawEmpty = body[key] === null || body[key] === undefined || str(String(body[key] ?? '')) === ''
      if (rawEmpty) {
        return res.status(400).json({ error: 'invalid_request', field: key, message: 'This field is required.' })
      }
    }
    const out = normalizeField(key, body[key])
    if (out.error) return res.status(400).json({ error: 'invalid_request', field: key, message: out.error })
    patch[key] = out.value
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'invalid_request', message: 'No editable fields were provided.' })
  }

  // ── First-submission requirements and server-set fields (intake parity) ────────────
  if (action === 'submit') {
    // Both acknowledgments are REQUIRED, exactly as on /student-form; version and
    // timestamp are server-set, never trusted from the client.
    if (body.availability_ack !== true) {
      return res.status(400).json({ error: 'invalid_request', field: 'availability_ack', message: 'Please acknowledge the availability statement to submit.' })
    }
    const privacyAckName = str(body.privacy_ack_name)
    if (body.privacy_ack !== true || privacyAckName.length < 1 || privacyAckName.length > 120) {
      return res.status(400).json({ error: 'invalid_request', field: 'privacy_ack', message: 'Please complete the Student Information Use Acknowledgment before submitting.' })
    }
    // Documents: the same server-authoritative rule as the public intake endpoint
    // (incoming canonical path OR already durably on the record).
    const missingDoc = checkDocumentsRequired(body, student)
    if (missingDoc) {
      return res.status(400).json({ error: 'documents_required', field: missingDoc.field, message: missingDoc.message })
    }
    patch.availability_ack = true
    patch.student_form_privacy_ack_name = privacyAckName
    patch.student_form_privacy_ack_version = STUDENT_FORM_ACK_VERSION
    patch.student_form_privacy_ack_at = new Date().toISOString()
    // S-03: bind each supplied file reference to this student, so a portal student cannot point
    // their own record at another student's object. The value must equal the canonical path this
    // server issued for them. Rejected, never rewritten.
    for (const column of ['resume_url', 'headshot_url']) {
      if (!str(body[column])) continue
      const ref = validateStoredFileRefForStudent({
        value: body[column], column, cohortId: student.cohort_id, studentId: student.id,
      })
      if (!ref.ok) {
        console.log('[portal/my-profile] file reference rejected', { column, reason: ref.error })
        return res.status(400).json({ error: 'invalid_request', field: column, message: ref.message })
      }
      patch[column] = ref.path
    }
    patch.submitted_via = 'student_form'
    patch.status = 'Form Received'
    // STUDENT-FORM-CEDARS-STATUS-AUTO-MAP, mirrored from student-intake-submit.js:
    // applied only when the record has no cs_cedars_status yet; never overwrites or
    // auto-clears a staff-set value.
    const CS_AFFILIATION_TO_CEDARS_STATUS = { 'Current Employee': 'employee', 'Volunteer': 'employee', 'Former Employee': 'former' }
    const derived = CS_AFFILIATION_TO_CEDARS_STATUS[patch.cs_affiliation]
    if (derived && !str(student.cs_cedars_status)) {
      patch.cs_cedars_status = derived
      if (derived === 'employee') {
        patch.cs_stage1_action = 'not_applicable'
        patch.cs_stage1_submitted = true
        patch.cs_stage1_complete = true
      } else {
        patch.cs_stage1_action = ''
        patch.cs_stage1_submitted = false
        patch.cs_stage1_complete = false
      }
    }
  }

  // Server-composed display name whenever either half changes (intake parity).
  if (patch.first_name !== undefined || patch.last_name !== undefined) {
    const f = patch.first_name !== undefined ? patch.first_name : (student.first_name || '')
    const l = patch.last_name !== undefined ? patch.last_name : (student.last_name || '')
    patch.name = `${f} ${l}`.trim()
  }

  // ── Stale-write protection: conditioned UPDATE on the loaded updated_at ────────────
  // (set_updated_at_students refreshes updated_at on every write, so any intervening
  // staff or other-tab change makes this condition miss -> 409, nothing overwritten.)
  const { data: updatedRows, error: upErr } = await db
    .from('students')
    .update(patch)
    .eq('id', targetId)
    .eq('updated_at', expectedUpdatedAt)
    .select('updated_at')
  if (upErr) {
    console.log('[portal/my-profile] save failed', { errorCode: upErr.code })
    return res.status(500).json({ error: 'internal_error' })
  }
  if (!updatedRows || updatedRows.length === 0) {
    return res.status(409).json({
      error: 'stale_write',
      message: 'Your profile changed since this page was loaded. Review the latest version and try again.',
    })
  }

  // ── First submission: the same deduplicated form_received event as public intake ──
  if (action === 'submit') {
    try {
      const { data: existingEvent } = await db
        .from('program_events').select('id')
        .eq('student_id', targetId).eq('cohort_id', student.cohort_id)
        .eq('event_type', 'form_received').limit(1).maybeSingle()
      if (!existingEvent) {
        await db.from('program_events').insert({
          student_id: targetId,
          cohort_id: student.cohort_id,
          event_type: 'form_received',
          event_date: toLocalDateStr(),
          notes: 'Student submitted their profile from the Student Portal (My Profile).',
          created_by: 'Student Portal',
        })
      }
    } catch {
      console.warn('[portal/my-profile] form_received event log failed')
    }
  }

  // ── Audit: who, what fields, when, from where. Field NAMES only, never values. ────
  const changedFields = Object.keys(patch).filter(k => k !== 'name')
  try {
    await db.from('activity_logs').insert({
      user_id: caller.auth.profile.id,
      user_name: caller.auth.profile.full_name || 'Student',
      user_role: 'student',
      action_type: 'student_profile_self_update',
      entity_type: 'student',
      entity_id: String(targetId),
      cohort_id: student.cohort_id || null,
      description: action === 'submit'
        ? 'Student submitted their profile from the Student Portal (My Profile).'
        : 'Student updated their profile from the Student Portal (My Profile).',
      metadata: { source: 'portal_my_profile', kind: action, fields: changedFields },
    })
  } catch {
    console.warn('[portal/my-profile] audit insert failed')
  }

  return res.status(200).json({
    success: true,
    updated: changedFields,
    updated_at: updatedRows[0].updated_at,
  })
}
