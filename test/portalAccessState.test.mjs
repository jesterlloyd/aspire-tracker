// test/portalAccessState.test.mjs
//
// PORTAL-ACCESS-STATE: the portal fallback card must tell a person the truth
// about their access, and must not promise anything.
//
// The card began as one message for every situation ("Your ASPIRE portal is
// being prepared... The ASPIRE team will let you know as soon as it opens").
// A first pass split that into six states. That was too many: four of them said
// the same thing in four ways, and the not-provisioned wording still promised
// something was coming to students who had simply finished a rotation. The set
// is now two, split on the only line that changes what the reader can DO.
//
// Pure unit and source assertions. Nothing here opens a network connection,
// touches a live database, or sends email.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  resolveAccessState, accessCopy, ACCESS_STATES, ACCESS_COPY, SUPPORT_EMAIL,
} from '../src/lib/portalAccessState.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const portalApp = read('src/portal/PortalApp.jsx')
const portalCss = read('src/portal/portal.css')

// ── The states ───────────────────────────────────────────────────────────────

test('access state: there are exactly two, and a failed check is the only split', () => {
  assert.deepEqual(Object.values(ACCESS_STATES).sort(), ['no_access', 'unknown'])
  assert.equal(resolveAccessState({}), ACCESS_STATES.NO_ACCESS)
  assert.equal(resolveAccessState({ checkFailed: false }), ACCESS_STATES.NO_ACCESS)
  assert.equal(resolveAccessState({ checkFailed: true }), ACCESS_STATES.UNKNOWN)
  assert.equal(resolveAccessState(), ACCESS_STATES.NO_ACCESS)
})

test('access state: the states that used to exist are gone, not renamed', () => {
  // revoked / expired / pending / not_provisioned all read identically to the
  // person, so keeping them apart bought nothing and cost one false promise.
  const src = read('src/lib/portalAccessState.js')
  for (const dead of ['DEACTIVATED:', 'REVOKED:', 'EXPIRED:', 'PENDING:', 'NOT_PROVISIONED:']) {
    assert.doesNotMatch(src, new RegExp(dead), `${dead} must no longer be a state`)
  }
})

test('access state: deactivation is not an input to the wording', () => {
  // It decides WHICH screen, not which words. Same card either way.
  assert.equal(resolveAccessState({ profileActive: false }), ACCESS_STATES.NO_ACCESS)
  assert.match(portalApp, /if \(deactivated\) return <PortalAccessNotice state=\{ACCESS_STATES\.NO_ACCESS\} \/>/)
})

// ── The copy makes no promise ────────────────────────────────────────────────

test('access copy: nothing is being prepared and nobody will be notified', () => {
  for (const [state, copy] of Object.entries(ACCESS_COPY)) {
    const text = `${copy.title} ${copy.body}`
    assert.doesNotMatch(text, /being prepared/i, `${state} must not say anything is being prepared`)
    assert.doesNotMatch(text, /let you know|notify|notified|in touch|as soon as/i,
      `${state} must not promise anyone will make contact`)
    assert.doesNotMatch(text, /\byet\b/i, `${state} must not say "yet"`)
    assert.doesNotMatch(text, /Your account is active/i, `${state} must not claim the account is active`)
    assert.doesNotMatch(text, /soon|shortly|coming|opening|will open/i, `${state} must not imply access is on its way`)
  }
})

test('access copy: no-access says plainly that there is none, and points at a person', () => {
  const copy = accessCopy(ACCESS_STATES.NO_ACCESS)
  assert.match(copy.title, /No portal access on this account/)
  assert.match(copy.body, /no ASPIRE portal access on this account right now/)
  assert.equal(copy.showSupport, true)
  assert.equal(copy.canRetry, false)
})

