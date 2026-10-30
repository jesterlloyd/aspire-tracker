// INTEREST-ELIGIBILITY-1 (Owner, 2026-10-29): Profiles & Interest > Interest & Eligibility.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { licenseOf, employmentOf, gpaOf, interestColumns, LICENSE_LABELS, preceptedUnitOf, unitDemand, demandFor, seatLabel } from '../src/lib/ngrp/interestEligibilityModel.js'
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
  const cols = interestColumns({ effectiveEligibility: r => r.e || 'pending' })
  const rows = [
    { id: 'a', student: { last_name: 'Cruz', cumulative_gpa: 3.1 }, form_rn_status: null },
    { id: 'b', student: { last_name: 'Abe', cumulative_gpa: 3.9 }, form_rn_status: 'active' },
    { id: 'c', student: { last_name: 'Bo', cumulative_gpa: null }, form_rn_status: 'pending' },
  ]
  assert.deepEqual(sortRows(rows, cols, { key: 'alumnus', dir: 'asc' }).map(r => r.id), ['b', 'c', 'a'])
  assert.deepEqual(sortRows(rows, cols, { key: 'gpa', dir: 'desc' }).map(r => r.id), ['b', 'a', 'c'])
  assert.deepEqual(sortRows(rows, cols, { key: 'license', dir: 'asc' }).map(r => r.id), ['b', 'c', 'a'])
  assert.deepEqual(sortRows(rows, cols, { key: 'license', dir: 'desc' }).map(r => r.id), ['c', 'b', 'a'])
  assert.deepEqual(cols.map(c => c.key), ['alumnus', 'form', 'license', 'employment', 'gpa', 'eligibility', 'precepted', 'choices'])
})

test('Talent Acquisition never receives a GPA', () => {
  const out = narrowPayloadForTalentAcquisition({ students: [{ id: 's', status: 'Completed', cumulative_gpa: 3.4 }], candidates: [] })
  assert.equal('cumulative_gpa' in out.students[0], false)
})

test('the server attaches what the latest form reported, and the record GPA', () => {
  const src = read('lib/server/ngrpApplicants.js')
  assert.match(src, /'cumulative_gpa, matched_unit_id, unit, school_email, personal_email'/)
  assert.match(src, /form_rn_status: row\.payload\?\.licensure\?\.ca_rn_status \|\| null/)
  assert.match(src, /form_cs_employment: row\.payload\?\.identity\?\.cs_employment_status \|\| null/)
})

