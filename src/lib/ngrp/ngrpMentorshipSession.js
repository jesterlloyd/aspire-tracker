// MENTORSHIP-1 (Owner, 2026-09-14): the mentorship session record.
//
// Support > During Residency keeps the record of every session between a new
// grad (mentee) and their mentor. It replaces Cedars-Sinai's mentorship
// platform, so a session holds what that platform held: when, who led it, how
// it happened, how long, what was discussed and what comes next.
//
// ONE definition for every way a session gets logged. Today the ASPIRE team
// logs it on the Support tab. Later a mentor or the resident will log their own
// (a cron link or a portal, not built yet); both will validate through
// validateSessionDetails and write the same columns, with logged_by saying who.
// The migration's CHECKs (20260920000000) match these lists exactly.
//
// Pure and node-safe: lib/server/ngrpSupport.js and SupportTab.jsx both read it.

export const SESSION_FORMATS = Object.freeze([
  Object.freeze({ key: 'in_person', label: 'In person' }),
  Object.freeze({ key: 'virtual',   label: 'Virtual' }),
  Object.freeze({ key: 'phone',     label: 'Phone' }),
])
export const SESSION_FORMAT_KEYS = Object.freeze(SESSION_FORMATS.map(f => f.key))

// Who wrote the record. Only aspire_team exists today; the other two are the
// future self-logging paths, named now so the column never needs widening.
export const SESSION_LOGGERS = Object.freeze([
  Object.freeze({ key: 'aspire_team', label: 'ASPIRE team' }),
  Object.freeze({ key: 'mentor',      label: 'Mentor' }),
  Object.freeze({ key: 'resident',    label: 'Resident' }),
])
export const SESSION_LOGGER_KEYS = Object.freeze(SESSION_LOGGERS.map(l => l.key))

export const DURATION_MIN = 5
export const DURATION_MAX = 480
export const TOPICS_MAX = 2000
export const NEXT_STEPS_MAX = 2000

export const sessionFormatLabel = key => SESSION_FORMATS.find(f => f.key === key)?.label || ''
export const sessionLoggerLabel = key => SESSION_LOGGERS.find(l => l.key === key)?.label || ''

const text = (v) => (typeof v === 'string' ? v.trim() : '')

// The session-specific fields. Format and topics are required: a session with
// neither is not a record worth keeping. Duration and next steps are optional.
export function validateSessionDetails(input, { loggedBy = 'aspire_team' } = {}) {
  const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {}
  const errors = []

  const format = text(src.session_format)
  if (!SESSION_FORMAT_KEYS.includes(format)) errors.push({ field: 'session_format', message: 'Choose how the session happened.' })

  let duration = null
  const rawDuration = src.duration_minutes
  if (rawDuration !== null && rawDuration !== undefined && rawDuration !== '') {
    const n = Number(rawDuration)
    if (!Number.isInteger(n) || n < DURATION_MIN || n > DURATION_MAX) {
      errors.push({ field: 'duration_minutes', message: `Enter the length in whole minutes, ${DURATION_MIN} to ${DURATION_MAX}.` })
    } else {
      duration = n
    }
  }

  const topics = text(src.topics)
  if (!topics) errors.push({ field: 'topics', message: 'Say what the session covered.' })
  else if (topics.length > TOPICS_MAX) errors.push({ field: 'topics', message: `Keep the topics under ${TOPICS_MAX} characters.` })

  const nextSteps = text(src.next_steps)
  if (nextSteps.length > NEXT_STEPS_MAX) errors.push({ field: 'next_steps', message: `Keep the next steps under ${NEXT_STEPS_MAX} characters.` })

  if (!SESSION_LOGGER_KEYS.includes(loggedBy)) errors.push({ field: 'logged_by', message: 'Unknown session logger.' })

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    details: {
      session_format: format,
      duration_minutes: duration,
      topics,
      next_steps: nextSteps || null,
      logged_by: loggedBy,
    },
  }
}
