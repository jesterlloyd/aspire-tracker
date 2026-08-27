// src/lib/accessRetirement.js
//
// COHORT-ACCESS-RETIREMENT-1: the pure core for the CS-Link access-retirement
// email. No I/O - fully unit-testable under node - so the send-date math and
// the student selection have exactly one implementation.
//
// THE RULE. When a cohort is marked Completed (cohorts.completed_at, stamped
// by the DB trigger), the notice goes out on the FIRST BUSINESS DAY STRICTLY
// AFTER the completion date (Pacific), at 9:00 AM Pacific (the cron gates the
// hour). Business day = not Saturday, not Sunday, not a US federal holiday
// (with observed-day shifting: a fixed-date holiday on Saturday is observed
// Friday, on Sunday observed Monday).
//
// THE LIST. Students in the completed cohort whose CS-Link state is
// "complete" (the ✓ CS-Link Active badge - the Hybrid Student Nurse CS-Link
// access Arturo retires), in ANY status except Active Rotation: a student
// still rotating keeps their access even if the cohort was flipped early.

import { getCsLinkStatus } from './utils.js'

export const ACTIVE_ROTATION_STATUS = 'Active Rotation'

// ── Date plumbing (YYYY-MM-DD, timezone-trap free via Date.UTC) ─────────────

export function parseYmd(ymd) {
  const [y, m, d] = String(ymd || '').split('-').map(Number)
  return { y, m, d }
}

const toUtc = (ymd) => {
  const { y, m, d } = parseYmd(ymd)
  return new Date(Date.UTC(y, m - 1, d))
}

const fromUtc = (date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`

export function addDays(ymd, days) {
  const date = toUtc(ymd)
  date.setUTCDate(date.getUTCDate() + days)
  return fromUtc(date)
}

// 0 = Sunday ... 6 = Saturday
export function weekdayOf(ymd) {
  return toUtc(ymd).getUTCDay()
}

// The Pacific calendar date of a timestamp (completed_at is a timestamptz;
// "the day the cohort was completed" means the Pacific day).
export function pacificDateOf(isoTimestamp) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(isoTimestamp))
  const get = (type) => parts.find(p => p.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

// ── US federal holidays (observed) ──────────────────────────────────────────

// nth (1-based) given weekday of a month; nth = -1 means the last one.
function nthWeekday(year, month, weekday, nth) {
  if (nth === -1) {
    for (let d = new Date(Date.UTC(year, month, 0)); ; d.setUTCDate(d.getUTCDate() - 1)) {
      if (d.getUTCDay() === weekday) return fromUtc(d)
    }
  }
  let count = 0
  for (let d = new Date(Date.UTC(year, month - 1, 1)); ; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === weekday) { count += 1; if (count === nth) return fromUtc(d) }
  }
}

// A fixed-date holiday falling on Saturday is observed the preceding Friday;
// on Sunday, the following Monday (the federal observance rule).
function observed(ymd) {
  const wd = weekdayOf(ymd)
  if (wd === 6) return addDays(ymd, -1)
  if (wd === 0) return addDays(ymd, 1)
  return ymd
}

// The eleven US federal holidays for a year, as OBSERVED dates.
export function usFederalHolidays(year) {
  return new Set([
    observed(`${year}-01-01`),           // New Year's Day
    nthWeekday(year, 1, 1, 3),           // MLK Day: 3rd Monday of January
    nthWeekday(year, 2, 1, 3),           // Washington's Birthday: 3rd Monday of February
    nthWeekday(year, 5, 1, -1),          // Memorial Day: last Monday of May
    observed(`${year}-06-19`),           // Juneteenth
    observed(`${year}-07-04`),           // Independence Day
    nthWeekday(year, 9, 1, 1),           // Labor Day: 1st Monday of September
    nthWeekday(year, 10, 1, 2),          // Columbus Day: 2nd Monday of October
    observed(`${year}-11-11`),           // Veterans Day
    nthWeekday(year, 11, 4, 4),          // Thanksgiving: 4th Thursday of November
    observed(`${year}-12-25`),           // Christmas Day
  ])
}

export function isBusinessDay(ymd) {
  const wd = weekdayOf(ymd)
  if (wd === 0 || wd === 6) return false
  const { y } = parseYmd(ymd)
  // An observed holiday can spill across the year boundary (Jan 1 on a
  // Saturday is observed Dec 31), so check the neighbor years too.
  return !usFederalHolidays(y).has(ymd)
    && !usFederalHolidays(y - 1).has(ymd)
    && !usFederalHolidays(y + 1).has(ymd)
}

// The first business day STRICTLY AFTER ymd ("next business day": mark the
// cohort today, the notice goes out the next morning that is a business day).
export function firstBusinessDayAfter(ymd) {
  let d = addDays(ymd, 1)
  while (!isBusinessDay(d)) d = addDays(d, 1)
  return d
}

// ── Selection ───────────────────────────────────────────────────────────────

// Cohorts due for the notice today. A cohort is due when:
//   - status is Completed AND completed_at is stamped,
//   - today (Pacific) is on/after the first business day after the completion
//     date (a run that failed on the due day retries every later day), and
//   - the ledger holds no sent-ish row AT/AFTER completed_at (so one send per
//     completion; a reverted-then-re-completed cohort sends again because its
//     completed_at moved past the old send).
// `ledger` is [{ cohort_id, sent_at }] of already-sent rows for this type.
export function selectDueCohorts({ cohorts = [], todayPacific, ledger = [] } = {}) {
  const sentAtByCohort = new Map()
  for (const row of ledger) {
    if (!row?.cohort_id || !row?.sent_at) continue
    const prev = sentAtByCohort.get(row.cohort_id)
    if (!prev || row.sent_at > prev) sentAtByCohort.set(row.cohort_id, row.sent_at)
  }

  const due = []
  const skipped = []
  for (const cohort of cohorts) {
    if (cohort.status !== 'Completed') { skipped.push({ id: cohort.id, reason: 'not_completed' }); continue }
    if (!cohort.completed_at) { skipped.push({ id: cohort.id, reason: 'no_completed_at' }); continue }
    const dueDate = firstBusinessDayAfter(pacificDateOf(cohort.completed_at))
    if (todayPacific < dueDate) { skipped.push({ id: cohort.id, reason: 'not_due_yet', due_date: dueDate }); continue }
    const lastSent = sentAtByCohort.get(cohort.id)
    if (lastSent && lastSent >= cohort.completed_at) { skipped.push({ id: cohort.id, reason: 'already_sent' }); continue }
    due.push({ ...cohort, due_date: dueDate })
  }
  return { due, skipped }
}

// The retirement list for one cohort: ✓ CS-Link Active holders (the Hybrid
// Student Nurse CS-Link access) in any status except Active Rotation.
export function selectRetirementStudents(students = []) {
  return students
    .filter(s => getCsLinkStatus(s) === 'complete' && s.status !== ACTIVE_ROTATION_STATUS)
    .map(s => ({
      id: s.id,
      name: [s.first_name, s.last_name].map(v => String(v || '').trim()).filter(Boolean).join(' ') || 'Unnamed student',
      school: String(s.school || '').trim() || 'No school on file',
      status: s.status || '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
