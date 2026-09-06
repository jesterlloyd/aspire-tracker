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
  cloudynight: 'cloudynight', nightcloudy: 'cloudynight', overcastnight: 'cloudynight',
  // MASTHEAD-RAINNIGHT-1: rain after dark is its own scene as of Rome. The
  // "rainy night" spellings move here from cloudynight, where they only ever
  // pointed because there was no frame for this - no shipped pack used them,
  // so nothing re-resolves. Note the parser takes the LONGEST trailing token
  // run first, which is what stops "RainNight" reading as plain "night" and
  // leaving a phantom city called RomeRain.
  rainnight: 'rainnight', nightrain: 'rainnight', rainynight: 'rainnight',
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
  hongkong: 'hongkong',
  honolulu: 'honolulu',
  // The folder is Rio, the city is Rio de Janeiro, and a browser's location
  // label says the long form. Both spellings have to reach the same pack.
  rio: 'rio', riodejaneiro: 'rio',
  tokyo: 'tokyo',
  london: 'london',
  rome: 'rome',
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
  rome: [41.90, 12.50],
  hongkong: [22.30, 114.17],
  paris: [48.86, 2.35],
  tokyo: [35.68, 139.69],
  honolulu: [21.31, -157.86],
  rio: [-22.91, -43.17],
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
  // Hong Kong's hills reach the top edge from x 26 to 60 and again east of
  // 66; the one clear sky is over the western harbour, so the moon sits just
  // right of the greeting, above the distant islands.
  hongkong: '24%',
}
export const DEFAULT_SKY_X = '52%'

// ── The card shows the WHOLE frame ──────────────────────────────────────────
//
// MASTHEAD-FULL-FRAME-1 (Owner, 2026-09-06). The card was 5.9:1 and every
// panorama is 5:1, so cover cropped 61 of each frame's 400 rows - 15% of the
// artwork, on every city, in every scene. Which 15% was a per-city decision
// (CITY_IMG_Y: bottom-anchored by default, centred for a spire, top-anchored
// once a landmark reached the frame's top edge), and it cost something every
// time: Rio, Tokyo, London, Rome and Hollywood 3 were all top-anchored to save
// a cross, a mast or a needle, and each paid for it with the foreground.
//
// The card is 5:1 now. Nothing is cropped, the crop map is gone, and a new pack
// needs no crop decision at all - which is also why this constant exists rather
// than 5 appearing in four files: the motion layer converts a vertical
// percentage into an on-screen angle through it, and a card that changed shape
// without that changing with it would tilt every deck, cable and wave crest.
export const CARD_ASPECT = 5

