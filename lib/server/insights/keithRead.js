// INSIGHTS-KEITH-READ-1 (Owner, 2026-11-07): Keith's Read on ASPIRE Insights, the server half.
//
//   latest(db, { filters, population, figures })  the latest read for these filters (and, failing
//                                                 that, the latest read of anything), with whether
//                                                 the figures have changed since it was written
//   run(db, { filters, population, actor })       read the page's figures on the SERVER, send them
//                                                 to Keith, keep what passes parseRead, save a row
//
// The figures are always recomputed here from the filters (getInsights, staff viewer), never taken
// from the browser. A read is stored per population (is_demo), so a demo read never shows on the
// real page. Before 20261202000000 the table and the Skill do not exist: `latest` answers
// { enabled: false } and `run` refuses with not_enabled.

import { createHash, randomUUID } from 'node:crypto'
import { getInsights } from './getInsights.js'
import { readDigest, filtersKey } from '../../../src/lib/insights/keithReadModel.js'
import { sanitizeFilters } from '../../../src/lib/insights/insightsModel.js'
import { runKeithSkill, loadSkill } from '../keith/runKeithSkill.js'
import { skillMode } from '../../../src/lib/keith/provenanceModel.js'
import { authorizeSkillForCaller } from '../keith/skillAuthorization.js'

export const SKILL_KEY = 'read-insights'
const TABLE = 'insights_reads'
const MISSING = new Set(['42P01', 'PGRST205', '42703', 'PGRST204'])
const missing = e => MISSING.has(e?.code) || /does not exist|could not find the table/i.test(e?.message || '')

export class KeithReadError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status }
}

export const hashFigures = digest => createHash('sha256').update(JSON.stringify(digest)).digest('hex').slice(0, 32)

/** The filters in words, for Keith and for the card: what this read is about. */
export function scopeWords(data) {
  const f = data.filters || {}
  const parts = []
  if (f.cohortIds?.length) parts.push(f.cohortIds.map(id => data.cohorts.find(c => c.id === id)?.name).filter(Boolean).join(', '))
  if (f.schools?.length) parts.push(f.schools.join(', '))
  if (f.pathway && f.pathway !== 'all') parts.push(f.pathway === 'internal' ? 'Internal' : 'External')
  if (f.serviceLine) parts.push(f.serviceLine)
  if (f.unit) parts.push(data.units.find(u => u.key === f.unit)?.name || f.unit)
  if (f.shift) parts.push(`${f.shift} shift`)
  if (f.stage && f.stage !== 'all') parts.push({ placed: 'Placed students', completed: 'Completed students', in_rotation: 'Students in rotation' }[f.stage])
  if (f.residencyStatus && f.residencyStatus !== 'all') parts.push(`Residency status: ${f.residencyStatus.replace(/_/g, ' ')}`)
  return parts.length ? parts.join(' · ') : 'Every cohort, school and unit'
}

/** The page's figures for these filters, and what Keith would be sent. */
export async function figuresFor({ filters, population, dbFor, load }) {
  const data = await getInsights(filters, { kind: 'staff' }, { dbFor, population, load })
  const scope = scopeWords(data)
  const digest = readDigest(data, scope)
  return { data, scope, digest, key: filtersKey(keyFilters(filters)), hash: hashFigures(digest) }
}

// The key is the filters that narrow the figures, sanitized, so "?cohort=x" and "cohort=x&stage=all" agree.
function keyFilters(filters) {
  const f = sanitizeFilters(filters, { kind: 'staff' })
  return { ...f, compare: f.compare === 'off' ? '' : f.compare, stage: f.stage === 'all' ? '' : f.stage, residencyStatus: f.residencyStatus === 'all' ? '' : f.residencyStatus, pathway: f.pathway === 'all' ? '' : f.pathway }
}

export const shape = (row, hash) => row && ({
  id: row.id,
  scope: row.scope_words,
  read: row.output,
  provenanceId: row.provenance_id || null,
  createdAt: row.created_at,
  asOf: row.as_of,
  byName: row.created_by_name || null,
  current: hash ? row.figures_hash === hash : null,
})

/** Whether the Skill is on, and whether the caller may run it (the table's absence reads as not set up). */
export async function readStatus(db, actor, skillKey = SKILL_KEY) {
  let skill
  try { skill = await loadSkill(db, skillKey) } catch { return { enabled: false, canRun: false } }
  const on = Boolean(skill) && skillMode(skill) !== 'off'
  const caller = { profileId: actor?.id, role: actor?.role, isOwner: actor?.is_owner === true }
  return { enabled: on, canRun: on && authorizeSkillForCaller(skill, caller).ok }
}

export async function latest(db, { filters, population, dbFor, load, actor }) {
  const status = await readStatus(db, actor)
  const { key, hash, scope } = await figuresFor({ filters, population, dbFor, load })
  const cols = 'id, filters_key, scope_words, figures_hash, as_of, output, provenance_id, created_at, created_by'
  const base = () => db.from(TABLE).select(cols).eq('is_demo', Boolean(population)).order('created_at', { ascending: false }).limit(1)
  const here = await base().eq('filters_key', key)
  if (here.error) {
    if (missing(here.error)) return { enabled: false, canRun: false, scope, read: null, other: null }
    throw new KeithReadError('read_failed', 'Keith’s reads could not be loaded.', 500)
  }
  const mine = here.data?.[0] || null
  // When these filters were never read, the most recent read of any filters is offered beside it.
  const other = mine ? null : (await base()).data?.[0] || null
  const names = await namesFor(db, [mine?.created_by, other?.created_by])
  return {
    ...status,
    scope,
    read: mine ? { ...shape(mine, hash), byName: names.get(mine.created_by) || null } : null,
    other: other ? { ...shape(other, null), byName: names.get(other.created_by) || null } : null,
  }
}

export async function namesFor(db, ids) {
  const list = [...new Set(ids.filter(Boolean))]
  if (!list.length) return new Map()
  const { data } = await db.from('user_profiles').select('id, full_name').in('id', list)
  return new Map((data || []).map(p => [p.id, p.full_name]))
}

export async function run(db, { filters, population, dbFor, load, actor, complete }) {
  const status = await readStatus(db, actor)
  if (!status.enabled) throw new KeithReadError('not_enabled', 'Keith’s Read is not set up yet.')
  if (!status.canRun) throw new KeithReadError('denied', 'Only the Owner and Admins ask Keith to read the figures.', 403)
  const { data, scope, digest, key, hash } = await figuresFor({ filters, population, dbFor, load })
  const id = randomUUID()
  const result = await runKeithSkill(db, SKILL_KEY, { figures: { value: digest, refs: [{ type: 'insights_figures', id: key.slice(0, 200) }] } }, {
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
    id, filters_key: key, filters: data.filters, scope_words: scope, figures_hash: hash, as_of: data.asOf,
    output: result.output, provenance_id: result.provenanceId || null, created_by: actor?.id || null, is_demo: Boolean(population),
  }
  const { error } = await db.from(TABLE).insert(row)
  if (error) {
    if (missing(error)) throw new KeithReadError('not_enabled', 'Keith’s Read is not set up yet.')
    throw new KeithReadError('save_failed', 'Keith read the figures but the read could not be saved.', 500)
  }
  return { ...status, scope, read: { ...shape({ ...row, created_at: new Date().toISOString() }, hash), byName: actor?.full_name || null }, other: null }
}
