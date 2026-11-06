// ASPIRE-INSIGHTS-1, Phase 1: the one metric layer behind ASPIRE Insights.
//
// Every figure on the Insights page, the NE&L Data tab and each portal's At a Glance outcomes
// section comes from computeInsights. Charts never compute their own math. This module is PURE:
// lib/server/insights/getInsights.js reads the rows, buildSnapshot normalizes them, and
// computeInsights applies the viewer's lock FIRST and then the filters. Reference:
// docs/mockups/aspire-insights.html. Owner decisions, 2026-11-05 (they override the build prompt):
//
//   - Applied to NGRP is a staff-marked application (ngrp_candidates.application_status
//     'confirmed') OR a hire on record. The Transition Form is NOT an application, so
//     "Submitted Transition Form" is its own funnel step before Applied.
//   - Internal is the intake's cs_affiliation 'Current Employee' only. Volunteers and former
//     employees are External.
//   - Completed is the stored ASPIRE status. Hours are not re-checked.
//   - A cohort whose students carry no placement record at all (Fall 2025 and Spring 2026 were
//     imported as completers only) enters the funnel at Completed. It is never counted toward
//     Applicants, Interviewed, Placed, or any placement chart.
//   - No preceptor load chart: a preceptor never takes more than one student per cohort.
//   - Clinical hours by school is a card of its own.

import { resolveOperativeSchoolName } from '../schoolIdentity.js'
import { unitNameKey, canonicalUnitName } from '../unitNameCanon.js'
import { cohortTimelineKey, sortByCohortTimeline } from '../cohortTimeline.js'

/** A rate built on fewer students than this is "Too few to rate": the count shows, the rate never does. */
export const MIN_CELL = 5
/** A partner never sees the program average unless at least this many schools are in it. */
export const MIN_SCHOOLS_FOR_AVERAGE = 3
/** How long a filter set's figures are reused before the rows are read again. */
export const CACHE_MS = 10 * 60 * 1000

export const MEASURES = Object.freeze(['applied', 'offered', 'hired'])
export const MEASURE_LABELS = Object.freeze({
  transition: 'Submitted Transition Form',
  applied: 'Applied to NGRP',
  offered: 'Offered NGRP',
  hired: 'Hired into NGRP',
})
export const PATHWAYS = Object.freeze(['all', 'internal', 'external'])
export const RESIDENCY_STATUSES = Object.freeze(['all', 'applied', 'not_applied', 'offered', 'hired', 'applied_not_hired'])
export const COMPARES = Object.freeze(['off', 'previous', 'program'])
export const SHIFTS = Object.freeze(['Day', 'Night', 'Mid'])
export const CHOICE_BUCKETS = Object.freeze([
  { key: 'top_choice', label: '1st choice' },
  { key: 'second_choice', label: '2nd choice' },
  { key: 'third_choice', label: '3rd choice' },
  { key: 'other', label: 'Not a choice' },
])

/** Who is asking. The server decides the kind; nothing in a request can change it. */
export const VIEWER_KINDS = Object.freeze(['staff', 'leadership', 'partner', 'unit', 'residency'])
const FULL_PAGE = new Set(['staff', 'leadership'])

/**
 * The definitions, worded once. The Definitions drawer reads this list.
 */
