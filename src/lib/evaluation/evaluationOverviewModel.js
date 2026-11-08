// EVAL-OVERVIEW-1 (Owner, 2026-11-07): Evaluation > Overview, the four surveys read the way ASPIRE
// Insights reads the pipeline. Reference: docs/mockups/evaluation-overview.html.
//
// Pure, tested without a browser. This module only FILTERS and GROUPS: every score, band, pair and
// status comes from responsesPacketModel.js (and the Casey-Fink comparison behind it), so the
// Overview and Responses cannot disagree about a number. A group under MIN_N is withheld, never
// shown as zero. Nothing here reads a name or a comment.

import {
  PACKET_INSTRUMENTS, CASEY_FINK_SLUG, instrumentBySlug, rowsForInstrument, effectiveStatus,
  statusGroup, canonicalTimepoint, subscaleMean, responseOf, buildDistribution,
} from './responsesPacketModel.js'
import { buildCaseyFinkComparison } from './caseyFinkComparison.js'
import { isReissuableAssignment } from './assignmentReissue.js'
import { TIMEPOINT_QUALIFIERS } from './surveyNames.js'
import { timepointSortIndex } from '../evaluationLabels.js'
import { sortByCohortTimeline } from '../cohortTimeline.js'

export const MIN_N = 5
export const FILTER_KEYS = Object.freeze(['cohort', 'school', 'unit', 'survey', 'timepoint', 'status'])
export const EMPTY_FILTERS = Object.freeze({ cohort: '', school: '', unit: '', survey: '', timepoint: '', status: '' })
/** The folded filters: More filters opens itself when one of these is on. */
export const MORE_FILTER_KEYS = Object.freeze(['survey', 'timepoint'])

// The KPI cards that filter. Each names the status the rate cards measure; '' is every survey sent.
export const STATUS_TILES = Object.freeze({
  '': { label: 'Surveys Sent', measures: ['completed'], measureWord: 'completed' },
  completed: { label: 'Completed', measures: ['completed'], measureWord: 'completed' },
  awaiting: { label: 'Awaiting Answer', measures: ['awaiting'], measureWord: 'awaiting an answer' },
  closed: { label: 'Expired or Revoked', measures: ['expired', 'revoked'], measureWord: 'expired or revoked' },
})

const unitKey = name => String(name || '').toLowerCase().replace(/\s+/g, '')

/** One rate, withheld below MIN_N. */
export function rateOf(count, n) {
  const suppressed = n < MIN_N
  return { count, n, rate: suppressed || !n ? null : (count / n) * 100, suppressed }
}

/**
 * Each assignment with what the Overview groups it by. `units` is [{ id, unit_name }]; a student's
 * unit is their matched unit's name, compared by key so '6NE' and '6 NE' are one unit.
 */
export function annotate(assignments, units = []) {
  const nameById = new Map((units || []).map(u => [u.id, u.unit_name]))
  return (assignments || []).map(a => {
    const unitName = nameById.get(a?.students?.matched_unit_id) || ''
    return {
      ...a,
      _school: String(a?.students?.school || '').trim(),
      _unit: unitName,
      _unitKey: unitName ? unitKey(unitName) : '',
      _slug: a?.evaluation_instruments?.slug || '',
      _tp: canonicalTimepoint(a?.timepoint) || '',
    }
  })
}

/** The rows the filters keep, every filter except the status tile (which picks a measure). */
export function scopeRows(rows, f = EMPTY_FILTERS) {
  return rows.filter(a =>
    (!f.cohort || a.cohort_id === f.cohort)
    && (!f.school || a._school === f.school)
    && (!f.unit || a._unitKey === f.unit)
    && (!f.survey || a._slug === f.survey)
    && (!f.timepoint || a._tp === f.timepoint))
}

