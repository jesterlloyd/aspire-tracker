// AP-STUDENT-RECORDS-1 (Owner, 2026-11-08): an Academic Partner opens one of its own students. The
// profile is an allowlist (contact and GPA widened by the Owner; never DOB, SSN, gender, résumé or
// program_type); three answers can be corrected and the student's own answer is kept; the clearance
// checklist is filed, never reviewed. The roster endpoint's own privacy pin is unchanged.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PROFILE_COLUMNS, FORBIDDEN_PROFILE_FIELDS, cleanCorrection, shapeProfile, CORRECTABLE,
} from '../src/lib/ap/schoolStudentProfile.js'
import { clearanceRows, clearanceSummary, isExpired, cleanItemLabel } from '../src/lib/ap/clearanceChecklist.js'
import { createSchoolStudentRecordsHandler } from '../api/portal/school-student-records.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const ROW = {
  id: 's1', cohort_id: 'c1', school: 'UCLA', status: 'Placed', first_name: 'Maria', preferred_first_name: 'Mia', last_name: 'Lopez',
  school_email: 'mlopez@ucla.edu', personal_email: 'mia@example.com', phone: '555-0100', cumulative_gpa: 3.62,
  prior_healthcare_experience: 'CNA, 2 years', unit_preference_1: '8 SCCT', unit_preference_2: '5 North',
  shift_availability: 'Day', weekends_available: true, nights_available: false, preferred_days: ['Mon', 'Tue'],
  interest_statement: 'I want to learn.', headshot_url: 'x/headshot.jpg', expected_graduation: '2027-05-15',
  date_of_birth: '2001-01-01', ssn_last4: '1234', gender: 'F', resume_url: 'x/resume.pdf', program_type: 'ADN',
}

test('the allowlist never selects a forbidden field, and the shaped profile never carries one', () => {
  for (const f of ['date_of_birth', 'ssn', 'ssn_last4', 'gender', 'resume_url', 'program_type']) {
    assert.ok(!PROFILE_COLUMNS.includes(f), `${f} is not selected`)
  }
  const p = shapeProfile(ROW, { cohort: { id: 'c1', name: 'Fall 2026' }, unitName: '8 SCCT', graduationEnabled: true })
  const json = JSON.stringify(p)
  for (const f of FORBIDDEN_PROFILE_FIELDS) assert.ok(!json.includes(`"${f}"`), `${f} is not sent`)
  assert.doesNotMatch(json, /2001-01-01|1234|"F"|resume\.pdf|ADN|headshot\.jpg/)
  assert.equal(p.assigned_unit, 'Neuroscience ICU', 'a school reads the plain unit name')
  assert.deepEqual(p.preferences, ['Neuroscience ICU', 'Cardiac Progressive Care'])
  assert.equal(p.contact.school_email, 'mlopez@ucla.edu')
  assert.equal(p.academics.cumulative_gpa, 3.62)
  assert.equal(p.availability.weekends, 'Yes')
  assert.equal(p.availability.nights, 'No')
})

test('expected graduation is hidden until its column exists', () => {
  assert.equal(shapeProfile(ROW, { graduationEnabled: false }).academics.expected_graduation, undefined)
})

test('a correction keeps the student\'s first answer, however many corrections follow', () => {
  const p = shapeProfile(ROW, { corrections: [
    { field: 'cumulative_gpa', old_value: '3.4', new_value: '3.5', corrected_by_name: 'A', created_at: '2026-11-01T00:00:00Z' },
    { field: 'cumulative_gpa', old_value: '3.5', new_value: '3.62', corrected_by_name: 'B', created_at: '2026-11-02T00:00:00Z' },
  ] })
  assert.deepEqual(p.corrections.cumulative_gpa, { studentAnswer: '3.4', correctedBy: 'B', correctedAt: '2026-11-02T00:00:00Z' })
  assert.equal(p.corrections.school_email, undefined)
})

test('only three answers are correctable, and only graduation can be set for a cohort', () => {
  assert.deepEqual(Object.keys(CORRECTABLE).sort(), ['cumulative_gpa', 'expected_graduation', 'school_email'])
  assert.deepEqual(Object.keys(CORRECTABLE).filter(k => CORRECTABLE[k].cohortWide), ['expected_graduation'])
  assert.deepEqual(cleanCorrection('phone', '1'), { error: 'field_not_correctable' })
  assert.deepEqual(cleanCorrection('school_email', ' A@UCLA.EDU '), { value: 'a@ucla.edu' })
  assert.deepEqual(cleanCorrection('school_email', ''), { error: 'school_email_required' })
  assert.deepEqual(cleanCorrection('school_email', 'nope'), { error: 'invalid_email' })
  assert.deepEqual(cleanCorrection('cumulative_gpa', '3.75'), { value: 3.75 })
  assert.deepEqual(cleanCorrection('cumulative_gpa', '4.5'), { error: 'invalid_gpa' })
  assert.deepEqual(cleanCorrection('cumulative_gpa', '3.755'), { error: 'invalid_gpa' })
  assert.deepEqual(cleanCorrection('cumulative_gpa', ''), { value: null })
  assert.deepEqual(cleanCorrection('expected_graduation', '2027-05-15'), { value: '2027-05-15' })
  assert.deepEqual(cleanCorrection('expected_graduation', 'May 2027'), { error: 'invalid_date' })
})

