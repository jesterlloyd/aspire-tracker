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
  toInterviewRubricWrite,
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
  assert.match(session, /import \{ toInterviewRubricWrite \} from '\.\.\/lib\/interviewRubricWrite'/)
  // persist: the shared payload is gated once, and the create path gates the whole spread.
  assert.match(session, /const payload = toInterviewRubricWrite\(\{\s*\.\.\.scopedUpdates,/)
  assert.match(session, /\.insert\(toInterviewRubricWrite\(\{ student_id: student\.id, cohort_id: cohortId, \.\.\.initForm\(\), \.\.\.form, \.\.\.payload \}\)\)/)
  assert.match(session, /\.update\(payload\)\.eq\('id', id\)/)
  // reset, unlock, and inline edit each gate their literal.
  const gatedUpdates = session.match(/\.update\(toInterviewRubricWrite\(/g) || []
  assert.equal(gatedUpdates.length, 3, 'reset, unlock, and inline edit must each be gated')
  // No raw object literal reaches the table.
  assert.doesNotMatch(session, /from\('interview_rubrics'\)\s*\.update\(\{/)
  assert.doesNotMatch(session, /from\('interview_rubrics'\)\s*\.insert\(\{/)
})

test('the whole-form writers that carried the RPC row still exist and are the reason', () => {
  assert.match(session, /await persistRef\.current\(formRef\.current, false\)/)
  assert.match(session, /persist\(\{ \.\.\.form, status:'Completed', composite_score: composite \}, true\)/)
  assert.match(session, /setForm\(existing\); setRubricId\(existing\.id\); return/)
})
