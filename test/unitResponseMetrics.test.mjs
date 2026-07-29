// At a Glance Placement Capacity: cohort-scoped unit response / pending / slot metrics.
//
// Functional tests drive the pure helper (src/lib/unitResponseMetrics.js), including the reported
// Fall 2026 defect (units with no response row were invisible, so the summary read "N of N, 0
// pending"). Source guards prove OverviewTab uses the shared helper, dropped the row-count denominator,
// and guards loading/error so it never flashes a false "0 pending".
//
// Run: node --test test/unitResponseMetrics.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { computeUnitResponseMetrics, formatUnitResponseSummary } from '../src/lib/unitResponseMetrics.js'

const here = dirname(fileURLToPath(import.meta.url))
const overview = readFileSync(join(here, '..', 'src/components/OverviewTab.jsx'), 'utf8')

const unit = (id, over = {}) => ({ id, unit_name: id, is_participating: true, ...over })
const resp = (unit_id, status, slots = 0, over = {}) => ({ unit_id, response_status: status, slots_offered: slots, ...over })

// ─── Core defect + join semantics (1, 2, 15) ────────────────────────────────────

test('13 responded + 10 rostered no-row units → responded 13, expected 23, pending 10', () => {
  const units = []
  for (let i = 0; i < 13; i++) units.push(unit('h' + i))
  for (let i = 0; i < 10; i++) units.push(unit('p' + i))        // rostered, no response row
  const responses = units.slice(0, 13).map((u, i) => resp(u.id, 'submitted_hosting', i < 4 ? 5 : 0))
  const m = computeUnitResponseMetrics({ units, responses })
  assert.equal(m.respondedUnitCount, 13)
  assert.equal(m.expectedUnitCount, 23)
  assert.equal(m.pendingUnitCount, 10)
  // The Fall 2026 fixture: the OLD code showed "13 of 13 ... 0 pending"; the fix shows the truth.
  assert.equal(formatUnitResponseSummary(m), '13 of 23 units responded · 20 slots confirmed · 10 pending')
})

test('a rostered unit with no response survives the join and is pending', () => {
  const m = computeUnitResponseMetrics({ units: [unit('a'), unit('b')], responses: [resp('a', 'submitted_hosting', 3)] })
  assert.equal(m.expectedUnitCount, 2)
  assert.equal(m.respondedUnitCount, 1)
  assert.deepEqual(m.pendingUnitIds, ['b'])
})

// ─── Responded semantics (3, 4, 5) ──────────────────────────────────────────────

test('a zero-slot submitted (not hosting) response counts as responded, contributes 0 slots', () => {
  const m = computeUnitResponseMetrics({ units: [unit('a')], responses: [resp('a', 'submitted_not_hosting', 0)] })
  assert.equal(m.respondedUnitCount, 1)
  assert.equal(m.pendingUnitCount, 0)
  assert.equal(m.confirmedSlotCount, 0)
})

test('an explicit decline (submitted_not_hosting) counts as responded even when is_participating is false', () => {
  const m = computeUnitResponseMetrics({ units: [unit('a', { is_participating: false })], responses: [resp('a', 'submitted_not_hosting', 0)] })
  assert.equal(m.expectedUnitCount, 1)   // still expected: it has a response row
  assert.equal(m.respondedUnitCount, 1)
})

test('draft / pending / incomplete states do not count as responded', () => {
  for (const status of ['pending', 'draft', 'in_progress', '']) {
    const m = computeUnitResponseMetrics({ units: [unit('a')], responses: [resp('a', status, 9)] })
    assert.equal(m.respondedUnitCount, 0, `status "${status}" must not count as responded`)
    assert.equal(m.pendingUnitCount, 1)
    assert.equal(m.confirmedSlotCount, 0)
  }
})

// ─── Duplicate / superseded (6, 7, 8) ───────────────────────────────────────────

test('duplicate response rows for one unit resolve deterministically (latest wins, counted once)', () => {
  const responses = [
    resp('a', 'submitted_not_hosting', 0, { last_updated_at: '2026-01-01T00:00:00Z' }),
    resp('a', 'submitted_hosting', 7, { last_updated_at: '2026-02-01T00:00:00Z' }),  // newer
  ]
  const m = computeUnitResponseMetrics({ units: [unit('a')], responses })
  assert.equal(m.respondedUnitCount, 1)          // counted once
  assert.equal(m.confirmedSlotCount, 7)          // latest row's slots
})

