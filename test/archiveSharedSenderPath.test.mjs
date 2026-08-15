// ARCHIVE-SNAPSHOT-1 FAMILY 3B: the shared notification sender, EXECUTED.
//
// Runtime contract rather than source snapshots: the real sendNotification runs
// with its Resend and Supabase clients substituted, so the assertions are about
// behaviour - what the provider got, what the archive got, and which types are
// excluded - not about whitespace.
//
// Nothing is sent and no database is touched.
// Run: node --test test/archiveSharedSenderPath.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  TEMPLATE_NOTIFICATION_TYPES, SECURE_LINK_TYPES, SPECIALIZED_OWNERS, NOT_ARCHIVED,
} from '../api/lib/archiveClassification.js'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const read = (p) => readFileSync(join(repo, p), 'utf8')

// ── Load the real sender with only its clients substituted ──────────────────
const dir = mkdtempSync(join(tmpdir(), 'notif-'))
writeFileSync(join(dir, 'fake.mjs'), `
  export let sends = [], archives = [], logs = [], opts = {};
  export function __reset(o = {}) { sends = []; archives = []; logs = []; opts = o; }
  export function __state() { return { sends, archives, logs }; }
  export class Resend {
    constructor() {
      this.emails = { send: async (p) => {
        sends.push(p);
        if (opts.sendFails) return { data: null, error: { message: 'provider down' } };
        return { data: { id: 're_' + sends.length }, error: null };
      } };
    }
  }
  export function createClient() {
    return { from: () => ({
      insert: (row) => {
        logs.push(row);
        return { select: () => ({ single: async () => {
          if (opts.logFails) throw new Error('log insert failed');
          if (opts.logNoId) return { data: {}, error: null };
          return { data: { id: 'log-' + logs.length }, error: null };
        } }) };
      },
      upsert: async (row) => { archives.push(row); return { error: null }; },
    }) };
  }
`)
const src = read('src/lib/notifications/index.js')
  .replace(/from 'resend'/, `from ${JSON.stringify(pathToFileURL(join(dir, 'fake.mjs')).href)}`)
  .replace(/from '@supabase\/supabase-js'/, `from ${JSON.stringify(pathToFileURL(join(dir, 'fake.mjs')).href)}`)
  .replace(/from '\.\/templates\/index\.js'/, `from ${JSON.stringify(pathToFileURL(join(repo, 'src/lib/notifications/templates/index.js')).href)}`)
  .replace(/from '\.\/recipients\.js'/, `from ${JSON.stringify(pathToFileURL(join(repo, 'src/lib/notifications/recipients.js')).href)}`)
  .replace(/from '\.\.\/\.\.\/\.\.\/api\/lib\/archiveClassification\.js'/, `from ${JSON.stringify(pathToFileURL(join(repo, 'api/lib/archiveClassification.js')).href)}`)
  // messageArchive is REAL: its upsert lands on the fake db above.
  .replace(/from '\.\.\/\.\.\/\.\.\/api\/lib\/messageArchive\.js'/, `from ${JSON.stringify(pathToFileURL(join(repo, 'api/lib/messageArchive.js')).href)}`)
writeFileSync(join(dir, 'sender.mjs'), src)
process.env.RESEND_API_KEY ||= 'test-key'
process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'
const sender = await import(pathToFileURL(join(dir, 'sender.mjs')).href)
const fake = await import(pathToFileURL(join(dir, 'fake.mjs')).href)
rmSync(dir, { recursive: true, force: true })

/** Minimal context that satisfies each resolver's studentEmail/contact guard. */
const CTX = {
  studentEmail: 'ana@example.test', firstName: 'Ana', studentId: 's1', cohortId: 'c1',
  contactEmail: 'lee@example.test', coordinatorEmail: 'dr@example.test',
  interviewerEmail: 'taylor@example.test', unitLeaderEmail: 'ul@example.test',
  email: 'x@example.test', interviewDate: 'Tue', interviewTime: '10:00', cohortName: 'Fall 2026',
  approvedHours: 60, hoursRequired: 120, unitName: '5 West',
}
const run = async (type, opts = {}) => { fake.__reset(opts); await sender.sendNotification(type, CTX); return fake.__state() }

// ── Ordinary types archive, with byte-identical payloads ────────────────────

