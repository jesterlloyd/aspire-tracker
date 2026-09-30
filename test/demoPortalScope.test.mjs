// test/demoPortalScope.test.mjs
//
// DEMO-MODE-2: the four portals that phase 4 deliberately left out.
//
// Phase 4 filtered the Student Portal preview by filtering the ONE endpoint that decides
// its population, and said so in its own commit message: "the Unit Leader, Academic
// Partner, Nursing Education & Leadership and Residency previews resolve their own scope
// inside their roster endpoints, and those endpoints are not demo-filtered yet."
//
// They are now, and NOT by editing 25 endpoints. The boundary goes on the client each of
// them shares, once, in the function that already resolves their authorization. That is
// the same argument src/lib/demoScope.js makes for the browser, and it is worth repeating
// because it is what these tests defend: a boundary that must be remembered at every call
// site is a boundary that fails quietly, and the failure is a real student's name on a
// projector in a ballroom.
//
// WHAT EACH SECTION IS FOR
//
//   1  The generated PostgREST request. The wrapper is worth nothing unless is_demo is
//      actually in the WHERE clause, and the only honest way to know is the URL.
//   2  Three states, because absent is not false.
//   3  The mutation hazard. scopedServiceDb MUTATES its client, which is safe only
//      because getServiceDb() builds a new one per call. That property is pinned here.
//   4  Every portal scope resolver goes through it. A new portal that forgets is the
//      failure this catches.
//   5  The residency join rule, for tables that carry no is_demo of their own.
//   6  The header that tells the server which population to answer for.
//   7  The seed rows the Unit Leader Portal authorizes on, which did not exist.

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

// demoMode.js reads its marker once at module load, so the stub has to exist first.
const store = new Map()
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
}

const { scopedServiceDb, serviceDbForRequest, demoScopeOf, narrowToStudents, isDemoScopedTable } =
  await import('../lib/server/demoScope.js')
const { DEMO_SCOPED_TABLES } = await import('../shared/demoTables.js')
const { installDemoApiHeader, isOwnApiRequest, DEMO_HEADER } = await import('../src/lib/demoFetch.js')
const { setDemoMode } = await import('../src/lib/demoMode.js')

// A client whose fetch records the request instead of making one.
function probeClient() {
  const calls = []
  const client = createClient('https://probe.supabase.co', 'anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (url, init = {}) => {
        calls.push({ url: String(url), method: init.method || 'GET', body: init.body })
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
      },
    },
  })
  return { client, calls }
}

beforeEach(() => { store.clear(); setDemoMode(false) })

// ─────────────────────────────────────────────────────────────────────
// 1. What the wrapper actually generates
// ─────────────────────────────────────────────────────────────────────
test('a demo scope puts is_demo in the WHERE clause of every read and write', async () => {
  const { client, calls } = probeClient()
  const db = scopedServiceDb(client, true)

  await db.from('students').select('id')
  await db.from('students').update({ status: 'Placed' }).eq('id', 'x')
  await db.from('students').delete().eq('id', 'x')

  assert.match(calls[0].url, /is_demo=eq\.true/, 'select must be filtered')
  assert.match(calls[1].url, /is_demo=eq\.true/,
    'UPDATE must carry the mode in its WHERE, or a write issued during a demo can reach a real row')
  assert.match(calls[2].url, /is_demo=eq\.true/,
    'DELETE must carry the mode in its WHERE, for the same reason')
})

test('an insert is stamped, and an explicit is_demo in the payload loses', async () => {
  const { client, calls } = probeClient()
  const db = scopedServiceDb(client, true)

  await db.from('student_shift_logs').insert({ student_id: 'x', is_demo: false })
  assert.equal(JSON.parse(calls[0].body).is_demo, true,
    'the mode decides, not the payload: a caller cannot write a real row from inside a demo')

  await db.from('student_shift_logs').insert([{ student_id: 'a' }, { student_id: 'b' }])
  assert.deepEqual(JSON.parse(calls[1].body).map(r => r.is_demo), [true, true],
    'a batch insert is stamped row by row')
})

