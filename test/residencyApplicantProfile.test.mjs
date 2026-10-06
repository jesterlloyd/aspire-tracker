// RESIDENCY-APPLICANT-PROFILE-1: the applicant chart's Profile sheet holds Contact and Personal
// Information. The roster still carries no emails; one alumnus's details travel on the
// ngrp-workspace `profile` read, shaped per audience here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shapeApplicantProfile } from '../lib/server/ngrpApplicantProfile.js'

const student = {
  id: 's1', cohort_id: 'c1', status: 'Completed', first_name: 'Abel', last_name: 'DeLeon',
  preferred_first_name: 'Abe', school_email: 'a@school.edu', personal_email: 'a@mail.com',
  phone: '555', date_of_birth: '2000-01-01', gender: 'Male', cumulative_gpa: 3.5,
  ssn_last4: '1234',
}

test('PROFILE 1: the ASPIRE team sees contact and personal details; edits follow student-update', () => {
  const owner = shapeApplicantProfile(student, { audience: 'staff', profile: { role: 'owner', is_owner: true } })
  assert.equal(owner.student.personal_email, 'a@mail.com')
  assert.equal(owner.student.date_of_birth, '2000-01-01')
  assert.deepEqual(owner.editable, { contact: true, personal: true })
  const coLead = shapeApplicantProfile(student, { audience: 'staff', profile: { role: 'co-lead' } })
  assert.deepEqual(coLead.editable, { contact: true, personal: false })
  assert.equal('ssn_last4' in owner.student, false, 'the residency never carries the SSN')
})

test('PROFILE 2: Talent Acquisition sees contact only once the form (and its consent) is in', () => {
  const before = shapeApplicantProfile(student, { audience: 'talent_acquisition', consented: false })
  assert.equal(before.contactShared, false)
  assert.equal('personal_email' in before.student, false)
  assert.equal('school_email' in before.student, false)
  assert.equal(before.student.last_name, 'DeLeon')
  const after = shapeApplicantProfile(student, { audience: 'talent_acquisition', consented: true })
  assert.equal(after.student.phone, '555')
  for (const s of [before, after]) {
    assert.equal(s.personal, false)
    assert.deepEqual(s.editable, { contact: false, personal: false })
    for (const k of ['date_of_birth', 'gender', 'cumulative_gpa', 'ssn_last4']) assert.equal(k in s.student, false, k)
  }
})

test('PROFILE 3: the Profile sheet holds the details; Interest and Eligibility sit on Application', () => {
  const src = readFileSync(new URL('../src/components/ngrp/ApplicantDrawer.jsx', import.meta.url), 'utf8')
  const profile = src.slice(src.indexOf("id={sheetDomId('applicant')}"), src.indexOf("id={sheetDomId('application')}"))
  const application = src.slice(src.indexOf("id={sheetDomId('application')}"), src.indexOf("id={sheetDomId('documents')}"))
  assert.match(profile, /<ApplicantProfileSheet /)
  assert.ok(!/Residency Interest|title="Eligibility"/.test(profile))
  assert.match(application, /<Section title="Residency Interest">/)
  assert.match(application, /title="Eligibility"/)
  const endpoint = readFileSync(new URL('../api/ngrp-workspace.js', import.meta.url), 'utf8')
  // NGRP-INTERVIEWS-1 added 'rubrics' after it.
  assert.match(endpoint, /const ACTIONS = new Set\(\[[^\]]*'profile'/)
})
