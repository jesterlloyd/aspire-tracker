// ASPIRE calendar: event-type schema/API parity guard.
//
// The database enforces the accepted event types via CHECK aspire_events_event_type_chk. The
// application enforces the same list in TWO places that cannot share an import (api/ code does not
// resolve src/ imports at the Vercel runtime), so the canonical application list lives in
// src/lib/aspireEvents.js (EVENT_TYPE_VALUES) and is mirrored by api/aspire-events.js (EVENT_TYPES).
//
// This guard proves all THREE agree as sets. It fails if a future application event type is added
// without a matching schema migration (the exact drift that let Birthday reach production and be
// rejected by the database). US holidays stay a computed system overlay and are never a manual type.
//
// Run: node --test test/aspireEventTypeParity.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { EVENT_TYPE_VALUES, ASPIRE_EVENT_TYPES } from '../src/lib/aspireEvents.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const serverApi = read('api/aspire-events.js')
const migration = read('supabase/migrations/20260731010000_add_birthday_event_type.sql')

const sortedUnique = (arr) => [...new Set(arr)].sort()
const hasNoDuplicates = (arr) => new Set(arr).size === arr.length

// The exact final allow-list this fix targets (order-independent; compared as a set).
const CANONICAL = [
  'ngrp_open', 'ngrp_deadline', 'town_hall', 'interview_window', 'orientation',
  'milestone', 'deadline', 'rotation', 'reminder', 'custom', 'birthday',
]

// Server mirror: parse the EVENT_TYPES array literal out of the api source.
const serverTypes = (() => {
  const m = /const EVENT_TYPES\s*=\s*\[([^\]]*)\]/.exec(serverApi)
  assert.ok(m, 'could not locate EVENT_TYPES in api/aspire-events.js')
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1])
})()

// Migration: parse the CHECK (event_type IN (...)) list (the ADD CONSTRAINT one, not the NOT IN preflight).
const migrationTypes = (() => {
  const addIdx = migration.indexOf('ADD CONSTRAINT aspire_events_event_type_chk')
  assert.ok(addIdx > 0, 'could not locate the ADD CONSTRAINT statement')
  const m = /event_type IN \(([^)]*)\)/.exec(migration.slice(addIdx))
  assert.ok(m, 'could not parse the CHECK allow-list')
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1])
})()

// Migration preflight: parse the NOT IN guard list.
const preflightTypes = (() => {
  const m = /event_type NOT IN \(([^)]*)\)/.exec(migration)
  assert.ok(m, 'could not parse the preflight allow-list')
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1])
})()

test('client canonical, server mirror, and migration all match as sets', () => {
  assert.deepEqual(sortedUnique(EVENT_TYPE_VALUES), sortedUnique(CANONICAL), 'client canonical drifted')
  assert.deepEqual(sortedUnique(serverTypes), sortedUnique(CANONICAL), 'server mirror drifted from canonical')
  assert.deepEqual(sortedUnique(migrationTypes), sortedUnique(CANONICAL), 'migration allow-list drifted from canonical')
})

test('migration preflight guard uses the same allow-list as the constraint', () => {
  assert.deepEqual(sortedUnique(preflightTypes), sortedUnique(migrationTypes))
})

test('no allow-list contains duplicate values', () => {
  assert.ok(hasNoDuplicates(EVENT_TYPE_VALUES), 'client list has duplicates')
  assert.ok(hasNoDuplicates(serverTypes), 'server list has duplicates')
  assert.ok(hasNoDuplicates(migrationTypes), 'migration list has duplicates')
})

test('birthday is accepted by client and server validation, lowercase in persistence', () => {
  assert.ok(EVENT_TYPE_VALUES.includes('birthday'))   // client validation
  assert.ok(serverTypes.includes('birthday'))         // server validation
  assert.ok(migrationTypes.includes('birthday'))      // database contract
  const birthday = ASPIRE_EVENT_TYPES.find(t => t.value === 'birthday')
  assert.equal(birthday.value, 'birthday')            // persisted value is lowercase
  assert.equal(birthday.label, 'Birthday')            // UI label
})

test('every pre-existing event type remains accepted (no value dropped)', () => {
  const preBirthday = CANONICAL.filter(v => v !== 'birthday')
  preBirthday.forEach(v => {
    assert.ok(serverTypes.includes(v), `server dropped ${v}`)
    assert.ok(migrationTypes.includes(v), `migration dropped ${v}`)
    assert.ok(EVENT_TYPE_VALUES.includes(v), `client dropped ${v}`)
  })
})

test('US Holiday is not a manually selectable event type', () => {
  const holidayish = /holiday/i
  assert.ok(!EVENT_TYPE_VALUES.some(v => holidayish.test(v)))
  assert.ok(!serverTypes.some(v => holidayish.test(v)))
  assert.ok(!migrationTypes.some(v => holidayish.test(v)))
})
