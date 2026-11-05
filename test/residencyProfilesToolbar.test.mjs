// RESIDENCY-PROFILES-TOOLBAR-1 (Owner, 2026-11-03): Residency > Profiles & Interest carries Student
// Profiles' toolbar (Copy visible emails, Send Message to All, Import, Add Alumnus); Talent
// Acquisition may add alumni; Student Profiles' + Add can send the intake form or a portal
// activation. These pin the contact rule (TA only under the form's consent), the import matching
// (never creates, never guesses), the server gates and the wiring.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { shapeRosterContacts, loadRosterContacts } from '../lib/server/ngrpRosterContacts.js'
import { matchImportRows, normalizeImportRow, MAX_IMPORT_ROWS } from '../lib/server/ngrpAlumniImport.js'
import { visibleStudentContacts } from '../src/lib/connect/copyStudentContacts.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = p => readFileSync(join(root, p), 'utf8')

const students = [
  { id: 's1', personal_email: 'one@gmail.com', phone: '(323) 555-0101' },
  { id: 's2', personal_email: 'two@gmail.com', phone: '323-555-0102' },
  { id: 's3', personal_email: null, phone: null },
]
const candidates = [
  { student_id: 's1', form_status: 'submitted', assignment_id: 'a1' },
  { student_id: 's2', form_status: 'sent', assignment_id: 'a2' },
]
const revisions = new Map([['a1', { identity: { preferred_email: 'preferred@me.com' } }]])

test('the ASPIRE team gets every asked-for alumnus; the form preferred email wins', () => {
  const r = shapeRosterContacts({ studentIds: ['s1', 's2', 's3'], students, candidates, revisionsByAssignment: revisions, audience: 'staff' })
  assert.equal(r.withheld, 0)
  assert.deepEqual(r.contacts.map(c => c.email), ['preferred@me.com', 'two@gmail.com', null])
  assert.equal(r.contacts[0].phone, '(323) 555-0101')
})

test('Talent Acquisition gets only alumni who submitted the Transition Form; the rest are counted', () => {
  const r = shapeRosterContacts({ studentIds: ['s1', 's2', 's3'], students, candidates, revisionsByAssignment: revisions, audience: 'talent_acquisition' })
  assert.deepEqual(r.contacts.map(c => c.student_id), ['s1'])
  assert.equal(r.withheld, 2)
})

test('an id off the roster is dropped before any read', async () => {
  let asked = null
  const db = { from: () => ({ select: () => ({ in: (_c, ids) => { asked = ids; return Promise.resolve({ data: students.filter(s => ids.includes(s.id)), error: null }) } }) }) }
  const payload = { students: [{ id: 's1' }], candidates: [] }
  const r = await loadRosterContacts(db, { payload, studentIds: ['s1', 'intruder'], audience: 'staff' })
  assert.deepEqual(asked, ['s1'])
  assert.deepEqual(r.contacts.map(c => c.student_id), ['s1'])
})

test('Copy visible emails takes the address the host decided', () => {
  const r = visibleStudentContacts([{ email: 'a@b.com' }, { email: 'A@b.com' }, { email: null }], 'email', { emailOf: p => p.email })
  assert.deepEqual(r.values, ['a@b.com'])
  assert.equal(r.duplicates, 1)
  assert.equal(r.skipped, 1)
})

const pool = [
  { id: 'a', first_name: 'Emi', last_name: 'Bayaraa', personal_email: 'emi@gmail.com', school_email: 'emi@csula.edu', status: 'Completed', cohort: { name: 'Summer 2025' } },
  { id: 'b', first_name: 'Lauren', last_name: 'Chung', preferred_first_name: 'Lo', personal_email: null, school_email: null, status: 'Completed' },
  { id: 'c', first_name: 'Sam', last_name: 'Lee', status: 'Completed' },
  { id: 'd', first_name: 'Sam', last_name: 'Lee', status: 'Completed' },
  { id: 'e', first_name: 'Ana', last_name: 'Ruiz', status: 'Active Rotation' },
  { id: 'f', first_name: 'Dylan', last_name: 'Cline', status: 'Completed' },
]

