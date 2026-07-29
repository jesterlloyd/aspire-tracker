// Cohort-scoped unit response metrics for the Placement Capacity summary (At a Glance).
//
// Pure and shared. Both inputs must already be scoped to ONE cohort (the caller fetches them by
// cohort_id), so there is no cross-cohort leakage here.
//
// The denominator is the EXPLICIT per-cohort outreach-target set (cohort_unit_response_targets), NOT
// the response rows and NOT the lazily-created `units` rows. Targets are matched to responses by
// canonical unit identity (unit_id first, else canonical unit key); a submitted response that matches
// no target is an ORPHAN (surfaced for staff, excluded from configured expected/responded/slots). See
// docs/product/UNIT_RESPONSE_COUNT_SEMANTICS.md.

import { canonicalUnitKey } from './canonicalUnit.js'

// A distinct target counts as RESPONDED only for these submitted states. A decline
// (submitted_not_hosting / zero slots) is a valid response. `pending`, drafts, and missing rows are not.
export const RESPONDED_STATUSES = new Set(['submitted_hosting', 'submitted_not_hosting'])

// Deterministic recency when more than one row exists per unit (unit_cohort_responses is unique on
// (cohort_id, unit_id), so normally there is exactly one; latest by last_updated_at then submitted_at).
function responseTime(r) {
  const t = Date.parse(r?.last_updated_at || r?.submitted_at || '')
  return Number.isNaN(t) ? 0 : t
}
const slotsOf = (r) => {
  const n = Number(r?.slots_offered)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// targets:   [{ unit_id?, unit_key, unit_name }]  - the cohort's ACTIVE outreach targets
// responses: [{ unit_id, unit_name, response_status, slots_offered, ... }] - unit_cohort_responses rows
export function computeUnitResponseMetrics({ targets = [], responses = [] } = {}) {
  const dataQualityWarnings = []

  // Canonical (latest) response per distinct unit_id.
  const respById = new Map()
  for (const r of responses) {
    if (!r || r.unit_id == null) continue
    const p = respById.get(r.unit_id)
    if (!p || responseTime(r) >= responseTime(p)) respById.set(r.unit_id, r)
  }
  const allResponses = [...respById.values()]

  // Canonical-name index of responses, with ambiguity detection (two distinct unit_ids, same key).
  const respByCanon = new Map()
  const ambiguousCanon = new Set()
  for (const r of allResponses) {
    const c = canonicalUnitKey(r.unit_name)
    if (!c) continue
    const prev = respByCanon.get(c)
    if (prev && prev.unit_id !== r.unit_id) { ambiguousCanon.add(c); continue }
    respByCanon.set(c, r)
  }

  // Received submitted responses + fallback slots (target-independent; used by the unconfigured summary).
  let submittedResponseCount = 0
  let fallbackSlotCount = 0
  for (const r of allResponses) {
    if (!RESPONDED_STATUSES.has(r.response_status)) continue
    submittedResponseCount += 1
    if (r.response_status === 'submitted_hosting') fallbackSlotCount += slotsOf(r)
  }

  // Distinct active targets by canonical identity.
  const targetByCanon = new Map()
  for (const t of targets) {
    if (!t) continue
    const canon = canonicalUnitKey(t.unit_key ?? t.unit_name)
    if (!canon) continue
    if (targetByCanon.has(canon)) { dataQualityWarnings.push(`Duplicate target for ${t.unit_key ?? t.unit_name}`); continue }
    targetByCanon.set(canon, t)
  }
  const targetList = [...targetByCanon.values()]
  const configured = targetList.length > 0

  // Match each target to its canonical response: unit_id first, else canonical key (ambiguous → fail
  // closed, target stays pending with a data-quality warning). Track attributed responses for orphans.
  const attributed = new Set()
  const respondedUnitIds = []
  const pendingUnits = []
  let confirmedSlotCount = 0
  for (const t of targetList) {
    const canon = canonicalUnitKey(t.unit_key ?? t.unit_name)
    let r = (t.unit_id != null && respById.get(t.unit_id)) || null
    if (!r) {
      if (ambiguousCanon.has(canon)) {
        dataQualityWarnings.push(`Ambiguous response match for ${t.unit_key ?? t.unit_name}`)
      } else {
        r = respByCanon.get(canon) || null
      }
    }
    if (r) attributed.add(r.unit_id)
    if (r && RESPONDED_STATUSES.has(r.response_status)) {
      respondedUnitIds.push(r.unit_id ?? canon)
      if (r.response_status === 'submitted_hosting') confirmedSlotCount += slotsOf(r)
    } else {
      pendingUnits.push({ key: t.unit_key ?? t.unit_name, name: (t.unit_name ?? t.unit_key ?? '').toString().trim() })
    }
  }

  // Orphans: submitted responses attributed to no target.
  const orphanUnits = []
  for (const r of allResponses) {
    if (!RESPONDED_STATUSES.has(r.response_status)) continue
    if (attributed.has(r.unit_id)) continue
    orphanUnits.push({ key: canonicalUnitKey(r.unit_name), name: (r.unit_name || '').toString().trim() || '(unknown unit)' })
  }

  const expectedUnitCount = targetList.length
  const respondedUnitCount = Math.min(respondedUnitIds.length, expectedUnitCount)
  const pendingUnitCount = Math.max(0, expectedUnitCount - respondedUnitCount)

  return {
    configured,
    expectedUnitCount,
    respondedUnitCount,
    pendingUnitCount,
    confirmedSlotCount,          // targeted hosting only (configured metric)
    fallbackSlotCount,           // all submitted hosting (unconfigured fallback)
    submittedResponseCount,
    pendingUnits,
    pendingUnitNames: pendingUnits.map(p => p.name).filter(Boolean),
    orphanResponseCount: orphanUnits.length,
    orphanUnits,
    orphanUnitNames: orphanUnits.map(o => o.name).filter(Boolean),
    dataQualityWarnings,
    expectedUnitIds: targetList.map(t => t.unit_id ?? canonicalUnitKey(t.unit_key ?? t.unit_name)),
    respondedUnitIds,
    pendingUnitIds: pendingUnits.map(p => canonicalUnitKey(p.key)),
  }
}

// Concise summary. Configured cohorts use the target metric; unconfigured cohorts get an honest
// "targets not set" fallback that summarizes received responses and never claims a pending count.
export function formatUnitResponseSummary(metrics) {
  if (!metrics) return 'No unit response requests are configured for this cohort.'
  if (!metrics.configured) {
    const n = metrics.submittedResponseCount || 0
    return `${n} unit response${n === 1 ? '' : 's'} received · ${metrics.fallbackSlotCount || 0} slots confirmed · response targets not set`
  }
  const { respondedUnitCount, expectedUnitCount, confirmedSlotCount, pendingUnitCount } = metrics
  return `${respondedUnitCount} of ${expectedUnitCount} units responded · ${confirmedSlotCount} slots confirmed · ${pendingUnitCount} pending`
}
