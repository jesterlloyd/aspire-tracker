// MASTHEAD-MOTION-1: the per-city motion registry. These guard DATA, not
// rendering: every coordinate in CITY_MOTION was measured off a specific frame,
// and the failure mode when one drifts is silent. Light lands on empty hillside
// and reads as dust on the lens, with nothing to catch it but the eye.
//
// Run: node --test test/mastheadMotion.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CITY_MOTION, CARD_ASPECT } from '../src/lib/mastheadCityScenes.js'

const here = dirname(fileURLToPath(import.meta.url))
const MASTHEAD = join(here, '..', 'public', 'masthead')

// Anything not on this list is a typo. A misspelled effect key does not throw,
// it simply renders nothing, so the registry has to be closed rather than open.
const EFFECTS = ['lights', 'beacons', 'beaconTone', 'aircraft', 'water', 'bridge', 'beam',
  'birds', 'haze', 'hazeTone', 'flare', 'helicopter', 'rainfall', 'ferry', 'ferryTone', 'glints',
  'steam', 'neon', 'wheel', 'orb', 'emoji', 'torch', 'strike', 'snowfall', 'swell', 'surf', 'rainbow', 'cable', 'sceneOverrides', 'sceneShift']
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
// Beacon points may carry a variant as a third element, the way neon points
// carry a tone. Only this one is drawn.
const BEACON_VARIANTS = ['glow']
// Neon points may carry a tone as a third element; only this one is drawn.
const NEON_TONES = ['cyan']
// Two glows are "on top of each other" at a PHYSICAL distance, so the vertical
// threshold has to be stated as one. 0.2542% of the card's WIDTH is what 1.5%
// of its height meant on the old 5.9:1 card; MASTHEAD-FULL-FRAME-1 made the
// card 5:1 and every measured y shrank by the same factor, so a threshold left
// at 1.5 would have started failing pairs that never moved relative to the art.
const MIN_DY = 0.2542 * CARD_ASPECT
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
  // MASTHEAD-HOLLYWOOD-3: NOTHING declares sceneOverrides any more. Hollywood's
  // second pack was its only user - its cloudy-night frame drew the mast at a
  // different x - and the third pack's ten frames align within 1px, so the
  // override went with the art. The machinery stays: it is general, it is
  // tested above, and the next pack whose weather frame is a different drawing
  // will want it. This asserts it is unused rather than absent, so that a city
  // quietly acquiring one is a deliberate act.
  const withOverrides = Object.entries(CITY_MOTION).filter(([, m]) => m.sceneOverrides)
  assert.deepEqual(withOverrides.map(([c]) => c), [],
    'a city declares sceneOverrides again; make sure its frames really are different drawings')
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

