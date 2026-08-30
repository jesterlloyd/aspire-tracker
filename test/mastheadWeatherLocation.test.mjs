// MASTHEAD-WEATHER-1: location-aware masthead weather + scene alignment.
//
// Location: one shared resolver (weatherLocation.js) with a cached, prompt-polite
// hierarchy - cached granted location renders instantly, live geolocation runs
// only when it will not nag (granted, or prompt + not snoozed), and the fixed
// Cedars-Sinai / LA fallback covers everything else. Coordinates stay rounded,
// unlogged, and out of the UI.
//
// Alignment: the celestial asset layers (whose solid pixels start at row 0 of the
// source renders) no longer start ABOVE the clipping box - the old negative tops
// cut the sun/moon and left dead sky at the top of the masthead card.
//
// Run: node --test test/mastheadWeatherLocation.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { LA_FALLBACK, readCachedLocation, LOC_CACHE_KEY, PROMPT_SNOOZE_KEY, PROMPT_SNOOZE_DAYS } from '../src/lib/weatherLocation.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const loc = read('src/lib/weatherLocation.js')
const wx = read('src/components/WeatherScene.jsx')
const assets = read('src/lib/weatherAssetMap.js')
const css = read('src/index.css')

// ── Fallback hierarchy ───────────────────────────────────────────────────────

test('the LA/Cedars-Sinai fallback is unchanged and instant', () => {
  assert.deepEqual(LA_FALLBACK, { lat: 34.076, lon: -118.380, label: 'Los Angeles', geo: false })
  // The hook renders IMMEDIATELY from cache-or-fallback; resolution never blocks.
  assert.match(loc, /useState\(\(\) => readCachedLocation\(\) \|\| LA_FALLBACK\)/)
})

test('readCachedLocation is storage-safe and shape-validated', () => {
  // In node there is no localStorage: the guarded read returns null, never throws.
  assert.equal(readCachedLocation(), null)
  assert.match(loc, /if \(!c \|\| typeof c\.lat !== 'number' \|\| typeof c\.lon !== 'number'\) return null/)
  assert.equal(typeof LOC_CACHE_KEY, 'string')
  assert.equal(typeof PROMPT_SNOOZE_KEY, 'string')
})

