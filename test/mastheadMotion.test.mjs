// MASTHEAD-MOTION-1: the per-city motion registry. These guard DATA, not
// rendering: every coordinate in CITY_MOTION was measured off a specific frame,
// and the failure mode when one drifts is silent. Light lands on empty hillside
// and reads as dust on the lens, with nothing to catch it but the eye.
//
// Run: node --test test/mastheadMotion.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CITY_MOTION, CITY_IMG_Y, DEFAULT_IMG_Y } from '../src/lib/mastheadCityScenes.js'

const here = dirname(fileURLToPath(import.meta.url))
const MASTHEAD = join(here, '..', 'public', 'masthead')

// Anything not on this list is a typo. A misspelled effect key does not throw,
// it simply renders nothing, so the registry has to be closed rather than open.
const EFFECTS = ['lights', 'beacons', 'beaconTone', 'aircraft', 'water', 'bridge', 'beam',
  'birds', 'haze', 'hazeTone', 'flare', 'helicopter', 'rainfall', 'ferry', 'ferryTone', 'glints',
  'steam', 'neon', 'wheel', 'orb', 'snowfall', 'swell', 'sceneOverrides', 'sceneShift']
// A scene may carry its own measured point sets when its frame is a different
// drawing. Only point kinds, only these scenes (the two that share a frame
// with another scene's motion), and each set is a full replacement.
const OVERRIDE_SCENES = ['cloudynight']
const OVERRIDE_KINDS = ['lights', 'beacons', 'water']
// A scene whose frame is the same drawing MOVED gets one measured vertical
// shift of the anchored group instead of a second copy of every set.
const SHIFT_SCENES = ['cloudynight', 'snownight']
const CROSSINGS = ['aircraft', 'birds', 'helicopter', 'ferry']
const POINT_EFFECTS = ['lights', 'beacons', 'water', 'glints', 'steam', 'neon']
// Neon points may carry a tone as a third element; only this one is drawn.
const NEON_TONES = ['cyan']
// A city may carry one span or a list of them.
const spansOf = m => Array.isArray(m.bridge) ? m.bridge : m.bridge ? [m.bridge] : []

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

test('scene overrides name a real scene, replace only point kinds, and are measured too', () => {
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    for (const [scene, o] of Object.entries(m.sceneOverrides || {})) {
      assert.ok(OVERRIDE_SCENES.includes(scene), `${city}.sceneOverrides.${scene}: no CSS gate exists for that scene`)
      for (const [kind, pts] of Object.entries(o)) {
        assert.ok(OVERRIDE_KINDS.includes(kind), `${city}.sceneOverrides.${scene}.${kind} is not a point kind`)
        assert.ok(pts.length > 0, `${city}.sceneOverrides.${scene}.${kind} is empty; omit it instead`)
        for (const [x, y] of pts) assert.ok(x >= 0 && x <= 100 && y >= 0 && y <= 100, `${city}.${scene}.${kind} [${x},${y}] is outside the card`)
        for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
          assert.ok(Math.abs(pts[i][0] - pts[j][0]) > 0.4 || Math.abs(pts[i][1] - pts[j][1]) > 1.5,
            `${city}.${scene}.${kind} points ${i} and ${j} sit on top of each other`)
        }
      }
    }
    // Both CSS halves exist for every override scene, or the sets would stack.
    const css = readFileSync(join(here, '..', 'src', 'index.css'), 'utf8')
    for (const scene of Object.keys(m.sceneOverrides || {})) {
      assert.match(css, new RegExp(`\\.mast-scene-${scene} \\.mast-motion-only-${scene} \\{ display: contents; \\}`))
      assert.match(css, new RegExp(`\\.mast-scene-${scene} \\.mast-motion-not-${scene} \\{ display: none; \\}`))
    }
  }
  // Atlanta's Connector: the first pack refused traffic on a curve; the
  // second carries two short straight rails, the long one with the police car.
  assert.equal(spansOf(CITY_MOTION.atlanta).length, 2)
  assert.equal(spansOf(CITY_MOTION.atlanta)[0].police, true)
  // Hollywood's cloudy-night mast is a different drawing (x 72.5%, not 71.4%).
  assert.deepEqual(CITY_MOTION.hollywood.sceneOverrides.cloudynight.beacons[0], [72.5, 1.5])
})

