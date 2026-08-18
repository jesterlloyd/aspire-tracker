// src/lib/placementCommunication.js
//
// PLACEMENT-COMMUNICATION-HANDOFF-1 - the ONE place that decides what a placement
// communication may claim about a student, and where every value came from.
//
// WHY THIS EXISTS. The unit-leader envelope used to read students.term_dates, a
// free-text legacy column that STUDENT-PROFILE-CANON-1B removed from the profile
// and 1C removed from operational date logic. It survived only in the email, so
// the one message a unit leader actually receives was the last place still quoting
// a retired source - usually blank, sometimes stale, never coordinator-owned.
//
// THE DATE AUDIT (every source found in the repository, and its verdict):
//
//   cohort_school_rotations.rotation_start_date / rotation_end_date
//       AUTHORITATIVE. Submitted by the school's clinical-placement coordinator
//       through /school-form (api/school-form-submit.js) or the Academic Partner
//       portal, editable only by Owner/Admin through api/update-rotation-dates.js,
//       and already the source of truth for badges, shift-window validation,
//       Keith, CohortBar and the student profile. Students link by
//       students.cohort_school_rotation_id.
//   students.term_dates
//       REJECTED. Legacy free text ("Jun 8 - Aug 18, 2026"), no longer shown in
//       the profile and explicitly excluded from date logic by rotationWindow.js.
//   cohorts.start_date / end_date
//       REJECTED for a placement notice. Cohort-wide programme framing, not this
//       school's rotation; CohortBar derives its display FROM the rotation rows
//       for exactly this reason.
//   a cohort NAME ("Summer 2026")
//       REJECTED. A label, not data.
//   student_shift_logs
//       REJECTED. Evidence of what happened, never of what was scheduled.
//   SCHOOL_DEFAULTS[school].term_dates (src/lib/constants.js)
//       REJECTED. A seeding convenience for data entry, not a coordinator record.
//
//   The '1900-01-01' sentinel means "pending admin review" and reads as UNKNOWN,
//   never as a real date - the same rule rotationWindow.js and attention.js use.
//
// NOTHING HERE IS INVENTED. Every resolver returns the canonical value or a
// null-ish marker, and every builder reports what it could not resolve so the
// caller can show the gap BEFORE a message is opened. A blank is shown as
// "To be confirmed"; it is never guessed, derived, or back-filled from a
// retired column.

import { resolveOperativeSchoolName } from './schoolIdentity.js'
import { canonicalRotationWindow } from './rotationWindow.js'
import {
  formatWeekdays, formatDates, sanitizeWeekdays, sanitizeIsoDates,
} from './availability.js'

export const TO_BE_CONFIRMED = 'To be confirmed'

const trim = (v) => (typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim()))

// ── Rotation window ─────────────────────────────────────────────────────────

/**
 * The coordinator-owned rotation window for one student.
 *
 * Resolution order, both branches reading the SAME coordinator-owned table:
 *   1. 'link'   - students.cohort_school_rotation_id, the explicit foreign key.
 *   2. 'school' - exactly ONE rotation row in this cohort whose school resolves
 *                 to the student's school. Used only when the link is absent
 *                 (older rows predate it); AMBIGUOUS matches resolve to nothing
 *                 rather than picking one.
 * Anything else - no row, missing date, sentinel - is UNAVAILABLE (null).
 *
 * @param student            the student row
 * @param rotationRows       cohort_school_rotations rows for this cohort
 * @returns {{start: string, end: string, source: 'link'|'school'}|null}
 */
export function resolveStudentRotationWindow(student, rotationRows) {
  const rows = Array.isArray(rotationRows) ? rotationRows.filter(Boolean) : []
  if (!student || rows.length === 0) return null

  const linkId = trim(student.cohort_school_rotation_id)
  if (linkId) {
    const linked = rows.find(r => String(r.id || '') === linkId) || null
    // An explicit link is FINAL. When it points at a sentinel or incomplete row
    // the answer is "unavailable" - never a different school's window.
    if (linked) {
      const win = canonicalRotationWindow(linked)
      return win ? { ...win, source: 'link' } : null
    }
    return null
  }

  const school = resolveSchoolKey(student.school)
  if (!school) return null
  const candidates = rows.filter(r => resolveSchoolKey(r.school_name) === school)
  if (candidates.length !== 1) return null   // none, or ambiguous → unavailable
  const win = canonicalRotationWindow(candidates[0])
  return win ? { ...win, source: 'school' } : null
}

