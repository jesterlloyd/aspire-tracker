// MASTHEAD-SCENE-1/3: the deterministic time-of-day scene for the masthead
// background artwork AND the whole-card night treatment - ONE clock for both,
// so the artwork and the dark card can never disagree at dawn or dusk.
//
// SCENE-3 (seven-scene city packs): the clock now cycles SIX time states -
// 'dawn' (pre-sunrise), 'morning' (the low light after sunrise), 'day',
// 'goldenhour' (the warm hour before sunset), 'sunset', 'night' - and a
// seventh artwork state 'rain' overrides the daytime family when the weather
// says rain, overcast, or fog (Owner decision: partly cloudy keeps the time
// scene, and night keeps its city-lights artwork whatever the weather).
//
// When the shared weather query has today's sun times (they ride the existing
// Open-Meteo daily request - no extra fetch), the windows anchor to the real
// sunrise/sunset; otherwise fixed local-time windows take over, so the scene
// never blocks on the network. Pure and clock-injected for tests.
//
// This module deliberately does NOT touch the greeting (src/lib/masthead.js):
// "Good evening" and its four windows are a separate, already-shipped contract.

const MIN = 60 * 1000

/** Every artwork state a city pack can carry (also the QA-override vocabulary
 *  and the pack-completeness checklist). */
// The scenes EVERY city pack must carry. A pack missing one of these is
// incomplete and the SVG scenery renders beneath it, so this list is the
// contract a dropped folder has to satisfy.
export const SCENES = ['dawn', 'morning', 'day', 'goldenhour', 'sunset', 'night', 'rain']

// MASTHEAD-CLOUDY-NIGHT (Owner): scenes a pack MAY carry. Optional on purpose -
// the five cities that shipped before this one have no CloudyNight frame, and
// making it required would have made all of them incomplete overnight. Each
// optional scene declares what it falls back to, so a pack without it still
// renders something true rather than nothing at all.
export const OPTIONAL_SCENES = ['cloudynight']
export const SCENE_FALLBACK = { cloudynight: 'night' }

/** Every scene that can be rendered, required and optional together. */
export const ALL_SCENES = [...SCENES, ...OPTIONAL_SCENES]

/** The frame a pack actually shows for a scene: itself, or what it falls back
 *  to when the pack does not carry it. Pure, so both the renderer and the
 *  tests read one rule. */
export function sceneFrameFor(scene, scenes) {
  if (scenes?.[scene]) return scenes[scene]
  const fallback = SCENE_FALLBACK[scene]
  return fallback ? scenes?.[fallback] || null : null
}

/** Night treatment covers every scene that IS night, not only the clear one. */
export function isNightScene(scene) {
  return scene === 'night' || scene === 'cloudynight'
}

/** The six states the clock itself produces ('rain' is weather-driven). */
export const CLOCK_SCENES = ['dawn', 'morning', 'day', 'goldenhour', 'sunset', 'night']

/** Parse the weather payload's sun times into Dates, or null when absent/bad.
 *  Open-Meteo (timezone=auto) returns the LOCATION's local wall time without an
 *  offset. MASTHEAD-CITY-TIME-1: the payload now carries the location's UTC
 *  offset as well, and the wall time is read THROUGH it into an absolute
 *  instant, so a chosen city's sun rises when it actually rises there. New
 *  York's 06:27 used to be read as 06:27 in the viewer's zone, three hours
 *  late from Los Angeles: a sunlit weather icon over a night skyline until
 *  nine in the morning Eastern. Without an offset (older payloads, tests) the
 *  string is read in the browser's zone as before. */
export function sunTimesFrom(weather) {
  if (!weather?.sunrise || !weather?.sunset) return null
  const off = typeof weather.utcOffsetSeconds === 'number' ? weather.utcOffsetSeconds : null
  const sunrise = wallTimeToInstant(weather.sunrise, off)
  const sunset = wallTimeToInstant(weather.sunset, off)
  if (Number.isNaN(sunrise.getTime()) || Number.isNaN(sunset.getTime())) return null
  return { sunrise, sunset }
}

/** "2026-09-05T06:27" in a zone that is `offsetSeconds` from UTC, as an
 *  instant. With no offset, the browser's own zone reads it. */
export function wallTimeToInstant(wall, offsetSeconds = null) {
  if (offsetSeconds === null) return new Date(wall)
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(wall))
  if (!m) return new Date(NaN)
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - offsetSeconds * 1000)
}

/**
 * The clock scene for a moment in time.
 * With sun times: dawn opens 80 min before sunrise and holds until 10 min
 * after it; morning carries the low light until 2.5 h past sunrise; golden
 * hour opens 75 min before sunset; sunset proper runs from 15 min before to
 * 25 min after (civil twilight); night is everything outside those.
 * Without sun times: fixed windows sized for Los Angeles year-round.
 */
export function sceneForTime(now = new Date(), sun = null) {
  if (sun) {
    const t = now.getTime()
    const dawnStart = sun.sunrise.getTime() - 80 * MIN
    const morningStart = sun.sunrise.getTime() + 10 * MIN
    const dayStart = sun.sunrise.getTime() + 150 * MIN
    const goldenStart = sun.sunset.getTime() - 75 * MIN
    const sunsetStart = sun.sunset.getTime() - 15 * MIN
    const nightStart = sun.sunset.getTime() + 25 * MIN
    // Sun times are today's; overnight hours fall outside [dawnStart, nightStart).
    if (t >= dawnStart && t < morningStart) return 'dawn'
    if (t >= morningStart && t < dayStart) return 'morning'
    if (t >= dayStart && t < goldenStart) return 'day'
    if (t >= goldenStart && t < sunsetStart) return 'goldenhour'
    if (t >= sunsetStart && t < nightStart) return 'sunset'
    return 'night'
  }
  const h = now.getHours() + now.getMinutes() / 60
  if (h >= 5 && h < 6.5) return 'dawn'
  if (h >= 6.5 && h < 9) return 'morning'
  if (h >= 9 && h < 17.5) return 'day'
  if (h >= 17.5 && h < 18.92) return 'goldenhour'
  if (h >= 18.92 && h < 19.75) return 'sunset'
  return 'night'
}

/** WMO codes that swap the daytime artwork for the Rain scene: rain, drizzle,
 *  freezing rain, showers, thunderstorms, snow (LA courtesy), full overcast,
 *  and fog. Partly cloudy (1-2) deliberately keeps the time-of-day scene. */
export function isRainyCode(code) {
  if (code == null) return false
  if (code === 3 || code === 45 || code === 48) return true
  if (code >= 51 && code <= 67) return true
  if (code >= 71 && code <= 77) return true
  if ((code >= 80 && code <= 86) || (code >= 95 && code <= 99)) return true
  return false
}

/** The artwork scene: the clock scene, except that rainy, overcast or foggy
 *  weather overrides it - to 'rain' by day and, since MASTHEAD-CLOUDY-NIGHT, to
 *  'cloudynight' after dark. Night used to ignore the weather entirely and show
 *  a clear sky through a storm; it does not any more. A pack without a
 *  CloudyNight frame falls back to its Night one (SCENE_FALLBACK), so this is
 *  safe for every city whether or not it has the extra artwork. */
export function artSceneFor(clockScene, weatherCode) {
  if (!isRainyCode(weatherCode)) return clockScene
  return clockScene === 'night' ? 'cloudynight' : 'rain'
}
