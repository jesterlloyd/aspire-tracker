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

// HIRE-HISTORY-3 (Owner, 2026-11-04): the titles a resident holds, stored in full words and
// offered by their short names. A title stored before this list ('RN Resident') still reads,
// as Other with its own words.
export const POSITION_TITLES = Object.freeze([
  'Clinical Nurse I', 'Clinical Nurse II', 'Clinical Nurse III', 'Clinical Nurse IV',
  'Assistant Nurse Manager', 'Associate Director',
  'Nursing Professional Development Practitioner', 'Clinical Nurse Specialist',
])
export const TITLE_SHORT = Object.freeze({
  'Clinical Nurse I': 'CN I', 'Clinical Nurse II': 'CN II', 'Clinical Nurse III': 'CN III', 'Clinical Nurse IV': 'CN IV',
  'Assistant Nurse Manager': 'ANM', 'Associate Director': 'AD',
  'Nursing Professional Development Practitioner': 'NPD-P', 'Clinical Nurse Specialist': 'CNS',
})
// A typed or imported title in its short form ('CN II', 'npd-p') reads as the full title.
export function canonicalTitle(v) {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) return ''
  const k = s.toLowerCase().replace(/[\s.]+/g, ' ')
  for (const [full, short] of Object.entries(TITLE_SHORT)) {
    if (full.toLowerCase() === k || short.toLowerCase().replace(/[\s.]+/g, ' ') === k) return full
  }
  return s
}

// HIRE-HISTORY-3 (Owner, 2026-11-04): a past hire is recorded by the residency cohort they were
// hired into, not a date. Its hire date is that cohort's residency start, else the day its
// applications opened: the cohort's own dates, so retention and "hired before" still order it.
export const cohortHireDate = cycle => dayOf(cycle?.residency_start_date) || dayOf(cycle?.application_open_date) || null
export const OTHER_TITLE = '__other__'

export const RESIDENTS_SCOPES = Object.freeze({ COHORT: 'cohort', AGGREGATE: 'aggregate' })

// RESIDENTS-ONE-RECORD-1: the record a Residents row opens, that resident's binder at the
// Hiring sheet in Profiles & Interest. By candidate, so an Aggregate row from another residency
// cohort switches the cohort first (ProfilesTab's ?candidate= lookup).
export const residentRecordPath = (base, candidateId) =>
  `${base}/profiles?candidate=${encodeURIComponent(candidateId)}&sheet=hiring`

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

  const title = canonicalTitle(src.position_title)
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

  // HIRE-HISTORY-1: the day a changed title took effect. Not a column of the outcome row; the
  // server writes it to the title history. Today when omitted; never before the hire.
  const eff = typeof src.title_effective_on === 'string' ? src.title_effective_on.trim() : ''
  if (eff && !isDate(eff)) errors.push({ field: 'title_effective_on', message: 'Use a calendar date for when the title took effect.' })
  else if (eff && hiredAt && eff < dayOf(hiredAt)) {
    errors.push({ field: 'title_effective_on', message: 'A title cannot take effect before the hire date.' })
  }
  const titleEffectiveOn = eff && isDate(eff) ? eff : null

  return errors.length ? { ok: false, errors } : { ok: true, details, titleEffectiveOn }
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
  outcomes = [], candidates = [], students = [], cycles = [], formPhones = {}, reflectionPreceptors = {}, titles = {},
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
      // HIRE-HISTORY-1: what they were hired as, their licensure at application, and the title
      // history (latest first). The current title is the latest row, else position_title.
      hired_as: o.hired_as || null,
      hired_as_other: o.hired_as_other || '',
      hired_as_label: hiredAsLabel(o),
      licensed_at_application: typeof o.licensed_at_application === 'boolean' ? o.licensed_at_application : null,
      license_issued_on: o.license_issued_on || null,
      interim_permit_issued: typeof o.interim_permit_issued === 'boolean' ? o.interim_permit_issued : null,
      backfilled: o.backfilled === true,
      titles: sortTitles(titles[o.candidate_id] || []),
      current_title: currentTitle(sortTitles(titles[o.candidate_id] || []), o.position_title),
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

