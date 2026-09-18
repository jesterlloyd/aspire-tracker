// test/demoScope.test.mjs
//
// DEMO-MODE-1. Three things are worth testing here and they are not equally important.
//
// The LOCKSTEP test is the one that matters. DEMO_SCOPED_TABLES tells the client which
// tables to filter on is_demo; the migration decides which tables actually have that
// column. If the two ever disagree in the direction of "client filters, database does
// not have it", every read of that table returns 400 and the app is down. This test
// fails the moment they diverge, in either direction.
//
// The BOUNDARY tests assert the generated PostgREST requests, not the intent. The
// wrapper is only worth anything if update and delete carry is_demo in the WHERE, and
// the only honest way to know that is to look at the URL supabase-js produces.
//
// The STATE tests cover the two-key arrangement in demoMode.js, whose whole reason for
// existing is a timing problem: the answer must be available synchronously, before auth
// resolves, or the first paint of a presentation fetches real rows.

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// A localStorage stub has to exist BEFORE demoMode.js is imported, because that module
// reads the armed marker once at load time and caches it. Installing it afterwards
// would test a different module than the one that ships.
const store = new Map()
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
}

const { installDemoScope, attachDemoScope, DEMO_SCOPED_TABLES, DEMO_UNSCOPED_RPCS, isScopedTable, realtimePayloadInScope } =
  await import('../src/lib/demoScope.js')
const { setDemoMode, isDemoMode, isDemoModeAvailable, isDemoModeArmed, reconcileDemoModeForUser, subscribeDemoMode } =
  await import('../src/lib/demoMode.js')
const { DEMO_BOUNDARY_LIVE } = await import('../src/lib/demoBoundaryFlag.js')

// The boundary tests drive attachDemoScope directly. installDemoScope puts the
// DEMO_BOUNDARY_LIVE gate in front of it, and that gate is false for most of this
// feature's life, so testing through it would test the gate over and over and the
// wrapper never. The gate has its own tests at the end of this file.
//
// setDemoMode/isDemoMode are also gated, so these tests drive the wrapper's notion of
// the mode through a stub rather than through the real state module.

// ─────────────────────────────────────────────────────────────────────
// A client whose fetch records the request instead of making one.
// ─────────────────────────────────────────────────────────────────────
function probeClient() {
  const calls = []
  const mode = { on: false }
  const client = createClient('https://probe.supabase.co', 'anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (url, init = {}) => {
        calls.push({ url: String(url), method: init.method || 'GET', body: init.body })
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
      },
    },
  })
  attachDemoScope(client, () => mode.on)
  return { client, calls, mode }
}

beforeEach(() => {
  store.clear()
  setDemoMode(false)
})

