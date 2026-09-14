// CAPACITY-LIVE-SLOTS-1 (2026-09-14): Placement Capacity shows the unit's LIVE slot count.
//
// A unit leader's form response records what they offered (unit_cohort_responses.slots_offered).
// Staff can then adjust the unit's capacity in Set Up Units, which writes units.total_slots, the
// number Placement Snapshot already counts. The capacity pills read the response, so an adjustment
// changed the Snapshot and left every pill stale. The response stays the leader's record; the pill
// shows the unit row, and says what was originally offered when the two differ.

const toCount = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// response: a unit_cohort_responses row; units: the cohort's units rows.
// Falls back to the offer when the unit row is missing (units are created lazily on submission).
export function capacitySlotsFor(response, units = []) {
  const offered = toCount(response?.slots_offered)
  const unit = response?.unit_id != null ? units.find(u => u.id === response.unit_id) : null
  if (!unit) return { slots: offered, offered, adjusted: false }
  const slots = toCount(unit.total_slots)
  return { slots, offered, adjusted: slots !== offered }
}
