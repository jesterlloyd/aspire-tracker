// At a Glance Placement Capacity: cohort-scoped responded / pending / slot metrics.
//
// The denominator is the EXPLICIT per-cohort outreach-target set. Functional tests drive the pure
// helper (targets ⋈ responses by canonical unit identity: unit_id first, else canonical key; orphans
// excluded from configured metrics and surfaced; ambiguous matches fail closed). Source guards prove
// OverviewTab reads targets via the authorized API and exposes an accessible pending list.
//
// Run: node --test test/unitResponseMetrics.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { computeUnitResponseMetrics, formatUnitResponseSummary } from '../src/lib/unitResponseMetrics.js'
import { canonicalUnitKey } from '../src/lib/canonicalUnit.js'

const here = dirname(fileURLToPath(import.meta.url))
const overview = readFileSync(join(here, '..', 'src/components/OverviewTab.jsx'), 'utf8')

const target = (key, over = {}) => ({ unit_key: key, unit_name: key, ...over })
const resp = (unit_id, status, slots = 0, over = {}) => ({ unit_id, unit_name: unit_id, response_status: status, slots_offered: slots, ...over })

// ─── Denominator is targets (1) ─────────────────────────────────────────────────

test('23 targets, 13 responses, 10 missing → 13 of 23, 10 pending', () => {
  const targets = []; for (let i = 0; i < 23; i++) targets.push(target('U' + i))
  const responses = []; for (let i = 0; i < 13; i++) responses.push(resp('U' + i, i < 10 ? 'submitted_hosting' : 'submitted_not_hosting', i < 10 ? 2 : 0))
  const m = computeUnitResponseMetrics({ targets, responses })
  assert.equal(m.expectedUnitCount, 23)
  assert.equal(m.respondedUnitCount, 13)
  assert.equal(m.pendingUnitCount, 10)
  assert.equal(formatUnitResponseSummary(m), '13 of 23 units responded · 20 slots confirmed · 10 pending')
})

// ─── No units row / canonical match (2, 3) ──────────────────────────────────────

test('a target with no units row matches its response by canonical key, else is pending', () => {
  const matched = computeUnitResponseMetrics({ targets: [target('6 NE')], responses: [{ unit_id: 'x', unit_name: '6NE', response_status: 'submitted_hosting', slots_offered: 4 }] })
  assert.equal(matched.respondedUnitCount, 1)
  assert.equal(matched.confirmedSlotCount, 4)
  const pend = computeUnitResponseMetrics({ targets: [target('6 NW')], responses: [] })
  assert.equal(pend.pendingUnitCount, 1)
  assert.deepEqual(pend.pendingUnitNames, ['6 NW'])
})

test('canonical matching ignores spacing/punctuation/case (alias collapses to one target)', () => {
  assert.equal(canonicalUnitKey('6 NE'), canonicalUnitKey('6ne'))
  const m = computeUnitResponseMetrics({ targets: [target('6 NE'), target('6-N-E')], responses: [resp('u', 'submitted_hosting', 1, { unit_name: '6NE' })] })
  assert.equal(m.expectedUnitCount, 1)            // duplicate alias targets collapse
  assert.equal(m.respondedUnitCount, 1)
})

// ─── Ambiguity fails closed (4) ─────────────────────────────────────────────────

test('an ambiguous canonical match (two responses, same key) fails closed with a warning', () => {
  const m = computeUnitResponseMetrics({
    targets: [target('6 NE')],
    responses: [resp('a', 'submitted_hosting', 1, { unit_name: '6NE' }), resp('b', 'submitted_hosting', 2, { unit_name: '6-NE' })],
  })
  assert.equal(m.respondedUnitCount, 0)           // not attributed
  assert.equal(m.pendingUnitCount, 1)
  assert.ok(m.dataQualityWarnings.some(w => /Ambiguous/.test(w)))
})

// ─── Declines, targeted slots, orphans (5, 6, 7, 8) ─────────────────────────────

test('declines count as responded; only targeted hosting slots count; orphans are surfaced', () => {
  const targets = [target('A'), target('B'), target('C')]
  const responses = [
    resp('A', 'submitted_hosting', 5),
    resp('B', 'submitted_not_hosting', 0),          // decline → responded, 0 slots
    resp('ORPHAN', 'submitted_hosting', 9),         // not a target → orphan
  ]
  const m = computeUnitResponseMetrics({ targets, responses })
  assert.equal(m.respondedUnitCount, 2)
  assert.equal(m.pendingUnitCount, 1)               // C pending
  assert.equal(m.confirmedSlotCount, 5)             // orphan's 9 slots NOT in configured slots
  assert.equal(m.orphanResponseCount, 1)
  assert.deepEqual(m.orphanUnitNames, ['ORPHAN'])
})

// ─── Unconfigured fallback (9) ──────────────────────────────────────────────────

test('unconfigured cohort (no targets) reports received responses, never a false "0 pending"', () => {
  const responses = []; for (let i = 0; i < 13; i++) responses.push(resp('U' + i, 'submitted_hosting', i < 10 ? 2 : 0))
  const m = computeUnitResponseMetrics({ targets: [], responses })
  assert.equal(m.configured, false)
  const summary = formatUnitResponseSummary(m)
  assert.match(summary, /13 unit responses received · 20 slots confirmed · response targets not set/)
  assert.doesNotMatch(summary, /pending/)
  assert.doesNotMatch(summary, /of \d+ units responded/)
})

// ─── Clamps + cohort isolation (12, 13, 19) ─────────────────────────────────────

test('responded never exceeds expected; pending never negative; inputs are per-cohort', () => {
  const m = computeUnitResponseMetrics({ targets: [target('A'), target('B')], responses: [resp('A', 'submitted_hosting', 1), resp('B', 'submitted_hosting', 1), resp('Z', 'submitted_hosting', 1)] })
  assert.ok(m.respondedUnitCount <= m.expectedUnitCount)
  assert.equal(m.respondedUnitCount, 2)
  assert.ok(m.pendingUnitCount >= 0)
  assert.equal(m.orphanResponseCount, 1)            // Z is an orphan (isolation: only targets count)
})

// ─── OverviewTab wiring + accessibility (17) ────────────────────────────────────

test('OverviewTab reads targets via the authorized API, not direct table access', () => {
  assert.match(overview, /listCohortResponseTargets\(cohortId\)/)
  assert.doesNotMatch(overview, /from\('cohort_unit_response_targets'\)/)  // never a direct browser read
  assert.match(overview, /computeUnitResponseMetrics\(\{ targets: unitResponseTargets, responses: unitResponses \}\)/)
})

test('OverviewTab exposes an accessible pending list and a staff-only send action', () => {
  assert.match(overview, /aria-expanded=\{pendingListOpen\}/)
  assert.match(overview, /aria-controls="ov-pending-units"/)
  assert.match(overview, /isAdmin && \(/)                                   // send action is staff-only
  // ASPIRE-DESIGN-CORRECTION-1: the card carries the real send button; the manual configure
  // fallback and inline orphan lists are no longer surfaced on At a Glance (the orphan data stays
  // available in computeUnitResponseMetrics for admin surfaces).
  assert.match(overview, /Send Capacity Request/)
  assert.doesNotMatch(overview, /Configure response targets/)
  assert.doesNotMatch(overview, /orphanUnitNames/)
})
