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
// Saved in this browser, so it needs no schema and no server: a choice never
// travels to another person, and staff and portal viewers stay independent.
// 'auto' - the default - follows the viewer's own resolved location.
//
// MASTHEAD-CITY-PER-USER-1: saved PER SIGNED-IN USER, not per browser. Shared
// workstations are normal on a unit, and under the old flat key the next person
// to sign in inherited whoever last used the machine. See mastheadCityKey.

import { mastheadCityKey, LEGACY_MASTHEAD_CITY_KEY } from './sessionKeys.js'

export const AUTO = 'auto'

/**
 * Read the stored preference, or 'auto' when unset/unavailable.
 *
 * Adopts a pre-namespacing value on the way past, once: the first account to read
 * after the change inherits the machine's old choice and the legacy key is removed,
 * so nobody after them sees it. Migrating only when this user has no value of their
 * own means a returning user's real choice always wins over the leftover.
 */
export function readCityPreference(userId) {
  try {
    const key = mastheadCityKey(userId)
    const own = localStorage.getItem(key)
    if (own) return own
    const legacy = localStorage.getItem(LEGACY_MASTHEAD_CITY_KEY)
    if (legacy) {
      localStorage.removeItem(LEGACY_MASTHEAD_CITY_KEY)
      localStorage.setItem(key, legacy)
      return legacy
    }
    return AUTO
  } catch {
    return AUTO // storage unavailable (privacy mode): behave as automatic
  }
}

/** Persist a choice. 'auto' clears the key rather than storing a sentinel. */
export function writeCityPreference(userId, city) {
  try {
    const key = mastheadCityKey(userId)
    if (!city || city === AUTO) localStorage.removeItem(key)
    else localStorage.setItem(key, city)
  } catch { /* storage unavailable: the choice simply does not persist */ }
}

/** Display names for installed pack keys; falls back to a title-cased key. */
const CITY_NAMES = {
  losangeles: 'Los Angeles',
  lasvegas: 'Las Vegas',
  sandiego: 'San Diego',
  sanfrancisco: 'San Francisco',
  sacramento: 'Sacramento',
  newyork: 'New York',
  saltlakecity: 'Salt Lake City',
  washington: 'Washington, DC',
  hongkong: 'Hong Kong',
  // The folder is Rio (the Owner named it), the city is Rio de Janeiro. The
  // pack key follows the folder, as the canon requires; only the label is the
  // long form, and CITY_ALIASES maps the long spelling back so a browser that
  // reports "Rio de Janeiro" still lands on this pack.
  rio: 'Rio de Janeiro',
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

// MASTHEAD-PICKER-GRID-1: the picker's card images, one per option, dropped
// by the Owner under public/masthead/picker/ (16:9, corners already rounded,
// never edited here). The mapping is explicit so a renamed file fails the
// guard test rather than showing a broken card; a city with no image gets no
// URL and the card renders its label alone.
export const PICKER_IMAGE_FILES = {
  [AUTO]: 'Automatic.png',
  atlanta: 'Atlanta.png',
  hollywood: 'Hollywood.png',
  hongkong: 'HongKong.png',
  honolulu: 'Honolulu.png',
  rio: 'Rio.png',
  tokyo: 'Tokyo.png',
  lasvegas: 'LasVegas.png',
  losangeles: 'LosAngeles.png',
  newyork: 'NewYork.png',
  sanfrancisco: 'SanFrancisco.png',
  seattle: 'Seattle.png',
}

/** Root-relative public URL for an option's picker image, or null. Encoded,
 *  so a filename with a space would still resolve. */
export function pickerImageFor(key) {
  const file = PICKER_IMAGE_FILES[key]
  return file ? encodeURI(`/masthead/picker/${file}`) : null
}

export function cityOptions(packs) {
  const cities = Object.keys(packs || {})
    .map(key => ({ key, label: cityDisplayName(key) }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return [{ key: AUTO, label: 'Automatic' }, ...cities]
}