export const DEFINITIONS = Object.freeze([
  { term: 'Applicants', text: 'Every student a school submitted for the cohort, less Declined and Not Proceeding (the Cohort pulse rule).' },
  { term: 'Placed', text: 'Students matched to a unit on the Placement Board.' },
  { term: 'Completed', text: 'Students whose ASPIRE status is Completed.' },
  { term: 'Submitted Transition Form', text: 'Completed students who submitted the NGRP Transition Form. The form is not an application.' },
  { term: 'Applied to NGRP', text: 'Completed students the team marked as having applied to NGRP, or who were hired. Denominator: completed students in finished cohorts.' },
  { term: 'Offered NGRP', text: 'Completed students with an NGRP offer on record. Same denominator.' },
  { term: 'Hired into NGRP', text: 'Completed students hired into NGRP. Same denominator. The headline rate.' },
  { term: 'Internal', text: 'A Cedars-Sinai employee when they applied to ASPIRE (the intake\'s affiliation is Current Employee). Volunteers are external.' },
  { term: 'Unit yield', text: 'Students hired into NGRP on the unit where they rotated, divided by the students the unit hosted, in finished cohorts.' },
  { term: 'Casey-Fink change', text: 'For students with a pre- and post-rotation response, the post-rotation Section I mean minus the pre-rotation mean.' },
  { term: 'Clinical hours', text: 'Approved hours logged against the school\'s required hours.' },
  { term: 'Too few to rate', text: `Any rate built on fewer than ${MIN_CELL} students. The count still shows.` },
  { term: 'In rotation', text: 'A cohort still in its rotation. It counts toward Applicants and Placed, never toward an outcome rate.' },
  { term: 'Placement history', text: 'Cohorts imported as completers only have no placement record. They enter the funnel at Completed.' },
])

// ── Small pieces ─────────────────────────────────────────────────────────────

/**
 * A rate under the small-cell rule. `count` of `n`; rate is a 0-100 percentage, one decimal.
 * Under MIN_CELL the rate is withheld and `suppressed` is true.
 */
export function rateOf(count, n) {
  const c = Number(count) || 0
  const d = Number(n) || 0
  if (d < MIN_CELL) return { count: c, n: d, rate: null, suppressed: true }
  return { count: c, n: d, rate: Math.round((c / d) * 1000) / 10, suppressed: false }
}

/** A mean under the same rule. */
export function meanOf(values) {
  const list = (values || []).filter(v => Number.isFinite(v))
  if (list.length < MIN_CELL) return { n: list.length, mean: null, suppressed: true }
  const mean = list.reduce((s, v) => s + v, 0) / list.length
  return { n: list.length, mean: Math.round(mean * 100) / 100, suppressed: false }
}

/** Change between two rates, in percentage points, or null when either is withheld. */
export function pointsBetween(a, b) {
  if (!a || !b || a.rate === null || b.rate === null) return null
  return Math.round((a.rate - b.rate) * 10) / 10
}

// The Cohort pulse's ladder (src/lib/home/cyclePhase.js pipelineCounts), so Insights and
// At a Glance never disagree on who applied, interviewed or was placed.
const STAGE_RANK = { 'Pending Outreach': 0, 'Form Sent': 0, 'Form Received': 0, 'Interview Scheduled': 0, Interviewed: 1, Placed: 2, 'Active Rotation': 3, Completed: 4 }
const WITHDRAWN = new Set(['Declined', 'Not Proceeding'])
export function stageOf(status) {
  if (WITHDRAWN.has(status)) return -1
  return STAGE_RANK[status] ?? 0
}

function schoolName(raw) {
  const resolved = resolveOperativeSchoolName(raw)
  return resolved?.displayName || (String(raw || '').trim() || 'School not recorded')
}

// ── Snapshot: raw rows to one normalized student list ────────────────────────

/**
 * Normalize the rows the loader read. Pure and tested.
 * @param {object} raw
 * @param {object[]} raw.cohorts            { id, name, finished }   (finished from derivePhase === 'eval')
 * @param {object[]} raw.students           students rows (id, cohort_id, school, status, cs_affiliation,
 *                                          matched_unit_id, shift_assigned, hours_required, approved_hours)
 * @param {object[]} raw.matches            { student_id, unit_id, match_quality, shift_assigned }
 * @param {object[]} raw.units              { id, unit_name, division }
 * @param {object[]} raw.unitAssignments    student_unit_assignments rows (student_id, unit_id, unit_key, status)
 * @param {object[]} raw.candidates         { id, student_id, application_status, application_confirmed_at }
 * @param {object[]} raw.outcomes           { candidate_id, student_id, offer_extended_at, hired_at, hired_unit }
 * @param {object[]} raw.submittedCandidateIds  candidate ids with a submitted Transition Form
 * @param {Map|object} raw.caseyFinkChange  student_id -> post minus pre (Section I mean)
 * @param {string} raw.loadedAt
 */
