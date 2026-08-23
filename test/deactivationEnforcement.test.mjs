// test/deactivationEnforcement.test.mjs
//
// S-05: deactivation must actually revoke access.
//
// This file asserts one property: EVERY endpoint that verifies a Supabase JWT consults the caller's
//      is_active on the auth path. This is a repository-wide sweep, not a
//      sample: a new endpoint that copies an older verifier and forgets the
//      check fails this file. That sweep is the point. One endpoint is
//      exempt, by name, with its reason recorded below.
//
// Pure source and unit assertions. Nothing here opens a network connection,
// touches a live database, or sends email.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  isActiveProfile, INACTIVE_STATUS, INACTIVE_REASON, INACTIVE_MESSAGE,
} from '../api/lib/activeAccount.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const apiFiles = execSync("find api -name '*.js' | sort", { cwd: root, encoding: 'utf8' })
  .trim().split('\n').filter(Boolean)

// api/portal-activation-event.js verifies a JWT but grants NO authority: it
// records an activation diagnostic about the caller's own session and returns
// 200 even when the write fails, precisely so a diagnostic can never break
// activation. Requiring an active profile there would refuse events from the
// exact accounts whose activation is being diagnosed. It reads nothing and
// authorizes nothing, so there is no access to revoke.
const EXEMPT = new Set(['api/portal-activation-event.js'])

// The shared verifiers. A file that routes its caller through one of these
// inherits the active check from portalAuth.verifyPortalCaller and needs no
// check of its own.
const SHARED_VERIFIERS = /verifyPortalCaller|verifyOwnerAdminCaller|verifyStaffCaller|verifyPortalStudentCaller|verifyPortalMessagesCaller|verifyPortalUnitLeaderCaller|verifyPortalAcademicPartnerCaller/

