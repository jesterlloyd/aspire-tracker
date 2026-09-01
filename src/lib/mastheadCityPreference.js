// MASTHEAD-SCENE-4/5: the viewer's chosen masthead city.
//
// Choosing a city moves the WHOLE masthead there: its artwork, its weather,
// and - because the scene clock reads the same query's sunrise and sunset -
// its time of day. That coherence is the point. An earlier pass changed only
// the artwork, which left a New York skyline reporting a Los Angeles
// temperature: one card making two claims that did not match.
//
// The greeting deliberately stays local. It addresses the person, not the
// city, so someone in Los Angeles reading a New York masthead at 5 PM is
// still greeted "Good afternoon" while the scene shows New York's evening.
// The card names the chosen city so that reads as a fact about New York
// rather than a contradiction.
//
// Saved per browser (the theme's model), so it needs no schema and no server.
// 'auto' - the default - follows the viewer's own resolved location.

export const CITY_PREF_KEY = 'aspire_masthead_city_v1'
export const AUTO = 'auto'

/** Read the stored preference, or 'auto' when unset/unavailable. */
export function readCityPreference() {
  try {
    const v = localStorage.getItem(CITY_PREF_KEY)
    return v || AUTO
  } catch {
    return AUTO // storage unavailable (privacy mode): behave as automatic
  }
}

/** Persist a choice. 'auto' clears the key rather than storing a sentinel. */
export function writeCityPreference(city) {
  try {
    if (!city || city === AUTO) localStorage.removeItem(CITY_PREF_KEY)
    else localStorage.setItem(CITY_PREF_KEY, city)
  } catch { /* storage unavailable: the choice simply does not persist */ }
}

/** Display names for installed pack keys; falls back to a title-cased key. */
const CITY_NAMES = {
  la: 'Los Angeles',
  lasvegas: 'Las Vegas',
  sandiego: 'San Diego',
  sanfrancisco: 'San Francisco',
  sacramento: 'Sacramento',
  newyork: 'New York',
  saltlakecity: 'Salt Lake City',
  washington: 'Washington, DC',
}

export function cityDisplayName(key) {
  if (!key) return ''
  return CITY_NAMES[key] || key.charAt(0).toUpperCase() + key.slice(1)
}

/**
 * The options a picker should show: Auto first, then every installed city
 * pack in display order. `packs` is the parsed { city: { scene: url } } map.
 */
/**
 * The weather location for a chosen city, or null for automatic. Shaped like
 * the resolver's own value so it can stand in for it directly; geo:false keeps
 * it out of the granted-location cache, which stays reserved for the viewer's
 * real position.
 */
export function cityWeatherLocation(city, coords) {
  if (!city || !coords?.[city]) return null
  const [lat, lon] = coords[city]
  return { lat, lon, label: cityDisplayName(city), geo: false, chosen: true }
}

export function cityOptions(packs) {
  const cities = Object.keys(packs || {})
    .map(key => ({ key, label: cityDisplayName(key) }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return [{ key: AUTO, label: 'Automatic' }, ...cities]
}
