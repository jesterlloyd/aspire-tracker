// test/studentActivityCompletionEndpoint.test.mjs
//
// POST-ROTATION-SEQUENCED-RELEASE-1 - activity management endpoint, behaviorally.
//
// The REAL handler runs with substituted Supabase clients. What is proven:
// authorization, cohort membership, refusal of a body-supplied identity,
// idempotency, append-only correction, immediate effective state, and that this
// path can never send an email or release an evaluation.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const read = (p) => readFileSync(join(repo, p), 'utf8')
const abs = (p) => JSON.stringify(pathToFileURL(join(repo, p)).href)

process.env.SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key-not-a-secret'
process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'test-anon-not-a-secret'

const dir = mkdtempSync(join(tmpdir(), 'activity-ep-'))
test.after(() => rmSync(dir, { recursive: true, force: true }))

writeFileSync(join(dir, 'fake.mjs'), `
  export let ledger = [], sends = [], updates = [], deletes = [];
  export let ROLE = 'owner';
  export let STUDENT = { id: 'aaaaaaaa-1111-4111-8111-000000000001', cohort_id: 'cccccccc-1111-4111-8111-000000000001', first_name: 'ZZ', last_name: 'Fixture' };
  export function __reset(role = 'owner', student = { id: 'aaaaaaaa-1111-4111-8111-000000000001', cohort_id: 'cccccccc-1111-4111-8111-000000000001', first_name: 'ZZ', last_name: 'Fixture' }) {
    ledger = []; sends = []; updates = []; deletes = []; ROLE = role; STUDENT = student;
  }
  export function __seed(rows) { ledger = rows.slice(); }

  // Any send attempt is recorded so a test can prove none happened.
  export class Resend {
    constructor() { this.emails = { send: async (p) => { sends.push(p); return { data: { id: 're_1' }, error: null }; } }; }
  }
  export function createClient() {
    return { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } }, error: null }) } };
  }

  const admin = {
    from(table) {
      const q = { table, filters: [] };
      const api = {
        select() { return api },
        eq(f, v) { q.filters.push([f, v]); return api },
        // Chainable AND thenable, exactly like a PostgrestBuilder: the endpoint
        // chains .order('created_at').order('id') for a deterministic tiebreak.
        order() { return api },
        then(resolve) { return Promise.resolve({ data: rowsFor(q), error: null }).then(resolve) },
        maybeSingle() {
          if (q.table === 'user_profiles') {
            return Promise.resolve({ data: ROLE === null ? null : { id: 'staff-1', role: ROLE, is_owner: ROLE === 'owner', full_name: 'QC Owner', email: 'qc@example.org' }, error: null });
          }
          if (q.table === 'students') {
            const id = (q.filters.find(([f]) => f === 'id') || [])[1];
            return Promise.resolve({ data: (STUDENT && STUDENT.id === id) ? STUDENT : null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        insert(row) {
          const stamped = { id: 'ev-' + (ledger.length + 1), created_at: new Date(2026, 7, 17, 12, ledger.length).toISOString(), ...row };
          ledger.push(stamped);
          return { select: () => ({ single: async () => ({ data: stamped, error: null }) }) };
        },
        update(patch) { updates.push({ table: q.table, patch }); return { eq: async () => ({ data: null, error: null }) } },
        delete() { deletes.push({ table: q.table }); return { eq: async () => ({ data: null, error: null }) } },
      };
      return api;
    },
  };
  function rowsFor(q) {
    if (q.table !== 'student_activity_completions') return [];
    const sid = (q.filters.find(([f]) => f === 'student_id') || [])[1];
    const key = (q.filters.find(([f]) => f === 'activity_key') || [])[1];
    return ledger.filter(r => r.student_id === sid && (!key || r.activity_key === key));
  }
  export default admin;
`)

const FAKE = JSON.stringify(pathToFileURL(join(dir, 'fake.mjs')).href)
const src = read('api/student-activity-completion.js')
  .replace(/from '@supabase\/supabase-js'/, `from ${FAKE}`)
  .replace(/from '\.\.\/lib\/server\/evaluation\/supabase_admin\.js'/, `from ${FAKE}`)
  .replace(/from '\.\.\/src\/lib\/evaluation\/postRotationSequence\.js'/, `from ${abs('src/lib/evaluation/postRotationSequence.js')}`)
  .replace(/from '\.\/lib\/activeAccount\.js'/, `from ${abs('api/lib/activeAccount.js')}`)
writeFileSync(join(dir, 'handler.mjs'), src)

