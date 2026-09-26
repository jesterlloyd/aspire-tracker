// test/homeModels.test.mjs
//
// HOME-1: the rules behind the At a Glance home page, tested without a browser. Every
// number the page prints comes from one of these modules; nothing is computed in JSX.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { derivePhase, pipelineCounts, PHASES, PHASE_KEYS } from '../src/lib/home/cyclePhase.js'
import { hoursPace, BEHIND_TOLERANCE_PCT } from '../src/lib/clinicalHours.js'
import {
  messagesGroup, signaturesGroup, reviewReleaseGroup, formsDocsGroup, interviewsGroup, placementGroup,
  needsYouSummary, filterChips, nextFilter, visibleGroups, orderGroups, ageLabel, ROWS_PER_GROUP, rowsFor,
} from '../src/lib/home/needsYouModel.js'
import { onCampusGroups, scheduleRows, shiftGroupLabel, shiftGroupState, dueTodayItems, initialsOf, plannedShiftType, defaultTodayView } from '../src/lib/home/todayModel.js'
import { hoursBar, midpointBar } from '../src/lib/home/cohortPulseModel.js'
import { placementSummary, capacityByServiceLine, filteredCapacityByServiceLine, requestsBySchool } from '../src/lib/home/placementSummaryModel.js'
import { getUnit } from '../src/lib/unitCatalog.js'
import { ACTIONS, QUICK_ACTION_KEYS, allowedActions, quickActions, personRows, searchLauncher, moveSelection, greetingFor } from '../src/lib/home/launcherModel.js'
import { activityRows, ACTIVITY_LIMIT } from '../src/lib/home/recentActivityModel.js'

const TODAY = '2026-09-24'
const NOW = new Date('2026-09-24T20:46:00')
const NOW_MS = NOW.getTime()

// ── Cycle phase ──────────────────────────────────────────────────────────────

test('PHASE 1: five phases, each with its order after Needs you, from the brief', () => {
  assert.deepEqual(PHASE_KEYS, ['recruit', 'interview', 'placement', 'rotation', 'eval'])
  assert.deepEqual(PHASES.recruit.order, ['recruit', 'duo', 'activity', 'placement'])
  assert.deepEqual(PHASES.interview.order, ['duo', 'recruit', 'activity', 'placement'])
  assert.deepEqual(PHASES.placement.order, ['placement', 'duo', 'activity'])
  assert.deepEqual(PHASES.rotation.order, ['duo', 'placement', 'activity'])
  assert.deepEqual(PHASES.eval.order, ['evals', 'duo', 'activity', 'placement'])
})

test('PHASE 2: derived from cohort status, student statuses and the school rotation windows', () => {
  const cohort = { status: 'Active' }
  assert.equal(derivePhase({ cohort, students: [], rotations: [], today: TODAY }).key, 'recruit')
  assert.equal(derivePhase({ cohort, students: [{ status: 'Pending Outreach' }], today: TODAY }).key, 'recruit')
  assert.equal(derivePhase({ cohort, students: [{ status: 'Form Received' }], today: TODAY }).key, 'interview')
  assert.equal(derivePhase({ cohort, students: [{ status: 'Interviewed' }, { status: 'Placed' }], today: TODAY }).key, 'placement')
  assert.equal(derivePhase({ cohort, students: [{ status: 'Placed' }], rotations: [{ rotation_start_date: '2026-09-01', rotation_end_date: '2026-12-01' }], today: TODAY }).key, 'rotation')
  assert.equal(derivePhase({ cohort, students: [{ status: 'Active Rotation' }], today: TODAY }).key, 'rotation')
  assert.equal(derivePhase({ cohort, students: [{ status: 'Completed' }], rotations: [{ rotation_start_date: '2026-05-01', rotation_end_date: '2026-08-01' }], today: TODAY }).key, 'eval')
  assert.equal(derivePhase({ cohort: { status: 'Completed' }, students: [{ status: 'Active Rotation' }], today: TODAY }).key, 'eval')
})

test('PHASE 3: the 1900-01-01 sentinel is unknown, never a date that has ended', () => {
  const r = derivePhase({ cohort: { status: 'Active' }, students: [{ status: 'Placed' }], rotations: [{ rotation_start_date: '1900-01-01', rotation_end_date: '1900-01-01' }], today: TODAY })
  assert.equal(r.key, 'placement')
})