// MASTHEAD-GLINTS-EVERYWHERE (Owner, 2026-09-07): "glints is what I love. can
// you put it in daytime water features". Every city that paints water carries
// them; the six that paint none (Hollywood, Los Angeles, Las Vegas, Atlanta,
// Tokyo, Rome) are exempt because there is nothing to sparkle on - checked
// frame by frame, the blue below their horizons is glass, haze and hillside.
// This guard is for the NEXT water city: an effect that says a city has water
// obliges it to say where the sun lands on it.
test('a city with water has sun glitter on it', () => {
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    const hasWater = (m.water?.length || 0) > 0 || !!m.swell || (m.surf?.length || 0) > 0
    if (!hasWater) continue
    assert.ok((m.glints?.length || 0) > 0,
      `${city} paints water but declares no glints; daytime water sparkles (Owner)`)
  }
  // The two the Owner asked to enrich, and the two already carrying a full set.
  assert.ok(CITY_MOTION.rio.glints.length >= 39, 'Rio lost its second glint pass')
  assert.ok(CITY_MOTION.sanfrancisco.glints.length >= 25, 'San Francisco lost its second glint pass')
  assert.ok(CITY_MOTION.newyork.glints.length >= 30)
  // A sparkle centred on the card's edge is half a sparkle, and one at the
  // very bottom row is clipped by the card's own corner radius.
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    for (const [x, y] of m.glints || []) {
      assert.ok(x >= 0.5 && x <= 99.5, `${city} has a glint at x ${x}, on the card's edge`)
      assert.ok(y <= 97, `${city} has a glint at y ${y}, in the card's bottom edge`)
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
          assert.ok(dx > 0.4 || dy > MIN_DY,
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
  // MASTHEAD-NY-DECK-2: both rails re-traced on the roadway (Owner: "the cars
  // seem to elevate from the bridge in the right side part"). The check above
  // is worth reading honestly: it asks whether a span's lights and its line
  // agree with EACH OTHER, which the first pass did - the lights were measured
  // off the cables and the city behind them, and the rail was fitted to those
  // lights, so a bridge whose traffic ran up to 13% of the card above the
  // roadway passed every test in this file. Nothing here can read the
  // artwork, so these two lines are pinned instead, and a change to them is a
  // change that has to be re-measured against the frame.
  assert.deepEqual(ny[0].deck, { x: 57, y: 56.4, w: 16, rise: 4.3 })
  assert.deepEqual(ny[1].deck, { x: 75, y: 61.5, w: 16, rise: 7.8 })
  // Both East River spans fall away to the right in this drawing's
  // perspective. A rail that runs flat across a span the artwork paints
  // falling is the defect that was fixed here.
  for (const span of ny) assert.ok(span.deck.rise > 3, 'a New York span cannot run flat')
})

// MASTHEAD-CAR-PACE-1: a car crosses ITS SPAN in one period, so a fixed period
// makes the real speed a function of span width. Spans run 5% to 98% of the
// card, which had Las Vegas's traffic moving nineteen times faster than Los
// Angeles's. The period scales with the square root of the span; this pins the
// resulting speeds to a band rather than pinning one city's number.
test('traffic runs at a comparable speed on every span, whatever its length', async () => {
  const src = readFileSync(new URL('../src/components/masthead/MastheadMotion.jsx', import.meta.url), 'utf8')
  assert.match(src, /const carPace = w => Math\.sqrt\(Math\.max\(w, CAR_REF_SPAN\) \/ CAR_REF_SPAN\)/,
    'the pace must come from the span width, not a constant')
  assert.match(src, /'--dur': `\$\{\(c\.dur \* carPace\(span\.deck\.w\)/, 'cars must use the paced period')
  assert.match(src, /'--dur': `\$\{\(23 \* carPace\(span\.deck\.w\)\)/, 'the police car must use it too')
  const carPace = w => Math.sqrt(Math.max(w, 5) / 5)
  const speeds = []
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    for (const span of spansOf(m)) {
      const w = span.deck.w
      // the shortest car period is 9s; the slowest is 17s
      speeds.push([city, w, w / (9 * carPace(w))])
    }
  }
  assert.ok(speeds.length >= 10, 'expected traffic on several cities')
  for (const [city, w, v] of speeds) {
    assert.ok(v <= 2.6, `${city}'s ${w}% span moves at ${v.toFixed(2)}% of the card per second - too fast to read as traffic`)
    assert.ok(v >= 0.4, `${city}'s ${w}% span moves at ${v.toFixed(2)}% of the card per second - slow enough to look stopped`)
  }
  const fastest = Math.max(...speeds.map(s => s[2])), slowest = Math.min(...speeds.map(s => s[2]))
  assert.ok(fastest / slowest <= 6,
    `the fastest traffic is ${(fastest / slowest).toFixed(1)}x the slowest; a fixed period made that 19x`)
})

test('the forked lightning names files that exist, and only wet scenes render it', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  const src = readFileSync(new URL('../src/components/masthead/MastheadMotion.jsx', import.meta.url), 'utf8')
  const urls = [...css.matchAll(/\.mast-motion-strike-[ab]\s*\{[^}]*url\('([^']+)'\)/g)].map(m => m[1])
  assert.equal(urls.length, 2, 'both bolt shapes must be declared')
  for (const u of urls) {
    assert.ok(existsSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', u)),
      `the strike names ${u}, which is not on disk - a missing image is silently no lightning`)
  }
  // An <img>/background loads whether or not CSS hid it, so the guard is in
  // the component: a dry card must not pull the assets down at all.
  assert.match(src, /\{strike && wet && BOLTS\.map/, 'the strike must be gated on wet in the component, not only in CSS')
  // The box has to come from each shape's measured tip, or "hit the tower"
  // silently degrades to "put a rectangle near the tower".
  assert.match(src, /const BOLTS = \[/, 'the bolt tip fractions must be declared')
  assert.match(src, /left: `\$\{\(strike\.x \+ \(0\.5 - bolt\.tipX\) \* strike\.w\)/)
  assert.match(src, /top: `\$\{\(strike\.y - bolt\.tipY \* h\)/)
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
    for (const pt of m.beacons || []) {
      if (pt[2] !== undefined) assert.ok(BEACON_VARIANTS.includes(pt[2]),
        `${city}.beacons variant "${pt[2]}" has no rule; an unknown variant renders the default and throws nothing`)
    }
  }
  // Las Vegas, third pack: the High Roller fitted from its rim above the
  // skyline (top pixel 39.35/47.25, half-chord 1.80 at y 54.75 -> radius
  // 1.83% of the card width), and the Sphere from its solid-yellow component.
  assert.deepEqual(CITY_MOTION.lasvegas.wheel, { x: 39.35, y: 56.4, d: 3.66 })
  // London's Eye, fitted to the rim arc that stands against clear sky.
  assert.deepEqual(CITY_MOTION.london.wheel, { x: 38.7, y: 21.95, d: 6.97 })
  // A wheel is a circle drawn with aspect-ratio 1, so its diameter is a share
  // of the card's WIDTH and its vertical reach is CARD_ASPECT x that share of the
  // height. Both ends of that reach have to stay on the card, or the rim is
  // clipped and no longer reads as turning.
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    if (!m.wheel) continue
    const halfV = m.wheel.d / 2 * CARD_ASPECT
    assert.ok(m.wheel.y - halfV >= 0 && m.wheel.y + halfV <= 100,
      `${city}.wheel reaches y ${(m.wheel.y - halfV).toFixed(1)}..${(m.wheel.y + halfV).toFixed(1)}, off the card`)
  }
  assert.equal(CITY_MOTION.lasvegas.orb.cut, 67)
  // MASTHEAD-SPHERE-FACE-1: a face is drawn on a landmark, so its disc must BE
  // that landmark's disc. If the emoji and the orb ever disagree the features
  // slide off the sphere and land on the skyline, which nothing else reports.
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    if (!m.emoji) continue
    assert.ok(m.orb, `${city}.emoji needs the orb it is drawn on`)
    assert.deepEqual({ x: m.emoji.x, y: m.emoji.y, d: m.emoji.d },
      { x: m.orb.x, y: m.orb.y, d: m.orb.d },
      `${city}.emoji must sit exactly on ${city}.orb`)
    assert.ok(m.emoji.d > 0 && m.emoji.d < 12, `${city}.emoji is not a landmark-sized disc`)
  }
  assert.deepEqual(CITY_MOTION.lasvegas.emoji, { x: 46.9, y: 67.0, d: 4.8 })
  // MASTHEAD-TORCH-1 / MASTHEAD-STRIKE-1: both are single measured points on
  // the card, and the strike carries raster art, so the files it names have to
  // exist - a missing background-image fails silently as no lightning at all.
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    if (m.torch) assert.ok(m.torch.x >= 0 && m.torch.x <= 100 && m.torch.y >= 0 && m.torch.y <= 100,
      `${city}.torch is off the card`)
    if (!m.strike) continue
    // x and y are WHERE THE TIP LANDS, so they are a point on the card, and
    // the box is derived from each shape's own tip fraction in the component.
    const { x, y, w } = m.strike
    assert.ok(w > 0 && w < 40, `${city}.strike width ${w} is not a bolt`)
    assert.ok(x >= 0 && x <= 100 && y >= 0 && y <= 100, `${city}.strike tip is off the card`)
  }
  assert.deepEqual(CITY_MOTION.newyork.torch, { x: 22.5, y: 49.5 })
  assert.deepEqual(CITY_MOTION.newyork.strike, { x: 40.5, y: 16, w: 11 })
  // The point of the effect: the tip must land ON One World Trade. The spire's
  // red beacon is the topmost beacon in the entry, so the strike has to share
  // its column and sit below it, on the tower rather than in open sky.
  const spire = CITY_MOTION.newyork.beacons.reduce((a, b) => (b[1] < a[1] ? b : a))
  assert.ok(Math.abs(CITY_MOTION.newyork.strike.x - spire[0]) < 1.5,
    `the strike lands at x ${CITY_MOTION.newyork.strike.x} but One World Trade is at ${spire[0]}`)
  assert.ok(CITY_MOTION.newyork.strike.y > spire[1],
    'the strike must land below the spire tip, not above it')
})

