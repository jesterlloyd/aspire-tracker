import { createClient } from '@supabase/supabase-js'
import { toLocalDateStr } from '../shared/dateUtils.js'

// WS1e-A1: server-verified caller identity (WS1 pattern). Returns both identifier
// domains (userId = auth.users.id, profileId = user_profiles.id). req.body never
// influences authorization.
async function verifyCaller(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { authenticated: false, status: 401, reason: 'missing_token' }
  const url        = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey    = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  let user
  try {
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data, error } = await userClient.auth.getUser()
    if (error || !data?.user) return { authenticated: false, status: 401, reason: 'invalid_token' }
    user = data.user
  } catch {
    return { authenticated: false, status: 401, reason: 'verify_threw' }
  }
  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: profile, error: pErr } = await admin
      .from('user_profiles').select('id, role, is_owner').eq('auth_user_id', user.id).maybeSingle()
    if (pErr) return { authenticated: false, status: 401, reason: 'profile_lookup_failed' }
    if (!profile) return { authenticated: false, status: 403, reason: 'no_profile' }
    return { authenticated: true, userId: user.id, profileId: profile.id, role: profile.role || '', isOwner: profile.is_owner === true }
  } catch {
    return { authenticated: false, status: 401, reason: 'profile_threw' }
  }
}

// WS1e-A3b: exact rubric-outcome field set for save_interview_outcome (used by
// Owner/Admin/Interviewer). These fields are NO LONGER writable via the generic
// `update` action (see MIGRATED_RUBRIC below).
const RUBRIC_OUTCOME_FIELDS = [
  'unit_preference_1', 'unit_preference_2', 'unit_preference_3',
  'avg_cj_score', 'avg_pp_score', 'avg_ga_score', 'avg_composite_score', 'rubric_count',
  'auto_recommendation', 'score_flag', 'score_flag_message', 'interview_outcome',
  'status', 'flagged_for_second_interview', 'flag_note',
]
const RUBRIC_AUTO_REC = ['Recommend', 'Recommend with Reservations', 'Do Not Recommend at This Time']
const RUBRIC_OUTCOME  = ['Recommend', 'Recommend with Reservations', 'Do Not Recommend']
const RUBRIC_STATUS   = ['Interviewed'] // the only status the rubric workflow assigns
// Manual interview_outcome override options (StudentSidePanel/StudentRow selects).
const MANUAL_OUTCOME_VALUES = ['Pending Interview', 'Recommend', 'Recommend with Reservations', 'Do Not Recommend']

// Fields migrated OFF the generic `update` action into explicit actions. Rejected
// before the whitelist/fallback so the all-pass-through fallback can never write
// them. `status` is intentionally NOT here (cross-domain; kept generic for Owner/Admin).
const MIGRATED_PLACEMENT = ['matched_preceptor', 'shift_assigned', 'assigned_shift']
const MIGRATED_SCHEDULE  = ['interview_scheduled_date', 'interview_scheduled_time', 'interview_duration_minutes', 'interview_assigned_interviewers']
const MIGRATED_RUBRIC    = ['unit_preference_1', 'unit_preference_2', 'unit_preference_3', 'avg_cj_score', 'avg_pp_score', 'avg_ga_score', 'avg_composite_score', 'rubric_count', 'auto_recommendation', 'score_flag', 'score_flag_message', 'interview_outcome', 'flagged_for_second_interview', 'flag_note']
function migratedFieldHint(field) {
  if (MIGRATED_PLACEMENT.includes(field)) return 'Use update_preceptor_assignment for preceptor/shift assignment.'
  if (MIGRATED_SCHEDULE.includes(field))  return 'Use update_interview_schedule for interview scheduling.'
  return 'Use save_interview_outcome / update_interview_outcome for interview outcome fields.'
}


function validateRubricField(k, v) {
  switch (k) {
    case 'status':                       return RUBRIC_STATUS.includes(v)
    case 'auto_recommendation':          return RUBRIC_AUTO_REC.includes(v)
    case 'interview_outcome':            return RUBRIC_OUTCOME.includes(v)
    case 'score_flag':
    case 'flagged_for_second_interview': return typeof v === 'boolean'
    case 'rubric_count':                 return Number.isInteger(v) && v >= 0 && v <= 50
    case 'avg_cj_score':
    case 'avg_pp_score':
    case 'avg_ga_score':                 return typeof v === 'number' && v >= 0 && v <= 5
    case 'avg_composite_score':          return typeof v === 'number' && v >= 0 && v <= 15
    case 'score_flag_message':
    case 'flag_note':                    return typeof v === 'string' && v.length <= 2000
    case 'unit_preference_1':
    case 'unit_preference_2':
    case 'unit_preference_3':            return typeof v === 'string' && v.length <= 120
    default:                             return false
  }
}

// ── WS1e-A4: explicit staff-domain field sets, enums, and validation ──────────
// Status enum duplicated from src/lib/constants.js ASPIRE_STATUSES (keep in sync).
const ASPIRE_STATUSES = ['Pending Outreach', 'Form Sent', 'Form Received', 'Interview Scheduled', 'Interviewed', 'Placed', 'Active Rotation', 'Completed', 'Declined', 'Not Proceeding']
const NGRP_OUTCOMES   = ['Pending', 'Applied', 'Interviewed', 'Offered', 'Hired', 'Declined']
const CEDARS_STATUS   = ['new', 'former', 'employee']
const STAGE1_ACTIONS  = ['add_non_employee', 'assignment_change', 'extend_end_date', 'reactivate', 'not_applicable']

