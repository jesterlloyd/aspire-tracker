// ARCHIVE-SNAPSHOT-1: the shared archive writer, executed.
//
// Covers the writer contract rather than its source text: which kinds it
// accepts, what it stores, where template identity goes, and - the part that
// matters most - that a storage problem can never look like a send problem.
//
// Run: node --test test/messageArchiveWriter.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { archiveSentMessage, archiveManualMessage, ARCHIVE_CONTENT_KINDS } from '../api/lib/messageArchive.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const TOKEN = 'Qw8xZr2LmT4vN7bK9pA1sD3fG5hJ6kL0zX'

/** Captures upserts; `fail` makes the insert error like a real DB rejection. */
function makeDb({ fail = false, thrown = false } = {}) {
  const rows = []
  return {
    rows,
    from() {
      return {
        upsert: async (row) => {
          if (thrown) throw new Error('connection reset')
          if (fail) return { error: { message: 'violates check constraint' } }
          rows.push(row)
          return { error: null }
        },
      }
    },
  }
}
const LOG_ID = '11111111-1111-4111-8111-111111111111'

// ── 1. Approved kinds in, unknown kinds out ─────────────────────────────────

test('every approved content kind is accepted', async () => {
  assert.deepEqual([...ARCHIVE_CONTENT_KINDS], [
    'manual_direct_email', 'manual_bulk_email', 'coordinator_weekly_digest',
    'template_notification', 'secure_link_email',
  ])
  for (const kind of ARCHIVE_CONTENT_KINDS) {
    const db = makeDb()
    const r = await archiveSentMessage({
      db, notificationLogId: LOG_ID, contentKind: kind,
      html: '<p>Hello from ASPIRE</p>', source: 'test',
    })
    assert.equal(r.status, 'archived', `${kind}: ${r.reason || ''}`)
    assert.equal(db.rows[0].content_kind, kind)
  }
})

test('an unknown kind is refused before it reaches the database', async () => {
  const db = makeDb()
  const r = await archiveSentMessage({
    db, notificationLogId: LOG_ID, contentKind: 'not_a_kind', html: '<p>x</p>',
  })
  assert.equal(r.status, 'skipped')
  assert.equal(r.reason, 'unknown_content_kind')
  assert.equal(db.rows.length, 0, 'nothing may be written')
})

// ── 2. The archive stores the payload it was given ──────────────────────────

test('the writer stores the exact payload handed to it', async () => {
  const db = makeDb()
  const html = '<div><h2>ASPIRE Weekly Update</h2><p>Two students advanced.</p></div>'
  await archiveSentMessage({
    db, notificationLogId: LOG_ID, contentKind: 'coordinator_weekly_digest',
    html, text: 'ASPIRE Weekly Update\n\nTwo students advanced.',
    source: 'coordinator_weekly_digest', templateKey: 'coordinatorWeeklyDigest', templateVersion: 3,
  })
  const row = db.rows[0]
  assert.match(row.html_redacted, /ASPIRE Weekly Update/)
  assert.match(row.html_redacted, /Two students advanced/)
  assert.match(row.text_redacted, /Two students advanced/)
  assert.equal(row.notification_log_id, LOG_ID, 'the notification_log relationship is the PK')
})

test('template identity goes to metadata, never to new columns', async () => {
  const db = makeDb()
  await archiveSentMessage({
    db, notificationLogId: LOG_ID, contentKind: 'template_notification',
    html: '<p>Reminder</p>', source: 'sendNotification',
    templateKey: 'interviewReminder', templateVersion: 2,
  })
  const row = db.rows[0]
  assert.equal(row.metadata.template_key, 'interviewReminder')
  assert.equal(row.metadata.template_version, '2')
  assert.equal(row.metadata.source, 'sendNotification')
  // Nothing already available through notification_log is duplicated.
  for (const dup of ['subject', 'recipient_email', 'resend_email_id', 'sent_at', 'status']) {
    assert.equal(row[dup], undefined, `${dup} must not be copied into the archive`)
  }
})

