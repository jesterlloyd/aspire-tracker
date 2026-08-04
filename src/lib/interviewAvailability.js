// AVAILABILITY-CALENDAR-1: the shared, pure time math behind the Add
// Availability editor, the day drawer's block summaries, and their tests.
//
// The generation rule here MIRRORS api/availability.js create_block exactly: an
// interview occupies `duration` minutes, the next one starts `duration + break`
// later, and a slot that would run past the end time is never created. Keeping
// one implementation of that rule is what lets the form's live preview promise
// the same slot count the server will actually produce.
//
// BREAKS NEED NO SCHEMA. The gap is fully described by the stored slot times, so
// readers recover it with deriveBreakMinutes rather than reading a column.

// The length of ONE interview. Never longer than an hour.
export const INTERVIEW_LENGTHS = [30, 45, 60]

// The buffer between generated interviews. "No break" (0) is retained but is
// NOT the default: every block created before breaks existed is effectively a
// zero-break block, and back-to-back interviewing is still a legitimate pattern,
// so the option has to stay available to reproduce that shape.
export const BREAK_OPTIONS = [0, 5, 10, 15, 30]
export const DEFAULT_BREAK_MINUTES = 15

/** "30 minutes" / "1 hour" for an interview-length option. */
export function interviewLengthLabel(minutes) {
  return minutes === 60 ? '1 hour' : `${minutes} minutes`
}

/** "No break" / "15 minutes" for a break option. */
export function breakLabel(minutes) {
  return minutes === 0 ? 'No break' : `${minutes} minutes`
}

const pad = (n) => String(n).padStart(2, '0')

/** "HH:MM" -> minutes since midnight, or null when unparseable. */
export function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim())
  if (!m) return null
  const h = Number(m[1]); const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** minutes since midnight -> "HH:MM" (24h, zero padded). */
export function toHHMM(minutes) {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)))
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`
}

/** "HH:MM" -> "9:30 AM" for display. */
export function formatTime12(hhmm) {
  const mins = toMinutes(hhmm)
  if (mins == null) return ''
  const h24 = Math.floor(mins / 60)
  const m = mins % 60
  const suffix = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${pad(m)} ${suffix}`
}

/**
 * Direct time typing. Accepts the shapes people actually type, so the editor
 * never requires minute-by-minute stepping:
 *   "9", "9am", "9 AM"      -> 09:00
 *   "930", "9:30", "9:30pm" -> 09:30 / 21:30
 *   "13:15", "1315"         -> 13:15
 * Returns "HH:MM" or null when the input cannot be read as a time.
 */
export function parseTimeInput(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/\s+/g, '')
  if (!s) return null
  const meridiem = /(am|pm)$/.exec(s)
  const body = meridiem ? s.slice(0, -2) : s
  if (!/^\d{1,4}(:\d{1,2})?$/.test(body)) return null

  let h; let m
  if (body.includes(':')) {
    const [hs, ms] = body.split(':')
    h = Number(hs); m = Number(ms.padEnd(2, '0'))
  } else if (body.length <= 2) {
    h = Number(body); m = 0
  } else {
    // 3 or 4 digits: trailing two are minutes.
    h = Number(body.slice(0, body.length - 2)); m = Number(body.slice(-2))
  }
  if (!Number.isFinite(h) || !Number.isFinite(m) || m > 59) return null

  if (meridiem) {
    if (h < 1 || h > 12) return null
    const isPm = meridiem[1] === 'pm'
    if (isPm && h !== 12) h += 12
    if (!isPm && h === 12) h = 0
  }
  if (h > 23) return null
  return toHHMM(h * 60 + m)
}

/**
 * The next nearest 30-minute mark, used as the Start default so the editor
 * opens on a usable time instead of an arbitrary one. An exact half-hour
 * advances to the following mark (the current minute has already begun).
 */
export function nextHalfHourFrom(date = new Date()) {
  const mins = date.getHours() * 60 + date.getMinutes()
  const next = (Math.floor(mins / 30) + 1) * 30
  return toHHMM(Math.min(next, 23 * 60 + 30))
}

/**
 * The slot start times a block will generate. Mirrors the server loop exactly.
 * Returns [] when the window, length, or break cannot produce a whole slot.
 */
export function generateSlotTimes({ start, end, duration, breakMinutes = 0 }) {
  const startTotal = toMinutes(start)
  const endTotal = toMinutes(end)
  const dur = Number(duration)
  const brk = Number(breakMinutes) || 0
  if (startTotal == null || endTotal == null) return []
  if (!Number.isFinite(dur) || dur <= 0) return []
  if (endTotal <= startTotal) return []
  const stride = dur + brk
  const out = []
  for (let t = startTotal; t + dur <= endTotal; t += stride) out.push(toHHMM(t))
  return out
}

/** Slot count for the live preview (same rule as the server). */
export function slotCountFor(args) {
  return generateSlotTimes(args).length
}

/**
 * Recover the configured break from generated slots: the gap between two
 * consecutive starts, less the interview length. Returns 0 for a single slot
 * (no gap exists) and null when the slots are irregular, so callers can omit
 * the phrase rather than state something untrue.
 */
export function deriveBreakMinutes(slotTimes, duration) {
  const times = (slotTimes || []).map(toMinutes).filter(t => t != null).sort((a, b) => a - b)
  const dur = Number(duration)
  if (times.length < 2 || !Number.isFinite(dur)) return times.length ? 0 : null
  const first = times[1] - times[0] - dur
  for (let i = 2; i < times.length; i++) {
    if (times[i] - times[i - 1] - dur !== first) return null
  }
  return first >= 0 ? first : null
}

/** "30-minute interviews with 10-minute breaks" / "... with no breaks". */
export function describeCadence(duration, breakMinutes) {
  const brk = Number(breakMinutes)
  const tail = !Number.isFinite(brk) ? '' : (brk > 0 ? ` with ${brk}-minute breaks` : ' with no breaks')
  return `${duration}-minute interviews${tail}`
}