const CONTACT_FIELDS = ['personal_email', 'phone']
// WS1e-A4 (corr.2): `name` is NOT client-writable — server composes it from
// first_name/last_name. Client may submit first_name and/or last_name only.
const PROFILE_FIELDS = ['first_name', 'last_name', 'date_of_birth', 'gender', 'cumulative_gpa', 'program_type', 'shift_availability', 'prior_healthcare_experience', 'cs_affiliation', 'cs_department', 'cs_role', 'interest_statement', 'resume_url', 'headshot_url']
const REQUIREMENT_FIELDS = ['hours_required']
const CSLINK_FIELDS  = ['cs_cedars_status', 'cs_stage1_action', 'cs_stage1_submitted', 'cs_stage1_submitted_date', 'cs_stage1_complete', 'cs_stage1_complete_date', 'cs_link_requested', 'cs_link_requested_date', 'cs_link_complete', 'cs_link_complete_date', 'cs_access_notes']
const CSLINK_PAIRS = [['cs_stage1_submitted', 'cs_stage1_submitted_date'], ['cs_stage1_complete', 'cs_stage1_complete_date'], ['cs_link_requested', 'cs_link_requested_date'], ['cs_link_complete', 'cs_link_complete_date']]
const NGRP_FIELDS    = ['ngrp_cohort_target', 'ngrp_outcome']
const BADGE_FIELDS   = ['badge_created'] // WS1e-A4 (corr.1): only active badge mutation
const NOTES_FIELDS   = ['notes']

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
function isValidYMD(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}
function validateA4Field(k, v) {
  switch (k) {
    case 'personal_email':            return v === '' || (typeof v === 'string' && v.length <= 200 && EMAIL_RE.test(v))
    case 'phone':                     return typeof v === 'string' && v.length <= 40
    case 'first_name':
    case 'last_name':
    case 'name':                      return typeof v === 'string' && v.length <= 120
    case 'date_of_birth':             return v === '' || v === null || isValidYMD(v)
    case 'gender':                    return typeof v === 'string' && v.length <= 50
    case 'cumulative_gpa':            return v === null || v === '' || (typeof v === 'number' && v >= 0 && v <= 4.5)
    case 'program_type':
    case 'shift_availability':
    case 'cs_affiliation':
    case 'cs_department':
    case 'cs_role':                   return typeof v === 'string' && v.length <= 120
    case 'prior_healthcare_experience':
    case 'interest_statement':        return typeof v === 'string' && v.length <= 5000
    case 'resume_url':
    case 'headshot_url':              return v === '' || (typeof v === 'string' && v.length <= 500)
    case 'hours_required':            return Number.isInteger(v) && v >= 0 && v <= 10000
    case 'cs_cedars_status':          return v === '' || v === null || CEDARS_STATUS.includes(v)
    case 'cs_stage1_action':          return v === '' || v === null || STAGE1_ACTIONS.includes(v)
    case 'cs_stage1_submitted':
    case 'cs_stage1_complete':
    case 'cs_link_requested':
    case 'cs_link_complete':          return typeof v === 'boolean'
    case 'cs_stage1_submitted_date':
    case 'cs_stage1_complete_date':
    case 'cs_link_requested_date':
    case 'cs_link_complete_date':     return v === '' || v === null || isValidYMD(v) // WS1e-A4 (corr.3): exact YYYY-MM-DD
    case 'cs_access_notes':           return v === '' || v === null || (typeof v === 'string' && v.length <= 5000)
    case 'ngrp_cohort_target':        return typeof v === 'string' && v.length <= 120
    case 'ngrp_outcome':              return v === '' || v === null || NGRP_OUTCOMES.includes(v)
    case 'badge_created':             return typeof v === 'boolean'
    case 'notes':                     return typeof v === 'string' && v.length <= 10000
    default:                          return false
  }
}

