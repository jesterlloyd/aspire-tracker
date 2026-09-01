/* global process */
// Signed-in Student Portal rotation activity and planned shifts.
//
// Actual activity remains authoritative in student_shift_logs. This endpoint
// owns only the student's planning overlay and the read-only school blackout
// dates supplied by the clinical placement coordinator. The browser never
// receives another student's plan or an unrestricted rotation row.

import {
  verifyPortalCaller,
  getServiceDb,
  hasActiveRoleGrant,
  getActiveStudentLinks,
} from '../lib/portalAuth.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
const ACTIONS = new Set(['create', 'update', 'cancel'])
const ALLOWED_KEYS = new Set(['action', 'plan_id', 'student_id', 'shift_date', 'preceptor_name'])

function validYmd(value) {
  if (!YMD_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(y, m - 1, d))
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d
}

function migrationMissing(error) {
  return ['42P01', 'PGRST205'].includes(error?.code)
}

async function resolveCaller(req, res, db) {
  const auth = await verifyPortalCaller(req)
  if (!auth.authenticated) {
    res.status(auth.status).json({ error: auth.reason })
    return null
  }
  if (!(await hasActiveRoleGrant(db, auth.profile.id, 'student'))) {
    res.status(403).json({ error: 'forbidden' })
    return null
  }
  const studentIds = await getActiveStudentLinks(db, auth.profile.id)
  if (studentIds.length === 0) {
    res.status(403).json({ error: 'forbidden' })
    return null
  }
  return { profileId: auth.profile.id, studentIds }
}