test('PIPELINE: five cumulative stages, exits excluded', () => {
  const students = [
    { status: 'Pending Outreach' }, { status: 'Interviewed' }, { status: 'Placed' }, { status: 'Active Rotation' }, { status: 'Completed' }, { status: 'Declined' },
  ]
  const p = pipelineCounts(students)
  assert.deepEqual(p.map(s => [s.label, s.count]), [['Applied', 5], ['Interviewed', 4], ['Placed', 3], ['Active rotation', 2], ['Completed', 1]])
})

// ── Hours pace (the one "behind" rule) ───────────────────────────────────────

test('PACE 1: expected hours follow the rotation window; behind is more than the tolerance below', () => {
  assert.equal(BEHIND_TOLERANCE_PCT, 10)
  const win = { start: '2026-08-01', end: '2026-12-01' }
  const mid = '2026-10-01'   // half way: 90 of 180 expected
  assert.equal(hoursPace({ hours_required: 180, approved_hours: 60 }, win, mid).pace, 'behind')     // 30 short, > 18
  assert.equal(hoursPace({ hours_required: 180, approved_hours: 80 }, win, mid).pace, 'on_track')   // 10 short, <= 18
  assert.equal(hoursPace({ hours_required: 180, approved_hours: 180 }, win, mid).pace, 'complete')
})

test('PACE 2: no window, an unknown requirement, or a rotation not yet started is unknown, never behind', () => {
  assert.equal(hoursPace({ hours_required: 180, approved_hours: 0 }, {}, TODAY).pace, 'unknown')
  assert.equal(hoursPace({ hours_required: 0, approved_hours: 0 }, { start: '2026-08-01', end: '2026-12-01' }, TODAY).pace, 'unknown')
  assert.equal(hoursPace({ hours_required: 180, approved_hours: 0 }, { start: '2026-10-01', end: '2026-12-01' }, TODAY).pace, 'unknown')
  assert.equal(hoursPace({ hours_required: 180, approved_hours: 0 }, { start: '1900-01-01', end: '1900-01-01' }, TODAY).pace, 'unknown')
})

// ── Needs you ────────────────────────────────────────────────────────────────

test('NEEDS 1: messages count replies and unassigned, sorted oldest first, rows navigate to the thread', () => {
  const g = messagesGroup({ now: NOW_MS, conversations: [
    { id: 'a', subject: 'Parking', participant_name: 'Maya', status: 'open', latest_author_role: 'student', assigned_staff_profile_id: 'x', last_message_at: '2026-09-22T10:00:00' },
    { id: 'b', subject: 'Placement', participant_name: 'Priya', status: 'open', latest_author_role: 'student', assigned_staff_profile_id: null, last_message_at: '2026-09-15T10:00:00' },
    { id: 'c', subject: 'Resolved', participant_name: 'Dan', status: 'resolved', latest_author_role: 'student', assigned_staff_profile_id: null, last_message_at: '2026-09-23T10:00:00' },
    { id: 'd', subject: 'Waiting', participant_name: 'Eve', status: 'open', latest_author_role: 'staff', assigned_staff_profile_id: 'x', last_message_at: '2026-09-23T10:00:00' },
  ] })
  assert.deepEqual(g.pills, [{ text: '2 reply', tone: 'amber' }, { text: '1 unassigned', tone: 'red' }])
  assert.equal(g.rows[0].id, 'msg:b', 'oldest first')
  assert.equal(g.rows[0].pill.text, '9d')
  assert.match(g.rows[0].meta, /Unassigned/)
  assert.equal(g.rows[1].to, '/connect/messages?conversation=a')
  assert.equal(g.count, 2)
})

test('NEEDS 2: an empty source is hidden (null), so "All caught up" means every source was empty', () => {
  assert.equal(messagesGroup({ conversations: [] }), null)
  assert.equal(signaturesGroup({ requests: [], signers: [], meId: 'me' }), null)
  assert.equal(reviewReleaseGroup({ queues: {}, workflows: [{ key: 'a', label: 'A' }] }), null)
  assert.equal(formsDocsGroup({ trackerRows: [], items: [] }), null)
  assert.equal(interviewsGroup({ slots: [], students: [] }), null)
  assert.equal(placementGroup({ students: [], units: [], today: TODAY }), null)
  const s = needsYouSummary([null, null])
  assert.equal(s.items, 0); assert.equal(s.areas, 0)
})

