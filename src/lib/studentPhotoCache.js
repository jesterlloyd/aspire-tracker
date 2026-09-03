// src/lib/studentPhotoCache.js
//
// WAVE F-2 (photo performance): a shared, in-memory signed-photo cache with
// in-flight request deduplication. Without it, every StudentAvatar instance signs
// its own short-lived URL on mount, so list views (N students), the same student
// appearing on At a Glance / On Campus Now / Student Profiles, and every list<->grid
// or tab remount each re-sign and hand the <img> a brand-new URL, which also defeats
// the browser image cache. This module makes a given student's photo sign at most
// once per authorization scope while the entry is valid, and returns a STABLE URL so
// remounts reuse the browser-cached image.
//
// Security:
//   - UI-CONSISTENCY-1 (Owner decision, 2026-09-03): entries are mirrored to
//     sessionStorage so a fresh page load shows every headshot instantly instead of
//     re-signing the roster. This REPLACES the earlier memory-only posture, and it is
//     bounded the same three ways: sessionStorage dies with the tab (never localStorage
//     or IndexedDB); every stored entry carries the authorization scope it was signed
//     under and is ignored, then discarded, under any other scope; and every entry
//     carries its own expiry, which is shorter than the server signed-URL lifetime. A
//     read never trusts storage blindly: scope and expiry are checked on every peek.
//   - The cache is scoped to an authorization context (see setStudentPhotoCacheScope).
//     Changing user, role, or active state clears it, so a signed URL minted for one
//     authorization context is never reused under another (no cross-user leakage,
//     and no access after sign-out or a role/account change).
//   - Only successful URLs are cached. 401 / 403 / errors are never cached, and an
//     auth error clears the cache.
//   - Entries expire BEFORE the server signed-URL TTL, so a served URL is always
//     still valid.

// STUDENT-PHOTO-PERF-1: only headshot URLs ever enter this cache (resumes are
// minted fresh per click and never cached), and every headshot-signing endpoint
// signs with the shared 3600s headshot lifetime (lib/server/studentFiles.js).
// Expire cache entries well before that, so a served URL is always still valid.
const TTL_MS = 3300 * 1000

const cache = new Map()    // key -> { url, expiresAt }
const inflight = new Map() // key -> Promise<string|null>
let scope = null           // current authorization scope token

// sessionStorage mirror. Guarded everywhere: storage can be absent (SSR, tests), full,
// or blocked, and none of that may ever break a render - the cache simply stays in memory.
const STORE_KEY = 'aspire:studentPhotoCache:v1'
function storage() {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null } catch { return null }
}
function persist() {
  const st = storage(); if (!st) return
  try {
    if (!scope || cache.size === 0) { st.removeItem(STORE_KEY); return }
    const now = Date.now()
    const entries = [...cache.entries()].filter(([, e]) => e.expiresAt > now)
    st.setItem(STORE_KEY, JSON.stringify({ scope, entries }))
  } catch { /* quota or privacy mode: memory still works */ }
}
// Rehydrate ONLY entries signed under the current scope and not yet expired. Anything
// else is dropped from storage on the spot, so a stale or foreign snapshot never lingers.
function rehydrate() {
  const st = storage(); if (!st || !scope) return
  try {
    const raw = st.getItem(STORE_KEY); if (!raw) return
    const snap = JSON.parse(raw)
    if (!snap || snap.scope !== scope || !Array.isArray(snap.entries)) { st.removeItem(STORE_KEY); return }
    const now = Date.now()
    for (const [key, e] of snap.entries) {
      if (e && typeof e.url === 'string' && typeof e.expiresAt === 'number' && e.expiresAt > now) cache.set(key, e)
    }
  } catch { try { st.removeItem(STORE_KEY) } catch { /* ignore */ } }
}

// Set the current authorization scope. Any change (sign-in, sign-out, role change,
// active-state change, user change) clears the cache and in-flight promises, so the
// next request re-signs under the new context. Call from AuthContext.
export function setStudentPhotoCacheScope(nextScope) {
  const s = nextScope == null ? null : String(nextScope)
  if (s !== scope) {
    scope = s
    cache.clear()
    inflight.clear()
    // A scope change is the one moment storage may be read: what it holds is either
    // this scope's warm cache from an earlier page load, or someone else's, dropped.
    rehydrate()
    persist()
  }
}

// Explicit clear (sign-out, authorization failure).
// Invalidate ONE student's cached photo, e.g. when its signed URL is stale. This is
// the surgical alternative to clearStudentPhotoCache: the drawer used to clear the
// WHOLE cache on a single photo error, which blanked every roster avatar. A one-key
// delete re-signs only the affected student and leaves the rest of the roster warm.
export function invalidateStudentPhoto(key) {
  if (!key) return
  cache.delete(key)
  inflight.delete(key)
  persist()
}

export function clearStudentPhotoCache() {
  cache.clear()
  inflight.clear()
  persist()
}

// Synchronous read of a still-valid cached URL, or null. Used to render a warm
// photo immediately (no loading flash, no request).
export function peekStudentPhotoUrl(key) {
  if (!key) return null
  const e = cache.get(key)
  if (!e) return null
  if (e.expiresAt <= Date.now()) { cache.delete(key); return null }
  return e.url
}

// Resolve a signed URL for `key`, using the cache and de-duplicating concurrent
// callers. `fetcher` performs the actual signing request and resolves to a URL (or
// null / throws on denial). Successful non-null URLs are cached; failures are not.
export async function resolveStudentPhotoUrl(key, fetcher) {
  if (!key) return null
  const cached = peekStudentPhotoUrl(key)
  if (cached) return cached
  const pending = inflight.get(key)
  if (pending) return pending

  const p = (async () => {
    try {
      const url = await fetcher()
      if (url) { cache.set(key, { url, expiresAt: Date.now() + TTL_MS }); persist() }
      return url || null
    } catch (err) {
      // Never cache a failure. An auth error invalidates the whole scope.
      if (err && (err.status === 401 || err.status === 403)) clearStudentPhotoCache()
      throw err
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, p)
  return p
}

// Test/introspection helper: current entry count.
export function studentPhotoCacheSize() {
  return cache.size
}