test('access copy: a failed check is its own message, with a way to retry', () => {
  const copy = accessCopy(ACCESS_STATES.UNKNOWN)
  assert.match(copy.title, /could not check/i)
  assert.equal(copy.canRetry, true, 'the one state where trying again can help must offer it')
  assert.equal(copy.showSupport, true)
})

test('access copy: the support address is the ASPIRE one, on every state', () => {
  assert.equal(SUPPORT_EMAIL, 'aspire@cshs.org')
  for (const [state, copy] of Object.entries(ACCESS_COPY)) {
    assert.equal(copy.showSupport, true, `${state} must offer a route to a person`)
  }
})

test('access copy: no state explains the mechanism', () => {
  for (const [state, copy] of Object.entries(ACCESS_COPY)) {
    const text = `${copy.title} ${copy.body}`
    assert.doesNotMatch(text, /token|JWT|session|grant|RPC|endpoint|is_active|role|database|403|deactivat|revok|expir/i,
      `${state} leaks mechanism the reader cannot act on`)
  }
})

test('access copy: every state is complete, and house style holds', () => {
  for (const state of Object.values(ACCESS_STATES)) {
    const copy = ACCESS_COPY[state]
    assert.ok(copy && copy.title && copy.body, `${state} is missing copy`)
    assert.equal(typeof copy.showSupport, 'boolean')
    assert.equal(typeof copy.canRetry, 'boolean')
  }
  const all = Object.values(ACCESS_COPY).map(c => `${c.title} ${c.body}`).join(' ')
  assert.doesNotMatch(all, /ASPIRE Program/)
  // — is the em dash, written as an escape so this file contains none either.
  assert.doesNotMatch(all, /—/)
  assert.doesNotMatch(read('src/lib/portalAccessState.js'), /—/)
  assert.doesNotMatch(portalCss, /—/)
})

// ── The endpoint that no longer earns its place ──────────────────────────────

test('access state: the grant-classifying endpoint is gone', () => {
  // It existed to tell revoked from expired from never-provisioned. Those now
  // read identically, and its remaining state (pending) is unreachable:
  // user_role_grants.starts_at is NOT NULL DEFAULT now() and
  // grant_portal_access() never supplies it, so no path can future-date a grant.
  assert.equal(existsSync(join(root, 'api/portal/my-access-state.js')), false)
  assert.doesNotMatch(portalApp, /my-access-state/)
  const authz = read('supabase/migrations/20260712000007_phase2_authz_foundation.sql')
  assert.match(authz, /starts_at\s+timestamptz NOT NULL DEFAULT now\(\)/)
  const lifecycle = read('supabase/migrations/20260712000009_phase2_portal_access_lifecycle.sql')
  for (const m of lifecycle.matchAll(/INSERT INTO public\.user_role_grants \(([^)]*)\)/g)) {
    assert.doesNotMatch(m[1], /starts_at/, 'a grant insert that sets starts_at would make pending reachable again')
  }
})

