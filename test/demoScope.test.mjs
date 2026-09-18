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
import { readFileSync, readdirSync } from 'node:fs'
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
// The boundary is spread over more than one migration now: the foundation covers the
// ASPIRE spine, DEMO-MODE-2 adds the residency workspace. Both are read, because a
// registry entry is satisfied by ANY of them and a table named by any of them must be
// in the registry.
const DEMO_MIGRATIONS = [
  'supabase/migrations/20260921000000_demo_mode_foundation.sql',
  'supabase/migrations/20260922000000_demo_mode_residency.sql',
]

/** Every table named in a migration's own preflight statement of what it covers. */
function tablesInMigrations() {
  const out = []
  for (const file of DEMO_MIGRATIONS) {
    const sql = readFileSync(join(root, file), 'utf8')
    const block = sql.match(/required_tables text\[\] := ARRAY\[([\s\S]*?)\];/)
    assert.ok(block, `could not find required_tables in ${file}`)
    out.push(...[...block[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]))
  }
  return out
}

/** Every (child, parent, fk) inheritance trigger the migrations install. */
function triggerSpecs() {
  const out = []
  for (const file of DEMO_MIGRATIONS) {
    const sql = readFileSync(join(root, file), 'utf8')
    const spec = sql.match(/spec text\[\]\[\] := ARRAY\[([\s\S]*?)\];/)
    assert.ok(spec, `could not find the trigger spec in ${file}`)
    out.push(...[...spec[1].matchAll(/\['([a-z_]+)','([a-z_]+)','([a-z_]+)'\]/g)])
  }
  return out
}

