// test/s14InterviewOutcomeScope.test.mjs
//
// S-14: the save_interview_outcome path in api/student-update.js gated on role alone, so ANY
// account with the interviewer role could write status, interview_outcome, the average score
// fields, and flagged_for_second_interview for ANY student_id, in any cohort, with no check that
// the interviewer had anything to do with that student. The only thing resembling a scope check
// lived in RubricSession.jsx, comparing interviewer_name to the profile's full name, which is
// presentation and never authority.
//
// The write is now bounded by the interviewer's ACTIVE cohort entitlements, the same identity-based
// boundary api/student-file-access.js already applies to reads, so an interviewer's read scope and
// their outcome-write scope are one thing.
//
// Source-shape assertions plus a behavioral check of the scope helper. Nothing here performs
// network I/O and no email is sent.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')
const SRC = read('api/student-update.js')

// The save_interview_outcome branch only.
const OUTCOME = SRC.slice(
  SRC.indexOf("if (action === 'save_interview_outcome')"),
  SRC.indexOf("if (action === 'update_interview_outcome')"),
)
// Comment-free view. The new comments legitimately NAME interviewer_name while explaining why the
// scope is cohort-based rather than session-based, so "no name matching" has to be asserted against
// code alone or it would fail on its own documentation.
const OUTCOME_CODE = OUTCOME.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

// ── The scope is enforced server-side ────────────────────────────────────────────────────────────

