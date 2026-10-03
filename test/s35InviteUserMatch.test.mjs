// test/s35InviteUserMatch.test.mjs
//
// S-35: api/invite-user.js attaches an invitation to an existing account only on an EXACT
// normalized email match, treats a lookup error or an ambiguous match as a failure, and never
// lifts a deactivation ban. The matching rule is exercised on the real helpers; the endpoint's
// use of them is pinned by reading the source (the handler needs Supabase and Resend to run).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { normalizeEmailForLookup, escapeLikePattern } from '../src/lib/emailUtils.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')
const src = read('api/invite-user.js')

// What the endpoint does with the rows the database returns for the escaped pattern.
function exactMatches(rows, typed) {
  const norm = normalizeEmailForLookup(typed)
  return rows.filter(r => normalizeEmailForLookup(r.email) === norm)
}

test('S-35: an underscore or percent in the typed address matches itself, not any character', () => {
  assert.equal(escapeLikePattern('jane_doe@cshs.org'), 'jane\\_doe@cshs.org')
  assert.equal(escapeLikePattern('100%@cshs.org'), '100\\%@cshs.org')
  // The exploit from the register: jane_doe must not attach to jane.doe.
  const rows = [{ id: 'p1', email: 'jane.doe@cshs.org' }]
  assert.deepEqual(exactMatches(rows, 'jane_doe@cshs.org'), [])
})

test('S-35: the match is exact after normalization (case, whitespace, zero-width characters)', () => {
  const rows = [{ id: 'p1', email: 'Jane.Doe@cshs.org' }, { id: 'p2', email: 'jane.doe@cshs.org.au' }]
  assert.deepEqual(exactMatches(rows, '  jane.doe@CSHS.org '), [rows[0]])
  assert.deepEqual(exactMatches(rows, 'jane.doe@cshs.org​'), [rows[0]])
  assert.deepEqual(exactMatches(rows, 'jane.doe@cshs.or'), [])
})

test('S-35: the endpoint uses the escaped pattern, re-compares every row, and fails on an error or an ambiguous match', () => {
  assert.match(src, /import \{ normalizeEmailForLookup, escapeLikePattern \} from '\.\.\/src\/lib\/emailUtils\.js'/)
  assert.match(src, /\.ilike\('email', escapeLikePattern\(normEmail\)\)\n\s+\.limit\(5\)/)
  assert.doesNotMatch(src, /\.ilike\('email', normEmail\)/, 'the raw pattern is gone')
  assert.doesNotMatch(src, /\.ilike\('email'[^\n]*\n\s+\.maybeSingle\(\)/, 'maybeSingle swallowed a two-row error')
  assert.match(src, /if \(lookupErr\) \{[\s\S]{0,200}status\(500\)\.json\(\{ error: 'internal_error' \}\)/)
  assert.match(src, /const exactMatches = \(emailRows \|\| \[\]\)\.filter\(r => normalizeEmailForLookup\(r\.email\) === normEmail\)/)
  assert.match(src, /if \(exactMatches\.length > 1\) \{[\s\S]{0,300}status\(409\)/)
  assert.match(src, /const existingProfile = exactMatches\[0\] \|\| null/)
})

test('S-35: a deactivated account is refused and the auth ban is never lifted here', () => {
  assert.match(src, /if \(existingProfile && existingProfile\.is_active === false\) \{[\s\S]{0,400}status\(409\)/)
  assert.doesNotMatch(src, /restoreAuthAccess\(/)
  assert.doesNotMatch(src, /from '\.\/lib\/accountSession\.js'/)
})

test('S-35: the address is validated as one address with no whitespace or wildcards', () => {
  assert.match(src, /if \(!\/\^\[\^\\s@%_\]\+@\[\^\\s@%_\]\+\\\.\[\^\\s@%_\]\+\$\/\.test\(email\)\)/)
  const re = /^[^\s@%_]+@[^\s@%_]+\.[^\s@%_]+$/
  assert.equal(re.test('jane.doe@cshs.org'), true)
  assert.equal(re.test('jane_doe@cshs.org'), false)
  assert.equal(re.test('jane doe@cshs.org'), false)
  assert.equal(re.test('jane@cshs'), false)
})

test('S-35: the register records the finding as Closed', () => {
  const reg = read('docs/security/FINDINGS_REGISTER.md')
  const entry = reg.slice(reg.indexOf('## S-35.'), reg.indexOf('## S-36.'))
  assert.match(entry, /\*\*Status\*\*: Closed/)
  assert.doesNotMatch(entry, /\u2014/)
})
