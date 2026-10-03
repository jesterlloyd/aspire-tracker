// test/deactivationSessionTermination.test.mjs
//
// S-05, second half: deactivating an account must end its session, not merely
// change a flag that future requests consult.
//
// A Supabase access token stays valid until it expires and its refresh token
// keeps minting new ones, so the profile write alone leaves a deactivated
// person holding a live, renewable session. These tests pin the Auth-side
// change, both directions of it, and the deliberate decision that an Auth
// failure never rolls back or hides the profile change.
//
// The per-request endpoint guards are asserted separately, in
// test/deactivationEnforcement.test.mjs.
//
// Unit and source assertions against a fake admin client. Nothing here opens a
// network connection, touches a live database, or sends email.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  endAuthAccess, restoreAuthAccess, PERMANENT_BAN_DURATION, NO_BAN,
} from '../api/lib/accountSession.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const apiFiles = execSync("find api -name '*.js' | sort", { cwd: root, encoding: 'utf8' })
  .trim().split('\n').filter(Boolean)

// ── The Auth-side change ───────────────────────────────────────────────

const fakeAdmin = (impl) => ({ auth: { admin: { updateUserById: impl } } })

test('S-05: deactivation bans the auth identity', async () => {
  const calls = []
  const admin = fakeAdmin(async (id, attrs) => { calls.push([id, attrs]); return { error: null } })
  const out = await endAuthAccess(admin, 'auth-user-1')
  assert.equal(out.ok, true)
  assert.deepEqual(calls, [['auth-user-1', { ban_duration: PERMANENT_BAN_DURATION }]])
})

test('S-05: reactivation lifts the ban', async () => {
  const calls = []
  const admin = fakeAdmin(async (id, attrs) => { calls.push([id, attrs]); return { error: null } })
  const out = await restoreAuthAccess(admin, 'auth-user-1')
  assert.equal(out.ok, true)
  assert.deepEqual(calls, [['auth-user-1', { ban_duration: NO_BAN }]])
  assert.equal(NO_BAN, 'none')
})

test('S-05: a profile with no auth identity is skipped, not treated as a failure', async () => {
  let called = false
  const admin = fakeAdmin(async () => { called = true; return { error: null } })
  const out = await endAuthAccess(admin, null)
  assert.equal(out.ok, true)
  assert.equal(out.skipped, true)
  assert.equal(called, false, 'no Auth call may be made without an identity')
})

test('S-05: an Auth failure is reported, never thrown and never swallowed', async () => {
  const returned = await endAuthAccess(fakeAdmin(async () => ({ error: { message: 'auth is down' } })), 'u1')
  assert.equal(returned.ok, false)
  assert.equal(returned.action, 'ban')
  assert.match(returned.reason, /auth is down/)

  const threw = await endAuthAccess(fakeAdmin(async () => { throw new Error('socket hang up') }), 'u1')
  assert.equal(threw.ok, false)
  assert.match(threw.reason, /socket hang up/)
})

// ── 5. The deactivation endpoint's ordering and failure handling ─────────────

test('S-05: admin-users writes the profile FIRST, then changes auth state', () => {
  const src = read('api/admin-users.js')
  const write = src.indexOf("await db.from('user_profiles').update(patch)")
  const authChange = src.indexOf('await endAuthAccess(db, target.auth_user_id)')
  assert.ok(write > 0 && authChange > 0)
  assert.ok(write < authChange, 'the profile write must be committed before the Auth call is attempted')
})

test('S-05: a failed Auth call does not roll back or hide the profile change', () => {
  const src = read('api/admin-users.js')
  // No rollback of the flag anywhere after the auth attempt.
  const after = src.slice(src.indexOf('let authAccess = null;'))
  assert.doesNotMatch(after, /update\(\{ is_active/, 'the profile flag is never reverted')
  // Visible, not silent: logged at error level AND returned to the caller.
  assert.match(after, /console\.error\('\[admin-users\] auth access change failed'/)
  assert.match(after, /session_warning/)
  // Still a success for the state change itself.
  assert.match(after, /success: true/)
})

test('S-05: both directions of toggle_active are wired, and audited', () => {
  const src = read('api/admin-users.js')
  assert.match(src, /newActive\s*\n?\s*\?\s*await restoreAuthAccess\(db, target\.auth_user_id\)\s*\n?\s*:\s*await endAuthAccess\(db, target\.auth_user_id\)/)
  assert.match(src, /admin_account_reactivated/)
  assert.match(src, /admin_account_deactivated/)
})

// S-35 (Owner decision 2026-10-02, commit "S-35: invite-user matches an account exactly and
// never lifts a deactivation"): this test used to require the OPPOSITE, that re-inviting a
// deactivated account lifted its ban. Inviting is no longer a reactivation path: a deactivated
// profile is refused with 409 and the ban stays until Users & Access lifts it.
test('S-35: inviting never lifts a deactivation ban; a deactivated account is refused', () => {
  const src = read('api/invite-user.js')
  assert.doesNotMatch(src, /import \{[^}]*restoreAuthAccess[^}]*\} from '\.\/lib\/accountSession\.js'/)
  assert.doesNotMatch(src, /await restoreAuthAccess\(/)
  assert.match(src, /if \(existingProfile && existingProfile\.is_active === false\) \{[\s\S]{0,400}status\(409\)/)
  assert.match(src, /belongs to a deactivated account\. Reactivate it from Users & Access/)
})

test('S-05: only admin-users deactivates a staff account', () => {
  // Scoped to writes against user_profiles. api/cohort-unit-response-targets.js
  // also writes an is_active: false, but on cohort_unit_response_targets, which
  // is a program row and has no session behind it.
  const writers = apiFiles.filter((f) => {
    const src = read(f)
    if (!/is_active: newActive|is_active: false/.test(src)) return false
    return /\.from\('user_profiles'\)/.test(src)
  })
  assert.deepEqual(writers, ['api/admin-users.js'],
    'a second deactivation path would need its own session termination')
})

// ── 6. House rules ───────────────────────────────────────────────────────────

test('S-05: accountSession carries no em dash and never builds a client or reads a secret', () => {
  const src = read('api/lib/accountSession.js')
  // \u2014 is the em dash, written as an escape so this file contains none either.
  assert.doesNotMatch(src, /\u2014/)
  assert.doesNotMatch(src, /createClient|process\.env|SERVICE_ROLE/)
})
