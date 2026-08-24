const PREFIX = 'aspire:portal:cohort-hint:'

export function portalCohortHintKey(userId, experience) {
  if (!userId || !experience) return null
  return `${PREFIX}${experience}:${userId}`
}

export function hasSeenPortalCohortHint(userId, experience) {
  const key = portalCohortHintKey(userId, experience)
  if (!key) return true
  try { return sessionStorage.getItem(key) === 'true' } catch { return false }
}

export function markPortalCohortHintSeen(userId, experience) {
  const key = portalCohortHintKey(userId, experience)
  if (!key) return
  try { sessionStorage.setItem(key, 'true') } catch { /* storage can be unavailable */ }
}

// Signing out starts a new login experience even when the same browser tab remains open.
export function clearPortalCohortHintSession() {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i)
      if (key?.startsWith(PREFIX)) sessionStorage.removeItem(key)
    }
  } catch {
    // Storage can be unavailable in privacy mode. The hint then falls back to component state.
  }
}