/** Normalized school identity used only for matching (never for display). */
function resolveSchoolKey(name) {
  const raw = trim(name)
  if (!raw) return ''
  const resolved = resolveOperativeSchoolName(raw)
  return (resolved ? resolved.displayName : raw).toLowerCase()
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function ymdParts(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trim(value).slice(0, 10))
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  // Reject calendar overflow (2026-02-31) the same way portalDates.fmtDate does.
  const dt = new Date(y, mo - 1, d)
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
  return { y, m: mo, d }
}

/**
 * A rotation window written the way a person writes it:
 *   same month  → "August 24-30, 2026"
 *   same year   → "August 24-October 20, 2026"
 *   across years→ "December 28, 2026-January 15, 2027"
 * The separator is an EN DASH. A partial or unusable window returns null - a
 * one-sided range is not a term-date statement, so the caller shows the
 * "To be confirmed" fallback instead of half an answer.
 */
export function formatRotationTerm(start, end) {
  const a = ymdParts(start)
  const b = ymdParts(end)
  if (!a || !b) return null
  if (a.y !== b.y) {
    return `${MONTHS[a.m - 1]} ${a.d}, ${a.y}–${MONTHS[b.m - 1]} ${b.d}, ${b.y}`
  }
  if (a.m === b.m) {
    return `${MONTHS[a.m - 1]} ${a.d}–${b.d}, ${a.y}`
  }
  return `${MONTHS[a.m - 1]} ${a.d}–${MONTHS[b.m - 1]} ${b.d}, ${a.y}`
}

/** The term-dates line for a message: the canonical range, or "To be confirmed". */
export function rotationTermText(window) {
  const text = window ? formatRotationTerm(window.start, window.end) : null
  return text || TO_BE_CONFIRMED
}

// ── Student-facing canonical values ─────────────────────────────────────────

// Stored program values, expanded to something a unit leader can read. Covers the
// canonical PROGRAM_TYPES plus the abbreviations historical rows carry. An
// unrecognized value passes through UNCHANGED - never guessed at, never blanked.
export const PROGRAM_LABELS = Object.freeze({
  'BSN Semester': 'BSN (Semester)',
  'BSN Trimester': 'BSN (Trimester)',
  'BSN Quarter': 'BSN (Quarter)',
  'Accelerated BSN': 'Accelerated BSN (ABSN)',
  'ABSN': 'Accelerated BSN (ABSN)',
  'LVN to BSN': 'LVN to BSN',
  'LVN-BSN': 'LVN to BSN',
  'MECN': "Master's Entry Clinical Nurse (MECN)",
  'ELMN': "Entry-Level Master's in Nursing (ELMN)",
  'BSN': 'BSN',
})

export function programLabel(programType) {
  const raw = trim(programType)
  if (!raw) return ''
  return PROGRAM_LABELS[raw] || raw
}

/**
 * The formal institutional name, from the app's canonical school catalog
 * (schoolIdentity.js). An unknown string is returned unchanged rather than
 * being force-fitted to a known school.
 */
export function schoolFullName(school) {
  const raw = trim(school)
  if (!raw) return ''
  return resolveOperativeSchoolName(raw)?.canonicalName || raw
}

/**
 * "Last, First" with a preferred first name surfaced in quotes when it differs -
 * the same rule as getStudentLegalDisplayName, ordered last-name-first for the
 * placement notice. There is no middle_name column in this schema.
 */
export function studentPlacementName(student) {
  const first = trim(student?.first_name)
  const last = trim(student?.last_name) || trim(student?.name)
  const preferred = trim(student?.preferred_first_name)
  const given = preferred && preferred.toLowerCase() !== first.toLowerCase()
    ? `${first} “${preferred}”`.trim()
    : first
  if (last && given) return `${last}, ${given}`
  return last || given || ''
}

