// STUDENT-EMAIL-LIFECYCLE-1 (Owner, 2026-09-30): supersedes the no-fallback,
// status-only and legacy Hired-label rules. Preceptor identity tests remain intact.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveReminderRecipient, RECIPIENT_REASONS } from '../lib/server/evaluation/reminderRecipient.js'
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const student = (over = {}) => ({
  id: 's-1', first_name: 'Ava', last_name: 'Wong', status: 'Completed',
  school_email: 'ava@school.example', personal_email: 'ava@personal.example',
  rotation: { rotation_end_date: '2026-09-01' }, ...over,
})
const assignment = (over = {}) => ({ respondent_type: 'student', ...over })
function makeDb() {
  const queries = []
  return { queries, db: { from(table) { queries.push({ table }); throw new Error('Unexpected lookup') } }, authAdmin: {} }
}
const resolve = s => resolveReminderRecipient({ assignment: assignment(), student: s, now: '2026-09-30T12:00:00Z' })
test('reminders switch only after both completion and the rotation end date', async () => {
  for (const status of ['Placed', 'Interviewed', 'Active Rotation']) assert.equal((await resolve(student({ status }))).route, 'school')
  assert.equal((await resolve(student())).route, 'personal')
  assert.equal((await resolve(student({ rotation: null }))).route, 'school')
  assert.equal((await resolve(student({ rotation: { rotation_end_date: '2026-09-30' } }))).route, 'school')
})
test('missing or invalid preferred addresses fall back and visibly report it', async () => {
  const school = await resolve(student({ personal_email: 'invalid' }))
  assert.equal(school.route, 'school')
  assert.equal(school.fallbackUsed, true)
  assert.match(school.warning, /Personal email missing or invalid/)
  const personal = await resolve(student({ status: 'Placed', school_email: '' }))
  assert.equal(personal.route, 'personal')
  assert.match(personal.warning, /School email missing or invalid/)
  assert.equal((await resolve(student({ personal_email: '', school_email: 'bad' }))).ok, false)
  assert.equal((await resolve(null)).reason, RECIPIENT_REASONS.STUDENT_NOT_FOUND)
})
test('hired residents use their residency-record Cedars address, then personal, never school', async () => {
  const outcome = { hired_at: '2026-09-20', separated_at: null, cs_email: 'ava@cshs.org' }
  const s = student({ status: 'Active Rotation', residency_outcomes: [outcome] })
  assert.equal((await resolve(s)).route, 'cedars')
  const fallback = await resolve({ ...s, residency_outcomes: [{ ...outcome, cs_email: '' }] })
  assert.equal(fallback.route, 'personal')
  assert.equal(fallback.fallbackUsed, true)
  assert.equal((await resolve({ ...s, personal_email: '', residency_outcomes: [{ ...outcome, cs_email: '' }] })).reason, RECIPIENT_REASONS.MISSING_RESIDENCY_EMAIL)
  assert.equal((await resolve({ ...s, residency_outcomes: [{ ...outcome, separated_at: '2026-09-25' }] })).route, 'school')
  assert.equal((await resolve(student({ status: 'Placed', ngrp_outcome: 'Hired' }))).route, 'school')
})

// ── Preceptor identity cannot drift ─────────────────────────────────────────

test('a preceptor reminder goes to the ASSIGNMENT SNAPSHOT, not the current preceptor', async () => {
  const { db, authAdmin, queries } = makeDb()
  const r = await resolveReminderRecipient({
    db, authAdmin,
    assignment: assignment({
      respondent_type: 'preceptor',
      respondent_email: 'asked.preceptor@example.org',
      respondent_name: 'Dana Whitfield',
    }),
    // A different preceptor is now on file for this student. It must be ignored.
    student: student({ preceptor_email: 'new.preceptor@example.org', preceptor_id: 'p-999' }),
  })
  assert.equal(r.ok, true)
  assert.equal(r.email, 'asked.preceptor@example.org')
  assert.equal(r.name, 'Dana Whitfield')
  assert.equal(r.route, 'preceptor_snapshot')
  const tables = queries.map(q => q.table)
  assert.ok(!tables.includes('preceptors'), 'the preceptors table must not be consulted')
  assert.ok(!tables.includes('student_preceptor_assignments'), 'nor the assignment table')
})

test('a preceptor snapshot without a usable address sends nothing', async () => {
  const { db, authAdmin } = makeDb()
  for (const email of [null, '', '   ', 'not-an-email']) {
    const r = await resolveReminderRecipient({
      db, authAdmin, assignment: assignment({ respondent_type: 'preceptor', respondent_email: email }), student: null,
    })
    assert.equal(r.ok, false, String(email))
    assert.equal(r.reason, RECIPIENT_REASONS.MISSING_PRECEPTOR_SNAPSHOT_EMAIL, String(email))
  }
})

// ── No unit-leader fan-out is invented ──────────────────────────────────────

test('NO UNIT-LEADER AUDIENCE EXISTS: an unknown respondent type is refused', async () => {
  const { db, authAdmin, queries } = makeDb()
  for (const respondent_type of ['unit_leader', 'staff', '', null, undefined]) {
    const r = await resolveReminderRecipient({
      db, authAdmin, assignment: assignment({ respondent_type }), student: student(),
    })
    assert.equal(r.ok, false, String(respondent_type))
    assert.equal(r.reason, RECIPIENT_REASONS.UNSUPPORTED_RESPONDENT_TYPE, String(respondent_type))
  }
  assert.equal(queries.length, 0, 'no lookup of any kind is attempted for an unsupported respondent')
})

test('the reminder modules never read unit membership to build an audience', () => {
  for (const f of [
    'lib/server/evaluation/reminderRecipient.js',
    'lib/server/evaluation/reminderSend.js',
    'api/cron/evaluation-reminders.js',
  ]) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const table of ['user_unit_scopes', 'units', 'unit_leaders']) {
      assert.doesNotMatch(code, new RegExp(`from\\('${table}'\\)`),
        `${f} must not query ${table} - a unit-leader audience would be invented, not found`)
    }
  }
})

test('the schema itself cannot express a unit-leader respondent', () => {
  const sql = read('supabase/migrations/20260613000000_ps2a_add_evaluation_assignment_respondent_identity.sql')
  assert.match(sql, /respondent_type IN \('student', ?'preceptor'\)/,
    'respondent_type is CHECK-constrained to student|preceptor, so no such assignment can exist')
})
