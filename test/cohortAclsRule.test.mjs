// COHORT-ACLS-RULE-1 (Owner, 2026-10-29): ACLS by the residency start date, set in Cohort Settings.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rulesOf, conditionalRules } from '../src/lib/ngrp/ngrpCohortForm.js'
import { validateQualificationRules, computeEligibility } from '../lib/server/ngrpEligibility.js'

const stored = { conditional: { license: { enabled: true, deadline: null }, bls: { enabled: true, deadline: '2027-01-01' }, acls: { enabled: false, deadline: null } } }

test('the checkbox reads the stored rule and writes the start date as its deadline', () => {
  assert.equal(rulesOf({ qualification_rules: stored }).acls_by_start, false)
  const rules = { ...rulesOf({ qualification_rules: stored }), acls_by_start: true }
  const c = conditionalRules(rules, stored, '2027-01-25')
  assert.deepEqual(c.acls, { enabled: true, deadline: '2027-01-25' })
  assert.deepEqual(c.license, { enabled: true, deadline: null })
  assert.deepEqual(c.bls, stored.conditional.bls, 'BLS, which the screen does not edit, survives a save')
  assert.equal(rulesOf({ qualification_rules: { conditional: c } }).acls_by_start, true)
})

test('off clears it; a save never drops ACLS by rebuilding licensure alone', () => {
  const c = conditionalRules({ nclex_exception_enabled: true, license_deadline_override: '', acls_by_start: false }, stored, '2027-01-25')
  assert.deepEqual(c.acls, { enabled: false, deadline: null })
})

test('with the rule on, "None yet" is conditional, not not-eligible', () => {
  const rules = validateQualificationRules({ conditional: conditionalRules({ nclex_exception_enabled: true, license_deadline_override: '', acls_by_start: true }, null, '2027-01-25') })
  const facts = { acls_required: true, acls_status: 'none' }
  const acls = computeEligibility({ cycle: { residency_start_date: '2027-01-25' }, rules, facts }).requirements.find(r => r.code === 'acls')
  assert.equal(acls.status, 'conditional')
})
