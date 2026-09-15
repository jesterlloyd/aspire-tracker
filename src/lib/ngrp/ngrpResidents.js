// RESIDENTS-1 (Owner, 2026-09-14): Residency > Residents, the hired new grads and
// whether they are still at Cedars-Sinai (the retention tracker).
//
// Pure and node-safe: the server loader (lib/server/ngrpResidents.js), the
// manage endpoint's validator and the ResidentsTab component read this one
// module, so the title list, the fallbacks and the retention math cannot drift.
//
// WHERE EACH COLUMN COMES FROM
//   unit, shift, hire date, Cedars-Sinai email, separation -> ngrp_residency_outcomes
//   position/title   -> ngrp_residency_outcomes.position_title (dropdown or typed)
//   preceptor        -> the typed override, else the names the resident gave in
//                       their first bi-weekly reflection (about.preceptor_names)
//   phone            -> the typed override, else the Transition Form's preferred phone
//   personal email   -> the student record (the school email is never shown)
//
// A resident is still affiliated until a separation date is recorded.

export const POSITION_TITLES = Object.freeze([
  'RN Resident', 'Clinical Nurse I', 'Clinical Nurse II', 'Clinical Nurse III',
])
export const OTHER_TITLE = '__other__'

export const RESIDENTS_SCOPES = Object.freeze({ COHORT: 'cohort', AGGREGATE: 'aggregate' })

const text = (v, max) => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s.slice(0, max) : ''
}
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
export const dayOf = v => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : null)

// A separation is recorded as a calendar date. Noon UTC keeps the same date in
// every US time zone when it is read back as a timestamp.
export const separationTimestamp = d => `${d}T12:00:00.000Z`

// Validate the Residents edit form. hiredAt is the recorded hire, so a
// separation can never predate it.
export function validateResidentDetails(input, { hiredAt = null } = {}) {
  const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {}
  const errors = []
  const details = {}

  const title = typeof src.position_title === 'string' ? src.position_title.trim() : ''
  if (title.length > 120) errors.push({ field: 'position_title', message: 'Keep the title to 120 characters.' })
  details.position_title = title ? title.slice(0, 120) : null

  const preceptor = typeof src.preceptor_name === 'string' ? src.preceptor_name.trim() : ''
  if (preceptor.length > 200) errors.push({ field: 'preceptor_name', message: 'Keep the preceptor names to 200 characters.' })
  details.preceptor_name = preceptor ? preceptor.slice(0, 200) : null

  const phone = typeof src.phone === 'string' ? src.phone.trim() : ''
  if (phone && (phone.length > 40 || (phone.match(/\d/g) || []).length < 7 || !/^[\d\s().+\-x]+$/i.test(phone))) {
    errors.push({ field: 'phone', message: 'Enter a phone number, for example (310) 555-0100.' })
  }
  details.phone = phone || null

  const on = typeof src.separated_on === 'string' ? src.separated_on.trim() : ''
  const reason = typeof src.separation_reason === 'string' ? src.separation_reason.trim() : ''
  if (on && !isDate(on)) errors.push({ field: 'separated_on', message: 'Use a calendar date for the separation.' })
  else if (on && hiredAt && on < dayOf(hiredAt)) {
    errors.push({ field: 'separated_on', message: 'A separation cannot be earlier than the hire date.' })
  }
  if (reason && !on) errors.push({ field: 'separated_on', message: 'Add the separation date to record a reason.' })
  if (reason.length > 500) errors.push({ field: 'separation_reason', message: 'Keep the reason to 500 characters.' })
  details.separated_at = on && isDate(on) ? separationTimestamp(on) : null
  details.separation_reason = on && reason ? reason.slice(0, 500) : null

  return errors.length ? { ok: false, errors } : { ok: true, details }
}

// What the resident answered, reduced to the one value this page shows.
export const preceptorFromReflection = payload => text(payload?.about?.preceptor_names, 200) || null
export const phoneFromForm = payload => text(payload?.identity?.preferred_phone, 40) || null

const sourced = (typed, answered, answeredSource) => (
  typed ? { value: typed, source: 'record' }
    : answered ? { value: answered, source: answeredSource }
      : { value: '', source: null }
)

// One row per recorded hire. formPhones and reflectionPreceptors are keyed by
// candidate id.
export function composeResidents({
  outcomes = [], candidates = [], students = [], cycles = [], formPhones = {}, reflectionPreceptors = {},
} = {}) {
  const candById = new Map(candidates.map(c => [c.id, c]))
  const studentById = new Map(students.map(s => [s.id, s]))
  const cycleById = new Map(cycles.map(c => [c.id, c]))
  const rows = outcomes.filter(o => o && o.hired_at).map((o) => {
    const cand = candById.get(o.candidate_id) || {}
    const cycleId = o.cycle_id || cand.cycle_id || null
    const student = studentById.get(o.student_id || cand.student_id) || null
    return {
      candidate_id: o.candidate_id,
      cycle_id: cycleId,
      cohort_name: cycleById.get(cycleId)?.name || '',
      student,
      unit: o.hired_unit || cand.assigned_unit || '',
      shift: o.shift || '',
      hired_at: o.hired_at,
      residency_start_date: o.residency_start_date || null,
      position_title: o.position_title || '',
      preceptor: sourced(text(o.preceptor_name, 200), reflectionPreceptors[o.candidate_id], 'reflection'),
      phone: sourced(text(o.phone, 40), formPhones[o.candidate_id], 'form'),
      cs_email: o.cs_email || '',
      personal_email: student?.personal_email || '',
      separated_at: o.separated_at || null,
      separation_reason: o.separation_reason || '',
      affiliated: !o.separated_at,
    }
  })
  const key = r => `${r.student?.last_name || ''}${r.student?.preferred_first_name || r.student?.first_name || ''}`.toLowerCase()
  return rows.sort((a, b) => key(a).localeCompare(key(b)) || a.cohort_name.localeCompare(b.cohort_name))
}

// The retention tracker's counts. rate is a whole percent, or null with no hires.
export function retentionSummary(rows = []) {
  const hired = rows.length
  const separated = rows.filter(r => !r.affiliated).length
  const affiliated = hired - separated
  return { hired, affiliated, separated, rate: hired ? Math.round((affiliated / hired) * 100) : null }
}
