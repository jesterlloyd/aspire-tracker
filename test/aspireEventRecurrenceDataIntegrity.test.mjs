// ASPIRE event recurrence: database-level data integrity.
//
// These are DDL-contract guards on the Owner-gated migration. The table has no CREATE TABLE in the
// repo and this branch runs no SQL, so integrity is proven by asserting the migration encodes each
// rule the database must enforce (cadence allow-list; recurrence_end consistency vs the canonical
// UTC start date) using an idempotent replace pattern, not a name-only check.
//
// Run: node --test test/aspireEventRecurrenceDataIntegrity.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const migration = read('supabase/migrations/20260731000000_add_aspire_event_recurrence.sql')

// Collapse whitespace so multi-line CHECK bodies can be matched as single expressions.
const flat = migration.replace(/\s+/g, ' ')

test('columns are additive and default existing rows to a one-time event', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'none'/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS recurrence_end date/)
})

test('cadence allow-list is enforced and applied as an idempotent replace', () => {
  assert.match(migration, /DROP CONSTRAINT IF EXISTS chk_aspire_events_recurrence\b/)
  assert.match(flat, /ADD CONSTRAINT chk_aspire_events_recurrence CHECK \(recurrence IN \('none', 'weekly', 'monthly', 'annually'\)\)/)
})

test('recurrence_end consistency is a database constraint, applied as an idempotent replace', () => {
  assert.match(migration, /DROP CONSTRAINT IF EXISTS chk_aspire_events_recurrence_end\b/)
  assert.match(migration, /ADD CONSTRAINT chk_aspire_events_recurrence_end/)
})

test('DB rejects recurrence_end on a one-time event', () => {
  // recurrence = 'none' requires recurrence_end IS NULL.
  assert.match(flat, /\(recurrence = 'none' AND recurrence_end IS NULL\)/)
})

test('DB rejects recurrence_end before the start, but allows an indefinite (NULL) end', () => {
  // recurring branch: NULL end (indefinite) OR end >= start.
  assert.match(flat, /recurrence <> 'none' AND \( recurrence_end IS NULL OR recurrence_end >= /)
})

test('start comparison uses the immutable UTC start date, not a session-timezone cast', () => {
  // Matches the API contract new Date(start_at).toISOString().slice(0,10); IMMUTABLE => valid in CHECK.
  assert.match(migration, /\(start_at AT TIME ZONE 'UTC'\)::date/)
  // A bare session-timezone cast of the timestamp must NOT be used for the comparison.
  assert.doesNotMatch(migration, /recurrence_end >= start_at::date/)
})

test('migration is wrapped in a single transaction', () => {
  assert.match(migration, /^BEGIN;/m)
  assert.match(migration, /^COMMIT;/m)
})
