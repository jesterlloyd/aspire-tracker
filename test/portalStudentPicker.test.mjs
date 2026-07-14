// ASPIRE-PORTAL-STUDENT-PICKER: static-source guards for the unified Student
// picker, the removal of the separate linked-record field, student-record
// autofill, and the login-email selection behavior.
// Run: node --test test/portalStudentPicker.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const modal = readFileSync(join(here, '../src/components/settings/GrantPortalAccessModal.jsx'), 'utf8')

test('Unified Student picker', async (t) => {
  await t.test('the separate "Linked student record" field no longer renders', () => {
    assert.doesNotMatch(modal, /Linked student record/)
    assert.doesNotMatch(modal, /function StudentPicker\b/)
  })

  await t.test('the Full name field is a unified Student + Contact picker for the student role', () => {
    assert.match(modal, /function IdentityPicker/)
    assert.match(modal, /<IdentityPicker id="gpa-name"[\s\S]*?includeStudents/)
    assert.match(modal, /onPickStudent=\{onPickStudentRecord\} onPickContact=\{applyContactSelection\}/)
    assert.match(modal, /placeholder="Search students by name or email"/)
  })

  await t.test('the picker searches student name and every approved student email field', () => {
    assert.match(modal, /from\('students'\)[\s\S]*?first_name\.ilike[\s\S]*?last_name\.ilike[\s\S]*?preferred_first_name\.ilike[\s\S]*?school_email\.ilike[\s\S]*?personal_email\.ilike/)
  })

  await t.test('the picker also surfaces saved Contacts with source labels', () => {
    assert.match(modal, /ASPIRE student/)
    assert.match(modal, /Saved contact/)
    assert.match(modal, /kind: 'student'/)
    assert.match(modal, /kind: 'contact'/)
  })

  await t.test('selecting a student stores students.id and populates name; email never changes it', () => {
    assert.match(modal, /const onPickStudentRecord = useCallback\(\(s\) => \{/)
    assert.match(modal, /setStudent\(s\)\s*\n\s*setRole\('student'\)/)
    assert.match(modal, /setFullName\(studentName\(s\)\)/)
    assert.match(modal, /if \(role === 'student'\) base\.student_id = student\?\.id/)
    // Changing the login email is a plain setEmail; it does not touch student.
    assert.doesNotMatch(modal, /setEmail\([^)]*\)[^\n]*setStudent/)
  })

  await t.test('selected student summary renders with Change and Clear', () => {
    assert.match(modal, /role === 'student' && student \?/)
    assert.match(modal, />Change<\/button>/)
    assert.match(modal, />Clear<\/button>/)
    // Summary shows school / cohort / status / placement.
    assert.match(modal, /student\.school, cohortsById\[student\.cohort_id\], student\.status, student\.matched_unit_id \? 'Placed'/)
  })

  await t.test('available student emails render as labeled quick-picks with a default', () => {
    assert.match(modal, /const studentEmailOptions = \(s\)/)
    assert.match(modal, /label: 'School email'/)
    assert.match(modal, /label: 'Personal email'/)
    assert.match(modal, /emails\.map\(e => \(/)
    assert.match(modal, /onClick=\{\(\) => setEmail\(e\.value\)\}/)
    // Default priority (school -> personal) via bestStudentLoginEmail on selection.
    assert.match(modal, /const em = bestStudentLoginEmail\(s, null\)/)
  })

  await t.test('missing student email requires manual entry', () => {
    assert.match(modal, /const showStudentEmailPrompt = role === 'student' && !!student && !email\.trim\(\)/)
    assert.match(modal, /No email is on file for this student\. Enter a login email manually\./)
  })

  await t.test('login email is a plain editable input (not forced to the record email)', () => {
    assert.match(modal, /<input id="gpa-email" type="email" value=\{email\} onChange=\{e => setEmail\(e\.target\.value\)\}/)
    assert.match(modal, /does not have to match an email stored on the linked ASPIRE student record, and changing it never changes the linked student/)
  })

  await t.test('no invitation is submitted from selection handlers (only submit() calls the API)', () => {
    assert.match(modal, /const submit = async \(\) => \{[\s\S]*?\/api\/invite-portal-user/)
    assert.doesNotMatch(modal, /onPickStudentRecord[\s\S]{0,400}fetch\(/)
  })
})
