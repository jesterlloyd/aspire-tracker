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
  // PLACEMENT-COMMUNICATION-HANDOFF-1A: the scope-of-practice bullet now says the
  // documents are attached, so it appears only when they actually are. Built here
  // in the attached state, which is what every real send is.
  const draft = buildPreceptorAssignmentDraft({ firstName: 'Kelly', attachmentsAttached: true })

  assert.equal(draft.subject, 'ASPIRE: Student Assignment and Introduction Details')
  // PLACEMENT-NOTIFICATION-CONTROL-1: both bodies now open with the block
  // heading, then the greeting - the rich body always did.
  assert.match(draft.body, /^Preceptor Assignment & Details\n\nDear Kelly,/)
  for (const required of [
    'Student: [Student Name]',
    'School: [School]',
    'Unit: [Unit]',
    'Rotation Dates: [Rotation Dates]',
    'Required Hours: [Required Hours]',
    'Shift: [Shift]',
    'Your preferred name and title',
    'Preferred method of communication',
    'Best contact email and phone',
    'Unit and shift confirmation',
    'Typical schedule or upcoming shifts',
    'Optional photo to share with the student',
    "Any expectations or instructions for the student's first day",
    'When you have a moment',
    'Please email us the details below so I can introduce you to your student and help make the first day as smooth as possible. Send to aspire@cshs.org, do not reply to this email.',
    'Preceptor pay:',
    'Coverage:',
    'Floating:',
    // PRECEPTOR-ATTACHMENT-REMINDER-1: the canonical sentence, without "the".
    'Resources: Please see attached ASPIRE Brochure and General Guidelines for Pre-Licensure Students for your reference.',
  ]) assert.match(draft.body, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  assert.match(draft.richBody, /Preceptor Assignment &amp; Details|Preceptor Assignment & Details/)
  assert.match(draft.richBody, /data-aspire-block="note"[^>]+data-title="When you have a moment"[^>]+data-mailto="aspire@cshs.org"/)
  assert.doesNotMatch(draft.body, /Kind regards|Jester Lloyd Bautista/)
})

test('the preceptor assignment email matches the approved field labels, copy, and rich emphasis', () => {
  const draft = buildPreceptorAssignmentDraft({
    placement: {
      studentName: 'Nathalie Imamoto',
      school: 'California State University, Long Beach',
      unit: '7 SCCT',
      schedule: 'August 25–December 11, 2026',
      hoursRequired: '135 hours',
      shift: 'Day shift',
      preceptorFirstName: 'Isaac',
    },
    attachmentsAttached: true,
  })

  assert.equal(draft.subject, 'ASPIRE: Student Assignment and Introduction Details')
  assert.match(draft.body, /^Preceptor Assignment & Details\n\nDear Isaac,\n\nThank you for agreeing/)
  for (const line of [
    'Student: Nathalie Imamoto',
    'School: California State University, Long Beach',
    'Unit: 7 SCCT',
    'Rotation Dates: August 25–December 11, 2026',
    'Required Hours: 135 hours',
    'Shift: Day shift',
  ]) assert.ok(draft.body.includes(line), line)

  for (const label of ['Student:', 'School:', 'Unit:', 'Rotation Dates:', 'Required Hours:', 'Shift:',
    'Preceptor pay:', 'Coverage:', 'Floating:', 'Resources:']) {
    assert.ok(draft.richBody.includes(`<strong>${label}</strong>`), `${label} must be bold in rich email`)
  }
  assert.ok(draft.body.includes('Preceptor pay: You may be eligible, please reach out to Dr. Krystal Rodriguez with any questions.'))
  assert.ok(draft.body.endsWith("We truly appreciate your time, effort, and heart in mentoring our students. Your guidance helps them build confidence, competence, and readiness for practice. Please don't hesitate to reach out if you have any questions."))
  for (const retired of ['Unit / Assignment:', 'Rotation Dates / Schedule:', 'Additional Notes:', 'If eligible']) {
    assert.ok(!draft.body.includes(retired), `retired wording survived: ${retired}`)
  }
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
