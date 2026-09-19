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

  test(`${f}: the legend names states, never a person`, () => {
    const src = strip(read(f))
    // The point of this test: a legend swatch must not carry initials or a name that a
    // reader could take for a real student. PLANNER-CALENDAR-1 made the swatches plain
    // colour blocks, matching the Interviews legend, so there is no name at all now,
    // which satisfies that more completely than the word "Student" did.
    assert.doesNotMatch(src, />AR<|label="AR"/)
    assert.match(src, /Completed shift/)
    assert.match(src, /On shift now/)
    // Either shape is fine: the planner's colour swatches (staff Rotation) or the
    // `label="Student"` chip the portal still uses. What is NOT fine is a real name.
    // Find the legend by its CONTAINER, never by searching for its words: "Completed
    // shift" also appears in the day list, where it sits beside a real shift's name, and
    // slicing around that text tested the wrong element entirely.
    const at = ['className="pl-legend"', 'className="ptl-cal-legend"']
      .map(c => src.indexOf(c)).find(i => i > 0)
    assert.ok(at > 0, 'the legend has no container to anchor on')
    const legend = src.slice(at, src.indexOf('</div>', at) + 6)
    assert.ok(legend.includes('Completed shift') && legend.includes('On shift now'),
      'both shift states belong in the legend')
    assert.doesNotMatch(legend, /student_name|shift\.student|first_name/,
      'a legend swatch never renders a real name')
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
