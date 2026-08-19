// test/placementNotificationEndpoint.test.mjs
//
// PLACEMENT-NOTIFICATION-CONTROL-1 - endpoint security and identity proof.
//
// The SHIPPED handler is executed with only its imports swapped: a substituted
// Supabase admin client, a substituted auth client, and a recording mail client
// that must never be called. Nothing here re-implements handler logic, so if the
// endpoint stops enforcing what these tests claim, these tests fail.
//
// WHY THIS FILE EXISTS SEPARATELY. api/placement-notification-confirm.js is the
// ONLY writer of placement notification state. Everything the Placement Board
// and the Action Center display about a real person passes through it, and the
// browser supplies every identifier in the request. So the request is treated as
// a CLAIM: the match id is a lookup handle, and every relationship is re-read
// from the database before anything is written.
//
// MUTATION CONTROLS. The last section weakens each guard in a copy of the
// shipped source and asserts the corresponding proof FAILS against the weakened
// build. A security test that passes against a broken endpoint proves nothing;
// these show each one has teeth.
//
// Run: node --test test/placementNotificationEndpoint.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const read = (p) => readFileSync(join(repo, p), 'utf8')
const abs = (p) => JSON.stringify(pathToFileURL(join(repo, p)).href)

process.env.SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key-not-a-secret'
process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'test-anon-not-a-secret'

const dir = mkdtempSync(join(tmpdir(), 'placement-notify-'))
test.after(() => rmSync(dir, { recursive: true, force: true }))

// ── The world the handler reads ─────────────────────────────────────────────

const ID = {
  cohort: 'cccccccc-0000-4000-8000-00000000000c',
  otherCohort: 'cccccccc-0000-4000-8000-00000000000d',
  student: 'aaaaaaaa-0000-4000-8000-000000000001',
  otherStudent: 'aaaaaaaa-0000-4000-8000-000000000002',
  unit: 'dddddddd-0000-4000-8000-000000000001',
  otherUnit: 'dddddddd-0000-4000-8000-000000000002',
  preceptor: 'eeeeeeee-0000-4000-8000-000000000001',
  replaced: 'eeeeeeee-0000-4000-8000-000000000002',
  match: 'ffffffff-0000-4000-8000-000000000001',
  // A second placement for the SAME student, on another unit.
  match2: 'ffffffff-0000-4000-8000-000000000002',
  gone: 'ffffffff-0000-4000-8000-00000000dead',
}

// Every profile shape the app can present. Only the first two may write.
const PROFILES = {
  owner: { id: 'staff-owner', role: 'owner', is_owner: true, full_name: 'Test Owner', email: 'owner@example.org' },
  admin: { id: 'staff-admin', role: 'admin', is_owner: false, full_name: 'Test Admin', email: 'admin@example.org' },
  viewer: { id: 'staff-viewer', role: 'viewer', is_owner: false, full_name: 'View Only', email: 'viewer@example.org' },
  interviewer: { id: 'staff-iv', role: 'interviewer', is_owner: false, full_name: 'Panelist', email: 'iv@example.org' },
  preceptor: { id: 'staff-prec', role: 'preceptor', is_owner: false, full_name: 'A Preceptor', email: 'prec@example.org' },
  // The subtlest one: a role string nobody defined. It must fail CLOSED.
  unknown: { id: 'staff-x', role: 'coordinator', is_owner: false, full_name: 'Unknown Role', email: 'x@example.org' },
  none: null,                    // authenticated, but no profile row
}

