// MASTHEAD-SCENE-2/3: city scene packs - folder-per-city parsing, multi-word
// scene names, webp preference, alias and proximity matching, and the LA/SVG
// fallback chain.
//
// Run: node --test test/mastheadCityScenes.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  parseSceneFiles, choosePack, normalizeCityToken, CITY_COORDS,
  CITY_IMG_Y, DEFAULT_IMG_Y, imgPositionFor,
} from '../src/lib/mastheadCityScenes.js'
import { SCENES } from '../src/lib/mastheadScene.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')

test('folder-per-city convention: the folder names the pack, scenes come from filename ends', () => {
  const packs = parseSceneFiles([
    'LosAngeles/LosAngeles_Dawn.webp', 'LosAngeles/LosAngeles_Morning.webp', 'LosAngeles/LosAngeles_Day.webp', 'LosAngeles/LosAngeles_GoldenHour.webp',
    'LosAngeles/LosAngeles_Sunset.webp', 'LosAngeles/LosAngeles_Night.webp', 'LosAngeles/LosAngeles_Rain.webp',
  ])
  assert.deepEqual(Object.keys(packs), ['losangeles'])
  assert.equal(packs.losangeles.dawn, '/masthead/LosAngeles/LosAngeles_Dawn.webp')
  assert.equal(packs.losangeles.morning, '/masthead/LosAngeles/LosAngeles_Morning.webp')   // morning is its own scene now
  assert.equal(packs.losangeles.goldenhour, '/masthead/LosAngeles/LosAngeles_GoldenHour.webp')
  assert.equal(packs.losangeles.rain, '/masthead/LosAngeles/LosAngeles_Rain.webp')
  for (const scene of SCENES) assert.ok(packs.losangeles[scene], `Los Angeles must carry ${scene}`)
})

test('scene synonyms, multi-word cities, flat files, and junk', () => {
  const packs = parseSceneFiles([
    'Las_Vegas_Dusk.png', 'Las_Vegas_Sunrise.png', 'Chicago/Chicago_Golden_Hour.webp',
    'Chicago/Chicago_Overcast.webp', 'README.md', 'notes.txt', 'Paris_Banner.png',
    'Tokyo.png', 'deep/nest/Tokyo_Day.png',
  ])
  assert.equal(packs.lasvegas.sunset, '/masthead/Las_Vegas_Dusk.png')
  assert.equal(packs.lasvegas.dawn, '/masthead/Las_Vegas_Sunrise.png')
  assert.equal(packs.chicago.goldenhour, '/masthead/Chicago/Chicago_Golden_Hour.webp')
  assert.equal(packs.chicago.rain, '/masthead/Chicago/Chicago_Overcast.webp')
  assert.equal(packs.paris, undefined)  // "Banner" is not a scene word
  assert.equal(packs.tokyo, undefined)  // no scene suffix; deeper nesting ignored
})

test('webp beats png for the same city and scene, in either order', () => {
  for (const files of [['LosAngeles/LosAngeles_Day.png', 'LosAngeles/LosAngeles_Day.webp'], ['LosAngeles/LosAngeles_Day.webp', 'LosAngeles/LosAngeles_Day.png']]) {
    assert.equal(parseSceneFiles(files).losangeles.day, '/masthead/LosAngeles/LosAngeles_Day.webp')
  }
})

test('label match wins: resolved city name and aliases pick the pack directly', () => {
  const packs = parseSceneFiles(['LosAngeles/LosAngeles_Day.webp', 'Chicago/Chicago_Day.webp'])
  assert.equal(choosePack(packs, { label: 'Los Angeles', lat: 0, lon: 0 }).city, 'losangeles')
  assert.equal(choosePack(packs, { label: 'Chicago', lat: 0, lon: 0 }).city, 'chicago')
  assert.equal(normalizeCityToken('Los Angeles'), 'losangeles')
})

