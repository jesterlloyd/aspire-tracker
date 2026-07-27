// Canonical cohort timeline ordering, shared by the portals (Academic Partner + Unit Leader) so a
// cohort dropdown reads like a timeline instead of by creation order or alphabetically. This is the
// single ordering helper the portals consume; the main app's own header switcher keeps its existing
// start-date-ascending order (src/App.jsx sortedCohorts) and is intentionally NOT rewired, so the main
// app's visible order never changes.
//
// Order (real cohorts):
//   1. current    (status === 'Active'),                by start_date ASC (earliest first)
//   2. upcoming   (Planning / any non-terminal status), by start_date ASC (earliest first)
//   3. historical (Completed / Archived),               by start_date DESC (most recent first)
//
// Missing start dates sort last within their group; ties fall back to created_at ASC, then name, then
// id, so the order is stable and deterministic without disturbing valid timeline ordering. The status
// vocabulary is the canonical COHORT_STATUSES = ['Planning','Active','Completed','Archived'].

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

// Which timeline group a cohort belongs to. Active is current; Completed/Archived are historical;
// everything else (Planning, or any non-terminal/unknown status) is upcoming.
export function cohortLifecycle(cohort) {
  const status = cohort?.status
  if (status === 'Active') return 'current'
  if (status === 'Completed' || status === 'Archived') return 'historical'
  return 'upcoming'
}

// Comparator for one group. Present start dates always precede missing ones; among present dates the
// direction applies; ties fall back to created_at ASC, then name, then id (all deterministic).
function byStart(direction) {
  const dir = direction === 'desc' ? -1 : 1
  return (a, b) => {
    const ad = a?.start_date || ''
    const bd = b?.start_date || ''
    if (ad && bd) { if (ad !== bd) return ad < bd ? -dir : dir }
    else if (ad && !bd) return -1
    else if (!ad && bd) return 1
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
  const current = list.filter(c => cohortLifecycle(c) === 'current').sort(byStart('asc'))
  const upcoming = list.filter(c => cohortLifecycle(c) === 'upcoming').sort(byStart('asc'))
  const historical = list.filter(c => cohortLifecycle(c) === 'historical').sort(byStart('desc'))
  return [...current, ...upcoming, ...historical]
}

// The currently-Active cohorts, in timeline order. Used for the "All Current Cohorts" aggregate and
// for the "current" scope set.
export function currentCohorts(cohorts) {
  return orderCohortsByTimeline(cohorts).filter(c => cohortLifecycle(c) === 'current')
}
