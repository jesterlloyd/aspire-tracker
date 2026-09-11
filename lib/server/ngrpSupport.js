// lib/server/ngrpSupport.js
//
// RESIDENCY-SUPPORT-1: validation for recorded support and resident mentors.
// Pure and db-free so every rule is unit-tested. The activity list is the one
// in src/lib/ngrp/ngrpSupportActivities.js; the migration's CHECK matches it.
import {
  SUPPORT_ACTIVITY_KEYS, supportActivity, SUPPORT_NOTE_MAX, MENTOR_NAME_MAX,
} from '../../src/lib/ngrp/ngrpSupportActivities.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/
export const ATTENDANCE_MAX = 200

function realDay(v) {
  if (typeof v !== 'string' || !DAY.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function optionalText(v, max) {
  if (v == null) return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false }
  const t = v.trim()
  if (!t) return { ok: true, value: null }
  return t.length > max ? { ok: false } : { ok: true, value: t }
}

// One recorded activity. `today` is YYYY-MM-DD (Pacific), passed in so the
// rule is testable: support cannot be recorded for a future date.
export function validateSupportEntry(input, { today } = {}) {
  const src = (input && typeof input === 'object') ? input : {}
  const errors = []
  const push = (field, message) => errors.push({ field, message })
  if (!SUPPORT_ACTIVITY_KEYS.includes(src.activity)) push('activity', 'Choose a support activity.')
  if (!realDay(src.occurred_on)) push('occurred_on', 'Enter the date it happened.')
  else if (today && src.occurred_on > today) push('occurred_on', 'Support can only be recorded once it has happened.')
  const note = optionalText(src.note, SUPPORT_NOTE_MAX)
  if (!note.ok) push('note', `Keep the note under ${SUPPORT_NOTE_MAX} characters.`)
  const mentor = optionalText(src.mentor_name, MENTOR_NAME_MAX)
  if (!mentor.ok) push('mentor_name', `Keep the mentor's name under ${MENTOR_NAME_MAX} characters.`)
  if (src.event_id != null && src.event_id !== '' && !(typeof src.event_id === 'string' && UUID.test(src.event_id))) {
    push('event_id', 'That calendar event could not be found.')
  }
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    entry: {
      activity: src.activity,
      occurred_on: src.occurred_on,
      note: note.value,
      // A mentor name belongs only on a mentorship session.
      mentor_name: src.activity === 'mentorship_session' ? mentor.value : null,
      event_id: typeof src.event_id === 'string' && UUID.test(src.event_id) ? src.event_id : null,
    },
  }
}

// Group attendance: one activity and date for several alumni at once. Only
// group activities (Town Hall, Interview Bootcamp) can be recorded this way.
export function validateAttendance(input, { today } = {}) {
  const src = (input && typeof input === 'object') ? input : {}
  const base = validateSupportEntry({ ...src, mentor_name: null }, { today })
  const errors = base.ok ? [] : [...base.errors]
  if (base.ok && supportActivity(src.activity)?.mode !== 'group') {
    errors.push({ field: 'activity', message: 'Attendance is recorded for Town Halls and Interview Bootcamps.' })
  }
  const ids = Array.isArray(src.candidate_ids) ? [...new Set(src.candidate_ids)] : []
  if (ids.length === 0) errors.push({ field: 'candidate_ids', message: 'Choose at least one alumnus.' })
  else if (ids.length > ATTENDANCE_MAX) errors.push({ field: 'candidate_ids', message: `Record at most ${ATTENDANCE_MAX} alumni at once.` })
  else if (!ids.every(id => typeof id === 'string' && UUID.test(id))) errors.push({ field: 'candidate_ids', message: 'One of the alumni could not be found.' })
  if (errors.length) return { ok: false, errors }
  return { ok: true, entry: base.entry, candidateIds: ids }
}

export function validateMentor(input) {
  const src = (input && typeof input === 'object') ? input : {}
  const errors = []
  const name = optionalText(src.mentor_name, MENTOR_NAME_MAX)
  if (!name.ok || !name.value) errors.push({ field: 'mentor_name', message: 'Enter the mentor\'s name.' })
  const profileId = src.mentor_profile_id
  if (profileId != null && profileId !== '' && !(typeof profileId === 'string' && UUID.test(profileId))) {
    errors.push({ field: 'mentor_profile_id', message: 'That staff member could not be found.' })
  }
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    mentor: { mentor_name: name.value, mentor_profile_id: typeof profileId === 'string' && UUID.test(profileId) ? profileId : null },
  }
}

export function validateVoid(input) {
  const src = (input && typeof input === 'object') ? input : {}
  if (!(typeof src.entry_id === 'string' && UUID.test(src.entry_id))) {
    return { ok: false, errors: [{ field: 'entry_id', message: 'That entry could not be found.' }] }
  }
  const reason = optionalText(src.reason, 300)
  if (!reason.ok) return { ok: false, errors: [{ field: 'reason', message: 'Keep the reason under 300 characters.' }] }
  return { ok: true, entryId: src.entry_id, reason: reason.value }
}
