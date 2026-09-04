// test/rotationCalendarFirstName.test.mjs
//
// ROTATION-CALENDAR-FIRST-NAME-1: the month-cell chip on the two staff-facing rotation
// calendars (Unit Leader Portal > Home, Main App > Rotation > Activity) names the student by
// FIRST name, "Victoria with Romelyn", instead of by initials, "VM with Romelyn". The Student
// Portal calendar keeps "Shift with Romelyn": the signed-in student is the only reader, so the
// name is implied.
//
// What this pins:
//   1. Both chips read one helper (chipName) that prefers the feed's student_first_name, then
//      the first token of student_name, then the honest "Student" fallback.
//   2. Both feeds ship student_first_name through getStudentPreferredFirstName, the shared
//      preferred-name formatter, so a multi-word preferred name ("Mary Ann") survives intact
//      instead of being split by a whitespace tokenizer at the call site.
//   3. The legend swatches stopped saying "AR" (sample initials) and say "Student".
//   4. The Student Portal chip and legend were not disturbed.
//
// Source assertions. No network, no database, no rendering.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const strip = (src) => src.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

const UL_CAL = 'src/portal/unit/UnitRotationCalendar.jsx'
const STAFF_CAL = 'src/components/rotation/RotationActivityCalendar.jsx'
const UL_API = 'api/portal/unit-shift-activity.js'
const STAFF_FEED = 'src/components/RotationActivity.jsx'
const STUDENT_CAL = 'src/portal/StudentRotationActivity.jsx'

const CHIP_NAME = /function chipName\(shift\) \{\s*return shift\.student_first_name \|\| firstNameOf\(shift\.student_name\) \|\| 'Student'\s*\}/

for (const f of [UL_CAL, STAFF_CAL]) {
  test(`${f}: the month-cell chip is the student's first name, never initials`, () => {
    const src = strip(read(f))
    assert.match(src, CHIP_NAME, 'one helper, one fallback chain')
    assert.match(src, /<CanonicalActivityChip\s+key=\{shift\.id\}\s+label=\{chipName\(shift\)\}/)
    assert.doesNotMatch(src, /label=\{initials\(shift\.student_name\)\}/, 'the cell chip no longer shows initials')
    // The accessible label still carries the FULL name: "Victoria Martinez with Romelyn".
    assert.match(src, /const nameForLabel = shift\.student_name \|\| 'Student'/)
    // The selected-day list still prints the full name next to its state marker.
    assert.match(src, /\{shift\.student_name \|\| 'Student'\}/)
  })

  test(`${f}: the legend swatches say Student, not sample initials`, () => {
    const src = strip(read(f))
    assert.doesNotMatch(src, />AR<|label="AR"/)
    assert.equal((src.match(/Completed shift/g) || []).length >= 1, true)
    assert.match(src, /(>Student<\/span> Completed shift|label="Student" \/> Completed shift)/)
    assert.match(src, /(>Student<\/span> On shift now|label="Student" live \/> On shift now)/)
  })
}

test('the Unit Leader feed ships student_first_name through the shared preferred-name formatter', () => {
  const src = strip(read(UL_API))
  assert.match(src, /import \{ getStudentPreferredFirstName \} from '\.\.\/\.\.\/src\/lib\/studentNameFormatters\.js'/)
  assert.match(src, /student_first_name: getStudentPreferredFirstName\(s\) \|\| null,/)
})

test('the staff feed ships student_first_name through the same formatter', () => {
  const src = strip(read(STAFF_FEED))
  assert.match(src, /import \{ getStudentPreferredFullName, getStudentPreferredFirstName \} from '\.\.\/lib\/studentNameFormatters'/)
  assert.match(src, /const firstById = new Map\(students\.map\(s => \[s\.id, getStudentPreferredFirstName\(s\)\]\)\)/)
  assert.match(src, /student_first_name: firstById\.get\(l\.student_id\) \|\| null,/)
})

test('the Student Portal calendar keeps "Shift with <preceptor>" and its legend', () => {
  const src = strip(read(STUDENT_CAL))
  assert.match(src, /<CanonicalActivityChip\s+label="Shift"/)
  assert.match(src, /className="ptl-cal-chip" aria-hidden="true">Shift<\/span> Logged shift/)
  assert.doesNotMatch(src, /chipName|student_first_name/)
})

test('no em dash in anything this change touched', () => {
  const EM = String.fromCharCode(0x2014)
  for (const f of [UL_CAL, STAFF_CAL, UL_API, STAFF_FEED, 'test/rotationCalendarFirstName.test.mjs']) {
    assert.ok(!read(f).includes(EM), `${f} contains an em dash`)
  }
})