test('nothing in the motion layer blends: two hundred blended layers over the bolt dropped every storm frame', () => {
  // MASTHEAD-BOLT-FLICKER-2 (2026-09-05). Taking the blend off the bolt alone
  // was not enough: with ~200 mix-blend-mode children above it, every frame
  // of the bolt's opacity animation made each of them re-read its backdrop.
  // Chromium dropped 37 frames of 75-167ms in 3.5s of the cloudy-night scene
  // and none with blending off, which the Owner saw as the whole screen
  // flickering on each strike. So the rule is for the whole block.
  const css = readFileSync(join(here, '..', 'src', 'index.css'), 'utf8')
  // The header line sits inside a comment, so start at that comment's opener.
  const start = css.lastIndexOf('/*', css.indexOf('MASTHEAD-MOTION-1 (PROTOTYPE): motion over the still artwork'))
  const end = css.indexOf('Motion is decoration, so reduced motion removes it outright')
  assert.ok(start > 0 && end > start, 'the motion block is where it was')
  const rules = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '')
  assert.doesNotMatch(rules, /mix-blend-mode/)
  assert.match(css, /\.mast-motion \{ position: absolute; inset: 0; pointer-events: none; overflow: hidden; \}/)
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
    for (const span of spansOf(m)) {
      const { deck, lights, police } = span
      assert.ok(deck && lights?.length, `${city}.bridge needs both deck and lights`)
      assert.ok(police === undefined || police === true, `${city}.bridge police is a flag, not a value`)
      const slope = deck.rise / deck.w
      for (const [x, y] of lights) {
        assert.ok(x >= deck.x - 0.5 && x <= deck.x + deck.w + 0.5,
          `${city} deck light at x=${x} is off the declared span`)
        const expected = deck.y + slope * (x - deck.x)
        assert.ok(Math.abs(y - expected) < 3,
          `${city} deck light at x=${x} is ${(y - expected).toFixed(1)}% off the deck line`)
      }
    }
  }
  // New York carries both East River spans, far then near, and they do not
  // overlap in x: two rails on one stretch would stack traffic.
  const ny = spansOf(CITY_MOTION.newyork)
  assert.equal(ny.length, 2)
  assert.ok(ny[0].deck.x + ny[0].deck.w <= ny[1].deck.x + 0.5, 'the far span runs into the near one')
})

test('a wheel and an orb are measured discs that sit on the card', () => {
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    for (const kind of ['wheel', 'orb']) {
      const d = m[kind]
      if (!d) continue
      assert.ok(d.x >= 0 && d.x <= 100 && d.y >= 0 && d.y <= 100, `${city}.${kind} centre is outside the card`)
      assert.ok(d.d > 0 && d.d < 12, `${city}.${kind} diameter ${d.d}% of the width is not a landmark`)
    }
    if (m.orb) assert.ok(m.orb.cut > 0 && m.orb.cut <= 100, `${city}.orb.cut must be a share of the disc`)
    for (const pt of m.neon || []) {
      if (pt[2] !== undefined) assert.ok(NEON_TONES.includes(pt[2]), `${city}.neon tone "${pt[2]}" has no glow`)
    }
  }
  // Las Vegas: the High Roller's rim (97px across, centre x 39.0) and the
  // Sphere (123px, cut by the skyline 54% of the way down).
  assert.deepEqual(CITY_MOTION.lasvegas.wheel, { x: 39.0, y: 58.6, d: 4.85 })
  assert.equal(CITY_MOTION.lasvegas.orb.cut, 54)
})

