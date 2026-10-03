// test/s34KeithToolScope.test.mjs
//
// S-34: Keith's data tools run under a scope derived from the SERVER-VERIFIED caller. An
// Interviewer is bounded to the cohorts they hold an active entitlement for and to their own
// rubric rows; Owner, Admin and Co-Lead are unrestricted. The body's activeCohortId carries
// no authority. The pure module is exercised directly with a fake client; the wiring into
// api/keith.js is pinned by reading the source.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { resolveToolScope, cohortAllowed, rubricsForScope, COHORT_REFUSED, STUDENT_REFUSED } from '../lib/server/keith/toolScope.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')

const COHORT_A = '11111111-1111-4111-8111-111111111111'
const COHORT_B = '22222222-2222-4222-8222-222222222222'
const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const COLLEAGUE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

// A fake client that answers the one entitlement query the module makes, and records
// whether it was asked at all.
function fakeDb(rows, { fail = false } = {}) {
  const calls = []
  const q = {
    select() { return q },
    eq(col, val) { calls.push(['eq', col, val]); return q },
    is() { return Promise.resolve(fail ? { data: null, error: { message: 'boom' } } : { data: rows, error: null }) },
  }
  return { from(table) { calls.push(['from', table]); return q }, calls }
}

test('S-34: Owner, Admin and Co-Lead are unrestricted and the entitlement table is never read', async () => {
  for (const caller of [
    { role: 'admin', isOwner: true, profileId: ME },
    { role: 'admin', isOwner: false, profileId: ME },
    { role: 'co-lead', isOwner: false, profileId: ME },
    { role: 'co_lead', isOwner: false, profileId: ME },
  ]) {
    const db = fakeDb([{ cohort_id: COHORT_A }])
    const scope = await resolveToolScope(db, caller)
    assert.equal(scope.unrestricted, true, JSON.stringify(caller))
    assert.equal(db.calls.length, 0, 'an unrestricted caller makes no entitlement query')
    assert.equal(cohortAllowed(scope, COHORT_B), true)
  }
})

test('S-34: an Interviewer is bounded to their ACTIVE entitlements, looked up by profile id', async () => {
  const db = fakeDb([{ cohort_id: COHORT_A }])
  const scope = await resolveToolScope(db, { role: 'interviewer', isOwner: false, profileId: ME })
  assert.equal(scope.unrestricted, false)
  assert.deepEqual(db.calls, [['from', 'interviewer_cohort_entitlements'], ['eq', 'interviewer_profile_id', ME]])
  assert.equal(cohortAllowed(scope, COHORT_A), true, 'the entitled cohort is readable')
  assert.equal(cohortAllowed(scope, COHORT_B), false, 'a cohort outside the entitlement is refused')
  assert.equal(cohortAllowed(scope, null), false, 'no cohort id is never allowed for a bounded caller')
})

test('S-34: a failed entitlement lookup fails CLOSED', async () => {
  const scope = await resolveToolScope(fakeDb(null, { fail: true }), { role: 'interviewer', isOwner: false, profileId: ME })
  assert.equal(scope.unrestricted, false)
  assert.equal(cohortAllowed(scope, COHORT_A), false)
  const noProfile = await resolveToolScope(fakeDb([{ cohort_id: COHORT_A }]), { role: 'interviewer', isOwner: false, profileId: null })
  assert.equal(cohortAllowed(noProfile, COHORT_A), false, 'no profile id, no scope')
})

test('S-34: another interviewer\'s rubric is withheld from a bounded caller; the unrestricted caller sees all', async () => {
  const rubrics = [
    { interviewer_profile_id: ME, interviewer_name: 'Me', summary_comments: 'mine' },
    { interviewer_profile_id: COLLEAGUE, interviewer_name: 'Colleague', summary_comments: 'theirs' },
    { interviewer_profile_id: null, interviewer_name: 'Me', summary_comments: 'unlinked legacy row' },
  ]
  const bounded = await resolveToolScope(fakeDb([{ cohort_id: COHORT_A }]), { role: 'interviewer', isOwner: false, profileId: ME })
  const mine = rubricsForScope(bounded, rubrics)
  assert.deepEqual(mine.map(r => r.summary_comments), ['mine'], 'identity decides, never the name')
  const admin = await resolveToolScope(fakeDb([]), { role: 'admin', isOwner: false, profileId: COLLEAGUE })
  assert.equal(rubricsForScope(admin, rubrics).length, 3)
  assert.deepEqual(rubricsForScope(bounded, null), [])
})

test('S-34: api/keith.js resolves the scope once from the verified caller and every data tool checks it', () => {
  const src = read('api/keith.js')
  assert.match(src, /import \{ resolveToolScope, cohortAllowed, rubricsForScope, COHORT_REFUSED, STUDENT_REFUSED \} from '\.\.\/lib\/server\/keith\/toolScope\.js'/)
  assert.match(src, /const toolScope = await resolveToolScope\(supabase, auth\)/)
  assert.match(src, /executeToolCall\(block\.name, block\.input, auth\.role, supabase, activeCohortId, toolScope\)/)
  assert.match(src, /async function executeToolCall\(toolName, input, userRole, supabase, activeCohortId, scope\)/)
  // search_students and get_unit_details check the requested cohort before reading.
  assert.match(src, /case 'search_students': \{\n\s+if \(!cohortAllowed\(scope, activeCohortId\)\) return \{ error: COHORT_REFUSED \}/)
  assert.match(src, /case 'get_unit_details': \{\n\s+if \(!cohortAllowed\(scope, activeCohortId\)\) return \{ error: COHORT_REFUSED \}/)
  // get_cohort_summary checks the cohort the tool input may override to.
  assert.match(src, /const cohortId = input\.cohort_id \|\| activeCohortId;\n\s+if \(!cohortAllowed\(scope, cohortId\)\) return \{ error: COHORT_REFUSED \}/)
  // get_student_detail selects the student's cohort, re-checks it with the not-found sentence,
  // and filters rubrics by the caller's identity.
  assert.match(src, /\.select\('id, cohort_id, first_name, preferred_first_name, last_name, school, program_type, status, cumulative_gpa, school_email/)
  assert.match(src, /if \(!cohortAllowed\(scope, student\.cohort_id\)\) return \{ error: STUDENT_REFUSED \}/)
  assert.match(src, /\.select\('interviewer_profile_id, interviewer_name, composite_score/)
  assert.match(src, /const rubrics = rubricsForScope\(scope, rubricRows\)/)
  assert.equal(STUDENT_REFUSED, 'Student not found', 'an out-of-scope student reads exactly like a missing one')
  assert.ok(COHORT_REFUSED.length > 0)
})

test('S-34: the register records the finding as Closed', () => {
  const reg = read('docs/security/FINDINGS_REGISTER.md')
  const entry = reg.slice(reg.indexOf('## S-34.'), reg.indexOf('## S-35.'))
  assert.match(entry, /\*\*Status\*\*: Closed/)
  assert.doesNotMatch(entry, /\u2014/)
})
