import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  buildBulkTemplate,
  buildPreceptorAssignmentDraft,
  buildStudentAcceptanceOrientationDraft,
} from '../src/lib/outreachTemplates.js'
import { applyMergeFields } from '../src/lib/recipientParse.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const registry = read('src/lib/connect/templateRegistry.js')
const outreach = read('src/components/connect/OutreachView.jsx')

test('the preceptor assignment draft contains the assignment, requested details, and reminders in one message', () => {
  const draft = buildPreceptorAssignmentDraft({ firstName: 'Kelly' })

  assert.equal(draft.subject, 'ASPIRE: Student preceptor assignment and introduction details')
  assert.match(draft.body, /^Dear Kelly,/)
  for (const required of [
    'Student: [Student Name]',
    'School: [School]',
    'Unit / Assignment: [Unit / Assignment]',
    'Rotation Dates / Schedule: [Rotation Dates / Schedule]',
    'Required Hours: [Required Hours, if applicable]',
    'Your preferred name and title',
    'Typical schedule or upcoming shifts',
    'Unit and shift confirmation',
    'Optional photo to share with the student',
    'Preceptor pay:',
    'Coverage:',
    'Floating:',
    'Scope of practice:',
  ]) assert.match(draft.body, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  assert.match(draft.richBody, /data-aspire-block="note"/)
  assert.match(draft.richBody, /Preceptor Assignment &amp; Details|Preceptor Assignment & Details/)
  assert.doesNotMatch(draft.body, /Kind regards|Jester Lloyd Bautista/)
})

test('the student acceptance draft carries the complete August 17 orientation invitation', () => {
  const draft = buildStudentAcceptanceOrientationDraft({ firstName: 'Ava' })

  assert.equal(draft.subject, "Welcome to ASPIRE! You're Invited: ASPIRE Orientation – Monday, August 17, 2026")
  assert.match(draft.body, /^Dear Ava,/)
  for (const required of [
    "Congratulations and welcome to ASPIRE",
    'Monday, August 17, 2026, 2:00 PM',
    '8700 Beverly Blvd., Los Angeles, CA 90048',
    'Starbucks, South Tower, Plaza Level',
    'Your school uniform',
    'Student ID badge',
    '$20 cash for parking',
    'P4 Visitor Parking',
    '127 S. Sherbourne Dr., Los Angeles, CA 90048',
    'Optional unit tours with your preceptor, if available',
    'Please confirm your attendance',
    'aspire@cshs.org',
  ]) assert.ok(draft.body.includes(required), `missing orientation copy: ${required}`)

  assert.match(draft.richBody, /data-aspire-block="event"/)
  assert.match(draft.richBody, /data-title="ASPIRE Orientation"/)
  assert.match(draft.richBody, /data-aspire-block="note"[^>]+data-title="Arrival instructions"/)
  assert.doesNotMatch(draft.body, /Kind regards|Jester Lloyd Bautista/)
})

test('bulk student orientation personalizes safely and never leaks its greeting token', () => {
  const draft = buildBulkTemplate('student_acceptance_orientation')
  assert.ok(draft)
  assert.match(draft.body, /^\[Student Greeting\]/)

  const named = applyMergeFields(draft.body, { firstName: 'Ava', school: 'West Coast University' })
  const fallback = applyMergeFields(draft.body, { firstName: '', school: '' })
  assert.match(named, /^Dear Ava,/)
  assert.match(fallback, /^Dear ASPIRE Student,/)
  assert.doesNotMatch(named + fallback, /\[Student Greeting\]/)
})

test('Connect exposes one combined preceptor template and student orientation on both send surfaces', () => {
  assert.match(registry, /key: 'preceptor_assignment', label: 'Preceptor Assignment & Details'/)
  assert.doesNotMatch(registry, /key: 'preceptor_details_request'/)
  assert.doesNotMatch(outreach, /buildPreceptorDetailsRequestDraft|case 'preceptor_details_request'/)

  const studentEntries = registry.match(/key: 'student_acceptance_orientation'/g) || []
  assert.equal(studentEntries.length, 2, 'one Send-to-one and one Send-to-many entry')
  assert.match(registry, /key: 'student_acceptance_orientation', label: 'ASPIRE Acceptance & Orientation', active: true, kind: 'hydrate'/)
  assert.match(registry, /key: 'student_acceptance_orientation', label: 'ASPIRE Acceptance & Orientation',[\s\S]{0,220}defaultSource: 'students'[\s\S]{0,100}AUDIENCES\.STUDENT/)
  assert.match(outreach, /case 'student_acceptance_orientation': return buildStudentAcceptanceOrientationDraft\(\{ firstName \}\)/)
})

test('the generic announcement path and recipient-send endpoints remain separate and unchanged', () => {
  assert.match(registry, /key: 'announcement_broadcast', label: 'Announcement \/ Broadcast'/)
  assert.match(registry, /defaultSource: 'students', audiences: \[AUDIENCES\.GENERIC\]/)
  assert.doesNotMatch(read('src/lib/outreachTemplates.js'), /resend\.emails\.send|connect-send-bulk-message|connect-send-direct-email/)
})
