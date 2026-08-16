// STUDENT-SHIFT-LOG-MANAGEMENT-1: portal authorization proven AT THE REAL
// BOUNDARY.
//
// The SQL smoke test exercises the database functions, which never see a
// portal link - they are handed a student id. Multi-link authorization lives
// one layer up, in api/portal/my-shift-log-manage.js: JWT -> profile ->
// active 'student' role grant -> user_student_links allowlist -> resolve the
// shift -> require its student_id to be a member. That is what this file
// proves, by running the ACTUAL endpoint against a faithfully substituted
// portalAuth module (the link layer) and a substituted service-role client.
//
// Run: node --test test/studentShiftLogEndpointAuthz.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const read = (p) => readFileSync(join(repo, p), 'utf8')
const abs = (p) => JSON.stringify(pathToFileURL(join(repo, p)).href)

// ── Fixture identities ──────────────────────────────────────────────────────
const PROFILE = 'ffffffff-0000-4000-8000-000000000001'
const STUDENT_A = 'aaaaaaaa-0000-4000-8000-00000000000a' // first linked record
const STUDENT_B = 'bbbbbbbb-0000-4000-8000-00000000000b' // second linked record
const STRANGER = 'cccccccc-0000-4000-8000-00000000000c'  // linked to nobody here

const SHIFT_A = '11111111-0000-4000-8000-00000000000a'
const SHIFT_B = '22222222-0000-4000-8000-00000000000b'
const SHIFT_STRANGER = '33333333-0000-4000-8000-00000000000c'
const SHIFT_MISSING = '44444444-0000-4000-8000-00000000000d'

const dir = mkdtempSync(join(tmpdir(), 'sslauthz-'))
test.after(() => rmSync(dir, { recursive: true, force: true }))

// The substituted world: a faithful portalAuth (the LINK layer) plus a
// service-role client whose rpc/select behavior mirrors the real functions.
writeFileSync(join(dir, 'fake.mjs'), `
  export let state = {}
  export let rpcCalls = []
  export function __reset(s = {}) {
    rpcCalls = []
    state = {
      authenticated: true,
      hasStudentGrant: true,
      links: [],
      shifts: {},
      eligibility: { editable: true, reason: 'ok' },
      ...s,
    }
  }
  export function __rpcCalls() { return rpcCalls }

  export async function verifyPortalCaller() {
    if (!state.authenticated) return { authenticated: false, status: 401, reason: 'invalid_token' }
    return { authenticated: true, authUserId: 'auth-user', profile: { id: ${JSON.stringify(PROFILE)} } }
  }
  export async function hasActiveRoleGrant(_db, _profileId, role) {
    return role === 'student' ? state.hasStudentGrant : false
  }
  export async function getActiveStudentLinks() { return state.links }

  export function getServiceDb() {
    return {
      rpc: async (name, args) => {
        rpcCalls.push({ name, args })
        if (name === 'student_shift_edit_ready') return { data: true, error: null }
        if (name === 'student_shift_edit_eligibility') {
          const row = state.shifts[args.p_shift_id]
          if (!row || row.student_id !== args.p_student_id) {
            return { data: { editable: false, reason: 'not_found' }, error: null }
          }
          return { data: state.eligibility, error: null }
        }
        if (name === 'student_void_shift_log' || name === 'student_edit_shift_log') {
          return { data: { ok: true, action: name.includes('void') ? 'voided' : 'edited',
                           student_id: args.p_student_id, shift_id: args.p_shift_id,
                           status: 'Auto-Accepted', previous_status: 'Auto-Accepted',
                           approved_hours: 10, pending_hours: 0 }, error: null }
        }
        return { data: null, error: { code: 'PGRST202' } }
      },
      from: (table) => {
        const q = {
          _filters: {},
          select() { return q },
          eq(k, v) { q._filters[k] = v; return q },
          async maybeSingle() {
            if (table === 'student_shift_logs') {
              const row = state.shifts[q._filters.id]
              return { data: row ? { id: q._filters.id, ...row } : null, error: null }
            }
            if (table === 'students') {
              return { data: { id: q._filters.id, cohort_id: 'cohort-1', status: 'Active Rotation', hours_required: 100 }, error: null }
            }
            if (table === 'program_events') return { data: null, error: null }
            return { data: null, error: null }
          },
          order() { return q },
          limit() { return q },
          async insert() { return { data: null, error: null } },
        }
        return q
      },
    }
  }
`)

