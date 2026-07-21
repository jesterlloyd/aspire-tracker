// UL-PORTAL: guards for the Unit Leader Portal UI.
//
// Static-source guards in the style this repo already uses: no jsdom, no
// testing-library. They assert the properties that matter and that a future edit
// could silently break: the Home order, the states, the routing, the accessibility
// affordances, ASPIRE authority wording, and that no excluded field is ever
// requested or rendered.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const portal = read('src/portal/UnitLeaderPortal.jsx')
const chrome = read('src/portal/unit/UnitLeaderChrome.jsx')
const api    = read('src/portal/unit/unitLeaderApi.js')
const app    = read('src/portal/PortalApp.jsx')
const css    = read('src/portal/portal.css')

const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const portalCode = stripJs(portal)
const apiCode = stripJs(api)

// ── Home priority order ─────────────────────────────────────────────────────
test('Home renders the five sections in the locked order', () => {
  const home = portal.slice(portal.indexOf('function HomeScreen'), portal.indexOf('function BucketCard'))
  const order = [
    'Needs your attention',
    'Upcoming students',
    'Active rotations',
    'Capacity and placement',
    'Recent ASPIRE Messages',
  ]
  let cursor = -1
  for (const label of order) {
    const at = home.indexOf(label)
    assert.ok(at > -1, `Home must contain ${label}`)
    assert.ok(at > cursor, `${label} must come after the previous section`)
    cursor = at
  }
})

// ── Every required section exists and is routed ─────────────────────────────
test('all eight sections exist in the navigation', () => {
  for (const label of [
    'Home', 'Placement Requests', 'Capacity', 'Students',
    'Preceptor Assignments', 'Messages', 'Report a Concern', 'Profile',
  ]) {
    assert.ok(chrome.includes(`label: '${label}'`), `nav must include ${label}`)
  }
})

test('every section has a screen wired in the portal', () => {
  for (const view of ['home', 'placements', 'capacity', 'students', 'preceptors', 'concern', 'profile', 'messages']) {
    assert.match(portalCode, new RegExp(`view === '${view}'`), `${view} must render`)
  }
})

