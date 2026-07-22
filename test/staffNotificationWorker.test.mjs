// PHASE 2C: behavioral proof for the Owner/Admin notification email worker
// (lib/server/staffNotifications/deliveryService.js). Uses injected fake Supabase + Resend
// clients (no network, no process env). Proves: the worker claims due rows via the RPC, sends
// one email per row and marks it sent, retries a transient failure with a scheduled next attempt,
// fails a permanent one, gives up after MAX_ATTEMPTS, passes a stable per-recipient idempotency
// key so the provider cannot double-send, and survives a row whose persistence throws.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  processClaimedStaffNotification,
  runStaffNotificationWorker,
} from '../lib/server/staffNotifications/deliveryService.js'
import { MAX_ATTEMPTS } from '../lib/server/staffNotifications/config.js'

// ── Fakes ───────────────────────────────────────────────────────────────────
function makeRow(over = {}) {
  return {
    id: 'row-1',
    correlation_id: 'preceptor_primary:stu-1:prc-1:123',
    recipient_profile_id: 'admin-1',
    recipient_email: 'admin@example.org',
    event_type: 'preceptor_primary_changed',
    subject: 'Primary preceptor changed',
    actor_name: 'A Leader',
    dest_url: '/students/stu-1',
    old_value: 'prc-0',
    new_value: 'prc-1',
    attempts: 0,
    max_attempts: MAX_ATTEMPTS,
    ...over,
  }
}

// Fake db: records every staff_notifications update and the claim RPC call.
function makeDb({ claimRows = [], claimError = null, failUpdateForId = null } = {}) {
  const updates = []
  const rpcCalls = []
  return {
    updates,
    rpcCalls,
    rpc(name, args) {
      rpcCalls.push({ name, args })
      if (name === 'claim_due_staff_notifications') {
        return Promise.resolve({ data: claimError ? null : claimRows, error: claimError })
      }
      return Promise.resolve({ data: null, error: null })
    },
    from(table) {
      assert.equal(table, 'staff_notifications')
      return {
        update(patch) {
          return {
            eq(col, id) {
              assert.equal(col, 'id')
              if (failUpdateForId && id === failUpdateForId) {
                return Promise.reject(new Error('db write failed'))
              }
              updates.push({ id, patch })
              return Promise.resolve({ data: null, error: null })
            },
          }
        },
      }
    },
  }
}

// Fake Resend: records sends; behavior is scripted per call.
function makeResend(script) {
  const sends = []
  return {
    sends,
    emails: {
      send(payload, opts) {
        sends.push({ payload, opts })
        const step = typeof script === 'function' ? script(sends.length) : script
        if (step?.throw) return Promise.reject(new Error(step.throw))
        if (step?.error) return Promise.resolve({ data: null, error: step.error })
        return Promise.resolve({ data: { id: step?.id || 'resend-1' }, error: null })
      },
    },
  }
}

// ── processClaimedStaffNotification ───────────────────────────────────────────
test('a successful send marks the row sent, records the provider id, one attempt', async () => {
  const db = makeDb()
  const resend = makeResend({ id: 'resend-abc' })
  const out = await processClaimedStaffNotification(db, resend, makeRow())

  assert.deepEqual(out, { outcome: 'sent', queueStatus: 'sent' })
  assert.equal(resend.sends.length, 1)
  assert.equal(db.updates.length, 1)
  const patch = db.updates[0].patch
  assert.equal(patch.queue_status, 'sent')
  assert.equal(patch.attempts, 1)
  assert.equal(patch.resend_email_id, 'resend-abc')
  assert.equal(patch.next_attempt_at, null)
  assert.equal(patch.locked_at, null)
})

test('the Resend idempotency key is correlation_id:recipient (no double-send per recipient)', async () => {
  const db = makeDb()
  const resend = makeResend({ id: 'r' })
  await processClaimedStaffNotification(db, resend, makeRow())
  assert.equal(resend.sends[0].opts.idempotencyKey, 'preceptor_primary:stu-1:prc-1:123:admin-1')
  assert.deepEqual(resend.sends[0].payload.to, ['admin@example.org'])
})

