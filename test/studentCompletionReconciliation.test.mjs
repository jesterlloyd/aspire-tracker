// Canonical student completion policy and scheduling guards.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const sql = read('supabase/migrations/20260821130000_automatic_student_completion.sql')
const cron = read('api/cron/student-completion-reconciliation.js')
const sidePanel = read('src/components/StudentSidePanel.jsx')
const app = read('src/App.jsx')
const vercel = JSON.parse(read('vercel.json'))

test('the database function owns the canonical Active Rotation to Completed transition', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.reconcile_student_completions/)
  assert.match(sql, /WHERE s\.status = 'Active Rotation'/)
  assert.match(sql, /SET status = 'Completed'/)
  assert.match(sql, /rotation_completed_at = COALESCE\(s\.rotation_completed_at, v_now\)/)
  assert.match(sql, /AND s\.status = 'Active Rotation'/,
    'the conditional update must remain race-safe and never overwrite another terminal state')
})

test('completion fails closed on the official school-specific rotation evidence', () => {
  const executableSql = sql.replace(/--[^\n]*/g, '')
  assert.match(sql, /JOIN public\.cohort_school_rotations r/)
  assert.match(sql, /r\.id = s\.cohort_school_rotation_id/)
  assert.match(sql, /r\.cohort_id = s\.cohort_id/)
  assert.match(sql, /r\.school_name = s\.school/)
  assert.match(sql, /r\.rotation_end_date <> DATE '1900-01-01'/)
  assert.match(sql, /r\.rotation_end_date < v_today_pt/,
    'the end date must fully pass; do not complete a student at the start of their final day')
  assert.doesNotMatch(executableSql, /cohorts\.(start_date|end_date)|s\.term_dates/,
    'legacy/cohort dates must not substitute for the linked school-form row')
})

test('only approved hours satisfy a positive configured requirement', () => {
  assert.match(sql, /s\.hours_required IS NOT NULL/)
  assert.match(sql, /s\.hours_required > 0/)
  assert.match(sql, /COALESCE\(s\.approved_hours, 0\) >= s\.hours_required/)
  assert.doesNotMatch(sql, /pending_hours/)
})

test('staff-facing hours summaries and exports use the same approved-hours source', () => {
  assert.match(sidePanel, /label:`\$\{data\.approved_hours\|\|0\}\/\$\{data\.hours_required\} hrs`/)
  assert.doesNotMatch(sidePanel, /label:`\$\{data\.hours_completed\|\|0\}\/\$\{data\.hours_required\} hrs`/)
  assert.match(app, /s\.term_dates,s\.hours_required,s\.approved_hours,s\.unit,s\.preceptor_name/)
})

test('the transition logs one canonical completion event and is service-role only', () => {
  assert.match(sql, /event_type, event_date, notes, created_by/)
  assert.match(sql, /'completion'/)
  assert.match(sql, /'system'/)
  assert.match(sql, /NOT EXISTS \([\s\S]*pe\.event_type = 'completion'/)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.reconcile_student_completions\(uuid, uuid\)[\s\S]*FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.reconcile_student_completions\(uuid, uuid\)[\s\S]*TO service_role/)
})

test('cohort close, hours/date changes, and the migration backfill all invoke the same policy', () => {
  assert.match(sql, /AFTER UPDATE OF status ON public\.cohorts/)
  assert.match(sql, /NEW\.status = 'Completed'/)
  assert.match(sql, /AFTER UPDATE OF approved_hours, hours_required, cohort_school_rotation_id ON public\.students/)
  assert.match(sql, /AFTER UPDATE OF rotation_end_date ON public\.cohort_school_rotations/)
  assert.match(sql, /SELECT public\.reconcile_student_completions\(NULL, NULL\);/)
})

test('a protected daily sweep handles date passage without a database write', () => {
  // S-12: the inline `Bearer ${process.env.CRON_SECRET}` comparison was replaced
  // by the shared fail-closed helper. Same property, one implementation.
  assert.match(cron, /isAuthorizedCronRequest\(req\)/)
  assert.match(cron, /\.rpc\('reconcile_student_completions'/)
  assert.match(cron, /startCronRun\(db, CRON_NAME\)/)
  assert.match(cron, /finishCronRunSuccess\(db, runId, \{ completed_count: completed \}\)/)
  assert.match(cron, /finishCronRunError/)

  const schedule = vercel.crons.find(c => c.path === '/api/cron/student-completion-reconciliation')
  assert.deepEqual(schedule, {
    path: '/api/cron/student-completion-reconciliation',
    schedule: '5 13 * * *',
  })
  assert.equal(vercel.functions['api/cron/student-completion-reconciliation.js']?.maxDuration, 60)
})
