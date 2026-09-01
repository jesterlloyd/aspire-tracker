// MASTHEAD-NIGHT-1 → MASTHEAD-SCENE-1: the masthead card adopts the Nightfall
// dark treatment when the unified time-of-day scene is 'night' - and only then.
//
// One shared clock (useMastheadScene: real sun times from the shared weather
// query, fixed local windows as fallback) drives BOTH the .mast-scene-* artwork
// state and the .mast-night card treatment on both masthead hosts, so the dark
// card and the night artwork can never disagree. The night layer is an
// always-mounted ::after that cross-fades, every ink cross-fades with it,
// day/dusk scenes stay light, and the page outside the card keeps the user's
// theme.
//
// Run: node --test test/mastheadNightMode.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const wx = read('src/components/WeatherScene.jsx')
const today = read('src/components/TodayMasthead.jsx')
const shared = read('src/components/masthead/GreetingMasthead.jsx')
const css = read('src/index.css')

test('one unified clock: night is the scene clock, never is_day and never the theme', () => {
  // useMastheadScene anchors to sun times (fallback: fixed windows), applies the
  // SCENE-3 rain artwork override, and derives night from the result.
  assert.match(wx, /let scene = artSceneFor\(sceneForTime\(new Date\(\), sunTimesFrom\(data\)\), data\?\.code\)/)
  assert.match(wx, /return \{ scene, night: scene === 'night' \}/)
  assert.match(wx, /export function useMastheadNight\(\) \{\n {2}return useMastheadScene\(\)\.night\n\}/)
  // The old split driver is gone: nothing keys the card on the weather's is_day.
  assert.doesNotMatch(wx, /useMastheadNight\(\) \{\n {2}const \{ data \} = useWelcomeWeather/)
  // Neither host infers night from the app theme or the greeting wash.
  for (const [name, src] of [['TodayMasthead', today], ['GreetingMasthead', shared]]) {
    assert.match(src, /const \{ scene, night: sceneNight \} = useMastheadScene\(\)/, `${name} must use the shared clock`)
    assert.doesNotMatch(src, /data-theme|prefers-color-scheme/, `${name} must not key night on the theme`)
  }
})

test('both hosts carry the scene class and .mast-night; the portal host gates both on showWeather', () => {
  assert.ok(today.includes("className={`mast mast-wash-${wash} mast-scenic mast-scene-${scene}${sceneNight ? ' mast-night' : ''}`}"))
  assert.match(today, /<MastheadScenery \/>/)
  // A portal masthead rendered with showWeather={false} has no scenery and never darkens.
  assert.ok(shared.includes("className={`mast mast-wash-${wash}${showWeather ? ` mast-scenic mast-scene-${scene}` : ''}${showWeather && sceneNight ? ' mast-night' : ''}`}"))
  assert.match(shared, /\{showWeather && <MastheadScenery \/>\}/)
})

test('the night layer is the existing Nightfall language, cross-fading and contained', () => {
  assert.match(css, /\.mast \{ isolation: isolate; \}/)
  assert.match(css, /\.mast::after \{\n {2}content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none;\n {2}background: var\(--nightfall-gradient/)
  // MASTHEAD-SCENE-6: the night layer breathes at the shared morph duration
  // (10s on scenic cards via --scn-fade; the 0.8s fallback covers any
  // non-scenic surface), so the card darkens at the pace the artwork blends.
  assert.match(css, /opacity: 0; transition: opacity var\(--scn-fade, 0\.8s\) ease;\n\}\n\.mast-night::after \{ opacity: 1; \}/)
})

test('every ink cross-fades and flips to accessible night values', () => {
  assert.match(css, /\.mast-night \.mast-greet, \.mast-night \.mast-mile-name,\n\.mast-night \.wx-mast-temp, \.mast-night \.wx-mast-cond \{ color: #fff; \}/)
  assert.match(css, /\.mast-night \.mast-sub, \.mast-night \.mast-mile-when, \.mast-night \.wx-mast-hilo \{ color: rgba\(255,255,255,0\.74\); \}/)
  assert.match(css, /\.mast-night \.mast-mile-label, \.mast-night \.mast-today-label \{ color: rgba\(255,255,255,0\.60\); \}/)
  assert.match(css, /\.mast-night \.mast-evchip \{ background: rgba\(255,255,255,0\.10\); border-color: rgba\(255,255,255,0\.18\); color: rgba\(255,255,255,0\.92\); \}/)
  // The transition list covers the same elements so the fade is uniform.
  assert.match(css, /\.mast-greet, \.mast-sub, \.mast-mile-label, \.mast-mile-name, \.mast-mile-when,\n\.mast-today-label, \.mast-evchip, \.mast-vdiv, \.mast-today-line,\n\.wx-mast-temp, \.wx-mast-cond, \.wx-mast-hilo, \.wx-mast-city \{\n {2}transition: color var\(--scn-fade, 0\.8s\) ease, background-color var\(--scn-fade, 0\.8s\) ease, border-color var\(--scn-fade, 0\.8s\) ease;\n\}/)
})

test('the calendar button adopts the existing dark-theme treatment on the night card', () => {
  assert.match(css, /\.mast-night \.mast-cal-btn \{ background: var\(--color-accent-primary-dark, #6B8EFF\); color: #0F1419; \}/)
  // The light-theme button and the app-level dark-theme override are untouched.
  assert.match(css, /\.mast-cal-btn \{\n {2}background: var\(--chart-navy, #1D2567\); color: #fff;/)
  assert.match(css, /\[data-theme="dark"\] \.mast-cal-btn \{ color: #0F1419; \}/)
  // MASTHEAD-SCENE polish 2: scenery cards SUPERSEDE both with frosted glass -
  // the later .mast-scene-night rule must stay after the solid night rule so
  // the cascade keeps the glass treatment (Owner decision; do not "fix" back).
  const solidAt = css.indexOf('.mast-night .mast-cal-btn {')
  const glassAt = css.indexOf('.mast-scene-night .mast-cal-btn {')
  assert.ok(solidAt !== -1 && glassAt > solidAt, 'glass night button must come after the solid rule')
  assert.match(css, /\.mast-scene-night \.mast-cal-btn \{\n {2}background: rgba\(255,255,255,0\.14\);/)
})

test('reduced motion drops the night cross-fade along with every ink transition', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n {2}\.mast::after, \.mast-greet, \.mast-sub/)
})

test('the day/dusk hierarchy and the 1c night backdrop survive untouched', () => {
  // Time-of-day washes are unchanged (the wash paints ABOVE the night layer).
  for (const wash of ['morning', 'afternoon', 'evening', 'night']) {
    assert.match(css, new RegExp(`\\.mast-wash-${wash}::before`), `wash ${wash} must survive`)
  }
  // The scene-local star backdrop from 1c stays in place.
  assert.match(css, /\.wx-mast-night \.wx-mast-art::before \{ opacity: 1; \}/)
  assert.match(wx, /className=\{`wx-mast\$\{night \? ' wx-mast-night' : ''\}`\}/)
})
