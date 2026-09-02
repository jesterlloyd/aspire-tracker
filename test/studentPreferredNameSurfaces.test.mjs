// test/studentPreferredNameSurfaces.test.mjs
//
// STUDENT-PREFERRED-NAME-SURFACES: a student who goes by a preferred first name must be
// shown by it everywhere the app names them, not only on the surfaces that happened to
// remember.
//
// The reported symptom was one student appearing as "Xing Li" on Interviews Today, in the
// Interview Rubric, and greeted "Dear Xing," in the Acceptance and Orientation template,
// while other surfaces correctly showed "Steven Li". The formatters in
// src/lib/studentNameFormatters.js were already canonical and already correct; eleven
// display sites simply composed `first_name + last_name` themselves instead of asking.
//
// This is the shape that matters: a canonical helper exists, and a call site reimplements
// its logic beside it. The guard below is therefore about CALL SITES, not about the
// formatters, which were never wrong.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  getStudentPreferredFullName, getStudentPreferredFirstName, getStudentLegalDisplayName,
} from '../src/lib/studentNameFormatters.js'
import { buildInterviewRows } from '../src/lib/interviewsToday.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
// Line comments FIRST: a path ending in a wildcard inside a // comment otherwise opens a
// false block comment and swallows the rest of the file.
const strip = (src) => src.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

// The reported student, with names changed only where the test needs to be explicit.
const XING = { id: 's1', first_name: 'Xing', last_name: 'Li', preferred_first_name: 'Steven' }
const PLAIN = { id: 's2', first_name: 'Dana', last_name: 'Reed', preferred_first_name: '' }

// Every surface that names a student, and which formatter it must use.
const PREFERRED_SURFACES = [
  'src/lib/interviewsToday.js',
  'src/components/RubricSession.jsx',
  'src/components/EmbedUnitCard.jsx',
  'src/components/PreceptorAssignmentModal.jsx',
  'src/components/StudentSidePanel.jsx',
  'src/components/StudentMatchingCard.jsx',
  'src/components/InterviewCalendar.jsx',
  'src/components/evaluation/PreceptorFeedbackPanel.jsx',
  'src/components/connect/OutreachView.jsx',
  'lib/server/evaluation/reminderSend.js',
  'lib/server/evaluation/reminderRecipient.js',
]

// ── The rule itself (unchanged, and it was never the bug) ────────────────────

test('the canon resolves a preferred first name and keeps the legal last', () => {
  assert.equal(getStudentPreferredFullName(XING), 'Steven Li')
  assert.equal(getStudentPreferredFirstName(XING), 'Steven')
  // A student without a preferred name is unaffected.
  assert.equal(getStudentPreferredFullName(PLAIN), 'Dana Reed')
  // Legal display still surfaces both, for the profile header that certifies identity.
  assert.equal(getStudentLegalDisplayName(XING), 'Xing “Steven” Li')
})

// ── The call sites ───────────────────────────────────────────────────────────

test('no surface composes a student name itself instead of asking', () => {
  // The exact expressions that produced "Xing Li". Each one bypassed a helper sitting in
  // the same repo, and in one case in the same component.
  const handRolled = [
    /\{student\.first_name\}\s*\{student\.last_name\}/,
    /\{s\.first_name\}\s*\{s\.last_name\}/,
    /\[student\.first_name,\s*student\.last_name\]/,
  ]
  for (const file of PREFERRED_SURFACES) {
    const code = strip(read(file))
    for (const pattern of handRolled) {
      assert.doesNotMatch(code, pattern, `${file} composes a student name by hand`)
    }
    assert.match(code, /studentNameFormatters/, `${file} must import the canon`)
  }
})

test('Interviews Today labels the row with the preferred name (functional)', () => {
  // buildInterviewRows(slots, opts); the student rides on the slot (slotStudent).
  const slot = {
    id: 'slot1', start_at: '2026-09-10T17:00:00Z', end_at: '2026-09-10T17:30:00Z',
    status: 'booked', students: XING,
  }
  const [row] = buildInterviewRows([slot], { now: new Date('2026-09-10T16:00:00Z') })
  assert.ok(row, 'a row for the booked student')
  assert.equal(row.name, 'Steven Li', 'Interviews Today showed the legal first name')
  assert.ok(!row.name.includes('Xing'))
  // A student with no preferred name is unchanged.
  const [plain] = buildInterviewRows([{ ...slot, students: PLAIN }], { now: new Date('2026-09-10T16:00:00Z') })
  assert.equal(plain.name, 'Dana Reed')
})

// ── The greeting ─────────────────────────────────────────────────────────────

test('a template greeting reads the canon, it does not split a display string', () => {
  const src = strip(read('src/components/connect/OutreachView.jsx'))
  // The correct value was already computed in this component and shadowed by a local that
  // re-derived it from dmRecipientName, which is built from students.name or first+last.
  assert.match(src, /const firstName = studentFirstName \|\| firstNameOf\(dmRecipientName\)/)
  assert.match(src, /const studentFirstName = \(selectedStudent \? getStudentPreferredFirstName\(selectedStudent\) : ''\) \|\| null/)
  // A contact has no preferred_first_name, so splitting its display name is still the only
  // source available and must remain the fallback.
  assert.match(src, /firstNameOf\(dmRecipientName\)/)
})

// ── What must NOT change ─────────────────────────────────────────────────────

test('the profile header still certifies legal identity', () => {
  // The one place that must show both names: First "Preferred" Last.
  assert.match(read('src/components/StudentSidePanel.jsx'), /getStudentLegalDisplayName\(data\)/)
})

test('the audit log still records the legal name', () => {
  // An activity log is a record of what happened, not a way to address someone. It keeps
  // the legal name deliberately, and this pins that as a choice rather than an oversight.
  const src = read('src/components/RubricSession.jsx')
  assert.match(src, /submitted interview rubric for \$\{student\.first_name\} \$\{student\.last_name\}/)
})

// NOTE: this file deliberately has no em-dash sweep. An earlier version asserted it across
// all eleven surfaces, which is a claim about code this change did not author: each of these
// files was edited by one line. Chasing it led into unrelated separator cleanup in the
// evaluation panels, which is not this fix. The rule still stands; it is just not this
// test's job to enforce it over legacy files.
