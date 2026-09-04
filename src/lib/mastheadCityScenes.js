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
// then nearest known city that has a pack within MAX_KM, then the Los Angeles pack,
// then null (the caller falls back to the built-in SVG scenery). Pure and
// list-injected for tests.

// Scene-word synonyms accepted in filenames, normalized to the canonical
// scene keys from src/lib/mastheadScene.js. SCENE-3: seven scenes - morning
// is its own state now (no longer an alias of dawn), golden hour joined, and
// rain is the weather-override artwork.
const SCENE_WORDS = {
  dawn: 'dawn', sunrise: 'dawn', earlymorning: 'dawn',
  morning: 'morning',
  day: 'day', daytime: 'day', noon: 'day', midday: 'day',
  goldenhour: 'goldenhour', golden: 'goldenhour',
  sunset: 'sunset', dusk: 'sunset', evening: 'sunset',
  night: 'night',
  rain: 'rain', rainy: 'rain', cloudy: 'rain', overcast: 'rain', storm: 'rain',
  // MASTHEAD-CLOUDY-NIGHT: the same weather after dark. Listed before nothing
  // else matters, but note the parser tries the LONGEST trailing token run
  // first, so "CloudyNight" resolves here rather than as bare "night".
  cloudynight: 'cloudynight', nightcloudy: 'cloudynight',
  rainynight: 'cloudynight', nightrain: 'cloudynight', overcastnight: 'cloudynight',
}

// ── MASTHEAD-CITY-CANON (Owner) ──────────────────────────────────────────────
//
// A CITY FOLDER IS NAMED FOR THE CITY, IN FULL, WITH NO ABBREVIATION:
//
//   public/masthead/LosAngeles/LosAngeles_Dawn.webp
//   public/masthead/SanFrancisco/SanFrancisco_GoldenHour.webp
//
//   folder   the city's common name, PascalCase, no spaces or punctuation
//   file     <Folder>_<Scene>.webp
//   scenes   Dawn · Morning · Day · GoldenHour · Sunset · Night · Rain
//
// The canonical key is that folder name lowercased: losangeles, lasvegas,
// newyork, sanfrancisco, atlanta. It is what CITY_COORDS, CITY_SKY_X and
// cityDisplayName are all keyed on, so there is ONE spelling of a city
// anywhere in the system.
//
// Los Angeles used to be the exception, keyed 'la' while every other city used
// its full name, which made it the one city whose folder and key disagreed.
// It does not any more.
//
// THE ABBREVIATIONS ARE RETIRED (Owner). NYC, SFO, Vegas, SF, DC and SLC no
// longer resolve, and neither does a folder named after them. That is not a
// silent failure: the pack guard in test/mastheadCityScenes.test.mjs asserts
// every image file maps to a city and a scene, so a mis-named folder fails the
// suite naming the exact files rather than quietly falling back to LA.
//
// This map now holds only the spellings of ONE name that should mean the same
// city - the same word with and without its spaces, which is what a location
// label like "New York" arrives as.
const CITY_ALIASES = {
  losangeles: 'losangeles',
  lasvegas: 'lasvegas',
  newyork: 'newyork', newyorkcity: 'newyork',
  sanfrancisco: 'sanfrancisco',
  saltlakecity: 'saltlakecity',
  washington: 'washington', washingtondc: 'washington',
  atlanta: 'atlanta',
  hollywood: 'hollywood',
}

// Coordinates for proximity matching ("wherever I am"): a viewer near one of
// these cities gets that city's pack when it exists. Extend freely when a new
// city pack is added; a pack whose key is absent here still works via exact
// label match.
export const CITY_COORDS = {
  losangeles: [34.05, -118.24],
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
  // Hollywood sits about 12km from downtown Los Angeles, so proximity gives a
  // viewer whichever they are actually nearer to. Both packs are installed and
  // both are pickable; this only decides the automatic match.
  hollywood: [34.10, -118.33],
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
 * { losangeles: { day: '/masthead/LosAngeles/LosAngeles_Day.webp', ... }, ... }
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

  if (packs.losangeles) return { city: 'losangeles', scenes: packs.losangeles }
  return null
}

