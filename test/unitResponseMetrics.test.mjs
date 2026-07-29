// At a Glance Placement Capacity: cohort-scoped responded / pending / slot metrics.
//
// The denominator is the EXPLICIT per-cohort outreach-target set (cohort_unit_response_targets), never
// the response rows and never the lazily-created `units` rows. Functional tests drive the pure helper;
// source guards prove OverviewTab reads targets fail-closed (never a false "0 pending") and the
// Owner-gated migration adds the target model without guessing Fall 2026's list.
//
// Run: node --test test/unitResponseMetrics.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { computeUnitResponseMetrics, formatUnitResponseSummary } from '../src/lib/unitResponseMetrics.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const overview = read('src/components/OverviewTab.jsx')
const migration = read('supabase/migrations/20260731030000_add_cohort_unit_response_targets.sql')

const target = (key, over = {}) => ({ unit_key: key, ...over })
const resp = (unit_id, status, slots = 0, over = {}) => ({ unit_id, unit_name: unit_id, response_status: status, slots_offered: slots, ...over })

// ─── Core: targets are the denominator (1, 2) ───────────────────────────────────

test('13 submitted + 10 targets without responses → 13 of 23, 10 pending', () => {
  const targets = []
  for (let i = 0; i < 23; i++) targets.push(target('U' + i))
  const responses = []
  for (let i = 0; i < 13; i++) responses.push(resp('U' + i, i < 10 ? 'submitted_hosting' : 'submitted_not_hosting', i < 10 ? 2 : 0))
  const m = computeUnitResponseMetrics({ targets, responses })
  assert.equal(m.configured, true)
  assert.equal(m.expectedUnitCount, 23)
  assert.equal(m.respondedUnitCount, 13)
  assert.equal(m.pendingUnitCount, 10)
  assert.equal(formatUnitResponseSummary(m), '13 of 23 units responded · 20 slots confirmed · 10 pending')
})

test('13 response rows alone do NOT cap expected at 13 when the target set is larger', () => {
  const responses = []
  for (let i = 0; i < 13; i++) responses.push(resp('U' + i, 'submitted_hosting', 1))
  const targets = []
  for (let i = 0; i < 23; i++) targets.push(target('U' + i))
  const m = computeUnitResponseMetrics({ targets, responses })
  assert.equal(m.expectedUnitCount, 23)     // driven by targets, not by the 13 response rows
  assert.equal(m.pendingUnitCount, 10)
})

// ─── Orphan / no-roster-row / decline (3, 4, 5, 8) ──────────────────────────────

test('a submitted response with no matching target is an orphan: slots yes, responded/pending no', () => {
  const m = computeUnitResponseMetrics({
    targets: [target('A')],
    responses: [resp('A', 'submitted_hosting', 3), resp('ORPHAN', 'submitted_hosting', 9)],
  })
  assert.equal(m.expectedUnitCount, 1)
  assert.equal(m.respondedUnitCount, 1)
  assert.equal(m.pendingUnitCount, 0)
  assert.equal(m.confirmedSlotCount, 12)     // both hosting responses count toward confirmed slots
})

test('a target with no units row (unit_key only) matches its response by name, else is pending', () => {
  // Matched to a response by normalized name (target has no unit_id, response has unit_name).
  const matched = computeUnitResponseMetrics({ targets: [target('6 NE')], responses: [{ unit_name: '6NE', response_status: 'submitted_hosting', slots_offered: 4 }] })
  assert.equal(matched.respondedUnitCount, 1)
  assert.equal(matched.confirmedSlotCount, 4)
  // No response at all → pending, surfaced by name.
  const pend = computeUnitResponseMetrics({ targets: [target('6 NW')], responses: [] })
  assert.equal(pend.pendingUnitCount, 1)
  assert.deepEqual(pend.pendingUnitNames, ['6 NW'])
})

test('an explicit decline (submitted_not_hosting) counts as responded, 0 slots', () => {
  const m = computeUnitResponseMetrics({ targets: [target('A')], responses: [resp('A', 'submitted_not_hosting', 0)] })
  assert.equal(m.respondedUnitCount, 1)
  assert.equal(m.pendingUnitCount, 0)
  assert.equal(m.confirmedSlotCount, 0)
})

test('draft / pending / incomplete responses to a target stay pending', () => {
  for (const status of ['pending', 'draft', 'in_progress', '']) {
    const m = computeUnitResponseMetrics({ targets: [target('A')], responses: [resp('A', status, 9)] })
    assert.equal(m.respondedUnitCount, 0, `"${status}" must not count as responded`)
    assert.equal(m.pendingUnitCount, 1)
  }
})

// ─── Metric depends only on targets+responses, not on units flags (6, 7) ────────

