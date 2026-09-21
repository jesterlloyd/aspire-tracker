// test/demoDataBoundary2.test.mjs
//
// DEMO-DATA-2 (Owner, 2026-09-21): "Audit the other server endpoints that could mix demo
// and real data." The rule, from DEMO-DATA-1: "we're not supposed to mix real and fake
// data." Anything that AGGREGATES people reads one population: a request that says
// x-aspire-demo: 1 reads demo rows, and everything else, crons included, reads real rows.
//
// The behaviour tests run the real helpers and handlers against a fake client that
// APPLIES the filters it is given, over a database holding both populations. The source
// guards pin each site the audit fixed, so a later edit cannot quietly drop one.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import {
  populationDb, populationOf, demoScopeOf, scopedServiceDb,
  sendLogPopulationFilters, narrowSendLog, narrowByEmbed,
} from '../lib/server/demoScope.js'
import { createReviewQueueHandler } from '../api/evaluation-unit-release-queue.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const DB = {
  students: [
    { id: 's-real', first_name: 'Real', last_name: 'Student', is_demo: false },
    { id: 's-demo', first_name: 'Demo', last_name: 'Student', is_demo: true },
  ],
  evaluation_response_unit_release: [
    { response_id: 'resp-real', instrument_slug: 'preceptor_progress', hist_unit_key: '6 NE' },
    { response_id: 'resp-demo', instrument_slug: 'preceptor_progress', hist_unit_key: '6 NE' },
  ],
  evaluation_responses: [
    { id: 'resp-real', student_id: 's-real' },
    { id: 'resp-demo', student_id: 's-demo' },
  ],
}

// A PostgREST-shaped fake whose builder is awaitable and applies eq / in.
function fakeClient() {
  return {
    from(table) {
      const filters = []
      const qb = {
        select() { return qb }, order() { return qb }, limit() { return qb },
        update() { return qb }, delete() { return qb }, insert() { return qb }, upsert() { return qb },
        eq(col, val) { filters.push(r => r[col] === val); return qb },
        in(col, vals) { filters.push(r => vals.includes(r[col])); return qb },
        then(resolve, reject) {
          const data = (DB[table] || []).filter(r => filters.every(f => f(r)))
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        },
      }
      return qb
    },
  }
}

const DEMO_REQ = { headers: { 'x-aspire-demo': '1' } }

// ── 1. The rule itself ───────────────────────────────────────────────────────
test('populationOf: only an explicit demo request is demo; silence and crons are real', () => {
  assert.equal(populationOf(), false, 'a cron has no request: real')
  assert.equal(populationOf({ headers: {} }), false, 'no header: real, never "both"')
  assert.equal(populationOf({ headers: { 'x-aspire-demo': '0' } }), false)
  assert.equal(populationOf({ headers: { 'x-aspire-demo': 'yes' } }), false, 'malformed reads as real')
  assert.equal(populationOf(DEMO_REQ), true)
  assert.equal(populationOf({ query: { demo: 'true' }, headers: {} }), true)
})

test('populationDb scopes every read of a boundary table, and never to "both"', async () => {
  const real = await populationDb(fakeClient()).from('students').select('id')
  assert.deepEqual(real.data.map(s => s.id), ['s-real'])
  const demo = await populationDb(fakeClient(), DEMO_REQ).from('students').select('id')
  assert.deepEqual(demo.data.map(s => s.id), ['s-demo'])
  assert.equal(demoScopeOf(populationDb(fakeClient(), { headers: {} })), false)
})

// ── 2. The send log (notification_log has no is_demo) ─────────────────────────
const IDS = ['0de05000-0000-4000-8000-000000000001', '0de05000-0000-4000-8000-000000000002']

test('sendLogPopulationFilters: real excludes demo addresses and demo subjects, NULL-safe', () => {
  const real = sendLogPopulationFilters(false, IDS)
  assert.deepEqual(real, [
    'recipient_email.is.null,recipient_email.not.ilike.*@demo.aspire.invalid',
    `student_id.is.null,student_id.not.in.(${IDS.join(',')})`,
  ])
  // With no demo students there is no student clause at all.
  assert.deepEqual(sendLogPopulationFilters(false, []), [real[0]])
})

test('sendLogPopulationFilters: demo keeps demo addresses OR demo subjects', () => {
  assert.deepEqual(sendLogPopulationFilters(true, IDS),
    [`recipient_email.ilike.*@demo.aspire.invalid,student_id.in.(${IDS.join(',')})`])
})