// Shared runner for the simple domain actions (exact schema, ≥1 field, idempotent).
// crossValidate(payload) → returns an offending field name (400) or null.
async function handleDomainUpdate({ res, db, requestId, auth, body, payload, domainFields, label, crossValidate }) {
  const ALLOWED = ['action', 'student_id', ...domainFields]
  const unexpected = Object.keys(body || {}).filter(k => !ALLOWED.includes(k))
  if (unexpected.length > 0) return res.status(400).json({ error: 'invalid_request', field: unexpected[0], message: 'Unexpected field.' })
  const { student_id } = payload
  if (!student_id || typeof student_id !== 'string') return res.status(400).json({ error: 'invalid_request', field: 'student_id' })
  const supplied = domainFields.filter(k => payload[k] !== undefined)
  if (supplied.length === 0) return res.status(400).json({ error: 'invalid_request', message: 'At least one field is required.' })
  for (const k of supplied) {
    if (!validateA4Field(k, payload[k])) return res.status(400).json({ error: 'invalid_request', field: k, message: 'Invalid value for this field.' })
  }
  if (crossValidate) {
    const bad = crossValidate(payload)
    if (bad) return res.status(400).json({ error: 'invalid_request', field: bad, message: 'Inconsistent paired fields.' })
  }
  const { data: stu, error: stuErr } = await db.from('students')
    .select(['id', 'cohort_id', ...supplied].join(', ')).eq('id', student_id).maybeSingle()
  if (stuErr) return res.status(500).json({ error: 'internal_error' })
  if (!stu) return res.status(404).json({ error: 'not_found' })
  const upd = {}
  for (const k of supplied) upd[k] = payload[k]
  const noChange = supplied.every(k => (stu[k] ?? null) === (upd[k] ?? null))
  if (noChange) return res.status(200).json({ success: true, no_change: true })
  const { error: updErr } = await db.from('students').update(upd).eq('id', student_id)
  if (updErr) {
    console.log(`[student-update] ${label} failed`, { request_id: requestId, errorCode: updErr.code })
    return res.status(500).json({ error: 'internal_error' })
  }
  console.log(`[student-update] ${label}`, { request_id: requestId, callerRole: auth.role, studentId: student_id, cohortId: stu.cohort_id ?? null, fields: supplied })
  return res.status(200).json({ success: true })
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Server configuration error' })

  const db = createClient(supabaseUrl, serviceKey)
  const requestId = `req_${Math.random().toString(36).slice(2, 10)}`

  // WS1e-A1: every action requires a server-verified staff caller.
  const auth = await verifyCaller(req)
  if (!auth.authenticated) {
    console.log('[student-update] auth rejected', { reason: auth.reason, request_id: requestId })
    if (auth.reason === 'no_profile') return res.status(403).json({ error: 'forbidden', message: 'Access denied.' })
    return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' })
  }
  const isOwnerAdmin  = auth.isOwner || auth.role === 'admin'
  const isInterviewer = auth.role === 'interviewer'

  const { action, ...payload } = req.body || {}

  try {

    if (action === 'update') {
      const { student_id, fields, loaded_updated_at } = payload
      if (!student_id) return res.status(400).json({ error: 'invalid_request', field: 'student_id' })
      if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length === 0) {
        return res.status(400).json({ error: 'invalid_request', field: 'fields' })
      }

      // ── Owner/Admin only. Interviewers have NO generic-update access (WS1e-A3b);
      //    their only student write path is save_interview_outcome. ──────────────
      if (!isOwnerAdmin) {
        return res.status(403).json({ error: 'forbidden', message: 'You do not have permission to update students.' })
      }

      // Fields migrated to explicit actions (placement A2, scheduling A3a, rubric
      // outcomes A3b) — reject BEFORE the whitelist/fallback so the all-pass-through
      // fallback can never write them.
      const migratedField = Object.keys(fields).find(k =>
        MIGRATED_PLACEMENT.includes(k) || MIGRATED_SCHEDULE.includes(k) || MIGRATED_RUBRIC.includes(k))
      if (migratedField) {
        return res.status(400).json({ error: 'invalid_request', field: migratedField, message: migratedFieldHint(migratedField) })
      }

      const allowed = [
        'first_name', 'last_name', 'name', 'email', 'school_email', 'personal_email',
        'phone', 'school', 'program', 'program_type', 'cohort_id',
        'cumulative_gpa', 'gpa', 'expected_graduation', 'graduation_date', 'graduation_semester',
        'status', 'decline_reason',
        // WS1e-A3b: unit_preference_1/2/3 migrated to save_interview_outcome.
        'unit_preference', 'specialty_interest',
        'notes', 'internal_notes', 'admin_notes',
        'badge_created', 'badge_issued', 'badge_printed',
        // CS-Link Access Manager — all 4 paired boolean+date fields plus action, status, notes
        'cs_cedars_status',
        'cs_stage1_action',
        'cs_stage1_submitted', 'cs_stage1_submitted_date',
        'cs_stage1_complete',  'cs_stage1_complete_date',
        'cs_link_requested',   'cs_link_requested_date',
        'cs_link_complete',    'cs_link_complete_date',
        'cs_access_notes',
        'approved_hours', 'hours_required', 'pending_hours',
        'matched_unit_id', 'preceptor_id',
        'orientation_sent_at', 'interview_preference',
        'shift_preference', 'availability_notes',
        'linkedin_url', 'portfolio_url',
        'emergency_contact', 'emergency_phone',
        'preferred_name', 'pronouns',
        'interview_score', 'recommendation', 'self_scheduled',
        // WS1e-A2: matched_preceptor / shift_assigned / assigned_shift migrated to
        // the explicit update_preceptor_assignment action — intentionally NOT here.
        'preceptor_name', 'preceptor_assigned', 'assigned_preceptor',
        'shift', 'shift_type', 'clinical_shift', 'shift_preference',
        'match_notes', 'placement_notes', 'unit_notes', 'preceptor_notes',
        // WS1e-A3a: interview_scheduled_* migrated to update_interview_schedule.
        // WS1e-A3b: flagged_for_second_interview / auto_recommendation / interview_outcome
        // and rubric aggregates migrated to save_interview_outcome.
        'resume_url', 'headshot_url', 'scheduling_viewed_at',
        'interest_statement', 'submitted_via',
        'date_of_birth', 'ssn_last4', 'gender', 'shift_availability',
        'cs_affiliation', 'cs_department', 'cs_role', 'prior_healthcare_experience',
        'estimated_graduation_date',
        // cohort_school_rotation_id intentionally omitted: owned by school-form
        // submission handler and the rotation override panel, not generic drawer edits
      ]

      const rejectedFields = Object.keys(fields).filter(k => !allowed.includes(k))
      if (rejectedFields.length > 0) console.warn('[student-update] rejected (not in whitelist):', rejectedFields)

      const safeFields = {}
      Object.keys(fields).forEach(key => { if (allowed.includes(key)) safeFields[key] = fields[key] })

      // If ALL fields were rejected, pass everything through rather than silently fail
      const fieldsToSave = Object.keys(safeFields).length > 0 ? safeFields : fields

      console.log('[student-update] whitelisted fields:', { request_id: requestId, callerRole: auth.role, fields: Object.keys(fieldsToSave) }) // PII-safe: names only

      // Build the update query; attach OCC guard when caller supplies loaded_updated_at
      let query = db.from('students').update(fieldsToSave).eq('id', student_id)
      if (loaded_updated_at) {
        query = query.eq('updated_at', loaded_updated_at)
      }
      // Use .select() (not .single()) so 0-row results don't throw PGRST116
      const { data, error } = await query.select()
      if (error) {
        console.error('student update DB error:', error)
        return res.status(400).json({ error: error.message })
      }

      // OCC conflict: filter matched but 0 rows updated (another write changed updated_at)
      if (loaded_updated_at && data.length === 0) {
        const { data: existing } = await db.from('students')
          .select('id, updated_at').eq('id', student_id).maybeSingle()
        if (existing) {
          console.warn('[student-update] OCC conflict on', student_id)
          return res.status(409).json({ conflict: true, current_updated_at: existing.updated_at })
        }
        return res.status(404).json({ error: 'Student not found' })
      }

      return res.status(200).json({
        success: true,
        data: data[0] || null,
        fieldsWritten: Object.keys(fieldsToSave),
        droppedFields: rejectedFields,
      })
    }

    // WS1e-A2: explicit, narrow placement operation — the ONLY student-update path
    // permitted to mutate matched_preceptor / shift_assigned. Owner/Admin only.
    if (action === 'update_preceptor_assignment') {
      if (!isOwnerAdmin) {
        return res.status(403).json({ error: 'forbidden', message: 'You do not have permission to assign placement.' })
      }
      // Exact top-level schema (besides action): student_id + optional preceptor/shift/email.
      // WS1e-A4: preceptor_email added here (placement-adjacent; NOT student contact info).
      const PA_ALLOWED = ['action', 'student_id', 'matched_preceptor', 'shift_assigned', 'preceptor_email']
      const unexpectedPA = Object.keys(req.body || {}).filter(k => !PA_ALLOWED.includes(k))
      if (unexpectedPA.length > 0) {
        return res.status(400).json({ error: 'invalid_request', field: unexpectedPA[0], message: 'Unexpected field.' })
      }
      const { student_id, matched_preceptor, shift_assigned, preceptor_email } = payload
      if (!student_id || typeof student_id !== 'string') {
        return res.status(400).json({ error: 'invalid_request', field: 'student_id' })
      }
      const hasPreceptor = matched_preceptor !== undefined
      const hasShift     = shift_assigned !== undefined
      const hasEmail     = preceptor_email !== undefined
      if (!hasPreceptor && !hasShift && !hasEmail) {
        return res.status(400).json({ error: 'invalid_request', message: 'At least one of matched_preceptor, shift_assigned, or preceptor_email is required.' })
      }

      const upd = {}
      if (hasPreceptor) {
        if (typeof matched_preceptor !== 'string') {
          return res.status(400).json({ error: 'invalid_request', field: 'matched_preceptor' })
        }
        const v = matched_preceptor.trim() // free text; empty string clears. NOT a verified record; preceptor_id not written.
        if (v.length > 200) return res.status(400).json({ error: 'invalid_request', field: 'matched_preceptor', message: 'Too long.' })
        if (/[\u0000-\u001F\u007F]/.test(v)) return res.status(400).json({ error: 'invalid_request', field: 'matched_preceptor', message: 'Invalid characters.' })
        upd.matched_preceptor = v
      }
      if (hasShift) {
        const SHIFTS = ['Day', 'Night', 'Midshift', 'Either', ''] // '' clears
        if (typeof shift_assigned !== 'string' || !SHIFTS.includes(shift_assigned)) {
          return res.status(400).json({ error: 'invalid_request', field: 'shift_assigned' })
        }
        upd.shift_assigned = shift_assigned
      }
      if (hasEmail) {
        // Free-text preceptor contact email; '' clears. preceptor_id NOT inferred/written.
        if (typeof preceptor_email !== 'string' || (preceptor_email !== '' && (preceptor_email.length > 200 || !EMAIL_RE.test(preceptor_email)))) {
          return res.status(400).json({ error: 'invalid_request', field: 'preceptor_email' })
        }
        upd.preceptor_email = preceptor_email
      }

      // Resolve student; derive cohort context; evaluate idempotency on requested fields only.
      const { data: stu, error: stuErr } = await db
        .from('students').select('id, cohort_id, matched_preceptor, shift_assigned, preceptor_email')
        .eq('id', student_id).maybeSingle()
      if (stuErr) return res.status(500).json({ error: 'internal_error' })
      if (!stu) return res.status(404).json({ error: 'not_found' })

      const noChange = Object.keys(upd).every(k => (stu[k] ?? '') === (upd[k] ?? ''))
      if (noChange) {
        return res.status(200).json({ success: true, no_change: true })
      }

      const { error: updErr } = await db.from('students').update(upd).eq('id', student_id)
      if (updErr) {
        console.log('[student-update] preceptor-assignment update failed', { request_id: requestId, errorCode: updErr.code })
        return res.status(500).json({ error: 'internal_error' })
      }
      console.log('[student-update] preceptor-assignment update', { request_id: requestId, callerRole: auth.role, callerIsOwner: auth.isOwner, studentId: student_id, cohortId: stu.cohort_id, fields: Object.keys(upd) })
      return res.status(200).json({ success: true })
    }

    // WS1e-A3a: explicit interview scheduling — the ONLY student-update path for
    // the four scheduling fields. Server-controls status='Interview Scheduled'.
    // Owner/Admin only. Two explicit modes: schedule/reschedule, or clear.
    if (action === 'update_interview_schedule') {
      if (!isOwnerAdmin) {
        return res.status(403).json({ error: 'forbidden', message: 'You do not have permission to schedule interviews.' })
      }
      const { student_id } = payload
      if (!student_id || typeof student_id !== 'string') {
        return res.status(400).json({ error: 'invalid_request', field: 'student_id' })
      }
      const isClear = req.body?.clear === true

      // ── Clear mode: { action, student_id, clear:true } — no mixed values ──────
      if (isClear) {
        const CLEAR_ALLOWED = ['action', 'student_id', 'clear']
        const unexpected = Object.keys(req.body || {}).filter(k => !CLEAR_ALLOWED.includes(k))
        if (unexpected.length > 0) {
          return res.status(400).json({ error: 'invalid_request', field: unexpected[0], message: 'Unexpected field (clear mode accepts no scheduling values).' })
        }
        const { data: stu, error: stuErr } = await db.from('students')
          .select('id, cohort_id, interview_scheduled_date, interview_scheduled_time, interview_duration_minutes, interview_assigned_interviewers')
          .eq('id', student_id).maybeSingle()
        if (stuErr) return res.status(500).json({ error: 'internal_error' })
        if (!stu) return res.status(404).json({ error: 'not_found' })
        const alreadyClear = (stu.interview_scheduled_date ?? '') === '' && (stu.interview_scheduled_time ?? '') === ''
          && stu.interview_duration_minutes == null && (stu.interview_assigned_interviewers ?? '') === ''
        if (alreadyClear) return res.status(200).json({ success: true, no_change: true })
        // status intentionally preserved (matches current EditScheduleModal delete behavior).
        const { error: updErr } = await db.from('students').update({
          interview_scheduled_date: '', interview_scheduled_time: '',
          interview_duration_minutes: null, interview_assigned_interviewers: '',
        }).eq('id', student_id)
        if (updErr) {
          console.log('[student-update] schedule clear failed', { request_id: requestId, errorCode: updErr.code })
          return res.status(500).json({ error: 'internal_error' })
        }
        console.log('[student-update] interview schedule cleared', { request_id: requestId, callerRole: auth.role, studentId: student_id, cohortId: stu.cohort_id ?? null })
        return res.status(200).json({ success: true })
      }

      // ── Schedule / reschedule mode (exact schema) ─────────────────────────────
      const SCHED_ALLOWED = ['action', 'student_id', 'interview_scheduled_date', 'interview_scheduled_time', 'interview_duration_minutes', 'interview_assigned_interviewers']
      const unexpected = Object.keys(req.body || {}).filter(k => !SCHED_ALLOWED.includes(k))
      if (unexpected.length > 0) {
        return res.status(400).json({ error: 'invalid_request', field: unexpected[0], message: 'Unexpected field.' })
      }
      const { interview_scheduled_date: schedDate, interview_scheduled_time: schedTime,
              interview_duration_minutes: schedDuration, interview_assigned_interviewers: schedInterviewers } = payload

      if (typeof schedDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(schedDate)) {
        return res.status(400).json({ error: 'invalid_request', field: 'interview_scheduled_date', message: 'Expected YYYY-MM-DD.' })
      }
      {
        const [y, m, d] = schedDate.split('-').map(Number)
        const dt = new Date(y, m - 1, d)
        if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
          return res.status(400).json({ error: 'invalid_request', field: 'interview_scheduled_date', message: 'Invalid calendar date.' })
        }
      }
      if (typeof schedTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedTime)) {
        return res.status(400).json({ error: 'invalid_request', field: 'interview_scheduled_time', message: 'Expected HH:MM.' })
      }
      if (!Number.isInteger(schedDuration) || ![30, 45].includes(schedDuration)) {
        return res.status(400).json({ error: 'invalid_request', field: 'interview_duration_minutes' })
      }
      if (typeof schedInterviewers !== 'string' || schedInterviewers.length > 500) {
        return res.status(400).json({ error: 'invalid_request', field: 'interview_assigned_interviewers' })
      }

      const { data: stu, error: stuErr } = await db.from('students')
        .select('id, cohort_id, status, interview_scheduled_date, interview_scheduled_time, interview_duration_minutes, interview_assigned_interviewers')
        .eq('id', student_id).maybeSingle()
      if (stuErr) return res.status(500).json({ error: 'internal_error' })
      if (!stu) return res.status(404).json({ error: 'not_found' })

      const fieldsMatch = (stu.interview_scheduled_date ?? '') === schedDate
        && (stu.interview_scheduled_time ?? '') === schedTime
        && (stu.interview_duration_minutes ?? null) === schedDuration
        && (stu.interview_assigned_interviewers ?? '') === schedInterviewers
      if (fieldsMatch && stu.status === 'Interview Scheduled') {
        return res.status(200).json({ success: true, no_change: true })
      }
      const { error: updErr } = await db.from('students').update({
        interview_scheduled_date: schedDate,
        interview_scheduled_time: schedTime,
        interview_duration_minutes: schedDuration,
        interview_assigned_interviewers: schedInterviewers,
        status: 'Interview Scheduled',
      }).eq('id', student_id)
      if (updErr) {
        console.log('[student-update] schedule failed', { request_id: requestId, errorCode: updErr.code })
        return res.status(500).json({ error: 'internal_error' })
      }
      console.log('[student-update] interview scheduled', { request_id: requestId, callerRole: auth.role, studentId: student_id, cohortId: stu.cohort_id ?? null })
      return res.status(200).json({ success: true })
    }

    // WS1e-A3b: unified rubric-outcome persistence — the ONLY student-update path
    // for the rubric field set. Owner/Admin/Interviewer (interviewer status only
    // 'Interviewed', enforced by validateRubricField). Partial updates supported.
    if (action === 'save_interview_outcome') {
      if (!(isOwnerAdmin || isInterviewer)) {
        return res.status(403).json({ error: 'forbidden', message: 'You do not have permission to save interview outcomes.' })
      }
      const ALLOWED = ['action', 'student_id', ...RUBRIC_OUTCOME_FIELDS]
      const unexpected = Object.keys(req.body || {}).filter(k => !ALLOWED.includes(k))
      if (unexpected.length > 0) {
        return res.status(400).json({ error: 'invalid_request', field: unexpected[0], message: 'Unexpected field.' })
      }
      const { student_id } = payload
      if (!student_id || typeof student_id !== 'string') {
        return res.status(400).json({ error: 'invalid_request', field: 'student_id' })
      }
      const supplied = RUBRIC_OUTCOME_FIELDS.filter(k => payload[k] !== undefined)
      if (supplied.length === 0) {
        return res.status(400).json({ error: 'invalid_request', message: 'At least one rubric field is required.' })
      }
      for (const k of supplied) {
        // status (if supplied) is restricted to 'Interviewed' for ALL roles here.
        if (!validateRubricField(k, payload[k])) {
          return res.status(400).json({ error: 'invalid_request', field: k, message: 'Invalid value for this field.' })
        }
      }
      const upd = {}
      for (const k of supplied) upd[k] = payload[k]

      // supplied keys come only from the fixed RUBRIC_OUTCOME_FIELDS allow-list.
      const { data: stu, error: stuErr } = await db.from('students')
        .select(['id', 'cohort_id', ...supplied].join(', ')).eq('id', student_id).maybeSingle()
      if (stuErr) return res.status(500).json({ error: 'internal_error' })
      if (!stu) return res.status(404).json({ error: 'not_found' })

      const noChange = supplied.every(k => (stu[k] ?? null) === (upd[k] ?? null))
      if (noChange) return res.status(200).json({ success: true, no_change: true })

      const { error: updErr } = await db.from('students').update(upd).eq('id', student_id)
      if (updErr) {
        console.log('[student-update] save_interview_outcome failed', { request_id: requestId, errorCode: updErr.code })
        return res.status(500).json({ error: 'internal_error' })
      }
      console.log('[student-update] interview outcome saved', { request_id: requestId, callerRole: auth.role, studentId: student_id, cohortId: stu.cohort_id ?? null, fields: supplied })
      return res.status(200).json({ success: true })
    }

    // WS1e-A3b: manual single-field interview_outcome override — Owner/Admin only,
    // distinct from the full rubric submission. Cannot touch any other field.
    if (action === 'update_interview_outcome') {
      if (!isOwnerAdmin) {
        return res.status(403).json({ error: 'forbidden', message: 'You do not have permission to set interview outcome.' })
      }
      const ALLOWED = ['action', 'student_id', 'interview_outcome']
      const unexpected = Object.keys(req.body || {}).filter(k => !ALLOWED.includes(k))
      if (unexpected.length > 0) {
        return res.status(400).json({ error: 'invalid_request', field: unexpected[0], message: 'Unexpected field.' })
      }
      const { student_id, interview_outcome } = payload
      if (!student_id || typeof student_id !== 'string') {
        return res.status(400).json({ error: 'invalid_request', field: 'student_id' })
      }
      if (typeof interview_outcome !== 'string' || !MANUAL_OUTCOME_VALUES.includes(interview_outcome)) {
        return res.status(400).json({ error: 'invalid_request', field: 'interview_outcome' })
      }
      const { data: stu, error: stuErr } = await db.from('students')
        .select('id, cohort_id, interview_outcome').eq('id', student_id).maybeSingle()
      if (stuErr) return res.status(500).json({ error: 'internal_error' })
      if (!stu) return res.status(404).json({ error: 'not_found' })
      if ((stu.interview_outcome ?? '') === interview_outcome) {
        return res.status(200).json({ success: true, no_change: true })
      }
      const { error: updErr } = await db.from('students').update({ interview_outcome }).eq('id', student_id)
      if (updErr) {
        console.log('[student-update] update_interview_outcome failed', { request_id: requestId, errorCode: updErr.code })
        return res.status(500).json({ error: 'internal_error' })
      }
      console.log('[student-update] manual interview outcome updated', { request_id: requestId, callerRole: auth.role, studentId: student_id, cohortId: stu.cohort_id ?? null })
      return res.status(200).json({ success: true })
    }

    // ── WS1e-A4: explicit staff-domain actions (Owner/Admin only) ─────────────
    if (action === 'update_contact') {
      if (!isOwnerAdmin) return res.status(403).json({ error: 'forbidden' })
      return handleDomainUpdate({ res, db, requestId, auth, body: req.body, payload, domainFields: CONTACT_FIELDS, label: 'contact update' })
    }
    // WS1e-A4 (corr.2): name is server-composed from first_name/last_name; client
    // may not submit `name` (rejected as unexpected).
    if (action === 'update_profile') {
      if (!isOwnerAdmin) return res.status(403).json({ error: 'forbidden' })
      const ALLOWED = ['action', 'student_id', ...PROFILE_FIELDS]
      const unexpected = Object.keys(req.body || {}).filter(k => !ALLOWED.includes(k))
      if (unexpected.length > 0) return res.status(400).json({ error: 'invalid_request', field: unexpected[0], message: 'Unexpected field.' })
      const { student_id } = payload
      if (!student_id || typeof student_id !== 'string') return res.status(400).json({ error: 'invalid_request', field: 'student_id' })
      const supplied = PROFILE_FIELDS.filter(k => payload[k] !== undefined)
      if (supplied.length === 0) return res.status(400).json({ error: 'invalid_request', message: 'At least one field is required.' })
      for (const k of supplied) {
        if (!validateA4Field(k, payload[k])) return res.status(400).json({ error: 'invalid_request', field: k, message: 'Invalid value for this field.' })
      }
      const selectCols = [...new Set(['id', 'cohort_id', 'name', 'first_name', 'last_name', ...supplied])].join(', ')
      const { data: stu, error: stuErr } = await db.from('students').select(selectCols).eq('id', student_id).maybeSingle()
      if (stuErr) return res.status(500).json({ error: 'internal_error' })
      if (!stu) return res.status(404).json({ error: 'not_found' })
      const upd = {}
      for (const k of supplied) upd[k] = payload[k]
      // Server-compose name from the resulting first/last whenever either changes.
      if (upd.first_name !== undefined || upd.last_name !== undefined) {
        const f = (upd.first_name !== undefined ? upd.first_name : (stu.first_name || '')).trim()
        const l = (upd.last_name  !== undefined ? upd.last_name  : (stu.last_name  || '')).trim()
        upd.name = `${f} ${l}`.trim()
      }
      const compareKeys = Object.keys(upd)
      const noChange = compareKeys.every(k => (stu[k] ?? null) === (upd[k] ?? null))
      if (noChange) return res.status(200).json({ success: true, no_change: true })
      const { error: updErr } = await db.from('students').update(upd).eq('id', student_id)
      if (updErr) {
        console.log('[student-update] profile update failed', { request_id: requestId, errorCode: updErr.code })
        return res.status(500).json({ error: 'internal_error' })
      }
      console.log('[student-update] profile update', { request_id: requestId, callerRole: auth.role, studentId: student_id, cohortId: stu.cohort_id ?? null, fields: compareKeys })
      return res.status(200).json({ success: true })
    }
    if (action === 'update_requirements') {
      if (!isOwnerAdmin) return res.status(403).json({ error: 'forbidden' })
      return handleDomainUpdate({ res, db, requestId, auth, body: req.body, payload, domainFields: REQUIREMENT_FIELDS, label: 'requirements update' })
    }
    // WS1e-A4 (corr.3): CS-Link dates are exact YYYY-MM-DD; pairing rejects a false
    // boolean accompanied (same request) by a non-empty paired date.
    if (action === 'update_cslink') {
      if (!isOwnerAdmin) return res.status(403).json({ error: 'forbidden' })
      const crossValidate = (p) => {
        for (const [boolKey, dateKey] of CSLINK_PAIRS) {
          if (p[boolKey] === false && p[dateKey] !== undefined && p[dateKey] !== '' && p[dateKey] !== null) return dateKey
        }
        return null
      }
      return handleDomainUpdate({ res, db, requestId, auth, body: req.body, payload, domainFields: CSLINK_FIELDS, label: 'cslink update', crossValidate })
    }
    if (action === 'update_ngrp') {
      if (!isOwnerAdmin) return res.status(403).json({ error: 'forbidden' })
      return handleDomainUpdate({ res, db, requestId, auth, body: req.body, payload, domainFields: NGRP_FIELDS, label: 'ngrp update' })
    }
    if (action === 'update_badge') {
      if (!isOwnerAdmin) return res.status(403).json({ error: 'forbidden' })
      return handleDomainUpdate({ res, db, requestId, auth, body: req.body, payload, domainFields: BADGE_FIELDS, label: 'badge update' })
    }
    if (action === 'update_notes') {
      if (!isOwnerAdmin) return res.status(403).json({ error: 'forbidden' })
      return handleDomainUpdate({ res, db, requestId, auth, body: req.body, payload, domainFields: NOTES_FIELDS, label: 'notes update' })
    }

    // WS1e-A4: administrative status override (Owner/Admin), recognized enum only.
    if (action === 'update_student_status') {
      if (!isOwnerAdmin) return res.status(403).json({ error: 'forbidden' })
      const ALLOWED = ['action', 'student_id', 'status', 'decline_reason']
      const unexpected = Object.keys(req.body || {}).filter(k => !ALLOWED.includes(k))
      if (unexpected.length > 0) return res.status(400).json({ error: 'invalid_request', field: unexpected[0], message: 'Unexpected field.' })
      const { student_id, status, decline_reason } = payload
      if (!student_id || typeof student_id !== 'string') return res.status(400).json({ error: 'invalid_request', field: 'student_id' })
      if (typeof status !== 'string' || !ASPIRE_STATUSES.includes(status)) return res.status(400).json({ error: 'invalid_request', field: 'status' })
      if (decline_reason !== undefined && (typeof decline_reason !== 'string' || decline_reason.length > 2000)) {
        return res.status(400).json({ error: 'invalid_request', field: 'decline_reason' })
      }
      // WS1e-A4: decline_reason is only meaningful for 'Declined' — reject it with any
      // other status. (Existing reasons on a non-Declined transition are left as-is.)
      if (decline_reason !== undefined && status !== 'Declined') {
        return res.status(400).json({ error: 'invalid_request', field: 'decline_reason', message: 'decline_reason is only valid with status Declined.' })
      }
      const { data: stu, error: stuErr } = await db.from('students')
        .select('id, cohort_id, status, decline_reason').eq('id', student_id).maybeSingle()
      if (stuErr) return res.status(500).json({ error: 'internal_error' })
      if (!stu) return res.status(404).json({ error: 'not_found' })
      const declineChanges = decline_reason !== undefined && (stu.decline_reason ?? '') !== decline_reason
      if (stu.status === status && !declineChanges) return res.status(200).json({ success: true, no_change: true })
      const upd = { status }
      if (decline_reason !== undefined) upd.decline_reason = decline_reason
      const { error: updErr } = await db.from('students').update(upd).eq('id', student_id)
      if (updErr) {
        console.log('[student-update] status update failed', { request_id: requestId, errorCode: updErr.code })
        return res.status(500).json({ error: 'internal_error' })
      }
      console.log('[student-update] status updated', { request_id: requestId, callerRole: auth.role, studentId: student_id, cohortId: stu.cohort_id ?? null, status })
      return res.status(200).json({ success: true })
    }


    // WS1e-A1: the actions below have NO active UI caller today. Authenticated +
    // Owner/Admin only (Interviewer/others denied). Contracts unchanged otherwise.
    if (action === 'update_status') {
      if (!isOwnerAdmin) return res.status(403).json({ error: 'forbidden' })
      const { student_id, status, decline_reason } = payload
      if (!student_id || !status) return res.status(400).json({ error: 'student_id and status are required' })
      const updateFields = { status }
      if (decline_reason !== undefined) updateFields.decline_reason = decline_reason
      const { data, error } = await db.from('students').update(updateFields).eq('id', student_id).select().single()
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true, data })
    }

    if (action === 'log_communication') {
      if (!isOwnerAdmin) return res.status(403).json({ error: 'forbidden' })
      const { student_id, cohort_id: cid, type, notes, sent_by } = payload
      if (!student_id || !type) return res.status(400).json({ error: 'student_id and type are required' })
      const { error } = await db.from('communications').insert({
        student_id, cohort_id: cid || null, type,
        notes: notes || '',
        sent_at: new Date().toISOString(),
        sent_by: sent_by || 'Coordinator',
      })
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    if (action === 'log_event') {
      if (!isOwnerAdmin) return res.status(403).json({ error: 'forbidden' })
      const { student_id, cohort_id, event_type, notes, created_by } = payload
      if (!student_id || !event_type) return res.status(400).json({ error: 'student_id and event_type are required' })
      const { error } = await db.from('program_events').insert({
        student_id, cohort_id: cohort_id || null, event_type,
        event_date: toLocalDateStr(),
        notes: notes || '', created_by: created_by || 'System',
      })
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: 'invalid_request', message: 'Unknown action.' })

  } catch (err) {
    console.error('student-update error:', err)
    return res.status(500).json({ error: err.message })
  }
}
