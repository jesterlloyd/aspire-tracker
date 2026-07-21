// api/unit-leader-decisions.js
//
// ASPIRE STAFF: decide the three Unit Leader workflows.
//
//   placement    confirm / withdraw / reassign a placement request
//   capacity     accept / adjust / decline / mark under review a submission
//   nomination   confirm / decline / withdraw a preceptor nomination
//
// This is the ASPIRE side of the authority split the Unit Leader endpoints were
// built around. Without it those workflows are actionable only by editing the
// database directly, which is not an acceptable operating position.
//
// It is deliberately a STAFF endpoint, not a portal one:
//   - it uses verifyStaffCaller, which requires an ACTIVE owner or admin, and is
//     the same helper the Messages staff endpoints use. is_staff() is never used,
//     because it also returns true for interviewer and viewer.
//   - it lives in api/, not api/portal/, so it is not reachable from the portal
//     surface at all.
//
// UNIT LEADER PERMISSIONS ARE NOT WIDENED. Nothing here grants a Unit Leader any
// new ability; it only lets ASPIRE respond to what they submitted.
//
// AUDIT: every placement decision appends to unit_placement_request_events, which
// is the append-only audit of record for that workflow. Capacity and nomination
// carry their attribution on the row itself, as designed.

import { verifyStaffCaller, getServiceDb } from './lib/messagesAuth.js'
import { emitUnitLeaderAlert } from '../lib/server/notifications/unitLeaderAlerts.js'

const PLACEMENT_DECISIONS = new Set(['confirmed', 'withdrawn', 'reassigned'])
const CAPACITY_DECISIONS = new Set(['under_review', 'accepted', 'adjusted', 'declined'])
const NOMINATION_DECISIONS = new Set(['confirmed', 'declined', 'withdrawn'])
const MAX_NOTE = 2000

const isUuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  // ACTIVE owner or admin only. A deactivated staff account is refused.
  const caller = await verifyStaffCaller(req)
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason })

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const allowed = new Set(['kind', 'id', 'decision', 'note'])
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) return res.status(400).json({ error: 'unexpected_field', field: k })
  }

  const { kind, id, decision } = body
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if (!isUuid(id)) return res.status(400).json({ error: 'invalid_id' })
  if (note.length > MAX_NOTE) return res.status(400).json({ error: 'note_too_long' })

  const db = getServiceDb()
  const profile = caller.profile

  try {
    if (kind === 'placement') return await decidePlacement(res, { db, profile, id, decision, note })
    if (kind === 'capacity') return await decideCapacity(res, { db, profile, id, decision, note })
    if (kind === 'nomination') return await decideNomination(res, { db, profile, id, decision, note })
    return res.status(400).json({ error: 'invalid_kind' })
  } catch {
    return res.status(500).json({ error: 'internal_error' })
  }
}

async function decidePlacement(res, { db, profile, id, decision, note }) {
  if (!PLACEMENT_DECISIONS.has(decision)) return res.status(400).json({ error: 'invalid_decision' })

  const { data: row, error: loadErr } = await db
    .from('unit_placement_requests')
    .select('id, unit_key, cohort_id, aspire_status')
    .eq('id', id)
    .maybeSingle()
  if (loadErr) return res.status(500).json({ error: 'internal_error' })
  if (!row) return res.status(404).json({ error: 'not_found' })
  // A decision is final. Reopening is a deliberate future action, not an accident.
  if (row.aspire_status !== 'open') {
    return res.status(409).json({ error: 'already_decided', aspire_status: row.aspire_status })
  }

  const now = new Date().toISOString()
  const { data: updated, error: updErr } = await db
    .from('unit_placement_requests')
    .update({
      aspire_status: decision,
      aspire_note: note || null,
      aspire_decided_by_profile_id: profile.id,
      aspire_decided_at: now,
      updated_at: now,
    })
    .eq('id', id)
    // Guarded, so two staff deciding at once cannot both win.
    .eq('aspire_status', 'open')
    .select('id, unit_key, cohort_id, unit_response, aspire_status, aspire_note, aspire_decided_at')
    .maybeSingle()
  if (updErr) return res.status(500).json({ error: 'internal_error' })
  if (!updated) return res.status(409).json({ error: 'already_decided' })

  // Append-only audit of record for this workflow.
  const { error: evErr } = await db.from('unit_placement_request_events').insert({
    request_id: id,
    event_type: 'aspire_decision',
    actor_profile_id: profile.id,
    actor_role: 'staff',
    unit_key: row.unit_key,
    from_value: 'open',
    to_value: decision,
    comment: note || null,
    created_at: now,
  })
  if (evErr) return res.status(500).json({ error: 'internal_error' })

  await emitUnitLeaderAlert(db, {
    alertType: 'placement_request',
    unitKey: row.unit_key,
    cohortId: row.cohort_id,
    subjectId: `${id}:${decision}`,
    subject: 'Placement request decided',
    summary: `ASPIRE ${decision} a placement request.`,
    ctaPath: '/portal/unit/placements',
  })

  return res.status(200).json({ request: updated })
}

