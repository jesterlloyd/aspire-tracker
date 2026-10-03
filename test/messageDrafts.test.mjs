// test/messageDrafts.test.mjs
//
// MESSAGE-DRAFTS-1 (Owner, 2026-10-03): "when someone is typing a message and
// closes the modal, then reopens it, the draft is erased." A draft now survives
// until it is sent, emptied or discarded, for at most seven days, in this
// browser under the writer's own profile id. These tests run the rules against
// an in-memory localStorage and pin each composer's wiring.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) },
}
const {
  DRAFT_PREFIX, DRAFT_TTL_MS, draftStorageKey, isEmptyDraft, loadDraft, saveDraft, clearDraft,
} = await import('../src/lib/messages/messageDrafts.js')

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const T0 = Date.parse('2026-10-03T12:00:00Z')

test('a draft is saved under the writer\'s own id and the thread, and read back', () => {
  store.clear()
  saveDraft('jester', 'reply.c1', { body: 'Hi Joel, quick question' }, T0)
  assert.ok(store.has(`${DRAFT_PREFIX}jester.reply.c1`))
  assert.deepEqual(loadDraft('jester', 'reply.c1', T0 + 1000), { body: 'Hi Joel, quick question' })
  assert.equal(loadDraft('krystal', 'reply.c1', T0), null, 'another person never reads it')
  assert.equal(loadDraft('jester', 'reply.c2', T0), null, 'another thread never reads it')
})

test('an emptied draft is removed; whitespace is empty', () => {
  store.clear()
  saveDraft('jester', 'reply.c1', { body: 'something' }, T0)
  saveDraft('jester', 'reply.c1', { body: '   ' }, T0)
  assert.equal(store.size, 0)
})

test('Discard and a successful send clear it', () => {
  store.clear()
  saveDraft('jester', 'new', { subject: 'Badge', body: 'Hello' }, T0)
  clearDraft('jester', 'new')
  assert.equal(loadDraft('jester', 'new', T0), null)
})

test('a draft older than seven days, or a damaged one, is dropped, never shown', () => {
  store.clear()
  saveDraft('jester', 'reply.c1', { body: 'old' }, T0)
  assert.equal(loadDraft('jester', 'reply.c1', T0 + DRAFT_TTL_MS + 1), null)
  assert.equal(store.size, 0)
  store.set(`${DRAFT_PREFIX}jester.reply.c1`, '{not json')
  assert.equal(loadDraft('jester', 'reply.c1', T0), null)
  assert.equal(store.size, 0)
})

test('only typed fields make a draft: a recipient or category alone is not kept', () => {
  assert.equal(isEmptyDraft({ participant: { id: 'p' }, subject: '', body: '' }, ['subject', 'body']), true)
  assert.equal(isEmptyDraft({ category: 'Scheduling', subject: '', body: '' }, ['subject', 'body']), true)
  assert.equal(isEmptyDraft({ subject: 'Badge', body: '' }, ['subject', 'body']), false)
  store.clear()
  saveDraft('jester', 'new', { category: 'Scheduling', subject: '', body: '' }, T0, ['subject', 'body'])
  assert.equal(store.size, 0)
})

test('no signed-in profile or no thread: nothing is written', () => {
  store.clear()
  saveDraft(null, 'reply.c1', { body: 'x' }, T0)
  saveDraft('jester', null, { body: 'x' }, T0)
  assert.equal(store.size, 0)
  assert.equal(draftStorageKey(null, 'new'), null)
})

test('sign-out keeps drafts on purpose: the key is registered as keyed', () => {
  const reg = read('src/lib/signOutCleanup.js')
  assert.match(reg, /prefix: 'aspire\.messages\.draft\.v1\.', store: 'local', cls: 'keyed'/)
})

test('every composer reads and writes through the one hook, and clears on send', () => {
  const staffReply = read('src/components/connect/messages/ThreadActions.jsx')
  const staffNew = read('src/components/connect/messages/NewMessageDialog.jsx')
  const portalReply = read('src/portal/messages/PortalReplyComposer.jsx')
  const portalNew = read('src/portal/messages/PortalNewMessageDrawer.jsx')
  assert.match(staffReply, /useMessageDraft\(conversationId \? `reply\.\$\{conversationId\}` : null, \{ body: '' \}\)/)
  assert.match(portalReply, /useMessageDraft\(conversationId \? `reply\.\$\{conversationId\}` : null, \{ body: '' \}\)/)
  assert.match(staffNew, /useMessageDraft\('new', \{ participant: null, subject: '', body: '' \}, NEW_DRAFT_TEXT\)/)
  assert.match(portalNew, /useMessageDraft\('new', \{ subject: '', category: '', body: '' \}, NEW_DRAFT_TEXT\)/)
  for (const src of [staffReply, staffNew, portalReply, portalNew]) {
    assert.doesNotMatch(src, /useState\(''\)\s*\n[^\n]*\b(setBody|setSubject)\b/, 'no composer keeps its text in plain state')
    assert.match(src, /Draft saved/)
    assert.match(src, />\s*Discard( draft)?\s*</)
  }
  // Closing keeps the draft, so the button says Close, not Cancel.
  assert.match(staffNew, />Close<\/button>/)
  assert.match(portalNew, />Close<\/button>/)
})
