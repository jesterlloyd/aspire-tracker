// MASTHEAD-SCENE-2: city scene packs - filename parsing, webp preference,
// alias and proximity matching, and the LA/SVG fallback chain.
//
// Run: node --test test/mastheadCityScenes.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseSceneFiles, choosePack, normalizeCityToken, CITY_COORDS } from '../src/lib/mastheadCityScenes.js'

const here = dirname(fileURLToPath(import.meta.url))

test('parses the canonical filename convention into packs', () => {
  const packs = parseSceneFiles(['LA_Day.webp', 'LA_Sunset.webp', 'LA_Night.webp', 'LA_Morning.webp'])
  assert.deepEqual(Object.keys(packs), ['la'])
  assert.equal(packs.la.day, '/masthead/LA_Day.webp')
  assert.equal(packs.la.sunset, '/masthead/LA_Sunset.webp')
  assert.equal(packs.la.night, '/masthead/LA_Night.webp')
  assert.equal(packs.la.dawn, '/masthead/LA_Morning.webp') // Morning → dawn
})

test('scene synonyms, multi-word cities, and junk files', () => {
  const packs = parseSceneFiles([
    'Las_Vegas_Dusk.png', 'Las_Vegas_Sunrise.png', 'Chicago_EarlyMorning.webp',
    'README.md', 'notes.txt', 'Paris_Banner.png', 'Tokyo.png',
  ])
  assert.equal(packs.lasvegas.sunset, '/masthead/Las_Vegas_Dusk.png')
  assert.equal(packs.lasvegas.dawn, '/masthead/Las_Vegas_Sunrise.png')
  assert.equal(packs.chicago.dawn, '/masthead/Chicago_EarlyMorning.webp')
  assert.equal(packs.paris, undefined)  // "Banner" is not a scene word
  assert.equal(packs.tokyo, undefined)  // no scene suffix at all
})

test('webp beats png for the same city and scene, in either order', () => {
  for (const files of [['LA_Day.png', 'LA_Day.webp'], ['LA_Day.webp', 'LA_Day.png']]) {
    assert.equal(parseSceneFiles(files).la.day, '/masthead/LA_Day.webp')
  }
})

test('label match wins: resolved city name and aliases pick the pack directly', () => {
  const packs = parseSceneFiles(['LA_Day.webp', 'Chicago_Day.webp'])
  assert.equal(choosePack(packs, { label: 'Los Angeles', lat: 0, lon: 0 }).city, 'la')
  assert.equal(choosePack(packs, { label: 'Chicago', lat: 0, lon: 0 }).city, 'chicago')
  assert.equal(normalizeCityToken('Los Angeles'), 'losangeles')
})

test('proximity match: a viewer near a pack city gets that pack', () => {
  const packs = parseSceneFiles(['LA_Day.webp', 'Chicago_Day.webp'])
  // Palmdale is ~60 km from LA and nowhere near Chicago.
  assert.equal(choosePack(packs, { label: 'Palmdale', lat: 34.58, lon: -118.13 }).city, 'la')
  // Evanston sits on Chicago's shoulder.
  assert.equal(choosePack(packs, { label: 'Evanston', lat: 42.05, lon: -87.68 }).city, 'chicago')
})

test('fallback chain: distant viewer → LA pack; no packs → null (SVG scenery)', () => {
  const packs = parseSceneFiles(['LA_Day.webp', 'Chicago_Day.webp'])
  assert.equal(choosePack(packs, { label: 'Auckland', lat: -36.85, lon: 174.76 }).city, 'la')
  assert.equal(choosePack({}, { label: 'Auckland', lat: -36.85, lon: 174.76 }), null)
  const noLa = parseSceneFiles(['Chicago_Day.webp'])
  assert.equal(choosePack(noLa, { label: 'Auckland', lat: -36.85, lon: 174.76 }), null)
})

test('every prepared file in public/masthead parses into a pack scene', () => {
  const files = readdirSync(join(here, '..', 'public', 'masthead')).filter(f => /\.(webp|png|jpe?g)$/i.test(f))
  const packs = parseSceneFiles(files)
  const placed = Object.values(packs).reduce((n, p) => n + Object.keys(p).length, 0)
  assert.equal(placed, files.length, `every image file must map to a city+scene: ${files.join(', ')}`)
  // The shipped LA pack is complete - all four scenes present.
  for (const scene of ['day', 'sunset', 'night', 'dawn']) {
    assert.ok(packs.la?.[scene], `LA pack must include ${scene}`)
  }
})

test('proximity cities carry sane coordinates', () => {
  for (const [city, [lat, lon]] of Object.entries(CITY_COORDS)) {
    assert.ok(Math.abs(lat) <= 90 && Math.abs(lon) <= 180, `${city} coords out of range`)
  }
})
