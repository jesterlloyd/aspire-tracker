// ASPIRE-STUDENT-PORTAL: pure-logic tests for the portal date helpers. The bug
// was "Invalid Date to Invalid Date"; these lock in the null-safe behavior.
// Run: node --test test/portalDates.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { fmtDate, formatDateRange, placementWindow, TBC, ROTATION_SENTINEL } from '../src/lib/portalDates.js'

test('fmtDate never returns "Invalid Date"', async (t) => {
  await t.test('valid YYYY-MM-DD formats', () => {
    assert.equal(fmtDate('2026-07-14'), 'Jul 14, 2026')
    assert.equal(fmtDate('2026-07-14T09:30:00Z'), 'Jul 14, 2026')
  })
  await t.test('null / blank / malformed / overflow return null', () => {
    for (const v of [null, undefined, '', '   ', 'not a date', '2026-13-40', '2026-02-31']) {
      assert.equal(fmtDate(v), null, `fmtDate(${JSON.stringify(v)}) should be null`)
    }
  })
})

test('formatDateRange handles every combination', async (t) => {
  await t.test('both valid -> "A to B"', () => {
    assert.equal(formatDateRange('2026-07-01', '2026-08-15'), 'Jul 1, 2026 to Aug 15, 2026')
  })
  await t.test('only start valid -> "From A"', () => {
    assert.equal(formatDateRange('2026-07-01', null), 'From Jul 1, 2026')
    assert.equal(formatDateRange('2026-07-01', 'garbage'), 'From Jul 1, 2026')
  })
  await t.test('only end valid -> "Until B"', () => {
    assert.equal(formatDateRange('', '2026-08-15'), 'Until Aug 15, 2026')
  })
  await t.test('neither valid -> To be confirmed (never Invalid Date)', () => {
    assert.equal(formatDateRange(null, null), TBC)
    assert.equal(formatDateRange('bad', 'worse'), TBC)
    assert.equal(formatDateRange(ROTATION_SENTINEL, ROTATION_SENTINEL), TBC)
  })
  await t.test('sentinel on one side is treated as unavailable', () => {
    assert.equal(formatDateRange(ROTATION_SENTINEL, '2026-08-15'), 'Until Aug 15, 2026')
  })
})

test('placementWindow prefers the canonical rotation, then cohort, then term_dates', async (t) => {
  await t.test('canonical school-and-cohort rotation wins', () => {
    assert.equal(
      placementWindow(
        { start: '2026-08-24', end: '2026-10-20' },
        { start_date: '2026-09-01', end_date: '2026-12-15' },
        'Fall 2026',
      ),
      'Aug 24, 2026 to Oct 20, 2026',
    )
  })
  await t.test('falls back to the cohort range when no linked rotation is available', () => {
    assert.equal(placementWindow(null, { start_date: '2026-07-01', end_date: '2026-08-15' }, 'Summer 2026'), 'Jul 1, 2026 to Aug 15, 2026')
  })
  await t.test('falls back to a meaningful term_dates string', () => {
    assert.equal(placementWindow(null, { start_date: null, end_date: null }, 'Summer 2026'), 'Summer 2026')
  })
  await t.test('never surfaces an "invalid" term_dates value', () => {
    assert.equal(placementWindow(null, {}, 'Invalid Date to Invalid Date'), TBC)
    assert.equal(placementWindow(null, null, ''), TBC)
  })
})