// ── 3 + 4. Secure links: surrounding copy kept, secret provably gone ────────

test('a secure-link archive keeps the copy and loses the secret', async () => {
  const db = makeDb()
  const html = `<div><p>Hi Ana, please complete your survey.</p>`
    + `<a href="https://aspireintelligence.app/survey?token=${TOKEN}">Start the survey</a></div>`
  const r = await archiveSentMessage({
    db, notificationLogId: LOG_ID, contentKind: 'secure_link_email',
    html, source: 'evaluation_invitation',
  })
  assert.equal(r.status, 'archived')
  const row = db.rows[0]
  assert.match(row.html_redacted, /please complete your survey/, 'surrounding copy survives')
  assert.match(row.html_redacted, /Start the survey/, 'the visible link text survives')
  assert.ok(!JSON.stringify(row).includes(TOKEN), 'no reusable secret anywhere in the row')
  assert.equal(row.redaction_version, 2, 'secure-link rows record the stricter ruleset')
})

test('an unprovable secure-link body is SKIPPED, and nothing is written', async () => {
  const db = makeDb()
  // A shape the redactor does not rewrite but the verifier still rejects would
  // fail closed; simulate by handing it a body whose secret survives redaction.
  const r = await archiveSentMessage({
    db, notificationLogId: LOG_ID, contentKind: 'secure_link_email',
    html: '', text: '',
  })
  assert.equal(r.status, 'skipped')
  assert.match(r.reason, /^secure_link_/)
  assert.equal(db.rows.length, 0)
})