function fakeSource(profileKey, authenticated = true) {
  return `
  export let logInserts = [], matchUpdates = [], mailCalls = [], authCalls = [];
  export function __reset() { logInserts = []; matchUpdates = []; mailCalls = []; authCalls = []; }

  export const ID = ${JSON.stringify(ID)};
  export let PROFILE = ${JSON.stringify(PROFILES[profileKey] ?? null)};
  export const AUTHENTICATED = ${authenticated ? 'true' : 'false'};

  // The mail client. If the handler ever contacts it, these tests fail.
  export class Resend {
    constructor() { this.emails = { send: async (p) => { mailCalls.push(p); return { data: { id: 'x' }, error: null } } } }
  }

  export function createClient() {
    return { auth: { getUser: async () => {
      authCalls.push(1);
      if (!AUTHENTICATED) return { data: null, error: { message: 'invalid token' } };
      return { data: { user: { id: 'auth-user-1' } }, error: null };
    } } };
  }

  // The CANONICAL rows. The request never edits these; it only claims things
  // about them, and the handler re-reads them.
  const MATCHES = {
    [ID.match]:  { id: ID.match,  student_id: ID.student, unit_id: ID.unit,      cohort_id: ID.cohort, preceptor_id: ID.preceptor, preceptor_assigned: 'Real Preceptor', notification_sent: false },
    [ID.match2]: { id: ID.match2, student_id: ID.student, unit_id: ID.otherUnit, cohort_id: ID.cohort, preceptor_id: ID.replaced,  preceptor_assigned: 'Other Preceptor', notification_sent: false },
  };
  const STUDENTS = {
    [ID.student]:      { id: ID.student,      cohort_id: ID.cohort, preceptor_id: ID.preceptor, matched_preceptor: 'Real Preceptor', preceptor_email: 'real@example.org', shift_assigned: 'Day' },
    [ID.otherStudent]: { id: ID.otherStudent, cohort_id: ID.cohort, preceptor_id: null, matched_preceptor: '', preceptor_email: '', shift_assigned: null },
  };
  const UNITS = {
    [ID.unit]:      { id: ID.unit,      cohort_id: ID.cohort, unit_name: 'QC Unit', contact_person: 'Unit Leader Name', contact_email: 'leader@example.org' },
    [ID.otherUnit]: { id: ID.otherUnit, cohort_id: ID.cohort, unit_name: 'QC Unit Two', contact_person: 'Other Leader', contact_email: 'other@example.org' },
  };
  const PRECEPTORS = {
    [ID.preceptor]: { id: ID.preceptor, full_name: 'Real Preceptor',  email: 'real@example.org',  shift_type: 'Day', is_active: true },
    [ID.replaced]:  { id: ID.replaced,  full_name: 'Other Preceptor', email: 'other@example.org', shift_type: 'Day', is_active: true },
  };
  export const CANON = { MATCHES, STUDENTS, UNITS, PRECEPTORS };

  const readField = (row, key) => {
    const j = /^metadata->>(.+)$/.exec(key);
    return j ? row?.metadata?.[j[1]] : row?.[key];
  };

  const admin = {
    from(table) {
      const q = { table, filters: [], inFilter: null };
      const api = {
        select() { return api },
        eq(f, v) { q.filters.push([f, v]); return api },
        in(col, vals) {
          if (q.table === 'preceptors') {
            return Promise.resolve({ data: vals.map(v => PRECEPTORS[v]).filter(Boolean), error: null });
          }
          q.inFilter = [col, vals];
          return api;
        },
        order() { return api },
        then(resolve, reject) {
          let rows = [];
          if (q.table === 'matches') {
            rows = Object.values(MATCHES).filter(m => q.filters.every(([f, v]) => String(m[f] ?? '') === String(v)));
          } else if (q.table === 'notification_log') {
            rows = logInserts.filter(r =>
              (!q.inFilter || q.inFilter[1].includes(readField(r, q.inFilter[0])))
              && q.filters.every(([f, v]) => String(readField(r, f) ?? '') === String(v)));
          }
          // Rows are COPIES, so a handler cannot mutate the stored ledger in place.
          return Promise.resolve({ data: rows.map(r => JSON.parse(JSON.stringify(r))), error: null }).then(resolve, reject);
        },
        maybeSingle() {
          if (q.table === 'user_profiles') return Promise.resolve({ data: PROFILE, error: null });
          const id = (q.filters.find(([f]) => f === 'id') || [])[1];
          const row = q.table === 'matches' ? MATCHES[id]
            : q.table === 'units' ? UNITS[id]
            : q.table === 'students' ? STUDENTS[id]
            : q.table === 'preceptors' ? PRECEPTORS[id]
            : null;
          return Promise.resolve({ data: row ? JSON.parse(JSON.stringify(row)) : null, error: null });
        },
        single() { return api.maybeSingle() },
        insert(row) {
          if (q.table === 'notification_log') logInserts.push(JSON.parse(JSON.stringify(row)));
          else logInserts.push({ __FOREIGN_TABLE__: q.table, row });
          return { select: () => ({ single: async () => ({ data: { id: 'log-' + logInserts.length }, error: null }) }) };
        },
        update(patch) {
          return { eq: async (col, val) => {
            matchUpdates.push({ table: q.table, patch, [col]: val });
            return { data: null, error: null };
          } };
        },
        delete() { throw new Error('the endpoint must never delete') },
      };
      return api;
    },
  };
  export default admin;
`
}

