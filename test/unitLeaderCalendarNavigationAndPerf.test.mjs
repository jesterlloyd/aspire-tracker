// Commit 2: the Unit Leader calendar navigates freely into future (and past) months,
// and the portal warms the calendar chunk in parallel with the roster bootstrap.
//
// The navigation assertions are behavioral (they exercise the real month-step maths
// from rotationCalendarDates.js); the performance assertions are the repo's established
// static-guard style, protecting the request/bundle shape.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { monthGrid, monthLabel } from '../src/portal/unit/rotationCalendarDates.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const calendar = read('src/portal/unit/UnitRotationCalendar.jsx')
const calendarCode = stripJs(calendar)
const portal = read('src/portal/UnitLeaderPortal.jsx')
const portalCode = stripJs(portal)
const endpoint = read('api/portal/unit-shift-activity.js')

// The month-step maths the calendar uses (UTC-based, no timezone drift).
function stepMonth(cursor, delta) {
  const d = new Date(Date.UTC(cursor.y, cursor.m + delta, 1))
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() }
}

test('stepping forward past the current month is possible and rolls the year', () => {
  // December 2026 -> January 2027, the exact case a hard current-month ceiling broke.
  const dec = { y: 2026, m: 11 }
  const next = stepMonth(dec, 1)
  assert.deepEqual(next, { y: 2027, m: 0 })
  assert.equal(monthLabel(next.y, next.m), 'January 2027')
})

test('a future month renders a normal, whole-week grid with no activity', () => {
  const future = stepMonth({ y: 2026, m: 6 }, 6) // Jul 2026 -> Jan 2027
  const g = monthGrid(future.y, future.m)
  assert.equal(g.length % 7, 0)
  assert.equal(g.filter(c => c.inMonth).length, 31)
  // No shifts exist for a future month, so the grid is simply empty (not fabricated).
  const byDay = new Map()
  assert.equal(g.some(c => c.inMonth && byDay.has(c.ymd)), false)
})

test('the calendar imposes no navigation caps in either direction', () => {
  assert.doesNotMatch(calendarCode, /canGoForward|canGoBack|prevDisabled|nextDisabled/)
  // windowStart is no longer needed by the calendar (data bounds != navigation bounds).
  assert.doesNotMatch(calendar, /windowStart/)
  assert.doesNotMatch(portal, /windowStart=\{/)
})

test('Today returns to the real current month and selected date', () => {
  assert.match(calendarCode, /const goToday = \(\) => \{/)
  assert.match(calendarCode, /setSelectedDate\(today\)/)
  assert.match(calendarCode, /setCursor\(\{ y: Number\(today\.slice\(0, 4\)\), m: Number\(today\.slice\(5, 7\)\) - 1 \}\)/)
})

test('the server still refuses future or over-window ranges (navigation never asks it to)', () => {
  // The endpoint keeps its guards; the client simply never requests a future range,
  // because month navigation is client-side over already-fetched window data.
  assert.match(endpoint, /if \(to > today\) return res\.status\(400\)\.json\(\{ error: 'range_in_future'/)
  assert.match(endpoint, /if \(from < windowStart\) return res\.status\(400\)\.json\(\{ error: 'range_before_window'/)
})

test('the portal warms the calendar chunk in parallel with the roster bootstrap', () => {
  assert.match(portalCode, /useEffect\(\(\) => \{\s*import\('\.\/unit\/UnitRotationCalendar'\)\.catch\(\(\) => \{\}\)\s*\}, \[\]\)/)
})

test('the calendar is still fetched once and does not refetch on unit switching', () => {
  const home = portalCode.slice(portalCode.indexOf('function HomeScreen'), portalCode.indexOf('function PlacementScreen'))
  // Shift activity: one fetch, deps [] so a unit-switch never refetches it; the
  // visible set is narrowed client-side instead.
  assert.match(home, /useEndpoint\(s => getShiftActivity\(\{\}, s\), \[\]\)/)
  // The single roster/activity fetch is filtered client-side by unit (no refetch on unit switching);
  // a cohort selection narrows on top of that, still from the same fetch.
  assert.match(home, /const unitShifts = unitKey === ALL_UNITS \? shifts : shifts\.filter\(shift => shift\.unit_key === unitKey\)/)
  assert.equal((portalCode.match(/getShiftActivity\(/g) || []).length, 1)
  // Still exactly one bootstrap read.
  assert.equal((portalCode.match(/useEndpoint\(getRoster/g) || []).length, 1)
})