test('sendLogPopulationFilters: an id that is not a uuid cannot reach the filter string', () => {
  const out = sendLogPopulationFilters(false, ['x),recipient_email.eq.a@b.c', IDS[0]])
  assert.ok(!out.join('|').includes('recipient_email.eq'))
  assert.match(out[1], new RegExp(`not\\.in\\.\\(${IDS[0]}\\)`))
})

const LOG = [
  { id: 'real-to-real', recipient_email: 'student@csun.edu', student_id: 's-real' },
  { id: 'to-demo-person', recipient_email: 'amara.okonkwo@demo.aspire.invalid', student_id: null },
  { id: 'about-demo-student', recipient_email: 'interviewer@cshs.org', student_id: 's-demo' },
  { id: 'internal-no-student', recipient_email: 'owner@cshs.org', student_id: null },
]

test('narrowSendLog: a real client keeps real rows only', async () => {
  const rows = await narrowSendLog(scopedServiceDb(fakeClient(), false), LOG)
  assert.deepEqual(rows.map(r => r.id), ['real-to-real', 'internal-no-student'])
})

test('narrowSendLog: a demo client keeps demo rows only, including a real interviewer\'s reminder about a demo candidate', async () => {
  const rows = await narrowSendLog(scopedServiceDb(fakeClient(), true), LOG)
  assert.deepEqual(rows.map(r => r.id), ['to-demo-person', 'about-demo-student'])
})

test('narrowByEmbed: the embedded student decides; a missing embed is dropped', () => {
  const events = [
    { id: 'e-real', students: { id: 's-real', is_demo: false } },
    { id: 'e-demo', students: { id: 's-demo', is_demo: true } },
    { id: 'e-orphan', students: null },
  ]
  assert.deepEqual(narrowByEmbed(events, false, e => e.students).map(e => e.id), ['e-real'])
  assert.deepEqual(narrowByEmbed(events, true, e => e.students).map(e => e.id), ['e-demo'])
  assert.equal(narrowByEmbed(events, null, e => e.students).length, 3, 'no boundary: untouched')
})

// ── 3. The release queue, run for real against the fake ──────────────────────
function makeRes() {
  return {
    statusCode: null, body: null,
    setHeader() {}, status(c) { this.statusCode = c; return this },
    json(p) { this.body = p; return this }, end() { return this },
  }
}

for (const [label, headers, expected] of [
  ['a real request', {}, ['resp-real']],
  ['a demo request', { 'x-aspire-demo': '1' }, ['resp-demo']],
]) {
  test(`release queue: ${label} lists one population`, async () => {
    const handler = createReviewQueueHandler({
      verifyCaller: async () => ({ ok: true, profile: { id: 'p1', role: 'owner' } }),
      makeUserDb: () => fakeClient(),
    })
    const res = makeRes()
    await handler({ method: 'GET', headers, query: {} }, res)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body.rows.map(r => r.response_id ?? r.responseId), expected)
  })
}

// ── 4. Crons: every sweep reads real rows ────────────────────────────────────
// A cron that builds its own service client must scope it, or say here why it need not.
const CRON_EXEMPT = {
  'clockout-reminders-resend.js': 'two hardcoded shift ids; it cannot sweep',
  'messages-delivery-worker.js': 'delivers queued rows one by one; each send goes through the mailer guard',
  'portal-feedback-delivery-worker.js': 'delivers queued rows one by one; each send goes through the mailer guard',
  'staff-notification-worker.js': 'delivers queued rows one by one; each send goes through the mailer guard',
  'student-completion-reconciliation.js': 'a per-student status repair rpc; it sends nothing and lists nothing',
}