test('permission-polite: denied never calls geolocation, prompts are snoozed', () => {
  // Permissions API consulted where available; 'denied' short-circuits to the fallback
  // and drops the cached grant so a revoked permission downgrades cleanly.
  assert.match(loc, /navigator\.permissions\?\.query/)
  assert.match(loc, /if \(state === 'denied'\) \{\n {6}try \{ localStorage\.removeItem\(LOC_CACHE_KEY\) \}/)
  // The hook applies the resolver's answer unconditionally (upgrades AND downgrades).
  assert.match(loc, /if \(mounted\) setLoc\(\{ lat: l\.lat, lon: l\.lon, label: l\.label, geo: l\.geo === true \}\)/)
  // A pending 'prompt' state respects the snooze marker instead of nagging.
  assert.match(loc, /if \(state === 'prompt' && promptSnoozed\(\)\) return cached \|\| LA_FALLBACK/)
  // Ignoring the prompt (timeout) or denying it sets the snooze marker.
  assert.match(loc, /if \(state === 'prompt'\) writeJson\(PROMPT_SNOOZE_KEY, \{ ts: Date\.now\(\) \}\)/)
  assert.match(loc, /err\?\.code === 1/)
  assert.equal(PROMPT_SNOOZE_DAYS, 7)
})

test('privacy: only rounded coords are cached; nothing is logged or shown', () => {
  assert.match(loc, /const round2 = \(n\) => Math\.round\(n \* 100\) \/ 100/)
  assert.match(loc, /writeJson\(LOC_CACHE_KEY, \{ lat, lon, label: loc\.label, ts: Date\.now\(\) \}\)/)
  assert.doesNotMatch(loc, /console\./)
  // The UI label is a city name or the neutral label, never coordinates.
  assert.match(loc, /label: city \|\| 'Current location'/)
})

test('one shared resolver: a single module-level promise feeds every consumer', () => {
  assert.match(loc, /let _locPromise = null/)
  assert.match(loc, /if \(_locPromise\) return _locPromise/)
  // WeatherScene consumes it through the one shared hook + one shared query key.
  assert.match(wx, /import \{ useWeatherLocation \} from '\.\.\/lib\/weatherLocation'/)
  assert.match(wx, /queryKey: \['welcome_weather', location\.geo \? `geo:\$\{location\.lat\},\$\{location\.lon\}` : 'los_angeles'\]/)
})

test('all four surfaces share ONE weather component (no duplicated implementations)', () => {
  // MASTHEAD-SCENE-1: both hosts import the unified scene clock from the same module.
  assert.match(read('src/components/TodayMasthead.jsx'), /import \{ WeatherMasthead, useMastheadScene \} from '\.\/WeatherScene'/)
  const shared = read('src/components/masthead/GreetingMasthead.jsx')
  assert.match(shared, /import \{ WeatherMasthead, useMastheadScene \} from '\.\.\/WeatherScene'/)
  // The three portals all render the shared GreetingMasthead.
  for (const p of ['src/portal/StudentPortal.jsx', 'src/portal/UnitLeaderPortal.jsx', 'src/portal/AcademicPartnerPortal.jsx']) {
    assert.match(read(p), /GreetingMasthead/, `${p} must use the shared masthead`)
  }
})

// ── No-jump rendering and failure states ─────────────────────────────────────

test('weather renders silently or not at all: no spinner, no throw, no layout jump path', () => {
  assert.match(wx, /if \(!data\) return null/)
  assert.doesNotMatch(wx, /Loading|spinner/i)
  // The query keeps cached results warm and does not refetch on focus.
  assert.match(wx, /staleTime: 30 \* 60 \* 1000/)
  assert.match(wx, /refetchOnWindowFocus: false/)
})

// ── Scene alignment: celestial layers stay inside the clipping box ───────────

test('sun and moon layers start inside the box (the old negative tops clipped the disc)', () => {
  assert.match(assets, /const sunLayer {2}= \{\n {2}src: SUN, left: '14%', top: '2%', width: '66%'/)
  assert.match(assets, /const moonLayer = \{ src: MOON, left: '22%', top: '3%', width: '62%'/)
  // The partly-cloudy overrides inherit the corrected tops (no top override reintroduces clipping).
  assert.match(assets, /\{ \.\.\.sunLayer, left: '2%', width: '58%' \}/)
  assert.match(assets, /\{ \.\.\.moonLayer, left: '8%', width: '48%' \}/)
})

test('the masthead art and caption grew modestly, subordinate to the 30px greeting', () => {
  assert.match(css, /\.wx-mast-art \{ position: relative; flex-shrink: 0; width: 192px; margin-top: -16px; pointer-events: none; \}/)
  assert.match(css, /\.wx-mast-temp \{ font-size: 27px;/)
  assert.match(css, /\.wx-mast-cond \{ font-size: 13px;/)
  assert.match(css, /\.wx-mast-hilo \{ font-size: 11\.5px;/)
  assert.match(css, /\.mast-greet \{[\s\S]{0,700}font-size: 30px/, 'the greeting stays the dominant element')
})

// ── MASTHEAD-WEATHER-1c: narrow anchoring + scene-state night backdrop ───────

test('narrow layouts top-anchor the art to the card, clicks fall through, caption stays in flow', () => {
  // The positioned ancestors go static so .mast is the absolute anchor; top:2px
  // matches the desktop resting position (absolute offsets are border-box based).
  assert.match(css, /@media \(max-width: 760px\) \{\n {2}\.mast-row, \.mast-right \{ position: static; \}\n {2}\/\*[\s\S]{0,300}\*\/\n {2}\.wx-mast-art \{ position: absolute; top: 2px; right: 4px; width: 150px; margin-top: 0; \}/)
  assert.match(css, /\.mast-left \{ padding-right: 132px; \}/)
  // The smallest screens only tighten the size; the anchor rules carry through.
  assert.match(css, /\.wx-mast-art \{ width: 142px; margin-top: 0; \}/)
})

test('the night backdrop is scene-keyed, cross-fades, and never blocks input', () => {
  const wxSrc = read('src/components/WeatherScene.jsx')
  assert.match(wxSrc, /className=\{`wx-mast\$\{night \? ' wx-mast-night' : ''\}`\}/)
  // Always-mounted overlay at opacity 0 -> 1 keyed by the class; soft edges via mask.
  assert.match(css, /\.wx-mast-art::before \{/)
  assert.match(css, /opacity: 0; transition: opacity 0\.8s ease;/)
  assert.match(css, /\.wx-mast-night \.wx-mast-art::before \{ opacity: 1; \}/)
  assert.match(css, /mask-image: linear-gradient\(90deg, transparent 0, #000 22%, #000 78%, transparent 100%\);/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.wx-mast-art::before \{ transition: none; \} \}/)
  // Day scenes stay bright: opacity 1 exists ONLY under the night class.
  const nightRuleCount = (css.match(/\.wx-mast-night \.wx-mast-art::before/g) || []).length
  assert.equal(nightRuleCount, 1)
  // Stars keep to the box's upper sky (a mid-box star used to land on the calendar button).
  assert.match(wxSrc, /\[\[14, 14, 3\], \[78, 10, 4\], \[92, 20, 3\], \[8, 40, 3\], \[64, 6, 3\]\]/)
})

// ── Animation preservation ───────────────────────────────────────────────────

test('every animation and the reduced-motion freeze survive untouched', () => {
  for (const kf of ['wx-pulse', 'wx-spin', 'wx-drift', 'wx-drift2', 'wx-rain', 'wx-fog', 'wx-wind', 'wx-twinkle', 'wx-fall', 'wx-blow']) {
    assert.match(wx, new RegExp(`@keyframes ${kf} `), `keyframes ${kf} must survive`)
  }
  assert.match(wx, /@media \(prefers-reduced-motion: reduce\)\{ \.wx-a\{ animation:none !important \} \}/)
  // The scene switchers (day/night, per-condition) are intact.
  assert.match(wx, /function mapScene\(code, windKmh, isDay\)/)
  assert.match(wx, /const night = data\.isDay === 0/)
})
