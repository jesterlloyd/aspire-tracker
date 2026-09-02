// NGRP-PLACEMENT-BOARD-1: Unit Pool | Applicant Pool.
//
// ONE RULE ABOVE ALL OTHERS, and the plan states it outright (section 147):
// "HR-assigned unit only; never substitute a ranked preference". A preference is
// what the applicant asked for on their Transition Form; the assignment is what
// HR decided. The board shows both and lets neither imply the other.
//
// The second rule is that only a CONFIRMED applicant is placeable. A submitted
// form and an eligible result are not an application, and assigning a unit to
// someone who never applied records a decision against a person who did not ask
// for one.
//
// Run: node --test test/ngrpPlacementBoard.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  placeableRows, preferencesOf, assignedRank, unitPool, placementSummary, orderApplicants,
  preferenceCounts, topChoicePct, preferenceRankFor, orderForFocus,
} from '../src/lib/ngrp/ngrpPlacement.js'
import { isMissingNgrpColumn, isMissingNgrpSchema } from '../lib/server/ngrpApplicants.js'
import { NGRP_AUDIT_EVENTS } from '../lib/server/ngrpAudit.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')
const board = read('src/components/ngrp/PlacementBoard.jsx')
const manageApi = read('api/ngrp-manage.js')
const migration = read('supabase/migrations/20260906000000_ngrp_assignment_interview.sql')
const workspace = read('src/components/ngrp/NgrpWorkspace.jsx')

const UNITS = [
  { unit_name: '5 SCCT', is_active: true, capacity: 2 },
  { unit_name: '6 NT', is_active: true, capacity: 1 },
  { unit_name: 'NICU', is_active: false, capacity: 5 },
]
const row = (o) => ({ application_status: 'confirmed', assigned_unit: null, ...o })

// ── Who is on the board ──────────────────────────────────────────────────────

test('only confirmed applicants are placeable', () => {
  const rows = [
    row({ id: 'a' }),
    row({ id: 'b', application_status: 'not_confirmed' }),
    row({ id: 'c', application_status: 'withdrawn' }),
  ]
  assert.deepEqual(placeableRows(rows).map(r => r.id), ['a'])
  // A submitted form and an eligible result are NOT an application.
  const eligibleButUnconfirmed = row({ id: 'd', application_status: 'not_confirmed', form_status: 'submitted', eligibility_calculated: 'eligible' })
  assert.deepEqual(placeableRows([eligibleButUnconfirmed]), [])
})

// ── A preference is not an assignment ────────────────────────────────────────

test('preferences are compacted and de-duplicated, never invented', () => {
  assert.deepEqual(preferencesOf({ unit_preference_1: '5 SCCT', unit_preference_2: '6 NT', unit_preference_3: '7 SCCT' }), ['5 SCCT', '6 NT', '7 SCCT'])
  // A blank rank is dropped, not rendered as an empty slot.
  assert.deepEqual(preferencesOf({ unit_preference_1: '5 SCCT', unit_preference_2: '  ', unit_preference_3: '6 NT' }), ['5 SCCT', '6 NT'])
  // The same unit ranked twice is one preference.
  assert.deepEqual(preferencesOf({ unit_preference_1: '5 SCCT', unit_preference_2: '5 scct' }), ['5 SCCT'])
  assert.deepEqual(preferencesOf({}), [])
  assert.deepEqual(preferencesOf(null), [])
})

test('the board records WHICH preference was granted, including none', () => {
  const r = { assigned_unit: '6 NT', unit_preference_1: '5 SCCT', unit_preference_2: '6 NT' }
  assert.equal(assignedRank(r), 2)
  assert.equal(assignedRank({ ...r, assigned_unit: '5 SCCT' }), 1)
  // HR assigning a unit the applicant did not rank is LEGITIMATE, not an error.
  // 0 says "assigned, off their list", which the board shows rather than hides.
  assert.equal(assignedRank({ ...r, assigned_unit: 'PACU' }), 0)
  // Unassigned is null, which is not the same as 0.
  assert.equal(assignedRank({ ...r, assigned_unit: null }), null)
  // Case never decides whether a preference was honoured.
  assert.equal(assignedRank({ assigned_unit: '5 scct', unit_preference_1: '5 SCCT' }), 1)
})

// ── Unit Pool ────────────────────────────────────────────────────────────────

