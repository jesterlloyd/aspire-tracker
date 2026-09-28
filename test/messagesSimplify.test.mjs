// test/messagesSimplify.test.mjs
//
// MESSAGES-SIMPLIFY-1: the server-side rules that are not SQL. Who may react to
// what, and how Done and Reopen are composed from the existing evented RPCs.
// The Needs reply rule itself is proven on real Postgres in
// test/messagesSimplifyMigration.test.mjs.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { reactionAllowed } from '../lib/server/messages/reactionRules.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const manage = read('api/messages-staff-manage.js')

const fromStudent = { author_role: 'student', author_profile_id: 'stu' }
const fromStaff = { author_role: 'staff', author_profile_id: 'jester' }

test('staff react to participant messages only', () => {
  assert.equal(reactionAllowed({ message: fromStudent, actorKind: 'staff', actorProfileId: 'jester', reactionKey: 'acknowledge' }), true)
  assert.equal(reactionAllowed({ message: fromStaff, actorKind: 'staff', actorProfileId: 'krystal', reactionKey: 'acknowledge' }), false)
})

test('participants react to staff messages only, never their own', () => {
  assert.equal(reactionAllowed({ message: fromStaff, actorKind: 'student', actorProfileId: 'stu', reactionKey: 'thanks' }), true)
  assert.equal(reactionAllowed({ message: fromStudent, actorKind: 'student', actorProfileId: 'stu', reactionKey: 'thanks' }), false)
  assert.equal(reactionAllowed({ message: fromStudent, actorKind: 'unit_leader', actorProfileId: 'ul', reactionKey: 'thanks' }), false)
})

test('removing a reaction is always allowed; an unknown message is not', () => {
  assert.equal(reactionAllowed({ message: fromStudent, actorKind: 'student', actorProfileId: 'stu', reactionKey: null }), true)
  assert.equal(reactionAllowed({ message: null, actorKind: 'staff', actorProfileId: 'jester', reactionKey: 'done' }), false)
})

test('Done resolves and clears the flag; Reopen opens and clears the caller archive', () => {
  const fn = manage.slice(manage.indexOf('async function setDone'), manage.indexOf('export default async function handler'))
  assert.match(fn, /p_status: 'resolved'/)
  assert.match(fn, /p_flagged: false/)
  assert.match(fn, /p_status: 'open'/)
  assert.match(fn, /messages_set_conversation_archived[\s\S]*p_archived: false/)
  // Each step is skipped when it would change nothing.
  assert.match(fn, /if \(conv\.status !== 'resolved'\)/)
  assert.match(fn, /if \(conv\.follow_up_flagged\)/)
  assert.match(manage, /if \(typeof parsed\.body\.done !== 'boolean'\) return res\.status\(422\)\.json\(\{ error: 'invalid_done' \}\)/)
})

test('Messages no longer writes status, assignee or category from its own UI', () => {
  const ui = ['src/components/connect/messages/ThreadActions.jsx', 'src/components/connect/messages/MessagesInbox.jsx',
    'src/components/connect/messages/MessagesWorkspace.jsx'].map(read).join('\n')
  assert.doesNotMatch(ui, /action: 'assign'|action: 'status'|action: 'category'|run\('status'|run\('assign'|run\('category'/)
  assert.match(read('src/components/connect/messages/NewMessageDialog.jsx'), /category: null,/)
})

test('At a Glance and the Action Center read the Needs reply view, with no assignee', () => {
  assert.match(read('src/lib/home/homeLoaders.js'), /view: 'needs_reply'/)
  assert.doesNotMatch(read('src/hooks/useActionCenterQueue.js'), /assigned_staff_profile_id/)
  assert.doesNotMatch(read('src/lib/actionCenter/queueModel.js'), /Assign to me|assigned_staff_profile_id/)
  assert.match(read('src/components/ActionCenterV2.jsx'), /action: 'done', conversation_id: id, done: true/)
})
