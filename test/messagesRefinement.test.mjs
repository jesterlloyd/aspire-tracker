// MESSAGES-REFINEMENT-1: focused regression guards for staff triage, shared
// six-reaction behavior, theme coverage, and safe code-first SQL rollout.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_ATTENTION, serializeInboxQuery, queryIdentity,
} from '../src/lib/messages/inboxState.js'
import {
  needsYourReply, isUnassigned, isStale, waitState,
} from '../src/lib/messages/messagesTriage.js'
import {
  MESSAGE_REACTIONS, LEGACY_MESSAGE_REACTIONS, applyOptimisticReaction,
} from '../src/lib/messages/reactionConstants.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (path) => readFileSync(join(here, '..', path), 'utf8')

const inbox = read('src/components/connect/messages/MessagesInbox.jsx')
const workspace = read('src/components/connect/messages/MessagesWorkspace.jsx')
const reactions = read('src/components/shared/MessageReactions.jsx')
const launcher = read('src/components/MainMessagesLauncher.jsx')
const connect = read('src/pages/Connect.jsx')
const css = read('src/index.css')
const theme = read('src/styles/theme.css')
const staffListApi = read('api/messages-staff-list.js')
const staffReadApi = read('api/messages-staff-read.js')
const migration = read('supabase/migrations/20260922000000_messages_refinement_triage_reactions.sql')
const audit = read('db/audit/messages_refinement_triage_reactions_checks.sql')
const ownerGate = read('docs/security/OWNER_SQL_GATE.md')

test('derived triage rules follow the canonical definitions', () => {
  const now = new Date('2026-09-21T12:00:00Z')
  const portalLatest = { status: 'open', latest_author_role: 'student', assigned_staff_profile_id: null, last_message_at: '2026-09-12T12:00:00Z' }
  assert.equal(needsYourReply(portalLatest), true)
  assert.equal(isUnassigned(portalLatest), true)
  assert.equal(isStale(portalLatest, now), true)
  assert.equal(needsYourReply({ ...portalLatest, status: 'resolved' }), false)
  assert.equal(needsYourReply({ ...portalLatest, latest_author_role: 'staff' }), false)
  assert.equal(needsYourReply({ ...portalLatest, latest_author_role: null }), false)

  assert.deepEqual(
    waitState({ status: 'open' }, { author_role: 'student', created_at: '2026-09-20T12:00:00Z' }, now),
    { kind: 'needs_reply', age: 1, label: 'Needs your reply · they wrote 1 day ago' },
  )
  assert.deepEqual(
    waitState({ status: 'open' }, { author_role: 'staff', created_at: '2026-09-19T12:00:00Z' }, now),
    { kind: 'waiting', age: 2, label: 'Waiting on them · 2 days since your reply' },
  )
  assert.equal(waitState({ status: 'resolved' }, null, now).label, '✓ Resolved · no reply needed')
})

test('attention filtering is server-backed and cursor-safe', () => {
  assert.equal(DEFAULT_ATTENTION, 'all')
  assert.equal(serializeInboxQuery({ attention: 'all' }).query.attention, undefined)
  assert.equal(serializeInboxQuery({ attention: 'needs_reply' }).query.attention, 'needs_reply')
  assert.notEqual(queryIdentity({ attention: 'all' }), queryIdentity({ attention: 'unassigned' }))
  assert.match(staffListApi, /messages_staff_list_conversations_v4/)
  assert.match(staffListApi, /p_attention: attention/)
  assert.match(staffListApi, /triage_not_ready/)
  assert.match(migration, /v_attention = 'needs_reply'/)
  assert.match(migration, /v_attention = 'unassigned'/)
  assert.ok(migration.indexOf('v_attention =') < migration.indexOf('LIMIT v_limit'))
})

test('staff inbox presents the refined work views without removing canonical controls', () => {
  for (const label of ['Active', 'Needs reply', 'Unassigned']) {
    assert.match(inbox, new RegExp(`label="${label}"`))
  }
  assert.match(inbox, /Search subjects and senders/)
  assert.match(inbox, /Archived and more filters/)
  assert.match(inbox, /All statuses/)
  assert.match(inbox, /All assignees/)
  assert.match(inbox, /All categories/)
  assert.match(inbox, /All follow up/)
  assert.match(inbox, /They wrote ·/)
  assert.match(inbox, /You replied ·/)
  assert.match(inbox, /messages-triage-pill--danger/)
  assert.match(inbox, /messages-triage-pill--amber/)
  assert.match(inbox, /Resolved means answered and it stays in the list/)
})