export function buildSnapshot(raw = {}) {
  const unitsById = new Map((raw.units || []).map(u => [u.id, u]))
  const divisionByKey = new Map()
  for (const u of raw.units || []) {
    const k = unitNameKey(u.unit_name)
    if (k && u.division && !divisionByKey.has(k)) divisionByKey.set(k, u.division)
  }
  const matchByStudent = new Map()
  for (const m of raw.matches || []) matchByStudent.set(m.student_id, m)

  const unitsByStudent = new Map()
  const addUnit = (sid, name) => {
    const key = unitNameKey(name)
    if (!sid || !key) return
    const list = unitsByStudent.get(sid) || []
    if (!list.some(u => u.key === key)) list.push({ key, name: canonicalUnitName(name), serviceLine: divisionByKey.get(key) || null })
    unitsByStudent.set(sid, list)
  }
  for (const s of raw.students || []) {
    const m = matchByStudent.get(s.id)
    const u = unitsById.get(m?.unit_id) || unitsById.get(s.matched_unit_id)
    if (u) addUnit(s.id, u.unit_name)
  }
  for (const a of raw.unitAssignments || []) {
    if (a.status === 'removed') continue
    addUnit(a.student_id, unitsById.get(a.unit_id)?.unit_name || a.unit_key)
  }

  const submitted = new Set(raw.submittedCandidateIds || [])
  const outcomeByCandidate = new Map((raw.outcomes || []).map(o => [o.candidate_id, o]))
  const ngrpByStudent = new Map()
  for (const c of raw.candidates || []) {
    const o = outcomeByCandidate.get(c.id)
    const e = ngrpByStudent.get(c.student_id) || { transition: false, applied: false, offered: false, hired: false, hiredUnitKey: null }
    if (submitted.has(c.id)) e.transition = true
    // applied_set writes application_confirmed_at; a later Not Proceeding keeps the timestamp.
    if (c.application_status === 'confirmed' || c.application_confirmed_at) e.applied = true
    if (o?.offer_extended_at) e.offered = true
    if (o?.hired_at) {
      e.hired = true; e.applied = true; e.offered = true
      e.hiredUnitKey = unitNameKey(o.hired_unit) || e.hiredUnitKey
    }
    ngrpByStudent.set(c.student_id, e)
  }

  const cf = raw.caseyFinkChange instanceof Map ? raw.caseyFinkChange : new Map(Object.entries(raw.caseyFinkChange || {}))

  // A cohort whose students have no placement record at all is a completers-only import.
  const placedCohorts = new Set((raw.students || []).filter(s => unitsByStudent.has(s.id) || matchByStudent.has(s.id)).map(s => s.cohort_id))
  const cohorts = sortByCohortTimeline((raw.cohorts || []).map(c => ({
    id: c.id,
    name: c.name,
    finished: c.finished === true,
    partial: !placedCohorts.has(c.id),
  })))

  const students = (raw.students || []).map(s => {
    const m = matchByStudent.get(s.id)
    const units = unitsByStudent.get(s.id) || []
    const ngrp = ngrpByStudent.get(s.id) || { transition: false, applied: false, offered: false, hired: false, hiredUnitKey: null }
    const required = Number(s.hours_required) || 0
    const change = cf.get(s.id)
    return {
      id: s.id,
      cohortId: s.cohort_id,
      school: schoolName(s.school),
      // The stored text, for the server's partner lock only; computeInsights never returns it.
      rawSchool: s.school || null,
      status: s.status,
      stage: stageOf(s.status),
      internal: s.cs_affiliation === 'Current Employee',
      placed: stageOf(s.status) >= 2 && (units.length > 0 || Boolean(m)),
      units,
      shift: normalizeShift(m?.shift_assigned || s.shift_assigned),
      choice: m?.match_quality || null,
      hoursRequired: required,
      hoursApproved: Number(s.approved_hours) || 0,
      cfChange: Number.isFinite(change) ? change : null,
      ngrp,
    }
  })

  return { loadedAt: raw.loadedAt || new Date().toISOString(), cohorts, students }
}

