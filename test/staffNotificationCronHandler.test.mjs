import test from 'node:test'
import assert from 'node:assert/strict'

import { createStaffNotificationWorkerHandler } from '../api/cron/staff-notification-worker.js'

function makeResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
}

function makeHarness(env) {
  const calls = { getDb: 0, startRun: 0, getResend: 0, runWorker: 0, finishSuccess: 0, finishError: 0 }
  const db = { name: 'fake-db' }
  const resend = { name: 'fake-resend' }
  const counts = { claimed: 0, sent: 0, retried: 0, failed: 0, suppressed: 0, errored: 0 }
  const handler = createStaffNotificationWorkerHandler({
    env,
    getDb: () => { calls.getDb += 1; return db },
    startRun: async (receivedDb, cronName) => {
      calls.startRun += 1
      assert.equal(receivedDb, db)
      assert.equal(cronName, 'staff-notification-worker')
      return 'run-1'
    },
    getResend: apiKey => {
      calls.getResend += 1
      assert.equal(apiKey, env.RESEND_API_KEY)
      return resend
    },
    runWorker: async (receivedDb, receivedResend) => {
      calls.runWorker += 1
      assert.equal(receivedDb, db)
      assert.equal(receivedResend, resend)
      return counts
    },
    finishSuccess: async () => { calls.finishSuccess += 1 },
    finishError: async () => { calls.finishError += 1 },
  })
  return { handler, calls, counts }
}

async function invoke(harness, authorization) {
  const req = { headers: {} }
  if (authorization !== undefined) req.headers.authorization = authorization
  const res = makeResponse()
  await harness.handler(req, res)
  return res
}

function assertRejectedWithoutWork(res, calls) {
  assert.equal(res.statusCode, 401)
  assert.deepEqual(res.body, { error: 'Unauthorized' })
  assert.deepEqual(calls, {
    getDb: 0, startRun: 0, getResend: 0, runWorker: 0, finishSuccess: 0, finishError: 0,
  })
}

test('worker rejects when CRON_SECRET is missing and does no queue work', async () => {
  const harness = makeHarness({ RESEND_API_KEY: 'test-resend-key' })
  assertRejectedWithoutWork(await invoke(harness), harness.calls)
})

test('worker rejects a blank or whitespace-only CRON_SECRET and does no queue work', async () => {
  for (const value of ['', '   \t']) {
    const harness = makeHarness({ CRON_SECRET: value, RESEND_API_KEY: 'test-resend-key' })
    assertRejectedWithoutWork(await invoke(harness, `Bearer ${value}`), harness.calls)
  }
})

test('worker rejects a missing Authorization header and does no queue work', async () => {
  const harness = makeHarness({ CRON_SECRET: 'configured-test-secret', RESEND_API_KEY: 'test-resend-key' })
  assertRejectedWithoutWork(await invoke(harness), harness.calls)
})

test('worker rejects an incorrect Authorization header and does no queue work', async () => {
  const harness = makeHarness({ CRON_SECRET: 'configured-test-secret', RESEND_API_KEY: 'test-resend-key' })
  assertRejectedWithoutWork(await invoke(harness, 'Bearer incorrect-test-secret'), harness.calls)
})

test('worker rejects literal Bearer undefined when CRON_SECRET is missing', async () => {
  const harness = makeHarness({ RESEND_API_KEY: 'test-resend-key' })
  assertRejectedWithoutWork(await invoke(harness, 'Bearer undefined'), harness.calls)
})

test('worker accepts only the exact configured Authorization header and invokes processing once', async () => {
  const env = { CRON_SECRET: 'configured-test-secret', RESEND_API_KEY: 'test-resend-key' }
  const harness = makeHarness(env)
  const res = await invoke(harness, `Bearer ${env.CRON_SECRET}`)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { success: true, ...harness.counts })
  assert.deepEqual(harness.calls, {
    getDb: 1, startRun: 1, getResend: 1, runWorker: 1, finishSuccess: 1, finishError: 0,
  })
  assert.ok(!JSON.stringify(res.body).includes(env.CRON_SECRET))
})
