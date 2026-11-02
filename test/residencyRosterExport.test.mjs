// TRANSITION-EXCEL-1 (Owner, 2026-11-01): the Transition Form answers as Excel, shaped like the
// Microsoft Forms export Talent Acquisition already works from. This replaced the roster CSV
// (RESIDENCY-PORTAL-3), and this file's CSV tests with it, in the same commit. Built server-side
// from the roster the caller may see; submitted responses only; the form's GPA, never the record's;
// no student-record emails, ids or preceptor feedback.
// Run: node --test test/residencyRosterExport.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Buffer } from 'node:buffer'

import { buildTransitionWorkbook, transitionWorkbookRows, fetchLatestRevisions, FROZEN_COLUMNS } from '../lib/server/ngrpResidencyExport.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')

const FORM = {
  identity: { preferred_email: 'ace@example.com', preferred_phone: '555-0100', cs_employment_status: 'per_diem' },
  education: { school: 'CSUN', program: 'BSN', degree_type: 'BSN', completion_date: '2026-12-15', gpa: 3.6, us_accredited: true },
  aspire: { aspire_cohort: 'Fall 2026', precepted_unit: 'Other', precepted_unit_other: '=HYPERLINK("x")', rotation_shifts: 12, prior_ngrp_applied: false, prior_ngrp_details: '' },
  licensure: { ca_rn_status: 'pending', license_number: '', nclex_scheduled_date: '2027-01-10', paid_rn_months: 0, bls_status: 'active', bls_issuer: 'AHA', bls_expiration: '2028-01-01', acls_required: false, acls_status: null, acls_issuer: '', acls_expiration: null },
  residency_interest: { interest: 'interested', unit_preferences: ['5 North', '6 South'], interest_statement: 'I want to stay, "truly".', strengths_statement: 'Calm,\nsteady.' },
  readiness: { resume: true, recommendation_letters: false },
  attestation: { accurate: true, consent_followup: true, consent_hr_share: true },
}
const CYCLE = {
  id: 'cy1', name: 'Winter 2027 Residency',
  application_checklist: [{ key: 'resume', label: 'Resume uploaded' }, { key: 'references', label: 'Two references' }],
}
const STUDENTS = [
  { id: 's2', first_name: 'Bea', last_name: 'Zed', school: 'APU', school_email: 'bea@school.edu', personal_email: 'bea@home.com', status: 'Completed' },
  { id: 's1', first_name: 'Ace', last_name: 'Capati', preferred_first_name: 'Ace', school: 'CSUN', program_type: 'BSN', aspire_cohort: 'Fall 2026', school_email: 'ace@school.edu', personal_email: 'ace@home.com', status: 'Completed' },
]
const CANDIDATES = [
  { id: 'k1', student_id: 's1', assignment_id: 'a1', form_status: 'submitted', form_submitted_at: '2026-09-10T18:00:00Z', form_revision_count: 1, eligibility_calculated: 'eligible', application_status: 'not_confirmed' },
]

const build = (over = {}) => transitionWorkbookRows({
  students: STUDENTS, candidates: CANDIDATES, revisionsByAssignment: new Map([['a1', FORM]]), ...over,
})
const cellOf = ({ header, rows }, rowIndex, h) => rows[rowIndex][header.findIndex(x => x.startsWith(h))]

test('submitted responses only, one row per alumnus, oldest first with the Id counting them', () => {
  const later = { id: 'k2', student_id: 's2', assignment_id: 'a2', form_status: 'revised', form_submitted_at: '2026-09-01T18:00:00Z', form_revised_at: '2026-09-11T18:00:00Z', form_revision_count: 2 }
  const notIn = { id: 'k3', student_id: 's3', assignment_id: 'a3', form_status: 'in_progress', form_revision_count: 0 }
  const t = build({
    students: [...STUDENTS, { id: 's3', first_name: 'Cy', last_name: 'Noform', status: 'Completed' }],
    candidates: [later, ...CANDIDATES, notIn],
    revisionsByAssignment: new Map([['a1', FORM], ['a2', FORM]]),
  })
  assert.equal(t.rows.length, 2, 'an unsubmitted form is not a row')
  assert.equal(cellOf(t, 0, 'Full Legal Name'), 'Capati, Ace')
  assert.deepEqual(cellOf(t, 0, 'Id'), { n: 1 })
  assert.equal(cellOf(t, 1, 'Full Legal Name'), 'Zed, Bea', 'a revision dates from when it was revised')
  assert.deepEqual(cellOf(t, 1, 'Id'), { n: 2 })
})

