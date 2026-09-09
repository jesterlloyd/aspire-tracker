// MASTHEAD-TIMELAPSE-1: the rules of the pick sweep.
//
// Every one of these is an Owner rule that is invisible on screen when it
// breaks - a sweep that ends on the wrong frame, or runs Rain through the
// middle of the day, still LOOKS like a sweep.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLOCK_SCENES, SWEEP_MS, SWEEP_MAX_MS, SWEEP_OVERRIDE_KEY, sweepDurationMs, sweepFramesFor } from '../src/lib/mastheadSweep.js'
import { SCENES, OPTIONAL_SCENES, isNightScene } from '../src/lib/mastheadScene.js'

const here = dirname(fileURLToPath(import.meta.url))

test('the sweep is the six clock scenes, in the order the day runs', () => {
  assert.deepEqual(CLOCK_SCENES, ['dawn', 'morning', 'day', 'goldenhour', 'sunset', 'night'])
  // It is SCENES minus rain, and it must stay that way by construction: a new
  // clock scene belongs in the sweep, a new weather scene does not.
  assert.deepEqual(CLOCK_SCENES, SCENES.filter(s => s !== 'rain'))
  for (const s of OPTIONAL_SCENES) {
    assert.ok(!CLOCK_SCENES.includes(s), `${s} is weather; it cannot be a step in the day`)
  }
})

test('every sweep ends on the scene the clock was going to show anyway', () => {
  // The rule that makes it read as "here is the day, and this is where we are"
  // rather than a lap followed by a cut.
  for (const dest of [...CLOCK_SCENES, ...OPTIONAL_SCENES, 'rain']) {
    const frames = sweepFramesFor(dest)
    assert.equal(frames[frames.length - 1], dest, `sweep to ${dest} ends on ${frames[frames.length - 1]}`)
  }
})

test('a clock destination runs exactly one lap, with no frame twice', () => {
  for (const dest of CLOCK_SCENES) {
    const frames = sweepFramesFor(dest)
    assert.equal(frames.length, 6, `${dest} is not one lap`)
    assert.equal(new Set(frames).size, 6, `${dest} repeats a frame`)
    // and the lap is the day in order, just rotated
    for (let i = 1; i < frames.length; i++) {
      const prev = CLOCK_SCENES.indexOf(frames[i - 1])
      assert.equal(frames[i], CLOCK_SCENES[(prev + 1) % 6], `${dest} runs out of order at ${frames[i]}`)
    }
  }
})

test('weather arrives as a final beat, never mid-day', () => {
  for (const dest of [...OPTIONAL_SCENES, 'rain']) {
    const frames = sweepFramesFor(dest)
    assert.equal(frames.length, 7, `${dest} should be a lap plus one`)
    // the lap itself is clock scenes only
    for (const f of frames.slice(0, 6)) {
      assert.ok(CLOCK_SCENES.includes(f), `${dest} runs ${f} inside the day`)
    }
    // and it hands over from the right half of the day: a storm at night comes
    // out of Night, a wet afternoon out of Day. Handing over from the wrong one
    // is a jump from noon to a dark sky.
    assert.equal(frames[5], isNightScene(dest) ? 'night' : 'day',
      `${dest} hands over from ${frames[5]}`)
  }
})

test('the sweep is one tunable, and the CSS does not hard-code a second one', () => {
  assert.ok(SWEEP_MS > 0 && SWEEP_MS <= 12000, 'a sweep is seconds, not a mood')
  const css = readFileSync(join(here, '..', 'src', 'index.css'), 'utf8')
  // The frame duration and cross-fade come from SWEEP_MS via an inline style.
  // A duration written into the sweep block would silently disagree with it.
  const start = css.indexOf('MASTHEAD-TIMELAPSE-1')
  const end = css.indexOf('Dark page theme', start)
  const block = css.slice(start, end)
  assert.ok(start > 0 && end > start, 'the sweep block is where it was')
  assert.doesNotMatch(block.replace(/0\.45s|0\.6s/g, ''), /\d+(\.\d+)?s/,
    'the sweep block hard-codes a duration; SWEEP_MS is the one tunable')
  // Every scene a pack can carry needs a data-sweep rule, or that frame is
  // invisible for its step and the card blinks to black mid-day.
  for (const s of [...SCENES, ...OPTIONAL_SCENES]) {
    assert.match(css, new RegExp(`\\[data-sweep="${s}"\\] \\.mast-scn-img-${s}`), `${s} has no sweep rule`)
  }
})

