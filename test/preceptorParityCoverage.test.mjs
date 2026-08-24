// test/preceptorParityCoverage.test.mjs
//
// db/audit/preceptor_parity_check.sql is the standing integrity check for
// preceptor assignments, run after any manual SQL session. Four questions from
// the one-off Phase 2A preflight had no standing home, so they were lifted into
// it and that branch was deleted. These tests pin what was lifted, what was
// deliberately left out, and why, so the reasoning survives the branch.
//
// Read-only SQL. Nothing here connects to a database or executes a statement.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const parity = read('db/audit/preceptor_parity_check.sql')

// ── The file stays read-only ─────────────────────────────────────────────────

test('parity check: still writes nothing', () => {
  const code = parity.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\b/i)
  assert.doesNotMatch(code, /\bBEGIN\b|\bCOMMIT\b/i)
  assert.match(parity, /READ-ONLY\. Every statement is a SELECT; this file writes nothing\./)
})

test('parity check: seven checks, each separately runnable', () => {
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    assert.match(parity, new RegExp(`^-- ${n}\\. `, 'm'), `check ${n} is missing`)
  }
  const code = parity.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  assert.equal((code.match(/;/g) || []).length, 7, 'one terminated statement per check')
  assert.match(parity, /RUN EACH NUMBERED CHECK SEPARATELY/)
})

// ── What was lifted ─────────────────────────────────────────────────────────

test('lifted: an active assignment to an inactive preceptor is detected', () => {
  // The priority case: nothing prevents it, and checks 1 to 3 compare
  // preceptor_id to preceptor_id without ever reading the preceptor row.
  const c4 = parity.slice(parity.indexOf('-- 4. ACTIVE ASSIGNMENTS'), parity.indexOf('-- 5. STALE'))
  assert.match(c4, /LEFT JOIN preceptors p ON p\.id = a\.preceptor_id/)
  assert.match(c4, /p\.is_active IS DISTINCT FROM true/)
  assert.match(c4, /a\.status = 'active'/)
  // Every role, not just primary.
  assert.doesNotMatch(c4, /role = 'primary'/)
  assert.match(c4, /Covers EVERY role/)
  // And it records why it can happen at all.
  assert.match(c4, /No\n--    application path sets preceptors\.is_active = false/)
})

test('lifted: a stale denormalized name or email is detected', () => {
  const c5 = parity.slice(parity.indexOf('-- 5. STALE'), parity.indexOf('-- 6. UNRESOLVED'))
  assert.match(c5, /matched_preceptor/)
  assert.match(c5, /preceptor_email/)
  // Case and whitespace insensitive, so capitalisation is not reported as drift.
  assert.match(c5, /btrim\(lower\(coalesce\(s\.matched_preceptor, ''\)\)\)/)
  // The reason the Phase 2B trigger does not cover this.
  assert.match(c5, /fires AFTER INSERT OR UPDATE OF preceptor_id ON students/)
})

test('lifted: an unresolved free-text link is surfaced, and marked informational', () => {
  const c6 = parity.slice(parity.indexOf('-- 6. UNRESOLVED'), parity.indexOf('-- 7. ACTIVE ASSIGNMENT FILED'))
  assert.match(c6, /s\.preceptor_id IS NULL/)
  assert.match(c6, /informational/)
  assert.match(c6, /a work queue, not a defect/)
  // Explains the blind spot in check 1 that makes this necessary.
  assert.match(c6, /a student with neither appears on neither side/)
  // And the header sets the expectation, so a non-zero count is not read as failure.
  assert.match(parity, /Check 6 is the exception: it is INFORMATIONAL/)
})

test('lifted: a cohort-stale active row is asserted, and labelled an assumption', () => {
  const c7 = parity.slice(parity.indexOf('-- 7. ACTIVE ASSIGNMENT FILED'))
  assert.match(c7, /a\.cohort_id IS DISTINCT FROM s\.cohort_id/)
  assert.match(c7, /guards a documented ASSUMPTION rather than an observed defect/)
  assert.match(c7, /never re-cohorted/)
})

// ── What was deliberately not lifted ────────────────────────────────────────

test('not lifted: the two index-and-FK-enforced checks, with the reason recorded', () => {
  // Adding a data check for something the database already makes impossible
  // would only ever restate that the constraint exists.
  assert.match(parity, /Two of the ten were deliberately NOT lifted, because they cannot happen/)
  assert.match(parity, /uq_spa_one_active_relationship_per_/)
  assert.match(parity, /prevented by the foreign keys \(student\n--     CASCADE, preceptor RESTRICT, cohort CASCADE\)/)
})

test('not lifted: the constraints named as preventing them really exist', () => {
  // If either of these ever goes away, the reasoning above stops holding and
  // the omitted checks would need revisiting.
  const idx = read('supabase/migrations/20260622000000_ppm3_pre_one_active_relationship_index.sql')
  assert.match(idx, /CREATE UNIQUE INDEX IF NOT EXISTS uq_spa_one_active_relationship_per_student_cohort_preceptor/)
  assert.match(idx, /ON student_preceptor_assignments \(student_id, cohort_id, preceptor_id\)/)
  assert.match(idx, /WHERE status = 'active'/)
})

test('not lifted: matches.preceptor_id parity is not duplicated here', () => {
  // It already has a standing home.
  assert.match(parity, /already has a standing home in\n-- db\/audit\/preceptor_projection_drift_audit\.sql/)
  const drift = read('db/audit/preceptor_projection_drift_audit.sql')
  assert.match(drift, /preceptor_id/)
  const code = parity.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  assert.doesNotMatch(code, /FROM matches/i, 'matches parity belongs to the drift audit')
})

// ── The Phase 2A branch can be deleted without losing the reasoning ─────────

test('provenance: the file records where these checks came from', () => {
  assert.match(parity, /CHECKS 4 TO 7: lifted from the Phase 2A preflight/)
  assert.match(parity, /branch phase2a-preceptor-preflight,\n-- since deleted/)
  assert.match(parity, /Phase 2B was built to repair what it\n-- found/)
})

test('house style: no em dash', () => {
  // — written as an escape so this file contains none either.
  assert.doesNotMatch(parity, /—/)
})
