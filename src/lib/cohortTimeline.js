// COHORT-ORDER-1 (Owner, 2026-11-04): cohorts are named by season and year ("Spring 2026"), and a
// list of them reads in calendar order: Winter, Spring, Summer, Fall within a year. Pure.
// A name with no season and year sorts after every dated one, by name.
const SEASONS = { winter: 0, spring: 1, summer: 2, fall: 3, autumn: 3 }

export function cohortTimelineKey(name) {
  const s = String(name || '').toLowerCase()
  const season = Object.keys(SEASONS).find(k => new RegExp(`\\b${k}\\b`).test(s))
  const year = s.match(/\b(19|20)\d{2}\b/)
  if (!season || !year) return null
  return Number(year[0]) * 10 + SEASONS[season]
}

/** Oldest first (newestFirst: true reverses the dated ones); undated names last, A to Z. */
export function sortByCohortTimeline(items, { nameOf = x => x?.name, newestFirst = false } = {}) {
  return [...(items || [])].sort((a, b) => {
    const ka = cohortTimelineKey(nameOf(a))
    const kb = cohortTimelineKey(nameOf(b))
    if (ka !== null && kb !== null && ka !== kb) return newestFirst ? kb - ka : ka - kb
    if ((ka === null) !== (kb === null)) return ka === null ? 1 : -1
    return String(nameOf(a) || '').localeCompare(String(nameOf(b) || ''))
  })
}
