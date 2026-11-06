// ASPIRE-INSIGHTS-1, Phase 1: getInsights(filters, viewer), the server half of the metric layer.
//
// Reads the rows once per population (real or demo, DEMO-DATA-2: an aggregate never mixes them),
// normalizes them with buildSnapshot, and hands them to computeInsights, which applies the
// viewer's lock before any filter. Every figure is in src/lib/insights/insightsModel.js; nothing
// is computed here. The snapshot is reused for CACHE_MS, and "As of" is the time it was read.

import { buildSnapshot, computeInsights, CACHE_MS } from '../../../src/lib/insights/insightsModel.js'
import { derivePhase } from '../../../src/lib/home/cyclePhase.js'
import { caseyFinkResponsesByStudent, CASEY_FINK_SLUG, CASEY_FINK_SECTION_GROUPS } from '../../../src/lib/evaluation/caseyFinkComparison.js'
import { unitNameKey } from '../../../src/lib/unitNameCanon.js'

const STUDENT_COLUMNS = 'id, cohort_id, school, status, cs_affiliation, matched_unit_id, shift_assigned, hours_required, approved_hours'
const CF_SELECT = `id, student_id, timepoint, status, sent_at, completed_at, evaluation_instruments!inner(slug), evaluation_responses(${CASEY_FINK_SECTION_GROUPS.map(g => g.scoreKey).join(', ')}, submitted_at)`
const PAGE = 1000

async function readAll(db, table, columns, build = q => q) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(db.from(table).select(columns)).range(from, from + PAGE - 1)
    if (error) throw Object.assign(new Error(`insights_read_failed:${table}`), { cause: error })
    out.push(...(data || []))
    if (!data || data.length < PAGE) return out
  }
}

function sectionMean(assignment) {
  const r = Array.isArray(assignment?.evaluation_responses) ? assignment.evaluation_responses[0] : assignment?.evaluation_responses
  const v = CASEY_FINK_SECTION_GROUPS.map(g => Number(r?.[g.scoreKey]))
  return v.every(Number.isFinite) ? v.reduce((s, x) => s + x, 0) / v.length : null
}

/** post minus pre Section I mean, per student, on the Responses packet's own pairing rule. */
export function caseyFinkChanges(assignments) {
  const out = new Map()
  for (const [studentId, e] of caseyFinkResponsesByStudent(assignments)) {
    if (!e.pre || !e.post) continue
    const pre = sectionMean(e.pre)
    const post = sectionMean(e.post)
    if (pre !== null && post !== null) out.set(studentId, Math.round((post - pre) * 100) / 100)
  }
  return out
}

/**
 * Read every row the metrics need. `db` must already be scoped to ONE population
 * (populationDb). NGRP tables carry no is_demo, so they are narrowed to the students read here.
 */
