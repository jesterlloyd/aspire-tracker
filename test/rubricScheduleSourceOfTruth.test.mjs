// RUBRIC-SCHEDULE-1
// The interview rubric's Section 1 date and time edit the REAL appointment.
//
// Before this, the rubric wrote interview_rubrics.interview_time, which no surface
// read, while the time input displayed students.interview_scheduled_time as a
// fallback. So the field looked like the schedule and behaved like a note: a staff
// member corrected 10:30 to 11:30 and neither the Interview Recommendations table
// (students.interview_scheduled_*) nor the Interviews Today card (interview_slots)
// changed, and nothing said why.
//
// Run: node --test test/rubricScheduleSourceOfTruth.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')

const rubric = read('src/components/RubricSession.jsx')
const availability = read('api/availability.js')
const booking = read('src/lib/interviewBooking.js')
const studentUpdate = read('api/student-update.js')
const table = read('src/components/InterviewRubricTab.jsx')
const todayCard = read('src/components/TodaysInterviews.jsx')

test('the two surfaces still read the appointment, not the rubric', () => {
  // This is what makes the rubric writing its own copy a bug rather than a preference.
  assert.match(table, /s\.interview_scheduled_date \? \(/)
  assert.match(table, /fmtApptTime\(s\.interview_scheduled_time\)/)
  assert.match(todayCard, /from\('interview_slots'\)/)
  assert.match(todayCard, /\.eq\('slot_date', localDate\)/)
  // The appointment cell itself resolves entirely from the student booking. (The tab
  // does name interview_rubrics elsewhere, but only to subscribe to rubric changes.)
  const apptStart = table.indexOf('2. Appointment')
  const apptCell = table.slice(apptStart, table.indexOf('3. Workflow Status', apptStart))
  assert.ok(apptCell.length > 200, 'expected the appointment cell')
  assert.doesNotMatch(apptCell, /interview_time|interview_date\b/, 'the cell never reads a rubric time')
  assert.doesNotMatch(todayCard, /interview_rubrics/)
})

test('Section 1 binds to the booking and never writes a second copy of it', () => {
  // Both inputs read the booking, and neither routes through the rubric field savers.
  assert.match(rubric, /const bookedDate = student\.interview_scheduled_date \|\| ''/)
  assert.match(rubric, /const bookedTime = \(student\.interview_scheduled_time \|\| ''\)\.slice\(0, 5\)/)
  assert.match(rubric, /onChange=\{e => reschedule\('date', e\.target\.value\)\}/)
  assert.match(rubric, /onChange=\{e => reschedule\('time', e\.target\.value\)\}/)
  // The old decoy is gone: no free-text time, and no saver call for either field.
  assert.doesNotMatch(rubric, /saveText\('interview_time'/)
  assert.doesNotMatch(rubric, /saveImmediate\('interview_date'/)
  assert.doesNotMatch(rubric, /placeholder="e\.g\. 09:00"/)
  assert.doesNotMatch(rubric, /const saveImmediate =/, 'its last caller went with the decoy')
  // A time input, so "11:30" cannot be typed into a column as prose.
  assert.match(rubric, /type="time" step="60"/)
})

test('rescheduling is Owner/Admin, matching the scheduling grant elsewhere', () => {
  // Co-Lead is deliberately excluded from scheduling in student-update; the rubric
  // must not become a side door into it, so canReschedule is NOT canManageAllRubrics.
  assert.match(rubric, /const canReschedule = userProfile\?\.is_owner === true \|\| \['owner', 'admin'\]\.includes\(normalizedRole\)/)
  assert.match(rubric, /canReschedule && !readOnly/)
  assert.match(availability, /if \(!adminLevel\) \{\s*return res\.status\(403\)[^}]*reschedule interviews/)
  assert.match(studentUpdate, /if \(action === 'update_interview_schedule'\) \{\s*if \(!isOwnerAdmin\)/)
})

test('the move claims before it releases, and rolls back rather than orphan a booking', () => {
  const move = availability.slice(availability.indexOf("if (action === 'move_booking')"),
                                  availability.indexOf("if (action === 'cancel_booking')"))
  assert.ok(move.length > 500, 'expected the move_booking handler')
  // Claim the destination conditionally first: losing the race leaves the old booking intact.
  const claim = move.indexOf(".eq('is_booked', false)\n        .select")
  const release = move.indexOf("status: 'available'")
  assert.ok(claim > 0 && release > claim, 'the claim must precede the release')
  assert.match(move, /rolled back/)
  // A failed release gives the claim back rather than leaving the student holding two.
  assert.match(move, /if \(releaseErr\) \{[\s\S]*?\.eq\('id', claimed\.id\)/)
  // The session follows the booking so the rubric stays attached to it.
  assert.match(move, /from\('interview_sessions'\)[\s\S]*?\.update\(\{ slot_id: claimed\.id \}\)/)
  assert.match(availability, /ALLOWED_ACTIONS = \[[^\]]*'move_booking'\]/)
})

test('a move never rewrites the student standing', () => {
  const move = availability.slice(availability.indexOf("if (action === 'move_booking')"),
                                  availability.indexOf("if (action === 'cancel_booking')"))
  // This is the trap that ruled out reusing the existing endpoints: update_interview_schedule
  // forces 'Interview Scheduled' and cancel_booking forces 'Form Received', either of which
  // would demote a student who has already been interviewed or placed.
  assert.doesNotMatch(move, /status: 'Interview Scheduled'/)
  assert.doesNotMatch(move, /status: 'Form Received'/)
  assert.match(studentUpdate, /status: 'Interview Scheduled',/, 'the endpoint we avoided still does this')
  assert.match(availability, /status: 'Form Received', interview_scheduled_date: null/, 'and so does cancel')
  // It writes exactly the appointment.
  assert.match(move, /interview_scheduled_date: claimed\.slot_date/)
  assert.match(move, /interview_scheduled_time: String\(claimed\.slot_time\)\.slice\(0, 5\)/)
})

test('the destination is matched by INTERVIEWER, across all of that day\'s blocks', () => {
  const move = availability.slice(availability.indexOf("if (action === 'move_booking')"),
                                  availability.indexOf("if (action === 'cancel_booking')"))
  // The bug this replaced: the first cut required the destination to share the origin's
  // block_id. Each "Add availability" creates its OWN block, so an interviewer with
  // 10:30-11:00, 11:30-12:00 and 2:30-3:00 on one day has three single-slot blocks, and
  // the open 11:30 is never in the booked 10:30's block. Every real move was refused.
  assert.doesNotMatch(move, /\.eq\('block_id', current\.block_id\)/,
    'matching the origin block refuses every move that crosses a block')
  // Identity is resolved on the parent block, never trusted from the slot.
  assert.match(move, /from\('interview_availability_blocks'\)[\s\S]{0,200}\.eq\('id', current\.block_id\)/)
  assert.match(move, /\.eq\('interviewer_profile_id', originBlock\.interviewer_profile_id\)/)
  assert.match(move, /\.eq\('block_date', newDate\)/)
  // The search then spans every block that interviewer holds that day.
  assert.match(move, /\.in\('block_id', blockIds\)/)
  assert.match(move, /\.eq\('is_booked', false\)/)
  // Legacy blocks carry only a name; they still resolve rather than failing shut.
  assert.match(move, /blockQuery\.eq\('interviewer_name', whoName\)/)
  assert.match(move, /No open interview slot at/)
  // A student with no booking is refused, not given one.
  assert.match(move, /has no booked interview to move/)
  assert.doesNotMatch(move, /\.insert\(\{[\s\S]{0,200}slot_date/, 'a move never creates a slot')
})

test('bookability is is_booked alone, the same test the public page applies', () => {
  const move = availability.slice(availability.indexOf("if (action === 'move_booking')"),
                                  availability.indexOf("if (action === 'cancel_booking')"))
  // interview-lookup offers slots on is_booked and date alone; block is_active gates
  // nothing there, so inventing a stricter rule here would hide bookable slots.
  const lookup = read('api/interview-lookup.js')
  assert.match(lookup, /\.eq\('is_booked', false\)/)
  assert.doesNotMatch(lookup, /is_active/)
  // Comments here explain the rule, so compare on code with comments stripped.
  const moveCode = move.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
  assert.doesNotMatch(moveCode, /is_active/, "no stricter bookability rule than the public page")
})

test('the rubric keeps a snapshot in step, so the export and rubric cards stay honest', () => {
  // interview_rubrics.interview_date still feeds the roster export and the rubric card,
  // so a successful move mirrors onto the row instead of leaving it contradicting.
  assert.match(rubric, /interview_date: appliedDate, interview_time: appliedTime/)
  assert.match(read('src/App.jsx'), /s\.interview_date\|\|''/)
  // A new rubric seeds from the booking rather than stamping the day it was opened.
  assert.match(rubric, /\.\.\.\(bookedDate \? \{ interview_date: bookedDate \} : \{\}\)/)
  // Completeness follows the appointment wherever it lives.
  assert.match(rubric, /!\(bookedDate \|\| form\.interview_date\)\s+&& 'Date of interview is required in Section 1'/)
})

test('a refusal is shown to the user rather than swallowed', () => {
  assert.match(booking, /throw new Error\(data\.message \|\| 'Could not move the interview\.'\)/)
  assert.match(rubric, /setReschedError\(err\.message/)
  assert.match(rubric, /className="iv-sched-note"/)
  assert.match(read('src/index.css'), /\.iv-sched-note/)
  // A successful move refreshes both the student and the rubric list.
  assert.match(rubric, /if \(onStudentUpdate\) await onStudentUpdate\(\)/)
})