test('access state: no request is made just to render this card', () => {
  // The card is now derived entirely from what the app already holds.
  const notice = portalApp.slice(portalApp.indexOf('function PortalAccessNotice'))
  assert.doesNotMatch(notice, /fetch\(/)
})

// ── Where the portal asks the question ───────────────────────────────────────

test('portal: the deactivated answer is given BEFORE any portal branch', () => {
  // Deactivation leaves a role grant intact, so without this gate a deactivated
  // person resolves to a real portal and is shown a blank one with no
  // explanation (StudentPortal turns the refusal into an empty list).
  const gate = portalApp.indexOf('if (deactivated) return <PortalAccessNotice')
  assert.ok(gate > 0, 'the deactivated gate must exist')
  assert.ok(gate < portalApp.indexOf('const roles = access?.roles || []'))
  for (const portal of ['<StudentPortal', '<UnitLeaderPortal', '<AcademicPartnerPortal']) {
    assert.ok(gate < portalApp.indexOf(portal), `the gate must run before ${portal} can render`)
  }
})

test('portal: a failed access lookup is recorded, not flattened into no-access', () => {
  assert.match(portalApp, /if \(error \|\| !data\) \{ setAccess\(\{ roles: \[\] \}\); setAccessFailed\(true\) \}/)
  assert.match(portalApp, /resolveAccessState\(\{ checkFailed: accessFailed \}\)/)
})

test('portal: the notice renders state-driven copy and keeps Sign out', () => {
  assert.match(portalApp, /function PortalAccessNotice\(\{ state, onRetry \}\)/)
  assert.match(portalApp, /const copy = accessCopy\(state\)/)
  assert.match(portalApp, /onClick=\{signOut\}>Sign out</)
  assert.match(portalApp, /copy\.canRetry && onRetry/)
  assert.match(portalApp, /data-access-state=\{state\}/)
})

// ── The access card carries no illustration ──────────────────────────────────

test('artwork: the no-access card has no image at all', () => {
  const notice = portalApp.slice(portalApp.indexOf('function PortalAccessNotice'))
  assert.doesNotMatch(notice, /<img/, 'five students smiling is the wrong picture for "you have no access"')
  assert.doesNotMatch(notice, /hero\.png|ptl-prepared/)
})

test('artwork: the illustration stays where arriving is the subject', () => {
  // Sign-in keeps it. Removing it everywhere would have been a different, larger
  // decision than the one asked for.
  assert.match(read('src/pages/Login.jsx'), /illustrations\/hero\.png/)
})

test('artwork: the plain card is composed, not just emptied', () => {
  // Its own measure, a title with weight, and a ruled footer, so it reads as
  // designed rather than as a picture that failed to load.
  assert.match(portalCss, /\.ptl-access-card \{ max-width: 408px; padding: 30px 30px 22px; text-align: center; \}/)
  assert.match(portalCss, /\.ptl-access-title \{[\s\S]*?font-weight: 700;/)
  assert.match(portalCss, /\.ptl-access-actions \{[\s\S]*?border-top: 1px solid/)
  assert.match(portalCss, /@media \(max-width: 760px\) \{\n  \.ptl-access-card \{ padding: 26px 22px 20px; \}/)
  assert.match(portalApp, /className="ptl-card ptl-center-card ptl-access-card"/)
})

test('artwork: the shared no-record strip keeps its uncrop', () => {
  // StudentPortal still uses .ptl-prepared-art, so the fix from cd70dc6 must hold.
  const start = portalCss.indexOf('.ptl-prepared-art {')
  const rule = portalCss.slice(start, start + portalCss.slice(start).indexOf('}') + 1)
  assert.doesNotMatch(rule, /height:|overflow:|aspect-ratio:|object-fit:/)
  assert.match(portalCss, /\.ptl-prepared-art img \{ width: 100%; height: auto;/)
})


test('artwork: the bleed cancels the card padding at every breakpoint', () => {
  // A hardcoded -24px matched only the middle of three padding regimes: it left
  // a 2px sliver at 1280px and up, and overhung by 8px per side at 760px and
  // below, where .ptl-prepared's overflow clipped the image horizontally.
  assert.match(portalCss, /\.ptl-prepared-art \{ margin: 0 calc\(var\(--ptl-card-pad-x, 24px\) \* -1\) 18px;/)
  assert.match(portalCss, /padding: 22px 24px;[\s\S]{0,400}--ptl-card-pad-x: 24px;/)
  assert.match(portalCss, /\.ptl-card \{ padding: 24px 26px; --ptl-card-pad-x: 26px; \}/)
  assert.match(portalCss, /\.ptl-card \{ padding: 18px 16px; --ptl-card-pad-x: 16px; \}/)
})

test('artwork: the card still clips the image to its rounded top corners', () => {
  // .ptl-prepared keeps overflow:hidden, which is the job it was actually for.
  assert.match(portalCss, /\.ptl-prepared \{ padding-top: 0; overflow: hidden; \}/)
})