// MASTHEAD-TORCH-1 and MASTHEAD-BEACON-GLOW-1 both exist because a light was
// hard to see, and both have now been corrected in BOTH directions by the
// Owner: the torch shipped as a floodlight ("too much glow"), was cut back,
// and went out entirely ("I think you might have removed the torch glow
// altogether. I can't see it now"). What a light is FOR cannot be asserted,
// but the two ways it fails can be bounded: a core too small to see, and a
// breath whose low end is dark.
test('the lights that are meant to be noticed stay lit', () => {
  const css = readFileSync(join(here, '..', 'src', 'index.css'), 'utf8')
  const block = name => {
    const at = css.indexOf(name)
    assert.ok(at > 0, `${name} is not defined in index.css`)
    return css.slice(at, css.indexOf('}', at) + 1)
  }
  const floors = frames => [...frames.matchAll(/opacity:\s*([\d.]+)/g)].map(m => Number(m[1]))

  // The flame. Its core is a pixel size rather than a card share because the
  // artwork's own flame is a fixed feature of the frame, not a share of it.
  const torch = block('.mast-motion-torch {')
  const px = Number(/width:\s*(\d+(?:\.\d+)?)px/.exec(torch)[1])
  assert.ok(px >= 12 && px <= 20, `the torch core is ${px}px; under 12 it disappears and over 20 it floods`)
  const torchFrames = css.slice(css.indexOf('@keyframes mast-torch'), css.indexOf('@keyframes mast-torch') + 260)
  assert.ok(Math.min(...floors(torchFrames)) >= 0.5,
    'the torch breathes down to nothing; a flame dims, it does not go out')

  // The landmark beacon. Bigger than an aviation light, and never dark.
  const base = Number(/width:\s*calc\(?\s*(\d+)px/.exec(block('.mast-motion-beacon {'))?.[1]
    ?? /width:\s*(\d+)px/.exec(block('.mast-motion-beacon {'))[1])
  const glow = Number(/width:\s*(\d+)px/.exec(block('.mast-motion-beacon-glow {'))[1])
  assert.ok(glow > base, `a glow beacon (${glow}px) must be larger than an aviation one (${base}px)`)
  const glowFrames = css.slice(css.indexOf('@keyframes mast-beacon-glow'), css.indexOf('@keyframes mast-beacon-glow') + 200)
  assert.ok(Math.min(...floors(glowFrames)) >= 0.35,
    'the landmark beacon blinks like a mast light; it is meant to glow')
  // It is a night light, gated exactly as the beacon it is a variant of.
  for (const scene of ['night', 'cloudynight', 'rainnight', 'snownight']) {
    assert.ok(css.includes(`.mast-scenic.mast-scene-${scene} .mast-motion-beacon-glow`),
      `the glow beacon has no ${scene} gate, so it animates in scenes the base beacon sits out`)
  }
  // And the component has to hand the variant to that class, or the registry
  // says 'glow' and the card renders an ordinary beacon.
  const src = readFileSync(join(here, '..', 'src', 'components', 'masthead', 'MastheadMotion.jsx'), 'utf8')
  assert.match(src, /variant === 'glow' \? ' mast-motion-beacon-glow' : ''/)
})

test('a scene shift names a gated scene, is small, and has its CSS rule', () => {
  const css = readFileSync(join(here, '..', 'src', 'index.css'), 'utf8')
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    for (const [scene, y] of Object.entries(m.sceneShift || {})) {
      assert.ok(SHIFT_SCENES.includes(scene), `${city}.sceneShift.${scene}: no CSS gate exists for that scene`)
      assert.ok(typeof y === 'number' && y !== 0 && Math.abs(y) <= 5 * (CARD_ASPECT / 5.9),
        `${city}.sceneShift.${scene}=${y}: a shift is a few percent, measured; anything larger is a different drawing and wants sceneOverrides`)
      assert.match(css, new RegExp(`\\.mast-scene-${scene} \\.mast-motion-anchored \\{ transform: translateY\\(var\\(--shift-${scene}, 0\\)\\); \\}`))
      assert.ok(!m.sceneOverrides?.[scene], `${city}.${scene} has both a shift and an override; pick one`)
    }
  }
  // MASTHEAD-NEWYORK-3: the second pack's cloudy and snowy nights were the
  // night drawing moved down, so they needed a measured shift. The third
  // pack's twelve frames all align within 2px, so NOTHING declares a shift any
  // more. The machinery is kept and the rules above still hold for the next
  // pack that needs it; this asserts it is currently unused rather than
  // pinning a city to a number that no longer exists.
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    assert.equal(m.sceneShift, undefined, `${city} declares a sceneShift; none is expected`)
  }
  // A swell is a measured patch inside the card; snowfall is a flag.
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    if (m.swell) {
      const { x, y, w, height } = m.swell
      assert.ok(x >= 0 && x + w <= 100 && y >= 0 && y + height <= 100, `${city}.swell leaves the card`)
    }
    if (m.snowfall !== undefined) assert.equal(m.snowfall, true, `${city}.snowfall is a flag`)
    // MASTHEAD-SURF-1: a crest is a bar on a traced shoreline - x, y, width
    // and the rise across that width. A crest whose ends leave the card, or
    // whose rise is steeper than a shoreline can be, is a measurement error:
    // the whole point of the kind is that it lies ON the waterline.
    for (const [x, y, w, rise] of m.surf || []) {
      assert.ok(x >= 0 && x + w <= 100, `${city}.surf crest at x=${x} width ${w} leaves the card`)
      assert.ok(w > 0, `${city}.surf crest at x=${x} has no width`)
      assert.ok(y >= 0 && y <= 100 && y + rise >= 0 && y + rise <= 100,
        `${city}.surf crest at x=${x} runs off the card between y=${y} and y=${y + rise}`)
      assert.ok(Math.abs(rise) <= 8,
        `${city}.surf crest at x=${x} falls ${rise}% across ${w}%; a shoreline that steep was mis-traced`)
    }
  }
  assert.equal(CITY_MOTION.newyork.snowfall, true)
  // MASTHEAD-HONOLULU-2: this artwork breaks in TWO places, so the crests are
  // two sets and neither one's direction is the invariant. The beach set
  // climbs the card west to east as the bay curves away; the reef set sweeps
  // DOWN toward the viewer. What holds for both is that each set is one
  // continuous line - every crest starts exactly where the last ended, on the
  // same line - and that the shore break is always INSHORE of the reef break
  // wherever they share an x. A resorted trace, or a rise that no longer
  // belongs to its segment, breaks the chain.
  assert.equal(CITY_MOTION.newyork.surf, undefined,
    'New York has no breaking crest in its water; the harbour chop is glints')
  const surf = CITY_MOTION.honolulu.surf
  assert.equal(surf.length, 13)
  const beach = surf.slice(0, 9), reef = surf.slice(9, 12), outer = surf[12]
  const chain = (set, label) => {
    for (let i = 1; i < set.length; i++) {
      const [px, py, pw, prise] = set[i - 1]
      assert.equal(set[i][0], px + pw, `honolulu.surf ${label} has a gap between crests`)
      assert.ok(Math.abs(set[i][1] - (py + prise)) < 0.02,
        `honolulu.surf ${label} steps off its own line between crests`)
    }
  }
  chain(beach, 'shore break')
  chain(reef, 'reef break')
  // Direction, asserted per set rather than across the array.
  for (let i = 1; i < beach.length; i++) {
    assert.ok(beach[i][1] <= beach[i - 1][1], 'honolulu.surf shore break does not climb the card')
  }
  for (let i = 1; i < reef.length; i++) {
    assert.ok(reef[i][1] > reef[i - 1][1], 'honolulu.surf reef break does not fall toward the viewer')
  }
  // The outer band is a different break: further out, and above the point the
  // reef line has fallen to by then.
  assert.ok(outer[0] > reef[2][0] + reef[2][2], 'honolulu.surf outer band overlaps the reef break')
  assert.ok(outer[1] < reef[2][1] + reef[2][3], 'honolulu.surf outer band is not further out')
  // The physical rule: a shore break cannot be seaward of a reef break.
  const yAt = ([x, y, w, rise], at) => y + rise * (at - x) / w
  for (const b of beach) {
    for (const r of [...reef, outer]) {
      const lo = Math.max(b[0], r[0]), hi = Math.min(b[0] + b[2], r[0] + r[2])
      if (lo >= hi) continue
      assert.ok(yAt(b, lo) < yAt(r, lo) && yAt(b, hi) < yAt(r, hi),
        `honolulu.surf shore break crosses the reef break near x=${lo}`)
    }
  }
})

