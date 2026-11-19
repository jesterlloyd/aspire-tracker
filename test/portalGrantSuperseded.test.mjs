// GRANT-SUPERSEDED-1: a revoked or expired grant that a later grant of the same role replaced
// is left out of the default list and the cards, and still listed under Revoked / Expired.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { supersededGrantIds } from '../api/list-portal-access.js'

const g = (grant_id, user_profile_id, portal_role, status, granted_at) => ({ grant_id, user_profile_id, portal_role, status, granted_at })

test('a revoked grant replaced by a later one is superseded', () => {
  const ids = supersededGrantIds([
    g('old', 'susan', 'academic_partner', 'revoked', '2026-10-01T00:00:00Z'),
    g('new', 'susan', 'academic_partner', 'pending', '2026-11-18T00:00:00Z'),
  ])
  assert.deepEqual([...ids], ['old'])
})

test('a revoked grant with no later grant still shows', () => {
  assert.equal(supersededGrantIds([g('only', 'a', 'student', 'revoked', '2026-10-01T00:00:00Z')]).size, 0)
})

test('a later grant of another role does not supersede', () => {
  const ids = supersededGrantIds([
    g('s', 'a', 'student', 'revoked', '2026-10-01T00:00:00Z'),
    g('ap', 'a', 'academic_partner', 'active', '2026-11-01T00:00:00Z'),
  ])
  assert.equal(ids.size, 0)
})

test('expired grants are superseded too; active ones never', () => {
  const ids = supersededGrantIds([
    g('e', 'a', 'unit_leader', 'expired', '2026-01-01T00:00:00Z'),
    g('x', 'a', 'unit_leader', 'active', '2026-02-01T00:00:00Z'),
    g('y', 'a', 'unit_leader', 'active', '2026-03-01T00:00:00Z'),
  ])
  assert.deepEqual([...ids], ['e'])
})

test('the endpoint lists superseded grants only under Revoked or Expired', () => {
  const src = readFileSync(new URL('../api/list-portal-access.js', import.meta.url), 'utf8')
  assert.match(src, /statusFilter === 'revoked' \|\| statusFilter === 'expired' \? records : current/)
  assert.match(src, /all_grants: current\.length/)
})
