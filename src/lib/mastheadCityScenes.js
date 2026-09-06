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
  rain: 'rain', rainy: 'rain', storm: 'rain',
  // MASTHEAD-CLOUDY-1: a dry overcast day is its own optional scene now.
  // "Cloudy" used to be a synonym of Rain; no shipped pack used the word.
  cloudy: 'cloudy', overcast: 'cloudy',
  // MASTHEAD-SNOW-1: a snowy day and night (the parser takes the longest
  // trailing token run first, so "SnowNight" resolves here, not as "night").
  snow: 'snow', snowy: 'snow', snowday: 'snow',
  snownight: 'snownight', nightsnow: 'snownight', snowynight: 'snownight',
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
//            (optional: CloudyNight, Cloudy, Snow, SnowNight)
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
  seattle: 'seattle',
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
  // MASTHEAD-NEWYORK-2: the second pack puts One WTC's needle at x 40.6%, and
  // at 33% the moon's disc touched it. The clearing is the sky over the
  // Jersey shore, left of Jersey City's towers (x 29-33, tops at card y 34%),
  // so the celestial art anchors there (Owner, 2026-09-05).
  newyork: '20%',
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
  // MASTHEAD-NEWYORK-2: One WTC's needle runs to source row 5 in the second
  // pack; the bottom-anchored crop would cut it at the antenna. Centred, the
  // needle exits the top edge as a skyline does in a photograph, and the
  // 30 rows spent at the bottom are Liberty Island's seawall.
  newyork: '50%',
  // MASTHEAD-LASVEGAS-2: the Strat's tip is at source row 68, seven rows
  // under the default crop's edge; centred it sits at card y 11% with sky
  // above it, and the 30 rows given up at the bottom are suburb.
  lasvegas: '50%',
  // MASTHEAD-SEATTLE-1: the Space Needle's tip is at source row 62 by day
  // and its beacon glows to row 44 at night; centred, the tip sits at card
  // y 9% with sky above it, and the 30 rows given up at the bottom are the
  // near shore's trees.
  seattle: '50%',
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
      // MASTHEAD-LOCKSCREEN-1: the left third, now that nothing fades it. The
      // observatory's windows and the basin edge under the greeting.
      [1.4, 56.0], [7.8, 96.2], [13.8, 54.3], [19.3, 53.7], [25.7, 59.6],
      [25.8, 78.8], [29.5, 72.3], [32.6, 79.9],
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
    //
    // MASTHEAD-SCENE-OVERRIDES (Owner, 2026-09-05): the CloudyNight frame is a
    // separate generation, not the Night frame under cloud. Its mast is a
    // different drawing, 22px further right and shorter (tip at source row 36
    // against 31), and the basin's discrete windows are gone under the haze:
    // of the eighteen Night lights, only the eight on the left ridge have a
    // warm pixel within 8px in this frame. So the two point kinds that run in
    // that scene get their own measured sets here, and the Night sets hide.
    sceneOverrides: {
      cloudynight: {
        lights: [
          [31.6, 81.1], [1.5, 57.8], [27.1, 59.6], [35.2, 88.2], [26.1, 80.8],
          [14.6, 56.0], [9.5, 55.5], [21.1, 59.0], [42.4, 51.0],
        ],
        // The mast's red lights, tip to base: source rows 36, 57, 73, 91.
        beacons: [[72.5, 1.5], [72.5, 7.7], [72.6, 12.4], [72.7, 17.7]],
      },
    },
  },
  losangeles: {
    // MASTHEAD-LOSANGELES-2 (2026-09-05): the second Los Angeles pack (nine
    // frames, Cloudy joined) replaced the first, so EVERY coordinate here was
    // re-measured (scratchpad nymeasure.mjs, gridzoom.py). One viewpoint on all
    // nine: the basin from the south-west, palms at both edges, downtown at
    // x 36-66 with the Wilshire Grand's spire at x 42.7, the San Gabriels
    // behind, the 110/101 interchange in front. Default crop (the spire stays
    // under the top edge). CloudyNight is the same drawing as Night.
    //
    // Night: downtown's windows and crowns, then the basin's carpet of light.
    lights: [
      [55.4, 34.8], [48.6, 46.6], [42.4, 45.4], [50.3, 32.5], [68.2, 60.5],
      [50.8, 44.0], [71.5, 67.3], [51.6, 59.0], [36.9, 55.5], [50.0, 67.8],
      [61.2, 63.7], [53.1, 67.3], [64.2, 67.8], [28.2, 68.1], [53.3, 47.8],
      [58.9, 70.2], [40.2, 55.2], [55.0, 53.7], [56.1, 64.9], [45.1, 51.6],
      [48.8, 57.8], [57.8, 46.0], [37.1, 69.0], [57.3, 57.8], [42.1, 55.8],
      [34.4, 62.8], [67.2, 68.7], [34.9, 71.1], [40.1, 68.4], [46.6, 61.7],
      // The basin, off the two freeway rails.
      [60.1, 95.6], [80.8, 95.6], [37.0, 81.7], [72.2, 96.5], [45.5, 89.1],
      [10.8, 82.9], [23.9, 68.1], [31.3, 86.1], [20.0, 88.8], [48.5, 94.1],
      [67.2, 78.5], [60.1, 74.6], [27.3, 90.9], [42.1, 95.6], [34.2, 99.1],
      [70.5, 75.5], [53.5, 84.1], [6.3, 79.1], [66.8, 87.9], [19.1, 69.3],
    ],
    // Aviation red on the crowns: the US Bank tower's (rgb 252,38,6 at card y
    // 35.7), the towers at x 58, 41.6 and 40, City Hall's neighbour, and the
    // Wilshire corridor's mid-rise crowns out to the west and east.
    beacons: [
      [54.4, 35.7], [58.3, 46.0], [41.6, 48.7], [40.0, 54.3], [59.9, 51.9],
      [68.7, 60.8], [29.9, 64.0], [34.2, 62.2], [26.4, 62.2], [84.1, 67.8],
      [88.8, 66.7], [18.2, 69.6], [4.5, 72.6],
    ],
    beaconTone: 'red',
    // Steam off three lit rooftops (first lit row of each column), the block
    // west of the towers and two mid-rises east of them, the ridge behind.
    steam: [[38.0, 55.2], [52.0, 50.2], [60.0, 51.9]],
    // The interchange. The first pack refused traffic on the curves; this
    // frame's elevated run in front of the basin (x 26-42) and the ramp that
    // drops off it (x 48.5-56.5) are straight enough, traced light by light
    // (+-1.5% band). A police car works the long run.
    bridge: [
      {
        lights: [[27.0, 90.6], [31.0, 90.6], [35.5, 90.6], [37.5, 89.7], [40.0, 88.2], [41.5, 89.4]],
        deck: { x: 26, y: 91.6, w: 16, rise: -2.4 },
        police: true,
      },
      {
        lights: [[49.0, 91.5], [50.5, 92.6], [52.0, 92.6], [55.0, 95.9]],
        deck: { x: 48.5, y: 90.5, w: 8, rise: 6 },
      },
    ],
    // East to west over downtown, the way the LAX approach actually runs;
    // the sky is clear above card y 25 between the palms (which reach the
    // top at both edges), so everything flies inside x 6-94.
    aircraft: { y: 21, from: 94, to: 33, flight: 34 },
    birds: { y: 30, from: 94, to: 60, flight: 30, count: 6 },
    // An LAPD helicopter low over the basin at sunset, west to east.
    helicopter: { y: 36, from: 8, to: 62, flight: 46 },
    // The basin's smog, between the mountains' base (card y 42-50) and the
    // mid-rise band; warm-grey, the default tone, which is what the basin is.
    haze: { y: 48, height: 16 },
    // The golden-hour sun is OFF-FRAME LEFT (left edge brightest at card y
    // 8%; sky column means peak at x 10 and fall to the right).
    flare: { x: -6, y: 8 },
    rainfall: true,
  },
  sanfrancisco: {
    // MASTHEAD-SANFRANCISCO-2 (2026-09-04): the second San Francisco pack
    // replaced the first, so EVERY coordinate here was re-measured off the new
    // frames (scratchpad sfmeasure.mjs, default crop: the tallest feature is
    // the Salesforce crown at source row 104, well under the 61 rows the
    // bottom-anchored crop removes). All eight frames share one viewpoint, the
    // Marin Headlands looking south-east over the Golden Gate to the city.
    //
    // Night: the downtown and Marina windows, the far East Bay shore under
    // the greeting, and the lit coast road on the Marin side at right.
    lights: [
      [97.8, 31.0], [86.9, 31.9], [70.3, 49.0], [49.5, 43.1], [44.6, 31.3],
      [59.7, 44.3], [64.9, 41.6], [40.5, 31.9], [76.3, 48.4], [91.0, 31.3],
      [55.8, 44.0], [86.9, 56.3], [52.0, 31.9], [57.3, 22.1], [45.9, 44.0],
      [82.5, 34.8],
      // The East Bay shore, left third.
      [27.9, 32.7], [13.7, 33.9], [35.8, 31.3], [1.8, 34.8], [20.1, 33.0],
      // The Marin coast road, right of the bridge's north pier.
      [78.6, 60.8], [74.5, 69.6], [94.9, 68.1], [90.7, 69.0], [99.6, 67.6],
    ],
    // The two tower crowns carry aviation lights, painted RED in the Night
    // frame (rgb 251,5,6 on the south tower, 248,55,48 on the north), so this
    // city joins Hollywood on the red tone. Nothing else on the bridge is a
    // beacon: the other red maxima are the International Orange paint.
    beacons: [[29.8, 34.2], [68.2, 33.6]],
    beaconTone: 'red',
    // Reflections: each tower's column of light in the strait beneath it, and
    // the city's soft wash on the bay between the bridge and the waterfront.
    water: [
      [29.9, 75.5], [26.7, 82.3], [30.0, 87.6],
      [67.8, 67.6], [67.8, 74.0], [67.5, 82.6], [68.3, 88.8], [63.9, 85.5],
      [68.3, 50.2], [72.3, 53.4], [64.5, 51.0], [53.9, 50.2], [58.1, 55.8], [40.5, 55.8],
    ],
    bridge: {
      // The deck string, measured light by light from the south approach to
      // the north pier.
      lights: [
        [21.1, 65.2], [23.2, 66.1], [25.5, 65.5], [31.3, 63.1], [33.5, 62.5],
        [35.4, 63.4], [38.3, 62.0], [40.5, 61.4], [43.5, 61.1], [47.0, 60.2],
        [51.3, 61.1], [53.8, 59.3], [58.0, 59.6], [60.5, 59.6], [62.5, 59.3],
        [66.3, 59.6], [70.0, 59.6], [73.7, 59.9], [76.4, 60.5],
      ],
      // The roadway is not quite one line here: it climbs from the south
      // approach to mid-span and runs level to the north pier (per-column
      // trace: 65.2 at x21, 62.8 at x39, 60.5 from x55 on). One rail fitted
      // through the whole run stays within 1.5% of the deck everywhere, about
      // three pixels on a wide card, under a 2px trail; the cost of a second
      // rail would be cars vanishing at the joint.
      deck: { x: 21.1, y: 64.6, w: 55.3, rise: -4.5 },
    },
    // Clear sky to card y 12% everywhere: the crown is the only thing above.
    aircraft: { y: 8, from: 2, to: 62, flight: 40 },
    // Gulls in the open sky above the East Bay hills (the hills begin at card
    // y 17%). Over the bay they vanished against the waterfront's buildings.
    birds: { y: 10, from: 98, to: 40, flight: 34, count: 5 },
    helicopter: { y: 44, from: 96, to: 42, flight: 46 },
    // The Golden Gate's fog: a band at deck height and below, so the towers
    // stand out of it. Tone 'fog' is white-blue, not the basin's warm smog.
    haze: { y: 60, height: 22 },
    hazeTone: 'fog',
    // The golden-hour sun is OFF-FRAME RIGHT here (sky brightest at the right
    // edge, card y 40%; sky column means rise from 155 at left to 193 at
    // right), the mirror of Hollywood. The flare layer flips for it and the
    // ghosts land on the strait and the headland at left.
    flare: { x: 106, y: 40 },
    rainfall: true,
    // A ferry on the Sausalito run, crossing the bay behind the bridge. Slow
    // and continuous rather than a rare crossing: it is what that water does.
    // Its lane is the strip of water between the waterfront (which reaches
    // card y 50% east of x 58%) and the deck (y 60%): nothing else is water
    // the whole way across.
    ferry: { y: 56, from: 46, to: 80, flight: 130 },
    // Sun glitter on the strait. Measured as the pale local maxima the
    // Morning, Golden Hour and Sunset frames share south-east of the north
    // pier, where the light path lies; the Day frame's water is flat and its
    // only pale maxima are the beach surf, so these twinkle in Day too but
    // over the same measured patch, not over invented water.
    glints: [
      [65.3, 70.5], [71.5, 66.1], [71.2, 74.0], [72.8, 73.5], [72.0, 83.5],
      [73.4, 83.2], [74.6, 85.0], [79.7, 84.7], [78.0, 88.5], [81.3, 90.0],
      [73.3, 93.2],
    ],
  },
  newyork: {
    // MASTHEAD-NEWYORK-2 (2026-09-05): the second New York pack replaced the
    // first, so EVERY coordinate here was re-measured off the new frames
    // (scratchpad nymeasure.mjs). All eight frames share one viewpoint: the
    // harbour from above Liberty Island, Lower Manhattan centre, Midtown
    // behind it, the two East River bridges at right. Measured through the
    // 50% crop (see CITY_IMG_Y): One WTC's needle runs to source row 5.
    //
    // Night: Lower Manhattan's windows, Midtown's crowns (the Empire State at
    // [61.1, 20.4]), Brooklyn and the far Queens skyline, the Jersey shore
    // under the greeting, Liberty's torch ([21.0, 50.2]) and the island's lamps.
    lights: [
      [47.5, 28.3], [38.4, 58.4], [55.0, 49.6], [29.2, 54.6], [53.6, 35.7],
      [61.1, 60.2], [42.7, 61.7], [34.1, 56.6], [57.4, 30.1], [33.8, 36.9],
      [45.1, 20.7], [44.1, 38.1], [61.3, 44.5], [37.1, 29.2], [28.2, 41.9],
      [58.3, 43.1], [35.7, 45.1], [40.6, 41.9], [53.3, 28.3], [61.1, 20.4],
      [50.2, 35.1], [53.8, 60.8],
      // Brooklyn and the far skyline, right of the bridges. Lamps within
      // 1.5% of either deck rail are left to the deck string.
      [73.8, 49.0], [91.3, 54.0], [63.5, 52.5], [64.6, 23.6], [79.1, 38.6],
      [64.3, 43.1], [93.2, 36.9], [70.3, 52.5], [99.1, 58.4], [67.3, 41.9],
      [88.1, 38.1], [72.2, 38.9],
      // The Jersey shore, left third.
      [7.4, 51.0], [18.8, 42.5], [11.9, 49.0], [22.4, 41.9], [4.9, 42.2],
      [0.5, 53.1], [15.4, 47.8], [26.8, 41.3], [14.3, 30.4], [4.2, 51.9],
      // Liberty's torch, and the island's path lamps along the bottom edge.
      [21.0, 50.2], [10.3, 95.9], [29.3, 97.1], [19.1, 94.7], [33.4, 95.6],
    ],
    // Aviation red is painted on most of this frame's crowns (rgb 252,27,17 on
    // the Jersey City tower, 236,45,3 and 248,58,29 on the two crowns beside
    // One WTC, 238,0,14 on the near bridge tower), so the city takes the red
    // tone. First is One WTC's antenna light, the only part of the needle the
    // crop keeps (the crown itself is white in the frame, 237,232,205).
    beacons: [
      [40.6, 2.1], [44.1, 21.8], [47.6, 23.6], [52.8, 33.0], [29.5, 36.3],
      [32.6, 34.2], [8.8, 28.0], [81.3, 31.6], [73.9, 39.2], [83.5, 44.0],
    ],
    beaconTone: 'red',
    // The harbour throws the strongest reflections of any pack: the waterfront
    // columns under Lower Manhattan (two tiers), the East River under the far
    // span, the near tower's column, the Brooklyn promenade, the Jersey shore.
    water: [
      [50.0, 64.6], [59.6, 63.1], [56.3, 64.0], [43.0, 64.0], [53.4, 63.1],
      [36.5, 67.6], [46.5, 64.6],
      [43.6, 68.4], [58.1, 68.7], [43.6, 79.7], [48.6, 81.7], [48.6, 68.1],
      [57.8, 79.1], [61.4, 77.6],
      [71.5, 66.1], [73.8, 67.0], [64.5, 71.1],
      [87.9, 76.1], [83.3, 87.6],
      [89.2, 76.7], [99.4, 76.7], [92.2, 77.9], [96.5, 82.0],
      [12.0, 63.4], [3.0, 65.2], [14.8, 63.1], [33.1, 55.8],
    ],
    // Two spans. The far one (Brooklyn Bridge, tower at x 67) runs from the
    // Manhattan approach to where it passes behind the near span; the near
    // one (Manhattan Bridge, tower at x 83.5) descends to the Brooklyn shore.
    // Each rail is one line fitted through a per-column trace of the lit
    // roadway (band +-1.3%); the near deck is a shallow curve, steeper to the
    // tower and flatter after, and one rail sits within 1.1% of it everywhere.
    bridge: [
      {
        lights: [[58.5, 53.7], [61.5, 52.5], [63.5, 52.8], [65.0, 53.4], [70.0, 54.6], [72.0, 56.0]],
        deck: { x: 58.5, y: 52.2, w: 13.5, rise: 3.2 },
      },
      {
        lights: [
          [74.0, 56.0], [77.5, 59.0], [80.0, 60.5], [81.5, 61.1], [83.0, 61.4],
          [84.5, 62.0], [86.0, 62.5], [89.0, 64.0], [93.5, 65.5],
        ],
        deck: { x: 74, y: 57.2, w: 22, rise: 8.4 },
      },
    ],
    // Sky is clear to card y 15% right of the needle (the Empire State reaches
    // 17% at x 61). The approach comes in from the east over Brooklyn.
    aircraft: { y: 4, from: 98, to: 44, flight: 40 },
    birds: { y: 8, from: 98, to: 44, flight: 34, count: 6 },
    // A tour helicopter, low over Midtown and out over the East River.
    helicopter: { y: 12, from: 46, to: 98, flight: 46 },
    // Smog lies on the far skylines (Jersey at y 30-42, Queens at 33-40 and
    // Midtown's base) while Lower Manhattan's towers rise through it.
    haze: { y: 27, height: 16 },
    // The golden-hour sun is OFF-FRAME LEFT (left edge brightest at card y 18%;
    // sky column means fall from 223 at left to 203 at right), like Hollywood.
    flare: { x: -6, y: 18 },
    rainfall: true,
    // The Staten Island Ferry, orange, out of the Battery and south-west across
    // the harbour. Its lane, y 73, is water the whole way: under the Brooklyn
    // shore (which reaches y 70.7 at x 90, hence the start at 84), clear of
    // Lower Manhattan (waterfront y 60-62) and stopping short of Liberty's
    // pedestal at x 20-22.5.
    ferry: { y: 73, from: 84, to: 26, flight: 150 },
    ferryTone: 'orange',
    // Steam, the thing every New York rooftop does. Three measured roof edges
    // (Day frame, first row where the column leaves the sky) with open sky
    // above them: a low-rise west of the WTC cluster and two mid towers.
    steam: [[34.0, 35.7], [52.0, 33.9], [58.0, 31.6]],
    // Sun glitter, measured as pale maxima INSIDE the water (the brightest
    // pale points of the day frames are the promenade edges, not the water):
    // the harbour below the waterfront, the East River mouth, the near shore.
    glints: [
      [33.9, 67.0], [40.9, 68.4], [40.2, 76.7], [46.0, 75.5], [57.2, 72.6],
      [61.1, 77.9], [63.4, 72.6], [68.2, 72.0], [71.2, 74.9], [80.0, 91.5],
      [85.0, 87.3], [96.3, 80.2],
    ],
    // MASTHEAD-SNOW-1: snow falls on the Snow and SnowNight frames, and the
    // harbour carries a light chop on the calm day scenes: the patch below
    // Lower Manhattan and the East River mouth (x 36-82, y 62-99), clear of
    // Liberty Island (x 8-35 below y 79) and the Brooklyn shore (x 76+ above
    // y 75, the mask's fade covers the corner).
    snowfall: true,
    swell: { x: 36, y: 62, w: 46, height: 37 },
    // MASTHEAD-SCENE-SHIFT: the CloudyNight frame is the Night drawing moved
    // DOWN 2.2% of the card (46 Night lights find their warm pixel 7-8px
    // lower, the four red crowns 2.0-2.3% lower, x unchanged). One measured
    // shift on the anchored group, rather than a second copy of every set.
    // SnowNight is the same drawing moved down 1.5% (crowns at 44.1 and
    // 83.5 sit 1.5-1.7% lower; the waterfront lamps within 1%).
    sceneShift: { cloudynight: 2.2, snownight: 1.5 },
  },
  lasvegas: {
    // MASTHEAD-LASVEGAS-2 (2026-09-05): the second Las Vegas pack replaced
    // the first, so EVERY coordinate here was re-measured (scratchpad
    // nymeasure.mjs, lvbbox.mjs). One viewpoint on all eight frames: the
    // valley from the south-east, the Strat at far left, the High Roller and
    // the Sphere left of centre, Paris's tower right of it, the Luxor pyramid
    // at right, mountains behind, the suburbs' arterial roads in front.
    // Measured through the 50% crop (see CITY_IMG_Y): the Strat's tip is at
    // source row 68. CloudyNight is the same drawing (landmarks and crowns
    // within 3px), so it needs no shift and no override.
    //
    // Night: the Strip's facades and crowns, then the suburb's lamps.
    lights: [
      [65.5, 63.4], [65.3, 52.8], [80.5, 45.7], [70.8, 54.3], [65.6, 73.5],
      [58.7, 54.9], [20.6, 47.8], [92.7, 59.6], [94.6, 71.4], [28.2, 46.6],
      [10.6, 73.2], [95.9, 51.3], [24.2, 57.2], [26.6, 62.5], [21.3, 72.9],
      [22.2, 62.5], [93.0, 49.3], [92.4, 71.1], [15.4, 67.3], [31.4, 47.8],
      [26.5, 69.6], [59.4, 73.8], [2.3, 64.0], [97.5, 69.6], [23.6, 68.7],
      [34.7, 67.0], [14.0, 73.5], [30.0, 65.8], [67.7, 62.0], [26.6, 56.3],
      [26.2, 50.4], [17.0, 73.2], [52.5, 62.0], [30.1, 72.9], [84.1, 52.8],
      // The suburb's lamps, off the two road rails.
      [21.8, 94.4], [33.0, 98.8], [69.3, 83.8], [55.8, 76.7], [41.6, 97.4],
      [91.0, 99.1], [95.1, 83.5], [50.3, 94.4], [91.0, 77.9],
    ],
    // The Strat's tip (rgb 232,100,58 at card y 11) and its pod's red band
    // (244,34,61), the crown at x 28 (250,67,2), Paris's tip, the red crown
    // at 81.2 (248,19,14) and the three tower crowns beside it.
    beacons: [
      [7.7, 11.0], [7.7, 16.8], [28.0, 47.8], [65.5, 42.2], [81.2, 44.8],
      [77.6, 43.1], [75.9, 44.5], [72.1, 44.0],
    ],
    beaconTone: 'red',
    // Neon: the saturated magenta and cyan maxima of the Strip's signage
    // (the third element picks the cyan glow; magenta is the default). The
    // wheel's rim and the Sphere's skin are left to their own kinds.
    neon: [
      [11.9, 59.6], [41.1, 58.1], [40.9, 66.4], [37.5, 69.0], [48.6, 74.9],
      [64.0, 58.4], [62.9, 68.4], [73.6, 45.7], [78.1, 48.7], [80.3, 59.3],
      [1.2, 67.3],
      [86.9, 71.7, 'cyan'], [87.5, 64.0, 'cyan'], [72.2, 45.7, 'cyan'],
      [91.5, 76.1, 'cyan'], [36.9, 58.7, 'cyan'], [73.6, 62.0, 'cyan'],
      [54.2, 53.4, 'cyan'],
    ],
    // The High Roller: a ring 97 source px across (bounding box of its lit
    // rim, card y 44.3-72.9), centred at x 39.0. Diameter as a share of the
    // card WIDTH, since the ring is square in pixels and the card is not.
    wheel: { x: 39.0, y: 58.6, d: 4.85 },
    // The Sphere: 123 px across, top at card y 54.3, its lower half behind
    // the Strip (the skyline cuts it at y 73.8, 54% of the way down).
    orb: { x: 47.2, y: 72.4, d: 6.15, cut: 54 },
    // The Luxor shaft, standing on the pyramid's apex: the brightest column
    // at x 88 peaks white (254,255,253) at card y 57-58 and the frame already
    // paints a faint beam above it.
    beam: { x: 87.95, y: 57.5, height: 47, width: 2.4 },
    // Two arterial roads across the suburb in front, traced light by light
    // (+-1.3% band): both run level across the whole frame.
    bridge: [
      {
        lights: [
          [3.5, 81.1], [7.0, 80.8], [10.0, 80.8], [13.0, 79.7], [16.5, 79.9],
          [20.0, 80.5], [25.5, 81.4], [29.0, 80.5], [35.0, 79.1], [39.0, 79.1],
          [43.5, 79.4], [46.5, 79.1], [53.5, 79.4], [56.5, 79.9], [60.5, 79.1],
          [64.5, 79.9], [69.0, 79.4], [73.0, 79.1], [77.5, 79.9], [81.5, 78.8],
          [86.0, 79.1], [89.5, 79.4], [92.0, 79.7], [97.0, 78.8],
        ],
        deck: { x: 1, y: 79.7, w: 98, rise: 0 },
      },
      {
        lights: [
          [2.5, 91.5], [8.0, 89.1], [12.0, 89.4], [16.5, 90.6], [21.0, 89.4],
          [26.0, 89.1], [31.5, 89.7], [37.0, 90.9], [40.5, 90.6], [44.0, 90.6],
          [50.0, 90.6], [53.5, 89.7], [58.0, 89.4], [61.5, 90.9], [65.5, 89.4],
          [70.0, 90.0], [73.5, 89.1], [79.5, 91.7], [84.5, 90.0], [88.5, 90.0],
          [93.5, 91.2], [97.0, 90.0],
        ],
        deck: { x: 1, y: 90.3, w: 98, rise: 0 },
      },
    ],
    // The ridge tops out at card y 30%; the Strat reaches 11% at x 7.7, so
    // the crossings keep to the east of it.
    aircraft: { y: 16, from: 98, to: 44, flight: 40 },
    birds: { y: 22, from: 98, to: 44, flight: 34, count: 6 },
    helicopter: { y: 24, from: 44, to: 98, flight: 46 },
    // Morning haze on the valley floor behind the Strip (the far lights band
    // at y 45-58), white rather than the basin's smog; the towers stand out.
    haze: { y: 44, height: 14 },
    hazeTone: 'fog',
    // The golden-hour sun is OFF-FRAME LEFT (left edge brightest at card y
    // 15%; sky column means fall from 225 at left to 207 at right).
    flare: { x: -6, y: 15 },
    rainfall: true,
  },
  seattle: {
    // MASTHEAD-SEATTLE-1 (2026-09-05): a new city, eleven frames (Cloudy,
    // Snow and SnowNight included). One viewpoint on all eleven, the Kerry
    // Park view: the Space Needle at x 20.1, downtown to x 50, the stadiums
    // and the port along the waterfront, Elliott Bay below, Rainier at x 76.
    // Every coordinate measured (scratchpad nymeasure.mjs, gridzoom.py)
    // through the 50% crop (see CITY_IMG_Y). The three night frames are one
    // drawing (forty lights and the Needle's tip within scatter), so the
    // snowy and clouded nights need neither a shift nor an override.
    //
    // Night: downtown's windows, then the waterfront, the stadiums, the port
    // and the far shore.
    lights: [
      [24.8, 46.9], [34.3, 47.5], [11.3, 67.3], [17.0, 65.5], [21.2, 62.5],
      [28.3, 45.7], [43.6, 66.1], [11.6, 60.5], [38.8, 55.5], [39.2, 72.0],
      [9.0, 62.5], [45.0, 52.8], [22.7, 34.2], [31.8, 47.5], [14.0, 36.6],
      [41.5, 66.4], [15.2, 49.0], [22.4, 53.4], [8.6, 54.0], [25.0, 72.0],
      [44.9, 44.8], [34.6, 41.3], [25.4, 64.6], [29.4, 39.5], [16.5, 73.2],
      [37.5, 33.3], [1.6, 56.9], [43.7, 72.6], [24.4, 57.8], [26.8, 53.1],
      [11.4, 73.5], [17.2, 54.3], [33.1, 59.3], [27.6, 71.1], [4.3, 63.4],
      [32.1, 70.2], [38.3, 62.0], [12.0, 42.2], [1.0, 67.6],
      // The waterfront, the port and the far shore.
      [70.7, 71.7], [56.4, 61.1], [76.5, 71.1], [74.2, 74.3], [68.4, 71.4],
      [78.3, 60.5], [63.8, 74.3], [58.7, 74.0], [73.9, 62.5], [61.7, 59.6],
      [79.3, 72.9], [55.3, 70.5], [65.5, 63.4], [61.6, 71.7], [94.7, 64.6],
      [83.8, 65.2], [67.8, 61.4], [86.3, 75.2], [58.9, 58.4], [81.5, 63.1],
    ],
    // The Needle's aviation light (rgb 221,31,7 on the snowy night, warm
    // white on the clear one) at the very tip, the Columbia Center's crown,
    // the Municipal Tower's, and the red crowns at x 12.6, 15.2 and 29.9.
    beacons: [[20.1, 4.0], [33.1, 20.7], [37.8, 28.6], [12.6, 43.1], [15.2, 34.8], [29.9, 39.8]],
    beaconTone: 'red',
    // The bay throws the city back: reflections under the waterfront, the
    // port and the far shore, and in the marina below the near shore.
    water: [
      [52.9, 87.0], [65.8, 79.9], [62.5, 82.0], [39.1, 94.7], [69.1, 79.7],
      [41.6, 93.8], [73.6, 77.3], [80.3, 77.9], [36.4, 95.3], [39.0, 85.0],
      [51.4, 79.7], [48.0, 80.2], [58.7, 85.8], [94.7, 81.4], [87.9, 78.5],
      [44.3, 86.1], [98.2, 82.0], [58.7, 74.0], [39.4, 77.6], [36.5, 74.6],
    ],
    // Alaskan Way along the piers: one level lit line from the aquarium to
    // the stadiums, traced light by light (+-1.3%), with a police car.
    bridge: [
      {
        lights: [[44.5, 72.6], [46.5, 72.0], [48.0, 72.0], [49.5, 73.2], [52.0, 74.3], [53.5, 72.6], [55.5, 74.0], [60.0, 74.0], [62.0, 73.2], [63.5, 73.8]],
        deck: { x: 44, y: 73.0, w: 20, rise: 0.5 },
        police: true,
      },
    ],
    // Sky is clear above card y 10 east of the Needle (Rainier's summit is at
    // 18, x 76; the Columbia Center reaches 21 at x 33), so the approach into
    // Sea-Tac runs east to west and stops short of the Needle's mast.
    aircraft: { y: 7, from: 98, to: 30, flight: 40 },
    birds: { y: 12, from: 96, to: 40, flight: 34, count: 6 },
    // A floatplane's height and a helicopter's rhythm, low over the bay at
    // sunset, out past the stadiums.
    helicopter: { y: 24, from: 40, to: 96, flight: 46 },
    // Marine fog lying on the bay: from the piers (y 72-75) out over the
    // water, white, with downtown and the Needle standing clear above it. A
    // first pass at y 60 laid it across the lower skyline and read as a bar.
    haze: { y: 66, height: 15 },
    hazeTone: 'fog',
    // Steam off three downtown rooftops with sky above them (first lit row of
    // the column on the Night frame).
    steam: [[26.0, 41.6], [36.0, 39.8], [46.0, 42.2]],
    // The golden-hour sun is OFF-FRAME RIGHT (right edge brightest at card y
    // 32; sky column means rise from 198 at left to 215 at right).
    flare: { x: 106, y: 32 },
    rainfall: true,
    snowfall: true,
    // A Washington State ferry, white, on the Bainbridge run: in from the
    // Sound at right and across the bay to the terminal. Lane y 88 is water
    // from x 98 to the marina at 46 (the near shore's trees begin at 45).
    ferry: { y: 88, from: 98, to: 46, flight: 150 },
    ferryTone: 'white',
    // Sun glitter, measured as the pale maxima of the Day and Golden Hour
    // frames INSIDE the bay: the marina below the near shore, the water off
    // the piers and the port, and the reach toward the far shore.
    glints: [
      [48.7, 84.1], [36.8, 82.9], [66.5, 79.9], [90.0, 77.0], [41.3, 92.0],
      [95.5, 80.8], [38.6, 90.6], [57.6, 80.5], [84.4, 78.8], [70.2, 76.1],
      [52.8, 79.4], [73.7, 79.4],
    ],
    // The bay's chop, from the marina to the far shore (the piers end at y
    // 75, the far shore at 72, the near shore's trees hold x < 45 below 78).
    swell: { x: 46, y: 76, w: 52, height: 23 },
  },
  atlanta: {
    // MASTHEAD-ATLANTA-2 (2026-09-05): the second Atlanta pack replaced the
    // first, so EVERY coordinate here was re-measured (scratchpad
    // nymeasure.mjs, gridzoom.py). One viewpoint on all eight frames: the
    // skyline from the west, the stadium at left, Bank of America Plaza's
    // spire at x 42.3, the Connector's interchange in front. Measured
    // through the 50% crop (the spire's tip is at source row 63). CloudyNight
    // is the same drawing as Night (lights and crowns within 3px).
    //
    // Night: Midtown and Downtown's windows, then the suburb's lamps.
    lights: [
      [36.2, 52.2], [48.2, 66.4], [40.4, 59.3], [42.1, 39.5], [32.2, 63.7],
      [28.6, 69.3], [36.5, 60.8], [46.9, 41.6], [53.5, 41.6], [62.4, 67.8],
      [43.6, 56.6], [42.4, 28.3], [53.1, 48.7], [37.4, 44.5], [25.4, 67.8],
      [17.8, 65.5], [94.1, 66.7], [11.3, 67.3], [80.8, 54.0], [47.0, 55.8],
      [52.6, 55.8], [45.6, 65.2], [52.8, 66.4], [49.4, 55.8], [55.9, 51.3],
      [96.9, 50.7], [42.0, 69.3], [67.0, 67.3], [64.7, 63.4], [55.8, 67.8],
      [36.5, 68.4], [15.2, 65.8], [91.0, 53.1], [29.9, 49.6], [0.9, 66.7],
      // The suburb in front, off the two freeway rails.
      [44.6, 74.9], [69.7, 94.1], [9.6, 90.6], [29.9, 78.2], [58.3, 71.1],
      [37.5, 77.0], [82.8, 79.1], [75.6, 97.9], [54.5, 98.8], [14.3, 73.5],
      [66.8, 71.4], [46.0, 86.7], [54.3, 81.7],
    ],
    // Aviation red is painted on the crowns here: the spire's tip (rgb
    // 244,4,9 at card y 10) and its lattice, 191 Peachtree's tip, Truist
    // Plaza, and the tower tops east and west of them (252,1,14 at x 70).
    beacons: [
      [42.4, 10.0], [42.4, 20.1], [53.0, 32.2], [47.2, 36.3], [50.0, 50.4],
      [65.0, 46.3], [69.9, 52.8], [78.3, 57.8], [32.3, 51.9], [58.4, 52.8],
      [39.6, 54.9],
    ],
    beaconTone: 'red',
    // The stadium's LED halo and two cyan signs, flickering.
    neon: [
      [24.9, 70.2, 'cyan'], [21.1, 71.1, 'cyan'], [18.6, 70.5, 'cyan'],
      [75.1, 76.1, 'cyan'], [86.3, 97.4, 'cyan'],
    ],
    // Steam off three rooftops with sky above them (Day frame roof edges).
    steam: [[30.0, 49.6], [58.0, 52.8], [62.0, 54.3]],
    // The Connector. The first pack had no traffic because the interchange
    // is a curve; this frame's run under the stadium is straight enough for
    // two rails, the gentle stretch from x 22 to 37 and the steeper ramp
    // from 36 that leaves the card's bottom edge, traced light by light
    // (+-1.5% band; every lamp within 1.8% of its rail). A police car runs
    // the long one.
    bridge: [
      {
        lights: [[25.0, 82.6], [26.5, 83.5], [28.5, 85.8], [30.0, 84.7], [31.5, 87.6], [35.0, 87.3]],
        deck: { x: 22, y: 83.2, w: 15, rise: 6.0 },
        police: true,
      },
      {
        lights: [[37.5, 92.6], [39.0, 92.6], [40.5, 94.7], [42.5, 98.5]],
        deck: { x: 36, y: 88.8, w: 7.5, rise: 10.4 },
      },
    ],
    // Sky is clear above card y 30 east of the spire (191 Peachtree reaches
    // 32 at x 53); the far hills lie at 37-42.
    aircraft: { y: 14, from: 98, to: 48, flight: 40 },
    birds: { y: 24, from: 98, to: 58, flight: 30, count: 6 },
    helicopter: { y: 20, from: 56, to: 98, flight: 46 },
    // Morning mist on the far hills and the suburbs behind the skyline.
    haze: { y: 36, height: 14 },
    hazeTone: 'fog',
    // The golden-hour sky is brightest at the top-RIGHT corner (219 against
    // 212 at left; Sunset and Dawn are lit from the right too), so the sun is
    // off-frame right and high.
    flare: { x: 106, y: 8 },
    rainfall: true,
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
