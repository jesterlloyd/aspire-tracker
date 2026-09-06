// test/grantPortalRegrant.test.mjs
//
// GRANT-STUDENT-REGRANT-1 (2026-09-05). The Owner re-granting a student login to their own
// address found the Grant button disabled with no explanation. Four gates decide that button
// (student picked, name, valid login email, scope); two of them were silent. Pins: Renew /
// Edit preloads the linked student; a stored address is prefilled only when it would pass;
// an invalid typed address is named; the picker tells a student-role user that the record is
// required and the login email is a separate field; the footer names the gate that holds.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const modal = readFileSync(join(here, '..', 'src/components/settings/GrantPortalAccessModal.jsx'), 'utf8')

test('Renew / Edit for a student account starts on the linked student, never replacing a picked one', () => {
  assert.match(modal, /const linkedStudentId = initial\?\.portal_role === 'student' \? \(initial\?\.scope\?\.students\?\.\[0\]\?\.student_id \|\| null\) : null/)
  assert.match(modal, /\.eq\('id', linkedStudentId\)\s*\.maybeSingle\(\)/)
  assert.match(modal, /setStudent\(current => current \|\| data\)/)
  // The preload selects exactly the columns the picker's own search selects.
  const cols = "'id, first_name, last_name, preferred_first_name, school, cohort_id, status, school_email, personal_email, matched_unit_id'"
  assert.equal(modal.split(cols).length - 1, 2, 'the picker search and the preload share one column list')
})

test('a stored address is prefilled only when it would pass the validator', () => {
  assert.match(modal, /const em = bestStudentLoginEmail\(s, null\)/)
  assert.match(modal, /if \(em && isValidEmail\(em\)\) setEmail\(em\)/)
  assert.match(modal, /const emailInvalid = !!email\.trim\(\) && !emailValid/)
  assert.match(modal, /Enter a valid login email, for example name@school\.edu\. It does not have to be a saved contact\./)
})

test('the picker explains a no-match for a student login', () => {
  assert.match(modal, /No ASPIRE student record has this email\. Search the student by name, then enter this address as the login email below\./)
  assert.match(modal, /No matching ASPIRE student\. A student login must be linked to a student record; search by name or school\./)
  // The contacts-only picker keeps its original copy.
  assert.match(modal, /'No matching student or contact found\. You can continue by entering the details manually\.'/)
  assert.match(modal, /\{showNoMatch && <div[^>]*>\{noMatchCopy\}<\/div>\}/)
})

test('the footer names the one gate that holds the button', () => {
  assert.match(modal, /const blockingReason = formValid \|\| loading \? null/)
  for (const reason of [
    'Pick the ASPIRE student record this login opens.',
    'Enter the name for the invitation.',
    'The login email is not a valid address.',
    'Enter a login email. Any address works.',
    'Pick at least one unit.',
    'Pick at least one school.',
  ]) assert.ok(modal.includes(reason), `names: ${reason}`)
  assert.match(modal, /\{blockingReason && \(\s*<span role="status"/)
  // The gates themselves are unchanged: the button still needs every one of them.
  assert.match(modal, /const formValid = !!fullName\.trim\(\) && emailValid && !!role && scopeValid && !loading/)
})
