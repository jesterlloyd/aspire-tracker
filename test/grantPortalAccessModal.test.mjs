// ASPIRE-PORTAL-ACCESS-UI: static-source guards for the Grant Portal Access
// modal. Confirms the three portal roles, per-role scope requirements, the
// login-email vs student-record separation, correct per-role payloads to
// /api/invite-portal-user, duplicate-submit prevention, the review step, and the
// full outcome-code handling. It must never write authorization tables directly.
// Run: node --test test/grantPortalAccessModal.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '../src/components/settings/GrantPortalAccessModal.jsx'), 'utf8')

test('Grant Portal Access modal', async (t) => {
  await t.test('is separate from the staff invitation workflow', () => {
    assert.doesNotMatch(src, /invite-user\b(?!-portal)/, 'must not call the staff invite endpoint')
    assert.doesNotMatch(src, /InviteUserModal/)
    assert.match(src, /\/api\/invite-portal-user/)
  })

  await t.test('offers all three portal roles', () => {
    assert.match(src, /PORTAL_ROLE_OPTIONS/)
    assert.match(src, /id="gpa-role"/)
  })

  await t.test('per-role scope requirements are enforced', () => {
    assert.match(src, /role === 'student' \? !!student/, 'student requires exactly one student record')
    assert.match(src, /role === 'unit_leader' \? unitKeys\.length > 0/, 'unit leader requires >=1 unit')
    assert.match(src, /role === 'academic_partner' \? schoolKeys\.length > 0/, 'academic partner requires >=1 school')
  })

  await t.test('login email is explained as separate from the student record', () => {
    assert.match(src, /does not have to match an email stored on the linked ASPIRE student record/)
  })

  await t.test('sends the correct payload shape per role', () => {
    assert.match(src, /if \(role === 'student'\) base\.student_id = student\?\.id/)
    assert.match(src, /if \(role === 'unit_leader'\) \{ base\.unit_keys = unitKeys/)
    assert.match(src, /if \(role === 'academic_partner'\) \{ base\.school_keys = schoolKeys/)
    assert.match(src, /base\.expires_at = /)
  })

  await t.test('prevents duplicate submission while pending', () => {
    assert.match(src, /if \(!formValid \|\| loading\) return/)
    assert.match(src, /disabled=\{loading \|\| !formValid\}/)
  })

  await t.test('has a review step before submitting', () => {
    assert.match(src, /step === 'review'/)
    assert.match(src, /Review portal access/)
    assert.match(src, /scoped portal access/)
  })

  await t.test('handles every invitation outcome code', () => {
    assert.match(src, /res\.status === 201[\s\S]*?Portal invitation sent and access granted/)
    assert.match(src, /res\.status === 200[\s\S]*?grant_action/)
    assert.match(src, /res\.status === 409[\s\S]*?already linked to another active portal account/)
    assert.match(src, /res\.status === 400/)
    assert.match(src, /res\.status === 401 \|\| res\.status === 403[\s\S]*?Owner or Admin authorization is required/)
    // grant_action variants surface distinct messages.
    for (const a of ['created', 'reused', 'renewed', 'reissued']) {
      assert.match(src, new RegExp(`${a}:`), `missing 200 message for grant_action ${a}`)
    }
  })

  await t.test('never writes authorization tables directly', () => {
    for (const tbl of ['user_role_grants', 'user_student_links', 'user_unit_scopes', 'user_school_scopes']) {
      assert.doesNotMatch(src, new RegExp(`from\\(\\s*['"\`]${tbl}`), `must not touch ${tbl}`)
    }
    assert.doesNotMatch(src, /auth_user_id/)
  })
})
