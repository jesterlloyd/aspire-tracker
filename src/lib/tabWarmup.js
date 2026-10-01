// src/lib/tabWarmup.js
//
// TAB-WARMUP-1 (Owner, 2026-10-01: "make the app so much faster"). Measured on the live app: At a
// Glance, Student Profiles and Rotation all mounted at boot whichever screen was opened, so every
// page load fired the requests of all three at once, about 120 in the first second, and the small
// database queued them (1.5 to 2.5 seconds each on a busy run).
//
// The screen that was opened now mounts alone. The other two are WARMED afterward, one at a time,
// once the first has had the network to itself; a tab that is clicked before its turn mounts on
// that click, exactly as Interviews and Evaluation always have. A mounted tab stays mounted, so
// switching is still instant and nothing typed in a hidden tab is lost.
//
// Pure rules here, tested without a browser; StaffApp.jsx owns the timers.

/** The tabs that used to mount at boot, in the order they are warmed. */
export const WARM_TABS = Object.freeze(['overview', 'profiles', 'rotation'])
/** How long the opened screen has the network to itself before the first hidden tab mounts. */
export const WARM_FIRST_DELAY_MS = 2500
/** The pause before each further hidden tab. */
export const WARM_STEP_MS = 1500

/** The next hidden tab to warm, or null when all are mounted. */
export function nextWarmTab(visited) {
  const has = (t) => (visited instanceof Set ? visited.has(t) : Array.isArray(visited) && visited.includes(t))
  return WARM_TABS.find(t => !has(t)) || null
}

/** How long to wait before warming the next tab: the long wait once, then the short one. */
export function warmDelay(alreadyWarmed) {
  return alreadyWarmed ? WARM_STEP_MS : WARM_FIRST_DELAY_MS
}

/** Every warm tab added to a visited set (the welcome tour needs its anchors on screen at once). */
export function withAllWarmTabs(visited) {
  const next = new Set(visited)
  for (const t of WARM_TABS) next.add(t)
  return next.size === (visited?.size ?? -1) ? visited : next
}
