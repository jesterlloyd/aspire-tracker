// UNIT-PREFS-SAVE-1: staff can change a student's Unit Placement Preferences again.
// WS1e-A5 (2026-06-09) removed the generic `update` action; the three preference fields stayed
// writable only through save_interview_outcome, so the side panel's selects failed for every
// student with "Save failed". This pins the dedicated action, its route, and the stale-pick display.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const api = read('api/student-update.js')
const proxy = read('src/lib/studentProxy.js')
const app = read('src/App.jsx')
const panel = read('src/components/StudentSidePanel.jsx')
const action = api.slice(api.indexOf("if (action === 'update_unit_preferences')"),
  api.indexOf("if (action === 'update_student_availability')"))

test('the server has a dedicated preferences action, gated like the other student-record edits', () => {
  assert.match(api, /const UNIT_PREFERENCE_FIELDS = \['unit_preference_1', 'unit_preference_2', 'unit_preference_3'\]/)
  assert.ok(action.length > 0, 'update_unit_preferences exists')
  assert.match(action, /^if \(action === 'update_unit_preferences'\) \{\s*\n\s*if \(!canStudentManage\) return res\.status\(403\)/)
  // Exact schema: only the three fields beside action and student_id.
  assert.match(action, /const ALLOWED = \['action', 'student_id', \.\.\.UNIT_PREFERENCE_FIELDS\]/)
  assert.match(action, /message: 'Unexpected field\.'/)
})

test('a pick must be a unit hosting the student\'s own cohort; an empty value clears it', () => {
  assert.match(action, /\.from\('units'\)\s*\n\s*\.select\('unit_name'\)\.eq\('cohort_id', stu\.cohort_id\)\.eq\('is_participating', true\)/)
  assert.match(action, /upd\[k\] !== '' && !names\.has\(upd\[k\]\)/)
  assert.match(action, /Choose a unit that is hosting this cohort\./)
  assert.match(action, /upd\[k\] = payload\[k\]\.trim\(\)/)
  // No write when nothing changed; the log names fields, never values.
  assert.match(action, /no_change: true/)
  assert.match(action, /fields: supplied \}\)/)
})

test('the rubric workflow still writes preferences through its own action', () => {
  assert.match(api, /const RUBRIC_OUTCOME_FIELDS = \[\s*\n\s*'unit_preference_1', 'unit_preference_2', 'unit_preference_3',/)
})

test('the client routes the three preference fields to the new action', () => {
  assert.match(proxy, /export const updateUnitPreferences = domainHelper\('update_unit_preferences'\)/)
  assert.match(app, /import \{[^}]*\bupdateUnitPreferences\b[^}]*\} from '\.\/lib\/studentProxy'/)
  assert.match(app, /\{ keys: \['unit_preference_1', 'unit_preference_2', 'unit_preference_3'\], helper: updateUnitPreferences \}/)
})

test('a stored pick that no longer hosts the cohort is shown, disabled, instead of "Not specified"', () => {
  assert.match(panel, /\{data\[f\] && !participatingUnits\.includes\(data\[f\]\) && \(\s*\n\s*<option value=\{data\[f\]\} disabled>\{data\[f\]\} \(not hosting this cohort\)<\/option>/)
})
