// src/portal/unit/rotationCalendarDates.js
//
// UL-PHASE1: pure date helpers for the Rotation Activity Calendar.
//
// Separate from the component for two reasons: exporting non-components from a
// component file breaks fast refresh, and these are the only part of the calendar
// with logic worth testing directly.
//
// EVERYTHING HERE IS STRING-BASED. student_shift_logs.shift_date is TEXT in
// YYYY-MM-DD, written in Pacific time at check-in. Comparing those strings is
// correct and timezone-stable; passing them through new Date() is not, because a
// Unit Leader east of Pacific would see the previous day's shifts shift a column.
// UTC is used only as a calendar arithmetic device, never as a display timezone.

/** Pacific YYYY-MM-DD, matching how shift_date is stamped at check-in. */
export function pacificToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/** Shift a YYYY-MM-DD string by N days with no timezone drift. */
export function addDays(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

/**
 * A month grid of { ymd, inMonth }, Sunday first to match the main-app Interviews
 * calendar week start, padded to whole weeks. Returns 35 cells for most months and
 * 42 when the month needs a sixth week.
 */
export function monthGrid(year, monthIndex) {
  const first = new Date(Date.UTC(year, monthIndex, 1))
  const lead = first.getUTCDay()                // getUTCDay: 0=Sun, so Sunday needs no shift
  const start = new Date(first)
  start.setUTCDate(start.getUTCDate() - lead)
  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setUTCDate(d.getUTCDate() + i)
    cells.push({ ymd: d.toISOString().slice(0, 10), inMonth: d.getUTCMonth() === monthIndex })
    if (i >= 27 && (i + 1) % 7 === 0 && d.getUTCMonth() !== monthIndex) break
  }
  return cells
}

/** Month label for the header, rendered in UTC so it cannot drift a day. */
export function monthLabel(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex, 1))
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** Group shifts by their shift_date string. */
export function groupByDay(shifts = []) {
  const map = new Map()
  for (const s of shifts) {
    if (!map.has(s.shift_date)) map.set(s.shift_date, [])
    map.get(s.shift_date).push(s)
  }
  return map
}
