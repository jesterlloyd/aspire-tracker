// src/lib/sessionKeys.js
//
// FRESH-LOGIN-HOME-1: everything this browser remembers about a signed-in staff user,
// in one place, because sign-out has to clear the right subset and "the right subset"
// is a decision worth writing down rather than rediscovering.
//
// All of these are PER AUTHENTICATED USER, keyed by the Supabase user id, so two
// accounts on the same browser cannot inherit each other's state. That rule was
// established by AUTH-UX-1 for the tab and extended to the cohort by SCOPE-PICKER-1.
//
// WHAT SIGN-OUT CLEARS, AND WHY THE SPLIT:
//   CLEARED  the last active tab, and the last NGRP sub-tab. These are WHERE YOU WERE.
//            Signing in again is a fresh start, and being returned to a screen from a
//            previous session is the defect this module exists to fix.
//   KEPT     the selected cohort. That is WHAT YOU WORK IN, not where you were. It
//            already falls back to the Active cohort when unset, so clearing it every
//            sign-in would re-pick a cohort for someone who had deliberately chosen a
//            different one.
//
// A note on why clearing is needed AT ALL, given the sign-in redirect below does the
// visible work: the tab value is written in exactly one place, App.jsx switchTab, which
// runs only on a deliberate tab click. Landing somewhere by redirect never rewrites it.
// So a value left behind is not harmlessly overwritten: PortalRoute reads it later and
// would return the user to a pre-logout tab they never chose this session. Clearing
// removes that second, disagreeing source of truth.

/** The staff workspace tab (overview | profiles | interviews | rotation | evaluation). */
export const lastTabKey = (userId) => `aspire:lastActiveTab:${userId}`

/** The Residency (NGRP) sub-tab, so that experience restores where the user left off. */
export const lastNgrpTabKey = (userId) => `aspire:lastNgrpTab:${userId}`

/** The selected ASPIRE cohort. Deliberately NOT cleared on sign-out; see above. */
export const aspireCohortKey = (userId) => `aspire:activeCohort:${userId}`

/**
 * Which account was last active in THIS browser. Not per-user by definition: it is how
 * a DIFFERENT account signing in is detected (AUTH-UX-1B).
 */
export const LAST_AUTH_USER_KEY = 'aspire:lastAuthenticatedUserId'

/**
 * One-shot marker: "a sign-out happened in this browser". Written on SIGNED_OUT,
 * consumed by the next sign-in, which then lands on At a Glance.
 *
 * Browser-level rather than per-user on purpose. At sign-out we know who left; at the
 * next sign-in we do not yet know who is arriving, and the answer is the same either
 * way: whoever signs in next is starting fresh.
 */
export const SIGNED_OUT_MARKER_KEY = 'aspire:signedOutHere'

/**
 * Clear the WHERE-YOU-WERE state for one user and mark that a sign-out happened.
 *
 * Safe to call with no id (an expired session whose user we never recorded): the marker
 * is still set, so the next sign-in still lands on At a Glance. That is the important
 * half; the per-user cleanup is the tidy half.
 *
 * Never throws. Storage can be unavailable (private mode, blocked site data), and a
 * sign-out must complete regardless.
 */
export function clearLastLocationOnSignOut(userId) {
  try {
    if (userId) {
      localStorage.removeItem(lastTabKey(userId))
      localStorage.removeItem(lastNgrpTabKey(userId))
    }
    localStorage.setItem(SIGNED_OUT_MARKER_KEY, '1')
  } catch { /* storage unavailable: the sign-in redirect simply does not fire */ }
}

/**
 * Did a sign-out happen in this browser since the last sign-in? Reading CONSUMES the
 * marker, so it fires exactly once: a later navigation in the same session must not be
 * treated as a fresh arrival.
 */
export function consumeSignedOutMarker() {
  try {
    const present = localStorage.getItem(SIGNED_OUT_MARKER_KEY) === '1'
    if (present) localStorage.removeItem(SIGNED_OUT_MARKER_KEY)
    return present
  } catch { return false }
}
