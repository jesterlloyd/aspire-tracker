// test/s13StaticTokenAuth.test.mjs
//
// S-13: no endpoint authenticates with a shared static token compared by equality, and
// the one hand re-run that survived (api/admin/resend-coordinator-digest.js) runs on an
// active Owner or Admin session, records the actor, mails a test only to the caller's
// own address, never bypasses an opt-out, and returns generic errors.
//
//   * SWEEP: no file under api/ or lib/ compares a TOKEN, SECRET or KEY environment
//     value with === or !==, reads x-admin-token, or names ADMIN_NOTIFICATION_TOKEN.
//     The only credential comparison outside a JWT verifier is api/lib/cronAuth.js,
//     which is constant-time over SHA-256 digests.
//   * the two retired endpoints are gone and nothing references them.
//   * the digest re-run, driven through its factory with the caller, db and mailer mocked.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createResendCoordinatorDigestHandler } from '../api/admin/resend-coordinator-digest.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const stripComments = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (/ \d\.(jsx?|mjs)$/.test(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (['.js', '.mjs'].includes(extname(name))) out.push(p)
  }
  return out
}

test('SWEEP: no static token is compared with === or !==, and the retired token is unreferenced', () => {
  const offenders = []
  for (const file of [...walk(join(root, 'api')), ...walk(join(root, 'lib')), ...walk(join(root, 'src'))]) {
    const rel = file.slice(root.length + 1)
    const code = stripComments(readFileSync(file, 'utf8'))
    if (/(===|!==)\s*process\.env\.[A-Z0-9_]*(TOKEN|SECRET|KEY)\b/.test(code)) offenders.push(`${rel}: compares an environment secret with === or !==`)
    if (/process\.env\.[A-Z0-9_]*(TOKEN|SECRET|KEY)\b\s*(===|!==)/.test(code)) offenders.push(`${rel}: compares an environment secret with === or !==`)
    if (/x-admin-token/i.test(code)) offenders.push(`${rel}: reads the retired x-admin-token header`)
    if (/ADMIN_NOTIFICATION_TOKEN/.test(code)) offenders.push(`${rel}: names the retired ADMIN_NOTIFICATION_TOKEN`)
  }
  assert.deepEqual(offenders, [], 'a shared credential is compared in constant time through api/lib/cronAuth.js, or not at all:\n' + offenders.join('\n'))
})

test('the two token-only endpoints are retired and nothing references them', () => {
  assert.equal(existsSync(join(root, 'api/send-notification.js')), false, 'api/send-notification.js retired: arbitrary type, context and recipient behind a shared token, no caller')
  assert.equal(existsSync(join(root, 'api/admin/resend-interview-reminders.js')), false, 'api/admin/resend-interview-reminders.js retired: one-shot recovery for a bug fixed in May 2026, no caller')
  for (const file of [...walk(join(root, 'api')), ...walk(join(root, 'lib')), ...walk(join(root, 'src')), ...walk(join(root, 'test'))]) {
    if (file.endsWith('s13StaticTokenAuth.test.mjs')) continue
    const code = stripComments(readFileSync(file, 'utf8'))
    assert.doesNotMatch(code, /send-notification\.js|resend-interview-reminders/, `${file.slice(root.length + 1)} still names a retired endpoint`)
  }
  assert.doesNotMatch(stripComments(read('vercel.json')), /send-notification|resend-interview-reminders/)
})

