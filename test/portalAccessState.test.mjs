// test/portalAccessState.test.mjs
//
// PORTAL-ACCESS-STATE: the portal fallback card must tell a person the truth
// about their access.
//
// One card used to serve five different situations with a single message:
// "Your ASPIRE portal is being prepared. Your account is active, but your
// portal experience is not available yet. The ASPIRE team will let you know as
// soon as it opens." For a deactivated or closed account every clause was
// false. These tests pin the resolver, the classifier, the wording, and, most
// importantly, the ORDER the portal asks the questions in.
//
// Pure unit and source assertions. Nothing here opens a network connection,
// touches a live database, or sends email.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  resolveAccessState, accessCopy, ACCESS_STATES, ACCESS_COPY, SUPPORT_EMAIL,
} from '../src/lib/portalAccessState.js'
import { classifyGrants, STATES } from '../api/portal/my-access-state.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const portalApp = read('src/portal/PortalApp.jsx')

// ── The resolver ─────────────────────────────────────────────────────────────

test('access state: a deactivated account outranks every other answer', () => {
  // The case that matters most: deactivation does not clear a role grant, so
  // the grant lookup can say "active" while the account is switched off.
  for (const grantState of ['active', 'pending', 'revoked', 'expired', 'not_provisioned', null]) {
    assert.equal(resolveAccessState({ profileActive: false, grantState }), ACCESS_STATES.DEACTIVATED)
  }
  // And it beats a failed lookup too.
  assert.equal(resolveAccessState({ profileActive: false, checkFailed: true }), ACCESS_STATES.DEACTIVATED)
})

test('access state: a NULL or absent is_active still counts as active', () => {
  // Matching how the server has always read that column. A row predating the
  // default must not be told its access ended.
  assert.notEqual(resolveAccessState({ profileActive: null }), ACCESS_STATES.DEACTIVATED)
  assert.notEqual(resolveAccessState({ profileActive: undefined }), ACCESS_STATES.DEACTIVATED)
  assert.notEqual(resolveAccessState({}), ACCESS_STATES.DEACTIVATED)
})

test('access state: a failed check is never dressed up as good news', () => {
  const state = resolveAccessState({ profileActive: true, checkFailed: true })
  assert.equal(state, ACCESS_STATES.UNKNOWN)
  assert.doesNotMatch(accessCopy(state).title, /being prepared/i)
  assert.equal(accessCopy(state).canRetry, true, 'the one state where trying again can help must offer it')
})

test('access state: each grant answer carries through', () => {
  for (const s of ['revoked', 'expired', 'pending', 'not_provisioned']) {
    assert.equal(resolveAccessState({ profileActive: true, grantState: s }), s)
  }
})

test('access state: an unrecognised or missing answer says the neutral true thing', () => {
  // Never invent a reason the server did not give.
  assert.equal(resolveAccessState({ profileActive: true, grantState: null }), ACCESS_STATES.NOT_PROVISIONED)
  assert.equal(resolveAccessState({ profileActive: true, grantState: 'something_new' }), ACCESS_STATES.NOT_PROVISIONED)
})

// ── The copy ─────────────────────────────────────────────────────────────────

test('access copy: an ended account is told so, and pointed at a person', () => {
  for (const s of [ACCESS_STATES.DEACTIVATED, ACCESS_STATES.REVOKED, ACCESS_STATES.EXPIRED]) {
    const copy = accessCopy(s)
    assert.match(copy.title, /has ended/i, `${s} must say access ended`)
    assert.doesNotMatch(copy.title, /being prepared/i, `${s} must not claim something is coming`)
    assert.doesNotMatch(copy.body, /being prepared|will let you know|as soon as it opens/i,
      `${s} must not promise a notification nobody will send`)
    assert.equal(copy.showSupport, true, `${s} must route the person to the ASPIRE team`)
  }
})

test('access copy: the old message survives only where it was always true', () => {
  // A grant that exists but has not started really is being prepared.
  assert.match(accessCopy(ACCESS_STATES.PENDING).title, /being prepared/i)
  assert.match(accessCopy(ACCESS_STATES.PENDING).body, /has not opened yet/i)
})

test('access copy: no state claims the account is active', () => {
  // The exact false clause from the old card.
  for (const [state, copy] of Object.entries(ACCESS_COPY)) {
    assert.doesNotMatch(copy.body, /Your account is active/i, `${state} must not assert the account is active`)
  }
})

