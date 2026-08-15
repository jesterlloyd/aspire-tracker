// BULK-EXACT-RECIPIENTS-1 (P0): the server allowlist guard, behaviorally.
//
// validateBulkRecipients is the floor that makes the reviewed list the ONLY
// list: every entry resolves against the CURRENT database row before the
// provider is touched. These tests run the real guard against a substituted
// database - no network, no email, no real rows.
//
// Run: node --test test/bulkRecipientAllowlist.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { validateBulkRecipients, NOT_PROCEEDING_STATUS } from '../api/lib/bulkRecipientAllowlist.js'

const BATCH = '11111111-2222-4333-8444-555555555555'

// ── Substituted database ────────────────────────────────────────────────────
const DB_STUDENTS = {
  'aaaaaaaa-0000-4000-8000-000000000001': {
    id: 'aaaaaaaa-0000-4000-8000-000000000001', first_name: 'Wcu', last_name: 'One',
    school_email: 'wcu1@student.example.edu', personal_email: 'wcu1@personal.example.com', status: 'Placed',
  },
  'aaaaaaaa-0000-4000-8000-000000000002': {
    id: 'aaaaaaaa-0000-4000-8000-000000000002', first_name: 'Not', last_name: 'Proceeding',
    school_email: 'np@student.example.edu', personal_email: null, status: NOT_PROCEEDING_STATUS,
  },
}
const DB_CONTACTS = {
  'bbbbbbbb-0000-4000-8000-000000000001': {
    id: 'bbbbbbbb-0000-4000-8000-000000000001', full_name: 'Coordinator One',
    email: 'coordinator1@example.org', is_active: true,
  },
  'bbbbbbbb-0000-4000-8000-000000000002': {
    id: 'bbbbbbbb-0000-4000-8000-000000000002', full_name: 'Inactive Contact',
    email: 'inactive@example.org', is_active: false,
  },
}

function makeDb({ alreadySentNorms = new Set() } = {}) {
  const reads = []
  const db = {
    from(table) {
      const q = { table, filters: [] }
      const api = {
        select() { return api },
        eq(f, v) { q.filters.push([f, v]); return api },
        filter(f, _op, v) { q.filters.push([f, v]); return api },
        limit() {
          reads.push(q)
          // idempotency probe: notification_log by batch_id + recipient_email_norm
          const norm = (q.filters.find(([f]) => f === 'metadata->>recipient_email_norm') || [])[1]
          return Promise.resolve({ data: alreadySentNorms.has(norm) ? [{ id: 'existing' }] : [], error: null })
        },
        single() {
          reads.push(q)
          const id = (q.filters.find(([f]) => f === 'id') || [])[1]
          const row = q.table === 'students' ? DB_STUDENTS[id]
            : q.table === 'contacts' ? DB_CONTACTS[id] : null
          return Promise.resolve(row ? { data: row, error: null } : { data: null, error: { message: 'not found' } })
        },
      }
      return api
    },
  }
  return { db, reads }
}

const student1 = (over = {}) => ({
  source: 'student', studentId: 'aaaaaaaa-0000-4000-8000-000000000001',
  email: 'wcu1@student.example.edu', emailType: 'school', name: 'Wcu One', ...over,
})
const contact1 = (over = {}) => ({
  source: 'contact', contactId: 'bbbbbbbb-0000-4000-8000-000000000001',
  email: 'coordinator1@example.org', name: 'Coordinator One', ...over,
})

// ── The allowlist can only shrink ───────────────────────────────────────────

test('THE GUARD NEVER EXPANDS: cleared is a subset of the input, by email and by count', async () => {
  const { db } = makeDb()
  const input = [student1(), contact1(), { source: 'manual', email: 'krystal@example.org', name: 'Krystal' }]
  const { cleared, rejected } = await validateBulkRecipients({ db, recipients: input, batchId: BATCH })
  assert.equal(cleared.length + rejected.length, input.length, 'every entry lands in exactly one bucket')
  assert.ok(cleared.length <= input.length)
  const inputEmails = new Set(input.map(r => r.email.toLowerCase()))
  for (const c of cleared) assert.ok(inputEmails.has(c.rawEmail.toLowerCase()), 'no email the client did not send')
})

test('the six-recipient happy path clears all six, in review order', async () => {
  const { db } = makeDb()
  const input = [
    student1(), contact1(),
    { source: 'manual', email: 'krystal@example.org', name: 'Krystal Sophia Rodriguez' },
  ]
  const { cleared, rejected } = await validateBulkRecipients({ db, recipients: input, batchId: BATCH })
  assert.equal(rejected.length, 0)
  assert.deepEqual(cleared.map(c => c.rawEmail),
    ['wcu1@student.example.edu', 'coordinator1@example.org', 'krystal@example.org'])
  assert.deepEqual(cleared.map(c => c.index), [0, 1, 2])
})

// ── Every rejection class, before any provider call ─────────────────────────

test('a stale/forged email that does not belong to the claimed student is rejected', async () => {
  const { db } = makeDb()
  const { cleared, rejected } = await validateBulkRecipients({
    db, recipients: [student1({ email: 'someoneelse@student.example.edu' })], batchId: BATCH,
  })
  assert.equal(cleared.length, 0)
  assert.equal(rejected[0].reason, 'email_mismatch')
})