export async function loadInsightsRaw(db, { today } = {}) {
  const [cohorts, students, matches, units, unitAssignments, rotations, cf] = await Promise.all([
    readAll(db, 'cohorts', 'id, name, status, start_date, end_date, completed_at'),
    readAll(db, 'students', STUDENT_COLUMNS),
    readAll(db, 'matches', 'student_id, unit_id, match_quality, shift_assigned'),
    readAll(db, 'units', 'id, unit_name, division'),
    readAll(db, 'student_unit_assignments', 'student_id, unit_id, unit_key, status'),
    readAll(db, 'cohort_school_rotations', 'cohort_id, rotation_start_date, rotation_end_date'),
    readAll(db, 'evaluation_assignments', CF_SELECT, q => q.eq('evaluation_instruments.slug', CASEY_FINK_SLUG)),
  ])
  const studentIds = new Set(students.map(s => s.id))
  const [candidatesAll, outcomesAll, assignmentsAll] = await Promise.all([
    readAll(db, 'ngrp_candidates', 'id, student_id, application_status'),
    readAll(db, 'ngrp_residency_outcomes', 'candidate_id, student_id, offer_extended_at, hired_at, hired_unit'),
    readAll(db, 'ngrp_transition_assignments', 'candidate_id, submitted_at', q => q.not('submitted_at', 'is', null)),
  ])
  const candidates = candidatesAll.filter(c => studentIds.has(c.student_id))
  const candidateIds = new Set(candidates.map(c => c.id))

  const byCohort = new Map()
  for (const s of students) {
    if (!byCohort.has(s.cohort_id)) byCohort.set(s.cohort_id, [])
    byCohort.get(s.cohort_id).push(s)
  }
  const rotByCohort = new Map()
  for (const r of rotations) {
    if (!rotByCohort.has(r.cohort_id)) rotByCohort.set(r.cohort_id, [])
    rotByCohort.get(r.cohort_id).push(r)
  }

  return {
    loadedAt: new Date().toISOString(),
    cohorts: cohorts.map(c => ({
      id: c.id,
      name: c.name,
      // A finished cohort is one At a Glance calls Evaluation: completed, archived, or every
      // known rotation ended with nobody still in Active Rotation.
      finished: derivePhase({ cohort: c, students: byCohort.get(c.id) || [], rotations: rotByCohort.get(c.id) || [], ...(today ? { today } : {}) }).key === 'eval',
    })),
    students,
    matches: matches.filter(m => studentIds.has(m.student_id)),
    units,
    unitAssignments: unitAssignments.filter(a => studentIds.has(a.student_id)),
    candidates,
    outcomes: outcomesAll.filter(o => candidateIds.has(o.candidate_id)),
    submittedCandidateIds: assignmentsAll.filter(a => candidateIds.has(a.candidate_id)).map(a => a.candidate_id),
    caseyFinkChange: caseyFinkChanges(cf.filter(a => studentIds.has(a.student_id))),
  }
}

const cache = new Map()

/** Forget every cached snapshot. Tests use it; nothing else needs to. */
export function clearInsightsCache() { cache.clear() }

/**
 * The snapshot for one population, reused for CACHE_MS.
 * @param {() => object} dbFor  returns a client scoped to `population`
 */
export async function insightsSnapshot(dbFor, population, { now = Date.now(), load = loadInsightsRaw } = {}) {
  const key = population ? 'demo' : 'real'
  const hit = cache.get(key)
  if (hit && now - hit.at < CACHE_MS) return hit.snapshot
  const snapshot = buildSnapshot(await load(dbFor()))
  cache.set(key, { at: now, snapshot })
  return snapshot
}

/**
 * The students a portal viewer may be counted over, from the viewer's own grant. Decided here,
 * on the server, before any figure; the request never names a school or a unit.
 *   partner: students whose school (and cohort, for a cohort-limited grant) a scope covers,
 *            matched on the STORED school text by the portal's own alias-aware rule
 *   unit:    students placed on one of the leader's units
 */
export function lockIdsFor(snapshot, viewer) {
  if (viewer.kind === 'partner') {
    const covers = viewer.inSchoolScope || (() => false)
    return new Set(snapshot.students.filter(s => covers(s.rawSchool, s.cohortId)).map(s => s.id))
  }
  if (viewer.kind === 'unit') {
    const keys = new Set((viewer.unitKeys || []).map(unitNameKey))
    return new Set(snapshot.students.filter(s => s.units.some(u => keys.has(u.key))).map(s => s.id))
  }
  return null
}

/**
 * Figures for one filter set and one viewer.
 * @param {object} filters  from the query string; sanitized for this viewer in the model
 * @param {object} viewer   { kind, unitKeys?, inSchoolScope? }, decided by the endpoint from the grant
 * @param {object} opts     { dbFor, population }
 */
export async function getInsights(filters, viewer, { dbFor, population = false, now, load } = {}) {
  const snapshot = await insightsSnapshot(dbFor, population, { now, load })
  const locked = lockIdsFor(snapshot, viewer)
  const v = { kind: viewer.kind, unitKeys: viewer.unitKeys, ...(locked ? { lockedStudentIds: locked } : {}) }
  return computeInsights(snapshot, filters, v)
}
