// test/transitionPortal.test.mjs
//
// TRANSITION-PORTAL-1 (Owner, 2026-11-02): every Transition Form send opens the alumnus's Student
// Portal through the residency start month, the form opens there under their own sign-in (no
// emailed code, no lockout), and staff can give one alumnus a later close date.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')

process.env.APP_BASE_URL ||= 'https://aspireintelligence.app'
const { portalAccessEnd, laterExpiry, ensureStudentPortalAccess } = await import('../lib/server/ngrpPortalAccess.js')

// ── The window ───────────────────────────────────────────────────────────────

test('access runs through the last day of the residency start month, Pacific', () => {
  const end = portalAccessEnd({ residency_start_date: '2027-01-20' })
  assert.match(end, /^2027-0[12]-/)
  // Jan 31 23:59:59 PST is Feb 1 07:59:59 UTC.
  assert.equal(new Date(end).toISOString().slice(0, 13), '2027-02-01T07')
  assert.equal(new Date(portalAccessEnd({ residency_start_date: '2028-02-03' })).toISOString().slice(0, 10), '2028-03-01')
  assert.equal(portalAccessEnd({}), null)
  assert.equal(portalAccessEnd({ residency_start_date: 'TBD' }), null)
})

test('a grant is never shortened', () => {
  assert.equal(laterExpiry(null, '2027-02-01T00:00:00Z'), null, 'no end is the longest')
  assert.equal(laterExpiry(undefined, '2027-02-01T00:00:00Z'), '2027-02-01T00:00:00Z')
  assert.equal(laterExpiry('2027-06-01T00:00:00Z', '2027-02-01T00:00:00Z'), '2027-06-01T00:00:00Z')
  assert.equal(laterExpiry('2026-06-01T00:00:00Z', '2027-02-01T00:00:00Z'), '2027-02-01T00:00:00Z')
})

// ── ensureStudentPortalAccess against a fake client ──────────────────────────

function fakeDb({ links = [], profiles = [], grants = [], users = {}, rpcError = null } = {}) {
  const calls = { rpc: [], generateLink: [], deleteUser: [] }
  const table = rows => {
    const filters = []
    const q = {
      select: () => q,
      eq: (k, v) => { filters.push(r => r[k] === v); return q },
      is: (k, v) => { filters.push(r => (r[k] ?? null) === v); return q },
      maybeSingle: async () => ({ data: rows.find(r => filters.every(f => f(r))) || null, error: null }),
      then: (ok, bad) => Promise.resolve({ data: rows.filter(r => filters.every(f => f(r))), error: null }).then(ok, bad),
    }
    return q
  }
  const db = {
    from: name => table({ user_student_links: links, user_profiles: profiles, user_role_grants: grants }[name] || []),
    rpc: async (fn, args) => { calls.rpc.push(args); return rpcError ? { data: null, error: rpcError } : { data: { grant: { action: 'created', expires_at: args.p_expires_at } }, error: null } },
    auth: { admin: {
      getUserById: async id => ({ data: { user: users[id] || null } }),
      generateLink: async args => { calls.generateLink.push(args); return { data: { user: { id: 'auth-new' }, properties: { hashed_token: 'h' } }, error: null } },
      deleteUser: async id => { calls.deleteUser.push(id) },
    } },
  }
  return { db, calls }
}

const cycle = { residency_start_date: '2027-01-20' }
const student = { id: 'stu-1' }

test('a new alumnus gets an account, a grant through the start month and an invite link', async () => {
  const { db, calls } = fakeDb()
  const out = await ensureStudentPortalAccess(db, { student, email: 'a@x.com', fullName: 'A', cycle })
  assert.equal(out.ok, true)
  assert.match(out.activationLink, /\/auth\/activate\?token_hash=h&type=invite/)
  assert.equal(calls.generateLink[0].type, 'invite')
  assert.equal(calls.rpc[0].p_role, 'student')
  assert.equal(calls.rpc[0].p_student_id, 'stu-1')
  assert.equal(calls.rpc[0].p_expires_at, portalAccessEnd(cycle))
})

