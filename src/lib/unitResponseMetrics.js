// Cohort-scoped unit response metrics for the Placement Capacity summary (At a Glance).
//
// Pure and shared. Both `units` and `responses` must already be scoped to ONE cohort (the callers
// query them by cohort_id), so there is no cross-cohort leakage here. See
// docs/product/UNIT_RESPONSE_COUNT_SEMANTICS.md for the definitions.

// A distinct expected unit counts as RESPONDED only for these submitted states. A decline
// (submitted_not_hosting / zero slots) is a valid response. `pending`, drafts, missing rows, and any
// other state are NOT responded.
export const RESPONDED_STATUSES = new Set(['submitted_hosting', 'submitted_not_hosting'])

// Deterministic recency for the (defensive) case of more than one row per unit. The table is unique on
// (cohort_id, unit_id), so normally there is exactly one; latest by last_updated_at then submitted_at.
function responseTime(r) {
  const t = Date.parse(r?.last_updated_at || r?.submitted_at || '')
  return Number.isNaN(t) ? 0 : t
}

// Returns metrics with left-join semantics from EXPECTED units to their canonical response:
//   { expectedUnitCount, respondedUnitCount, pendingUnitCount, confirmedSlotCount,
//     expectedUnitIds, respondedUnitIds, pendingUnitIds }
// - distinct by canonical unit id (never display name; aliases resolve to one unit)
// - a unit with no response stays expected and counts as pending
// - pending = max(0, expected - responded); responded never exceeds expected; slots never negative
export function computeUnitResponseMetrics({ units = [], responses = [] } = {}) {
  // One canonical response per unit id.
  const responseByUnitId = new Map()
  for (const r of responses) {
    if (!r || r.unit_id == null) continue
    const prev = responseByUnitId.get(r.unit_id)
    if (!prev || responseTime(r) >= responseTime(prev)) responseByUnitId.set(r.unit_id, r)
  }

  // Expected = distinct cohort units in the request cycle: currently participating (rostered) OR has a
  // response row (was clearly in the cycle, including declines that flipped is_participating to false).
  const expected = new Map()
  for (const u of units) {
    if (!u || u.id == null || expected.has(u.id)) continue
    if (u.is_participating === true || responseByUnitId.has(u.id)) expected.set(u.id, u)
  }

  const expectedUnitIds = [...expected.keys()]
  const respondedUnitIds = []
  let confirmedSlotCount = 0
  for (const id of expectedUnitIds) {
    const r = responseByUnitId.get(id)
    if (r && RESPONDED_STATUSES.has(r.response_status)) {
      respondedUnitIds.push(id)
      if (r.response_status === 'submitted_hosting') {
        const n = Number(r.slots_offered)
        confirmedSlotCount += Number.isFinite(n) && n > 0 ? n : 0
      }
    }
  }

  const expectedUnitCount = expectedUnitIds.length
  const respondedUnitCount = Math.min(respondedUnitIds.length, expectedUnitCount)
  const pendingUnitCount = Math.max(0, expectedUnitCount - respondedUnitCount)
  const respondedSet = new Set(respondedUnitIds)
  const pendingUnitIds = expectedUnitIds.filter(id => !respondedSet.has(id))

  return {
    expectedUnitCount,
    respondedUnitCount,
    pendingUnitCount,
    confirmedSlotCount,
    expectedUnitIds,
    respondedUnitIds,
    pendingUnitIds,
  }
}

// Concise, accurate summary line. Empty cohorts get a clear message instead of "0 of 0".
export function formatUnitResponseSummary(metrics) {
  if (!metrics || metrics.expectedUnitCount === 0) {
    return 'No unit response requests are configured for this cohort.'
  }
  const { respondedUnitCount, expectedUnitCount, confirmedSlotCount, pendingUnitCount } = metrics
  return `${respondedUnitCount} of ${expectedUnitCount} units responded · ${confirmedSlotCount} slots confirmed · ${pendingUnitCount} pending`
}
