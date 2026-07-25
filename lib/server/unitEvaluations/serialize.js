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

import { QUANTITATIVE_PATHS, ALL_QUANTITATIVE_PATHS } from './config.js'

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
    } else if (typeof v === 'object' && typeof v.avg === 'number' && Number.isFinite(v.avg)) {
      const n = Number(v.n)
      out[path] = { avg: v.avg, n: Number.isFinite(n) ? n : 0 }
    }
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
    responses,
  }
}

// Exact allowed key sets for the Unit Leader payload. assertUnitLeaderShape throws on ANY
// key not in these sets, so a future refactor cannot silently widen the surface.
const TOP_KEYS = new Set([
  'instrument_slug', 'timepoint', 'unit_key', 'released_response_count',
  'quantitative_averages', 'responses',
])
const ROW_KEYS = new Set([
  'position', 'anon_label', 'instrument_slug', 'timepoint', 'unit_key', 'quantitative',
])

function assertQuantitativeSafe(obj, where) {
  if (!obj || typeof obj !== 'object') throw new Error(`ul_eval_shape:${where}:not_object`)
  for (const [k, v] of Object.entries(obj)) {
    if (!ALL_QUANTITATIVE_PATHS.includes(k)) throw new Error(`ul_eval_shape:${where}:path:${k}`)
    if (typeof v === 'number') continue
    if (v && typeof v === 'object') {
      const extra = Object.keys(v).filter(x => x !== 'avg' && x !== 'n')
      if (extra.length) throw new Error(`ul_eval_shape:${where}:avgkeys:${extra.join(',')}`)
      if (typeof v.avg !== 'number') throw new Error(`ul_eval_shape:${where}:avg`)
      continue
    }
    throw new Error(`ul_eval_shape:${where}:value:${k}`)
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
export function serializeReviewQueueRow(rel, studentName) {
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
  }
}