test('real mode asks for real rows, which is the boundary working in both directions', async () => {
  const { client, calls } = probeClient()
  const db = scopedServiceDb(client, false)
  await db.from('students').select('id')
  assert.match(calls[0].url, /is_demo=eq\.false/,
    'a demo row must never appear in real work either; that was an explicit decision')
})

test('a table outside the registry is untouched in both modes', async () => {
  const { client, calls } = probeClient()
  const db = scopedServiceDb(client, true)
  await db.from('user_profiles').select('id')
  assert.doesNotMatch(calls[0].url, /is_demo/,
    'user_profiles has no is_demo column; filtering it would 400 every portal in demo mode')
  assert.equal(isDemoScopedTable('user_profiles'), false)
  assert.equal(isDemoScopedTable('students'), true)
})

test('filters chained after the boundary still apply', async () => {
  const { client, calls } = probeClient()
  const db = scopedServiceDb(client, true)
  await db.from('students').select('id').eq('status', 'Completed').order('last_name').limit(5)
  assert.match(calls[0].url, /is_demo=eq\.true/)
  assert.match(calls[0].url, /status=eq\.Completed/,
    'the wrapper returns the same builder, so everything chained after it survives')
  assert.match(calls[0].url, /order=last_name/)
})

// ─────────────────────────────────────────────────────────────────────
// 2. Three states
// ─────────────────────────────────────────────────────────────────────
test('a null scope returns the client completely untouched', async () => {
  const { client, calls } = probeClient()
  const db = scopedServiceDb(client, null)
  assert.equal(db, client, 'not a wrapper, the same object')
  await db.from('students').select('id')
  assert.doesNotMatch(calls[0].url, /is_demo/,
    'a build that does not know about demo mode must behave exactly as it did before')
  assert.equal(demoScopeOf(db), null)
})

test('serviceDbForRequest reads the scope off the request', async () => {
  const mk = () => probeClient().client
  assert.equal(demoScopeOf(serviceDbForRequest(mk(), { headers: {} })), null)
  assert.equal(demoScopeOf(serviceDbForRequest(mk(), { headers: { 'x-aspire-demo': '1' } })), true)
  assert.equal(demoScopeOf(serviceDbForRequest(mk(), { headers: { 'x-aspire-demo': '0' } })), false)
  assert.equal(demoScopeOf(serviceDbForRequest(mk(), { query: { demo: '1' } })), true,
    'the query parameter still works: phase 4 uses it on the two preview endpoints')
  assert.equal(demoScopeOf(serviceDbForRequest(mk(), { headers: { 'x-aspire-demo': 'yes' } })), null,
    'a malformed value is absent, not a guess')
})

// ─────────────────────────────────────────────────────────────────────
// 3. The mutation hazard
// ─────────────────────────────────────────────────────────────────────
test('wrapping twice does not double-filter or re-scope', async () => {
  const { client, calls } = probeClient()
  const db = scopedServiceDb(scopedServiceDb(client, true), false)
  await db.from('students').select('id')
  const hits = [...calls[0].url.matchAll(/is_demo=eq\./g)].length
  assert.equal(hits, 1, 'one filter, not two')
  assert.match(calls[0].url, /is_demo=eq\.true/,
    'the FIRST scope stands: a second wrap with the other scope would ask for rows that are ' +
    'both demo and real, which is always nothing at all')
})

test('getServiceDb builds a NEW client per call, which is what makes mutation safe', () => {
  // scopedServiceDb mutates the client it is given. That is contained only because the
  // client never outlives the request. If this function ever starts caching a module-level
  // singleton, one demo request would scope every later request in that warm container -
  // including a real Unit Leader's, who would then see an empty roster.
  const src = read('api/lib/portalAuth.js')
  const fn = src.match(/export function getServiceDb\(\)[\s\S]*?\n}/)
  assert.ok(fn, 'getServiceDb not found')
  assert.match(fn[0], /return createClient\(/,
    'getServiceDb must construct and return a client, not hand back a cached one')
  assert.doesNotMatch(src, /let\s+(cached|_db|singleton)[\s\S]{0,200}getServiceDb/,
    'a cached client would make scopedServiceDb leak across requests')
})

