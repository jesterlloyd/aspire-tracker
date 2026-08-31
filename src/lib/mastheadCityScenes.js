// MASTHEAD-SCENE-2: city scene packs for the masthead artwork.
//
// A "pack" is a set of prepared images in public/masthead/ named
// <City>_<Scene>.webp (see scripts/prepare-masthead-scenes.mjs), one per
// time-of-day scene. Vite injects the folder listing at build time
// (__MASTHEAD_SCENE_FILES__ in vite.config.js); this module parses that list
// and picks the pack for the viewer's location - the SAME resolved location
// the weather module already uses (granted geolocation city, else LA), so the
// artwork follows the person the way the temperature already does.
//
// Selection order: exact city-name match on the location label (with aliases),
// then nearest known city that has a pack within MAX_KM, then the LA pack,
// then null (the caller falls back to the built-in SVG scenery). Pure and
// list-injected for tests.

// Scene-word synonyms accepted in filenames, normalized to the canonical
// scene keys from src/lib/mastheadScene.js. SCENE-3: seven scenes - morning
// is its own state now (no longer an alias of dawn), golden hour joined, and
// rain is the weather-override artwork.
const SCENE_WORDS = {
  dawn: 'dawn', sunrise: 'dawn', earlymorning: 'dawn',
  morning: 'morning',
  day: 'day', noon: 'day', midday: 'day',
  goldenhour: 'goldenhour', golden: 'goldenhour',
  sunset: 'sunset', dusk: 'sunset', evening: 'sunset',
  night: 'night',
  rain: 'rain', rainy: 'rain', cloudy: 'rain', overcast: 'rain', storm: 'rain',
}

// Lowercased, punctuation-stripped label/filename tokens → canonical pack key.
const CITY_ALIASES = {
  la: 'la', losangeles: 'la',
  lasvegas: 'lasvegas', vegas: 'lasvegas',
  newyork: 'newyork', newyorkcity: 'newyork', nyc: 'newyork',
  sanfrancisco: 'sanfrancisco', sf: 'sanfrancisco',
  washington: 'washington', washingtondc: 'washington', dc: 'washington',
  saltlakecity: 'saltlakecity', slc: 'saltlakecity',
}

// Coordinates for proximity matching ("wherever I am"): a viewer near one of
// these cities gets that city's pack when it exists. Extend freely when a new
// city pack is added; a pack whose key is absent here still works via exact
// label match.
export const CITY_COORDS = {
  la: [34.05, -118.24],
  sandiego: [32.72, -117.16],
  sanfrancisco: [37.77, -122.42],
  sacramento: [38.58, -121.49],
  lasvegas: [36.17, -115.14],
  phoenix: [33.45, -112.07],
  seattle: [47.61, -122.33],
  portland: [45.52, -122.68],
  denver: [39.74, -104.99],
  saltlakecity: [40.76, -111.89],
  chicago: [41.88, -87.63],
  dallas: [32.78, -96.8],
  houston: [29.76, -95.37],
  miami: [25.76, -80.19],
  atlanta: [33.75, -84.39],
  newyork: [40.71, -74.01],
  boston: [42.36, -71.06],
  washington: [38.91, -77.04],
  london: [51.51, -0.13],
  paris: [48.86, 2.35],
  tokyo: [35.68, 139.69],
  manila: [14.6, 120.98],
}

const MAX_KM = 150

export const normalizeCityToken = s =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Parse a public/masthead/ file listing into packs:
 * { la: { day: '/masthead/LA/LA_Day.webp', ... }, ... }
 *
 * SCENE-3 convention: one FOLDER per city (public/masthead/LA/) holding files
 * named <City>_<Scene>; the folder name is the city key. Flat top-level files
 * still parse (city from the filename). The scene is recognized from the END
 * of the basename - up to two trailing tokens ("Golden Hour", "Golden_Hour")
 * - so multi-word cities like Las_Vegas_Night resolve correctly either way.
 * WebP wins over PNG/JPG for the same city+scene; unrecognized scene words
 * and deeper nesting are ignored.
 */
export function parseSceneFiles(files) {
  const packs = {}
  const isWebp = f => /\.webp$/i.test(f)
  for (const file of files || []) {
    const path = String(file).replace(/\\/g, '/')
    const parts = path.split('/')
    if (parts.length > 2 || parts.some(p => !p)) continue
    const folder = parts.length === 2 ? parts[0] : null
    const base = parts[parts.length - 1]
    const m = /^(.+)\.(webp|png|jpe?g)$/i.exec(base)
    if (!m) continue
    const tokens = m[1].split(/[_ ]+/).filter(Boolean)
    let scene = null
    let cityTokens = null
    for (const take of [2, 1]) {
      // A flat file must keep at least one token for the city name.
      if (tokens.length < take + (folder ? 0 : 1)) continue
      const s = SCENE_WORDS[normalizeCityToken(tokens.slice(-take).join(''))]
      if (s) { scene = s; cityTokens = tokens.slice(0, -take); break }
    }
    if (!scene) continue
    const token = normalizeCityToken(folder ?? cityTokens.join(''))
    const city = CITY_ALIASES[token] || token
    if (!city) continue
    packs[city] = packs[city] || {}
    const existing = packs[city][scene]
    if (existing && isWebp(existing.file) && !isWebp(path)) continue
    packs[city][scene] = { file: path, url: encodeURI(`/masthead/${path}`) }
  }
  // Flatten to scene → url.
  for (const city of Object.keys(packs)) {
    for (const scene of Object.keys(packs[city])) {
      packs[city][scene] = packs[city][scene].url
    }
  }
  return packs
}

function distanceKm([lat1, lon1], [lat2, lon2]) {
  const rad = d => (d * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}

/**
 * Pick the pack for a resolved weather location ({ lat, lon, label }).
 * Returns { city, scenes } or null when no pack applies.
 */
export function choosePack(packs, location) {
  const keys = Object.keys(packs || {})
  if (keys.length === 0) return null

  const labelToken = normalizeCityToken(location?.label)
  const labelCity = CITY_ALIASES[labelToken] || labelToken
  if (labelCity && packs[labelCity]) return { city: labelCity, scenes: packs[labelCity] }

  if (Number.isFinite(location?.lat) && Number.isFinite(location?.lon)) {
    let best = null
    for (const city of keys) {
      const coords = CITY_COORDS[city]
      if (!coords) continue
      const km = distanceKm([location.lat, location.lon], coords)
      if (km <= MAX_KM && (!best || km < best.km)) best = { city, km }
    }
    if (best) return { city: best.city, scenes: packs[best.city] }
  }

  if (packs.la) return { city: 'la', scenes: packs.la }
  return null
}

/** The build-injected file list, safe under Node tests (no global defined). */
export function injectedSceneFiles() {
  // eslint-disable-next-line no-undef
  return typeof __MASTHEAD_SCENE_FILES__ !== 'undefined' ? __MASTHEAD_SCENE_FILES__ : []
}
