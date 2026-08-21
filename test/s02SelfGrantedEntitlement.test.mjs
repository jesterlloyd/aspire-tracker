// test/s02SelfGrantedEntitlement.test.mjs
//
// S-02: api/availability.js let an interviewer cause a cohort entitlement to be created for
// THEMSELVES. A non-admin caller is correctly forced to their own profile id, but cohort_id was
// taken from the body unvalidated, and the create_block flow then called ensureCohortEntitlement
// with granted_by_profile_id set to the caller. api/student-file-access.js honors that entitlement
// to sign resume and headshot URLs for every student in the cohort, so a self-schedule was a
// self-service grant of student file access.
//
// That contradicted two documented statements: api/interviewer-entitlements.js ("Interviewers
// cannot grant or revoke their own entitlement") and the entitlement UI ("access follows a
// decision, not a role").
//
// The fix keeps the ADMIN-INITIATED auto-ensure, which the schema comment on
// interview_availability_blocks.interviewer_profile_id describes as intended, and requires a
// self-scheduling interviewer to already hold the cohort.
//
// These are source-shape assertions, matching how the rest of this suite covers api/availability.js
// (see test/interviewerEntitlements.test.mjs). Nothing here performs network I/O or sends email.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')
const SRC = read('api/availability.js')

// The create_block branch only, so an assertion cannot accidentally match another action.
const CREATE_BLOCK = SRC.slice(SRC.indexOf("if (action === 'create_block')"), SRC.indexOf("if (action === 'delete_block')"))

// ── The self-grant is gone ───────────────────────────────────────────────────────────────────────

