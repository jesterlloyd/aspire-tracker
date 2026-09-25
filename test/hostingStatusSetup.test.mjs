// HOSTING-STATUS-SETUP-1: Placement Capacity's Hosting / Not Hosting / Pending follow Set Up Units
// (units.is_participating), the same set Placement Snapshot counts. The form response is never rewritten.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyUnitSetup, SETUP_ADDED_NOTE, SETUP_REMOVED_NOTE } from '../src/lib/capacitySlots.js'

const overview = readFileSync(new URL('../src/components/OverviewTab.jsx', import.meta.url), 'utf8')

const units = [
  { id: 'u1', unit_name: '6 NE', is_participating: true },
  { id: 'u2', unit_name: '4 North', is_participating: false },
  { id: 'u3', unit_name: '5 South', is_participating: true },
  { id: 'u4', unit_name: '8 North', is_participating: false },
  { id: 'u5', unit_name: 'PACU', is_participating: true },
]
const byName = (rows) => Object.fromEntries(rows.map(r => [r.unit_name, r]))

test('a participating unit is hosting; a hosting offer removed in Set Up Units is not', () => {
  const rows = byName(applyUnitSetup([
    { id: 'r1', unit_id: 'u1', unit_name: '6 NE', response_status: 'submitted_hosting', slots_offered: 2 },
    { id: 'r2', unit_id: 'u2', unit_name: '4 North', response_status: 'submitted_hosting', slots_offered: 3 },
  ], units))
  assert.equal(rows['6 NE'].capacity_status, 'hosting')
  assert.equal(rows['6 NE'].setup_note, null)
  assert.equal(rows['4 North'].capacity_status, 'not_hosting')
  assert.equal(rows['4 North'].setup_note, SETUP_REMOVED_NOTE)
  // The leader's record is untouched.
  assert.equal(rows['4 North'].response_status, 'submitted_hosting')
  assert.equal(rows['4 North'].submitted, true)
})

test('a unit hosted in Set Up Units over a decline or a pending target shows as hosting, with a note', () => {
  const rows = byName(applyUnitSetup([
    { id: 'r3', unit_id: 'u3', unit_name: '5 South', response_status: 'submitted_not_hosting' },
    // A synthetic pending target has no unit_id; it matches by canonical name.
    { id: 'pending-target-pacu', unit_id: null, unit_name: 'PACU', response_status: 'pending', synthetic: true },
  ], units))
  assert.equal(rows['5 South'].capacity_status, 'hosting')
  assert.equal(rows['5 South'].setup_note, SETUP_ADDED_NOTE)
  assert.equal(rows.PACU.capacity_status, 'hosting')
  assert.equal(rows.PACU.unit_id, 'u5')
  assert.equal(rows.PACU.submitted, false)
})

test('declines and pending rows for non-participating or unknown units keep the form status', () => {
  const rows = byName(applyUnitSetup([
    { id: 'r4', unit_id: 'u4', unit_name: '8 North', response_status: 'submitted_not_hosting' },
    { id: 'p', unit_id: null, unit_name: '7 South', response_status: 'pending', synthetic: true },
  ], units))
  assert.equal(rows['8 North'].capacity_status, 'not_hosting')
  assert.equal(rows['8 North'].setup_note, null)
  assert.equal(rows['7 South'].capacity_status, 'pending')
})

test('a participating unit with no row gets a display-only hosting row, so Hosting equals the Snapshot', () => {
  const out = applyUnitSetup([{ id: 'r1', unit_id: 'u1', unit_name: '6 NE', response_status: 'submitted_hosting' }], units)
  const hosting = out.filter(r => r.capacity_status === 'hosting').map(r => r.unit_name).sort()
  assert.deepEqual(hosting, ['5 South', '6 NE', 'PACU'])
  assert.equal(hosting.length, units.filter(u => u.is_participating).length)
  const added = out.find(r => r.unit_name === 'PACU')
  assert.deepEqual([added.synthetic, added.submitted, added.setup_note], [true, false, SETUP_ADDED_NOTE])
})

test('every capacity surface reads capacity_status', () => {
  assert.match(overview, /const capacityView = useMemo\(\(\) => applyUnitSetup\(capacityRows, units\), \[capacityRows, units\]\)/)
  assert.match(overview, /const status    = response\.capacity_status/)
  // HOME-1 (2026-09-24): the division-grouped panel became the Placement card's service-line
  // rows; the status filter and every unit row still read capacity_status.
  assert.match(overview, /capacityView\.filter\(r => r\.capacity_status === unitStatusFilter\)/)
  assert.match(overview, /capacityView\.filter\(r => r\.capacity_status === 'pending'\)/)
  assert.match(overview, /count: n\('hosting'\)/)
  assert.match(overview, /const rows = capacityFiltered\.filter\(/)
  // View response only when the leader actually submitted.
  assert.match(overview, /\{response\.submitted && \(\s*<button\s*onClick=\{\(e\) => \{ e\.stopPropagation\(\); onView\?\.\(response\) \}\}/)
})
