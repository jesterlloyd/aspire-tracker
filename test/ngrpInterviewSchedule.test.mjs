// NGRP-INTERVIEWS-1 Phase 4: Residency > Interview Schedule. HR adds times and books the paired
// applicants; each booking, move and cancel follows into the binder and emails a calendar invite.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { bookInterview, cancelInterview, unitLeaderRecipients, scheduleInterviewees } from '../lib/server/ngrpInterviewSchedule.js'
import { interviewNoticeEmail, interviewIcs } from '../lib/server/email/ngrpInterviewEmail.js'
import { bookingChoices, scheduleCounts, noticeSummary } from '../src/lib/ngrp/interviewScheduleModel.js'
import { NGRP_TABS } from '../src/lib/ngrp/ngrpTabs.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const CY = '11111111-1111-4111-8111-111111111111'
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// A small in-memory PostgREST: select / eq / in / order / limit / maybeSingle, update and insert.
function fakeDb(tables) {
  const from = name => {
    const rows = tables[name] || (tables[name] = [])
    let filters = [], patch = null, insert = null, wantRows = false
    const match = r => filters.every(f => f(r))
    const q = {
      select() { wantRows = true; return q },
      eq(k, v) { filters.push(r => r[k] === v); return q },
      in(k, vs) { filters.push(r => vs.includes(r[k])); return q },
      order() { return q }, limit() { return q },
      update(p) { patch = p; return q },
      insert(p) { insert = p; return q },
      maybeSingle() { return run().then(r => ({ data: r.data?.[0] || null, error: null })) },
      single() { return run().then(r => ({ data: r.data?.[0] || null, error: null })) },
      then(res, rej) { return run().then(res, rej) },
    }
    const run = async () => {
      if (insert) { for (const x of [].concat(insert)) rows.push({ ...x }); return { data: [].concat(insert), error: null } }
      const hit = rows.filter(match)
      if (patch) { for (const r of hit) Object.assign(r, patch); return { data: wantRows ? hit.map(r => ({ ...r })) : null, error: null } }
      return { data: hit.map(r => ({ ...r })), error: null }
    }
    return q
  }
  return { from, tables }
}

const slot = (n, extra = {}) => ({ id: id(n), block_id: id(900), cycle_id: CY, unit_key: '6 NE', slot_at: `2026-11-0${n}T16:00:00.000Z`, duration_minutes: 30, status: 'available', booked_candidate_id: null, ...extra })
const cand = (n, extra = {}) => ({ id: id(100 + n), cycle_id: CY, student_id: id(200 + n), assigned_unit: '6 NE', interview_status: 'not_scheduled', interview_at: null, interview_mode: null, ...extra })
const world = () => fakeDb({
  ngrp_interview_slots: [slot(1), slot(2), slot(3, { unit_key: '5 North' })],
  ngrp_interview_blocks: [{ id: id(900), interview_mode: 'virtual' }],
  ngrp_candidates: [cand(1), cand(2, { assigned_unit: '5 North' }), cand(3, { interview_status: 'completed' })],
  ngrp_audit_events: [],
})
const profile = { id: id(500) }

test('SCHED 1: booking a paired applicant claims the time and puts it in the binder', async () => {
  const db = world()
  const r = await bookInterview(db, { cycleId: CY, profile, slotId: id(1), candidateId: id(101), nowIso: '2026-10-06T00:00:00.000Z' })
  assert.equal(r.status, 200); assert.equal(r.kind, 'booked')
  const s = db.tables.ngrp_interview_slots.find(x => x.id === id(1))
  assert.equal(s.status, 'booked'); assert.equal(s.booked_candidate_id, id(101)); assert.equal(s.booked_by_profile_id, profile.id)
  const c = db.tables.ngrp_candidates.find(x => x.id === id(101))
  assert.equal(c.interview_status, 'scheduled'); assert.equal(c.interview_at, s.slot_at)
  assert.equal(c.interview_mode, 'virtual', 'the span\'s format becomes the interview\'s')
  assert.equal(db.tables.ngrp_audit_events.at(-1).event_type, 'interview_booked')
})

test('SCHED 2: booking someone who holds a time moves them; the old time opens again', async () => {
  const db = world()
  await bookInterview(db, { cycleId: CY, profile, slotId: id(1), candidateId: id(101) })
  const r = await bookInterview(db, { cycleId: CY, profile, slotId: id(2), candidateId: id(101) })
  assert.equal(r.kind, 'moved'); assert.equal(r.previous.id, id(1))
  const [a, b] = db.tables.ngrp_interview_slots
  assert.equal(a.status, 'available'); assert.equal(a.booked_candidate_id, null)
  assert.equal(b.status, 'booked')
  assert.equal(db.tables.ngrp_candidates[0].interview_at, b.slot_at)
})

