// ASPIRE-WELCOME-CALENDAR-POLISH-5: US federal holidays, computed CLIENT-SIDE. Pure date math - no
// fetch, no API, no Supabase, no persistence. Returns read-only descriptors the Calendar + Aggregate
// render as non-editable chips (they never go through /api/aspire-events).
//
// Columbus Day is labeled "Indigenous Peoples' Day" (neutral, increasingly standard) - reported.
// Federal observance rule: a fixed-date holiday on Saturday is observed the Friday before; on Sunday,
// the Monday after. Both the actual date and (when it's a weekend) the observed date are returned.

const WD = { SUN: 0, MON: 1, THU: 4 }

function ymd(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// Day-of-month for the nth `weekday` (0=Sun…6=Sat) of month `m` (0-indexed).
function nthWeekday(year, m, weekday, n) {
  const firstDow = new Date(year, m, 1).getDay()
  return 1 + ((weekday - firstDow + 7) % 7) + (n - 1) * 7
}
// Day-of-month for the LAST `weekday` of month `m`.
function lastWeekday(year, m, weekday) {
  const last = new Date(year, m + 1, 0).getDate()
  const lastDow = new Date(year, m, last).getDay()
  return last - ((lastDow - weekday + 7) % 7)
}

// Federal observed shift for a fixed-date holiday: Sat → Fri before, Sun → Mon after, else none.
function observed(dateObj) {
  const dow = dateObj.getDay()
  if (dow === 6) { const d = new Date(dateObj); d.setDate(d.getDate() - 1); return d }
  if (dow === WD.SUN) { const d = new Date(dateObj); d.setDate(d.getDate() + 1); return d }
  return null
}

// All US federal holidays for one calendar year → [{ date:'YYYY-MM-DD', name, observed:boolean }].
export function getUsHolidaysForYear(year) {
  const out = []
  const push = (date, name, isObs = false) => out.push({ date, name, observed: isObs })

  // Fixed-date holidays (with weekend observance).
  const fixed = [
    { m: 0,  d: 1,  name: "New Year's Day" },
    { m: 5,  d: 19, name: 'Juneteenth' },
    { m: 6,  d: 4,  name: 'Independence Day' },
    { m: 10, d: 11, name: 'Veterans Day' },
    { m: 11, d: 25, name: 'Christmas Day' },
  ]
  fixed.forEach(({ m, d, name }) => {
    push(ymd(year, m, d), name, false)
    const obs = observed(new Date(year, m, d))
    if (obs) push(ymd(obs.getFullYear(), obs.getMonth(), obs.getDate()), `${name} (observed)`, true)
  })

  // Floating (nth-weekday) holidays - always a weekday, so no observance shift.
  push(ymd(year, 0,  nthWeekday(year, 0,  WD.MON, 3)), 'Martin Luther King Jr. Day')
  push(ymd(year, 1,  nthWeekday(year, 1,  WD.MON, 3)), "Presidents' Day")
  push(ymd(year, 4,  lastWeekday(year, 4, WD.MON)),    'Memorial Day')
  push(ymd(year, 8,  nthWeekday(year, 8,  WD.MON, 1)), 'Labor Day')
  push(ymd(year, 9,  nthWeekday(year, 9,  WD.MON, 2)), "Indigenous Peoples' Day")
  push(ymd(year, 10, nthWeekday(year, 10, WD.THU, 4)), 'Thanksgiving Day')

  return out
}

// Holidays whose (actual or observed) date falls within ['YYYY-MM-DD' start, end] inclusive.
// Computes a ±1 year window so an observed New Year's (which can land on Dec 31 of the prior year)
// is never missed near a range boundary.
export function getUsHolidaysForRange(startStr, endStr) {
  const startY = Number(startStr.slice(0, 4))
  const endY = Number(endStr.slice(0, 4))
  const all = []
  for (let y = startY - 1; y <= endY + 1; y++) all.push(...getUsHolidaysForYear(y))
  const seen = new Set()
  return all
    .filter(h => h.date >= startStr && h.date <= endStr)
    .filter(h => { const k = `${h.date}|${h.name}`; if (seen.has(k)) return false; seen.add(k); return true })
    .sort((a, b) => a.date.localeCompare(b.date))
}

// Convenience: holidays on a single local date string.
export function holidaysOnDate(dateStr) {
  return getUsHolidaysForRange(dateStr, dateStr)
}