test('the sample order and its answers; Third Choice added; questions the form never asked left out', () => {
  const t = build()
  assert.deepEqual(t.header.slice(0, 3), ['Id', 'Completion time', 'Full Legal Name (Last Name, First Name)'])
  assert.equal(FROZEN_COLUMNS, 3)
  assert.equal(cellOf(t, 0, 'Completion time'), '9/10/2026 11:00 AM', 'Pacific')
  assert.equal(cellOf(t, 0, 'Phone Number'), '555-0100')
  assert.equal(cellOf(t, 0, 'Email Address'), 'ace@example.com')
  assert.equal(cellOf(t, 0, 'Are you currently employed'), 'Yes, per diem')
  assert.equal(cellOf(t, 0, 'Date of Graduation'), '12/15/2026')
  assert.equal(cellOf(t, 0, 'Unit where you completed'), '=HYPERLINK("x")', 'an Other unit reads what they wrote')
  assert.deepEqual(cellOf(t, 0, 'ASPIRE shifts'), { n: 12 })
  assert.equal(cellOf(t, 0, 'Have you passed the NCLEX-RN?'), 'No')
  assert.equal(cellOf(t, 0, 'Have you scheduled your NCLEX?'), 'Yes')
  assert.equal(cellOf(t, 0, 'Scheduled Test Date'), '1/10/2027')
  assert.equal(cellOf(t, 0, 'First Choice Unit'), '5 North')
  assert.equal(cellOf(t, 0, 'Second Choice Unit'), '6 South')
  assert.ok(t.header.includes('Third Choice Unit'))
  assert.equal(cellOf(t, 0, 'Why are you interested'), 'I want to stay, "truly".')
  const i = h => t.header.findIndex(x => x.endsWith(h))
  assert.equal(t.rows[0][i('Updated professional résumé (within the last 3 months)')], 'Yes')
  assert.equal(t.rows[0][i('At least two letters of recommendation')], 'No')
  assert.equal(t.rows[0][i('Current BLS certification')], 'Yes')
  assert.equal(t.rows[0][i('RN license (if applicable)')], 'N/A')
  assert.equal(t.rows[0][i('Your cumulative GPA 3.0 or above')], 'Yes')
  for (const gone of ['What unit/department?', 'Role/Position', 'License Issuance Date', 'Interim Permit', 'Have you completed your nursing program?']) {
    assert.ok(!t.header.some(h => h.includes(gone)), gone)
  }
})

test("the GPA is the form's, as a number, and the record's GPA never reaches the file", () => {
  const t = build({ students: STUDENTS.map(s => ({ ...s, cumulative_gpa: 2.1 })) })
  assert.deepEqual(cellOf(t, 0, 'Cumulative GPA'), { n: 3.6 })
  assert.ok(!JSON.stringify(t).includes('2.1'))
})

test('no student-record emails, no ids, no preceptor feedback', () => {
  // FIT-RULES-2 (2026-11-02): the Fit columns name the score's Preceptor Feedback FACTOR (its
  // points, which the score dialog already shows both audiences). That header is the one allowed
  // mention; no feedback content may reach the file.
  const blob = JSON.stringify(build()).replace('Fit: Preceptor Feedback (of 30)', '')
  for (const leak of ['ace@school.edu', 'ace@home.com', 'bea@school.edu', 'bea@home.com', 'k1', '"a1"', 'cy1', 'preceptor', 'Preceptor']) {
    assert.ok(!blob.includes(leak), `leaked ${leak}`)
  }
})

test('a real .xlsx: answers are text and cannot run, the name columns are frozen, the file names the cohort', () => {
  const { bytes, fileName } = buildTransitionWorkbook({
    cycle: { name: 'Winter 2027 / Residency' }, students: STUDENTS, candidates: CANDIDATES, revisionsByAssignment: new Map([['a1', FORM]]),
  })
  assert.equal(fileName, 'ASPIRE to NGRP Transition Form - Winter 2027 Residency.xlsx')
  assert.equal(bytes.subarray(0, 2).toString(), 'PK')
  const xml = Buffer.from(bytes).toString('utf8')
  assert.match(xml, /xSplit="3" topLeftCell="D2"/)
  assert.ok(!/<f>/.test(xml), 'no formula anywhere')
  assert.match(xml, /t="inlineStr"><is><t xml:space="preserve">=HYPERLINK\(&quot;x&quot;\)/, 'the formula-looking answer is an inline string')
  assert.match(xml, /<v>3\.6<\/v>/)
})

test('latest revisions: only the current revision of each submitted form, in one read', async () => {
  const calls = []
  const db = {
    from: table => ({
      select: () => ({
        in: (col, ids) => {
          calls.push({ table, col, ids })
          return Promise.resolve({ data: [
            { assignment_id: 'a1', revision_number: 1, payload: { old: true } },
            { assignment_id: 'a1', revision_number: 2, payload: FORM },
          ], error: null })
        },
      }),
    }),
  }
  const { byAssignment } = await fetchLatestRevisions(db, [
    { assignment_id: 'a1', form_revision_count: 2 }, { assignment_id: 'a2', form_revision_count: 0 },
  ])
  assert.deepEqual(calls, [{ table: 'ngrp_transition_revisions', col: 'assignment_id', ids: ['a1'] }])
  assert.equal(byAssignment.get('a1'), FORM)
  assert.deepEqual(await fetchLatestRevisions(db, []), { byAssignment: new Map() })
})

test('Talent Acquisition downloads from the roster it sees; the endpoint builds from that view', () => {
  const ws = read('api/ngrp-workspace.js')
  const narrowAt = ws.indexOf('narrowPayloadForTalentAcquisition(payload)')
  const exportAt = ws.indexOf("if (action === 'export')")
  assert.ok(narrowAt > 0 && exportAt > narrowAt, 'export runs on the narrowed view')
  assert.match(ws, /buildTransitionWorkbook\(\{\s*cycle: payload\.cycle, students: view\.students, candidates: view\.candidates,/)
})

test('Download Excel replaced Download CSV, for both audiences', () => {
  // APPLICANT-SHEET-1 (2026-11-02): the table's button is Sheet now, and Download Excel lives in
  // the Sheet (src/components/ngrp/ApplicantSheet.jsx), exporting what the Sheet shows.
  const tab = read('src/components/ngrp/ProfilesTab.jsx')
  assert.ok(!/Download CSV|downloadCSV|Download Excel'\}/.test(tab))
  const sheet = read('src/components/ngrp/ApplicantSheet.jsx')
  assert.match(sheet, /\{downloading \? 'Preparing Excel…' : 'Download Excel'\}/)
  assert.match(read('src/lib/ngrp/useNgrpData.js'), /authedPost\('\/api\/ngrp-workspace', 'export', \{ cycle_id: cycleId \}\)/)
})