test('a thrown transport error retries: retry_wait with a scheduled next attempt', async () => {
  const db = makeDb()
  const resend = makeResend({ throw: 'ECONNRESET' })
  const out = await processClaimedStaffNotification(db, resend, makeRow({ attempts: 0 }))

  assert.equal(out.queueStatus, 'retry_wait')
  const patch = db.updates[0].patch
  assert.equal(patch.queue_status, 'retry_wait')
  assert.equal(patch.attempts, 1)
  assert.ok(patch.next_attempt_at, 'a next attempt is scheduled')
  assert.equal(patch.error_code, 'send_threw')
})

test('a permanent provider error fails the row without retry', async () => {
  const db = makeDb()
  const resend = makeResend({ error: { name: 'validation_error', message: 'bad from' } })
  const out = await processClaimedStaffNotification(db, resend, makeRow())

  assert.equal(out.queueStatus, 'failed')
  assert.equal(db.updates[0].patch.queue_status, 'failed')
  assert.equal(db.updates[0].patch.next_attempt_at, null)
})

test('a transient error on the final attempt gives up (failed, not an endless retry)', async () => {
  const db = makeDb()
  const resend = makeResend({ error: { name: 'rate_limit_exceeded', message: 'slow down' } })
  const out = await processClaimedStaffNotification(db, resend, makeRow({ attempts: MAX_ATTEMPTS - 1 }))

  assert.equal(out.queueStatus, 'failed')
  assert.equal(db.updates[0].patch.attempts, MAX_ATTEMPTS)
})

// ── runStaffNotificationWorker ────────────────────────────────────────────────
test('the worker claims via the RPC and sends every claimed row exactly once', async () => {
  const rows = [makeRow({ id: 'r1', recipient_profile_id: 'a1' }),
                makeRow({ id: 'r2', recipient_profile_id: 'a2' })]
  const db = makeDb({ claimRows: rows })
  const resend = makeResend({ id: 'ok' })

  const counts = await runStaffNotificationWorker(db, resend, { worker: 'w1', limit: 25, staleSeconds: 300 })

  assert.equal(db.rpcCalls[0].name, 'claim_due_staff_notifications')
  assert.deepEqual(db.rpcCalls[0].args, { p_worker: 'w1', p_limit: 25, p_stale_seconds: 300 })
  assert.equal(resend.sends.length, 2)              // one per row, no duplicate
  assert.deepEqual(counts, { claimed: 2, sent: 2, retried: 0, failed: 0, suppressed: 0, errored: 0 })
})

test('the worker keeps going when one row cannot be persisted', async () => {
  const rows = [makeRow({ id: 'r1', recipient_profile_id: 'a1' }),
                makeRow({ id: 'r2', recipient_profile_id: 'a2' })]
  const db = makeDb({ claimRows: rows, failUpdateForId: 'r1' })
  const resend = makeResend({ id: 'ok' })

  const counts = await runStaffNotificationWorker(db, resend, { worker: 'w1', limit: 25, staleSeconds: 300 })

  assert.equal(counts.claimed, 2)
  assert.equal(counts.errored, 1)                   // r1's write threw
  assert.equal(counts.sent, 1)                      // r2 still completed
})

test('a claim RPC error surfaces (the cron records the failure) and sends nothing', async () => {
  const db = makeDb({ claimError: { message: 'claim boom' } })
  const resend = makeResend({ id: 'ok' })
  await assert.rejects(
    () => runStaffNotificationWorker(db, resend, { worker: 'w1', limit: 25, staleSeconds: 300 }),
    /claim failed/,
  )
  assert.equal(resend.sends.length, 0)
})

test('an empty claim is a clean no-op', async () => {
  const db = makeDb({ claimRows: [] })
  const resend = makeResend({ id: 'ok' })
  const counts = await runStaffNotificationWorker(db, resend, { worker: 'w1', limit: 25, staleSeconds: 300 })
  assert.deepEqual(counts, { claimed: 0, sent: 0, retried: 0, failed: 0, suppressed: 0, errored: 0 })
  assert.equal(resend.sends.length, 0)
})