test('the chosen email SOURCE is honored - a personal email cannot ride a school claim', async () => {
  const { db } = makeDb()
  const { rejected } = await validateBulkRecipients({
    db, recipients: [student1({ email: 'wcu1@personal.example.com', emailType: 'school' })], batchId: BATCH,
  })
  assert.equal(rejected[0].reason, 'email_mismatch')
})

test('unknown ids, malformed sources, invalid and missing emails are all rejected', async () => {
  const { db } = makeDb()
  const { cleared, rejected } = await validateBulkRecipients({
    db,
    recipients: [
      student1({ studentId: 'aaaaaaaa-0000-4000-8000-00000000dead' }),
      contact1({ contactId: 'bbbbbbbb-0000-4000-8000-00000000dead' }),
      { source: 'student', studentId: 'not-a-uuid', email: 'x@example.com' },
      { source: 'cohort', email: 'x@example.com' },       // out-of-scope source
      { source: 'manual', email: 'not-an-email' },
      { source: 'manual' },
    ],
    batchId: BATCH,
  })
  assert.equal(cleared.length, 0)
  assert.deepEqual(rejected.map(r => r.reason),
    ['student_not_found', 'contact_not_found', 'invalid_student_id', 'invalid_source', 'invalid_email', 'missing_email'])
})

test('an inactive contact is rejected even with a matching email', async () => {
  const { db } = makeDb()
  const { rejected } = await validateBulkRecipients({
    db,
    recipients: [{ source: 'contact', contactId: 'bbbbbbbb-0000-4000-8000-000000000002', email: 'inactive@example.org' }],
    batchId: BATCH,
  })
  assert.equal(rejected[0].reason, 'contact_inactive')
})

test('duplicates are deterministic: first valid occurrence wins, later ones are rejected', async () => {
  const { db } = makeDb()
  const { cleared, rejected } = await validateBulkRecipients({
    db,
    recipients: [
      student1(),
      { source: 'manual', email: 'WCU1@student.example.edu' },   // same normalized email
    ],
    batchId: BATCH,
  })
  assert.equal(cleared.length, 1)
  assert.equal(cleared[0].index, 0)
  assert.deepEqual(rejected, [{ index: 1, source: 'manual', email: 'WCU1@student.example.edu', reason: 'duplicate' }])
})

test('an invalid first occurrence does not poison a valid later one for the same email', async () => {
  const { db } = makeDb()
  const { cleared, rejected } = await validateBulkRecipients({
    db,
    recipients: [
      student1({ studentId: 'not-a-uuid' }),   // rejected on shape
      student1(),                              // the genuine entry still clears
    ],
    batchId: BATCH,
  })
  assert.equal(rejected[0].reason, 'invalid_student_id')
  assert.equal(cleared.length, 1)
  assert.equal(cleared[0].index, 1)
})

test('a recipient already sent under this batch_id is rejected (replay protection)', async () => {
  const { db } = makeDb({ alreadySentNorms: new Set(['wcu1@student.example.edu']) })
  const { cleared, rejected } = await validateBulkRecipients({ db, recipients: [student1()], batchId: BATCH })
  assert.equal(cleared.length, 0)
  assert.equal(rejected[0].reason, 'already_sent_in_batch')
})

// ── Not Proceeding policy ───────────────────────────────────────────────────

test('a Not Proceeding student without an explicit acknowledgment is rejected', async () => {
  const { db } = makeDb()
  const np = {
    source: 'student', studentId: 'aaaaaaaa-0000-4000-8000-000000000002',
    email: 'np@student.example.edu', emailType: 'school',
  }
  const { cleared, rejected } = await validateBulkRecipients({ db, recipients: [np], batchId: BATCH })
  assert.equal(cleared.length, 0)
  assert.equal(rejected[0].reason, 'not_proceeding_not_acknowledged')

  // status_ack must be EXACTLY true - truthy strings do not count.
  const { cleared: c2 } = await validateBulkRecipients({ db, recipients: [{ ...np, status_ack: 'yes' }], batchId: BATCH })
  assert.equal(c2.length, 0)

  const { cleared: c3, rejected: r3 } = await validateBulkRecipients({ db, recipients: [{ ...np, status_ack: true }], batchId: BATCH })
  assert.equal(r3.length, 0)
  assert.equal(c3[0].rawEmail, 'np@student.example.edu')
})

// ── The guard consults nothing but the entries ──────────────────────────────

test('validation reads only the claimed rows - never a school/cohort/status roster query', async () => {
  const { db, reads } = makeDb()
  await validateBulkRecipients({ db, recipients: [student1(), contact1()], batchId: BATCH })
  for (const q of reads) {
    assert.ok(['students', 'contacts', 'notification_log'].includes(q.table))
    const fields = q.filters.map(([f]) => f)
    assert.ok(!fields.includes('school') && !fields.includes('cohort_id') && !fields.includes('status'),
      'no audience-shaped query exists - the guard can only verify, never discover')
  }
})