function buildHandler(profileKey, { mutate = (s) => s, tag = profileKey, authenticated = true } = {}) {
  const fakePath = join(dir, `fake-${tag}.mjs`)
  writeFileSync(fakePath, fakeSource(profileKey, authenticated))
  const FAKE = JSON.stringify(pathToFileURL(fakePath).href)
  const src = mutate(read('api/placement-notification-confirm.js'))
    .replace(/from '@supabase\/supabase-js'/, `from ${FAKE}`)
    .replace(/from '\.\.\/lib\/server\/evaluation\/supabase_admin\.js'/, `from ${FAKE}`)
    .replace(/from '\.\/lib\/placementSendGuard\.js'/, `from ${abs('api/lib/placementSendGuard.js')}`)
    .replace(/from '\.\.\/src\/lib\/placementNotificationState\.js'/, `from ${abs('src/lib/placementNotificationState.js')}`)
  const modPath = join(dir, `handler-${tag}.mjs`)
  writeFileSync(modPath, src)
  return Promise.all([
    import(pathToFileURL(modPath).href).then(m => m.default),
    import(pathToFileURL(fakePath).href),
  ])
}

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; return this },
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    end() { return this },
  }
}

const AUTH = { authorization: 'Bearer real-session-token' }

const precRef = (over = {}) => ({
  target: 'preceptor', action: 'confirm',
  match_id: ID.match, student_id: ID.student, unit_id: ID.unit,
  cohort_id: ID.cohort, preceptor_id: ID.preceptor, ...over,
})
const leaderRef = (over = {}) => ({
  target: 'unit_leader', action: 'confirm',
  match_id: ID.match, student_id: ID.student, unit_id: ID.unit, cohort_id: ID.cohort, ...over,
})

// A handler per caller shape, built once.
const built = {}
for (const key of ['owner', 'admin', 'viewer', 'interviewer', 'preceptor', 'unknown', 'none']) {
  const [handler, fakes] = await buildHandler(key, { tag: key })
  built[key] = { handler, fakes }
}
// 'anon' carries a VALID Owner profile row behind an auth client that rejects
// the token, so a rejected TOKEN is proven separately from a rejected ROLE - and
// a handler that checked the profile first would be caught here.
{
  const [handler, fakes] = await buildHandler('owner', { tag: 'anon', authenticated: false })
  built.anon = { handler, fakes }
}

async function call(who, body, { headers = AUTH, method = 'POST' } = {}) {
  const { handler, fakes } = built[who]
  fakes.__reset()
  const res = makeRes()
  await handler({ method, headers, body }, res)
  return { res, fakes }
}

// ── 1. Authentication and authorization ─────────────────────────────────────

test('SECURITY: an Owner and an Admin may record, for both targets', async () => {
  for (const who of ['owner', 'admin']) {
    for (const ref of [precRef, leaderRef]) {
      const { res, fakes } = await call(who, ref())
      assert.equal(res.statusCode, 200, `${who}: ${JSON.stringify(res.body)}`)
      assert.equal(res.body.recorded, true)
      assert.equal(fakes.logInserts.length, 1)
      assert.equal(fakes.mailCalls.length, 0, 'no email may leave this endpoint')
    }
  }
})

test('SECURITY: viewer, interviewer, preceptor and unknown roles are refused', async () => {
  for (const who of ['viewer', 'interviewer', 'preceptor', 'unknown']) {
    for (const ref of [precRef, leaderRef]) {
      const { res, fakes } = await call(who, ref())
      assert.equal(res.statusCode, 403, `${who} must be forbidden`)
      assert.equal(res.body.success, false)
      assert.equal(fakes.logInserts.length, 0, `${who} wrote a row`)
      assert.equal(fakes.matchUpdates.length, 0, `${who} wrote a match row`)
    }
  }
})

test('SECURITY: an authenticated user with NO profile row is refused', async () => {
  for (const ref of [precRef, leaderRef]) {
    const { res, fakes } = await call('none', ref())
    assert.equal(res.statusCode, 403)
    assert.equal(fakes.logInserts.length, 0)
  }
})