function normalizeShift(v) {
  const s = String(v || '').trim().toLowerCase()
  if (s.startsWith('day')) return 'Day'
  if (s.startsWith('night')) return 'Night'
  if (s.startsWith('mid')) return 'Mid'
  return null
}

// ── Filters ──────────────────────────────────────────────────────────────────

const list = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : String(v).split(',')).map(x => String(x).trim()).filter(Boolean)

/**
 * The effective filters for this viewer. A full-page viewer may use every filter; a portal's
 * At a Glance section has the cohort filter only, and its measure is always Hired.
 */
export function sanitizeFilters(input = {}, viewer = { kind: 'staff' }) {
  const full = FULL_PAGE.has(viewer?.kind)
  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback)
  const f = {
    cohortIds: list(input.cohortIds ?? input.cohort),
    schools: full ? list(input.schools ?? input.school) : [],
    pathway: full ? pick(input.pathway, PATHWAYS, 'all') : 'all',
    serviceLine: full ? (String(input.serviceLine || '').trim() || null) : null,
    unit: full ? (unitNameKey(input.unit) || null) : null,
    shift: full ? pick(input.shift, SHIFTS, null) : null,
    residencyStatus: full ? pick(input.residencyStatus, RESIDENCY_STATUSES, 'all') : 'all',
    measure: full ? pick(input.measure, MEASURES, 'hired') : 'hired',
    compare: full ? pick(input.compare, COMPARES, 'off') : 'off',
  }
  // Previous cohort compares one cohort with the one before it, so it needs exactly one.
  if (f.compare === 'previous' && f.cohortIds.length !== 1) f.compare = 'off'
  return f
}

function residencyMatch(s, status) {
  const n = s.ngrp
  switch (status) {
    case 'applied': return n.applied
    case 'not_applied': return !n.applied
    case 'offered': return n.offered
    case 'hired': return n.hired
    case 'applied_not_hired': return n.applied && !n.hired
    default: return true
  }
}

/** Students the filters keep. A unit, service-line or shift filter keeps only the placed. */
export function applyFilters(students, f) {
  const schools = new Set(f.schools)
  const cohorts = new Set(f.cohortIds)
  return students.filter(s => {
    if (cohorts.size && !cohorts.has(s.cohortId)) return false
    if (schools.size && !schools.has(s.school)) return false
    if (f.pathway === 'internal' && !s.internal) return false
    if (f.pathway === 'external' && s.internal) return false
    if (f.unit && !s.units.some(u => u.key === f.unit)) return false
    if (f.serviceLine && !s.units.some(u => u.serviceLine === f.serviceLine)) return false
    if (f.shift && s.shift !== f.shift) return false
    if (f.residencyStatus !== 'all' && !residencyMatch(s, f.residencyStatus)) return false
    return true
  })
}

const unitFiltered = f => Boolean(f.unit || f.serviceLine || f.shift)

// ── Metrics ──────────────────────────────────────────────────────────────────

function cohortSets(snapshot) {
  const finished = new Set(snapshot.cohorts.filter(c => c.finished).map(c => c.id))
  const partial = new Set(snapshot.cohorts.filter(c => c.partial).map(c => c.id))
  return { finished, partial }
}

/**
 * The residency outcome rates for a population. Numerator: completed students in FINISHED
 * cohorts who reached the step. Denominator: completed students in finished cohorts. A cohort
 * still in rotation never counts.
 */
function residencyRates(students, sets) {
  const base = students.filter(s => s.status === 'Completed' && sets.finished.has(s.cohortId))
  const out = { n: base.length }
  for (const k of ['transition', 'applied', 'offered', 'hired']) out[k] = rateOf(base.filter(s => s.ngrp[k]).length, base.length)
  return out
}

/** Completion rate: completed / placed, in finished cohorts with a placement record. */
function completionRate(students, sets) {
  const placed = students.filter(s => s.placed && sets.finished.has(s.cohortId) && !sets.partial.has(s.cohortId))
  return rateOf(placed.filter(s => s.status === 'Completed').length, placed.length)
}

