// ASPIRE-PORTAL-STUDENT-PICKER: pure-logic tests for contact-category -> portal
// role inference and student login-email priority, plus static-source guards that
// the Grant Portal Access modal infers the role (without the removed note),
// validates only the active role, and preserves manual role choices.
// Run: node --test test/portalRoleInference.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { inferPortalRoleFromContact, bestStudentLoginEmail } from '../src/lib/contactSearchCore.js'

const here = dirname(fileURLToPath(import.meta.url))
const modal = readFileSync(join(here, '../src/components/settings/GrantPortalAccessModal.jsx'), 'utf8')

test('inferPortalRoleFromContact maps supported categories only', async (t) => {
  await t.test('Unit Leadership -> unit_leader', () => {
    assert.equal(inferPortalRoleFromContact({ category: 'Unit Leadership' }), 'unit_leader')
    assert.equal(inferPortalRoleFromContact({ role: 'Assistant Nurse Manager' }), 'unit_leader')
  })
  await t.test('Academic Partners -> academic_partner', () => {
    assert.equal(inferPortalRoleFromContact({ category: 'Academic Partners' }), 'academic_partner')
    assert.equal(inferPortalRoleFromContact({ role: 'Clinical Placement Coordinator' }), 'academic_partner')
  })
  await t.test('a stored Student category -> student', () => {
    assert.equal(inferPortalRoleFromContact({ category: 'Student' }), 'student')
  })
  await t.test('unsupported / ambiguous -> null (preserve current role)', () => {
    for (const cat of ['Preceptors', 'BNI Team', 'Nursing Executives', 'Other']) {
      assert.equal(inferPortalRoleFromContact({ category: cat }), null)
    }
    assert.equal(inferPortalRoleFromContact({}), null)
    assert.equal(inferPortalRoleFromContact(null), null)
  })
})

test('bestStudentLoginEmail priority: contact email -> school -> personal', async (t) => {
  await t.test('school email first when picking a student record directly (no contact)', () => {
    assert.equal(bestStudentLoginEmail({ school_email: 's@x.edu', personal_email: 'p@x.com' }, null), 's@x.edu')
  })
  await t.test('personal email when no school email', () => {
    assert.equal(bestStudentLoginEmail({ school_email: '', personal_email: 'p@x.com' }, null), 'p@x.com')
  })
  await t.test('null when none available (manual entry required)', () => {
    assert.equal(bestStudentLoginEmail({ school_email: null, personal_email: '' }, null), null)
  })
})

test('Grant modal role inference and active-role validation', async (t) => {
  await t.test('the removed role-detection note no longer renders', () => {
    assert.doesNotMatch(modal, /Role detected from saved contact/)
    assert.doesNotMatch(modal, /roleDetected/)
  })

  await t.test('contact selection infers the role, unsupported preserves it', () => {
    assert.match(modal, /const inferred = inferPortalRoleFromContact\(c\)/)
    assert.match(modal, /const targetRole = inferred \|\| role/)
    assert.match(modal, /if \(inferred\) setRole\(targetRole\)/)
    // The role selector stays editable (not disabled by inference).
    assert.match(modal, /<select id="gpa-role" value=\{role\} disabled=\{isRenew\}/)
  })

  await t.test('validation evaluates ONLY the active role scope + a valid email', () => {
    assert.match(modal, /role === 'student' \? !!student :/)
    assert.match(modal, /role === 'unit_leader' \? unitKeys\.length > 0 :/)
    assert.match(modal, /role === 'academic_partner' \? schoolKeys\.length > 0 :/)
    // NURSING-ACADEMICS-1: the org-wide role is valid with no scope selection.
    assert.match(modal, /role === 'nursing_academic' \? true : false/)
    assert.match(modal, /const emailValid = isValidEmail\(email\)/)
    assert.match(modal, /const formValid = !!fullName\.trim\(\) && emailValid && !!role && scopeValid/)
  })

  await t.test('the active role renders only its own scope control (no cross-role block)', () => {
    assert.match(modal, /role === 'student' && student \?[\s\S]*?role === 'student' \?[\s\S]*?IdentityPicker/)
    assert.match(modal, /\{role === 'unit_leader' && \([\s\S]*?Assigned units/)
    assert.match(modal, /\{role === 'academic_partner' && \([\s\S]*?Assigned schools/)
  })

  await t.test('changing away from Student deactivates the internal student_id', () => {
    assert.match(modal, /if \(next !== 'student'\) setStudent\(null\)/)
  })

  await t.test('a new contact clears stale scope guards so suggestions refresh', () => {
    assert.match(modal, /setUnitTouched\(false\); setSchoolTouched\(false\); setStudentTouched\(false\)/)
  })
})
