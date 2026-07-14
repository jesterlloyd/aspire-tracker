// ASPIRE-PORTAL-ROLE-INFERENCE: pure-logic tests for contact-category -> portal
// role inference and the student login-email priority, plus static-source guards
// that the Grant Portal Access modal changes the role on contact selection,
// validates only the active role's scope, and autofills identity from a selected
// student record.
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
  await t.test('Unit Leadership -> unit_leader (stored category)', () => {
    assert.equal(inferPortalRoleFromContact({ category: 'Unit Leadership' }), 'unit_leader')
  })
  await t.test('Academic Partners -> academic_partner', () => {
    assert.equal(inferPortalRoleFromContact({ category: 'Academic Partners' }), 'academic_partner')
  })
  await t.test('a stored Student category -> student', () => {
    assert.equal(inferPortalRoleFromContact({ category: 'Student' }), 'student')
  })
  await t.test('inferred from role when category is null (Unit Leadership role set)', () => {
    assert.equal(inferPortalRoleFromContact({ role: 'Assistant Nurse Manager' }), 'unit_leader')
    assert.equal(inferPortalRoleFromContact({ role: 'Clinical Placement Coordinator' }), 'academic_partner')
  })
  await t.test('unsupported / ambiguous categories return null (preserve current role)', () => {
    assert.equal(inferPortalRoleFromContact({ category: 'Preceptors' }), null)
    assert.equal(inferPortalRoleFromContact({ category: 'BNI Team' }), null)
    assert.equal(inferPortalRoleFromContact({ category: 'Nursing Executives' }), null)
    assert.equal(inferPortalRoleFromContact({ category: 'Other' }), null)
    assert.equal(inferPortalRoleFromContact({ role: 'Preceptor' }), null)
    assert.equal(inferPortalRoleFromContact({}), null)
    assert.equal(inferPortalRoleFromContact(null), null)
  })
})

test('bestStudentLoginEmail follows the documented priority order', async (t) => {
  await t.test('1: linked contact email wins', () => {
    assert.equal(bestStudentLoginEmail({ school_email: 's@x.edu', personal_email: 'p@x.com' }, 'c@x.com'), 'c@x.com')
  })
  await t.test('2: school email when no contact email', () => {
    assert.equal(bestStudentLoginEmail({ school_email: 's@x.edu', personal_email: 'p@x.com' }, null), 's@x.edu')
  })
  await t.test('3: personal email when no contact or school email', () => {
    assert.equal(bestStudentLoginEmail({ school_email: '', personal_email: 'p@x.com' }, null), 'p@x.com')
  })
  await t.test('null when no reliable email exists (manual entry required)', () => {
    assert.equal(bestStudentLoginEmail({ school_email: null, personal_email: '' }, ''), null)
    assert.equal(bestStudentLoginEmail(null, null), null)
  })
})

test('Grant modal role inference and active-role validation', async (t) => {
  await t.test('contact selection infers the role and shows an editable note', () => {
    assert.match(modal, /const inferred = inferPortalRoleFromContact\(c\)/)
    assert.match(modal, /if \(inferred && inferred !== role\) \{ setRole\(targetRole\); setRoleDetected\(true\) \}/)
    assert.match(modal, /Role detected from saved contact \(editable\)/)
    // The role selector stays editable (not disabled by inference).
    assert.match(modal, /<select id="gpa-role" value=\{role\} disabled=\{isRenew\}/)
  })

  await t.test('unsupported/ambiguous category preserves the current role', () => {
    assert.match(modal, /const targetRole = inferred \|\| role/)
    assert.match(modal, /else if \(!inferred\) setRoleDetected\(false\)/)
  })

  await t.test('validation evaluates ONLY the active role scope', () => {
    assert.match(modal, /role === 'student' \? !!student :/)
    assert.match(modal, /role === 'unit_leader' \? unitKeys\.length > 0 :/)
    assert.match(modal, /role === 'academic_partner' \? schoolKeys\.length > 0 : false/)
    assert.match(modal, /const formValid = !!email\.trim\(\) && !!fullName\.trim\(\) && !!role && scopeValid/)
  })

  await t.test('the student control renders only for the student role (no cross-role block)', () => {
    assert.match(modal, /\{role === 'student' && \([\s\S]*?Linked student record/)
    assert.match(modal, /\{role === 'unit_leader' && \([\s\S]*?Assigned units/)
    assert.match(modal, /\{role === 'academic_partner' && \([\s\S]*?Assigned schools/)
  })

  await t.test('a new contact clears stale scope guards so suggestions refresh', () => {
    assert.match(modal, /setUnitTouched\(false\); setSchoolTouched\(false\); setStudentTouched\(false\)/)
  })
})

test('Grant modal student-record autofill', async (t) => {
  await t.test('selecting a student record sets role, name, and suggested email', () => {
    assert.match(modal, /const onPickStudentRecord = useCallback\(\(s\) => \{/)
    assert.match(modal, /setStudent\(s\)\s*\n\s*setRole\('student'\)/)
    assert.match(modal, /setFullName\(studentName\(s\)\)/)
    assert.match(modal, /const em = bestStudentLoginEmail\(s, null\)/)
    assert.match(modal, /if \(em\) setEmail\(em\)/)
    assert.match(modal, /<StudentPicker value=\{student\} onPick=\{onPickStudentRecord\}/)
  })

  await t.test('missing student email surfaces a manual-entry prompt (email not blanked)', () => {
    assert.match(modal, /const showStudentEmailPrompt = role === 'student' && !!student && !email\.trim\(\)/)
    assert.match(modal, /No email is on file for this student\. Enter a login email manually\./)
  })

  await t.test('student record query includes personal_email for the priority fallback', () => {
    assert.match(modal, /school_email, personal_email, status, cohort_id/)
  })

  await t.test('no invitation is submitted from selection handlers (only /api/invite-portal-user on submit)', () => {
    // Selection handlers set state; the network call lives only in submit().
    assert.match(modal, /const submit = async \(\) => \{[\s\S]*?\/api\/invite-portal-user/)
    assert.doesNotMatch(modal, /onPickStudentRecord[\s\S]{0,400}fetch\(/)
  })
})