test('the tab is Interest & Eligibility, every header sorts, GPA is staff only', () => {
  const tab = read('src/components/ngrp/ProfilesTab.jsx')
  assert.match(tab, /label: 'Interest & Eligibility'/)
  for (const k of ['alumnus', 'form', 'license', 'employment', 'gpa', 'eligibility', 'precepted', 'choices']) {
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

test('INTEREST-ELIGIBILITY-2: precepted unit, and the Rotation seat rule on residency numbers', () => {
  assert.equal(preceptedUnitOf({ student: { precepted_unit: '6 NE' }, form_precepted_unit: '4 North' }), '6 NE', 'the placement wins')
  assert.equal(preceptedUnitOf({ student: {}, form_precepted_unit: '4 North' }), '4 North')
  assert.equal(preceptedUnitOf({ student: {} }), null)
  const units = [
    { unit_name: '4 North', capacity: 2, is_active: true },
    { unit_name: '8 SCCT', capacity: 1, is_active: true },
    { unit_name: 'NICU', capacity: null, is_active: true },
    { unit_name: 'Retired', capacity: 3, is_active: false },
  ]
  const p = (...u) => ({ prefs: u })
  const rows = [
    p('4 North', '8 SCCT'), p('4 North'), p('4 North'), p('4 north'),
    { prefs: ['8 SCCT'], np: true },
    { prefs: [], outcome: { hired_unit: '8 SCCT', hired_at: '2026-10-01' } },
  ]
  const d = unitDemand(rows, units, { preferencesOf: r => r.prefs, isActive: r => !r.np })
  const n = demandFor(d, '4 North')
  assert.deepEqual([n.d1, n.open, n.highDemand], [4, 2, true], '4 first choices >= 2 open + 2')
  const s = demandFor(d, '8 scct')
  assert.deepEqual([s.d1, s.d2, s.open, s.highDemand], [0, 1, 0, false], 'Not Proceeding not counted; a hire takes a seat')
  assert.deepEqual(seatLabel(n), { text: '2 open', tone: 'open' })
  assert.deepEqual(seatLabel(s), { text: 'Full', tone: 'full' })
  assert.deepEqual(seatLabel({ open: 1 }), { text: '1 left', tone: 'left' })
  assert.equal(seatLabel(demandFor(d, 'NICU')), null, 'no position count, no chip')
  assert.equal(demandFor(d, 'Retired'), null)
})

test('INTEREST-ELIGIBILITY-2: a row click selects; the photo and name open Profiles', () => {
  const tab = read('src/components/ngrp/ProfilesTab.jsx')
  assert.match(tab, /onClick=\{canSelect \? \(\) => toggleRow\(r\.id\) : undefined\}/)
  assert.doesNotMatch(tab, /<tr[^>]*onClick=\{\(\) => selectRow\(r\.id, \{ toProfiles: true \}\)\}/)
  assert.equal((tab.match(/className="ngrp-openbtn[^"]*"/g) || []).length, 2)
  assert.match(tab, /<span className="ngrp-stack">\s*<NgrpStatusPill config=\{FORM_SENT_STATES\}/)
})

// ELIGIBILITY-SUBTITLES-1 (Owner, 2026-10-30): the line under the license and eligibility pills.
import { licenseDetail, eligibilityDetail, shortDate } from '../src/lib/ngrp/interestEligibilityModel.js'
import { computeEligibility } from '../lib/server/ngrpEligibility.js'

test('the license line is the number when licensed and the NCLEX date when ahead', () => {
  assert.equal(licenseDetail({ form_rn_status: 'active', form_rn_license_number: '95123456' }), 'License 95123456')
  assert.equal(licenseDetail({ form_rn_status: 'active' }), null)
  assert.equal(licenseDetail({ form_rn_status: 'pending', form_nclex_date: '2026-11-12' }), 'NCLEX Nov 12, 2026')
  assert.equal(licenseDetail({ form_rn_status: 'pending' }), 'NCLEX not yet scheduled')
  assert.equal(licenseDetail({ form_rn_status: 'none' }), null)
  assert.equal(shortDate('nope'), null)
})

test('the eligibility line says why, from the stored reasons', () => {
  const cycle = { application_deadline: '2026-12-01', licensure_deadline: '2027-01-15' }
  const base = { ca_rn_status: 'active', paid_rn_months: 0, gpa: 3.5, completion_date: '2026-08-01', bls_status: 'active' }
  const row = facts => ({ eligibility_reasons: computeEligibility({ cycle, facts }).reasons })
  const res = facts => computeEligibility({ cycle, facts }).result

  assert.equal(eligibilityDetail(row(base), res(base)), 'Requirements complete')
  const sched = { ...base, ca_rn_status: 'pending', nclex_scheduled_date: '2026-12-10' }
  assert.equal(res(sched), 'conditionally_eligible')
  assert.equal(eligibilityDetail(row(sched), res(sched)), 'NCLEX scheduled Dec 10, 2026')
  const none = { ...base, ca_rn_status: 'pending' }
  assert.equal(eligibilityDetail(row(none), res(none)), 'NCLEX not yet scheduled')
  const two = { ...none, gpa: 2.5 }
  assert.equal(eligibilityDetail(row(two), res(two)), 'NCLEX not yet scheduled +1 more')
  assert.equal(eligibilityDetail({ eligibility_effective: 'eligible' }, 'eligible'), 'Staff override')
  assert.equal(eligibilityDetail({}, 'pending'), 'Awaiting the Transition Form')
})
