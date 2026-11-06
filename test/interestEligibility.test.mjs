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
  // CANDIDATE-SCORE-1 (the commit that changed this): Fit joined the table.
  assert.deepEqual(cols.map(c => c.key), ['alumnus', 'form', 'license', 'employment', 'gpa', 'eligibility', 'precepted', 'choices', 'fit'])
})

test("Talent Acquisition never receives the record's GPA", () => {
  const out = narrowPayloadForTalentAcquisition({ students: [{ id: 's', status: 'Completed', cumulative_gpa: 3.4 }], candidates: [] })
  assert.equal('cumulative_gpa' in out.students[0], false)
})

test('the server attaches what the latest form reported, and the record GPA', () => {
  const src = read('lib/server/ngrpApplicants.js')
  assert.match(src, /'cumulative_gpa, matched_unit_id, unit, school_email, personal_email'/)
  assert.match(src, /form_rn_status: row\.payload\?\.licensure\?\.ca_rn_status \|\| null/)
  assert.match(src, /form_cs_employment: row\.payload\?\.identity\?\.cs_employment_status \|\| null/)
})

// TRANSITION-EXCEL-1 (Owner, 2026-11-01): Talent Acquisition now has the GPA column, showing the
// GPA on the form. The record's GPA stays with the ASPIRE team.
test("the tab is Interest & Eligibility, every header sorts, and each audience reads its own GPA", () => {
  const tab = read('src/components/ngrp/ProfilesTab.jsx')
  assert.match(tab, /label: 'Interest & Eligibility'/)
  for (const k of ['alumnus', 'form', 'license', 'employment', 'gpa', 'eligibility', 'precepted', 'choices']) {
    assert.match(tab, new RegExp(`<SortHeader[^>]*sortKey="${k}"`), k)
  }
  assert.match(tab, /<SortHeader thClassName="ngrp-col-gpa"/)
  assert.match(tab, /const gpa = staffApp \? gpaOf\(r\) : formGpaOf\(r\)/)
  assert.match(tab, /gpaValue: staffApp \? gpaOf : formGpaOf/)
  assert.match(read('lib/server/ngrpApplicants.js'), /form_gpa: row\.payload\?\.education\?\.gpa \?\? null/)
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

// ROW-ANSWERS-1 changed this: a row click used to select. Only the tick box selects now.
test('a row click opens the answers; the tick box selects; the photo and name open Profiles', () => {
  const tab = read('src/components/ngrp/ProfilesTab.jsx')
  assert.doesNotMatch(tab, /<tr[^>]*onClick=\{canSelect/)
  assert.match(tab, /<tr[\s\S]{0,500}setAnswersRowId\(r\.id\)/)
  assert.match(tab, /className="ngrp-cb" onClick=\{e => e\.stopPropagation\(\)\}/)
  assert.match(tab, /onChange=\{\(\) => toggleRow\(r\.id\)\}/)
  assert.match(tab, /e\.target\.closest\('a, button, input, label, select'\)/)
  assert.doesNotMatch(tab, /<tr[^>]*onClick=\{\(\) => selectRow\(r\.id, \{ toProfiles: true \}\)\}/)
  assert.equal((tab.match(/className="ngrp-openbtn[^"]*"/g) || []).length, 2)
  assert.match(tab, /<span className="ngrp-stack">\s*<NgrpStatusPill config=\{FORM_SENT_STATES\}/)
})

// ELIGIBILITY-SUBTITLES-1 (Owner, 2026-10-30): the line under the license and eligibility pills.
import { licenseDetail, eligibilityDetail, shortDate } from '../src/lib/ngrp/interestEligibilityModel.js'
import { computeEligibility } from '../lib/server/ngrpEligibility.js'

test('the license line is the number when licensed and the NCLEX date when ahead', () => {
  // RN-LICENSE-PREFIX-1: every surface prints the one spelling.
  assert.equal(licenseDetail({ form_rn_status: 'active', form_rn_license_number: '95123456' }), 'License RN-95123456')
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

// ROW-ANSWERS-1 (Owner, 2026-11-01): the row's Transition Form drawer, and the cohort filter.
import { cohortFilterOptions } from '../src/lib/ngrp/interestEligibilityModel.js'
import { transitionAnswerRows, transitionSummaryRows, submittedLine, noAnswersLine } from '../src/lib/ngrp/transitionSummary.js'

test('the cohort filter adds the cohort of anyone added by hand, once, after the mapped ones', () => {
  const source = [{ id: 'f', name: 'Fall 2026' }, { id: 's', name: 'Summer 2026' }]
  const row = (cohort_id, aspire_cohort) => ({ student: { cohort_id, aspire_cohort } })
  assert.deepEqual(cohortFilterOptions(source, [
    row('f', 'Fall 2026'), row('sp', 'Spring 2026'), row('sp', 'Spring 2026'), row(null, null), row('x', null),
  // COHORT-ORDER-1 changed this: the list reads in calendar order, oldest first.
  ]).map(c => c.name), ['Spring 2026', 'Summer 2026', 'Fall 2026'])
  assert.deepEqual(cohortFilterOptions(source, []).map(c => c.name), ['Summer 2026', 'Fall 2026'], 'a mapped cohort with nobody in it stays listed')
  const tab = read('src/components/ngrp/ProfilesTab.jsx')
  assert.match(tab, /cohortOptions\.map\(c => <option/)
  assert.match(tab, /activeCohortFilter = cohortOptions\.some/, 'a chosen added cohort is not treated as stale')
})

test('the drawer lists the shared answers plus ranked choices, which unit leaders never read', () => {
  const payload = { residency_interest: { interest: 'very_interested', unit_preferences: ['6 NE', '', '4 South'] } }
  const rows = transitionAnswerRows(payload)
  assert.deepEqual(rows[0], ['Ranked unit choices', '1. 6 NE, 2. 4 South'])
  assert.deepEqual(rows.slice(1), transitionSummaryRows(payload))
  assert.ok(!transitionSummaryRows(payload).some(([k]) => k === 'Ranked unit choices'))
  assert.deepEqual(transitionAnswerRows(null), [])
  assert.doesNotMatch(read('lib/server/ngrpUnitInterviews.js'), /transitionAnswerRows/)
})

test('a row with no answers says why, in Pacific dates', () => {
  assert.match(noAnswersLine({ candidate_id: null }), /has not been sent/)
  assert.match(noAnswersLine({ candidate_id: 'c', form_status: 'not_sent' }), /has not been sent/)
  assert.equal(noAnswersLine({ candidate_id: 'c', form_status: 'opened', form_sent_at: '2026-10-30T02:00:00Z' }),
    'No answers yet. The form was sent Oct 29, 2026 and has not been submitted.')
  assert.equal(submittedLine({ revision_number: 2, submitted_at: '2026-10-30T02:00:00Z' }), 'Revision 2 · submitted Oct 29, 2026')
})

test('the drawer reads only the review the binder already reads, and only with a candidate', () => {
  const d = read('src/components/ngrp/TransitionAnswersDrawer.jsx')
  assert.match(d, /postNgrpManage\('candidate_review', \{ candidate_id: row\.candidate_id \}\)/)
  assert.match(d, /form_revision_count/)
  assert.match(d, /trapFocus/)
  assert.doesNotMatch(d, /tokens|token_hash/)
})

// FORM-PROGRESS-1 (Owner, 2026-11-05): the Form column says how far a sent form got.
test('the Form column reads Not Sent, Sent, Opened, In Progress and Received', async () => {
  const { formSentState, FORM_SENT_STATES } = await import('../src/lib/ngrp/ngrpStates.js')
  const cases = { not_sent: 'not_sent', sent: 'sent', opened: 'opened', in_progress: 'in_progress', submitted: 'received', revised: 'received' }
  for (const [status, want] of Object.entries(cases)) assert.equal(formSentState({ form_status: status }), want, status)
  assert.equal(formSentState({}), 'not_sent')
  assert.equal(formSentState({ form_status: 'pending' }), 'sent')
  assert.deepEqual(Object.values(FORM_SENT_STATES).map(s => s.label), ['Not Sent', 'Sent', 'Opened', 'In Progress', 'Received'])
})

// INTEREST-PIN-1 (Owner, 2026-11-05): the roster takes the measured space under the pinned bar.
test('Interest & Eligibility sizes its roster to the pinned split height', async () => {
  const { readFileSync } = await import('node:fs')
  const css = readFileSync(new URL('../src/components/ngrp/ngrp.css', import.meta.url), 'utf8')
  const tab = readFileSync(new URL('../src/components/ngrp/ProfilesTab.jsx', import.meta.url), 'utf8')
  assert.match(tab, /className="ngrp-roster ngrp-roster-fill"/)
  assert.match(css, /\.ngrp-split-frame \.ngrp-roster-fill \{[^}]*height: var\(--profiles-chart-h/)
  assert.match(css, /\.ngrp-roster-fill \.ngrp-roster-scroll \{ flex: 1 1 auto; max-height: none; min-height: 0; \}/)
})

// BLS-DETAIL-1 (Owner, 2026-11-05): Leslie Zepeda read "BLS not active" while her form said active,
// expiring 2026-11-05, before the Nov 11 application deadline. The line names both dates.
test('a BLS card that expires too early says when, not "not active"', async () => {
  const { eligibilityDetail } = await import('../src/lib/ngrp/interestEligibilityModel.js')
  const { computeEligibility } = await import('../lib/server/ngrpEligibility.js')
  const old = { code: 'bls', status: 'not_met', detail: 'BLS is not active (or expires before the application date).' }
  const row = { eligibility_reasons: [old], form_bls_expiration: '2026-11-05' }
  assert.equal(eligibilityDetail(row, 'not_eligible', { applicationDeadline: '2026-11-11' }), 'BLS expires Nov 5, 2026, before Nov 11, 2026')
  assert.equal(eligibilityDetail({ eligibility_reasons: [old] }, 'not_eligible', { applicationDeadline: '2026-11-11' }), 'BLS not active')
  const out = computeEligibility({ cycle: { application_deadline: '2026-11-11' }, rules: null, facts: { bls_status: 'active', bls_expiration: '2026-11-05' } })
  const bls = out.requirements.find(r => r.code === 'bls')
  assert.equal(bls.status, 'not_met')
  assert.equal(bls.detail, 'BLS expires 2026-11-05, before 2026-11-11.')
  assert.equal(eligibilityDetail({ eligibility_reasons: [bls], form_bls_expiration: null }, 'not_eligible'), 'BLS expires Nov 5, 2026, before Nov 11, 2026')
})