test('cronAuth remains the one constant-time credential check, and the digest re-run does not use a token at all', () => {
  const cron = read('api/lib/cronAuth.js')
  assert.match(cron, /timingSafeEqual\(digest\(header\), digest\(`Bearer \$\{configured\}`\)\)/)
  const digestSrc = stripComments(read('api/admin/resend-coordinator-digest.js'))
  assert.match(digestSrc, /import \{ verifyOwnerAdminCaller \} from '\.\.\/lib\/portalAuth\.js'/)
  assert.match(digestSrc, /const auth = await verifyCaller\(req\)/)
  assert.doesNotMatch(digestSrc, /process\.env\.[A-Z_]*TOKEN/)
  // Every notification_log row this run writes carries the actor.
  assert.equal((digestSrc.match(/\.\.\.actorMeta,/g) || []).length, 5, 'test row, sent row and failed row, plus the two audit rows, all carry triggered_by_*')
  assert.equal((digestSrc.match(/await emitAudit\(/g) || []).length, 2, 'the test send and the manual run are both audited')
  // No response carries a raw provider or database message.
  for (const m of digestSrc.matchAll(/res\.status\(\d+\)\.json\(([^)]*)\)/g)) {
    assert.doesNotMatch(m[1], /\.message\b/, `raw message in a response: ${m[0]}`)
  }
  // An opt-out cannot be forced.
  assert.match(digestSrc, /if \(coordinator\.notification_preferences\?\.weekly_digest === false\) \{\s*skipped\.push/)
  assert.doesNotMatch(digestSrc, /!force && coordinator\.notification_preferences/)
})

// ── Behaviour, through the factory ──────────────────────────────────────────

function makeRes() {
  const res = { statusCode: 0, body: null, headers: {} }
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (payload) => { res.body = payload; return res }
  res.end = () => res
  return res
}

const COORD_OK = { id: 'c-ok', full_name: 'Casey Coordinator', preferred_name: 'Casey', email: 'casey@school.edu', school_name: 'WCU-LA', program_type: null, notification_preferences: {} }
const COORD_OUT = { id: 'c-out', full_name: 'Olive Optout', preferred_name: 'Olive', email: 'olive@school.edu', school_name: 'WCU-LA', program_type: null, notification_preferences: { weekly_digest: false } }
const EVENT = { id: 'e1', event_type: 'form_received', event_date: '2026-09-20', created_at: '2026-09-20T10:00:00Z', notes: null,
  students: { id: 's1', first_name: 'Sam', preferred_first_name: null, last_name: 'Student', school: 'WCU-LA', program_type: null, status: 'Placed', is_demo: false } }

function makeDb({ events = [EVENT], coordinators = [COORD_OK, COORD_OUT], alreadySent = [] } = {}) {
  const log = { notificationLogs: [], audits: [], contactUpdates: [] }
  const db = {
    from(table) {
      const q = { _table: table, _filters: [] }
      const chain = (fn) => { fn(); return q }
      q.select = () => q
      q.eq = (col, v) => chain(() => q._filters.push([col, v]))
      q.in = () => q
      q.gte = () => q
      q.lt = () => q
      q.insert = (row) => {
        if (table === 'notification_log') log.notificationLogs.push(row)
        if (table === 'activity_logs') log.audits.push(row)
        return { select: () => ({ single: async () => ({ data: { id: `log-${log.notificationLogs.length}` }, error: null }) }), then: (r) => r({ error: null }) }
      }
      q.update = (patch) => ({ eq: async () => { log.contactUpdates.push(patch); return { error: null } } })
      q.then = (resolve) => {
        if (table === 'program_events') return resolve({ data: events, error: null })
        if (table === 'contacts') return resolve({ data: coordinators, error: null })
        if (table === 'notification_log') return resolve({ data: alreadySent.map((id) => ({ contact_id: id })), error: null })
        if (table === 'message_archive' || table === 'notification_archive') return resolve({ data: null, error: null })
        return resolve({ data: [], error: null })
      }
      return q
    },
    // demoScopeOf reads this; narrowByEmbed keeps real rows for a real scope
    __aspireDemoScope: false,
  }
  return { db, log }
}

function makeMailer() {
  const sends = []
  return { sends, mailer: { emails: { send: async (payload) => { sends.push(payload); return { data: { id: `re_${sends.length}` }, error: null } } } } }
}

const ADMIN = { id: 'p-admin', role: 'admin', full_name: 'Ada Admin', email: 'Ada.Admin@cshs.org' }
const okCaller = async () => ({ ok: true, profile: ADMIN })

test('no session, or a non-admin session, is refused before anything is read or sent', async () => {
  const { db, log } = makeDb()
  const { mailer, sends } = makeMailer()
  for (const [verify, status] of [[async () => ({ ok: false, status: 401 }), 401], [async () => ({ ok: false, status: 403 }), 403]]) {
    const handler = createResendCoordinatorDigestHandler({ verifyCaller: verify, getDb: () => db, getMailer: () => mailer })
    const res = makeRes()
    await handler({ method: 'POST', headers: {}, body: {} }, res)
    assert.equal(res.statusCode, status)
  }
  assert.equal(sends.length, 0, 'no email sent')
  assert.equal(log.notificationLogs.length, 0)
})

test('a test send goes only to the caller\'s own account email; any other address is refused', async () => {
  const { db, log } = makeDb()
  const { mailer, sends } = makeMailer()
  const handler = createResendCoordinatorDigestHandler({ verifyCaller: okCaller, getDb: () => db, getMailer: () => mailer })
  const foreign = makeRes()
  await handler({ method: 'POST', headers: {}, body: { testMode: true, testRecipientEmail: 'someone.else@example.com' } }, foreign)
  assert.equal(foreign.statusCode, 403)
  assert.equal(sends.length, 0)

  const own = makeRes()
  await handler({ method: 'POST', headers: {}, body: { testMode: true, testRecipientEmail: 'ada.admin@cshs.org' } }, own)
  assert.equal(own.statusCode, 200, JSON.stringify(own.body))
  assert.deepEqual(sends.map((s) => s.to), [['ada.admin@cshs.org']], 'one email, to the caller, case-insensitively matched')
  assert.equal(log.notificationLogs[0].notification_type, 'coordinator_weekly_digest_test')
  assert.equal(log.notificationLogs[0].metadata.triggered_by_profile_id, 'p-admin', 'the actor is on the log row')
  assert.equal(log.audits.length, 1)
  assert.equal(log.audits[0].user_id, 'p-admin')
})

test('a manual run records the actor on every row, never mails an opted-out coordinator even with force, and returns generic failure text', async () => {
  const failing = { sends: [], mailer: { emails: { send: async (payload) => {
    failing.sends.push(payload)
    if (payload.to[0] === 'casey@school.edu') return { data: null, error: { message: 'Resend: 422 domain not verified (secret detail)' } }
    return { data: { id: 're_x' }, error: null }
  } } } }
  const { db, log } = makeDb()
  const handler = createResendCoordinatorDigestHandler({ verifyCaller: okCaller, getDb: () => db, getMailer: () => failing.mailer })
  const res = makeRes()
  await handler({ method: 'POST', headers: {}, body: { force: true } }, res)
  assert.equal(res.statusCode, 200, JSON.stringify(res.body))
  assert.deepEqual(failing.sends.map((s) => s.to), [['casey@school.edu']], 'Olive opted out: no email, force or not')
  assert.deepEqual(res.body.skipped, [{ coordinator: 'Olive Optout', reason: 'opted_out' }])
  assert.deepEqual(res.body.failed, [{ coordinator: 'Casey Coordinator', error: 'send_failed' }], 'the provider text stays in the server log')
  for (const row of log.notificationLogs) assert.equal(row.metadata.triggered_by_profile_id, 'p-admin', 'actor on the failed row too')
  assert.equal(log.audits.at(-1).action_type, 'coordinator_digest_manual_run')
  assert.equal(log.audits.at(-1).metadata.force, true)
})

test('the register records S-13 as closed with the force flag located, and no changed file carries an em dash', () => {
  const register = read('docs/security/FINDINGS_REGISTER.md')
  const s13 = register.slice(register.indexOf('## S-13.'), register.indexOf('## S-14.'))
  assert.match(s13, /\*\*Status\*\*: CLOSED\./)
  assert.match(s13, /force/)
  const dash = new RegExp(String.fromCharCode(8212))
  for (const p of ['api/admin/resend-coordinator-digest.js', 'test/s13StaticTokenAuth.test.mjs']) {
    assert.doesNotMatch(read(p), dash, `${p}: no em dash`)
    assert.doesNotMatch(read(p), new RegExp('ASPIRE ' + 'Program'))
  }
  assert.doesNotMatch(s13, dash)
})
