// MASTHEAD-MOTION-1: the per-city motion registry. These guard DATA, not
// rendering: every coordinate in CITY_MOTION was measured off a specific frame,
// and the failure mode when one drifts is silent. Light lands on empty hillside
// and reads as dust on the lens, with nothing to catch it but the eye.
//
// Run: node --test test/mastheadMotion.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CITY_MOTION, CITY_IMG_Y, DEFAULT_IMG_Y } from '../src/lib/mastheadCityScenes.js'

const here = dirname(fileURLToPath(import.meta.url))
const MASTHEAD = join(here, '..', 'public', 'masthead')

// Anything not on this list is a typo. A misspelled effect key does not throw,
// it simply renders nothing, so the registry has to be closed rather than open.
const EFFECTS = ['lights', 'beacons', 'aircraft', 'water', 'bridge', 'beam']
const POINT_EFFECTS = ['lights', 'beacons', 'water']

// The artwork's left fade runs to 62%, and the greeting sits in it. Points to
// the left of this are washed out at best and fight the text at worst.
const QUIET_ZONE_X = 46

test('every city in the registry has an installed scene pack', () => {
  const folders = readdirSync(MASTHEAD, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name.toLowerCase())
  for (const city of Object.keys(CITY_MOTION)) {
    assert.ok(folders.includes(city),
      `CITY_MOTION has "${city}" but public/masthead has no folder for it`)
  }
})

test('every effect key is a known effect', () => {
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    for (const key of Object.keys(m)) {
      assert.ok(EFFECTS.includes(key),
        `${city} declares unknown effect "${key}" - a typo renders nothing and throws nothing`)
    }
  }
})

test('every point sits inside the card', () => {
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    for (const key of POINT_EFFECTS) {
      for (const [x, y] of m[key] || []) {
        assert.ok(x >= 0 && x <= 100, `${city}.${key} x=${x} is outside the card`)
        assert.ok(y >= 0 && y <= 100, `${city}.${key} y=${y} is outside the card`)
      }
    }
  }
})

test('no lit point sits in the greeting quiet zone', () => {
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    for (const key of POINT_EFFECTS) {
      for (const [x] of m[key] || []) {
        assert.ok(x >= QUIET_ZONE_X,
          `${city}.${key} has a point at x=${x}, inside the greeting's quiet zone (<${QUIET_ZONE_X}%)`)
      }
    }
  }
})

test('no two points of the same effect collide', () => {
  // Two glows on one light is twice as bright as the measurement intended, and
  // reads as a hotspot rather than as that light breathing.
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    for (const key of POINT_EFFECTS) {
      const pts = m[key] || []
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = Math.abs(pts[i][0] - pts[j][0])
          const dy = Math.abs(pts[i][1] - pts[j][1])
          assert.ok(dx > 0.4 || dy > 1.5,
            `${city}.${key} points ${i} and ${j} sit on top of each other`)
        }
      }
    }
  }
})

test('bridge deck lights lie along the declared deck line', () => {
  // The deck line is what traffic rides. If the lights and the line disagree,
  // the cars drive off the roadway and nothing else notices.
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    if (!m.bridge) continue
    const { deck, lights } = m.bridge
    assert.ok(deck && lights?.length, `${city}.bridge needs both deck and lights`)
    const slope = deck.rise / deck.w
    for (const [x, y] of lights) {
      assert.ok(x >= deck.x - 0.5 && x <= deck.x + deck.w + 0.5,
        `${city} deck light at x=${x} is off the declared span`)
      const expected = deck.y + slope * (x - deck.x)
      assert.ok(Math.abs(y - expected) < 3,
        `${city} deck light at x=${x} is ${(y - expected).toFixed(1)}% off the deck line`)
    }
  }
})

test('a beam stands on the card and rises inside it', () => {
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    if (!m.beam) continue
    const { x, y, height, width } = m.beam
    assert.ok(x >= QUIET_ZONE_X && x <= 100, `${city}.beam x=${x} is outside the lit half`)
    assert.ok(y > 0 && y <= 100, `${city}.beam base y=${y} is outside the card`)
    assert.ok(height > 0 && y - height >= 0,
      `${city}.beam rises ${height}% from y=${y} and leaves the top of the card`)
    assert.ok(width > 0 && width < 10, `${city}.beam width=${width}% is not a beam`)
  }
})

test('aircraft crosses the frame and leaves it', () => {
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    if (!m.aircraft) continue
    const a = m.aircraft
    assert.ok(a.flight < a.cycle,
      `${city}.aircraft flight ${a.flight}s must be shorter than its ${a.cycle}s cycle, or the sky never empties`)
    assert.ok(a.from > a.to, `${city}.aircraft should travel right to left`)
    assert.ok(a.y >= 0 && a.y <= 100, `${city}.aircraft y=${a.y} is outside the card`)
  }
})

test('Atlanta is the crop exception, and the registry knows it', () => {
  // Atlanta is cropped at 50% rather than the bottom-anchored default, so its
  // coordinates went through a different conversion. If someone changes its
  // --scn-img-y, every Atlanta point silently shifts by about 30px and this
  // test is the only thing that will say so.
  assert.equal(CITY_IMG_Y.atlanta, '50%')
  assert.equal(DEFAULT_IMG_Y, '100%')
  for (const city of Object.keys(CITY_MOTION)) {
    if (city === 'atlanta') continue
    assert.equal(CITY_IMG_Y[city], undefined,
      `${city} now has a custom --scn-img-y, so its measured points need redoing`)
  }
})
