// AUTOMATION-SETTINGS-REGISTRY-1: every global automation card must have a
// server entry, or its control never resolves.
//
// THE PRODUCTION DEFECT
// Student Birthday Greetings shipped with a card in Connect > Automations and a
// live cron, but its key was never added to KNOWN_AUTOMATIONS in
// api/automation-settings.js. Two things follow, and only the first is visible:
//
//   1. GET omits the key, so the client's `loaded: !!settingByKey[key]` stays
//      false and the control renders "Loading…" forever with the toggle inert.
//   2. PATCH rejects the key with 400 'Unknown automation_key', so the Owner
//      cannot switch the automation off from the product at all.
//
// Meanwhile the cron is UNAFFECTED: api/lib/automationSettings.js is default-on,
// so a missing row means enabled. The automation would have sent on schedule
// while appearing uncontrollable - which is the dangerous half of this bug.
//
// This guard is structural on purpose: the failure is a missing registration,
// which no behavioral test of the existing keys would ever notice.
//
// Run: node --test test/automationSettingsRegistry.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const settingsSrc = read('api/automation-settings.js')
const viewSrc = read('src/components/connect/AutomationView.jsx')

/** Keys the SERVER will serve and accept. */
function serverKeys(src) {
  const block = src.slice(src.indexOf('const KNOWN_AUTOMATIONS'), src.indexOf('const META_BY_KEY'))
  return [...block.matchAll(/key: '([a-z0-9_]+)'/g)].map(m => m[1])
}

/** Keys the CLIENT cards ask for. `automation_key: null` opts a card out. */
function cardKeys(src) {
  const block = src.slice(src.indexOf('const AUTOMATION_CARDS'), src.indexOf('\n]', src.indexOf('const AUTOMATION_CARDS')))
  return [...block.matchAll(/automation_key: '([a-z0-9_]+)'/g)].map(m => m[1])
}

test('every automation card key is registered on the server', () => {
  const server = new Set(serverKeys(settingsSrc))
  const missing = cardKeys(viewSrc).filter(k => !server.has(k))
  assert.deepEqual(missing, [],
    `these cards would render "Loading…" forever and could not be toggled: ${missing.join(', ')}`)
})

test('student_birthday_greetings specifically is registered and defaults On', () => {
  const block = settingsSrc.slice(settingsSrc.indexOf('const KNOWN_AUTOMATIONS'), settingsSrc.indexOf('const META_BY_KEY'))
  const entry = block.slice(block.indexOf("key: 'student_birthday_greetings'"))
  assert.ok(entry, 'the key must be present')
  assert.match(entry.slice(0, 400), /defaultEnabled: true/,
    'a new automation defaults On, matching the cron helper which is default-on')
})

test('the server registry and the cron helper agree on the same key', () => {
  // The UI toggle is worthless if the cron reads a different key.
  const cron = read('api/cron/student-birthday-greetings.js')
  assert.match(cron, /AUTOMATION_KEY = 'student_birthday_greetings'/)
  assert.match(cron, /automationKey: AUTOMATION_KEY/)
  assert.match(settingsSrc, /key: 'student_birthday_greetings'/)
  assert.match(viewSrc, /automation_key: 'student_birthday_greetings'/)
})

test('an unregistered key is still rejected on write', () => {
  // The allow-list is a real gate, not decoration: it must keep rejecting keys
  // that no automation owns.
  assert.match(settingsSrc, /Unknown automation_key/)
  assert.match(settingsSrc, /META_BY_KEY/)
})

test('the cron remains default-on when no settings row exists', () => {
  const helper = read('api/lib/automationSettings.js')
  assert.match(helper, /defaultEnabled = true/)
  assert.match(helper, /return \{ enabled: defaultEnabled, source: 'default' \}/,
    'a missing row means enabled, which is why the stuck card did not stop sending')
})

// ── The endpoint, EXECUTED: On -> Off -> On, with no email anywhere near it ──
//
// The handler runs verbatim; only its supabase clients are substituted. This is
// what proves the toggle actually persists for the new key rather than 400ing,
// and it never touches a cron, a template, or Resend.

import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const OWNER = { id: 'p1', role: 'owner', is_owner: true }

