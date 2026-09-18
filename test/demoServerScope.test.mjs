// test/demoServerScope.test.mjs
//
// DEMO-MODE-1: the portal preview, which is the one place a staff member walks INTO a
// portal and therefore the one place a real student could appear inside a demo.
//
// The argument this file pins is an inheritance argument, and it is worth stating
// because it is why two endpoints were changed instead of twenty-two:
//
//   admin-preview-access lists the students a preview may open.
//   admin-student-preview projects ONE of them, scoped entirely by that id.
//   Every my-* endpoint the preview then feeds is scoped by the same id.
//
// So the population is decided once, at the picker. Filter the picker and everything
// downstream is already the right population, exactly as a demo child row is demo
// because its parent is. The id check in admin-student-preview is the second half:
// an id can outlive the mode that produced it.
//
// THREE STATES, NOT TWO. absent / 0 / 1, and absent is not false. Until the foundation
// migration is applied there is no is_demo column, so an endpoint that filtered on it
// would 400 every preview. The client omits the parameter entirely while the boundary
// is off, and these endpoints must then behave exactly as they did before.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { demoScopeFromRequest, applyDemoScope, rowInDemoScope } from '../lib/server/demoScope.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

// ─────────────────────────────────────────────────────────────────────
// 1. Reading the scope off a request
// ─────────────────────────────────────────────────────────────────────
test('absent means do not filter, which is not the same as false', () => {
  assert.equal(demoScopeFromRequest({ query: {} }), null)
  assert.equal(demoScopeFromRequest({ query: { demo: '' } }), null)
  assert.equal(demoScopeFromRequest({}), null)
  assert.equal(demoScopeFromRequest(null), null)

  // Absent is what every request looks like until the migration is applied. Treating it
  // as false would add is_demo=eq.false to a column that does not exist, and 400 every
  // portal preview in production.
  assert.notEqual(demoScopeFromRequest({ query: {} }), false)
})

test('the scope is read from the query or the header', () => {
  assert.equal(demoScopeFromRequest({ query: { demo: '1' } }), true)
  assert.equal(demoScopeFromRequest({ query: { demo: '0' } }), false)
  assert.equal(demoScopeFromRequest({ query: { demo: 'true' } }), true)
  assert.equal(demoScopeFromRequest({ query: { demo: 'false' } }), false)
  assert.equal(demoScopeFromRequest({ headers: { 'x-aspire-demo': '1' } }), true)
  assert.equal(demoScopeFromRequest({ query: { demo: ['1'] } }), true, 'a repeated param takes the first')
})

test('a malformed value is treated as absent, not guessed', () => {
  // Guessing true hides real work behind an empty screen. Guessing false shows real
  // people during a demo. Neither is a good default, so a value that is not one of the
  // four accepted spellings means the caller said nothing.
  for (const bad of ['yes', 'demo', '2', 'null', '{}']) {
    assert.equal(demoScopeFromRequest({ query: { demo: bad } }), null, `demo=${bad}`)
  }
})

// ─────────────────────────────────────────────────────────────────────
// 2. Applying it
// ─────────────────────────────────────────────────────────────────────
function fakeQuery() {
  const calls = []
  const q = { calls, eq(col, val) { calls.push([col, val]); return q } }
  return q
}

test('a null scope leaves the query completely untouched', () => {
  const q = fakeQuery()
  assert.equal(applyDemoScope(q, null), q)
  assert.deepEqual(q.calls, [], 'no filter may be added when the boundary is off')
})

test('a scope becomes an is_demo filter', () => {
  const real = fakeQuery()
  applyDemoScope(real, false)
  assert.deepEqual(real.calls, [['is_demo', false]])

  const demo = fakeQuery()
  applyDemoScope(demo, true)
  assert.deepEqual(demo.calls, [['is_demo', true]])
})

test('rowInDemoScope refuses an id from the other population', () => {
  assert.equal(rowInDemoScope({ is_demo: true }, true), true)
  assert.equal(rowInDemoScope({ is_demo: false }, true), false, 'a real student inside a demo')
  assert.equal(rowInDemoScope({ is_demo: true }, false), false, 'a demo student during real work')
  assert.equal(rowInDemoScope({ is_demo: false }, false), true)

  assert.equal(rowInDemoScope(null, true), false, 'no row is not in any population')
  assert.equal(rowInDemoScope(null, null), true, 'unless there is no boundary to be in')
})

// ─────────────────────────────────────────────────────────────────────
// 3. The endpoints actually use it
// ─────────────────────────────────────────────────────────────────────
test('the preview catalog is scoped, students and cohorts alike', () => {
  const src = read('api/portal/admin-preview-access.js')
  assert.match(src, /demoScopeFromRequest\(req\)/,
    'the catalog endpoint must read the scope from the request')

  // Both reads, not just the students one. The cohort names decorate the list, and a
  // real cohort name beside a fabricated student is the kind of detail an audience
  // notices.
  const scoped = [...src.matchAll(/applyDemoScope\(/g)].length
  assert.ok(scoped >= 2,
    `only ${scoped} query is scoped; both the student catalog and the cohort lookup must be`)
})

test('the per-student projection refuses an id from the other population', () => {
  const src = read('api/portal/admin-student-preview.js')
  assert.match(src, /demoScopeFromRequest\(req\)/)
  assert.match(src, /eq\('is_demo', demoScope\)/,
    'the id must be checked against the requested population')
  assert.match(src, /if \(demoScope !== null\)/,
    'the check must be skipped entirely when the boundary is off, or every preview 400s ' +
    'before the migration is applied')

  // And it must happen BEFORE the projection is built, not after.
  assert.ok(src.indexOf('demoScopeFromRequest') < src.indexOf('buildStudentPortalSummary'),
    'the mode check must gate the projection, not follow it')
})

test('the client sends the scope on both preview requests', () => {
  for (const [file, endpoint] of [
    ['src/portal/PortalApp.jsx', 'admin-preview-access'],
    ['src/portal/StudentPortal.jsx', 'admin-student-preview'],
  ]) {
    const src = read(file)
    assert.match(src, /demoScopeParam\(\)/, `${file} must read the current scope`)
    assert.match(src, /demoParam === null \? '' :/,
      `${file} must OMIT the parameter when the boundary is off, not send demo=0`)
    assert.ok(src.includes(endpoint), `${file} should call ${endpoint}`)
  }
})

test('the portal chrome wears the same marker as the staff header', () => {
  const shell = read('src/portal/PortalShell.jsx')
  assert.match(shell, /import DemoModeBadge/)
  assert.match(shell, /<DemoModeBadge \/>/)

  // The shared sheet has to reach the portal bundle, which loads its own CSS and never
  // loads index.css. Without this import the badge renders as unstyled text.
  assert.match(read('src/portal/PortalApp.jsx'), /styles\/demoMode\.css/,
    'the portal must import the shared demo sheet, or the badge has no styling at all')
})
