// test/freshLoginLandsHome.test.mjs
//
// FRESH-LOGIN-HOME-1: signing in after a sign-out lands on At a Glance.
//
// THE DEFECT. Signing out does not change the URL: App renders <LoginNew /> in place,
// so the browser stays on whatever route you left. Signing back in re-rendered the
// workspace exactly there. The existing reset (AUTH-UX-1B) only fired when a DIFFERENT
// account signed in, which is by design and is why the same-user case slipped through.
//
// TWO HALVES, AND BOTH MATTER:
//   The MARKER decides where a sign-in lands.
//   The CLEARING removes the saved tab, which is read elsewhere. It is not redundant:
//     the tab value is written only by App's switchTab, on a deliberate tab click, so a
//     redirect never rewrites it. Left behind, PortalRoute reads it later and returns
//     the user to a pre-logout tab they never chose this session.
//
// Functional tests for the storage module against a fake localStorage; source
// assertions for the wiring.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const APP = 'src/App.jsx'
const AUTH = 'src/contexts/AuthContext.jsx'
const KEYS = 'src/lib/sessionKeys.js'

// A localStorage stand-in. The module reads the global, so tests install one.
function installStorage(initial = {}, { throwing = false } = {}) {
  const store = new Map(Object.entries(initial))
  globalThis.localStorage = {
    getItem: (k) => { if (throwing) throw new Error('storage unavailable'); return store.has(k) ? store.get(k) : null },
    setItem: (k, v) => { if (throwing) throw new Error('storage unavailable'); store.set(k, String(v)) },
    removeItem: (k) => { if (throwing) throw new Error('storage unavailable'); store.delete(k) },
  }
  return store
}

const {
  lastTabKey, lastNgrpTabKey, aspireCohortKey,
  clearLastLocationOnSignOut, consumeSignedOutMarker, SIGNED_OUT_MARKER_KEY,
} = await import('../src/lib/sessionKeys.js')

// ── The storage module, functionally ─────────────────────────────────────────

test('sign-out forgets WHERE you were and keeps WHAT you work in', () => {
  const store = installStorage({
    [lastTabKey('u1')]: 'profiles',
    [lastNgrpTabKey('u1')]: 'applicants',
    [aspireCohortKey('u1')]: 'cohort-abc',
  })
  clearLastLocationOnSignOut('u1')
  assert.equal(store.get(lastTabKey('u1')), undefined, 'staff tab cleared')
  assert.equal(store.get(lastNgrpTabKey('u1')), undefined, 'NGRP sub-tab cleared')
  // Cohort is scope, not location. Clearing it would re-pick a cohort for someone who
  // had deliberately chosen a different one.
  assert.equal(store.get(aspireCohortKey('u1')), 'cohort-abc', 'cohort SURVIVES')
  assert.equal(store.get(SIGNED_OUT_MARKER_KEY), '1')
})

test('another account on the same browser keeps its own saved tab', () => {
  const store = installStorage({
    [lastTabKey('u1')]: 'profiles',
    [lastTabKey('u2')]: 'interviews',
  })
  clearLastLocationOnSignOut('u1')
  assert.equal(store.get(lastTabKey('u1')), undefined)
  assert.equal(store.get(lastTabKey('u2')), 'interviews', 'only the leaving user is cleared')
})

test('the marker fires exactly once', () => {
  installStorage()
  assert.equal(consumeSignedOutMarker(), false, 'nothing set: not a fresh arrival')
  clearLastLocationOnSignOut('u1')
  assert.equal(consumeSignedOutMarker(), true, 'the sign-in after a sign-out')
  // A later navigation in the same session must not read as a fresh arrival.
  assert.equal(consumeSignedOutMarker(), false, 'consumed on read')
  assert.equal(consumeSignedOutMarker(), false)
})

test('an expired session with no known user still marks the sign-out', () => {
  // SIGNED_OUT can arrive with no id we ever recorded. The per-user cleanup is the tidy
  // half; the marker is the half that decides where the next sign-in lands.
  const store = installStorage()
  clearLastLocationOnSignOut(null)
  assert.equal(store.get(SIGNED_OUT_MARKER_KEY), '1')
  assert.equal(consumeSignedOutMarker(), true)
})

test('unavailable storage never throws through a sign-out', () => {
  // Private mode or blocked site data. A sign-out must complete regardless.
  installStorage({}, { throwing: true })
  assert.doesNotThrow(() => clearLastLocationOnSignOut('u1'))
  assert.equal(consumeSignedOutMarker(), false, 'and degrades to "not a fresh arrival"')
})

