// ASPIRE-STUDENT-PORTAL: static-source guards for the self-service profile
// endpoint. Only non-authoritative presentation fields are editable; everything
// authoritative is server-locked, and authorization is scoped to the student's
// own active links.
// Run: node --test test/updateProfileApi.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '../api/portal/update-profile.js'), 'utf8')

const AUTHORITATIVE = ['school', 'cohort_id', 'status', 'unit', 'preceptor_name', 'term_dates',
  'hours_required', 'approved_hours', 'role', 'is_owner', 'auth_user_id', 'student_id', 'headshot_url']

test('update-profile endpoint', async (t) => {
  await t.test('POST only; other methods 405', () => {
    assert.match(src, /if \(req\.method !== 'POST'\) return res\.status\(405\)/)
  })

  await t.test('authorizes a portal student scoped to their own active links', () => {
    assert.match(src, /verifyPortalCaller\(req\)/)
    assert.match(src, /hasActiveRoleGrant\(db, auth\.profile\.id, 'student'\)/)
    assert.match(src, /getActiveStudentLinks\(db, auth\.profile\.id\)/)
    // A supplied student_id must be one of the caller's own links.
    assert.match(src, /if \(!studentIds\.includes\(targetId\)\) return res\.status\(403\)/)
  })

  await t.test('editable allowlist is only presentation/communication fields', () => {
    assert.match(src, /const EDITABLE_FIELDS = \['preferred_first_name', 'phone'\]/)
    assert.match(src, /keys\.some\(k => !EDITABLE_FIELDS\.includes\(k\)\)/, 'defensive non-allowlist rejection')
  })

  await t.test('no authoritative field can be written', () => {
    // The patch is built ONLY from the two allowlisted keys; assert no update of authoritative columns.
    for (const col of AUTHORITATIVE) {
      assert.doesNotMatch(src, new RegExp(`patch\\.${col}\\s*=`), `must not set ${col}`)
    }
  })

  await t.test('updates only the students row by id (no role/grant/link writes)', () => {
    assert.match(src, /from\('students'\)\.update\(patch\)\.eq\('id', targetId\)/)
    for (const tbl of ['user_role_grants', 'user_student_links', 'user_unit_scopes', 'user_school_scopes', 'user_profiles']) {
      assert.doesNotMatch(src, new RegExp(`from\\('${tbl}'\\)[^\\n]*\\.(update|insert|delete)`), `must not write ${tbl}`)
    }
  })

  await t.test('service role stays server-side; no secret or auth id returned', () => {
    assert.match(src, /getServiceDb\(\)/)
    assert.doesNotMatch(src, /json\([^)]*auth_user_id/)
    assert.doesNotMatch(src, /json\([^)]*SERVICE_ROLE/i)
  })
})