test('S-02: the auto-ensure is reachable only for an admin-level caller', () => {
  // The guard now requires adminLevel, so a self-scheduling interviewer cannot reach the insert.
  assert.match(CREATE_BLOCK, /if \(adminLevel && String\(interviewerAcct\.role \|\| ''\)\.toLowerCase\(\) === 'interviewer'\) \{/)
  // Exactly one call site, and it is inside that guard.
  assert.equal((SRC.match(/await ensureCohortEntitlement\(/g) || []).length, 1)
  const guardIdx = CREATE_BLOCK.indexOf('if (adminLevel && String(interviewerAcct.role')
  const callIdx = CREATE_BLOCK.indexOf('await ensureCohortEntitlement(')
  assert.ok(guardIdx > -1 && callIdx > guardIdx, 'the ensure must sit inside the adminLevel guard')
})

test('S-02: a self-scheduling interviewer must already hold the cohort', () => {
  assert.match(CREATE_BLOCK, /if \(!adminLevel\) \{/)
  assert.match(CREATE_BLOCK, /activeEntitledCohortIds\(db, interviewerProfileId\)\)\.has\(cohort_id\)/)
  assert.match(CREATE_BLOCK, /if \(!entitled\) \{/)
  assert.match(CREATE_BLOCK, /return res\.status\(403\)\.json\(\{/)
})

test('S-02: the entitlement predicate is the shared identity-based one, never a name', () => {
  assert.match(SRC, /import \{ activeEntitledCohortIds \} from '\.\.\/lib\/server\/interviewerEntitlements\.js'/)
  // The endpoint must not grow its own entitlement read, and must never match on a name.
  assert.doesNotMatch(CREATE_BLOCK, /interviewer_name === |\.ilike\(/)
  const helper = read('lib/server/interviewerEntitlements.js')
  assert.match(helper, /\.is\('revoked_at', null\)/, 'only unrevoked rows count as active')
})

test('S-02: the refusal happens BEFORE anything is written, so there is nothing to compensate', () => {
  const refusalIdx = CREATE_BLOCK.indexOf('if (!adminLevel) {')
  const blockInsertIdx = CREATE_BLOCK.indexOf(".from('interview_availability_blocks')\n        .insert(")
  assert.ok(refusalIdx > -1 && blockInsertIdx > -1, 'both landmarks must exist')
  assert.ok(refusalIdx < blockInsertIdx, 'the entitlement requirement must precede the block insert')
})

test('S-02: an entitlement lookup failure fails closed', () => {
  const guard = CREATE_BLOCK.slice(CREATE_BLOCK.indexOf('if (!adminLevel) {'), CREATE_BLOCK.indexOf('const { data: block'))
  assert.match(guard, /catch \{\s*\n\s*return res\.status\(500\)\.json\(\{ error: 'internal_error' \}\)/)
  assert.match(guard, /let entitled = false/, 'the default must be denied, not allowed')
})

test('S-02: the refusal message is non-technical and tells the interviewer what to do', () => {
  const msg = CREATE_BLOCK.slice(CREATE_BLOCK.indexOf('You do not have access to this cohort'))
    .slice(0, 200)
  assert.match(msg, /Ask the ASPIRE team/)
  assert.doesNotMatch(msg, /entitlement|interviewer_cohort|profile_id|uuid|sql/i, 'no internals in the copy')
})

// ── cohort_id is validated, not trusted ──────────────────────────────────────────────────────────

test('S-02: cohort_id is shape-checked and confirmed to exist before any write', () => {
  assert.match(CREATE_BLOCK, /if \(typeof cohort_id !== 'string' \|\| !UUID_REGEX\.test\(cohort_id\)\) \{/)
  assert.match(CREATE_BLOCK, /\.from\('cohorts'\)\.select\('id'\)\.eq\('id', cohort_id\)\.maybeSingle\(\)/)
  assert.match(CREATE_BLOCK, /if \(!cohortRow\) \{/)
  const validationIdx = CREATE_BLOCK.indexOf('!UUID_REGEX.test(cohort_id)')
  const insertIdx = CREATE_BLOCK.indexOf(".from('interview_availability_blocks')\n        .insert(")
  assert.ok(validationIdx < insertIdx, 'validation must precede the block insert')
})

test('S-02: an unknown cohort and a malformed one refuse identically', () => {
  // Both take the same field and the same copy, so neither confirms whether a cohort id exists.
  const shape = /error: 'invalid_request', field: 'cohort_id', message: 'Select a valid cohort\.'/g
  assert.equal((CREATE_BLOCK.match(shape) || []).length, 2)
})

// ── The admin path is untouched ──────────────────────────────────────────────────────────────────

test('S-02: the admin-initiated grant still works exactly as before', () => {
  // Same call, same arguments, same attribution: granted_by is the acting admin.
  assert.match(CREATE_BLOCK, /const ensured = await ensureCohortEntitlement\(db, interviewerProfileId, cohort_id, auth\.profileId\)/)
  // Same fail-closed compensation on failure.
  assert.match(CREATE_BLOCK, /if \(!ensured\.ok\) \{[\s\S]*?from\('interview_slots'\)\.delete\(\)\.eq\('block_id', block\.id\)[\s\S]*?from\('interview_availability_blocks'\)\.delete\(\)\.eq\('id', block\.id\)[\s\S]*?error: 'entitlement_failed'/)
  // Success is still reported only after the gate.
  const failIdx = CREATE_BLOCK.indexOf("error: 'entitlement_failed'")
  const successIdx = CREATE_BLOCK.indexOf('success: true, block, slots: createdSlots')
  assert.ok(failIdx > -1 && successIdx > failIdx)
})

test('S-02: the helper still never mutates or revokes an existing row', () => {
  const helper = SRC.slice(SRC.indexOf('async function ensureCohortEntitlement'), SRC.indexOf('export default'))
  assert.doesNotMatch(helper, /\.update\(|revoked_at:/)
  assert.match(helper, /if \(first\.data\) return \{ ok: true, idempotent: true \}/)
})

test('S-02: an Owner or Admin scheduling themselves is not blocked by the new requirement', () => {
  // The requirement is keyed on !adminLevel, and adminLevel is isOwner || role === 'admin', so an
  // Owner/Admin never hits it. Their file access does not come from an entitlement anyway.
  assert.match(SRC, /function isAdminLevel\(role, isOwner\) \{\s*\n\s*return isOwner \|\| role === 'admin';/)
})

// ── The documented rule this restores ────────────────────────────────────────────────────────────

test('S-02: the endpoint no longer contradicts the entitlement API contract', () => {
  const entitlementsApi = read('api/interviewer-entitlements.js')
  assert.match(entitlementsApi, /Interviewers cannot grant or revoke their own entitlement/)
  // Owner/Admin remain the only grantors: the management endpoint is unchanged.
  assert.match(entitlementsApi, /const caller = await verifyStaffCaller\(req\) \/\/ active owner\/admin only/)
  assert.match(entitlementsApi, /granted_by_profile_id: actorId/)
})
