// MASTHEAD-NIGHT-1: the masthead card adopts the Nightfall dark treatment when
// the MOON/NIGHT weather scene is active - and only then.
//
// One shared state (useMastheadNight, is_day === 0 - the same condition the
// scene itself uses) drives one shared class (.mast-night) on both masthead
// hosts, so the main app and all three portals behave identically. The night
// layer is an always-mounted ::after that cross-fades, every ink cross-fades
// with it, day/dusk scenes stay light, and the page outside the card keeps the
// user's theme.
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

test('one shared scene-keyed state: useMastheadNight reads the weather is_day, never the theme', () => {
  assert.match(wx, /export function useMastheadNight\(\) \{\n {2}const \{ data \} = useWelcomeWeather\(\)\n {2}return data\?\.isDay === 0\n\}/)
  // Neither host infers night from the app theme or the greeting wash.
  for (const [name, src] of [['TodayMasthead', today], ['GreetingMasthead', shared]]) {
    assert.match(src, /const sceneNight = useMastheadNight\(\)/, `${name} must use the shared hook`)
    assert.doesNotMatch(src, /data-theme|prefers-color-scheme/, `${name} must not key night on the theme`)
  }
})

test('both hosts apply the same .mast-night class; the portal host gates it on showWeather', () => {
  assert.match(today, /className=\{`mast mast-wash-\$\{wash\}\$\{sceneNight \? ' mast-night' : ''\}`\}/)
  // A portal masthead rendered with showWeather={false} has no scene, so it never darkens.
  assert.match(shared, /className=\{`mast mast-wash-\$\{wash\}\$\{showWeather && sceneNight \? ' mast-night' : ''\}`\}/)
})

test('the night layer is the existing Nightfall language, cross-fading and contained', () => {
  assert.match(css, /\.mast \{ isolation: isolate; \}/)
  assert.match(css, /\.mast::after \{\n {2}content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none;\n {2}background: var\(--nightfall-gradient/)
  assert.match(css, /opacity: 0; transition: opacity 0\.8s ease;\n\}\n\.mast-night::after \{ opacity: 1; \}/)
})

test('every ink cross-fades and flips to accessible night values', () => {
  assert.match(css, /\.mast-night \.mast-greet, \.mast-night \.mast-mile-name,\n\.mast-night \.wx-mast-temp, \.mast-night \.wx-mast-cond \{ color: #fff; \}/)
  assert.match(css, /\.mast-night \.mast-sub, \.mast-night \.mast-mile-when, \.mast-night \.wx-mast-hilo \{ color: rgba\(255,255,255,0\.74\); \}/)
  assert.match(css, /\.mast-night \.mast-mile-label, \.mast-night \.mast-today-label \{ color: rgba\(255,255,255,0\.60\); \}/)
  assert.match(css, /\.mast-night \.mast-evchip \{ background: rgba\(255,255,255,0\.10\); border-color: rgba\(255,255,255,0\.18\); color: rgba\(255,255,255,0\.92\); \}/)
  // The transition list covers the same elements so the fade is uniform.
  assert.match(css, /\.mast-greet, \.mast-sub, \.mast-mile-label, \.mast-mile-name, \.mast-mile-when,\n\.mast-today-label, \.mast-evchip, \.mast-vdiv, \.mast-today-line,\n\.wx-mast-temp, \.wx-mast-cond, \.wx-mast-hilo \{\n {2}transition: color 0\.8s ease, background-color 0\.8s ease, border-color 0\.8s ease;\n\}/)
})

test('the calendar button adopts the existing dark-theme treatment on the night card', () => {
  assert.match(css, /\.mast-night \.mast-cal-btn \{ background: var\(--color-accent-primary-dark, #6B8EFF\); color: #0F1419; \}/)
  // The light-theme button and the app-level dark-theme override are untouched.
  assert.match(css, /\.mast-cal-btn \{\n {2}background: var\(--chart-navy, #1D2567\); color: #fff;/)
  assert.match(css, /\[data-theme="dark"\] \.mast-cal-btn \{ color: #0F1419; \}/)
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