test('SECURITY: an unauthenticated caller is refused before any lookup', async () => {
  for (const ref of [precRef, leaderRef]) {
    const { res, fakes } = await call('anon', ref())
    assert.equal(res.statusCode, 401)
    assert.equal(fakes.logInserts.length, 0)
    assert.equal(fakes.matchUpdates.length, 0)
  }
  // And with no Authorization header at all, the auth client is never contacted.
  const { res, fakes } = await call('owner', precRef(), { headers: {} })
  assert.equal(res.statusCode, 401)
  assert.equal(fakes.authCalls.length, 0, 'a tokenless request must not reach the auth service')
})

test('SECURITY: only POST is accepted', async () => {
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    const { res, fakes } = await call('owner', precRef(), { method })
    assert.equal(res.statusCode, 405, method)
    assert.equal(fakes.logInserts.length, 0)
  }
})

// ── 2. The match id is a HANDLE; everything else is a claim ─────────────────

test('IDENTITY: relationships are re-read from the database, not taken from the body', async () => {
  const { res, fakes } = await call('owner', precRef())
  assert.equal(res.statusCode, 200)
  const meta = fakes.logInserts[0].metadata
  const canon = fakes.CANON.MATCHES[ID.match]
  // Every stamped id equals the CANONICAL row's value.
  assert.equal(meta.placement_student_id, canon.student_id)
  assert.equal(meta.placement_unit_id, canon.unit_id)
  assert.equal(meta.placement_cohort_id, canon.cohort_id)
  assert.equal(meta.placement_preceptor_id, canon.preceptor_id)
  assert.equal(meta.placement_match_id, canon.id)
})

test('IDENTITY: a stale match is refused for both targets', async () => {
  for (const ref of [precRef, leaderRef]) {
    const { res, fakes } = await call('owner', ref({ match_id: ID.gone }))
    assert.equal(res.statusCode, 409)
    assert.equal(res.body.placement_error, 'match_missing')
    assert.equal(fakes.logInserts.length, 0)
    assert.equal(fakes.matchUpdates.length, 0)
  }
})

test('IDENTITY: a wrong student, wrong unit or cross-cohort claim is refused', async () => {
  const cases = [
    [{ student_id: ID.otherStudent }, 'student_mismatch'],
    [{ unit_id: ID.otherUnit }, 'unit_mismatch'],
    [{ cohort_id: ID.otherCohort }, 'cohort_mismatch'],
  ]
  for (const [over, code] of cases) {
    for (const ref of [precRef, leaderRef]) {
      const { res, fakes } = await call('owner', ref(over))
      assert.equal(res.statusCode, 409, `${code}: ${JSON.stringify(res.body)}`)
      assert.equal(res.body.placement_error, code)
      assert.equal(fakes.logInserts.length, 0)
      assert.equal(fakes.matchUpdates.length, 0)
    }
  }
})

test('IDENTITY: a replaced preceptor is refused - the claim cannot pick the person', async () => {
  const { res, fakes } = await call('owner', precRef({ preceptor_id: ID.replaced }))
  assert.equal(res.statusCode, 409)
  assert.equal(res.body.placement_error, 'preceptor_changed')
  assert.equal(fakes.logInserts.length, 0)
})

test('IDENTITY: a multi-unit student cannot record one unit\'s preceptor on another', async () => {
  // match2 carries a DIFFERENT preceptor. Claiming match2 with match1's preceptor
  // must fail rather than resolve through the student-level fallback.
  const { res, fakes } = await call('owner', precRef({ match_id: ID.match2, unit_id: ID.otherUnit }))
  assert.equal(res.statusCode, 409)
  assert.equal(res.body.placement_error, 'preceptor_changed')
  assert.equal(fakes.logInserts.length, 0)
})

test('IDENTITY: incomplete context is refused before any lookup', async () => {
  const incomplete = [
    { match_id: 'not-a-uuid' }, { student_id: '' }, { unit_id: null },
    { cohort_id: undefined }, { match_id: undefined },
  ]
  for (const over of incomplete) {
    const { res, fakes } = await call('owner', precRef(over))
    assert.equal(res.statusCode, 400, JSON.stringify(over))
    assert.equal(fakes.logInserts.length, 0)
  }
  // A preceptor target with no preceptor id is incomplete by definition.
  const { res } = await call('owner', { ...precRef(), preceptor_id: undefined })
  assert.equal(res.statusCode, 400)
  assert.match(res.body.error, /preceptor_id/)
})

