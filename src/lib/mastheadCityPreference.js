// MASTHEAD-SCENE-4: the viewer's chosen masthead city.
//
// A display preference, nothing more: it picks which installed city pack the
// masthead artwork uses. It never touches the WEATHER, which keeps following
// the viewer's real resolved location - the temperature on screen is always
// the temperature where they are, whatever scenery they choose to look at.
//
// Saved per browser (the theme's model), so it needs no schema and no server.
// 'auto' - the default - falls back to location matching.

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
export function cityOptions(packs) {
  const cities = Object.keys(packs || {})
    .map(key => ({ key, label: cityDisplayName(key) }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return [{ key: AUTO, label: 'Automatic' }, ...cities]
}