/**
 * The same identity in natural reading order - "Anamaria “Ana” Cruz" - for prose
 * that addresses a person about the student (the preceptor message) rather than
 * listing them in a roster (the unit-leader notice, which is last-name-first by
 * request). Same inputs, same preferred-name rule; only the order differs.
 */
export function studentNaturalName(student) {
  const first = trim(student?.first_name)
  const last = trim(student?.last_name) || trim(student?.name)
  const preferred = trim(student?.preferred_first_name)
  const given = preferred && preferred.toLowerCase() !== first.toLowerCase()
    ? `${first} “${preferred}”`.trim()
    : first
  return [given, last].filter(Boolean).join(' ')
}

/** Required hours as "144 hours", or '' when the student record carries none. */
export function hoursRequiredText(student) {
  const raw = trim(student?.hours_required)
  if (!raw) return ''
  return /hours?$/i.test(raw) ? raw : `${raw} hours`
}

/**
 * The student's own availability, as the unit leader needs it for preceptor
 * selection. Built ONLY from student-owned canonical fields (Student Availability
 * in the profile); coordinator programme constraints are a different provenance
 * and are deliberately not mixed in. Returns '' when the student has told us
 * nothing, so the caller can say so plainly instead of printing "Not provided"
 * five times.
 */
export function studentAvailabilityText(student) {
  if (!student) return ''
  const parts = []

  const preferred = sanitizeWeekdays(toList(student.preferred_days))
  if (preferred.length) parts.push(`Preferred days: ${formatWeekdays(preferred)}`)

  const unavailable = sanitizeWeekdays(toList(student.unavailable_weekdays))
  if (unavailable.length) parts.push(`Unavailable: ${formatWeekdays(unavailable)}`)

  if (student.weekends_available === true) parts.push('Weekends: available')
  else if (student.weekends_available === false) parts.push('Weekends: not available')

  if (student.nights_available === true) parts.push('Nights: available')
  else if (student.nights_available === false) parts.push('Nights: not available')

  const blackout = sanitizeIsoDates(toList(student.personal_blackout_dates))
  if (blackout.length) parts.push(`Blackout dates: ${formatDates(blackout)}`)

  const notes = trim(student.availability_notes)
  if (notes) parts.push(notes)

  return parts.join('; ')
}

// Tolerates a real array, stringified jsonb, or a comma string - the same shapes
// availability.js's own formatters accept.
function toList(value) {
  if (Array.isArray(value)) return value
  const s = trim(value)
  if (!s) return []
  if (s.startsWith('[')) {
    try { const parsed = JSON.parse(s); return Array.isArray(parsed) ? parsed : [] }
    catch { /* fall through */ }
  }
  return s.split(',').map(v => v.trim()).filter(Boolean)
}

// ── The placement's preceptor ───────────────────────────────────────────────

/**
 * The preceptor for ONE placement row (this student, in THIS unit).
 *
 * PLACEMENT-SPECIFIC ONLY, UNLESS THE STUDENT HAS EXACTLY ONE PLACEMENT.
 *
 * matches.preceptor_id / matches.preceptor_assigned are per (student, unit), so
 * they are the only records that can say which preceptor belongs to WHICH
 * placement. They are read first, always.
 *
 * students.preceptor_id is a SINGLE field for the whole student. Reading it for a
 * placement row that names nobody would attach one unit's preceptor to another
 * unit's placement - and the projection trigger (20260820000000) makes that state
 * ordinary rather than exotic: it deliberately refuses to project onto match rows
 * when a student has more than one match in the cohort, so a second unit's row
 * legitimately sits empty while the student-level field still names the first
 * unit's preceptor. Falling back there would then email the wrong person about the
 * wrong rotation.
 *
 * So the student-level fallback is taken ONLY when the evidence proves there is
 * nothing to confuse it with: exactly one match row for this student in this
 * cohort. That is the same single-placement rule the database trigger itself uses.
 *
 * FAILS CLOSED. `studentMatches` is the evidence. Without it - a caller that
 * cannot say how many placements the student has - no student-level fallback is
 * taken at all, because "unknown" is not "one".
 *
 * Resolution order:
 *   1. matches.preceptor_id          → the preceptors row (name, email, shift)
 *   2. matches.preceptor_assigned    → placement-specific free text, name only
 *   3. students.preceptor_id         → only when this is the student's ONLY placement
 *   4. students.matched_preceptor    → same single-placement condition
 *
 * @param studentMatches  every match row for THIS student in this cohort
 * @returns {{id, name, email, shiftType, source}|null}
 */
