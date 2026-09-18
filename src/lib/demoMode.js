// src/lib/demoMode.js
//
// DEMO-MODE-1: the on/off state, and nothing else. The BOUNDARY that this state
// controls lives in src/lib/demoScope.js; keeping them apart is what lets
// supabase.js import the boundary without the boundary importing supabase.js.
//
// WHAT DEMO MODE IS: a presentation mode. With it on, the app reads and writes only
// rows carrying is_demo = true. With it off, it reads and writes only rows carrying
// is_demo = false. There is no third state and no mixed view, because the whole point
// is that a real student's name can never appear on a conference screen.
//
// WHAT DEMO MODE IS NOT: a security control. The filter is applied in the browser, so
// it hides demo rows from a presentation, not real rows from an attacker. Anyone
// holding the anon key can still read whatever RLS permits. Nothing here changes RLS,
// and nothing here should ever be cited as a privacy boundary.
//
// TWO KEYS, AND WHY:
//   The per-user key is the truth. Demo mode is a preference and, exactly like the
//   cohort and the masthead city (see sessionKeys.js), a shared workstation means two
//   accounts must not inherit each other's state.
//
//   The browser-level ARMED marker exists because of a timing problem the per-user key
//   cannot solve. Queries begin firing the moment the app mounts, and the Supabase user
//   id is not known until auth resolves a few hundred milliseconds later. A boundary
//   that cannot answer "demo or not?" synchronously at module load would let the first
//   paint fetch real rows. On a stage that is the exact failure this feature exists to
//   prevent, so the marker is read synchronously and answers from the very first query.
//
//   They are written together and reconciled on sign-in. When they disagree, the
//   per-user key wins, because a different account arriving must never inherit the
//   previous presenter's mode.

import { DEMO_BOUNDARY_LIVE } from './demoBoundaryFlag.js'

const ARMED_KEY = 'aspire:demoMode'
const userKey = (userId) => `aspire:demoMode:${userId}`

// Read once, synchronously, at module load. Every later read is this cached value, so
// the boundary never pays for storage access on a hot query path.
let demoOn = readArmed()
const listeners = new Set()

function readArmed() {
  // Storage can be unavailable (private mode, blocked site data). Demo OFF is the
  // correct fallback: it is the state that shows real data to someone doing real work,
  // and a presenter who cannot persist the flag will notice immediately, because the
  // indicator is missing.
  try { return localStorage.getItem(ARMED_KEY) === '1' } catch { return false }
}

/**
 * Is the app currently in demo mode? Synchronous by contract: the boundary calls this
 * on every query and must never await.
 *
 * The flag wins over stored state, always. Without that, a marker left in localStorage
 * by a build where the feature WAS live would report demo mode on a build where the
 * boundary is off, and the badge would sit on screen over real student data. Reading
 * the flag here means every consumer (the badge, the panel, the wrapper, view-as) gets
 * the same answer from the same place.
 */
export function isDemoMode() { return DEMO_BOUNDARY_LIVE && demoOn }

/** Can demo mode be turned on at all? False until the migration is applied. */
export function isDemoModeAvailable() { return DEMO_BOUNDARY_LIVE }

/**
 * The stored switch position, WITHOUT the boundary gate in front of it.
 *
 * Nothing that renders or queries should call this: the gated isDemoMode() is the only
 * honest answer to "what is the app showing?". It exists so the storage and reconcile
 * rules can be tested as themselves, and so a future phase can tell "armed but not yet
 * available" apart from "off".
 */
export function isDemoModeArmed() { return demoOn }

/**
 * Turn demo mode on or off for this user, on this device.
 *
 * `userId` may be absent (auth not resolved). The armed marker is still written, so the
 * mode takes effect immediately; reconcileDemoModeForUser fixes the per-user key as soon
 * as the id arrives.
 */
export function setDemoMode(on, userId) {
  const next = Boolean(on)
  try {
    if (next) localStorage.setItem(ARMED_KEY, '1')
    else localStorage.removeItem(ARMED_KEY)
    if (userId) localStorage.setItem(userKey(userId), next ? '1' : '0')
  } catch { /* storage unavailable: the mode still applies for this page's lifetime */ }
  if (next === demoOn) return isDemoMode()
  demoOn = next
  emit()
  return isDemoMode()
}

/**
 * Called once auth resolves. Settles the two keys against each other and returns the
 * mode now in force.
 *
 * The per-user key wins whenever it exists. When it does not, this user has never used
 * demo mode on this device, and they inherit nothing: an armed marker left behind by a
 * different account is cleared rather than adopted.
 */
export function reconcileDemoModeForUser(userId) {
  if (!userId) return isDemoMode()
  let stored = null
  try { stored = localStorage.getItem(userKey(userId)) } catch { /* fall through */ }
  const next = stored === null ? false : stored === '1'
  return setDemoMode(next, userId)
}

/**
 * The demo scope as a request parameter, or null when there is none to send.
 *
 * A server endpoint cannot discover demo mode, so the requests that need it carry it.
 * null while the boundary is not live, which is what lets those endpoints keep behaving
 * exactly as they did before is_demo existed: see lib/server/demoScope.js for why
 * "absent" and "false" have to mean different things there.
 */
export function demoScopeParam() {
  if (!DEMO_BOUNDARY_LIVE) return null
  return demoOn ? '1' : '0'
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function subscribeDemoMode(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit() {
  // Publish what isDemoMode() would answer, never the raw stored value. A subscriber
  // that rendered the raw value would draw the Demo badge on a build where the boundary
  // is off, which is precisely the state this module refuses to allow.
  const value = isDemoMode()
  for (const fn of listeners) {
    // One bad subscriber must not stop the others from learning the mode changed.
    try { fn(value) } catch (err) { console.error('[demoMode] subscriber failed:', err) }
  }
}

/** Test seam. Resets module state without touching storage. */
export function __resetDemoModeForTests(value = false) {
  demoOn = Boolean(value)
  listeners.clear()
}
