import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applySnoozes, firstNameFirst, groupQueue, normalizeHomeQueue, normalizeSupportQueue, sortQueue,
} from '../src/lib/actionCenter/queueModel.js'
import { allowedStaffNotificationDestination } from '../src/lib/staffNotificationNavigation.js'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('Action Center formats names first-name first at the queue boundary', () => {
  assert.equal(firstNameFirst({ preferred_first_name: 'Eden Rose', first_name: 'Eden', last_name: 'Delos Santos' }), 'Eden Rose Delos Santos')
})

test('message threads normalize to one actionable item with message count and quote', () => {
  const conversation = {
    id: '812', participant_name: 'Maya Okafor', subject: 'Parking permit',
    status: 'open', assigned_staff_profile_id: null, unread_count: 2,
    latest_preview: 'Can someone help with night parking?', last_message_at: '2026-09-20T10:00:00Z',
  }
  const items = normalizeHomeQueue({
    groups: [{ key: 'messages', allRows: [{ id: 'msg:812', title: 'Maya Okafor · Parking permit', meta: '', ageMs: 1, to: '/connect/messages?conversation=812' }] }],
    conversations: [conversation], now: new Date('2026-09-25T10:00:00Z').getTime(),
  })
  assert.equal(items.length, 1)
  assert.equal(items[0].meta, '2 messages · Parking permit')
  assert.equal(items[0].quote, conversation.latest_preview)
  assert.equal(items[0].entityId, '812')
  assert.deepEqual(items[0].actions.map(a => a.key), ['assign', 'reply', 'resolve', 'snooze'])
})

test('overdue catalog work keeps its resource identity and uses the real reminder action', () => {
  const [item] = normalizeHomeQueue({
    groups: [{ key: 'formsDocs', allRows: [{ id: 'cat:123e4567-e89b-12d3-a456-426614174000', title: 'Clinical agreement', meta: '2 overdue', ageMs: 10, to: '/catalog?resource=clinical-agreement' }] }],
  })
  assert.equal(item.entityId, '123e4567-e89b-12d3-a456-426614174000')
  assert.deepEqual(item.actions.map(action => action.key), ['reminder', 'snooze'])
})

test('support replies use the latest append-only decision and keep one row per check-in', () => {
  const base = { id: 'shift-1', student_id: 'student-1', shift_date: '2026-09-24', unit_name: 'ACU/CDU', support_needed: 'I need help?' }
  const result = normalizeSupportQueue({
    logs: [base], students: [{ id: 'student-1', first_name: 'Eden', last_name: 'Delos Santos' }],
    events: [
      { id: '1', shift_log_id: 'shift-1', classification: 'request', status: 'open', created_at: '2026-09-24T10:00:00Z' },
      { id: '2', shift_log_id: 'shift-1', classification: 'request', status: 'closed_staff', created_at: '2026-09-24T11:00:00Z' },
    ],
    now: new Date('2026-09-25T10:00:00Z').getTime(),
  })
  assert.deepEqual(result.open, [])
  assert.deepEqual(result.closed, [])
})

test('urgent support precedes every normal group and a snooze hides only that user item', () => {
  const urgent = { key: 'support:1', group: 'messages', urgent: true, age: '2026-09-25T00:00:00Z' }
  const signature = { key: 'sig:1', group: 'signatures', urgent: false, age: '2026-09-20T00:00:00Z' }
  const visible = applySnoozes([urgent, signature], [{ item_key: 'sig:1', snoozed_until: '2026-09-26T08:00:00Z' }], new Date('2026-09-25T08:00:00Z').getTime())
  assert.deepEqual(visible.map(i => i.key), ['support:1'])
  assert.deepEqual(sortQueue([signature, urgent]).map(i => i.key), ['support:1', 'sig:1'])
  assert.equal(groupQueue([signature, urgent])[0].key, 'signatures')
})

test('notification destinations allow the six Action Center event routes and reject external URLs', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000'
  assert.equal(allowedStaffNotificationDestination(`/connect/messages?conversation=${id}`), `/connect/messages?conversation=${id}`)
  assert.equal(allowedStaffNotificationDestination(`/catalog/signatures?tab=requests&request=${id}`), `/catalog/signatures?tab=requests&request=${id}`)
  assert.equal(allowedStaffNotificationDestination('/interviews'), '/interviews')
  assert.equal(allowedStaffNotificationDestination('/evaluation'), '/evaluation')
  assert.equal(allowedStaffNotificationDestination('/connect/outreach'), '/connect/outreach')
  assert.equal(allowedStaffNotificationDestination('https://example.com'), null)
})

test('drawer and schema carry the accessibility, snooze, classification, and notification contracts', () => {
  const panel = read('src/components/ActionCenterV2.jsx')
  const css = read('src/components/actionCenter/actionCenter.css')
  const migration = read('supabase/migrations/20261005000000_action_center_queue.sql')
  const backfill = read('db/audit/action_center_support_checkin_backfill.sql')
  assert.match(panel, /role="dialog" aria-modal="true" aria-labelledby="ac2-title"/)
  assert.match(panel, /role="tablist"/)
  assert.match(panel, /aria-live="polite"/)
  assert.match(panel, /record_support_checkin_decision/)
  assert.match(panel, /formStaff\('people'/)
  assert.match(css, /width: 440px/)
  assert.match(css, /@media \(max-width: 479px\)/)
  assert.match(css, /data-style="classic".*ac2-body/s)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.action_snoozes/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.support_checkin_events/)
  assert.match(migration, /safety_term/)
  assert.match(migration, /clear_decline/)
  for (const type of ['message_assigned', 'signed_copy_returned', 'calendar_event_changed', 'evaluation_window_opened', 'followed_message_resolved']) {
    assert.match(migration, new RegExp(type))
  }
  assert.match(read('api/webhooks/resend.js'), /outreach_delivered/)
  assert.match(read('src/components/connect/messages/MessagesWorkspace.jsx'), /linkedConversationId[\s\S]*focusLinkedReply/)
  assert.match(read('src/components/connect/messages/ThreadActions.jsx'), /autoFocus=\{focusOnMount\}/)
  assert.match(backfill, /ROLLBACK;/)
})

test('Classic Action Center uses the compact slotted clipboard clip from Outreach', () => {
  const panel = read('src/components/ActionCenterV2.jsx')
  const css = read('src/components/actionCenter/actionCenter.css')
  assert.equal((panel.match(/<div className="ac2-clip" aria-hidden="true"><span \/><\/div>/g) || []).length, 2)
  assert.match(css, /data-style="classic"\] \.ac2-clip \{[^}]*width: 76px;[^}]*height: 24px;/)
  assert.match(css, /data-style="classic"\] \.ac2-clip > span \{[^}]*width: 25px;[^}]*height: 6px;/)
})