test('access copy: the support address is the ASPIRE one, everywhere it is offered', () => {
  assert.equal(SUPPORT_EMAIL, 'aspire@cshs.org')
  const offered = Object.values(ACCESS_COPY).filter(c => c.showSupport)
  assert.ok(offered.length >= 4, 'every ended or uncertain state offers a route to a person')
})

test('access copy: no state explains the mechanism', () => {
  for (const [state, copy] of Object.entries(ACCESS_COPY)) {
    const text = `${copy.title} ${copy.body}`
    assert.doesNotMatch(text, /token|JWT|session|grant|RPC|endpoint|is_active|role|database|403/i,
      `${state} leaks mechanism the reader cannot act on`)
  }
})

test('access copy: every state has copy, and every copy is complete', () => {
  for (const state of Object.values(ACCESS_STATES)) {
    const copy = ACCESS_COPY[state]
    assert.ok(copy, `${state} has no copy`)
    assert.ok(copy.title && copy.body, `${state} is missing title or body`)
    assert.equal(typeof copy.showSupport, 'boolean')
    assert.equal(typeof copy.canRetry, 'boolean')
  }
})

test('access copy: ASPIRE is never written as "ASPIRE Program", and no em dash appears', () => {
  const all = Object.values(ACCESS_COPY).map(c => `${c.title} ${c.body}`).join(' ')
  assert.doesNotMatch(all, /ASPIRE Program/)
  // — is the em dash, written as an escape so this file contains none either.
  assert.doesNotMatch(all, /—/)
  assert.doesNotMatch(read('src/lib/portalAccessState.js'), /—/)
  assert.doesNotMatch(read('api/portal/my-access-state.js'), /—/)
})

// ── The classifier ───────────────────────────────────────────────────────────

const NOW = Date.parse('2026-08-22T12:00:00Z')
const grant = (o) => ({ role: 'student', starts_at: '2026-01-01T00:00:00Z', expires_at: null, revoked_at: null, ...o })

test('classify: no grants at all reads as not provisioned', () => {
  assert.equal(classifyGrants([], NOW), STATES.NOT_PROVISIONED)
  assert.equal(classifyGrants(null, NOW), STATES.NOT_PROVISIONED)
})

test('classify: a live grant reads as active', () => {
  assert.equal(classifyGrants([grant({})], NOW), STATES.ACTIVE)
  assert.equal(classifyGrants([grant({ expires_at: '2027-01-01T00:00:00Z' })], NOW), STATES.ACTIVE)
})

test('classify: revoked and expired are told apart', () => {
  assert.equal(classifyGrants([grant({ revoked_at: '2026-08-01T00:00:00Z' })], NOW), STATES.REVOKED)
  assert.equal(classifyGrants([grant({ expires_at: '2026-08-10T00:00:00Z' })], NOW), STATES.EXPIRED)
})

test('classify: a grant that has not started yet reads as pending', () => {
  assert.equal(classifyGrants([grant({ starts_at: '2026-12-01T00:00:00Z' })], NOW), STATES.PENDING)
})

test('classify: the MOST RECENT ending is the one reported', () => {
  // Revoked long ago, then given fresh access that later lapsed on its own.
  // "Expired" is the current situation and the useful thing to say.
  const rows = [
    grant({ revoked_at: '2026-06-01T00:00:00Z' }),
    grant({ expires_at: '2026-08-10T00:00:00Z' }),
  ]
  assert.equal(classifyGrants(rows, NOW), STATES.EXPIRED)
  // And the other way round.
  const flipped = [
    grant({ expires_at: '2026-06-01T00:00:00Z' }),
    grant({ revoked_at: '2026-08-10T00:00:00Z' }),
  ]
  assert.equal(classifyGrants(flipped, NOW), STATES.REVOKED)
})

test('classify: a live grant wins even when an older one was revoked', () => {
  const rows = [grant({ revoked_at: '2026-06-01T00:00:00Z' }), grant({})]
  assert.equal(classifyGrants(rows, NOW), STATES.ACTIVE)
})

