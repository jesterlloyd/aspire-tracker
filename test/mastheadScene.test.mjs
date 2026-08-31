// MASTHEAD-SCENE-1/3: the unified time-of-day scene clock for the masthead
// artwork and night treatment. Pure-module tests: six sun-anchored windows,
// the fixed-window fallback, midnight wrap, the rain artwork override, and
// defensive parsing of sun times.
//
// Run: node --test test/mastheadScene.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { sceneForTime, sunTimesFrom, artSceneFor, isRainyCode, SCENES, CLOCK_SCENES } from '../src/lib/mastheadScene.js'

const at = (h, m = 0) => new Date(2026, 7, 29, h, m) // local time, Aug 29 2026
const SUN = { sunrise: at(6, 24), sunset: at(19, 20) }

test('the scene vocabularies are the published sets', () => {
  assert.deepEqual(SCENES, ['dawn', 'morning', 'day', 'goldenhour', 'sunset', 'night', 'rain'])
  assert.deepEqual(CLOCK_SCENES, ['dawn', 'morning', 'day', 'goldenhour', 'sunset', 'night'])
})

test('sun-anchored windows walk the full cycle in order', () => {
  assert.equal(sceneForTime(at(5, 3), SUN), 'night')       // 1 min before dawn opens (05:04)
  assert.equal(sceneForTime(at(5, 4), SUN), 'dawn')        // dawn opens sunrise-80m
  assert.equal(sceneForTime(at(6, 33), SUN), 'dawn')       // holds to sunrise+10m
  assert.equal(sceneForTime(at(6, 34), SUN), 'morning')    // morning opens
  assert.equal(sceneForTime(at(8, 53), SUN), 'morning')    // holds to sunrise+150m
  assert.equal(sceneForTime(at(8, 54), SUN), 'day')        // day opens
  assert.equal(sceneForTime(at(18, 4), SUN), 'day')        // holds to sunset-75m
  assert.equal(sceneForTime(at(18, 5), SUN), 'goldenhour') // golden hour opens
  assert.equal(sceneForTime(at(19, 4), SUN), 'goldenhour') // holds to sunset-15m
  assert.equal(sceneForTime(at(19, 5), SUN), 'sunset')     // sunset opens
  assert.equal(sceneForTime(at(19, 44), SUN), 'sunset')    // civil twilight holds
  assert.equal(sceneForTime(at(19, 45), SUN), 'night')     // night opens sunset+25m
})

test('overnight hours are night on both sides of midnight', () => {
  assert.equal(sceneForTime(at(23, 30), SUN), 'night')
  assert.equal(sceneForTime(at(0, 10), SUN), 'night')
  assert.equal(sceneForTime(at(3, 0), SUN), 'night')
})

test('fallback fixed windows govern when sun times are absent', () => {
  assert.equal(sceneForTime(at(4, 59)), 'night')
  assert.equal(sceneForTime(at(5, 0)), 'dawn')
  assert.equal(sceneForTime(at(6, 29)), 'dawn')
  assert.equal(sceneForTime(at(6, 30)), 'morning')
  assert.equal(sceneForTime(at(8, 59)), 'morning')
  assert.equal(sceneForTime(at(9, 0)), 'day')
  assert.equal(sceneForTime(at(17, 29)), 'day')
  assert.equal(sceneForTime(at(17, 30)), 'goldenhour')
  assert.equal(sceneForTime(at(18, 54)), 'goldenhour')
  assert.equal(sceneForTime(at(18, 56)), 'sunset')
  assert.equal(sceneForTime(at(19, 44)), 'sunset')
  assert.equal(sceneForTime(at(19, 45)), 'night')
})

test('rain codes: precipitation, overcast, and fog - never partly cloudy', () => {
  for (const code of [3, 45, 48, 51, 61, 67, 71, 77, 80, 82, 85, 95, 99]) {
    assert.ok(isRainyCode(code), `code ${code} must be rainy`)
  }
  for (const code of [0, 1, 2, null, undefined]) {
    assert.ok(!isRainyCode(code), `code ${code} must NOT be rainy`)
  }
})

test('the rain artwork overrides the daytime family and yields to night', () => {
  for (const scene of ['dawn', 'morning', 'day', 'goldenhour', 'sunset']) {
    assert.equal(artSceneFor(scene, 61), 'rain', `${scene} + rain -> rain art`)
    assert.equal(artSceneFor(scene, 0), scene, `${scene} + clear stays`)
    assert.equal(artSceneFor(scene, 2), scene, `${scene} + partly cloudy stays`)
  }
  assert.equal(artSceneFor('night', 61), 'night')  // city lights stay after dark
  assert.equal(artSceneFor('day', undefined), 'day')
})

test('sunTimesFrom parses only complete, valid pairs', () => {
  assert.equal(sunTimesFrom(null), null)
  assert.equal(sunTimesFrom({}), null)
  assert.equal(sunTimesFrom({ sunrise: '2026-08-29T06:24' }), null)
  assert.equal(sunTimesFrom({ sunrise: 'not-a-date', sunset: '2026-08-29T19:20' }), null)
  const sun = sunTimesFrom({ sunrise: '2026-08-29T06:24', sunset: '2026-08-29T19:20' })
  assert.ok(sun.sunrise instanceof Date && sun.sunset instanceof Date)
  assert.equal(sun.sunrise.getHours(), 6)
  assert.equal(sun.sunset.getHours(), 19)
})

test('a full day sweep never yields anything outside the clock vocabulary', () => {
  for (let h = 0; h < 24; h++) {
    for (const sun of [SUN, null]) {
      assert.ok(CLOCK_SCENES.includes(sceneForTime(at(h, 17), sun)))
    }
  }
})
