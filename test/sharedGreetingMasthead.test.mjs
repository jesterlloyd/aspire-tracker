// Commit 1: the shared portal greeting masthead. Pure last-visit tests, greeting reuse, and
// source guards that the portal reuses the canonical masthead system (greeting, weather,
// .mast* CSS) without recreating it, and that the main-app masthead is left untouched.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { greetingLine } from '../src/lib/masthead.js'
import { formatLastVisit } from '../src/lib/lastVisit.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const at = (h) => new Date(2026, 6, 18, h, 0)

// ── greeting reuse (morning/afternoon/evening) ────────────────────────────────
test('the shared masthead reuses the canonical daypart greeting', () => {
  assert.equal(greetingLine('Jordan Cruz', at(8)).heading, 'Good morning, Jordan')
  assert.equal(greetingLine('Jordan Cruz', at(14)).heading, 'Good afternoon, Jordan')
  assert.equal(greetingLine('Jordan Cruz', at(20)).heading, 'Good evening, Jordan')
  // Never invents a name.
  assert.equal(greetingLine('', at(8)).heading, 'Good morning')
})

// ── last-visit label ──────────────────────────────────────────────────────────
test('formatLastVisit produces the honest browser-scoped wording', () => {
  const now = Date.parse('2026-07-18T12:00:00Z')
  assert.equal(formatLastVisit(null, now), null)
  assert.equal(formatLastVisit('not-a-date', now), null)
  assert.match(formatLastVisit('2026-07-18T09:00:00Z', now), /Last visit on this browser: earlier today/)
  assert.match(formatLastVisit('2026-07-17T09:00:00Z', now), /Last visit on this browser: yesterday/)
  assert.match(formatLastVisit('2026-07-10T09:00:00Z', now), /Last visit on this browser: Jul 10/)
})

// ── the shared component reuses the canonical system, no parallel art ─────────
test('GreetingMasthead reuses greetingLine, WeatherMasthead, and the .mast* card', () => {
  const c = read('src/components/masthead/GreetingMasthead.jsx')
  assert.match(c, /import \{ greetingLine \} from '\.\.\/\.\.\/lib\/masthead'/)
  // MASTHEAD-SCENE-1: the shared masthead imports the unified scene clock.
  assert.match(c, /import \{ WeatherMasthead, useMastheadScene \} from '\.\.\/WeatherScene'/)
  assert.match(c, /className="chart-route-title mast-greet"/)      // same heading class as staff
  // MASTHEAD-SCENE-1: the card carries the scene artwork class and mast-night,
  // both gated on showWeather (a weatherless masthead never darkens).
  assert.ok(c.includes("className={`mast mast-wash-${wash}${showWeather ? ` mast-scene-${scene}` : ''}${showWeather && sceneNight ? ' mast-night' : ''}`}"))
  // No new weather artwork or parallel greeting system is defined here.
  assert.ok(!/svg|canvas|\.png|weather-icon|new Image/i.test(c), 'must not define new weather art')
  // Role-neutral slots: name, date, context, last-visit all arrive as props.
  for (const p of ['fullName', 'dateLabel', 'contextLabel', 'lastVisitLine', 'headingRef']) {
    assert.ok(c.includes(p), `must accept ${p} prop`)
  }
})

// ── the main-app masthead is untouched (its guards stay valid) ────────────────
test('the shared component and TodayMasthead do not depend on each other', () => {
  const shared = read('src/components/masthead/GreetingMasthead.jsx')
  const staff = read('src/components/TodayMasthead.jsx')
  // No import dependency in either direction (a comment may name the other for context).
  assert.ok(!/^import[^\n]*TodayMasthead/m.test(shared), 'shared masthead must not import the staff one')
  assert.ok(!/GreetingMasthead/.test(staff), 'staff masthead must remain independent')
  // The staff masthead still owns its guarded internals (unchanged this branch).
  assert.match(staff, /aspire:lastVisit:\$\{currentUserId\}:\$\{cohortId\}/)
  assert.match(staff, /<h1 className="chart-route-title mast-greet">\{heading\}<\/h1>/)
})

// ── UL Home integration: masthead in, no duplicate unit label ─────────────────
test('the Unit Leader Home renders the shared masthead without a duplicated unit label', () => {
  const raw = read('src/portal/UnitLeaderPortal.jsx')
  const portal = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')  // scan CODE, not comments
  assert.match(portal, /import GreetingMasthead from '\.\.\/components\/masthead\/GreetingMasthead'/)
  assert.match(portal, /<GreetingMasthead[\s\S]*?headingRef=\{greetingRef\}/)
  // The greeting <h1> is the focus-on-navigation target (programmatic focus, like SectionHeading).
  assert.match(portal, /el\.dataset\.programmaticFocus = 'true'/)
  // The redundant lower "Unit Leader · X" line was removed (Commit 2); the unit context is
  // shown once by the UnitSwitcher's upper "Unit · X" line, which lives in UnitLeaderChrome.
  assert.ok(!portal.includes('Unit · '), 'no unit label line in the portal body')
  const unitLeaderLines = portal.match(/Unit Leader · /g) || []
  assert.equal(unitLeaderLines.length, 0, 'no Unit Leader context line below the masthead')
  // The old plain welcome heading is gone.
  assert.ok(!portal.includes('firstNameOf') && !/`Welcome`|Welcome, \$\{first\}/.test(portal))
  // A portal-scoped ring suppression exists for the masthead heading focus.
  const css = read('src/portal/portal.css')
  assert.match(css, /\.mast-greet\[data-programmatic-focus\]:focus \{ outline: none; \}/)
})
