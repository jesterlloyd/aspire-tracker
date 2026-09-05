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
const EFFECTS = ['lights', 'beacons', 'beaconTone', 'aircraft', 'water', 'bridge', 'beam',
  'birds', 'haze', 'flare', 'helicopter', 'rainfall']
const CROSSINGS = ['aircraft', 'birds', 'helicopter']
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

test('the left third is lit too, now that nothing fades it', () => {
  // MASTHEAD-LOCKSCREEN-1 retired the half-card fade, and with it the rule
  // that no point may sit under the greeting. Every city was re-measured on
  // its left third; each must now carry at least one point there.
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    assert.ok((m.lights || []).some(([x]) => x < QUIET_ZONE_X),
      `${city} has no measured light in the left third; the frame was not re-measured after the fade came off`)
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

test('every crossing has a flight, a direction, and a height inside the card', () => {
  // The on-screen fraction of a cycle is the VISIBLE constant in MastheadMotion,
  // written against the keyframes; a stored cycle would be a second source that
  // could disagree with it, so the data carries only the flight.
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    for (const kind of CROSSINGS) {
      const c = m[kind]
      if (!c) continue
      assert.ok(c.flight > 0, `${city}.${kind} needs a flight duration`)
      assert.equal(c.cycle, undefined, `${city}.${kind} carries a cycle; the component derives it, remove the field`)
      assert.notEqual(c.from, c.to, `${city}.${kind} must actually move`)
      assert.ok(c.y >= 0 && c.y <= 100, `${city}.${kind} y=${c.y} is outside the card`)
    }
  }
})

test('beacon tone is only red where the artwork paints it red', () => {
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    if (m.beaconTone === undefined) continue
    assert.equal(m.beaconTone, 'red', `${city}.beaconTone "${m.beaconTone}" is not a known tone`)
    assert.ok(m.beacons?.length, `${city} declares a beacon tone with no beacons to apply it to`)
  }
  // Hollywood's mast lights are rgb(163,103,103) in the frame: red. Everyone
  // else's crowns are white, and stay on the default tone.
  assert.equal(CITY_MOTION.hollywood.beaconTone, 'red')
  assert.equal(CITY_MOTION.losangeles.beaconTone, undefined)
})

test('haze and flare stay on the card where they must, and off it where they may', () => {
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    if (m.haze) {
      assert.ok(m.haze.y >= 0 && m.haze.y + m.haze.height <= 100, `${city}.haze band leaves the card`)
    }
    if (m.flare) {
      // The sun may sit OFF the card (a light source at the edge of frame is the
      // normal case for a flare), but its height must be on it.
      assert.ok(m.flare.y >= 0 && m.flare.y <= 100, `${city}.flare y=${m.flare.y} is outside the card`)
      assert.ok(m.flare.x < QUIET_ZONE_X, `${city}.flare sun at x=${m.flare.x}: ghosts are placed toward the centre from it, so a sun on the right would throw them over the greeting`)
    }
  }
})

test('the crop exceptions are exactly the cities measured through them', () => {
  // A city cropped at 50% rather than the bottom-anchored default had its
  // coordinates converted differently. If someone changes a city's --scn-img-y,
  // every one of its points silently shifts by about 30px and this test is the
  // only thing that will say so. Atlanta and Hollywood (second pack) are the
  // two; both were measured through the centred crop.
  const CENTRED = ['atlanta', 'hollywood']
  assert.equal(DEFAULT_IMG_Y, '100%')
  for (const city of CENTRED) assert.equal(CITY_IMG_Y[city], '50%', `${city} was measured through a 50% crop`)
  for (const city of Object.keys(CITY_MOTION)) {
    if (CENTRED.includes(city)) continue
    assert.equal(CITY_IMG_Y[city], undefined,
      `${city} now has a custom --scn-img-y, so its measured points need redoing`)
  }
})