test('duplicate unit entries (same id / alias) do not double-count', () => {
  const units = [unit('a', { unit_name: '6 NE' }), unit('a', { unit_name: '6NE' })]  // same canonical id
  const m = computeUnitResponseMetrics({ units, responses: [resp('a', 'submitted_hosting', 4)] })
  assert.equal(m.expectedUnitCount, 1)
  assert.equal(m.respondedUnitCount, 1)
})

// ─── Slots (9) ──────────────────────────────────────────────────────────────────

test('confirmed slots sum only hosting responses of expected units; never negative', () => {
  const units = [unit('a'), unit('b'), unit('c')]
  const responses = [
    resp('a', 'submitted_hosting', 5),
    resp('b', 'submitted_not_hosting', 0),      // decline → 0
    resp('c', 'submitted_hosting', -3),         // malformed → clamped to 0
  ]
  const m = computeUnitResponseMetrics({ units, responses })
  assert.equal(m.confirmedSlotCount, 5)
  assert.ok(m.confirmedSlotCount >= 0)
})

// ─── Cross-cohort / orphan isolation + clamps (10, 11, 12, 13) ──────────────────

test('responses for units not in the expected set are ignored (no cross-cohort/orphan leakage)', () => {
  const m = computeUnitResponseMetrics({
    units: [unit('a')],
    responses: [resp('a', 'submitted_hosting', 2), resp('other-cohort-unit', 'submitted_hosting', 99)],
  })
  assert.equal(m.expectedUnitCount, 1)
  assert.equal(m.respondedUnitCount, 1)
  assert.equal(m.confirmedSlotCount, 2)          // the orphan's 99 slots are not counted
})

test('responded never exceeds expected and pending never goes negative', () => {
  // Two expected units, three responses (one orphan) → responded capped at expected, pending >= 0.
  const m = computeUnitResponseMetrics({
    units: [unit('a'), unit('b')],
    responses: [resp('a', 'submitted_hosting', 1), resp('b', 'submitted_hosting', 1), resp('z', 'submitted_hosting', 1)],
  })
  assert.ok(m.respondedUnitCount <= m.expectedUnitCount)
  assert.equal(m.respondedUnitCount, 2)
  assert.ok(m.pendingUnitCount >= 0)
  assert.equal(m.pendingUnitCount, 0)
})

// ─── Empty + no-regression (14, 16, 20) ─────────────────────────────────────────

test('zero expected units yields the empty state, not "0 of 0"', () => {
  const m = computeUnitResponseMetrics({ units: [], responses: [] })
  assert.equal(m.expectedUnitCount, 0)
  assert.equal(formatUnitResponseSummary(m), 'No unit response requests are configured for this cohort.')
})

test('the same pure logic serves any cohort fixture (fully responded → 0 pending, no regression)', () => {
  const units = [unit('a'), unit('b'), unit('c')]
  const responses = [resp('a', 'submitted_hosting', 2), resp('b', 'submitted_hosting', 3), resp('c', 'submitted_not_hosting', 0)]
  const m = computeUnitResponseMetrics({ units, responses })
  assert.equal(m.expectedUnitCount, 3)
  assert.equal(m.respondedUnitCount, 3)
  assert.equal(m.pendingUnitCount, 0)
  assert.equal(formatUnitResponseSummary(m), '3 of 3 units responded · 5 slots confirmed · 0 pending')
})

// ─── OverviewTab wiring (15, 17, 18, 19) ────────────────────────────────────────

test('OverviewTab uses the shared helper and dropped the response-row denominator', () => {
  assert.match(overview, /computeUnitResponseMetrics\(\{ units, responses: unitResponses \}\)/)
  assert.match(overview, /formatUnitResponseSummary\(/)
  // The old buggy formula is gone.
  assert.doesNotMatch(overview, /unitResponses\.length > 0 \? responded : participating\.length/)
  assert.doesNotMatch(overview, /const total\s+= unitResponses\.length > 0 \? unitResponses\.length/)
})

test('OverviewTab guards loading/error so it never shows a false "0 pending"', () => {
  assert.match(overview, /if \(unitResponsesError\) return/)
  assert.match(overview, /if \(unitResponsesLoading\) return/)
})

test('the metric helper is display-only: no auth, scope, or supabase coupling', () => {
  const helper = readFileSync(join(here, '..', 'src/lib/unitResponseMetrics.js'), 'utf8')
  assert.doesNotMatch(helper, /supabase|user_unit_scopes|auth|POLICY|GRANT/i)
})