// ── HIRE-HISTORY-1 (Owner, 2026-11-04) ───────────────────────────────────────
// What they were hired as, their licensure when they applied, the title history, and the two
// reports (by school, by ASPIRE cohort). Pure, so the sheet, the server and the tests agree.

// HIRE-HISTORY-2 (Owner, 2026-11-04): GNT is Graduate Nurse Trainee, and the screens say CN I
// and GNT. The stored value is the full name; HIRED_AS_SHORT is what a person reads.
export const HIRED_AS = Object.freeze(['Clinical Nurse I', 'Graduate Nurse Trainee', 'Other'])
export const HIRED_AS_OTHER = 'Other'
export const HIRED_AS_SHORT = Object.freeze({ 'Clinical Nurse I': 'CN I', 'Graduate Nurse Trainee': 'GNT', Other: 'Other' })
// HIRE-SITE-1 (Owner, 2026-11-07): a hire anywhere in Cedars-Sinai counts, not only a Medical
// Center unit. These are stored in hired_unit exactly as written, beside the catalog's unit names.
export const HIRE_SITES = Object.freeze(['Marina del Rey Hospital', 'Cedars-Sinai Health System'])
// GNT is the unlicensed path (HIRE-GNT-LICENSE-1, Owner, 2026-11-07): choosing it answers
// "licensed when they applied" with No. A person can still change that answer afterwards.
export const HIRED_AS_UNLICENSED = 'Graduate Nurse Trainee'
// One licensure date (the license issue date, HIRE-HISTORY-2) and the interim permit box.
// nclex_passed_on is no longer written or shown.
export const HIRE_HISTORY_KEYS = Object.freeze([
  'hired_as', 'hired_as_other', 'licensed_at_application', 'license_issued_on', 'interim_permit_issued',
])

export function hiredAsLabel(o) {
  if (!o?.hired_as) return ''
  return o.hired_as === HIRED_AS_OTHER ? (text(o.hired_as_other, 120) || 'Other') : (HIRED_AS_SHORT[o.hired_as] || o.hired_as)
}

const yesNo = v => (v === true || v === 'yes' ? true : v === false || v === 'no' ? false : null)
const yesNoValid = v => v === undefined || v === null || v === '' || typeof v === 'boolean' || v === 'yes' || v === 'no'

// Validate the hire-history fields of an outcome save. Every field is optional; an absent key
// reads as null, so a save from a sheet that predates these fields clears nothing by accident
// only because the sheet always sends what it shows.
export function validateHireHistory(input) {
  const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {}
  const errors = []
  const fields = {}
  const as = typeof src.hired_as === 'string' ? src.hired_as.trim() : ''
  if (as && !HIRED_AS.includes(as)) errors.push({ field: 'hired_as', message: 'Choose CN I, GNT or Other.' })
  fields.hired_as = as && HIRED_AS.includes(as) ? as : null
  const other = text(src.hired_as_other, 120)
  if (fields.hired_as === HIRED_AS_OTHER && !other) errors.push({ field: 'hired_as_other', message: 'Say what they were hired as.' })
  fields.hired_as_other = fields.hired_as === HIRED_AS_OTHER ? (other || null) : null
  const lic = src.licensed_at_application
  if (!yesNoValid(lic)) errors.push({ field: 'licensed_at_application', message: 'Licensed at application is yes, no or unknown.' })
  fields.licensed_at_application = yesNo(lic)
  const issued = typeof src.license_issued_on === 'string' ? src.license_issued_on.trim() : ''
  if (issued && !isDate(issued)) errors.push({ field: 'license_issued_on', message: 'Use a calendar date.' })
  fields.license_issued_on = issued && isDate(issued) ? issued : null
  const permit = src.interim_permit_issued
  if (!yesNoValid(permit)) errors.push({ field: 'interim_permit_issued', message: 'Interim permit issued is yes, no or unknown.' })
  fields.interim_permit_issued = yesNo(permit)
  return errors.length ? { ok: false, errors } : { ok: true, fields }
}

