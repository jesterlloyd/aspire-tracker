// PHASE2-ACCESS: static guard for the portal revocation endpoint.
// Verifies Owner/Admin gating, target validation, that revocation runs through
// the revoke_portal_access RPC, that it never deletes the auth user or the
// user_profiles row, idempotent success, and no secret leakage.
//
// Run: node --test test/revokePortalAccess.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '../api/revoke-portal-access.js'), 'utf8')

test('revoke-portal-access endpoint', async (t) => {
  await t.test('only owners and admins may revoke', () => {
    assert.match(src, /if \(!\(auth\.isOwner \|\| auth\.role === 'admin'\)\)/, 'owner/admin gate present')
  })

  await t.test('validates the target profile and role', () => {
    assert.match(src, /A valid user_profile_id is required/, 'requires a valid user_profile_id')
    assert.match(src, /const PORTAL_ROLES = \['student', 'unit_leader', 'academic_partner', 'nursing_academic'\]/)
    assert.match(src, /Role is not permitted/, 'validates the role against the allow-list')
  })

  await t.test('revocation goes through the transactional RPC', () => {
    assert.match(src, /rpc\('revoke_portal_access'/, 'calls revoke_portal_access')
  })

  await t.test('never deletes the auth user or the user_profiles row', () => {
    assert.doesNotMatch(src, /deleteUser/, 'must not delete the auth user')
    assert.doesNotMatch(src, /from\(\s*['"`]user_profiles['"`]\s*\)[\s\S]{0,40}\.delete\(/, 'must not delete profiles')
  })

  await t.test('idempotent success for an already-revoked grant', () => {
    assert.match(src, /already_revoked/, 'reports already-revoked as success')
    assert.match(src, /status\(200\)/, 'returns 200 for idempotent revocation')
  })

  await t.test('does not leak service-role secrets or raw db errors to the client', () => {
    assert.doesNotMatch(src, /json\(\{[^}]*rpcErr\.message/, 'must not return raw rpc error text')
    assert.doesNotMatch(src, /json\(\{[^}]*SERVICE_ROLE/i, 'must not return the service-role key')
  })
})