test('proximity match: a viewer near a pack city gets that pack', () => {
  const packs = parseSceneFiles(['LosAngeles/LosAngeles_Day.webp', 'Chicago/Chicago_Day.webp'])
  // Palmdale is ~60 km from LA and nowhere near Chicago.
  assert.equal(choosePack(packs, { label: 'Palmdale', lat: 34.58, lon: -118.13 }).city, 'losangeles')
  // Evanston sits on Chicago's shoulder.
  assert.equal(choosePack(packs, { label: 'Evanston', lat: 42.05, lon: -87.68 }).city, 'chicago')
})

test('fallback chain: distant viewer → Los Angeles pack; no packs → null (SVG scenery)', () => {
  const packs = parseSceneFiles(['LosAngeles/LosAngeles_Day.webp', 'Chicago/Chicago_Day.webp'])
  assert.equal(choosePack(packs, { label: 'Auckland', lat: -36.85, lon: 174.76 }).city, 'losangeles')
  assert.equal(choosePack({}, { label: 'Auckland', lat: -36.85, lon: 174.76 }), null)
  const noLa = parseSceneFiles(['Chicago/Chicago_Day.webp'])
  assert.equal(choosePack(noLa, { label: 'Auckland', lat: -36.85, lon: 174.76 }), null)
})

test('the shipped Los Angeles folder is a complete seven-scene pack and nothing is orphaned', () => {
  const files = readdirSync(join(here, '..', 'public', 'masthead'), { recursive: true })
    .map(f => String(f).replace(/\\/g, '/'))
    .filter(f => /\.(webp|png|jpe?g)$/i.test(f))
  const packs = parseSceneFiles(files)
  const placed = Object.values(packs).reduce((n, p) => n + Object.keys(p).length, 0)
  assert.equal(placed, files.length, `every image file must map to a city+scene: ${files.join(', ')}`)
  for (const scene of SCENES) {
    assert.ok(packs.losangeles?.[scene], `Los Angeles pack must include ${scene}`)
  }
})

test('proximity cities carry sane coordinates', () => {
  for (const [city, [lat, lon]] of Object.entries(CITY_COORDS)) {
    assert.ok(Math.abs(lat) <= 90 && Math.abs(lon) <= 180, `${city} coords out of range`)
  }
})

// ── MASTHEAD-SCENE-4: the viewer's chosen scenery city ───────────────────────

test('the city preference is artwork-only, and defaults to automatic', async () => {
  // Per-user storage is asserted in test/mastheadCityPerUser.test.mjs.
  const { AUTO, cityOptions, cityDisplayName } = await import('../src/lib/mastheadCityPreference.js')
  assert.equal(AUTO, 'auto')
  assert.equal(cityDisplayName('lasvegas'), 'Las Vegas')
  assert.equal(cityDisplayName('losangeles'), 'Los Angeles')
  // Automatic always leads; installed packs follow in display order.
  const packs = parseSceneFiles(['LosAngeles/LosAngeles_Day.webp', 'LasVegas/LasVegas_Day.webp'])
  const opts = cityOptions(packs)
  assert.equal(opts[0].key, 'auto')
  assert.deepEqual(opts.slice(1).map(o => o.label), ['Las Vegas', 'Los Angeles'])
  // The picker changes SCENERY only - it must never touch the weather query.
  const pref = readFileSync(join(here, '..', 'src/lib/mastheadCityPreference.js'), 'utf8')
  assert.doesNotMatch(pref, /useWelcomeWeather|open-meteo|weatherLocation/)
})

