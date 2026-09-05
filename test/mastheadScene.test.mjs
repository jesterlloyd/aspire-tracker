// MASTHEAD-SCENE-1/3: the unified time-of-day scene clock for the masthead
// artwork and night treatment. Pure-module tests: six sun-anchored windows,
// the fixed-window fallback, midnight wrap, the rain artwork override, and
// defensive parsing of sun times.
//
// Run: node --test test/mastheadScene.test.mjs

import test from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { sceneForTime, sunTimesFrom, artSceneFor, isRainyCode, SCENES, CLOCK_SCENES,
  OPTIONAL_SCENES, ALL_SCENES, SCENE_FALLBACK, sceneFrameFor, isNightScene,
} from '../src/lib/mastheadScene.js'

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

test('bad weather overrides every scene: rain by day, cloudynight after dark', () => {
  for (const scene of ['dawn', 'morning', 'day', 'goldenhour', 'sunset']) {
    assert.equal(artSceneFor(scene, 61), 'rain', `${scene} + rain -> rain art`)
    assert.equal(artSceneFor(scene, 0), scene, `${scene} + clear stays`)
    assert.equal(artSceneFor(scene, 2), scene, `${scene} + partly cloudy stays`)
  }
  // MASTHEAD-CLOUDY-NIGHT (Owner): night used to ignore the weather entirely
  // and show a clear sky through a storm. Now it has its own bad-weather frame.
  assert.equal(artSceneFor('night', 61), 'cloudynight', 'rain after dark')
  assert.equal(artSceneFor('night', 3), 'cloudynight', 'overcast after dark')
  assert.equal(artSceneFor('night', 45), 'cloudynight', 'fog after dark')
  assert.equal(artSceneFor('night', 95), 'cloudynight', 'thunderstorm after dark')
  assert.equal(artSceneFor('night', 0), 'night', 'a clear night is still a clear night')
  assert.equal(artSceneFor('night', 2), 'night', 'partly cloudy is not bad weather')
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

test('with the location\'s UTC offset, sun times are read as instants in THAT zone', () => {
  // MASTHEAD-CITY-TIME-1: New York's 06:27 sunrise (UTC-4) is 10:27Z, whatever
  // zone the browser is in. Read in the browser's zone, as it used to be, a
  // Los Angeles viewer saw New York's dawn three hours late.
  const ny = sunTimesFrom({ sunrise: '2026-09-05T06:27', sunset: '2026-09-05T19:22', utcOffsetSeconds: -14400 })
  assert.equal(ny.sunrise.toISOString(), '2026-09-05T10:27:00.000Z')
  assert.equal(ny.sunset.toISOString(), '2026-09-05T23:22:00.000Z')
  // 07:00 in New York is morning there, and the scene says so from anywhere.
  assert.equal(sceneForTime(new Date('2026-09-05T11:00:00Z'), ny), 'morning')
  assert.equal(sceneForTime(new Date('2026-09-05T04:00:00Z'), ny), 'night')
  // A malformed wall time with an offset is rejected, not read as garbage.
  assert.equal(sunTimesFrom({ sunrise: 'soon', sunset: '2026-09-05T19:22', utcOffsetSeconds: -14400 }), null)
  // The offset ride the payload: the weather query keeps both zone fields.
  const wx = readFileSync(new URL('../src/components/WeatherScene.jsx', import.meta.url), 'utf8')
  assert.match(wx, /utcOffsetSeconds: typeof j\.utc_offset_seconds === 'number' \? j\.utc_offset_seconds : null/)
  assert.match(wx, /timezone: typeof j\.timezone === 'string' \? j\.timezone : null/)
})

test('a full day sweep never yields anything outside the clock vocabulary', () => {
  for (let h = 0; h < 24; h++) {
    for (const sun of [SUN, null]) {
      assert.ok(CLOCK_SCENES.includes(sceneForTime(at(h, 17), sun)))
    }
  }
})

// ── MASTHEAD-CLOUDY-NIGHT (Owner) ───────────────────────────────────────────

test('an optional scene is optional, and declares what it falls back to', () => {
  // Making CloudyNight REQUIRED would have made all five cities that shipped
  // before it incomplete overnight, which drops the SVG scenery in underneath
  // a perfectly good pack. It is optional with a declared fallback instead.
  assert.ok(!SCENES.includes('cloudynight'), 'not required of every pack')
  assert.deepEqual(OPTIONAL_SCENES, ['cloudynight'])
  assert.deepEqual(ALL_SCENES, [...SCENES, 'cloudynight'])
  assert.equal(SCENE_FALLBACK.cloudynight, 'night')
  // Every optional scene must declare a fallback, or a pack without it would
  // render nothing at all for that state.
  for (const s of OPTIONAL_SCENES) {
    assert.ok(SCENE_FALLBACK[s], `${s} must declare a fallback`)
    assert.ok(SCENES.includes(SCENE_FALLBACK[s]), `${s} must fall back to a REQUIRED scene`)
  }
})

test('a pack without CloudyNight shows its Night frame, never nothing', () => {
  const withIt = { night: '/n.webp', cloudynight: '/cn.webp', day: '/d.webp' }
  const without = { night: '/n.webp', day: '/d.webp' }
  assert.equal(sceneFrameFor('cloudynight', withIt), '/cn.webp')
  assert.equal(sceneFrameFor('cloudynight', without), '/n.webp', 'falls back rather than blanking')
  assert.equal(sceneFrameFor('night', without), '/n.webp')
  // A required scene has no fallback: absent means absent, which is what makes
  // the pack incomplete and brings the SVG scenery back.
  assert.equal(sceneFrameFor('rain', without), null)
  assert.equal(sceneFrameFor('cloudynight', null), null)
})

test('night treatment follows every night scene, clear or clouded', () => {
  assert.ok(isNightScene('night'))
  assert.ok(isNightScene('cloudynight'))
  for (const s of ['dawn', 'morning', 'day', 'goldenhour', 'sunset', 'rain']) {
    assert.ok(!isNightScene(s), s)
  }
})
