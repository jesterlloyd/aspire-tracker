// Canonical cohort timeline ordering, shared by the Academic Partner and Unit Leader portals. It
// mirrors the main app's header switcher: every real cohort is ordered by the season and year its name
// states, regardless of lifecycle status. That produces one continuous sequence such as Summer 2026,
// Fall 2026, Winter 2027, Spring 2027 instead of alphabetically or in current/upcoming/historical
// groups. Pickers read it newest first (orderCohortsNewestFirst).
//
// Names with no season and year sort last. Ties fall back to created_at ASC, then name, then id, so the order is
// stable and deterministic without disturbing valid timeline ordering. Lifecycle remains separate
// from display order and is used only to identify Active cohorts and choose the login default.

import { cohortChronoKey } from '../cohortSeason.js'

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

// Which timeline group a cohort belongs to. Active is current; Completed/Archived are historical;
// everything else (Planning, or any non-terminal/unknown status) is upcoming.
export function cohortLifecycle(cohort) {
  const status = cohort?.status
  if (status === 'Active') return 'current'
  if (status === 'Completed' || status === 'Archived') return 'historical'
  return 'upcoming'
}

// Timeline comparator. COHORT-NEWEST-1 (Owner, 2026-11-07): a cohort's place in time is the season
// and year its NAME states (cohortChronoKey, the rule the staff header already used). start_date is
// free text in production ("May 4, 2026", "01/05/2026", or blank), so ordering on it put Fall 2025
// after Summer 2026 and Spring 2027 above Winter 2027. Named cohorts come before unnamed ones in
// either direction; among unnamed ones (the demo cohorts) a readable start date decides; then
// created_at, name and id keep it deterministic. `direction` flips the season and date comparisons
// only, never which group comes first.
// A start date as a number for ordering only, or null when the text is not a date.
function readableDate(value) {
  const s = String(value || '').trim()
  if (!s) return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
}

function byStart(direction) {
  const dir = direction === 'desc' ? -1 : 1
  return (a, b) => {
    const ka = cohortChronoKey(a?.name)
    const kb = cohortChronoKey(b?.name)
    const aNamed = ka[0] !== Infinity && ka[1] !== Infinity
    const bNamed = kb[0] !== Infinity && kb[1] !== Infinity
    if (aNamed !== bNamed) return aNamed ? -1 : 1
    if (aNamed) {
      if (ka[0] !== kb[0]) return ka[0] < kb[0] ? -dir : dir
      if (ka[1] !== kb[1]) return ka[1] < kb[1] ? -dir : dir
    }
    const ad = readableDate(a?.start_date)
    const bd = readableDate(b?.start_date)
    if (ad !== null && bd !== null) { if (ad !== bd) return ad < bd ? -dir : dir }
    else if (ad !== null) return -1
    else if (bd !== null) return 1
    const ac = a?.created_at || ''
    const bc = b?.created_at || ''
    if (ac !== bc) return ac < bc ? -1 : 1
    const n = collator.compare(String(a?.name || ''), String(b?.name || ''))
    return n !== 0 ? n : collator.compare(String(a?.id || ''), String(b?.id || ''))
  }
}

// Order a set of canonical cohort rows by timeline. Returns a new array (never mutates the input).
export function orderCohortsByTimeline(cohorts) {
  const list = Array.isArray(cohorts) ? cohorts.slice() : []
  return list.sort(byStart('asc'))
}

// The same timeline, newest first: what every cohort PICKER shows (COHORT-NEWEST-1).
export function orderCohortsNewestFirst(cohorts) {
  const list = Array.isArray(cohorts) ? cohorts.slice() : []
  return list.sort(byStart('desc'))
}

// The newest-first comparator itself, for callers that sort their own lists.
export const compareCohortsNewestFirst = byStart('desc')

// The currently-Active cohorts, in timeline order. Used for the "All Current Cohorts" aggregate and
// for the "current" scope set.
export function currentCohorts(cohorts) {
  return orderCohortsByTimeline(cohorts).filter(c => cohortLifecycle(c) === 'current')
}

// The single newest cohort by start date (present dates before missing), or null. Used to pick a
// "newest active" DEFAULT selection independent of the ascending display order within a group.
export function newestByStart(cohorts) {
  const list = Array.isArray(cohorts) ? cohorts.slice() : []
  if (!list.length) return null
  return list.sort(byStart('desc'))[0]
}
