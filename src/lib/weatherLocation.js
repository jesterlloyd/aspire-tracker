// ASPIRE-WELCOME-CALENDAR-POLISH-5: resolves the location for the welcome-band weather. Tries the
// browser's geolocation ONCE (module-level singleton so both weather consumers share one request and
// one prompt); falls back to the fixed Cedars-Sinai / Los Angeles coords if permission is
// denied/unavailable/slow. Privacy: coordinates are rounded to ~2 decimals (≈1 km), used ONLY for the
// Open-Meteo request + React Query key (in memory), never logged, never persisted, never shown in the
// UI (the label is "Current location", not raw coords). No API key, no server, no IP geolocation.
//
// Open-Meteo has no reverse-geocoding endpoint, so a granted location shows the neutral label
// "Current location" rather than a city name (adding a third-party reverse geocoder needs approval).
import { useEffect, useState } from 'react'

// Fixed Cedars-Sinai / Los Angeles fallback (unchanged from prior weather work).
export const LA_FALLBACK = { lat: 34.076, lon: -118.380, label: 'Los Angeles', geo: false }

const round2 = (n) => Math.round(n * 100) / 100

// Resolve exactly once per page load; both hook instances await the same promise.
let _locPromise = null
function resolveLocation() {
  if (_locPromise) return _locPromise
  _locPromise = new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { resolve(LA_FALLBACK); return }
    // Own timeout guards the case where the user ignores the permission prompt (the geolocation
    // `timeout` option only bounds acquisition AFTER a grant, not the prompt itself).
    let settled = false
    const done = (loc) => { if (!settled) { settled = true; resolve(loc) } }
    const timer = setTimeout(() => done(LA_FALLBACK), 6000)
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => { clearTimeout(timer); done({ lat: round2(pos.coords.latitude), lon: round2(pos.coords.longitude), label: 'Current location', geo: true }) },
        () => { clearTimeout(timer); done(LA_FALLBACK) },
        { timeout: 6000, maximumAge: 30 * 60 * 1000, enableHighAccuracy: false },
      )
    } catch { clearTimeout(timer); done(LA_FALLBACK) }
  })
  return _locPromise
}

// Starts at the LA fallback (so weather appears immediately) and upgrades to the browser location
// only if geolocation is granted; on denial/timeout it stays at the fallback.
export function useWeatherLocation() {
  const [loc, setLoc] = useState(LA_FALLBACK)
  useEffect(() => {
    let mounted = true
    resolveLocation().then((l) => { if (mounted && l.geo) setLoc(l) })
    return () => { mounted = false }
  }, [])
  return loc
}
