// ASPIRE-PORTAL-ACCESS-UI: static-source guards for the portal-access listing
// endpoint. Confirms GET-only, Owner/Admin authorization (interviewer/viewer and
// portal users denied), service-role-only server use, pagination, sanitized
// output (no auth_user_id / revoked_by), correct status derivation, retention of
// historical grants, and that it performs no mutation.
// Run: node --test test/listPortalAccessApi.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '../api/list-portal-access.js'), 'utf8')

test('list-portal-access endpoint', async (t) => {
  await t.test('GET only; other methods 405', () => {
    assert.match(src, /if \(req\.method !== 'GET'\) return res\.status\(405\)/)
  })

  await t.test('requires Owner/Admin; others get 403', () => {
    assert.match(src, /verifyCaller\(req\)/)
    assert.match(src, /if \(!\(auth\.isOwner \|\| auth\.role === 'admin'\)\)/)
    assert.match(src, /status\(403\)/)
    // A portal (non owner/admin) or interviewer/viewer caller fails the same gate.
  })

  await t.test('uses the service role only on the server', () => {
    assert.match(src, /SUPABASE_SERVICE_ROLE_KEY/)
    assert.match(src, /getServiceDb\(\)/)
  })

  await t.test('supports pagination and filters', () => {
    assert.match(src, /q\.limit/); assert.match(src, /q\.offset/)
    assert.match(src, /roleFilter/); assert.match(src, /statusFilter/)
    assert.match(src, /\.slice\(offset, offset \+ limit\)/)
    assert.match(src, /MAX_LIMIT/)
  })

  await t.test('derives all four statuses consistently', () => {
    assert.match(src, /function deriveStatus/)
    for (const s of ['revoked', 'expired', 'scheduled', 'active']) {
      assert.match(src, new RegExp(`return '${s}'`), `status ${s} must be derivable`)
    }
  })

  await t.test('returns sanitized fields only (no auth_user_id / revoked_by / tokens)', () => {
    // The response builder must not expose these.
    assert.doesNotMatch(src, /auth_user_id:/,'must not return auth_user_id')
    assert.doesNotMatch(src, /revoked_by/, 'must not select or return revoked_by')
    assert.match(src, /user_profile_id: g\.user_profile_id/, 'profile id returned only for revoke')
    assert.match(src, /grant_id: g\.id/)
  })

  await t.test('retains historical grants as separate records', () => {
    // One record per grant row (active + historical), newest first.
    assert.match(src, /from\('user_role_grants'\)[\s\S]*?order\('granted_at', \{ ascending: false \}\)/)
    assert.match(src, /\.map\(g =>/)
  })

  await t.test('performs no mutation', () => {
    assert.doesNotMatch(src, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/, 'listing endpoint must not mutate')
    assert.doesNotMatch(src, /\.rpc\('provision_portal_access'|\.rpc\('revoke_portal_access'/)
  })

  await t.test('does not leak secrets or raw db errors to the client', () => {
    assert.doesNotMatch(src, /json\([^)]*gErr\.message/)
    assert.doesNotMatch(src, /json\([^)]*SERVICE_ROLE/i)
  })
})