/**
 * The pack to render: an explicit city choice wins, but only when that pack is
 * actually installed - a stale choice falls back to location matching rather
 * than dropping the viewer to the SVG scenery. Shared by the scenery layer and
 * the weather module so they can never disagree about which city is on screen.
 */
export function resolvePack(packs, preferredCity, location) {
  if (preferredCity && packs?.[preferredCity]) return { city: preferredCity, scenes: packs[preferredCity] }
  return choosePack(packs, location)
}

/**
 * Where each city's sky is CLEAR, as a left offset for the animated sun/moon.
 *
 * This is a property of the artwork, not of the layout: LA and Vegas put their
 * mountains and skyline center-right with open sky above the middle of the
 * card, while New York's harbor leaves the left-of-centre sky empty and its
 * towers (One WTC's spire especially) occupy exactly the middle. A single
 * global position cannot serve both - at 52% the moon sat on the spire.
 * Measured from each pack's night scene by column profile, then confirmed on
 * screen. A city with no entry uses the default.
 */
export const CITY_SKY_X = {
  newyork: '33%',
  // San Francisco puts downtown center-right (the moon sat on the Salesforce
  // and Transamerica towers at the default) and leaves the sky over the bay
  // and the bridge span open, between the greeting and the skyline.
  sanfrancisco: '30%',
  // Atlanta's towers run in one dense band from roughly 42% to 72% of the
  // frame, with the Bank of America spire near 68%, so the default 52% lands
  // the moon in the middle of them. The left third is low rooftops and trees
  // under open sky, which is where it goes.
  atlanta: '30%',
  // Hollywood looks east from Griffith: the right half is ridgeline rising to
  // the radio tower near 70%, and the left half is the open basin under a low
  // horizon. The moon goes over the basin.
  hollywood: '30%',
}
export const DEFAULT_SKY_X = '52%'

// ── Where the card's vertical crop comes from, per city ─────────────────────
//
// The card is 5.9:1 and the panoramas are 5:1, so cover crops a horizontal band
// and object-position decides which. 100% is bottom-anchored: the whole crop
// comes off the TOP, which keeps the ground and city footer whole and is right
// for a skyline whose towers sit well below the frame's top edge.
//
// ATLANTA DOES NOT (Owner). Its tallest spire begins at source row 42 of 400,
// and the card crops about 40px off the top at a 1304px width, so roughly 12px
// of tower was being sliced. Because both the crop and the tower scale with the
// card width, the ratio is viewport-independent: anything at or below 69% keeps
// the spire in frame, and 50% leaves a few pixels of sky above it. The cost is
// paid at the bottom, where Atlanta has open highway rather than a skyline.
export const CITY_IMG_Y = {
  atlanta: '50%',
  // MASTHEAD-HOLLYWOOD-2: the second pack's radio mast reaches source row 36,
  // and the default crop removes rows 0..60, so it lost its top 25px and all of
  // its aviation lights with them. Centring the crop keeps the mast whole and
  // spends the 30px on featureless brush at the bottom instead.
  hollywood: '50%',
}
export const DEFAULT_IMG_Y = '100%'

