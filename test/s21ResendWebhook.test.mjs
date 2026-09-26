// test/s21ResendWebhook.test.mjs
//
// S-21 (S21-1, 2026-09-26): the Resend webhook never moves a delivery status sideways or
// backwards, never overwrites a terminal status, never rewrites a timestamp, and treats a
// replayed svix-id as a no-op. Signature verification is exercised for real with the svix
// library: a forged signature is refused before any database read.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Webhook } from 'svix'
import {
  createResendWebhookHandler, decideNotificationUpdate, STATUS_RANK, TERMINAL_STATUSES,
} from '../api/webhooks/resend.js'
import { shouldApplyProviderStatus } from '../lib/server/messages/deliveryLogic.js'

const SECRET = 'whsec_' + Buffer.from('s21-test-secret-s21-test-secret').toString('base64')

// A minimal supabase-js stand-in: records every call, answers from a script.
function mockDb({ logRow = null, updatedRows = null } = {}) {
  const calls = []
  const make = (table) => {
    const chain = { table, ops: [] }
    const p = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') {
          const result = (() => {
            if (table === 'notification_log' && chain.ops.some(o => o[0] === 'update')) {
              return { data: updatedRows ?? [{ id: logRow?.id }], error: null }
            }
            if (table === 'notification_log') return { data: logRow, error: null }
            if (table === 'message_notification_deliveries') return { data: null, error: null }
            if (table === 'user_profiles') return { data: null, error: null }
            return { data: null, error: null }
          })()
          return (resolve) => resolve(result)
        }
        return (...args) => { chain.ops.push([prop, ...args]); return p }
      },
    })
    calls.push(chain)
    return p
  }
  return { from: (table) => make(table), calls }
}

function signedRequest(payload, { id = 'msg_test_1', secret = SECRET, tamper = false } = {}) {
  const body = JSON.stringify(payload)
  const ts = new Date()
  const sig = new Webhook(secret).sign(id, ts, body)
  return {
    method: 'POST',
    headers: {
      'svix-id': id,
      'svix-timestamp': String(Math.floor(ts.getTime() / 1000)),
      'svix-signature': tamper ? sig.replace(/.$/, c => (c === 'A' ? 'B' : 'A')) : sig,
    },
    body,
  }
}

function res() {
  const r = { statusCode: null, payload: null }
  r.status = (c) => { r.statusCode = c; return r }
  r.json = (p) => { r.payload = p; return r }
  r.end = () => r
  return r
}

const handlerWith = (db) => createResendWebhookHandler({
  getDb: () => db, getSecret: () => SECRET, readBody: async (req) => req.body, now: () => new Date('2026-09-26T10:00:00Z'),
})

const event = (type, email_id = 're_1', created_at = '2026-09-26T09:00:00Z') => ({ type, data: { email_id, created_at } })

function updatePayloadOf(db) {
  const chain = db.calls.find(c => c.table === 'notification_log' && c.ops.some(o => o[0] === 'update'))
  return chain ? chain.ops.find(o => o[0] === 'update')[1] : null
}

test('the ranking: delayed below delivered, three terminal statuses, no ties except terminals', () => {
  assert.ok(STATUS_RANK.delayed < STATUS_RANK.delivered)
  assert.ok(STATUS_RANK.delivered < STATUS_RANK.opened && STATUS_RANK.opened < STATUS_RANK.clicked)
  assert.deepEqual([...TERMINAL_STATUSES].sort(), ['bounced', 'complained', 'failed'])
  for (const t of TERMINAL_STATUSES) assert.ok(STATUS_RANK[t] > STATUS_RANK.clicked)
})

test('decideNotificationUpdate: no downgrade, no lateral move, terminal frozen, timestamps written once', () => {
  const t = '2026-09-26T09:00:00Z'
  // out of order: delayed after delivered leaves the status alone and has no column
  assert.equal(decideNotificationUpdate({ row: { status: 'delivered' }, eventStatus: 'delayed', timestampCol: null, eventTime: t }), null)
  // sent after delivered: status stays, but sent_at is filled once
  assert.deepEqual(decideNotificationUpdate({ row: { status: 'delivered', sent_at: null }, eventStatus: 'sent', timestampCol: 'sent_at', eventTime: t }), { sent_at: t })
  // and never rewritten
  assert.equal(decideNotificationUpdate({ row: { status: 'delivered', sent_at: '2026-09-26T08:00:00Z' }, eventStatus: 'sent', timestampCol: 'sent_at', eventTime: t }), null)
  // terminal: complained after bounced changes no status; opened after bounced changes no status
  assert.deepEqual(decideNotificationUpdate({ row: { status: 'bounced', complained_at: null }, eventStatus: 'complained', timestampCol: 'complained_at', eventTime: t }), { complained_at: t })
  assert.equal(decideNotificationUpdate({ row: { status: 'bounced', opened_at: '2026-09-26T08:00:00Z' }, eventStatus: 'opened', timestampCol: 'opened_at', eventTime: t }), null)
  assert.equal(decideNotificationUpdate({ row: { status: 'failed' }, eventStatus: 'delivered', timestampCol: 'delivered_at', eventTime: t })?.status, undefined)
  // forward: delayed then delivered advances
  assert.deepEqual(decideNotificationUpdate({ row: { status: 'delayed', delivered_at: null }, eventStatus: 'delivered', timestampCol: 'delivered_at', eventTime: t }), { status: 'delivered', delivered_at: t })
  // same status again is a no-op
  assert.equal(decideNotificationUpdate({ row: { status: 'delivered', delivered_at: t }, eventStatus: 'delivered', timestampCol: 'delivered_at', eventTime: t }), null)
})