test('thread actions expose wait ownership, visible save feedback, and layered privacy text', () => {
  const actions = read('src/components/connect/messages/ThreadActions.jsx')
  assert.match(workspace, /messages-waitbar--\$\{waiting\.kind\}/)
  assert.match(workspace, /messages-save-toast/)
  assert.match(actions, /Set to Unassigned\./)
  assert.match(actions, /Assigned to \$\{option\.text/)
  assert.match(actions, /Category set to \$\{e\.target\.value\}/)
  assert.match(actions, /Do not include patient names, medical record numbers, or other identifying information\./)
  assert.match(actions, /Full notice/)
  assert.match(actions, /ASPIRE Messages is not monitored continuously/)
})

test('six reactions retain one selection, replacement, and cancellation semantics', () => {
  assert.deepEqual(MESSAGE_REACTIONS.map((item) => item.glyph), ['👍', '👀', '✅', '🙏', '🙂', '🎉'])
  assert.deepEqual(LEGACY_MESSAGE_REACTIONS.map((item) => item.key), ['acknowledge', 'thanks', 'celebrate'])
  assert.match(reactions, /const next = key === mineKey \? null : key/)
  assert.match(reactions, /data-tooltip=\{def\.label\}/)
  assert.doesNotMatch(reactions, /msg-reaction-option-label/)
  const replaced = applyOptimisticReaction([{ key: 'warm', count: 1, mine: true }], 'done')
  assert.deepEqual(replaced, [{ key: 'done', count: 1, mine: true }])
  assert.deepEqual(applyOptimisticReaction(replaced, null), [])
})

test('all staff badge surfaces use Needs your reply and drawer handoff keeps the thread', () => {
  const header = read('src/components/Header/HeaderActions.jsx')
  const polling = read('src/lib/messages/messagesPolling.js')
  for (const source of [header, connect, launcher]) {
    assert.match(source, /useStaffNeedsReplyCount/)
    assert.match(source, /needsReplyLabel/)
  }
  assert.match(staffReadApi, /messages_staff_needs_reply_count/)
  assert.match(polling, /needs_reply_count/)
  assert.match(launcher, /conversation=\$\{encodeURIComponent\(lastSelectedId\)\}/)
  assert.match(connect, /URLSearchParams\(location\.search\)\.get\('conversation'\)/)
})

test('Messages uses shared light and dark theme tokens in every host', () => {
  assert.match(theme, /--messages-bubble-in:/)
  assert.equal((theme.match(/--messages-bubble-out:/g) || []).length, 2)
  assert.match(css, /background: var\(--messages-bubble-in/)
  assert.match(css, /background: var\(--messages-bubble-out/)
  assert.match(css, /\[data-theme='dark'\] \.messages-status-pill--open/)
  assert.match(launcher, /var\(--color-header-bg/)
  assert.doesNotMatch(`${workspace}\n${inbox}`, /data-style=/)
})

test('Owner-gated migration preserves data and fails closed before application', () => {
  assert.match(migration, /^BEGIN;$/m)
  assert.match(migration, /^COMMIT;$/m)
  assert.match(migration, /CHECK \(reaction_key IN \('acknowledge', 'on_it', 'done', 'thanks', 'warm', 'celebrate'\)\)/)
  assert.match(migration, /ON CONFLICT \(message_id, profile_id\) DO UPDATE/)
  assert.match(migration, /messages_staff_get_thread_v4/)
  assert.match(migration, /messages_portal_get_thread_v4/)
  assert.match(migration, /messages_staff_needs_reply_count/)
  assert.match(audit, /SELECT-only/)
  assert.doesNotMatch(audit, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE)\b(?![^\n]*--)/)
  assert.match(ownerGate, /20260922000000_messages_refinement_triage_reactions\.sql/)
  assert.match(ownerGate, /NOT APPLIED, Owner-gated/)
})
