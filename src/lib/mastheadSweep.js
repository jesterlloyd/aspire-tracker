// MASTHEAD-TIMELAPSE-1 (Owner, 2026-09-06): when you PICK a city, the card
// runs the day in four and a half seconds before it settles on the time it
// actually is.
//
// This works because of something the packs already guarantee. Every city's
// frames are ONE DRAWING - when each pack was built the nine frames were
// cross-correlated and agreed to within 2px of 339 - so dissolving between
// them is not a slideshow, it is a time-lapse: the sky turns, the lights come
// on, and the city underneath never moves.
//
// THE RULES (Owner):
//
//   Only on an explicit pick. Not on load, not when dusk arrives on its own,
//   not when Automatic resolves. A six-second sweep every time the dashboard
//   opened would go from delightful to tiring inside a week. Re-picking the
//   city you already have replays it, which is the on-demand version.
//
//   It ENDS where the clock is. The cycle is rotated so the last frame is the
//   scene you were going to see anyway, so it reads as "here is the whole day,
//   and this is where we are in it" rather than a lap followed by a cut.
//
//   Clock scenes only. Rain, Cloudy, Snow and their night twins are a
//   different axis; putting Rain mid-sweep would read as "it rained for a
//   second". They are also the only frames with a measured vertical shift in
//   some cities, so excluding them is what keeps the dissolve seamless. If the
//   weather is one of them, it arrives as a final beat after the clock cycle.
//
//   The motion layer sits it out. Lights, birds, traffic and the rest are
//   gated on the host's scene class, which does NOT change during a sweep -
//   only the images cross-fade. The motion is hidden anyway, because six
//   scene-changes' worth of lights snapping on and birds appearing under a
//   dissolve is noise, not life.
//
// The store is module-level for the same reason useCityPreference's is: the
// images, the motion layer and the celestial art live in three components that
// do not share a parent, and this is a transient visual state, not app state.

import { useEffect, useState } from 'react'
import { isNightScene } from './mastheadScene.js'

// The day, in order. SCENES minus 'rain' - see the clock-scenes-only rule.
export const CLOCK_SCENES = ['dawn', 'morning', 'day', 'goldenhour', 'sunset', 'night']

// Owner's number, chosen by watching. One tunable, deliberately: the per-frame
// pace is this divided by the frame count, and the cross-fade is the same
// length again, so each frame is still dissolving into the next when the next
// begins - 750ms a frame for a clock destination.
//
// Picked from three real captures of the running sweep at 3s, 4.5s and 6s. At
// 3s it is a swipe rather than a day: dawn and sunset barely register, and
// those are the two best frames in every pack. 6s lets each time of day land
// but outstays a UI response. This is the middle, and it was the Owner's call
// on a question that is taste, not engineering - my own guesses were 4s, then
// 6s from stills, and stills were the wrong evidence for it.
export const SWEEP_MS = 4500

// QA/taste override, same shape as aspire_scene_override_v1 and
// aspire_wet_override_v1: set aspire_sweep_ms_v1 in the console and pick a
// city to try a length live, remove it to go back to the default.
//
//   localStorage.setItem('aspire_sweep_ms_v1', 4000)   // try four seconds
//   localStorage.setItem('aspire_sweep_ms_v1', 0)      // turn the sweep off
//   localStorage.removeItem('aspire_sweep_ms_v1')      // back to the default
//
// This exists because the pace is a matter of taste that cannot be settled by
// reading the code or by looking at stills - it has to be watched, at speed,
// by the person who has to live with it. 0 is a legitimate setting and means
// no sweep, which is also what reduced motion gets.
export const SWEEP_OVERRIDE_KEY = 'aspire_sweep_ms_v1'
export const SWEEP_MAX_MS = 20000

// MASTHEAD-SWEEP-CONTINUOUS-1 (Owner, 2026-09-06): how far each dissolve runs
// PAST the step that started it, as a multiple of the step. At 1 a frame
// reaches full opacity at the exact instant the next one begins, which with a
// linear curve is one unbroken motion. Above 1 the next frame starts while the
// last is still arriving, so two are always mid-dissolve and no frame is ever
// quite whole - more fluid, less distinct. The Owner's complaint that the sweep
// went "transition, stop, transition, stop" was not this number at all: it was
// the default `ease` curve decelerating into every frame and dwelling there.
// That is fixed in the CSS; this is the dial for taste on top of it.
//
//   localStorage.setItem('aspire_sweep_overlap_v1', 1.3)  // try a softer blend
//   localStorage.removeItem('aspire_sweep_overlap_v1')    // back to the default
export const SWEEP_OVERLAP = 1
export const SWEEP_OVERLAP_KEY = 'aspire_sweep_overlap_v1'

export function sweepOverlap() {
  try {
    const raw = localStorage.getItem(SWEEP_OVERLAP_KEY)
    if (raw !== null && raw !== '') {
      const n = Number(raw)
      if (Number.isFinite(n) && n >= 0.5 && n <= 3) return n
    }
  } catch { /* storage unavailable: the default stands */ }
  return SWEEP_OVERLAP
}

