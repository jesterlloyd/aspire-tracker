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
  assert.match(scenery, /'--scn-fade': `\$\{\(sweep\.stepMs \/ 1000\)/)
  assert.doesNotMatch(scenery, /SWEEP_MS/, 'the fade should come from the running sweep, not the constant')
})