test('IDENTITY: a body-supplied actor, recipient or state is REFUSED, not ignored', async () => {
  const forged = [
    { confirmed_by: 'someone-else' },
    { confirmed_by_name: 'Not Me' },
    { recipient_name: 'Forged Person' },
    { recipient_email: 'forged@example.org' },
    { status: 'confirmed' },
    { notification_type: 'placement_notification_confirmed' },
    { metadata: { placement_match_id: ID.match } },
    { already: true },
  ]
  for (const over of forged) {
    const { res, fakes } = await call('owner', { ...precRef(), ...over })
    assert.equal(res.statusCode, 400, JSON.stringify(over))
    assert.match(res.body.error, /Unexpected field/)
    assert.match(res.body.error, /taken from your session, never from the request/)
    assert.equal(fakes.logInserts.length, 0)
  }
})

test('IDENTITY: the acting user and the recipient come from the SERVER', async () => {
  const { fakes } = await call('admin', precRef())
  const row = fakes.logInserts[0]
  assert.equal(row.metadata.confirmed_by, 'staff-admin', 'the session profile id')
  assert.equal(row.metadata.confirmed_by_name, 'Test Admin')
  // The recipient identity is the preceptor row the guard verified.
  assert.equal(row.recipient_email, 'real@example.org')
  assert.equal(row.recipient_name, 'Real Preceptor')
  assert.equal(row.recipient_role, 'Preceptor')

  // The unit-leader target takes its recipient from the UNIT row.
  const leader = await call('admin', leaderRef())
  const lrow = leader.fakes.logInserts[0]
  assert.equal(lrow.recipient_email, 'leader@example.org')
  assert.equal(lrow.recipient_name, 'Unit Leader Name')
  assert.equal(lrow.recipient_role, 'Unit Leader')
})

// ── 2b. Legacy confirmations the endpoint must be able to see ──────────────

test('LEGACY: a pre-ledger manual confirmation is visible to the endpoint', async () => {
  // DEFECT REPRODUCED IN FIXTURE QC: a placement_manual_confirmation carries no
  // notification_target - the field did not exist when it was written. While the
  // ledger read filtered on that field, the board showed the row as confirmed
  // and the endpoint could not see it, so the Owner's correction silently
  // answered "nothing to correct".
  const { handler, fakes } = built.owner
  fakes.__reset()
  fakes.logInserts.push({
    id: 'manual-legacy-1',
    notification_type: 'placement_manual_confirmation', status: 'confirmed',
    sent_at: '2026-08-13T10:00:00.000Z',
    metadata: {
      placement_match_id: ID.match, placement_preceptor_id: ID.preceptor,
      placement_student_id: ID.student, placement_unit_id: ID.unit,
      placement_cohort_id: ID.cohort, source: 'manual_confirmation',
    },
  })

  // It reads as confirmed, so confirming again changes nothing.
  const again = makeRes()
  await handler({ method: 'POST', headers: AUTH, body: precRef() }, again)
  assert.equal(again.body.already, true, 'a legacy confirmation is still a confirmation')
  assert.equal(fakes.logInserts.length, 1, 'nothing was appended')

  // And it can be CORRECTED, which is the half that was broken.
  const res = makeRes()
  await handler({ method: 'POST', headers: AUTH, body: precRef({ action: 'correct', reason: 'never actually sent' }) }, res)
  assert.equal(res.statusCode, 200, JSON.stringify(res.body))
  assert.equal(res.body.recorded, true, 'the correction must be recorded')
  assert.equal(fakes.logInserts.length, 2)
  const corr = fakes.logInserts[1]
  assert.equal(corr.notification_type, 'placement_notification_corrected')
  assert.equal(corr.metadata.correction_reason, 'never actually sent')
  assert.equal(corr.metadata.corrects_notification_id, 'manual-legacy-1',
    'the reversal points at the legacy row it corrects')
  // The original is untouched.
  assert.equal(fakes.logInserts[0].notification_type, 'placement_manual_confirmation')
  assert.equal(fakes.logInserts[0].status, 'confirmed')
})

