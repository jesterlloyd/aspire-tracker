// INTERVIEW-RUBRIC-WRITE-1
// Regression contract for the rubric save failure
//   "Could not find the 'can_edit' column of 'interview_rubrics' in the schema cache".
// The rubric rows RubricSession holds come from list_interview_rubrics_for_cohort, which
// appends can_view_details / can_edit / is_own. The auto-save and Mark Complete write the
// whole form, so every interview_rubrics write must pass toInterviewRubricWrite.
// Run: node --test test/interviewRubricWritePayload.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  INTERVIEW_RUBRIC_COLUMNS,
  INTERVIEW_RUBRIC_COMPUTED_KEYS,
  INTERVIEW_RUBRIC_SERVER_KEYS,
  toInterviewRubricWrite,
  toInterviewRubricInsert,
  resolveDraftRubricId,
} from '../src/lib/interviewRubricWrite.js'

const migrationPath = new URL('../supabase/migrations/20260822010000_interview_rubric_authorization.sql', import.meta.url)
const sessionPath = new URL('../src/components/RubricSession.jsx', import.meta.url)
const [migration, session] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(sessionPath, 'utf8'),
])

// The columns the RPC returns, read from its RETURNS TABLE clause.
function rpcReturnedColumns() {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.list_interview_rubrics_for_cohort(')
  assert.ok(start >= 0, 'expected the list_interview_rubrics_for_cohort definition')
  const block = migration.slice(start)
  const table = block.match(/RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE plpgsql/)
  assert.ok(table, 'expected a RETURNS TABLE clause')
  return table[1].split('\n').map(l => l.trim()).filter(Boolean).map(l => l.split(/\s+/)[0])
}

// A row shaped exactly as the RPC returns it, with a value for every column.
function rpcRow() {
  const row = {}
  for (const col of rpcReturnedColumns()) row[col] = `value:${col}`
  row.interviewer_profile_id = null
  row.can_view_details = true
  row.can_edit = true
  row.is_own = true
  return row
}

test('the write allowlist is exactly the RPC row minus its computed booleans', () => {
  const returned = rpcReturnedColumns()
  for (const key of INTERVIEW_RUBRIC_COMPUTED_KEYS) {
    assert.ok(returned.includes(key), `the RPC no longer returns ${key}; update INTERVIEW_RUBRIC_COMPUTED_KEYS`)
  }
  const expected = returned.filter(c => !INTERVIEW_RUBRIC_COMPUTED_KEYS.includes(c))
  assert.deepEqual([...INTERVIEW_RUBRIC_COLUMNS].sort(), expected.sort())
})

test('a whole RPC row written back drops the computed keys and keeps every column', () => {
  const written = toInterviewRubricWrite(rpcRow())
  for (const key of INTERVIEW_RUBRIC_COMPUTED_KEYS) assert.equal(key in written, false, `${key} must not be written`)
  for (const col of INTERVIEW_RUBRIC_COLUMNS) assert.ok(col in written, `${col} must survive the gate`)
  assert.equal(written.interviewer_profile_id, null, 'an explicit null identity is a real write and must survive')
  assert.equal(written.cj_score, 'value:cj_score')
})

test('unknown keys are dropped whatever they are, and the input is not mutated', () => {
  const input = { cj_score: 3, some_future_rpc_field: 'x', can_edit: false }
  const written = toInterviewRubricWrite(input)
  assert.deepEqual(written, { cj_score: 3 })
  assert.deepEqual(input, { cj_score: 3, some_future_rpc_field: 'x', can_edit: false })
  assert.deepEqual(toInterviewRubricWrite(undefined), {})
})

test('every field the session form starts with is a writable column', () => {
  const init = session.match(/const initForm = \(\) => \(\{([\s\S]*?)\n\}\)/)
  assert.ok(init, 'expected initForm in RubricSession')
  const keys = [...init[1].matchAll(/(\w+):/g)].map(m => m[1])
  assert.ok(keys.length >= 15, `expected the full initForm key set, saw ${keys.length}`)
  for (const key of keys) assert.ok(INTERVIEW_RUBRIC_COLUMNS.includes(key), `${key} is set by the form but not writable`)
})

test('every interview_rubrics write in RubricSession passes the gate', () => {
  // The three write gates are imported together; RUBRIC-RESUME-OWN-1 added ownership
  // helpers to the same line, so the pin covers the gates and tolerates the rest.
  assert.match(session, /import \{ toInterviewRubricWrite, toInterviewRubricInsert, resolveDraftRubricId,/)
  // persist: the shared payload is gated once, and the create path gates the whole spread.
  assert.match(session, /const payload = toInterviewRubricWrite\(\{\s*\.\.\.scopedUpdates,/)
  // The create seed grew across several lines when RUBRIC-SCHEDULE-1 taught it to take
  // the date and time from the booking; what this pins is that it still goes through the gate.
  assert.match(session, /\.insert\(toInterviewRubricInsert\(\{[\s\S]{0,400}?\.\.\.payload,?\s*\}\)\)/)
  assert.match(session, /\.update\(payload\)\.eq\('id', id\)/)
  // reset, unlock, and inline edit each gate their literal.
  const gatedUpdates = session.match(/\.update\(toInterviewRubricWrite\(/g) || []
  // reset, unlock, inline edit, and (RUBRIC-SCHEDULE-1) the snapshot mirrored onto the
  // rubric row after a successful reschedule.
  assert.equal(gatedUpdates.length, 4, 'every literal update must be gated')
  // No raw object literal reaches the table.
  assert.doesNotMatch(session, /from\('interview_rubrics'\)\s*\.update\(\{/)
  assert.doesNotMatch(session, /from\('interview_rubrics'\)\s*\.insert\(\{/)
})

test('the whole-form writers that carried the RPC row still exist and are the reason', () => {
  assert.match(session, /await persistRef\.current\(formRef\.current, false\)/)
  assert.match(session, /persist\(\{ \.\.\.form, status:'Completed', composite_score: composite \}, true\)/)
  assert.match(session, /setForm\(existing\); setRubricId\(existing\.id\); return/)
})

// INTERVIEW-RUBRIC-WRITE-2: a restored draft must adopt its row, and an insert must
// never carry a row identity ("duplicate key value violates unique constraint
// "interview_rubrics_pkey"").

test('an insert built from a whole form never carries id or created_at', () => {
  const written = toInterviewRubricInsert({ ...rpcRow(), student_id: 's1', cohort_id: 'c1' })
  for (const key of INTERVIEW_RUBRIC_SERVER_KEYS) assert.equal(key in written, false, `${key} must be left to the database`)
  for (const key of INTERVIEW_RUBRIC_COMPUTED_KEYS) assert.equal(key in written, false)
  assert.equal(written.student_id, 's1')
  assert.equal(written.cohort_id, 'c1')
  assert.equal(written.cj_score, 'value:cj_score')
  // The update gate still carries id: an update payload naming its own row is harmless.
  assert.equal(toInterviewRubricWrite({ id: 'r1' }).id, 'r1')
})

test('a draft adopts the rubric it came from only while that row still exists', () => {
  const rubrics = [{ id: 'r1', student_id: 's1' }, { id: 'r2', student_id: 's1' }]
  assert.equal(resolveDraftRubricId({ id: 'r2', cj_score: 3 }, rubrics), 'r2')
  assert.equal(resolveDraftRubricId({ id: 'gone', cj_score: 3 }, rubrics), null, 'a deleted row is not adopted')
  assert.equal(resolveDraftRubricId({ cj_score: 3 }, rubrics), null, 'a form with no id is a new rubric')
  assert.equal(resolveDraftRubricId(null, rubrics), null)
  assert.equal(resolveDraftRubricId({ id: 'r1' }, undefined), null)
})

test('the session adopts a draft row on restore and again at save time', () => {
  // The three write gates are imported together; RUBRIC-RESUME-OWN-1 added ownership
  // helpers to the same line, so the pin covers the gates and tolerates the rest.
  assert.match(session, /import \{ toInterviewRubricWrite, toInterviewRubricInsert, resolveDraftRubricId,/)
  // Restore: the id is restored beside the form.
  assert.match(session, /const draftRubricId = resolveDraftRubricId\(draft\.formState, rubrics\)\s*if \(draftRubricId\) setRubricId\(draftRubricId\)/)
  // Save: any path that seeded the form without rubricId resolves the row before choosing insert.
  assert.match(session, /let id = rubricId \|\| resolveDraftRubricId\(form, studentRubrics\)\s*if \(id && !rubricId\) setRubricId\(id\)/)
  // No insert on the table bypasses the insert gate.
  assert.doesNotMatch(session, /from\('interview_rubrics'\)\s*\.insert\(toInterviewRubricWrite\(/)
})

test('the existing-rubrics banner does not call an in-progress row submitted', () => {
  // RUBRIC-RESUME-OWN-1: the banner now reports OTHER people's rubrics, because your
  // own is the form on screen. It still must never call an unfinished row submitted.
  assert.match(session, /const submitted  = others\.filter\(r => r\.status === 'Completed'\)\.length/)
  assert.match(session, /const unfinished = others\.filter\(r => r\.status !== 'Completed'\)/)
  assert.match(session, /rubric\$\{unfinished\.length !== 1 \? 's' : ''\} in progress/)
  assert.doesNotMatch(session, /studentRubrics\.length - submitted/,
    'the in-progress count no longer includes the reader\'s own row')
})