test('a scene shift names a gated scene, is small, and has its CSS rule', () => {
  const css = readFileSync(join(here, '..', 'src', 'index.css'), 'utf8')
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    for (const [scene, y] of Object.entries(m.sceneShift || {})) {
      assert.ok(SHIFT_SCENES.includes(scene), `${city}.sceneShift.${scene}: no CSS gate exists for that scene`)
      assert.ok(typeof y === 'number' && y !== 0 && Math.abs(y) <= 5,
        `${city}.sceneShift.${scene}=${y}: a shift is a few percent, measured; anything larger is a different drawing and wants sceneOverrides`)
      assert.match(css, new RegExp(`\\.mast-scene-${scene} \\.mast-motion-anchored \\{ transform: translateY\\(var\\(--shift-${scene}, 0\\)\\); \\}`))
      assert.ok(!m.sceneOverrides?.[scene], `${city}.${scene} has both a shift and an override; pick one`)
    }
  }
  // New York's cloudy night is the night drawing 2.2% lower (46 lights, 4 crowns),
  // and its snowy night 1.5% lower (the crowns at 44.1 and 83.5).
  assert.equal(CITY_MOTION.newyork.sceneShift.cloudynight, 2.2)
  assert.equal(CITY_MOTION.newyork.sceneShift.snownight, 1.5)
  // A swell is a measured patch inside the card; snowfall is a flag.
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    if (m.swell) {
      const { x, y, w, height } = m.swell
      assert.ok(x >= 0 && x + w <= 100 && y >= 0 && y + height <= 100, `${city}.swell leaves the card`)
    }
    if (m.snowfall !== undefined) assert.equal(m.snowfall, true, `${city}.snowfall is a flag`)
  }
  assert.equal(CITY_MOTION.newyork.snowfall, true)
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
  // Hollywood's mast lights are rgb(163,103,103) in the frame: red. The Golden
  // Gate's tower crowns are rgb(251,5,6) in the second San Francisco pack:
  // red. Everyone else's crowns are white, and stay on the default tone.
  assert.equal(CITY_MOTION.hollywood.beaconTone, 'red')
  assert.equal(CITY_MOTION.sanfrancisco.beaconTone, 'red')
  // New York's second pack paints aviation red on most crowns (rgb 252,27,17
  // on the Jersey City tower, 238,0,14 on the Manhattan Bridge tower).
  assert.equal(CITY_MOTION.newyork.beaconTone, 'red')
  // Las Vegas's second pack: the Strat's pod band is rgb(244,34,61) and the
  // crown at x 81.2 is 248,19,14.
  assert.equal(CITY_MOTION.lasvegas.beaconTone, 'red')
  // Los Angeles's second pack paints its crowns red too (the US Bank tower's
  // is rgb 252,38,6). Atlanta's first pack is the one on the default tone.
  assert.equal(CITY_MOTION.losangeles.beaconTone, 'red')
  // A ferry tone is 'orange' (the Staten Island Ferry) or 'white' (Washington
  // State's), each with a hull rule in the CSS, and only with a ferry.
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    if (m.ferryTone === undefined) continue
    assert.ok(['orange', 'white'].includes(m.ferryTone), `${city}.ferryTone "${m.ferryTone}" is not a known tone`)
    assert.ok(m.ferry, `${city} declares a ferry tone with no ferry to paint`)
    assert.match(readFileSync(join(here, '..', 'src', 'index.css'), 'utf8'), new RegExp(`\\.mast-motion-ferry-${m.ferryTone} \\.mast-motion-ferry-hull`))
  }
  assert.equal(CITY_MOTION.newyork.ferryTone, 'orange')
  assert.equal(CITY_MOTION.seattle.ferryTone, 'white')
  // A haze tone is likewise only 'fog', and only with a haze to colour.
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    if (m.hazeTone === undefined) continue
    assert.equal(m.hazeTone, 'fog', `${city}.hazeTone "${m.hazeTone}" is not a known tone`)
    assert.ok(m.haze, `${city} declares a haze tone with no haze to apply it to`)
  }
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
      // The sun sits at one EDGE or beyond it, never mid-card: ghosts are
      // placed toward the centre from it, and a mid-card sun would pile them on
      // the clock. Left of the quiet zone, or (mirrored) right of its reflection.
      assert.ok(m.flare.x < QUIET_ZONE_X || m.flare.x > 100 - QUIET_ZONE_X,
        `${city}.flare sun at x=${m.flare.x} is mid-card; a flare needs a sun at an edge`)
    }
  }
})

test('the crop exceptions are exactly the cities measured through them', () => {
  // A city cropped at 50% rather than the bottom-anchored default had its
  // coordinates converted differently. If someone changes a city's --scn-img-y,
  // every one of its points silently shifts by about 30px and this test is the
  // only thing that will say so. Atlanta, Hollywood (second pack) and New
  // York (second pack) are the three; all were measured through the centred crop.
  const CENTRED = ['atlanta', 'hollywood', 'newyork', 'lasvegas', 'seattle', 'hongkong']
  assert.equal(DEFAULT_IMG_Y, '100%')
  for (const city of CENTRED) assert.equal(CITY_IMG_Y[city], '50%', `${city} was measured through a 50% crop`)
  for (const city of Object.keys(CITY_MOTION)) {
    if (CENTRED.includes(city)) continue
    assert.equal(CITY_IMG_Y[city], undefined,
      `${city} now has a custom --scn-img-y, so its measured points need redoing`)
  }
})
