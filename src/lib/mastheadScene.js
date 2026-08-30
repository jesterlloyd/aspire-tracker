// MASTHEAD-SCENE-1: the deterministic time-of-day scene for the masthead
// background artwork AND the whole-card night treatment - ONE clock for both,
// so the artwork and the dark card can never disagree at dawn or dusk.
//
// Four states: 'dawn' (early morning, pre-sunrise glow), 'day', 'sunset',
// 'night'. When the shared weather query has today's sun times (they ride the
// existing Open-Meteo daily request - no extra fetch), the windows are anchored
// to the real sunrise/sunset; otherwise fixed local-time windows take over, so
// the scene never blocks on the network. Pure and clock-injected for tests.
//
// This module deliberately does NOT touch the greeting (src/lib/masthead.js):
// "Good evening" and its four windows are a separate, already-shipped contract.

const MIN = 60 * 1000

export const SCENES = ['dawn', 'day', 'sunset', 'night']

/** Parse the weather payload's sun times into Dates, or null when absent/bad.
 *  Open-Meteo (timezone=auto) returns the LOCATION's local wall time without an
 *  offset; Date() reads it in the browser's zone. The weather location is the
 *  viewer's own (or the LA fallback), so the zones agree in practice. */
export function sunTimesFrom(weather) {
  if (!weather?.sunrise || !weather?.sunset) return null
  const sunrise = new Date(weather.sunrise)
  const sunset = new Date(weather.sunset)
  if (Number.isNaN(sunrise.getTime()) || Number.isNaN(sunset.getTime())) return null
  return { sunrise, sunset }
}

/**
 * The scene for a moment in time.
 * With sun times: dawn opens 80 min before sunrise and holds until 15 min
 * after it (the low golden light just past sunrise still reads as dawn);
 * sunset opens 50 min before sunset and holds until 25 min after (civil
 * twilight); night is everything outside those and the day between them.
 * Without sun times: fixed windows sized for Los Angeles year-round.
 */
export function sceneForTime(now = new Date(), sun = null) {
  if (sun) {
    const t = now.getTime()
    const dawnStart = sun.sunrise.getTime() - 80 * MIN
    const dayStart = sun.sunrise.getTime() + 15 * MIN
    const sunsetStart = sun.sunset.getTime() - 50 * MIN
    const nightStart = sun.sunset.getTime() + 25 * MIN
    // Sun times are today's; overnight hours fall outside [dawnStart, nightStart).
    if (t >= dawnStart && t < dayStart) return 'dawn'
    if (t >= dayStart && t < sunsetStart) return 'day'
    if (t >= sunsetStart && t < nightStart) return 'sunset'
    return 'night'
  }
  const h = now.getHours() + now.getMinutes() / 60
  if (h >= 5 && h < 7) return 'dawn'
  if (h >= 7 && h < 18) return 'day'
  if (h >= 18 && h < 19.75) return 'sunset'
  return 'night'
}