test('NEEDS 3: signatures show only requests where it is the viewer\'s turn', () => {
  const requests = [
    { id: 'r1', title: 'Affiliation Attestation', status: 'progress', signing_order: 'sequential', sent_at: '2026-09-20T10:00:00' },
    { id: 'r2', title: 'Other', status: 'sent', signing_order: 'sequential', sent_at: '2026-09-20T10:00:00' },
    { id: 'r3', title: 'Done', status: 'completed', signing_order: 'sequential', sent_at: '2026-09-20T10:00:00' },
  ]
  const signers = [
    { request_id: 'r1', order_index: 0, recipient_type: 'signer', name: 'School', signed_at: '2026-09-23T10:00:00', user_profile_id: null },
    { request_id: 'r1', order_index: 1, recipient_type: 'signer', name: 'Me', signed_at: null, user_profile_id: 'me' },
    { request_id: 'r2', order_index: 0, recipient_type: 'signer', name: 'Someone', signed_at: null, user_profile_id: 'other' },
    { request_id: 'r2', order_index: 1, recipient_type: 'signer', name: 'Me', signed_at: null, user_profile_id: 'me' },
  ]
  const g = signaturesGroup({ requests, signers, meId: 'me', now: NOW_MS })
  assert.equal(g.rows.length, 1)
  assert.equal(g.rows[0].title, 'Affiliation Attestation')
  assert.match(g.rows[0].meta, /School signed Sep 23 · you countersign|School signed Sep 23 · you sign next/)
  assert.deepEqual(g.rows[0].pill, { text: 'Your turn', tone: 'plum' })
  assert.equal(g.rows[0].to, '/catalog/signatures?tab=requests&request=r1')
})

test('NEEDS 4: Review & Release rows are workflows, ready before blocked, opening that workflow', () => {
  const g = reviewReleaseGroup({ now: NOW_MS, workflows: [{ key: 'w1', label: 'Post-Rotation Casey-Fink' }, { key: 'w2', label: 'Preceptor Midpoint' }, { key: 'w3', label: 'Quiet' }], queues: {
    w1: { items: [{ state: 'blocked', since: '2026-09-10' }, { state: 'blocked', since: '2026-09-11' }] },
    w2: { items: [{ state: 'ready', since: '2026-09-20' }, { state: 'notEligible' }] },
    w3: { items: [{ state: 'notEligible' }] },
  } })
  assert.deepEqual(g.pills, [{ text: '1 ready', tone: 'green' }, { text: '2 blocked', tone: 'amber' }])
  assert.equal(g.rows[0].title, 'Preceptor Midpoint')
  assert.equal(g.rows[0].to, '/evaluation?workflow=w2')
  assert.equal(g.rows[1].pill.text, 'Blocked')
  assert.equal(g.count, 3)
})

test('NEEDS 5: forms and documents count overdue people per Catalog item', () => {
  const g = formsDocsGroup({ now: NOW_MS, items: [{ id: 'i1', slug: 'parking', title: 'Student Parking Request', kind: 'form' }, { id: 'i2', slug: 'ok', title: 'Fine', kind: 'form' }], trackerRows: [
    { id: 'i1', due_at: '2026-09-20T00:00:00', completed_at: null },
    { id: 'i1', due_at: '2026-09-20T00:00:00', completed_at: null },
    { id: 'i1', due_at: '2026-09-20T00:00:00', completed_at: '2026-09-19T00:00:00' },
    { id: 'i2', due_at: '2026-10-20T00:00:00', completed_at: null },
  ] })
  assert.deepEqual(g.pills, [{ text: '2 overdue', tone: 'red' }])
  assert.equal(g.rows.length, 1)
  assert.equal(g.rows[0].meta, '1 of 3 done · due Sep 20')
  assert.equal(g.rows[0].to, '/catalog?resource=parking')
})

test('NEEDS 6: interviews show today\'s slots and invited candidates with no slot', () => {
  const g = interviewsGroup({ now: NOW_MS, today: TODAY,
    slots: [{ id: 's1', slot_date: TODAY, slot_time: '21:30', duration_minutes: 30, students: { id: 'st1', first_name: 'Jordan', school: 'APU' } }],
    students: [
      { id: 'st2', first_name: 'Alexis', school: 'CSULA', status: 'Form Received', interview_scheduled_date: null },
      { id: 'st3', first_name: 'Nobody', school: 'CSULA', status: 'Form Received', interview_scheduled_date: null },
    ],
    communications: [{ student_id: 'st2', type: 'scheduling_link', sent_at: '2026-09-20T10:00:00' }],
    interviewerNameFor: () => 'Krystal', displayName: (s) => s.first_name,
  })
  assert.deepEqual(g.pills, [{ text: '1 today', tone: 'navy' }, { text: '1 unscheduled', tone: 'amber' }])
  const today = g.rows.find(r => r.id === 'iv:s1')
  assert.equal(today.meta, 'Today 9:30 PM · with Krystal')
  assert.equal(today.to, '/interviews?student=st1')
  const open = g.rows.find(r => r.id === 'iv-open:st2')
  assert.equal(open.pill.text, 'No slot')
  assert.equal(g.rows.some(r => r.id === 'iv-open:st3'), false, 'not invited yet is not unscheduled')
})