test('the Unit Pool counts only active units, and counts them honestly', () => {
  const rows = [
    row({ id: 'a', assigned_unit: '5 SCCT', unit_preference_1: '5 SCCT' }),
    row({ id: 'b', assigned_unit: '5 SCCT', unit_preference_1: '6 NT' }),
    row({ id: 'c', unit_preference_1: '6 NT' }),
    row({ id: 'd', application_status: 'not_confirmed', assigned_unit: '6 NT' }),
  ]
  const pool = unitPool(UNITS, rows)
  // NICU is inactive: the form never offered it, so nobody could rank it.
  assert.deepEqual(pool.map(u => u.unit_name), ['5 SCCT', '6 NT'])
  const scct = pool.find(u => u.unit_name === '5 SCCT')
  assert.deepEqual([scct.seats, scct.assigned, scct.remaining, scct.over], [2, 2, 0, false])
  const nt = pool.find(u => u.unit_name === '6 NT')
  // 'd' is unconfirmed, so their stale assignment does not fill a seat.
  assert.equal(nt.assigned, 0)
  // Three confirmed applicants ranked 6 NT anywhere... two did.
  assert.equal(nt.requested, 2)
})

test('over capacity is reported, not silently absorbed', () => {
  const rows = [
    row({ id: 'a', assigned_unit: '6 NT' }),
    row({ id: 'b', assigned_unit: '6 NT' }),
  ]
  const nt = unitPool(UNITS, rows).find(u => u.unit_name === '6 NT')
  assert.equal(nt.over, true)
  assert.equal(nt.remaining, -1)
  assert.deepEqual(placementSummary(UNITS, rows).overSubscribed, ['6 NT'])
})

test('a unit with no number set reports unknown, never zero remaining', () => {
  const units = [{ unit_name: 'A', is_active: true, capacity: null }]
  const u = unitPool(units, [row({ id: 'a', assigned_unit: 'A' })])[0]
  assert.equal(u.seats, null)
  assert.equal(u.remaining, null, 'unknown, not full')
  assert.equal(u.over, false, 'cannot be over a total nobody stated')
  // And the summary refuses to total seats it does not fully know.
  assert.equal(placementSummary(units, []).seats, null)
})

// ── The number the board exists to move ──────────────────────────────────────

test('the summary counts placed against unplaced, confirmed only', () => {
  const rows = [
    row({ id: 'a', assigned_unit: '5 SCCT' }),
    row({ id: 'b' }),
    row({ id: 'c' }),
    row({ id: 'd', application_status: 'not_confirmed' }),
  ]
  const s = placementSummary(UNITS, rows)
  assert.equal(s.confirmed, 3)
  assert.equal(s.placed, 1)
  assert.equal(s.unplaced, 2)
  assert.equal(s.seats, 3)
  assert.equal(s.units, 2)
})

test('applicants sort by what still needs doing, never against each other', () => {
  const name = r => r.n
  const rows = [
    { n: 'Zed', assigned_unit: '5 SCCT', unit_preference_1: '5 SCCT' },
    { n: 'Ann', assigned_unit: null },
    { n: 'Bea', assigned_unit: null, unit_preference_1: '6 NT' },
  ]
  // Unplaced first (they are the work), then those who ranked something, then
  // alphabetically. Nothing scores or ranks the people themselves.
  assert.deepEqual(orderApplicants(rows, name).map(r => r.n), ['Bea', 'Ann', 'Zed'])
  // Nothing SCORES or ranks a person. The board says the word exactly once, in
  // a sentence promising the opposite, so the guard is about DATA rather than
  // vocabulary: no field, state or payload key carries a score or a rubric.
  assert.doesNotMatch(board, /(score|rubric)\s*[:=]/i, 'no score or rubric is stored or read')
  assert.doesNotMatch(read('src/lib/ngrp/ngrpPlacement.js'), /(score|rubric)/i)
  // The migration adds no column whose NAME carries a score or a rubric. It
  // mentions both words, in a comment saying neither is stored.
  const added = [...migration.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)].map(m => m[1])
  assert.ok(added.length > 0)
  for (const col of added) assert.doesNotMatch(col, /score|rubric/i, col)
  // And it says so out loud, because the absence is the promise.
  assert.match(board, /No interview rubric or score is stored\s+anywhere in ASPIRE/)
})

// ── The write path ───────────────────────────────────────────────────────────

