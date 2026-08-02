// ASPIRE-WELCOME-CALENDAR-POLISH-5: resolves the location for the masthead weather. Tries the
// browser's geolocation ONCE (module-level singleton so every weather consumer shares one request and
// one prompt); falls back to the fixed Cedars-Sinai / Los Angeles coords if permission is
// denied/unavailable/slow. Privacy: coordinates are rounded to ~2 decimals (≈1 km), used ONLY for the
// Open-Meteo request + React Query key, never logged and never shown in the UI (the label is a nearby
// city name or "Current location", not raw coords). No API key, no server, no IP geolocation.
//
// ASPIRE-POLISH-6A: a granted location is labeled with its nearest Southern California city (e.g.
// "Palmdale") via a bundled, fully-offline centroid lookup (findNearestSocalCity) - NO third-party
// reverse geocoder, NO server, NO extra network request. If the location is outside the SoCal table's
// range (nearest city beyond the threshold), the neutral "Current location" label is kept.
//
// MASTHEAD-WEATHER-1: cached, prompt-polite resolution. Fallback hierarchy (first hit wins):
//   1. Cached granted location (localStorage, rounded coords only) - rendered IMMEDIATELY so a
//      returning user sees their own city's weather with zero wait, then refreshed in the background.
//   2. Live geolocation - only when it will not nag: permission already 'granted' (silent), or
//      'prompt' and the user has not dismissed/ignored our prompt in the last PROMPT_SNOOZE_DAYS.
//   3. The fixed Cedars-Sinai / Los Angeles fallback (also the instant first paint when no cache).
// A denied permission or an ignored prompt is remembered (timestamp only, no coords) so the user is
// not re-prompted every visit. Masthead rendering NEVER blocks on any of this.
import { useEffect, useState } from 'react'
// Explicit .js extension so node-based tests can import this module directly.
import { findNearestSocalCity } from './socalCities.js'

// Fixed Cedars-Sinai / Los Angeles fallback (unchanged from prior weather work).
export const LA_FALLBACK = { lat: 34.076, lon: -118.380, label: 'Los Angeles', geo: false }

// Rounded-coords cache of the last GRANTED location + the prompt-snooze marker.
export const LOC_CACHE_KEY = 'aspire_weather_loc_v1'
export const PROMPT_SNOOZE_KEY = 'aspire_weather_loc_snooze_v1'
const LOC_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000 // background-refresh after a day; still usable stale
export const PROMPT_SNOOZE_DAYS = 7

const round2 = (n) => Math.round(n * 100) / 100

function readJson(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable: skip */ }
}

// Cached granted location, if structurally valid. `fresh` distinguishes "render and refresh in the
// background" from "render but definitely try to re-resolve".
export function readCachedLocation() {
  const c = readJson(LOC_CACHE_KEY)
  if (!c || typeof c.lat !== 'number' || typeof c.lon !== 'number') return null
  return {
    lat: c.lat, lon: c.lon,
    label: typeof c.label === 'string' && c.label ? c.label : 'Current location',
    geo: true,
    fresh: typeof c.ts === 'number' && Date.now() - c.ts < LOC_CACHE_MAX_AGE_MS,
  }
}

function promptSnoozed() {
  const s = readJson(PROMPT_SNOOZE_KEY)
  return typeof s?.ts === 'number' && Date.now() - s.ts < PROMPT_SNOOZE_DAYS * 86400000
}

// Permission state via the Permissions API where available; 'prompt' when unknown (older Safari),
// which preserves the pre-existing ask-once-per-load behavior behind the snooze marker.
async function permissionState() {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'prompt'
    const st = await navigator.permissions.query({ name: 'geolocation' })
    return st?.state || 'prompt'
  } catch { return 'prompt' }
}

// Resolve exactly once per page load; every hook instance awaits the same promise.
let _locPromise = null
function resolveLocation() {
  if (_locPromise) return _locPromise
  _locPromise = (async () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return readCachedLocation() || LA_FALLBACK
    const cached = readCachedLocation()
    const state = await permissionState()
    // Denied: never call getCurrentPosition (some browsers surface UI even then); the stale grant
    // cache is dropped so a user who revoked permission falls back cleanly on this and every
    // future visit.
    if (state === 'denied') {
      try { localStorage.removeItem(LOC_CACHE_KEY) } catch { /* storage unavailable: skip */ }
      return LA_FALLBACK
    }
    // Prompting would nag: keep whatever we have. A silent 'granted' read never prompts, so it
    // always proceeds; only the 'prompt' state consults the snooze marker.
    if (state === 'prompt' && promptSnoozed()) return cached || LA_FALLBACK
    return new Promise((resolve) => {
      // Own timeout guards the case where the user ignores the permission prompt (the geolocation
      // `timeout` option only bounds acquisition AFTER a grant, not the prompt itself).
      let settled = false
      const done = (loc) => { if (!settled) { settled = true; resolve(loc) } }
      const onTimeout = () => {
        // Ignored prompt: snooze future prompts, keep the best non-live answer.
        if (state === 'prompt') writeJson(PROMPT_SNOOZE_KEY, { ts: Date.now() })
        done(cached || LA_FALLBACK)
      }
      const timer = setTimeout(onTimeout, 6000)
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            clearTimeout(timer)
            const lat = round2(pos.coords.latitude)
            const lon = round2(pos.coords.longitude)
            // Nearest bundled SoCal city (offline lookup on the already-rounded coords); neutral
            // label if the user is outside the region. Raw coords are never shown or logged; only
            // the rounded pair is cached.
            const city = findNearestSocalCity(lat, lon)
            const loc = { lat, lon, label: city || 'Current location', geo: true }
            writeJson(LOC_CACHE_KEY, { lat, lon, label: loc.label, ts: Date.now() })
            done(loc)
          },
          (err) => {
            clearTimeout(timer)
            if (state === 'prompt' && err?.code === 1 /* PERMISSION_DENIED */) {
              writeJson(PROMPT_SNOOZE_KEY, { ts: Date.now() })
            }
            done(cached || LA_FALLBACK)
          },
          { timeout: 6000, maximumAge: 30 * 60 * 1000, enableHighAccuracy: false },
        )
      } catch { clearTimeout(timer); done(cached || LA_FALLBACK) }
    })
  })()
  return _locPromise
}

// Starts INSTANTLY at the cached granted location (returning user) or the LA fallback (so weather
// renders with no wait), then applies the resolver's answer. The resolver already returns the best
// entry in the hierarchy (live grant > cache > fallback), so applying it unconditionally also
// downgrades a REVOKED permission back to the fallback instead of pinning a stale city.
export function useWeatherLocation() {
  const [loc, setLoc] = useState(() => readCachedLocation() || LA_FALLBACK)
  useEffect(() => {
    let mounted = true
    resolveLocation().then((l) => { if (mounted) setLoc({ lat: l.lat, lon: l.lon, label: l.label, geo: l.geo === true }) })
    return () => { mounted = false }
  }, [])
  return loc
}
