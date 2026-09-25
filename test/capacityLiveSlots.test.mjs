// CAPACITY-LIVE-SLOTS-1: Placement Capacity pills follow Set Up Units (units.total_slots), the same
// number Placement Snapshot counts, and name the original offer when staff changed it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { capacitySlotsFor } from '../src/lib/capacitySlots.js'

const overview = readFileSync(new URL('../src/components/OverviewTab.jsx', import.meta.url), 'utf8')

test('the pill reads the unit row, not the form offer', () => {
  const units = [{ id: 'ne', total_slots: 1 }, { id: 'nw', total_slots: 3 }, { id: 'scct', total_slots: 2 }]
  // The Owner's 2026-09-14 case: 6 NE 2 -> 1, 6 NW 2 -> 3.
  assert.deepEqual(capacitySlotsFor({ unit_id: 'ne', slots_offered: 2 }, units), { slots: 1, offered: 2, adjusted: true })
  assert.deepEqual(capacitySlotsFor({ unit_id: 'nw', slots_offered: 2 }, units), { slots: 3, offered: 2, adjusted: true })
  assert.deepEqual(capacitySlotsFor({ unit_id: 'scct', slots_offered: 2 }, units), { slots: 2, offered: 2, adjusted: false })
})

test('a missing unit row falls back to the offer; junk values count as zero', () => {
  assert.deepEqual(capacitySlotsFor({ unit_id: 'x', slots_offered: 4 }, []), { slots: 4, offered: 4, adjusted: false })
  assert.deepEqual(capacitySlotsFor({ unit_id: null, slots_offered: null }, [{ id: null, total_slots: 9 }]), { slots: 0, offered: 0, adjusted: false })
  assert.deepEqual(capacitySlotsFor({ unit_id: 'u', slots_offered: '2' }, [{ id: 'u', total_slots: null }]), { slots: 0, offered: 2, adjusted: true })
})

test('both the row pill and the division total use the live count', () => {
  assert.doesNotMatch(overview, /\{response\.slots_offered\} slot/)
  assert.doesNotMatch(overview, /r\.slots_offered \|\| 0/)
  assert.match(overview, /const slotInfo = capacitySlotsFor\(response, units\)/)
  assert.match(overview, /\{slotInfo\.slots\} slot\{slotInfo\.slots === 1 \? '' : 's'\}/)
  // HOME-1 (2026-09-24): a service line's total is now the Placement card's row, which sums
  // the units' own total_slots (Set Up Units), the same live number the pill reads.
  assert.match(readFileSync(new URL('../src/lib/home/placementSummaryModel.js', import.meta.url), 'utf8'), /r\.slots \+= n\(u\.total_slots\)/)
  assert.match(overview, /\{slotInfo\.offered\} offered/)
})
