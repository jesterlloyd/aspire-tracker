// RESIDENCY-REFLECTION-1: the NGRP Bi-Weekly Clinical Orientation Progress and
// Reflection Tool, as a form. Owner decisions, 2026-09-13.
//
// This is the paper instrument residents fill in during orientation (RV/JG/CW
// 07.28.25), rebuilt so ASPIRE Intelligence sends it, stores it, and shows it.
// It replaces the weekly email check-in the Support tab counted before.
//
//   - BI-WEEKLY, FIVE PERIODS, TEN WEEKS, started by a button. Nothing is
//     anchored to residency_start_date; the schedule is built from the day the
//     ASPIRE team presses Start. Period 1 is sent at once. Each later period is
//     sent on the Friday night before it opens and is due the Sunday that
//     closes it, which is how the paper tool reads.
//   - The one-time intake on the tool's cover page (unit, preceptor names,
//     schedule, questions) is the "About you" section of period 1, not a sixth
//     send. The emergency-contact line is left out: a phone number the NPD-P
//     keeps on file is not something this app needs to store.
//   - The preceptor's comments and signature are deferred to a later piece;
//     this is the resident's side only.
//
// PURE AND BROWSER-SAFE. No server imports. The public page, the Support tab,
// and lib/server/ngrpReflection.js all read this one definition, so the form
// the resident sees, the validation the server applies, and the schedule the
// cron follows can never disagree.

export const PERIOD_COUNT = 5
export const PERIOD_DAYS = 14
// The link stays open this many days past the Sunday due date. New graduates
// work weekends; a Tuesday close costs nothing and saves a lot of "I missed
// it by an hour" email.
export const GRACE_DAYS = 2
export const MAX_SHIFTS = 6
export const MAX_GOALS = 3

// The ten areas on the cover page, in the order the tool lists them.
export const DIFFICULTY_AREAS = Object.freeze([
  { key: 'critical_thinking',    label: 'Critical Thinking' },
  { key: 'time_management',      label: 'Time Management' },
  { key: 'patient_care_safety',  label: 'Patient Care / Safety' },
  { key: 'medication_management', label: 'Medication Management' },
  { key: 'communication_skills', label: 'Communication Skills', hint: 'patient, family, coworkers, physicians, team members' },
  { key: 'cs_link_documentation', label: 'CS Link Documentation' },
  { key: 'patient_experience',   label: 'Improving Patient Experience' },
  { key: 'basic_procedures',     label: 'Mastering Basic Procedures and Skills', hint: 'including unit-specific, for example chest tubes, trach care' },
  { key: 'equipment_resources',  label: 'Correct Use of Equipment and Resources' },
  { key: 'teamwork',             label: 'Teamwork / Interdisciplinary Interactions' },
])
export const DIFFICULTY_AREA_KEYS = Object.freeze(DIFFICULTY_AREAS.map(a => a.key))

export const GOAL_STATES = Object.freeze(['met', 'not_met'])

export const EMPTY_SHIFT = Object.freeze({ date: '', patients: '', tsam_tier: '', diagnoses: '', went_well: '', improve: '' })
export const EMPTY_GOAL = Object.freeze({ text: '', met: null, carry_forward: false })

export function emptyReflection() {
  return {
    about: { unit: '', preceptor_names: '', work_schedule: '', questions: '' },
    shifts: [{ ...EMPTY_SHIFT }],
    skills: { communication: '', technical: '' },
    goals: [{ ...EMPTY_GOAL }, { ...EMPTY_GOAL }, { ...EMPTY_GOAL }],
    development: { ana_standards: '', caritas: '' },
    difficulty_areas: [],
    workshops: '',
    support_needed: '',
    competencies_on_track: null,
  }
}

// ── Schedule (pure date math on YYYY-MM-DD strings, no time zones) ──────────
const isYmd = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const toUtc = ymd => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d) }
const fromUtc = ms => new Date(ms).toISOString().slice(0, 10)

export function addDays(ymd, n) {
  return fromUtc(toUtc(ymd) + n * 86400000)
}
// 0 = Sunday, like Date#getUTCDay.
export function weekdayOf(ymd) {
  return new Date(toUtc(ymd)).getUTCDay()
}
export function daysBetween(fromYmd, toYmd) {
  return Math.round((toUtc(toYmd) - toUtc(fromYmd)) / 86400000)
}
// The first date on or after `ymd` that falls on `weekday`.
export function nextWeekdayOnOrAfter(ymd, weekday) {
  const delta = (weekday - weekdayOf(ymd) + 7) % 7
  return addDays(ymd, delta)
}

/**
 * The five periods, built from the day the team pressed Start.
 *
 *   period 1: opens on the start day, is sent at once, and is due on the
 *             Sunday on or after start + 13 days (so it is 13 to 19 days long,
 *             then everything lands on Sundays).
 *   period n: opens the Monday after period n-1 is due, is sent the Friday
 *             before that (opens - 3), and is due 14 days after period n-1.
 *
 * Materialized on the run so the cron is a trivial query ("send_on is today
 * and sent_at is null") and the schedule is inspectable rather than recomputed.
 */
