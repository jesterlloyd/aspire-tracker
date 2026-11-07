// COHORT-NEWEST-1 (Owner, 2026-11-07): a portal's cohort picker opens on the newest cohort, unless
// the person was working in another one; then it opens where they left off. One small record per
// account in this browser, keyed by the user id (signOutCleanup 'keyed'), holding one cohort id per
// picker ("ap:<school>", "unit"). A remembered cohort that is no longer offered is ignored by the
// caller, which falls back to its default. Storage failures are silent: the choice still applies.

const PREFIX = 'aspire:portalCohort:'
const keyFor = userId => (userId ? `${PREFIX}${userId}` : null)

function readAll(userId) {
  const k = keyFor(userId)
  if (!k) return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(k) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch { return {} }
}

/** The cohort option id last chosen in this picker, or null. */
export function readPortalCohort(userId, picker) {
  const v = readAll(userId)[picker]
  return typeof v === 'string' && v ? v : null
}

/** Remember the option chosen in this picker. */
export function writePortalCohort(userId, picker, optionId) {
  const k = keyFor(userId)
  if (!k || !picker) return
  try {
    const all = readAll(userId)
    if (optionId) all[picker] = String(optionId)
    else delete all[picker]
    localStorage.setItem(k, JSON.stringify(all))
  } catch { /* storage unavailable */ }
}

export const PORTAL_COHORT_PREFIX = PREFIX
