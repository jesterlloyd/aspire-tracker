// Canonical cohort timeline ordering, shared by the Academic Partner and Unit Leader portals. It
// mirrors the main app's header switcher: every real cohort is ordered by start_date ASC, regardless
// of lifecycle status. That produces one continuous sequence such as Summer 2026, Fall 2026, Winter
// 2027, Spring 2027 instead of alphabetically or in current/upcoming/historical groups.
//
// Missing start dates sort last. Ties fall back to created_at ASC, then name, then id, so the order is
// stable and deterministic without disturbing valid timeline ordering. Lifecycle remains separate
// from display order and is used only to identify Active cohorts and choose the login default.

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

// Which timeline group a cohort belongs to. Active is current; Completed/Archived are historical;
// everything else (Planning, or any non-terminal/unknown status) is upcoming.
export function cohortLifecycle(cohort) {
  const status = cohort?.status
  if (status === 'Active') return 'current'
  if (status === 'Completed' || status === 'Archived') return 'historical'
  return 'upcoming'
}

// Timeline comparator. Present start dates always precede missing ones; ties fall back to created_at
// ASC, then name, then id (all deterministic).
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
  return list.sort(byStart('asc'))
}

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