// ─────────────────────────────────────────────────────────────────────
// 4. Every portal resolver goes through the boundary
// ─────────────────────────────────────────────────────────────────────
// The list IS the coverage claim. A portal added later without a line here is a portal
// whose roster shows real students during a demo.
const RESOLVERS = [
  ['api/lib/unitLeaderScope.js',       'Unit Leader'],
  ['api/lib/schoolScope.js',           'Academic Partner'],
  ['api/lib/nursingAcademicScope.js',  'Nursing Education & Leadership'],
  ['api/ngrp-workspace.js',            'Residency (read)'],
  ['api/ngrp-manage.js',               'Residency (manage)'],
  ['api/ngrp-support.js',              'Residency (support)'],
  ['api/ngrp-preceptor-feedback.js',   'Residency (preceptor feedback)'],
  ['api/ngrp-transition-send.js',      'Residency (transition send)'],
]

for (const [file, portal] of RESOLVERS) {
  test(`${portal}: the service client is scoped before anything reads through it`, () => {
    const src = read(file)
    assert.match(src, /serviceDbForRequest\(getServiceDb\(\), req\)|scopedServiceDb\(getServiceDb\(\), demoScope\)/,
      `${file} calls getServiceDb() without applying the demo boundary. Every read below it ` +
      'then answers from both populations at once.')
    assert.doesNotMatch(src, /^\s*(const|let)\s+db\s*=\s*getServiceDb\(\)\s*$/m,
      `${file} still has a bare getServiceDb() assignment`)
  })
}

test('the Academic Partner preview derives demo schools from students, not from a catalog', () => {
  // The canonical schools catalog has no is_demo column and never will: it describes the
  // real world. A demo whose schools came from it would resolve to an empty roster,
  // because Pacific Crest University is not in anybody's catalog.
  const src = read('api/lib/schoolScope.js')
  assert.match(src, /demoScope === true[\s\S]{0,400}\.from\('schools'\)/,
    'the schools catalog read must be skipped in demo mode in favour of the student-derived fallback')
})

// ─────────────────────────────────────────────────────────────────────
// 5. The residency join rule
// ─────────────────────────────────────────────────────────────────────
test('narrowToStudents drops a row whose student is outside the population', () => {
  const rows = [{ student_id: 'demo' }, { student_id: 'real' }]
  assert.deepEqual(narrowToStudents(rows, ['demo'], true).map(r => r.student_id), ['demo'])
  assert.deepEqual(narrowToStudents(rows, ['demo', 'real'], null).map(r => r.student_id), ['demo', 'real'],
    'a null scope changes nothing at all')
  assert.deepEqual(narrowToStudents(rows, [], true), [])
})

test('narrowToStudents takes a key function, because the id can come from either row', () => {
  const rows = [{ candidate_id: 'c1', student_id: null }]
  const byCandidate = { c1: 'demo' }
  assert.equal(
    narrowToStudents(rows, ['demo'], true, r => r.student_id || byCandidate[r.candidate_id]).length, 1,
    'an outcome with no student_id of its own falls back to its candidate, exactly as composeResidents does')
})

test('a residency hire record is filtered by its student, since it carries no is_demo', () => {
  // The leak this closes: composeResidents keeps an outcome whose student was filtered
  // away and renders it with a BLANK NAME - while its own columns, a real Cedars-Sinai
  // address and hire unit among them, stay intact on the screen.
  const src = read('lib/server/ngrpResidents.js')
  assert.match(src, /narrowToStudents\(/, 'loadResidents must narrow its outcomes')
  assert.match(src, /outcomes:\s*inScope/,
    'composeResidents must receive the NARROWED list; passing the original would make the ' +
    'filter above it decorative')
})

test('the applicant roster needs no such rule, and this is why', () => {
  // deriveApplicantRows maps over STUDENTS and looks candidates up by student id, so a
  // candidate whose student is filtered away simply never appears. If that ever inverts,
  // the Residency applicant roster gains the same leak the Residents tab had.
  const src = read('src/lib/ngrp/ngrpStates.js')
  const fn = src.match(/export function deriveApplicantRows[\s\S]*?\n}/)
  assert.ok(fn, 'deriveApplicantRows not found')
  assert.match(fn[0], /\(students \|\| \[\]\)\s*\n?\s*\.filter/,
    'deriveApplicantRows must iterate students, not candidates')
})

