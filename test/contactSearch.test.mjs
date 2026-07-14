// ASPIRE-PORTAL-CONTACTS: pure-logic tests for the shared contacts-search
// helpers used by both the Outreach CC picker and the Grant Portal Access modal.
// Run: node --test test/contactSearch.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeContactTerm, matchCatalogKeys, pickReliableStudent, contactSubtitle, CONTACT_SEARCH_COLUMNS,
} from '../src/lib/contactSearchCore.js'

test('sanitizeContactTerm strips PostgREST/ilike-breaking characters', () => {
  assert.equal(sanitizeContactTerm('  a,(b)%_\\*c  '), 'a b c')
  assert.equal(sanitizeContactTerm(null), '')
})

test('CONTACT_SEARCH_COLUMNS carries the scope-affiliation fields', () => {
  assert.match(CONTACT_SEARCH_COLUMNS, /unit_name/)
  assert.match(CONTACT_SEARCH_COLUMNS, /school_name/)
  assert.match(CONTACT_SEARCH_COLUMNS, /email/)
})

test('matchCatalogKeys maps only known catalog values (never invents keys)', async (t) => {
  const UNITS = ['4 North', 'NICU', 'PICU']
  await t.test('exact tokens map, unknown tokens drop', () => {
    assert.deepEqual(matchCatalogKeys('NICU, PICU', UNITS), ['NICU', 'PICU'])
    assert.deepEqual(matchCatalogKeys('NICU, Made Up Unit', UNITS), ['NICU'])
  })
  await t.test('case-insensitive and slash/semicolon separators', () => {
    assert.deepEqual(matchCatalogKeys('nicu / picu', UNITS), ['NICU', 'PICU'])
    assert.deepEqual(matchCatalogKeys('4 north; nicu', UNITS), ['4 North', 'NICU'])
  })
  await t.test('empty / no match yields empty array', () => {
    assert.deepEqual(matchCatalogKeys('', UNITS), [])
    assert.deepEqual(matchCatalogKeys('nothing here', UNITS), [])
  })
})

test('pickReliableStudent links only on an exact email match to exactly one student', async (t) => {
  const students = [
    { id: 's1', school_email: 'jae@school.edu', personal_email: 'jae@gmail.com' },
    { id: 's2', school_email: 'sam@school.edu', personal_email: null },
  ]
  await t.test('exactly one exact match (school email) links', () => {
    assert.equal(pickReliableStudent('JAE@school.edu', students)?.id, 's1')
  })
  await t.test('exact match on personal email links', () => {
    assert.equal(pickReliableStudent('jae@gmail.com', students)?.id, 's1')
  })
  await t.test('no email match returns null (never guesses by name)', () => {
    assert.equal(pickReliableStudent('someone-else@x.com', students), null)
  })
  await t.test('ambiguous: two students share the email -> null', () => {
    const dup = [{ id: 'a', school_email: 'x@x.com' }, { id: 'b', school_email: 'x@x.com' }]
    assert.equal(pickReliableStudent('x@x.com', dup), null)
  })
  await t.test('empty email returns null', () => {
    assert.equal(pickReliableStudent('', students), null)
  })
})

test('contactSubtitle shows role/title, unit, school, email context', () => {
  const s = contactSubtitle({ role: 'Clinical Coordinator', unit_name: 'NICU', school_name: 'CSULB', email: 'c@x.com' })
  assert.match(s, /Clinical Coordinator/); assert.match(s, /NICU/); assert.match(s, /CSULB/); assert.match(s, /c@x\.com/)
})