test('a forged signature is refused before any database read', async () => {
  const db = mockDb({ logRow: { id: 'n1', status: 'sent', metadata: {} } })
  const r = res()
  await handlerWith(db)(signedRequest(event('email.delivered'), { tamper: true }), r)
  assert.equal(r.statusCode, 401)
  assert.equal(db.calls.length, 0)
  const r2 = res()
  await handlerWith(db)(signedRequest(event('email.delivered'), { secret: 'whsec_' + Buffer.from('another-secret-another-secret').toString('base64') }), r2)
  assert.equal(r2.statusCode, 401)
  assert.equal(db.calls.length, 0)
})

test('a valid event advances the status once and records its svix-id', async () => {
  const db = mockDb({ logRow: { id: 'n1', status: 'sent', sent_at: '2026-09-26T08:00:00Z', delivered_at: null, metadata: { batch_id: 'b1' } } })
  const r = res()
  await handlerWith(db)(signedRequest(event('email.delivered'), { id: 'msg_A' }), r)
  assert.equal(r.statusCode, 200)
  assert.deepEqual(r.payload, { success: true, handled: true, changed: true })
  const payload = updatePayloadOf(db)
  assert.equal(payload.status, 'delivered')
  assert.equal(payload.delivered_at, '2026-09-26T09:00:00Z')
  assert.deepEqual(payload.metadata, { batch_id: 'b1', webhook_event_ids: ['msg_A'] })
  const chain = db.calls.find(c => c.table === 'notification_log' && c.ops.some(o => o[0] === 'update'))
  const or = chain.ops.find(o => o[0] === 'or')
  assert.match(or[1], /webhook_event_ids\.not\.cs\.\["msg_A"\]/)
  assert.ok(chain.ops.some(o => o[0] === 'select'), 'the compare-and-set returns the matched rows')
})

test('out of order: a late delayed after delivered, and an opened after bounced, change no status', async () => {
  const db = mockDb({ logRow: { id: 'n1', status: 'delivered', delivered_at: '2026-09-26T08:30:00Z', metadata: {} } })
  const r = res()
  await handlerWith(db)(signedRequest(event('email.delivery_delayed'), { id: 'msg_B' }), r)
  assert.equal(r.payload.changed, false)
  assert.deepEqual(updatePayloadOf(db), { metadata: { webhook_event_ids: ['msg_B'] } })

  const db2 = mockDb({ logRow: { id: 'n1', status: 'bounced', bounced_at: '2026-09-26T08:30:00Z', opened_at: null, metadata: {} } })
  await handlerWith(db2)(signedRequest(event('email.opened'), { id: 'msg_C' }), res())
  const p = updatePayloadOf(db2)
  assert.equal(p.status, undefined, 'a terminal status is never overwritten')
  assert.equal(p.opened_at, '2026-09-26T09:00:00Z')
})

test('a replayed svix-id is acknowledged and writes nothing; a concurrent replay loses the compare-and-set', async () => {
  const db = mockDb({ logRow: { id: 'n1', status: 'delivered', delivered_at: '2026-09-26T08:30:00Z', metadata: { webhook_event_ids: ['msg_A'] } } })
  const r = res()
  await handlerWith(db)(signedRequest(event('email.delivered'), { id: 'msg_A' }), r)
  assert.deepEqual(r.payload, { success: true, handled: false, reason: 'replayed' })
  assert.equal(updatePayloadOf(db), null)
  assert.ok(!db.calls.some(c => c.table === 'message_notification_deliveries'), 'a replay reconciles nothing')

  const raced = mockDb({ logRow: { id: 'n1', status: 'sent', delivered_at: null, metadata: {} }, updatedRows: [] })
  const r2 = res()
  await handlerWith(raced)(signedRequest(event('email.delivered'), { id: 'msg_D' }), r2)
  assert.deepEqual(r2.payload, { success: true, handled: false, reason: 'replayed' })
  assert.ok(!raced.calls.some(c => c.table === 'staff_notifications'), 'the in-app notification is not emitted twice')
})

test('the Messages provider status never moves sideways either', () => {
  assert.equal(shouldApplyProviderStatus('bounced', 'complained'), false)
  assert.equal(shouldApplyProviderStatus('delivered', 'delivered'), false)
  assert.equal(shouldApplyProviderStatus('sent', 'delivered'), true)
  assert.equal(shouldApplyProviderStatus('opened', 'sent'), false)
})

test('the register records S-21 closed, and no changed file carries an em dash', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const { dirname, join } = await import('node:path')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const read = (p) => readFileSync(join(root, p), 'utf8')
  const register = read('docs/security/FINDINGS_REGISTER.md')
  const s21 = register.slice(register.indexOf('## S-21.'), register.indexOf('## S-22.'))
  assert.match(s21, /\*\*Status\*\*: Closed\./)
  const dash = new RegExp(String.fromCharCode(8212))
  for (const p of ['api/webhooks/resend.js', 'lib/server/messages/deliveryLogic.js']) {
    assert.doesNotMatch(read(p), dash, `${p}: no em dash`)
    assert.doesNotMatch(read(p), new RegExp('ASPIRE ' + 'Program'))
  }
  assert.doesNotMatch(s21, dash)
})