test('headers are read loosely; "Last, First" and "First Last" both split', () => {
  assert.deepEqual(normalizeImportRow({ 'First Name': 'Emi', 'Last Name': 'Bayaraa' }), { first_name: 'Emi', last_name: 'Bayaraa', emails: [] })
  assert.deepEqual(normalizeImportRow({ name: 'Bayaraa, Emi' }).last_name, 'Bayaraa')
  assert.deepEqual(normalizeImportRow({ Name: 'Mary Ann Smith' }), { first_name: 'Mary Ann', last_name: 'Smith', emails: [] })
  assert.deepEqual(normalizeImportRow({ Email: ' EMI@Gmail.com ' }).emails, ['emi@gmail.com'])
})

test('a row matches one Completed student by email, else by name; nothing else is written', () => {
  const r = matchImportRows([
    { email: 'EMI@CSULA.EDU' },              // school email, any case
    { first_name: 'Lo', last_name: 'Chung' }, // preferred first name
    { name: 'Sam Lee' },                      // two people
    { name: 'Ana Ruiz' },                     // not completed
    { name: 'Nobody Here' },
    { notes: 'x' },
    { name: 'Dylan Cline' },                  // already on the roster
    { email: 'emi@gmail.com' },               // same person twice in the file
  ], pool, ['f'])
  assert.deepEqual(r.map(x => x.status), ['matched', 'matched', 'ambiguous', 'not_completed', 'not_found', 'blank', 'on_roster', 'on_roster'])
  assert.equal(r[0].student_id, 'a')
  assert.equal(r[0].cohort, 'Summer 2025')
  assert.equal(r[2].student_id, undefined, 'an ambiguous row names nobody')
})

test('the file is capped', () => {
  const rows = Array.from({ length: MAX_IMPORT_ROWS + 20 }, () => ({ name: 'Nobody Here' }))
  assert.equal(matchImportRows(rows, pool, []).length, MAX_IMPORT_ROWS)
})

test('ngrp-manage: TA may search, add and create; remove, invite and import stay Owner/Admin', () => {
  const s = src('api/ngrp-manage.js')
  assert.match(s, /const TA_ALUMNI_ACTIONS = new Set\(\['alumni_search', 'alumni_add', 'alumni_create'\]\)/)
  assert.match(s, /if \(!ownerAdmin && !taAllowed\)/)
  assert.match(s, /isTalentAcquisition \? r\.results\.map\(x => \(\{ \.\.\.x, personal_email: null \}\)\)/, 'a TA search carries no personal email')
  assert.match(s, /new_cohort_name === 'string' && !isTalentAcquisition/, 'TA cannot create a past cohort')
  assert.match(s, /'alumni_import_match', 'alumni_import_add'/)
  // import add re-checks: on the roster or not Completed is skipped, and each add is audited
  assert.match(s, /if \(onRoster\.has\(id\) \|\| !completed\.has\(id\)\) \{ skipped\+\+; continue \}/)
})

test('ngrp-workspace serves contacts through the roster rule', () => {
  const s = src('api/ngrp-workspace.js')
  // STUDENT-HIRE-READ-1 added 'student_hire' after 'contacts' in the action list.
  assert.match(s, /'contacts'[,\]]/)
  assert.match(s, /loadRosterContacts\(db, \{ payload, studentIds: body\.student_ids, audience: caller\.audience \}\)/)
})

test('wiring: Residency toolbar, Add Alumnus for TA, and the + Add follow-up', () => {
  const tab = src('src/components/ngrp/ProfilesTab.jsx')
  assert.match(tab, /<ResidencyRosterActions/)
  assert.match(tab, /const canAddAlumni = canManage && \(ownerAdmin \|\| !staffApp\)/)
  assert.match(tab, /const canImportAlumni = staffApp && ownerAdmin/)
  const actions = src('src/components/ngrp/ResidencyRosterActions.jsx')
  assert.ok(actions.indexOf('Copy visible emails') < actions.indexOf('Send Message to All'))
  assert.ok(actions.indexOf('Send Message to All') < actions.indexOf('↑ Import'))
  assert.ok(actions.indexOf('↑ Import') < actions.indexOf('Add Alumnus'))
  assert.match(actions, /<StudentMessagesSetup/)
  assert.doesNotMatch(actions, /\btitle=/, 'Residency uses the Tooltip, never title')
  const modal = src('src/components/AddStudentModal.jsx')
  assert.match(modal, /useState\('form'\)/, 'the student form is the default')
  const app = src('src/staff/StaffApp.jsx')
  assert.match(app, /source: 'student_profiles_add',\s*templateKey: 'student_profile_invitation'/)
  assert.match(app, /sendStudentPortalInvite\(\{ studentId: data\.id/)
})
