// test/capacityRebalance.test.mjs
//
// CAPACITY-REBALANCE-1: Fall 2026 keeps only the slots it used; every unused
// Fall slot becomes Winter 2027's offer, replacing the 2026-08-29 carry-over.
// Pins the Owner's decisions of 2026-09-10 and the numbers from discovery D0.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(new URL(
  '../supabase/migrations/20260910000000_fall_winter_capacity_rebalance.sql', import.meta.url), 'utf8')
const body = sql.slice(sql.indexOf('DO $$'), sql.indexOf('END $$;'))

const pinned = (name) => {
  const m = sql.match(new RegExp(`${name} jsonb := '(\\{[\\s\\S]*?\\})'::jsonb`))
  assert.ok(m, `${name} literal found`)
  return JSON.parse(m[1])
}
const fBefore = pinned('f_before')
const wBefore = pinned('w_before')
const wAfter = pinned('w_after')
const sum = (obj, f) => Object.values(obj).reduce((s, v) => s + f(v), 0)

test('Fall as discovered: 20 hosting units, 33 slots, 19 placed; after, 14 units and 19 slots', () => {
  assert.equal(Object.keys(fBefore).length, 20)
  assert.equal(sum(fBefore, v => v.total), 33)
  assert.equal(sum(fBefore, v => v.matched), 19)
  const after = Object.values(fBefore).filter(v => v.matched > 0)
  assert.equal(after.length, 14)
  assert.equal(after.reduce((s, v) => s + v.matched, 0), 19)
  const leaving = Object.values(fBefore).filter(v => v.matched === 0).map(v => v.name).sort()
  assert.deepEqual(leaving, ['3 SCCT', '4 South', '5 North', '7 South', '8 North', 'PACU'])
  assert.match(body, /IF v_n <> 20 OR v_slots <> 33 THEN/)
  assert.match(body, /IF v_n <> 14 OR v_slots <> 19 THEN/)
})

test('Winter becomes exactly Fall\'s unused slots, unit by unit', () => {
  assert.equal(Object.keys(wBefore).length, 18)
  assert.equal(sum(wBefore, v => v.slots), 24)
  assert.equal(Object.keys(wAfter).length, 10)
  assert.equal(sum(wAfter, v => v.slots), 14)
  // Fall's unused per unit name equals the Winter plan per unit name.
  const unused = Object.fromEntries(Object.values(fBefore)
    .filter(v => v.total > v.matched).map(v => [v.name, v.total - v.matched]))
  const plan = Object.fromEntries(Object.values(wAfter).map(v => [v.name, v.slots]))
  assert.deepEqual(plan, unused)
  // Every Winter unit that stays keeps its id; the ones Fall used leave.
  for (const id of Object.keys(wAfter)) assert.ok(id in wBefore, `${wAfter[id].name} is an existing Winter row`)
  const leaving = Object.entries(wBefore).filter(([id]) => !(id in wAfter)).map(([, v]) => v.name).sort()
  assert.deepEqual(leaving, ['3 South Short Stay', '5 SCCT', '6 NE', '6 NW', '7 SCCT', '8 SCCT', 'NICU', 'Pediatrics'])
  // The plan is re-derived from Fall in-lock, not trusted.
  assert.match(body, /Winter "%" computes to % slot\(s\) from Fall, but the pinned plan says %/)
  assert.match(body, /IF v_n <> 10 OR v_slots <> 14 THEN/)
})

test('a unit leaves a cohort the way Set Up Units does it, never by DELETE', () => {
  assert.doesNotMatch(sql, /DELETE FROM units/)
  assert.match(body, /UPDATE units SET is_participating = false, total_slots = 0, slots_remaining = 0\s*\n\s*WHERE id = ANY \(v_leave_fall\)/)
  assert.match(body, /UPDATE units SET is_participating = false, total_slots = 0, slots_remaining = 0\s*\n\s*WHERE id = ANY \(v_leave_winter\)/)
  // Its response goes (Placement Capacity lists every response row) and its targets deactivate.
  assert.match(body, /DELETE FROM unit_cohort_responses WHERE unit_id = ANY \(v_leave_fall\)/)
  assert.match(body, /UPDATE cohort_unit_response_targets SET is_active = false, removed_at = now\(\)/)
  assert.doesNotMatch(sql, /DELETE FROM cohort_unit_response_targets/)
})

test('both stores change together: units and the response ledger', () => {
  assert.match(body, /SET slots_offered = \(SELECT x\.total_slots FROM units x WHERE x\.id = r\.unit_id\)[\s\S]*?WHERE r\.unit_id = ANY \(v_shrink_fall\)/)
  assert.match(body, /SET slots_offered = \(SELECT x\.total_slots FROM units x WHERE x\.id = r\.unit_id\)[\s\S]*?WHERE r\.unit_id = ANY \(v_resize_winter\)/)
  assert.match(body, /% Fall hosting responses agree with their units, expected 14/)
  assert.match(body, /% Winter hosting responses agree with their units, expected 10/)
})

test('fails closed: locks first, refuses drift, a second run, and cascading deletes', () => {
  const lock = body.indexOf('FOR UPDATE')
  const firstWrite = body.search(/\n\s*(UPDATE|DELETE|INSERT)\b/)
  assert.ok(lock > 0 && lock < firstWrite, 'rows are locked before any write')
  assert.match(body, /this rebalance already ran/)
  assert.match(body, /confrelid = 'public\.unit_cohort_responses'::regclass/)
  assert.match(body, /match row\(s\) sit on units leaving Fall/)
  assert.match(body, /live assignment\(s\) sit on units leaving Fall/)
  assert.match(body, /student\(s\) are placed on Winter units/)
  assert.match(body, /ledger is inconsistent/)
})

test('every changed row is backed up before the first write, somewhere the API cannot read', () => {
  assert.match(sql, /REVOKE ALL ON SCHEMA ops_backup FROM PUBLIC, anon, authenticated;/)
  assert.match(sql, /REVOKE ALL ON ops_backup\.capacity_rebalance_20260910 FROM PUBLIC, anon, authenticated;/)
  const backup = body.indexOf('INSERT INTO ops_backup.capacity_rebalance_20260910')
  const firstChange = body.search(/\n\s*UPDATE units\b/)
  assert.ok(backup > 0 && backup < firstChange, 'the backup precedes the first change')
  assert.match(body, /backup holds % unit rows, expected 19/)
  // Rollback and verification ship with the script.
  assert.match(sql, /── Rollback/)
  assert.match(sql, /jsonb_populate_record\(NULL::unit_cohort_responses, b\.row_data\)/)
  for (const v of ['V1', 'V2', 'V3', 'V4']) assert.match(sql, new RegExp(`-- ${v} `))
})

test('student picks are named as untouched, and the script is in the Owner SQL gate ledger', () => {
  assert.match(sql, /Student picks are NOT touched/)
  assert.doesNotMatch(body, /UPDATE students/)
  assert.match(read('docs/security/OWNER_SQL_GATE.md'), /\| 20260910000000_fall_winter_capacity_rebalance\.sql \| CAPACITY-REBALANCE-1, 73e4c1d4, 2026-09-10 \| \*\*APPLIED, confirmed 2026-09-10\*\*/)
})

function read(p) { return readFileSync(new URL(`../${p}`, import.meta.url), 'utf8') }