// ─────────────────────────────────────────────────────────────────────
// 6. The header
// ─────────────────────────────────────────────────────────────────────
test('only same-origin /api/ requests are annotated', () => {
  const origin = 'https://aspireintelligence.app'
  assert.equal(isOwnApiRequest('/api/portal/unit-roster', origin), true)
  assert.equal(isOwnApiRequest(`${origin}/api/ngrp-workspace`, origin), true)
  assert.equal(isOwnApiRequest('/students', origin), false, 'a page route is not an endpoint')
  assert.equal(isOwnApiRequest('https://abc.supabase.co/rest/v1/students', origin), false,
    'a custom header on a CROSS-ORIGIN request forces a preflight, which would break every ' +
    'Supabase read in the app. This is the most important line in this file.')
  assert.equal(isOwnApiRequest(null, origin), false)
})

test('the patched fetch adds the header, and adds it to nothing else', async () => {
  const seen = []
  const scope = {
    location: { origin: 'https://aspireintelligence.app' },
    Request: globalThis.Request,
    fetch: async (input, init) => { seen.push({ input, init }); return new Response('{}') },
  }
  const original = installDemoApiHeader(scope)
  assert.ok(original, 'install returns the function it replaced')

  setDemoMode(true)
  await scope.fetch('/api/portal/unit-roster', { headers: { Authorization: 'Bearer x' } })
  assert.equal(new Headers(seen[0].init.headers).get(DEMO_HEADER), '1')
  assert.equal(new Headers(seen[0].init.headers).get('Authorization'), 'Bearer x',
    'the caller\'s own headers survive')

  await scope.fetch('https://abc.supabase.co/rest/v1/students')
  assert.equal(seen[1].init, undefined, 'a cross-origin request is passed through byte for byte')

  setDemoMode(false)
  await scope.fetch('/api/portal/unit-roster')
  assert.equal(new Headers(seen[2].init.headers).get(DEMO_HEADER), '0',
    'real mode says so explicitly; absent would mean "do not filter", which is a third thing')

  // Installing again is a no-op rather than a double wrap.
  assert.equal(installDemoApiHeader(scope), scope.fetch)
})

test('an explicitly set header wins over the automatic one', async () => {
  const seen = []
  const scope = {
    location: { origin: 'https://aspireintelligence.app' },
    Request: globalThis.Request,
    fetch: async (input, init) => { seen.push(init); return new Response('{}') },
  }
  installDemoApiHeader(scope)
  setDemoMode(true)
  await scope.fetch('/api/portal/unit-roster', { headers: { [DEMO_HEADER]: '0' } })
  assert.equal(new Headers(seen[0].headers).get(DEMO_HEADER), '0',
    'a caller that deliberately asks about the other population still can')
})

test('the boundary is installed on the one client every import shares', () => {
  const src = read('src/lib/supabase.js')
  assert.match(src, /installDemoApiHeader\(\)/,
    'without this the portals ask the server nothing and it answers for both populations')
  assert.match(src, /installDemoScope\(supabase\)/, 'and the table boundary stays where it was')
})