// Any accepted spelling of "refuse a caller whose profile is not active".
const ACTIVE_CHECK = /isActiveProfile\s*\(|is_active === false|is_active !== true|!profile\.is_active/

// ── 1. Repository-wide sweep ─────────────────────────────────────────────────

test('S-05: every JWT-verifying endpoint consults the caller active state', () => {
  const missing = []
  for (const file of apiFiles) {
    if (EXEMPT.has(file)) continue
    const src = read(file)
    const verifiesJwt = /auth\.getUser\(\)/.test(src) || SHARED_VERIFIERS.test(src)
    if (!verifiesJwt) continue
    if (SHARED_VERIFIERS.test(src)) continue      // inherits the check
    if (!ACTIVE_CHECK.test(src)) missing.push(file)
  }
  assert.deepEqual(missing, [], 'these endpoints verify a JWT but never check whether the account is still active')
})

test('S-05: the sweep actually covers a large surface, so a broken matcher cannot pass it silently', () => {
  const covered = apiFiles.filter((f) => {
    const src = read(f)
    return /auth\.getUser\(\)/.test(src) || SHARED_VERIFIERS.test(src)
  })
  assert.ok(covered.length >= 100, `expected the sweep to reach 100+ endpoints, reached ${covered.length}`)
})

test('S-05: the exemption list is exactly one endpoint, and it grants no authority', () => {
  assert.equal(EXEMPT.size, 1)
  const src = read('api/portal-activation-event.js')
  // It writes one ledger row and nothing else, and never reads program data.
  assert.match(src, /portal_invitation_events/)
  assert.doesNotMatch(src, /\.from\('students'\)|\.from\('cohorts'\)|\.from\('interviews'\)/)
})

// ── 2. The shared rule ───────────────────────────────────────────────────────

test('S-05: isActiveProfile refuses a deactivated profile and a missing one', () => {
  assert.equal(isActiveProfile({ is_active: false }), false)
  assert.equal(isActiveProfile(null), false)
  assert.equal(isActiveProfile(undefined), false)
})

test('S-05: isActiveProfile treats a NULL or absent flag as active, matching portalAuth', () => {
  // A row predating the column default must not be locked out.
  assert.equal(isActiveProfile({ is_active: null }), true)
  assert.equal(isActiveProfile({ is_active: true }), true)
  assert.equal(isActiveProfile({ id: 'x' }), true)
  // And portalAuth really does read it that way.
  assert.match(read('api/lib/portalAuth.js'), /profile\.is_active === false/)
})

test('S-05: the refusal is 403 with a plain-language message and no mechanism', () => {
  assert.equal(INACTIVE_STATUS, 403)
  assert.equal(INACTIVE_REASON, 'inactive')
  assert.match(INACTIVE_MESSAGE, /no longer active/i)
  assert.match(INACTIVE_MESSAGE, /ASPIRE/)
  // Never leaks the column, the table, or the ban.
  assert.doesNotMatch(INACTIVE_MESSAGE, /is_active|user_profiles|ban|token|JWT/i)
})

// ── 3. Every guarded endpoint refuses before doing work ──────────────────────

test('S-05: each guarded endpoint places the active check before its role gate', () => {
  const offenders = []
  for (const file of apiFiles) {
    const src = read(file)
    if (!ACTIVE_CHECK.test(src) || SHARED_VERIFIERS.test(src)) continue
    const activeAt = src.search(ACTIVE_CHECK)
    // The role gate that follows in the raw-auth family.
    const roleAt = src.indexOf("!['owner', 'admin'].includes(profile.role)")
    if (roleAt === -1) continue
    if (activeAt > roleAt) offenders.push(file)
  }
  assert.deepEqual(offenders, [], 'the active check must run before the role gate, so no work happens first')
})

test('S-05: the guarded endpoints answer with the shared message, not a bespoke one', () => {
  const users = apiFiles.filter((f) => /message: INACTIVE_MESSAGE/.test(read(f)))
  assert.ok(users.length >= 35, `expected the shared message on 35+ endpoints, found ${users.length}`)
  // The named endpoints from the audit are all among them.
  for (const named of [
    'api/invite-user.js', 'api/connect-send-bulk-message.js', 'api/connect-send-direct-email.js',
    'api/student-update.js', 'api/knowledge-admin.js', 'api/templates-admin.js',
    'api/update-rotation-dates.js', 'api/keith.js',
  ]) {
    assert.ok(users.includes(named), `${named} must return the shared inactive message`)
  }
  // And the evaluation STAFF routes, as a family. The token-based routes
  // (evaluation-submit, *-token-validate, *-submit) are deliberately public:
  // a preceptor or student answering a survey has no account and no JWT, so
  // they verify a single-use token instead and have no caller to deactivate.
  const evalStaffRoutes = apiFiles
    .filter((f) => f.startsWith('api/evaluation-'))
    .filter((f) => /auth\.getUser\(\)/.test(read(f)) || SHARED_VERIFIERS.test(read(f)))
  const evalGuarded = evalStaffRoutes.filter((f) => ACTIVE_CHECK.test(read(f)) || SHARED_VERIFIERS.test(read(f)))
  assert.ok(evalStaffRoutes.length >= 10, `expected 10+ evaluation staff routes, found ${evalStaffRoutes.length}`)
  assert.deepEqual(evalGuarded.sort(), evalStaffRoutes.sort(), 'every evaluation staff route must be guarded')
})

test('S-05: an active caller is unaffected, because the guard only fires on false', () => {
  // Source-level proof that no guard was written as a truthiness test, which
  // would refuse legitimate NULL-flag accounts.
  for (const file of apiFiles) {
    const src = read(file)
    assert.doesNotMatch(src, /if \(!profile\.is_active\)/, `${file} uses a truthiness test, which locks out NULL-flag accounts`)
  }
})

// ── House rules ──────────────────────────────────────────────────────────────

test('S-05: activeAccount carries no em dash and performs no I/O', () => {
  const src = read('api/lib/activeAccount.js')
  // \u2014 is the em dash, written as an escape so this file contains none either.
  assert.doesNotMatch(src, /\u2014/)
  assert.doesNotMatch(src, /createClient|fetch\(|process\.env/)
})
