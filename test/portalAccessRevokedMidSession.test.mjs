// test/portalAccessRevokedMidSession.test.mjs
//
// Revoking portal access mid-session must not be reported as a transient error.
//
// Found by smoke test: the Academic Partner students view showed "Something went
// wrong. We could not load your students right now. Please try again shortly",
// with a Try again button. Nothing had gone wrong, the person's access had ended,
// Try again could never succeed, and "shortly" repeated the false-promise problem
// the access-state cards had just lost. On reload the same person correctly
// reached "No portal access on this account", so only the mid-session path was
// wrong.
//
// The hard part is not detecting a refusal, it is telling an ACCESS refusal apart
// from a RESOURCE refusal. A 403 or 404 can equally mean "not you, for this one
// student", which must stay local. Most of this file is about that line.
//
// Pure unit and source assertions. No network, no live database, no email.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { classifyPortalFailure, isAccessEnded, ACCESS_FAILURE } from '../src/lib/portalAccessState.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

// ── The classifier ───────────────────────────────────────────────────────────

test('classify: the reasons that mean this person no longer has access', () => {
  for (const reason of [
    'deactivated', 'no_profile', 'no_active_student_grant', 'no_active_student_link',
    'unit_leader_role_required', 'staff_role_required', 'inactive_staff',
    'owner_or_admin_required', 'forbidden',
  ]) {
    assert.equal(classifyPortalFailure({ status: 403, error: reason }), ACCESS_FAILURE.ACCESS_ENDED, reason)
    assert.equal(isAccessEnded({ status: 403, error: reason }), true, reason)
  }
})

test('classify: a resource refusal stays local and never blanks the portal', () => {
  // unit-student-detail answers 404 not_found for an out-of-scope student, on
  // purpose, so ids cannot be probed. Escalating that would replace a working
  // portal with a no-access card because one drawer was opened on one student.
  assert.equal(classifyPortalFailure({ status: 404, error: 'not_found' }), ACCESS_FAILURE.TRANSIENT)
  // A bare 403 with no reason we recognise is not enough to declare access over.
  assert.equal(classifyPortalFailure({ status: 403 }), ACCESS_FAILURE.TRANSIENT)
  assert.equal(classifyPortalFailure({ status: 403, error: 'unit_not_in_scope' }), ACCESS_FAILURE.TRANSIENT)
})

test('classify: a lookup failure is transient, because it is not an answer', () => {
  // These mean the server could not READ the authorization tables. Saying
  // someone's access ended would be a guess, and the wrong one to guess.
  for (const reason of ['grant_lookup_failed', 'link_lookup_failed', 'scope_lookup_failed',
    'profile_lookup_failed', 'profile_threw', 'internal_error', 'server_misconfigured']) {
    assert.equal(classifyPortalFailure({ status: 403, error: reason }), ACCESS_FAILURE.TRANSIENT, reason)
  }
})

test('classify: a missing or unreadable session is its own answer', () => {
  // Distinct from access ending: signing in again can genuinely help here, and
  // cannot help a revoked person.
  for (const reason of ['missing_token', 'invalid_token', 'verify_threw', 'unauthenticated']) {
    assert.equal(classifyPortalFailure({ status: 401, error: reason }), ACCESS_FAILURE.SIGNED_OUT, reason)
  }
  assert.equal(classifyPortalFailure({ status: 401 }), ACCESS_FAILURE.SIGNED_OUT)
})

test('classify: network and server failures stay retryable', () => {
  assert.equal(classifyPortalFailure({ status: 0, error: 'network_error' }), ACCESS_FAILURE.TRANSIENT)
  assert.equal(classifyPortalFailure({ status: 500, error: 'internal_error' }), ACCESS_FAILURE.TRANSIENT)
  assert.equal(classifyPortalFailure({ status: 503 }), ACCESS_FAILURE.TRANSIENT)
  assert.equal(classifyPortalFailure({}), ACCESS_FAILURE.TRANSIENT)
  assert.equal(classifyPortalFailure(), ACCESS_FAILURE.TRANSIENT)
})

test('classify: every reason the portal verifiers emit is accounted for', () => {
  // Guards against a new verifier reason quietly defaulting to transient and
  // reintroducing the bug on a surface nobody thought about.
  const sources = ['api/lib/portalAuth.js', 'api/lib/messagesAuth.js',
    'api/lib/unitLeaderScope.js', 'api/lib/schoolScope.js']
  const emitted = new Set()
  for (const f of sources) {
    for (const m of read(f).matchAll(/reason: '([a-z_]+)'/g)) emitted.add(m[1])
  }
  assert.ok(emitted.size >= 15, `expected the verifier reason set, found ${emitted.size}`)
  const unclassified = [...emitted].filter((r) =>
    classifyPortalFailure({ status: 403, error: r }) === ACCESS_FAILURE.TRANSIENT
    && !/lookup_failed|_threw|internal_error|server_misconfigured/.test(r))
  assert.deepEqual(unclassified, [], 'these verifier reasons fall through to transient unreviewed')
})

// ── The shell takes over ─────────────────────────────────────────────────────

const portalApp = read('src/portal/PortalApp.jsx')

test('shell: an access refusal renders the SAME no-access card as a reload', () => {
  assert.match(portalApp, /if \(deactivated \|\| accessEnded\) return <PortalAccessNotice state=\{ACCESS_STATES\.NO_ACCESS\} \/>/)
  // Ahead of every portal branch, exactly like the deactivated gate.
  const gate = portalApp.indexOf('if (deactivated || accessEnded)')
  for (const p of ['<StudentPortal', '<UnitLeaderPortal', '<AcademicPartnerPortal']) {
    assert.ok(gate < portalApp.indexOf(p), `the gate must precede ${p}`)
  }
})