test('sections are REAL routes, so refresh and deep links work', () => {
  assert.match(app, /function unitViewFromPath\(pathname\)/)
  assert.match(app, /\/portal\/unit\//)
  assert.match(app, /navigate\(key === 'messages' \? '\/portal\/messages' : `\/portal\/unit\/\$\{key\}`\)/)
  // An unknown section falls back to home rather than rendering nothing.
  assert.match(app, /return 'home'/)
  // Messages reuses the Student Portal thread route, so one link works for both.
  assert.match(app, /if \(pathname\.startsWith\('\/portal\/messages'\)\) return 'messages'/)
})

// ── Unit switcher and All assigned units ────────────────────────────────────
test('the unit switcher offers All assigned units and hides for a single unit', () => {
  assert.match(chrome, /All assigned units \(\{unitKeys\.length\}\)/)
  assert.match(chrome, /if \(unitKeys\.length <= 1\) return null/)
})

test('All assigned units NARROWS nothing: it omits the unit filter entirely', () => {
  assert.match(apiCode, /unitKey && unitKey !== ALL_UNITS \? `\?unit_key=\$\{encodeURIComponent\(unitKey\)\}` : ''/)
  assert.match(api, /omitting unit_key IS the all-units request/)
})

// ── The four required states ────────────────────────────────────────────────
test('loading, empty, error, and permission-denied states all exist', () => {
  for (const s of ['LoadingState', 'EmptyState', 'ErrorState', 'DeniedState']) {
    assert.match(chrome, new RegExp(`export function ${s}`), s)
  }
})

test('denied is DISTINCT from empty, because they are different facts', () => {
  assert.match(portalCode, /if \(unitKeys\.length === 0\) return <DeniedState \/>/)
  assert.match(chrome, /and "this unit has no students" are different facts/)
})

test('every screen handles loading and error, not just the happy path', () => {
  for (const screen of ['PlacementScreen', 'CapacityScreen', 'PreceptorScreen']) {
    const body = portal.slice(portal.indexOf(`function ${screen}`))
    const scoped = body.slice(0, body.indexOf('\n// ──') === -1 ? body.length : body.indexOf('\n// ──'))
    assert.match(scoped, /if \(loading\) return <LoadingState/, `${screen} loading`)
    assert.match(scoped, /if \(error\) return <ErrorState/, `${screen} error`)
    assert.match(scoped, /<EmptyState/, `${screen} empty`)
  }
})

// ── Accessibility ───────────────────────────────────────────────────────────
test('state changes are announced, not silent', () => {
  assert.match(chrome, /role="status" aria-live="polite"/)
  assert.match(chrome, /role="alert"/)
  assert.match(portalCode, /role="status"/)
})

test('navigation moves focus to the new section heading', () => {
  assert.match(chrome, /export function SectionHeading/)
  assert.match(chrome, /tabIndex=\{-1\}/)
  assert.match(chrome, /ref\.current\?\.focus\(\)/)
  // Every screen uses it, so focus never strands the user at the top of the shell.
  const headings = (portal.match(/<SectionHeading focusKey=/g) || []).length
  assert.ok(headings >= 6, `expected a heading per screen, saw ${headings}`)
})

test('the current section is exposed to assistive technology', () => {
  assert.match(chrome, /aria-current=\{active \? 'page' : undefined\}/)
  assert.match(chrome, /aria-label="Unit Leader Portal sections"/)
})

test('unread is never conveyed by color alone', () => {
  assert.match(chrome, /unreadLabel\(unread\)/)
  assert.match(chrome, /aria-hidden="true"/)
})

test('tables are labelled and filters report their pressed state', () => {
  const captions = (portal.match(/<caption className="ptl-visually-hidden">/g) || []).length
  assert.ok(captions >= 4, `every table needs a caption, saw ${captions}`)
  assert.match(portal, /scope="col"/)
  assert.match(portal, /aria-pressed=\{filter === f\}/)
  assert.match(portal, /role="group" aria-label="Filter students by stage"/)
})

test('every form control has an associated label', () => {
  const htmlFors = (portal.match(/htmlFor="/g) || []).length
  const ids = (portal.match(/\bid="(cap|nom|con)-/g) || []).length
  assert.ok(htmlFors >= 10, `expected labels, saw ${htmlFors}`)
  assert.equal(htmlFors, ids, 'each htmlFor must match a control id')
})

// ── Mobile and responsive ───────────────────────────────────────────────────
test('every table cell carries a mobile label, so the stacked view is readable', () => {
  const tds = (portal.match(/<td/g) || []).length
  const labelled = (portal.match(/data-label="/g) || []).length
  assert.equal(tds, labelled, 'every td needs data-label for the phone layout')
})

test('wide content scrolls inside its own container, never the page body', () => {
  assert.match(css, /\.ptl-table-wrap \{ overflow-x: auto/)
  assert.match(css, /@media \(max-width: 760px\)/)
  assert.match(css, /\.ptl-table thead \{ position: absolute/)
})

test('motion respects a reduced-motion preference', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(css, /\.ptl-spinner \{ animation: none; \}/)
})

test('the focus ring is made consistent, never removed', () => {
  assert.match(css, /:focus-visible/)
  assert.doesNotMatch(css, /\.ptl-(chip|linklike|section-title)[^{]*\{[^}]*outline:\s*none/)
})

// ── Product rules ───────────────────────────────────────────────────────────
test('ASPIRE keeps final authority, and it is stated on every relevant screen', () => {
  assert.match(api, /ASPIRE reviews and confirms this/)
  const uses = (portal.match(/ASPIRE_AUTHORITY_NOTE/g) || []).length
  assert.ok(uses >= 3, `authority note should appear on placement, capacity, and preceptors; saw ${uses}`)
  // Unit Leader state is always shown alongside the ASPIRE state.
  assert.match(portal, /Awaiting ASPIRE/)
})

test('the empty placeholder is a single dash', () => {
  assert.match(api, /export const EMPTY = '-'/)
  assert.match(api, /v === null \|\| v === undefined \|\| v === '' \? EMPTY : v/)
})

test('the product name and ASPIRE wording are correct', () => {
  assert.match(chrome, /Unit Leader Portal/)
  for (const [n, s] of Object.entries({ portal, chrome, api })) {
    assert.doesNotMatch(s, /ASPIRE Program/, `${n} must not say ASPIRE Program`)
  }
})

test('no employment, residency, or preceptor guarantee is implied', () => {
  for (const [n, s] of Object.entries({ portal, chrome, api })) {
    assert.doesNotMatch(s, /guarantee|guaranteed|will be hired|assured/i, n)
  }
})

// ── Privacy: excluded data is never requested or rendered ───────────────────
test('no excluded field is ever requested by the browser', () => {
  for (const forbidden of [
    'support_needed', 'learning_highlight', 'admin_notes', 'review_reason',
    'gpa_verified', 'bls_current', 'health_cleared', 'background_check',
    'rubric', 'survey', 'certificate',
  ]) {
    assert.ok(!apiCode.includes(forbidden), `api must not request ${forbidden}`)
    assert.ok(!portalCode.includes(forbidden), `portal must not render ${forbidden}`)
  }
})

test('the support signal is a COUNT, never the narrative text', () => {
  assert.match(portal, /s\.support\?\.open_count > 0/)
  assert.match(portal, /s\.support\.window_days/)
  assert.doesNotMatch(portalCode, /support\.text|support_needed/)
})

test('Report a Concern prefills context only, and goes to the ASPIRE Team', () => {
  const con = portal.slice(portal.indexOf('function ConcernScreen'), portal.indexOf('function ProfileScreen'))
  assert.match(con, /destination: 'aspire'/)
  // Prefill carries the student name and unit, nothing private.
  assert.match(con, /Student: \$\{studentName\(s\)\}/)
  assert.match(con, /Unit: \$\{s\.unit_key\}/)
  assert.match(con, /The student is not part of it/)
  // The draft is editable before sending.
  assert.match(con, /onChange=\{e => setBody\(e\.target\.value\)\}/)
  // Duplicate-submission guard.
  assert.match(con, /if \(sending\) return/)
  assert.match(con, /disabled=\{sending \|\| !student\}/)
  // Success and error are both handled.
  assert.match(con, /tone: 'ok'/)
  assert.match(con, /tone: 'error'/)
})

test('no student file path or signed URL is constructed in the browser', () => {
  for (const [n, s] of Object.entries({ portalCode, apiCode })) {
    assert.doesNotMatch(s, /getPublicUrl|createSignedUrl|storage\.from/, n)
    assert.doesNotMatch(s, /student-files/, n)
  }
  assert.match(api, /Never persisted/)
})

test('Student Portal behavior is preserved in the shared router', () => {
  // The student branch still resolves first and keeps its own view and nav.
  assert.ok(app.indexOf("roles.includes('student')") < app.indexOf("roles.includes('unit_leader')"))
  assert.match(app, /<StudentPortal/)
  assert.match(app, /<PortalNav/)
})

test('no em dash in the Unit Leader UI', () => {
  for (const [n, s] of Object.entries({ portal, chrome, api, css })) {
    assert.doesNotMatch(s, /—/, n)
  }
})
