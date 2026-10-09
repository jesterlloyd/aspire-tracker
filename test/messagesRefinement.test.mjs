// MESSAGES-REFINEMENT-1: focused regression guards for staff triage, shared
// six-reaction behavior, theme coverage, and safe code-first SQL rollout.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { serializeInboxQuery, queryIdentity } from '../src/lib/messages/inboxState.js'
import {
  needsReply, isDone, shortName, previewPrefix, rowChip, threadBanner,
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

// MESSAGES-SIMPLIFY-1 (20261014000000) replaced the attention modes, the
// Unassigned view, the wait bar and the status/assignee/category controls with
// a computed Needs reply, two chips, a status banner, Follow up and Done. These
// four tests pin that replacement; the ones before them pinned what it removed.
test('Needs reply is derived: the server decides, the legacy fields stand in before the migration', () => {
  assert.equal(needsReply({ needs_reply: true, latest_author_role: 'staff' }), true, 'the server wins')
  assert.equal(needsReply({ needs_reply: false, latest_author_role: 'student' }), false)
  const legacy = { status: 'open', latest_author_role: 'student' }
  assert.equal(needsReply(legacy), true)
  assert.equal(needsReply({ ...legacy, status: 'resolved' }), false)
  assert.equal(needsReply({ ...legacy, is_archived: true }), false)
  assert.equal(needsReply({ ...legacy, latest_author_role: 'staff' }), false)
  assert.equal(needsReply({ ...legacy, latest_author_role: 'staff', follow_up_flagged: true }), true)
  assert.equal(isDone({ status: 'resolved' }), true)
  assert.equal(isDone({ is_done: false, status: 'resolved' }), false, 'the server wins')
})

test('rows say who wrote last and who handled the thread', () => {
  assert.equal(shortName('Krystal Rodriguez'), 'K. Rodriguez')
  assert.equal(shortName('Jester Lloyd Bautista'), 'J. Bautista')
  assert.equal(previewPrefix({ latest_author_role: 'student' }, 'me'), 'They wrote · ')
  assert.equal(previewPrefix({ latest_author_role: 'staff', latest_author_profile_id: 'me' }, 'me'), 'You replied · ')
  assert.equal(previewPrefix({ latest_author_role: 'staff', latest_author_profile_id: 'k', latest_author_name: 'Krystal Rodriguez' }, 'me'), 'K. Rodriguez replied · ')
  assert.deepEqual(rowChip({ needs_reply: true }), { kind: 'needs', label: 'Needs reply' })
  assert.deepEqual(rowChip({ needs_reply: false, handled_by_name: 'Jester Lloyd Bautista' }), { kind: 'by', label: 'Replied by J. Bautista' })
  assert.equal(serializeInboxQuery({}).query.view, 'needs_reply')
  assert.notEqual(queryIdentity({ view: 'all' }), queryIdentity({ view: 'done' }))
})

test('the banner updates itself: waiting, flagged, answered, done', () => {
  const now = new Date('2026-09-21T12:00:00Z')
  const student = { author_role: 'student', created_at: '2026-09-18T12:00:00Z', reactions: [] }
  assert.deepEqual(threadBanner({ status: 'open' }, student, null, now), { kind: 'needs', label: 'Needs reply · they wrote 3 days ago' })
  const reacted = { ...student, reactions: [{ key: 'acknowledge', count: 1, mine: true }] }
  const viewer = { id: 'me', full_name: 'Jester Lloyd Bautista' }
  assert.deepEqual(threadBanner({ status: 'open' }, reacted, viewer, now), { kind: 'answered', label: 'Answered by Jester Lloyd Bautista' })
  const staff = { author_role: 'staff', created_at: '2026-09-20T12:00:00Z' }
  assert.deepEqual(threadBanner({ status: 'open', follow_up_flagged: true }, staff, viewer, now), { kind: 'needs', label: 'Needs reply · flagged for follow-up' })
  // MSG-WAITING-1: staff wrote last, so the team waits on the participant; never "no reply needed".
  assert.deepEqual(threadBanner({ status: 'open', handled_by_name: 'Krystal Rodriguez', participant_name: 'Wynter Brown' }, staff, viewer, now), { kind: 'waiting', label: 'Waiting for Wynter to reply · Krystal Rodriguez wrote 1 day ago', short: 'Waiting for Wynter to reply' })
  assert.deepEqual(threadBanner({ status: 'open', participant_name: 'Wynter Brown' }, { ...staff, author_name: 'Jester Lloyd Bautista', created_at: '2026-09-21T10:00:00Z' }, viewer, now), { kind: 'waiting', label: 'Waiting for Wynter to reply · Jester Lloyd Bautista wrote today', short: 'Waiting for Wynter to reply' })
  assert.equal(threadBanner({ status: 'open' }, staff, viewer, now).short, 'Waiting for them to reply')
  assert.equal(threadBanner({ status: 'resolved' }, student, viewer, now).label, 'Done · moved out of your list. It reopens if the student writes again.')
  assert.equal(threadBanner({ status: 'open' }, { author_role: 'student', created_at: '2026-09-21T09:00:00Z' }, null, now).label, 'Needs reply · they wrote today')
})

test('the inbox and the thread carry only the simplified controls', () => {
  const actions = read('src/components/connect/messages/ThreadActions.jsx')
  for (const label of ['Needs reply', 'All']) assert.match(inbox, new RegExp(`label="${label}"`))
  assert.doesNotMatch(inbox, /label="Active"|label="Unassigned"|Archived and more filters|All assignees|All categories|Resolved means answered/)
  assert.match(inbox, /Search subjects and senders/)
  assert.match(workspace, /messages-status-banner messages-status-banner--\$\{banner\.kind\}/)
  assert.match(workspace, /messages-save-toast/)
  assert.doesNotMatch(actions, /mg-status|mg-assignee|mg-category|<select/)
  assert.match(actions, /'Following up' : 'Follow up'/)
  assert.match(actions, /done \? 'Reopen' : 'Done'/)
  assert.match(actions, /Replying as <b>\{replyingAs\}<\/b>/)
  assert.match(actions, /Press and hold a student&apos;s message to react\./)
  assert.match(actions, /Do not include patient names, medical record numbers, or other identifying information\./)
  assert.match(actions, /Full notice/)
  assert.match(actions, /ASPIRE Messages is not monitored continuously/)
})

test('six reactions retain one selection, replacement, and cancellation semantics', () => {
  assert.deepEqual(MESSAGE_REACTIONS.map((item) => item.glyph), ['👍', '👀', '✅', '🙏', '🙂', '🎉'])
  assert.deepEqual(LEGACY_MESSAGE_REACTIONS.map((item) => item.key), ['acknowledge', 'thanks', 'celebrate'])
  assert.match(reactions, /const next = key === mineKey \? null : key/)
  // MESSAGES-REFINE-2: the label is the shown tooltip (data-label), not a native title.
  assert.match(reactions, /data-label=\{def\.label\}/)
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
  assert.match(staffReadApi, /messages_staff_needs_reply_count_v2/)
  assert.match(staffReadApi, /messages_staff_needs_reply_count'/)
  assert.match(polling, /needs_reply_count/)
  assert.match(launcher, /conversation=\$\{encodeURIComponent\(lastSelectedId\)\}/)
  assert.match(connect, /URLSearchParams\(location\.search\)\.get\('conversation'\)/)
})

test('Messages uses shared light and dark theme tokens in every host', () => {
  assert.match(theme, /--messages-bubble-in:/)
  assert.equal((theme.match(/--messages-bubble-out:/g) || []).length, 2)
  assert.match(css, /background: var\(--messages-bubble-in/)
  assert.match(css, /background: var\(--messages-bubble-out/)
  // MESSAGES-SIMPLIFY-1: state colours are paired tokens with a dark value each.
  for (const token of ['--messages-needs-ink', '--messages-needs-soft', '--messages-ok-ink', '--messages-ok-soft', '--messages-neutral-ink']) {
    assert.equal((theme.match(new RegExp(`${token}:`, 'g')) || []).length, 2, `${token} needs a light and a dark value`)
  }
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
  // a286a0c5: the Owner applied it on 2026-09-21, and the ledger row says so.
  assert.match(ownerGate, /20260922000000_messages_refinement_triage_reactions\.sql[^\n]*\*\*APPLIED 2026-09-21 by the Owner\.\*\*/)
})