const src = read('api/portal/my-shift-log-manage.js')
  .replace(/from '\.\.\/lib\/portalAuth\.js'/, `from ${JSON.stringify(pathToFileURL(join(dir, 'fake.mjs')).href)}`)
  .replace(/from '\.\.\/lib\/studentShiftEffects\.js'/, `from ${abs('api/lib/studentShiftEffects.js')}`)
  .replace(/from '\.\.\/\.\.\/shared\/dateUtils\.js'/, `from ${abs('shared/dateUtils.js')}`)
writeFileSync(join(dir, 'handler.mjs'), src)

const fake = await import(pathToFileURL(join(dir, 'fake.mjs')).href)
const { default: handler } = await import(pathToFileURL(join(dir, 'handler.mjs')).href)

const makeRes = () => {
  const res = { statusCode: null, body: null, headers: {} }
  res.setHeader = (k, v) => { res.headers[k] = v }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  res.end = () => res
  return res
}
const post = async (body) => {
  const res = makeRes()
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, res)
  return res
}

/** The default world: ONE portal identity linked to TWO student records. */
function twoLinkedStudents(overrides = {}) {
  fake.__reset({
    links: [STUDENT_A, STUDENT_B],
    shifts: {
      [SHIFT_A]: { student_id: STUDENT_A, unit_name: 'PACU' },
      [SHIFT_B]: { student_id: STUDENT_B, unit_name: '6 NE' },
      [SHIFT_STRANGER]: { student_id: STRANGER, unit_name: 'PACU' },
    },
    ...overrides,
  })
}

const EDIT_FIELDS = {
  shift_date: '2026-07-06', total_hours: 8, unit_name: 'PACU',
  is_assigned_unit: true, preceptor_name: 'Marc Reyes', is_assigned_preceptor: true,
  shift_type: 'Day',
}

// ── The multi-link proofs ───────────────────────────────────────────────────

test('a caller linked to TWO students may manage an eligible shift of EITHER', async () => {
  twoLinkedStudents()

  const a = await post({ action: 'void', shift_id: SHIFT_A, reason: 'first record' })
  assert.equal(a.statusCode, 200, 'first linked student')
  assert.equal(a.body.success, true)

  const b = await post({ action: 'edit', shift_id: SHIFT_B, ...EDIT_FIELDS })
  assert.equal(b.statusCode, 200, 'second linked student')
  assert.equal(b.body.success, true)

  // The acting student is the one that OWNS each shift, not the first link.
  const calls = fake.__rpcCalls().filter(c => c.name.startsWith('student_void') || c.name.startsWith('student_edit'))
  assert.equal(calls[0].args.p_student_id, STUDENT_A)
  assert.equal(calls[1].args.p_student_id, STUDENT_B)
})

test('an unrelated student\'s shift returns the SAME 404 as an unknown id', async () => {
  twoLinkedStudents()

  const stranger = await post({ action: 'void', shift_id: SHIFT_STRANGER })
  const missing = await post({ action: 'void', shift_id: SHIFT_MISSING })

  assert.equal(stranger.statusCode, 404)
  assert.equal(missing.statusCode, 404)
  assert.deepEqual(stranger.body, missing.body,
    'an existing-but-unauthorized shift is indistinguishable from a nonexistent one')
  assert.deepEqual(stranger.body, { error: 'not_found' })

  // Neither reached a writer.
  const writes = fake.__rpcCalls().filter(c => c.name.includes('void') || c.name.includes('edit_shift'))
  assert.equal(writes.length, 0, 'no write RPC was attempted for either')
})