const fakes = await import(pathToFileURL(join(dir, 'fake.mjs')).href)
const handler = (await import(pathToFileURL(join(dir, 'handler.mjs')).href)).default

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; return this },
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    end() { return this },
  }
}
async function call(body, { role = 'owner', student, headers } = {}) {
  fakes.__reset(role, student)
  const res = makeRes()
  await handler({ method: 'POST', headers: headers ?? { authorization: 'Bearer t' }, body }, res)
  return res
}
const COMPLETE = { student_id: 'aaaaaaaa-1111-4111-8111-000000000001', activity_key: 'town_hall', action: 'complete' }

// ── Authorization ───────────────────────────────────────────────────────────

test('unauthenticated and non-Owner/Admin callers are refused', async () => {
  const noToken = await call(COMPLETE, { headers: {} })
  assert.equal(noToken.statusCode, 401)
  assert.equal(fakes.ledger.length, 0)

  for (const role of ['interviewer', 'viewer', 'preceptor', null]) {
    const r = await call(COMPLETE, { role })
    assert.equal(r.statusCode, 403, `${role} must be refused`)
    assert.equal(fakes.ledger.length, 0, 'nothing recorded')
  }
})

test('only POST is accepted', async () => {
  fakes.__reset()
  const res = makeRes()
  await handler({ method: 'GET', headers: { authorization: 'Bearer t' }, body: {} }, res)
  assert.equal(res.statusCode, 405)
  assert.equal(fakes.ledger.length, 0)
})

// ── Identity can never come from the body ───────────────────────────────────

test('a body-supplied acting identity is REFUSED, not ignored', async () => {
  for (const field of ['recorded_by', 'recorded_by_name', 'actor_id', 'user_id']) {
    const r = await call({ ...COMPLETE, [field]: 'someone-else' })
    assert.equal(r.statusCode, 400, `${field} must be refused`)
    assert.match(r.body.error, /taken from your session/)
    assert.equal(fakes.ledger.length, 0)
  }
})

test('the recorded actor is the session user', async () => {
  const r = await call(COMPLETE)
  assert.equal(r.statusCode, 200)
  assert.equal(fakes.ledger[0].recorded_by, 'staff-1')
  assert.equal(fakes.ledger[0].recorded_by_name, 'QC Owner')
})

// ── Cohort membership, server-verified ──────────────────────────────────────

test('a student outside any cohort, or not found, cannot be recorded', async () => {
  const missing = await call({ ...COMPLETE, student_id: 'bbbbbbbb-2222-4222-8222-000000000002' })
  assert.equal(missing.statusCode, 404)
  assert.equal(fakes.ledger.length, 0)

  const noCohort = await call(COMPLETE, { student: { id: 'aaaaaaaa-1111-4111-8111-000000000001', cohort_id: null } })
  assert.equal(noCohort.statusCode, 422)
  assert.match(noCohort.body.error, /not in a cohort/)
  assert.equal(fakes.ledger.length, 0)
})

test('the caller supplies no cohort at all, so it cannot be spoofed', () => {
  const s = read('api/student-activity-completion.js')
  assert.match(s, /ALLOWED = \['student_id', 'activity_key', 'action', 'completed_at', 'reason', 'notes'\]/)
  assert.doesNotMatch(s, /body\.cohort_id/)
  assert.match(s, /\.from\('students'\)[\s\S]{0,200}\.eq\('id', studentId\)/, 'the student row is the cohort authority')
})

// ── Input validation ────────────────────────────────────────────────────────

test('only the three required activities are accepted', async () => {
  for (const key of ['invented', 'orientation', '', 'town_hall ']) {
    const r = await call({ ...COMPLETE, activity_key: key })
    if (key === 'town_hall ') { assert.equal(r.statusCode, 200); continue } // trimmed
    assert.equal(r.statusCode, 400, `${key} must be refused`)
  }
})

test('a correction requires a reason, and a completion cannot be in the future', async () => {
  const noReason = await call({ ...COMPLETE, action: 'reverse' })
  assert.equal(noReason.statusCode, 400)
  assert.match(noReason.body.error, /requires a reason/)

  const future = await call({ ...COMPLETE, completed_at: new Date(Date.now() + 86400000).toISOString() })
  assert.equal(future.statusCode, 400)
  assert.match(future.body.error, /future/)
  assert.equal(fakes.ledger.length, 0)
})

// ── Recording, idempotency, correction ──────────────────────────────────────

test('recording a completion returns the new effective state immediately', async () => {
  const r = await call(COMPLETE)
  assert.equal(r.statusCode, 200)
  assert.equal(r.body.recorded, true)
  assert.equal(r.body.state.completed, true)
  assert.ok(r.body.state.completed_at, 'the panel can render the date without refetching')
  assert.equal(r.body.state.recorded_by_name, 'QC Owner')
  assert.equal(fakes.ledger.length, 1)
})