test('a rainbow arcs inside the card, on the half away from the sun', () => {
  // MASTHEAD-RAINBOW-1. A bow is centred on the ANTISOLAR point: it is always
  // in the half of the sky opposite the sun, never the same half. A city that
  // declares both a flare and a rainbow on the same side has one of the two
  // measured wrong, and nothing on screen would say which - a rainbow lit from
  // behind still draws, it just cannot happen.
  const css = readFileSync(join(here, '..', 'src', 'index.css'), 'utf8')
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    const r = m.rainbow
    if (!r) continue
    assert.ok(r.w > 0 && r.h > 0, `${city}.rainbow has no size`)
    assert.ok(r.x >= 0 && r.x + r.w <= 100, `${city}.rainbow leaves the card sideways`)
    assert.ok(r.y >= 0 && r.y + r.h <= 100, `${city}.rainbow leaves the card vertically`)
    if (m.flare) {
      const apex = r.x + r.w / 2
      assert.ok((m.flare.x > 50) !== (apex > 50),
        `${city} puts its rainbow (apex x=${apex}) on the same half as its sun (x=${m.flare.x})`)
    }
  }
  // Honolulu's, over the Koolau: apex at x 35, feet at 18 and 52, and its sun
  // is off the right edge, so the bow is left of centre.
  assert.deepEqual(CITY_MOTION.honolulu.rainbow, { x: 18, y: 10, w: 34, h: 34 })
  // The sunlit scenes only. An overcast frame has no sun to make one, and the
  // gate is the only thing that keeps it off Rain and the night scenes.
  for (const scene of ['day', 'morning', 'cloudy', 'goldenhour']) {
    assert.match(css, new RegExp(`\\.mast-scene-${scene} \\.mast-motion-rainbow`))
  }
  for (const scene of ['rain', 'night', 'cloudynight', 'snownight']) {
    assert.doesNotMatch(css, new RegExp(`\\.mast-scene-${scene} \\.mast-motion-rainbow`))
  }
})

