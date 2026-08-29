// test/winterCarryover.test.mjs
//
// WINTER-2027-SETUP: the unit capacity carry-over + Juliana Pilla duplication
// script. Pins the decisions of 2026-08-29 so the file cannot drift from them:
// unused capacity only, responses copied as the standing answer, Fall
// untouched, Juliana duplicated fresh (never migrated).

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(new URL(
  '../supabase/migrations/20260901000000_winter_2027_unit_carryover_and_juliana.sql',
  import.meta.url), 'utf8')

test('the carry set is pinned: 18 units, 22 slots, unused capacity only', () => {
  // The qualifying rule is participation AND leftover slots.
  assert.match(sql, /is_participating = true AND slots_remaining > 0/)
  assert.match(sql, /IF v_n <> 18 OR v_slots <> 22 THEN/)
  // Every pinned id from the Owner's discovery, with its exact remaining count.
  assert.match(sql, /"c18b77d8-5863-4681-bc0f-00c35ac8ef8d": 2/, '6 NE carries 2')
  assert.match(sql, /"6b655d1b-5a1e-45ad-92e9-f1c2d45da3b1": 3/, '7 South carries 3')
  assert.match(sql, /"dbdbe02a-c7b1-4808-ae64-e928812d1016": 1/, '3 SCCT carries 1')
  // Fully-used and not-hosting units are named as excluded, not silently absent.
  assert.match(sql, /6 South, ACU\/CDU/)
  assert.match(sql, /their "no" is\s*\n-- {4,5}NOT copied/)
  // The ledger is re-proved in-lock, not trusted from discovery alone.
  assert.match(sql, /total_slots - v_matched <> fall_unit\.slots_remaining/)
})

test('clones carry every schema column and Winter arrives at full availability', () => {
  // to_jsonb -> jsonb_populate_record, so no hand-typed column list can drop data.
  assert.match(sql, /jsonb_populate_record\(\s*\n\s*NULL::units/)
  assert.match(sql, /jsonb_populate_record\(\s*\n\s*NULL::unit_cohort_responses/)
  // total AND remaining both become the Fall leftover.
  assert.match(sql, /'total_slots',\s+u\.slots_remaining/)
  assert.match(sql, /'slots_remaining', u\.slots_remaining/)
  // The response keeps its true provenance; only the offer is rescaled.
  assert.match(sql, /'slots_offered',\s+fall_unit\.slots_remaining/)
  assert.doesNotMatch(sql, /'submitted_at'/, 'submitted_at is preserved, never overridden')
  // First population only: a non-empty Winter aborts, which also blocks re-runs.
  assert.match(sql, /Winter 2027 already has % units row\(s\)/)
  assert.match(sql, /Winter 2027 already has % response row\(s\)/)
})

test('Juliana is duplicated fresh, and her Fall record is provably untouched', () => {
  assert.ok(sql.includes('d6ff6ac4-94c0-4818-935a-e5bde2c07c00'), 'her Fall id is named')
  // Preconditions: still Not Proceeding in Fall, no Winter row yet.
  assert.match(sql, /expected \(Fall 2026, Not Proceeding\)/)
  assert.match(sql, /Juliana already has % Winter 2027 row\(s\)/)
  // Fresh pipeline state, attached to the Winter NoHo rotation from 20260830000000.
  assert.match(sql, /'Pending Outreach', 'Pending Interview', 'Pending'/)
  assert.match(sql, /SELECT id INTO STRICT v_rot FROM cohort_school_rotations/)
  // Student-owned fields start empty: the postcondition asserts no unit pref.
  assert.match(sql, /coalesce\(unit_preference_1, ''\) = ''/)
  // Her Fall row is never in an UPDATE, and the postcondition re-proves it.
  assert.match(sql, /POSTCONDITION: Juliana''s Fall 2026 row changed/)
  assert.doesNotMatch(sql, /UPDATE students/)
  // The operational trap is documented: intake resolves the ACCEPTING cohort.
  assert.match(sql, /do not resend her the intake form until Winter 2027 becomes/i)
})

test('postconditions precede COMMIT, Fall is re-proved, and rollback is documented', () => {
  assert.match(sql, /POSTCONDITION: Winter 2027 has % units carrying %/)
  assert.match(sql, /POSTCONDITION: Fall 2026 changed/)
  assert.match(sql, /POSTCONDITION: % Winter response\(s\) disagree/)
  assert.ok(sql.lastIndexOf('POSTCONDITION') < sql.indexOf('COMMIT;'), 'postconditions precede COMMIT')
  assert.match(sql, /── Rollback ─/)
  // Data-only.
  assert.doesNotMatch(sql, /\n\s*(ALTER TABLE|CREATE TABLE|DROP TABLE|CREATE POLICY)/)
  assert.equal(sql.match(/^BEGIN;/gm)?.length, 1, 'one transaction')
})
