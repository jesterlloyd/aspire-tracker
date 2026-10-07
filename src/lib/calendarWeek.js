// src/lib/calendarWeek.js
//
// ONE-CALENDAR-1: pure week arithmetic for the planner's Week view, shared by every calendar
// that offers one (Residency Calendar, the Unit Leader's At a Glance calendar). String dates
// only (YYYY-MM-DD), Sunday first, UTC used as arithmetic and never as a display zone, the same
// rules rotationCalendarDates.js keeps.

const PT = 'America/Los_Angeles'
const pad = n => String(n).padStart(2, '0')

/** Shift a YYYY-MM-DD by N days with no timezone drift. */
export function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/** The Sunday that starts the week holding `ymd`. */
export function weekStartOf(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return addDaysYmd(ymd, -dow)
}

/** The seven YYYY-MM-DD of a week. */
export function weekDays(weekStart) {
  return Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i))
}

/** "October 4 – 10, 2026", or "Sep 28 – Oct 4, 2026" across a month end. */
export function weekTitle(weekStart) {
  const end = addDaysYmd(weekStart, 6)
  const at = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
  const a = at(weekStart), b = at(end)
  const o = { timeZone: 'UTC' }
  if (a.getUTCMonth() === b.getUTCMonth()) {
    return `${a.toLocaleDateString('en-US', { month: 'long', day: 'numeric', ...o })} – ${b.getUTCDate()}, ${b.getUTCFullYear()}`
  }
  return `${a.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...o })} – ${b.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...o })}`
}

/** Minutes since midnight of an HH:MM string. */
export function minutesOf(hhmm) {
  if (!hhmm) return 0
  const [h, m] = String(hhmm).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** HH:MM from minutes since midnight. */
export function hhmmOf(minutes) {
  const c = Math.max(0, Math.round(minutes))
  return `${pad(Math.floor(c / 60) % 24)}:${pad(c % 60)}`
}

/** A timestamp's Pacific wall-clock date and time, as the week view places things. */
export function pacificParts(iso) {
  if (iso == null || iso === '') return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: PT, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d).map(x => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` }
}

/**
 * Where the week's scroller should open: the first timed entry of the week, a little above
 * it, else `fallbackHour`. The Interviews week used to open at 7 AM with the day's interviews
 * 300px below the fold, which read as "the week view shows nothing".
 */
export function weekScrollTop(items = [], { startHour = 7, hourHeight = 64, fallbackHour = 8, lead = 8 } = {}) {
  const starts = items.map(i => minutesOf(i.start)).filter(n => Number.isFinite(n))
  const first = starts.length ? Math.min(...starts) : fallbackHour * 60
  return Math.max(0, ((first - startHour * 60) / 60) * hourHeight - lead)
}

/** Timed items that overlap are laid side by side: returns groups of mutually overlapping items. */
export function overlapGroups(items = []) {
  const sorted = [...items].sort((a, b) => minutesOf(a.start) - minutesOf(b.start))
  const groups = []
  for (const item of sorted) {
    const last = groups[groups.length - 1]
    if (last && last.some(g => minutesOf(g.end) > minutesOf(item.start))) last.push(item)
    else groups.push([item])
  }
  return groups
}
