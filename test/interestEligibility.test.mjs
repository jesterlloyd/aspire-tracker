// INTEREST-ELIGIBILITY-1 (Owner, 2026-10-29): Profiles & Interest > Interest & Eligibility.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { licenseOf, employmentOf, gpaOf, interestColumns, LICENSE_LABELS } from '../src/lib/ngrp/interestEligibilityModel.js'
import { sortRows } from '../src/components/shared/dataSheetSort.js'
import { narrowPayloadForTalentAcquisition } from '../lib/server/ngrpTalentAcquisition.js'

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

test('licensure, employment and GPA read as words, and nothing reported is null', () => {
  assert.equal(licenseOf({ form_rn_status: 'active' }).label, 'Licensed')
  assert.equal(licenseOf({}), null)
  assert.deepEqual(employmentOf({ form_cs_employment: 'per_diem' }), { label: 'Internal', detail: 'Per diem' })
  assert.equal(employmentOf({ form_cs_employment: 'not_employed' }).label, 'External')
  assert.equal(employmentOf({ form_cs_employment: null }), null)
  assert.equal(gpaOf({ student: { cumulative_gpa: '3.62' } }), 3.62)
  assert.equal(gpaOf({ student: { cumulative_gpa: null } }), null)
  for (const v of Object.values(LICENSE_LABELS)) assert.ok(v.label && v.family && v.icon)
})

test('every column sorts, and an unreported value sorts last both ways', () => {
  const cols = interestColumns({ effectiveEligibility: r => r.e || 'pending', rosterStatus: r => r.st, statusOrder: ['not_in_pool', 'in_pool'] })
  const rows = [
    { id: 'a', student: { last_name: 'Cruz', cumulative_gpa: 3.1 }, form_rn_status: null },
    { id: 'b', student: { last_name: 'Abe', cumulative_gpa: 3.9 }, form_rn_status: 'active' },
    { id: 'c', student: { last_name: 'Bo', cumulative_gpa: null }, form_rn_status: 'pending' },
  ]
  assert.deepEqual(sortRows(rows, cols, { key: 'alumnus', dir: 'asc' }).map(r => r.id), ['b', 'c', 'a'])
  assert.deepEqual(sortRows(rows, cols, { key: 'gpa', dir: 'desc' }).map(r => r.id), ['b', 'a', 'c'])
  assert.deepEqual(sortRows(rows, cols, { key: 'license', dir: 'asc' }).map(r => r.id), ['b', 'c', 'a'])
  assert.deepEqual(sortRows(rows, cols, { key: 'license', dir: 'desc' }).map(r => r.id), ['c', 'b', 'a'])
  assert.deepEqual(cols.map(c => c.key), ['alumnus', 'form', 'license', 'employment', 'gpa', 'eligibility', 'choices', 'status'])
})

test('Talent Acquisition never receives a GPA', () => {
  const out = narrowPayloadForTalentAcquisition({ students: [{ id: 's', status: 'Completed', cumulative_gpa: 3.4 }], candidates: [] })
  assert.equal('cumulative_gpa' in out.students[0], false)
})

test('the server attaches what the latest form reported, and the record GPA', () => {
  const src = read('lib/server/ngrpApplicants.js')
  assert.match(src, /'cumulative_gpa, school_email, personal_email'/)
  assert.match(src, /form_rn_status: row\.payload\?\.licensure\?\.ca_rn_status \|\| null/)
  assert.match(src, /form_cs_employment: row\.payload\?\.identity\?\.cs_employment_status \|\| null/)
})

test('the tab is Interest & Eligibility, every header sorts, GPA is staff only', () => {
  const tab = read('src/components/ngrp/ProfilesTab.jsx')
  assert.match(tab, /label: 'Interest & Eligibility'/)
  for (const k of ['alumnus', 'form', 'license', 'employment', 'gpa', 'eligibility', 'choices', 'status']) {
    assert.match(tab, new RegExp(`<SortHeader[^>]*sortKey="${k}"`), k)
  }
  assert.match(tab, /\{staffApp && <SortHeader thClassName="ngrp-col-gpa"/)
})

test('the caption names a sorted column readably, acronyms intact', () => {
  const tab = read('src/components/ngrp/ProfilesTab.jsx')
  assert.match(tab, /gpa: 'GPA'/)
  assert.match(tab, /license: 'CA RN license'/)
  assert.match(tab, /employment: 'CS employee'/)
  assert.match(tab, /sorted by \{colSort \? COLUMN_CAPTIONS\[colSort\.key\] :/)
  assert.doesNotMatch(tab, /COLUMN_CAPTIONS\[colSort\.key\]\.toLowerCase/)
})
