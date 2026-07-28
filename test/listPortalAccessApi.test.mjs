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

  // ACCOUNTS-ACCESS-DIRECTORY-2: 'pending' is a real derived status, not only
  // the legacy `pending` array.
  await t.test("'pending' is a real derived status, filterable via ?status=pending", () => {
    assert.match(src, /STATUSES = \[.*'pending'.*\]/)
  })

  await t.test('pending only overrides active/scheduled, never revoked/expired', () => {
    assert.match(src, /if \(\(status === 'active' \|\| status === 'scheduled'\) && pendingEmails\.has/)
    // The override runs against `status` (the already-derived value), so a
    // 'revoked' or 'expired' grant can never fall into that branch.
    assert.doesNotMatch(src, /status === 'revoked'[\s\S]{0,60}pendingEmails/, 'revoked must never be overridden to pending')
    assert.doesNotMatch(src, /status === 'expired'[\s\S]{0,60}pendingEmails/, 'expired must never be overridden to pending')
  })

  await t.test('the pending email set is computed before record building', () => {
    const pendingIdx = src.indexOf('const pendingEmails = new Set()')
    const recordsIdx = src.indexOf('const records = (grants || []).map(')
    assert.ok(pendingIdx > -1 && recordsIdx > -1 && pendingIdx < recordsIdx,
      'pendingEmails must be built before the records map so status override can use it')
  })

  await t.test('counts initialize and accumulate a pending bucket', () => {
    assert.match(src, /const counts = \{[^}]*pending: 0[^}]*\}/)
  })

  await t.test('returns sanitized fields only (no auth_user_id / revoked_by / tokens)', () => {
    // The response builder must not expose these.
    assert.doesNotMatch(src, /auth_user_id:/,'must not return auth_user_id')
    assert.doesNotMatch(src, /revoked_by/, 'must not select or return revoked_by')
    assert.match(src, /user_profile_id: g\.user_profile_id/, 'profile id returned only for revoke')
    assert.match(src, /grant_id: g\.id/)
  })

  await t.test('records include last_login_at from the profile', () => {
    assert.match(src, /last_login_at: p\.last_login_at \|\| null/)
  })

  await t.test('records include avatar_url with a normalized-email contacts fallback', () => {
    assert.match(src, /import \{ normalizeEmailForLookup \} from '\.\.\/src\/lib\/emailUtils\.js'/)
    assert.match(src, /from\('contacts'\)\.select\('email, avatar_url'\)/)
    assert.match(src, /avatar_url: p\.avatar_url \|\| contactAvatarByEmail\.get\(normalizeEmailForLookup\(p\.email\)\) \|\| null/)
  })

  await t.test('legacy pending array keeps its prior shape for response compatibility', () => {
    assert.match(src, /const pending = records/)
    assert.match(src, /user_profile_id: r\.user_profile_id/)
    assert.match(src, /full_name: r\.full_name/)
    assert.match(src, /portal_role: r\.portal_role/)
    assert.match(src, /invited_at: pendingInvitedAtByEmail\.get/)
    assert.match(src, /pending_available: pendingAvailable/)
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
