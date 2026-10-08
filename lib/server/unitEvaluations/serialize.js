// lib/server/unitEvaluations/serialize.js
//
// UL-EVAL-API: output shaping for the Unit Leader evaluations surface. The database RPCs
// already return only safe, scoped, allowlisted data; this module is the server-side
// defense-in-depth layer that (1) re-filters quantitative values to the exact per-instrument
// allowlist, (2) builds the Unit Leader payload from ONLY allowed keys, and (3) asserts —
// fail closed — that the payload contains no prohibited field anywhere before it is sent.
//
// A Unit Leader NEVER receives: any id (response/assignment/student/preceptor/cohort/rotation),
// student or preceptor identity, email, headshot, any timestamp, free text, raw JSON, staff
// actor, moderation/release lifecycle metadata, or a stable/durable response token.

import { QUANTITATIVE_PATHS, ALL_QUANTITATIVE_PATHS, CHOICE_OPTIONS, isAllowedChoice } from './config.js'

/**
 * Keep ONLY allowlisted numeric quantitative paths for the instrument. Row values are raw
 * numbers; summary averages are { avg:number, n:number }. Anything else is dropped.
 */
export function sanitizeQuantitative(instrument, quant) {
  const allowed = QUANTITATIVE_PATHS[instrument] || []
  const out = {}
  if (!quant || typeof quant !== 'object') return out
  for (const path of allowed) {
    const v = quant[path]
    if (v === null || v === undefined) continue
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[path] = v
    } else if (isAllowedChoice(path, v)) {
      out[path] = v   // UL-CHOICE-WORDS-1: one of the question's own fixed phrases, never typed text
    } else if (typeof v === 'object' && typeof v.avg === 'number' && Number.isFinite(v.avg)) {
      const n = Number(v.n)
      out[path] = { avg: v.avg, n: Number.isFinite(n) ? n : 0 }
    }
  }
  return out
}

/**
 * UL-CHOICE-WORDS-1: per path, how many released responses gave each fixed phrase. Only allowed
 * paths of this instrument and allowed phrases survive; a count must be a positive integer.
 */
export function sanitizeChoiceCounts(instrument, counts) {
  const allowed = QUANTITATIVE_PATHS[instrument] || []
  const out = {}
  if (!counts || typeof counts !== 'object') return out
  for (const path of allowed) {
    const byWord = counts[path]
    if (!byWord || typeof byWord !== 'object' || !CHOICE_OPTIONS[path]) continue
    const kept = {}
    for (const word of CHOICE_OPTIONS[path]) {
      const n = Number(byWord[word])
      if (Number.isInteger(n) && n > 0) kept[word] = n
    }
    if (Object.keys(kept).length) out[path] = kept
  }
  return out
}

/**
 * Build the Unit Leader payload from the raw RPC outputs. Only allowed keys are copied; the
 * positional `position` is an in-memory array index (1-based), NOT a database identifier —
 * the future modal opens from the already-returned row via this positional key.
 */
export function serializeUnitLeaderEvaluations({ instrument, timepoint, unitKey, summary, list }) {
  const s = summary && typeof summary === 'object' ? summary : {}
  const rows = Array.isArray(list) ? list : []

  const responses = rows.map((r, i) => ({
    position: i + 1,
    anon_label: typeof r?.anon_label === 'string' ? r.anon_label : `Response ${i + 1}`,
    instrument_slug: instrument,
    timepoint: typeof r?.timepoint === 'string' ? r.timepoint : (timepoint || null),
    unit_key: typeof r?.unit_key === 'string' ? r.unit_key : null,
    quantitative: sanitizeQuantitative(instrument, r?.quantitative),
  }))

  const count = Number(s.released_response_count)

  return {
    instrument_slug: instrument,
    timepoint: timepoint || null,
    unit_key: unitKey || null,                       // null = All Assigned Units
    released_response_count: Number.isFinite(count) ? count : 0,
    quantitative_averages: sanitizeQuantitative(instrument, s.quantitative_averages),
    choice_counts: sanitizeChoiceCounts(instrument, s.choice_counts),
    responses,
  }
}

// Exact allowed key sets for the Unit Leader payload. assertUnitLeaderShape throws on ANY
// key not in these sets, so a future refactor cannot silently widen the surface.
const TOP_KEYS = new Set([
  'instrument_slug', 'timepoint', 'unit_key', 'released_response_count',
  'quantitative_averages', 'choice_counts', 'responses',
])
const ROW_KEYS = new Set([
  'position', 'anon_label', 'instrument_slug', 'timepoint', 'unit_key', 'quantitative',
])