export function resolvePlacementPreceptor({ student, match, preceptorsById, studentMatches } = {}) {
  const byId = preceptorsById instanceof Map
    ? preceptorsById
    : new Map(Object.entries(preceptorsById || {}))
  const lookup = (id) => (id ? (byId.get(String(id)) || null) : null)

  const matchId = trim(match?.preceptor_id)
  const matchRecord = lookup(matchId)
  if (matchRecord) return fromRecord(matchRecord, 'match_record')

  const matchName = trim(match?.preceptor_assigned)
  if (matchName) {
    return { id: matchId || null, name: matchName, email: '', shiftType: '', source: 'match_text' }
  }

  // Below this line every source is student-level, so it is gated on proof.
  if (!singlePlacement(studentMatches)) return null

  const studentRecord = lookup(trim(student?.preceptor_id))
  if (studentRecord) return fromRecord(studentRecord, 'student_record')

  const studentName = trim(student?.matched_preceptor)
  if (studentName) {
    return {
      id: trim(student?.preceptor_id) || null,
      name: studentName,
      email: trim(student?.preceptor_email),
      shiftType: trim(student?.shift_assigned),
      source: 'student_text',
    }
  }
  return null
}

/**
 * Does the repository evidence prove exactly one relevant placement?
 * A missing or unusable list is NOT proof, and neither is an empty one.
 */
export function singlePlacement(studentMatches) {
  if (!Array.isArray(studentMatches)) return false
  return studentMatches.filter(Boolean).length === 1
}

function fromRecord(p, source) {
  return {
    id: p.id || null,
    name: trim(p.full_name),
    email: trim(p.email),
    shiftType: trim(p.shift_type),
    source,
  }
}

// ── The unit leader's name ──────────────────────────────────────────────────

const NAME_TITLES = new Set([
  'dr', 'dr.', 'mr', 'mr.', 'ms', 'ms.', 'mrs', 'mrs.', 'prof', 'prof.', 'professor',
])
// Credentials and role words that a units.contact_person free-text value often
// carries. A greeting must never address someone as "Dear MSN,".
const NOT_A_NAME = /^[A-Z]{2,6}(-[A-Z]{2,3})?$/

/**
 * The greeting name for the unit leader actually being emailed.
 *
 * 1. unit_leaders, matched on the RECIPIENT address first (so the greeting names
 *    the person the message goes to), then on the unit's active primary lead.
 *    preferred_name wins over full_name - the canonical greeting rule already
 *    used by lib/notifications/greetings.js.
 * 2. units.contact_person free text, parsed conservatively: the first listed
 *    person, "Last, First" honored, titles skipped, credential-looking tokens
 *    refused.
 * 3. Nothing reliable → null, and the caller greets the unit's team instead.
 */
export function resolveUnitLeaderGreetingName({ unit, leaders, recipientEmails } = {}) {
  const rows = (Array.isArray(leaders) ? leaders : []).filter(l => l && l.is_active !== false)
  const unitName = trim(unit?.unit_name)

  const wanted = new Set(
    (Array.isArray(recipientEmails) ? recipientEmails : [])
      .map(e => trim(e).toLowerCase()).filter(Boolean),
  )
  const forUnit = rows.filter(l => trim(l.unit_name).toLowerCase() === unitName.toLowerCase())

  const byRecipient = wanted.size
    ? forUnit.find(l => wanted.has(trim(l.email).toLowerCase()))
    : null
  const primary = forUnit.find(l => l.is_primary_lead) || null
  const leader = byRecipient || primary
  if (leader) {
    const name = trim(leader.preferred_name) || firstNameOf(trim(leader.full_name))
    if (name) return { name, source: byRecipient ? 'unit_leader_recipient' : 'unit_leader_primary' }
  }

  const parsed = firstNameOf(firstListedPerson(unit?.contact_person))
  if (parsed) return { name: parsed, source: 'unit_contact_person' }
  return { name: null, source: 'none' }
}