test('an explicit city wins over location, and a stale choice falls back to automatic', async () => {
  // The rule lives in resolvePack (shared by the scenery layer and the weather
  // module), so it is asserted behaviorally rather than by matching source.
  const { resolvePack } = await import('../src/lib/mastheadCityScenes.js')
  const packs = parseSceneFiles(['LosAngeles/LosAngeles_Day.webp', 'LasVegas/LasVegas_Day.webp'])
  const inLA = { label: 'Los Angeles', lat: 34.05, lon: -118.24 }
  assert.equal(resolvePack(packs, 'lasvegas', inLA).city, 'lasvegas', 'an explicit choice wins')
  assert.equal(resolvePack(packs, null, inLA).city, 'losangeles', 'automatic follows location')
  // A choice naming an uninstalled pack must not strand the viewer on the SVG.
  assert.equal(resolvePack(packs, 'chicago', inLA).city, 'losangeles')
})

test('every installed city pack carries all seven scenes', () => {
  // Swept rather than enumerated, so a new city folder is checked the moment
  // it is dropped in - a pack missing a scene falls back to the SVG art for
  // that state alone, which is a silent visual inconsistency worth catching.
  const files = readdirSync(join(here, '..', 'public', 'masthead'), { recursive: true })
    .map(f => String(f).replace(/\\/g, '/'))
    .filter(f => /\.(webp|png|jpe?g)$/i.test(f))
  const packs = parseSceneFiles(files)
  const cities = Object.keys(packs)
  assert.ok(cities.includes('losangeles') && cities.includes('lasvegas') && cities.includes('newyork'),
    `expected the shipped packs; got ${cities.join(', ')}`)
  for (const city of cities) {
    for (const scene of SCENES) assert.ok(packs[city]?.[scene], `${city} pack must include ${scene}`)
  }
  // Every city with a pack needs coordinates, or location matching can never
  // reach it and the pack is picker-only.
  for (const city of cities) {
    assert.ok(CITY_COORDS[city], `${city} pack needs CITY_COORDS for location matching`)
  }
})

