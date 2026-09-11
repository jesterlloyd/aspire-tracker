// RESIDENCY-PORTAL-3: the Alumni Roster CSV (Owner decision 8, modeled on the
// Community Benefit export). Built server-side from the roster the caller may
// already see; every Transition Form answer; no student-record emails, no ids,
// no preceptor feedback; spreadsheet formulas neutralized.
// Run: node --test test/residencyRosterExport.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { buildResidencyCsv, csvEscape, fetchLatestRevisions } from '../lib/server/ngrpResidencyExport.js'
import { narrowPayloadForTalentAcquisition } from '../lib/server/ngrpTalentAcquisition.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')

const FORM = {
  identity: { preferred_email: 'ace@example.com', preferred_phone: '555-0100', cs_employment_status: 'per_diem' },
  education: { school: 'CSUN', program: 'BSN', degree_type: 'BSN', completion_date: '2026-12-15', gpa: 3.6, us_accredited: true },
  aspire: { aspire_cohort: 'Fall 2026', precepted_unit: 'Other', precepted_unit_other: '=HYPERLINK("x")', rotation_shifts: 12, prior_ngrp_applied: false, prior_ngrp_details: '' },
  licensure: { ca_rn_status: 'pending', license_number: '', nclex_scheduled_date: '2027-01-10', paid_rn_months: 0, bls_status: 'active', bls_issuer: 'AHA', bls_expiration: '2028-01-01', acls_required: false, acls_status: null, acls_issuer: '', acls_expiration: null },
  residency_interest: { interest: 'interested', unit_preferences: ['5 North', '6 South'], interest_statement: 'I want to stay, "truly".', strengths_statement: 'Calm,\nsteady.' },
  readiness: { resume: true, references: false },
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

// A real CSV reader: quoted fields may hold commas, doubled quotes, and newlines.
const parseCsv = text => {
  const rows = []; let row = []; let cur = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++ } else if (ch === '"') q = false; else cur += ch }
    else if (ch === '"') q = true
    else if (ch === ',') { row.push(cur); cur = '' }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
    else cur += ch
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  return rows
}

test('every form answer, the cohort checklist, and the roster status, one row per alumnus', () => {
  const { csv, filename } = buildResidencyCsv({
    cycle: CYCLE, students: STUDENTS, candidates: CANDIDATES, revisionsByAssignment: new Map([['a1', FORM]]),
  })
  assert.equal(filename, 'aspire-residency-winter-2027-residency.csv')
  const records = parseCsv(csv)
  assert.equal(records.length, 3, 'header plus two alumni, the multi-line answer intact')
  const header = records[0]
  for (const h of ['Student', 'Transition Form', 'Eligibility', 'Preferred Email', 'GPA', 'Precepted Unit (Other)',
    'Unit Preference 1', 'Interest Statement', 'Readiness: Resume uploaded', 'Readiness: Two references',
    'Consent to Share with Talent Acquisition']) {
    assert.ok(header.includes(h), h)
  }
  const col = h => header.indexOf(h)
  const ace = records[1]
  assert.equal(ace[col('Student')], 'Ace Capati', 'name order puts Ace first')
  assert.equal(ace[col('Transition Form')], 'submitted')
  assert.equal(ace[col('Submitted')], '2026-09-10')
  assert.equal(ace[col('Eligibility')], 'eligible')
  assert.equal(ace[col('Preferred Email')], 'ace@example.com')
  assert.equal(ace[col('Cedars-Sinai Employment')], 'per diem')
  assert.equal(ace[col('US Accredited')], 'Yes')
  assert.equal(ace[col('Unit Preference 2')], '6 South')
  assert.equal(ace[col('Strengths Statement')], 'Calm,\nsteady.')
  assert.equal(ace[col('Readiness: Resume uploaded')], 'Yes')
  assert.equal(ace[col('Readiness: Two references')], 'No')
  assert.equal(ace[col('Consent to Share with Talent Acquisition')], 'Yes')
  const bea = records[2]
  assert.equal(bea[col('Transition Form')], 'not sent', 'staff rosters include alumni without a form')
  assert.equal(bea[col('Preferred Email')], '')
})

test('no student-record emails, no ids, no preceptor feedback', () => {
  const { csv } = buildResidencyCsv({
    cycle: CYCLE, students: STUDENTS, candidates: CANDIDATES, revisionsByAssignment: new Map([['a1', FORM]]),
  })
  for (const leak of ['ace@school.edu', 'ace@home.com', 'bea@school.edu', 'bea@home.com', 'k1', 'a1', 'cy1', 'preceptor', 'Preceptor']) {
    assert.ok(!csv.includes(leak), `leaked ${leak}`)
  }
})

test('formulas are neutralized and quoting is correct (the Community Benefit rule)', () => {
  assert.equal(csvEscape('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`)
  assert.equal(csvEscape('+1'), "'+1")
  assert.equal(csvEscape('a,b'), '"a,b"')
  assert.equal(csvEscape(3.6), '3.6')
  assert.equal(csvEscape(null), '')
  const { csv } = buildResidencyCsv({
    cycle: CYCLE, students: STUDENTS, candidates: CANDIDATES, revisionsByAssignment: new Map([['a1', FORM]]),
  })
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`))
  assert.ok(csv.includes('"Calm,\nsteady."'))
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

test('Talent Acquisition exports only the narrowed roster; the endpoint builds after narrowing', () => {
  const view = narrowPayloadForTalentAcquisition({ students: STUDENTS, candidates: CANDIDATES })
  const { csv } = buildResidencyCsv({ cycle: CYCLE, students: view.students, candidates: view.candidates })
  assert.equal(csv.trim().split('\n').length, 2, 'header plus the one submitter')
  assert.ok(!csv.includes('Zed'))
  const ws = read('api/ngrp-workspace.js')
  const narrowAt = ws.indexOf('narrowPayloadForTalentAcquisition(payload)')
  const exportAt = ws.indexOf("if (action === 'export')")
  assert.ok(narrowAt > 0 && exportAt > narrowAt, 'export runs on the narrowed view')
  assert.match(ws, /buildResidencyCsv\(\{\s*cycle: payload\.cycle, students: view\.students, candidates: view\.candidates,/)
})

test('the roster header offers Download CSV to both audiences', () => {
  const tab = read('src/components/ngrp/ProfilesTab.jsx')
  assert.match(tab, /downloadCSV\(res\.csv, res\.filename\)/)
  assert.match(tab, /\{exporting \? 'Preparing CSV…' : 'Download CSV'\}/)
  assert.match(read('src/lib/ngrp/useNgrpData.js'), /authedPost\('\/api\/ngrp-workspace', 'export', \{ cycle_id: cycleId \}\)/)
})
