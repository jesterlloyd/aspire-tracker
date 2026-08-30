// MASTHEAD-SCENE-1: the unified time-of-day scene clock for the masthead
// artwork and night treatment. Pure-module tests: sun-anchored windows, the
// fixed-window fallback, midnight wrap, and defensive parsing of sun times.
//
// Run: node --test test/mastheadScene.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { sceneForTime, sunTimesFrom, SCENES } from '../src/lib/mastheadScene.js'

const at = (h, m = 0) => new Date(2026, 7, 29, h, m) // local time, Aug 29 2026
const SUN = { sunrise: at(6, 24), sunset: at(19, 20) }

test('the four scenes are the published vocabulary', () => {
  assert.deepEqual(SCENES, ['dawn', 'day', 'sunset', 'night'])
})

test('sun-anchored windows: dawn opens 80 min before sunrise, holds 15 past it', () => {
  assert.equal(sceneForTime(at(5, 3), SUN), 'night')   // 1 min before dawn opens (05:04)
  assert.equal(sceneForTime(at(5, 4), SUN), 'dawn')    // dawn opens
  assert.equal(sceneForTime(at(6, 38), SUN), 'dawn')   // still dawn 14 min after sunrise
  assert.equal(sceneForTime(at(6, 39), SUN), 'day')    // day opens sunrise+15
})

test('sun-anchored windows: sunset opens 50 min before sunset, night 25 after', () => {
  assert.equal(sceneForTime(at(18, 29), SUN), 'day')     // 1 min before sunset window (18:30)
  assert.equal(sceneForTime(at(18, 30), SUN), 'sunset')  // sunset opens
  assert.equal(sceneForTime(at(19, 44), SUN), 'sunset')  // civil twilight holds
  assert.equal(sceneForTime(at(19, 45), SUN), 'night')   // night opens sunset+25
})

test('overnight hours are night on both sides of midnight', () => {
  assert.equal(sceneForTime(at(23, 30), SUN), 'night')
  assert.equal(sceneForTime(at(0, 10), SUN), 'night')
  assert.equal(sceneForTime(at(3, 0), SUN), 'night')
})

test('fallback fixed windows govern when sun times are absent', () => {
  assert.equal(sceneForTime(at(4, 59)), 'night')
  assert.equal(sceneForTime(at(5, 0)), 'dawn')
  assert.equal(sceneForTime(at(6, 59)), 'dawn')
  assert.equal(sceneForTime(at(7, 0)), 'day')
  assert.equal(sceneForTime(at(17, 59)), 'day')
  assert.equal(sceneForTime(at(18, 0)), 'sunset')
  assert.equal(sceneForTime(at(19, 44)), 'sunset')
  assert.equal(sceneForTime(at(19, 45)), 'night')
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

test('a full day sweep never yields anything outside the vocabulary', () => {
  for (let h = 0; h < 24; h++) {
    for (const sun of [SUN, null]) {
      assert.ok(SCENES.includes(sceneForTime(at(h, 17), sun)))
    }
  }
})