test('every scoped table gets is_demo in a migration, and vice versa', () => {
  const inMigration = tablesInMigrations().sort()
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

test('the migrations install one inheritance trigger per child table', () => {
  const children = triggerSpecs()

  // Roots own their is_demo value. Everything else must inherit it, or a row written by
  // an rpc or a server endpoint would be stamped by nobody. ngrp_cycles is a root for
  // the same reason cohorts is: a residency cycle belongs to no larger thing.
  const ROOTS = new Set(['cohorts', 'students', 'units', 'contacts', 'preceptors', 'ngrp_cycles'])
  const expectedChildren = DEMO_SCOPED_TABLES.filter(t => !ROOTS.has(t)).sort()
  const actualChildren = children.map(m => m[1]).sort()

  assert.deepEqual(actualChildren, expectedChildren,
    'A scoped child table with no inheritance trigger gets is_demo only when the browser ' +
    'happens to be the writer. Server endpoints and rpcs would write it wrong.')

  for (const [, child, parent, fk] of children) {
    // A child may inherit from any ROOT, that is, any table that owns its own is_demo
    // rather than deriving it. preceptor_cohort_participation inherits from preceptors
    // because it IS a preceptor's history; the cohort id would give the same answer for
    // well-formed data, but the preceptor is the entity the row belongs to.
    // A parent must be a table that CARRIES is_demo by the time the child is written.
    // A root always does. A scoped child does too, because its own BEFORE INSERT
    // trigger resolved it when that row was inserted, which the foreign key forces to
    // happen first. That is what lets the transition rows chain: an assignment inherits
    // from its candidate, a revision from its assignment, and neither has a student_id
    // of its own to inherit from directly.
    assert.ok(ROOTS.has(parent) || DEMO_SCOPED_TABLES.includes(parent),
      `${child} inherits from ${parent}, which carries no is_demo of its own`)
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
test('the gate decides what every consumer is told', () => {
  // Deliberately written to assert something in BOTH states rather than returning early
  // when the flag is on. A test that silently no-ops is a gate that cannot fail, and
  // this repository has shipped one of those before.
  setDemoMode(true, 'owner')
  assert.equal(isDemoModeArmed(), true, 'the stored switch position is always honoured')

  if (DEMO_BOUNDARY_LIVE) {
    // Live: the armed switch is the answer, and the feature is offered.
    assert.equal(isDemoMode(), true)
    assert.equal(isDemoModeAvailable(), true)

    setDemoMode(false, 'owner')
    assert.equal(isDemoMode(), false, 'turning it off must actually turn it off')
  } else {
    // Not live: every consumer is told NO regardless of storage. This is what stops a
    // marker left behind by a later build from putting the Demo badge over real data.
    assert.equal(isDemoMode(), false, 'the gate overrides stored state')
    assert.equal(isDemoModeAvailable(), false)
  }
})

test('installDemoScope follows the gate', async () => {
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
  setDemoMode(false, 'owner')
  installDemoScope(client)

  await client.from('students').select('*')
  await client.from('students').update({ status: 'x' }).eq('id', 'y')

  if (DEMO_BOUNDARY_LIVE) {
    // Live: the boundary is installed, so real mode asks for is_demo = false explicitly.
    for (const c of calls) assert.match(c.url, /is_demo=eq\.false/)
  } else {
    // Not live: byte-identical to a build with no demo mode, because the column this
    // would filter on does not exist yet and a filter on a missing column is a 400.
    for (const c of calls) assert.doesNotMatch(c.url, /is_demo/)
  }
})

test('the flag is ON, which is only correct while the migration is applied', () => {
  const src = readFileSync(join(root, 'src/lib/demoBoundaryFlag.js'), 'utf8')
  assert.match(src, /export const DEMO_BOUNDARY_LIVE = (true|false)/)

  // A reminder, not a prohibition, and it now points the other way. The flag went true
  // once 20260921000000 was applied and its V1-V4 confirmed in production. If you are
  // here because this failed, you set it back to false: that is a legitimate way to
  // disable the feature, but any seeded demo rows then become visible in normal use, so
  // run db/demo/demo_teardown.sql first and update this assertion in the same commit.
  assert.equal(DEMO_BOUNDARY_LIVE, true,
    'DEMO_BOUNDARY_LIVE is false. If that is deliberate, tear the demo rows out with ' +
    'db/demo/demo_teardown.sql, because nothing filters them while the flag is off.')
})

// ─────────────────────────────────────────────────────────────────────
// 7. A view can never enter the boundary again
// ─────────────────────────────────────────────────────────────────────
test('no scoped relation is a view', () => {
  // student_active_disposition got into the registry and through the preflight, because
  // to_regclass() resolves a view perfectly happily. The failure surfaced halfway
  // through the migration as "ADD COLUMN cannot be performed on relation ... This
  // operation is not supported for views."
  //
  // The migration now checks relkind rather than mere existence. This is the same check
  // one step earlier, against the views this repository actually defines, so the
  // mistake is caught while writing rather than while applying.
  const views = new Set()
  for (const dir of ['supabase/migrations', 'migrations']) {
    let entries = []
    try { entries = readdirSync(join(root, dir)) }
    catch (err) { if (err.code === 'ENOENT') continue; throw err }
    for (const f of entries) {
      if (!f.endsWith('.sql')) continue
      const sql = readFileSync(join(root, dir, f), 'utf8')
      for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?([a-z_]+)/gi)) {
        views.add(m[1].toLowerCase())
      }
    }
  }
  assert.ok(views.size > 5, `expected to find this repo's views, found ${views.size}`)

  const offenders = DEMO_SCOPED_TABLES.filter(t => views.has(t))
  assert.deepEqual(offenders, [],
    'These are VIEWS, not tables. A view cannot carry an is_demo column, so the ' +
    'migration will fail on ALTER TABLE, and the client would filter on a column the ' +
    'view does not expose. Scope the view\'s BASE TABLE instead, or leave it out when ' +
    'every read of it is already scoped by a parent the boundary filters.')
})

test('the migration checks relkind, not just existence', () => {
  const sql = readFileSync(
    join(root, 'supabase/migrations/20260921000000_demo_mode_foundation.sql'), 'utf8')
  assert.match(sql, /relkind/,
    'the preflight must verify each relation is an ordinary table; to_regclass() alone ' +
    'resolves views and defers the failure to ALTER TABLE')
  assert.match(sql, /NOT IN \('r', 'p'\)/, 'ordinary and partitioned tables are the accepted kinds')
})

test('the preflight reports every problem in one run', () => {
  const sql = readFileSync(
    join(root, 'supabase/migrations/20260921000000_demo_mode_foundation.sql'), 'utf8')
  // Raising on the first fault means discovering a schema one exception and one round
  // trip at a time. It cost two of those before this was fixed.
  assert.match(sql, /problems text\[\]/, 'faults must be collected, not raised immediately')
  assert.match(sql, /array_length\(problems, 1\) > 0/, 'and raised once at the end')
  assert.match(sql, /array_to_string\(problems/, 'with all of them in the message')
})

// ─────────────────────────────────────────────────────────────────────
// 8. The one panel that substitutes instead of filtering
// ─────────────────────────────────────────────────────────────────────
test('the staff directory substitutes, and the session profile never does', () => {
  // Comments stripped: the directory's own comment EXPLAINS that AuthContext reads
  // get_my_profile, and matching that prose would make this test pass or fail on
  // documentation rather than on code. It failed exactly that way when first written.
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/[^\n]*/g, '')
  const dir = strip(readFileSync(join(root, 'src/components/settings/AccountsDirectory.jsx'), 'utf8'))
  const auth = strip(readFileSync(join(root, 'src/contexts/AuthContext.jsx'), 'utf8'))

  // The substitution is safe ONLY because these are two different RPCs. If the session
  // ever starts reading its own profile out of get_all_user_profiles, or the directory
  // starts reading get_my_profile, swapping one would change the other and this whole
  // exception collapses.
  assert.match(dir, /get_all_user_profiles/, 'the directory reads the list RPC')
  assert.doesNotMatch(dir, /get_my_profile/,
    'the directory must not read the session profile RPC; the substitution would then ' +
    'change who the app thinks you are')
  assert.match(auth, /get_my_profile/, 'the session reads its own profile RPC')
  assert.doesNotMatch(auth, /get_all_user_profiles/,
    'AuthContext must never resolve the session from the substituted list')

  // And the substitution itself.
  assert.match(dir, /if \(demoMode\) return demoStaffRows\(\)/)
  assert.match(dir, /queryKey: \['people_access_users', demoMode\]/,
    'the mode must be in the query key, or flipping it serves a cached real directory')
})

test('user_profiles is not in the demo boundary, deliberately', () => {
  // Filtering it would hide the signed-in user's own row, which resolves permissions,
  // the Owner/Admin flags, the greeting and the avatar. src/lib/demoStaff.js exists
  // precisely because this table cannot be filtered.
  assert.ok(!DEMO_SCOPED_TABLES.includes('user_profiles'),
    'user_profiles must never be scoped: the session profile would vanish and the app ' +
    'would lose permissions rather than merely showing demo data')
})

// ─────────────────────────────────────────────────────────────────────
// 9. The marker has to read on chrome that is three different colours
// ─────────────────────────────────────────────────────────────────────
test('demo mode announces itself through the scope light, not a second badge', () => {
  const labels = readFileSync(join(root, 'src/lib/scopePickerLabels.js'), 'utf8')
  const picker = readFileSync(join(root, 'src/components/Header/scope/ScopePicker.jsx'), 'utf8')
  const header = readFileSync(join(root, 'src/components/Header/Header.jsx'), 'utf8')

  // The first version hung a separate amber pill beside the wordmark. It was a second
  // thing to look at, and being a translucent tint it also inherited whatever chrome was
  // behind it, which is white in some portals and navy in the staff app. The scope
  // control already has a status light the viewer has learned to read; a fourth colour
  // in that one light says the same thing with nothing added.
  assert.match(labels, /export const DEMO_TONE/, 'the demo tone must live with the status tones')
  assert.match(labels, /cohortStatusTone\(status, isDemo = false\)/,
    'one tone function, with the demo case inside it, or the two rules drift')
  assert.match(labels, /if \(isDemo\) return DEMO_TONE/,
    'demo must WIN over status: a demo cohort is Active, but that is not what matters while presenting')
  assert.match(picker, /cohortStatusTone\(cohortStatus, cohortIsDemo\)/)
  assert.match(header, /cohortIsDemo: cohort\.activeCohort\?\.is_demo === true/)

  // And the pill is gone for good.
  assert.doesNotMatch(header, /DemoModeBadge/, 'the separate badge must not come back')
})

test('the demo cohort gets a mark in the scope picker', () => {
  const mark = readFileSync(join(root, 'src/components/Header/scope/SeasonMark.jsx'), 'utf8')
  const list = readFileSync(join(root, 'src/components/Header/scope/InternshipCohortList.jsx'), 'utf8')

  // Every other cohort is named for a season and gets an icon. "Demo Cohort" is named
  // for none, so it was the one row with an empty slot beside a list of marked ones.
  assert.match(mark, /Presentation/, 'the demo cohort needs its own icon')
  assert.match(mark, /isDemo \? Presentation/,
    'the demo mark must WIN over a season, so a cohort named "Spring Demo" still reads as the demo')
  assert.match(list, /<SeasonMark name=\{c\.name\} isDemo=\{c\.is_demo\} \/>/,
    'the ASPIRE cohort list must pass the flag through')

  // Monochrome, like the seasons. The header pill carries the STATE; this is
  // punctuation, and two things shouting the same thing is worse than one.
  assert.doesNotMatch(mark, /#A855F7|DEMO_TONE/,
    'the mark is monochrome punctuation; the purple scope light is what carries the state')
})
