// ASPIRE-EVENTS-CALENDAR-2B: shared config/helpers for custom ASPIRE events (distinct from
// interview slots/availability). Pure config + pure functions - no data/API/JSX. The gated endpoint
// api/aspire-events.js keeps its OWN copies of the allow-lists (api/ imports don't resolve safely at
// the Vercel runtime), so keep the two in sync if the lists ever change.

// Event types - each carries a distinct, non-interview color so ASPIRE events never read like a
// booked/available/blocked interview slot. Order = the modal's picker order.
export const ASPIRE_EVENT_TYPES = [
  { value: 'ngrp_open',        label: 'NGRP Application Opens',  color: '#0E7490' },
  { value: 'ngrp_deadline',    label: 'NGRP Application Deadline', color: '#B91C1C' },
  { value: 'town_hall',        label: 'Town Hall',              color: '#7C3AED' },
  { value: 'interview_window', label: 'Interview Window',       color: '#1D2567' },
  { value: 'orientation',      label: 'Orientation',            color: '#C2410C' },
  { value: 'milestone',        label: 'ASPIRE Milestone',       color: '#9333EA' },
  { value: 'deadline',         label: 'Deadline',               color: '#DC2626' },
  { value: 'rotation',         label: 'Rotation Milestone',     color: '#0891B2' },
  { value: 'reminder',         label: 'Reminder',               color: '#6B7280' },
  { value: 'birthday',         label: 'Birthday',               color: '#C2410C' },
  { value: 'custom',           label: 'Custom Event',           color: '#475569' },
]

export const EVENT_TYPE_VALUES = ASPIRE_EVENT_TYPES.map(t => t.value)

// Recurrence: the smallest canonical set (no custom builder). Order = the modal's picker order.
export const RECURRENCE_OPTIONS = [
  { value: 'none',     label: 'Does not repeat' },
  { value: 'weekly',   label: 'Weekly' },
  { value: 'monthly',  label: 'Monthly' },
  { value: 'annually', label: 'Annually' },
]
export const RECURRENCE_VALUES = RECURRENCE_OPTIONS.map(o => o.value)

// Event types that default to an annual all-day series when chosen (the user may still change it).
export const ANNUAL_ALLDAY_TYPES = new Set(['birthday'])

export const AUDIENCE_OPTIONS = [
  { value: 'internal', label: 'Internal team' },
  { value: 'all',      label: 'Everyone' },
  { value: 'cohort',   label: 'Cohort' },
  { value: 'school',   label: 'School' },
]
export const AUDIENCE_VALUES = AUDIENCE_OPTIONS.map(a => a.value)

const TYPE_MAP = Object.fromEntries(ASPIRE_EVENT_TYPES.map(t => [t.value, t]))

export function eventTypeLabel(type) {
  return TYPE_MAP[type]?.label || 'Event'
}

// A custom color override (validated #RRGGBB) wins; otherwise the type's default color.
export function eventColor(ev) {
  if (ev?.color && /^#[0-9A-Fa-f]{6}$/.test(ev.color)) return ev.color
  return TYPE_MAP[ev?.event_type]?.color || '#475569'
}

// 'YYYY-MM-DD' from a timestamptz string, in LOCAL time (matches the calendar's toLocalDateStr).
export function localDateStr(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function localTimeLabel(ts) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// Human "when" line for chips/detail. All-day → "All day"; point event → start time; ranged → range.
export function formatEventWhen(ev) {
  if (!ev?.start_at) return ''
  if (ev.all_day) return 'All day'
  const start = localTimeLabel(ev.start_at)
  if (!ev.end_at) return start
  const sameDay = localDateStr(ev.start_at) === localDateStr(ev.end_at)
  const end = localTimeLabel(ev.end_at)
  return sameDay ? `${start} – ${end}` : `${start} →`
}

// 'YYYY-MM-DD' -> { y, mo (1-12), d } or null.
function parseYmd(s) {
  const m = typeof s === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null
  return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null
}
// Local weekday (0-6) for a YMD (noon-local via the Y/M/D constructor avoids DST edges).
function weekdayOf(ymd) {
  const p = parseYmd(ymd)
  return p ? new Date(p.y, p.mo - 1, p.d).getDay() : -1
}
const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

// Whether a recurring event that STARTED on startYmd has an occurrence on dateStr. Deterministic:
//   weekly   -> same weekday (every 7 days).
//   monthly  -> same day-of-month; a month lacking that day (e.g. the 31st, or the 30th in Feb) simply
//               has NO occurrence that month (never a shifted date).
//   annually -> same month + day; Feb 29 -> Feb 28 in non-leap years (Feb 29 in leap years).
// Interval is always 1 (no custom builder). Assumes dateStr >= startYmd (the caller checks bounds).
export function matchesRecurrence(repeats, startYmd, dateStr) {
  const s = parseYmd(startYmd), t = parseYmd(dateStr)
  if (!s || !t) return false
  if (repeats === 'weekly') return weekdayOf(startYmd) === weekdayOf(dateStr)
  if (repeats === 'monthly') return t.d === s.d
  if (repeats === 'annually') {
    if (s.mo === 2 && s.d === 29) return t.mo === 2 && (isLeapYear(t.y) ? t.d === 29 : t.d === 28)
    return t.mo === s.mo && t.d === s.d
  }
  return false
}

// Does an event touch a given 'YYYY-MM-DD' local date?
//   One-time (recurrence 'none' or absent/unknown -> fail closed to one-time): point event (start only)
//     or multi-day range (start_at .. end_at inclusive of both calendar days).
//   Recurring: on/after the local start date, on/before recurrence_end (when set), and matching the
//     cadence. Occurrences are computed here at read time (no materialized rows, no duplicates), so a
//     recurring parent renders on each occurrence day within whatever range the caller iterates.
export function eventOnDate(ev, dateStr) {
  if (!ev?.start_at) return false
  const startDay = localDateStr(ev.start_at)
  const repeats = ev.recurrence || 'none'
  if (repeats === 'none' || !RECURRENCE_VALUES.includes(repeats)) {
    const endDay = ev.end_at ? localDateStr(ev.end_at) : startDay
    return dateStr >= startDay && dateStr <= endDay
  }
  if (dateStr < startDay) return false
  const recEnd = ev.recurrence_end || null
  if (recEnd && dateStr > recEnd) return false
  return matchesRecurrence(repeats, startDay, dateStr)
}

// Group active events by the local date(s) they touch → { 'YYYY-MM-DD': [ev, ...] }. Multi-day events
// appear on each spanned day. Sorted all-day first, then by start time.
export function groupEventsByDate(events, dateStrs) {
  const out = {}
  dateStrs.forEach(ds => {
    const list = (events || []).filter(ev => eventOnDate(ev, ds))
    list.sort((a, b) => {
      if (!!a.all_day !== !!b.all_day) return a.all_day ? -1 : 1
      return String(a.start_at).localeCompare(String(b.start_at))
    })
    if (list.length) out[ds] = list
  })
  return out
}