/** Share of placed students (with a placement record) matched to their 1st choice. */
function firstChoiceRate(students, sets) {
  const placed = students.filter(s => s.placed && !sets.partial.has(s.cohortId) && s.choice)
  return rateOf(placed.filter(s => s.choice === 'top_choice').length, placed.length)
}

function tilesFor(students, sets, f) {
  const full = students.filter(s => !sets.partial.has(s.cohortId))
  const res = residencyRates(students, sets)
  return {
    // Applicants have no unit, so a unit, service-line or shift filter leaves this tile empty.
    applicants: unitFiltered(f)
      ? { count: null, na: true, note: 'Applicants have no unit yet' }
      : { count: full.filter(s => s.stage >= 0).length, na: false },
    placed: { count: full.filter(s => s.placed).length },
    completed: { count: students.filter(s => s.status === 'Completed').length, rate: completionRate(students, sets) },
    measure: res[f.measure],
    transition: res.transition,
    applied: res.applied,
    offered: res.offered,
    hired: res.hired,
    inRotation: { count: students.filter(s => s.status === 'Active Rotation').length },
    retention: { connected: false },
  }
}

function pipelineFor(students, sets, f) {
  const finished = students.filter(s => sets.finished.has(s.cohortId))
  const full = finished.filter(s => !sets.partial.has(s.cohortId))
  const completed = finished.filter(s => s.status === 'Completed')
  const steps = [
    { key: 'applicants', label: 'Applied to ASPIRE', count: unitFiltered(f) ? null : full.filter(s => s.stage >= 0).length },
    { key: 'interviewed', label: 'Interviewed', count: unitFiltered(f) ? null : full.filter(s => s.stage >= 1).length },
    { key: 'placed', label: 'Placed', count: full.filter(s => s.placed).length },
    { key: 'completed', label: 'Completed', count: completed.length },
    { key: 'transition', label: MEASURE_LABELS.transition, count: completed.filter(s => s.ngrp.transition).length },
    { key: 'applied', label: MEASURE_LABELS.applied, count: completed.filter(s => s.ngrp.applied).length },
    { key: 'offered', label: MEASURE_LABELS.offered, count: completed.filter(s => s.ngrp.offered).length },
    { key: 'hired', label: MEASURE_LABELS.hired, count: completed.filter(s => s.ngrp.hired).length },
  ]
  // % of the prior step. Completers-only cohorts join at Completed, so Completed is measured
  // against Placed on the cohorts that have both.
  const fullCompleted = full.filter(s => s.status === 'Completed').length
  for (let i = 0; i < steps.length; i += 1) {
    const prior = steps[i - 1]
    const step = steps[i]
    if (!prior || prior.count === null || step.count === null) { step.ofPrior = null; step.drop = null; continue }
    const num = step.key === 'completed' ? fullCompleted : step.count
    step.ofPrior = rateOf(num, prior.count)
    step.drop = Math.max(0, prior.count - num)
  }
  const inRotation = students.filter(s => !sets.finished.has(s.cohortId))
  return { steps, excludedCohortIds: [...new Set(inRotation.map(s => s.cohortId))] }
}

function choiceFor(students, sets, measure) {
  const placed = students.filter(s => s.placed && !sets.partial.has(s.cohortId))
  const recorded = placed.filter(s => s.choice)
  const buckets = CHOICE_BUCKETS.map(b => ({ ...b, ...rateOf(recorded.filter(s => s.choice === b.key).length, recorded.length) }))
  const top = students.filter(s => s.choice === 'top_choice')
  const rest = students.filter(s => s.choice && s.choice !== 'top_choice')
  return {
    buckets,
    notRecorded: placed.length - recorded.length,
    // An association, never a cause: 1st-choice matches vs everyone else.
    association: { top: residencyRates(top, sets)[measure], others: residencyRates(rest, sets)[measure] },
  }
}

function groupBy(items, keyOf) {
  const m = new Map()
  for (const it of items) {
    const k = keyOf(it)
    if (k == null) continue
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(it)
  }
  return m
}