test('NEEDS 7: placement lists unplaced interviewed students and students behind pace; a row never carries an action', () => {
  const g = placementGroup({ now: NOW_MS, today: '2026-10-01',
    students: [
      { id: 'u1', first_name: 'Priya', school: 'CSULB', status: 'Interviewed', matched_unit_id: null, unit_preference_1: '5 SCCT' },
      { id: 'b1', first_name: 'Maya', school: 'CSULA', status: 'Active Rotation', matched_unit_id: 'un1', hours_required: 180, approved_hours: 40 },
      { id: 'ok', first_name: 'Dan', school: 'CSULA', status: 'Active Rotation', matched_unit_id: 'un1', hours_required: 180, approved_hours: 100 },
    ],
    units: [{ id: 'un1', unit_name: '4 South', is_participating: true, total_slots: 3 }],
    rotations: [{ school_name: 'CSULA', rotation_start_date: '2026-08-01', rotation_end_date: '2026-12-01' }],
    unitNameFor: () => '4 South', displayName: (s) => s.first_name,
  })
  assert.deepEqual(g.pills, [{ text: '1 open', tone: 'amber' }, { text: '1 unplaced', tone: 'amber' }, { text: '1 behind', tone: 'amber' }])
  assert.equal(g.rows.find(r => r.id === 'pl:u1').meta, 'Unplaced · 1st choice 5 SCCT')
  assert.equal(g.rows.find(r => r.id === 'hrs:b1').to, '/students?student=b1')
  for (const r of g.rows) {
    assert.ok(r.to, 'every row is navigation')
    assert.equal(r.action, undefined)
  }
})

test('NEEDS 8: a group shows its top three, and the chips, the summary and the filter follow the rules', () => {
  const convos = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, subject: 'S', participant_name: 'P', status: 'open', latest_author_role: 'student', assigned_staff_profile_id: 'x', last_message_at: `2026-09-1${i}T10:00:00` }))
  const g = messagesGroup({ conversations: convos, now: NOW_MS })
  assert.equal(g.rows.length, ROWS_PER_GROUP)
  assert.equal(g.total, 5)
  const groups = orderGroups([g, null])
  assert.equal(needsYouSummary(groups).caption, '5 items across 1 area')
  assert.deepEqual(filterChips(groups).map(c => c.label), ['All', 'Messages'])
  assert.equal(nextFilter('all', 'messages'), 'messages')
  assert.equal(nextFilter('messages', 'messages'), 'all', 'a second click on the active chip returns to All')
  assert.equal(visibleGroups(groups, 'messages').length, 1)
  assert.equal(visibleGroups(groups, 'signatures').length, 0)
  assert.equal(ageLabel('2026-09-24T01:00:00', NOW_MS), 'Today')
  assert.equal(ageLabel('2026-09-22T01:00:00', NOW_MS), '2d')
})

// ── Today ────────────────────────────────────────────────────────────────────

test('TODAY 1: On campus groups by shift with the canonical window times and marks the group in progress', () => {
  assert.equal(shiftGroupLabel('Day'), 'Day shift · 7:00 AM to 7:30 PM')
  assert.equal(shiftGroupLabel('Night'), 'Night shift · 7:00 PM to 7:30 AM')
  assert.equal(shiftGroupState('Day', TODAY, NOW), 'ended')
  assert.equal(shiftGroupState('Night', TODAY, NOW), 'live')
  const r = onCampusGroups({ today: TODAY, now: NOW,
    students: [
      { id: 'a', first_name: 'Maya', last_name: 'Okafor', matched_unit_id: 'u', hours_required: 180, approved_hours: 104 },
      { id: 'b', first_name: 'Noah', last_name: 'Bennett', matched_unit_id: 'u', hours_required: 180, approved_hours: 110, shift_assigned: 'Night' },
    ],
    logs: [{ student_id: 'a', shift_type: 'Day', unit_name: '4 South', preceptor_name: 'Hannah Lee' }],
    plans: [{ student_id: 'b', preceptor_name: 'Tessa Morgan' }],
    unitNameFor: () => '4 North', displayName: (s) => `${s.first_name} ${s.last_name}`,
  })
  assert.equal(r.count, 2)
  assert.deepEqual(r.groups.map(g => [g.key, g.state, g.rows.length]), [['Day', 'ended', 1], ['Night', 'live', 1]])
  assert.equal(r.groups[0].rows[0].meta, '4 South · with Hannah Lee')
  assert.equal(r.groups[0].rows[0].hours, '104 of 180 h')
  assert.equal(r.groups[1].rows[0].source, 'plan', 'a planned shift shows before hours are logged')
  assert.equal(initialsOf('Maya Okafor'), 'MO')
})

