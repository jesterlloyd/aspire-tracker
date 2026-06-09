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

// WS1e-A1: temporary NARROW Interviewer allow-list — exactly the fields the
// RubricSession workflow submits to the student record. Interviewers may set
// NOTHING else through the generic `update` action. (Owner/Admin retain the
// broad legacy surface temporarily; A2–A5 migrate/remove it.)
const INTERVIEWER_RUBRIC_FIELDS = [
  'unit_preference_1', 'unit_preference_2', 'unit_preference_3',
  'avg_cj_score', 'avg_pp_score', 'avg_ga_score', 'avg_composite_score', 'rubric_count',
  'auto_recommendation', 'score_flag', 'score_flag_message', 'interview_outcome',
  'status', 'flagged_for_second_interview', 'flag_note',
]
const RUBRIC_AUTO_REC = ['Recommend', 'Recommend with Reservations', 'Do Not Recommend at This Time']
const RUBRIC_OUTCOME  = ['Recommend', 'Recommend with Reservations', 'Do Not Recommend']
const RUBRIC_STATUS   = ['Interviewed'] // the only status the rubric workflow assigns
function validateInterviewerField(k, v) {
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

      // ── Interviewer: narrow rubric-only path (exact allow-list, no fallback) ──
      if (isInterviewer && !isOwnerAdmin) {
        const keys = Object.keys(fields)
        const unexpected = keys.filter(k => !INTERVIEWER_RUBRIC_FIELDS.includes(k))
        if (unexpected.length > 0) {
          console.log('[student-update] interviewer non-rubric field denied', { request_id: requestId, denied: unexpected.length })
          return res.status(403).json({ error: 'forbidden', message: 'Interviewers may only update interview rubric fields.' })
        }
        for (const k of keys) {
          if (!validateInterviewerField(k, fields[k])) {
            return res.status(400).json({ error: 'invalid_request', field: k, message: 'Invalid value for this field.' })
          }
        }
        const { data: stu, error: stuErr } = await db.from('students').select('id').eq('id', student_id).maybeSingle()
        if (stuErr) return res.status(500).json({ error: 'internal_error' })
        if (!stu) return res.status(404).json({ error: 'not_found' })
        const { error: updErr } = await db.from('students').update(fields).eq('id', student_id)
        if (updErr) {
          console.log('[student-update] interviewer update failed', { request_id: requestId, errorCode: updErr.code })
          return res.status(500).json({ error: 'internal_error' })
        }
        console.log('[student-update] interviewer rubric update', { request_id: requestId, callerRole: auth.role, studentId: student_id, fields: keys })
        return res.status(200).json({ success: true })
      }

      // ── Owner/Admin only beyond here (temporary broad legacy surface; A2–A5) ──
      if (!isOwnerAdmin) {
        return res.status(403).json({ error: 'forbidden', message: 'You do not have permission to update students.' })
      }

      const allowed = [
        'first_name', 'last_name', 'name', 'email', 'school_email', 'personal_email',
        'phone', 'school', 'program', 'program_type', 'cohort_id',
        'cumulative_gpa', 'gpa', 'expected_graduation', 'graduation_date', 'graduation_semester',
        'status', 'decline_reason',
        'unit_preference_1', 'unit_preference_2', 'unit_preference_3',
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
        'preceptor_name', 'matched_preceptor', 'preceptor_assigned', 'assigned_preceptor',
        'shift', 'shift_type', 'shift_assigned', 'assigned_shift', 'clinical_shift', 'shift_preference',
        'match_notes', 'placement_notes', 'unit_notes', 'preceptor_notes',
        'interview_scheduled_date', 'interview_scheduled_time',
        'interview_duration_minutes', 'interview_assigned_interviewers',
        'flagged_for_second_interview', 'auto_recommendation',
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

    return res.status(400).json({ error: `Unknown action: ${action}` })

  } catch (err) {
    console.error('student-update error:', err)
    return res.status(500).json({ error: err.message })
  }
}
