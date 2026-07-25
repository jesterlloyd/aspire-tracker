// lib/server/unitEvaluations/validation.js
//
// UL-EVAL-API: input validation for the Unit Leader evaluations surface. Pure functions;
// never touch a database or a request object beyond the plain values passed in. Every
// rejection returns { ok:false, status, error } with a stable snake_case error key.

import { APPROVED_INSTRUMENTS, TIMEPOINTS, LIFECYCLE_ACTIONS } from './config.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Validate the Unit Leader read query. instrument is required and must be one of the two
 * approved slugs; timepoint and unit_key are optional narrowing inputs. unit_key here only
 * narrows — the database RPC intersects it with the caller's server-derived scopes, so a
 * bogus or out-of-scope value simply returns nothing, never widens.
 */
export function validateUnitEvalQuery(query) {
  const q = query && typeof query === 'object' ? query : {}

  const instrument = typeof q.instrument === 'string' ? q.instrument : ''
  if (!APPROVED_INSTRUMENTS.includes(instrument)) {
    return { ok: false, status: 400, error: 'invalid_instrument' }
  }

  const rawTp = typeof q.timepoint === 'string' ? q.timepoint.trim() : ''
  const timepoint = rawTp === '' ? null : rawTp
  if (timepoint !== null && !TIMEPOINTS.includes(timepoint)) {
    return { ok: false, status: 400, error: 'invalid_timepoint' }
  }

  const rawUnit = typeof q.unit_key === 'string' ? q.unit_key.trim() : ''
  const unitKey = rawUnit === '' ? null : rawUnit
  if (unitKey !== null && unitKey.length > 120) {
    return { ok: false, status: 400, error: 'invalid_unit_key' }
  }

  return { ok: true, value: { instrument, timepoint, unitKey } }
}

/**
 * Validate an Owner/Admin lifecycle action body. The action must be one of the four known
 * verbs; response_id must be a uuid; a 'moderate' action requires a decision of
 * 'cleared' | 'blocked'. No caller-supplied profile id, role, or scope is accepted.
 */
export function validateLifecycleAction(body) {
  const b = body && typeof body === 'object' ? body : {}

  const allowed = new Set(['action', 'response_id', 'decision'])
  for (const k of Object.keys(b)) {
    if (!allowed.has(k)) return { ok: false, status: 400, error: 'unexpected_field', field: k }
  }

  const action = b.action
  if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(LIFECYCLE_ACTIONS, action)) {
    return { ok: false, status: 400, error: 'invalid_action' }
  }

  const responseId = b.response_id
  if (typeof responseId !== 'string' || !UUID_RE.test(responseId)) {
    return { ok: false, status: 400, error: 'invalid_response_id' }
  }

  let decision = null
  if (action === 'moderate') {
    decision = b.decision
    if (decision !== 'cleared' && decision !== 'blocked') {
      return { ok: false, status: 400, error: 'invalid_decision' }
    }
  } else if (b.decision !== undefined) {
    return { ok: false, status: 400, error: 'unexpected_field', field: 'decision' }
  }

  return { ok: true, value: { action, responseId, decision } }
}

/**
 * Validate the Owner/Admin review-queue query. All filters optional; instrument, when
 * present, must be approved. release_state / moderation_state are free-form filters the
 * server clamps to known values (unknown → ignored, never an error, so the UI can add
 * states without breaking older clients).
 */
export function validateQueueQuery(query) {
  const q = query && typeof query === 'object' ? query : {}

  const rawInst = typeof q.instrument === 'string' ? q.instrument.trim() : ''
  if (rawInst && !APPROVED_INSTRUMENTS.includes(rawInst)) {
    return { ok: false, status: 400, error: 'invalid_instrument' }
  }

  const clamp = (v, set) => (typeof v === 'string' && set.has(v) ? v : null)
  const rawTp = typeof q.timepoint === 'string' ? q.timepoint.trim() : ''

  return {
    ok: true,
    value: {
      instrument: rawInst || null,
      timepoint: rawTp && TIMEPOINTS.includes(rawTp) ? rawTp : null,
      unitKey: typeof q.unit_key === 'string' && q.unit_key.trim() ? q.unit_key.trim() : null,
      releaseState: clamp(q.release_state, new Set(['pending', 'moderated', 'released', 'revoked', 'ineligible'])),
      moderationState: clamp(q.moderation_state, new Set(['pending', 'cleared', 'blocked'])),
    },
  }
}