// MASTHEAD-MOTION-1 (PROTOTYPE): what moves in each city, and where.
//
// Coordinates are percentages of the CARD, which since MASTHEAD-FULL-FRAME-1 is
// the whole 5:1 frame - so a card percentage and a source percentage are now the
// same thing, and a new pack's points can be read straight off the artwork with
// no crop conversion in between. Every position was MEASURED off the artwork by
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
    // MASTHEAD-HOLLYWOOD-3 (2026-09-06): the THIRD Hollywood pack, and every
    // coordinate here is new - the viewpoint, the crop and the architecture all
    // changed, so nothing from the second pack survives. Ten frames now, with
    // Cloudy and RainNight that the second pack lacked. Measured through the
    // TOP-anchored crop (historic), which is itself a change from the
    // second pack's centred one.
    //
    // The view is Griffith Park looking east: the sign at x 17-21 on the ridge,
    // the transmission mast above it at x 23, dark chaparral hills across the
    // whole left half, Griffith Observatory at x 60-72, and downtown Los
    // Angeles small and hazy at x 75-92 with the basin spread below it.
    //
    // THE LEFT HALF IS GENUINELY DARK. The hills are unlit parkland, so the
    // only lit things out there are the sign's letters and the mast - which is
    // the honest answer, and a change from the second pack, whose art put a
    // basin glow behind the ridge.
    lights: [
      // The sign, letter by letter. Pale rather than warm (rgb 164,171,210):
      // it is floodlit white, not sodium, and the warm scorer does not see it.
      [17.3, 27.29], [18.3, 27.29], [18.9, 27.29], [19.8, 27.54], [20.6, 27.71],
      // The mast's own structure lights, below the beacon.
      [22.9, 20.25], [22.0, 22.29], [22.5, 22.29],
      // Griffith Observatory: the dome, the colonnade and the lawn lights.
      [61.1, 73.98], [65.4, 71.53], [66.9, 54.24], [70.6, 53.22], [69.9, 53.98],
      [66.0, 71.53],
      // Downtown and the basin behind it.
      [67.8, 78.98], [97.4, 61.27], [82.2, 56.78], [77.8, 62.97], [80.7, 57.46],
      [73.7, 57.46], [75.0, 69.24], [66.9, 78.73], [68.4, 53.22], [92.4, 68.73],
      [80.8, 61.27], [78.0, 57.46], [90.0, 57.03], [66.1, 72.97], [75.4, 56.78],
      [68.7, 78.22], [72.8, 56.78], [90.9, 48.98], [81.5, 57.29], [85.7, 59.24],
      // The near basin below the observatory.
      [65.5, 77.97], [61.1, 77.71], [62.0, 77.97], [63.9, 78.47], [64.5, 76.27],
      [62.9, 77.71], [56.4, 83.73], [63.8, 81.02],
    ],
    // ONE beacon, and it is the only red thing in the frame: the mast's
    // aviation light at the very top, core rgb(152,46,70) with a red halo
    // against the blue sky. Downtown's crowns probe warm white, not red, so
    // they stay in lights where they breathe.
    beacons: [[23.8, 1.78]],
    beaconTone: 'red',
    // Sky is clear above card y 34 east of the mast, which itself reaches y 2
    // at x 23 - so the lane stops at 30. The motion layer draws ABOVE the
    // artwork, and a plane at this height would cross the mast, not pass it.
    aircraft: { y: 11.86, from: 98, to: 30, flight: 40 },
    // The flock spreads 6.4% above its lane and 11.5% below, so y 24 puts it
    // between 17.6 and 35.5 and the ridge under the run never rises past 38.
    birds: { y: 20.34, from: 96, to: 34, flight: 34, count: 6 },
    helicopter: { y: 25.42, from: 34, to: 96, flight: 46 },
    // THE SMOG, which is the one thing this view is really about: the pale band
    // lying across the basin at card y 44-57, with downtown standing in it. The
    // default warm-grey tone, whose mask is strongest right of 56% - which here
    // is exactly the basin and not the hills.
    haze: { y: 37.29, height: 11.02 },
    // The golden-hour sun is OFF-FRAME RIGHT on this pack, which is a reversal
    // from the second one: the brightest edge pixel is at the RIGHT edge at
    // card y 2.4, and the sky column mean rises from 224 mid-frame to 229 at
    // x 90. The old art was lit from the left; this one is not.
    flare: { x: 106, y: 6.78 },
    rainfall: true,
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
      [55.4, 44.75], [48.6, 54.75], [42.4, 53.73], [50.3, 42.8], [68.2, 66.53],
      [50.8, 52.54], [71.5, 72.29], [51.6, 65.25], [36.9, 62.29], [50.0, 72.71],
      [61.2, 69.24], [53.1, 72.29], [64.2, 72.71], [28.2, 72.97], [53.3, 55.76],
      [58.9, 74.75], [40.2, 62.03], [55.0, 60.76], [56.1, 70.25], [45.1, 58.98],
      [48.8, 64.24], [57.8, 54.24], [37.1, 73.73], [57.3, 64.24], [42.1, 62.54],
      [34.4, 68.47], [67.2, 73.47], [34.9, 75.51], [40.1, 73.22], [46.6, 67.54],
      // The basin, off the two freeway rails.
      [60.1, 96.27], [80.8, 96.27], [37.0, 84.49], [72.2, 97.03], [45.5, 90.76],
      [10.8, 85.51], [23.9, 72.97], [31.3, 88.22], [20.0, 90.51], [48.5, 95.0],
      [67.2, 81.78], [60.1, 78.47], [27.3, 92.29], [42.1, 96.27], [34.2, 99.24],
      [70.5, 79.24], [53.5, 86.53], [6.3, 82.29], [66.8, 89.75], [19.1, 73.98],
    ],
    // Aviation red on the crowns: the US Bank tower's (rgb 252,38,6 at card y
    // 35.7), the towers at x 58, 41.6 and 40, City Hall's neighbour, and the
    // Wilshire corridor's mid-rise crowns out to the west and east.
    beacons: [
      [54.4, 45.51], [58.3, 54.24], [41.6, 56.53], [40.0, 61.27], [59.9, 59.24],
      [68.7, 66.78], [29.9, 69.49], [34.2, 67.97], [26.4, 67.97], [84.1, 72.71],
      [88.8, 71.78], [18.2, 74.24], [4.5, 76.78],
    ],
    beaconTone: 'red',
    // Steam off three lit rooftops (first lit row of each column), the block
    // west of the towers and two mid-rises east of them, the ridge behind.
    steam: [[38.0, 62.03], [52.0, 57.8], [60.0, 59.24]],
    // The interchange. The first pack refused traffic on the curves; this
    // frame's elevated run in front of the basin (x 26-42) and the ramp that
    // drops off it (x 48.5-56.5) are straight enough, traced light by light
    // (+-1.5% band). A police car works the long run.
    bridge: [
      {
        lights: [[27.0, 92.03], [31.0, 92.03], [35.5, 92.03], [37.5, 91.27], [40.0, 90.0], [41.5, 91.02]],
        deck: { x: 26, y: 92.88, w: 16, rise: -2.03 },
        police: true,
      },
      {
        lights: [[49.0, 92.8], [50.5, 93.73], [52.0, 93.73], [55.0, 96.53]],
        deck: { x: 48.5, y: 91.95, w: 8, rise: 5.08 },
      },
    ],
    // East to west over downtown, the way the LAX approach actually runs;
    // the sky is clear above card y 25 between the palms (which reach the
    // top at both edges), so everything flies inside x 6-94.
    aircraft: { y: 33.05, from: 94, to: 33, flight: 34 },
    birds: { y: 40.68, from: 94, to: 60, flight: 30, count: 6 },
    // An LAPD helicopter low over the basin at sunset, west to east.
    helicopter: { y: 45.76, from: 8, to: 62, flight: 46 },
    // The basin's smog, between the mountains' base (card y 42-50) and the
    // mid-rise band; warm-grey, the default tone, which is what the basin is.
    haze: { y: 55.93, height: 13.56 },
    // The golden-hour sun is OFF-FRAME LEFT (left edge brightest at card y
    // 8%; sky column means peak at x 10 and fall to the right).
    flare: { x: -6, y: 22.03 },
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
      [97.8, 41.53], [86.9, 42.29], [70.3, 56.78], [49.5, 51.78], [44.6, 41.78],
      [59.7, 52.8], [64.9, 50.51], [40.5, 42.29], [76.3, 56.27], [91.0, 41.78],
      [55.8, 52.54], [86.9, 62.97], [52.0, 42.29], [57.3, 33.98], [45.9, 52.54],
      [82.5, 44.75],
      // The East Bay shore, left third.
      [27.9, 42.97], [13.7, 43.98], [35.8, 41.78], [1.8, 44.75], [20.1, 43.22],
      // The Marin coast road, right of the bridge's north pier.
      [78.6, 66.78], [74.5, 74.24], [94.9, 72.97], [90.7, 73.73], [99.6, 72.54],
    ],
    // The two tower crowns carry aviation lights, painted RED in the Night
    // frame (rgb 251,5,6 on the south tower, 248,55,48 on the north), so this
    // city joins Hollywood on the red tone. Nothing else on the bridge is a
    // beacon: the other red maxima are the International Orange paint.
    beacons: [[29.8, 44.24], [68.2, 43.73]],
    beaconTone: 'red',
    // Reflections: each tower's column of light in the strait beneath it, and
    // the city's soft wash on the bay between the bridge and the waterfront.
    water: [
      [29.9, 79.24], [26.7, 85.0], [30.0, 89.49],
      [67.8, 72.54], [67.8, 77.97], [67.5, 85.25], [68.3, 90.51], [63.9, 87.71],
      [68.3, 57.8], [72.3, 60.51], [64.5, 58.47], [53.9, 57.8], [58.1, 62.54], [40.5, 62.54],
    ],
    bridge: {
      // The deck string, measured light by light from the south approach to
      // the north pier.
      lights: [
        [21.1, 70.51], [23.2, 71.27], [25.5, 70.76], [31.3, 68.73], [33.5, 68.22],
        [35.4, 68.98], [38.3, 67.8], [40.5, 67.29], [43.5, 67.03], [47.0, 66.27],
        [51.3, 67.03], [53.8, 65.51], [58.0, 65.76], [60.5, 65.76], [62.5, 65.51],
        [66.3, 65.76], [70.0, 65.76], [73.7, 66.02], [76.4, 66.53],
      ],
      // The roadway is not quite one line here: it climbs from the south
      // approach to mid-span and runs level to the north pier (per-column
      // trace: 65.2 at x21, 62.8 at x39, 60.5 from x55 on). One rail fitted
      // through the whole run stays within 1.5% of the deck everywhere, about
      // three pixels on a wide card, under a 2px trail; the cost of a second
      // rail would be cars vanishing at the joint.
      deck: { x: 21.1, y: 70.0, w: 55.3, rise: -3.81 },
    },
    // Clear sky to card y 12% everywhere: the crown is the only thing above.
    aircraft: { y: 22.03, from: 2, to: 62, flight: 40 },
    // Gulls in the open sky above the East Bay hills (the hills begin at card
    // y 17%). Over the bay they vanished against the waterfront's buildings.
    birds: { y: 23.73, from: 98, to: 40, flight: 34, count: 5 },
    helicopter: { y: 52.54, from: 96, to: 42, flight: 46 },
    // The Golden Gate's fog: a band at deck height and below, so the towers
    // stand out of it. Tone 'fog' is white-blue, not the basin's warm smog.
    haze: { y: 66.1, height: 18.64 },
    hazeTone: 'fog',
    // The golden-hour sun is OFF-FRAME RIGHT here (sky brightest at the right
    // edge, card y 40%; sky column means rise from 155 at left to 193 at
    // right), the mirror of Hollywood. The flare layer flips for it and the
    // ghosts land on the strait and the headland at left.
    flare: { x: 106, y: 49.15 },
    rainfall: true,
    // A ferry on the Sausalito run, crossing the bay behind the bridge. Slow
    // and continuous rather than a rare crossing: it is what that water does.
    // Its lane is the strip of water between the waterfront (which reaches
    // card y 50% east of x 58%) and the deck (y 60%): nothing else is water
    // the whole way across.
    ferry: { y: 62.71, from: 46, to: 80, flight: 130 },
    // Sun glitter on the strait. Measured as the pale local maxima the
    // Morning, Golden Hour and Sunset frames share south-east of the north
    // pier, where the light path lies; the Day frame's water is flat and its
    // only pale maxima are the beach surf, so these twinkle in Day too but
    // over the same measured patch, not over invented water.
    glints: [
      [65.3, 75.0], [71.5, 71.27], [71.2, 77.97], [72.8, 77.54], [72.0, 86.02],
      [73.4, 85.76], [74.6, 87.29], [79.7, 87.03], [78.0, 90.25], [81.3, 91.53],
      [73.3, 94.24],
    ],
  },
  newyork: {
    // MASTHEAD-NEWYORK-2 (2026-09-05): the second New York pack replaced the
    // first, so EVERY coordinate here was re-measured off the new frames
    // (scratchpad nymeasure.mjs). All eight frames share one viewpoint: the
    // harbour from above Liberty Island, Lower Manhattan centre, Midtown
    // behind it, the two East River bridges at right. Measured through the
    // 50% crop (historic): One WTC's needle runs to source row 5.
    //
    // Night: Lower Manhattan's windows, Midtown's crowns (the Empire State at
    // [61.1, 24.92]), Brooklyn and the far Queens skyline, the Jersey shore
    // under the greeting, Liberty's torch ([21.0, 50.17]) and the island's lamps.
    lights: [
      [47.5, 31.61], [38.4, 57.12], [55.0, 49.66], [29.2, 53.9], [53.6, 37.88],
      [61.1, 58.64], [42.7, 59.92], [34.1, 55.59], [57.4, 33.14], [33.8, 38.9],
      [45.1, 25.17], [44.1, 39.92], [61.3, 45.34], [37.1, 32.37], [28.2, 43.14],
      [58.3, 44.15], [35.7, 45.85], [40.6, 43.14], [53.3, 31.61], [61.1, 24.92],
      [50.2, 37.37], [53.8, 59.15],
      // Brooklyn and the far skyline, right of the bridges. Lamps within
      // 1.5% of either deck rail are left to the deck string.
      [73.8, 49.15], [91.3, 53.39], [63.5, 52.12], [64.6, 27.63], [79.1, 40.34],
      [64.3, 44.15], [93.2, 38.9], [70.3, 52.12], [99.1, 57.12], [67.3, 43.14],
      [88.1, 39.92], [72.2, 40.59],
      // The Jersey shore, left third.
      [7.4, 50.85], [18.8, 43.64], [11.9, 49.15], [22.4, 43.14], [4.9, 43.39],
      [0.5, 52.63], [15.4, 48.14], [26.8, 42.63], [14.3, 33.39], [4.2, 51.61],
      // Liberty's torch, and the island's path lamps along the bottom edge.
      [21.0, 50.17], [10.3, 88.9], [29.3, 89.92], [19.1, 87.88], [33.4, 88.64],
    ],
    // Aviation red is painted on most of this frame's crowns (rgb 252,27,17 on
    // the Jersey City tower, 236,45,3 and 248,58,29 on the two crowns beside
    // One WTC, 238,0,14 on the near bridge tower), so the city takes the red
    // tone. First is One WTC's antenna light, the only part of the needle the
    // crop keeps (the crown itself is white in the frame, 237,232,205).
    beacons: [
      [40.6, 9.41], [44.1, 26.1], [47.6, 27.63], [52.8, 35.59], [29.5, 38.39],
      [32.6, 36.61], [8.8, 31.36], [81.3, 34.41], [73.9, 40.85], [83.5, 44.92],
    ],
    beaconTone: 'red',
    // The harbour throws the strongest reflections of any pack: the waterfront
    // columns under Lower Manhattan (two tiers), the East River under the far
    // span, the near tower's column, the Brooklyn promenade, the Jersey shore.
    water: [
      [50.0, 62.37], [59.6, 61.1], [56.3, 61.86], [43.0, 61.86], [53.4, 61.1],
      [36.5, 64.92], [46.5, 62.37],
      [43.6, 65.59], [58.1, 65.85], [43.6, 75.17], [48.6, 76.86], [48.6, 65.34],
      [57.8, 74.66], [61.4, 73.39],
      [71.5, 63.64], [73.8, 64.41], [64.5, 67.88],
      [87.9, 72.12], [83.3, 81.86],
      [89.2, 72.63], [99.4, 72.63], [92.2, 73.64], [96.5, 77.12],
      [12.0, 61.36], [3.0, 62.88], [14.8, 61.1], [33.1, 54.92],
    ],
    // Two spans. The far one (Brooklyn Bridge, tower at x 67) runs from the
    // Manhattan approach to where it passes behind the near span; the near
    // one (Manhattan Bridge, tower at x 83.5) descends to the Brooklyn shore.
    // Each rail is one line fitted through a per-column trace of the lit
    // roadway (band +-1.3%); the near deck is a shallow curve, steeper to the
    // tower and flatter after, and one rail sits within 1.1% of it everywhere.
    bridge: [
      {
        lights: [[58.5, 53.14], [61.5, 52.12], [63.5, 52.37], [65.0, 52.88], [70.0, 53.9], [72.0, 55.08]],
        deck: { x: 58.5, y: 51.86, w: 13.5, rise: 2.71 },
      },
      {
        lights: [
          [74.0, 55.08], [77.5, 57.63], [80.0, 58.9], [81.5, 59.41], [83.0, 59.66],
          [84.5, 60.17], [86.0, 60.59], [89.0, 61.86], [93.5, 63.14],
        ],
        deck: { x: 74, y: 56.1, w: 22, rise: 7.12 },
      },
    ],
    // Sky is clear to card y 15% right of the needle (the Empire State reaches
    // 17% at x 61). The approach comes in from the east over Brooklyn.
    aircraft: { y: 11.02, from: 98, to: 44, flight: 40 },
    birds: { y: 14.41, from: 98, to: 44, flight: 34, count: 6 },
    // A tour helicopter, low over Midtown and out over the East River.
    helicopter: { y: 17.8, from: 46, to: 98, flight: 46 },
    // Smog lies on the far skylines (Jersey at y 30-42, Queens at 33-40 and
    // Midtown's base) while Lower Manhattan's towers rise through it.
    haze: { y: 30.51, height: 13.56 },
    // The golden-hour sun is OFF-FRAME LEFT (left edge brightest at card y 18%;
    // sky column means fall from 223 at left to 203 at right), like Hollywood.
    flare: { x: -6, y: 22.88 },
    rainfall: true,
    // The Staten Island Ferry, orange, out of the Battery and south-west across
    // the harbour. Its lane, y 73, is water the whole way: under the Brooklyn
    // shore (which reaches y 70.7 at x 90, hence the start at 84), clear of
    // Lower Manhattan (waterfront y 60-62) and stopping short of Liberty's
    // pedestal at x 20-22.5.
    ferry: { y: 69.49, from: 84, to: 26, flight: 150 },
    ferryTone: 'orange',
    // Steam, the thing every New York rooftop does. Three measured roof edges
    // (Day frame, first row where the column leaves the sky) with open sky
    // above them: a low-rise west of the WTC cluster and two mid towers.
    steam: [[34.0, 37.88], [52.0, 36.36], [58.0, 34.41]],
    // Sun glitter, measured as pale maxima INSIDE the water (the brightest
    // pale points of the day frames are the promenade edges, not the water):
    // the harbour below the waterfront, the East River mouth, the near shore.
    glints: [
      [33.9, 64.41], [40.9, 65.59], [40.2, 72.63], [46.0, 71.61], [57.2, 69.15],
      [61.1, 73.64], [63.4, 69.15], [68.2, 68.64], [71.2, 71.1], [80.0, 85.17],
      [85.0, 81.61], [96.3, 75.59],
    ],
    // MASTHEAD-SNOW-1: snow falls on the Snow and SnowNight frames, and the
    // harbour carries a light chop on the calm day scenes: the patch below
    // Lower Manhattan and the East River mouth (x 36-82, y 62-99), clear of
    // Liberty Island (x 8-35 below y 79) and the Brooklyn shore (x 76+ above
    // y 75, the mask's fade covers the corner).
    snowfall: true,
    swell: { x: 36, y: 60.17, w: 46, height: 31.36 },
    // MASTHEAD-SCENE-SHIFT: the CloudyNight frame is the Night drawing moved
    // DOWN 2.2% of the card (46 Night lights find their warm pixel 7-8px
    // lower, the four red crowns 2.0-2.3% lower, x unchanged). One measured
    // shift on the anchored group, rather than a second copy of every set.
    // SnowNight is the same drawing moved down 1.5% (crowns at 44.1 and
    // 83.5 sit 1.5-1.7% lower; the waterfront lamps within 1%).
    sceneShift: { cloudynight: 1.86, snownight: 1.27 },
  },
  lasvegas: {
    // MASTHEAD-LASVEGAS-2 (2026-09-05): the second Las Vegas pack replaced
    // the first, so EVERY coordinate here was re-measured (scratchpad
    // nymeasure.mjs, lvbbox.mjs). One viewpoint on all eight frames: the
    // valley from the south-east, the Strat at far left, the High Roller and
    // the Sphere left of centre, Paris's tower right of it, the Luxor pyramid
    // at right, mountains behind, the suburbs' arterial roads in front.
    // measured before MASTHEAD-FULL-FRAME-1 and converted to the full frame with it: the Strat's tip is at
    // source row 68. CloudyNight is the same drawing (landmarks and crowns
    // within 3px), so it needs no shift and no override.
    //
    // Night: the Strip's facades and crowns, then the suburb's lamps.
    lights: [
      [65.5, 61.36], [65.3, 52.37], [80.5, 46.36], [70.8, 53.64], [65.6, 69.92],
      [58.7, 54.15], [20.6, 48.14], [92.7, 58.14], [94.6, 68.14], [28.2, 47.12],
      [10.6, 69.66], [95.9, 51.1], [24.2, 56.1], [26.6, 60.59], [21.3, 69.41],
      [22.2, 60.59], [93.0, 49.41], [92.4, 67.88], [15.4, 64.66], [31.4, 48.14],
      [26.5, 66.61], [59.4, 70.17], [2.3, 61.86], [97.5, 66.61], [23.6, 65.85],
      [34.7, 64.41], [14.0, 69.92], [30.0, 63.39], [67.7, 60.17], [26.6, 55.34],
      [26.2, 50.34], [17.0, 69.66], [52.5, 60.17], [30.1, 69.41], [84.1, 52.37],
      // The suburb's lamps, off the two road rails.
      [21.8, 87.63], [33.0, 91.36], [69.3, 78.64], [55.8, 72.63], [41.6, 90.17],
      [91.0, 91.61], [95.1, 78.39], [50.3, 87.63], [91.0, 73.64],
    ],
    // The Strat's tip (rgb 232,100,58 at card y 11) and its pod's red band
    // (244,34,61), the crown at x 28 (250,67,2), Paris's tip, the red crown
    // at 81.2 (248,19,14) and the three tower crowns beside it.
    beacons: [
      [7.7, 16.95], [7.7, 21.86], [28.0, 48.14], [65.5, 43.39], [81.2, 45.59],
      [77.6, 44.15], [75.9, 45.34], [72.1, 44.92],
    ],
    beaconTone: 'red',
    // Neon: the saturated magenta and cyan maxima of the Strip's signage
    // (the third element picks the cyan glow; magenta is the default). The
    // wheel's rim and the Sphere's skin are left to their own kinds.
    neon: [
      [11.9, 58.14], [41.1, 56.86], [40.9, 63.9], [37.5, 66.1], [48.6, 71.1],
      [64.0, 57.12], [62.9, 65.59], [73.6, 46.36], [78.1, 48.9], [80.3, 57.88],
      [1.2, 64.66],
      [86.9, 68.39, 'cyan'], [87.5, 61.86, 'cyan'], [72.2, 46.36, 'cyan'],
      [91.5, 72.12, 'cyan'], [36.9, 57.37, 'cyan'], [73.6, 60.17, 'cyan'],
      [54.2, 52.88, 'cyan'],
    ],
    // The High Roller: a ring 97 source px across (bounding box of its lit
    // rim, card y 44.3-72.9), centred at x 39.0. Diameter as a share of the
    // card WIDTH, since the ring is square in pixels and the card is not.
    wheel: { x: 39.0, y: 57.29, d: 4.85 },
    // The Sphere: 123 px across, top at card y 54.3, its lower half behind
    // the Strip (the skyline cuts it at y 73.8, 54% of the way down).
    orb: { x: 47.2, y: 68.98, d: 6.15, cut: 54 },
    // The Luxor shaft, standing on the pyramid's apex: the brightest column
    // at x 88 peaks white (254,255,253) at card y 57-58 and the frame already
    // paints a faint beam above it.
    beam: { x: 87.95, y: 56.36, height: 39.83, width: 2.4 },
    // Two arterial roads across the suburb in front, traced light by light
    // (+-1.3% band): both run level across the whole frame.
    bridge: [
      {
        lights: [
          [3.5, 76.36], [7.0, 76.1], [10.0, 76.1], [13.0, 75.17], [16.5, 75.34],
          [20.0, 75.85], [25.5, 76.61], [29.0, 75.85], [35.0, 74.66], [39.0, 74.66],
          [43.5, 74.92], [46.5, 74.66], [53.5, 74.92], [56.5, 75.34], [60.5, 74.66],
          [64.5, 75.34], [69.0, 74.92], [73.0, 74.66], [77.5, 75.34], [81.5, 74.41],
          [86.0, 74.66], [89.5, 74.92], [92.0, 75.17], [97.0, 74.41],
        ],
        deck: { x: 1, y: 75.17, w: 98, rise: 0.0 },
      },
      {
        lights: [
          [2.5, 85.17], [8.0, 83.14], [12.0, 83.39], [16.5, 84.41], [21.0, 83.39],
          [26.0, 83.14], [31.5, 83.64], [37.0, 84.66], [40.5, 84.41], [44.0, 84.41],
          [50.0, 84.41], [53.5, 83.64], [58.0, 83.39], [61.5, 84.66], [65.5, 83.39],
          [70.0, 83.9], [73.5, 83.14], [79.5, 85.34], [84.5, 83.9], [88.5, 83.9],
          [93.5, 84.92], [97.0, 83.9],
        ],
        deck: { x: 1, y: 84.15, w: 98, rise: 0.0 },
      },
    ],
    // The ridge tops out at card y 30%; the Strat reaches 11% at x 7.7, so
    // the crossings keep to the east of it.
    aircraft: { y: 21.19, from: 98, to: 44, flight: 40 },
    birds: { y: 26.27, from: 98, to: 44, flight: 34, count: 6 },
    helicopter: { y: 27.97, from: 44, to: 98, flight: 46 },
    // Morning haze on the valley floor behind the Strip (the far lights band
    // at y 45-58), white rather than the basin's smog; the towers stand out.
    haze: { y: 44.92, height: 11.86 },
    hazeTone: 'fog',
    // The golden-hour sun is OFF-FRAME LEFT (left edge brightest at card y
    // 15%; sky column means fall from 225 at left to 207 at right).
    flare: { x: -6, y: 20.34 },
    rainfall: true,
  },
  hongkong: {
    // MASTHEAD-HONGKONG-1 (2026-09-05): a new city, nine frames (Cloudy and
    // CloudyNight included). One viewpoint on all nine, from the Peak: Central
    // and Wan Chai below with the IFC at x 38.9 and the Bank of China at 55,
    // Victoria Harbour across the middle (card y 36-52), Kowloon on the far
    // shore with the ICC at x 61, the hills behind reaching the top edge.
    // Every coordinate measured (scratchpad nymeasure.mjs, gridzoom.py)
    // through the 50% crop (historic). All nine frames are one drawing
    // (skyline profiles within 6px), so no shift and no override.
    //
    // Night: Central and Wan Chai's windows, then Kowloon's along the far
    // shore. The harbour's own maxima are reflections and live in `water`.
    lights: [
      [97.1, 92.12], [6.9, 89.66], [80.2, 73.14], [70.9, 82.63], [81.4, 84.92],
      [66.3, 86.86], [73.3, 88.64], [26.5, 69.41], [22.9, 61.1], [46.5, 56.1],
      [30.3, 88.9], [84.0, 81.1], [1.8, 66.36], [32.7, 92.12], [77.2, 89.92],
      [31.3, 69.15], [47.1, 62.63], [58.8, 87.37], [39.8, 86.86], [84.0, 73.14],
      [37.8, 76.1], [86.9, 78.9], [3.6, 85.17], [12.9, 90.85], [54.1, 85.17],
      [17.8, 54.15], [39.5, 68.14], [63.8, 77.88], [23.4, 75.59], [64.5, 53.39],
      [63.5, 91.1], [70.7, 88.9],
      // Kowloon, the far shore, west to east.
      [27.5, 22.12], [26.7, 29.92], [30.3, 33.39], [34.2, 36.36], [38.2, 37.12],
      [41.3, 37.63], [51.2, 29.92], [56.6, 25.17], [73.2, 25.34], [79.0, 28.64],
      [82.7, 28.14], [85.5, 26.86], [88.1, 27.37], [92.0, 22.12], [97.2, 24.15],
      [99.5, 25.85], [85.5, 34.41], [82.3, 35.59], [87.8, 35.85],
    ],
    // The ICC's top light across the harbour, the IFC's crown, and the red
    // crowns the frame paints on Central's and Wan Chai's towers (rgb
    // 252,70,4 at x 31.3, 245,51,24 at x 51).
    beacons: [
      [61.2, 19.66], [38.9, 38.14], [46.3, 57.37], [31.3, 65.08], [17.6, 65.85],
      [41.9, 77.88], [51.0, 80.34], [65.8, 80.08],
    ],
    beaconTone: 'red',
    // Neon: Hong Kong's facades are lit in magenta and cyan, and the frame
    // paints them so. Twenty-two measured saturated maxima on the near towers.
    neon: [
      [44.5, 75.17], [12.7, 57.63], [46.8, 87.63], [12.7, 62.88], [21.1, 69.41],
      [74.0, 85.85], [13.5, 69.92], [67.3, 60.59], [74.2, 79.66], [66.8, 78.14],
      [21.3, 75.85], [10.0, 36.1],
      [31.1, 86.1, 'cyan'], [34.1, 58.9, 'cyan'], [63.2, 71.61, 'cyan'],
      [63.4, 54.92, 'cyan'], [26.6, 53.39, 'cyan'], [52.1, 87.12, 'cyan'],
      [62.8, 64.41, 'cyan'], [55.5, 64.15, 'cyan'], [61.3, 58.14, 'cyan'],
      [27.0, 65.85, 'cyan'], [69.7, 81.61, 'cyan'],
    ],
    // Reflections on the harbour between the two shores (Kowloon's at card y
    // 33-36, Central's at 55, North Point's at 46-50): the ICC's column and
    // the shore lights thrown back across the water.
    water: [
      [80.4, 45.34], [70.5, 50.34], [56.5, 49.92], [76.4, 48.64], [91.0, 39.92],
      [99.8, 49.92], [93.6, 42.37], [53.8, 50.59], [48.2, 44.41], [59.9, 47.63],
      [51.1, 46.36], [36.4, 43.64], [74.1, 50.34], [84.4, 44.41],
    ],
    // Steam off three tower tops that stand against the harbour.
    steam: [[46.5, 56.78], [66.5, 65.68], [21.5, 61.44]],
    // The hills reach the top edge between x 50 and 60, so the approach
    // crosses in front of them at night; the kites keep to the eastern
    // hills, the helicopter to the harbour.
    aircraft: { y: 11.02, from: 98, to: 30, flight: 40 },
    birds: { y: 12.71, from: 98, to: 66, flight: 30, count: 5 },
    helicopter: { y: 41.53, from: 96, to: 30, flight: 46 },
    // Haze over Kowloon (the far shore's towers, card y 20-36), warm-grey.
    haze: { y: 24.58, height: 13.56 },
    // The golden-hour sun is OFF-FRAME LEFT (left edge brightest at card y
    // 32; sky column means fall from 237 at left to 150 behind the ICC).
    flare: { x: -6, y: 34.75 },
    rainfall: true,
    // The Star Ferry, white, Tsim Sha Tsui to Central: lane y 43 is water
    // from the eastern harbour at x 98 to the piers at 28 (Kowloon's shore
    // ends at 36, North Point's begins at 46).
    ferry: { y: 44.07, from: 98, to: 28, flight: 140 },
    ferryTone: 'white',
    // Sun glitter, the pale maxima the Day and Golden Hour frames share
    // inside the harbour, the ICC's light path among them.
    glints: [
      [49.5, 42.63], [52.1, 47.63], [71.5, 48.9], [61.2, 43.14], [38.0, 45.17],
      [74.0, 47.63], [80.8, 47.63], [60.6, 39.92], [76.8, 45.34], [65.0, 50.17],
      [91.0, 38.64], [67.4, 43.64],
    ],
    // The harbour's chop, shore to shore.
    swell: { x: 28, y: 38.14, w: 72, height: 11.86 },
  },
  seattle: {
    // MASTHEAD-SEATTLE-1 (2026-09-05): a new city, eleven frames (Cloudy,
    // Snow and SnowNight included). One viewpoint on all eleven, the Kerry
    // Park view: the Space Needle at x 20.1, downtown to x 50, the stadiums
    // and the port along the waterfront, Elliott Bay below, Rainier at x 76.
    // Every coordinate measured (scratchpad nymeasure.mjs, gridzoom.py)
    // through the 50% crop (historic). The three night frames are one
    // drawing (forty lights and the Needle's tip within scatter), so the
    // snowy and clouded nights need neither a shift nor an override.
    //
    // Night: downtown's windows, then the waterfront, the stadiums, the port
    // and the far shore.
    lights: [
      [24.8, 47.37], [34.3, 47.88], [11.3, 64.66], [17.0, 63.14], [21.2, 60.59],
      [28.3, 46.36], [43.6, 63.64], [11.6, 58.9], [38.8, 54.66], [39.2, 68.64],
      [9.0, 60.59], [45.0, 52.37], [22.7, 36.61], [31.8, 47.88], [14.0, 38.64],
      [41.5, 63.9], [15.2, 49.15], [22.4, 52.88], [8.6, 53.39], [25.0, 68.64],
      [44.9, 45.59], [34.6, 42.63], [25.4, 62.37], [29.4, 41.1], [16.5, 69.66],
      [37.5, 35.85], [1.6, 55.85], [43.7, 69.15], [24.4, 56.61], [26.8, 52.63],
      [11.4, 69.92], [17.2, 53.64], [33.1, 57.88], [27.6, 67.88], [4.3, 61.36],
      [32.1, 67.12], [38.3, 60.17], [12.0, 43.39], [1.0, 64.92],
      // The waterfront, the port and the far shore.
      [70.7, 68.39], [56.4, 59.41], [76.5, 67.88], [74.2, 70.59], [68.4, 68.14],
      [78.3, 58.9], [63.8, 70.59], [58.7, 70.34], [73.9, 60.59], [61.7, 58.14],
      [79.3, 69.41], [55.3, 67.37], [65.5, 61.36], [61.6, 68.39], [94.7, 62.37],
      [83.8, 62.88], [67.8, 59.66], [86.3, 71.36], [58.9, 57.12], [81.5, 61.1],
    ],
    // The Needle's aviation light (rgb 221,31,7 on the snowy night, warm
    // white on the clear one) at the very tip, the Columbia Center's crown,
    // the Municipal Tower's, and the red crowns at x 12.6, 15.2 and 29.9.
    beacons: [[20.1, 11.02], [33.1, 25.17], [37.8, 31.86], [12.6, 44.15], [15.2, 37.12], [29.9, 41.36]],
    beaconTone: 'red',
    // The bay throws the city back: reflections under the waterfront, the
    // port and the far shore, and in the marina below the near shore.
    water: [
      [52.9, 81.36], [65.8, 75.34], [62.5, 77.12], [39.1, 87.88], [69.1, 75.17],
      [41.6, 87.12], [73.6, 73.14], [80.3, 73.64], [36.4, 88.39], [39.0, 79.66],
      [51.4, 75.17], [48.0, 75.59], [58.7, 80.34], [94.7, 76.61], [87.9, 74.15],
      [44.3, 80.59], [98.2, 77.12], [58.7, 70.34], [39.4, 73.39], [36.5, 70.85],
    ],
    // Alaskan Way along the piers: one level lit line from the aquarium to
    // the stadiums, traced light by light (+-1.3%), with a police car.
    bridge: [
      {
        lights: [[44.5, 69.15], [46.5, 68.64], [48.0, 68.64], [49.5, 69.66], [52.0, 70.59], [53.5, 69.15], [55.5, 70.34], [60.0, 70.34], [62.0, 69.66], [63.5, 70.17]],
        deck: { x: 44, y: 69.49, w: 20, rise: 0.42 },
        police: true,
      },
    ],
    // Sky is clear above card y 10 east of the Needle (Rainier's summit is at
    // 18, x 76; the Columbia Center reaches 21 at x 33), so the approach into
    // Sea-Tac runs east to west and stops short of the Needle's mast.
    aircraft: { y: 13.56, from: 98, to: 30, flight: 40 },
    birds: { y: 17.8, from: 96, to: 40, flight: 34, count: 6 },
    // A floatplane's height and a helicopter's rhythm, low over the bay at
    // sunset, out past the stadiums.
    helicopter: { y: 27.97, from: 40, to: 96, flight: 46 },
    // Marine fog lying on the bay: from the piers (y 72-75) out over the
    // water, white, with downtown and the Needle standing clear above it. A
    // first pass at y 60 laid it across the lower skyline and read as a bar.
    haze: { y: 63.56, height: 12.71 },
    hazeTone: 'fog',
    // Steam off three downtown rooftops with sky above them (first lit row of
    // the column on the Night frame).
    steam: [[26.0, 42.88], [36.0, 41.36], [46.0, 43.39]],
    // The golden-hour sun is OFF-FRAME RIGHT (right edge brightest at card y
    // 32; sky column means rise from 198 at left to 215 at right).
    flare: { x: 106, y: 34.75 },
    rainfall: true,
    snowfall: true,
    // A Washington State ferry, white, on the Bainbridge run: in from the
    // Sound at right and across the bay to the terminal. Lane y 88 is water
    // from x 98 to the marina at 46 (the near shore's trees begin at 45).
    ferry: { y: 82.2, from: 98, to: 46, flight: 150 },
    ferryTone: 'white',
    // Sun glitter, measured as the pale maxima of the Day and Golden Hour
    // frames INSIDE the bay: the marina below the near shore, the water off
    // the piers and the port, and the reach toward the far shore.
    glints: [
      [48.7, 78.9], [36.8, 77.88], [66.5, 75.34], [90.0, 72.88], [41.3, 85.59],
      [95.5, 76.1], [38.6, 84.41], [57.6, 75.85], [84.4, 74.41], [70.2, 72.12],
      [52.8, 74.92], [73.7, 74.92],
    ],
    // The bay's chop, from the marina to the far shore (the piers end at y
    // 75, the far shore at 72, the near shore's trees hold x < 45 below 78).
    swell: { x: 46, y: 72.03, w: 52, height: 19.49 },
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
      [36.2, 51.86], [48.2, 63.9], [40.4, 57.88], [42.1, 41.1], [32.2, 61.61],
      [28.6, 66.36], [36.5, 59.15], [46.9, 42.88], [53.5, 42.88], [62.4, 65.08],
      [43.6, 55.59], [42.4, 31.61], [53.1, 48.9], [37.4, 45.34], [25.4, 65.08],
      [17.8, 63.14], [94.1, 64.15], [11.3, 64.66], [80.8, 53.39], [47.0, 54.92],
      [52.6, 54.92], [45.6, 62.88], [52.8, 63.9], [49.4, 54.92], [55.9, 51.1],
      [96.9, 50.59], [42.0, 66.36], [67.0, 64.66], [64.7, 61.36], [55.8, 65.08],
      [36.5, 65.59], [15.2, 63.39], [91.0, 52.63], [29.9, 49.66], [0.9, 64.15],
      // The suburb in front, off the two freeway rails.
      [44.6, 71.1], [69.7, 87.37], [9.6, 84.41], [29.9, 73.9], [58.3, 67.88],
      [37.5, 72.88], [82.8, 74.66], [75.6, 90.59], [54.5, 91.36], [14.3, 69.92],
      [66.8, 68.14], [46.0, 81.1], [54.3, 76.86],
    ],
    // Aviation red is painted on the crowns here: the spire's tip (rgb
    // 244,4,9 at card y 10) and its lattice, 191 Peachtree's tip, Truist
    // Plaza, and the tower tops east and west of them (252,1,14 at x 70).
    beacons: [
      [42.4, 16.1], [42.4, 24.66], [53.0, 34.92], [47.2, 38.39], [50.0, 50.34],
      [65.0, 46.86], [69.9, 52.37], [78.3, 56.61], [32.3, 51.61], [58.4, 52.37],
      [39.6, 54.15],
    ],
    beaconTone: 'red',
    // The stadium's LED halo and two cyan signs, flickering.
    neon: [
      [24.9, 67.12, 'cyan'], [21.1, 67.88, 'cyan'], [18.6, 67.37, 'cyan'],
      [75.1, 72.12, 'cyan'], [86.3, 90.17, 'cyan'],
    ],
    // Steam off three rooftops with sky above them (Day frame roof edges).
    steam: [[30.0, 49.66], [58.0, 52.37], [62.0, 53.64]],
    // The Connector. The first pack had no traffic because the interchange
    // is a curve; this frame's run under the stadium is straight enough for
    // two rails, the gentle stretch from x 22 to 37 and the steeper ramp
    // from 36 that leaves the card's bottom edge, traced light by light
    // (+-1.5% band; every lamp within 1.8% of its rail). A police car runs
    // the long one.
    bridge: [
      {
        lights: [[25.0, 77.63], [26.5, 78.39], [28.5, 80.34], [30.0, 79.41], [31.5, 81.86], [35.0, 81.61]],
        deck: { x: 22, y: 78.14, w: 15, rise: 5.08 },
        police: true,
      },
      {
        lights: [[37.5, 86.1], [39.0, 86.1], [40.5, 87.88], [42.5, 91.1]],
        deck: { x: 36, y: 82.88, w: 7.5, rise: 8.81 },
      },
    ],
    // Sky is clear above card y 30 east of the spire (191 Peachtree reaches
    // 32 at x 53); the far hills lie at 37-42.
    aircraft: { y: 19.49, from: 98, to: 48, flight: 40 },
    birds: { y: 27.97, from: 98, to: 58, flight: 30, count: 6 },
    helicopter: { y: 24.58, from: 56, to: 98, flight: 46 },
    // Morning mist on the far hills and the suburbs behind the skyline.
    haze: { y: 38.14, height: 11.86 },
    hazeTone: 'fog',
    // The golden-hour sky is brightest at the top-RIGHT corner (219 against
    // 212 at left; Sunset and Dawn are lit from the right too), so the sun is
    // off-frame right and high.
    flare: { x: 106, y: 14.41 },
    rainfall: true,
  },
  honolulu: {
    // MASTHEAD-HONOLULU-1 (2026-09-05): a new city, nine frames. The view is
    // Waikiki from the west, looking along the beach to Diamond Head: the
    // Koolau range across the left, the hotel towers from x 0 to 46, the
    // shoreline running out to Kapiolani and the crater at x 64-88, and the
    // bay filling everything below. All nine frames are ONE drawing - a
    // vertical cross-correlation of their edge profiles agrees to within 2px
    // of 339 (0.6% of the card) on every pair - so there is neither a scene
    // shift nor a scene override here, and one set of coordinates serves all
    // nine. measured before MASTHEAD-FULL-FRAME-1 and converted to the full frame with it.
    //
    // No beacons: nothing in this frame carries an aviation light. The reddest
    // points on the night frame are sodium street lamps (rgb 250,110,30), not
    // crowns, so the city goes on the default with none rather than inventing
    // some. No bridge either - the lit line along the Diamond Head shore is
    // hotels and trees, not a roadway, and traffic on it would read as lights
    // sliding along the sand.
    //
    // The hotel windows, west to east: the Ala Moana end, the tower cluster
    // behind the beach, then the low shorefront out past Kapiolani to Kahala.
    lights: [
      [12.0, 42.63], [5.1, 51.86], [11.2, 60.85], [5.4, 63.9], [2.9, 58.14],
      [11.9, 48.64], [11.3, 45.17], [9.0, 60.59], [5.1, 46.36], [2.9, 54.66],
      [17.9, 55.08], [9.8, 57.12], [11.9, 52.88], [11.2, 58.64],
      [35.8, 46.1], [34.5, 65.08], [35.8, 43.9], [34.5, 43.9], [42.1, 59.41],
      [38.5, 50.17], [28.5, 48.14], [38.6, 56.1], [34.5, 61.61], [35.8, 50.17],
      [34.5, 46.1], [38.6, 53.14], [34.5, 49.66],
      [55.8, 63.14], [53.8, 64.92], [65.8, 65.08], [50.0, 64.66], [68.3, 64.15],
      [47.7, 64.66], [56.8, 60.17], [67.2, 56.1], [60.3, 64.66], [47.9, 62.37],
      [90.5, 64.41], [76.1, 64.66], [91.6, 63.9], [80.8, 65.34], [74.4, 65.59],
      [72.0, 64.66], [75.3, 61.61], [79.3, 65.59], [86.5, 62.37], [71.0, 65.59],
    ],
    // THE WATERLINE IS A CURVE, AND EVERY WET COORDINATE BELOW RESPECTS IT.
    // Waikiki's beach runs diagonally across the card - the sea meets the sand
    // at card y 92 on the left edge and at y 67 on the right - so a flat band
    // of "water" between two y values is half beach. Traced off the Day frame
    // by hue (the first row of a column with fourteen straight rows of blue
    // dominance), then every point below sampled from waterline + 1.5% down.
    // The first pass took a flat band and put nine reflections on the sand.
    water: [
      [30.2, 77.88], [34.5, 81.36], [35.2, 88.64], [44.8, 73.9], [11.7, 86.61],
      [3.1, 85.59], [18.7, 86.61], [50.5, 74.15], [94.3, 68.9], [50.5, 80.59],
      [16.1, 84.92], [19.6, 80.59], [7.1, 84.92], [43.5, 88.9], [43.7, 81.36],
      [22.2, 79.66], [55.5, 70.85], [31.1, 89.41], [15.8, 91.36], [24.5, 90.59],
      [38.4, 78.64], [47.8, 73.39], [46.6, 80.34], [41.8, 75.59], [53.3, 70.85],
      [24.6, 80.34],
    ],
    // Sun glitter, the pale maxima of the Day frame taken under the same
    // waterline so none of them lands on the sand.
    glints: [
      [88.1, 84.92], [97.5, 76.36], [53.3, 70.59], [18.6, 81.36], [88.1, 91.1],
      [31.4, 77.63], [47.0, 73.14], [15.0, 84.66], [50.6, 71.1], [62.4, 68.64],
      [35.3, 77.37], [11.0, 83.14], [25.8, 79.15], [39.8, 74.92], [18.8, 88.9],
      [22.0, 80.08],
    ],
    // MASTHEAD-SURF-1: the break along the beach, and the reason this city
    // exists in the registry. Nine crests laid on the traced waterline,
    // 1.4% seaward of it, each rotated to the slope of the shore it sits on
    // so the foam follows the bay's curve instead of cutting across it. The
    // raw trace has one outlier at x 36 (a pier), so the line these use is
    // the monotone fit through the readings either side of it.
    surf: [
      [0, 86.78, 9, -3.14], [9, 83.64, 9, -2.8], [18, 80.85, 9, -2.54],
      [27, 78.31, 9, -2.63], [36, 75.68, 9, -3.05], [45, 72.63, 9, -2.8],
      [54, 69.83, 9, -1.53], [63, 68.31, 9, -0.76], [72, 67.54, 9, -0.51],
    ],
    // The open bay past the break, where the waterline has already fallen
    // away: x 44 meets the sea at y 75.7, x 98 at y 67.
    swell: { x: 44, y: 73.73, w: 54, height: 17.8 },
    // A catamaran on the Waikiki run, white like the boats already in the
    // Day, Golden Hour and Sunset frames. Lane y 86 is open water from the
    // right edge in to x 36, where the sand is still 5.5% above it.
    ferry: { y: 80.51, from: 98, to: 36, flight: 160 },
    ferryTone: 'white',
    // Sky is clear above card y 22 east of the ridge (the Koolau crest holds
    // y 9-18 out to x 26; Diamond Head's summit is at 30), so the approach
    // into Honolulu runs east to west and stops short of the range.
    aircraft: { y: 12.71, from: 98, to: 30, flight: 40 },
    // Seabirds, and the one flock in this registry that flies BELOW the
    // skyline rather than above it: over the bay is where Waikiki's birds
    // are, and a dark silhouette reads on turquoise as well as on sky.
    // THE LANE IS NOT THE FLOCK. Measured in the browser, the six birds sit
    // from 6.4% ABOVE the declared y to 11.5% below it, so a lane at 76
    // running in to x 44 put the leading bird on the sand at the west end.
    // At y 80 stopping at x 54 the highest bird is 73.6 and the sea there
    // begins at 72.0, so the whole flock stays over water for the whole run.
    birds: { y: 75.42, from: 96, to: 54, flight: 34, count: 6 },
    // A tour helicopter's height and rhythm, out along the crater rim.
    helicopter: { y: 26.27, from: 44, to: 96, flight: 46 },
    // Vog on the horizon: the default warm-grey tone, not the white fog,
    // BECAUSE OF THE MASK. The smog mask fades off the left half and is full
    // strength from 56% rightward, which here is the crater's lower slopes
    // (y 30-44) and the sea horizon behind it (y 45-53), exactly where a
    // marine haze belongs. The white fog tone is feathered at the card edges
    // only, so at this height it would have laid a bar across the open sky
    // east of Diamond Head, which is the mistake Seattle's first pass made.
    haze: { y: 42.37, height: 10.17 },
    // The golden-hour sun is OFF-FRAME RIGHT and low: the right sky column
    // brightens from lum 196 at card y 2 to 207 at y 14 and holds, and the
    // Sunset frame puts its glow on the right horizon behind the crater.
    flare: { x: 106, y: 19.49 },
    // MASTHEAD-RAINBOW-1: the Rainbow State earns one, and it goes where the
    // real ones go - over the Koolau, on the half of the sky OPPOSITE the sun.
    // A bow is centred on the antisolar point, and this artwork's sun is off
    // the right edge (see flare), so an arc drawn anywhere right of centre
    // would be lit from the wrong side. Apex at x 35, feet at x 18 and 52,
    // measured against the frame: the sky at x 35 is clear from the top edge
    // down to the ridge at y 25, and the arc stands on the range the way
    // Honolulu's actually do. The apex sits at 35 rather than the 29 it
    // started at because the greeting grows leftward-to-rightward as the card
    // narrows - it reaches x 40 by 768px - and at 29 the peak of the bow, the
    // one part that has to be seen, was behind the word "Jester". The visible
    // span ends at x 47 (the mask dissolves the last 14%), which clears the
    // clock's box at 45.9 because the arc's band stops at y 39 and the clock
    // starts at 47.9. Withdrawn below 768px, where the card changes aspect.
    rainbow: { x: 18, y: 16.95, w: 34, h: 35.59 },
    rainfall: true,
  },
  rio: {
    // MASTHEAD-RIO-1 (2026-09-06): a new city, nine frames, measured before
    // MASTHEAD-FULL-FRAME-1 and converted to the full frame with it. The view looks
    // east from above Botafogo: Corcovado and the statue at x 16, the favela
    // hillside across the left, the Botafogo cove and its promenade curving
    // from x 31 to 62, Guanabara Bay filling the centre-right with Niteroi on
    // the far shore, and Sugarloaf at x 83 with Urca below it.
    //
    // The city's own windows, the hillside, and the far shore.
    lights: [
      [3.0, 47.03], [3.9, 59.75], [13.2, 66.27], [15.1, 64.24], [7.2, 47.97],
      [2.7, 55.76], [11.1, 61.02], [10.8, 66.27], [7.2, 54.24], [0.9, 53.98],
      [8.3, 51.27], [15.5, 67.29], [0.9, 62.71], [5.5, 57.46],
      [16.9, 68.47], [34.5, 67.03], [26.3, 72.03], [24.8, 71.02], [24.6, 67.03],
      [18.8, 70.25], [35.6, 72.03], [28.5, 71.27], [17.4, 71.02], [30.3, 51.78],
      [31.8, 64.49], [36.9, 71.02], [35.1, 59.24], [33.1, 68.47], [22.2, 73.47],
      [29.4, 68.73],
      [48.4, 59.24], [51.3, 67.97], [48.7, 70.0], [43.1, 68.73], [45.6, 71.02],
      [39.6, 71.02], [57.8, 52.71], [54.8, 65.51], [53.3, 66.27], [47.0, 69.24],
      [44.0, 55.0], [41.4, 71.53], [51.8, 63.47], [57.4, 69.24],
      [91.3, 55.76], [62.4, 67.54], [70.3, 57.03], [93.1, 59.49], [72.8, 55.76],
      [58.9, 52.97], [88.4, 50.51], [59.2, 70.51], [74.2, 55.25], [78.3, 54.49],
      [61.1, 68.98], [69.8, 71.02], [63.3, 51.78], [64.3, 70.76],
      // The floodlit statue, twice up its height, and the lit summit station
      // on Sugarloaf that the cable car runs from.
      [15.8, 6.27], [15.8, 8.81], [83.1, 30.76],
    ],
    // The two red masts flanking Corcovado. Measured by their HALO, not their
    // core: a small saturated red light blows out to pink in the middle, so
    // the core reads rgb(156,78,98) and rgb(229,180,199) while the glow around
    // them is unambiguously red against the blue sky. A strict red test over
    // the whole frame returned nothing but sodium street lamps.
    beacons: [[11.3, 12.97], [11.4, 16.27], [18.1, 16.78]],
    beaconTone: 'red',
    // THE SHORE HERE IS A ROAD, NOT A BEACH. Botafogo's waterline is the
    // promenade below, traced lamp by lamp, and every reflection is sampled
    // 2.2% clear beneath it. The first pass measured reflections and deck
    // lights independently and produced eleven pairs sitting on each other -
    // [62.1, 72.97] appeared in both sets at the same coordinate.
    water: [
      [34.2, 82.29], [49.8, 78.22], [51.4, 78.47], [39.4, 83.47], [35.8, 82.29],
      [60.3, 78.22], [37.8, 82.71], [49.6, 82.54], [54.7, 76.78], [53.0, 77.29],
      [57.2, 78.98], [58.8, 78.47], [45.5, 79.24], [31.6, 83.73], [62.1, 76.53],
      [48.0, 77.97], [60.3, 83.47], [47.4, 83.98], [45.5, 83.22],
    ],
    // Sun glitter in the OPEN bay. Rio's city is white, so pale maxima find
    // rooftops: every one of these was accepted only when the ring 10-18px
    // around it is blue, smooth and darker than the glint itself. Without
    // that ring test the first pass put twelve of fourteen on buildings.
    glints: [
      [61.0, 52.03], [69.9, 53.98], [73.0, 54.24], [74.5, 59.75], [75.8, 49.75],
      [89.7, 50.0], [95.3, 53.98], [98.2, 54.24], [90.9, 82.29],
    ],
    // The promenade round the cove, in two straight runs because one is not
    // straight: the drop is 0.29% per 1% of width from x 31 and 0.26% from
    // x 47, and a single rail through both would leave the traffic 2% off the
    // road at the join. Traced light by light; every lamp is within 1.3% of
    // the rail it belongs to. The seaward run carries the police car.
    bridge: [
      {
        lights: [[31, 81.02], [34, 80.76], [36.5, 79.24], [39, 78.98], [41, 78.22], [43.5, 77.71], [46, 77.29]],
        deck: { x: 31, y: 81.02, w: 15, rise: -3.73 },
      },
      {
        lights: [[47, 76.27], [49.5, 76.53], [52, 76.27], [54.5, 75.51], [57, 73.73], [59.5, 73.22], [62, 72.97]],
        deck: { x: 47, y: 76.27, w: 15, rise: -3.31 },
        police: true,
      },
    ],
    // MASTHEAD-CABLE-1: the Sugarloaf bondinho, and the reason this pack has a
    // new kind. The wire is DRAWN in all nine frames, from the summit station
    // down to Urca, with cabins painted on it and both stations lit at night,
    // so a cabin that runs it is riding real geometry rather than decorating
    // empty rock. Anchored on the five bright points along the wire (the two
    // stations at [83.0, 30.25] and [91.0, 56.36] and the three lit cabins
    // between them) and fitted by least squares; the cable sags, so the rail
    // is the chord and the worst residual is 2.1% of card height, which is
    // inside the cabin's own radius. One cabin, down and back up, because
    // that is what a cableway does.
    cable: { x: 83, y: 31.36, w: 8, rise: 26.78, flight: 42 },
    // Sky is clear above card y 33 from x 22 east; Corcovado holds y 4-24 at
    // x 14-18 and the lane stops well short of it.
    aircraft: { y: 6.78, from: 98, to: 26, flight: 40 },
    // Frigatebirds over the bay, high. The flock spreads 6.4% above the lane
    // and 11.5% below it, so at y 22 the highest sits at 15.6 and the lowest
    // at 33.5, and the ridge under the run never rises past 37.
    birds: { y: 18.64, from: 96, to: 30, flight: 34, count: 6 },
    // A tour helicopter round the Sugarloaf circuit, above its summit at 37.
    helicopter: { y: 25.42, from: 60, to: 96, flight: 46 },
    // The Niteroi ferry. Lane y 68 is open water from x 82 in to 58 and then
    // stops: Sugarloaf's base blocks x 84-86, so the crossing cannot run the
    // width of the card and does not pretend to.
    ferry: { y: 57.63, from: 82, to: 58, flight: 120 },
    ferryTone: 'white',
    // Tropical haze on the far range and the bay's far shore. Default tone,
    // whose mask is strongest right of 56% - which here is exactly the
    // distance that carries it.
    haze: { y: 32.2, height: 10.17 },
    // The golden-hour sun is OFF-FRAME LEFT: the sky column mean falls from
    // 231 at x 0 to 191 at x 90, and the brightest edge pixel is at x 2.
    flare: { x: -6, y: 22.03 },
    // The bay between the cove and Sugarloaf's base, verified open water at
    // every 2% from x 60 to 82.
    swell: { x: 60, y: 54.24, w: 22, height: 11.86 },
    rainfall: true,
  },
  tokyo: {
    // MASTHEAD-TOKYO-1 (2026-09-06): a new city, nine frames, measured through
    // the TOP-anchored crop (historic). The view looks west across the
    // whole basin: Fuji at x 10-16, Tokyo Tower at x 32.5 with its spire at the
    // top edge, the Shinjuku cluster from x 40 to 72, the Skytree at x 87.5,
    // and low-rise city everywhere else to the horizon.
    //
    // NO TRAIN, AND THE REASON IS THE CROP. The frame does draw an elevated
    // railway, a clear multi-track viaduct running diagonally from x 58 to 66,
    // but it sits at source rows 346-391 - card y 102 to 114, entirely below
    // the card's bottom edge. Including it means the centred crop, which takes
    // the Skytree's crown and Tokyo Tower's spire, and those are the city. A
    // sweep of every straight line across the lower card found no second
    // candidate: Tokyo's pale rooftops ARE the background here, so nothing
    // scored above the noise. A train drawn anywhere else would be invented.
    //
    // TOKYO'S WINDOWS ARE WHITE. Every other pack in this registry measures its
    // lights with a warm score (r - b >= 12) because sodium is what those
    // cities burn; on this frame that score returns NOTHING. The artwork paints
    // fluorescent office light at rgb(255,255,255), so these were measured on
    // luminance with a low-saturation gate instead.
    lights: [
      [14.3, 79.24], [6.6, 81.78], [14.4, 81.78], [18.4, 83.22], [15.3, 78.22],
      [19.0, 77.97], [14.6, 74.24], [16.8, 80.25], [12.8, 73.98], [0.6, 75.76],
      [10.2, 72.03],
      [32.4, 76.53], [37.3, 72.97], [31.1, 73.22], [29.5, 72.46], [33.7, 63.47],
      [22.1, 73.22], [37.7, 77.03], [35.4, 81.02], [22.1, 67.29], [20.4, 74.75],
      [38.4, 66.27],
      [46.3, 80.25], [49.0, 73.98], [41.4, 46.78], [41.9, 51.02], [53.0, 76.78],
      [57.6, 70.0], [50.0, 60.0], [56.3, 65.0], [43.9, 78.73], [55.2, 61.27],
      [47.6, 63.47],
      [66.1, 53.22], [66.1, 65.25], [71.3, 68.98], [65.7, 69.75], [65.5, 81.02],
      [79.0, 81.78], [60.4, 70.25], [65.1, 53.73], [77.3, 80.76], [75.8, 81.27],
      [78.3, 62.54],
      [80.2, 71.53], [84.9, 65.76], [83.5, 77.71], [85.0, 75.76], [80.8, 63.73],
      [82.3, 77.29], [91.5, 73.47], [97.2, 70.25], [93.3, 54.24], [92.5, 65.51],
      [89.9, 56.53], [95.7, 77.54], [94.2, 61.02],
      // Tokyo Tower's floodlit lattice, and the Skytree's lit column. Both are
      // lit structures rather than windows, so they breathe with the city.
      [32.4, 12.97], [32.5, 16.27], [32.4, 14.75], [32.4, 27.71], [31.8, 50.25],
      [87.6, 4.24], [87.2, 18.47], [87.5, 23.47], [87.6, 25.0], [87.4, 38.22],
    ],
    // Every tall building in this frame carries an aviation light, which is
    // true of Tokyo and is the single most animated thing in the artwork.
    // FOUND BY THE SKY ABOVE THEM, not by colour: Tokyo Tower is painted
    // red-orange from top to bottom, so a per-pixel red test returns its whole
    // lattice and nothing useful. A beacon is the one red point on its
    // building with open sky overhead, and that test returns only crowns -
    // including the tower's own tip light at [32.5, 2.71].
    beacons: [
      [32.5, 2.71], [47.3, 31.53], [71.9, 48.73], [4.7, 49.75], [90.5, 51.27],
      [12.0, 57.03], [93.2, 43.47], [53.3, 33.73], [94.0, 45.0], [39.8, 52.29],
      [45.6, 31.78], [53.6, 62.29], [81.0, 62.71], [14.0, 50.25], [80.6, 47.29],
      [67.9, 40.76], [7.9, 58.47], [65.2, 49.75], [53.6, 47.29], [91.7, 57.71],
      [33.2, 48.98], [94.8, 51.53], [42.9, 62.03], [69.0, 48.47], [66.0, 49.49],
      [40.8, 57.29],
    ],
    beaconTone: 'red',
    // The approach runs east to west and stops at x 36: Tokyo Tower's spire
    // reaches card y 3 at x 32.5 and the Skytree y 2 at x 87.5, so a lane that
    // crossed the whole card at this height would draw straight through both.
    // The motion layer sits ABOVE the artwork, so a plane behind a tower is not
    // an option; the lane has to end short of them.
    aircraft: { y: 10.17, from: 84, to: 36, flight: 40 },
    // The flock spreads 6.4% above its lane and 11.5% below, so y 20 puts it
    // between 13.6 and 31.5 - clear of the Shinjuku crowns, which start at 33.
    birds: { y: 16.95, from: 82, to: 38, flight: 34, count: 6 },
    helicopter: { y: 22.03, from: 40, to: 84, flight: 46 },
    // Kanto haze on the far range, which sits at y 44-57 across the frame.
    haze: { y: 37.29, height: 9.32 },
    // The golden-hour sun is OFF-FRAME LEFT and high: the sky column mean falls
    // from 227 at x 0 to 200 at x 80, and the left edge is brightest at y 2-8.
    flare: { x: -6, y: 6.78 },
    rainfall: true,
  },
  london: {
    // MASTHEAD-LONDON-1 (2026-09-06): a new city, nine frames, measured through
    // the TOP-anchored crop (historic). The view looks east down the
    // Thames: Parliament and Big Ben across the left, the London Eye at x 38.7,
    // Westminster Bridge crossing from x 26 to 50, St Paul's at 52.8, the City
    // cluster at 65-75, two more bridges downstream, and the Shard at x 90.
    //
    // NO BEACONS. Nothing in this frame blinks. A strict aviation-red test
    // returns only sodium street lamps, and the Shard's tip probes
    // rgb(255,248,121) - warm white. The tower crowns are steady, so they are
    // in `lights`, where they breathe, rather than in `beacons`, where they
    // would blink at a city that does not.
    lights: [
      [5.5, 41.78], [7.9, 46.78], [2.8, 59.49], [6.8, 25.51], [6.5, 42.54],
      [24.5, 28.73], [4.0, 58.73], [6.2, 59.75], [23.6, 30.25], [5.3, 47.71],
      [6.7, 37.71], [13.3, 46.78],
      [36.8, 57.46], [47.5, 56.78], [41.0, 40.76], [45.3, 41.02], [44.0, 57.46],
      [50.7, 34.24], [37.9, 43.98], [32.3, 41.78], [51.0, 37.71], [45.9, 57.71],
      [67.3, 45.51], [59.2, 51.53], [63.3, 47.03], [64.6, 46.78], [73.4, 29.49],
      [70.9, 45.51], [68.8, 45.0], [54.3, 27.29], [70.5, 26.27], [69.7, 50.25],
      [66.1, 46.53], [55.8, 34.75],
      [84.8, 56.78], [93.8, 62.97], [97.5, 38.22], [94.2, 31.78], [95.0, 62.29],
      [86.1, 57.97], [99.5, 57.29], [91.8, 39.75], [98.4, 38.98], [84.4, 45.51],
      [90.4, 46.02], [90.0, 39.75], [98.2, 75.25], [92.0, 66.27], [91.1, 63.73],
      [92.5, 63.47], [91.1, 66.78], [98.2, 71.78], [93.7, 72.29], [82.0, 66.27],
      // The crowns: Victoria Tower, St Paul's dome, a City tower, and four up
      // the Shard's lit glass. Found by the sky above them, as Tokyo's were.
      [17.2, 32.71], [52.8, 33.73], [70.1, 8.73], [65.8, 35.51],
      [90.1, 11.02], [90.9, 15.25], [91.3, 24.75], [88.9, 32.71],
    ],
    // THE LONDON EYE. A least-squares circle through the rim arc that stands
    // against clear sky: the centre x is 38.7 on every row from 18 to 90 (it
    // never varies by more than 0.1), and pinning the apex at row 18 gives
    // R 69.7px. Rows below 96 were excluded - the city behind the wheel creeps
    // into the row scan there and inflates the radius by half again.
    wheel: { x: 38.7, y: 21.95, d: 6.97 },
    // The Thames at night. Reflections here are LONG streaks, so the test that
    // separates them from the embankment lamps is a smear persisting 6 to 26
    // rows down; at the four-sample depth that served Rio, Parliament's lit
    // facade and the plane trees passed as river.
    water: [
      [74.6, 56.27], [53.1, 60.51], [72.3, 56.27], [26.8, 77.54], [45.8, 63.47],
      [49.3, 62.03], [56.5, 60.51], [47.5, 65.25], [44.3, 63.47], [75.3, 64.24],
      [60.4, 55.76], [69.8, 55.76], [64.5, 55.25], [70.3, 74.24], [67.4, 57.29],
      [51.1, 61.02], [74.5, 60.25], [53.0, 65.51], [76.5, 68.98], [33.3, 80.0],
      [56.4, 64.75], [54.8, 59.49], [69.7, 63.47], [38.0, 81.02], [64.4, 58.98],
    ],
    // Daylight glitter on the river, each one accepted only with a ring of
    // open blue-grey water around it.
    glints: [
      [64.5, 65.51], [60.4, 70.0], [66.1, 57.71], [63.6, 59.75], [72.0, 58.73],
      [55.8, 73.22], [66.0, 63.22], [47.5, 66.78], [59.1, 63.73], [58.0, 72.46],
      [69.0, 62.71], [52.9, 67.71], [70.0, 58.47], [58.3, 67.71], [26.4, 82.97],
      [71.5, 62.71], [60.0, 60.0], [69.0, 66.53],
    ],
    // The reach between Westminster Bridge and the downstream pair, verified
    // open water at every 2% of width on five separate rows.
    swell: { x: 50, y: 60.17, w: 24, height: 12.71 },
    // Westminster Bridge, traced lamp by lamp: it falls 11.8% across 24% of
    // the card and every lamp is within 1.1% of that rail. Then the downstream
    // bridge, which is nearly level. The two do not overlap in x, so the
    // traffic on one never stacks on the other. The police car runs the long
    // span, which is the one with the red buses on it by day.
    bridge: [
      {
        lights: [[26.7, 62.54], [28.7, 65.25], [30.7, 65.51], [32.7, 66.53], [34.7, 67.03], [36.7, 66.78], [38.7, 68.47], [40.7, 69.24], [42.7, 70.25], [44.7, 71.27], [46.7, 72.03], [48.7, 72.97]],
        deck: { x: 26, y: 63.22, w: 24, rise: 10.0 },
        police: true,
      },
      {
        lights: [[62.0, 49.24], [63.5, 48.47], [65.5, 48.47], [67.5, 50.25], [69.5, 50.25], [71.0, 51.02], [72.5, 50.76], [76.0, 51.27]],
        deck: { x: 61, y: 48.73, w: 15, rise: 2.54 },
      },
    ],
    // A river boat, white like the ones the artwork already puts on the water.
    // Lane y 80 is river from x 76 in to 42; the two columns that read as land
    // on the way are bridge shadows, which a boat passes under.
    ferry: { y: 67.8, from: 76, to: 42, flight: 130 },
    ferryTone: 'white',
    // The sky here is pierced in four places - Parliament's Victoria Tower at
    // x 6, the Eye at 36-42, the City at 66-70 and the Shard at 90 - so there
    // is no lane across the card at altitude. This is the longest clear run.
    aircraft: { y: 10.17, from: 64, to: 42, flight: 40 },
    // Gulls over the Thames rather than over the roofs: the flock spreads 6.4%
    // above its lane and 11.5% below, so y 78 keeps all six over water.
    birds: { y: 66.1, from: 74, to: 46, flight: 34, count: 6 },
    helicopter: { y: 16.95, from: 44, to: 64, flight: 46 },
    haze: { y: 22.88, height: 8.47 },
    // The golden-hour sun is OFF-FRAME LEFT: the sky column mean falls from
    // 232 at x 0 to about 190 at x 80.
    flare: { x: -6, y: 16.95 },
    rainfall: true,
  },
  rome: {
    // MASTHEAD-ROME-1 (2026-09-06): a new city, and the first pack with TEN
    // frames - it brought RainNight, a rain-after-dark scene no pack had
    // before (see OPTIONAL_SCENES in mastheadScene.js). Measured through the
    // TOP-anchored crop (historic). The view looks across the centro
    // storico from the Janiculum: St Peter's at x 24, the Vittoriano at 62-72,
    // domes and tiled rooftops everywhere between, the Alban hills behind.
    //
    // All ten frames are ONE DRAWING - a vertical cross-correlation of their
    // edge profiles agrees to within 1px of 339 on every pair, the tightest of
    // any pack so far - so there is no scene shift and no override, and the
    // pick sweep dissolves through them without anything moving.
    //
    // NO BEACONS, and none available: Rome has no building tall enough to
    // carry an aviation light, and a strict red test over the night frame
    // returns nothing but sodium street lamps (rgb 245,145,60 and its
    // neighbours). NO WATER either - the Tiber is not in this frame - so
    // nothing here reflects, glitters, swells or sails.
    //
    // Warm windows, lit facades and the floodlit domes, west to east. Rome
    // burns sodium, so the shared warm score finds these the way it was
    // written to; contrast Tokyo, whose windows are white.
    lights: [
      [9.6, 72.46], [12.8, 58.73], [19.8, 52.97], [2.1, 63.73], [19.1, 46.02],
      [18.9, 52.54], [3.6, 41.27], [13.2, 71.02], [19.8, 41.78], [18.9, 50.0],
      [16.4, 83.22], [13.1, 75.51], [14.9, 62.54],
      [28.5, 42.29], [21.1, 42.29], [38.6, 44.24], [22.4, 28.22], [27.8, 31.02],
      [23.4, 34.24], [36.9, 65.76], [21.4, 72.71], [20.6, 30.76], [24.9, 52.54],
      [25.3, 33.73], [39.4, 63.22], [22.1, 42.54],
      [52.2, 60.51], [59.4, 65.0], [57.5, 62.54], [49.5, 47.03], [59.3, 62.29],
      [50.0, 82.03], [44.5, 55.0], [50.3, 50.0], [50.9, 81.27], [51.8, 82.03],
      [58.4, 58.22], [48.4, 74.24], [48.4, 50.25],
      [79.9, 72.29], [61.2, 61.78], [64.5, 73.73], [60.1, 62.71], [76.4, 46.27],
      [76.1, 61.27], [68.8, 63.47], [79.3, 50.0], [69.3, 41.27], [67.2, 48.73],
      [79.7, 68.47], [60.5, 59.24], [64.7, 49.49],
      [83.8, 51.27], [80.3, 73.98], [80.3, 67.71], [89.0, 64.24], [83.5, 44.75],
      [83.4, 48.73], [86.5, 49.49], [83.9, 53.98], [98.2, 52.54], [80.2, 70.25],
      [88.9, 78.73], [96.2, 80.51], [93.0, 61.78],
    ],
    // The approach stops at x 32 because St Peter's cross reaches card y 8 at
    // x 24, and the motion layer draws ABOVE the artwork - a plane at this
    // height would cross the dome rather than pass behind it.
    aircraft: { y: 10.17, from: 98, to: 32, flight: 40 },
    // Swifts over the rooftops. The flock spreads 6.4% above its lane and
    // 11.5% below, and the lowest roofline under this run is card y 23 (the
    // Vittoriano's quadrigae at x 62), so y 10 keeps all six clear of it.
    birds: { y: 8.47, from: 96, to: 34, flight: 34, count: 6 },
    helicopter: { y: 13.56, from: 34, to: 96, flight: 46 },
    // Haze on the Alban hills and the far quarters, which sit at card y 23-37
    // across the frame - and the default tone's mask is strongest right of
    // 56%, which here is exactly the distance that carries it.
    haze: { y: 20.34, height: 8.47 },
    // The golden-hour sun is OFF-FRAME LEFT: the sky column mean falls from
    // 241 at x 0 to 210 at x 90, and the brightest edge pixel is at card y 12.
    flare: { x: -6, y: 8.47 },
    rainfall: true,
  },
}

export function skyPositionFor(city) {
  return CITY_SKY_X[city] || DEFAULT_SKY_X
}

/** The build-injected file list, safe under Node tests (no global defined). */
export function injectedSceneFiles() {
  // eslint-disable-next-line no-undef
  return typeof __MASTHEAD_SCENE_FILES__ !== 'undefined' ? __MASTHEAD_SCENE_FILES__ : []
}
