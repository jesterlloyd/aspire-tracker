// ASPIRE-PORTAL-STUDENT-PICKER: pure-logic tests for alias-aware Academic Partner
// school matching (the fix for school autofill).
// Run: node --test test/portalSchoolMatching.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { matchSchoolKeys, normalizeSchoolTerm } from '../src/lib/contactSearchCore.js'
import { SCHOOL_SCOPE_OPTIONS } from '../src/lib/portalScopeCatalog.js'

const CSULA = 'California State University, Los Angeles'
const CSULB = 'California State University, Long Beach'
const APU = 'Azusa Pacific University'

test('normalizeSchoolTerm strips punctuation and case', () => {
  assert.equal(normalizeSchoolTerm('California State University, Los Angeles'), 'california state university los angeles')
  assert.equal(normalizeSchoolTerm('Cal State LA'), 'cal state la')
})

test('matchSchoolKeys resolves canonical, alias, and abbreviation forms', async (t) => {
  await t.test('maps from the canonical school_name', () => {
    assert.deepEqual(matchSchoolKeys(CSULA, SCHOOL_SCOPE_OPTIONS), [CSULA])
  })
  await t.test('maps a spelled-out alias (Cal State LA)', () => {
    assert.deepEqual(matchSchoolKeys('Cal State LA', SCHOOL_SCOPE_OPTIONS), [CSULA])
  })
  await t.test('maps an abbreviation (CSULA), case/punctuation-insensitive', () => {
    assert.deepEqual(matchSchoolKeys('csula', SCHOOL_SCOPE_OPTIONS), [CSULA])
    assert.deepEqual(matchSchoolKeys('C.S.U.L.A', SCHOOL_SCOPE_OPTIONS), [])  // dotted initials are not an approved alias
    assert.deepEqual(matchSchoolKeys('APU', SCHOOL_SCOPE_OPTIONS), [APU])
  })
  await t.test('reads from organization when school_name is empty', () => {
    assert.deepEqual(matchSchoolKeys([null, 'CSULB'], SCHOOL_SCOPE_OPTIONS), [CSULB])
  })
  await t.test('preserves multiple distinct valid affiliations', () => {
    const out = matchSchoolKeys(['CSULA', 'Azusa Pacific'], SCHOOL_SCOPE_OPTIONS)
    assert.equal(out.length, 2)
    assert.ok(out.includes(CSULA) && out.includes(APU))
  })
  await t.test('does not guess on unmatched or ambiguous affiliation', () => {
    assert.deepEqual(matchSchoolKeys('Some Community College', SCHOOL_SCOPE_OPTIONS), [])
    // A bare "West Coast University" is not an alias of a specific campus -> no guess.
    assert.deepEqual(matchSchoolKeys('West Coast University', SCHOOL_SCOPE_OPTIONS), [])
    assert.deepEqual(matchSchoolKeys('', SCHOOL_SCOPE_OPTIONS), [])
  })
})
