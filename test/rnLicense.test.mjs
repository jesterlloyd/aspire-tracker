// RN-LICENSE-PREFIX-1 (Owner, 2026-11-05): the license box reads "RN-" and takes the number after
// it; the stored value is the digits; every reader prints "RN-<digits>".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { rnLicenseDigits, rnLicenseText, RN_LICENSE_PREFIX } from '../src/lib/ngrp/rnLicense.js'
import { licenseDetail } from '../src/lib/ngrp/interestEligibilityModel.js'
import { validateSubmission } from '../lib/server/ngrpTransition.js'

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

test('every spelling the alumni used reads as one number', () => {
  for (const v of ['RN95478438', '#RN95472188', '95480034', 'rn-95478438', ' RN 95478438 ', 'RN-95478438']) {
    assert.equal(rnLicenseDigits(v), v.replace(/\D/g, ''))
    assert.equal(rnLicenseText(v), `RN-${v.replace(/\D/g, '')}`)
  }
  assert.equal(rnLicenseDigits(''), '')
  assert.equal(rnLicenseDigits(null), '')
  assert.equal(rnLicenseText(undefined), '')
  assert.equal(rnLicenseDigits('1'.repeat(20)).length, 12, 'capped')
  assert.equal(RN_LICENSE_PREFIX, 'RN-')
})

test('the roster chip prints the one spelling whatever an older revision stored', () => {
  assert.equal(licenseDetail({ form_rn_status: 'active', form_rn_license_number: '#RN95472188' }), 'License RN-95472188')
  assert.equal(licenseDetail({ form_rn_status: 'active', form_rn_license_number: '95472188' }), 'License RN-95472188')
  assert.equal(licenseDetail({ form_rn_status: 'active', form_rn_license_number: '' }), null)
})

test('a submission stores the digits alone, and an active license still needs one', () => {
  const base = {
    identity: { preferred_email: 'a@x.test', cs_employment_status: 'per_diem' },
    education: { school: 'CSUN', program: 'ABSN', degree_type: 'BSN', completion_date: '2026-08-01', gpa: 3.5, us_accredited: true },
    aspire: { aspire_cohort: 'Summer 2026', precepted_unit: '6 South', rotation_shifts: 15, prior_ngrp_applied: false },
    licensure: { ca_rn_status: 'active', license_number: 'RN-95478438', paid_rn_months: 2, bls_status: 'active', bls_issuer: 'AHA', bls_expiration: '2027-06-01', acls_required: false },
    residency_interest: { interest: 'interested', unit_preferences: ['5 SCCT', '6 South', 'NICU'] },
    attestation: { accurate: true, consent_followup: true, consent_hr_share: true, consent_unit_share: true },
  }
  const ok = validateSubmission(base, { activeUnitNames: ['5 SCCT', '6 South', 'NICU'], requireComplete: true })
  assert.equal(ok.ok, true, JSON.stringify(ok.errors))
  assert.equal(ok.payload.licensure.license_number, '95478438')
  const bad = validateSubmission({ ...base, licensure: { ...base.licensure, license_number: 'RN-' } }, { activeUnitNames: ['5 SCCT', '6 South', 'NICU'], requireComplete: true })
  assert.ok(bad.errors.some(e => e.field === 'licensure.license_number'), 'a prefix alone is no number')
})

test('the form draws the prefix and takes digits; the export and the binder print the one spelling', () => {
  const page = read('src/pages/NgrpTransitionFormPage.jsx')
  assert.match(page, /<div className="ngrpf-prefixed"><span aria-hidden="true">\{RN_LICENSE_PREFIX\}<\/span>/)
  assert.match(page, /value=\{rnLicenseDigits\(p\.licensure\.license_number\)\} onChange=\{e => update\('licensure', 'license_number', rnLicenseDigits\(e\.target\.value\)\)\}/)
  assert.match(read('lib/server/ngrpResidencyExport.js'), /\['RN License Number', \(\{ form \}\) => rnLicenseText\(form\.licensure\?\.license_number\), 120\]/)
  assert.match(read('src/lib/ngrp/transitionSummary.js'), /push\('License #', rnLicenseText\(payload\.licensure\?\.license_number\) \|\| undefined\)/)
})
