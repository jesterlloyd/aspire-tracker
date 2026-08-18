// PLACEMENT-COMMUNICATION-HANDOFF-1A - the placement authorization guard.
//
// BEHAVIORAL. Every test runs the REAL verifyPlacementSend against a fake
// Supabase client backed by in-memory rows, so what is exercised is the shipped
// decision logic, not a description of it. Nothing here can send an email: the
// guard never touches a mail provider, and it is the gate that decides whether
// the endpoint reaches one at all.
//
// The shape of these tests is deliberately adversarial. A payload arrives from a
// browser claiming a placement; each case tampers with one part of that claim and
// asserts the send is refused with the reason that names the disagreement.
//
// Run: node --test test/placementSendGuard.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'

const { verifyPlacementSend } = await import('../api/lib/placementSendGuard.js')
const { PLACEMENT_META } = await import('../src/lib/placementPreceptorSent.js')

// ── Identifiers (real UUIDs - the guard validates their shape) ───────────────
const COHORT_A = 'aaaaaaaa-0000-4000-8000-00000000000a'
const COHORT_B = 'aaaaaaaa-0000-4000-8000-00000000000b'
const STU_ANA  = 'bbbbbbbb-0000-4000-8000-00000000000a'
const STU_BEN  = 'bbbbbbbb-0000-4000-8000-00000000000b'
const UNIT_ONE = 'cccccccc-0000-4000-8000-000000000001'
const UNIT_TWO = 'cccccccc-0000-4000-8000-000000000002'
const PREC_DANA = 'dddddddd-0000-4000-8000-00000000000d'
const PREC_SAM  = 'dddddddd-0000-4000-8000-00000000000e'
const MATCH_1  = 'eeeeeeee-0000-4000-8000-000000000001'
const MATCH_2  = 'eeeeeeee-0000-4000-8000-000000000002'
const MATCH_RECREATED = 'eeeeeeee-0000-4000-8000-000000000003'

const DANA_EMAIL = 'Dana.Reyes@example.org'
const SAM_EMAIL  = 'sam@example.org'

// ── A fake Supabase client, only as capable as the guard actually uses ───────
//
// It supports .from().select().eq().in().maybeSingle() and awaiting the builder,
// and can be told to fail a specific table so the unreadable-table paths are
// exercised rather than assumed.
function makeDb(tables, { failTable = null } = {}) {
  const reads = []
  return {
    reads,
    from(table) {
      const filters = []
      let inFilter = null
      const api = {
        select() { return api },
        eq(col, val) { filters.push([col, val]); return api },
        in(col, vals) { inFilter = [col, vals]; return api },
        async maybeSingle() { return api._run(true) },
        async single() { return api._run(true) },
        then(resolve, reject) { return api._run(false).then(resolve, reject) },
        async _run(single) {
          reads.push(table)
          if (failTable === table) return { data: null, error: { message: 'boom' } }
          let rows = (tables[table] || []).slice()
          for (const [col, val] of filters) rows = rows.filter(r => String(r[col] ?? '') === String(val))
          if (inFilter) {
            const set = new Set(inFilter[1].map(String))
            rows = rows.filter(r => set.has(String(r[inFilter[0]])))
          }
          return { data: single ? (rows[0] ?? null) : rows, error: null }
        },
      }
      return api
    },
  }
}

// The world as it really stands: Ana is placed on Unit One with Dana.
const WORLD = () => ({
  matches: [
    { id: MATCH_1, student_id: STU_ANA, unit_id: UNIT_ONE, cohort_id: COHORT_A, preceptor_id: PREC_DANA, preceptor_assigned: 'Dana Reyes' },
  ],
  students: [
    { id: STU_ANA, cohort_id: COHORT_A, preceptor_id: PREC_DANA, matched_preceptor: 'Dana Reyes', preceptor_email: DANA_EMAIL, shift_assigned: 'Night' },
    { id: STU_BEN, cohort_id: COHORT_A, preceptor_id: PREC_SAM, matched_preceptor: 'Sam Ortiz', preceptor_email: SAM_EMAIL, shift_assigned: 'Day' },
  ],
  units: [
    { id: UNIT_ONE, cohort_id: COHORT_A, unit_name: '5 SCCT' },
    { id: UNIT_TWO, cohort_id: COHORT_A, unit_name: '6 ICU' },
  ],
  preceptors: [
    { id: PREC_DANA, full_name: 'Dana Reyes', email: DANA_EMAIL, shift_type: 'Night', is_active: true },
    { id: PREC_SAM, full_name: 'Sam Ortiz', email: SAM_EMAIL, shift_type: 'Day', is_active: true },
  ],
})

const TRUE_REF = {
  match_id: MATCH_1, student_id: STU_ANA, unit_id: UNIT_ONE,
  cohort_id: COHORT_A, preceptor_id: PREC_DANA,
}

const run = (ref, opts = {}) => verifyPlacementSend({
  db: makeDb(opts.tables || WORLD(), { failTable: opts.failTable }),
  ref,
  recipientType: opts.recipientType || 'contact',
  recipientEmail: opts.recipientEmail || DANA_EMAIL,
})

