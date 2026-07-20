// api/portal/unit-milestones.js
//
// UL-PORTAL: operational milestone confirmations.
//
// GET   live milestones for the caller's assigned units
// POST  confirm a milestone for a scoped student
//
// Every confirmation is timestamped, attributed to the acting Unit Leader, and
// auditable. Nothing is ever hard deleted: an Owner/Admin correction stamps
// corrected_at and corrected_by on the row, which releases the partial unique index
// so a replacement can be recorded. Unit Leaders cannot correct; that is staff only.
//
// Confirming 'rotation_conclusion' also stamps students.rotation_completed_at, which
// is what starts the 90-day completed-visibility window. That is the ONLY writer of
// that column: the migration deliberately never backfilled it, because no existing
// column recorded an actual conclusion.

import {
  verifyPortalUnitLeaderCaller,
  narrowScopes,
  resolveUnitScopedStudents,
} from '../lib/unitLeaderScope.js'
import { emitUnitLeaderAudit } from '../lib/unitLeaderAudit.js'

const MILESTONES = new Set([
  'arrival', 'unit_orientation', 'preceptor_confirmation', 'rotation_conclusion',
])
const MAX_COMMENT = 2000
const LIST_LIMIT = 500

const isUuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const auth = await verifyPortalUnitLeaderCaller(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })

  const { db, profile, scopes } = auth
  if (scopes.length === 0) return res.status(200).json({ milestones: [] })

  return req.method === 'GET'
    ? listMilestones(req, res, { db, scopes })
    : confirmMilestone(req, res, { db, profile, scopes })
}

async function listMilestones(req, res, { db, scopes }) {
  const requestedUnit = typeof req.query?.unit_key === 'string' ? req.query.unit_key : null
  const effective = narrowScopes(scopes, requestedUnit)
  if (effective === null) return res.status(403).json({ error: 'unit_not_in_scope' })

  const keys = [...new Set(effective.map(s => s.unit_key))]
  if (keys.length === 0) return res.status(200).json({ milestones: [] })

  const { data, error } = await db
    .from('unit_student_milestones')
    .select('id, student_id, cohort_id, unit_key, milestone, confirmed, confirmed_at, ' +
            'comment, corrected_at, correction_note')
    .in('unit_key', keys)
    .is('corrected_at', null)
    .order('confirmed_at', { ascending: false })
    .limit(LIST_LIMIT)
  if (error) return res.status(500).json({ error: 'internal_error' })

  const inScope = (data || []).filter(r =>
    effective.some(s => s.unit_key === r.unit_key && (s.cohort_id === null || s.cohort_id === r.cohort_id)))

  return res.status(200).json({ milestones: inScope.map(shapeMilestone) })
}

async function confirmMilestone(req, res, { db, profile, scopes }) {
  const body = req.body && typeof req.body === 'object' ? req.body : {}

  const allowed = new Set(['student_id', 'milestone', 'comment'])
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) return res.status(400).json({ error: 'unexpected_field', field: k })
  }

  const studentId = body.student_id
  const milestone = typeof body.milestone === 'string' ? body.milestone : ''
  const comment = typeof body.comment === 'string' ? body.comment.trim() : ''

  if (!isUuid(studentId)) return res.status(400).json({ error: 'invalid_student_id' })
  if (!MILESTONES.has(milestone)) return res.status(400).json({ error: 'invalid_milestone' })
  if (comment.length > MAX_COMMENT) return res.status(400).json({ error: 'comment_too_long' })

  // Authorize the student through the single source of truth. The unit is derived
  // from the student's placement, never from the request.
  const { students } = await resolveUnitScopedStudents(db, scopes).catch(() => ({ students: null }))
  if (students === null) return res.status(500).json({ error: 'internal_error' })

  const student = students.find(s => s.id === studentId)
  // Out of scope and nonexistent are indistinguishable.
  if (!student) return res.status(404).json({ error: 'not_found' })

  const now = new Date().toISOString()
  const { data: created, error: insErr } = await db
    .from('unit_student_milestones')
    .insert({
      student_id: studentId,
      cohort_id: student.cohort_id,
      unit_key: student.unit_key,
      milestone,
      confirmed: true,
      confirmed_by_profile_id: profile.id,
      confirmed_at: now,
      comment: comment || null,
    })
    .select('id, student_id, cohort_id, unit_key, milestone, confirmed, confirmed_at, ' +
            'comment, corrected_at, correction_note')
    .maybeSingle()

  if (insErr) {
    // uq_usm_live: one live row per student, unit, and milestone.
    if (insErr.code === '23505') return res.status(409).json({ error: 'already_confirmed' })
    return res.status(500).json({ error: 'internal_error' })
  }

  // Concluding the rotation starts the 90-day completed-visibility clock.
  if (milestone === 'rotation_conclusion') {
    const { error: stuErr } = await db
      .from('students')
      .update({ rotation_completed_at: now })
      .eq('id', studentId)
      // Only stamp the first conclusion; never move an existing one.
      .is('rotation_completed_at', null)
    if (stuErr) {
      console.warn('[unit-milestones] rotation_completed_at stamp failed', stuErr.message)
    }
  }

  await emitUnitLeaderAudit(db, profile, {
    action: 'unit_milestone_confirmed',
    entityType: 'unit_student_milestone',
    entityId: created.id,
    unitKey: student.unit_key,
    cohortId: student.cohort_id,
    toValue: milestone,
    comment: comment || null,
    description: `${profile.full_name || 'A Unit Leader'} confirmed ${milestone} ` +
      `for a student in ${student.unit_key}`,
  })

  return res.status(201).json({ milestone: shapeMilestone(created) })
}

function shapeMilestone(r) {
  return {
    id: r.id,
    student_id: r.student_id,
    cohort_id: r.cohort_id,
    unit_key: r.unit_key,
    milestone: r.milestone,
    confirmed: r.confirmed,
    confirmed_at: r.confirmed_at,
    comment: r.comment ?? null,
    corrected_at: r.corrected_at ?? null,
    correction_note: r.correction_note ?? null,
  }
}