test('SCHED 3: refusals: not paired with the unit, a taken time, a result already recorded, another cohort', async () => {
  const db = world()
  assert.equal((await bookInterview(db, { cycleId: CY, profile, slotId: id(1), candidateId: id(102) })).error, 'not_paired')
  assert.equal((await bookInterview(db, { cycleId: CY, profile, slotId: id(1), candidateId: id(103) })).error, 'interview_recorded')
  await bookInterview(db, { cycleId: CY, profile, slotId: id(1), candidateId: id(101) })
  db.tables.ngrp_candidates.push(cand(4))
  assert.equal((await bookInterview(db, { cycleId: CY, profile, slotId: id(1), candidateId: id(104) })).error, 'slot_taken')
  assert.equal((await bookInterview(db, { cycleId: id(7), profile, slotId: id(2), candidateId: id(104) })).status, 404)
})

test('SCHED 4: cancelling opens the time and clears the binder only while it is still this booking', async () => {
  const db = world()
  await bookInterview(db, { cycleId: CY, profile, slotId: id(1), candidateId: id(101) })
  const r = await cancelInterview(db, { cycleId: CY, profile, slotId: id(1) })
  assert.equal(r.status, 200)
  assert.equal(db.tables.ngrp_interview_slots[0].status, 'available')
  const c = db.tables.ngrp_candidates[0]
  assert.equal(c.interview_status, 'not_scheduled'); assert.equal(c.interview_at, null)
  assert.equal(db.tables.ngrp_audit_events.at(-1).event_type, 'interview_booking_cancelled')
  assert.equal((await cancelInterview(db, { cycleId: CY, profile, slotId: id(1) })).idempotent, true)
})

test('SCHED 5: unit leaders are the active unit-scoped portal grants, matched like 6NE = 6 NE', async () => {
  const db = fakeDb({
    user_unit_scopes: [
      { user_profile_id: 'a', unit_key: '6NE', revoked_at: null }, { user_profile_id: 'b', unit_key: '6 NE', revoked_at: '2026-01-01' },
      { user_profile_id: 'c', unit_key: '5 North', revoked_at: null }, { user_profile_id: 'd', unit_key: '6 NE', revoked_at: null },
    ],
    user_role_grants: [{ user_profile_id: 'a', role: 'unit_leader', revoked_at: null }, { user_profile_id: 'd', role: 'unit_leader', revoked_at: '2026-01-01' }],
    user_profiles: [{ id: 'a', full_name: 'Dana Whitfield', email: 'dana@x.org', is_active: true }, { id: 'd', full_name: 'Old', email: 'o@x.org', is_active: true }],
  })
  assert.deepEqual((await unitLeaderRecipients(db, '6 NE')).map(r => r.email), ['dana@x.org'])
})

test('SCHED 6: the invite updates one event per applicant, and a cancel cancels it', () => {
  const s = { slot_at: '2026-11-02T16:00:00.000Z', duration_minutes: 30 }
  const a = interviewIcs({ kind: 'booked', candidateId: 'c1', unit: '6 NE', slot: s, applicantName: 'Jordan Reyes', mode: 'virtual', nowIso: '2026-10-06T00:00:00Z' })
  const b = interviewIcs({ kind: 'cancelled', candidateId: 'c1', unit: '6 NE', slot: s, applicantName: 'Jordan Reyes', nowIso: '2026-10-07T00:00:00Z' })
  assert.match(a, /UID:ngrp-interview-c1@aspire-program\.com/); assert.match(b, /UID:ngrp-interview-c1@aspire-program\.com/)
  assert.match(a, /DTSTART:20261102T160000Z/); assert.match(a, /DTEND:20261102T163000Z/)
  assert.match(b, /METHOD:CANCEL/); assert.match(b, /STATUS:CANCELLED/)
  const seq = t => Number(t.match(/SEQUENCE:(\d+)/)[1])
  assert.ok(seq(b) > seq(a), 'a later change carries a higher SEQUENCE')
})

test('SCHED 7: the emails name the unit and time in Pacific, and escape names', () => {
  const slot0 = { slot_at: '2026-11-02T16:00:00.000Z', duration_minutes: 30 }
  const al = interviewNoticeEmail({ kind: 'booked', audience: 'alumnus', applicant: { first_name: '<b>J</b>', last_name: 'R' }, unit: '6 NE', slot: slot0, mode: 'virtual' })
  assert.equal(al.subject, 'Your Residency Interview Is Scheduled')
  assert.match(al.html, /8:00 AM Pacific Time/, "Nov 2 is after DST ends: 16:00Z is 8 AM PST"); assert.doesNotMatch(al.html, /<b>J<\/b>/)
  const un = interviewNoticeEmail({ kind: 'moved', audience: 'unit', applicant: { first_name: 'Jordan', last_name: 'Reyes' }, unit: '6 NE', slot: slot0, previous: { slot_at: '2026-11-01T16:00:00.000Z' } })
  assert.match(un.subject, /^Interview moved: Jordan Reyes, /); assert.match(un.html, /Moved from/)
})

