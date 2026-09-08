// test/interviewRubricResumeOwnDraft.test.mjs
//
// RUBRIC-RESUME-OWN-1: your own unfinished rubric reopens when you reopen the student.
//
// The defect: the session seeded the form from your own unfinished rubric only when
// your role was interviewer and nothing more. An Owner, Admin or Co-lead who saved a
// draft came back to a blank form, and the existing-rubrics banner then counted the
// row they had just written and told them a rubric was in progress and that they were
// adding a new one. It was describing their own work back to them. The row was in the
// database the whole time, and rendered nowhere: "All Rubrics for This Student" lists
// completed rubrics only.
//
// The rule is unit-tested here rather than pinned as a source string, because the one
// thing that must never break is that a wider privilege level still resumes only its
// OWN work. A privileged caller can edit every rubric, so "can I edit it" must not be
// allowed to mean "is it mine".

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  isSelfInterviewerName,
  isOwnRubricRow,
  selectResumableRubric,
} from '../src/lib/interviewRubricWrite.js'

const session = await readFile(new URL('../src/components/RubricSession.jsx', import.meta.url), 'utf8')

const ME = 'Jester Lloyd Bautista'
const mine = (over = {}) => ({ id: 'r1', student_id: 's1', is_own: true, status: 'In Progress', ...over })

// ── The ownership rule ───────────────────────────────────────────────────────

test('the server verdict is what claims a row', () => {
  assert.equal(isOwnRubricRow(mine(), { fullName: ME }), true)
  assert.equal(isOwnRubricRow({ ...mine(), is_own: false, interviewer_profile_id: 'p-other' }, { fullName: ME }), false)
  assert.equal(isOwnRubricRow(null, { fullName: ME }), false)
})

test("a row another profile owns is NEVER claimed, even when the names match", () => {
  // The dangerous case: two people share a display name, or a privileged reader can
  // edit everything. Ownership is settled by the profile id, not by the label.
  const someoneElses = {
    id: 'r9', student_id: 's1', is_own: false, status: 'In Progress',
    interviewer_profile_id: 'p-other', interviewer_name: ME, can_edit: true,
  }
  assert.equal(isOwnRubricRow(someoneElses, { fullName: ME }), false)
  assert.equal(selectResumableRubric([someoneElses], { studentId: 's1', fullName: ME }), null)
})

test('an unclaimed row is recovered by name, and only when the server allows the edit', () => {
  // Rows written before identity was stamped reliably carry no interviewer_profile_id:
  // a privileged user picking their own name got null whenever that name reached the
  // dropdown from the `interviewers` catalog, which holds names and no ids.
  const orphan = {
    id: 'r2', student_id: 's1', is_own: false, status: 'In Progress',
    interviewer_profile_id: null, interviewer_name: ME, can_edit: true,
  }
  assert.equal(isOwnRubricRow(orphan, { fullName: ME }), true)
  assert.equal(isOwnRubricRow({ ...orphan, can_edit: false }, { fullName: ME }), false,
    'without an edit right from the server, no name match may claim a row')
  assert.equal(isOwnRubricRow({ ...orphan, interviewer_name: 'Someone Else' }, { fullName: ME }), false)
})

test('a caller with no name claims nothing', () => {
  const orphan = { id: 'r3', student_id: 's1', interviewer_profile_id: null, interviewer_name: '', can_edit: true }
  for (const fullName of [undefined, null, '', '   ']) {
    assert.equal(isOwnRubricRow(orphan, { fullName }), false)
    assert.equal(isSelfInterviewerName('', fullName), false)
  }
})

test('name matching ignores case and surrounding whitespace, nothing else', () => {
  assert.equal(isSelfInterviewerName('  jester lloyd bautista ', ME), true)
  assert.equal(isSelfInterviewerName('Jester Bautista', ME), false, 'a different name is a different person')
})

// ── Which row reopens ────────────────────────────────────────────────────────

