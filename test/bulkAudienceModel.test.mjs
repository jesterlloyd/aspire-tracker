// BULK-EXACT-RECIPIENTS-1 (P0): the client audience model, behaviorally.
//
// THE INCIDENT: a bulk send reached 12 recipients when exactly 6 were reviewed
// (Aug 14, 2026, ~5:08 PM). The extras were stale selections restored from a
// saved draft and hidden by the active tab/filter view. These tests pin the
// audience model that prevents a recurrence: the payload is a pure projection
// of the reviewed audience, select-all touches only what is shown, hidden
// selections are always countable, and Not Proceeding students never travel
// without an explicit acknowledgment.
//
// Run: node --test test/bulkAudienceModel.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCombinedRecipients, selectableShownStudentIds, visibleSelectionSplit,
  notProceedingRecipients, buildPayloadRecipients, studentToRecipient,
  contactToRecipient, NOT_PROCEEDING_STATUS,
} from '../src/lib/connect/bulkAudience.js'

// ── Fixtures mirroring the incident shape (synthetic identities) ────────────
const wcu = (n, status = 'Placed') => ({
  id: `wcu-${n}`, first_name: `WcuFirst${n}`, last_name: `WcuLast${n}`,
  school: 'West Coast University - North Hollywood', status,
  school_email: `wcu${n}@student.example.edu`, personal_email: `wcu${n}@personal.example.com`,
})
const csulb = (n) => ({
  id: `csulb-${n}`, first_name: `CsulbFirst${n}`, last_name: `CsulbLast${n}`,
  school: 'Cal State Long Beach', status: 'Interviewed',
  school_email: `csulb${n}@student.csulb.example.edu`, personal_email: null,
})
const coordinator = (n, cat = 'Academic Partners') => ({
  id: `contact-${n}`, full_name: `Coordinator ${n}`, preferred_name: null,
  email: `coordinator${n}@example.org`, category: cat,
  school_name: n <= 2 ? 'West Coast University' : 'Another University',
  organization: 'University Partner Office', is_active: true,
})

const STUDENTS = [wcu(1), wcu(2), wcu(3), wcu(4, NOT_PROCEEDING_STATUS), csulb(1), csulb(2), csulb(3)]
const CONTACTS = [coordinator(1), coordinator(2), coordinator(3), coordinator(4)]

// ── The exact-payload guarantee ─────────────────────────────────────────────

test('INCIDENT REGRESSION: selecting the intended six produces a payload of exactly those six', () => {
  const krystal = {
    email: 'krystal@example.org', normEmail: 'krystal@example.org',
    name: 'Krystal Sophia Rodriguez', firstName: 'Krystal', school: null,
    source: 'manual', studentId: null, contactId: null,
  }
  const { recipients } = buildCombinedRecipients({
    studentSel: new Set(['wcu-1', 'wcu-2', 'wcu-3']),
    contactSel: new Set(['contact-1', 'contact-2']),
    picked: [krystal],
    students: STUDENTS, contacts: CONTACTS, emailSource: 'school',
  })
  const payload = buildPayloadRecipients(recipients)
  assert.equal(payload.length, 6, 'exactly six - never more')
  assert.deepEqual(
    payload.map(p => p.email).sort(),
    ['coordinator1@example.org', 'coordinator2@example.org', 'krystal@example.org',
      'wcu1@student.example.edu', 'wcu2@student.example.edu', 'wcu3@student.example.edu'],
  )
  // Unselected CSULB students, the Not Proceeding WCU student, and the other
  // coordinators exist in the data yet never appear: selection is the ONLY door.
  for (const p of payload) {
    assert.doesNotMatch(p.email, /csulb/, 'an unselected student can never enter the payload')
    assert.notEqual(p.email, 'wcu4@student.example.edu')
    assert.notEqual(p.email, 'coordinator3@example.org')
  }
})

test('the payload is a pure projection: same length, same order, same emails as the reviewed audience', () => {
  const { recipients } = buildCombinedRecipients({
    studentSel: new Set(['wcu-1', 'csulb-1']), contactSel: new Set(['contact-3']),
    picked: [], students: STUDENTS, contacts: CONTACTS, emailSource: 'school',
  })
  const payload = buildPayloadRecipients(recipients)
  assert.equal(payload.length, recipients.length)
  assert.deepEqual(payload.map(p => p.email), recipients.map(r => r.email))
})

test('a stale selected id (cohort switch, deleted record) is dropped, never guessed', () => {
  const { recipients } = buildCombinedRecipients({
    studentSel: new Set(['wcu-1', 'gone-student']), contactSel: new Set(['gone-contact']),
    picked: [], students: STUDENTS, contacts: CONTACTS, emailSource: 'school',
  })
  assert.deepEqual(recipients.map(r => r.email), ['wcu1@student.example.edu'])
})

test('student and contact selections cannot leak into one another', () => {
  const { recipients } = buildCombinedRecipients({
    studentSel: new Set(['contact-1']),   // a contact id in the student store resolves to nothing
    contactSel: new Set(['wcu-1']),       // and vice versa
    picked: [], students: STUDENTS, contacts: CONTACTS, emailSource: 'school',
  })
  assert.equal(recipients.length, 0)
})

test('a student without an email for the chosen source is excluded, not rerouted', () => {
  const { recipients } = buildCombinedRecipients({
    studentSel: new Set(['csulb-1']),   // csulb-1 has no personal email
    contactSel: new Set(), picked: [],
    students: STUDENTS, contacts: CONTACTS, emailSource: 'personal',
  })
  assert.equal(recipients.length, 0, 'never falls back to a different email than the operator chose')
})

// ── Deterministic, visible duplicate handling ───────────────────────────────

