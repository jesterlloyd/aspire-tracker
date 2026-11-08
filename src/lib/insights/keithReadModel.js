// INSIGHTS-KEITH-READ-1 (Owner, 2026-11-07): Keith's Read on ASPIRE Insights. Pure and tested.
//
// Keith reads the figures the page already shows, for the filters that are on, and says in words
// what stands out. He never computes. Three rules hold that, in code rather than in his instructions:
//   1. He is sent `readDigest(data)`: aggregates only, the same numbers the cards draw, with a
//      withheld rate sent as "too few" and never as a number. No student, no id.
//   2. `parseRead` drops any finding that states a number the digest does not hold (a rate rounded
//      to a whole percent is the digest's own number). A headline that does so drops the whole read.
//   3. The app, not Keith, decides whether a read is current: the server hashes the digest
//      (lib/server/insights/keithRead.js) and a later page with other figures reads as out of date.

/** The cards a finding may point at, by the page's own card ids. */
export const READ_CARDS = Object.freeze(['tiles', 'pipeline', 'match', 'school', 'trend', 'pathway', 'hosted', 'yield', 'heatmap', 'caseyfink', 'hours'])
export const MAX_FINDINGS = 5

const rate = r => (!r ? null : r.suppressed ? { rate: 'too few', n: r.n } : { rate: r.rate, count: r.count, n: r.n })
const mean = m => (!m ? null : m.suppressed ? { mean: 'too few', n: m.n } : { mean: m.mean, n: m.n })

/**
 * What Keith is sent: the page's figures for one filter set, from the staff payload.
 * @param {object} data   computeInsights' full-page result
 * @param {string} scope  the filters in words ("Every cohort, school and unit", "Fall 2025 · CSULB")
 */
export function readDigest(data, scope) {
  const t = data.tiles
  const measure = data.filters?.measure || 'hired'
  return {
    scope,
    measure,
    tiles: {
      applicants: t.applicants.na ? 'not applicable with a unit filter' : t.applicants.count,
      placed: t.placed.count,
      completed: t.completed.count,
      completedOfPlaced: rate(t.completed.rate),
      transitionForm: rate(t.transition),
      appliedToNgrp: rate(t.applied),
      offeredNgrp: rate(t.offered),
      hiredIntoNgrp: rate(t.hired),
      inRotationNow: t.inRotation.count,
    },
    compare: data.compare?.tiles ? { against: data.compare.label, measurePoints: data.compare.delta?.measure ?? null, completedPoints: data.compare.delta?.completed ?? null } : null,
    pipeline: data.pipeline.steps.map(s => ({ step: s.label, count: s.count, ofPrior: s.ofPrior ? rate(s.ofPrior) : null })),
    placementMatch: {
      buckets: data.choice.buckets.map(b => ({ match: b.label, ...rate(b) })),
      notRecorded: data.choice.notRecorded,
      firstChoiceVsOthers: { firstChoice: rate(data.choice.association.top), others: rate(data.choice.association.others) },
    },
    bySchool: { program: rate(data.bySchool.program), schools: data.bySchool.schools.map(s => ({ school: s.school, ...rate(s) })) },
    trends: data.trends.filter(c => c.finished).map(c => ({ cohort: c.name, placed: c.placed, applied: rate(c.applied), offered: rate(c.offered), hired: rate(c.hired) })),
    pathway: Object.fromEntries(['internal', 'external'].map(k => {
      const p = data.pathway[k]
      return [k, { students: p.count, measure: rate(p.measure), completion: rate(p.completion), firstChoice: rate(p.firstChoice), caseyFinkChange: mean(p.caseyFink) }]
    })),
    unitsHosting: data.hostedByUnit.slice(0, 10).map(h => ({ unit: h.unit, placed: h.total })),
    unitYield: { program: rate(data.unitYield.program), units: data.unitYield.units.filter(u => !u.suppressed).slice(0, 10).map(u => ({ unit: u.unit, ...rate(u) })) },
    caseyFinkBySchool: data.caseyFinkBySchool.map(c => ({ school: c.school, ...mean(c) })),
    hoursBySchool: data.hoursBySchool.map(h => ({ school: h.school, n: h.n, percentOfRequirement: h.suppressed ? 'too few' : h.pctOfRequirement })),
    retention: 'not connected yet',
  }
}

/** Every number Keith may state: each number in the digest, its whole-number rounding, and every number inside its words. */
export function allowedNumbers(digest) {
  const out = new Set()
  const add = n => {
    if (!Number.isFinite(n)) return
    out.add(String(n))
    out.add(String(Math.round(n)))
    out.add(String(Math.abs(n)))
    out.add(String(Math.round(Math.abs(n))))
    out.add((Math.round(Math.abs(n) * 10) / 10).toString())
  }
  const walk = v => {
    if (v == null) return
    if (typeof v === 'number') return add(v)
    if (typeof v === 'string') { for (const m of v.match(/\d+(?:\.\d+)?/g) || []) add(Number(m)); return }
    if (Array.isArray(v)) return v.forEach(walk)
    if (typeof v === 'object') return Object.values(v).forEach(walk)
  }
  walk(digest)
  return out
}

/** The numbers a sentence states that the digest does not hold. */
export function strayNumbers(text, allowed) {
  return (String(text || '').match(/\d+(?:[.,]\d+)?/g) || [])
    .map(m => m.replace(/,/g, ''))
    .filter(m => !allowed.has(m) && !allowed.has(String(Number(m))))
}

const clean = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * Keith's output, checked against the digest. Throws (the runner then drops the read) when the
 * headline states a number the page does not show; a finding, a watch or a caveat that does is
 * dropped on its own. `dropped` counts what was removed, so the card can say so.
 */
export function parseRead(json, digest) {
  const allowed = allowedNumbers(digest)
  const ok = s => strayNumbers(s, allowed).length === 0
  const headline = clean(json.headline, 240)
  if (!headline) throw new Error('read_empty')
  if (!ok(headline)) throw Object.assign(new Error('read_unsupported_number'), { code: 'unsupported_number' })
  let dropped = 0
  const findings = []
  for (const f of (json.findings || []).slice(0, MAX_FINDINGS)) {
    const title = clean(f?.title, 80)
    const text = clean(f?.text, 500)
    if (!title || !text) continue
    if (!ok(title) || !ok(text)) { dropped += 1; continue }
    findings.push({ title, text, card: READ_CARDS.includes(f?.card) ? f.card : null })
  }
  const list = arr => (Array.isArray(arr) ? arr : []).slice(0, 3).map(s => clean(s, 240)).filter(Boolean)
    .filter(s => (ok(s) ? true : ((dropped += 1), false)))
  const watch = list(json.watch)
  const caveats = list(json.caveats)
  if (!findings.length) throw Object.assign(new Error('read_no_findings'), { code: 'no_findings' })
  return { headline, findings, watch, caveats, dropped }
}

/** The filters as one key, so the latest read for these filters is found again. */
export function filtersKey(filters = {}) {
  const keys = Object.keys(filters).filter(k => filters[k] != null && filters[k] !== '').sort()
  return keys.map(k => `${k}=${Array.isArray(filters[k]) ? [...filters[k]].sort().join(',') : filters[k]}`).join('&') || 'all'
}
