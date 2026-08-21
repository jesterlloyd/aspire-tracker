// INTERVIEW-RUBRIC-AUTH-1
// Source-level regression contracts for rubric confidentiality and ownership.
// Run: node --test test/interviewRubricAuthorization.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migrationPath = new URL('../supabase/migrations/20260822010000_interview_rubric_authorization.sql', import.meta.url)
const appPath = new URL('../src/App.jsx', import.meta.url)
const sessionPath = new URL('../src/components/RubricSession.jsx', import.meta.url)

const [migration, app, session] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(appPath, 'utf8'),
  readFile(sessionPath, 'utf8'),
])

test('rubrics are identity-bound and legacy names backfill only when unambiguous', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS interviewer_profile_id uuid/i)
  assert.match(migration, /HAVING count\(\*\) = 1/i)
  assert.match(migration, /r\.interviewer_profile_id IS NULL/i)
  assert.match(migration, /interviewer_name is display text only/i)
})

test('legacy broad policies are removed and own-row writes are server enforced', () => {
  assert.match(migration, /FROM pg_policies[\s\S]*tablename = 'interview_rubrics'/i)
  assert.match(migration, /CREATE POLICY interview_rubrics_select_own_or_privileged/i)
  assert.match(migration, /CREATE POLICY interview_rubrics_insert_own_or_privileged/i)
  assert.match(migration, /CREATE POLICY interview_rubrics_update_own_or_privileged/i)
  assert.match(migration, /CREATE POLICY interview_rubrics_delete_privileged/i)
  assert.match(migration, /interview_rubric_identity_matches_caller/i)
})

test('owner, admin, and both co-lead spellings can manage all rubrics', () => {
  assert.match(migration, /up\.role IN \('owner', 'admin', 'co-lead', 'co_lead'\)/)
  assert.match(session, /\['owner', 'admin', 'co-lead'\]\.includes\(normalizedRole\)/)
})

test('cohort reads use the redacting RPC instead of downloading every rubric', () => {
  assert.match(app, /rpc\('list_interview_rubrics_for_cohort'/)
  assert.doesNotMatch(app, /from\('interview_rubrics'\)\.select\('\*'\)\.eq\('cohort_id'/)
  assert.match(migration, /CASE WHEN actor_is_privileged OR r\.interviewer_profile_id = actor_profile_id THEN r\.cj_notes ELSE NULL END/)
  assert.match(migration, /CASE WHEN actor_is_privileged OR r\.interviewer_profile_id = actor_profile_id THEN r\.student_questions ELSE NULL END/)
})

test('other interviewers retain summaries but cannot open or edit details', () => {
  assert.match(migration, /r\.cj_score,[\s\S]*r\.pp_score,[\s\S]*r\.ga_score/)
  assert.match(migration, /r\.individual_recommendation,[\s\S]*r\.suggested_unit,[\s\S]*r\.summary_comments/)
  assert.match(session, /Rubric view restricted/)
  assert.match(session, /disabled=\{!canView\}/)
  assert.match(session, /canViewRubric = canManageAllRubrics \|\| r\.can_view_details === true/)
  assert.match(session, /canEditRubric = canManageAllRubrics \|\| r\.can_edit === true/)
  assert.doesNotMatch(session, /r\.interviewer_name === userProfile\?\.full_name/)
})

test('ordinary interviewer inserts are bound to the authenticated profile identity', () => {
  assert.match(session, /interviewer_profile_id: userProfile\?\.id \|\| null/)
  assert.match(session, /interviewer_name: userProfile\?\.full_name \|\| ''/)
  assert.match(session, /if \(isInterviewerOnly\) return/)
  assert.match(session, /r\.is_own === true/)
})

test('average calculations use safe cohort summaries rather than an own-row table read', () => {
  const recalcBody = session.slice(
    session.indexOf('async function recalculateStudentAverages'),
    session.indexOf('// ── Editable rubric card'),
  )
  assert.match(recalcBody, /rpc\('list_interview_rubrics_for_cohort'/)
  assert.doesNotMatch(recalcBody, /from\('interview_rubrics'\)/)
})
