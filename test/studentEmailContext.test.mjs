import test from 'node:test'
import assert from 'node:assert/strict'
import { createStudentEmailContextHandler } from '../api/student-email-context.js'

const visibleId = '00000000-0000-4000-8000-000000000001'
const hiddenId = '00000000-0000-4000-8000-000000000002'
function db(rows, calls, error = null) {
  return { from(table) {
    const call = { table, filters: [] }; calls.push(call)
    const q = {
      select(columns) { call.columns = columns; return q },
      in(column, values) { call.filters.push([column, values]); return q },
      eq(column, value) { call.filters.push([column, value]); return q },
      then(resolve, reject) { return Promise.resolve({ data: rows, error }).then(resolve, reject) },
    }
    return q
  } }
}
async function run({ auth = { ok: true }, visible = [{ id: visibleId }], outcomes = [], error = null, body = { student_ids: [visibleId, hiddenId] }, method = 'POST' } = {}) {
  const userCalls = [], serviceCalls = []
  const handler = createStudentEmailContextHandler({
    verifyCaller: async () => auth,
    makeUserDb: () => db(visible, userCalls),
    makeServiceDb: () => db(outcomes, serviceCalls, error),
  })
  const res = { headers: {}, setHeader(k,v) { this.headers[k] = v }, status(n) { this.code = n; return this }, json(value) { this.body = value; return this } }
  await handler({ method, body, headers: { 'x-aspire-demo': '0' } }, res)
  return { res, userCalls, serviceCalls }
}

test('email context refuses unauthorized callers before any student or residency read', async () => {
  for (const status of [401,403]) {
    const result = await run({ auth: { ok: false, status, reason: 'denied' } })
    assert.equal(result.res.code, status)
    assert.deepEqual(result.userCalls, [])
    assert.deepEqual(result.serviceCalls, [])
  }
})
test('email context bounds inputs and returns no cacheable contact payload', async () => {
  for (const body of [{}, { student_ids: [] }, { student_ids: ['bad'] }, { student_ids: Array(201).fill(visibleId) }, '{']) {
    const { res, serviceCalls } = await run({ body })
    assert.equal(res.code, 400)
    assert.deepEqual(serviceCalls, [])
  }
  assert.equal((await run({ method: 'GET' })).res.code, 405)
  assert.match((await run()).res.headers['Cache-Control'], /no-store/)
})
test('only RLS-visible student IDs reach the residency read; both reads retain population scope', async () => {
  const { res, userCalls, serviceCalls } = await run({ outcomes: [{
    student_id: visibleId, hired_at: '2026-09-20', separated_at: null, cs_email: 'test@cshs.org', secret: 'not returned',
  }] })
  assert.equal(res.code, 200)
  assert.deepEqual(serviceCalls[0].filters.find(([key]) => key === 'student_id')[1], [visibleId])
  for (const call of [userCalls[0], serviceCalls[0]]) assert.ok(call.filters.some(([k,v]) => k === 'is_demo' && v === false))
  assert.deepEqual(res.body.students, [{ id: visibleId, residency_outcomes: [{ hired_at: '2026-09-20', separated_at: null, cs_email: 'test@cshs.org' }] }])
})
test('missing visibility performs no privileged read, and a failed residency lookup never becomes a guessed route', async () => {
  const empty = await run({ visible: [] })
  assert.deepEqual(empty.serviceCalls, [])
  assert.deepEqual(empty.res.body, { students: [] })
  const failure = await run({ error: { message: 'read failed' } })
  assert.equal(failure.res.code, 500)
  assert.equal(failure.res.body.error, 'email_context_unavailable')
})