test('every cron that builds a service client scopes it with populationDb', () => {
  const offenders = []
  for (const name of readdirSync(new URL('../api/cron/', import.meta.url))) {
    if (!name.endsWith('.js') || / \d+\.js$/.test(name)) continue
    const src = stripComments(read(`api/cron/${name}`))
    if (!/createClient\(/.test(src)) continue
    if (/populationDb\(createClient\(/.test(src)) continue
    if (CRON_EXEMPT[name]) continue
    offenders.push(name)
  }
  assert.deepEqual(offenders, [], 'Wrap the client: populationDb(createClient(...)). A cron has no demo mode.')
})

test('the two hand re-runs of crons read what the crons read', () => {
  for (const f of ['api/admin/resend-interview-reminders.js', 'api/admin/resend-coordinator-digest.js']) {
    assert.match(stripComments(read(f)), /populationDb\(createClient\(/, f)
  }
})

test('the digest events carry their student\'s is_demo and are narrowed by it', () => {
  for (const f of ['api/cron/coordinator-weekly-digest.js', 'api/admin/resend-coordinator-digest.js']) {
    const src = stripComments(read(f))
    assert.match(src, /students!inner\([^)]*\bis_demo\)/, `${f}: the embed must select is_demo`)
    assert.match(src, /const events = narrowByEmbed\(eventRows, demoScopeOf\(db\), e => e\.students\)/, f)
  }
})

test('resident reflections skip a period whose resident is outside the population', () => {
  const src = stripComments(read('api/cron/resident-reflections.js'))
  assert.match(src, /const due = dueAll\.filter\(p => studentById\.has\(p\.student_id\) \|\| outcomeByCandidate\.has\(p\.candidate_id\)\)/)
})

// ── 5. Request endpoints ─────────────────────────────────────────────────────
test('Keith: every client the handler builds is scoped, and its send log is narrowed', () => {
  const src = read('api/keith.js')
  const handler = src.slice(src.indexOf('export default async function handler(req, res)'),
    src.indexOf('async function callAnthropicWithRetry'))
  const code = stripComments(handler)
  assert.match(code, /const keithDb = \(\) => populationDb\(makeServiceRoleClient\(\), req\);/)
  // One exception, by name: the skills catalog reads no boundary table.
  const bare = code.replace('loadInvocableSkills(makeServiceRoleClient(), auth)', '')
  assert.equal((bare.match(/makeServiceRoleClient\(\)/g) || []).length, 1,
    'inside the handler, makeServiceRoleClient() is reached only through keithDb()')
  for (const site of [
    /const meterClient = keithDb\(\);/, /answerPersonContactQuery\(keithDb\(\), lastUserText\)/,
    /const dbkeith = keithDb\(\);/, /const dbFallback = keithDb\(\);/, /\? keithDb\(\)\n/,
  ]) assert.match(code, site)
  assert.match(code, /getRecentCommunications\(dbkeith, \{[^}]*\}\)\.then\(rows => narrowSendLog\(dbkeith, rows\)\)/)
})

test('Sent History applies the population inside applyFilters, so list, count and KPIs agree', () => {
  const src = stripComments(read('api/notification-log-query.js'))
  assert.match(src, /\.from\('students'\)\.select\('id'\)\.eq\('is_demo', true\)/)
  assert.match(src, /sendLogPopulationFilters\(\s*populationOf\(req\)/)
  const applyFilters = src.slice(src.indexOf('const applyFilters'), src.indexOf('const loadContactCategories'))
  assert.match(applyFilters, /for \(const expr of populationFilters\) x = x\.or\(expr\);/)
})

test('the unit form CC reads real Unit Leaders only', () => {
  const src = stripComments(read('src/lib/notifications/recipients.js'))
  assert.match(src, /return populationDb\(createClient\(url, key\)\);/)
})

test('the Student Portal leadership read takes the student\'s population', () => {
  const src = stripComments(read('api/lib/studentPortalSummary.js'))
  assert.match(src, /'is_demo',\n\]\.join/)
  assert.match(src, /\.in\('category', \['Unit Leader', 'Unit Leadership'\]\)\s*\.eq\('is_active', true\)\s*\.eq\('is_demo', leadershipIsDemo\)/)
})

test('a contact created in a demo session is stamped demo', () => {
  const src = stripComments(read('api/contacts-upsert.js'))
  const insertAt = src.indexOf(".insert(payload)")
  const stampAt = src.indexOf("if (demoScopeFromRequest(req) === true) payload.is_demo = true;")
  assert.ok(stampAt > 0 && stampAt < insertAt, 'the stamp comes before the insert')
})

test('a decision on a demo row emails no real Unit Leader', () => {
  const src = stripComments(read('api/unit-leader-decisions.js'))
  const emits = src.match(/await emitUnitLeaderAlert\(/g) || []
  const guarded = src.match(/if \(!\(await isDemoDecision\(db, row\)\)\) \{\n\s+await emitUnitLeaderAlert\(/g) || []
  assert.equal(emits.length, 3)
  assert.equal(guarded.length, emits.length, 'every alert is behind the demo check')
  assert.match(src, /\.select\('id, unit_key, cohort_id, aspire_status, is_demo'\)/)
  assert.match(src, /\.select\('id, unit_key, cohort_id, review_status, superseded_at, is_demo'\)/)
})

test('sendNotification sends through the guarded mailer', () => {
  const src = stripComments(read('src/lib/notifications/index.js'))
  assert.match(src, /return createMailer\(\);/)
  assert.doesNotMatch(src, /new Resend\s*\(/)
})