test('assigning is staff-only, explicit, and carries its actor', () => {
  const block = manageApi.slice(manageApi.indexOf("action === 'assign_unit'"), manageApi.indexOf("action === 'application_confirm'"))
  // Only someone on the official NGRP list can be assigned.
  assert.match(block, /candidate\.application_status !== 'confirmed'/)
  // A blank string is not a unit; clearing is NULL, one representation only.
  assert.match(block, /const unit = raw \|\| null/)
  // Actor and moment travel with the assignment, and clearing clears both.
  assert.match(block, /assigned_unit_at: unit \? nowIso : null/)
  assert.match(block, /assigned_by_profile_id: unit \? actorId : null/)
  // Re-assigning the same unit is a no-op rather than a spurious audit row.
  assert.match(block, /idempotent: true/)
  // Audited both ways.
  assert.match(block, /eventType: unit \? 'unit_assigned' : 'unit_assignment_cleared'/)
  for (const ev of ['unit_assigned', 'unit_assignment_cleared']) {
    assert.ok(NGRP_AUDIT_EVENTS.includes(ev), `${ev} is allowlisted in JS`)
    assert.match(migration, new RegExp(`'${ev}'`), `${ev} is allowed by the DB CHECK`)
  }
})

test('the board fails closed until the migration is applied', () => {
  // A missing COLUMN is a different failure from a missing table and PostgREST
  // reports it differently; without this the board would 500 instead of saying
  // what is actually wrong.
  assert.ok(isMissingNgrpColumn({ code: 'PGRST204' }))
  assert.ok(isMissingNgrpColumn({ code: '42703' }))
  assert.ok(isMissingNgrpColumn({ message: 'column ngrp_candidates.assigned_unit does not exist' }))
  assert.ok(!isMissingNgrpColumn({ code: '23505' }), 'a duplicate key is not a missing column')
  assert.ok(!isMissingNgrpColumn(null))
  // And every existing unprovisioned branch inherits it.
  assert.ok(isMissingNgrpSchema({ code: 'PGRST204' }))
  assert.match(manageApi, /isMissingNgrpColumn\(upd\.error\) \? unprovisioned\(res\)/)
  assert.match(board, /planning\.status === 'unprovisioned' \|\| applicants\.status === 'unprovisioned'/)
  assert.match(board, /20260906000000/, 'the empty state names the migration')
})

// ── The migration ────────────────────────────────────────────────────────────

test('the migration is additive and needs no backfill', () => {
  assert.equal((migration.match(/ADD COLUMN IF NOT EXISTS/g) || []).length, 7)
  // Nothing existing is dropped or retyped; the only DROPs are of constraints
  // this same file then re-adds, which is how a CHECK is widened.
  for (const m of migration.match(/DROP CONSTRAINT IF EXISTS (\w+)/g) || []) {
    const name = m.split(' ').pop()
    assert.match(migration, new RegExp(`ADD CONSTRAINT ${name}`), `${name} is re-added`)
  }
  assert.doesNotMatch(migration, /DROP COLUMN|DROP TABLE|ALTER COLUMN .* TYPE/)
  // interview_status defaults, so existing rows stay valid with no backfill.
  assert.match(migration, /interview_status text NOT NULL DEFAULT 'not_scheduled'/)
  // The vocabulary is the client's, enforced in the database.
  const states = read('src/lib/ngrp/ngrpStates.js')
  const check = migration.slice(migration.indexOf('CHECK (interview_status IN ('), migration.indexOf("'no_show'")) + "'no_show'"
  for (const k of Object.keys(JSON.parse(JSON.stringify({})) || {})) void k
  for (const k of ['not_scheduled', 'scheduled', 'completed', 'decision_recorded', 'cancelled', 'applicant_withdrew', 'no_interview', 'no_show']) {
    assert.match(check, new RegExp(`'${k}'`), `${k} is in the DB CHECK`)
    assert.match(states, new RegExp(`${k}:`), `${k} is in INTERVIEW_STATES`)
  }
  assert.match(migration, /-- {3}SELECT/, 'a verification query ships with it')
})

