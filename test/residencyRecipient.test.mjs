// RESIDENCY: where residency correspondence goes (Owner, 2026-09-11).
// Hired -> Cedars-Sinai email, personal as backup. Still applying -> the
// Transition Form's preferred email, personal as backup. The school address is
// never used: alumni lose it after graduation.
// Run: node --test test/residencyRecipient.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { residencyRecipient, isHired } from '../lib/server/ngrpResidencyRecipient.js'
import { validateOutcomePayload } from '../lib/server/ngrpPlanning.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')
const code = src => src.split('\n').filter(l => !/^\s*(--|\/\/)/.test(l)).join('\n')
const STUDENT = { school_email: 'maya@school.edu', personal_email: 'maya@home.com' }
const HIRED = { hired_at: '2027-01-05T00:00:00Z', cs_email: 'Maya.Lin@cshs.org' }

test('hired: the Cedars-Sinai address, then personal; never the school address', () => {
  assert.deepEqual(residencyRecipient({ outcome: HIRED, student: STUDENT }), { email: 'Maya.Lin@cshs.org', source: 'cs_email' })
  assert.deepEqual(residencyRecipient({ outcome: { ...HIRED, cs_email: null }, student: STUDENT }),
    { email: 'maya@home.com', source: 'personal_email' })
  assert.deepEqual(residencyRecipient({ outcome: { ...HIRED, cs_email: 'not-an-email' }, student: STUDENT }),
    { email: 'maya@home.com', source: 'personal_email' }, 'a malformed address is not used')
  assert.deepEqual(residencyRecipient({ outcome: HIRED, student: { school_email: 'maya@school.edu' } }),
    { email: 'Maya.Lin@cshs.org', source: 'cs_email' })
  assert.deepEqual(residencyRecipient({ outcome: { hired_at: HIRED.hired_at }, student: { school_email: 'maya@school.edu' } }),
    { email: null, reason: 'no_cs_or_personal_email' }, 'the school address is never a fallback')
})

test('still applying: the Transition Form preferred email, then personal', () => {
  assert.deepEqual(residencyRecipient({ formPreferredEmail: ' maya@gmail.com ', student: STUDENT }),
    { email: 'maya@gmail.com', source: 'form_preferred_email' })
  assert.deepEqual(residencyRecipient({ student: STUDENT }), { email: 'maya@home.com', source: 'personal_email' })
  assert.deepEqual(residencyRecipient({}), { email: null, reason: 'no_preferred_or_personal_email' })
  // A separated resident is no longer reached at their Cedars-Sinai address.
  const separated = { ...HIRED, separated_at: '2027-06-01T00:00:00Z' }
  assert.equal(isHired(separated), false)
  assert.deepEqual(residencyRecipient({ outcome: separated, formPreferredEmail: 'maya@gmail.com', student: STUDENT }),
    { email: 'maya@gmail.com', source: 'form_preferred_email' })
})

test('a hire can carry the address, and a malformed one is refused with a reason', () => {
  const base = { offer_extended_at: '2026-12-01T00:00:00Z', offer_accepted_at: '2026-12-05T00:00:00Z', hired_at: '2026-12-20T00:00:00Z', hired_unit: '7 SCCT' }
  assert.equal(validateOutcomePayload({ ...base, cs_email: '  Maya.Lin@cshs.org ' }).outcome.cs_email, 'Maya.Lin@cshs.org')
  assert.equal(validateOutcomePayload(base).outcome.cs_email, null, 'optional: the account may not exist yet')
  assert.equal(validateOutcomePayload({ ...base, cs_email: '' }).outcome.cs_email, null)
  const bad = validateOutcomePayload({ ...base, cs_email: 'maya at cshs' })
  assert.equal(bad.ok, false)
  assert.deepEqual(bad.errors, [{ field: 'cs_email', message: 'Enter a valid Cedars-Sinai email address.' }])
})

test('the migration adds one nullable, shape-checked column and nothing else', () => {
  const sql = code(read('supabase/migrations/20260915000000_ngrp_outcome_cs_email.sql'))
  assert.match(sql, /^BEGIN;$/m)
  assert.match(sql, /^COMMIT;$/m)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS cs_email text\s+CHECK \(cs_email IS NULL OR \(btrim\(cs_email\) <> '' AND char_length\(cs_email\) <= 200 AND cs_email LIKE '%@%\.%'\)\)/)
  assert.doesNotMatch(sql, /DROP |GRANT |REVOKE |CREATE POLICY|UPDATE |DELETE /)
})

test('the roster reads the column when it exists and falls back when it does not', () => {
  const src = read('lib/server/ngrpApplicants.js')
  assert.match(src, /select\(`\$\{OUTCOME_FIELDS\}, cs_email`\)/)
  assert.match(src, /if \(!full\.error \|\| !isMissingNgrpColumn\(full\.error\)\) return full/)
  assert.match(read('api/ngrp-manage.js'), /isMissingNgrpSchema\(wrote\.error\) \|\| isMissingNgrpColumn\(wrote\.error\)/)
  const drawer = read('src/components/ngrp/ApplicantDrawer.jsx')
  assert.match(drawer, /<Row label="Cedars-Sinai email">\{o\.cs_email\}<\/Row>/)
  assert.match(drawer, /value=\{form\.cs_email\}/, 'and it can be typed in')
  assert.match(read('src/components/ngrp/SupportTab.jsx'), /sub=\{r\.row\.outcome\?\.cs_email \|\| 'No Cedars-Sinai email yet'\}/)
})
