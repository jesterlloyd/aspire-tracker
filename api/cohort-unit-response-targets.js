// api/cohort-unit-response-targets.js
//
// Staff-authorized CRUD for public.cohort_unit_response_targets (the explicit per-cohort outreach
// target set that is the denominator for the At a Glance responded/pending metric).
//
// SECURITY:
//   - Authorization is SERVER-VERIFIED as an ACTIVE owner or admin via verifyOwnerAdminCaller. Students,
//     Unit Leaders, and Academic Partners are rejected (403). No authorization is derived FROM this
//     table; it is descriptive data only.
//   - Reads/writes use the service-role client (the table's RLS denies anon/authenticated entirely).
//   - FAIL CLOSED: a service-role probe of cohort_unit_response_targets_ready() gates the feature; until
//     the Owner migration is applied, list returns { ready:false, targets:[] } and writes return 503.
//   - Never trusts client identity; requested_by / removed_by are the verified caller's profile id.

import { verifyOwnerAdminCaller, getServiceDb } from './lib/portalAuth.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const str = (v) => (typeof v === 'string' ? v.trim() : '')
// One canonical normalization rule; kept in parity with src/lib/canonicalUnit.js (api cannot import src).
export const canonicalUnitKey = (v) => String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '')

async function isTargetsReady(db) {
  try {
    const { data, error } = await db.rpc('cohort_unit_response_targets_ready')
    return !error && data === true
  } catch {
    return false
  }
}

const TARGET_FIELDS = 'id, cohort_id, unit_key, unit_name, unit_id, is_active, requested_at, requested_by_profile_id, removed_at, removed_by_profile_id, created_at, updated_at'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  // ── Authorization: active owner/admin only ──────────────────────────────────
  const auth = await verifyOwnerAdminCaller(req)
  if (!auth.ok) {
    const status = auth.status || 403
    return res.status(status).json({ error: status === 401 ? 'unauthorized' : 'forbidden', code: 'STAFF_ONLY' })
  }
  const actorId = auth.profile.id

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const action = typeof body.action === 'string' ? body.action : 'list'
  const cohortId = str(body.cohortId)
  if (!cohortId || !UUID_RE.test(cohortId)) {
    return res.status(400).json({ error: 'invalid_request', field: 'cohortId' })
  }

  let db
  try { db = getServiceDb() } catch { return res.status(500).json({ error: 'internal_error' }) }

  const ready = await isTargetsReady(db)

  // ── list: active targets (+ inactive for management) ────────────────────────
  if (action === 'list') {
    if (!ready) return res.status(200).json({ success: true, ready: false, targets: [] })
    const includeInactive = body.includeInactive === true
    let q = db.from('cohort_unit_response_targets').select(TARGET_FIELDS).eq('cohort_id', cohortId).order('unit_name')
    if (!includeInactive) q = q.eq('is_active', true)
    const { data, error } = await q
    if (error) return res.status(500).json({ error: 'internal_error' })
    return res.status(200).json({ success: true, ready: true, targets: data || [] })
  }

  // ── writes require readiness ────────────────────────────────────────────────
  if (!ready) return res.status(503).json({ error: 'targets_not_enabled', code: 'TARGETS_NOT_ENABLED' })

  // create: add one or more targets from canonical unit choices (dedup + reactivate + insert).
  if (action === 'create') {
    const raw = Array.isArray(body.units) ? body.units : []
    // Normalize + de-duplicate the incoming units by canonical key; require nonblank key and name.
    const byCanon = new Map()
    for (const u of raw) {
      const unitKey = str(u?.unit_key || u?.unit_name)
      const unitName = str(u?.unit_name || u?.unit_key)
      const canon = canonicalUnitKey(unitKey)
      if (!unitKey || !unitName || !canon) continue
      if (!byCanon.has(canon)) byCanon.set(canon, { unit_key: unitKey, unit_name: unitName, canon })
    }
    if (byCanon.size === 0) return res.status(400).json({ error: 'invalid_request', field: 'units' })

    // Existing rows for this cohort (active + inactive) so we can skip active dupes and reactivate.
    const { data: existing, error: exErr } = await db
      .from('cohort_unit_response_targets').select('id, unit_key, is_active').eq('cohort_id', cohortId)
    if (exErr) return res.status(500).json({ error: 'internal_error' })
    const existingByCanon = new Map()
    for (const row of existing || []) existingByCanon.set(canonicalUnitKey(row.unit_key), row)

    const now = new Date().toISOString()
    let added = 0, reactivated = 0, skipped = 0
    for (const t of byCanon.values()) {
      const ex = existingByCanon.get(t.canon)
      if (ex && ex.is_active) { skipped += 1; continue }              // already an active target
      if (ex && !ex.is_active) {
        const { error } = await db.from('cohort_unit_response_targets')
          .update({ is_active: true, removed_at: null, removed_by_profile_id: null, unit_name: t.unit_name, requested_at: now, requested_by_profile_id: actorId })
          .eq('id', ex.id)
        if (error) return res.status(500).json({ error: 'internal_error' })
        reactivated += 1
      } else {
        const { error } = await db.from('cohort_unit_response_targets')
          .insert({ cohort_id: cohortId, unit_key: t.unit_key, unit_name: t.unit_name, is_active: true, requested_at: now, requested_by_profile_id: actorId })
        if (error) return res.status(500).json({ error: 'internal_error' })
        added += 1
      }
    }
    return res.status(200).json({ success: true, added, reactivated, skipped })
  }

  // deactivate / reactivate a single target by id (auditable soft-remove / restore).
  if (action === 'deactivate' || action === 'reactivate') {
    const id = str(body.id)
    if (!id || !UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_request', field: 'id' })
    const { data: row, error: rErr } = await db
      .from('cohort_unit_response_targets').select('id, cohort_id, unit_key, is_active').eq('id', id).maybeSingle()
    if (rErr) return res.status(500).json({ error: 'internal_error' })
    if (!row || row.cohort_id !== cohortId) return res.status(404).json({ error: 'not_found' })

    if (action === 'deactivate') {
      const { error } = await db.from('cohort_unit_response_targets')
        .update({ is_active: false, removed_at: new Date().toISOString(), removed_by_profile_id: actorId })
        .eq('id', id)
      if (error) return res.status(500).json({ error: 'internal_error' })
      return res.status(200).json({ success: true })
    }
    // reactivate: refuse if another ACTIVE target already holds this canonical key (unique guard).
    const { data: dupes, error: dErr } = await db
      .from('cohort_unit_response_targets').select('id, unit_key, is_active').eq('cohort_id', cohortId).eq('is_active', true)
    if (dErr) return res.status(500).json({ error: 'internal_error' })
    const canon = canonicalUnitKey(row.unit_key)
    if ((dupes || []).some(d => d.id !== id && canonicalUnitKey(d.unit_key) === canon)) {
      return res.status(409).json({ error: 'duplicate_active_target', code: 'DUPLICATE_ACTIVE_TARGET' })
    }
    const { error } = await db.from('cohort_unit_response_targets')
      .update({ is_active: true, removed_at: null, removed_by_profile_id: null, requested_at: new Date().toISOString(), requested_by_profile_id: actorId })
      .eq('id', id)
    if (error) return res.status(500).json({ error: 'internal_error' })
    return res.status(200).json({ success: true })
  }

  return res.status(400).json({ error: 'invalid_request', field: 'action' })
}
