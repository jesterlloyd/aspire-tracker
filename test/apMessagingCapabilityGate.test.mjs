// Owner-gate hardening: the server capability gate for Academic Partner messaging. Behavioral tests of
// the pure resolver (env flag AND applied DB migration), plus source guards proving the client never
// decides enablement, one canonical source feeds both the tab and the launcher, the disabled state
// makes no unsupported calls, and enabled writes still re-authorize independently.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  apMessagingEnvEnabled, isApTeamMessagingCapable, resolveApMessagingCapability,
} from '../api/lib/apMessagingCapability.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

// A db mock whose rpc() returns a chosen result and records that it was called.
function makeDb(result) {
  const calls = []
  return {
    calls,
    rpc(name) { calls.push(name); if (result instanceof Error) return Promise.reject(result); return Promise.resolve(result) },
  }
}

const withEnv = async (value, fn) => {
  const prev = process.env.AP_MESSAGING_ENABLED
  if (value === undefined) delete process.env.AP_MESSAGING_ENABLED
  else process.env.AP_MESSAGING_ENABLED = value
  try { return await fn() } finally {
    if (prev === undefined) delete process.env.AP_MESSAGING_ENABLED
    else process.env.AP_MESSAGING_ENABLED = prev
  }
}

test('env true AND the DB sentinel true reports ENABLED', async () => {
  await withEnv('true', async () => {
    const db = makeDb({ data: true, error: null })
    assert.equal(await resolveApMessagingCapability(db), true)
    assert.deepEqual(db.calls, ['ap_team_messaging_capability'])
  })
})

test('a missing or non-"true" env flag reports DISABLED and never probes the database', async () => {
  await withEnv(undefined, async () => {
    assert.equal(apMessagingEnvEnabled(), false)
    const db = makeDb({ data: true, error: null })
    assert.equal(await resolveApMessagingCapability(db), false)
    assert.deepEqual(db.calls, [], 'the DB is not probed when the env flag is off')
  })
  await withEnv('false', async () => {
    const db = makeDb({ data: true, error: null })
    assert.equal(await resolveApMessagingCapability(db), false)
    assert.deepEqual(db.calls, [])
  })
  await withEnv('1', async () => {
    // Only the exact string 'true' enables; '1' does not.
    assert.equal(apMessagingEnvEnabled(), false)
  })
})

test('env true but the DB capability missing/failing reports DISABLED (fail-closed)', async () => {
  await withEnv('true', async () => {
    // sentinel not applied -> PostgREST returns an error
    assert.equal(await resolveApMessagingCapability(makeDb({ data: null, error: { code: '42883', message: 'undefined_function' } })), false)
    // sentinel returns a non-true value
    assert.equal(await resolveApMessagingCapability(makeDb({ data: false, error: null })), false)
    // the probe throws
    assert.equal(await resolveApMessagingCapability(makeDb(new Error('network'))), false)
    // no db at all
    assert.equal(await isApTeamMessagingCapable(null), false)
  })
})

test('isApTeamMessagingCapable is true ONLY for a clean true result', async () => {
  assert.equal(await isApTeamMessagingCapable(makeDb({ data: true, error: null })), true)
  assert.equal(await isApTeamMessagingCapable(makeDb({ data: 'true', error: null })), false)  // strict boolean
})

test('the browser cannot decide enablement: it reads one server capability, never a client constant', () => {
  const app = read('src/portal/PortalApp.jsx')
  // The single client value comes from the server endpoint response, gated to an Academic Partner.
  assert.match(app, /fetch\('\/api\/portal\/portal-capabilities'/)
  assert.match(app, /setApMessagingCapable\(data\?\.ap_messaging === true\)/)
  assert.match(app, /const apMessagesEnabled = isAcademicPartner && apMessagingCapable/)
  // No client capability constant/module exists anymore.
  assert.doesNotMatch(app, /AP_MESSAGING_ENABLED/)
  // The capability module reads the flag from the server env only (not a public VITE_ var).
  const cap = read('api/lib/apMessagingCapability.js')
  assert.match(cap, /process\.env\.AP_MESSAGING_ENABLED === 'true'/)
  assert.doesNotMatch(cap, /VITE_/)
})

test('one canonical capability feeds BOTH the Messages tab and the lower-right launcher', () => {
  const app = read('src/portal/PortalApp.jsx')
  // Same apMessagesEnabled drives the tab (AcademicPartnerPortal messagesEnabled) and the launcher
  // (PortalUtilityLayer messagesAuthorized) — not two independent decisions.
  assert.match(app, /messagesEnabled=\{apMessagesEnabled\}/)
  assert.match(app, /messagesAuthorized=\{apMessagesEnabled\}/)
})

test('when disabled the AP portal makes no unsupported message calls (prepared state only)', () => {
  const portal = read('src/portal/AcademicPartnerPortal.jsx')
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  // The workspace (and its polling) is rendered only past the messagesEnabled gate.
  assert.match(strip(portal), /if \(!messagesEnabled\) \{[\s\S]*?<EmptyState[\s\S]*?\}\s*\n\s*return \(\s*\n\s*<PortalMessagesWorkspace/)
})

test('even when enabled, the write still re-authorizes independently (capability is not a substitute)', () => {
  const teamStart = read('api/portal/team-messages-start.js')
  // The caller JWT + role/scope verification runs regardless, BEFORE the capability check, and the RPC
  // re-authorizes in the DB. The capability gate only decides whether to attempt the write at all.
  assert.match(teamStart, /const caller = await verifyPortalMessagesCaller\(req\)/)
  assert.match(teamStart, /if \(!caller\.ok\) return res\.status\(caller\.status\)/)
  assert.match(teamStart, /const apCapable = await resolveApMessagingCapability\(getServiceDb\(\)\)/)
  assert.match(teamStart, /startGeneralTeamConversationForPortal/)
})