// ── The honest case ─────────────────────────────────────────────────────────

test('a truthful placement is accepted and stamped from the DATABASE rows', async () => {
  const v = await run(TRUE_REF)
  assert.equal(v.ok, true, v.error)
  assert.deepEqual(v.metadata, {
    [PLACEMENT_META.template]: 'preceptor_assignment',
    [PLACEMENT_META.student]: STU_ANA,
    [PLACEMENT_META.unit]: UNIT_ONE,
    [PLACEMENT_META.preceptor]: PREC_DANA,
    [PLACEMENT_META.cohort]: COHORT_A,
    [PLACEMENT_META.match]: MATCH_1,
  })
  assert.equal(v.verified.matchId, MATCH_1)
})

test('the recipient address is matched case- and whitespace-insensitively', async () => {
  const v = await run(TRUE_REF, { recipientEmail: '  DANA.reyes@EXAMPLE.org ' })
  assert.equal(v.ok, true, v.error)
})

// ── Payload tampering: every claim is disproved independently ────────────────

test('NEGATIVE CONTROL: a tampered STUDENT id is refused', async () => {
  const v = await run({ ...TRUE_REF, student_id: STU_BEN })
  assert.equal(v.ok, false)
  assert.equal(v.code, 'student_mismatch')
  assert.equal(v.status, 409)
  assert.match(v.error, /different student/)
  assert.equal(v.metadata, null)
})

test('NEGATIVE CONTROL: a tampered UNIT id is refused', async () => {
  const v = await run({ ...TRUE_REF, unit_id: UNIT_TWO })
  assert.equal(v.ok, false)
  assert.equal(v.code, 'unit_mismatch')
})

test('NEGATIVE CONTROL: a CROSS-COHORT claim is refused', async () => {
  const v = await run({ ...TRUE_REF, cohort_id: COHORT_B })
  assert.equal(v.ok, false)
  assert.equal(v.code, 'cohort_mismatch')
  assert.match(v.error, /different cohort/)
})

test('NEGATIVE CONTROL: a tampered PRECEPTOR id is refused', async () => {
  const v = await run({ ...TRUE_REF, preceptor_id: PREC_SAM }, { recipientEmail: SAM_EMAIL })
  assert.equal(v.ok, false)
  assert.equal(v.code, 'preceptor_changed')
  assert.match(v.error, /has changed/)
})

test('NEGATIVE CONTROL: a WRONG RECIPIENT is refused even when the placement is true', async () => {
  // Every id is correct; the message is simply addressed to somebody else.
  const v = await run(TRUE_REF, { recipientEmail: SAM_EMAIL })
  assert.equal(v.ok, false)
  assert.equal(v.code, 'recipient_mismatch')
  assert.match(v.error, /someone other than the placement’s assigned preceptor/)
})

test('NEGATIVE CONTROL: a STUDENT recipient can never be a placement preceptor', async () => {
  const v = await run(TRUE_REF, { recipientType: 'student' })
  assert.equal(v.ok, false)
  assert.equal(v.code, 'recipient_type')
})

// ── Staleness: the world moved while the draft sat open ─────────────────────

test('a DELETED placement is refused, and the message names the cause', async () => {
  const world = WORLD()
  world.matches = []                       // unmatched while the draft was open
  const v = await run(TRUE_REF, { tables: world })
  assert.equal(v.ok, false)
  assert.equal(v.code, 'match_missing')
  assert.match(v.error, /no longer exists/)
})

test('a RECREATED placement is a different placement, and the stale id fails', async () => {
  const world = WORLD()
  // Same student, same unit, same preceptor - but rematched, so a new row.
  world.matches = [{ ...world.matches[0], id: MATCH_RECREATED }]
  const stale = await run(TRUE_REF, { tables: world })
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'match_missing', 'the OLD match id must not resolve to the new row')

  // And the new placement verifies on its own terms, stamped with its own id.
  const fresh = await run({ ...TRUE_REF, match_id: MATCH_RECREATED }, { tables: world })
  assert.equal(fresh.ok, true, fresh.error)
  assert.equal(fresh.metadata[PLACEMENT_META.match], MATCH_RECREATED,
    'so the recreated placement can never inherit the deleted one’s record')
})

test('a REPLACED preceptor is refused with the stale preceptor id', async () => {
  const world = WORLD()
  world.matches[0].preceptor_id = PREC_SAM       // reassigned after the handoff
  world.students[0].preceptor_id = PREC_SAM
  const v = await run(TRUE_REF, { tables: world })
  assert.equal(v.ok, false)
  assert.equal(v.code, 'preceptor_changed')
})

test('a placement with NO assigned preceptor is refused', async () => {
  const world = WORLD()
  world.matches[0].preceptor_id = null
  world.matches[0].preceptor_assigned = ''
  world.students[0].preceptor_id = null
  world.students[0].matched_preceptor = ''
  const v = await run(TRUE_REF, { tables: world })
  assert.equal(v.ok, false)
  assert.equal(v.code, 'preceptor_unassigned')
})