test('TODAY 1b: a planned shift takes its preceptor\'s shift, then the assigned preceptor\'s, then the student\'s', () => {
  const byName = new Map([['tessa morgan', { full_name: 'Tessa Morgan', shift_type: 'Night' }], ['vari able', { full_name: 'Vari Able', shift_type: 'Variable' }]])
  assert.equal(plannedShiftType({ plan: { preceptor_name: '  Tessa   Morgan ' }, student: { shift_assigned: 'Day' }, preceptorsByName: byName }), 'Night')
  assert.equal(plannedShiftType({ plan: { preceptor_name: 'Vari Able' }, student: {}, preceptorsByName: byName, assignedPreceptorShift: 'Night' }), 'Night', 'Variable says nothing about today')
  assert.equal(plannedShiftType({ plan: { preceptor_name: 'Unknown' }, student: { shift_assigned: 'Night shift' }, preceptorsByName: byName }), 'Night')
  assert.equal(plannedShiftType({ plan: { preceptor_name: 'Unknown' }, student: {}, preceptorsByName: byName }), 'Day')
})

test('TODAY 0: Today opens on the view that has something in it', () => {
  assert.equal(defaultTodayView(5, 9), 'schedule')
  assert.equal(defaultTodayView(0, 1), 'campus')
  assert.equal(defaultTodayView(0, 0), 'schedule')
  assert.equal(defaultTodayView(2, 0), 'schedule')
})

test('NEEDS 9: a group shows more rows when fewer areas share the width', () => {
  const g = { allRows: Array.from({ length: 10 }, (_, i) => ({ id: String(i) })), rows: [] }
  assert.deepEqual([rowsFor(g, 1).rows.length, rowsFor(g, 1).more, rowsFor(g, 1).wide], [8, 2, true])
  assert.deepEqual([rowsFor(g, 2).rows.length, rowsFor(g, 2).more, rowsFor(g, 2).wide], [5, 5, false])
  assert.deepEqual([rowsFor(g, 4).rows.length, rowsFor(g, 4).more], [3, 7])
  assert.equal(rowsFor({ allRows: [{ id: 'a' }] }, 1).wide, false, 'one row is not split into columns')
})

test('TODAY 2: the schedule merges interviews, events, holidays and due dates, in time order, and marks the item in progress', () => {
  const rows = scheduleRows({ today: TODAY, now: new Date('2026-09-24T14:10:00'),
    interviews: [
      { id: 's1', slot_date: TODAY, slot_time: '09:00', duration_minutes: 30, students: { id: 'r', first_name: 'Riley', school: 'APU' } },
      { id: 's2', slot_date: TODAY, slot_time: '14:00', duration_minutes: 30, students: { id: 'j', first_name: 'Jordan', school: 'APU' } },
    ],
    events: [
      { id: 'e1', title: 'ASPIRE town hall', event_type: 'town_hall', start_at: '2026-09-24T12:00:00', end_at: '2026-09-24T13:00:00', location: 'Harvey Morse' },
      { id: 'e2', title: 'Elsewhere', event_type: 'custom', start_at: '2026-09-25T12:00:00' },
    ],
    holidays: [],
    dueItems: [{ id: 'd', title: 'Midpoint assessments', kind: 'form', count: 4, slug: 'mid' }],
    interviewerNameFor: () => 'Jester', displayName: (s) => s.first_name,
  })
  assert.deepEqual(rows.map(r => r.time), ['All day', '9:00 AM', '12:00 PM', '2:00 PM'])
  assert.deepEqual(rows.map(r => r.tag), ['Due', 'Interview', 'Event', 'Interview'])
  assert.equal(rows[3].inProgress, true)
  assert.equal(rows[1].inProgress, false)
  assert.equal(rows[2].meta, 'Harvey Morse')
})

