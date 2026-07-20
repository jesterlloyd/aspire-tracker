// api/portal/unit-capacity.js
//
// UL-PORTAL: unit capacity submission and history.
//
// GET   live and superseded submissions for the caller's assigned units
// POST  create a submission, or correct a pending one
//
// SUPERSEDE, NEVER OVERWRITE. A correction inserts a NEW row pointing at the one it
// replaces and stamps superseded_at on the old row, so the history is complete and
// nothing is lost. That is the whole reason this table exists rather than reusing
// unit_cohort_responses, which is UNIQUE(cohort_id, unit_id) and overwrites in place.
//
// The legacy public unit form path (unit_cohort_responses, api/unit-form-submit.js)
// is deliberately untouched by this endpoint.
//
// ASPIRE review is authoritative: review_status is never set here. A Unit Leader can
// only correct a submission that is still 'submitted'.

import { verifyPortalUnitLeaderCaller, narrowScopes } from '../lib/unitLeaderScope.js'
import { emitUnitLeaderAudit } from '../lib/unitLeaderAudit.js'

const SHIFTS = new Set(['any', 'day', 'evening', 'night', 'weekend'])
const MAX_NOTES = 2000
const MAX_PERIOD_LABEL = 120
const MAX_STUDENTS = 99
const LIST_LIMIT = 300

const isUuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

const isDateOnly = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const auth = await verifyPortalUnitLeaderCaller(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })

  const { db, profile, scopes, unitKeys } = auth
  if (scopes.length === 0) return res.status(200).json({ submissions: [] })

  return req.method === 'GET'
    ? listSubmissions(req, res, { db, scopes, unitKeys })
    : createSubmission(req, res, { db, profile, scopes })
}

async function listSubmissions(req, res, { db, scopes, unitKeys }) {
  const requestedUnit = typeof req.query?.unit_key === 'string' ? req.query.unit_key : null
  const effective = narrowScopes(scopes, requestedUnit)
  if (effective === null) return res.status(403).json({ error: 'unit_not_in_scope' })

  const keys = [...new Set(effective.map(s => s.unit_key))]
  if (keys.length === 0) return res.status(200).json({ submissions: [] })

  const { data, error } = await db
    .from('unit_capacity_submissions')
    .select('id, unit_key, cohort_id, period_label, period_start_date, period_end_date, ' +
            'shift, student_count, notes, review_status, review_note, reviewed_at, ' +
            'supersedes_id, superseded_at, submitted_at')
    .in('unit_key', keys)
    .order('submitted_at', { ascending: false })
    .limit(LIST_LIMIT)
  if (error) return res.status(500).json({ error: 'internal_error' })

  const inScope = (data || []).filter(r =>
    effective.some(s => s.unit_key === r.unit_key && (s.cohort_id === null || s.cohort_id === r.cohort_id)))

  return res.status(200).json({
    submissions: inScope.map(shapeSubmission),
    unit_keys: unitKeys,
  })
}

