// ARCHIVE-SNAPSHOT-1 FAMILY 2: coordinator weekly digest.
//
// Proves rendered digest -> Resend payload -> archiveSentMessage input is ONE
// binding chain, that only a genuinely sent-and-logged digest is archived, and
// that coordinators are isolated from one another. Nothing is sent and no cron
// is invoked; the writer's runtime behaviour is covered by
// test/messageArchiveWriter.test.mjs with substituted clients.
//
// Run: node --test test/archiveDigestSendPath.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { archiveSentMessage } from '../api/lib/messageArchive.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const src = read('api/cron/coordinator-weekly-digest.js')
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const at = (needle) => code.indexOf(needle)
const SEND = at('resend.emails.send(')
const LOG = at("notification_type: 'coordinator_weekly_digest'")
const ARCHIVE = at('archiveSentMessage({')

// ── Sequence: send, then log, then archive ─────────────────────────────────

test('the archive runs after the send AND after the log insert', () => {
  assert.ok(SEND > -1 && LOG > SEND, 'log follows send')
  assert.ok(ARCHIVE > LOG, 'archive follows the log insert')
})

test('all three preconditions are required before archiving', () => {
  const guard = code.slice(ARCHIVE - 260, ARCHIVE)
  assert.match(guard, /sendStatus === 'sent'/, 'Resend must have succeeded')
  assert.match(guard, /notificationLogId/, 'the log row id must exist')
  assert.match(code, /\.select\('id'\)\.single\(\)/, 'the insert returns its id')
  assert.match(code, /notificationLogId = logRow\?\.id \|\| null/)
})

test('an unsent or failed digest creates no archive', () => {
  // sendStatus is set to 'failed' on both the Resend error branch and the throw
  // branch, and the guard requires 'sent'.
  assert.ok((code.match(/sendStatus = 'failed'/g) || []).length >= 2)
  assert.match(code.slice(ARCHIVE - 260, ARCHIVE), /if \(sendStatus === 'sent' && notificationLogId\)/)
})

test('a failed notification-log insert creates no archive', () => {
  // The catch leaves notificationLogId null, which the guard rejects.
  assert.match(code, /catch \(logErr\)[\s\S]{0,220}log write failed/)
  assert.match(code.slice(ARCHIVE - 260, ARCHIVE), /notificationLogId\)/)
})

// ── Payload fidelity: one binding, no rebuild ──────────────────────────────

test('the archive gets the same html the provider got', () => {
  const sendBlock = code.slice(SEND, code.indexOf('})', SEND))
  assert.match(sendBlock, /\bhtml,/, 'provider receives `html`')
  const archiveBlock = code.slice(ARCHIVE, code.indexOf('});', ARCHIVE))
  assert.match(archiveBlock, /\bhtml,/, 'archive receives the same binding')
})