// "Ana Cruz; Ben Diaz" or "Ana Cruz, Ben Diaz" → the first person. A single
// "Cruz, Ana" is one person written last-name-first, so it is reordered rather
// than split.
function firstListedPerson(value) {
  const raw = trim(value)
  if (!raw) return ''
  if (raw.includes(';')) return trim(raw.split(';')[0])
  const commaParts = raw.split(',').map(s => s.trim()).filter(Boolean)
  if (commaParts.length === 2 && commaParts.every(p => p.split(/\s+/).length === 1)) {
    return `${commaParts[1]} ${commaParts[0]}`      // "Cruz, Ana" → "Ana Cruz"
  }
  return commaParts[0] || ''
}

function firstNameOf(full) {
  const parts = trim(full).split(/\s+/).filter(Boolean)
  for (const p of parts) {
    const bare = p.replace(/[.,]+$/, '')
    if (!bare) continue
    if (NAME_TITLES.has(p.toLowerCase())) continue
    if (NOT_A_NAME.test(bare)) continue            // MSN, RN, NPD-BC …
    return bare
  }
  return ''
}

// ── The placement facts one message needs ───────────────────────────────────

/**
 * Everything a placement communication may state about one (student, unit) row,
 * already resolved from canonical sources, plus the list of fields that could
 * NOT be resolved. `missing` is the contract that makes the "never invent"
 * promise checkable: the caller shows it before opening anything.
 */
export function buildPlacementFacts({ student, unit, match, rotationRows, preceptorsById, studentMatches } = {}) {
  const window = resolveStudentRotationWindow(student, rotationRows)
  const termDates = rotationTermText(window)
  const preceptor = resolvePlacementPreceptor({ student, match, preceptorsById, studentMatches })

  const facts = {
    studentName: studentPlacementName(student),
    studentNaturalName: studentNaturalName(student),
    studentFirstName: trim(student?.preferred_first_name) || trim(student?.first_name),
    school: schoolFullName(student?.school),
    program: programLabel(student?.program_type),
    termDates,
    termWindow: window,
    hoursRequired: hoursRequiredText(student),
    shiftPreference: trim(student?.shift_availability),
    availability: studentAvailabilityText(student),
    unitName: trim(unit?.unit_name),
    preceptorName: preceptor?.name || '',
    preceptorEmail: preceptor?.email || '',
    preceptorId: preceptor?.id || null,
    preceptorSource: preceptor?.source || null,
    assignedShift: preceptor?.shiftType || trim(student?.shift_assigned),
  }

  const missing = []
  if (!facts.studentName) missing.push({ key: 'student', label: 'Student name' })
  if (!facts.school) missing.push({ key: 'school', label: 'School' })
  if (!facts.program) missing.push({ key: 'program', label: 'Program' })
  if (!window) missing.push({ key: 'term_dates', label: 'Rotation dates' })
  if (!facts.hoursRequired) missing.push({ key: 'hours', label: 'Required hours' })
  if (!facts.shiftPreference) missing.push({ key: 'shift', label: 'Shift preference' })
  if (!facts.availability) missing.push({ key: 'availability', label: 'Student availability' })

  return { ...facts, missing }
}

/**
 * The placement facts, in the shape the unit-leader message builder consumes.
 * Shared so the Placement Board and the Action Center cannot describe the same
 * placement two different ways.
 */
export function toNoticeStudent(facts) {
  return {
    name:            facts?.studentName || '',
    school:          facts?.school || '',
    program:         facts?.program || '',
    termDates:       facts?.termDates || '',
    hoursRequired:   facts?.hoursRequired || '',
    shiftPreference: facts?.shiftPreference || '',
    preceptorName:   facts?.preceptorName || '',
    availability:    facts?.availability || '',
  }
}

/** One short sentence naming what the message will have to leave open. */
export function missingSummary(missing) {
  const list = (missing || []).map(m => m.label).filter(Boolean)
  if (list.length === 0) return ''
  if (list.length === 1) return `${list[0]} is not on file yet.`
  const last = list[list.length - 1]
  return `${list.slice(0, -1).join(', ')} and ${last} are not on file yet.`
}
