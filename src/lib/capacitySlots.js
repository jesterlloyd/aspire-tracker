// CAPACITY-LIVE-SLOTS-1 (2026-09-14): Placement Capacity shows the unit's LIVE slot count.
//
// A unit leader's form response records what they offered (unit_cohort_responses.slots_offered).
// Staff can then adjust the unit's capacity in Set Up Units, which writes units.total_slots, the
// number Placement Snapshot already counts. The capacity pills read the response, so an adjustment
// changed the Snapshot and left every pill stale. The response stays the leader's record; the pill
// shows the unit row, and says what was originally offered when the two differ.

import { canonicalUnitKey } from './canonicalUnit.js'
import { RESPONDED_STATUSES } from './unitResponseMetrics.js'

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

// HOSTING-STATUS-SETUP-1 (2026-09-14): Hosting / Not Hosting / Pending also follow Set Up Units.
//
// Set Up Units writes units.is_participating, which Placement Snapshot counts. Each capacity row
// gets a capacity_status the panel reads; response_status stays exactly as the leader submitted
// it (View response still shows their form).
//   unit participating                          -> hosting (note when the form did not say so)
//   unit not participating, form said hosting   -> not_hosting, "Removed in Set Up Units"
//   unit not participating, form declined/pending -> as the form says
//   no unit row                                 -> as the form says
// A participating unit with no capacity row at all (added in Set Up Units, never responded) gets a
// display-only hosting row so the Hosting count equals the Snapshot's unit count.
export const SETUP_ADDED_NOTE = 'Hosting set in Set Up Units'
export const SETUP_REMOVED_NOTE = 'Removed in Set Up Units'

const FORM_STATUS = {
  submitted_hosting: 'hosting',
  submitted_not_hosting: 'not_hosting',
  pending: 'pending',
}

export function applyUnitSetup(rows = [], units = []) {
  const byId = new Map()
  const byKey = new Map()
  for (const u of units) {
    if (!u) continue
    if (u.id != null) byId.set(u.id, u)
    const k = canonicalUnitKey(u.unit_name)
    if (k && !byKey.has(k)) byKey.set(k, u)
  }

  const used = new Set()
  const out = rows.map(r => {
    const unit = (r.unit_id != null && byId.get(r.unit_id)) || byKey.get(canonicalUnitKey(r.unit_name)) || null
    const formStatus = FORM_STATUS[r.response_status] || 'pending'
    const submitted = RESPONDED_STATUSES.has(r.response_status)
    let capacity_status = formStatus
    let setup_note = null
    if (unit) {
      used.add(unit.id)
      if (unit.is_participating) {
        capacity_status = 'hosting'
        if (formStatus !== 'hosting') setup_note = SETUP_ADDED_NOTE
      } else if (formStatus === 'hosting') {
        capacity_status = 'not_hosting'
        setup_note = SETUP_REMOVED_NOTE
      }
    }
    return { ...r, unit_id: r.unit_id ?? unit?.id ?? null, capacity_status, setup_note, submitted }
  })

  for (const u of units) {
    if (!u?.is_participating || used.has(u.id)) continue
    out.push({
      id: `setup-unit-${u.id}`, unit_id: u.id, unit_name: u.unit_name,
      response_status: null, slots_offered: null, synthetic: true,
      capacity_status: 'hosting', setup_note: SETUP_ADDED_NOTE, submitted: false,
    })
  }
  return out
}