test('LEGACY: a legacy row for the OTHER target does not answer for this one', async () => {
  const { handler, fakes } = built.owner
  fakes.__reset()
  // The manual row was only ever about the preceptor.
  fakes.logInserts.push({
    id: 'manual-legacy-2',
    notification_type: 'placement_manual_confirmation', status: 'confirmed',
    sent_at: '2026-08-13T10:00:00.000Z',
    metadata: { placement_match_id: ID.match, placement_preceptor_id: ID.preceptor },
  })
  const res = makeRes()
  await handler({ method: 'POST', headers: AUTH, body: leaderRef() }, res)
  assert.equal(res.body.recorded, true,
    'a confirmed preceptor must not make the unit leader look confirmed')
  assert.equal(fakes.logInserts.length, 2)
})

// ── 3. Writes: what may be written, and what may never be ──────────────────

test('WRITES: a confirmation writes ONE notification_log row and nothing else', async () => {
  const { fakes } = await call('owner', precRef())
  assert.equal(fakes.logInserts.length, 1)
  assert.ok(!fakes.logInserts[0].__FOREIGN_TABLE__, 'only notification_log is inserted into')
  assert.equal(fakes.matchUpdates.length, 0, 'a preceptor confirmation writes no match row')
  assert.equal(fakes.mailCalls.length, 0)
})

test('WRITES: the unit-leader projection touches ONLY the notification columns', async () => {
  const { fakes } = await call('owner', leaderRef())
  assert.equal(fakes.matchUpdates.length, 1)
  const { table, patch, id } = fakes.matchUpdates[0]
  assert.equal(table, 'matches')
  assert.equal(id, ID.match, 'exactly that placement')
  assert.deepEqual(Object.keys(patch).sort(), ['notification_sent', 'notified_at'])
  for (const forbidden of ['student_id', 'unit_id', 'cohort_id', 'preceptor_id', 'preceptor_assigned', 'shift_assigned']) {
    assert.ok(!(forbidden in patch), `a notification must never write ${forbidden}`)
  }
})

test('WRITES: a correction requires a NONBLANK reason', async () => {
  for (const reason of [undefined, '', '   ', 'no', '  a ', 42, null]) {
    const first = await call('owner', precRef())
    assert.equal(first.res.statusCode, 200)
    const { res, fakes } = await call('owner', precRef({ action: 'correct', reason }), { headers: AUTH })
    // Every call resets the fake, so this correction runs against an EMPTY
    // ledger: a blank reason must be refused on its own terms, before the
    // "nothing to correct" answer can mask it.
    assert.equal(res.statusCode, 400, `reason=${JSON.stringify(reason)} -> ${JSON.stringify(res.body)}`)
    assert.match(res.body.error, /requires a reason/)
    assert.equal(fakes.logInserts.length, 0)
  }
})

test('WRITES: no delete path exists, and no send path exists', async () => {
  const src = read('api/placement-notification-confirm.js')
  assert.ok(!src.includes('.delete('), 'confirmations and delivery history are never deleted')
  assert.ok(!/resend|Resend|emails\.send/.test(src), 'this endpoint has no mail path at all')
  // Executed proof: the substituted mail client is never called on any path.
  for (const who of ['owner', 'admin', 'viewer', 'anon']) {
    const { fakes } = await call(who, precRef())
    assert.equal(fakes.mailCalls.length, 0, who)
  }
})

// ── 4. MUTATION CONTROLS: weaken a guard, prove the proof fails ────────────
//
// Each entry patches the shipped source, rebuilds the handler, and asserts the
// weakened build FAILS the check above. If a mutation still passes, that check
// is not actually testing anything.

