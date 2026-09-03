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
const preceptorsWorkspace = read('src/portal/unit/UnitPreceptorsWorkspace.jsx')
const preceptorDirectoryTable = read('src/components/shared/PreceptorDirectoryTable.jsx')

// Built from its code point so this guard does not put the character it forbids into
// the very file that enforces the rule.
const EM_DASH_RE = new RegExp(String.fromCharCode(0x2014))

const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const portalCode = stripJs(portal)
const apiCode = stripJs(api)

// ── Home priority order ─────────────────────────────────────────────────────
test('Home renders welcome, optional attention, calendar, then the table', () => {
  // Portal convergence keeps Home focused: welcome/context, actionable attention
  // when present, the activity calendar, then the full-width student roster. Capacity
  // and Placement remain dedicated routes rather than extra Home cards.
  const home = portal.slice(portal.indexOf('function HomeScreen'), portal.indexOf('function PlacementScreen'))
  const order = ['Welcome', 'ptl-attn-strip', 'UnitRotationCalendar', 'StudentRoster']
  let cursor = -1
  for (const marker of order) {
    const at = home.indexOf(marker)
    assert.ok(at > -1, `Home must contain ${marker}`)
    assert.ok(at > cursor, `${marker} in order`)
    cursor = at
  }
  assert.ok(!home.includes('Upcoming students'))
  assert.ok(!home.includes('Capacity and placement'))
  assert.ok(!home.includes('ptl-home-followup-grid'))
})

// ── Every required section exists and is routed ─────────────────────────────
test('every workflow still has a nav entry after the Phase 1 restructure', () => {
  // Report a Concern is deliberately absent: it was never a separate workflow, only a
  // Messages conversation with destination 'aspire', and now lives inside Messages.
  for (const label of [
    'Home', 'Preceptors', 'Messages', 'Evaluations', 'Placement Requests', 'Capacity',
  ]) {
    assert.ok(chrome.includes(`label: '${label}'`), `nav must include ${label}`)
  }
  assert.ok(!chrome.includes("label: 'Profile'"), 'Profile lives in the avatar menu')
  assert.ok(!chrome.includes("label: 'Notification Preferences'"), 'preferences live inside Profile')
  assert.ok(!chrome.includes("label: 'Report a Concern'"),
    'it is an action inside Messages, not a section')
})

test('every section has a screen wired in the portal', () => {
  for (const view of ['home', 'placements', 'capacity', 'students', 'preceptors',
    'profile', 'messages', 'evaluations']) {
    assert.match(portalCode, new RegExp(`view === '${view}'`), `${view} must render`)
  }
  // 'concern' no longer renders a screen; its route hands off to Messages instead,
  // which is asserted in test/unitLeaderPhase1.test.mjs.
  assert.ok(!portalCode.includes("view === 'concern'"))
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
  assert.match(chrome, /<SegmentedTabs[\s\S]*label="Viewing"/)
  assert.match(chrome, /label: 'All Assigned Units'/)
  assert.match(chrome, /items=\{items\}/)
  // UL-POLISH: a single-unit leader now gets a static unit-context line rather
  // than a dead control; the segmented switcher still never renders for one unit.
  assert.match(chrome, /if \(unitKeys\.length === 0\) return null/)
  assert.match(chrome, /if \(unitKeys\.length === 1\) \{\s*return <p className="ptl-unit-context">/)
  assert.doesNotMatch(chrome, /id="ul-unit-switcher"|<select/)
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
  // SUPERSEDED: CapacityScreen is now the canonical unit-availability SUBMIT form (like
  // /unit-form); it loads no prior rows, so it has no loading/error/empty table states.
  for (const screen of ['PlacementScreen']) {
    const body = portal.slice(portal.indexOf(`function ${screen}`))
    const scoped = body.slice(0, body.indexOf('\n// ──') === -1 ? body.length : body.indexOf('\n// ──'))
    // UL-POLISH P2: table screens load with a shimmer skeleton (which carries
    // its own polite live region); other surfaces keep LoadingState.
    assert.match(scoped, /if \(loading\) return <(LoadingState|TableSkeleton)/, `${screen} loading`)
    assert.match(scoped, /if \(error\) return <ErrorState/, `${screen} error`)
    assert.match(scoped, /<EmptyState/, `${screen} empty`)
  }
  assert.match(preceptorsWorkspace, /preceptors\.loading \?/)
  assert.match(preceptorsWorkspace, /preceptors\.error \?/)
  assert.match(preceptorsWorkspace, /<EmptyState/)
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
  // UL-POLISH: the heading still receives programmatic focus on navigation;
  // the effect now also marks that focus so its ring can be suppressed.
  assert.match(chrome, /const el = ref\.current/)
  assert.match(chrome, /el\.focus\(\)/)
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

test('tables are labelled with captions and column scopes', () => {
  // SUPERSEDED: the stage filters were removed in the UX-cleanup pass, so the pressed-
  // state and filter-group assertions are gone. The student table returned (with its own
  // caption), so every table including the roster is captioned.
  // The canonical Capacity form replaced the old capacity table, so its caption is gone;
  // the remaining tables (roster, placements, preceptors) stay captioned.
  const captions = ((portal + preceptorsWorkspace + preceptorDirectoryTable).match(/<caption className="ptl-visually-hidden">/g) || []).length
  assert.ok(captions >= 3, `every table needs a caption, saw ${captions}`)
  assert.match(portal, /scope="col"/)
  assert.ok(!portal.includes('Filter students by stage'), 'the stage filter control is gone')
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
  // UL-POLISH: an outline may be suppressed ONLY for non-keyboard focus, i.e.
  // :focus:not(:focus-visible) or the [data-programmatic-focus] marker set by
  // the focus-on-navigation effect. Every keyboard focus ring must survive.
  const isProgrammaticFocusRule = (line) =>
    line.includes(':focus:not(:focus-visible)') || line.includes('[data-programmatic-focus]')
  const keyboardCss = css.split('\n').filter(l => !isProgrammaticFocusRule(l)).join('\n')
  assert.doesNotMatch(keyboardCss, /\.ptl-(chip|linklike|section-title)[^{]*\{[^}]*outline:\s*none/)
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

test('support signals stay out of the portal UI', () => {
  assert.doesNotMatch(portal, /s\.support\?\.open_count > 0/)
  assert.doesNotMatch(portal, /s\.support\.window_days/)
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
    assert.doesNotMatch(s, EM_DASH_RE, n)
  }
})