test('S-14: an interviewer outcome write is bounded by active cohort entitlement', () => {
  assert.match(OUTCOME, /if \(!isOwnerAdmin\) \{/)
  assert.match(OUTCOME, /activeEntitledCohortIds\(db, auth\.profileId\)\)\.has\(stu\.cohort_id\)/)
  assert.match(OUTCOME, /if \(!entitled\) \{/)
  assert.match(OUTCOME, /return res\.status\(403\)\.json\(\{/)
})

test('S-14: the scope uses the caller identity from the verified JWT, never request input', () => {
  // auth.profileId comes from verifyCaller, which resolves the profile from the token.
  assert.match(OUTCOME, /activeEntitledCohortIds\(db, auth\.profileId\)/)
  assert.doesNotMatch(OUTCOME, /body\.(interviewer|profile|cohort)/i)
  // The cohort compared against is the STUDENT's, read from the database, not supplied.
  assert.match(OUTCOME, /\.select\(\['id', 'cohort_id', \.\.\.supplied\]\.join\(', '\)\)/)
})

test('S-14: the check defaults to denied and fails closed on a lookup error', () => {
  const guard = OUTCOME.slice(OUTCOME.indexOf('if (!isOwnerAdmin) {'), OUTCOME.indexOf('const noChange'))
  assert.match(guard, /let entitled = false/)
  assert.match(guard, /catch \{\s*\n\s*return res\.status\(500\)\.json\(\{ error: 'internal_error' \}\)/)
})

test('S-14: the scope check runs BEFORE the update is issued', () => {
  const checkIdx = OUTCOME.indexOf('if (!isOwnerAdmin) {')
  const updateIdx = OUTCOME.indexOf(".from('students').update(upd)")
  assert.ok(checkIdx > -1 && updateIdx > -1)
  assert.ok(checkIdx < updateIdx, 'the entitlement gate must precede the write')
})

test('S-14: no name comparison is used as authority anywhere in this path', () => {
  assert.doesNotMatch(OUTCOME_CODE, /interviewer_name/)
  assert.doesNotMatch(OUTCOME_CODE, /full_name/)
  assert.doesNotMatch(OUTCOME_CODE, /\.ilike\(/)
})

// ── Non-enumeration ──────────────────────────────────────────────────────────────────────────────

test('S-14: for an interviewer, unknown student and out-of-scope student refuse identically', () => {
  // The 404 is now Owner/Admin only, so an interviewer probing student ids gets one answer.
  assert.match(OUTCOME, /if \(!stu && isOwnerAdmin\) return res\.status\(404\)\.json\(\{ error: 'not_found' \}\)/)
  // entitled is false whenever stu is null, so a missing student falls into the same 403.
  assert.match(OUTCOME, /entitled = !!stu && \(await activeEntitledCohortIds/)
  // Exactly one refusal site for the interviewer path.
  assert.equal((OUTCOME.match(/error: 'forbidden',\s*\n\s*message: 'You do not have permission to save an interview outcome/g) || []).length, 1)
})

test('S-14: the refusal does not say which condition failed', () => {
  const msg = "You do not have permission to save an interview outcome for this student."
  assert.ok(OUTCOME.includes(msg))
  assert.doesNotMatch(msg, /cohort|entitle|not found|does not exist|session/i)
})

test('S-14: a null student can never reach the update', () => {
  // Owner/Admin take the 404; an interviewer takes the 403 because entitled requires !!stu.
  // So every path that reaches noChange has a non-null stu.
  const afterGate = OUTCOME.slice(OUTCOME.indexOf('const noChange'))
  assert.match(afterGate, /stu\[k\]/)
  const gateIdx = OUTCOME.indexOf('if (!entitled) {')
  assert.ok(gateIdx > -1 && gateIdx < OUTCOME.indexOf('const noChange'))
})

// ── Owner and Admin behavior is unchanged ────────────────────────────────────────────────────────

test('S-14: Owner and Admin keep their existing behavior exactly', () => {
  // Same role gate admitting both roles into the action.
  assert.match(OUTCOME, /if \(!\(isOwnerAdmin \|\| isInterviewer\)\) \{/)
  // The new gate is skipped entirely for them.
  assert.match(OUTCOME, /if \(!isOwnerAdmin\) \{/)
  // Their 404 for a genuinely missing student is preserved.
  assert.match(OUTCOME, /!stu && isOwnerAdmin/)
})

test('S-14: the validated field set and its rules are untouched', () => {
  // The hardening must not have widened or narrowed what may be written.
  assert.match(SRC, /const RUBRIC_OUTCOME_FIELDS = \[/)
  for (const f of ['interview_outcome', 'status', 'flagged_for_second_interview',
                   'avg_cj_score', 'avg_pp_score', 'avg_ga_score', 'avg_composite_score']) {
    assert.ok(SRC.includes(`'${f}'`), `${f} must still be in the outcome field set`)
  }
  // status is still restricted to the single rubric value for every role.
  assert.match(SRC, /const RUBRIC_STATUS   = \['Interviewed'\]/)
  assert.match(OUTCOME, /const ALLOWED = \['action', 'student_id', \.\.\.RUBRIC_OUTCOME_FIELDS\]/)
})

// ── The shared predicate ─────────────────────────────────────────────────────────────────────────

test('S-14: the entitlement predicate counts only unrevoked rows, and throws so callers fail closed', async () => {
  const helper = read('lib/server/interviewerEntitlements.js')
  assert.match(helper, /\.is\('revoked_at', null\)/)
  assert.match(helper, /throw new Error\('entitlement_lookup_failed'\)/)

  const { activeEntitledCohortIds } = await import('../lib/server/interviewerEntitlements.js')
  // A fake client proving the shape: the returned Set carries exactly the cohort ids given back.
  const fakeDb = rows => ({
    from: () => ({ select: () => ({ eq: () => ({ is: async () => ({ data: rows, error: null }) }) }) }),
  })
  const held = await activeEntitledCohortIds(fakeDb([{ cohort_id: 'c-1' }, { cohort_id: 'c-2' }]), 'p-1')
  assert.ok(held.has('c-1') && held.has('c-2'))
  assert.ok(!held.has('c-3'), 'a cohort not granted must not be in scope')
  const none = await activeEntitledCohortIds(fakeDb([]), 'p-1')
  assert.equal(none.size, 0, 'an interviewer with no entitlement holds no cohort')

  // A lookup error throws, which the endpoint turns into a fail-closed 500.
  const errDb = { from: () => ({ select: () => ({ eq: () => ({ is: async () => ({ data: null, error: { message: 'x' } }) }) }) }) }
  await assert.rejects(() => activeEntitledCohortIds(errDb, 'p-1'), /entitlement_lookup_failed/)
})

test('S-14: the same predicate governs file reads, so read and write scope cannot drift', () => {
  const fileAccess = read('api/student-file-access.js')
  assert.match(fileAccess, /activeEntitledCohortIds/)
  assert.match(SRC, /import \{ activeEntitledCohortIds \} from '\.\.\/lib\/server\/interviewerEntitlements\.js'/)
})

// ── The client gate stays presentation only ──────────────────────────────────────────────────────

test('S-14: the RubricSession name comparison is presentation, and the server no longer relies on it', () => {
  const rubric = read('src/components/RubricSession.jsx')
  // The client check still exists for UI affordance.
  assert.match(rubric, /canEdit=\{isOwnerOrAdmin \|\| r\.interviewer_name === userProfile\?\.full_name\}/)
  // But the server path contains no equivalent, which is the point of this fix.
  assert.doesNotMatch(OUTCOME_CODE, /interviewer_name/)
})