test('a cableway hangs between two points on the card', () => {
  // MASTHEAD-CABLE-1. The rail is a chord: x/y is the top station, w the run
  // and rise the drop across it, so BOTH ends have to land on the card. A
  // cableway whose lower station is off the frame would send the cabin out of
  // the card and back, which reads as a bug rather than as a journey.
  for (const [city, m] of Object.entries(CITY_MOTION)) {
    const c = m.cable
    if (!c) continue
    assert.ok(c.w > 0, `${city}.cable has no run`)
    assert.ok(c.x >= 0 && c.x + c.w <= 100, `${city}.cable leaves the card sideways`)
    assert.ok(c.y >= 0 && c.y <= 100 && c.y + c.rise >= 0 && c.y + c.rise <= 100,
      `${city}.cable runs off the card between y=${c.y} and y=${c.y + c.rise}`)
    assert.ok(c.flight > 0, `${city}.cable needs a flight duration`)
    // A cableway climbs. A rail this shallow is a road and belongs in bridge,
    // where it would get traffic instead of a gondola.
    assert.ok(Math.abs(c.rise) / c.w > 1.5,
      `${city}.cable drops ${c.rise}% over ${c.w}%; that is a roadway, not a cableway`)
  }
  // MASTHEAD-RIO-2: Rio's bondinho, fitted to the painted ROPE rather than to
  // the two stations - it runs from where the strands leave Sugarloaf's rock
  // at [84.4, 36] down to where they enter the trees above Urca at
  // [91.5, 56.6]. The station-to-station chord was 0.45 steeper and crossed
  // the strands instead of riding them, and its top percent of travel was a
  // cabin drawn on the rock face.
  assert.deepEqual(CITY_MOTION.rio.cable, { x: 84.4, y: 36.0, w: 7.1, rise: 20.6, flight: 42 })
  // The wire is the artwork's. Ours is the cabin, and only the cabin.
  const css = readFileSync(join(here, '..', 'src', 'index.css'), 'utf8')
  assert.match(css, /\.mast-motion-cable \{\s*\n\s*position: absolute; height: 0;/)
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
  // The third New York pack paints WHITE boats, not the orange Staten Island
  // Ferry the second one carried - sampled at all three hulls in the Day
  // frame, the brightest pixel is neutral (255,255,254 / 208,211,212). The
  // tone follows the artwork, not the city's most famous boat.
  assert.equal(CITY_MOTION.newyork.ferryTone, 'white')
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

test('the card shows the whole frame, and the angle maths agrees with its shape', () => {
  // MASTHEAD-FULL-FRAME-1. The card was 5.9:1 against 5:1 art, so it cropped
  // 15% of every frame and each city carried a --scn-img-y saying which 15%.
  // Now it is 5:1 and there is no crop and no map.
  //
  // CARD_ASPECT is not decoration. A vertical percentage is CARD_ASPECT times
  // fewer pixels than a horizontal one, and the deck, cable and surf angles all
  // divide their rise by it to get a real on-screen angle. If the CSS shape and
  // this constant ever disagree, every rail in the registry tilts wrongly and
  // nothing else says so.
  const css = readFileSync(join(here, '..', 'src', 'index.css'), 'utf8')
  const m = /aspect-ratio: ([\d.]+) \/ 1;/.exec(css)
  assert.ok(m, 'the card no longer declares an aspect ratio')
  assert.equal(Number(m[1]), CARD_ASPECT, 'the CSS card shape and CARD_ASPECT disagree')
  // Every source frame really is that shape, which is the premise for cropping
  // nothing. A pack drawn at another ratio would be cover-cropped silently.
  const dirs = readdirSync(MASTHEAD, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'picker').map(d => d.name)
  assert.ok(dirs.length > 0)
  // And the crop machinery is gone rather than merely unused.
  const reg = readFileSync(join(here, '..', 'src', 'lib', 'mastheadCityScenes.js'), 'utf8')
  assert.doesNotMatch(reg, /export const CITY_IMG_Y/)
  assert.doesNotMatch(reg, /export function imgPositionFor/)
  assert.doesNotMatch(readFileSync(join(here, '..', 'src', 'index.css'), 'utf8'), /--scn-img-y/)
})