test('an activated account is reused with no link; an expired grant is renewed to the window', async () => {
  const { db, calls } = fakeDb({
    links: [{ student_id: 'stu-1', user_profile_id: 'p1', revoked_at: null }],
    profiles: [{ id: 'p1', auth_user_id: 'u1', email: 'a@x.com' }],
    grants: [{ user_profile_id: 'p1', role: 'student', revoked_at: null, expires_at: '2026-01-01T00:00:00Z' }],
    users: { u1: { user_metadata: { password_set: true } } },
  })
  const out = await ensureStudentPortalAccess(db, { student, email: 'other@x.com', fullName: 'A', cycle })
  assert.equal(out.ok, true)
  assert.equal(out.activationLink, null)
  assert.equal(out.signInEmail, 'a@x.com', 'the account they already sign in with')
  assert.equal(calls.generateLink.length, 0)
  assert.equal(calls.rpc[0].p_expires_at, portalAccessEnd(cycle))
})

test('a longer live grant keeps its end; a never-activated account gets a recovery link', async () => {
  const { db, calls } = fakeDb({
    links: [{ student_id: 'stu-1', user_profile_id: 'p1', revoked_at: null }],
    profiles: [{ id: 'p1', auth_user_id: 'u1', email: 'a@x.com' }],
    grants: [{ user_profile_id: 'p1', role: 'student', revoked_at: null, expires_at: '2099-01-01T00:00:00Z' }],
    users: { u1: { user_metadata: {} } },
  })
  const out = await ensureStudentPortalAccess(db, { student, email: 'a@x.com', fullName: 'A', cycle })
  assert.equal(calls.rpc[0].p_expires_at, '2099-01-01T00:00:00Z')
  assert.equal(calls.generateLink[0].type, 'recovery')
  assert.match(out.activationLink, /type=recovery/)
})

test('a revoked link is respected, and a failed provision removes only the account it made', async () => {
  const revoked = fakeDb({ links: [{ student_id: 'stu-1', user_profile_id: 'p1', revoked_at: '2026-10-01T00:00:00Z' }] })
  assert.deepEqual(await ensureStudentPortalAccess(revoked.db, { student, email: 'a@x.com', cycle }), { ok: false, reason: 'portal_access_revoked' })
  assert.equal(revoked.calls.rpc.length, 0)

  const failed = fakeDb({ rpcError: { code: 'XX000' } })
  const out = await ensureStudentPortalAccess(failed.db, { student, email: 'a@x.com', cycle })
  assert.equal(out.reason, 'portal_access_failed')
  assert.deepEqual(failed.calls.deleteUser, ['auth-new'])

  const noStart = fakeDb()
  assert.equal((await ensureStudentPortalAccess(noStart.db, { student, email: 'a@x.com', cycle: {} })).reason, 'portal_access_no_start_date')
})

// ── Wiring ───────────────────────────────────────────────────────────────────

test('the send provisions only for a real email, never in a demo', () => {
  const ep = read('api/ngrp-transition-send.js')
  assert.match(ep, /ensureStudentPortalAccess\(getServiceDb\(\)/)
  assert.match(ep, /populationOf\(req\)/)
})

test('the portal form reuses the one set of form actions, keyed by the session student', () => {
  const portal = read('api/portal/my-residency.js')
  assert.match(portal, /runTransitionAction\(/)
  assert.match(portal, /resolveStudentAssignment\(/)
  assert.doesNotMatch(portal, /body\.student_id|body\.token/)
  const page = read('src/portal/StudentResidency.jsx')
  assert.match(page, /lazyReload\(/)
  assert.match(page, /NgrpTransitionFormPage/)
})

test('staff extend one alumnus\'s deadline; Talent Acquisition cannot', () => {
  const manage = read('api/ngrp-manage.js')
  const block = manage.slice(manage.indexOf("action === 'form_deadline_set'"))
  assert.match(block.slice(0, 400), /isTalentAcquisition\) return res\.status\(403\)/)
  assert.match(block, /deadline_at: parsed\.closeAt/)
  assert.match(block, /'form_deadline_extended'/)
  const drawer = read('src/components/ngrp/ApplicantDrawer.jsx')
  assert.match(drawer, /Send a New Link/)
  assert.match(drawer, /Extend Deadline/)
  assert.match(read('src/components/ngrp/ProfilesTab.jsx'), /extendDeadline: canSendForms \?/)
})

test('the sign-in page offers a new activation link', () => {
  assert.match(read('src/pages/Login.jsx'), /Email me a new activation link/)
})