test('TODAY 3: due today is read from the tracker rows', () => {
  const items = dueTodayItems([{ id: 'i', due_at: '2026-09-24T23:00:00', completed_at: null }, { id: 'i', due_at: '2026-09-24T23:00:00', completed_at: '2026-09-20' }, { id: 'j', due_at: '2026-09-25T00:00:00' }], [{ id: 'i', title: 'Parking', slug: 'p', kind: 'form' }, { id: 'j', title: 'J', slug: 'j', kind: 'form' }], TODAY)
  assert.deepEqual(items, [{ id: 'i', title: 'Parking', slug: 'p', kind: 'form', count: 1 }])
})

// ── Cohort pulse ─────────────────────────────────────────────────────────────

test('PULSE 1: clinical hours read the one pace rule; the bar names all three numbers', () => {
  const b = hoursBar({ today: '2026-10-01', rotations: [{ school_name: 'S', rotation_start_date: '2026-08-01', rotation_end_date: '2026-12-01' }], students: [
    { status: 'Active Rotation', school: 'S', hours_required: 180, approved_hours: 120 },
    { status: 'Active Rotation', school: 'S', hours_required: 180, approved_hours: 80 },
    { status: 'Active Rotation', school: 'S', hours_required: 180, approved_hours: 20 },
    { status: 'Placed', school: 'S', hours_required: 180, approved_hours: 0 },
  ] })
  assert.equal(b.headline, '1 of 3 past midpoint')
  assert.equal(b.sub, '1 on track · 1 behind pace')
  assert.equal(b.ariaLabel, '1 past midpoint, 1 on track, 1 behind')
  assert.equal(b.segments.length, 3)
})

test('PULSE 2: midpoint assessments count the preceptor midpoint assignments', () => {
  const inst = { slug: 'preceptor_progress' }
  const b = midpointBar({ readyToRelease: 2, assignments: [
    { timepoint: 'midpoint', completed_at: '2026-09-20', evaluation_instruments: inst },
    { timepoint: 'midpoint', completed_at: null, evaluation_instruments: inst },
    { timepoint: 'post_rotation', completed_at: null, evaluation_instruments: inst },
    { timepoint: 'midpoint', completed_at: null, evaluation_instruments: { slug: 'other' } },
  ] })
  assert.equal(b.headline, '1 of 4 submitted')
  assert.equal(b.sub, '1 awaiting preceptor · 2 ready to release')
})

// ── Placement ────────────────────────────────────────────────────────────────

test('PLACEMENT 1: one summary line, every clause from data, a clause with no data omitted', () => {
  const units = [{ id: 'u1', unit_name: '4 South', is_participating: true, total_slots: 2, division: 'Medical' }, { id: 'u2', unit_name: 'CSICU', is_participating: true, total_slots: 1, division: 'Critical Care' }]
  const students = [{ id: 'a', status: 'Placed', matched_unit_id: 'u2' }, { id: 'b', status: 'Placed', matched_unit_id: 'u1' }, { id: 'c', status: 'Declined', matched_unit_id: null }]
  const s = placementSummary({ students, units, matches: [{ student_id: 'a', unit_id: 'u2', notification_sent: true }, { student_id: 'b', unit_id: 'u1', notification_sent: false }] })
  assert.deepEqual(s.clauses.map(c => c.text), ['2 of 3 slots filled', '1 open slot (Medical)', 'Every proceeding student placed', '1 unit leader notified'])
  const noMatches = placementSummary({ students, units, matches: null })
  assert.equal(noMatches.clauses.some(c => c.key === 'notified'), false, 'no matches loaded, no notified clause')
  const empty = placementSummary({ students: [], units: [] })
  assert.deepEqual(empty.clauses, [])
})

test('PLACEMENT 2: capacity by service line and requests by school', () => {
  const units = [{ id: 'u1', unit_name: '4 South', is_participating: true, total_slots: 2, division: 'Medical' }, { id: 'u2', unit_name: 'CSICU', is_participating: true, total_slots: 1, division: 'Critical Care' }, { id: 'u3', is_participating: false, total_slots: 9, division: 'Medical' }]
  const students = [{ id: 'a', school: 'APU', matched_unit_id: 'u2' }, { id: 'b', school: 'APU', matched_unit_id: null }, { id: 'c', school: 'CSULA', matched_unit_id: 'u1' }]
  const cap = capacityByServiceLine({ units, students, order: ['Critical Care', 'Medical'] })
  assert.deepEqual(cap.map(r => [r.serviceLine, r.filled, r.slots]), [['Critical Care', 1, 1], ['Medical', 1, 2]])
  const req = requestsBySchool({ students })
  assert.deepEqual(req.map(r => [r.school, r.placed, r.students]), [['APU', 1, 2], ['CSULA', 1, 1]])
})

