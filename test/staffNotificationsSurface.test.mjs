// PHASE 2C: static guards for the in-app staff notification surface (one header bell, a two-tab
// Action Center: "Action Needed" for live-derived tasks and "Notifications" for durable
// staff_notifications activity, one combined unread badge). The populated tab cannot be exercised
// against a live DB in this gated pass (the staff_notifications table is created by the unapplied
// 2C migration), so these assert the wiring, the required per-notification fields, the single
// combined badge, the separation from the task list, and reuse of the authored RPC/table.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const hook    = read('src/hooks/useStaffNotifications.js')
const panel   = read('src/components/StaffNotificationsPanel.jsx')
const actionC = read('src/components/ActionCenter.jsx')
const headerA = read('src/components/Header/HeaderActions.jsx')
const app     = read('src/App.jsx')

// ── The read hook: own rows via RLS, read-state only through the RPC ──────────
test('the hook reads the caller\'s own staff_notifications and marks read only via the RPC', () => {
  assert.match(hook, /from\('staff_notifications'\)/)
  assert.match(hook, /\.eq\('recipient_profile_id', profileId\)/)     // own rows (RLS own-or-admin)
  assert.match(hook, /order\('created_at', \{ ascending: false \}\)/)
  assert.match(hook, /rpc\('mark_staff_notifications_read', \{ p_ids: list \}\)/)
  // Unread count is derived from in_app_read_at (the durable read state), not invented.
  assert.match(hook, /filter\(i => !i\.in_app_read_at\)\.length/)
  // No direct UPDATE/insert to the table from the client (read-state RPC only).
  assert.ok(!/\.update\(|\.insert\(|\.upsert\(/.test(hook), 'no client table write')
})

// ── The panel surfaces every required field ──────────────────────────────────
test('each notification surfaces event type, actor, role, unit, old/new, assignment role, reason, time, link, read state', () => {
  assert.match(panel, /EVENT_LABEL/)                               // event type -> human label
  assert.match(panel, /row\.actor_name/)                          // actor
  assert.match(panel, /roleLabel\(row\.actor_role\)/)            // actor role
  assert.match(panel, /row\.unit_key/)                           // unit
  assert.match(panel, /row\.old_value[\s\S]{0,60}row\.new_value/) // old and new values
  assert.match(panel, /row\.assignment_role/)                    // assignment role
  assert.match(panel, /row\.reason/)                             // reason when present
  assert.match(panel, /relTime\(row\.created_at\)/)             // timestamp
  assert.match(panel, /onOpenStudent\?\.\(row\.student_id\)/)    // direct destination link
  assert.match(panel, /!row\.in_app_read_at/)                   // read/unread state drives styling
  // Override is called out; the match-anomaly event is labeled.
  assert.match(panel, /row\.was_override/)
  assert.match(panel, /preceptor_match_anomaly: 'Match record needs review'/)
})

test('the panel covers every notified event type from the migration', () => {
  for (const ev of [
    'preceptor_primary_changed', 'preceptor_add_secondary', 'preceptor_replace_secondary',
    'preceptor_end_secondary', 'preceptor_add_coverage', 'preceptor_replace_coverage',
    'preceptor_end_coverage', 'preceptor_created', 'preceptor_match_anomaly',
  ]) assert.ok(panel.includes(ev), `panel labels ${ev}`)
})

test('opening an unread item marks it read (per-item), and Mark all read clears the rest', () => {
  assert.match(panel, /if \(unread\) onMarkRead\?\.\(\[row\.id\]\)/)
  assert.match(panel, /onMarkAllRead/)
})

// ── Two tabs under one bell; no second model; task list stays separate ───────
test('the Action Center has an Action Needed tab and a Notifications tab', () => {
  assert.match(actionC, /setAcTab\('actions'\)/)
  assert.match(actionC, /setAcTab\('notifications'\)/)
  assert.match(actionC, /Action Needed/)
  assert.match(actionC, /<StaffNotificationsPanel/)
  // The task list body is gated to the actions tab, so notification events are never mixed in.
  assert.match(actionC, /\{acTab === 'actions' && \(<>/)
  assert.match(actionC, /\{acTab === 'notifications' && \(/)
})

test('exactly one notification model: the surface reads staff_notifications, no new table/store', () => {
  // The panel + hook reference only the authored table/RPC; no second notifications table name.
  assert.ok(!/notifications_v2|staff_notification_queue|new .*Notification.*table/i.test(hook + panel))
  assert.match(hook, /staff_notifications/)
})

// ── One combined badge on one bell ───────────────────────────────────────────
test('the bell shows ONE combined badge: task count plus notification unread', () => {
  assert.match(headerA, /const bellBadgeCount = \(actionBadgeCount \|\| 0\) \+ \(notificationsUnread \|\| 0\)/)
  assert.match(headerA, /\{bellBadgeCount > 0 &&/)
  assert.match(headerA, /bellBadgeCount >= 10 \? '9\+' : bellBadgeCount/)
  // App hoists the hook and passes both the badge input and the panel data.
  assert.match(app, /useStaffNotifications\(\{ enabled: canEdit \}\)/)
  assert.match(app, /notificationsUnread/)
  assert.match(app, /notifications=\{staffNotifications\}/)
})

test('no em dash in the new in-app surface files', () => {
  const emDash = String.fromCharCode(0x2014)
  for (const src of [hook, panel]) assert.ok(!src.includes(emDash), 'no em dash')
})