function assertQuantitativeSafe(obj, where) {
  if (!obj || typeof obj !== 'object') throw new Error(`ul_eval_shape:${where}:not_object`)
  for (const [k, v] of Object.entries(obj)) {
    if (!ALL_QUANTITATIVE_PATHS.includes(k)) throw new Error(`ul_eval_shape:${where}:path:${k}`)
    if (typeof v === 'number') continue
    if (typeof v === 'string') {
      if (isAllowedChoice(k, v)) continue
      throw new Error(`ul_eval_shape:${where}:text:${k}`)
    }
    if (v && typeof v === 'object') {
      const extra = Object.keys(v).filter(x => x !== 'avg' && x !== 'n')
      if (extra.length) throw new Error(`ul_eval_shape:${where}:avgkeys:${extra.join(',')}`)
      if (typeof v.avg !== 'number') throw new Error(`ul_eval_shape:${where}:avg`)
      continue
    }
    throw new Error(`ul_eval_shape:${where}:value:${k}`)
  }
}

function assertChoiceCountsSafe(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('ul_eval_shape:choices:not_object')
  for (const [path, byWord] of Object.entries(obj)) {
    if (!CHOICE_OPTIONS[path]) throw new Error(`ul_eval_shape:choices:path:${path}`)
    if (!byWord || typeof byWord !== 'object') throw new Error(`ul_eval_shape:choices:value:${path}`)
    for (const [word, n] of Object.entries(byWord)) {
      if (!isAllowedChoice(path, word)) throw new Error(`ul_eval_shape:choices:word:${path}`)
      if (!Number.isInteger(n)) throw new Error(`ul_eval_shape:choices:count:${path}`)
    }
  }
}

/**
 * Fail-closed assertion: the payload must contain ONLY the allowed keys, and quantitative
 * objects must contain ONLY allowlisted numeric paths. Throws otherwise. Callers treat a
 * throw as a 500 rather than sending a possibly-leaky payload.
 */
export function assertUnitLeaderShape(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('ul_eval_shape:top:not_object')
  }
  for (const k of Object.keys(payload)) {
    if (!TOP_KEYS.has(k)) throw new Error(`ul_eval_shape:top:${k}`)
  }
  if (typeof payload.instrument_slug !== 'string') throw new Error('ul_eval_shape:top:instrument_slug')
  if (typeof payload.released_response_count !== 'number') throw new Error('ul_eval_shape:top:count')
  assertQuantitativeSafe(payload.quantitative_averages, 'averages')
  for (const v of Object.values(payload.quantitative_averages)) {
    if (typeof v === 'string') throw new Error('ul_eval_shape:averages:text')
  }
  assertChoiceCountsSafe(payload.choice_counts)
  if (!Array.isArray(payload.responses)) throw new Error('ul_eval_shape:top:responses')
  for (const row of payload.responses) {
    if (!row || typeof row !== 'object') throw new Error('ul_eval_shape:row:not_object')
    for (const k of Object.keys(row)) {
      if (!ROW_KEYS.has(k)) throw new Error(`ul_eval_shape:row:${k}`)
    }
    if (typeof row.position !== 'number') throw new Error('ul_eval_shape:row:position')
    assertQuantitativeSafe(row.quantitative, 'row')
  }
  return payload
}

/**
 * Staff (Owner/Admin) review-queue row. Staff MAY see identity and lifecycle metadata, so
 * this is a distinct, deliberately richer shape. It still comes from an allowlist (never a
 * raw DB row), and `response_id` is returned ONLY here (owner/admin), for exact-row actions.
 */
/**
 * MODERATION-STACKS-1: the numbers a Unit Leader would see for one response, read from the
 * response with the same per-instrument allowlist (sanitizeQuantitative). Staff only: the review
 * queue shows them so a moderator reviews exactly what would be released. Never free text.
 */
export function leaderSeesFromResponses(instrument, responses) {
  const allowed = QUANTITATIVE_PATHS[instrument] || []
  const raw = {}
  if (!responses || typeof responses !== 'object') return raw
  for (const path of allowed) {
    let v = responses
    for (const key of path.split('.')) v = v && typeof v === 'object' ? v[key] : undefined
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) v = Number(v)
    raw[path] = v
  }
  return sanitizeQuantitative(instrument, raw)
}

export function serializeReviewQueueRow(rel, studentName, withheldAt = null, leaderSees = null) {
  return {
    response_id: rel.response_id,
    instrument_slug: rel.instrument_slug,
    timepoint: rel.timepoint ?? null,
    student_name: studentName || null,
    unit_key: rel.hist_unit_key ?? null,
    evaluated_preceptor: rel.hist_preceptor_label ?? null,
    cohort_label: rel.hist_cohort_label ?? null,
    rotation_end: rel.hist_rotation_end ?? null,
    eligible_at: rel.unit_leader_eligible_at ?? null,
    snapshot_source: rel.snapshot_source ?? null,
    moderation_state: rel.moderation_state ?? null,
    release_state: rel.release_state ?? null,
    released_at: rel.released_at ?? null,
    revoked_at: rel.revoked_at ?? null,
    withheld_at: withheldAt || null,   // AC-DISMISS-1: marked "won't release"
    leader_sees: leaderSees || {},     // MODERATION-STACKS-1: what the leader would see
  }
}
