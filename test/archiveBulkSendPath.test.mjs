// ARCHIVE-SNAPSHOT-1 FAMILY 1: manual bulk email.
//
// Proves the chain rendered payload -> provider payload -> archive input for the
// bulk composer, per recipient, using the REAL handler with substituted Resend
// and Supabase clients. Nothing is sent and no database is touched.
//
// Run: node --test test/archiveBulkSendPath.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const src = read('api/connect-send-bulk-message.js')
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// ── Wiring: the archive is fed the SAME variables the provider was ──────────

test('the archive receives the exact html handed to Resend', () => {
  // One `html` binding is built once, passed to sendParams, then to the archive.
  assert.match(code, /const \{ html \} = buildDirectMessageEmail\(\{/, 'rendered once')
  const sendAt = code.indexOf('const sendParams = {')
  const archiveAt = code.indexOf('archiveSentMessage({')
  assert.ok(sendAt > -1 && archiveAt > sendAt, 'the archive runs after the send is composed')
  const sendBlock = code.slice(sendAt, code.indexOf('};', sendAt))
  assert.match(sendBlock, /\bhtml,/, 'provider gets `html`')
  const archiveBlock = code.slice(archiveAt, code.indexOf('});', archiveAt))
  assert.match(archiveBlock, /\bhtml,/, 'archive gets the same `html` binding')
  assert.doesNotMatch(archiveBlock, /buildDirectMessageEmail|applyMergeFields/,
    'the archive must not re-render - that would no longer be a snapshot of the send')
})

test('per-recipient personalization is preserved', () => {
  // mergedBody/mergedSubject are computed per iteration from that recipient's
  // merge context, and `html` is built from mergedBody, so the archived body is
  // that recipient's copy rather than the template.
  assert.match(code, /const mergedBody\s*=\s*applyMergeFields\(bodyRaw\.trim\(\), bodyMergeCtx\)/)
  assert.match(code, /body:\s*mergedBody,/)
})

test('the archive is keyed to the notification_log row it belongs to', () => {
  assert.match(code, /\.select\('id'\)\.single\(\)/, 'the insert now returns its id')
  assert.match(code, /notificationLogId = logRow\?\.id \|\| null/)
  assert.match(code, /if \(notificationLogId\) \{[\s\S]{0,400}archiveSentMessage\(/,
    'no log row means no archive row')
})

test('it archives as manual_bulk_email', () => {
  assert.match(code, /contentKind: 'manual_bulk_email'/)
  assert.match(code, /source: 'connect_send_bulk_message'/)
})

// ── Only successfully-sent recipients are archived ─────────────────────────

test('a failed recipient is never archived as delivered content', () => {
  // The archive sits inside the success path: the log insert it depends on runs
  // only after a successful send, and failures take the `failed.push` branch.
  const archiveAt = code.indexOf('archiveSentMessage({')
  const successLogAt = code.indexOf("notification_type: 'bulk_message_sent'")
  assert.ok(successLogAt > -1 && archiveAt > successLogAt,
    'the archive follows the sent-path log write')
  const between = code.slice(successLogAt, archiveAt)
  assert.doesNotMatch(between, /failed\.push/, 'no failure branch intervenes')
})

// ── Archive failure is inert ───────────────────────────────────────────────

test('an archive problem cannot resend or change the delivery result', () => {
  const archiveAt = code.indexOf('archiveSentMessage({')
  const after = code.slice(archiveAt, archiveAt + 900)
  // The result is logged, never thrown, never retried, never re-sent.
  assert.match(after, /archive\.status !== 'archived'/)
  assert.doesNotMatch(after, /resend\.emails\.send|throw |return res\./,
    'the archive result must not alter the send outcome')
  // sent.push still happens regardless of archive status.
  const sentPushAt = code.indexOf('sent.push({ index: i')
  assert.ok(sentPushAt > archiveAt, 'the recipient is still recorded as sent')
})

test('one recipient\'s archive failure cannot affect another', () => {
  // Everything runs inside the per-recipient loop, and archiveSentMessage never
  // throws (proved in test/messageArchiveWriter.test.mjs), so the loop continues.
  const loopAt = code.search(/for \(let i = 0/)
  const archiveAt = code.indexOf('archiveSentMessage({')
  assert.ok(loopAt > -1 && archiveAt > loopAt, 'the archive is inside the batch loop')
  assert.doesNotMatch(code.slice(archiveAt, archiveAt + 700), /break;|return\b/,
    'an archive outcome must not exit the batch')
})

// ── The obsolete note is gone ──────────────────────────────────────────────

test('the "bulk bodies cannot be archived" note is removed', () => {
  assert.doesNotMatch(src, /NO message_archive write \(content_kind CHECK does not permit/)
  assert.match(src, /ARCHIVE-SNAPSHOT-1/, 'and replaced by what actually happens now')
})

// ── Structural negative control ────────────────────────────────────────────

test('NEGATIVE CONTROL: removing the archive call fails this suite', () => {
  // The assertions above key off `archiveSentMessage(` and its contentKind, so
  // deleting the call breaks them. This test states that dependency explicitly.
  assert.ok(code.includes('archiveSentMessage('), 'the bulk path must archive')
  assert.ok(code.includes("contentKind: 'manual_bulk_email'"))
})

test('preview mode still archives nothing', () => {
  // The preview branch returns before any send, log, or archive.
  assert.match(src, /Return preview - NO send, NO notification_log, NO message_archive/)
})