export function buildSchedule({ startedOn, periodCount = PERIOD_COUNT, periodDays = PERIOD_DAYS }) {
  if (!isYmd(startedOn)) throw new Error('startedOn must be YYYY-MM-DD')
  const firstDue = nextWeekdayOnOrAfter(addDays(startedOn, periodDays - 1), 0)
  const periods = []
  for (let n = 1; n <= periodCount; n += 1) {
    const dueOn = addDays(firstDue, periodDays * (n - 1))
    const opensOn = n === 1 ? startedOn : addDays(periods[n - 2].due_on, 1)
    const sendOn = n === 1 ? startedOn : addDays(opensOn, -3)
    periods.push({ period_number: n, opens_on: opensOn, due_on: dueOn, send_on: sendOn })
  }
  return periods
}

// The last calendar day a period accepts saves and submissions.
export function closesOn(period) {
  return addDays(period.due_on, GRACE_DAYS)
}

// ── Validation (pure). Canonicalizes; unexpected keys are dropped. ──────────
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const intOrNull = v => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : null
}
const boolOrNull = v => (v === true ? true : v === false ? false : null)
const realDate = v => {
  if (!isYmd(v)) return null
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? v : null
}

const shiftIsBlank = s => !s.date && s.patients === null && !s.tsam_tier && !s.diagnoses && !s.went_well && !s.improve

/**
 * validateReflection(payload, { periodNumber, requireComplete })
 * Returns { ok:true, payload } (canonical) or { ok:false, errors:[{field,message}] }.
 * A draft is never refused for being incomplete; a submission needs at least
 * one dated shift, the on-track answer, and (in period 1) the unit.
 */
export function validateReflection(raw, { periodNumber = 1, requireComplete = true } = {}) {
  const p = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {}
  const about = p.about || {}
  const skills = p.skills || {}
  const dev = p.development || {}

  const shifts = (Array.isArray(p.shifts) ? p.shifts : []).slice(0, MAX_SHIFTS).map(s => {
    const o = (s && typeof s === 'object') ? s : {}
    return {
      date: realDate(o.date),
      patients: intOrNull(o.patients),
      tsam_tier: str(o.tsam_tier, 20),
      diagnoses: str(o.diagnoses, 1000),
      went_well: str(o.went_well, 2000),
      improve: str(o.improve, 2000),
    }
  }).filter(s => !shiftIsBlank(s))

  const goals = (Array.isArray(p.goals) ? p.goals : []).slice(0, MAX_GOALS).map(g => {
    const o = (g && typeof g === 'object') ? g : {}
    return {
      text: str(o.text, 300),
      met: GOAL_STATES.includes(o.met) ? o.met : null,
      carry_forward: o.carry_forward === true,
    }
  }).filter(g => g.text)

  const areas = Array.isArray(p.difficulty_areas)
    ? [...new Set(p.difficulty_areas.filter(k => DIFFICULTY_AREA_KEYS.includes(k)))]
    : []

  const canonical = {
    about: periodNumber === 1 ? {
      unit: str(about.unit, 120),
      preceptor_names: str(about.preceptor_names, 200),
      work_schedule: str(about.work_schedule, 1000),
      questions: str(about.questions, 2000),
    } : null,
    shifts,
    skills: { communication: str(skills.communication, 2000), technical: str(skills.technical, 2000) },
    goals,
    development: { ana_standards: str(dev.ana_standards, 2000), caritas: str(dev.caritas, 2000) },
    difficulty_areas: areas,
    workshops: str(p.workshops, 600),
    support_needed: str(p.support_needed, 2000),
    competencies_on_track: boolOrNull(p.competencies_on_track),
  }

  const errors = []
  if (requireComplete) {
    if (periodNumber === 1 && !canonical.about.unit) errors.push({ field: 'about.unit', message: 'Enter the unit you are orienting on.' })
    if (!canonical.shifts.some(s => s.date)) errors.push({ field: 'shifts', message: 'Add at least one shift with its date.' })
    if (canonical.competencies_on_track === null) errors.push({ field: 'competencies_on_track', message: 'Answer whether your orientation competencies are on track.' })
  }
  if (errors.length) return { ok: false, errors }
  return { ok: true, payload: canonical }
}

// ── What the Support tab shows per resident (pure) ──────────────────────────
export const PERIOD_STATUSES = Object.freeze(['pending', 'sent', 'opened', 'in_progress', 'submitted'])

/**
 * A resident's reflections at a glance. `today` is YYYY-MM-DD (Pacific).
 * overdue: a period that was sent, is past its due date, and was not submitted.
 * next: the earliest period not yet submitted, whether or not it has been sent.
 */
export function summarizeReflections(run, periods = [], today) {
  if (!run) return { started: false, sent: 0, submitted: 0, total: 0, overdue: 0, next: null, done: false, stopped: false }
  const mine = periods.filter(p => p.run_id === run.id).sort((a, b) => a.period_number - b.period_number)
  const submitted = mine.filter(p => p.status === 'submitted').length
  const sent = mine.filter(p => p.sent_at).length
  const overdue = today ? mine.filter(p => p.sent_at && p.status !== 'submitted' && today > p.due_on).length : 0
  const next = mine.find(p => p.status !== 'submitted') || null
  return {
    started: true,
    stopped: run.status === 'stopped',
    done: run.status === 'completed' || (mine.length > 0 && submitted === mine.length),
    sent, submitted, total: mine.length, overdue, next,
  }
}