export function sweepDurationMs() {
  try {
    const raw = localStorage.getItem(SWEEP_OVERRIDE_KEY)
    if (raw !== null && raw !== '') {
      const n = Number(raw)
      if (Number.isFinite(n) && n >= 0 && n <= SWEEP_MAX_MS) return n
    }
  } catch { /* storage unavailable: the default stands */ }
  return SWEEP_MS
}

/**
 * The frames to run, ending on `destination`.
 *
 * A clock destination rotates the cycle so it lands there. A weather
 * destination is not in the cycle, so the cycle runs to the clock scene that
 * matches its half of the day and the weather frame is appended as a final
 * beat - which is also the only step in the sweep that may move, since a
 * weather frame is the one that can carry a sceneShift.
 */
export function sweepFramesFor(destination) {
  const clockEnd = CLOCK_SCENES.includes(destination)
    ? destination
    : (isNightScene(destination) ? 'night' : 'day')
  const at = CLOCK_SCENES.indexOf(clockEnd)
  const cycle = [...CLOCK_SCENES.slice(at + 1), ...CLOCK_SCENES.slice(0, at + 1)]
  return CLOCK_SCENES.includes(destination) ? cycle : [...cycle, destination]
}

let state = null          // { frame } while sweeping, null when idle
let timers = []
const subs = new Set()

const publish = () => { for (const fn of subs) fn(state) }

/** Subscribe to the sweep. Returns an unsubscribe. */
export function subscribeSweep(fn) {
  subs.add(fn)
  return () => subs.delete(fn)
}

export function getSweep() { return state }

export function stopSweep() {
  for (const t of timers) clearTimeout(t)
  timers = []
  if (state) { state = null; publish() }
}

/**
 * Run a sweep to `destination`. Ignored while one is already running: two
 * mastheads can be mounted at once (a staff card and a portal card share the
 * city preference), and both would otherwise start their own timers against
 * the same module state.
 *
 * `totalMs` of 0 - or a viewer who has asked for reduced motion - means no
 * sweep at all, which is the straight cut those viewers should get.
 */
export function startSweep(destination, totalMs = sweepDurationMs()) {
  if (state || !destination) return false
  let reduced = false
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { /* no matchMedia: sweep */ }
  if (reduced || totalMs <= 0) return false
  const frames = sweepFramesFor(destination)
  // The last frame is the destination, which the scene class is already
  // showing, so the sweep only has to DRIVE the frames before it and then get
  // out of the way. Holding the last one would double-render the same image.
  // The step travels WITH the state so the cross-fade always matches the sweep
  // that is actually running. Recomputing it at render would read the override
  // afresh, and changing the override mid-sweep would then desync the fade from
  // the frames it is fading between.
  const step = totalMs / frames.length
  const fade = step * sweepOverlap()
  state = { frame: frames[0], stepMs: step, fadeMs: fade }
  publish()
  for (let i = 1; i < frames.length; i++) {
    timers.push(setTimeout(() => { state = { frame: frames[i], stepMs: step, fadeMs: fade }; publish() }, step * i))
  }
  timers.push(setTimeout(() => { state = null; timers = []; publish() }, totalMs))
  return true
}

/**
 * Preload the frames a sweep will show, then start it.
 *
 * Picking a NEW city changes every <img> src at once, and until those decode
 * the elements have nothing to paint - a sweep started immediately would
 * dissolve between blanks for its first second or two, which is the opposite
 * of the effect. Waiting on decode() costs nothing when the pack is already
 * cached (re-picking the current city, or a city visited earlier) and buys the
 * whole sweep when it is not.
 *
 * The cap matters more than the wait: a slow connection should still get its
 * sweep, just over whatever has arrived, rather than a click that appears to
 * do nothing for ten seconds.
 */
export async function startSweepWhenReady(destination, urls, { totalMs = sweepDurationMs(), capMs = 1200, shouldStart } = {}) {
  if (state || !destination) return false
  const list = (urls || []).filter(Boolean)
  const load = u => new Promise(resolve => {
    const img = new Image()
    img.onload = img.onerror = () => resolve()
    img.src = u
  })
  if (list.length) {
    // Wait on the FIRST TWO frames only, and start every other load without
    // waiting for it. Frame n has (n x step) of lead time - a second each at
    // the default - so by the time the sweep needs frame four it has had three
    // seconds to arrive, and blocking on the whole pack would mean staring at
    // the destination for a second or more before anything happened.
    for (const u of list.slice(2)) load(u)
    await Promise.race([
      Promise.all(list.slice(0, 2).map(load)),
      new Promise(resolve => setTimeout(resolve, capMs)),
    ])
  }
  // The await above is where a second pick can land, so the caller gets to veto
  // here rather than in startSweep - by this point `state` is null (the first
  // effect's cleanup ran) and nothing else would stop a stale sweep.
  if (shouldStart && !shouldStart()) return false
  return startSweep(destination, totalMs)
}

/** React face of the store. Returns { frame } while sweeping, else null. */
export function useSceneSweep() {
  const [sweep, setSweep] = useState(getSweep)
  useEffect(() => subscribeSweep(setSweep), [])
  return sweep
}