test('PLACEMENT 2b: capacity uses canonical service lines and the selected status rows', () => {
  const units = [
    { id: 'nicu', unit_name: 'NICU', is_participating: true, total_slots: 1, division: 'Specialty' },
    { id: 'peds', unit_name: 'Pediatrics', is_participating: true, total_slots: 1, division: 'Specialty' },
    { id: 'picu', unit_name: 'PICU', is_participating: true, total_slots: 1, division: 'Specialty' },
    { id: 'pacu', unit_name: 'PACU', is_participating: false, total_slots: 0, division: 'Procedural' },
  ]
  const students = [
    { matched_unit_id: 'nicu' }, { matched_unit_id: 'peds' }, { matched_unit_id: 'picu' },
  ]
  const allRows = [
    { id: 'r1', unit_id: 'nicu', unit_name: 'NICU', capacity_status: 'hosting' },
    { id: 'r2', unit_id: 'peds', unit_name: 'Pediatrics', capacity_status: 'hosting' },
    { id: 'r3', unit_id: 'picu', unit_name: 'PICU', capacity_status: 'hosting' },
    { id: 'r4', unit_id: 'pacu', unit_name: 'PACU', capacity_status: 'pending' },
  ]
  const divisionOf = unit => getUnit(unit?.unit_name)?.division || unit?.division || 'Other'
  const hosting = filteredCapacityByServiceLine({
    capacityRows: allRows.filter(row => row.capacity_status === 'hosting'),
    units, students, divisionOf,
  })
  assert.deepEqual(hosting.map(row => [row.serviceLine, row.filled, row.slots]), [['Women & Children', 3, 3]])

  const pending = filteredCapacityByServiceLine({
    capacityRows: allRows.filter(row => row.capacity_status === 'pending'),
    units, students, divisionOf,
  })
  assert.deepEqual(pending.map(row => [row.serviceLine, row.filled, row.slots]), [['Procedural', 0, 0]])
})

// ── Launcher ─────────────────────────────────────────────────────────────────

test('LAUNCHER 1: six quick actions in a fixed order, filtered by permission, never offered disabled', () => {
  assert.deepEqual(QUICK_ACTION_KEYS, ['sign', 'form', 'outreach', 'interview', 'file', 'contact'])
  const admin = allowedActions({ isAdmin: true, canInterview: true, canMatch: true, signatures: true, forms: true })
  assert.deepEqual(quickActions(admin).map(a => a.title), ['Send for signature', 'Build a form', 'Send outreach', 'Schedule an interview', 'Send a file', 'Add a contact'])
  const interviewer = allowedActions({ isAdmin: false, canInterview: true, canMatch: false, signatures: false, forms: false })
  assert.deepEqual(interviewer.map(a => a.key), ['interview', 'shift', 'board'])
  const noFlag = allowedActions({ isAdmin: true, canInterview: true, canMatch: true, signatures: false, forms: true })
  assert.equal(noFlag.some(a => a.key === 'sign'), false, 'the signatures flag hides Send for signature')
  assert.equal(allowedActions({ isAdmin: true, isActive: false }).length, 0)
  assert.equal(ACTIONS.length, 12)
})

test('LAUNCHER 2: results come in three groups, capped, Keith always last; empty query, no results', () => {
  const actions = allowedActions({ isAdmin: true, canInterview: true, canMatch: true, signatures: true, forms: true })
  const people = personRows({
    students: [{ id: 's1', first_name: 'Maya', school: 'Cal State LA', matched_unit_id: 'u' }, { id: 's2', first_name: 'Mason', school: 'APU', status: 'Interviewed', matched_unit_id: null }],
    contacts: [{ id: 'c1', full_name: 'Maria Santos', category: 'Unit Leader', unit_name: '6 NE' }, { id: 'c2', full_name: 'Gone', category: 'Preceptor', is_active: false }],
    unitNameFor: (id) => (id ? '4 South' : ''), displayName: (s) => s.first_name,
  })
  assert.equal(people.find(p => p.id === 'student:s1').qualifier, 'Student · Cal State LA · 4 South')
  assert.equal(people.find(p => p.id === 'student:s2').qualifier, 'Student · APU · Unplaced')
  assert.equal(people.find(p => p.id === 'contact:c1').qualifier, 'Unit leader · 6 NE')
  assert.equal(people.some(p => p.id === 'contact:c2'), false)
  const r = searchLauncher('ma', { actions, people })
  assert.equal(r.options[r.options.length - 1].kind, 'keith')
  assert.equal(r.groups.people.length, 3)
  assert.ok(r.groups.actions.length <= 5)
  assert.equal(searchLauncher('', { actions, people }).options.length, 0)
  const send = searchLauncher('send', { actions, people })
  assert.ok(send.groups.actions.every(a => /send/i.test(`${a.title} ${a.where}`)))
  assert.equal(searchLauncher('x', { actions, people, canAskKeith: false }).options.some(o => o.kind === 'keith'), false)
})