/** In-memory automation_settings honouring the filters the handler uses. */
function makeDb(rows) {
  const state = { rows: [...rows] }
  const api = {
    state,
    from(table) {
      const f = {}
      let pending = null
      const b = {
        select() { return b },
        eq(c, v) { f[c] = v; return b },
        is(c, v) { f[c] = v; return b },
        in(c, v) { f[`in_${c}`] = v; return b },
        limit() { return b },
        // Resolve through the same `then` body, then take the first row. Written
        // as an async fn because `b.then(...)` returns a value, not a promise.
        async maybeSingle() {
          if (table === 'user_profiles') return { data: OWNER, error: null }
          const r = await new Promise(res => b.then(res))
          return { data: (r.data || [])[0] || null, error: r.error || null }
        },
        single() { return b.maybeSingle() },
        update(patch) { pending = { kind: 'update', patch }; return b },
        insert(row) { pending = { kind: 'insert', row }; return b },
        upsert(row) { pending = { kind: 'upsert', row }; return b },
        then(resolve) {
          if (table === 'user_profiles') return resolve({ data: [OWNER], error: null })
          const match = (r) =>
            (f.automation_key === undefined || r.automation_key === f.automation_key)
            && (f.in_automation_key === undefined || f.in_automation_key.includes(r.automation_key))
            && (f.scope_type === undefined || r.scope_type === f.scope_type)
          if (pending?.kind === 'update') {
            const hit = state.rows.filter(match)
            hit.forEach(r => Object.assign(r, pending.patch, { updated_at: '2026-08-13T20:00:00Z' }))
            return resolve({ data: hit, error: null })
          }
          if (pending?.kind === 'insert' || pending?.kind === 'upsert') {
            const row = { scope_type: 'global', scope_ref: null, updated_at: '2026-08-13T20:00:00Z', ...pending.row }
            const i = state.rows.findIndex(r => r.automation_key === row.automation_key)
            if (i >= 0) state.rows[i] = { ...state.rows[i], ...row }; else state.rows.push(row)
            return resolve({ data: [row], error: null })
          }
          return resolve({ data: state.rows.filter(match), error: null })
        },
      }
      return b
    },
  }
  return api
}

let callSettings
{
  const dir = mkdtempSync(join(tmpdir(), 'autoset-'))
  writeFileSync(join(dir, 'fake.mjs'), `
    export let db = null
    export function __setDb(d) { db = d }
    export function createClient() {
      return { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } }, error: null }) } }
    }
    export default new Proxy({}, { get: (_t, p) => (typeof db[p] === 'function' ? db[p].bind(db) : db[p]) })
  `)
  const rewritten = settingsSrc
    .replace(/from '@supabase\/supabase-js'/, `from ${JSON.stringify(pathToFileURL(join(dir, 'fake.mjs')).href)}`)
    .replace(/from '\.\.\/lib\/server\/evaluation\/supabase_admin\.js'/, `from ${JSON.stringify(pathToFileURL(join(dir, 'fake.mjs')).href)}`)
  writeFileSync(join(dir, 'handler.mjs'), rewritten)
  const mod = await import(pathToFileURL(join(dir, 'handler.mjs')).href)
  const fake = await import(pathToFileURL(join(dir, 'fake.mjs')).href)
  rmSync(dir, { recursive: true, force: true })

  callSettings = async (method, body, db) => {
    fake.__setDb(db)
    let payload = null, code = 0
    const res = { setHeader() {}, status(c) { code = c; return res }, json(j) { payload = j; return res } }
    await mod.default({ method, headers: { authorization: 'Bearer x' }, body }, res)
    return { code, payload }
  }
}

const birthdayOf = (payload) =>
  (payload.settings || payload.automations || []).find(s => s.automation_key === 'student_birthday_greetings')

test('GET now returns the birthday automation, defaulting On with no row', async () => {
  const db = makeDb([])
  const { code, payload } = await callSettings('GET', null, db)
  assert.equal(code, 200)
  const s = birthdayOf(payload)
  assert.ok(s, 'the key must appear at all - its absence was the whole bug')
  assert.equal(s.enabled, true, 'a new automation defaults On')
  assert.equal(s.source, 'default', 'and says so, so the card knows there is no row yet')
})

test('ON -> OFF -> ON persists, and the cron would read the same value', async () => {
  const db = makeDb([])

  const off = await callSettings('PATCH', { automation_key: 'student_birthday_greetings', enabled: false }, db)
  assert.equal(off.code, 200, 'PATCH used to 400 with Unknown automation_key')
  let s = birthdayOf(await callSettings('GET', null, db).then(r => r.payload))
  assert.equal(s.enabled, false, 'Off persists across a re-read (a page refresh)')
  assert.equal(s.source, 'row', 'now backed by a real row')

  // The cron reads the SAME row through isAutomationEnabled: scope_type global,
  // scope_ref null. Persisted shape must satisfy that query.
  const row = db.state.rows.find(r => r.automation_key === 'student_birthday_greetings')
  assert.equal(row.scope_type, 'global')
  assert.equal(row.scope_ref, null)
  assert.equal(row.enabled, false, 'so a paused card really does stop the cron')

  const on = await callSettings('PATCH', { automation_key: 'student_birthday_greetings', enabled: true }, db)
  assert.equal(on.code, 200)
  s = birthdayOf(await callSettings('GET', null, db).then(r => r.payload))
  assert.equal(s.enabled, true, 'and back On')
})

test('an unknown key is still rejected', async () => {
  const { code, payload } = await callSettings('PATCH', { automation_key: 'not_an_automation', enabled: true }, makeDb([]))
  assert.equal(code, 400)
  assert.match(String(payload.error), /Unknown automation_key/)
})