test('SCHED 8: the book list is the unit\'s paired applicants; a result locks them; counts and toast', () => {
  const people = scheduleInterviewees([
    { candidate_id: 'c1', assigned_unit: '6 NE', student: { first_name: 'A', last_name: 'Zed' }, staff_unit_preferences: ['6 NE'] },
    { candidate_id: 'c2', assigned_unit: '6NE', student: { first_name: 'B', last_name: 'Abe' } },
    { candidate_id: 'c3', assigned_unit: '6 NE', student: { first_name: 'C', last_name: 'Cy' }, interview_status: 'completed' },
    { candidate_id: 'c4', assigned_unit: '5 North', student: { first_name: 'D', last_name: 'Dee' } },
    { candidate_id: 'c5', assigned_unit: null, student: { first_name: 'E', last_name: 'Eve' } },
  ])
  assert.equal(people.length, 4, 'unpaired alumni are not on the schedule')
  const slots = [{ id: 's1', unit_key: '6 NE', status: 'booked', booked: true, booked_candidate_id: 'c2', slot_at: '2026-11-02T16:00:00Z' }, { id: 's2', unit_key: '6 NE', status: 'available', slot_at: '2026-11-02T17:00:00Z' }]
  const choices = bookingChoices(people, slots, slots[1])
  assert.deepEqual(choices.map(c => [c.last_name, c.action]), [['Zed', 'book'], ['Abe', 'move'], ['Cy', null]])
  assert.deepEqual(scheduleCounts(people, slots, '6 NE'), { paired: 3, booked: 1, open: 1 })
  assert.match(noticeSummary([{ audience: 'alumnus', ok: true }, { audience: 'unit_leader', ok: true }]), /Emailed the applicant and 1 unit leader/)
  assert.match(noticeSummary([{ audience: 'alumnus', ok: false, reason: 'no_email' }]), /No email is on file.*No unit leader/)
})

test('SCHED 9: one calendar per portal: the schedule lives on the Residency Calendar and the Unit Leader\'s At a Glance', () => {
  // ONE-CALENDAR-1 (Owner, 2026-10-06): no Interview Schedule sub-tab, no second calendar anywhere.
  const subs = NGRP_TABS.find(t => t.id === 'residency').subTabs.map(s => s.id)
  assert.deepEqual(subs, ['board', 'residents', 'activity'])
  assert.equal(existsSync(new URL('../src/components/ngrp/InterviewScheduleTab.jsx', import.meta.url)), false)
  assert.equal(existsSync(new URL('../src/components/ngrp/InterviewTimesCalendar.jsx', import.meta.url)), false)
  const manage = read('api/ngrp-manage.js')
  for (const a of ['schedule_open_times', 'schedule_remove_times', 'schedule_slot_block', 'schedule_book', 'schedule_cancel']) assert.match(manage, new RegExp(`'${a}'`))
  assert.match(manage, /\.\.\.SCHEDULE_ACTIONS/, 'listed in ACTIONS, or every call answers invalid_action')
  assert.match(read('api/ngrp-workspace.js'), /'schedule'\]\)/)
  // The Residency Calendar draws the times, books, and offers Month | Week.
  const cal = read('src/components/ngrp/ActivityCalendar.jsx')
  for (const p of [/useInterviewSchedule/, /InterviewDayChips/, /InterviewSlotRow/, /BookDialog/, /OpenTimesModal/, /CanonicalWeekView/, /schedule_book/, /schedule_cancel/]) assert.match(cal, p)
  // The Unit Leader's one calendar switches Internship | Residency and Month | Week.
  const ul = read('src/portal/unit/UnitRotationCalendar.jsx')
  for (const p of [/value: 'internship'/, /value: 'residency'/, /CanonicalWeekView/, /InterviewDayChips/, /OpenTimesModal/, /RemoveTimesAction/]) assert.match(ul, p)
  assert.match(read('src/portal/UnitLeaderPortal.jsx'), /interviewActions=\{interviewActions\}/, 'At a Glance hands the calendar the Interviews endpoint\'s writes')
  // The Interviews tab has no calendar of its own.
  const tab = read('src/portal/unit/UnitInterviewsWorkspace.jsx')
  for (const p of [/CanonicalCalendarLayout/, /InterviewTimesCalendar/, /OpenTimesModal/, /pl-monthgrid/]) assert.doesNotMatch(tab, p)
  // The main app's Interviews week lands on its first interview.
  assert.match(read('src/components/InterviewCalendar.jsx'), /weekScrollTop\(/)
})