// ── The wiring ───────────────────────────────────────────────────────────────

test('sign-out clears through the shared module, on the event not just the button', () => {
  const auth = read(AUTH)
  // The EVENT, so an expired session counts the same as pressing Sign Out.
  const signedOut = auth.slice(auth.indexOf("event === 'SIGNED_OUT'"), auth.indexOf("event === 'TOKEN_REFRESHED'"))
  assert.ok(signedOut.length > 0, 'SIGNED_OUT branch not found')
  assert.match(signedOut, /clearLastLocationOnSignOut\(currentUserIdRef\.current\)/)
  // The id comes from a ref: the handler is registered with [] deps so it would close
  // over a stale user, and the event's own session is null exactly when we need to know
  // who just left.
  assert.match(auth, /const currentUserIdRef = useRef\(null\)/)
  // Every path that establishes a user populates it, including a RESTORED session.
  const setUserCalls = (auth.match(/setUser\(session\.user\)/g) || []).length
  const refSets = (auth.match(/currentUserIdRef\.current = session\.user\.id/g) || []).length
  assert.equal(refSets, setUserCalls, 'every setUser(session.user) sets the ref too')
})

test('the sign-in landing consumes the marker unconditionally', () => {
  const app = read(APP)
  const effect = app.slice(app.indexOf('// Where a SIGN-IN lands.'), app.indexOf('const [profilesView'))
  assert.ok(effect.length > 0, 'landing effect not found')
  // Consumed before the branch: a marker left set would fire on some later render.
  const consumeAt = effect.indexOf('consumeSignedOutMarker()')
  const branchAt = effect.indexOf('if (differentUser || afterSignOut)')
  assert.ok(consumeAt > 0 && branchAt > consumeAt, 'consume must precede the branch')
  assert.match(effect, /navigate\('\/aggregate', \{ replace: true \}\)/)
  // AUTH-UX-1B still fires for a different account.
  assert.match(effect, /const differentUser = Boolean\(prevAuthId\) && prevAuthId !== user\.id/)
})

test('only a record-naming URL survives a sign-in', () => {
  const app = read(APP)
  const effect = app.slice(app.indexOf('// Where a SIGN-IN lands.'), app.indexOf('const [profilesView'))
  assert.match(effect, /new URLSearchParams\(location\.search\)\.has\('student'\)/)
  assert.match(effect, /if \(!linkedToRecord\) navigate/)
  // A PATH is never a deep link: /connect, /settings/accounts and /rotation/matrix are
  // places you were, which is the whole complaint.
  assert.doesNotMatch(effect, /pathname\.startsWith|pathname ===/)
})

test('a live-session refresh is not a sign-in, and Connect-and-back still restores', () => {
  const app = read(APP)
  const effect = app.slice(app.indexOf('// Where a SIGN-IN lands.'), app.indexOf('const [profilesView'))
  // Neither trigger matches a refresh: the marker was consumed at the last sign-in and
  // the id is unchanged, so the route is left alone.
  assert.match(effect, /if \(!user\?\.id\) return/)
  // The in-session restore is a DIFFERENT effect keyed on pathname '/', untouched here.
  assert.match(app, /if \(location\.pathname === '\/'\) \{[\s\S]{0,400}localStorage\.getItem\(lastTabKey\(user\.id\)\)/)
})

test('the keys have one owner, and it says what sign-out keeps', () => {
  const keys = read(KEYS)
  for (const k of ['lastTabKey', 'lastNgrpTabKey', 'aspireCohortKey', 'LAST_AUTH_USER_KEY']) {
    assert.match(keys, new RegExp(`export const ${k}`), k)
  }
  // App must not redefine them alongside the module.
  const app = read(APP)
  assert.doesNotMatch(app, /const lastTabKey = |const lastNgrpTabKey = |const aspireCohortKey = /)
  assert.match(app, /from '\.\/lib\/sessionKeys'/)
  // Cohort is documented as deliberately kept, so a future reader does not "fix" it.
  assert.match(keys, /Deliberately NOT cleared on sign-out/)
})

// ── House style ──────────────────────────────────────────────────────────────

test('no em dash in anything this change added', () => {
  // The character below is the em dash, written as an escape so this file has none.
  const EM = String.fromCharCode(0x2014)
  assert.ok(!read(KEYS).includes(EM), 'sessionKeys.js contains an em dash')
})