/** What each filter can be set to, from every row loaded (never from the filtered ones). */
export function filterOptions(rows, cohorts = []) {
  const ids = new Set(rows.map(a => a.cohort_id).filter(Boolean))
  const cohortList = sortByCohortTimeline((cohorts || []).filter(c => ids.has(c.id)), { newestFirst: true })
  const schools = [...new Set(rows.map(a => a._school).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const unitNames = new Map()
  for (const a of rows) if (a._unitKey && !unitNames.has(a._unitKey)) unitNames.set(a._unitKey, a._unit)
  const unitList = [...unitNames.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const surveys = PACKET_INSTRUMENTS.filter(i => rows.some(a => a._slug === i.slug)).map(i => ({ value: i.slug, label: i.name }))
  const timepoints = [...new Set(rows.map(a => a._tp).filter(t => TIMEPOINT_QUALIFIERS[t]))]
    .sort((a, b) => timepointSortIndex(a) - timepointSortIndex(b))
    .map(t => ({ value: t, label: TIMEPOINT_QUALIFIERS[t] }))
  return { cohorts: cohortList, schools, units: unitList, surveys, timepoints }
}

/** The headline counts for the rows in scope. */
export function tilesFor(rows, now = Date.now()) {
  const t = { sent: rows.length, completed: 0, awaiting: 0, closed: 0, reissuable: 0 }
  for (const a of rows) {
    const g = statusGroup(effectiveStatus(a, now))
    if (g === 'completed') t.completed += 1
    else if (g === 'awaiting') t.awaiting += 1
    else if (g === 'expired' || g === 'revoked') t.closed += 1
    if (isReissuableAssignment(a, now)) t.reissuable += 1
  }
  t.responseRate = rateOf(t.completed, t.sent)
  t.pairs = buildCaseyFinkComparison(rows.filter(a => a._slug === CASEY_FINK_SLUG)).matchedCount
  return t
}

const measured = (rows, tile, now) => {
  const groups = (STATUS_TILES[tile] || STATUS_TILES['']).measures
  return rows.filter(a => groups.includes(statusGroup(effectiveStatus(a, now)))).length
}

/** One bar per survey and timepoint, in the canonical order: the share of sent in the chosen status. */
export function rateBySurvey(rows, tile = '', now = Date.now()) {
  const out = []
  for (const inst of PACKET_INSTRUMENTS) {
    const mine = rows.filter(a => a._slug === inst.slug)
    const tps = [...new Set(mine.map(a => a._tp))].sort((a, b) => timepointSortIndex(a) - timepointSortIndex(b))
    for (const tp of tps) {
      const group = mine.filter(a => a._tp === tp)
      const q = TIMEPOINT_QUALIFIERS[tp]
      out.push({ id: `${inst.slug}:${tp}`, slug: inst.slug, timepoint: tp, label: q && tps.length > 1 ? `${inst.name}, ${q}` : inst.name, ...rateOf(measured(group, tile, now), group.length) })
    }
  }
  return out
}

/** One bar per school: the share of its surveys in the chosen status. */
export function rateBySchool(rows, tile = '', now = Date.now()) {
  const by = new Map()
  for (const a of rows) {
    if (!a._school) continue
    if (!by.has(a._school)) by.set(a._school, [])
    by.get(a._school).push(a)
  }
  return [...by.entries()]
    .map(([school, group]) => ({ id: school, label: school, ...rateOf(measured(group, tile, now), group.length) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** Casey-Fink, pre against post, over the matched pairs in scope (the comparison's own rule). */
export function readinessChange(rows) {
  const cf = buildCaseyFinkComparison(rows.filter(a => a._slug === CASEY_FINK_SLUG))
  const n = cf.matchedCount
  return {
    pairs: n,
    suppressed: n < MIN_N,
    sections: cf.metrics.map(m => ({
      key: m.key, label: m.label, preMean: m.preMean, postMean: m.postMean, delta: m.delta,
      higher: m.changeCounts.higherPost, same: m.changeCounts.same, lower: m.changeCounts.lowerPost,
    })),
  }
}

/**
 * Preceptor's Assessment by competency, on the instrument's own bands. With no timepoint chosen it
 * reads Post-Rotation when any is completed (where a rotation ends), else Midpoint: mixing the two
 * would count one student twice.
 */
export function preceptorRatings(rows, timepoint = '', now = Date.now()) {
  const inst = instrumentBySlug('preceptor_progress')
  const mine = rowsForInstrument(rows, inst.slug)
  const done = tp => mine.some(a => a._tp === tp && effectiveStatus(a, now) === 'completed')
  const tp = timepoint || (done('post_rotation') ? 'post_rotation' : done('midpoint') ? 'midpoint' : '')
  const group = tp ? mine.filter(a => a._tp === tp) : mine
  const d = buildDistribution(inst, group, null, null, now)
  return { timepoint: tp, timepointLabel: TIMEPOINT_QUALIFIERS[tp] || '', responses: d.total, heads: d.heads, suppressed: d.total < MIN_N, competencies: d.subscales }
}

/** Student's Feedback on ASPIRE, by section, on the ASPIRE Likert rule. */
export function aspireFeedback(rows, now = Date.now()) {
  const inst = instrumentBySlug('post_rotation_evaluation')
  const d = buildDistribution(inst, rowsForInstrument(rows, inst.slug), null, null, now)
  return { responses: d.total, heads: d.heads, suppressed: d.total < MIN_N, sections: d.subscales }
}

/** Student's Feedback on Unit and Preceptor, domain means per unit. A unit under MIN_N is withheld. */
export function unitFeedback(rows, now = Date.now()) {
  const inst = instrumentBySlug('student_preceptor_eval')
  const done = rowsForInstrument(rows, inst.slug).filter(a => effectiveStatus(a, now) === 'completed' && a._unitKey)
  const by = new Map()
  for (const a of done) {
    if (!by.has(a._unitKey)) by.set(a._unitKey, { key: a._unitKey, name: a._unit, rows: [] })
    by.get(a._unitKey).rows.push(a)
  }
  const domains = inst.subscales.map(s => ({ key: s.key, label: s.label }))
  const units = [...by.values()].map(u => {
    const n = u.rows.length
    const means = n < MIN_N ? null : Object.fromEntries(inst.subscales.map(s => {
      const vals = u.rows.map(a => subscaleMean(inst, s, responseOf(a))).filter(v => v != null)
      return [s.key, vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null]
    }))
    return { key: u.key, name: u.name, n, suppressed: n < MIN_N, means }
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  return { domains, units }
}

/** The ASPIRE Likert rule's band for a mean (4.0 and above agreed, 3.0 to 3.9 neutral, else disagreed). */
export function likertBand(mean) {
  if (mean == null) return null
  return mean >= 4 ? 'up' : mean >= 3 ? 'same' : 'down'
}

/** Everything the page draws, for these filters. */
export function buildOverview(rows, f = EMPTY_FILTERS, now = Date.now()) {
  const scoped = scopeRows(rows, f)
  const tile = STATUS_TILES[f.status] ? f.status : ''
  return {
    scoped: scoped.length,
    tiles: tilesFor(scoped, now),
    measure: STATUS_TILES[tile],
    bySurvey: rateBySurvey(scoped, tile, now),
    bySchool: rateBySchool(scoped, tile, now),
    readiness: readinessChange(scoped),
    preceptor: preceptorRatings(scoped, f.timepoint, now),
    aspire: aspireFeedback(scoped, now),
    units: unitFeedback(scoped, now),
  }
}

/** The chips under the bar: one per filter that is on. */
export function chipsFor(f, options) {
  const out = []
  if (f.status && STATUS_TILES[f.status]) out.push({ key: 'status', label: STATUS_TILES[f.status].label })
  if (f.cohort) out.push({ key: 'cohort', label: options.cohorts.find(c => c.id === f.cohort)?.name || 'Cohort' })
  if (f.school) out.push({ key: 'school', label: f.school })
  if (f.unit) out.push({ key: 'unit', label: options.units.find(u => u.key === f.unit)?.name || f.unit })
  if (f.survey) out.push({ key: 'survey', label: options.surveys.find(s => s.value === f.survey)?.label || f.survey })
  if (f.timepoint) out.push({ key: 'timepoint', label: TIMEPOINT_QUALIFIERS[f.timepoint] || f.timepoint })
  return out
}

/** A KPI card: the chosen one again clears it, and Surveys Sent always clears. */
export function pickStatus(f, tile) {
  return { ...f, status: !tile || f.status === tile ? '' : tile }
}