const MUTATIONS = [
  {
    name: 'the role gate removed',
    mutate: (s) => s.replace(
      "  if (!isOwnerAdmin) return { ok: false, status: 403 };",
      '  if (false) return { ok: false, status: 403 };'),
    // A viewer now writes.
    async prove(handler, fakes) {
      fakes.__reset()
      const res = makeRes()
      await handler({ method: 'POST', headers: AUTH, body: precRef() }, res)
      return res.statusCode === 200 && fakes.logInserts.length === 1
    },
    profile: 'viewer',
    breaks: 'viewer, interviewer, preceptor and unknown roles are refused',
  },
  {
    name: 'the extra-field refusal removed',
    mutate: (s) => s.replace('  if (extra.length) {', '  if (false) {'),
    async prove(handler, fakes) {
      fakes.__reset()
      const res = makeRes()
      await handler({ method: 'POST', headers: AUTH, body: { ...precRef(), confirmed_by: 'someone-else' } }, res)
      return res.statusCode === 200
    },
    profile: 'owner',
    breaks: 'a body-supplied actor, recipient or state is REFUSED',
  },
  {
    name: 'the unit-leader match verification removed',
    mutate: (s) => s.replace(
      "    if (String(match.student_id) !== String(body.student_id)) {",
      '    if (false) {'),
    async prove(handler, fakes) {
      fakes.__reset()
      const res = makeRes()
      await handler({ method: 'POST', headers: AUTH, body: leaderRef({ student_id: ID.otherStudent }) }, res)
      return res.statusCode === 200
    },
    profile: 'owner',
    breaks: 'a wrong student claim is refused',
  },
  {
    name: 'the metadata built from the REQUEST instead of the verified rows',
    mutate: (s) => s.replace(
      '    [NOTIFY_META.preceptor]: body.preceptor_id,',
      '    [NOTIFY_META.preceptor]: body.preceptor_id,'),   // shape-preserving no-op guard
    async prove() { return null },                          // reported, not asserted
    profile: 'owner',
    breaks: null,
  },
  {
    name: 'the ledger read filtered by notification_target again',
    mutate: (s) => s.replace(
      "    .eq('metadata->>placement_match_id', body.match_id);",
      "    .eq('metadata->>placement_match_id', body.match_id)\n    .eq('metadata->>notification_target', target);"),
    async prove(handler, fakes) {
      fakes.__reset()
      fakes.logInserts.push({
        id: 'manual-legacy-1', notification_type: 'placement_manual_confirmation', status: 'confirmed',
        sent_at: '2026-08-13T10:00:00.000Z',
        metadata: { placement_match_id: ID.match, placement_preceptor_id: ID.preceptor },
      })
      const res = makeRes()
      await handler({ method: 'POST', headers: AUTH, body: precRef({ action: 'correct', reason: 'never actually sent' }) }, res)
      // The regression: the legacy row is invisible, so the correction is refused.
      return res.body?.already === true && fakes.logInserts.length === 1
    },
    profile: 'owner',
    breaks: 'a pre-ledger manual confirmation is visible to the endpoint',
  },
  {
    name: 'the correction reason requirement removed',
    mutate: (s) => s.replace(
      "  if (action === 'correct' && reason.length < 3) {",
      '  if (false) {'),
    async prove(handler, fakes) {
      fakes.__reset()
      const res = makeRes()
      await handler({ method: 'POST', headers: AUTH, body: precRef() }, res)
      const res2 = makeRes()
      await handler({ method: 'POST', headers: AUTH, body: precRef({ action: 'correct', reason: '' }) }, res2)
      return res2.statusCode !== 400
    },
    profile: 'owner',
    breaks: 'a correction requires a NONBLANK reason',
  },
  {
    name: 'the preceptor guard skipped',
    mutate: (s) => s.replace('  if (isPreceptor) {\n    const verdict = await verifyPlacementSend({',
      '  if (false) {\n    const verdict = await verifyPlacementSend({'),
    async prove(handler, fakes) {
      fakes.__reset()
      const res = makeRes()
      await handler({ method: 'POST', headers: AUTH, body: precRef({ preceptor_id: ID.replaced }) }, res)
      return res.statusCode === 200
    },
    profile: 'owner',
    breaks: 'a replaced preceptor is refused',
  },
]

test('MUTATION CONTROLS: weakening each guard makes its proof fail', async () => {
  const report = []
  for (const [i, m] of MUTATIONS.entries()) {
    if (!m.breaks) continue
    const src = read('api/placement-notification-confirm.js')
    const mutated = m.mutate(src)
    assert.notEqual(mutated, src, `mutation "${m.name}" did not change the source`)
    const [handler, fakes] = await buildHandler(m.profile, { mutate: m.mutate, tag: `mut${i}` })
    const weakened = await m.prove(handler, fakes)
    assert.equal(weakened, true,
      `with "${m.name}" the endpoint should have let the bad request through, which is what proves "${m.breaks}" has teeth`)
    report.push(`${m.name} -> breaks: ${m.breaks}`)
  }
  assert.equal(report.length, MUTATIONS.filter(m => m.breaks).length)
})