test('the board is wired as the Residency board sub-tab', () => {
  assert.match(workspace, /import PlacementBoard from '\.\/PlacementBoard'/)
  assert.match(workspace, /tab === 'residency' && subTab === 'board'/)
  // Two panels, one screen, built on the ASPIRE board's own panel system and
  // named as it names them (bar the one word that had to change).
  assert.match(board, /<span className="embed-panel-title-light">Unit Pool<\/span>/)
  assert.match(board, /<span className="embed-panel-title-light">Applicant Pool<\/span>/)
  for (const cls of ['embed-units-panel', 'embed-unit-grid', 'embed-students-panel', 'embed-student-grid', 'embed-light-hdr', 'euc-card', 'euc-fill-badge', 'ov-panel-title']) {
    assert.match(board, new RegExp(cls), `${cls} is reused, not reinvented`)
  }
  // Neither rejected name is rendered. The header comment explains why they
  // were rejected, which is not the same as using them.
  assert.doesNotMatch(board.slice(board.indexOf('  return (')), /Student Pool|Candidate Pool/)
})

test('focus runs both ways, which is what makes it a board', () => {
  // Clicking a unit reorders the applicants who ranked it; clicking an
  // applicant lights up the units they asked for. Neither hides the other side.
  assert.match(board, /const \[focusedUnit, setFocusedUnit\]/)
  assert.match(board, /const \[selectedApplicant, setSelectedApplicant\]/)
  assert.match(board, /ngrp-uc-wanted/, 'a unit the selected applicant ranked is marked')
  assert.match(board, /ngrp-ac-dim/, 'an applicant who did not rank the focused unit recedes')
  assert.match(board, /Place \{nameOf\(selectedApplicant\)\} here/, 'an open seat places the selection')
  // The focused unit reports its preference tally, as the ASPIRE board does.
  assert.match(board, /Preferences for <b>\{focusedUnit\}<\/b>/)
})

test('the preference breakdown is honest about what was not ranked', () => {
  const rows = [
    { application_status: 'confirmed', assigned_unit: 'A', unit_preference_1: 'A' },
    { application_status: 'confirmed', assigned_unit: 'B', unit_preference_1: 'A', unit_preference_2: 'B' },
    // HR assigned a unit this applicant never ranked.
    { application_status: 'confirmed', assigned_unit: 'Z', unit_preference_1: 'A' },
    { application_status: 'confirmed', assigned_unit: null, unit_preference_1: 'A' },
  ]
  const c = preferenceCounts(rows)
  assert.deepEqual(c, { top: 1, second: 1, other: 0, notRecorded: 1 })
  // The headline counts only assignments with a RECORDED rank, so the
  // off-list one is not dragged into the denominator as a failure.
  assert.equal(topChoicePct(c), 50)
  // And when nothing was ranked, the answer is "not recorded", never 0%.
  assert.equal(topChoicePct({ top: 0, second: 0, other: 0, notRecorded: 4 }), null)
  assert.match(board, /No assignment matched a ranked choice/)
})

test('an open seat is drawn as a seat, not as absence', () => {
  // A unit hiring three with one assigned should LOOK two short.
  assert.match(board, /Array\.from\(\{ length: Math\.max\(0, u\.seats - u\.assigned\) \}/)
  assert.match(read('src/components/ngrp/ngrp.css'), /\.ngrp-uc-slot-open \{[\s\S]{0,120}dashed/)
  // A unit with no number set says so rather than drawing zero seats.
  assert.match(board, /No number of new grads set for this unit/)
})

test('a focused unit reorders applicants by the choice it was for them', () => {
  const name = r => r.n
  const rows = [
    { n: 'Zed', unit_preference_1: 'B' },
    { n: 'Ann', unit_preference_1: 'B', unit_preference_2: 'A' },
    { n: 'Bea', unit_preference_1: 'A' },
  ]
  assert.equal(preferenceRankFor(rows[2], 'A'), 1)
  assert.equal(preferenceRankFor(rows[1], 'A'), 2)
  assert.equal(preferenceRankFor(rows[0], 'A'), 4, 'did not rank it')
  assert.deepEqual(orderForFocus(rows, 'A', name).map(r => r.n), ['Bea', 'Ann', 'Zed'])
  // With nothing focused it falls back to unplaced-first.
  assert.deepEqual(orderForFocus(rows, null, name).map(r => r.n), ['Ann', 'Bea', 'Zed'])
})

test('no em dash in anything this change added', () => {
  for (const f of [
    'src/lib/ngrp/ngrpPlacement.js', 'src/components/ngrp/PlacementBoard.jsx',
    'supabase/migrations/20260906000000_ngrp_assignment_interview.sql',
  ]) {
    assert.doesNotMatch(read(f), /—/, `${f} must not contain an em dash`)
  }
})
