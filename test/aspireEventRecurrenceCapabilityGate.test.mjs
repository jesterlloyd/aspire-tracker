// ASPIRE event recurrence: server capability gate.
//
// Functional tests drive the exported readiness helpers directly (dependency-injected env + a fake
// service-role client), proving recurrence is enabled ONLY when the server release flag is exactly
// 'true' AND the database capability sentinel returns true, and fails closed otherwise. Source guards
// prove the sentinel is created last, is service_role-only, and that the probe no longer relies on a
// bare column select.
//
// Run: node --test test/aspireEventRecurrenceCapabilityGate.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { recurrenceReleaseEnabled, isRecurrenceReady } from '../api/aspire-events.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const migration = read('supabase/migrations/20260731000000_add_aspire_event_recurrence.sql')
const serverApi = read('api/aspire-events.js')

// Fake service-role clients (only .rpc is exercised).
const dbSentinelTrue  = { rpc: async () => ({ data: true, error: null }) }
const dbSentinelMissing = { rpc: async () => ({ data: null, error: { message: 'function public.aspire_event_recurrence_capability() does not exist' } }) }
const dbSentinelThrows = { rpc: async () => { throw new Error('network down') } }
const ON = { ASPIRE_EVENT_RECURRENCE_ENABLED: 'true' }

// ─── Server release flag ───────────────────────────────────────────────────────

test('release flag: only the exact lowercase string "true" enables', () => {
  assert.equal(recurrenceReleaseEnabled({ ASPIRE_EVENT_RECURRENCE_ENABLED: 'true' }), true)
  assert.equal(recurrenceReleaseEnabled({}), false)                                          // missing
  assert.equal(recurrenceReleaseEnabled({ ASPIRE_EVENT_RECURRENCE_ENABLED: 'false' }), false)
  assert.equal(recurrenceReleaseEnabled({ ASPIRE_EVENT_RECURRENCE_ENABLED: 'TRUE' }), false) // case-sensitive
  assert.equal(recurrenceReleaseEnabled({ ASPIRE_EVENT_RECURRENCE_ENABLED: '1' }), false)
})

// ─── Combined readiness (flag AND sentinel) ────────────────────────────────────

test('readiness: flag off keeps recurrence disabled even if the sentinel is true', async () => {
  assert.equal(await isRecurrenceReady(dbSentinelTrue, {}), false)
  assert.equal(await isRecurrenceReady(dbSentinelTrue, { ASPIRE_EVENT_RECURRENCE_ENABLED: 'false' }), false)
})

test('readiness: flag on but missing sentinel keeps recurrence disabled', async () => {
  assert.equal(await isRecurrenceReady(dbSentinelMissing, ON), false)
})

test('readiness: flag on and sentinel true enables recurrence', async () => {
  assert.equal(await isRecurrenceReady(dbSentinelTrue, ON), true)
})

test('readiness: a throwing probe fails closed', async () => {
  assert.equal(await isRecurrenceReady(dbSentinelThrows, ON), false)
})

test('readiness: the probe calls the sentinel, not a bare column select', () => {
  assert.match(serverApi, /rpc\('aspire_event_recurrence_capability'\)/)
  // The old single-column readiness probe is gone.
  assert.doesNotMatch(serverApi, /select\('recurrence'\)\.limit\(1\)/)
  // The flag is server-only (never exposed with a VITE_ prefix).
  assert.doesNotMatch(serverApi, /VITE_ASPIRE_EVENT_RECURRENCE_ENABLED/)
})

// ─── Fail-closed write behavior (source guards) ────────────────────────────────

test('recurring writes fail closed with 503 while recurrence is disabled', () => {
  assert.match(serverApi, /recurrence_not_enabled/)
  assert.match(serverApi, /503/)
})

test('one-time events still save when recurrence is disabled (fields stripped, not referenced)', () => {
  assert.match(serverApi, /delete row\.recurrence; delete row\.recurrence_end;/)
  assert.match(serverApi, /delete patch\.recurrence; delete patch\.recurrence_end;/)
})

test('occurrences are read-time expansions: the create path inserts exactly one row', () => {
  // No occurrence materialization loop on write.
  assert.match(serverApi, /\.insert\(row\)/)
  assert.doesNotMatch(serverApi, /occurrences?\s*\.\s*(map|forEach)|insert\(\s*rows\s*\)/)
  assert.match(migration, /NO materialized occurrence rows|materializes no occurrence rows/)
})

// ─── Sentinel DDL guards ───────────────────────────────────────────────────────

test('sentinel is created LAST: after every column, constraint, and column comment', () => {
  const createFn = migration.indexOf('CREATE OR REPLACE FUNCTION public.aspire_event_recurrence_capability')
  assert.ok(createFn > 0, 'sentinel function must be created')
  const lastConstraint = migration.lastIndexOf('ADD CONSTRAINT')
  const lastColComment = migration.lastIndexOf('COMMENT ON COLUMN')
  const lastAddColumn = migration.lastIndexOf('ADD COLUMN IF NOT EXISTS')
  const commit = migration.indexOf('\nCOMMIT;')
  assert.ok(createFn > lastConstraint, 'sentinel must come after the last constraint')
  assert.ok(createFn > lastColComment, 'sentinel must come after the last column comment')
  assert.ok(createFn > lastAddColumn, 'sentinel must come after the last column add')
  assert.ok(createFn < commit, 'sentinel must be created inside the transaction (before COMMIT)')
})

test('sentinel is service_role-only with an explicit safe search_path', () => {
  assert.match(migration, /RETURNS boolean/)
  assert.match(migration, /SET search_path = ''/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.aspire_event_recurrence_capability\(\) FROM PUBLIC;/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.aspire_event_recurrence_capability\(\) FROM anon;/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.aspire_event_recurrence_capability\(\) FROM authenticated;/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.aspire_event_recurrence_capability\(\) TO service_role;/)
  // Never granted to PUBLIC / anon / authenticated.
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.aspire_event_recurrence_capability\(\) TO (PUBLIC|anon|authenticated)/)
})