test('LAUNCHER 3: selection wraps and the greeting follows the viewer\'s clock', () => {
  assert.equal(moveSelection(0, -1, 4), 3)
  assert.equal(moveSelection(3, 1, 4), 0)
  assert.equal(moveSelection(0, 1, 0), -1)
  assert.equal(greetingFor(new Date('2026-09-24T08:00:00'), 'Jester'), 'Good morning, Jester')
  assert.equal(greetingFor(new Date('2026-09-24T13:00:00'), 'Jester'), 'Good afternoon, Jester')
  assert.equal(greetingFor(new Date('2026-09-24T20:46:00'), 'Jester'), 'Good evening, Jester')
})

// ── Recent activity ──────────────────────────────────────────────────────────

test('ACTIVITY 2: the viewer is matched by profile id or by email, whatever the source recorded', () => {
  const at = new Date(NOW_MS - 3600000).toISOString()
  const events = [
    { id: 'sig', kind: 'signed', at, actorProfileId: 'me', actorEmail: 'someone@else.org', sentence: {} },
    { id: 'out', kind: 'outreach', at, actorEmail: 'Jester@Example.org', sentence: {} },
    { id: 'form', kind: 'form', at, actorEmail: 'student@school.edu', sentence: {} },
    { id: 'eval', kind: 'assessment', at, actorEmail: null, actorName: 'A preceptor', sentence: {} },
  ]
  const rows = activityRows(events, { id: 'me', email: 'jester@example.org' }, NOW_MS)
  assert.deepEqual(rows.map(r => r.id).sort(), ['eval', 'form'])
})

test('ACTIVITY 3: the endpoint records an actor for every source and reads the bulk send\'s real keys', () => {
  const ep = readFileSync(new URL('../api/home-activity.js', import.meta.url), 'utf8')
  assert.match(ep, /actorProfileId: last\?\.user_profile_id \|\| null, actorEmail: last\?\.email \|\| null/)
  assert.match(ep, /actorEmail: a\?\.email \|\| null/)
  assert.match(ep, /actorEmail: r\.respondent_email \|\| null/)
  assert.match(ep, /senderEmail: r\.metadata\?\.sent_by_email/)
  // The key the bulk send actually writes.
  assert.match(readFileSync(new URL('../api/connect-send-bulk-message.js', import.meta.url), 'utf8'), /sent_by_email:\s+senderEmail/)
})

test('ACTIVITY: last 24 hours, newest first, at most eight, never the viewer\'s own', () => {
  const at = (h) => new Date(NOW_MS - h * 3600000).toISOString()
  const events = [
    { id: '1', kind: 'signed', at: at(1), actorProfileId: 'other', sentence: { actor: 'Sofia', post: ' signed' } },
    { id: '2', kind: 'form', at: at(2), actorProfileId: 'me', sentence: { actor: 'Me', post: ' submitted' } },
    { id: '3', kind: 'resolved', at: at(30), actorProfileId: 'other', sentence: { actor: 'Old', post: ' resolved' } },
    { id: '4', kind: 'assessment', at: at(3), actorEmail: 'jester@example.org', sentence: { actor: 'Jester Bautista', post: ' submitted' } },
    ...Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, kind: 'outreach', at: at(4 + i / 10), actorProfileId: 'o', sentence: { actor: 'O', post: '' } })),
  ]
  const rows = activityRows(events, { id: 'me', email: 'jester@example.org' }, NOW_MS)
  assert.equal(rows.length, ACTIVITY_LIMIT)
  assert.equal(rows[0].id, '1')
  assert.equal(rows.some(r => r.id === '2'), false)
  assert.equal(rows.some(r => r.id === '3'), false)
  assert.equal(rows.some(r => r.id === '4'), false)
  assert.equal(rows[0].icon, 'check')
})