test('classify: only portal roles count', () => {
  assert.equal(classifyGrants([grant({ role: 'preceptor' })], NOW), STATES.NOT_PROVISIONED)
  for (const role of ['student', 'unit_leader', 'academic_partner']) {
    assert.equal(classifyGrants([grant({ role })], NOW), STATES.ACTIVE, `${role} must be recognised`)
  }
})

// ── Where the portal asks the questions ──────────────────────────────────────

test('portal: the deactivated answer is given BEFORE any portal branch', () => {
  // This ordering is the actual fix for the worse of the two bugs. Deactivation
  // leaves a role grant intact, so without this gate a deactivated person
  // resolves to a real portal and is shown a blank one with no explanation.
  const gate = portalApp.indexOf('if (deactivated) return <PortalAccessNotice')
  assert.ok(gate > 0, 'the deactivated gate must exist')
  const firstBranch = portalApp.indexOf('const roles = access?.roles || []')
  assert.ok(firstBranch > 0)
  assert.ok(gate < firstBranch, 'the deactivated gate must run before the roles are read')
  for (const portal of ['<StudentPortal', '<UnitLeaderPortal', '<AcademicPartnerPortal']) {
    assert.ok(gate < portalApp.indexOf(portal), `the gate must run before ${portal} can render`)
  }
})

test('portal: a failed access lookup is recorded, not flattened into no-grants', () => {
  assert.match(portalApp, /if \(error \|\| !data\) \{ setAccess\(\{ roles: \[\] \}\); setAccessFailed\(true\) \}/)
  assert.match(portalApp, /setAccessFailed\(true\); setLoading\(false\)/)
})

test('portal: the why-lookup is skipped whenever the answer is already known', () => {
  // No extra request on a normal sign-in, and none for a caller every endpoint
  // is refusing anyway.
  assert.match(portalApp, /if \(loading \|\| deactivated \|\| accessFailed \|\| experience\) return undefined/)
})

test('portal: the old catch-all component and its copy are gone', () => {
  assert.doesNotMatch(portalApp, /function BeingPrepared/)
  assert.doesNotMatch(portalApp, /Your account is active, but your portal experience/)
  // The remaining literal title lives in the copy module, not the component.
  assert.doesNotMatch(portalApp, /<h1 className="ptl-card-title">Your ASPIRE portal is being prepared/)
})

test('portal: the notice renders state-driven copy and keeps Sign out', () => {
  assert.match(portalApp, /function PortalAccessNotice\(\{ state, onRetry \}\)/)
  assert.match(portalApp, /const copy = accessCopy\(state\)/)
  assert.match(portalApp, /onClick=\{signOut\}>Sign out</)
  assert.match(portalApp, /copy\.canRetry && onRetry/)
  // Exposed for QC without reading the copy.
  assert.match(portalApp, /data-access-state=\{state\}/)
})

// ── The endpoint keeps S-05 intact ───────────────────────────────────────────

test('endpoint: my-access-state is behind the standard portal verifier', () => {
  const src = read('api/portal/my-access-state.js')
  assert.match(src, /import \{ verifyPortalCaller, getServiceDb \} from '\.\.\/lib\/portalAuth\.js'/)
  assert.match(src, /const auth = await verifyPortalCaller\(req\)/)
  // No bespoke auth, and no loosening of the active requirement to serve this screen.
  assert.doesNotMatch(src, /auth\.getUser\(\)/)
  assert.doesNotMatch(src, /is_active/)
})

test('endpoint: it reads only the caller own grants and returns only a state', () => {
  const src = read('api/portal/my-access-state.js')
  assert.match(src, /\.eq\('user_profile_id', auth\.profile\.id\)/)
  assert.match(src, /res\.status\(200\)\.json\(\{ state: classifyGrants\(data\) \}\)/)
  // One table, nothing else.
  const tables = [...src.matchAll(/\.from\('([^']+)'\)/g)].map(m => m[1])
  assert.deepEqual([...new Set(tables)], ['user_role_grants'])
  // GET only, never cached.
  assert.match(src, /method !== 'GET'/)
  assert.match(src, /'Cache-Control', 'no-store'/)
})

test('endpoint: a lookup failure is its own answer, not not_provisioned', () => {
  const src = read('api/portal/my-access-state.js')
  assert.match(src, /if \(error\) return res\.status\(503\)\.json\(\{ error: 'state_unavailable' \}\)/)
})