function bySchoolFor(students, sets, measure) {
  return [...groupBy(students, s => s.school)].map(([school, rows]) => ({ school, ...residencyRates(rows, sets)[measure] }))
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.school.localeCompare(b.school))
}

function trendsFor(snapshot, students) {
  const sets = cohortSets(snapshot)
  return snapshot.cohorts.map(c => {
    const rows = students.filter(s => s.cohortId === c.id)
    const r = residencyRates(rows, sets)
    return {
      cohortId: c.id, name: c.name, finished: c.finished, partial: c.partial,
      placed: c.partial ? null : rows.filter(s => s.placed).length,
      applied: c.finished ? r.applied : null,
      offered: c.finished ? r.offered : null,
      hired: c.finished ? r.hired : null,
    }
  })
}

function pathwayFor(students, sets, measure) {
  const panel = rows => ({
    count: rows.length,
    measure: residencyRates(rows, sets)[measure],
    completion: completionRate(rows, sets),
    firstChoice: firstChoiceRate(rows, sets),
    caseyFink: meanOf(rows.map(s => s.cfChange)),
  })
  return { internal: panel(students.filter(s => s.internal)), external: panel(students.filter(s => !s.internal)) }
}

function unitRows(students, sets) {
  // One row per (student, unit) the student was placed on, from cohorts with a placement record.
  const out = []
  for (const s of students) {
    if (!s.placed || sets.partial.has(s.cohortId)) continue
    for (const u of s.units) out.push({ s, u })
  }
  return out
}

function hostedFor(students, sets) {
  const rows = unitRows(students, sets)
  return [...groupBy(rows, r => r.u.key)].map(([key, rs]) => {
    const bySchool = [...groupBy(rs, r => r.s.school)].map(([school, x]) => ({ school, count: x.length }))
      .sort((a, b) => b.count - a.count || a.school.localeCompare(b.school))
    return { unitKey: key, unit: rs[0].u.name, serviceLine: rs[0].u.serviceLine, total: rs.length, bySchool }
  }).sort((a, b) => b.total - a.total || a.unit.localeCompare(b.unit))
}

/** Hired back onto the same unit / students hosted, finished cohorts only. */
function yieldFor(students, sets) {
  const rows = unitRows(students, sets).filter(r => sets.finished.has(r.s.cohortId))
  const units = [...groupBy(rows, r => r.u.key)].map(([key, rs]) => ({
    unitKey: key, unit: rs[0].u.name,
    ...rateOf(rs.filter(r => r.s.ngrp.hired && r.s.ngrp.hiredUnitKey === key).length, rs.length),
  })).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.unit.localeCompare(b.unit))
  const program = rateOf(rows.filter(r => r.s.ngrp.hired && r.s.ngrp.hiredUnitKey === r.u.key).length, rows.length)
  return { units, program }
}

function heatmapFor(students, sets) {
  const rows = unitRows(students, sets)
  const schools = [...new Set(rows.map(r => r.s.school))].sort()
  const hosted = hostedFor(students, sets)
  const units = hosted.map(h => h.unit)
  const cells = schools.map(school => hosted.map(h => h.bySchool.find(b => b.school === school)?.count || 0))
  return { schools, units, cells }
}

function cfBySchoolFor(students) {
  return [...groupBy(students.filter(s => s.cfChange !== null), s => s.school)]
    .map(([school, rows]) => ({ school, ...meanOf(rows.map(s => s.cfChange)) }))
    .sort((a, b) => a.school.localeCompare(b.school))
}

/** Approved hours against the requirement, for placed students whose requirement is known. */
function hoursBySchoolFor(students, sets) {
  const known = students.filter(s => s.placed && !sets.partial.has(s.cohortId) && s.hoursRequired > 0)
  return [...groupBy(known, s => s.school)].map(([school, rows]) => {
    const hours = meanOf(rows.map(s => s.hoursApproved))
    const required = meanOf(rows.map(s => s.hoursRequired))
    const pct = meanOf(rows.map(s => Math.min(100, (s.hoursApproved / s.hoursRequired) * 100)))
    return { school, n: rows.length, suppressed: hours.suppressed, meanHours: hours.mean, meanRequired: required.mean, pctOfRequirement: pct.mean }
  }).sort((a, b) => a.school.localeCompare(b.school))
}

