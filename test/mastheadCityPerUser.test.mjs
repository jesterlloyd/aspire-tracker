// MASTHEAD-CITY-PER-USER-1: the chosen masthead city is per SIGNED-IN USER, not
// per browser.
//
// Shared workstations are normal on a unit. Under the old flat key the next
// person to sign in inherited whoever last used the machine: they could change
// it, but it was not theirs. These tests are the guarantee that two accounts on
// one browser cannot see each other's choice.
//
// Run: node --test test/mastheadCityPerUser.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mastheadCityKey, LEGACY_MASTHEAD_CITY_KEY } from '../src/lib/sessionKeys.js'
import { AUTO, readCityPreference, writeCityPreference } from '../src/lib/mastheadCityPreference.js'

const here = dirname(fileURLToPath(import.meta.url))

// Node has no localStorage, so the module talks to this. It is deliberately a
// plain map with the real API shape rather than a mock that records calls: what
// matters is what ends up stored, not which methods were reached.
function installStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: k => { store.delete(k) },
  }
  return store
}

const ALICE = '11111111-1111-4111-8111-111111111111'
const BOB = '22222222-2222-4222-8222-222222222222'

test('two accounts on one browser cannot see each other\'s city', () => {
  installStorage()
  writeCityPreference(ALICE, 'newyork')
  writeCityPreference(BOB, 'lasvegas')
  assert.equal(readCityPreference(ALICE), 'newyork')
  assert.equal(readCityPreference(BOB), 'lasvegas')
  // And an account that never chose is Automatic, not whatever the last one picked.
  assert.equal(readCityPreference('33333333-3333-4333-8333-333333333333'), AUTO)
})

test('the signed-out bucket is separate from every signed-in user', () => {
  installStorage()
  writeCityPreference(null, 'atlanta')
  assert.equal(readCityPreference(null), 'atlanta')
  assert.equal(readCityPreference(ALICE), AUTO, 'a signed-in user must not inherit the anonymous card')
})

test('the key carries the user id, and anonymous is its own bucket', () => {
  assert.equal(mastheadCityKey(ALICE), `aspire:mastheadCity:${ALICE}`)
  assert.equal(mastheadCityKey(null), 'aspire:mastheadCity:anon')
  assert.equal(mastheadCityKey(undefined), 'aspire:mastheadCity:anon')
  assert.notEqual(mastheadCityKey(ALICE), mastheadCityKey(BOB))
})

test('a pre-namespacing choice is adopted once, then never seen again', () => {
  const store = installStorage({ [LEGACY_MASTHEAD_CITY_KEY]: 'sanfrancisco' })
  // The first account to read after the change keeps the machine's old choice.
  assert.equal(readCityPreference(ALICE), 'sanfrancisco')
  assert.equal(store.get(mastheadCityKey(ALICE)), 'sanfrancisco')
  // And the legacy key is gone, so the next person starts clean.
  assert.equal(store.has(LEGACY_MASTHEAD_CITY_KEY), false)
  assert.equal(readCityPreference(BOB), AUTO, 'the second account must not inherit the migration')
})

test('a user\'s own choice always beats a leftover legacy value', () => {
  installStorage({ [LEGACY_MASTHEAD_CITY_KEY]: 'sanfrancisco' })
  writeCityPreference(ALICE, 'atlanta')
  assert.equal(readCityPreference(ALICE), 'atlanta')
})

test('automatic clears the key rather than storing a sentinel', () => {
  const store = installStorage()
  writeCityPreference(ALICE, 'newyork')
  writeCityPreference(ALICE, AUTO)
  assert.equal(store.has(mastheadCityKey(ALICE)), false)
  assert.equal(readCityPreference(ALICE), AUTO)
  // An empty choice is the same instruction as Automatic.
  writeCityPreference(ALICE, 'newyork')
  writeCityPreference(ALICE, null)
  assert.equal(store.has(mastheadCityKey(ALICE)), false)
})

test('unavailable storage degrades to automatic instead of throwing', () => {
  // Private mode and blocked site data both throw on access. A masthead must
  // still render; it simply does not remember.
  globalThis.localStorage = {
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('blocked') },
    removeItem() { throw new Error('blocked') },
  }
  assert.equal(readCityPreference(ALICE), AUTO)
  assert.doesNotThrow(() => writeCityPreference(ALICE, 'newyork'))
})

test('nothing sends the city to a server', () => {
  // The whole reason one viewer's choice cannot reach another is that it never
  // leaves the browser. If this module ever gains a fetch or a Supabase call,
  // that guarantee is gone and this test is what says so.
  const src = readFileSync(join(here, '..', 'src/lib/mastheadCityPreference.js'), 'utf8')
  assert.doesNotMatch(src, /fetch\(|supabase|\/api\//)
})

test('the hook reads the id from AuthContext and re-reads when it changes', () => {
  // The shared-workstation case: signing out and in as someone else need not
  // remount the hook, so without the userId effect the new viewer would keep
  // looking at the previous viewer's city until something forced a reload.
  const hook = readFileSync(join(here, '..', 'src/components/masthead/useCityPreference.js'), 'utf8')
  assert.match(hook, /useAuth\(\)/)
  assert.match(hook, /readCityPreference\(userId\)/)
  // The account change is handled during render, not in an effect: an effect
  // sets state after paint, so the new viewer would see the previous viewer's
  // city for a frame. Both halves are asserted - noticing the change, and
  // re-reading on it - because either alone silently does nothing.
  assert.match(hook, /seenUser !== userId/, 'the hook must notice the account changing')
  assert.match(hook, /setSeenUser\(userId\)[\s\S]{0,80}setCity\(readCityPreference\(userId\)\)/,
    'noticing the change must actually re-read the new user\'s city')
  // The cross-tab listener still has to be rebound when the account changes.
  assert.match(hook, /\}, \[userId\]\)/, 'the storage subscription must depend on userId')
  assert.match(hook, /writeCityPreference\(userId,/)
})