// ─────────────────────────────────────────────────────────────────────
// 1. Lockstep: the registry and the migration name the same tables.
// ─────────────────────────────────────────────────────────────────────
test('every scoped table gets is_demo in the migration, and vice versa', () => {
  const sql = readFileSync(
    join(root, 'supabase/migrations/20260921000000_demo_mode_foundation.sql'), 'utf8',
  )

  // The preflight block is the migration's own statement of what it covers.
  const block = sql.match(/required_tables text\[\] := ARRAY\[([\s\S]*?)\];/)
  assert.ok(block, 'could not find required_tables in the migration')
  const inMigration = [...block[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort()
  const inRegistry = [...DEMO_SCOPED_TABLES].sort()

  const missingFromMigration = inRegistry.filter(t => !inMigration.includes(t))
  const missingFromRegistry = inMigration.filter(t => !inRegistry.includes(t))

  assert.deepEqual(missingFromMigration, [],
    'DEMO_SCOPED_TABLES filters these, but the migration never adds is_demo to them. ' +
    'Every read of them would 400. Add them to the migration or remove them from the registry.')
  assert.deepEqual(missingFromRegistry, [],
    'The migration adds is_demo to these, but the client never filters them, so they ' +
    'leak real rows into a demo. Add them to DEMO_SCOPED_TABLES.')
})

test('the migration installs one inheritance trigger per child table', () => {
  const sql = readFileSync(
    join(root, 'supabase/migrations/20260921000000_demo_mode_foundation.sql'), 'utf8',
  )
  const spec = sql.match(/spec text\[\]\[\] := ARRAY\[([\s\S]*?)\];/)
  assert.ok(spec, 'could not find the trigger spec')
  const children = [...spec[1].matchAll(/\['([a-z_]+)','([a-z_]+)','([a-z_]+)'\]/g)]

  // Roots own their is_demo value. Everything else must inherit it, or a row written by
  // an rpc or a server endpoint would be stamped by nobody.
  const ROOTS = new Set(['cohorts', 'students', 'units', 'contacts', 'preceptors'])
  const expectedChildren = DEMO_SCOPED_TABLES.filter(t => !ROOTS.has(t)).sort()
  const actualChildren = children.map(m => m[1]).sort()

  assert.deepEqual(actualChildren, expectedChildren,
    'A scoped child table with no inheritance trigger gets is_demo only when the browser ' +
    'happens to be the writer. Server endpoints and rpcs would write it wrong.')

  for (const [, child, parent, fk] of children) {
    assert.ok(['students', 'cohorts', 'units'].includes(parent),
      `${child} inherits from ${parent}, which is not a root table`)
    assert.ok(fk.endsWith('_id'), `${child}.${fk} does not look like a foreign key`)
  }
})

// ─────────────────────────────────────────────────────────────────────
// 2. The boundary, measured on the generated request.
// ─────────────────────────────────────────────────────────────────────
test('reads on a scoped table carry the current mode', async () => {
  const { client, calls, mode } = probeClient()

  await client.from('students').select('id,first_name')
  assert.match(calls[0].url, /is_demo=eq\.false/)

  mode.on = true
  await client.from('students').select('id,first_name')
  assert.match(calls[1].url, /is_demo=eq\.true/)
})

test('the filter survives everything chained after it', async () => {
  const { client, calls } = probeClient()

  await client.from('students').select('*').eq('cohort_id', 'c1').order('last_name').limit(10)
  assert.match(calls[0].url, /is_demo=eq\.false/)
  assert.match(calls[0].url, /cohort_id=eq\.c1/)
  assert.match(calls[0].url, /order=last_name/)

  await client.from('students').select('*', { count: 'exact', head: true })
  assert.equal(calls[1].method, 'HEAD')
  assert.match(calls[1].url, /is_demo=eq\.false/)

  await client.from('students').select('*').or('a.eq.1,b.eq.2')
  assert.match(calls[2].url, /is_demo=eq\.false/)
})

test('a write in demo mode cannot reach a real row', async () => {
  const { client, calls, mode } = probeClient()
  mode.on = true

  // The id handed to these is a REAL student's id. The mode is in the WHERE clause, so
  // the statement matches nothing. This is the property the whole feature rests on.
  await client.from('students').update({ status: 'Placed' }).eq('id', 'real-student')
  assert.equal(calls[0].method, 'PATCH')
  assert.match(calls[0].url, /is_demo=eq\.true/)
  assert.match(calls[0].url, /id=eq\.real-student/)

  await client.from('students').delete().eq('id', 'real-student')
  assert.equal(calls[1].method, 'DELETE')
  assert.match(calls[1].url, /is_demo=eq\.true/)
})

test('inserts are stamped with the current mode', async () => {
  const { client, calls, mode } = probeClient()

  await client.from('students').insert({ first_name: 'Ada' })
  assert.deepEqual(JSON.parse(calls[0].body), { first_name: 'Ada', is_demo: false })

  mode.on = true
  await client.from('students').insert([{ first_name: 'Ada' }, { first_name: 'Grace' }])
  assert.deepEqual(JSON.parse(calls[1].body), [
    { first_name: 'Ada', is_demo: true }, { first_name: 'Grace', is_demo: true },
  ])

  // The mode decides, never the payload.
  await client.from('students').insert({ first_name: 'Ada', is_demo: false })
  assert.equal(JSON.parse(calls[2].body).is_demo, true)
})

test('unscoped tables are left alone in both modes', async () => {
  const { client, calls, mode } = probeClient()
  mode.on = true

  await client.from('templates').select('*')
  assert.doesNotMatch(calls[0].url, /is_demo/)

  await client.from('knowledge_entries').select('*')
  assert.doesNotMatch(calls[1].url, /is_demo/)

  assert.equal(isScopedTable('students'), true)
  assert.equal(isScopedTable('templates'), false)
})

test('installing twice does not double-filter', async () => {
  const { client, calls, mode } = probeClient()
  attachDemoScope(client, () => mode.on)
  attachDemoScope(client, () => mode.on)

  await client.from('students').select('*')
  assert.equal(calls[0].url.match(/is_demo=eq\.false/g).length, 1)
})

// ─────────────────────────────────────────────────────────────────────
// 3. Realtime, the one read path the wrapper cannot intercept.
// ─────────────────────────────────────────────────────────────────────
test('realtime payloads are admitted only when they match the mode', { skip: !DEMO_BOUNDARY_LIVE && 'boundary not live; see the gate tests below' }, () => {
  const real = () => false
  const demo = () => true

  assert.equal(realtimePayloadInScope({ new: { id: 1, is_demo: false } }, real), true)
  assert.equal(realtimePayloadInScope({ new: { id: 1, is_demo: true } }, real), false)
  assert.equal(realtimePayloadInScope({ new: { id: 1, is_demo: true } }, demo), true)
  assert.equal(realtimePayloadInScope({ new: { id: 1, is_demo: false } }, demo), false)

  // A payload with no is_demo belongs to an unscoped table. Dropping it would break
  // realtime for everything outside the boundary, so it is admitted.
  assert.equal(realtimePayloadInScope({ new: { id: 1 } }, real), true)
  assert.equal(realtimePayloadInScope(null, real), true)
})

// ─────────────────────────────────────────────────────────────────────
// 4. The documented rpc gap has not silently grown.
// ─────────────────────────────────────────────────────────────────────
test('DEMO_UNSCOPED_RPCS still lists every people-bearing rpc in src/', () => {
  const out = execSync(
    `grep -rhoE "\\.rpc\\('[a-z_]+'" ${JSON.stringify(join(root, 'src'))} || true`,
    { encoding: 'utf8' },
  )
  const found = new Set([...out.matchAll(/\.rpc\('([a-z_]+)'/g)].map(m => m[1]))

  // Functions that touch only the caller's own identity or pure configuration are not
  // part of the gap; they show the same thing in both modes and that is correct.
  const IDENTITY_OR_CONFIG = new Set([
    'get_my_profile', 'update_my_avatar', 'touch_my_last_login',
    'update_my_connect_signature', 'get_my_portal_access', 'mark_staff_notifications_read',
    'verify_school_form_password', 'school_form_requires_password',
  ])

  const unaccounted = [...found].filter(
    fn => !IDENTITY_OR_CONFIG.has(fn) && !DEMO_UNSCOPED_RPCS.includes(fn),
  )
  assert.deepEqual(unaccounted, [],
    'A new rpc reads or writes people data and is outside the demo boundary. Add it to ' +
    'DEMO_UNSCOPED_RPCS (and handle it), or to IDENTITY_OR_CONFIG if it is genuinely neither.')
})

// ─────────────────────────────────────────────────────────────────────
// 5. The two-key state arrangement.
// ─────────────────────────────────────────────────────────────────────
test('the armed marker is readable synchronously, before any user id exists', () => {
  setDemoMode(true, 'user-a')
  assert.equal(store.get('aspire:demoMode'), '1')
  assert.equal(store.get('aspire:demoMode:user-a'), '1')

  setDemoMode(false, 'user-a')
  assert.equal(store.has('aspire:demoMode'), false)
  assert.equal(store.get('aspire:demoMode:user-a'), '0')
})

test('a different account never inherits the previous presenter mode', () => {
  setDemoMode(true, 'user-a')
  assert.equal(isDemoModeArmed(), true)

  // user-b signs in on the same machine. They have never used demo mode, so they get
  // real data, and the marker user-a left behind is cleared rather than adopted.
  reconcileDemoModeForUser('user-b')
  assert.equal(isDemoModeArmed(), false)

  // user-a signs back in and their own choice is still theirs.
  reconcileDemoModeForUser('user-a')
  assert.equal(isDemoModeArmed(), true)
})

test('subscribers are notified only on a real change', () => {
  const seen = []
  const off = subscribeDemoMode(() => seen.push(isDemoModeArmed()))

  setDemoMode(true, 'u')
  setDemoMode(true, 'u')   // no change, no notification
  setDemoMode(false, 'u')
  off()
  setDemoMode(true, 'u')   // unsubscribed

  assert.deepEqual(seen, [true, false])
})

// ─────────────────────────────────────────────────────────────────────
// 6. The gate. These are the tests that matter while the migration is unapplied.
// ─────────────────────────────────────────────────────────────────────
test('while the boundary is not live, nothing can believe it is in a demo', () => {
  if (DEMO_BOUNDARY_LIVE) return // the gate is open; the tests above are the live contract

  // The switch can be armed, and storage remembers it.
  setDemoMode(true, 'owner')
  assert.equal(isDemoModeArmed(), true, 'the stored switch position is honoured')

  // But every consumer is told NO. This is what stops a flag left behind by an earlier
  // build from putting the Demo badge on screen over real student data.
  assert.equal(isDemoMode(), false, 'the gated answer overrides stored state')
  assert.equal(isDemoModeAvailable(), false)
})

test('while the boundary is not live, installDemoScope does not touch the client', async () => {
  if (DEMO_BOUNDARY_LIVE) return

  const calls = []
  const client = createClient('https://probe.supabase.co', 'anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (url, init = {}) => {
        calls.push({ url: String(url), method: init.method || 'GET' })
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
      },
    },
  })
  installDemoScope(client)

  // No is_demo anywhere. The app must be byte-identical to a build with no demo mode,
  // because the column this would filter on does not exist in the database yet and a
  // filter on a missing column is a 400 on every screen.
  await client.from('students').select('*')
  await client.from('students').update({ status: 'x' }).eq('id', 'y')
  await client.from('students').insert({ first_name: 'z' })
  for (const c of calls) assert.doesNotMatch(c.url, /is_demo/)
})

test('the flag ships OFF, so the code is safe to deploy before the SQL is applied', () => {
  const src = readFileSync(join(root, 'src/lib/demoBoundaryFlag.js'), 'utf8')
  assert.match(src, /export const DEMO_BOUNDARY_LIVE = (true|false)/)

  // This assertion is a reminder, not a prohibition. Flipping it to true is the correct
  // second step, AFTER 20260921000000 is applied and verified. If you are here because
  // this failed, confirm the migration is live in production, then update this test in
  // the same commit that flips the flag.
  assert.equal(DEMO_BOUNDARY_LIVE, false,
    'DEMO_BOUNDARY_LIVE is true. Confirm 20260921000000_demo_mode_foundation.sql is ' +
    'applied in production, then change this assertion to true in the same commit.')
})
