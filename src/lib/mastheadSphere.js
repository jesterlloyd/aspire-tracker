// MASTHEAD-SPHERE-CYCLE-1 (Owner, 2026-09-09): "do you think it's possible for
// the sphere in las vegas to change projections (cycle through the scenes)
// every 2 minutes or so? Just the sphere part."
//
// It is, and it costs nothing, because of two things the pack already gives us.
//
// FIRST, the artwork paints a DIFFERENT PROJECTION on the Sphere in every one
// of the ten frames, and they are the real building's own repertoire: a galaxy
// at Dawn, the Earth at Morning, the grey dome by Day, a sunrise at Golden
// Hour, the EYE at Sunset, flat emoji yellow at Night, the Moon under Cloudy, a
// burning sun at Cloudy Night, blue ripples in Rain and a purple mesh at Rain
// Night. Nobody has to draw anything; the projections are already there, each
// one sitting in a frame that only shows at its own time of day.
//
// SECOND, every one of those frames is ALREADY IN THE DOM. MastheadScenery
// renders all of them as <img> and cross-fades by opacity, so the bytes are
// fetched and decoded whether or not we use them here. Reusing one as a
// background costs no request and no decode.
//
// So the whole feature is: draw the Sphere's disc out of a frame that is not
// the current one, and change which frame every couple of minutes. The rest of
// the card never moves - the scene class, the sky, the ink and every other
// motion gate hold exactly as they are, which is what the Owner asked for
// ("during daytime, the entire scene remains daytime").
//
// The registration that makes it safe was measured, not assumed: across the
// Sphere's own neighbourhood the ten frames agree with Night at dx=0 on all
// ten and dy=0 on nine, the tenth being one row. So a disc clipped out of one
// frame lands exactly on the disc in another.
//
// Module-level for the same reason the sweep's store is: the disc is drawn by
// MastheadScenery and the emoji face by MastheadMotion, two components with no
// shared parent, and they must never disagree about which projection is up.

import { useEffect, useState } from 'react'

// Two minutes, as asked. Long enough that it is a thing you notice rather than
// a thing that flickers at you, short enough that a normal sitting sees it.
export const SPHERE_MS = 120000
export const SPHERE_MS_KEY = 'aspire_sphere_ms_v1'
// The cross-fade. The card's own scene morph is 10s (the Owner's slow dissolve);
// the Sphere is one small disc rather than the whole frame, so it can be
// quicker without reading as a cut.
export const SPHERE_FADE_MS = 2600

/** QA override, clamped. 0 disables the cycle and leaves the scene's own face. */
export function sphereIntervalMs() {
  try {
    const raw = localStorage.getItem(SPHERE_MS_KEY)
    if (raw === null) return SPHERE_MS
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) return SPHERE_MS
    return n === 0 ? 0 : Math.min(Math.max(n, 2000), 3600000)
  } catch { return SPHERE_MS }
}

let state = null          // the scene name whose projection is showing, or null
let listeners = new Set()
let timer = null
let order = []
let at = 0

const publish = () => { for (const fn of listeners) fn(state) }

function reduced() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

/**
 * Start (or re-start) the cycle over `scenes`, a list of scene names whose
 * frames the pack actually has, BEGINNING at `home` - the scene the card is
 * really in.
 *
 * Home is IN the rotation, not excluded from it. Dropping it looked right (a
 * beat showing the projection already underneath is a beat where nothing
 * changes) and was wrong: on a night card the Sphere's own projection is the
 * flat yellow one, so excluding it meant the emoji face - the thing that made
 * this landmark worth animating - never came back. Its own beat now reads as a
 * rest between changes, which a rotation wants anyway.
 */
export function startSphereCycle(scenes, home) {
  stopSphereCycle()
  const ms = sphereIntervalMs()
  // Reduced motion keeps the Sphere on its own scene's projection: this is
  // decoration, and the card is complete without it.
  if (!ms || reduced()) return false
  order = (scenes || []).filter(Boolean)
  if (order.length < 2) return false
  // Start where the card already is, so the first thing anyone sees is the
  // Sphere they expect, and the change happens while they are looking at it.
  const home0 = order.indexOf(home)
  at = home0 >= 0 ? home0 : 0
  state = order[at]
  publish()
  timer = setInterval(() => {
    at = (at + 1) % order.length
    state = order[at]
    publish()
  }, ms)
  return true
}

export function stopSphereCycle() {
  if (timer) clearInterval(timer)
  timer = null
  order = []
  at = 0
  if (state !== null) { state = null; publish() }
}

export function subscribeSphere(fn) {
  listeners.add(fn)
  fn(state)
  return () => listeners.delete(fn)
}

/** The scene whose projection is currently on the Sphere, or null for the
 *  card's own. */
export function useSphereProjection() {
  const [p, setP] = useState(state)
  useEffect(() => subscribeSphere(setP), [])
  return p
}