// ─────────────────────────────────────────────────────────────────────
// 7. The rows the Unit Leader Portal authorizes on
// ─────────────────────────────────────────────────────────────────────
test('the seed creates the unit assignments the roster is authorized by', () => {
  // api/lib/unitLeaderScope.js authorizes ONLY through LIVE student_unit_assignments
  // rows; students.matched_unit_id stopped being the path at MULTI-UNIT-STUDENT-
  // PLACEMENTS-2. The seed inserted students with matched_unit_id already set, and the
  // trigger that would have mirrored it is AFTER UPDATE, so it never fired: every demo
  // unit roster was empty, which looks exactly like a broken demo boundary.
  const seed = read('db/demo/demo_seed.sql')
  assert.match(seed, /INSERT INTO student_unit_assignments/,
    'no assignment rows means no demo roster, however well the filtering works')
  assert.match(seed, /DELETE FROM student_unit_assignments\s+WHERE is_demo;/,
    'and the seed must stay re-runnable')

  // Comments inside the statement contain semicolons, so strip them before slicing it out.
  const bare = seed.replace(/^\s*--.*$/gm, '')
  const insert = bare.match(/INSERT INTO student_unit_assignments[\s\S]*?;/)[0]
  // The COLUMN LIST, not the whole statement: the WHERE clause says is_demo for a
  // different reason (it selects the demo students to build rows from).
  const columns = insert.match(/student_unit_assignments\s*\(([^)]*)\)/)[1]
  assert.doesNotMatch(columns, /is_demo/,
    'is_demo is set by aspire_demo_inherit from the parent student. Passing it here would ' +
    'test the seed instead of the trigger.')
  assert.doesNotMatch(columns, /unit_key/,
    'unit_key is snapshotted from units.unit_name by trg_sua_enforce_unit_identity, which ' +
    'RAISES on a value that disagrees')
  assert.match(insert, /WHERE s\.is_demo/,
    'and the statement can only ever build rows for demo students')
  assert.doesNotMatch(insert, /'planned'/,
    'every row must be ACTIVE. trg_sync_matched_unit_from_assignments reads the student\'s ' +
    'PRIMARY + ACTIVE assignment and writes students.matched_unit_id from it, so a planned ' +
    'row sets that column to NULL for exactly the Placed students this file just placed.')
  assert.match(insert, /'active',/, 'and the status must actually be there')
})

test('the seed gives every placed demo student a rotation window', () => {
  // The Rotation Timeline column on the Unit Leader and Academic Partner rosters reads
  // students.cohort_school_rotation_id. The seed created the rotation rows and never
  // linked them.
  const seed = read('db/demo/demo_seed.sql')
  assert.match(seed, /SET cohort_school_rotation_id = r\.id/,
    'without the link every demo roster line shows an empty timeline')
  assert.match(seed, /rotation_end_date\s*=\s*CURRENT_DATE - 10/,
    'and a Completed student with no rotation_end_date fails completedStillVisible CLOSED, ' +
    'so the 90-day window has nobody in it to demonstrate')
})

test('the teardown removes them too', () => {
  assert.match(read('db/demo/demo_teardown.sql'), /DELETE FROM student_unit_assignments\s+WHERE is_demo;/)
})

test('the registry has exactly one copy', () => {
  // It moved to shared/ so the server could read it. A second literal list is a list
  // that drifts, and the drift shows up as a real student on a projector.
  // 19 from the foundation, 6 from the residency migration.
  assert.equal(DEMO_SCOPED_TABLES.length, 25)
  assert.doesNotMatch(read('src/lib/demoScope.js'), /'student_shift_logs'/,
    'src/lib/demoScope.js must re-export the shared registry, not restate it')
  assert.doesNotMatch(read('lib/server/demoScope.js'), /'student_shift_logs'/,
    'and so must the server half')
})

// ─────────────────────────────────────────────────────────────────────
// 8. These gates can fail
// ─────────────────────────────────────────────────────────────────────
// This repository once shipped a gate that could not fail and reported a PASS for it.
test('the boundary assertions are real', async () => {
  const { client, calls } = probeClient()
  // An UNWRAPPED client must fail the section-1 assertion, or that assertion proves nothing.
  await client.from('students').select('id')
  assert.doesNotMatch(calls[0].url, /is_demo/)

  assert.throws(() => assert.match(calls[0].url, /is_demo=eq\.true/),
    'the section-1 test would pass on an unfiltered client if this throws nothing')
})

test('the resolver coverage assertion is real', () => {
  const bare = "import { getServiceDb } from './lib/portalAuth.js'\nconst db = getServiceDb()\n"
  assert.match(bare, /^\s*(const|let)\s+db\s*=\s*getServiceDb\(\)\s*$/m,
    'the shape the section-4 test forbids must actually be detectable')
})