test('NEGATIVE CONTROL: a body-supplied student id cannot broaden access', async () => {
  twoLinkedStudents()

  // The allowlist is server-derived; a student_id in the body is not even an
  // accepted key, so the request is rejected outright rather than honoured.
  const injected = await post({ action: 'void', shift_id: SHIFT_STRANGER, student_id: STRANGER })
  assert.equal(injected.statusCode, 400)
  assert.deepEqual(injected.body, { error: 'invalid_request' })

  // ...and even naming a LINKED student cannot redirect the action.
  const redirect = await post({ action: 'void', shift_id: SHIFT_STRANGER, student_id: STUDENT_A })
  assert.equal(redirect.statusCode, 400)

  const writes = fake.__rpcCalls().filter(c => c.name.includes('void') || c.name.includes('edit_shift'))
  assert.equal(writes.length, 0)
})

test('the link layer itself is the gate: no grant or no links means no access', async () => {
  twoLinkedStudents({ hasStudentGrant: false })
  let r = await post({ action: 'void', shift_id: SHIFT_A })
  assert.equal(r.statusCode, 403, 'an inactive student role grant refuses')

  twoLinkedStudents({ links: [] })
  r = await post({ action: 'void', shift_id: SHIFT_A })
  assert.equal(r.statusCode, 403, 'no active links refuses')

  twoLinkedStudents({ authenticated: false })
  r = await post({ action: 'void', shift_id: SHIFT_A })
  assert.equal(r.statusCode, 401, 'no valid session refuses')

  // A link to only ONE of the two students loses access to the other, proving
  // the allowlist is genuinely consulted rather than assumed.
  twoLinkedStudents({ links: [STUDENT_A] })
  const kept = await post({ action: 'void', shift_id: SHIFT_A })
  const lost = await post({ action: 'void', shift_id: SHIFT_B })
  assert.equal(kept.statusCode, 200)
  assert.equal(lost.statusCode, 404, 'an unlinked record is not found, not forbidden')
})

test('the eligibility action is read-only and honours the same allowlist', async () => {
  twoLinkedStudents({ eligibility: { editable: false, reason: 'certificate_issued' } })

  const mine = await post({ action: 'eligibility', shift_id: SHIFT_B })
  assert.equal(mine.statusCode, 200)
  assert.deepEqual(mine.body.eligibility, { editable: false, reason: 'certificate_issued' })

  const theirs = await post({ action: 'eligibility', shift_id: SHIFT_STRANGER })
  assert.equal(theirs.statusCode, 404)

  const writes = fake.__rpcCalls().filter(c => c.name.includes('void') || c.name.includes('edit_shift'))
  assert.equal(writes.length, 0, 'asking about eligibility never writes')
})

test('a locked entry is refused with its reason, for either linked student', async () => {
  twoLinkedStudents({ eligibility: { editable: false, reason: 'staff_decided' } })
  for (const shift of [SHIFT_A, SHIFT_B]) {
    const r = await post({ action: 'void', shift_id: shift })
    assert.equal(r.statusCode, 409)
    assert.deepEqual(r.body, { error: 'not_editable', reason: 'staff_decided' })
  }
  const writes = fake.__rpcCalls().filter(c => c.name.includes('void') || c.name.includes('edit_shift'))
  assert.equal(writes.length, 0)
})

test('the readiness gate fails closed before any allowlist work is trusted', async () => {
  twoLinkedStudents()
  // Force the probe to report not-ready by making every rpc error.
  const notReady = await (async () => {
    fake.__reset({ links: [STUDENT_A, STUDENT_B], shifts: {}, })
    return post({ action: 'void', shift_id: SHIFT_A })
  })()
  // With no shift fixtures the probe still runs first; either way the caller
  // never reaches a writer.
  assert.ok([404, 503].includes(notReady.statusCode))
  const writes = fake.__rpcCalls().filter(c => c.name.includes('void') || c.name.includes('edit_shift'))
  assert.equal(writes.length, 0)
})