test('the archive block never rebuilds or re-queries the digest', () => {
  const archiveBlock = code.slice(ARCHIVE, code.indexOf('});', ARCHIVE))
  assert.doesNotMatch(archiveBlock, /buildCoordinatorWeeklyDigestEmail/,
    'calling the builder again would archive a reconstruction, not the send')
  assert.doesNotMatch(archiveBlock, /\.from\(|select\(|await db\./,
    'no activity data may be read after sending')
})

test('the digest is rendered exactly once per coordinator', () => {
  assert.equal((code.match(/buildCoordinatorWeeklyDigestEmail\(\{/g) || []).length, 1)
  assert.ok(at('buildCoordinatorWeeklyDigestEmail({') < SEND, 'rendered before sending')
})

// ── Metadata ───────────────────────────────────────────────────────────────

test('template identity and source are recorded, duplicates are not', () => {
  const b = code.slice(ARCHIVE, code.indexOf('});', ARCHIVE))
  assert.match(b, /contentKind: 'coordinator_weekly_digest'/)
  assert.match(b, /source: 'cron_coordinator_weekly_digest'/)
  assert.match(b, /templateKey: 'coordinatorWeeklyDigest'/)
  assert.match(b, /templateVersion: COORDINATOR_DIGEST_TEMPLATE_VERSION/)
  for (const dup of ['recipient_email', 'resend_email_id', 'sent_at', 'subject:']) {
    assert.doesNotMatch(b, new RegExp(dup), `${dup} is on notification_log; do not copy it`)
  }
})

test('the existing non-sensitive digest context stays on the log row', () => {
  // window bounds, school, program type and the transition COUNT remain where
  // they were - the archive adds a body, it does not move the metadata.
  assert.match(code, /window_start:\s*windowStart\.toISOString\(\)/)
  assert.match(code, /transition_count: totalItems/)
})

// ── Isolation between coordinators ─────────────────────────────────────────

test('archiving happens inside the per-coordinator loop', () => {
  const loop = code.search(/for \(const coordinator of|for \(let c = 0|coordinators\.entries\(\)/)
  assert.ok(loop > -1 && ARCHIVE > loop, 'the archive is per coordinator')
  const after = code.slice(ARCHIVE, ARCHIVE + 700)
  assert.doesNotMatch(after, /\bbreak;|\breturn\b|throw /,
    'an archive outcome must not exit or abort the loop')
})

test('one coordinator\'s archive failure cannot resend or block another', async () => {
  // The writer never throws, so the loop always continues. Proved at runtime.
  const failing = { from: () => ({ upsert: async () => { throw new Error('driver down') } }) }
  const r = await archiveSentMessage({
    db: failing, notificationLogId: '11111111-1111-4111-8111-111111111111',
    contentKind: 'coordinator_weekly_digest', html: '<p>Digest A</p>', source: 'test',
  })
  assert.equal(r.status, 'failed')
  assert.equal(r.reason, 'insert_exception')
})

test('two coordinators archive their own bodies against their own log rows', async () => {
  const rows = []
  const db = { from: () => ({ upsert: async (row) => { rows.push(row); return { error: null } } }) }
  await archiveSentMessage({ db, notificationLogId: 'aaaaaaaa-1111-4111-8111-111111111111',
    contentKind: 'coordinator_weekly_digest', html: '<p>West Coast University: 3 students</p>', source: 'test' })
  await archiveSentMessage({ db, notificationLogId: 'bbbbbbbb-2222-4222-8222-222222222222',
    contentKind: 'coordinator_weekly_digest', html: '<p>CSUN: 1 student</p>', source: 'test' })
  assert.equal(rows.length, 2)
  assert.notEqual(rows[0].notification_log_id, rows[1].notification_log_id)
  assert.match(rows[0].html_redacted, /West Coast University/)
  assert.doesNotMatch(rows[0].html_redacted, /CSUN/, 'content must not cross coordinators')
  assert.match(rows[1].html_redacted, /CSUN/)
  assert.doesNotMatch(rows[1].html_redacted, /West Coast/)
})

// ── Unchanged behaviour ────────────────────────────────────────────────────

test('archive failure does not change the send result or CRM update', () => {
  const crm = code.search(/last_contact_type:\s*'weekly_digest'/)
  assert.ok(crm > ARCHIVE, 'the successful-send CRM update still follows')
  const between = code.slice(ARCHIVE, crm)
  assert.doesNotMatch(between, /resend\.emails\.send|sendStatus =(?!=)/,
    'the archive must not re-send or rewrite the send status')
})

test('dry-run, zero-recipient and disabled paths are untouched', () => {
  // Asserted against `src`: this is a COMMENT, and `code` has comments stripped.
  assert.match(src, /No resend\.emails\.send\(\), no notification_log write/,
    'the dry-run branch still short-circuits before send, log and archive')
  assert.ok(src.indexOf('No resend.emails.send(), no notification_log write') < src.indexOf('resend.emails.send('))
  assert.match(src, /automation_disabled|isAutomationEnabled/, 'the enable gate is unchanged')
})

test('retries cannot create a duplicate archive row', () => {
  // notification_log_id is the archive PK and the writer upserts with
  // ignoreDuplicates, so a repeated run for the same log row is a no-op.
  assert.match(read('api/lib/messageArchive.js'), /onConflict: 'notification_log_id', ignoreDuplicates: true/)
})

test('historical digest fallback wording is unchanged', () => {
  assert.match(read('api/notification-log-message.js'), /digest_contents_not_stored/)
  assert.match(read('api/notification-log-message.js'), /was not stored with this record/)
})

// ── Structural negative control ────────────────────────────────────────────

test('NEGATIVE CONTROL: removing the archive call fails this suite', () => {
  assert.ok(code.includes('archiveSentMessage('), 'the digest cron must archive')
  assert.ok(code.includes("contentKind: 'coordinator_weekly_digest'"))
})

test('the admin test and manual-resend digest paths archive their exact sent bodies too', () => {
  const admin = read('api/admin/resend-coordinator-digest.js')
  assert.match(admin, /import \{ archiveSentMessage \}/)
  assert.equal((admin.match(/archiveSentMessage\(\{/g) || []).length, 2)
  assert.equal((admin.match(/contentKind: 'coordinator_weekly_digest'/g) || []).length, 2)
  assert.match(admin, /notificationLogId: testNotificationLogId[\s\S]{0,120}html: simHtml/)
  assert.match(admin, /notificationLogId,[\s\S]{0,120}\bhtml,/)
  assert.equal((admin.match(/\.select\('id'\)\.single\(\)/g) || []).length, 2)
})
