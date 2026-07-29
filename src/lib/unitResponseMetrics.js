// Cohort-scoped unit response metrics for the Placement Capacity summary (At a Glance).
//
// Pure and shared. Both inputs must already be scoped to ONE cohort (the caller queries them by
// cohort_id), so there is no cross-cohort leakage here.
//
// The denominator is the EXPLICIT per-cohort outreach-target list (cohort_unit_response_targets), NOT
// the response rows and NOT the lazily-created `units` rows. `units.is_participating` is a response
// outcome, not an outreach flag, and a non-responding, never-seeded unit has no row at all - so pending
// cannot be inferred from silence. See docs/product/UNIT_RESPONSE_COUNT_SEMANTICS.md.

// A distinct target counts as RESPONDED only for these submitted states. A decline
// (submitted_not_hosting / zero slots) is a valid response. `pending`, drafts, and missing rows are not.
export const RESPONDED_STATUSES = new Set(['submitted_hosting', 'submitted_not_hosting'])

// Canonical, label-independent unit key (whitespace/punctuation/case-insensitive), so alias spellings
// of the same unit resolve together when a target must be matched to a response by name.
const norm = (s) => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '')

// Deterministic recency for the (defensive) case of more than one row per unit. unit_cohort_responses
// is unique on (cohort_id, unit_id), so normally there is exactly one; latest wins otherwise.
function responseTime(r) {
  const t = Date.parse(r?.last_updated_at || r?.submitted_at || '')
  return Number.isNaN(t) ? 0 : t
}

// targets:   [{ unit_id?, unit_key/unit_name }]  - the cohort's explicit outreach targets
// responses: [{ unit_id, unit_name, response_status, slots_offered, ... }] - unit_cohort_responses rows
export function computeUnitResponseMetrics({ targets = [], responses = [] } = {}) {
  // Canonical (latest) response per distinct unit, keyed by unit id when present, else normalized name.
  const canonical = new Map()
  for (const r of responses) {
    if (!r) continue
    const key = r.unit_id != null ? `id:${r.unit_id}` : `nm:${norm(r.unit_name)}`
    const p = canonical.get(key)
    if (!p || responseTime(r) >= responseTime(p)) canonical.set(key, r)
  }
  // Lookups (by id and by normalized name) for matching a target to its canonical response.
  const respById = new Map()
  const respByName = new Map()
  for (const r of canonical.values()) {
    if (r.unit_id != null) respById.set(r.unit_id, r)
    const nm = norm(r.unit_name)
    if (nm) respByName.set(nm, r)
  }
  // Slots + received count from the canonical (latest) responses only.
  let submittedResponseCount = 0
  let confirmedSlotCount = 0
  for (const r of canonical.values()) {
    if (!RESPONDED_STATUSES.has(r.response_status)) continue
    submittedResponseCount += 1
    if (r.response_status === 'submitted_hosting') {
      const n = Number(r.slots_offered)
      confirmedSlotCount += Number.isFinite(n) && n > 0 ? n : 0
    }
  }

  // Distinct targets by canonical identity (unit_id when present, else normalized unit key).
  const targetIdOf = (t) => (t.unit_id != null ? t.unit_id : norm(t.unit_key ?? t.unit_name))
  const targetMap = new Map()
  for (const t of targets) {
    if (!t) continue
    const id = targetIdOf(t)
    if (id !== '' && id != null && !targetMap.has(id)) targetMap.set(id, t)
  }
  const targetList = [...targetMap.values()]
  const configured = targetList.length > 0

  const responseForTarget = (t) =>
    (t.unit_id != null && respById.get(t.unit_id)) || respByName.get(norm(t.unit_key ?? t.unit_name)) || null

  const respondedUnitIds = []
  const pendingUnitIds = []
  const pendingUnitNames = []
  for (const t of targetList) {
    const r = responseForTarget(t)
    const id = targetIdOf(t)
    if (r && RESPONDED_STATUSES.has(r.response_status)) {
      respondedUnitIds.push(id)
    } else {
      pendingUnitIds.push(id)
      const name = (t.unit_key ?? t.unit_name ?? '').toString().trim()
      if (name) pendingUnitNames.push(name)
    }
  }

  const expectedUnitCount = targetList.length
  const respondedUnitCount = Math.min(respondedUnitIds.length, expectedUnitCount)
  const pendingUnitCount = Math.max(0, expectedUnitCount - respondedUnitCount)

  return {
    configured,
    expectedUnitCount,
    respondedUnitCount,
    pendingUnitCount,
    confirmedSlotCount,
    submittedResponseCount,
    expectedUnitIds: targetList.map(targetIdOf),
    respondedUnitIds,
    pendingUnitIds,
    pendingUnitNames,
  }
}

// Concise, accurate summary. Never claims "0 pending" for a cohort with no configured targets.
export function formatUnitResponseSummary(metrics) {
  if (!metrics) return 'No unit response requests are configured for this cohort.'
  if (!metrics.configured) {
    const n = metrics.submittedResponseCount || 0
    return `${n} unit response${n === 1 ? '' : 's'} received · ${metrics.confirmedSlotCount || 0} slots confirmed · response targets not set`
  }
  const { respondedUnitCount, expectedUnitCount, confirmedSlotCount, pendingUnitCount } = metrics
  return `${respondedUnitCount} of ${expectedUnitCount} units responded · ${confirmedSlotCount} slots confirmed · ${pendingUnitCount} pending`
}
