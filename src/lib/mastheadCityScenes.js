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
  // MASTHEAD-SANFRANCISCO-3: the third pack's sky is the smallest in the
  // registry - the hills close it at card y 13-16 by day - and the Salesforce
  // Tower spikes to y 5 at x 60. The deepest clear band is x 64-80 (day 15-16,
  // night 26+), which also clears the greeting on the left, the centred clock
  // and the temperature readout on the right.
  //
  // The Owner also asked for the art to be RAISED here, and it should not be.
  // I built a per-city vertical anchor and measured it: the celestial render
  // is a tall 2:3 image with the disc at its VERY TOP and transparency below,
  // so the -27px default already sits the whole disc between the card's edge
  // and the hills, and raising only feeds the moon into the top edge - 13px
  // cuts it in half, 22px leaves a glow and no moon. The box reaching card
  // y 68 is empty pixels, not overhang. The machinery was removed rather than
  // left unused; it is ten lines if a future pack genuinely needs it.
  sanfrancisco: '66%',
  // Atlanta's towers run in one dense band from roughly 42% to 72% of the
  // frame, with the Bank of America spire near 68%, so the default 52% lands
  // the moon in the middle of them. The left third is low rooftops and trees
  // under open sky, which is where it goes.
  atlanta: '30%',
  // MASTHEAD-LOSANGELES-3: the third pack puts the Wilshire Grand's needle at
  // x 54 (card y 12) with the tower cluster from x 40 to 76, so the default
  // 52% sits the moon on the needle. The clearing is the sky over the west
  // basin, between the left palms (x 10) and the towers, above a ridge that
  // never rises past y 30 there.
  losangeles: '28%',
  // MASTHEAD-ROME-SKY-1 (2026-09-06, Owner): the sun belongs where THIS
  // artwork's light actually comes from, and in Rome that is off-frame LEFT.
  // Measured three ways and the three agree: the sky column means fall
  // monotonically left to right on every sunlit frame (Day 231 -> 223, Morning
  // 238 -> 219, Golden Hour 236 -> 205); St Peter's dome is brighter on its
  // LEFT half than its right on all three (by 22.9, 14.8 and 8.6); and both
  // umbrella-pine canopies are lit on the left on all three. At the default
  // 52% the sun sat mid-frame, lighting the city from a side its own shadows
  // contradict.
  //
  // So the art goes in the clearing BEFORE the basilica, not after it. The
  // dome is the only thing between x 0 and 56 that breaks the skyline above
  // y 22, and only across x 23-25.5, which leaves two clearings; the right-hand
  // one (28%) is cleaner but puts the sun on the wrong side of every shadow in
  // the frame. At 8% the sun render lands at x 11-21: past the greeting's last
  // word, short of the dome, and on the side the painting is lit from.
  //
  // A caution for the next city: the art box is a FIXED 192px, so it is 14.6%
  // of a 1400px card but 21% of a 1000px one. A left anchor that clears a
  // landmark on a wide card can reach it on a narrow one - check both.
  rome: '8%',
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
    // MASTHEAD-LOSANGELES-3 (2026-09-06): the THIRD Los Angeles pack. Ten
    // frames now (RainNight joined), ONE drawing on all ten (row-edge
    // correlation within 1px, r >= 0.90), and a new viewpoint, so nothing from
    // the second pack survives: every coordinate here was measured on these
    // frames (scratchpad la3measure.mjs, la3crown.mjs, overlay3.py) and read
    // straight off the artwork, because the card shows the whole frame.
    //
    // The view is the basin from the south-west with a palm colonnade at both
    // edges (fronds to the top edge at x 4-10 and x 90-96), downtown at x 40-76
    // with the Wilshire Grand's needle at x 54 (dark to card y 18, lit from
    // 19), the US Bank tower at x 61 (crown y 23.5), City Hall at x 70-71.7
    // (tip y 49), the San Gabriels behind at y 24-33, and the 110 interchange
    // in the foreground at x 47-67, y 82-100.
    //
    // Night: downtown's windows and crowns, then the basin's carpet of light,
    // west and east of the towers and in the near foreground.
    lights: [
      [52.8, 38.8], [63.8, 32.5], [59.4, 60.3], [63.5, 42.3], [47.0, 56.5],
      [49.1, 61.0], [51.9, 59.8], [55.1, 43.3], [42.6, 56.8], [42.8, 50.5],
      [55.1, 51.5], [57.5, 43.5], [61.9, 60.3], [51.9, 53.5], [75.0, 58.3],
      [48.3, 51.2], [59.3, 52.0], [59.7, 43.5], [52.3, 45.0], [63.8, 56.5],
      [57.3, 59.8], [54.0, 57.5], [66.6, 58.0], [61.1, 23.5], [71.0, 52.0],
      [61.9, 54.0], [61.1, 30.5], [38.2, 57.8], [42.8, 61.8], [69.7, 61.8],
      [68.7, 50.5], [72.2, 58.3], [71.4, 46.0],
      // The basin west of downtown.
      [8.8, 88.8], [8.2, 80.8], [37.8, 95.0], [23.5, 68.5], [11.1, 76.8],
      [15.7, 86.5], [19.6, 66.5], [27.5, 93.5], [28.7, 67.3], [24.4, 59.0],
      [31.3, 77.8], [23.4, 79.0], [15.0, 62.3], [34.2, 67.8],
      // East of downtown, and the near foreground either side of the freeway.
      [80.5, 86.3], [91.0, 96.3], [84.8, 88.0], [76.6, 70.8], [76.1, 80.8],
      [81.3, 70.8], [89.1, 68.5], [78.3, 62.5], [57.5, 83.8], [71.2, 93.3],
      [71.2, 78.3], [44.5, 98.5], [44.8, 87.0], [68.1, 93.0], [45.5, 69.8],
      [75.0, 71.3], [54.5, 81.3],
    ],
    // Aviation red on the crowns. Each of these is a strict-red local maximum
    // (r >= 180, g <= 110) with OPEN SKY in the 6-16 rows above it, which is
    // what separates a crown from a tail-light on the freeway (the plain red
    // search returned thirty of those first). The pair at x 58-59 are the two
    // corners of one roof; City Hall's is the beacon on its tip.
    beacons: [
      [58.0, 34.8], [59.0, 35.3], [67.3, 50.0], [56.5, 37.8], [63.2, 31.8],
      [50.0, 43.0], [46.9, 53.0], [79.0, 56.8], [81.7, 60.0], [71.7, 49.3],
      [21.5, 57.5], [85.5, 60.0], [10.4, 61.8],
    ],
    beaconTone: 'red',
    // Steam off three rooftops (first lit row of each column): the tower west
    // of the cluster, the glass tower east of the US Bank tower, and a low
    // block behind City Hall. Not the tower at x 50: its crown carries a beacon.
    steam: [[44.0, 54.8], [66.0, 39.5], [74.0, 55.0]],
    // The interchange. Two straight stretches, traced light by light and then
    // drawn back on the frame: the elevated run at the top of the curve
    // (x 48-53) and the main freeway where it straightens toward the bottom
    // edge (x 56-64.5, dropping 6.5% over 8.5%). The overpass at y 90 between
    // them would overlap the freeway in x, so it carries no rail. The police
    // car works the freeway.
    bridge: [
      {
        lights: [[50.0, 85.5], [52.0, 87.3]],
        deck: { x: 48, y: 84.2, w: 5, rise: 3 },
      },
      {
        lights: [[56.0, 90.8], [58.5, 94.5], [60.5, 94.0], [63.5, 96.3]],
        deck: { x: 56, y: 92.5, w: 8.5, rise: 6.5 },
        police: true,
      },
    ],
    // East to west over downtown, the way the LAX approach runs. The sky is
    // clear above card y 10 from x 9 to x 92 (the palms own both corners,
    // reaching y 4.5 at x 6 and y 3.3 at x 94; the needle stops at y 12), so
    // the plane flies at 8 and fades inside the palms at each end.
    aircraft: { y: 8, from: 88, to: 12, flight: 40 },
    // The flock spreads 6.4% above its lane and 11.5% below; at y 12 it stays
    // between 5.6 and 23.5, and the ridge never rises past 24.
    birds: { y: 12, from: 86, to: 14, flight: 34, count: 6 },
    // An LAPD helicopter low over the west basin at sunset, west to east,
    // against the mountains' face; it fades before the towers at x 48.
    helicopter: { y: 40, from: 14, to: 48, flight: 46 },
    // The basin's smog: the pale band between the mountains' base (y 45-50)
    // and the mid-rise band (y 55-66). The default warm-grey tone, which is
    // what the basin is.
    haze: { y: 46, height: 14 },
    // The golden-hour sun is OFF-FRAME LEFT: the left edge is the brightest
    // edge, the sky column means fall from 219 at x 0 to 207 at x 90, and the
    // edge column peaks (lum 228) at y 36-40, just above the ridge.
    flare: { x: -6, y: 36 },
    rainfall: true,
  },
  sanfrancisco: {
    // MASTHEAD-SANFRANCISCO-3 (2026-09-07): the THIRD San Francisco pack. Ten
    // frames now (Cloudy and RainNight joined the eight), one drawing on all
    // ten (lag 0-1px), and a new viewpoint from the Marin headlands looking
    // south-east, so every coordinate here was measured again.
    //
    // The Golden Gate fills the frame: north tower at x 26.3 (top card y 22.8),
    // south tower at x 75.1 (top y 25.3), the deck running between them and on
    // to Fort Point at x 85-90. Downtown sits behind at x 33-96 with the
    // Salesforce Tower spiking to y 5 at x 60. The Marin headland occupies the
    // whole left third, its rocky foot breaking white from x 17 to 27. Water
    // fills everything below the deck.
    //
    // Downtown and the shoreline, west to east.
    lights: [
      [71.8, 39.5], [82.4, 40.5], [57.4, 44.3], [37.0, 37.5], [38.8, 38.5],
      [57.3, 39.0], [79.0, 44.3], [78.2, 38.8], [86.7, 54.8], [74.7, 42.8],
      [77.6, 49.0], [52.0, 42.8], [43.3, 40.3], [91.6, 36.0], [59.2, 40.3],
      [61.3, 45.0], [72.7, 31.8], [71.2, 46.5], [68.3, 41.0], [64.8, 44.3],
      [95.9, 57.3], [65.6, 38.5], [67.7, 47.5], [49.5, 37.0], [61.6, 40.8],
      [79.5, 51.5], [94.3, 29.8], [68.5, 30.5], [93.5, 35.5], [56.9, 31.8],
      [45.6, 40.3], [67.8, 36.8], [33.1, 28.0], [47.6, 35.3],
    ],
    // THE TOWERS BLINK RED (Owner). The Golden Gate is International Orange
    // from top to bottom, so a plain red search returns the whole structure -
    // these are the topmost red rows of each tower, which is where the real
    // aviation lights sit, plus one at deck height on each where the artwork
    // carries a second lamp.
    beacons: [
      [26.3, 22.75], [26.2, 45.0], [75.1, 25.25], [75.7, 39.5],
    ],
    beaconTone: 'red',
    // THE DECK IS A CATENARY SEEN IN PERSPECTIVE, so it rises toward the middle
    // of the frame rather than sagging: y 64.8 at the north tower, 61.8 across
    // the centre span, back to 63.0 approaching Fort Point. One straight rail
    // through all of that leaves the cars 2% off the roadway at the ends, so it
    // is two, meeting at x 56. Every declared light is within 1.8% of its rail.
    bridge: [
      {
        lights: [
          [21, 65.0], [25, 64.8], [29, 64.0], [33, 63.5], [37, 63.0],
          [41, 62.7], [45, 61.0], [49, 61.3], [53, 61.5],
        ],
        deck: { x: 20, y: 64.8, w: 36, rise: -3.0 },
        police: true,
      },
      {
        lights: [
          [57, 61.8], [61, 61.5], [65, 61.8], [69, 61.8], [74, 62.0],
          [77, 62.3], [81, 62.5], [87, 63.0], [91, 61.8],
        ],
        deck: { x: 56, y: 61.8, w: 36, rise: 1.2 },
      },
    ],
    // The bridge's reflection. THE ARTWORK PAINTS STREAKS, NOT DISCS: each
    // deck lamp throws a broken vertical chain of amber down into the water,
    // which is exactly what this effect draws, so the shimmer goes on the
    // streaks rather than inventing round bokeh that would fight the painting.
    // Every point verified as a vertical smear and taken from below the deck.
    water: [
      [26.2, 96.25], [26.5, 78.0], [26.7, 87.0], [32.6, 95.25], [37.1, 86.5],
      [40.8, 89.25], [54.6, 86.75], [58.8, 84.5], [62.7, 87.75], [70.5, 86.0],
      [74.5, 81.0], [76.2, 90.0], [76.7, 77.5], [79.6, 85.25], [84.0, 77.0],
      [88.1, 82.0], [89.3, 69.75],
    ],
    // Sun sparkle on the bay, taken east of x 32 so none of it lands in the
    // headland's foam, which the pale detector otherwise reports first.
    glints: [
      [80.3, 72.0], [85.8, 77.0], [75.3, 67.8], [88.3, 63.7], [94.2, 76.8],
      [89.7, 75.3], [92.5, 64.0], [85.3, 62.5], [96.5, 76.3], [66.0, 74.0],
      [58.0, 79.0], [46.0, 82.0], [38.0, 88.0], [51.0, 91.0],
    ],
    // Waves breaking on the headland's rocky foot (Owner). The shore runs
    // diagonally out of the bottom-left, from (17, 91.5) up to (27, 83), so
    // the crests follow it rather than lying flat.
    surf: [
      [17, 91.5, 4, -3.7], [21, 87.8, 3, -2.8], [24, 85.0, 3, -2.0],
    ],
    // The open bay beyond the bridge, where the chop reads.
    swell: { x: 30, y: 70, w: 66, height: 16 },
    // A ferry on the bay behind the bridge, white like the boats the day
    // frames already carry.
    ferry: { y: 58, from: 96, to: 34, flight: 150 },
    ferryTone: 'white',
    // THE SKY IS TINY ON THIS PACK. The hills close it off at card y 13-16 by
    // day (y 22-26 at night), and the Salesforce Tower spikes to y 5 at x 60.
    // Everything airborne therefore flies high and stops short of that tower.
    aircraft: { y: 4, from: 96, to: 64, flight: 40 },
    birds: { y: 9, from: 94, to: 66, flight: 34, count: 6 },
    helicopter: { y: 11, from: 66, to: 96, flight: 46 },
    // San Francisco's fog, on the water rather than the skyline: the white
    // tone, laid across the bay behind the bridge. Seattle's first pass put
    // marine fog at skyline height and drew a white bar across the city.
    haze: { y: 52, height: 12 },
    hazeTone: 'fog',
    // The golden-hour sun is off-frame RIGHT: the right edge is the brightest
    // edge pixel and the sky column means climb from 185 at x 0 to 216 at 90.
    flare: { x: 106, y: 4 },
    rainfall: true,
  },
  newyork: {
    // MASTHEAD-NEWYORK-3 (2026-09-07): the THIRD New York pack, and the first
    // in the registry to carry ALL TWELVE scenes - Cloudy and RainNight joined
    // the ten, so nothing falls back. One drawing on all twelve (lag 0-2px,
    // r 0.926-0.980). New viewpoint from the harbour looking north-east.
    //
    // Liberty Island fills the left third with the statue at x 22.5 and her
    // torch at y 49.5. One World Trade stands at x 40.5 with a RED spire
    // beacon at card y 2.4. Lower Manhattan runs x 30-58, midtown behind it to
    // x 72, then the Manhattan and Brooklyn bridges at x 57-92. Water fills
    // everything below y 58.
    //
    // Manhattan's towers, then the shoreline, Jersey City and Brooklyn.
    lights: [
      [50.0, 36.5], [48.3, 40.3], [37.8, 36.5], [53.1, 34.0], [38.0, 47.8],
      [46.3, 41.3], [54.9, 46.3], [36.0, 35.8], [65.5, 38.0], [48.5, 31.8],
      [55.4, 35.5], [59.0, 31.8], [61.8, 30.3], [65.0, 31.8], [28.1, 46.3],
      [75.4, 45.3], [53.1, 41.3], [38.3, 41.8], [54.9, 42.5], [72.0, 42.8],
      [50.3, 45.5], [32.6, 47.8], [63.9, 46.0], [51.3, 40.5], [57.8, 46.3],
      [58.7, 25.8],
      [30.3, 56.5], [43.5, 55.3], [95.8, 55.8], [7.9, 54.5], [62.5, 50.7],
      [83.4, 45.3], [66.6, 51.5], [10.5, 53.5], [95.8, 48.3], [90.9, 52.5],
      [16.8, 47.3], [60.1, 50.7], [73.7, 53.0], [88.0, 51.7], [98.5, 52.8],
      [93.8, 53.3], [22.4, 50.7], [1.7, 54.8], [50.4, 55.3], [86.3, 51.0],
      [6.0, 56.5], [60.4, 56.5],
    ],
    // Aviation red. ONE WORLD TRADE'S SPIRE BEACON IS THE ONE THAT MATTERS -
    // a clean red point at the very top of the card, x 40.5 y 2.4 - and the
    // rest are strict-red maxima with open sky above them across the skyline
    // and the Brooklyn shore.
    // The spire light carries a third element, 'glow', because it is not an
    // aviation blink: One World Trade's is the one beacon on this card that
    // names the building, and a 6px dot that spends nine tenths of its cycle
    // at opacity 0.12 does not read as lit at all (Owner: "the red light in
    // the one world trade center tower also doesn't glow"). A 'glow' beacon is
    // larger and breathes between half and full instead of flashing.
    beacons: [
      [40.5, 2.4, 'glow'], [36.9, 43.8], [31.6, 38.8], [12.1, 42.8], [88.8, 40.3],
      [83.4, 45.8], [88.2, 48.3],
    ],
    beaconTone: 'red',
    // MASTHEAD-TORCH-1 (Owner: "pulsing statue of liberty torch"). The flame
    // is a single warm point at the top of the raised arm, measured off the
    // Night frame at x 22.5, y 49.5. It gets its own kind rather than joining
    // `lights`: a torch is a FLAME, so it breathes deeper and slower than a
    // window does, and it is the one light on this card that should draw the
    // eye. Runs in every scene - the torch is lit by day too.
    torch: { x: 22.5, y: 49.5 },
    // MASTHEAD-STRIKE-1 (Owner). Forked lightning that HITS One World Trade.
    // x and y are where the bolt's TIP lands, not where its box sits: the tip
    // is 21% across and 80% down inside its own image, so anchoring the box
    // put the fork beside the tower instead of on it (Owner: "its tip should
    // hit the tower ... as if it got hit"). The component measures each
    // shape's tip and places the box so both land here, on the tower's
    // shoulder just under the roofline at y 15-16, with the spire and its red
    // beacon standing inside the fork. The sky FLASH runs with it on the same
    // double-tick - the flash is the sky lighting up, this is where it came
    // down.
    strike: { x: 40.5, y: 16, w: 11 },
    // The bridge's reflection and the harbour's - 42 points, each verified as
    // a vertical smear below the waterline. This is the "water light bokeh":
    // the artwork paints broken chains of light on the chop, and these breathe
    // on them.
    water: [
      [0.8, 66.75], [3.9, 66.25], [6.9, 65.5], [9.9, 65.0], [12.9, 84.0],
      [14.1, 64.25], [16.2, 89.0], [18.5, 87.25], [21.4, 79.0], [21.5, 70.5],
      [22.0, 92.5], [24.6, 88.5], [28.1, 86.25], [31.7, 60.0], [33.1, 86.75],
      [36.4, 60.75], [40.5, 68.75], [40.9, 60.25], [46.0, 63.5], [48.5, 75.0],
      [49.5, 64.5], [54.9, 63.5], [55.9, 74.0], [58.3, 62.75], [64.8, 73.75],
      [66.0, 62.25], [68.5, 67.0], [70.7, 60.75], [73.1, 69.0], [73.9, 60.0],
      [75.4, 69.25], [78.0, 70.75], [79.8, 79.5], [80.3, 62.5], [83.7, 74.25],
      [84.9, 62.0], [88.2, 63.75], [88.8, 73.75], [92.0, 76.0], [92.6, 60.75],
      [95.5, 76.0], [98.7, 77.25],
    ],
    // Sun glitter on the harbour - white sparks scattered over the chop, the
    // way San Francisco's read (Owner). This water has no breaking crest in
    // it, so there is no surf here: the first pass laid three and they read as
    // a shoreline that the artwork does not paint.
    glints: [
      [35.9, 60.8], [44.9, 62.5], [88.7, 68.0], [56.0, 60.3], [73.1, 60.8],
      [70.3, 66.5], [86.0, 67.0], [34.2, 73.3], [86.4, 73.5], [88.0, 88.8],
      [58.6, 87.0], [93.1, 75.5], [84.0, 62.7], [52.4, 64.0], [46.8, 64.3],
      [91.3, 75.3], [67.8, 64.3], [79.7, 62.5], [91.0, 69.3], [88.0, 85.3],
      [30.3, 87.3], [60.0, 88.5], [28.1, 87.0], [43.4, 62.0], [24.4, 86.0],
      [48.9, 63.5], [98.5, 75.5], [81.1, 63.0], [82.2, 74.5], [81.1, 70.8],
    ],
    // Both East River crossings, far then near, traced light by light. They do
    // not overlap in x: two rails on one stretch would stack traffic.
    // MASTHEAD-NY-DECK-2 (Owner: "the cars seem to elevate from the bridge in
    // the right side part"). Both rails were re-traced on the roadway itself,
    // by walking the brightest continuous band across the span in the Night
    // frame and again in the Day frame, which agree to within a pixel. The
    // first pass fitted the rails to bright points that were NOT on the
    // roadway - the near span's sat on the cables and the city behind them,
    // several of them on pixels darker than the frame's own mean - and the
    // guard below only checks that a span's lights and its line agree with
    // EACH OTHER, so a rail measured wrong and lit wrong passes it. Both
    // spans fall to the right in perspective: the far one 4.3% of the card
    // across its length, the near one 7.8%, where the old rails fell 0.4 and
    // 3.2 and left the traffic climbing off the bridge at the Brooklyn end.
    bridge: [
      {
        lights: [[58, 55.75], [59.8, 56.25], [62.5, 57.25], [64.5, 57.75], [67.2, 59.0], [70, 59.5], [72.2, 59.75]],
        deck: { x: 57, y: 56.4, w: 16, rise: 4.3 },
      },
      {
        lights: [[75.2, 60.5], [77, 61.5], [79.8, 63.75], [81.8, 65.0], [83.8, 65.0], [86.5, 66.25], [88.8, 68.5], [91, 69.25]],
        deck: { x: 75, y: 61.5, w: 16, rise: 7.8 },
        police: true,
      },
    ],
    // Steam off three Manhattan rooftops - the thing New York actually does.
    steam: [[44.0, 41.0], [52.0, 38.5], [61.0, 34.5]],
    swell: { x: 26, y: 64, w: 70, height: 16 },
    // A Staten Island ferry across the harbour, white like the boats the day
    // frames already carry.
    ferry: { y: 80, from: 96, to: 30, flight: 150 },
    ferryTone: 'white',
    // The skyline tops out at card y 25 (One World's spire reaches 2.4 at
    // x 40.5), so the crossings keep east of the tower and above the rest.
    aircraft: { y: 8, from: 96, to: 46, flight: 40 },
    birds: { y: 14, from: 94, to: 48, flight: 34, count: 6 },
    helicopter: { y: 20, from: 48, to: 96, flight: 46 },
    // Harbour haze along the far shore, white rather than a basin smog.
    haze: { y: 44, height: 11 },
    hazeTone: 'fog',
    // The golden-hour sun is off-frame LEFT: the left edge is the brightest
    // edge pixel (241) and the sky column means fall from 212 at x 0 to 161
    // at x 90.
    flare: { x: -6, y: 16.5 },
    rainfall: true,
    snowfall: true,
  },
  lasvegas: {
    // MASTHEAD-LASVEGAS-3 (2026-09-07): the THIRD Las Vegas pack. Ten frames
    // now (Cloudy and RainNight joined the eight), one drawing on all ten
    // (row-edge Pearson: lag 0 or 1px, r 0.967-0.987), and every coordinate
    // re-measured on these frames.
    //
    // The valley from the south-east: the Strat at x 11.7 (mast to card y 23,
    // its red pod band at 28-31), the High Roller at x 39.35, the Sphere at
    // x 46.9, Paris's tower at x 64, the Luxor pyramid at x 84.2 and the sky
    // beam beside it at x 87.9, mountains behind, two arterial roads across
    // the suburb in front.
    //
    // Night: the Strip's facades and crowns, then the suburb's lamps.
    lights: [
      [64.5, 66.3], [47.4, 70.3], [64.0, 46.3], [55.1, 71.5], [45.3, 67.8],
      [44.8, 62.5], [47.4, 55.3], [9.3, 67.0], [64.0, 61.0], [91.0, 71.8],
      [47.2, 61.8], [64.1, 53.3], [55.6, 57.5], [19.6, 71.3], [6.6, 61.5],
      [92.0, 64.3], [20.5, 58.3], [69.0, 70.0], [52.3, 58.0], [32.7, 50.5],
      [2.6, 71.0], [28.5, 69.5], [58.1, 55.3], [29.5, 51.2], [67.7, 58.0],
      [79.3, 61.8], [94.8, 69.3], [9.3, 61.8], [13.2, 69.8], [92.0, 55.5],
      [50.1, 55.3], [18.3, 64.3], [99.5, 67.0], [0.4, 69.5], [85.8, 63.2],
      [12.3, 61.3], [69.9, 60.3], [17.6, 55.8], [23.6, 68.8], [4.8, 71.3],
      // The suburb's lamps, off the two road rails.
      [50.8, 84.0], [99.2, 83.0], [21.0, 80.3], [10.0, 74.8], [37.2, 76.0],
      [13.3, 78.3], [23.9, 83.8], [92.7, 72.8], [63.0, 75.8], [96.0, 87.5],
      [84.5, 78.0], [74.3, 97.8], [69.2, 76.5], [47.6, 75.3], [37.0, 93.5],
      [75.9, 83.3],
    ],
    // Aviation red. The Strat's pod band is the pair at x 11.7 - the "sky
    // above" test FAILS on those two, correctly, because the mast continues
    // above them, so they are taken from the column profile instead. The rest
    // are strict-red maxima with open sky overhead: Paris's tip at x 64, the
    // two crowns on the block at x 31-34, and the towers at 66 and 78.
    beacons: [
      [11.7, 28.5], [11.7, 31.3], [64.0, 46.5], [33.7, 50.7], [31.3, 50.7],
      [78.1, 47.8], [66.3, 56.8],
    ],
    beaconTone: 'red',
    // Neon: the saturated magenta and cyan maxima of the Strip's signage. The
    // wheel's rim, the Sphere's skin and the beam are left to their own kinds.
    neon: [
      [9.6, 57.5], [63.1, 68.8], [78.6, 71.5], [5.0, 68.5], [40.6, 70.8],
      [22.0, 62.7], [26.7, 68.5], [81.5, 72.0], [23.9, 53.3], [33.8, 72.8],
      [39.4, 62.7], [61.6, 58.3], [38.5, 68.3],
      [26.9, 57.3, 'cyan'], [73.9, 47.5, 'cyan'], [24.5, 58.5, 'cyan'],
      [76.4, 68.0, 'cyan'], [84.0, 59.0, 'cyan'], [72.0, 57.3, 'cyan'],
      [52.8, 53.8, 'cyan'], [67.0, 57.3, 'cyan'], [8.5, 68.5, 'cyan'],
    ],
    // The High Roller, fitted rather than eyeballed: the rim's topmost pixel is
    // (39.35, 47.25) and its half-chord is 1.80 at y 54.75, which solves to a
    // radius of 1.83% of the card WIDTH. Diameter is a share of the width
    // because the ring is square in pixels and the card is not; the fit
    // predicts the measured span within 0.2% at every row above the skyline.
    wheel: { x: 39.35, y: 56.4, d: 3.66 },
    // The Sphere: the largest solid-yellow component on the Night frame spans
    // x 44.50-49.30 with its top at y 55.0, so it is 4.80% across, 24.0% tall,
    // centred at y 67.0, and the skyline cuts it 67% of the way down.
    orb: { x: 46.9, y: 67.0, d: 4.8, cut: 67 },
    // MASTHEAD-SPHERE-FACE-1 (Owner): the Sphere is left blank in emoji yellow
    // on the Night frame precisely so a face can be drawn on it, and the eyes
    // look around the valley. Same disc as the orb above - it has to be, or
    // the face slides off the sphere - and gated to Night alone, which is the
    // only frame where the artwork's Sphere is that flat yellow (Golden Hour
    // is orange, Cloudy Night orange, Rain Night purple, and the daylight
    // frames paint it blue). The face sits in the TOP 67% of the disc because
    // that is all the skyline leaves visible.
    emoji: { x: 46.9, y: 67.0, d: 4.8 },
    // The Luxor sky beam, standing on the pyramid's apex where it belongs
    // (Owner). The frame paints a PURE WHITE LAMP there - x 84.25, y 57.5-59,
    // rgb(255,255,255) against a sky at lum 33 - and no shaft above it: the
    // sky column means over the apex are 36-42, flat. So the artwork gives the
    // beam its source and leaves the shaft to us, which is exactly what this
    // effect is for.
    //
    // I first put it at x 87.9, on the one column between x 80 and 96 that IS
    // elevated (mean 56 against 46 either side). That column is real, but it
    // rises from Mandalay Bay's roofline, not from the Luxor, and following it
    // meant drawing the city's most recognisable landmark in the wrong place.
    // Brightest is not the same as right.
    beam: { x: 84.25, y: 57.5, height: 38.0, width: 2.4 },
    // Two arterial roads across the suburb, traced light by light. The suburb
    // is a carpet of lamps rather than a lit roadway, so the trace scatters:
    // these are the lights within 1.4% of each fitted level, and none of the
    // kept ones is more than 1.33% off the line the cars ride.
    bridge: [
      {
        lights: [
          [3.0, 77.0], [10.0, 74.8], [13.5, 74.8], [18.0, 76.8], [30.0, 75.0],
          [32.0, 75.5], [34.0, 75.3], [41.5, 76.0], [43.0, 77.0], [45.5, 75.8],
          [47.5, 75.3], [51.0, 76.5], [60.5, 77.0], [63.0, 75.8], [65.0, 76.3],
          [69.0, 76.8], [73.5, 75.3], [75.5, 75.0], [77.5, 75.5], [80.0, 77.0],
          [81.5, 75.8], [85.0, 74.5], [88.5, 76.5], [95.0, 75.3], [98.0, 76.5],
        ],
        deck: { x: 1, y: 75.83, w: 98, rise: 0.0 },
        police: true,
      },
      {
        lights: [
          [3.5, 83.5], [6.5, 83.0], [11.0, 83.0], [17.5, 84.8], [20.0, 83.0],
          [21.5, 83.0], [24.0, 83.8], [27.5, 84.0], [32.0, 83.3], [33.5, 84.5],
          [35.0, 84.5], [36.5, 84.8], [40.5, 82.8], [45.0, 84.3], [51.0, 83.8],
          [53.0, 85.0], [56.0, 83.8], [59.5, 84.3], [64.0, 84.8], [66.0, 83.5],
          [73.5, 84.5], [76.0, 83.3], [79.5, 82.8], [82.5, 82.8], [85.5, 83.8],
          [89.0, 84.3], [90.5, 83.8], [92.0, 83.8], [94.5, 83.3], [97.5, 83.5],
        ],
        deck: { x: 1, y: 83.87, w: 98, rise: 0.0 },
      },
    ],
    // The ridge tops out at card y 30.8 and the Strat's mast reaches 23, so
    // the crossings run east of it and above the range.
    aircraft: { y: 12, from: 98, to: 22, flight: 40 },
    // The flock spreads 6.4% above its lane and 11.5% below, so a lane at 16
    // spans y 9.6-27.5 and clears the ridge everywhere along its run.
    birds: { y: 16, from: 96, to: 26, flight: 34, count: 6 },
    helicopter: { y: 24, from: 26, to: 96, flight: 46 },
    // Morning haze on the valley floor behind the Strip (the far lights band
    // at y 44-56), white rather than a basin smog; the towers stand out of it.
    haze: { y: 44, height: 12 },
    hazeTone: 'fog',
    // THE SUN CHANGED SIDES with this pack. It is off-frame RIGHT now: the
    // brightest edge pixel on Golden Hour is the right edge, and the sky
    // column means rise monotonically from 193 at x 0 to 221 at x 90. The
    // second pack's art was lit from the left.
    flare: { x: 106, y: 7 },
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
    // MASTHEAD-HONOLULU-2 (2026-09-06): the SECOND Honolulu pack replaced the
    // first. Ten frames now (RainNight joined the nine), one drawing on all ten
    // (row-edge Pearson: lag 0 on nine of them, 1px on Sunset), and a viewpoint
    // that dropped closer to the water, so every coordinate here was measured
    // again on these frames and read straight off the artwork.
    //
    // The view is still Waikiki looking east to Diamond Head, but from lower
    // down and further out: the Koolau range across the left (crest y 12-25),
    // the hotel towers from x 0 to 50 standing on a beach that runs from card
    // y 67 at the left edge to y 54 under the crater, Diamond Head at x 52-80,
    // and the bay filling the whole bottom half. The frame now paints an
    // outrigger canoe at x 24, surfers on the reef break, and a moon glitter
    // path down the right edge.
    //
    // Still no beacons. The reddest points on the night frame are sodium
    // street lamps (rgb 249,71,7 at x 16) exactly as in the first pack, so the
    // city goes without rather than inventing crowns. No bridge either.
    //
    // Hotel windows and shore lamps, west to east.
    lights: [
      [20.2, 58.3], [32.6, 55.3], [23.5, 56.5], [3.4, 61.5], [10.5, 60.3],
      [25.9, 56.8], [11.5, 36.0], [16.7, 56.5], [4.8, 49.3], [33.9, 42.8],
      [28.6, 59.0], [1.7, 33.8], [20.1, 34.5], [29.0, 35.8], [38.2, 45.8],
      [13.8, 55.0], [6.5, 59.3], [17.6, 42.5], [9.9, 45.5], [13.8, 43.8],
      [28.9, 49.8], [14.3, 49.0], [36.3, 53.3], [22.2, 36.8], [32.6, 49.0],
      [13.8, 60.5],
      // The shorefront east of the towers, out along Kapiolani to the crater.
      [50.9, 53.8], [79.4, 53.8], [60.3, 53.5], [68.3, 53.8], [55.4, 53.0],
      [73.4, 53.3], [44.6, 54.8], [75.6, 54.5], [47.0, 52.8], [85.9, 53.5],
      [50.7, 46.3], [53.3, 44.0], [61.6, 46.3], [58.3, 46.8], [83.8, 53.3],
      [66.9, 47.8], [77.0, 47.8], [64.6, 53.5], [53.3, 51.0], [40.1, 40.3],
    ],
    // THE SHORELINE IS A CURVE AND EVERY WET COORDINATE RESPECTS IT. Traced
    // off the Day frame as the last row of the pale sand strip in each column:
    // y 67.2 at the left edge, 62.4 at x 20, 57.9 at x 40, 54.8 at x 60, 53.5
    // at the right. A flat band of "water" between two y values would be half
    // beach, which is the mistake the first pack's first pass made.
    //
    // Reflections of the shore lights, each one verified as a VERTICAL SMEAR
    // (the warm run continues 14+ rows below the point) rather than a bright
    // pixel, which is what separates a reflection from the lamp casting it.
    // They stop at x 64: east of that the artwork's reflections are genuinely
    // short and faint, and the bright path down the right edge is MOONLIGHT,
    // which is neutral where this effect's glow is amber. It is left alone.
    water: [
      [1.3, 70.25], [5.1, 69.0], [5.6, 80.0], [9.4, 68.0], [14.5, 85.0],
      [14.7, 66.5], [18.1, 65.75], [24.9, 69.75], [30.4, 63.25], [33.9, 70.75],
      [35.8, 62.75], [40.9, 61.0], [48.6, 60.75], [53.3, 58.75], [56.8, 58.25],
      [63.9, 57.75],
    ],
    // Sun glitter. The sun is off-frame RIGHT on this pack (see flare), so the
    // glitter path is on the right half, and every point was required to have
    // eleven of the fifteen rows below it still reading blue so none of them
    // lands on foam or on the sand.
    glints: [
      [52.3, 81.0], [59.0, 86.25], [61.4, 80.0], [63.1, 89.25], [66.3, 82.75],
      [67.3, 92.0], [71.0, 83.75], [71.7, 95.5], [76.3, 86.25], [76.9, 97.0],
      [80.3, 88.25], [80.9, 81.0], [83.3, 95.5], [91.0, 92.75], [94.9, 61.25],
      [95.3, 69.25], [95.3, 79.5], [95.5, 91.75],
    ],
    // MASTHEAD-SURF-1, re-measured, and THIS ARTWORK BREAKS IN TWO PLACES.
    //
    // The beach set is the one that was here in the first pack and it is back
    // (Owner: "i don't see the waves in the seaside anymore"). Nine crests
    // laid 1.6% seaward of the traced sand edge, each rotated to the slope of
    // the shore beneath it, climbing the card west to east as the bay curves
    // away. THE REASON THIS WAS BRIEFLY LOST IS WORTH KEEPING: the second pack
    // paints no white shore break, so the foam trace scored the shoreline near
    // zero and the reef break 20-42, and the crests were moved out to follow
    // the strong signal. But the FIRST pack painted no shore break either -
    // both frames put soft turquoise shallows at the water's edge - so those
    // nine crests were never sitting on painted foam. They ARE the foam. A
    // detector that finds nothing here is not evidence that nothing belongs
    // here; it is only evidence that the artwork does not draw it.
    //
    // The reef set is what the second pack added: the line the surfers are
    // riding, out in the bay, sweeping DOWN toward the viewer from y 81.6 at
    // x 50 to y 97.8 at x 74 (slope 0.675, fitted on the twelve strongest
    // columns of the foam trace). Three contiguous crests carry it and a
    // fourth sits on the separate, flatter band further out at x 79. They are
    // placed on the CENTRE of the painted foam, not its upper edge: the
    // detector reports the strongest six-row window, which reads about 1.5%
    // high against a band thicker than that.
    //
    // Both sets run in EVERY scene - the sea does not stop breaking after
    // dark, and the night frames get the quieter amplitude, not none.
    surf: [
      // The shore break, west to east along the beach.
      [0, 68.4, 9, -1.9], [9, 66.5, 9, -2.25], [18, 64.25, 9, -1.75],
      [27, 62.5, 9, -1.9], [36, 60.6, 9, -2.2], [45, 58.4, 9, -1.3],
      [54, 57.1, 9, -1.0], [63, 56.1, 9, 0.0], [72, 56.1, 9, -0.33],
      // The reef break, and then the flatter band beyond it.
      [50, 81.6, 8, 5.4], [58, 87.0, 8, 5.4], [66, 92.4, 8, 5.4],
      [79, 89.5, 8, 2.0],
    ],
    // The calm open bay between the shore and the break, which is where the
    // chop reads: below the waterline everywhere across it (y 62 against a
    // shoreline of 57.6 at its west end) and above the foam.
    swell: { x: 42, y: 62, w: 56, height: 17 },
    // A catamaran on the Waikiki run, white like the boats already painted in
    // the Day, Golden Hour and Sunset frames. Lane y 66 is open water from the
    // right edge in to x 34, where the sand is still 6.7% above it, and it
    // stays inshore of the break the whole way.
    ferry: { y: 66, from: 96, to: 34, flight: 160 },
    ferryTone: 'white',
    // The approach into Honolulu, east to west, above both the clouds and the
    // Koolau (which reach y 12 at x 12 and y 22 by x 30). It flies at 7 so it
    // passes ABOVE the rainbow's apex at 10 rather than through it.
    aircraft: { y: 7, from: 96, to: 30, flight: 40 },
    // Seabirds over the bay - the one flock in this registry that flies BELOW
    // the skyline, because over the water is where Waikiki's birds are and a
    // dark silhouette reads on turquoise as well as on sky. THE LANE IS NOT
    // THE FLOCK: the six birds sit from 6.4% above the declared y to 11.5%
    // below it, so a lane at 74 running in to x 30 spans y 67.6 to 85.5 and
    // the shoreline at x 30 is 60.3 - the whole flock stays over water.
    birds: { y: 74, from: 96, to: 30, flight: 34, count: 6 },
    // A tour helicopter along the crater rim at sunset, whose summit is y 30.
    helicopter: { y: 24, from: 50, to: 96, flight: 46 },
    // Vog on the horizon: the DEFAULT warm-grey tone, not the white fog,
    // because of the mask. The smog mask fades off the left half and is full
    // strength from 56% rightward, which here is the crater's slopes (y 30-50)
    // and the sea horizon behind it (y 50-53), exactly where a marine haze
    // belongs. The white fog tone is feathered at the card edges only, so at
    // this height it would lay a bar across the open sky east of Diamond Head.
    haze: { y: 40, height: 11 },
    // The golden-hour sun is OFF-FRAME RIGHT and low: the brightest edge pixel
    // on both the Golden Hour and Sunset frames is the RIGHT edge (lum 241 and
    // 215), and the sky column means rise from 180 at x 0 to 200 at x 90.
    flare: { x: 106, y: 19 },
    // MASTHEAD-RAINBOW-1, re-placed on the new frame. A bow is centred on the
    // ANTISOLAR point, so with the sun off the right edge it belongs on the
    // LEFT half. Apex at x 35 (the box is x 18-52): the greeting grows
    // rightward as the card narrows and reaches x 40 by 768px, and at the 29
    // this started from the peak of the bow sat behind the word "Jester".
    // The box is y 10-44, which puts the arc over the Koolau with its feet
    // dissolving into the ridge - the CSS mask fades everything below 66% of
    // the height, so the visible band is y 10-32 and never reaches the hotel
    // towers at y 42-58. That is the change from the first pack, whose art put
    // the city lower: at the old y the feet landed inside the buildings.
    // Withdrawn below 768px, where the card changes aspect.
    rainbow: { x: 18, y: 10, w: 34, h: 34 },
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
