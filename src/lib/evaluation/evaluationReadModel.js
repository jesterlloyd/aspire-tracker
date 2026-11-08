// EVAL-KEITH-READ-1 (Owner, 2026-11-07): Keith's Read on Evaluation > Overview. Pure and tested.
//
// The same three rules as Insights' read (src/lib/insights/keithReadModel.js), which this module
// reuses rather than restates:
//   1. Keith is sent `evaluationDigest(overview, scope)`: the figures the Overview draws for the
//      filters that are on, aggregates only. A group under MIN_N is sent as "too few", never as a
//      number. No student, no id, no comment.
//   2. `parseEvaluationRead` drops any sentence that states a number the digest does not hold.
//   3. The server, not Keith, decides whether a saved read is current (a hash of the digest).

import { parseRead } from '../insights/keithReadModel.js'
import { MIN_N } from './evaluationOverviewModel.js'

/** The Overview's cards a finding may point at. The DOM id is `ins-evo-<card>` (ChartCard prefixes ins-). */
export const EVAL_READ_CARDS = Object.freeze(['rate', 'cf', 'prec', 'school', 'unit', 'aspire'])
export const EVAL_CARD_NAMES = Object.freeze({
  rate: 'Response Rate by Survey', cf: 'Readiness Change', prec: 'Preceptor Ratings', school: 'Response Rate by School',
  unit: 'Unit and Preceptor Feedback', aspire: "Student's Feedback on ASPIRE",
})

const one = v => (v == null ? null : Math.round(v * 10) / 10)
const two = v => (v == null ? null : Math.round(v * 100) / 100)
const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0)
const rate = r => (!r ? null : r.suppressed ? { rate: 'too few', n: r.n } : { rate: one(r.rate), count: r.count, n: r.n })

/** A band row as the page draws it: each band's count and its whole-percent share. */
const bands = (row, heads) => ({
  [heads.up]: { count: row.up, percent: pct(row.up, row.total) },
  [heads.same]: { count: row.same, percent: pct(row.same, row.total) },
  [heads.down]: { count: row.down, percent: pct(row.down, row.total) },
  responses: row.total,
})

/**
 * What Keith is sent: the Overview's figures for one filter set.
 * @param {object} o      buildOverview's result
 * @param {string} scope  the filters in words ("Every cohort, school and unit", "Fall 2025 · UCLA")
 */
export function evaluationDigest(o, scope) {
  const t = o.tiles
  const r = o.readiness
  const p = o.preceptor
  const a = o.aspire
  const shownUnits = o.units.units.filter(u => !u.suppressed)
  return {
    scope,
    rateCardsMeasure: o.measure?.measureWord || 'completed',
    figures: {
      surveysSent: t.sent,
      completed: t.completed,
      responseRate: rate(t.responseRate),
      awaitingAnAnswer: t.awaiting,
      expiredOrRevoked: t.closed,
      canBeSentAgain: t.reissuable,
      caseyFinkMatchedPairs: t.pairs,
    },
    rateBySurvey: o.bySurvey.map(s => ({ survey: s.label, ...rate(s) })),
    rateBySchool: o.bySchool.map(s => ({ school: s.label, ...rate(s) })),
    readinessChange: r.suppressed
      ? { matchedPairs: r.pairs, sections: 'too few' }
      : {
        matchedPairs: r.pairs,
        scale: '1 to 4',
        sections: r.sections.map(s => ({
          section: s.label, preMean: two(s.preMean), postMean: two(s.postMean), change: two(s.delta),
          higherPost: s.higher, same: s.same, lowerPost: s.lower,
        })),
      },
    preceptorRatings: p.suppressed
      ? { timepoint: p.timepointLabel || null, responses: p.responses, competencies: 'too few' }
      : { timepoint: p.timepointLabel || null, responses: p.responses, competencies: p.competencies.map(c => ({ competency: c.label, ...bands(c, p.heads) })) },
    aspireFeedback: a.suppressed
      ? { responses: a.responses, sections: 'too few' }
      : { responses: a.responses, sections: a.sections.map(s => ({ section: s.label, ...bands(s, a.heads) })) },
    unitFeedback: {
      scale: '1 to 5; 4.0 and above reads as agreed, 3.0 to 3.9 neutral, below 3.0 disagreed',
      domains: o.units.domains.map(d => d.label),
      units: shownUnits.map(u => ({
        unit: u.name, responses: u.n,
        means: Object.fromEntries(o.units.domains.map(d => [d.label, two(u.means?.[d.key])])),
      })),
      unitsWithheld: o.units.units.length - shownUnits.length,
      withheldBelow: MIN_N,
    },
  }
}

/** Keith's output checked against the digest, with the Overview's own card ids. */
export function parseEvaluationRead(json, digest) {
  return parseRead(json, digest, EVAL_READ_CARDS)
}
