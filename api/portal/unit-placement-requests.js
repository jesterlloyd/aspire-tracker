// api/portal/unit-placement-requests.js
//
// UL-PORTAL: placement requests a Unit Leader may respond to.
//
// GET   list open and recent requests for the caller's assigned units
// POST  record a Unit Leader response: accept, decline, or request changes
//
// ASPIRE RETAINS FINAL AUTHORITY. A Unit Leader response only ever writes
// unit_response. aspire_status is a separate column that only staff endpoints
// change, so no Unit Leader action can silently become an ASPIRE approval. The
// response payload always reports both, and the UI labels the request as pending
// ASPIRE confirmation until aspire_status leaves 'open'.
//
// Every transition is appended to unit_placement_request_events (never overwritten)
// and emitted to activity_logs.

import { verifyPortalUnitLeaderCaller, narrowScopes } from '../lib/unitLeaderScope.js'
import { emitUnitLeaderAudit } from '../lib/unitLeaderAudit.js'

const UNIT_RESPONSES = new Set(['accepted', 'declined', 'changes_requested'])
const MAX_COMMENT = 2000
const LIST_LIMIT = 200

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

  const { db, profile, scopes, unitKeys } = auth
  if (scopes.length === 0) return res.status(200).json({ requests: [] })

  return req.method === 'GET'
    ? listRequests(req, res, { db, scopes, unitKeys })
    : respondToRequest(req, res, { db, profile, scopes })
}

async function listRequests(req, res, { db, scopes, unitKeys }) {
  // A query parameter may NARROW to one assigned unit. It can never widen.
  const requestedUnit = typeof req.query?.unit_key === 'string' ? req.query.unit_key : null
  const effective = narrowScopes(scopes, requestedUnit)
  if (effective === null) return res.status(403).json({ error: 'unit_not_in_scope' })

  const keys = [...new Set(effective.map(s => s.unit_key))]
  if (keys.length === 0) return res.status(200).json({ requests: [] })

  const { data, error } = await db
    .from('unit_placement_requests')
    .select('id, student_id, cohort_id, unit_key, unit_response, unit_comment, ' +
            'responded_at, aspire_status, aspire_note, aspire_decided_at, due_at, created_at, updated_at')
    .in('unit_key', keys)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT)
  if (error) return res.status(500).json({ error: 'internal_error' })

  // Apply the scope's cohort restriction after the fetch, mirroring the roster.
  const inScope = (data || []).filter(r =>
    effective.some(s => s.unit_key === r.unit_key && (s.cohort_id === null || s.cohort_id === r.cohort_id)))

  return res.status(200).json({
    requests: inScope.map(shapeRequest),
    unit_keys: unitKeys,
  })
}

async function respondToRequest(req, res, { db, profile, scopes }) {
  const body = req.body && typeof req.body === 'object' ? req.body : {}

  // Strict allowlist: an unexpected key is a client error, not something to ignore.
  const allowed = new Set(['request_id', 'unit_response', 'unit_comment'])
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) return res.status(400).json({ error: 'unexpected_field', field: k })
  }

  const requestId = body.request_id
  const response = typeof body.unit_response === 'string' ? body.unit_response : ''
  const comment = typeof body.unit_comment === 'string' ? body.unit_comment.trim() : ''

  if (!isUuid(requestId)) return res.status(400).json({ error: 'invalid_request_id' })
  if (!UNIT_RESPONSES.has(response)) return res.status(400).json({ error: 'invalid_unit_response' })
  if (comment.length > MAX_COMMENT) return res.status(400).json({ error: 'comment_too_long' })
  // Requesting changes without saying what to change is not actionable.
  if (response === 'changes_requested' && comment.length === 0) {
    return res.status(400).json({ error: 'comment_required_for_changes' })
  }

  // Load the row and authorize it against the caller's scopes. A request outside
  // scope is reported as not found, so the endpoint does not confirm its existence.
  const { data: row, error: loadErr } = await db
    .from('unit_placement_requests')
    .select('id, student_id, cohort_id, unit_key, unit_response, aspire_status')
    .eq('id', requestId)
    .maybeSingle()
  if (loadErr) return res.status(500).json({ error: 'internal_error' })
  if (!row) return res.status(404).json({ error: 'not_found' })

  const covered = scopes.some(s =>
    s.unit_key === row.unit_key && (s.cohort_id === null || s.cohort_id === row.cohort_id))
  if (!covered) return res.status(404).json({ error: 'not_found' })

  // ASPIRE has already decided; the Unit Leader window is closed.
  if (row.aspire_status !== 'open') {
    return res.status(409).json({ error: 'already_decided', aspire_status: row.aspire_status })
  }

  const now = new Date().toISOString()
  const { data: updated, error: updErr } = await db
    .from('unit_placement_requests')
    .update({
      unit_response: response,
      unit_comment: comment || null,
      responded_by_profile_id: profile.id,
      responded_at: now,
      updated_at: now,
    })
    .eq('id', requestId)
    // Optimistic guard: only transition while ASPIRE has not decided, so a stale
    // client cannot overwrite a decision made between load and write.
    .eq('aspire_status', 'open')
    .select('id, student_id, cohort_id, unit_key, unit_response, unit_comment, ' +
            'responded_at, aspire_status, aspire_note, aspire_decided_at, due_at, created_at, updated_at')
    .maybeSingle()
  if (updErr) return res.status(500).json({ error: 'internal_error' })
  if (!updated) return res.status(409).json({ error: 'already_decided' })

  // Append-only history. Never overwritten.
  await db.from('unit_placement_request_events').insert({
    request_id: requestId,
    event_type: 'unit_response',
    actor_profile_id: profile.id,
    actor_role: 'unit_leader',
    unit_key: row.unit_key,
    from_value: row.unit_response,
    to_value: response,
    comment: comment || null,
  })

  await emitUnitLeaderAudit(db, profile, {
    action: 'unit_placement_response',
    entityType: 'unit_placement_request',
    entityId: requestId,
    unitKey: row.unit_key,
    cohortId: row.cohort_id,
    fromValue: row.unit_response,
    toValue: response,
    comment: comment || null,
    aspireStatus: updated.aspire_status,
  })

  return res.status(200).json({ request: shapeRequest(updated) })
}

function shapeRequest(r) {
  return {
    id: r.id,
    student_id: r.student_id,
    cohort_id: r.cohort_id,
    unit_key: r.unit_key,
    unit_response: r.unit_response,
    unit_comment: r.unit_comment ?? null,
    responded_at: r.responded_at ?? null,
    // Always surfaced so the UI can state plainly that ASPIRE has the final word.
    aspire_status: r.aspire_status,
    aspire_note: r.aspire_note ?? null,
    aspire_decided_at: r.aspire_decided_at ?? null,
    awaiting_aspire_confirmation: r.aspire_status === 'open',
    due_at: r.due_at ?? null,
    created_at: r.created_at,
  }
}