test('repeating the SAME action is idempotent and appends nothing', async () => {
  fakes.__reset()
  const res1 = makeRes()
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: COMPLETE }, res1)
  assert.equal(fakes.ledger.length, 1)

  const res2 = makeRes()
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: COMPLETE }, res2)
  assert.equal(res2.statusCode, 200)
  assert.equal(res2.body.recorded, false)
  assert.equal(res2.body.idempotent, true)
  assert.equal(res2.body.state.completed, true)
  assert.equal(fakes.ledger.length, 1, 'no duplicate row was written')
})

test('reversing a completion appends a correction and never rewrites history', async () => {
  fakes.__reset()
  const r1 = makeRes()
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: COMPLETE }, r1)
  const original = { ...fakes.ledger[0] }

  const r2 = makeRes()
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' },
    body: { ...COMPLETE, action: 'reverse', reason: 'Recorded against the wrong student' } }, r2)

  assert.equal(r2.statusCode, 200)
  assert.equal(r2.body.recorded, true)
  assert.equal(r2.body.state.completed, false, 'the effective state is now not-complete')
  assert.equal(fakes.ledger.length, 2, 'the correction is a NEW row')

  // The original is byte-identical: same actor, same timestamp, same date.
  assert.deepEqual(fakes.ledger[0], original, 'history was not overwritten')
  assert.equal(fakes.ledger[1].action, 'reverse')
  assert.equal(fakes.ledger[1].reason, 'Recorded against the wrong student')
  assert.equal(fakes.ledger[1].completed_at, null)
  assert.equal(fakes.ledger[1].source, 'correction')

  // Nothing was ever updated or deleted.
  assert.equal(fakes.updates.length, 0)
  assert.equal(fakes.deletes.length, 0)
})

test('reversing something that is not complete is a no-op', async () => {
  const r = await call({ ...COMPLETE, action: 'reverse', reason: 'mistake' })
  assert.equal(r.statusCode, 200)
  assert.equal(r.body.recorded, false)
  assert.equal(r.body.idempotent, true)
  assert.equal(fakes.ledger.length, 0)
})

test('a completion can be re-recorded after a correction', async () => {
  fakes.__reset()
  const post = async (body) => {
    const res = makeRes()
    await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, res)
    return res
  }
  await post(COMPLETE)
  await post({ ...COMPLETE, action: 'reverse', reason: 'wrong student' })
  const again = await post(COMPLETE)
  assert.equal(again.body.recorded, true)
  assert.equal(again.body.state.completed, true)
  assert.equal(fakes.ledger.length, 3, 'three events, nothing rewritten')
})

// ── This path can never send or release ─────────────────────────────────────

test('activity management sends no email and releases nothing', async () => {
  await call(COMPLETE)
  assert.equal(fakes.sends.length, 0, 'no provider call')
  assert.equal(fakes.ledger[0].action, 'complete')

  const s = read('api/student-activity-completion.js')
  assert.doesNotMatch(s, /from 'resend'|emails\.send|Resend\(/, 'the endpoint does not import or use a mail client')
  assert.doesNotMatch(s, /evaluation_assignments|evaluation_tokens|notification_log/,
    'it touches no evaluation or notification table')
  const res = await call(COMPLETE)
  assert.equal(res.body.sent_email, false, 'and it says so explicitly')
})

test('the release endpoints keep their own prerequisite rechecks', () => {
  const cf = read('api/evaluation-release-casey-fink-post-rotation-survey.js')
  assert.match(cf, /caseyFinkPrerequisite\(/)
  const pr = read('api/evaluation-release-post-rotation-survey.js')
  assert.match(pr, /aspirePrerequisites\(/)
  // Neither delegates its check to the management endpoint.
  for (const s of [cf, pr]) {
    assert.doesNotMatch(s, /student-activity-completion/, 'the gate is re-derived, not asked of another endpoint')
  }
})

// ── The migration matches the append-only model ─────────────────────────────

test('the migration enforces append-only at the database, not in app code', () => {
  const m = read('supabase/migrations/20260822000000_student_activity_completions.sql')
  assert.match(m, /REVOKE UPDATE, DELETE ON student_activity_completions FROM service_role/)
  assert.match(m, /chk_sac_action_shape/, 'a completion needs a date; a reversal needs a reason')
  assert.match(m, /action IN \('complete', 'reverse'\)/)
  // NEGATIVE CONTROL: the old mutable-row model must be gone.
  assert.doesNotMatch(m, /uq_sac_student_activity UNIQUE/,
    'a UNIQUE(student, activity) row would make correction an overwrite')
})