test('the celestial art sits where each city leaves its sky clear', async () => {
  const { skyPositionFor, DEFAULT_SKY_X, CITY_SKY_X, resolvePack } = await import('../src/lib/mastheadCityScenes.js')
  // New York's towers occupy the middle of its frame (One WTC's spire sat
  // under the moon at the default), so that pack moves the art over the open
  // harbor sky; every other city keeps the default.
  assert.equal(skyPositionFor('newyork'), CITY_SKY_X.newyork)
  assert.notEqual(CITY_SKY_X.newyork, DEFAULT_SKY_X)
  for (const city of ['losangeles', 'lasvegas', 'chicago', undefined, null]) {
    assert.equal(skyPositionFor(city), DEFAULT_SKY_X, `${city} uses the default sky position`)
  }
  // The scenery layer and the weather module must resolve the SAME pack, or
  // the artwork and the sun/moon placement could disagree about the city.
  const packs = parseSceneFiles(['LosAngeles/LosAngeles_Day.webp', 'NewYork/NewYork_Day.webp'])
  assert.equal(resolvePack(packs, 'newyork', { label: 'Los Angeles', lat: 34.05, lon: -118.24 }).city, 'newyork')
  assert.equal(resolvePack(packs, null, { label: 'Los Angeles', lat: 34.05, lon: -118.24 }).city, 'losangeles')
  // A choice for an uninstalled pack falls back to location, never to nothing.
  assert.equal(resolvePack(packs, 'chicago', { label: 'Los Angeles', lat: 34.05, lon: -118.24 }).city, 'losangeles')
  const scenery = readFileSync(join(here, '..', 'src/components/MastheadScenery.jsx'), 'utf8')
  const weather = readFileSync(join(here, '..', 'src/components/WeatherScene.jsx'), 'utf8')
  for (const [name, src] of [['MastheadScenery', scenery], ['WeatherScene', weather]]) {
    assert.match(src, /resolvePack\(/, `${name} must resolve the pack through the shared helper`)
  }
})

test('a chosen city moves the whole masthead: artwork, weather, and time of day', async () => {
  const { cityWeatherLocation } = await import('../src/lib/mastheadCityPreference.js')
  const { CITY_COORDS: coords } = await import('../src/lib/mastheadCityScenes.js')
  // Automatic returns null so the viewer's own resolved location stands.
  assert.equal(cityWeatherLocation(null, coords), null)
  assert.equal(cityWeatherLocation('auto', coords), null)
  // A city with no coordinates cannot move the weather (it would silently
  // report the wrong place); it keeps the viewer's location instead.
  assert.equal(cityWeatherLocation('atlantis', coords), null)
  const ny = cityWeatherLocation('newyork', coords)
  assert.deepEqual([ny.lat, ny.lon], coords.newyork)
  assert.equal(ny.label, 'New York')
  // geo:false keeps a chosen city out of the granted-location cache, which is
  // reserved for where the person actually is.
  assert.equal(ny.geo, false)
  assert.equal(ny.chosen, true)

  const wx = readFileSync(join(here, '..', 'src/components/WeatherScene.jsx'), 'utf8')
  // The SAME query carries the sun times, so the scene clock follows the city
  // too - a New York skyline can never sit under Los Angeles's time of day.
  assert.match(wx, /const location = cityWeatherLocation\(preferredCity, CITY_COORDS\) \|\| resolved/)
  assert.match(wx, /queryKey: \['welcome_weather', location\.chosen \? `city:\$\{preferredCity\}`/)
  // MASTHEAD-LOCKSCREEN-1: the city moved off the card and into the
  // temperature's hover and accessible readout, which always name it.
  assert.match(wx, /title=\{`\$\{location\.label\} · Choose masthead scenery`\}/)
  assert.doesNotMatch(wx, /wx-mast-city/)
  // The dialog must not still promise that the weather stays local.
  const dlg = readFileSync(join(here, '..', 'src/components/masthead/CityPickerDialog.jsx'), 'utf8')
  assert.doesNotMatch(dlg, /weather still follows your own location/)
  assert.match(dlg, /artwork and weather/)
})

// ── MASTHEAD-CITY-CANON (Owner): full names, no abbreviations ───────────────

test('every shipped folder follows the naming canon', async () => {
  const { readdirSync: rd } = await import('node:fs')
  const dirs = rd(join(here, '..', 'public', 'masthead'), { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name)
  assert.ok(dirs.length >= 5, `expected the shipped city folders; got ${dirs.join(', ')}`)
  for (const dir of dirs) {
    // PascalCase, no spaces, no punctuation, and never an abbreviation.
    assert.match(dir, /^[A-Z][A-Za-z]+$/, `${dir} must be the city name in PascalCase with no spaces`)
    // Every file inside is <Folder>_<Scene>.webp - the folder names the city
    // once, and the file repeats it so a loose file is still identifiable.
    for (const f of rd(join(here, '..', 'public', 'masthead', dir))) {
      assert.match(String(f), new RegExp(`^${dir}_[A-Za-z]+\\.webp$`),
        `${dir}/${f} must be ${dir}_<Scene>.webp`)
    }
  }
  // The abbreviations are retired: no folder may use one.
  for (const abbr of ['LA', 'NYC', 'SFO', 'SF', 'Vegas', 'DC', 'SLC']) {
    assert.ok(!dirs.includes(abbr), `${abbr} is a retired abbreviation; use the full city name`)
  }
})

test('the canonical key is the folder name lowercased, with no exception', () => {
  // Los Angeles used to be keyed 'la' while every other city used its full
  // name, so its folder and its key disagreed. One rule now.
  const packs = parseSceneFiles([
    'LosAngeles/LosAngeles_Day.webp', 'LasVegas/LasVegas_Day.webp',
    'NewYork/NewYork_Day.webp', 'SanFrancisco/SanFrancisco_Day.webp',
    'Atlanta/Atlanta_Day.webp',
  ])
  assert.deepEqual(Object.keys(packs).sort(),
    ['atlanta', 'lasvegas', 'losangeles', 'newyork', 'sanfrancisco'])
  // And the three registries key on that same word.
  for (const city of Object.keys(packs)) {
    assert.ok(CITY_COORDS[city], `${city} needs coordinates keyed the same way`)
  }
  assert.equal(CITY_COORDS.la, undefined, "the 'la' key is retired")
})

test('a retired abbreviation no longer resolves, and the guard is what says so', () => {
  // Dropping a folder named NYC produces no pack at all now. That is caught by
  // the every-file-maps assertion above, which fails naming the exact files,
  // rather than falling back to Los Angeles unremarked.
  const packs = parseSceneFiles(['NYC/NYC_Day.webp'])
  assert.equal(packs.newyork, undefined, 'NYC is not a canonical name')
  assert.deepEqual(Object.keys(packs), ['nyc'], 'it parses as its own unknown city')
  assert.ok(!CITY_COORDS.nyc, 'which has no coordinates, so location can never reach it')
})

test('the vertical crop is per city, and only the cities whose mast or spire needs it opt out', () => {
  // Bottom-anchored is the default because the panoramas are composed with
  // ground at the bottom and sky to spare. Atlanta's spire (row 42), the
  // second Hollywood pack's radio mast (row 36) and the second New York
  // pack's One WTC needle (row 5) all reach into the top 61 rows the default
  // removes, so they crop centred. Everyone else stays.
  assert.equal(DEFAULT_IMG_Y, '100%')
  assert.deepEqual(Object.keys(CITY_IMG_Y).sort(), ['atlanta', 'hollywood', 'newyork'])
  assert.equal(imgPositionFor('atlanta'), '50%')
  assert.equal(imgPositionFor('hollywood'), '50%')
  assert.equal(imgPositionFor('newyork'), '50%')
  assert.equal(imgPositionFor('losangeles'), '100%')
  assert.equal(imgPositionFor(undefined), '100%')
})

test('the crop hook is applied where the art renders, not on the card', () => {
  const scenery = read('src/components/MastheadScenery.jsx')
  assert.match(scenery, /'--scn-img-y': imgPositionFor\(pack\?\.city\)/)
  // Read from the resolved pack, so a viewer who picks Atlanta explicitly gets
  // its framing too, not only one matched by location.
  assert.match(scenery, /imgPositionFor/)
  const css = read('src/index.css')
  assert.match(css, /object-position: 50% var\(--scn-img-y, 100%\)/)
})

test('CloudyNight parses as its own scene, not as bare Night', () => {
  // The parser reads the scene from the END of the basename, longest run
  // first, so "Hollywood_CloudyNight" must not resolve to 'night'.
  const packs = parseSceneFiles([
    'Hollywood/Hollywood_Night.webp', 'Hollywood/Hollywood_CloudyNight.webp',
  ])
  assert.equal(packs.hollywood.night, '/masthead/Hollywood/Hollywood_Night.webp')
  assert.equal(packs.hollywood.cloudynight, '/masthead/Hollywood/Hollywood_CloudyNight.webp')
  // The separated spellings work too, as they do for Golden Hour.
  for (const name of ['Cloudy Night', 'Cloudy_Night', 'Rainy Night', 'Night Rain']) {
    const p = parseSceneFiles([`Hollywood/Hollywood_${name}.webp`])
    assert.equal(Object.keys(p.hollywood)[0], 'cloudynight', name)
  }
})

test('an installed pack may add CloudyNight, and the five that predate it need not', () => {
  const files = readdirSync(join(here, '..', 'public', 'masthead'), { recursive: true })
    .map(f => String(f).replace(/\\/g, '/'))
    .filter(f => /\.(webp|png|jpe?g)$/i.test(f))
  const packs = parseSceneFiles(files)
  // Hollywood ships it; nobody is required to.
  assert.ok(packs.hollywood?.cloudynight, 'Hollywood carries CloudyNight')
  // And every pack, with or without it, is still COMPLETE on the required set.
  for (const city of Object.keys(packs)) {
    for (const scene of SCENES) assert.ok(packs[city]?.[scene], `${city} must carry ${scene}`)
  }
})
