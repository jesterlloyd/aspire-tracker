// test/placementExceptionPath.test.mjs
//
// PLACEMENT-POOL-READINESS-1 - final placement-path corrections.
//
// These are BEHAVIORAL tests, not source-string pins. createMatch lives inside
// the App component and cannot be imported, so each test extracts the REAL
// createMatch source out of src/App.jsx and executes it with injected fakes.
// Nothing here re-implements the handler: if the shipped code changes
// semantics, these tests change result. The two defects under test are:
//
//   1. FALSE AUDIT. The placement_exception_confirmed entry used to be written
//      BEFORE the matches insert, so a failed insert left an activity record
//      claiming a placement that never happened.
//
//   2. FABRICATED INTERVIEW OUTCOME. The handler always wrote
//      interview_outcome: 'Recommend'. For an approved PRE-interview exception
//      there is no interview, so that invented an outcome nobody recorded.
//
// The extraction is deliberately strict: if the declaration or the closing
// brace cannot be found, the test fails loudly rather than silently proving
// nothing.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const DECL = 'const createMatch = async (student, unit, options = {}) => {'

/** Pull the real createMatch out of App.jsx and make it callable. */
function loadCreateMatch(deps) {
  const src = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
  const start = src.indexOf(DECL)
  assert.notEqual(start, -1, 'createMatch declaration not found - update DECL')
  // The handler is declared at two-space indent inside the component, so its
  // closing brace is the first "\n  }" after the declaration.
  const end = src.indexOf('\n  }\n', start)
  assert.notEqual(end, -1, 'createMatch closing brace not found')
  const fnSrc = src.slice(start, end + 4)
  assert.ok(fnSrc.includes('matches').valueOf(), 'extracted body looks wrong')

  const names = Object.keys(deps)
  // eslint-disable-next-line no-new-func
  const factory = new Function(...names, `${fnSrc}\nreturn createMatch`)
  return factory(...names.map(n => deps[n]))
}

const STUDENT_INTERVIEWED = {
  id: 'stu-1', first_name: 'Ada', last_name: 'Interviewed',
  status: 'Interviewed', interview_outcome: 'Recommend',
  unit_preference_1: 'PACU',
}
const STUDENT_PRE_INTERVIEW = {
  id: 'stu-2', first_name: 'Fay', last_name: 'Pending',
  status: 'Pending Outreach', interview_outcome: 'Pending Interview',
  unit_preference_1: 'PACU',
}
const UNIT = { id: 'unit-1', unit_name: 'PACU', total_slots: 3 }

/**
 * Build a fake environment. matchInsertFails=true makes the matches insert
 * return an error exactly the way safeWrite surfaces one.
 */
function harness({ matchInsertFails = false } = {}) {
  const calls = {
    activity: [], studentUpdates: [], unitUpdates: [], toasts: [],
    events: [], localStudents: null, tables: [],
  }
  const students = [STUDENT_INTERVIEWED, STUDENT_PRE_INTERVIEW].map(s => ({ ...s }))

  const supabase = {
    from(table) {
      calls.tables.push(table)
      return {
        insert: () => ({
          select: () => ({
            single: async () => matchInsertFails
              ? { data: null, error: { message: 'insert failed' } }
              : { data: { id: 'match-1', student_id: 'x', unit_id: UNIT.id }, error: null },
          }),
        }),
        update(payload) {
          if (table === 'students') calls.studentUpdates.push(payload)
          if (table === 'units') calls.unitUpdates.push(payload)
          return { eq: async () => ({ data: null, error: null }) }
        },
      }
    },
  }

  const deps = {
    activeCohortId: 'cohort-1',
    matches: [],
    currentUserProfile: { full_name: 'QC Owner' },
    supabase,
    // safeWrite just runs the thunk, preserving its {data,error} shape.
    safeWrite: async (fn) => fn(),
    logActivity: (entry) => calls.activity.push(entry),
    logEvent: async (_c, e) => calls.events.push(e),
    eventExists: async () => false,
    toast: {
      warning: (t, b) => calls.toasts.push({ kind: 'warning', t, b }),
      success: (t, b) => calls.toasts.push({ kind: 'success', t, b }),
      error: (t, b) => calls.toasts.push({ kind: 'error', t, b }),
    },
    updateCohortMatchSummary: () => {},
    setMatches: () => {},
    setUnits: () => {},
    setStudents: (fn) => { calls.localStudents = fn(students) },
    console: { error: () => {}, warn: () => {}, log: () => {} },
  }

  return { calls, deps, createMatch: loadCreateMatch(deps) }
}

const exceptionLogs = calls =>
  calls.activity.filter(a => a.actionType === 'placement_exception_confirmed')

// ─── 1. No false exception audit ────────────────────────────────────────────

test('a FAILED match insert writes no successful-placement exception log', async () => {
  const { calls, createMatch } = harness({ matchInsertFails: true })
  await createMatch(STUDENT_PRE_INTERVIEW, UNIT, { placementException: true })

  assert.equal(exceptionLogs(calls).length, 0,
    'no activity entry may claim a placement that never happened')
  // Nothing downstream ran either - the handler returned at the insert error.
  assert.deepEqual(calls.studentUpdates, [], 'no student write after a failed insert')
  assert.deepEqual(calls.unitUpdates, [], 'no unit write after a failed insert')
  assert.equal(calls.activity.length, 0, 'and no student_matched entry either')
  assert.equal(calls.localStudents, null, 'local state untouched')
})

