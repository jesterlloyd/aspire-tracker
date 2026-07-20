// api/portal/unit-preceptor-nominations.js
//
// UL-PORTAL: preceptor nominations.
//
// GET   nominations and the current confirmed preceptor for scoped students
// POST  nominate a preceptor for a scoped student
//
// A NOMINATION IS NOT AN ASSIGNMENT. public.student_preceptor_assignments remains
// the authoritative assignment record and is staff written; this endpoint never
// touches it. A Unit Leader proposes, ASPIRE confirms, and only the ASPIRE
// confirmation writes the assignment and links it back through
// resulting_assignment_id. That separation is why the nomination lives in its own
// table rather than as a status on the assignment.

import {
  verifyPortalUnitLeaderCaller,
  narrowScopes,
  resolveUnitScopedStudents,
} from '../lib/unitLeaderScope.js'
import { emitUnitLeaderAudit } from '../lib/unitLeaderAudit.js'

const MAX_NOTE = 2000
const MAX_NAME = 120
const LIST_LIMIT = 300

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
  if (scopes.length === 0) return res.status(200).json({ nominations: [] })

  return req.method === 'GET'
    ? listNominations(req, res, { db, scopes })
    : createNomination(req, res, { db, profile, scopes })
}

async function listNominations(req, res, { db, scopes }) {
  const requestedUnit = typeof req.query?.unit_key === 'string' ? req.query.unit_key : null
  const effective = narrowScopes(scopes, requestedUnit)
  if (effective === null) return res.status(403).json({ error: 'unit_not_in_scope' })

  const keys = [...new Set(effective.map(s => s.unit_key))]
  if (keys.length === 0) return res.status(200).json({ nominations: [] })

  const { data, error } = await db
    .from('unit_preceptor_nominations')
    .select('id, student_id, cohort_id, unit_key, preceptor_id, proposed_name, note, ' +
            'status, nominated_at, decided_at, decision_note, resulting_assignment_id, ' +
            'preceptors ( full_name )')
    .in('unit_key', keys)
    .order('nominated_at', { ascending: false })
    .limit(LIST_LIMIT)
  if (error) return res.status(500).json({ error: 'internal_error' })

  const inScope = (data || []).filter(r =>
    effective.some(s => s.unit_key === r.unit_key && (s.cohort_id === null || s.cohort_id === r.cohort_id)))

  return res.status(200).json({ nominations: inScope.map(shapeNomination) })
}

async function createNomination(req, res, { db, profile, scopes }) {
  const body = req.body && typeof req.body === 'object' ? req.body : {}

  const allowed = new Set(['student_id', 'preceptor_id', 'proposed_name', 'note'])
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) return res.status(400).json({ error: 'unexpected_field', field: k })
  }

  const studentId = body.student_id
  const preceptorId = body.preceptor_id ?? null
  const proposedName = typeof body.proposed_name === 'string' ? body.proposed_name.trim() : ''
  const note = typeof body.note === 'string' ? body.note.trim() : ''

  if (!isUuid(studentId)) return res.status(400).json({ error: 'invalid_student_id' })
  if (preceptorId !== null && !isUuid(preceptorId)) {
    return res.status(400).json({ error: 'invalid_preceptor_id' })
  }
  // chk_upn_identifies_someone: one of the two must identify a person.
  if (preceptorId === null && (proposedName.length < 2 || proposedName.length > MAX_NAME)) {
    return res.status(400).json({ error: 'preceptor_id_or_proposed_name_required' })
  }
  if (note.length > MAX_NOTE) return res.status(400).json({ error: 'note_too_long' })

  const { students } = await resolveUnitScopedStudents(db, scopes).catch(() => ({ students: null }))
  if (students === null) return res.status(500).json({ error: 'internal_error' })

  const student = students.find(s => s.id === studentId)
  if (!student) return res.status(404).json({ error: 'not_found' })

  // A named preceptor must belong to the same unit. Resolved server side, so a
  // client cannot nominate someone from another unit by id.
  if (preceptorId) {
    const { data: prec, error: pErr } = await db
      .from('preceptors')
      .select('id, unit_name, is_active')
      .eq('id', preceptorId)
      .maybeSingle()
    if (pErr) return res.status(500).json({ error: 'internal_error' })
    if (!prec) return res.status(404).json({ error: 'not_found' })
    if (prec.unit_name !== student.unit_key) {
      return res.status(403).json({ error: 'preceptor_not_in_unit' })
    }
    if (prec.is_active === false) return res.status(409).json({ error: 'preceptor_inactive' })
  }

  const { data: created, error: insErr } = await db
    .from('unit_preceptor_nominations')
    .insert({
      student_id: studentId,
      cohort_id: student.cohort_id,
      unit_key: student.unit_key,
      preceptor_id: preceptorId,
      proposed_name: proposedName || null,
      note: note || null,
      nominated_by_profile_id: profile.id,
    })
    .select('id, student_id, cohort_id, unit_key, preceptor_id, proposed_name, note, ' +
            'status, nominated_at, decided_at, decision_note, resulting_assignment_id')
    .maybeSingle()

  if (insErr) {
    // uq_upn_one_open_per_student_unit: one open nomination per student per unit.
    if (insErr.code === '23505') return res.status(409).json({ error: 'nomination_already_open' })
    return res.status(500).json({ error: 'internal_error' })
  }

  await emitUnitLeaderAudit(db, profile, {
    action: 'unit_preceptor_nominated',
    entityType: 'unit_preceptor_nomination',
    entityId: created.id,
    unitKey: student.unit_key,
    cohortId: student.cohort_id,
    toValue: 'nominated',
    comment: note || null,
    aspireStatus: created.status,
    description: `${profile.full_name || 'A Unit Leader'} nominated a preceptor ` +
      `for a student in ${student.unit_key}, pending ASPIRE confirmation`,
  })

  return res.status(201).json({ nomination: shapeNomination(created) })
}

function shapeNomination(r) {
  return {
    id: r.id,
    student_id: r.student_id,
    cohort_id: r.cohort_id,
    unit_key: r.unit_key,
    preceptor_id: r.preceptor_id ?? null,
    preceptor_name: r.preceptors?.full_name ?? r.proposed_name ?? null,
    note: r.note ?? null,
    // ASPIRE confirmation is authoritative and is never set here.
    status: r.status,
    awaiting_aspire_confirmation: r.status === 'nominated',
    nominated_at: r.nominated_at,
    decided_at: r.decided_at ?? null,
    decision_note: r.decision_note ?? null,
    resulting_assignment_id: r.resulting_assignment_id ?? null,
  }
}
