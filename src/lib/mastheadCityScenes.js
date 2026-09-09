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
  toronto: 'toronto',
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
  toronto: [43.65, -79.38],
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
  // MASTHEAD-HONGKONG-2: a different drawing, and the old anchor is now the
  // worst place on the card - at 24% the weather art sat on the ICC's crown,
  // which is the tallest thing in Kowloon and carries this pack's landmark
  // glow. Measured under a 12%-wide art box on the night frame, the ridge
  // never rises above y 12.5 between x 70 and 88, and above y 6.2 anywhere
  // west of 62. 74% is the deepest clear sky that still clears the greeting on
  // the left and the temperature readout on the right.
  hongkong: '74%',
  // MASTHEAD-TORONTO-1: the default 52% sits the moon on the financial
  // district's crowns, which on this pack reach card y 24-28 between x 50 and
  // 62, and the CN Tower's mast is immediately west of it at x 44.9 running
  // the full height of the card. So the art goes WEST of the tower, where the
  // skyline is at its lowest (nothing above card y 33 anywhere left of x 43)
  // and where this artwork's own light comes from: the sky column means fall
  // left to right on Morning, Golden Hour and Sunset alike.
  //
  // 18% and not further left, which is Rome's caution paid: the art box is a
  // FIXED 192px, so it is 13.7% of a 1360px card but 19.2% of a 1000px one.
  // Measured on both, with the CLOUD render rather than the moon because it is
  // the widest art the box ever holds: at 12% it closed to nothing against the
  // greeting on the narrow card (text ends 20.9%, box opened 13.7%); at 18%
  // the gap is clear on both, and the disc still sits 27% of the card short of
  // the CN Tower.
  toronto: '18%',
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
    // MASTHEAD-FACADE-1 (Owner). The Griffith Observatory is floodlit white,
    // so the warm-mask that found Rome's buildings barely sees it - only its
    // golden window band passes. Measured off the night frame instead: the
    // building runs x 60.5 to 71.5 and its lit colonnade sits at y 74 to 81,
    // with the entrance hall brighter than the wings. Two boxes, the building
    // and its doorway, because that is how the artwork lights it.
    facade: [[66.0, 77.3, 11.6, 9.4], [65.3, 76.5, 2.8, 10.4]],
    rainfall: true,
    // MASTHEAD-STARS-1 (2026-09-09, Owner: "blinking stars or comet (falling
    // star) animations in some of the clear night skies"). CLEAR NIGHT ONLY -
    // the CSS gates both kinds to `night` and to nothing else, because a star
    // seen through an overcast is the same lie as sun glitter under a cloudy
    // sky, which this registry already refuses to draw.
    //
    // These are measured the OTHER WAY ROUND from every other kind in this
    // file. A light is placed on something the artwork already paints; a star
    // is placed where the artwork paints NOTHING, so the measurement is a proof
    // of emptiness. Each point sits at least 4 per cent of the card above this
    // city's own skyline; its 7x7 neighbourhood still reads as sky (grey mean
    // within 26 of the frame's top rows, standard deviation under 9, so no edge
    // and no glow); and none lands under the moon, whose disc and halo were
    // measured off the render's own alpha (box px 53 to 149 of 192) rather than
    // assumed to fill the art box.
    // The mast at x 23 reaches the very top, so the field steps around it, and the
    // Observatory ridge closes the sky below y 27 across the right half.
    stars: [
      [6.13, 18.61], [14.2, 12.34], [22.01, 13.75], [22.14, 6.36], [24.85, 3.6],
      [25.43, 6.89], [29.34, 10.31], [41.19, 19.53], [52.86, 2.54], [53.24, 8.69],
      [53.85, 20.05], [56.35, 16.74], [57.01, 9.88], [62.93, 8.74], [66.74, 21.99],
      [68.5, 26.43], [70.16, 19.52], [72.01, 12.7], [76.88, 21.3], [82.76, 16.8],
      [83.07, 2.44], [86.92, 12.22], [91.08, 19.52], [93.9, 11.96], [95.34, 19.01],
      [95.64, 25.26],
    ],
    comet: { x: 74, y: 2, run: 6, drop: 17, flight: 1.1 },
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
    // MASTHEAD-STARS-1 (2026-09-09, Owner: "blinking stars or comet (falling
    // star) animations in some of the clear night skies"). CLEAR NIGHT ONLY -
    // the CSS gates both kinds to `night` and to nothing else, because a star
    // seen through an overcast is the same lie as sun glitter under a cloudy
    // sky, which this registry already refuses to draw.
    //
    // These are measured the OTHER WAY ROUND from every other kind in this
    // file. A light is placed on something the artwork already paints; a star
    // is placed where the artwork paints NOTHING, so the measurement is a proof
    // of emptiness. Each point sits at least 4 per cent of the card above this
    // city's own skyline; its 7x7 neighbourhood still reads as sky (grey mean
    // within 26 of the frame's top rows, standard deviation under 9, so no edge
    // and no glow); and none lands under the moon, whose disc and halo were
    // measured off the render's own alpha (box px 53 to 149 of 192) rather than
    // assumed to fill the art box.
    // The palms near x 5-10 and the towers at x 90-100 both reach past y 4, so the
    // field stops short of either edge.
    stars: [
      [3.21, 12.23], [3.38, 20.28], [8.82, 2.46], [11.35, 11.5], [17.21, 10.5],
      [22.19, 9.77], [23.28, 19.47], [25.55, 2.29], [46.13, 2.2], [46.97, 12.57],
      [49.18, 18.33], [51.09, 8.47], [54.27, 8.31], [55.22, 20.99], [61.18, 16.09],
      [62.38, 7.89], [62.43, 2.57], [65.72, 3.5], [65.86, 16.66], [70.99, 4.88],
      [74.43, 5.41], [77.71, 7.83], [78.85, 3.05], [85.32, 14.63], [86.17, 10.15],
      [87.23, 6.46],
    ],
    comet: { x: 52.5, y: 2, run: 6, drop: 17, flight: 1.1 },
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
      // A second pass, on the Owner's ask for more of them, from the water
      // mask described in Rio's entry: a colour model learned from this
      // frame's own reflection points plus a texture test, which is what
      // keeps the picks off the foam and the headland. The two nearest the
      // rocks still clear the westernmost crest by 1.5% of the card. Nothing
      // is taken below y 96 or outside x 0.6-99.2: a sparkle centred on the
      // card's edge is half a sparkle.
      [25.5, 89.5], [26.95, 89.75], [28.1, 84.75], [29.8, 83.25], [31.35, 85.25],
      [52.35, 89.5], [53.9, 90.0], [60.55, 94.75], [91.35, 95.25], [91.95, 80.5],
      [93.75, 95.75],
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
    // MASTHEAD-STARS-1 (2026-09-09, Owner: "blinking stars or comet (falling
    // star) animations in some of the clear night skies"). CLEAR NIGHT ONLY -
    // the CSS gates both kinds to `night` and to nothing else, because a star
    // seen through an overcast is the same lie as sun glitter under a cloudy
    // sky, which this registry already refuses to draw.
    //
    // These are measured the OTHER WAY ROUND from every other kind in this
    // file. A light is placed on something the artwork already paints; a star
    // is placed where the artwork paints NOTHING, so the measurement is a proof
    // of emptiness. Each point sits at least 4 per cent of the card above this
    // city's own skyline; its 7x7 neighbourhood still reads as sky (grey mean
    // within 26 of the frame's top rows, standard deviation under 9, so no edge
    // and no glow); and none lands under the moon, whose disc and halo were
    // measured off the render's own alpha (box px 53 to 149 of 192) rather than
    // assumed to fill the art box.
    // The deepest sky in the registry: the harbour leaves it open to y 40 at both
    // edges, so this field runs lower than any other. One WTC at x 40.5 is the
    // one column it never crosses.
    stars: [
      [2.2, 28.96], [4.78, 19.89], [6.64, 28.69], [10.73, 19.04], [16.8, 24.6],
      [17.38, 14.41], [22.69, 32.13], [36.9, 22.62], [37.34, 2.52], [38.27, 18.81],
      [39.04, 8.79], [42.24, 27.2], [47.33, 11.0], [49.1, 23.72], [49.18, 2.37],
      [58.32, 7.15], [63.65, 12.48], [65.35, 4.65], [68.35, 10.7], [68.95, 20.38],
      [72.81, 15.14], [75.61, 15.49], [84.24, 9.26], [86.02, 3.22], [90.26, 10.54],
      [95.34, 22.97],
    ],
    comet: { x: 69.5, y: 2, run: 6, drop: 17, flight: 1.1 },
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
    // MASTHEAD-WHEEL-2: re-measured as the CABIN RING rather than the hub, and
    // with a height, because a wheel is an ellipse on these cards. The High
    // Roller's is very nearly round - 80px by 78px - so its scale is 0.98.
    wheel: { x: 39.4, y: 56.2, d: 4.0, h: 19.6 },
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
    // MASTHEAD-HONGKONG-2 (2026-09-07): the SECOND Hong Kong pack, TEN frames
    // (RainNight joined), and a COMPLETELY DIFFERENT DRAWING from the first -
    // the edge correlation between the two Day frames is -0.02, so not one
    // coordinate carried over and every number here was measured again.
    //
    // The frames register to each other to the pixel: each one's best rigid
    // offset against this pack's own Day frame is 0, bar Cloudy at 1px.
    //
    // The view is the classic one from Victoria Peak, looking north-east.
    // Hong Kong Island fills the bottom third from x 8 to 92, framed by the
    // Peak's own dark foliage at both edges; Two IFC stands at x 41.7 with its
    // lit crown at y 40 and the Bank of China's twin masts at x 64.05/64.45
    // reach up to y 50.5. Victoria Harbour runs across the middle, roughly
    // y 45-76, with two painted junks in it. Kowloon lines the far shore from
    // y 22 to 45, the ICC rising out of it at x 30.35 with a crown glow at
    // y 7. The New Territories hills close the back at y 5-25, and one lit
    // ridge mast at x 53.75 is the highest thing on the card.
    //
    // Windows on both shores, and the far towns along the left ridge. The
    // harbour's own maxima are reflections and live in `water`; each of these
    // was tested against the water mask so none of them is one.
    lights: [
      [2.05, 40.5], [4.35, 33.5], [6.7, 30.75], [8.4, 29.75], [9.3, 67.75],
      [11.1, 74.25], [12.2, 20.25], [12.3, 26.5], [15.8, 28.0], [18.0, 42.25],
      [18.05, 27.75], [18.6, 71.5], [18.75, 84.75], [18.9, 31.0], [19.6, 23.25],
      [20.0, 96.25], [20.35, 76.25], [20.55, 40.25], [24.8, 88.25], [26.85, 92.5],
      [27.55, 37.0], [28.7, 42.5], [31.75, 42.75], [33.35, 69.5], [33.35, 91.25],
      [34.05, 33.25], [35.25, 78.5], [46.6, 40.75], [48.15, 22.75], [50.05, 21.75],
      [51.15, 95.75], [57.95, 91.0], [58.0, 21.75], [58.0, 87.75], [58.0, 94.25],
      [61.6, 41.75], [63.4, 21.75], [64.7, 84.0], [66.5, 84.75], [68.2, 31.25],
      [69.95, 75.0], [71.4, 81.0], [71.55, 75.0], [73.1, 78.25], [80.2, 26.75],
      [80.7, 30.0], [82.05, 77.5], [82.15, 96.0], [83.3, 27.75], [85.8, 87.25],
      [86.35, 57.25], [87.05, 83.5], [93.45, 66.5], [96.25, 57.25], [99.15, 69.5],
    ],
    // The tower tops, and the two that are landmarks. The ICC's crown and Two
    // IFC's are drawn as a lit halo rather than as a point, so both take the
    // 'glow' variant (MASTHEAD-BEACON-GLOW-1, first cut for One World Trade):
    // larger, and breathing between half and full instead of blinking. The
    // rest blink: the ridge mast above the highest peak, the crown at x 54.9,
    // the Bank of China's two masts, and the tower top at x 82. No
    // beaconTone - this artwork paints its crowns white and blue, not red, so
    // the default is what matches it.
    beacons: [
      [30.35, 7.0, 'glow'], [41.7, 40.0, 'glow'],
      [53.75, 2.0], [54.9, 19.0], [64.05, 50.5], [64.45, 50.5], [82.0, 44.5],
    ],
    // THE BOKEH. This is the effect the harbour is for: the artwork paints
    // every tower on both shores as a broken vertical chain of light on the
    // water, so the shimmer goes on the chains rather than inventing round
    // discs. Each one was accepted only if it is TALLER THAN IT IS WIDE at 72%
    // of its own peak - which is what separates a reflection from a boat or a
    // lit pier - and only if the water 2% either side of it is dark harbour
    // blue. A day-frame water mask disagreed with 13 of these; the mask was
    // wrong, not the reflections, because it needs 15 of the 18 rows below a
    // pixel to be water too and the island's towers break that near the shore.
    water: [
      [14.0, 48.25], [16.4, 53.25], [18.6, 71.75], [19.2, 47.75], [19.2, 51.25],
      [23.0, 51.5], [24.6, 55.5], [29.8, 57.5], [34.0, 49.75], [34.0, 57.75],
      [34.0, 70.75], [37.0, 75.25], [37.8, 54.25], [40.6, 65.0], [40.6, 71.75],
      [42.4, 52.5], [42.4, 57.25], [42.4, 65.5], [42.4, 70.5], [55.2, 51.5],
      [62.8, 68.75], [63.8, 64.0], [64.4, 75.0], [75.4, 51.75], [82.4, 58.0],
      [82.6, 47.75], [83.0, 52.0], [83.2, 72.75], [84.0, 66.5], [86.0, 60.0],
      [86.2, 72.75], [86.2, 76.25], [86.8, 67.75], [88.0, 75.75], [88.2, 56.0],
      [89.4, 48.75],
    ],
    // Sun sparkle on the harbour by day, the effect the Owner asked to see in
    // every city that has water. From the learned-colour mask (see Rio), and
    // none within 0.7% of a reflection: four candidates were dropped for
    // sitting on one, which would put two glows on the same patch of water.
    glints: [
      [5.35, 44.25], [10.8, 45.0], [13.8, 45.25], [29.2, 60.75], [29.4, 51.0],
      [30.6, 54.75], [43.2, 53.25], [45.8, 54.0], [50.55, 77.5], [52.6, 50.0],
      [52.8, 54.75], [54.05, 60.75], [55.0, 54.25], [57.05, 60.0], [57.1, 53.75],
      [58.8, 59.25], [59.4, 53.25], [60.1, 48.5], [61.3, 52.75], [67.0, 77.25],
      [75.3, 48.5], [86.95, 51.5],
      // MASTHEAD-WET-DAYLIGHT-1 (Owner: "I need glints in hongkong river").
      // Eleven more on the harbour itself, from the same mask with its density
      // rule relaxed from 15 rows in 18 to 10 in 12 - the strict version skips
      // the water near both shores, where the towers break the run below a
      // pixel. Relaxing it costs something: the mask then leaks onto BLUE
      // GLASS, which in this city is everywhere, so every candidate also had
      // to sit above the island's own skyline, and four were dropped for
      // standing on a tower.
      [24.4, 51.0], [44.45, 53.5], [46.6, 63.75], [46.7, 54.25], [51.4, 54.25],
      [54.0, 52.0], [58.6, 49.5], [60.0, 58.75], [69.6, 51.5], [77.2, 46.0],
      [85.7, 52.75],
    ],
    // Hong Kong is the neon city and this frame paints it: saturated signage
    // on the island's blocks. Constrained three ways, because the first pass
    // found none of it - it found the junk's red sails and a dozen of the
    // harbour's own coloured reflections. A neon sign here has to be below the
    // island's skyline, off the water, and saturated above 0.5. Eleven read
    // cyan and one reads magenta, which is the kind's DEFAULT tone - naming it
    // would have been a second word for the same glow.
    neon: [
      [8.7, 59.5, 'cyan'], [13.95, 63.25, 'cyan'], [19.05, 68.0, 'cyan'],
      [34.2, 63.25, 'cyan'], [60.85, 84.75, 'cyan'], [63.25, 72.75, 'cyan'],
      [65.75, 96.25, 'cyan'], [70.85, 68.0, 'cyan'], [79.4, 59.25, 'cyan'],
      [81.35, 77.25, 'cyan'], [86.4, 54.25, 'cyan'], [87.2, 71.25],
    ],
    // A boat in the eastern channel, which is the widest stretch of open water
    // on the card: 16% of the width with nothing standing in it. The harbour
    // is wider than this everywhere else, but Two IFC and the Bank of China
    // rise THROUGH it, and the motion layer draws above the artwork, so a
    // ferry crossing the middle would pass in front of two towers it should
    // pass behind.
    ferry: { y: 54.5, from: 80.5, to: 65.5, flight: 130 },
    ferryTone: 'white',
    // The chop, in the western harbour: 84% water by the mask, and the best
    // rectangle on the card that holds no tower.
    swell: { x: 14, y: 52, w: 26, height: 12 },
    // Above y 4 the sky is clear from x 26 east on every column, measured on
    // the night frame where the ridge is a clean silhouette. The lit mast at
    // x 53.75 reaches y 2, so the lane sits under it rather than through it.
    aircraft: { y: 3.5, from: 98, to: 26, flight: 40 },
    // Birds over the harbour rather than over the sky, which is what this view
    // actually shows: the flock spreads 6.4% above its lane and 11.5% below,
    // so at y 50 it fills 43.6 to 61.5, all of it water.
    birds: { y: 50, from: 94, to: 20, flight: 34, count: 6 },
    // A helicopter over Kowloon, low against the far shore's towers.
    helicopter: { y: 34, from: 96, to: 58, flight: 46 },
    // The humid band on the hills behind Kowloon, white rather than a basin
    // smog - this is sea haze.
    haze: { y: 12, height: 10 },
    hazeTone: 'fog',
    // The sun is OFF-FRAME RIGHT here, which is new for this registry: the sky
    // column means rise left to right in all three low-sun frames (GoldenHour
    // 191 -> 209, Sunset 114 -> 175, Dawn 119 -> 206). The component mirrors
    // the flare geometry for a sun past 50.
    flare: { x: 106, y: 16 },
    rainfall: true,
  },
  seattle: {
    // MASTHEAD-SEATTLE-2 (2026-09-09): the SECOND Seattle pack, and A DIFFERENT
    // DRAWING - the edge correlation between the two Day frames is 0.209, barely
    // above the 0.145 that made Tokyo's second pack a rewrite, so nothing from
    // the first pack survived and every number here was measured again. Twelve
    // frames now: RainNight joined the eleven. They register to each other
    // within one row of four hundred.
    //
    // Seattle_RainNight.png arrived RGBA with a UNIFORM alpha of 219 and was
    // flattened to RGB before cwebp, exactly as Rio's did. Encoded as-is it
    // would have shipped one translucent frame in twelve.
    //
    // The view looks south-east across Elliott Bay from the north-west. The
    // SPACE NEEDLE stands at x 20.1 and reaches the top of the card; downtown
    // fills x 8-48 with crowns between y 24 and y 33; the stadium roofs arch at
    // x 54-65; the PORT CRANES stand lit at x 67-75; MOUNT RAINIER fills
    // x 68-88 and rises to y 6.5; and the bay opens across the right half,
    // its near edge running from y 79 at x 42 up to y 61 at x 78.
    //
    // Windows, the waterfront and the hillside houses, taken as the brightest
    // warm maximum in each cell of a column-by-band grid.
    lights: [
      [2.2, 55.75], [4.6, 45.25], [6.5, 59.25], [8.1, 40.75], [8.45, 48.0],
      [11.95, 36.25], [12.15, 59.5], [13.15, 50.25], [15.15, 62.75], [17.2, 37.75],
      [19.35, 56.5], [19.5, 46.75], [20.25, 64.0], [25.8, 33.75], [26.05, 45.25],
      [26.85, 55.5], [28.0, 65.0], [28.15, 41.75], [30.15, 41.5], [30.3, 51.0],
      [30.5, 59.0], [32.9, 28.0], [36.5, 51.0], [37.45, 43.25], [38.2, 24.0],
      [39.15, 64.25], [40.35, 49.75], [42.9, 56.0], [44.4, 70.5], [44.9, 34.75],
      [45.15, 59.5], [45.35, 51.0], [47.3, 40.0], [49.75, 63.5], [50.2, 51.75],
      [52.65, 66.75], [52.75, 58.0], [57.6, 69.25], [57.85, 59.5], [58.25, 49.25],
      [61.9, 56.5], [62.2, 68.75], [65.05, 50.0], [66.05, 66.5], [68.45, 59.0],
      [71.55, 49.0], [72.95, 63.75], [76.4, 50.5], [76.55, 59.75], [80.1, 50.75],
      [83.2, 63.25], [86.25, 66.5], [89.55, 55.5], [91.2, 65.0], [92.0, 54.25],
      [94.7, 50.5], [97.9, 65.75], [99.3, 55.5],
    ],
    // Aviation red on the tower crowns and the tallest port crane. Detected the
    // way Toronto's were - red dominance, dark sky above, a red blob no larger
    // than 60 pixels - and then read one by one off a contact sheet, which
    // dropped thirty-two of fifty-four. Nearly all of those were warm windows
    // and floodlit orange steel, which colour alone cannot tell from a lamp.
    //
    // THE SPACE NEEDLE'S OWN LAMP IS NOT HERE. Its red spans rows 0 to 3 of the
    // source frame and is centred 1.5px from the top, so the ARTWORK has
    // already clipped it; a 6px beacon there is the half beacon Tokyo's two
    // tower tips were. The Needle is lit by `facade` instead, which is what the
    // frame actually shows.
    beacons: [
      [9.1, 38.75], [14.4, 41.25], [15.05, 30.75], [15.15, 26.25], [18.45, 38.25],
      [25.1, 36.25], [29.05, 30.25], [29.75, 30.0], [31.15, 46.75], [33.35, 47.75],
      [34.2, 38.25], [34.65, 43.25], [35.45, 48.5], [37.55, 52.0], [42.0, 44.25],
      [46.15, 46.5], [53.05, 51.25], [60.05, 59.5], [61.6, 49.75], [66.4, 50.0],
      [73.05, 50.25],
    ],
    beaconTone: 'red',
    // MASTHEAD-FACADE-1: the Space Needle, floodlit cream from its legs to its
    // saucer. Three boxes because the tower is three shapes, and the column
    // scan gives each: the SAUCER at y 8.5-13 where the lit structure widens to
    // 2.85% of the card, the SHAFT from y 13.5 to 35 at a steady 0.75-1.3%, and
    // the LEGS splaying to 4.25% below y 35. One ellipse over all three would
    // have been a lozenge over the skyline behind it.
    facade: [
      [20.1, 10.8, 3.2, 5.6], [20.1, 24.0, 1.5, 23.0], [20.2, 40.0, 4.6, 12.0],
    ],
    // Elliott Bay after dark. The columns of the bay that run brighter than
    // their own 60-column neighbourhood, which is what makes a reflection a
    // reflection: a streak, not a level. The bay's near edge is not level
    // either - it climbs from y 79 at x 42 to y 61 at x 78 - so the search
    // starts from that measured edge per column rather than from one row.
    water: [
      [42.5, 83.14], [44.35, 79.66], [46.65, 81.38], [47.45, 81.84], [48.9, 81.26],
      [50.2, 78.75], [51.2, 82.65], [51.85, 76.43], [53.5, 79.69], [56.2, 78.54],
      [57.85, 78.14], [59.05, 78.09], [60.8, 75.14], [62.5, 77.25], [63.05, 75.29],
      [64.95, 72.75], [66.35, 74.48], [68.65, 73.53], [70.35, 69.62], [71.15, 65.91],
      [73.05, 69.95], [73.75, 67.81], [79.8, 70.48], [83.2, 72.63], [86.25, 72.23],
      [90.0, 72.42], [91.2, 73.86], [94.45, 73.12], [97.9, 72.2],
    ],
    // Sun glitter, taken where the Day and Golden Hour frames INDEPENDENTLY put
    // a local maximum in the same place: 206 of Day's 259 agreed, and these are
    // the spaced best of those. The gap from x 50 to 62 is the piers and the
    // stadiums standing in front of the water, not a thin patch of measurement.
    glints: [
      [42.95, 96.75], [43.05, 76.0], [44.8, 94.75], [48.5, 78.0], [49.45, 95.0],
      [61.95, 78.5], [64.0, 70.75], [64.0, 79.0], [65.95, 74.0], [66.0, 79.5],
      [67.8, 79.75], [68.0, 72.0], [69.95, 68.75], [72.95, 63.25], [74.95, 65.5],
      [75.6, 76.5], [77.65, 72.5], [77.8, 67.0], [79.7, 76.25], [80.55, 67.75],
      [81.6, 76.0], [82.85, 68.5], [83.3, 88.75], [84.6, 75.75], [84.9, 68.75],
      [87.45, 76.0], [87.9, 86.75], [90.1, 74.25], [92.1, 84.0], [94.4, 83.75],
    ],
    // MASTHEAD-STARS-1: Seattle was held back from the first star pass because
    // this pack was coming. Its sky is as empty as New York's - brightened two
    // and a half stops it carries nothing but the Needle, one tower and
    // Rainier's snow - so it takes the same treatment, measured the same way.
    // Rainier is the reason the right third carries few: the mountain reaches
    // y 6.5 across x 68-88 and the field keeps 4% of card clear above it.
    stars: [
      [2.81, 16.05], [10.85, 3.33], [14.78, 7.34], [22.81, 13.9], [23.29, 10.42],
      [24.21, 2.79], [24.94, 21.46], [31.17, 12.52], [32.01, 4.79], [34.75, 11.9],
      [39.06, 13.98], [41.74, 8.86], [44.04, 13.13], [44.39, 21.9], [45.04, 5.36],
      [49.82, 24.34], [50.36, 3.41], [53.2, 22.12], [62.0, 21.77], [72.39, 5.83],
      [73.12, 14.97], [79.17, 2.67], [89.24, 18.6], [91.84, 3.46], [96.83, 13.94],
      [98.23, 23.92],
    ],
    comet: { x: 44.5, y: 2, run: 6, drop: 17, flight: 1.1 },
    // The chop, on open bay: clear of the piers, and inside the water at every
    // corner - which the obvious rectangle is not, because the near shore rises
    // to meet the trees on the left.
    swell: { x: 60, y: 78, w: 38, height: 16 },
    // A Washington State ferry on the Bainbridge run, white like the boats the
    // day frames carry. Lane y 80 is open water from the right edge in to x 56.
    ferry: { y: 80, from: 98, to: 56, flight: 150 },
    ferryTone: 'white',
    // Sky lanes, threaded between the two things that reach the top of this
    // card: the Space Needle at x 20 and Mount Rainier from x 68. Between x 40
    // and 68 nothing rises above y 26.5, and the one tower that breaks y 20 west
    // of that sits at x 32 and tops at 14.25, which only the aircraft passes
    // over.
    aircraft: { y: 7, from: 66, to: 24, flight: 40 },
    birds: { y: 10, from: 64, to: 40, flight: 34, count: 6 },
    helicopter: { y: 16, from: 40, to: 64, flight: 46 },
    // The bolt's TIP on a downtown roof at x 42, whose own beacon sits at
    // y 44.25. A w:10 fork is about 25% of the card tall, so this one's top
    // lands at y 8.5. The Needle and Rainier are both unstrikeable: either
    // would need most of the fork above the frame.
    strike: { x: 42, y: 33.5, w: 10 },
    // Marine layer over the far shore and the sound, which is what this city's
    // haze actually is - hence the fog tone rather than the warm-grey default.
    haze: { y: 40, height: 10 },
    hazeTone: 'fog',
    // The golden-hour sun is OFF-FRAME RIGHT, and two frames agree: the sky
    // column means RISE left to right on Golden Hour (194 to 205) and Sunset
    // (170 to 186). Morning falls the other way, which is the same sun on the
    // other side of the day and not a contradiction.
    flare: { x: 106, y: 18 },
    // NO BRIDGE AND NO TRAFFIC on this drawing, and no steam either. The old
    // pack had a lit deck with cars; here the arches at x 54-65 are STADIUM
    // ROOFS, not a span, and the waterfront's brightest row wanders over ten
    // per cent of the card between x 28 and 66 - a scatter of pier and building
    // lights, not a road holding a line. Nothing paints a chimney, so nothing
    // gets a plume.
    rainfall: true,
    snowfall: true,
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
    // MASTHEAD-RIO-2 (2026-09-07): the SECOND Rio pack, and the first drop
    // whose stated purpose was alignment. Ten frames now - CloudyNight and
    // RainNight joined the nine - and every frame registers to the same
    // drawing, which is what makes the timelapse sweep clean. Measured: each
    // scene's best rigid offset against the pack's own Day frame is 0 or 1px,
    // where the first pack ran 0 to 3px and each frame carried its own.
    //
    // EVERY NIGHT-MEASURED POINT MOVED UP 2px (0.5% of the card). The pack-1
    // points were correct for pack-1's Night frame and 2px low on this one:
    // the same rigid fit that reports 0 for the old frames reports -2 for the
    // new ones, on the lights, the beacons and the reflections alike. They
    // were then re-snapped point by point on the new Night frame, and every
    // one of the 61 lights now sits on a maximum at least 1.3x its own
    // surroundings.
    //
    // The view looks east from above Botafogo: Corcovado and the statue at
    // x 16, the favela hillside across the left, the Botafogo cove and its
    // promenade curving from x 31 to 62, Guanabara Bay filling the
    // centre-right with Niteroi on the far shore, and Sugarloaf at x 83 with
    // Urca below it.
    //
    // The city's own windows, the hillside, and the far shore.
    lights: [
      [3.05, 46.25], [3.8, 58.75], [13.1, 66.25], [15.2, 63.75], [7.2, 47.5],
      [2.75, 55.0], [11.1, 60.5], [10.85, 66.0], [7.2, 53.5], [0.9, 53.25],
      [8.3, 50.75], [15.4, 66.75], [1.0, 62.75], [5.4, 57.5], [16.85, 67.75],
      [34.6, 66.75], [26.2, 71.75], [24.85, 70.25], [24.55, 66.5], [18.85, 70.0],
      [35.65, 71.75], [28.5, 71.0], [17.4, 70.25], [30.3, 51.25], [31.75, 64.25],
      [36.9, 70.0], [35.05, 58.5], [33.1, 68.0], [22.3, 73.0], [29.4, 68.25],
      [48.45, 58.75], [51.4, 68.0], [48.6, 69.75], [43.1, 68.5], [45.55, 71.0],
      [39.6, 71.0], [57.9, 52.75], [54.75, 65.0], [53.35, 66.25], [47.0, 69.25],
      [43.95, 54.0], [41.35, 71.25], [51.9, 62.5], [57.35, 69.25], [91.2, 55.75],
      [62.3, 66.75], [70.35, 57.0], [93.05, 58.75], [72.75, 55.75], [58.95, 52.5],
      [88.4, 50.25], [59.15, 70.5], [74.15, 54.75], [78.35, 54.25], [61.1, 69.0],
      [69.8, 70.5], [63.4, 51.75], [64.25, 70.5], [15.85, 5.25], [15.75, 8.25],
      [83.05, 30.25],
    ],
    // The two red masts flanking Corcovado. Measured by their HALO, not their
    // core: a small saturated red light blows out to pink in the middle, so
    // the core reads rgb(156,78,98) and rgb(229,180,199) while the glow around
    // them is unambiguously red against the blue sky. A strict red test over
    // the whole frame returned nothing but sodium street lamps.
    beacons: [[11.35, 12.5], [11.4, 15.75], [18.1, 16.25]],
    beaconTone: 'red',
    // THE SHORE HERE IS A ROAD, NOT A BEACH. Botafogo's waterline is the
    // promenade below, traced lamp by lamp, and every reflection is sampled
    // clear beneath it.
    water: [
      [34.2, 81.25], [49.7, 77.5], [51.4, 77.5], [39.35, 82.5], [35.8, 81.25],
      [60.4, 77.75], [37.75, 82.0], [49.55, 81.5], [54.65, 76.5], [53.05, 76.25],
      [57.2, 78.25], [58.75, 78.0], [45.45, 78.25], [31.6, 83.25], [62.1, 76.25],
      [48.0, 77.5], [60.3, 82.5], [47.35, 83.5], [45.45, 83.25],
    ],
    // Sun glitter on the bay, on the Owner's ask for water glitters. Rio's
    // city is white and its distant hills are hazy blue, so neither a bright
    // test nor a blue test finds water on its own: a first pass that asked
    // only for blue surroundings put a third of its points on the favela and
    // the far range. These come from a WATER MASK - blue minus red over 105
    // with the fifteen rows below also water, which excludes both the sky and
    // the hazy ridges - and each is a local maximum at least 16 above the
    // median of the 27px around it. The cove carries most of them because
    // that is the water the eye is on; a handful sit in the channel behind
    // Urca. None is within 0.6% of a promenade reflection: two glows on one
    // patch of water is a hotspot, not a sparkle.
    glints: [
      [27.5, 94.75], [31.05, 89.75], [40.7, 85.75], [43.75, 87.75], [45.6, 86.5],
      [48.05, 85.5], [49.9, 87.0], [50.95, 94.75], [53.25, 82.0], [54.5, 87.25],
      [54.6, 80.25], [56.95, 84.5], [57.15, 81.5], [57.55, 96.75], [58.95, 85.5],
      [59.2, 81.5], [61.05, 74.75], [62.75, 85.75], [63.45, 57.5], [66.05, 62.75],
      [66.65, 49.5], [67.35, 58.0], [67.9, 89.0], [68.65, 61.5], [68.95, 94.75],
      [69.05, 58.5], [70.6, 89.75], [72.15, 57.5], [74.2, 66.25],
      [78.4, 55.75],
      // A second pass, on the Owner's ask for more of them. Same water mask,
      // but its colour model is now LEARNED from the promenade reflections
      // rather than written as a blue threshold: sample 1.5% below each
      // reflection, take the median, and accept a pixel within 2.2 standard
      // deviations of it whose 9px neighbourhood varies by less than 14. That
      // last test is what a threshold cannot do - it separates water from
      // foliage and rooftops, which is where a fixed blue rule put a third of
      // the first pass. One candidate at [50.2, 51.25] passed every number
      // and sits on a hillside; it was dropped by looking at it.
      [32.8, 88.75], [35.8, 89.25], [37.4, 84.5], [46.9, 87.5], [48.1, 81.5],
      [58.35, 81.5], [61.7, 86.0], [69.0, 91.5], [76.45, 95.75],
    ],
    // The promenade round the cove, in two straight runs because one is not
    // straight. Re-traced on this pack by walking the brightest continuous
    // band from x 31 to x 62 (max residual 0.6% of the card on each run): the
    // road falls 4.7% of the card across the first run and 3.6% across the
    // second, where pack 1 declared 3.73 and 3.31 and left the traffic
    // climbing off the road at the seaward end of each. The seaward run
    // carries the police car.
    bridge: [
      {
        lights: [[31.0, 81.25], [33.75, 80.0], [35.75, 79.25], [37.75, 78.0], [40.0, 77.25], [43.75, 76.75], [45.75, 76.5]],
        deck: { x: 31, y: 81.1, w: 15, rise: -4.7 },
      },
      {
        lights: [[47.5, 75.25], [49.5, 74.75], [51.5, 74.25], [54.75, 74.5], [57.25, 73.0], [59.5, 73.0], [61.5, 72.75]],
        deck: { x: 46, y: 76.2, w: 16, rise: -3.6 },
        police: true,
      },
    ],
    // MASTHEAD-CABLE-1: the Sugarloaf bondinho, the star of this card (Owner),
    // and the reason this pack has a kind of its own. RE-FITTED TO THE ROPE
    // ITSELF rather than to the two stations. The wire is drawn as four dark
    // strands against the sky, and it is only visible where it leaves the
    // rock: it emerges at x 84.4 and disappears into the trees above the Urca
    // station at x 91.5. Traced by following the dark line down the sky and
    // fitted through the trace plus the lit lower station, worst residual
    // 0.55% of the card. The old rail ran from the summit station at x 83,
    // which is a cabin pasted on the rock face for its first percent of
    // travel, and at a slope of 3.35 against the rope's 2.9 it crossed the
    // painted strands rather than riding them. One cabin, down and back up,
    // because that is what a cableway does.
    cable: { x: 84.4, y: 36.0, w: 7.1, rise: 20.6, flight: 42 },
    // Sky is clear above card y 33 from x 22 east; Corcovado holds y 4-24 at
    // x 14-18 and the lane stops well short of it.
    aircraft: { y: 6.78, from: 98, to: 26, flight: 40 },
    // Frigatebirds over the bay, high. The flock spreads 6.4% above the lane
    // and 11.5% below it, so at y 18.64 the highest sits at 12.2 and the
    // lowest at 30.1, and the ridge under the run never rises past 33.
    birds: { y: 18.64, from: 96, to: 30, flight: 34, count: 6 },
    // A tour helicopter round the Sugarloaf circuit, just above its summit.
    helicopter: { y: 25.42, from: 60, to: 96, flight: 46 },
    // The Niteroi crossing, in the channel between the far shore and the Urca
    // headland. Both ends moved in: pack 1 ran it from x 82 at y 57.6, which
    // starts inside Sugarloaf's own base and clips the headland on the way
    // across. The water at y 59 runs x 62 to 78 and is 91% open by the mask,
    // the islands off Urca being the rest.
    ferry: { y: 59, from: 78, to: 62, flight: 120 },
    ferryTone: 'white',
    // Tropical haze on the far range and the bay's far shore.
    haze: { y: 32.2, height: 10.17 },
    // The golden-hour sun is OFF-FRAME LEFT: the sky column mean falls from
    // 231 at x 0 to 191 at x 90, and the brightest edge pixel is at x 2.
    flare: { x: -6, y: 22.03 },
    // The chop, moved to the cove where the water actually is. The old patch
    // (x 60-82, y 54.2-66.1) was 47% water by the mask: it covered Niteroi's
    // waterfront on one side and climbed the Urca hill on the other. This box
    // is 90% water, and the 10% is the sailboats in it.
    swell: { x: 32, y: 84, w: 36, height: 11 },
    rainfall: true,
  },
  tokyo: {
    // MASTHEAD-TOKYO-2 (2026-09-08): the SECOND Tokyo pack, TEN frames
    // (CloudyNight and RainNight joined the eight), and A DIFFERENT DRAWING -
    // the edge correlation between the two Day frames is 0.145, so nothing
    // carried over and every number here was measured again. The new frames
    // register to each other within a pixel.
    //
    // The view looks west over the city at dusk. Mount Fuji stands in the
    // top-left at x 4-18, TOKYO TOWER at x 25.6 reaching the very top of the
    // card, the Skytree at x 91.2 doing the same on the right, the business
    // district filling the middle with its rooftops at y 25-45, an elevated
    // expressway sweeping across the near ground from x 52 to 74, and the
    // park with its POND at x 39-49, y 88-95.
    //
    // THERE IS NO FERRIS WHEEL. The white ellipse at x 50-53 reads like one at
    // a glance and its bounding box even measures like one, but zoomed it is a
    // narrow oval tower 52px wide and 124 tall with curved ribs, not spokes
    // and cabins. The `wheel` kind stays out of this city.
    //
    // Windows across the skyline, the mid-city and the near blocks.
    lights: [
      [4.35, 54.75], [4.5, 58.5], [6.6, 61.0], [12.3, 59.25], [13.05, 55.25],
      [16.6, 43.25], [18.7, 56.5], [20.1, 50.25], [24.25, 90.0], [24.35, 45.5],
      [25.5, 24.0], [26.55, 88.5], [29.05, 72.75], [30.1, 80.5], [30.65, 41.0],
      [32.05, 58.0], [32.7, 81.25], [35.6, 77.75], [36.45, 82.5], [37.15, 47.25],
      [37.25, 42.75], [38.6, 80.5], [40.85, 43.25], [41.3, 51.5], [42.45, 41.75],
      [42.8, 37.5], [44.35, 33.0], [44.75, 40.75], [45.25, 26.75], [45.8, 36.75],
      [48.1, 52.0], [48.25, 39.0], [49.8, 85.0], [50.75, 36.25], [51.0, 32.25],
      [53.75, 87.75], [54.65, 29.75], [54.7, 37.0], [56.0, 33.5], [57.7, 88.0],
      [58.0, 43.75], [59.1, 58.75], [59.2, 32.75], [59.7, 52.5], [59.75, 46.75],
      [59.8, 40.0], [62.4, 37.5], [64.45, 45.25], [64.5, 43.25], [66.0, 38.75],
      [69.9, 50.5], [70.1, 44.5], [70.15, 57.0], [70.4, 41.25], [70.4, 70.0],
      [70.85, 64.0], [76.7, 92.0], [82.0, 43.75], [86.7, 70.5], [89.3, 85.25],
      [95.7, 40.75], [95.95, 60.25], [96.05, 54.5], [96.65, 46.75],
    ],
    // Tokyo paints its aviation lights properly: strict red maxima with dark
    // sky above them, all along the skyline band. The last three are the two
    // towers - Tokyo Tower's mast lamps at y 4.0 and 6.6, and the Skytree's at
    // y 2.5. Both towers carry a brighter lamp at the very tip (y 0.6 and 0.0)
    // and neither is here: a 6px beacon centred two pixels from the card's top
    // edge is a half beacon.
    beacons: [
      [5.25, 43.25], [17.35, 42.25], [21.7, 41.0], [24.8, 45.0], [25.62, 4.0],
      [25.62, 6.6], [25.7, 20.25], [37.15, 39.25], [40.0, 39.25], [44.2, 25.75],
      [54.3, 41.0], [56.7, 35.5], [59.15, 30.0], [60.55, 40.75], [64.2, 40.25],
      [66.75, 45.25], [70.35, 40.0], [73.35, 43.75], [82.15, 43.0], [91.2, 2.5],
      [95.35, 36.75],
    ],
    beaconTone: 'red',
    // MASTHEAD-FACADE-1: Tokyo Tower is floodlit orange from top to bottom,
    // which is exactly what this kind is for. Two boxes because the tower is a
    // triangle and an ellipse is not: the shaft, and the wider base below the
    // main deck.
    facade: [[25.65, 24.0, 2.2, 32.0], [25.7, 43.0, 4.6, 16.0]],
    // The pond in the park (Owner: "there is a water feature in the park").
    // The lamps along its far bank throw vertical streaks across it, so the
    // bokeh kind fits here exactly as it does on a harbour - just smaller.
    // Nothing above y 88: the bank itself is lit and its lights are not
    // reflections.
    water: [
      [39.2, 88.5], [41.0, 90.25], [41.0, 93.25], [41.9, 91.5], [43.85, 90.25],
      [43.85, 94.0], [45.05, 91.25], [45.35, 93.5], [46.7, 88.5], [46.7, 91.0],
      [46.7, 93.75], [47.6, 89.25], [47.6, 92.25], [48.5, 94.0], [48.65, 90.0],
      // And the canal on the right, at x 77-82: the same streaks, a second
      // water feature the Owner's note about the park led me to look for.
      [77.0, 64.75], [78.05, 63.75], [78.05, 67.5], [79.25, 63.25], [80.3, 63.75], [81.95, 62.75], [82.1, 68.0],
    ],
    // And the same water by day, where it reads green-brown rather than blue
    // (median rgb 69,122,89), so the glint mask that finds a harbour is no use
    // here. These are local maxima inside the measured pond instead.
    glints: [
      [38.65, 91.75], [38.95, 94.5], [39.25, 89.0], [40.95, 89.25], [41.15, 94.5],
      [46.75, 89.0], [48.45, 90.75],
      // The canal by day (median rgb 74,139,186, so blue where the pond is
      // green - two different waters on one card).
      [76.75, 68.5], [77.0, 63.0], [78.75, 62.25], [79.0, 67.5], [80.75, 62.75], [81.5, 67.75], [82.0, 62.25],
    ],
    // The elevated expressway, which is the one road on this card a car can
    // ride: it sweeps from x 52 down to x 74, dropping 18% of the card across
    // its run, and it is lit end to end in sodium orange. Traced lamp by lamp;
    // one candidate at x 55 came back at less than half the brightness of its
    // neighbours and was dropped rather than carried.
    bridge: [
      {
        lights: [[52.75, 79.5], [57.75, 82.75], [60.75, 85.75], [63.5, 88.25], [66.75, 91.5], [69.25, 92.0], [72.5, 94.75]],
        deck: { x: 52, y: 79, w: 22, rise: 18 },
        police: true,
      },
    ],
    // Sky lanes. Both towers reach the top of the card, so every lane stops
    // short of them: nothing runs west of x 30 or east of x 88.
    aircraft: { y: 8, from: 88, to: 30, flight: 40 },
    birds: { y: 16, from: 86, to: 32, flight: 34, count: 6 },
    helicopter: { y: 22, from: 84, to: 34, flight: 46 },
    // MASTHEAD-STRIKE-1 (Owner asked for a thunderstorm). x and y are where
    // the bolt's TIP lands: the rooftop at x 44.2, whose own red beacon sits
    // at y 25.75. A bolt is 3.1 times as tall as it is wide on this card, so a
    // tip on either tower would need most of its fork above the card; this one
    // fits with its top at y 1.5.
    strike: { x: 44.2, y: 26.2, w: 10 },
    // The haze on the far city, below Fuji and above the near blocks.
    haze: { y: 36, height: 9 },
    // The golden-hour sun is off-frame LEFT: the sky column means fall from
    // 183 at x 20 to 128 at x 90.
    flare: { x: -6, y: 14 },
    rainfall: true,
  },
  london: {
    // MASTHEAD-LONDON-2 (2026-09-08): the second London drop, and a TARGETED
    // one rather than a redraw. Diffed frame by frame against pack 1: Cloudy,
    // Dawn, Day, GoldenHour, Morning and Sunset are BYTE-IDENTICAL, Night is
    // relit (18% of pixels moved, none of them geometry), Rain and CloudyNight
    // are largely new, and RainNight is a new scene. So the pack is ten frames
    // now, and every point below was re-verified rather than re-measured: the
    // rigid fit that recovers a pack's offset from its own points reports 0,0
    // on the new Night frame at the same score as the old one. Two families
    // appeared to want a 3px shift on CloudyNight and RainNight and were left
    // alone - they disagreed on the direction, which is what chasing noise in
    // a dim frame looks like, and the edge correlation says at most 1px.
    //
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
    // MASTHEAD-CLOCK-1 (Owner). Big Ben's two lit dials, the near one and the
    // one turned away from us: measured off the night frame at 11px and 9px
    // across, centres level at y 33.4. They burn rather than twinkle, which is
    // why they are their own kind and not two more `lights`.
    clock: [[23.31, 33.4, 0.62], [24.3, 33.4, 0.48]],
    // MASTHEAD-WHEEL-2: the Eye re-measured on the capsule ring. The old entry
    // was a circle centred at y 21.95 with a diameter of 6.97% of the width,
    // which is 139px across and 139px tall: the painted wheel is 150 by 196,
    // so that circle cut clean across the middle of it. Traced by overlay on
    // the night frame, where the rim is the brightest thing against the sky.
    wheel: { x: 38.9, y: 29.8, d: 7.5, h: 49 },
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
    // MASTHEAD-FACADE-1 (Owner). Rome's floodlit stone, as buildings rather
    // than as points. Found by closing and labelling the warm-bright mask of
    // the night frame (red over 150, red minus blue over 42) and taking the
    // largest regions, then trimming each box back to the building itself -
    // the raw St Peter's blob runs 15.7% wide because it swallows the Vatican
    // wall and the umbrella pines in front of it. In order: the dome, the
    // basilica below it, the Vittoriano, the dome over the centre of the city,
    // the church on the right, and the lit palazzo in the foreground.
    facade: [
      [24.0, 32.6, 4.8, 14.8], [24.5, 46.0, 11.0, 17.0], [66.2, 43.5, 6.7, 17.0],
      [48.1, 66.0, 6.0, 22.0], [75.2, 82.0, 5.0, 18.0], [60.9, 88.8, 8.8, 12.8],
    ],
    rainfall: true,
    // MASTHEAD-STARS-1 (2026-09-09, Owner: "blinking stars or comet (falling
    // star) animations in some of the clear night skies"). CLEAR NIGHT ONLY -
    // the CSS gates both kinds to `night` and to nothing else, because a star
    // seen through an overcast is the same lie as sun glitter under a cloudy
    // sky, which this registry already refuses to draw.
    //
    // These are measured the OTHER WAY ROUND from every other kind in this
    // file. A light is placed on something the artwork already paints; a star
    // is placed where the artwork paints NOTHING, so the measurement is a proof
    // of emptiness. Each point sits at least 4 per cent of the card above this
    // city's own skyline; its 7x7 neighbourhood still reads as sky (grey mean
    // within 26 of the frame's top rows, standard deviation under 9, so no edge
    // and no glow); and none lands under the moon, whose disc and halo were
    // measured off the render's own alpha (box px 53 to 149 of 192) rather than
    // assumed to fill the art box.
    // St Peter's dome breaks the skyline to y 6 across x 23-25.5, and the moon sits
    // at 8 per cent, so the left third carries only three.
    stars: [
      [5.39, 8.13], [8.64, 5.7], [9.14, 1.87], [25.56, 3.75], [28.31, 12.93],
      [30.07, 6.65], [31.86, 12.73], [32.35, 16.72], [34.48, 9.45], [46.01, 9.0],
      [52.11, 2.36], [55.39, 13.72], [57.56, 7.29], [60.08, 16.95], [61.32, 11.78],
      [62.92, 26.04], [64.15, 4.24], [67.16, 13.79], [76.47, 8.99], [78.46, 5.25],
      [81.82, 3.72], [84.92, 14.64], [86.65, 8.35], [91.37, 2.38], [95.24, 3.59],
      [96.67, 10.85],
    ],
    comet: { x: 57.5, y: 2, run: 6, drop: 17, flight: 1.1 },
  },
  toronto: {
    // MASTHEAD-TORONTO-1 (2026-09-08, a new city). TWELVE frames, which makes
    // this the first pack in the registry to carry every optional scene -
    // Cloudy, CloudyNight, Snow, SnowNight, Rain and RainNight all arrived
    // with the six of the day. One drawing throughout: edge correlation
    // against Day runs 0.38 to 0.77, and the best whole-pixel registration
    // shift is zero on five of the eleven others and never more than two rows
    // of four hundred on any of them.
    //
    // The view is from the Toronto Islands looking north across Lake Ontario,
    // and it is HALF WATER. The skyline runs the full width with its crowns
    // between card y 25 and y 45; the CN TOWER stands at x 44.9 and reaches
    // the very top of the card; the Rogers Centre dome sits at x 37.6-42.6,
    // lit blue; a dense waterfront light strip runs the whole width at y 61-65;
    // and everything below y 66 is open lake carrying the reflection of the
    // entire city. That reflection is what this card is really about, which is
    // why the water set here is the largest in the registry.
    //
    // Windows and the waterfront strip, taken as the brightest warm maximum in
    // each cell of a 5%-column by four-band grid, so the skyline keeps its
    // windows instead of the set collapsing onto the strip - which is what a
    // plain brightness ranking did here, the strip being the brightest thing
    // on the card by a distance.
    lights: [
      [2.9, 63.75], [3.25, 57.0], [8.9, 57.0], [9.75, 61.25], [10.55, 52.75],
      [10.85, 63.75], [14.45, 59.25], [15.1, 51.75], [15.1, 55.25], [19.65, 65.0],
      [21.55, 62.75], [23.6, 54.0], [27.5, 63.25], [28.65, 59.75], [30.65, 46.0],
      [32.75, 64.25], [34.5, 56.5], [35.4, 51.5], [35.5, 53.75], [38.7, 64.0],
      [40.75, 48.0], [41.4, 64.5], [43.15, 57.0], [46.25, 64.25], [46.8, 52.5],
      [47.45, 56.0], [53.4, 64.25], [53.55, 51.75], [54.05, 56.75], [55.3, 43.25],
      [56.75, 63.0], [57.35, 51.75], [57.85, 56.75], [60.55, 43.5], [62.1, 49.75],
      [62.3, 53.0], [63.1, 62.0], [66.35, 64.5], [66.9, 49.75], [67.2, 56.0],
      [70.45, 65.5], [70.95, 53.5], [75.1, 64.5], [76.2, 57.5], [80.85, 64.5],
      [81.2, 52.0], [83.75, 54.25], [85.2, 55.5], [87.7, 63.25], [92.1, 59.75],
      [93.35, 64.25], [95.0, 59.0], [97.4, 64.25],
    ],
    // Aviation red, all along the skyline. Four detectors had to agree before
    // a point survived: red dominance over 58, dark sky above it, a red BLOB
    // no larger than 60 pixels, and the eye. The blob size is the one that
    // matters - a warm brown wall and a lamp read almost the same at a single
    // pixel, and three candidates that passed every colour test were 120 to
    // 400 pixels of lit masonry. Four more were dropped on sight after that.
    //
    // The last entry in the first row is the CN TOWER'S TIP at card y 1.5,
    // six pixels from the top edge on the source frame. It is kept where
    // Tokyo's two tip lamps were not, because a 6px beacon centred there still
    // sits entirely on the card at rest; it is the opening of the timelapse
    // drift, not the resting frame, that briefly carries it off the top.
    beacons: [
      [6.3, 54.25], [12.85, 52.25], [14.25, 46.25], [15.0, 46.25], [16.9, 45.5],
      [18.65, 54.25], [23.3, 50.75], [28.45, 42.5], [32.15, 48.75], [35.9, 45.0],
      [43.5, 46.25], [44.95, 1.5], [46.4, 40.25], [47.2, 40.25], [51.2, 45.5],
      [53.75, 31.25], [54.4, 25.5], [56.85, 34.75], [57.1, 27.75], [58.15, 40.0],
      [66.15, 44.5], [68.6, 41.25], [74.0, 43.0], [79.0, 43.25], [83.75, 47.75],
    ],
    beaconTone: 'red',
    // MASTHEAD-FACADE-1, and the first COOL one. The CN Tower is floodlit
    // cream from its base to the pod and takes the warm tone unchanged: the
    // shaft, then the pod itself, which the column scan puts at y 18-24.4
    // where the lit structure widens from 0.4% to 1.5% of the card.
    //
    // The Rogers Centre dome is lit BLUE, and a warm glow on it would have
    // been the one light on this card painted a colour the artwork does not
    // use. It names 'cool' as its fifth element instead - the same way a
    // beacon names a variant third and a neon names its tone. Measured off the
    // blue mask restricted to x 37.2-42.8: the arc runs y 54.3 to 59.5 and the
    // rows below y 65 that the unrestricted mask also returned are the dome's
    // REFLECTION, which is water and belongs to `water`.
    facade: [
      [44.95, 42.0, 1.6, 36.0], [45.0, 21.4, 3.2, 7.0],
      [40.1, 56.9, 5.2, 5.8, 'cool'],
    ],
    // THE REFLECTIONS. Every column of the lake that runs brighter than its
    // own 61-column neighbourhood, which is how a reflection differs from lit
    // water: it is a vertical streak, not a level. 67 columns cleared the test
    // and the strongest 42 are here, which ties New York for the largest water
    // set in the registry and is the only place either number is deserved -
    // a third of this card is lake.
    water: [
      [3.1, 72.69], [6.15, 73.8], [9.6, 73.28], [10.55, 72.81], [13.8, 74.82],
      [15.95, 82.39], [19.6, 73.61], [24.75, 74.34], [27.95, 77.02], [29.75, 75.65],
      [32.6, 74.79], [34.0, 73.83], [35.45, 75.32], [42.4, 73.87], [44.8, 80.77],
      [46.55, 74.89], [48.3, 74.54], [49.1, 74.17], [49.9, 75.01], [52.1, 77.12],
      [53.9, 76.85], [54.3, 71.9], [56.2, 74.59], [57.45, 76.15], [58.05, 73.3],
      [61.5, 75.1], [63.15, 74.97], [65.8, 72.93], [67.95, 73.79], [68.4, 75.33],
      [70.4, 75.77], [73.3, 74.05], [74.35, 75.24], [76.1, 75.25], [78.65, 75.99],
      [80.45, 74.85], [82.25, 75.77], [83.75, 74.38], [87.05, 74.86], [90.6, 75.17],
      [92.7, 72.88], [94.75, 74.79],
    ],
    // Sun glitter on the lake, and the detector here is AGREEMENT rather than
    // a threshold: a point is a glint only where the Day frame and the Golden
    // Hour frame independently put a local maximum in the same place. The two
    // frames are lit differently and drawn separately, so a ripple crest that
    // catches the light in both is a crest; 369 of Day's 407 maxima agreed,
    // and these are 41 of those, spaced so the sparkle covers the whole lake
    // rather than crowding the sun's own path. Each threshold is computed per
    // 100px column band, because the water darkens toward the right and one
    // global cut left that third of the lake bare. Five agreeing maxima below
    // card y 97 are NOT here: the guard that keeps a sparkle off the card's
    // rounded bottom corner is right, and the lake simply runs off the card.
    glints: [
      [0.8, 89.0], [10.45, 76.0], [14.05, 77.5], [14.1, 70.25], [21.4, 95.5],
      [21.55, 87.25], [28.2, 96.25], [30.15, 86.25], [31.2, 76.75], [34.15, 88.5],
      [38.55, 82.5], [38.8, 75.0], [42.2, 79.5], [44.5, 70.25], [44.55, 87.75],
      [44.7, 95.0], [49.1, 83.25], [49.1, 70.5], [51.8, 92.5], [53.75, 82.25],
      [55.85, 93.0], [56.1, 70.25], [57.4, 83.0], [61.0, 93.75], [61.35, 70.5],
      [61.75, 84.5], [68.2, 83.25], [68.4, 92.5], [69.7, 75.75], [73.05, 83.0],
      [73.65, 70.25], [73.7, 92.5], [77.4, 93.25], [78.55, 75.0], [78.65, 83.5],
      [80.9, 90.25], [82.9, 76.75], [85.6, 92.0], [92.2, 91.5], [93.6, 82.25],
      [95.9, 97.0],
    ],
    // The chop, on open lake: below the reflections, clear of the near shore,
    // and short of both edges.
    swell: { x: 4, y: 78, w: 92, height: 16 },
    // The Island ferry, white like the boats moored along the shore in the day
    // frames. Lane y 72 is open water from edge to edge - this is the one card
    // in the registry where a crossing has nothing to avoid.
    ferry: { y: 72, from: 98, to: 2, flight: 150 },
    ferryTone: 'white',
    // Sky lanes, all EAST of the CN Tower, which reaches the top of the card at
    // x 44.9 and would be crossed rather than passed by anything flying over
    // it. From x 50 to 96 the tallest thing on the skyline is a crown at card
    // y 24, so the three lanes stack below that with the flock's own spread
    // (6.4% up, 11.5% down) still clearing it.
    aircraft: { y: 7, from: 96, to: 50, flight: 40 },
    birds: { y: 11, from: 94, to: 52, flight: 34, count: 6 },
    helicopter: { y: 17, from: 52, to: 94, flight: 46 },
    // The bolt's TIP on the crown at x 57.1, whose own beacon sits at y 27.75.
    // A w:10 fork is about 25% of the card tall, so this one's top lands at
    // y 3 - on the card. A tip on the CN Tower would have needed most of its
    // fork above the frame.
    strike: { x: 57.1, y: 28.2, w: 10 },
    // Atmospheric haze over the far skyline: the day frame's row mean falls
    // steadily from 202 at y 40 to 129 at y 62 while its saturation rises,
    // which is distance, not shadow.
    haze: { y: 44, height: 11 },
    // The golden-hour sun is OFF-FRAME LEFT, and three frames agree: the sky
    // column means fall left to right on Morning (232 to 205), Golden Hour
    // (196 to 156) and Sunset (146 to 113).
    flare: { x: -6, y: 12 },
    rainfall: true,
    snowfall: true,
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