async function decideCapacity(res, { db, profile, id, decision, note }) {
  if (!CAPACITY_DECISIONS.has(decision)) return res.status(400).json({ error: 'invalid_decision' })

  const { data: row, error: loadErr } = await db
    .from('unit_capacity_submissions')
    .select('id, unit_key, cohort_id, review_status, superseded_at')
    .eq('id', id)
    .maybeSingle()
  if (loadErr) return res.status(500).json({ error: 'internal_error' })
  if (!row) return res.status(404).json({ error: 'not_found' })
  // A superseded submission is history; the replacement is what to review.
  if (row.superseded_at) return res.status(409).json({ error: 'already_superseded' })

  const now = new Date().toISOString()
  const { data: updated, error: updErr } = await db
    .from('unit_capacity_submissions')
    .update({
      review_status: decision,
      review_note: note || null,
      reviewed_by_profile_id: profile.id,
      reviewed_at: now,
    })
    .eq('id', id)
    .is('superseded_at', null)
    .select('id, unit_key, cohort_id, period_label, shift, student_count, review_status, review_note, reviewed_at')
    .maybeSingle()
  if (updErr) return res.status(500).json({ error: 'internal_error' })
  if (!updated) return res.status(409).json({ error: 'already_superseded' })

  await emitUnitLeaderAlert(db, {
    alertType: 'capacity_review_outcome',
    unitKey: row.unit_key,
    cohortId: row.cohort_id,
    subjectId: `${id}:${decision}`,
    subject: 'Capacity reviewed',
    summary: `ASPIRE marked a capacity submission ${decision}.`,
    ctaPath: '/portal/unit/capacity',
  })

  return res.status(200).json({ submission: updated })
}

async function decideNomination(res, { db, profile, id, decision, note }) {
  if (!NOMINATION_DECISIONS.has(decision)) return res.status(400).json({ error: 'invalid_decision' })

  const { data: row, error: loadErr } = await db
    .from('unit_preceptor_nominations')
    .select('id, unit_key, cohort_id, status')
    .eq('id', id)
    .maybeSingle()
  if (loadErr) return res.status(500).json({ error: 'internal_error' })
  if (!row) return res.status(404).json({ error: 'not_found' })
  if (row.status !== 'nominated') {
    return res.status(409).json({ error: 'already_decided', status: row.status })
  }

  const now = new Date().toISOString()
  const { data: updated, error: updErr } = await db
    .from('unit_preceptor_nominations')
    .update({
      status: decision,
      decision_note: note || null,
      decided_by_profile_id: profile.id,
      decided_at: now,
    })
    .eq('id', id)
    .eq('status', 'nominated')
    .select('id, unit_key, cohort_id, status, decision_note, decided_at')
    .maybeSingle()
  if (updErr) return res.status(500).json({ error: 'internal_error' })
  if (!updated) return res.status(409).json({ error: 'already_decided' })

  // NOTE: confirming a nomination does NOT write student_preceptor_assignments.
  // That table stays the authoritative assignment record and is written by the
  // existing staff preceptor workflow, so this endpoint cannot create an
  // assignment as a side effect of a decision.
  await emitUnitLeaderAlert(db, {
    alertType: 'preceptor_assignment_update',
    unitKey: row.unit_key,
    cohortId: row.cohort_id,
    subjectId: `${id}:${decision}`,
    subject: 'Preceptor nomination decided',
    summary: `ASPIRE ${decision} a preceptor nomination.`,
    ctaPath: '/portal/unit/preceptors',
  })

  return res.status(200).json({ nomination: updated })
}
