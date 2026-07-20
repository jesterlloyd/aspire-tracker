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
// AUDIT IS ATOMIC, NOT BEST EFFORT. The response and its append-only history row
// are written by unit_placement_respond in ONE transaction, so a successful state
// change cannot exist without its audit row. unit_placement_request_events is the
// audit of record for this workflow; nothing is duplicated into activity_logs.

import { verifyPortalUnitLeaderCaller, narrowScopes } from '../lib/unitLeaderScope.js'
import { mapRpcError, mapRpcStatus } from '../lib/unitLeaderRpcErrors.js'

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
    : respondToRequest(req, res, { db, profile })
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

async function respondToRequest(req, res, { db, profile }) {
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

  // ATOMIC. The RPC re-derives authorization from the actor profile, guards on
  // aspire_status = 'open' under a row lock, updates the request, and appends the
  // history row in ONE transaction. A successful state change can no longer exist
  // without its audit row, which the previous update-then-insert could produce.
  //
  // The request id is passed, not trusted: the function itself checks the active
  // unit_leader grant and an active user_unit_scopes row covering the request's
  // unit and cohort, so the API cannot widen scope by passing an arbitrary id.
  const { data: result, error: rpcErr } = await db.rpc('unit_placement_respond', {
    p_actor_profile_id: profile.id,
    p_request_id: requestId,
    p_unit_response: response,
    p_comment: comment || null,
  })

  if (rpcErr) return res.status(mapRpcStatus(rpcErr)).json({ error: mapRpcError(rpcErr) })
  if (!result) return res.status(404).json({ error: 'not_found' })

  return res.status(200).json({ request: result })
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
