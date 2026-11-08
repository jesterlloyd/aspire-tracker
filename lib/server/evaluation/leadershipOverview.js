// EVAL-OVERVIEW-LEADERSHIP-1 (Owner, 2026-11-07): the NE&L Portal's read-only Evaluation Overview,
// the server half. The rows are the staff Overview's (loadEvaluationRows), read through a client the
// caller has already scoped to REAL rows; the figures are built here for the filters asked, and only
// `leadershipOverview`'s cut leaves this module. No row, answer, id of a student or comment does.

import { loadEvaluationRows } from './keithRead.js'
import { annotate, buildOverview, filterOptions, EMPTY_FILTERS } from '../../../src/lib/evaluation/evaluationOverviewModel.js'
import { leadershipOverview, leadershipOptions } from '../../../src/lib/evaluation/leadershipOverviewModel.js'
import { PACKET_INSTRUMENTS } from '../../../src/lib/evaluation/responsesPacketModel.js'
import { TIMEPOINT_QUALIFIERS } from '../../../src/lib/evaluation/surveyNames.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LEAD_KEYS = Object.freeze(['cohort', 'school', 'unit', 'survey', 'timepoint'])

/** The leadership filters from a query string, or null when one is not a legal value. Status is never read. */
export function cleanLeadershipFilters(query = {}) {
  const f = { ...EMPTY_FILTERS }
  for (const k of LEAD_KEYS) {
    const v = query[k]
    if (v == null || v === '') continue
    if (typeof v !== 'string' || v.length > 120) return null
    if (k === 'cohort' && !UUID.test(v)) return null
    if (k === 'survey' && !PACKET_INSTRUMENTS.some(i => i.slug === v)) return null
    if (k === 'timepoint' && !TIMEPOINT_QUALIFIERS[v]) return null
    f[k] = v
  }
  return f
}

export async function leadershipOverviewFor(db, filters, { load, now = Date.now() } = {}) {
  const raw = load ? await load() : await loadEvaluationRows(db)
  const rows = annotate(raw.assignments, raw.units)
  return {
    options: leadershipOptions(filterOptions(rows, raw.cohorts)),
    overview: leadershipOverview(buildOverview(rows, { ...filters, status: '' }, now)),
  }
}
