// EVAL-OVERVIEW-LEADERSHIP-1 (Owner, 2026-11-07): Evaluation > Overview in the NE&L Portal, read-only.
// Pure and tested.
//
// The server builds the staff Overview (buildOverview) for the filters asked and sends the portal
// ONLY what `leadershipOverview` keeps:
//   - the figures leadership reads: surveys sent, completed, the response rate, matched pairs;
//   - the five charts, always measuring Completed;
//   - a withheld group (under MIN_N) as "too few" and its n, never its count, means or bands;
//   - the units that can be read, and how many more were withheld, never a withheld unit's name.
// Left with the ASPIRE team: awaiting, expired or revoked, can be sent again (follow-up work), the
// Expired and Awaiting measures, Ready to Release, Keith's Read and the jump into Responses.

const rate = r => (r.suppressed
  ? { id: r.id, label: r.label, n: r.n, count: null, rate: null, suppressed: true }
  : { id: r.id, label: r.label, n: r.n, count: r.count, rate: r.rate, suppressed: false })

const bands = rows => rows.map(r => ({ key: r.key, label: r.label, up: r.up, same: r.same, down: r.down, total: r.total }))

/** The staff Overview cut down to what leadership sees. */
export function leadershipOverview(o) {
  const t = o.tiles
  const r = o.readiness
  const p = o.preceptor
  const a = o.aspire
  const shown = o.units.units.filter(u => !u.suppressed)
  return {
    scoped: o.scoped,
    tiles: { sent: t.sent, completed: t.completed, responseRate: rate({ id: 'all', label: 'All', ...t.responseRate }), pairs: t.pairs },
    measure: { measureWord: 'completed' },
    bySurvey: o.bySurvey.map(s => ({ ...rate(s), slug: s.slug })),
    bySchool: o.bySchool.map(rate),
    readiness: {
      pairs: r.pairs,
      suppressed: r.suppressed,
      sections: r.suppressed ? [] : r.sections.map(s => ({
        key: s.key, label: s.label, preMean: s.preMean, postMean: s.postMean, delta: s.delta,
        higher: s.higher, same: s.same, lower: s.lower,
      })),
    },
    preceptor: {
      timepoint: p.timepoint, timepointLabel: p.timepointLabel, responses: p.responses, heads: p.heads,
      suppressed: p.suppressed, competencies: p.suppressed ? [] : bands(p.competencies),
    },
    aspire: { responses: a.responses, heads: a.heads, suppressed: a.suppressed, sections: a.suppressed ? [] : bands(a.sections) },
    units: {
      domains: o.units.domains,
      units: shown.map(u => ({ key: u.key, name: u.name, n: u.n, suppressed: false, means: u.means })),
      withheld: o.units.units.length - shown.length,
    },
  }
}

/** The filter choices, as the staff Overview offers them (names only; no status measure). */
export function leadershipOptions(options) {
  return {
    cohorts: options.cohorts.map(c => ({ id: c.id, name: c.name })),
    schools: options.schools,
    units: options.units.map(u => ({ key: u.key, name: u.name })),
    surveys: options.surveys.map(s => ({ value: s.value, label: s.label })),
    timepoints: options.timepoints.map(t => ({ value: t.value, label: t.label })),
  }
}