test('a SUCCESSFUL exception placement writes the audit, with full context', async () => {
  const { calls, createMatch } = harness()
  await createMatch(STUDENT_PRE_INTERVIEW, UNIT, { placementException: true })

  const logs = exceptionLogs(calls)
  assert.equal(logs.length, 1, 'exactly one exception entry')
  const e = logs[0]
  // Acting user, student, unit, original status, exception metadata.
  assert.equal(e.userProfile.full_name, 'QC Owner')
  assert.equal(e.entityId, STUDENT_PRE_INTERVIEW.id)
  assert.equal(e.cohortId, 'cohort-1')
  assert.equal(e.metadata.unit_id, UNIT.id)
  assert.equal(e.metadata.unit_name, 'PACU')
  assert.equal(e.metadata.status_at_placement, 'Pending Outreach',
    'the ORIGINAL status, not the post-placement one')
  assert.match(e.description, /Fay Pending/)
  assert.match(e.description, /PACU/)
  assert.match(e.description, /approved exception/)
})

test('the audit is ordered AFTER the match insert, never before', async () => {
  // Negative control for the ordering itself: with the insert failing, the
  // handler must exit before ever reaching the audit. Proven above. Here the
  // structural guarantee is pinned so the call cannot drift back upward.
  const src = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
  const body = src.slice(src.indexOf(DECL), src.indexOf('\n  }\n', src.indexOf(DECL)))
  const insertAt = body.indexOf("from('matches').insert")
  const guardAt = body.indexOf('if (error) { console.error(error); return }')
  const auditAt = body.indexOf("actionType: 'placement_exception_confirmed'")
  assert.ok(insertAt > -1 && guardAt > -1 && auditAt > -1, 'anchors still present')
  assert.ok(insertAt < guardAt && guardAt < auditAt,
    'the exception audit must come after the insert AND after its error guard')
})

// ─── 2. No fabricated interview outcome ─────────────────────────────────────

test('exception placement sets unit and Placed but PRESERVES interview_outcome', async () => {
  const { calls, createMatch } = harness()
  await createMatch(STUDENT_PRE_INTERVIEW, UNIT, { placementException: true })

  assert.equal(calls.studentUpdates.length, 1)
  const patch = calls.studentUpdates[0]
  assert.equal(patch.matched_unit_id, UNIT.id, 'the unit is still set')
  assert.equal(patch.status, 'Placed', 'the status is still Placed')
  assert.equal(patch.match_quality, 'top_choice')
  assert.ok(!('interview_outcome' in patch),
    'interview_outcome must be absent so the stored value is preserved exactly')

  // And the LOCAL projection must not reintroduce it.
  const local = calls.localStudents.find(s => s.id === STUDENT_PRE_INTERVIEW.id)
  assert.equal(local.interview_outcome, 'Pending Interview',
    'local state keeps the original outcome, matching the database')
  assert.equal(local.status, 'Placed')
  assert.equal(local.matched_unit_id, UNIT.id)
})

test('ordinary Interviewed placement still writes Recommend', async () => {
  const { calls, createMatch } = harness()
  await createMatch(STUDENT_INTERVIEWED, UNIT)

  const patch = calls.studentUpdates[0]
  assert.equal(patch.interview_outcome, 'Recommend',
    'the normal path is unchanged')
  assert.equal(patch.status, 'Placed')
  const local = calls.localStudents.find(s => s.id === STUDENT_INTERVIEWED.id)
  assert.equal(local.interview_outcome, 'Recommend')
  // A normal placement is not an exception, so it logs no exception entry.
  assert.equal(exceptionLogs(calls).length, 0)
})

test('an unconfirmed pre-interview placement (cancel) changes nothing at all', async () => {
  const { calls, createMatch } = harness()
  // No placementException flag - this is what Cancel leaves behind: the
  // handler is either never called, or called without the confirmation.
  await createMatch(STUDENT_PRE_INTERVIEW, UNIT)

  assert.equal(calls.toasts.filter(t => t.t === 'Interview required').length, 1,
    'the interview guard still rejects it')
  assert.deepEqual(calls.tables, [], 'no table was touched at all')
  assert.deepEqual(calls.studentUpdates, [])
  assert.equal(calls.activity.length, 0, 'no exception log for a rejected placement')
  assert.equal(calls.localStudents, null, 'local state untouched')
})

test('the exception flag cannot promote an already-Interviewed student', async () => {
  // Guards against the flag being read as a blanket override: an Interviewed
  // student is the NORMAL path and must still get Recommend, plus no audit.
  const { calls, createMatch } = harness()
  await createMatch(STUDENT_INTERVIEWED, UNIT, { placementException: true })

  assert.equal(calls.studentUpdates[0].interview_outcome, 'Recommend')
  assert.equal(exceptionLogs(calls).length, 0,
    'no exception was needed, so none is recorded')
})

test('a failed insert on the ORDINARY path also writes nothing', async () => {
  const { calls, createMatch } = harness({ matchInsertFails: true })
  await createMatch(STUDENT_INTERVIEWED, UNIT)

  assert.deepEqual(calls.studentUpdates, [])
  assert.deepEqual(calls.unitUpdates, [])
  assert.equal(calls.activity.length, 0)
  assert.equal(calls.localStudents, null)
})