// ── The multi-placement rule survives into the server ───────────────────────

test('a MULTI-UNIT student cannot borrow the student-level preceptor', async () => {
  const world = WORLD()
  // Ana now holds two placements. The second names nobody; the student-level
  // field still says Dana, who belongs to the first.
  world.matches.push({
    id: MATCH_2, student_id: STU_ANA, unit_id: UNIT_TWO, cohort_id: COHORT_A,
    preceptor_id: null, preceptor_assigned: '',
  })
  const v = await run({ ...TRUE_REF, match_id: MATCH_2, unit_id: UNIT_TWO }, { tables: world })
  assert.equal(v.ok, false)
  assert.equal(v.code, 'preceptor_unassigned',
    'the empty second placement must not resolve to the first placement’s preceptor')

  // The first placement still verifies.
  const first = await run(TRUE_REF, { tables: world })
  assert.equal(first.ok, true, first.error)
})

test('a SINGLE-placement student may still use the student-level preceptor', async () => {
  const world = WORLD()
  world.matches[0].preceptor_id = null      // the match names nobody...
  world.matches[0].preceptor_assigned = ''  // ...but this is the only placement
  const v = await run(TRUE_REF, { tables: world })
  assert.equal(v.ok, true, v.error)
  assert.equal(v.metadata[PLACEMENT_META.preceptor], PREC_DANA)
})

// ── Malformed and incomplete claims fail closed ─────────────────────────────

test('an incomplete reference fails closed rather than attributing anything', async () => {
  for (const key of ['match_id', 'student_id', 'unit_id', 'cohort_id', 'preceptor_id']) {
    const v = await run({ ...TRUE_REF, [key]: '' })
    assert.equal(v.ok, false, `${key} missing must fail`)
    assert.equal(v.metadata, null)
    assert.match(v.error, /incomplete/)
  }
  const none = await verifyPlacementSend({ db: makeDb(WORLD()), ref: null, recipientType: 'contact', recipientEmail: DANA_EMAIL })
  assert.equal(none.ok, false)
})

test('a non-UUID id is refused rather than queried', async () => {
  const v = await run({ ...TRUE_REF, match_id: "' OR 1=1 --" })
  assert.equal(v.ok, false)
  assert.equal(v.code, 'match_id_invalid')
})

// ── An unreadable database refuses the send; it never guesses ───────────────

test('every unreadable table fails CLOSED, not open', async () => {
  const cases = [
    ['matches', 'match_unreadable'],
    ['students', 'student_unreadable'],
    ['units', 'unit_unreadable'],
    ['preceptors', 'preceptors_unreadable'],
  ]
  for (const [table, code] of cases) {
    const v = await run(TRUE_REF, { failTable: table })
    assert.equal(v.ok, false, `${table} unreadable must refuse`)
    assert.equal(v.status, 503)
    assert.match(v.error, /nothing was sent/i)
    // NEGATIVE CONTROL: it must not fall through to a successful, unstamped send.
    assert.equal(v.metadata, null)
  }
})

// ── Cross-cohort integrity beyond the claim itself ──────────────────────────

test('a student who is not in the placement’s cohort is refused', async () => {
  const world = WORLD()
  world.students[0].cohort_id = COHORT_B
  const v = await run(TRUE_REF, { tables: world })
  assert.equal(v.ok, false)
  assert.equal(v.code, 'student_cohort_mismatch')
})

test('a unit that belongs to another cohort is refused', async () => {
  const world = WORLD()
  world.units[0].cohort_id = COHORT_B
  const v = await run(TRUE_REF, { tables: world })
  assert.equal(v.ok, false)
  assert.equal(v.code, 'unit_cohort_mismatch')
})

test('a missing student or unit row is refused', async () => {
  const noStudent = WORLD(); noStudent.students = []
  assert.equal((await run(TRUE_REF, { tables: noStudent })).code, 'student_missing')
  const noUnit = WORLD(); noUnit.units = []
  assert.equal((await run(TRUE_REF, { tables: noUnit })).code, 'unit_missing')
})

test('a preceptor with no email on file is refused', async () => {
  const world = WORLD()
  world.preceptors[0].email = ''
  const v = await run(TRUE_REF, { tables: world })
  assert.equal(v.ok, false)
  assert.equal(v.code, 'preceptor_no_email')
})

// ── The guard reads only what it needs, and writes nothing ──────────────────

test('the guard performs NO writes at all', async () => {
  const src = await import('node:fs').then(fs =>
    fs.readFileSync(new URL('../api/lib/placementSendGuard.js', import.meta.url), 'utf8'))
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const write of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
    assert.ok(!code.includes(write), `the guard must not ${write}`)
  }
  assert.ok(!/resend|Resend/.test(code), 'and must not know about the mail provider')
})

test('it reads exactly the tables the guarantees require', async () => {
  const db = makeDb(WORLD())
  await verifyPlacementSend({ db, ref: TRUE_REF, recipientType: 'contact', recipientEmail: DANA_EMAIL })
  assert.deepEqual([...new Set(db.reads)].sort(),
    ['matches', 'preceptors', 'students', 'units'])
})
