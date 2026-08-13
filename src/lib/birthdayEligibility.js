// STUDENT-BIRTHDAY-GREETING-1: who gets a birthday greeting, and when.
//
// Pure by design: the cron passes `now` and the already-fetched rows, so the
// tests exercise the same code production runs. Nothing here reads a database,
// sends anything, or formats an email.
//
// DATE OF BIRTH IS AN ELIGIBILITY INPUT AND NOTHING ELSE. Only the month and day
// are ever compared, no value derived from it is returned, and no caller is
// given a way to obtain an age or a full date from these helpers. DOB is
// already treated as private across ASPIRE (excluded from the Unit Leader and
// Academic Partner views and from Keith's student detail), and this module does
// not widen that.

/** Days in a month, 1-indexed month. */
const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

/** 'YYYY-MM-DD' -> { y, mo, d } or null. Accepts a timestamp and ignores the time. */
export function parseYmd(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''))
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return { y, mo, d }
}

/**
 * Today's calendar date in America/Los_Angeles, as 'YYYY-MM-DD'.
 * Intl does the DST arithmetic, so this is correct in both PST and PDT without
 * the codebase's usual caveat about toISOString() returning UTC.
 */
export function pacificDateString(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const get = (t) => parts.find(p => p.type === t)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** The hour (0-23) in America/Los_Angeles. DST-correct for the same reason. */
export function pacificHour(now = new Date()) {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false,
  }).format(now)
  return Number(h) % 24
}

/**
 * Does this date of birth have its birthday on `todayYmd`?
 *
 * FEB 29, using ASPIRE's EXISTING annual-recurrence rule rather than a new one.
 * src/lib/aspireEvents.js already defines annual recurrence for program events
 * as "same month + day; Feb 29 -> Feb 28 in non-leap years (Feb 29 in leap
 * years)". A Feb 29 birthday therefore lands on Feb 28 in a common year, which
 * keeps one greeting per calendar year for every student and matches the only
 * annual rule the product already has.
 */
export function birthdayFallsOn(dateOfBirth, todayYmd) {
  const dob = parseYmd(dateOfBirth)
  const today = parseYmd(todayYmd)
  if (!dob || !today) return false

  if (dob.mo === today.mo && dob.d === today.d) return true

  // The Feb 29 -> Feb 28 shift, and only in a non-leap year.
  if (dob.mo === 2 && dob.d === 29 && !isLeapYear(today.y)) {
    return today.mo === 2 && today.d === 28
  }
  return false
}

/**
 * Statuses that mean the student is actively on rotation.
 *
 * HOUSE RULE, NOT A NEW ONE. api/cron/midpoint-checkin.js selects
 * `.eq('status', 'Active Rotation')` and applies no rotation-window check, so
 * status alone is ASPIRE's existing definition of "currently on rotation" for
 * automated student email. This module deliberately reuses that rather than
 * introducing a second, stricter definition that would silently change who
 * receives automated mail.
 */
export const ACTIVE_ROTATION_STATUS = 'Active Rotation'

/** A usable address, preferring the school address exactly as the other crons do. */
export function studentEmail(student) {
  const pick = student?.school_email || student?.personal_email || ''
  const value = String(pick).trim()
  return value.includes('@') ? value : null
}

/**
 * Statuses on a prior notification_log row that mean "already sent".
 *
 * Copied in intent from api/cron/midpoint-checkin.js: the Resend webhook
 * advances a row through sent -> delivered -> opened -> clicked, so idempotency
 * must treat every one of those as sent or a delivered greeting is mailed again
 * on the next run. Only 'failed' (Resend handoff failure) and 'queued' remain
 * retryable.
 */
export const ALREADY_SENT_STATUSES = Object.freeze([
  'sent', 'delivered', 'opened', 'clicked', 'delayed', 'bounced', 'complained',
])

/** Did this student already receive a greeting in `year`? */
export function alreadyGreetedThisYear(logRows, studentId, year) {
  return (Array.isArray(logRows) ? logRows : []).some(r =>
    r?.student_id === studentId
    && ALREADY_SENT_STATUSES.includes(String(r?.status || ''))
    && parseYmd(r?.sent_at)?.y === year)
}

/**
 * The eligible students for `now`, with a reason for every exclusion so the run
 * summary can explain itself without ever naming a date of birth.
 *
 * @returns {{ eligible: Array, skipped: Array<{id, reason}>, todayPacific: string }}
 */
export function selectBirthdayRecipients({ students = [], greetedLog = [], now = new Date() }) {
  const todayPacific = pacificDateString(now)
  const year = parseYmd(todayPacific).y
  const eligible = []
  const skipped = []

  for (const s of students) {
    if (!s?.id) continue
    if (!birthdayFallsOn(s.date_of_birth, todayPacific)) { skipped.push({ id: s.id, reason: 'not_birthday' }); continue }
    if (s.status !== ACTIVE_ROTATION_STATUS) { skipped.push({ id: s.id, reason: 'not_active_rotation' }); continue }
    const email = studentEmail(s)
    if (!email) { skipped.push({ id: s.id, reason: 'no_email' }); continue }
    if (alreadyGreetedThisYear(greetedLog, s.id, year)) { skipped.push({ id: s.id, reason: 'already_sent_this_year' }); continue }
    eligible.push({ ...s, resolvedEmail: email })
  }

  return { eligible, skipped, todayPacific }
}

/**
 * May the run send right now?
 *
 * Vercel cron expressions are UTC only, so a fixed UTC hour drifts an hour
 * across DST - which is why "Daily 10:00 AM PT" in the Automations catalog is
 * really 17:00 UTC and becomes 9:00 AM in winter. Rather than inherit that
 * drift, this automation is scheduled to fire more than once and gates on the
 * LOCAL Pacific hour.
 *
 * The gate is `>=` on purpose: it makes the send self-healing within the day.
 * If the first qualifying run fails, a later run the same Pacific day still
 * sends the owed greeting, and per-year idempotency keeps it to one. It never
 * sends on a later calendar date, because the birthday match is against today.
 */
export const SEND_AFTER_PACIFIC_HOUR = 9

export function withinSendWindow(now = new Date()) {
  return pacificHour(now) >= SEND_AFTER_PACIFIC_HOUR
}