// ── MASTHEAD-SWEEP-NATURAL-1 (Owner: "the timelapse effect still feels
// unnatural"). Three changes, and each one is a claim that can be checked.
test('the sweep is paced by how far apart the frames actually are', async () => {
  const m = await import('../src/lib/mastheadSweep.js')
  const { STEP_WEIGHTS, CLOCK_SCENES, stepWeight, STEP_WEIGHT_KEY } = m
  // Every adjacent pair on the clock has a weight, including the wrap.
  for (let i = 0; i < CLOCK_SCENES.length; i++) {
    const a = CLOCK_SCENES[i], b = CLOCK_SCENES[(i + 1) % CLOCK_SCENES.length]
    assert.ok(STEP_WEIGHTS[`${a}>${b}`] > 0, `no weight for ${a}>${b}`)
  }
  // They are SHARES of an equal step, so they must average one: any other
  // normalisation silently changes the total length of the sweep.
  const w = Object.values(STEP_WEIGHTS)
  assert.equal(w.length, CLOCK_SCENES.length)
  const mean = w.reduce((a, b) => a + b, 0) / w.length
  assert.ok(Math.abs(mean - 1) < 0.02, `weights average ${mean.toFixed(3)}, not 1`)
  // The two biggest changes in any pack are the ones that cross the light:
  // measured across all thirteen, sunset>night and night>dawn are more than
  // twice morning>day. If that ordering ever inverts, the table was rebuilt
  // from something other than the frames.
  assert.ok(STEP_WEIGHTS['sunset>night'] > STEP_WEIGHTS['morning>day'] * 2)
  assert.ok(STEP_WEIGHTS['night>dawn'] > STEP_WEIGHTS['morning>day'] * 2)
  // A frame off the clock (the weather beat) takes an even share.
  assert.equal(stepWeight('night', 'rainnight'), 1)
  assert.equal(STEP_WEIGHT_KEY, 'aspire_sweep_pace_v1')
  const store = new Map()
  globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }
  try {
    assert.equal(stepWeight('sunset', 'night'), STEP_WEIGHTS['sunset>night'])
    store.set(STEP_WEIGHT_KEY, '0')
    assert.equal(stepWeight('sunset', 'night'), 1, 'pace 0 restores equal steps')
  } finally { delete globalThis.localStorage }
})

test('the sweep opens on a dissolve, lands long, and drifts to exactly 1', async () => {
  const m = await import('../src/lib/mastheadSweep.js')
  const { SWEEP_TAIL, SWEEP_ZOOM, sweepTail, sweepZoom } = m
  assert.ok(SWEEP_TAIL > 1 && SWEEP_TAIL <= 2, 'the last beat is longer, not a different effect')
  assert.ok(SWEEP_ZOOM > 1 && SWEEP_ZOOM < 1.05, 'a drift, not a zoom')
  // The drift ENDS at 1. Anything else would leave the artwork off the
  // geometry every point in CITY_MOTION is measured against.
  const css = readFileSync(join(here, '..', 'src', 'index.css'), 'utf8')
  assert.match(css, /@keyframes mast-sweep-drift \{\s*from \{ transform: scale\(var\(--sweep-zoom[^)]*\)\); \}\s*to\s+\{ transform: scale\(1\); \}/)
  // One animation across the whole sweep, driven by the same tunable as the
  // steps. A per-step transform would be six little zooms.
  assert.match(css, /\.mast-scenery\[data-sweep\] \{[^}]*animation: mast-sweep-drift var\(--sweep-total\)/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.mast-scenery\[data-sweep\] \{ animation: none/)
  // The first step starts from the destination - the frame already on screen -
  // so the sweep opens with a dissolve rather than a cut.
  const src = readFileSync(new URL('../src/lib/mastheadSweep.js', import.meta.url), 'utf8')
  assert.match(src, /const from = \[destination, \.\.\.frames\.slice\(0, -1\)\]/)
  // And the motion comes back DURING the last beat, not after the sweep ends.
  for (const rel of [['masthead', 'MastheadMotion.jsx'], ['WeatherScene.jsx']]) {
    const body = readFileSync(join(here, '..', 'src', 'components', ...rel), 'utf8')
    assert.match(body, /!!sweepState && !sweepState\.last/, `${rel.join('/')} still waits for the sweep to end`)
  }
  const store = new Map()
  globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }
  try {
    store.set('aspire_sweep_zoom_v1', '1'); assert.equal(sweepZoom(), 1, 'zoom 1 turns the drift off')
    store.set('aspire_sweep_tail_v1', '1'); assert.equal(sweepTail(), 1, 'tail 1 restores an even last beat')
    for (const bad of ['9', 'slow', '']) { store.set('aspire_sweep_zoom_v1', bad); assert.equal(sweepZoom(), SWEEP_ZOOM) }
  } finally { delete globalThis.localStorage }
})