async function createSubmission(req, res, { db, profile, scopes }) {
  const body = req.body && typeof req.body === 'object' ? req.body : {}

  const allowed = new Set([
    'unit_key', 'cohort_id', 'period_label', 'period_start_date', 'period_end_date',
    'shift', 'student_count', 'notes', 'supersedes_id',
  ])
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) return res.status(400).json({ error: 'unexpected_field', field: k })
  }

  const unitKey = typeof body.unit_key === 'string' ? body.unit_key.trim() : ''
  const cohortId = body.cohort_id
  const periodLabel = typeof body.period_label === 'string' ? body.period_label.trim() : ''
  const shift = typeof body.shift === 'string' ? body.shift : 'any'
  const studentCount = Number.isInteger(body.student_count) ? body.student_count : null
  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
  const startDate = body.period_start_date ?? null
  const endDate = body.period_end_date ?? null
  const supersedesId = body.supersedes_id ?? null

  if (!unitKey) return res.status(400).json({ error: 'unit_key_required' })
  if (!isUuid(cohortId)) return res.status(400).json({ error: 'invalid_cohort_id' })
  if (!periodLabel || periodLabel.length > MAX_PERIOD_LABEL) {
    return res.status(400).json({ error: 'invalid_period_label' })
  }
  if (!SHIFTS.has(shift)) return res.status(400).json({ error: 'invalid_shift' })
  if (studentCount === null || studentCount < 0 || studentCount > MAX_STUDENTS) {
    return res.status(400).json({ error: 'invalid_student_count' })
  }
  if (notes.length > MAX_NOTES) return res.status(400).json({ error: 'notes_too_long' })
  if (startDate !== null && !isDateOnly(startDate)) return res.status(400).json({ error: 'invalid_period_start_date' })
  if (endDate !== null && !isDateOnly(endDate)) return res.status(400).json({ error: 'invalid_period_end_date' })
  if (startDate && endDate && endDate < startDate) return res.status(400).json({ error: 'period_end_before_start' })
  if (supersedesId !== null && !isUuid(supersedesId)) return res.status(400).json({ error: 'invalid_supersedes_id' })

  // The declared unit AND cohort must both be inside an active scope.
  const covered = scopes.some(s =>
    s.unit_key === unitKey && (s.cohort_id === null || s.cohort_id === cohortId))
  if (!covered) return res.status(403).json({ error: 'unit_not_in_scope' })

  // A correction may only supersede a submission that is still awaiting review, in
  // the same unit, and not already superseded.
  let prior = null
  if (supersedesId) {
    const { data: p, error: pErr } = await db
      .from('unit_capacity_submissions')
      .select('id, unit_key, cohort_id, review_status, superseded_at, student_count')
      .eq('id', supersedesId)
      .maybeSingle()
    if (pErr) return res.status(500).json({ error: 'internal_error' })
    if (!p) return res.status(404).json({ error: 'not_found' })
    if (p.unit_key !== unitKey || p.cohort_id !== cohortId) {
      return res.status(403).json({ error: 'supersedes_out_of_scope' })
    }
    if (p.superseded_at) return res.status(409).json({ error: 'already_superseded' })
    if (p.review_status !== 'submitted') {
      return res.status(409).json({ error: 'already_reviewed', review_status: p.review_status })
    }
    prior = p
  }

  const now = new Date().toISOString()
  const { data: created, error: insErr } = await db
    .from('unit_capacity_submissions')
    .insert({
      unit_key: unitKey,
      cohort_id: cohortId,
      period_label: periodLabel,
      period_start_date: startDate,
      period_end_date: endDate,
      shift,
      student_count: studentCount,
      notes: notes || null,
      supersedes_id: supersedesId,
      submitted_by_profile_id: profile.id,
      submitted_at: now,
    })
    .select('id, unit_key, cohort_id, period_label, period_start_date, period_end_date, ' +
            'shift, student_count, notes, review_status, review_note, reviewed_at, ' +
            'supersedes_id, superseded_at, submitted_at')
    .maybeSingle()

  if (insErr) {
    // uq_ucs_live: one live submission per unit, cohort, period, and shift.
    if (insErr.code === '23505') {
      return res.status(409).json({ error: 'duplicate_live_submission' })
    }
    return res.status(500).json({ error: 'internal_error' })
  }

  // Mark the prior row superseded only AFTER the replacement exists, so a failure
  // never leaves the unit with no live submission.
  if (prior) {
    const { error: supErr } = await db
      .from('unit_capacity_submissions')
      .update({ superseded_at: now })
      .eq('id', prior.id)
      .is('superseded_at', null)
    if (supErr) {
      // Compensate: the replacement would otherwise collide with the live unique
      // index on the next attempt and the history would be ambiguous.
      await db.from('unit_capacity_submissions').delete().eq('id', created.id)
      return res.status(500).json({ error: 'internal_error' })
    }
  }

  await emitUnitLeaderAudit(db, profile, {
    action: prior ? 'unit_capacity_corrected' : 'unit_capacity_submitted',
    entityType: 'unit_capacity_submission',
    entityId: created.id,
    unitKey,
    cohortId,
    fromValue: prior ? String(prior.student_count) : null,
    toValue: String(studentCount),
    comment: notes || null,
    aspireStatus: created.review_status,
    description: `${profile.full_name || 'A Unit Leader'} submitted capacity of ` +
      `${studentCount} for ${unitKey} (${periodLabel}, ${shift})`,
  })

  return res.status(201).json({ submission: shapeSubmission(created) })
}

function shapeSubmission(r) {
  return {
    id: r.id,
    unit_key: r.unit_key,
    cohort_id: r.cohort_id,
    period_label: r.period_label,
    period_start_date: r.period_start_date ?? null,
    period_end_date: r.period_end_date ?? null,
    shift: r.shift,
    student_count: r.student_count,
    notes: r.notes ?? null,
    // ASPIRE review is authoritative and is never set by a Unit Leader.
    review_status: r.review_status,
    review_note: r.review_note ?? null,
    reviewed_at: r.reviewed_at ?? null,
    awaiting_aspire_review: r.review_status === 'submitted',
    supersedes_id: r.supersedes_id ?? null,
    superseded_at: r.superseded_at ?? null,
    is_live: r.superseded_at === null,
    submitted_at: r.submitted_at,
  }
}
