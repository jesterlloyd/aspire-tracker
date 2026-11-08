// EVAL-KEITH-READ-1 (Owner, 2026-11-07): Keith's Read on Evaluation > Overview, the server half.
// The same shape as Insights' (lib/server/insights/keithRead.js), whose status, hash, shape and
// error helpers it reuses:
//
//   latest(db, { filters, population, dbFor, actor })  the latest read for these filters, else the
//                                                     latest of any, with whether it is current
//   run(db, { filters, population, dbFor, actor })     recompute the Overview's figures HERE from the
//                                                     filters, send them to Keith, keep what passes
//                                                     parseEvaluationRead, save a row
//
// The figures are never taken from the browser. A read is stored per population (is_demo). Before
// 20261203000000 the table and the Skill do not exist: `latest` answers { enabled: false } and `run`
// refuses with not_enabled.

import { randomUUID } from 'node:crypto'
import { KeithReadError, hashFigures, readStatus, shape, namesFor } from '../insights/keithRead.js'
import { filtersKey } from '../../../src/lib/insights/keithReadModel.js'
import { evaluationDigest } from '../../../src/lib/evaluation/evaluationReadModel.js'
import {
  annotate, buildOverview, filterOptions, chipsFor, FILTER_KEYS, EMPTY_FILTERS,
} from '../../../src/lib/evaluation/evaluationOverviewModel.js'
import { runKeithSkill } from '../keith/runKeithSkill.js'

export const SKILL_KEY = 'read-evaluation'
const TABLE = 'evaluation_reads'
const PAGE = 1000
const MISSING = new Set(['42P01', 'PGRST205', '42703', 'PGRST204'])
const missing = e => MISSING.has(e?.code) || /does not exist|could not find the table/i.test(e?.message || '')

async function selectAll(build) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < PAGE) return out
  }
}

/** The rows the Overview loads, read through the population's client (the browser reads the same). */
export async function loadEvaluationRows(db) {
  const [assignments, units, cohorts] = await Promise.all([
    selectAll(() => db.from('evaluation_assignments').select(`
      id, cohort_id, timepoint, status, expires_at, revoked_at,
      students!inner ( id, school, matched_unit_id ),
      evaluation_instruments!inner ( slug ),
      evaluation_responses ( submitted_at, responses, score_s1_clinical_problem_solving, score_s1_learning_activities, score_s1_practice_readiness )
    `).order('id')),
    selectAll(() => db.from('units').select('id, unit_name').order('id')),
    selectAll(() => db.from('cohorts').select('id, name').order('id')),
  ])
  return { assignments, units, cohorts }
}

/** Only the Overview's own filter names, with their values. */
export const cleanEvaluationFilters = (filters = {}) =>
  Object.fromEntries(FILTER_KEYS.map(k => [k, typeof filters[k] === 'string' ? filters[k] : '']))

/** The Overview's figures for these filters, and what Keith would be sent. */
export async function evaluationFiguresFor({ filters, dbFor, load, now = Date.now() }) {
  const raw = load ? await load() : await loadEvaluationRows(dbFor())
  const rows = annotate(raw.assignments, raw.units)
  const f = { ...EMPTY_FILTERS, ...cleanEvaluationFilters(filters) }
  const overview = buildOverview(rows, f, now)
  const chips = chipsFor(f, filterOptions(rows, raw.cohorts))
  const scope = chips.length ? chips.map(c => c.label).join(' · ') : 'Every cohort, school and unit'
  const digest = evaluationDigest(overview, scope)
  return { scope, digest, key: filtersKey(f), hash: hashFigures(digest) }
}

const COLS = 'id, filters_key, scope_words, figures_hash, output, provenance_id, created_at, created_by'

export async function latest(db, { filters, population, dbFor, load, actor }) {
  const status = await readStatus(db, actor, SKILL_KEY)
  const { key, hash, scope } = await evaluationFiguresFor({ filters, dbFor, load })
  const base = () => db.from(TABLE).select(COLS).eq('is_demo', Boolean(population)).order('created_at', { ascending: false }).limit(1)
  const here = await base().eq('filters_key', key)
  if (here.error) {
    if (missing(here.error)) return { enabled: false, canRun: false, scope, read: null, other: null }
    throw new KeithReadError('read_failed', 'Keith’s reads could not be loaded.', 500)
  }
  const mine = here.data?.[0] || null
  const other = mine ? null : (await base()).data?.[0] || null
  const names = await namesFor(db, [mine?.created_by, other?.created_by])
  return {
    ...status,
    scope,
    read: mine ? { ...shape(mine, hash), byName: names.get(mine.created_by) || null } : null,
    other: other ? { ...shape(other, null), byName: names.get(other.created_by) || null } : null,
  }
}

export async function run(db, { filters, population, dbFor, load, actor, complete }) {
  const status = await readStatus(db, actor, SKILL_KEY)
  if (!status.enabled) throw new KeithReadError('not_enabled', 'Keith’s Read is not set up yet.')
  if (!status.canRun) throw new KeithReadError('denied', 'Only the Owner and Admins ask Keith to read the figures.', 403)
  const { scope, digest, key, hash } = await evaluationFiguresFor({ filters, dbFor, load })
  const id = randomUUID()
  const result = await runKeithSkill(db, SKILL_KEY, { figures: { value: digest, refs: [{ type: 'evaluation_figures', id: key.slice(0, 200) }] } }, {
    actor, entity: { id }, invocationMode: 'button', ...(complete ? { complete } : {}),
  })
  if (!result.ok) {
    const stray = result.reason === 'invalid_output' && result.stage === 'parse'
    throw new KeithReadError(result.reason || 'failed',
      stray ? 'Keith’s read used a figure the page does not show, so it was not kept. Try again.'
        : result.reason === 'off' ? 'Keith’s Read is turned off in Settings > Keith > Skills.'
          : 'Keith could not read the figures just now. Try again.',
      result.status || 502)
  }
  const row = {
    id, filters_key: key, filters: cleanEvaluationFilters(filters), scope_words: scope, figures_hash: hash,
    output: result.output, provenance_id: result.provenanceId || null, created_by: actor?.id || null, is_demo: Boolean(population),
  }
  const { error } = await db.from(TABLE).insert(row)
  if (error) {
    if (missing(error)) throw new KeithReadError('not_enabled', 'Keith’s Read is not set up yet.')
    throw new KeithReadError('save_failed', 'Keith read the figures but the read could not be saved.', 500)
  }
  return { ...status, scope, read: { ...shape({ ...row, created_at: new Date().toISOString() }, hash), byName: actor?.full_name || null }, other: null }
}