// MASTHEAD-MOTION-1 (PROTOTYPE): what moves in each city, and where.
//
// Coordinates are percentages of the CARD, not of the source image. The card
// crops the top 15.3% of the 5:1 panorama (a 5.9:1 box, bottom anchored), so
// these are already past that conversion and are only valid while the city
// keeps its --scn-img-y. Every position was MEASURED off the artwork by
// local-maximum search for bright pixels, never placed by eye: an invented
// coordinate lands the glow on empty hillside and reads as dust on the lens.
//
// A city names only the effects its own frame can carry. Los Angeles has no
// water and no bridge, so it has neither; San Francisco has both. Absent means
// absent, not defaulted, which is why this is a registry and not a formula.
//
//   lights    warm points already lit in the frame, breathing out of phase
//   beacons   tower crowns, a slow aviation pulse rather than a breath
//   aircraft  one light crossing the sky, then a long empty gap
//   water     reflections on a bay, stretching as well as brightening
//   bridge    a deck light string, plus traffic running both ways along it
//   beam      a single landmark shaft of light, for the one city that has one
//   birds     a small flock crossing clear sky, daytime scenes
//   haze      the basin's smog, drifting and breathing, daytime scenes
//   flare     lens artefacts thrown by a low sun, golden hour only
//   helicopter one aircraft low and slow with a strobe, sunset only
//   rainfall  streaks over the whole card, rain and cloudy night
//
// beaconTone: 'red' paints a city's beacons aviation red. Only where the
// artwork already does: Hollywood's mast lights are red in the frame.
export const CITY_MOTION = {
  hollywood: {
    // MASTHEAD-HOLLYWOOD-2 (2026-09-04): the second Hollywood pack replaced
    // the first, so EVERY coordinate here was re-measured. All eight frames
    // share one viewpoint, which is why one set of landmarks serves scenes
    // that carry that landmark. Measured through the 50% crop (see CITY_IMG_Y),
    // not the default: the old numbers would be about 30px out.
    //
    // Fewer lit points than the first pack, because this frame renders the
    // basin as a glow rather than as discrete windows; the ones here are the
    // hillside houses and the far basin edge, right of the greeting.
    lights: [
      [49.1, 88.8], [51.5, 59.6], [56.3, 62.2], [57.5, 90.0], [58.1, 78.5],
      [65.5, 31.9], [68.5, 30.4], [68.5, 71.4], [84.7, 56.9], [94.6, 54.6],
    ],
    // The Mt Lee mast. Its lights are painted red in the Night and CloudyNight
    // frames (rgb 163,103,103 at row 88), which is why this city alone carries
    // beaconTone. The tip sits at card y 0.1%; it is placed at 0.8% so the glow
    // is not half outside the card, the only non-measured value in this entry.
    beacons: [[71.4, 0.8], [71.3, 11.7], [71.2, 17.0]],
    beaconTone: 'red',
    // Sky is clear to card y 17% at the shallowest point (x 40-50%), so anything
    // flying at y <= 13% clears every ridge except the mast itself.
    aircraft: { y: 9, from: 98, to: 36, flight: 36 },
    birds: { y: 11, from: 99, to: 40, flight: 30, count: 6 },
    helicopter: { y: 13, from: 44, to: 96, flight: 42 },
    // The basin lies at card y 40-60%; the band sits on it and drifts.
    haze: { y: 49, height: 18 },
    // The golden-hour sun is OFF-FRAME LEFT: the left edge is brightest at card
    // y 33%. Ghosts lie on the line from there through the card's centre, so
    // they land on the hills at right, which is exactly where a photograph
    // would put them.
    flare: { x: -6, y: 33 },
    rainfall: true,
    // No traffic: the frame has no road that reads as a line of light. Griffith
    // Park's roads are unlit switchbacks in this artwork.
  },
  losangeles: {
    // The basin is a carpet of light, which is the best possible case for this.
    lights: [
      [55.5, 90.9], [67.9, 88.5], [76.4, 88.2], [49.1, 98.2], [61.9, 71.4],
      [46.9, 87.0], [61.9, 89.1], [81.0, 93.5], [58.7, 90.3], [52.3, 88.8],
      [71.2, 87.9], [67.3, 71.4], [57.5, 68.7], [51.4, 78.5],
    ],
    // Two crowns, because downtown LA really is dominated by two towers.
    beacons: [[62.5, 62.2], [64.4, 66.4]],
    // East to west over downtown, the way an approach actually runs. It leaves
    // the frame before the cycle repeats, so the loop has no seam to hide. The
    // cycle is flight / VISIBLE (MastheadMotion), so the sky is empty ~59% of
    // the time; there is deliberately no per-city cycle to disagree with that.
    aircraft: { y: 21, from: 97, to: 33, flight: 34 },
  },
  sanfrancisco: {
    lights: [
      [63.9, 44.8], [71.4, 46.0], [61.3, 37.8], [74.2, 46.6], [70.9, 36.3],
      [58.9, 37.2], [67.8, 35.7], [52.4, 34.2], [54.8, 35.4], [64.5, 37.8],
    ],
    // Reflections sit below the city and stretch vertically with the swell.
    water: [
      [60.8, 86.1], [64.3, 86.7], [67.8, 85.3], [72.5, 86.4], [75.5, 86.4],
      [78.5, 85.3], [82.0, 85.3], [88.0, 84.1], [93.1, 77.3],
    ],
    bridge: {
      // Measured along the deck, so the string carries the span's real sag.
      lights: [
        [22.0, 62.8], [24.8, 64.0], [28.4, 61.1], [31.3, 60.5], [34.2, 60.2],
        [37.9, 59.6], [41.3, 59.3], [44.8, 59.0], [47.3, 58.7], [50.7, 59.9],
        [55.3, 59.6], [59.0, 59.3], [69.3, 59.3], [73.5, 58.1], [78.3, 59.0],
        [81.5, 58.4],
      ],
      // The deck as a line: start point, span, and rise across it. Traffic
      // rides this rather than a flat row, or it drifts off the roadway by
      // several pixels at the ends.
      deck: { x: 22.0, y: 62.8, w: 59.5, rise: -4.4 },
    },
  },
  newyork: {
    lights: [
      [50.2, 74.6], [53.9, 77.0], [54.1, 64.9], [56.7, 74.3], [63.5, 74.3],
      [74.4, 74.3], [76.8, 64.0], [79.0, 74.3], [85.5, 74.3], [88.9, 74.0],
      [92.1, 74.6], [95.2, 74.9],
    ],
    // The harbour throws the strongest reflections of any pack.
    water: [
      [50.0, 84.4], [54.0, 90.6], [54.2, 81.4], [58.7, 87.0], [63.4, 82.6],
      [63.5, 95.3], [69.3, 91.7], [75.0, 82.6], [75.0, 99.1],
    ],
    // The first entry is the One World Trade spire tip, which the artwork
    // already paints red. Every other pack's crowns are white, so this is the
    // one city where an aviation-red beacon would be true to the frame.
    beacons: [[58.5, 13.6], [63.9, 41.9], [71.9, 43.7], [68.5, 51.9]],
  },
  lasvegas: {
    lights: [
      [46.2, 70.8], [48.7, 69.3], [51.3, 71.4], [56.0, 72.3], [59.8, 68.1],
      [62.4, 68.1], [65.3, 71.7], [67.8, 67.0], [75.1, 70.2], [79.5, 68.1],
      [84.3, 67.3], [87.9, 66.4], [91.3, 70.5], [93.8, 70.5],
    ],
    beacons: [[46.7, 49.9]],
    // The Luxor shaft, standing on the pyramid apex. The apex had to be found
    // by eye in the end: a brightest-pixel search kept landing on the hotel
    // beside it, which put the beam in mid-air next to the pyramid rather than
    // on it. No other city has a landmark that projects light, which is exactly
    // why this is not a shared effect: elsewhere it is a searchlight in an
    // empty sky.
    beam: { x: 64.6, y: 59.4, height: 52, width: 2.6 },
  },
  atlanta: {
    // Atlanta is the one city cropped at --scn-img-y 50%, so these were
    // converted through a centred crop, not the usual bottom-anchored one.
    lights: [
      [46.2, 54.0], [50.5, 56.6], [51.3, 65.2], [56.6, 44.3], [59.3, 59.0],
      [63.2, 41.6], [63.2, 67.6], [70.2, 58.7], [76.5, 55.8], [80.1, 56.0],
      [86.0, 56.3], [88.9, 63.7], [92.3, 64.9], [95.0, 65.5],
    ],
    beacons: [[50.8, 10.9], [68.4, 11.8]],
    // NO traffic, deliberately. The foreground is an interchange, not a span:
    // its light trails scatter rather than fitting a line, so the straight rail
    // that works for the Golden Gate would drive cars off the road. A curved
    // path needs a hand-traced offset-path per city, which is its own job.
  },
}

export function imgPositionFor(city) {
  return CITY_IMG_Y[city] || DEFAULT_IMG_Y
}

export function skyPositionFor(city) {
  return CITY_SKY_X[city] || DEFAULT_SKY_X
}

/** The build-injected file list, safe under Node tests (no global defined). */
export function injectedSceneFiles() {
  // eslint-disable-next-line no-undef
  return typeof __MASTHEAD_SCENE_FILES__ !== 'undefined' ? __MASTHEAD_SCENE_FILES__ : []
}