test('the sweep never changes the host scene class', () => {
  // This is what keeps the motion gates, skies and inks still while the images
  // move. If the scene class ever drove the sweep, every gate would fire six
  // times per pick.
  const scenery = readFileSync(join(here, '..', 'src', 'components', 'MastheadScenery.jsx'), 'utf8')
  assert.match(scenery, /data-sweep=\{sweep\?\.frame \|\| undefined\}/)
  const css = readFileSync(join(here, '..', 'src', 'index.css'), 'utf8')
  assert.match(css, /\.mast-motion-hushed, \.wx-mast-art-hushed \{ opacity: 0;/)
})

test('only an explicit pick can start a sweep', () => {
  // pickSeq is a counter incremented in choose() and nowhere else. A boolean
  // would not survive re-picking the same city, which is the Owner's replay.
  const hook = readFileSync(join(here, '..', 'src', 'components', 'masthead', 'useCityPreference.js'), 'utf8')
  const increments = hook.match(/pickSeq \+= 1/g) || []
  assert.equal(increments.length, 1, 'pickSeq is incremented somewhere other than choose()')
  const chooseBody = hook.slice(hook.indexOf('const choose ='), hook.indexOf('return {'))
  assert.match(chooseBody, /pickSeq \+= 1/, 'choose() no longer registers a pick')
  const scenery = readFileSync(join(here, '..', 'src', 'components', 'MastheadScenery.jsx'), 'utf8')
  assert.match(scenery, /\}, \[pickSeq\]\)/, 'the sweep effect is keyed on something other than the pick')
})

test('the length override follows the house QA convention and refuses nonsense', () => {
  // Same shape as aspire_scene_override_v1 / aspire_wet_override_v1: set it in
  // the console, pick a city, watch. The pace is taste, and taste cannot be
  // settled by reading code or looking at stills.
  assert.equal(SWEEP_OVERRIDE_KEY, 'aspire_sweep_ms_v1')
  const store = new Map()
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  }
  try {
    assert.equal(sweepDurationMs(), SWEEP_MS, 'unset means the default')
    store.set(SWEEP_OVERRIDE_KEY, '4000')
    assert.equal(sweepDurationMs(), 4000)
    // 0 is a real setting: no sweep, the same as reduced motion gets.
    store.set(SWEEP_OVERRIDE_KEY, '0')
    assert.equal(sweepDurationMs(), 0)
    // Anything unusable falls back rather than breaking the pick. A sweep is
    // decoration; a typo in a console override must not cost you the city.
    for (const bad of ['', 'soon', '-1', String(SWEEP_MAX_MS + 1), 'NaN', 'Infinity']) {
      store.set(SWEEP_OVERRIDE_KEY, bad)
      assert.equal(sweepDurationMs(), SWEEP_MS, `"${bad}" should fall back to the default`)
    }
  } finally {
    delete globalThis.localStorage
  }
})

test('the cross-fade is carried by the sweep, not recomputed at render', () => {
  // Changing the override mid-sweep would otherwise desync the fade from the
  // frames it is fading between.
  const scenery = readFileSync(join(here, '..', 'src', 'components', 'MastheadScenery.jsx'), 'utf8')
  assert.match(scenery, /'--scn-fade': `\$\{\(sweep\.fadeMs \/ 1000\)/)
  assert.doesNotMatch(scenery, /SWEEP_MS/, 'the fade should come from the running sweep, not the constant')
})

test('the sweep dissolves continuously: linear timing, and a fade no shorter than the step', async () => {
  // MASTHEAD-SWEEP-CONTINUOUS-1. With `ease`, each frame decelerates into full
  // opacity and dwells before the next starts - the Owner saw it as
  // "transition, stop, transition, stop". Linear at fade >= step is unbroken.
  const css = readFileSync(join(here, '..', 'src', 'index.css'), 'utf8')
  // MASTHEAD-SWEEP-NATURAL-1 made the curve a variable so the LAST beat can
  // decelerate. Linear is still the default and still what every other step
  // gets: the variable's fallback is the rule, and the component only ever
  // overrides it on the frame it marks `last`.
  assert.match(css, /\.mast-scenery\[data-sweep\] \.mast-scn-img \{[^}]*transition-timing-function: var\(--scn-ease, linear\)/)
  const scenery = readFileSync(join(here, '..', 'src', 'components', 'MastheadScenery.jsx'), 'utf8')
  assert.match(scenery, /'--scn-ease': sweep\.last \? '[^']+' : 'linear'/,
    'only the last beat may ease; every other step is mid-motion when the next begins')
  const { SWEEP_OVERLAP, sweepOverlap, SWEEP_OVERLAP_KEY } = await import('../src/lib/mastheadSweep.js')
  assert.ok(SWEEP_OVERLAP >= 1, 'a fade shorter than the step leaves a gap where nothing is arriving')
  assert.equal(SWEEP_OVERLAP_KEY, 'aspire_sweep_overlap_v1')
  const store = new Map()
  globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }
  try {
    assert.equal(sweepOverlap(), SWEEP_OVERLAP)
    store.set(SWEEP_OVERLAP_KEY, '1.3'); assert.equal(sweepOverlap(), 1.3)
    for (const bad of ['0.2', '9', 'soft', '']) { store.set(SWEEP_OVERLAP_KEY, bad); assert.equal(sweepOverlap(), SWEEP_OVERLAP, `"${bad}" should fall back`) }
  } finally { delete globalThis.localStorage }
})