// A past hire recorded after the fact (Record past hires). The hire date is a calendar day;
// the server turns it into the hire timestamp and sets both offer timestamps to it.
export function validateBackfillHire(input, { cohort = null } = {}) {
  const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {}
  const errors = []
  // HIRE-HISTORY-3: a hire date is optional; without one the cohort's own date stands in.
  const typed = typeof src.hired_on === 'string' ? src.hired_on.trim() : ''
  if (typed && !isDate(typed)) errors.push({ field: 'hired_on', message: 'Use a calendar date for the hire.' })
  const hiredOn = typed || cohortHireDate(cohort) || ''
  if (!typed && !hiredOn) {
    errors.push({ field: 'cohort', message: `${cohort?.name || 'That cohort'} has no residency start date. Add one in Cohort Settings, or enter the hire date.` })
  }
  const unit = text(src.hired_unit, 120)
  if (!unit) errors.push({ field: 'hired_unit', message: 'A hire needs the unit they were hired into.' })
  const history = validateHireHistory(src)
  if (!history.ok) errors.push(...history.errors)
  const typedStart = typeof src.residency_start_date === 'string' ? src.residency_start_date.trim() : ''
  if (typedStart && !isDate(typedStart)) errors.push({ field: 'residency_start_date', message: 'Use a calendar date for the residency start.' })
  const start = typedStart || dayOf(cohort?.residency_start_date) || ''
  const title = text(canonicalTitle(src.position_title), 120)
  const details = validateResidentDetails(
    { separated_on: src.separated_on, separation_reason: src.separation_reason, position_title: title },
    { hiredAt: isDate(hiredOn) ? separationTimestamp(hiredOn) : null },
  )
  if (!details.ok) errors.push(...details.errors)
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    hire: {
      hired_at: separationTimestamp(hiredOn),
      hired_unit: unit,
      residency_start_date: start || null,
      position_title: title || null,
      separated_at: details.details.separated_at,
      separation_reason: details.details.separation_reason,
      ...history.fields,
    },
  }
}

const sortTitles = rows => [...rows]
  .filter(r => r && r.title && r.effective_on)
  .sort((a, b) => String(b.effective_on).localeCompare(String(a.effective_on)) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
  .map(r => ({ title: r.title, effective_on: dayOf(r.effective_on) }))
const currentTitle = (sorted, fallback) => sorted[0]?.title || fallback || ''

// ── The two reports ──────────────────────────────────────────────────────────
// population: every Completed intern the viewer may count, { student_id, school, cohort_name,
// applied } (applied: submitted a Transition Form in any residency cohort). residents: the
// composeResidents rows. A student hired in two cohorts counts once. A group under SMALL_GROUP
// interns shows its rate marked small rather than hidden: 1 of 2 is a fact, not a trend.
export const SMALL_GROUP = 5
const pct = (n, d) => (d ? Math.round((n / d) * 100) : null)

export function residentReports({ population = [], residents = [] } = {}) {
  const hiredIds = new Set()
  const retainedIds = new Set()
  for (const r of residents) {
    const id = r?.student?.id
    if (!id) continue
    hiredIds.add(id)
    if (r.affiliated) retainedIds.add(id)
  }
  const group = (keyOf, label) => {
    const rows = new Map()
    for (const p of population) {
      const key = keyOf(p) || label
      if (!rows.has(key)) rows.set(key, { key, interns: 0, applied: 0, hired: 0, retained: 0 })
      const g = rows.get(key)
      g.interns++
      if (p.applied) g.applied++
      if (hiredIds.has(p.student_id)) g.hired++
      if (retainedIds.has(p.student_id)) g.retained++
    }
    return [...rows.values()]
      .map(g => ({ ...g, hiredPct: pct(g.hired, g.interns), retainedPct: pct(g.retained, g.hired), small: g.interns < SMALL_GROUP }))
      .sort((a, b) => b.interns - a.interns || a.key.localeCompare(b.key))
  }
  return {
    bySchool: group(p => p.school, 'No school on file'),
    byCohort: group(p => p.cohort_name, 'No cohort on file'),
    totals: {
      interns: population.length,
      hired: population.filter(p => hiredIds.has(p.student_id)).length,
      retained: population.filter(p => retainedIds.has(p.student_id)).length,
    },
  }
}