async function loadContext(db, studentIds) {
  const { data: students, error: studentError } = await db
    .from('students')
    .select('id, cohort_id, cohort_school_rotation_id')
    .in('id', studentIds)
  if (studentError) throw new Error('student_context_failed')

  const rotationIds = [...new Set((students || []).map(row => row.cohort_school_rotation_id).filter(Boolean))]
  let rotationsById = {}
  if (rotationIds.length > 0) {
    const { data: rotations, error: rotationError } = await db
      .from('cohort_school_rotations')
      .select('id, rotation_start_date, rotation_end_date, blackout_dates')
      .in('id', rotationIds)
    if (rotationError) throw new Error('rotation_context_failed')
    rotationsById = Object.fromEntries((rotations || []).map(row => [row.id, row]))
  }

  const { data: assignments, error: assignmentError } = await db
    .from('student_preceptor_assignments')
    .select('student_id, role, start_date, preceptors ( full_name )')
    .in('student_id', studentIds)
    .eq('status', 'active')
  const preceptors = {}
  if (!assignmentError) {
    for (const assignment of assignments || []) {
      const name = String(assignment.preceptors?.full_name || '').trim()
      if (!name) continue
      const list = (preceptors[assignment.student_id] ||= [])
      if (!list.includes(name)) list.push(name)
    }
  }

  return {
    rotations: Object.fromEntries((students || []).map(student => {
      const row = rotationsById[student.cohort_school_rotation_id] || null
      return [student.id, {
        start_date: row?.rotation_start_date || null,
        end_date: row?.rotation_end_date || null,
        blackout_dates: Array.isArray(row?.blackout_dates) ? row.blackout_dates : [],
      }]
    })),
    preceptors,
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) {
    return res.status(500).json({ error: 'internal_error' })
  }

  const db = getServiceDb()
  const caller = await resolveCaller(req, res, db)
  if (!caller) return

  try {
    if (req.method === 'GET') {
      const [{ data: plans, error: planError }, context] = await Promise.all([
        db.from('student_shift_plans')
          .select('id, student_id, cohort_id, shift_date, preceptor_name, created_at, updated_at')
          .in('student_id', caller.studentIds)
          .is('cancelled_at', null)
          .order('shift_date', { ascending: true }),
        loadContext(db, caller.studentIds),
      ])
      if (planError) {
        if (migrationMissing(planError)) return res.status(503).json({ error: 'migration_required' })
        return res.status(500).json({ error: 'internal_error' })
      }
      return res.status(200).json({ plans: plans || [], ...context })
    }

    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
    if (Object.keys(body).some(key => !ALLOWED_KEYS.has(key))) {
      return res.status(400).json({ error: 'invalid_request' })
    }
    const action = String(body.action || '')
    if (!ACTIONS.has(action)) return res.status(400).json({ error: 'invalid_request' })

    let plan = null
    if (action === 'create') {
      const studentId = String(body.student_id || '')
      if (!UUID_RE.test(studentId) || !caller.studentIds.includes(studentId)) {
        return res.status(404).json({ error: 'not_found' })
      }
      const { data: student, error } = await db.from('students')
        .select('id, cohort_id').eq('id', studentId).maybeSingle()
      if (error || !student) return res.status(404).json({ error: 'not_found' })
      plan = { student_id: student.id, cohort_id: student.cohort_id }
    } else {
      const planId = String(body.plan_id || '')
      if (!UUID_RE.test(planId)) return res.status(400).json({ error: 'invalid_request' })
      const { data, error } = await db.from('student_shift_plans')
        .select('id, student_id, cohort_id, shift_date, preceptor_name, updated_at')
        .eq('id', planId).is('cancelled_at', null).maybeSingle()
      if (error) {
        if (migrationMissing(error)) return res.status(503).json({ error: 'migration_required' })
        return res.status(500).json({ error: 'internal_error' })
      }
      if (!data || !caller.studentIds.includes(data.student_id)) {
        return res.status(404).json({ error: 'not_found' })
      }
      plan = data
    }

    if (action === 'cancel') {
      const { data, error } = await db.from('student_shift_plans')
        .update({ cancelled_at: new Date().toISOString(), cancelled_by_profile_id: caller.profileId })
        .eq('id', plan.id).is('cancelled_at', null)
        .select('id').maybeSingle()
      if (error || !data) return res.status(409).json({ error: 'conflict' })
      return res.status(200).json({ plan_id: plan.id, cancelled: true })
    }

    const shiftDate = String(body.shift_date || '')
    const preceptorName = String(body.preceptor_name || '').trim()
    if (!validYmd(shiftDate) || !preceptorName || preceptorName.length > 200) {
      return res.status(400).json({ error: 'invalid_field' })
    }

    // Planning never creates a second representation for a date that already
    // has actual activity. The actual shift remains the only clinical record.
    const { data: actual, error: actualError } = await db.from('student_shift_logs')
      .select('id').eq('student_id', plan.student_id).eq('shift_date', shiftDate)
      .neq('lifecycle_state', 'voided').limit(1)
    if (actualError) return res.status(500).json({ error: 'internal_error' })
    if ((actual || []).length > 0) return res.status(409).json({ error: 'actual_shift_exists' })

    if (action === 'create') {
      const { data, error } = await db.from('student_shift_plans').insert({
        student_id: plan.student_id,
        cohort_id: plan.cohort_id,
        shift_date: shiftDate,
        preceptor_name: preceptorName,
        created_by_profile_id: caller.profileId,
      }).select('id, student_id, cohort_id, shift_date, preceptor_name, created_at, updated_at').single()
      if (error) {
        if (migrationMissing(error)) return res.status(503).json({ error: 'migration_required' })
        if (error.code === '23505') return res.status(409).json({ error: 'date_already_planned' })
        return res.status(500).json({ error: 'internal_error' })
      }
      return res.status(201).json({ plan: data })
    }

    const { data, error } = await db.from('student_shift_plans').update({
      shift_date: shiftDate,
      preceptor_name: preceptorName,
      updated_at: new Date().toISOString(),
    }).eq('id', plan.id).is('cancelled_at', null)
      .select('id, student_id, cohort_id, shift_date, preceptor_name, created_at, updated_at').maybeSingle()
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'date_already_planned' })
      return res.status(500).json({ error: 'internal_error' })
    }
    if (!data) return res.status(409).json({ error: 'conflict' })
    return res.status(200).json({ plan: data })
  } catch (error) {
    console.error('[my-rotation-activity] unexpected error', { message: error?.message })
    return res.status(500).json({ error: 'internal_error' })
  }
}