test('clearance: filed, no review; required items count, a school\'s own items never do', () => {
  const types = [
    { key: 'clr_tb', label: 'TB Screening', required: true, check_kind: 'expiry_date', school_key: null },
    { key: 'clr_bls', label: 'BLS Card', required: true, check_kind: 'expiry_date', school_key: null },
    { key: 'sc_abc', label: 'Liability Insurance', required: false, check_kind: 'file', school_key: 'UCLA' },
  ]
  const docs = [{ id: 'd1', doc_type: 'clr_tb', current_version_id: 'v2' }]
  const versions = [
    { id: 'v2', document_id: 'd1', file_name: 'tb-2026.pdf', uploaded_at: '2026-10-02', doc_date: '2026-01-01', uploaded_via: 'school' },
    { id: 'v1', document_id: 'd1', file_name: 'tb-2025.pdf', uploaded_at: '2025-10-02', doc_date: '2025-01-01', uploaded_via: 'school' },
  ]
  const rows = clearanceRows(types, docs, versions)
  assert.equal(rows[0].current.file_name, 'tb-2026.pdf')
  assert.equal(rows[0].versions.length, 2, 'every version is kept')
  assert.equal(rows[2].own, true)
  assert.deepEqual(clearanceSummary(rows), { required: 2, onFile: 1, missing: ['BLS Card'], complete: false })
  assert.equal(isExpired(rows[0], '2026-11-08'), true)
  assert.equal(isExpired(rows[0], '2025-12-31'), false)
  assert.deepEqual(cleanItemLabel('  Liability   Insurance ', ''), { label: 'Liability Insurance', qualifier: null })
  assert.deepEqual(cleanItemLabel('', ''), { error: 'label_required' })
})

const res = () => {
  const r = { code: 0, body: null, headers: {} }
  r.status = (c) => { r.code = c; return r }
  r.json = (b) => { r.body = b; return r }
  r.end = () => r
  r.setHeader = (k, v) => { r.headers[k] = v }
  return r
}

test('API: the roster\'s own gate; a staff preview never writes; unknown actions are refused', async () => {
  const denied = createSchoolStudentRecordsHandler({ verifyCaller: async () => ({ ok: false, status: 403, reason: 'forbidden' }) })
  let r = res(); await denied({ method: 'GET', query: { action: 'profile', student_id: 'x' } }, r)
  assert.equal(r.code, 403)
  const preview = createSchoolStudentRecordsHandler({ verifyCaller: async () => ({ ok: true, db: { storage: {} }, scopes: [], profile: { id: 'p' }, staffPreview: true }) })
  for (const action of ['correct', 'item_add', 'item_retire', 'upload_start', 'upload_finish']) {
    r = res(); await preview({ method: 'POST', body: { action } }, r)
    assert.equal(r.code, 403, action)
    assert.equal(r.body.error, 'preview_read_only')
  }
  r = res(); await preview({ method: 'GET', query: { action: 'nope' } }, r)
  assert.equal(r.code, 400)
  assert.match(read('api/portal/school-student-records.js'), /verifyPortalAcademicPartnerCaller/)
})

test('the server checks every student id against the caller\'s scopes, and Residency keeps its checklist', () => {
  const src = read('lib/server/schoolStudentRecords.js')
  assert.match(src, /matchSchoolCohortScope\(scopes, r\.data\.school, r\.data\.cohort_id\)/)
  assert.match(src, /via: 'school'/)
  const docs = read('lib/server/studentDocuments.js')
  assert.match(docs, /checklist = 'ngrp'/, 'Residency reads the ngrp checklist by default')
  const mig = read('supabase/migrations/20261204000000_ap_student_records.sql')
  assert.match(mig, /checklist text NOT NULL DEFAULT 'ngrp'/)
  assert.match(mig, /school_key IS NULL OR \(checklist = 'clearance' AND required = false\)/)
  assert.match(mig, /GRANT SELECT, INSERT ON TABLE public\.student_record_corrections TO service_role/)
})

test('the portal opens the record from the roster row', () => {
  const page = read('src/portal/AcademicPartnerPortal.jsx')
  assert.match(page, /<SchoolStudentDrawer student=\{openStudent\}/)
  const drawer = read('src/portal/ap/SchoolStudentDrawer.jsx')
  assert.match(drawer, /confirmLabel: 'Change for everyone', cancelLabel: 'Only this student'/)
})
