// PHASE2-ACCESS: static guard for the refactored portal invitation endpoint.
// Verifies Owner/Admin gating, role/scope validation, the pre-auth conflict
// check, that all authorization writes go through the provision_portal_access
// RPC (never four separate inserts), compensation limited to a newly created
// auth user, the 201/200/409/400 status contract, and no secret leakage.
//
// Run: node --test test/invitePortalUserLifecycle.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '../api/invite-portal-user.js'), 'utf8')

test('invite-portal-user failure-safe lifecycle', async (t) => {
  await t.test('only owners and admins may invite', () => {
    assert.match(src, /if \(!\(auth\.isOwner \|\| auth\.role === 'admin'\)\)/, 'owner/admin gate present')
  })

  await t.test('portal role is allow-listed and student requires a student_id', () => {
    assert.match(src, /const PORTAL_ROLES = \['student', 'unit_leader', 'academic_partner', 'nursing_academic'\]/)
    assert.match(src, /student_id is required for a student invitation/, 'student_id required for student role')
  })

  await t.test('a conflict is checked BEFORE any auth work (clean 409, not a partial 500)', () => {
    const conflictIdx = src.indexOf('already linked to a portal account')
    // The auth account is now created via generateLink (branded email), not inviteUserByEmail.
    const inviteIdx = src.indexOf('admin.generateLink')
    const rpcIdx = src.indexOf("rpc('provision_portal_access'")
    assert.ok(conflictIdx > 0, 'conflict pre-check present')
    assert.ok(inviteIdx > 0, 'auth account created via generateLink')
    assert.ok(conflictIdx < inviteIdx, 'conflict check precedes the auth account creation')
    assert.ok(conflictIdx < rpcIdx, 'conflict check precedes provisioning')
    // The conflict is scoped to a DIFFERENT profile so a self re-invite is allowed.
    assert.match(src, /activeLink\.user_profile_id !== existingProfile\?\.id/, 'conflict scoped to a different profile')
  })

  await t.test('all authorization writes go through the provision RPC, not separate inserts', () => {
    assert.match(src, /rpc\('provision_portal_access'/, 'calls provision_portal_access')
    // No direct writes to the four authorization tables from the endpoint.
    for (const tbl of ['user_role_grants', 'user_student_links', 'user_unit_scopes', 'user_school_scopes']) {
      assert.doesNotMatch(src, new RegExp(`from\\(\\s*['"\`]${tbl}['"\`]\\s*\\)[\\s\\S]{0,40}\\.insert`),
        `endpoint must not insert into ${tbl} directly`)
    }
  })

  await t.test('renewal reuses an existing auth account instead of failing', () => {
    assert.match(src, /existingProfile\?\.auth_user_id/, 'reuses an existing linked auth account')
    assert.match(src, /createdAuthUser = true/, 'flags only newly created auth users')
  })

  await t.test('compensation deletes ONLY a newly created auth user', () => {
    // deleteUser must be guarded by createdAuthUser.
    const guardMatches = src.match(/if \(createdAuthUser\)\s*\{[\s\S]*?deleteUser\(authUserId\)/g) || []
    assert.ok(guardMatches.length >= 1, 'auth deletion is guarded by createdAuthUser')
    // There is no unguarded deleteUser call.
    assert.doesNotMatch(src, /deleteUser\([^)]*\)\s*;?\s*\n\s*(?:const|return)[^]*?createdAuthUser/,
      'no unconditional auth deletion')
    // Never delete a user_profiles row.
    assert.doesNotMatch(src, /from\(\s*['"`]user_profiles['"`]\s*\)[\s\S]{0,40}\.delete\(/, 'must not delete profiles')
  })

  await t.test('status contract: 201 new, 200 renewal, 409 conflict, 400 invalid', () => {
    assert.match(src, /createdAuthUser \? 201 : 200/, '201 for new account, 200 for renewal')
    assert.match(src, /status\(409\)/, 'returns 409 on conflict')
    assert.match(src, /status\(400\)/, 'returns 400 on invalid input')
    // RPC conflict code maps to 409.
    assert.match(src, /code === 'PT409'[\s\S]*?status\(409\)/, 'PT409 maps to 409')
  })

  await t.test('does not leak service-role secrets or raw db errors to the client', () => {
    // Responses use generic messages; error bodies never echo rpcErr.message.
    assert.doesNotMatch(src, /json\(\{[^}]*rpcErr\.message/, 'must not return raw rpc error text')
    assert.doesNotMatch(src, /json\(\{[^}]*SERVICE_ROLE/i, 'must not return the service-role key')
  })
})
