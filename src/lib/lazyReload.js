// CHUNK-RELOAD-1 (2026-09-15): lazy() that survives a deploy.
//
// Every code-split chunk has a content hash in its filename, and every deploy
// changes the hashes. A tab opened before a deploy still holds the OLD names, so
// the first click into a lazy part (the portals, the public site, a Unit Leader
// workspace) asks the server for a file that no longer exists. Until vercel.json
// excluded /assets/ from the SPA rewrite, that request came back as app.html with
// a 200, which the browser then tried to run as JavaScript; either way the import
// rejects, and with nothing to catch it React unmounted the whole tree: a blank
// page until the person refreshed by hand.
//
// This wrapper does the refresh for them, once. On a failed import it records the
// attempt in sessionStorage and reloads, which fetches the new app.html and the
// new chunk names. If the SAME chunk fails again within the window, the error is
// thrown instead, so AppErrorBoundary shows a real message rather than a reload
// loop. Vite 8 does not dispatch the vite:preloadError event this used to be done
// with, so the import promise itself is what is caught.

import { lazy } from 'react'

const WINDOW_MS = 2 * 60 * 1000
const keyFor = (name) => `aspire:chunk-reload:${name}`
const CACHE_BUSTER = '__aspire_reload'

// A normal location.reload() can reuse a cached app.html. That leaves an old
// app shell pointing at the same missing hashed chunk, so the retry fails again.
// Add a one-time query value to force the hosting layer to return the current
// app shell. The entry point removes the value after the document loads.
export function freshAppUrl(href, now = Date.now()) {
  const url = new URL(href)
  url.searchParams.set(CACHE_BUSTER, String(now))
  return url.toString()
}

export function reloadToCurrentVersion(location, now = Date.now()) {
  if (!location?.replace || !location?.href) return
  location.replace(freshAppUrl(location.href, now))
}

// Pure decision, testable without a browser: should a failed load of `name`
// reload the page? `storage` is Storage-like (getItem/setItem); `now` is ms.
export function shouldReloadAfterChunkFailure(name, storage, now = Date.now()) {
  let last
  try { last = storage?.getItem(keyFor(name)) } catch { /* storage blocked */ }
  const lastAt = Number(last)
  if (Number.isFinite(lastAt) && lastAt > 0 && now - lastAt < WINDOW_MS) return false
  try { storage?.setItem(keyFor(name), String(now)) } catch { /* storage blocked: still reload once */ }
  return true
}

export function lazyReload(importer, name) {
  return lazy(() => importer().catch((error) => {
    if (typeof window !== 'undefined' && shouldReloadAfterChunkFailure(name, window.sessionStorage)) {
      reloadToCurrentVersion(window.location)
      // Never resolves: the page is going away, and resolving to nothing would
      // flash an empty screen first.
      return new Promise(() => {})
    }
    throw error
  }))
}
