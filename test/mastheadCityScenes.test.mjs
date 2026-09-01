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
import { parseSceneFiles, choosePack, normalizeCityToken, CITY_COORDS } from '../src/lib/mastheadCityScenes.js'
import { SCENES } from '../src/lib/mastheadScene.js'

const here = dirname(fileURLToPath(import.meta.url))

test('folder-per-city convention: the folder names the pack, scenes come from filename ends', () => {
  const packs = parseSceneFiles([
    'LA/LA_Dawn.webp', 'LA/LA_Morning.webp', 'LA/LA_Day.webp', 'LA/LA_Golden Hour.webp',
    'LA/LA_Sunset.webp', 'LA/LA_Night.webp', 'LA/LA_Rain.webp',
  ])
  assert.deepEqual(Object.keys(packs), ['la'])
  assert.equal(packs.la.dawn, '/masthead/LA/LA_Dawn.webp')
  assert.equal(packs.la.morning, '/masthead/LA/LA_Morning.webp')   // morning is its own scene now
  assert.equal(packs.la.goldenhour, '/masthead/LA/LA_Golden%20Hour.webp') // URI-encoded space
  assert.equal(packs.la.rain, '/masthead/LA/LA_Rain.webp')
  for (const scene of SCENES) assert.ok(packs.la[scene], `LA must carry ${scene}`)
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
  for (const files of [['LA/LA_Day.png', 'LA/LA_Day.webp'], ['LA/LA_Day.webp', 'LA/LA_Day.png']]) {
    assert.equal(parseSceneFiles(files).la.day, '/masthead/LA/LA_Day.webp')
  }
})

test('label match wins: resolved city name and aliases pick the pack directly', () => {
  const packs = parseSceneFiles(['LA/LA_Day.webp', 'Chicago/Chicago_Day.webp'])
  assert.equal(choosePack(packs, { label: 'Los Angeles', lat: 0, lon: 0 }).city, 'la')
  assert.equal(choosePack(packs, { label: 'Chicago', lat: 0, lon: 0 }).city, 'chicago')
  assert.equal(normalizeCityToken('Los Angeles'), 'losangeles')
})

test('proximity match: a viewer near a pack city gets that pack', () => {
  const packs = parseSceneFiles(['LA/LA_Day.webp', 'Chicago/Chicago_Day.webp'])
  // Palmdale is ~60 km from LA and nowhere near Chicago.
  assert.equal(choosePack(packs, { label: 'Palmdale', lat: 34.58, lon: -118.13 }).city, 'la')
  // Evanston sits on Chicago's shoulder.
  assert.equal(choosePack(packs, { label: 'Evanston', lat: 42.05, lon: -87.68 }).city, 'chicago')
})

test('fallback chain: distant viewer → LA pack; no packs → null (SVG scenery)', () => {
  const packs = parseSceneFiles(['LA/LA_Day.webp', 'Chicago/Chicago_Day.webp'])
  assert.equal(choosePack(packs, { label: 'Auckland', lat: -36.85, lon: 174.76 }).city, 'la')
  assert.equal(choosePack({}, { label: 'Auckland', lat: -36.85, lon: 174.76 }), null)
  const noLa = parseSceneFiles(['Chicago/Chicago_Day.webp'])
  assert.equal(choosePack(noLa, { label: 'Auckland', lat: -36.85, lon: 174.76 }), null)
})

test('the shipped LA folder is a complete seven-scene pack and nothing is orphaned', () => {
  const files = readdirSync(join(here, '..', 'public', 'masthead'), { recursive: true })
    .map(f => String(f).replace(/\\/g, '/'))
    .filter(f => /\.(webp|png|jpe?g)$/i.test(f))
  const packs = parseSceneFiles(files)
  const placed = Object.values(packs).reduce((n, p) => n + Object.keys(p).length, 0)
  assert.equal(placed, files.length, `every image file must map to a city+scene: ${files.join(', ')}`)
  for (const scene of SCENES) {
    assert.ok(packs.la?.[scene], `LA pack must include ${scene}`)
  }
})

test('proximity cities carry sane coordinates', () => {
  for (const [city, [lat, lon]] of Object.entries(CITY_COORDS)) {
    assert.ok(Math.abs(lat) <= 90 && Math.abs(lon) <= 180, `${city} coords out of range`)
  }
})

// ── MASTHEAD-SCENE-4: the viewer's chosen scenery city ───────────────────────

test('the city preference is artwork-only, per browser, and defaults to automatic', async () => {
  const { AUTO, cityOptions, cityDisplayName, CITY_PREF_KEY } = await import('../src/lib/mastheadCityPreference.js')
  assert.equal(AUTO, 'auto')
  assert.equal(CITY_PREF_KEY, 'aspire_masthead_city_v1')
  assert.equal(cityDisplayName('lasvegas'), 'Las Vegas')
  assert.equal(cityDisplayName('la'), 'Los Angeles')
  // Automatic always leads; installed packs follow in display order.
  const packs = parseSceneFiles(['LA/LA_Day.webp', 'Vegas/Vegas_Day.webp'])
  const opts = cityOptions(packs)
  assert.equal(opts[0].key, 'auto')
  assert.deepEqual(opts.slice(1).map(o => o.label), ['Las Vegas', 'Los Angeles'])
  // The picker changes SCENERY only - it must never touch the weather query.
  const pref = readFileSync(join(here, '..', 'src/lib/mastheadCityPreference.js'), 'utf8')
  assert.doesNotMatch(pref, /useWelcomeWeather|open-meteo|weatherLocation/)
})

test('an explicit city wins over location, and a stale choice falls back to automatic', () => {
  const scenery = readFileSync(join(here, '..', 'src/components/MastheadScenery.jsx'), 'utf8')
  // The override only applies when that pack is actually installed; otherwise
  // choosePack (location matching) runs, never the SVG fallback.
  assert.match(scenery, /if \(preferredCity && packs\[preferredCity\]\) return \{ city: preferredCity, scenes: packs\[preferredCity\] \}/)
  assert.match(scenery, /return choosePack\(packs, location\)/)
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
  assert.ok(cities.includes('la') && cities.includes('lasvegas') && cities.includes('newyork'),
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
