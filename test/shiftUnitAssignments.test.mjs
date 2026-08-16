// MULTI-UNIT-STUDENT-PLACEMENTS-2: shift-to-assignment recognition.
//
// Proves the date-window rules with Emi's REAL shape: PACU active primary plus
// a 6 NE additional assignment ENDED July 8 - August 6, 2026, and historical
// shift logs that say '6NE' without the space. Nothing here creates an
// assignment; the matcher is read-only by construction.
//
// Run: node --test test/shiftUnitAssignments.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { unitNameKey, sameUnitName, canonicalUnitName } from '../src/lib/unitNameCanon.js'
import { UNIT_CATALOG } from '../src/lib/unitCatalog.js'
import {
  assignmentAppliesToShift, shiftMatchesAssignments, SHIFT_VALIDATING_STATUSES,
} from '../api/lib/shiftUnitAssignments.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

// ── Canonicalization ────────────────────────────────────────────────────────

test("the confirmed variant: '6NE' is the canonical '6 NE', for comparison and display", () => {
  assert.equal(sameUnitName('6NE', '6 NE'), true)
  assert.equal(sameUnitName('6 ne', '6 NE'), true)
  assert.equal(sameUnitName(' 6 NE ', '6 NE'), true)
  assert.equal(canonicalUnitName('6NE'), '6 NE')
  assert.equal(canonicalUnitName('6ne'), '6 NE')
  assert.equal(canonicalUnitName('PACU'), 'PACU')
})

test('canonicalization NEVER merges two different catalog units', () => {
  const keys = UNIT_CATALOG.map((u) => unitNameKey(u.name))
  assert.equal(new Set(keys).size, UNIT_CATALOG.length,
    'every catalog unit keeps a distinct comparison key')
})

test('unknown names stay themselves (trimmed), and blanks never match anything', () => {
  assert.equal(canonicalUnitName('  Some Future Unit  '), 'Some Future Unit')
  assert.equal(canonicalUnitName(''), '')
  assert.equal(sameUnitName('', ''), false)
  assert.equal(sameUnitName('   ', '   '), false)
  assert.equal(sameUnitName(null, '6 NE'), false)
})

// ── Emi's exact shape ───────────────────────────────────────────────────────

const EMI_ASSIGNMENTS = [
  // Active primary, backfill-era: no dates recorded (open window).
  { unit_key: 'PACU', status: 'active', start_date: null, end_date: null },
  // The ended additional unit with the Owner-confirmed window.
  { unit_key: '6 NE', status: 'ended', start_date: '2026-07-08', end_date: '2026-08-06' },
]

test("EMI: her ended 6 NE assignment still validates shifts from July 8 through August 6", () => {
  for (const day of ['2026-07-08', '2026-07-20', '2026-08-06']) {
    assert.equal(shiftMatchesAssignments(EMI_ASSIGNMENTS, { shiftDate: day, unitName: '6 NE' }), true, day)
    // And the historical '6NE' spelling counts as the same unit.
    assert.equal(shiftMatchesAssignments(EMI_ASSIGNMENTS, { shiftDate: day, unitName: '6NE' }), true, `${day} as 6NE`)
  }
})

test('EMI: 6 NE shifts OUTSIDE the window do not validate', () => {
  for (const day of ['2026-07-07', '2026-08-07', '2026-09-01']) {
    assert.equal(shiftMatchesAssignments(EMI_ASSIGNMENTS, { shiftDate: day, unitName: '6 NE' }), false, day)
  }
})

test('EMI: PACU validates on any date (open backfill window), other units never do', () => {
  assert.equal(shiftMatchesAssignments(EMI_ASSIGNMENTS, { shiftDate: '2026-07-20', unitName: 'PACU' }), true)
  assert.equal(shiftMatchesAssignments(EMI_ASSIGNMENTS, { shiftDate: '2026-12-01', unitName: 'PACU' }), true)
  assert.equal(shiftMatchesAssignments(EMI_ASSIGNMENTS, { shiftDate: '2026-07-20', unitName: 'NICU' }), false)
})

// ── The general rules ───────────────────────────────────────────────────────

test('planned, active, and ended validate by date; removed validates NOTHING', () => {
  assert.deepEqual([...SHIFT_VALIDATING_STATUSES], ['planned', 'active', 'ended'])
  const base = { unit_key: '4 South', start_date: '2026-07-01', end_date: '2026-07-31' }
  for (const status of SHIFT_VALIDATING_STATUSES) {
    assert.equal(assignmentAppliesToShift({ ...base, status }, { shiftDate: '2026-07-15', unitName: '4 South' }), true, status)
  }
  assert.equal(assignmentAppliesToShift({ ...base, status: 'removed' }, { shiftDate: '2026-07-15', unitName: '4 South' }), false,
    'a removed assignment was wrong - it can never vouch for a shift')
})

test('single-sided windows are open on the missing side', () => {
  const openEnd = { unit_key: 'NICU', status: 'active', start_date: '2026-07-01', end_date: null }
  assert.equal(assignmentAppliesToShift(openEnd, { shiftDate: '2026-12-31', unitName: 'NICU' }), true)
  assert.equal(assignmentAppliesToShift(openEnd, { shiftDate: '2026-06-30', unitName: 'NICU' }), false)
  const openStart = { unit_key: 'NICU', status: 'ended', start_date: null, end_date: '2026-07-31' }
  assert.equal(assignmentAppliesToShift(openStart, { shiftDate: '2026-01-01', unitName: 'NICU' }), true)
  assert.equal(assignmentAppliesToShift(openStart, { shiftDate: '2026-08-01', unitName: 'NICU' }), false)
})

test('an unparseable shift date is vouched for only by an undated assignment', () => {
  const dated = { unit_key: 'PACU', status: 'active', start_date: '2026-07-01', end_date: null }
  const open = { unit_key: 'PACU', status: 'active', start_date: null, end_date: null }
  assert.equal(assignmentAppliesToShift(dated, { shiftDate: 'not-a-date', unitName: 'PACU' }), false)
  assert.equal(assignmentAppliesToShift(open, { shiftDate: 'not-a-date', unitName: 'PACU' }), true)
})

test('empty or missing assignment lists match nothing', () => {
  assert.equal(shiftMatchesAssignments([], { shiftDate: '2026-07-15', unitName: 'PACU' }), false)
  assert.equal(shiftMatchesAssignments(null, { shiftDate: '2026-07-15', unitName: 'PACU' }), false)
})

// ── The no-inference boundary ───────────────────────────────────────────────

test('THE MATCHER IS READ-ONLY: the module contains no insert, update, or delete', () => {
  const src = read('api/lib/shiftUnitAssignments.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(src, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/,
    'shift logs are evidence, never a source of assignments')
  assert.match(src, /\.select\(/, 'the loader reads and nothing else')
})