function previousCohortId(snapshot, cohortId) {
  const i = snapshot.cohorts.findIndex(c => c.id === cohortId)
  if (i <= 0) return null
  const key = cohortTimelineKey(snapshot.cohorts[i].name)
  for (let j = i - 1; j >= 0; j -= 1) {
    if (cohortTimelineKey(snapshot.cohorts[j].name) !== key) return snapshot.cohorts[j].id
  }
  return null
}

// ── Locks ────────────────────────────────────────────────────────────────────

/**
 * The viewer's population, decided before any filter. `lockedStudentIds` is computed on the
 * server from the viewer's own grant (school scope, unit scope); a portal viewer without it
 * sees nobody, never everybody.
 */
export function lockedStudents(snapshot, viewer) {
  if (FULL_PAGE.has(viewer?.kind) || viewer?.kind === 'residency') return snapshot.students
  const ids = viewer?.lockedStudentIds instanceof Set ? viewer.lockedStudentIds : new Set(viewer?.lockedStudentIds || [])
  return snapshot.students.filter(s => ids.has(s.id))
}

// ── The one entry point ──────────────────────────────────────────────────────

/**
 * Every figure for one filter set and one viewer.
 * @returns {object} the full page's figures for staff and leadership, or the portal section's
 *   figures for a partner, unit leader or the Residency Portal. Aggregates only, never a student id.
 */