test('shell: it re-resolves access on the way in, and only once', () => {
  const handler = portalApp.slice(portalApp.indexOf('const handleAccessEnded'))
    .slice(0, 600)
  assert.match(handler, /setAccessAttempt\(n => n \+ 1\)/, 'must re-resolve rather than trust a stale snapshot')
  assert.match(handler, /refreshUserProfile\?\.\(\)/)
  // Guarded on the previous value, so repeated reports do not loop.
  assert.match(handler, /setAccessEnded\(prev => \{\s*\n\s*if \(!prev\) \{/)
})

test('shell: every portal branch can be reported to', () => {
  assert.equal((portalApp.match(/<PortalAccessSignalContext\.Provider value=\{handleAccessEnded\}>/g) || []).length, 3)
  assert.equal((portalApp.match(/<\/PortalAccessSignalContext\.Provider>/g) || []).length, 3)
})

test('shell: reporting outside a portal is a no-op, not a crash', () => {
  const signal = read('src/portal/portalAccessSignal.js')
  assert.match(signal, /typeof onAccessEnded === 'function'/)
  assert.match(signal, /createContext\(null\)/)
})

// ── The surfaces ─────────────────────────────────────────────────────────────

test('surface: the Academic Partner students view no longer lies', () => {
  const ap = read('src/portal/AcademicPartnerPortal.jsx')
  assert.match(ap, /const kind = reportFailure\(\{ status: res\.status, error: payload\?\.error \}\)/)
  assert.match(ap, /if \(kind === ACCESS_FAILURE\.ACCESS_ENDED\) \{ setLoading\(false\); return \}/)
  // The transient copy survives, for the case where it is true.
  assert.match(ap, /We could not load your students right now\. Please try again shortly\./)
  // The old shape, where any failure became the transient message, is gone.
  assert.doesNotMatch(ap, /const data = res\.ok \? await res\.json\(\) : null/)
})

test('surface: the Student Portal no longer renders a blank portal on refusal', () => {
  const sp = read('src/portal/StudentPortal.jsx')
  // This was the worse gap: a 403 became an empty student list, so the person saw
  // a complete but empty portal and was told nothing at all.
  assert.doesNotMatch(sp, /summaryRes\.ok \? await summaryRes\.json\(\) : \{ students: \[\] \}/)
  assert.match(sp, /reportFailure\(\{ status: summaryRes\.status, error: payload\?\.error \}\)/)
})

test('surface: every Unit Leader view is covered by one hook', () => {
  const ul = read('src/portal/UnitLeaderPortal.jsx')
  // useEndpoint is the single loader for the roster, placement requests,
  // capacity, milestones, notifications, shift activity, and the workspaces.
  const hook = ul.slice(ul.indexOf('function useEndpoint'), ul.indexOf('function useEndpoint') + 1600)
  assert.match(hook, /const reportFailure = useReportPortalFailure\(\)/)
  assert.match(hook, /if \(!res\.ok\) reportFailure\(\{ status: res\.status, error: res\.error \}\)/)
})

test('surface: My Profile stops telling a revoked person to sign in again', () => {
  const mp = read('src/portal/MyProfile.jsx')
  // Signing in again would land them right back here.
  assert.doesNotMatch(mp, /res\.status === 401 \|\| res\.status === 403 \? 'auth' : 'load'/)
  assert.match(mp, /kind === ACCESS_FAILURE\.SIGNED_OUT \? 'auth' : 'load'/)
  // And it yields the screen to the shell rather than flashing a second message.
  assert.match(mp, /if \(state\.error === 'access_ended'\) return null/)
})

test('surface: the Messages data views escalate too', () => {
  for (const f of ['src/portal/messages/PortalMessagesInbox.jsx', 'src/portal/messages/PortalMessagesThread.jsx']) {
    const src = read(f)
    assert.match(src, /useReportAccessFailureEffect\(isError, \{ status: error\?\.status, error: error\?\.code \}\)/, f)
    // MessagesApiError.code carries the endpoint's own error field, which is what
    // makes the reason available here at all.
    assert.ok(read('src/lib/messages/messagesApiClient.js').includes('this.code = code || null'))
  }
})

test('surface: Try again survives wherever it is honest', () => {
  // The point was never to remove the transient card, only to stop showing it for
  // something retrying cannot fix.
  assert.match(read('src/portal/AcademicPartnerPortal.jsx'), /Please try again shortly/)
  assert.match(read('src/portal/UnitLeaderPortal.jsx'), /onRetry=\{roster\.refresh\}/)
  assert.match(read('src/portal/messages/PortalMessagesInbox.jsx'), /Try again/)
})

test('surface: a per-resource denial still renders locally', () => {
  // StudentDetailDrawer's 403/404 must keep meaning "not this student", not
  // "your access is gone".
  const drawer = read('src/portal/unit/StudentDetailDrawer.jsx')
  assert.match(drawer, /res\.status === 403 \|\| res\.status === 404\) setDetail\(\{ forId: studentId, status: 'denied', data: null \}\)/)
  assert.doesNotMatch(drawer, /useReportPortalFailure|reportFailure/)
})

test('house style: no em dash in anything this change added', () => {
  // — written as an escape so this file contains none either.
  assert.doesNotMatch(read('src/portal/portalAccessSignal.js'), /—/)
  const added = read('src/lib/portalAccessState.js').slice(read('src/lib/portalAccessState.js').indexOf('ACCESS_FAILURE'))
  assert.doesNotMatch(added, /—/)
})
