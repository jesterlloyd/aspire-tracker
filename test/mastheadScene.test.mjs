// MASTHEAD-SCENE-1/3: the unified time-of-day scene clock for the masthead
// artwork and night treatment. Pure-module tests: six sun-anchored windows,
// the fixed-window fallback, midnight wrap, the rain artwork override, and
// defensive parsing of sun times.
//
// Run: node --test test/mastheadScene.test.mjs

import test from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { sceneForTime, sunTimesFrom, artSceneFor, isRainyCode, isWetCode, isOvercastCode, isSnowCode, SCENES, CLOCK_SCENES,
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

test('bad weather overrides every scene: rain or cloudy by day, cloudynight after dark', () => {
  for (const scene of ['dawn', 'morning', 'day', 'goldenhour', 'sunset']) {
    assert.equal(artSceneFor(scene, 61), 'rain', `${scene} + rain -> rain art`)
    // MASTHEAD-CLOUDY-1: a dry grey day is Cloudy (a pack without the frame
    // shows Rain through the fallback, which is what it always showed).
    assert.equal(artSceneFor(scene, 3), 'cloudy', `${scene} + overcast -> cloudy art`)
    assert.equal(artSceneFor(scene, 45), 'cloudy', `${scene} + fog -> cloudy art`)
    assert.equal(artSceneFor(scene, 95), 'rain', `${scene} + thunderstorm -> rain art`)
    assert.equal(artSceneFor(scene, 0), scene, `${scene} + clear stays`)
    assert.equal(artSceneFor(scene, 2), scene, `${scene} + partly cloudy stays`)
  }
  // Wet brings rain and lightning; snow is its own family; overcast is dry.
  for (const code of [51, 61, 67, 80, 82, 95, 99]) assert.ok(isWetCode(code) && !isOvercastCode(code) && !isSnowCode(code), `code ${code} is wet`)
  for (const code of [71, 75, 77, 85, 86]) assert.ok(isSnowCode(code) && !isWetCode(code) && !isOvercastCode(code), `code ${code} is snow`)
  for (const code of [3, 45, 48]) assert.ok(isOvercastCode(code) && !isWetCode(code) && !isSnowCode(code), `code ${code} is dry overcast`)
  for (const code of [0, 1, 2, null, undefined]) assert.ok(!isWetCode(code) && !isOvercastCode(code) && !isSnowCode(code), `code ${code} is neither`)
  // MASTHEAD-SNOW-1: snow has its own frames by day and by night.
  for (const scene of ['dawn', 'morning', 'day', 'goldenhour', 'sunset']) assert.equal(artSceneFor(scene, 73), 'snow', `${scene} + snow`)
  assert.equal(artSceneFor('night', 73), 'snownight')
  assert.equal(artSceneFor('night', 86), 'snownight')
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
  assert.ok(!SCENES.includes('cloudy'), 'not required of every pack')
  assert.deepEqual(OPTIONAL_SCENES, ['cloudynight', 'cloudy', 'snow', 'snownight'])
  assert.deepEqual(ALL_SCENES, [...SCENES, 'cloudynight', 'cloudy', 'snow', 'snownight'])
  assert.equal(SCENE_FALLBACK.cloudynight, 'night')
  // MASTHEAD-CLOUDY-1: without a Cloudy frame a grey day shows Rain, as before.
  assert.equal(SCENE_FALLBACK.cloudy, 'rain')
  // MASTHEAD-SNOW-1: a fallback may name another optional scene; the chain
  // is followed and every chain ends on a required scene.
  assert.equal(SCENE_FALLBACK.snow, 'rain')
  assert.equal(SCENE_FALLBACK.snownight, 'cloudynight')
  for (const s of OPTIONAL_SCENES) {
    assert.ok(SCENE_FALLBACK[s], `${s} must declare a fallback`)
    let t = s, hops = 0
    while (!SCENES.includes(t)) { t = SCENE_FALLBACK[t]; assert.ok(t && ++hops < 8, `${s}'s fallback chain must end on a REQUIRED scene`) }
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
  assert.equal(sceneFrameFor('cloudy', { rain: '/r.webp' }), '/r.webp', 'a grey day without its frame shows Rain')
  assert.equal(sceneFrameFor('cloudy', { rain: '/r.webp', cloudy: '/c.webp' }), '/c.webp')
  // MASTHEAD-SNOW-1: the chain. A snowy night shows SnowNight, else CloudyNight, else Night.
  assert.equal(sceneFrameFor('snownight', { night: '/n.webp', cloudynight: '/cn.webp', snownight: '/sn.webp' }), '/sn.webp')
  assert.equal(sceneFrameFor('snownight', { night: '/n.webp', cloudynight: '/cn.webp' }), '/cn.webp')
  assert.equal(sceneFrameFor('snownight', { night: '/n.webp' }), '/n.webp')
  assert.equal(sceneFrameFor('snow', { rain: '/r.webp' }), '/r.webp')
})

test('the storm runs only when something is falling: the wet flag, and the CSS that reads it', () => {
  // MASTHEAD-CLOUDY-1: the cloudy-night frame serves a dry overcast night AND
  // a storm; rain and lightning must not run on the dry one. The motion layer
  // carries .mast-motion-wet from the shared weather query, and after dark the
  // storm gates require it. The Rain scene is wet by construction.
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  assert.match(css, /\.mast-scenic\.mast-scene-cloudynight \.mast-motion-wet \.mast-motion-bolt-a \{ animation: mast-bolt/)
  assert.match(css, /\.mast-scenic\.mast-scene-cloudynight \.mast-motion-wet \.mast-motion-rain \{ opacity: 1; \}/)
  assert.doesNotMatch(css, /\.mast-scenic\.mast-scene-cloudynight \.mast-motion-bolt-a \{/)
  assert.doesNotMatch(css, /\.mast-scenic\.mast-scene-cloudynight \.mast-motion-rain \{/)
  const wx = readFileSync(new URL('../src/components/WeatherScene.jsx', import.meta.url), 'utf8')
  assert.match(wx, /return \{ scene, night: isNightScene\(scene\), wet \}/)
  const motion = readFileSync(new URL('../src/components/masthead/MastheadMotion.jsx', import.meta.url), 'utf8')
  // The wet flag has to reach the class name; the class LIST is allowed to grow
  // (MASTHEAD-TIMELAPSE-1 added mast-motion-hushed), so this pins the flag
  // rather than the whole template, which is what the rule actually is.
  assert.match(motion, /`mast-motion\$\{wet \? ' mast-motion-wet' : ''\}/)
  // And the grey day carries the day kinds that belong on it, not the sun ones.
  for (const kind of ['haze', 'flock', 'bird', 'steam', 'ferry', 'haze-fog']) {
    assert.match(css, new RegExp(`\\.mast-scenic\\.mast-scene-cloudy \\.mast-motion-${kind}`), `${kind} runs on a cloudy day`)
  }
  assert.doesNotMatch(css, /\.mast-scene-cloudy \.mast-motion-glint/, 'no sun glitter under an overcast')
  assert.doesNotMatch(css, /\.mast-scene-cloudy \.mast-motion-flare/, 'no lens flare under an overcast')
  // The scene has its sky, its frame gate and its celestial-art gate like every other.
  for (const scene of ['cloudy', 'snow', 'snownight']) {
    assert.match(css, new RegExp(`\\.mast-scene-${scene} \\.mast-sky-${scene}`), `${scene} sky`)
    assert.match(css, new RegExp(`\\.mast-scene-${scene} \\.mast-scn-img-${scene}`), `${scene} frame gate`)
    assert.match(css, new RegExp(`\\.mast-scene-${scene} \\.wx-mast-art::before`), `${scene} art gate`)
  }
  // MASTHEAD-SNOW-1: a snowy night carries every night kind the clouded one
  // does (each plain cloudynight gate has a snownight twin), never the storm.
  const gates = css.match(/\.mast-scenic\.mast-scene-cloudynight \.mast-motion-[\w-]+/g).filter(g => !/-wet|only-|not-|anchored/.test(g))
  for (const g of new Set(gates)) assert.match(css, new RegExp(g.replace('cloudynight', 'snownight').replace(/\./g, '\\.')), `${g} has a snownight twin`)
  assert.doesNotMatch(css, /\.mast-scene-snownight \.mast-motion-wet/)
  assert.doesNotMatch(css, /\.mast-scene-snow \.mast-motion-drop/)
  // and snow falls on both snow scenes, the swell only on calm days.
  assert.match(css, /\.mast-scenic\.mast-scene-snow \.mast-motion-flake,\n\.mast-scenic\.mast-scene-snownight \.mast-motion-flake \{/)
  assert.doesNotMatch(css, /\.mast-scene-(rain|night|cloudynight|snownight) \.mast-motion-swell/)
})

test('night treatment follows every night scene, clear or clouded', () => {
  assert.ok(isNightScene('night'))
  assert.ok(isNightScene('cloudynight'))
  assert.ok(isNightScene('snownight'))
  for (const s of ['dawn', 'morning', 'day', 'goldenhour', 'sunset', 'rain', 'cloudy', 'snow']) {
    assert.ok(!isNightScene(s), s)
  }
})