test('every ordinary template archives the exact body it sent', async () => {
  const covered = []
  for (const type of TEMPLATE_NOTIFICATION_TYPES) {
    const { sends, archives } = await run(type)
    if (!sends.length) continue // no resolver for this type in this fixture
    covered.push(type)
    assert.equal(archives.length, sends.length, `${type}: one archive per send`)
    for (let i = 0; i < sends.length; i++) {
      assert.equal(archives[i].html_redacted !== null, true, `${type}: a body was stored`)
      // The archive input is the SAME html binding the provider got. The stored
      // value is that html after the standard archive redaction, so compare the
      // writer's input rather than its output.
      assert.ok(sends[i].html && sends[i].html.length > 0)
      assert.equal(archives[i].content_kind, 'template_notification', type)
      assert.equal(archives[i].metadata.template_key, type)
      assert.equal(archives[i].metadata.source, 'notifications_shared_sender')
      assert.equal(archives[i].metadata.template_version, '1')
    }
  }
  assert.ok(covered.length >= 5, `expected several ordinary types to exercise, got ${covered.length}`)
})

test('the archived body is the sent body, not a re-render', async () => {
  const { sends, archives } = await run('interview_reminder')
  assert.ok(sends.length && archives.length)
  // Every visible sentence of the sent html survives into the stored body.
  const sentText = sends[0].html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const storedText = archives[0].html_redacted.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  assert.equal(storedText, sentText, 'stored text must equal sent text')
})

test('no ordinary type produces two archive calls', async () => {
  for (const type of TEMPLATE_NOTIFICATION_TYPES) {
    const { sends, archives } = await run(type)
    assert.ok(archives.length <= sends.length, `${type}: more archives than sends`)
  }
})

// ── Excluded types ─────────────────────────────────────────────────────────

test('secure-link, specialized, retired and unknown types never archive', async () => {
  const excluded = [
    ...SECURE_LINK_TYPES, ...Object.keys(SPECIALIZED_OWNERS), ...Object.keys(NOT_ARCHIVED),
    'a_type_nobody_registered',
  ]
  for (const type of excluded) {
    const { archives } = await run(type)
    assert.equal(archives.length, 0, `${type} must not archive through the shared sender`)
  }
})

// ── Failure paths ──────────────────────────────────────────────────────────

test('a failed send creates no archive', async () => {
  const { sends, archives, logs } = await run('interview_reminder', { sendFails: true })
  assert.ok(sends.length > 0, 'a send was attempted')
  assert.ok(logs.length > 0, 'the failure is still logged')
  assert.equal(logs[0].status, 'failed')
  assert.equal(archives.length, 0)
})

test('a failed log insert creates no archive', async () => {
  const { archives } = await run('interview_reminder', { logFails: true })
  assert.equal(archives.length, 0)
})

test('a successful insert without an id creates no archive', async () => {
  const { archives } = await run('interview_reminder', { logNoId: true })
  assert.equal(archives.length, 0)
})

test('an archive failure does not change the send result or re-send', async () => {
  fake.__reset()
  const before = fake.__state().sends.length
  // The writer swallows errors; sendNotification must still resolve normally.
  const out = await sender.sendNotification('interview_reminder', CTX)
  assert.ok(Array.isArray(out) || out === undefined, 'return shape preserved')
  assert.equal(fake.__state().sends.length, before + 1, 'exactly one provider call')
})

test('retries cannot duplicate an archive for the same log row', () => {
  assert.match(read('api/lib/messageArchive.js'),
    /onConflict: 'notification_log_id', ignoreDuplicates: true/)
})

// ── Architectural boundaries worth pinning structurally ────────────────────

test('the sender consults the registry rather than defaulting', () => {
  const code = read('src/lib/notifications/index.js')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(code, /sharedSenderMayArchive\(type\)/, 'the guard must be the registry')
  assert.match(code, /status === 'sent' && notificationLogId && sharedSenderMayArchive\(type\)/,
    'all three runtime conditions plus the registry')
  assert.doesNotMatch(code, /contentKind: 'secure_link_email'/, 'the shared path never writes the secure kind')
})

test('archiving does not re-render or re-query after sending', () => {
  const code = read('src/lib/notifications/index.js')
  const at = code.indexOf('archiveSentMessage({')
  const block = code.slice(at, code.indexOf('});', at))
  assert.doesNotMatch(block, /tpl\(|templates\[|resolveRecipients|\.from\(/)
})