export function computeInsights(snapshot, filtersIn = {}, viewer = { kind: 'staff' }) {
  if (!VIEWER_KINDS.includes(viewer?.kind)) throw new Error('unknown_viewer')
  const f = sanitizeFilters(filtersIn, viewer)
  const sets = cohortSets(snapshot)
  const mine = lockedStudents(snapshot, viewer)
  const students = applyFilters(mine, f)

  const base = {
    asOf: snapshot.loadedAt,
    viewer: viewer.kind,
    filters: f,
    minCell: MIN_CELL,
    inView: { applicants: tilesFor(students, sets, f).applicants.count, placed: students.filter(s => s.placed).length },
    cohorts: snapshot.cohorts.map(c => ({ id: c.id, name: c.name, finished: c.finished, partial: c.partial })),
  }

  if (FULL_PAGE.has(viewer.kind)) {
    const tiles = tilesFor(students, sets, f)
    let compare = null
    if (f.compare === 'program') {
      compare = { label: 'Program average', tiles: tilesFor(snapshot.students, sets, f) }
    } else if (f.compare === 'previous') {
      const prev = previousCohortId(snapshot, f.cohortIds[0])
      const prevName = snapshot.cohorts.find(c => c.id === prev)?.name
      compare = prev
        ? { label: prevName, tiles: tilesFor(applyFilters(snapshot.students, { ...f, cohortIds: [prev] }), sets, f) }
        : { label: null, tiles: null, unavailable: 'No earlier cohort' }
    }
    if (compare?.tiles) {
      compare.delta = {
        measure: pointsBetween(tiles.measure, compare.tiles.measure),
        completed: pointsBetween(tiles.completed.rate, compare.tiles.completed.rate),
      }
    }
    const programRate = residencyRates(snapshot.students, sets)[f.measure]
    return {
      ...base,
      schools: [...new Set(snapshot.students.map(s => s.school))].sort(),
      serviceLines: [...new Set(snapshot.students.flatMap(s => s.units.map(u => u.serviceLine)).filter(Boolean))].sort(),
      units: hostedFor(snapshot.students, sets).map(h => ({ key: h.unitKey, name: h.unit, serviceLine: h.serviceLine })),
      tiles,
      compare,
      pipeline: pipelineFor(students, sets, f),
      choice: choiceFor(students, sets, f.measure),
      bySchool: { measure: f.measure, schools: bySchoolFor(students, sets, f.measure), program: programRate },
      trends: trendsFor(snapshot, applyFilters(mine, { ...f, cohortIds: [] })),
      pathway: pathwayFor(students, sets, f.measure),
      hostedByUnit: hostedFor(students, sets),
      unitYield: yieldFor(students, sets),
      heatmap: heatmapFor(students, sets),
      caseyFinkBySchool: cfBySchoolFor(students),
      hoursBySchool: hoursBySchoolFor(students, sets),
      retention: { connected: false },
      definitions: DEFINITIONS,
    }
  }

  const tiles = tilesFor(students, sets, f)
  const portalTiles = { placed: tiles.placed, completed: { count: tiles.completed.count }, hired: tiles.hired, inRotation: tiles.inRotation }

  if (viewer.kind === 'residency') {
    // Program-level only: no school and no unit is ever named.
    return {
      ...base,
      tiles: { placed: portalTiles.placed, hired: portalTiles.hired, inRotation: portalTiles.inRotation },
      trends: trendsFor(snapshot, applyFilters(mine, { ...f, cohortIds: [] })),
      pipeline: pipelineFor(students, sets, f),
    }
  }

  if (viewer.kind === 'partner') {
    // The program average includes every school, but a partner never sees it when fewer than
    // MIN_SCHOOLS_FOR_AVERAGE schools are in it: two schools and your own figure give the other away.
    const program = applyFilters(snapshot.students, f)
    const programSchools = new Set(program.map(s => s.school)).size
    const hosted = hostedFor(students, sets).map(h => ({ unit: h.unit, total: h.total }))
    return {
      ...base,
      tiles: portalTiles,
      pipeline: pipelineFor(students, sets, f),
      youVsProgram: {
        you: residencyRates(students, sets).hired,
        program: programSchools >= MIN_SCHOOLS_FOR_AVERAGE ? residencyRates(program, sets).hired : null,
        programHidden: programSchools < MIN_SCHOOLS_FOR_AVERAGE,
      },
      whereRotated: hosted,
      hoursBySchool: hoursBySchoolFor(students, sets),
      trends: trendsFor(snapshot, applyFilters(mine, { ...f, cohortIds: [] })),
    }
  }

  // Unit leader: their own unit by name, every other unit only as an anonymous average.
  const unitKeys = new Set((viewer.unitKeys || []).map(unitNameKey))
  const programHosted = hostedFor(applyFilters(snapshot.students, f), sets)
  const own = programHosted.filter(h => unitKeys.has(h.unitKey))
  const others = programHosted.filter(h => !unitKeys.has(h.unitKey))
  const programYield = yieldFor(applyFilters(snapshot.students, f), sets).program
  const ownYieldRows = yieldFor(students, sets).units.filter(u => unitKeys.has(u.unitKey))
  const ownHostedCount = own.reduce((s, h) => s + h.total, 0)
  const ownHired = ownYieldRows.reduce((s, u) => s + u.count, 0)
  const ownHostedFinished = ownYieldRows.reduce((s, u) => s + u.n, 0)
  const ownStudents = students.filter(s => s.units.some(u => unitKeys.has(u.key)))
  const bySchool = [...groupBy(ownStudents.filter(s => !sets.partial.has(s.cohortId)), s => s.school)]
    .map(([school, rows]) => ({ school, count: rows.length })).sort((a, b) => b.count - a.count || a.school.localeCompare(b.school))
  return {
    ...base,
    units: own.map(h => h.unit),
    tiles: portalTiles,
    hosted: {
      you: ownHostedCount,
      averageUnit: others.length ? Math.round((others.reduce((s, h) => s + h.total, 0) / others.length) * 10) / 10 : null,
    },
    hiredBack: { you: rateOf(ownHired, ownHostedFinished), program: programYield },
    schoolsFeeding: bySchool,
    choice: choiceFor(ownStudents, sets, 'hired').buckets,
  }
}

/**
 * Rows for a chart's CSV. Suppressed rates are written "Too few to rate (n = 3)", never as a number.
 */
export function rateCell(r) {
  if (!r) return ''
  if (r.suppressed) return `Too few to rate (n = ${r.n})`
  return `${r.rate}% (n = ${r.n})`
}