test('duplicates resolve deterministically (ID-bearing wins over manual; first wins) and are counted', () => {
  const dupChip = {
    email: 'WCU1@student.example.edu', normEmail: 'wcu1@student.example.edu',
    name: 'Pasted Copy', firstName: 'Pasted', school: null,
    source: 'manual', studentId: null, contactId: null,
  }
  const a = buildCombinedRecipients({
    studentSel: new Set(['wcu-1']), contactSel: new Set(), picked: [dupChip],
    students: STUDENTS, contacts: CONTACTS, emailSource: 'school',
  })
  assert.equal(a.recipients.length, 1)
  assert.equal(a.duplicateCount, 1, 'the removal is visible, not silent')
  assert.equal(a.recipients[0].source, 'student', 'the ID-bearing record wins')
  // Same inputs, same outcome - run twice to pin determinism.
  const b = buildCombinedRecipients({
    studentSel: new Set(['wcu-1']), contactSel: new Set(), picked: [dupChip],
    students: STUDENTS, contacts: CONTACTS, emailSource: 'school',
  })
  assert.deepEqual(b.recipients, a.recipients)
})

// ── Select-all policy ───────────────────────────────────────────────────────

test('select-all-shown returns only currently displayed students', () => {
  const shown = [wcu(1), wcu(2)]   // e.g. after a school filter
  assert.deepEqual(selectableShownStudentIds(shown), ['wcu-1', 'wcu-2'])
})

test('select-all-shown never selects a Not Proceeding student', () => {
  const ids = selectableShownStudentIds(STUDENTS)
  assert.ok(!ids.includes('wcu-4'), 'Not Proceeding is excluded from bulk selection by default')
  assert.equal(ids.length, STUDENTS.length - 1)
})

// ── Hidden selections are always countable ──────────────────────────────────

test('filtering the Students view leaves off-filter selections counted as hidden, not vanished', () => {
  const { recipients } = buildCombinedRecipients({
    studentSel: new Set(['wcu-1', 'csulb-1']), contactSel: new Set(['contact-1']),
    picked: [], students: STUDENTS, contacts: CONTACTS, emailSource: 'school',
  })
  // Students tab filtered to Cal State Long Beach: only csulb rows are visible.
  const split = visibleSelectionSplit({
    recipients, source: 'students',
    filteredStudents: [csulb(1), csulb(2), csulb(3)], filteredContacts: [], picked: [],
  })
  assert.equal(split.visible, 1, 'only the selected CSULB student is on screen')
  assert.equal(split.hidden, 2, 'the WCU student and the coordinator are hidden - and counted')
})

test('the Contacts and Paste views count their own hidden selections symmetrically', () => {
  const chip = { email: 'x@example.com', normEmail: 'x@example.com', name: 'X', firstName: 'X', school: null, source: 'manual', studentId: null, contactId: null }
  const { recipients } = buildCombinedRecipients({
    studentSel: new Set(['wcu-1']), contactSel: new Set(['contact-1']), picked: [chip],
    students: STUDENTS, contacts: CONTACTS, emailSource: 'school',
  })
  const onContacts = visibleSelectionSplit({ recipients, source: 'contacts', filteredStudents: [], filteredContacts: CONTACTS, picked: [chip] })
  assert.deepEqual(onContacts, { visible: 1, hidden: 2 })
  const onPaste = visibleSelectionSplit({ recipients, source: 'paste', filteredStudents: [], filteredContacts: [], picked: [chip] })
  assert.deepEqual(onPaste, { visible: 1, hidden: 2 })
})

// ── Not Proceeding acknowledgment ───────────────────────────────────────────

test('Not Proceeding students are identified for the Review warning regardless of entry path', () => {
  const npChip = {
    email: 'wcu4@student.example.edu', normEmail: 'wcu4@student.example.edu',
    name: 'WcuFirst4 WcuLast4', firstName: 'WcuFirst4', school: 'West Coast University - North Hollywood',
    status: NOT_PROCEEDING_STATUS, source: 'student', studentId: 'wcu-4', contactId: null, emailType: 'school',
  }
  const np = notProceedingRecipients([npChip, contactToRecipient(CONTACTS[0]), studentToRecipient(STUDENTS[0], 'school')])
  assert.equal(np.length, 1)
  assert.equal(np[0].studentId, 'wcu-4')
})

test('status_ack travels ONLY for Not Proceeding students, and only when acknowledged', () => {
  const { recipients } = buildCombinedRecipients({
    studentSel: new Set(['wcu-1', 'wcu-4']), contactSel: new Set(['contact-1']),
    picked: [], students: STUDENTS, contacts: CONTACTS, emailSource: 'school',
  })
  const unacked = buildPayloadRecipients(recipients, { ackNotProceeding: false })
  assert.ok(unacked.every(p => !('status_ack' in p)), 'no acknowledgment, no flag')
  const acked = buildPayloadRecipients(recipients, { ackNotProceeding: true })
  const flagged = acked.filter(p => p.status_ack === true)
  assert.equal(flagged.length, 1)
  assert.equal(flagged[0].email, 'wcu4@student.example.edu')
  assert.ok(!('status_ack' in acked.find(p => p.email === 'wcu1@student.example.edu')),
    'an ordinary student never carries the flag')
})

test('recipients carry the review-screen identity fields: name, email, type, school/org, status', () => {
  const s = studentToRecipient(STUDENTS[0], 'school')
  assert.equal(s.school, 'West Coast University - North Hollywood')
  assert.equal(s.status, 'Placed')
  const c = contactToRecipient(CONTACTS[0])
  assert.equal(c.school, 'West Coast University')
  assert.equal(c.organization, 'University Partner Office')
})
