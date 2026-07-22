import test from 'node:test'
import assert from 'node:assert/strict'
import { createPreceptorRequestIdController } from '../src/lib/preceptorRequestId.js'

test('one intentional action keeps one request id across retry and blocks a double submission', () => {
  let created = 0
  const ids = createPreceptorRequestIdController(() => `request-${++created}`)

  assert.equal(ids.begin(), 'request-1')
  assert.equal(ids.begin(), null, 'double submission is rejected while the first attempt is in flight')
  assert.equal(created, 1, 'double submission did not create a second id')

  ids.releaseForRetry()
  assert.equal(ids.begin(), 'request-1', 'retry reuses the action request id')
  assert.equal(created, 1)
})

test('a completed or explicitly reset action gets a new request id', () => {
  let created = 0
  const ids = createPreceptorRequestIdController(() => `request-${++created}`)

  assert.equal(ids.begin(), 'request-1')
  ids.complete()
  assert.equal(ids.begin(), 'request-2', 'success ends the prior intentional action')
  ids.releaseForRetry()
  ids.reset()
  assert.equal(ids.begin(), 'request-3', 'back/new selection starts a new intentional action')
})