test('pending requires target membership; the metric ignores units.is_participating entirely', () => {
  // A response exists but there is NO target for it → not expected, not pending (it is an orphan).
  const m = computeUnitResponseMetrics({ targets: [], responses: [resp('X', 'submitted_hosting', 5)] })
  assert.equal(m.configured, false)
  assert.equal(m.pendingUnitCount, 0)        // no targets → nothing is "pending" (and we do not claim it)
})

test('a targeted unit that responded stays counted even if its units row would be deactivated', () => {
  // The helper never reads units/is_participating; a submitted response to an active target counts.
  const m = computeUnitResponseMetrics({ targets: [target('A', { unit_id: 'a' })], responses: [resp('a', 'submitted_not_hosting', 0)] })
  assert.equal(m.respondedUnitCount, 1)
})

// ─── Clamps + dedup + isolation (11) ────────────────────────────────────────────

test('responded never exceeds expected; pending never negative; duplicate targets dedup', () => {
  const targets = [target('A'), target('A'), target('B')]   // duplicate A
  const responses = [resp('A', 'submitted_hosting', 1), resp('B', 'submitted_hosting', 1), resp('C', 'submitted_hosting', 1)]
  const m = computeUnitResponseMetrics({ targets, responses })
  assert.equal(m.expectedUnitCount, 2)       // A, B (deduped)
  assert.ok(m.respondedUnitCount <= m.expectedUnitCount)
  assert.equal(m.respondedUnitCount, 2)
  assert.ok(m.pendingUnitCount >= 0)
})

test('duplicate response rows for one unit resolve deterministically (latest wins)', () => {
  const responses = [
    resp('a', 'submitted_not_hosting', 0, { last_updated_at: '2026-01-01T00:00:00Z' }),
    resp('a', 'submitted_hosting', 7, { last_updated_at: '2026-02-01T00:00:00Z' }),
  ]
  const m = computeUnitResponseMetrics({ targets: [target('a', { unit_id: 'a' })], responses })
  assert.equal(m.respondedUnitCount, 1)
  assert.equal(m.confirmedSlotCount, 7)
})

// ─── Empty / unconfigured (10) ──────────────────────────────────────────────────

test('unconfigured cohort (no targets) reports received responses, never a false "0 pending"', () => {
  const responses = []
  for (let i = 0; i < 13; i++) responses.push(resp('U' + i, 'submitted_hosting', i < 10 ? 2 : 0))
  const m = computeUnitResponseMetrics({ targets: [], responses })
  assert.equal(m.configured, false)
  const summary = formatUnitResponseSummary(m)
  assert.match(summary, /response targets not set/)
  assert.doesNotMatch(summary, /pending/)          // never claims a pending count
  assert.doesNotMatch(summary, /of \d+ units responded/) // never claims "13 of 13"
})

// ─── OverviewTab wiring (12 + fail-closed) ──────────────────────────────────────

test('OverviewTab reads explicit targets fail-closed and no longer uses units/rows as the denominator', () => {
  assert.match(overview, /from\('cohort_unit_response_targets'\)/)
  assert.match(overview, /if \(error\) return \[\]/)                    // fail closed to "not set"
  assert.match(overview, /computeUnitResponseMetrics\(\{ targets: unitResponseTargets, responses: unitResponses \}\)/)
  assert.doesNotMatch(overview, /computeUnitResponseMetrics\(\{ units,/) // old units-denominator gone
  assert.match(overview, /if \(unitResponsesError\)/)                   // load/error guard retained
  assert.match(overview, /if \(unitResponsesLoading\)/)
})

// ─── Owner-gated migration (9, 12) ──────────────────────────────────────────────

test('migration adds the target model, unique per (cohort, unit), soft-removable, no auth derivation', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.cohort_unit_response_targets/)
  assert.match(migration, /UNIQUE \(cohort_id, unit_key\)/)
  assert.match(migration, /is_active\s+boolean/)
  assert.match(migration, /removed_at/)
  // Descriptive only: the RLS policy is plain read access, and no policy derives scope from auth tables.
  assert.match(migration, /FOR SELECT TO authenticated/)
  assert.doesNotMatch(migration, /CREATE POLICY[\s\S]*?user_unit_scopes/i)
})

test('migration does NOT guess Fall 2026 targets: no executable INSERT inside the transaction', () => {
  const txn = migration.slice(migration.indexOf('BEGIN;'), migration.indexOf('COMMIT;'))
  assert.doesNotMatch(txn, /INSERT\s+INTO/i)                            // backfill is commented, Owner-run
  // The Fall 2026 cohort id appears only in commented backfill/verification guidance.
  for (const line of migration.split('\n')) {
    if (line.includes('eedd91ec-ad6f-4df8-aa20-5c06b2889011')) {
      assert.match(line.trimStart(), /^--/, `Fall 2026 id must only appear in comments: ${line}`)
    }
  }
})