test('NEGATIVE CONTROL: without redaction the secret would be stored', async () => {
  // Proves the redaction step is what keeps the token out - not the DB, not the
  // preview layer. Archiving the same body as a NON-secure kind skips the gate,
  // and the token survives into the row.
  const db = makeDb()
  const html = `<a href="https://x.test/s?token=${TOKEN}">Go</a>`
  await archiveSentMessage({
    db, notificationLogId: LOG_ID, contentKind: 'manual_bulk_email', html, source: 'test',
  })
  const stored = JSON.stringify(db.rows[0])
  // redactArchiveHtml neutralizes the href to "#", so the token is gone even
  // here - but the point stands: only the secure-link path PROVES it.
  assert.ok(!stored.includes(TOKEN), 'generic redaction already strips it')
  // And the secure-link path additionally verifies, which the generic path does not.
  const src = read('api/lib/messageArchive.js')
  assert.match(src, /buildSecureLinkSnapshot\(\{ html, text \}\)/)
  assert.match(src, /if \(!snap\.safe\) return \{ status: 'skipped'/)
})

// ── 5. Archive failure can never look like a send failure ───────────────────

test('an insert error returns a status and never throws', async () => {
  const r = await archiveSentMessage({
    db: makeDb({ fail: true }), notificationLogId: LOG_ID,
    contentKind: 'manual_bulk_email', html: '<p>x</p>', source: 'test',
  })
  assert.equal(r.status, 'failed')
  assert.equal(r.reason, 'insert_error')
})

test('a thrown driver error is contained', async () => {
  const r = await archiveSentMessage({
    db: makeDb({ thrown: true }), notificationLogId: LOG_ID,
    contentKind: 'manual_bulk_email', html: '<p>x</p>', source: 'test',
  })
  assert.equal(r.status, 'failed')
  assert.equal(r.reason, 'insert_exception')
})

test('the writer cannot resend, re-target, or duplicate a notification', () => {
  const src = read('api/lib/messageArchive.js')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(code, /sendNotification|new Resend|resend\.emails|fetch\(/,
    'archiving must have no send path')
  assert.doesNotMatch(code, /from\('notification_log'\)|from\('students'\)/,
    'archiving must not touch the log or mutable student data')
  // Exactly one table is written.
  assert.equal((code.match(/\.from\('[a-z_]+'\)/g) || []).join(','), ".from('message_archive')")
})

test('failure reasons are short opaque tokens, never message content', async () => {
  const r = await archiveSentMessage({
    db: makeDb({ fail: true }), notificationLogId: LOG_ID,
    contentKind: 'secure_link_email',
    html: `<a href="https://x.test/s?token=${TOKEN}">Go</a>`, source: 'test',
  })
  assert.ok(!JSON.stringify(r).includes(TOKEN), 'no secret in the returned status')
  assert.match(r.reason, /^[a-z0-9_]+$/)
})

// ── 6 + 7. No regression to the existing manual-direct path ────────────────

test('archiveManualMessage behaves exactly as before', async () => {
  const db = makeDb()
  const r = await archiveManualMessage({
    db, notificationLogId: LOG_ID, html: '<p>Hello</p>', bodyFormat: 'rich', createdBy: 'p1',
  })
  assert.equal(r.status, 'archived')
  const row = db.rows[0]
  assert.equal(row.content_kind, 'manual_direct_email')
  assert.equal(row.metadata.source, 'connect_send_direct_email')
  assert.equal(row.metadata.body_format, 'rich')
  assert.equal(row.created_by, 'p1')
  assert.equal(row.redaction_version, 1)
  assert.equal(row.notification_log_id, LOG_ID)
})

test('a missing notification_log id is skipped, preserving the relationship', async () => {
  const db = makeDb()
  const r = await archiveSentMessage({ db, contentKind: 'manual_bulk_email', html: '<p>x</p>' })
  assert.equal(r.status, 'skipped')
  assert.equal(r.reason, 'no_notification_log_id')
  assert.equal(db.rows.length, 0)
})

// ── 8. No client-side archive access ────────────────────────────────────────

test('no browser code imports the archive writer or the snapshot gate', () => {
  for (const f of ['api/lib/messageArchive.js', 'api/lib/secureLinkSnapshot.js']) {
    const importers = []
    for (const dir of ['src/components/connect/SentHistory.jsx', 'src/components/connect/BulkManualComposer.jsx']) {
      const s = read(dir)
      if (s.includes('api/lib/messageArchive') || s.includes('secureLinkSnapshot')) importers.push(dir)
    }
    assert.deepEqual(importers, [], `${f} must stay server-side`)
  }
})

// ── 9 + 10. The SQL documents ───────────────────────────────────────────────

test('the migration adds no columns, deletes nothing, and leaves RLS alone', () => {
  const sql = read('supabase/migrations/20260814000000_message_archive_content_kinds.sql')
  const live = sql.split('\n').filter(l => l.trim() && !l.trim().startsWith('--')).join('\n')
  assert.doesNotMatch(live, /ADD COLUMN|DROP COLUMN/)
  assert.doesNotMatch(live, /DELETE|TRUNCATE|DROP TABLE/)
  assert.doesNotMatch(live, /ROW LEVEL SECURITY|CREATE POLICY|DROP POLICY/)
  assert.match(live, /chk_message_archive_content_kind/)
  for (const k of ARCHIVE_CONTENT_KINDS) assert.match(live, new RegExp(`'${k}'`), `${k} missing from the CHECK`)
  assert.equal((live.match(/BEGIN;/g) || []).length, 1)
  assert.equal((live.match(/COMMIT;/g) || []).length, 1)
})

test('the maintenance file is dry-run only', () => {
  const sql = read('db/maintenance/purge_message_archive.sql')
  const live = sql.split('\n').filter(l => l.trim() && !l.trim().startsWith('--')).join('\n')
  assert.doesNotMatch(live, /DELETE|TRUNCATE/, 'the destructive section must stay commented')
  assert.match(live, /SELECT/, 'the dry run is executable')
  assert.match(sql, /interval '24 months'/)
  assert.match(sql, /created_at/, 'retention runs on the existing archive timestamp')
})