test('unfinished work wins over a completed rubric', () => {
  const rows = [
    mine({ id: 'done', status: 'Completed', updated_at: '2026-09-08T10:00:00Z' }),
    mine({ id: 'draft', status: 'In Progress', updated_at: '2026-09-01T10:00:00Z' }),
  ]
  assert.equal(selectResumableRubric(rows, { studentId: 's1', fullName: ME }).id, 'draft')
})

test('among several unfinished rows the most recently updated one reopens', () => {
  // Every reopen under the old role gate took the create path, so one author can hold
  // more than one unfinished row for the same student. The newest is the live draft.
  const rows = [
    mine({ id: 'older', updated_at: '2026-09-01T10:00:00Z' }),
    mine({ id: 'newest', updated_at: '2026-09-07T18:30:00Z' }),
    mine({ id: 'middle', updated_at: '2026-09-04T09:00:00Z' }),
  ]
  assert.equal(selectResumableRubric(rows, { studentId: 's1', fullName: ME }).id, 'newest')
})

test('a row with no timestamps still sorts, and another student is never picked up', () => {
  const rows = [mine({ id: 'untimed', updated_at: null, created_at: null })]
  assert.equal(selectResumableRubric(rows, { studentId: 's1', fullName: ME }).id, 'untimed')
  assert.equal(selectResumableRubric(rows, { studentId: 's2', fullName: ME }), null)
  assert.equal(selectResumableRubric(undefined, { studentId: 's1', fullName: ME }), null)
  assert.equal(selectResumableRubric([], { studentId: 's1', fullName: ME }), null)
})

// ── How the session uses it ──────────────────────────────────────────────────

test('the resume is no longer gated on the role', () => {
  assert.match(session, /const initialOwnRubric = selectResumableRubric\(rubrics, \{/)
  assert.doesNotMatch(session, /const ownRubrics = isInterviewerOnly/,
    'the interviewer-only gate that hid an Owner\'s own draft is gone')
  // A privileged user may be entering a rubric for someone else, so a blank form still
  // does not assume their own name.
  assert.match(session, /interviewer_name: isInterviewerOnly \? \(userProfile\?\.full_name \|\| ''\) : ''/)
})

test('choosing your own name stamps your profile id, so no new row is orphaned', () => {
  assert.match(session, /const interviewerProfileId = interviewerProfilesByName\[name\]\s*\|\| \(isSelfInterviewerName\(name, userProfile\?\.full_name\) \? \(userProfile\?\.id \|\| null\) : null\)/)
})

test('the banner reports other people, names whoever is mid-rubric, and hides when there is nobody', () => {
  assert.match(session, /const others     = studentRubrics\.filter\(r => !isOwnRubricRow\(r, \{ fullName: userProfile\?\.full_name \}\)\)/)
  assert.match(session, /if \(!submitted && !unfinished\.length\) return null/)
  assert.match(session, /who\.length \? ` \(\$\{who\.join\(', '\)\}\)` : ''/)
})

test('the completed-only rubric list is untouched: drafts stay private to their author', () => {
  assert.match(session, /\{!readOnly && completedRubrics\.length > 0 && \(/)
  assert.match(session, /All Rubrics for This Student \(\{completedRubrics\.length\}\)/)
})

test('no em dash in anything this change touched', async () => {
  const EM = String.fromCharCode(0x2014)
  const lib = await readFile(new URL('../src/lib/interviewRubricWrite.js', import.meta.url), 'utf8')
  const sql = await readFile(new URL('../db/audit/rubric_resume_own_draft_recovery.sql', import.meta.url), 'utf8')
  for (const [name, body] of [['RubricSession.jsx', session], ['interviewRubricWrite.js', lib], ['recovery.sql', sql]]) {
    assert.ok(!body.includes(EM), `${name} contains an em dash`)
  }
})

test('the recovery query is read only', async () => {
  // It runs against production data in the SQL editor. Nothing in it may write.
  const sql = await readFile(new URL('../db/audit/rubric_resume_own_draft_recovery.sql', import.meta.url), 'utf8')
  const statements = sql.replace(/--[^\n]*/g, '')
  assert.doesNotMatch(statements, /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i)
  assert.match(sql, /interviewer_profile_id IS NULL/)
})
