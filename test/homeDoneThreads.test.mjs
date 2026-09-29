// test/homeDoneThreads.test.mjs
//
// HOME-ACTIVITY-DONE-1: the Recent activity "resolved" source read two columns
// conversations does not have (participant_name, student_id), so PostgREST
// refused it on every call and the feed never showed a Done thread. This runs
// lib/server/homeDoneThreads.js against a fake PostgREST client that refuses
// any column the messaging migration does not create, the same way production
// failed, and checks what the feed receives.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readDoneThreads } from '../lib/server/homeDoneThreads.js'

const schemaSql = readFileSync(new URL('../supabase/migrations/20260716000000_messages_phase1_schema_foundation.sql', import.meta.url), 'utf8')
function columnsOf(table) {
  const start = schemaSql.indexOf(`CREATE TABLE IF NOT EXISTS public.${table} (`)
  assert.ok(start >= 0, `no CREATE TABLE for ${table}`)
  const body = schemaSql.slice(start, schemaSql.indexOf('\n);', start))
  return new Set([...body.matchAll(/^\s{2}([a-z_]+)\s/gm)].map((m) => m[1]).filter((c) => c !== 'constraint'))
}
const COLUMNS = {
  conversations: columnsOf('conversations'),
  conversation_participants: columnsOf('conversation_participants'),
  conversation_events: columnsOf('conversation_events'),
  students: new Set(['id']),
  user_profiles: new Set(['id', 'full_name']),
}

// A minimal PostgREST stand-in: select/eq/gte/in/is/order/limit, then await.
function fakeDb(rows) {
  const reads = []
  return {
    reads,
    from(table) {
      const q = { table, filters: [], limit: Infinity, error: null }
      const api = {
        select(cols) {
          for (const c of cols.split(',').map((x) => x.trim())) {
            if (!COLUMNS[table].has(c)) q.error = { code: '42703', message: `column ${table}.${c} does not exist` }
          }
          return api
        },
        eq(c, v) { q.filters.push((r) => r[c] === v); return api },
        gte(c, v) { q.filters.push((r) => r[c] >= v); return api },
        in(c, vs) { q.filters.push((r) => vs.includes(r[c])); return api },
        is(c, v) { q.filters.push((r) => r[c] === v); return api },
        order() { return api },
        limit(n) { q.limit = n; return api },
        then(resolve) {
          reads.push(table)
          if (q.error) return resolve({ data: null, error: q.error })
          return resolve({ data: (rows[table] || []).filter((r) => q.filters.every((f) => f(r))).slice(0, q.limit), error: null })
        },
      }
      return api
    },
  }
}

const SINCE = '2026-09-27T00:00:00Z'
const base = () => ({
  conversations: [
    { id: 'c1', subject: 'clocking in', status: 'resolved', resolved_at: '2026-09-27T10:00:00Z', related_student_id: 's-real' },
    { id: 'c2', subject: 'demo thread', status: 'resolved', resolved_at: '2026-09-27T11:00:00Z', related_student_id: 's-demo' },
    { id: 'c3', subject: 'still open', status: 'open', resolved_at: null, related_student_id: 's-real' },
    { id: 'c4', subject: 'old', status: 'resolved', resolved_at: '2026-09-20T10:00:00Z', related_student_id: 's-real' },
  ],
  // The population-scoped client returns only this population's students.
  students: [{ id: 's-real' }],
  conversation_events: [
    { conversation_id: 'c1', event_type: 'resolved', actor_profile_id: 'krystal', created_at: '2026-09-27T10:00:00Z' },
  ],
  conversation_participants: [
    { conversation_id: 'c1', participant_profile_id: 'old-p', added_at: '2026-08-01', removed_at: '2026-08-02' },
    { conversation_id: 'c1', participant_profile_id: 'chloe', added_at: '2026-08-31', removed_at: null },
  ],
  user_profiles: [{ id: 'krystal', full_name: 'Krystal Rodriguez' }, { id: 'chloe', full_name: 'Chloe Tergalstanian' }],
})

test('every column the source reads exists, so the read no longer fails', async () => {
  const db = fakeDb(base())
  const events = await readDoneThreads(db, { since: SINCE, isDemo: false, limit: 40 })
  assert.equal(events.length, 1)
})

test('a Done thread names who marked it done and whose thread it was', async () => {
  const [e] = await readDoneThreads(fakeDb(base()), { since: SINCE, isDemo: false, limit: 40 })
  assert.equal(e.id, 'conv:c1')
  assert.equal(e.kind, 'resolved')
  assert.equal(e.at, '2026-09-27T10:00:00Z')
  assert.equal(e.actorProfileId, 'krystal', 'the actor id lets the feed drop the viewer\'s own')
  assert.deepEqual(e.sentence, { pre: '', actor: 'Krystal Rodriguez', post: " marked Chloe Tergalstanian's thread done" })
  assert.equal(e.detail, 'clocking in')
  assert.equal(e.to, '/connect/messages?conversation=c1')
})

test('only the window, only resolved, only this population', async () => {
  const events = await readDoneThreads(fakeDb(base()), { since: SINCE, isDemo: false, limit: 40 })
  assert.deepEqual(events.map((e) => e.id), ['conv:c1'], 'not open, not older, not the demo student\'s')
})

test('a thread with no student is real: shown to a real session, never to a demo one', async () => {
  const rows = base()
  rows.conversations.push({ id: 'c5', subject: 'no student', status: 'resolved', resolved_at: '2026-09-27T12:00:00Z', related_student_id: null })
  assert.ok((await readDoneThreads(fakeDb(rows), { since: SINCE, isDemo: false, limit: 40 })).some((e) => e.id === 'conv:c5'))
  assert.ok(!(await readDoneThreads(fakeDb(rows), { since: SINCE, isDemo: true, limit: 40 })).some((e) => e.id === 'conv:c5'))
})

test('missing names fall back to plain words', async () => {
  const rows = base()
  rows.conversation_events = []
  rows.conversation_participants = []
  const [e] = await readDoneThreads(fakeDb(rows), { since: SINCE, isDemo: false, limit: 40 })
  assert.equal(e.actorProfileId, null)
  assert.deepEqual(e.sentence, { pre: '', actor: 'A teammate', post: ' marked a thread done' })
})

test('a refused read is thrown, so the endpoint reports the source as failed', async () => {
  const db = fakeDb(base())
  const orig = db.from.bind(db)
  db.from = (t) => (t === 'conversation_events' ? { ...orig(t), select: () => orig(t).select('nope') } : orig(t))
  await assert.rejects(readDoneThreads(db, { since: SINCE, isDemo: false, limit: 40 }), { code: '42703' })
})

test('the fake refuses the old query, as production did', async () => {
  const { error } = await fakeDb(base()).from('conversations')
    .select('id, subject, participant_name, resolved_at, student_id').eq('status', 'resolved')
  assert.equal(error?.code, '42703')
})

test('the endpoint uses the module and no longer reads the retired columns', () => {
  const ep = readFileSync(new URL('../api/home-activity.js', import.meta.url), 'utf8')
  assert.match(ep, /events\.push\(\.\.\.await readDoneThreads\(db, \{ since, isDemo, limit: LIMIT \}\)\)/)
  assert.doesNotMatch(ep, /participant_name, resolved_at, student_id/)
})