// ─────────────────────────────────────────────────────────────────────
// 9. The audit: nothing in a portal reads a scoped table outside the boundary
// ─────────────────────────────────────────────────────────────────────
// The boundary filters BOTH ways, so this section is as much about real work as about
// a demo: with demo mode OFF the client asks for is_demo = false, and a fabricated
// student must never appear on a real Unit Leader's roster or a real partner's school
// list. That only holds if every portal endpoint reading a scoped table goes through a
// resolver that applies the boundary.
//
// Ten do not, and each one is safe for a reason that is written down here rather than
// rediscovered. A new endpoint that is not on this list fails the test by name.
const OUTSIDE_THE_WRAPPER = {
  // Phase 4: these two carry the scope as a QUERY PARAMETER instead, and
  // admin-student-preview additionally refuses an id from the other population.
  'admin-preview-access.js': 'carries ?demo= (phase 4)',
  'admin-student-preview.js': 'carries ?demo= and checks the id (phase 4)',

  // SELF-SCOPED. Every one of these resolves the caller's OWN student id from
  // user_student_links and reads by that id. A demo student has no account, no profile
  // and no link, so these endpoints cannot reach one however the mode is set. That is
  // safety by construction, which is stronger than a filter, and the assertion below
  // pins the premise it rests on.
  'my-avatar.js': 'self-scoped to the caller\'s own student',
  'my-profile.js': 'self-scoped',
  'my-profile-file-sign.js': 'self-scoped',
  'my-rotation-activity.js': 'self-scoped',
  'my-shift-lifecycle.js': 'self-scoped',
  'my-shift-log-manage.js': 'self-scoped',
  'update-profile.js': 'self-scoped',
  'student-file-access.js': 'self-scoped',
}

test('every portal endpoint reading a scoped table is inside the boundary, or listed', () => {
  const VIA = /verifyPortalUnitLeaderCaller|verifyPortalAcademicPartnerCaller|verifyPortalNursingAcademicCaller|serviceDbForRequest/
  const scoped = new Set(DEMO_SCOPED_TABLES)
  const dir = join(root, 'api/portal')
  const strays = []

  for (const file of readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const src = read(join('api/portal', file))
    if (VIA.test(src)) continue
    // Every quote style, not just the one this repo happens to use today. A detector
    // that misses .from("students") is a gate that cannot fail, and this one silently
    // passed a deliberately planted stray endpoint until it was mutation-tested.
    const tables = [...new Set([...src.matchAll(/\.from\(\s*['"\`]([a-z_]+)['"\`]\s*\)/g)].map(m => m[1]))]
      .filter(t => scoped.has(t))
    if (tables.length && !(file in OUTSIDE_THE_WRAPPER)) strays.push(`${file} reads ${tables.join(', ')}`)
  }

  assert.deepEqual(strays, [],
    'These portal endpoints read a table inside the demo boundary without going through a\n' +
    'resolver that applies it. In demo mode they answer with real people; in real mode they\n' +
    'answer with fabricated ones. Either route them through one, or add them to\n' +
    'OUTSIDE_THE_WRAPPER above WITH the reason they are safe.')
})

test('the premise the self-scoped endpoints rest on: a demo student has no account', () => {
  // If the seed ever created a user_profiles row or a user_student_link for a demo
  // student, every "self-scoped is safe by construction" argument above would quietly
  // stop being true, and there would be no filter behind it to catch that.
  const seed = read('db/demo/demo_seed.sql')
  for (const table of ['user_profiles', 'user_student_links', 'user_role_grants', 'user_unit_scopes', 'user_school_scopes']) {
    assert.doesNotMatch(seed, new RegExp(`INSERT INTO ${table}\\b`),
      `the seed must never give a fabricated person an account (${table})`)
  }
})

test('real mode is a filter, not an absence of one', () => {
  // The direction that is easy to forget. Demo mode hiding real students is the
  // headline; real mode hiding DEMO students is what keeps twenty-one fabricated
  // people off a real Unit Leader's roster the morning after a conference.
  const { client, calls } = probeClient()
  const db = serviceDbForRequest(client, { headers: { 'x-aspire-demo': '0' } })
  return db.from('students').select('id').then(() => {
    assert.match(calls[0].url, /is_demo=eq\.false/)
  })
})
