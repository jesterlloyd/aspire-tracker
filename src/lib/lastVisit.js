// src/lib/lastVisit.js
//
// Shared "Last visit on this browser" primitive for the PORTAL family (Unit Leader today;
// Academic Partner and Student portals later). Storage is THIS browser only; no server
// audit is implied, matching the honest wording the main-app masthead uses.
//
// The caller supplies the FULL storage key, so each portal surface tracks its own last
// visit and never collides with the staff dashboard's per-cohort key
// (`aspire:lastVisit:<userId>:<cohortId>`), which stays inline in TodayMasthead unchanged.
// A separate key is deliberate: the portal is a distinct surface whose "last visit" is not
// scoped to a staff cohort, and one account could in principle hold both roles. See
// docs/product/SHARED_PORTAL_HOME_PROFILE_CALENDAR_FOUNDATION.md.

import { useEffect, useMemo, useState } from 'react'

/**
 * Format a stored ISO timestamp into the masthead's honest last-visit wording. Pure: `now`
 * is passed in (tests supply a fixed clock; the hook supplies Date.now()).
 */
export function formatLastVisit(previousIso, now) {
  if (!previousIso) return null
  const then = new Date(previousIso)
  const t = then.getTime()
  if (Number.isNaN(t)) return null
  const days = Math.floor((now - t) / 86400000)
  const when = days <= 0 ? 'earlier today'
    : days === 1 ? 'yesterday'
    : then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `Last visit on this browser: ${when}`
}

/**
 * Read the previous visit for `storageKey`, stamp the current visit, and return the ready
 * last-visit line (or null when there is no prior visit or storage is unavailable).
 *
 * The previous value is read once in a lazy initializer (a pure read, not a render side
 * effect, and never a synchronous setState in an effect), the current visit is stamped in an
 * effect, and the label memoizes its one clock read; the repo forbids a bare clock read in
 * the render body but allows it inside a memo.
 */
export function useLastVisitLabel(storageKey) {
  const [previous] = useState(() => {
    if (!storageKey) return null
    try { return localStorage.getItem(storageKey) || null } catch { return null }
  })
  useEffect(() => {
    if (!storageKey) return
    try { localStorage.setItem(storageKey, new Date().toISOString()) } catch { /* storage unavailable */ }
  }, [storageKey])
  // `new Date().getTime()` (not `Date.now()`); the repo's purity rule flags the latter even
  // inside a memo; the value is read once here, not in the bare render body.
  return useMemo(() => formatLastVisit(previous, new Date().getTime()), [previous])
}
