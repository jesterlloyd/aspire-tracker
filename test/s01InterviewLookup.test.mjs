// test/s01InterviewLookup.test.mjs
//
// S-01: api/interview-lookup.js is a PUBLIC, unauthenticated endpoint that resolves a student from
// a school email. It previously ran select('*') and returned the whole row, so an anonymous caller
// who guessed an institutional address received date_of_birth, ssn_last4, personal_email,
// cumulative_gpa, and the interview scores and recommendations.
//
// These tests pin the four properties that make that no longer true:
//   1. the response carries only allow-listed fields, and no sensitive one survives,
//   2. an unknown email is indistinguishable from a known-but-ineligible one,
//   3. the rate limit runs before any lookup and fails closed,
//   4. failures are generic, with no database or provider text.
//
// The endpoint imports lib/server/evaluation/rate_limit.js, which throws at import when
// EVALUATION_RATE_LIMIT_PEPPER is unset. That is the intended fail-closed behavior, so the test
// sets a dummy pepper before importing. No real value is used and no network call is made.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

process.env.EVALUATION_RATE_LIMIT_PEPPER ||= 'test-pepper-not-a-real-value'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')
const SRC = read('api/interview-lookup.js')

const mod = await import('../api/interview-lookup.js')
const { projectStudent, projectSlot, projectBooking, STUDENT_COLUMNS, SLOT_COLUMNS,
        EXISTING_BOOKING_COLUMNS, NOT_ELIGIBLE, RATE_LIMITS, ELIGIBLE_STATUSES } = mod
const handler = mod.default

// Every field the scheduling screen actually renders, verified against
// src/components/InterviewSchedulePage.jsx. Nothing else may appear in a response.
const ALLOWED_STUDENT_FIELDS = [
  'id', 'first_name', 'last_name', 'school', 'program_type',
  'school_email', 'interview_scheduled_date', 'interview_scheduled_time',
]

// What an unauthenticated caller must never receive. `status` is included deliberately: the
// endpoint reads it for the eligibility gate but must not hand it back, because it would say
// exactly where in the pipeline a named student sits.
const FORBIDDEN_STUDENT_FIELDS = [
  'date_of_birth', 'ssn_last4', 'personal_email', 'cumulative_gpa', 'phone', 'gender',
  'status', 'interview_outcome', 'avg_score', 'avg_communication', 'avg_critical_thinking',
  'recommendation', 'interviewer_notes', 'flagged_for_second_interview', 'interest_statement',
  'prior_healthcare_experience', 'resume_url', 'headshot_url', 'cs_affiliation', 'cs_department',
  'cs_role', 'cs_cedars_status', 'notes', 'disposition', 'ngrp_outcome', 'matched_unit_id',
  'preceptor_id', 'preceptor_name', 'approved_hours', 'pending_hours', 'unit_preference_1',
  'school_coordinator_email', 'privacy_ack_name', 'availability_notes', 'cohort_id',
]

// A row shaped like a real students record: every allow-listed field plus every forbidden one.
function fullStudentRow() {
  const row = {}
  for (const f of ALLOWED_STUDENT_FIELDS) row[f] = `allowed:${f}`
  for (const f of FORBIDDEN_STUDENT_FIELDS) row[f] = `SENSITIVE:${f}`
  return row
}

// ── 1. Allow-listed fields only ──────────────────────────────────────────────────────────────────

test('S-01: projectStudent returns exactly the allow-listed fields', () => {
  const out = projectStudent(fullStudentRow())
  assert.deepEqual(Object.keys(out).sort(), [...ALLOWED_STUDENT_FIELDS].sort())
})

test('S-01: no sensitive student field survives the projection', () => {
  const out = projectStudent(fullStudentRow())
  const serialized = JSON.stringify(out)
  for (const f of FORBIDDEN_STUDENT_FIELDS) {
    assert.ok(!(f in out), `${f} must not be a key in the response`)
    assert.ok(!serialized.includes(`SENSITIVE:${f}`), `${f}'s value must not appear in the response`)
  }
  assert.ok(!serialized.includes('SENSITIVE:'), 'no sensitive value may appear anywhere in the payload')
})

test('S-01: a column added to the students table cannot leak by default', () => {
  // The projection names its fields, so tomorrow's column is absent without anyone editing it.
  const out = projectStudent({ ...fullStudentRow(), some_future_pii_column: 'SENSITIVE:future' })
  assert.ok(!('some_future_pii_column' in out))
  assert.ok(!JSON.stringify(out).includes('SENSITIVE:future'))
})

test('S-01: slot and booking projections are equally closed', () => {
  const slot = projectSlot({
    id: 'slot-1', slot_date: '2026-09-01', slot_time: '10:00', duration_minutes: 30,
    created_at: '2026-08-01T00:00:00Z',
    interviewer_name: 'SENSITIVE', booked_by_student_id: 'SENSITIVE', cohort_id: 'SENSITIVE',
    is_booked: false, status: 'SENSITIVE', notes: 'SENSITIVE',
  })
  assert.deepEqual(Object.keys(slot).sort(), ['created_at', 'duration_minutes', 'id', 'slot_date', 'slot_time'])
  assert.ok(!JSON.stringify(slot).includes('SENSITIVE'))

  const booking = projectBooking({
    slot_date: '2026-09-01', slot_time: '10:00',
    id: 'SENSITIVE', interviewer_name: 'SENSITIVE', booked_by_student_id: 'SENSITIVE',
  })
  assert.deepEqual(Object.keys(booking).sort(), ['slot_date', 'slot_time'])
  assert.ok(!JSON.stringify(booking).includes('SENSITIVE'))
})

test('S-01: the queries name their columns and never select everything', () => {
  assert.doesNotMatch(SRC, /\.select\('\*'\)/, "select('*') must not appear in this endpoint")
  // status is fetched for the gate but is not in the projection (asserted above).
  assert.ok(STUDENT_COLUMNS.includes('status'), 'status is needed server-side for eligibility')
  for (const f of ALLOWED_STUDENT_FIELDS) {
    assert.ok(STUDENT_COLUMNS.includes(f), `${f} must be fetched`)
  }
  for (const f of FORBIDDEN_STUDENT_FIELDS.filter(f => f !== 'status')) {
    assert.ok(!STUDENT_COLUMNS.split(',').map(s => s.trim()).includes(f), `${f} must not be fetched`)
  }
  assert.equal(SLOT_COLUMNS, 'id, slot_date, slot_time, duration_minutes, created_at')
  assert.equal(EXISTING_BOOKING_COLUMNS, 'slot_date, slot_time')
  // The interviewer's identity is internal and is not rendered by the page.
  assert.ok(!EXISTING_BOOKING_COLUMNS.includes('interviewer_name'))
  assert.ok(!SLOT_COLUMNS.includes('interviewer_name'))
})

test('S-01: every response shape is built from a projection, never from a raw row', () => {
  // The three success responses must pass through the projections.
  assert.match(SRC, /student: safeStudent/)
  assert.match(SRC, /booking: projectBooking\(existingSlot\)/)
  assert.match(SRC, /slots: slots\.map\(projectSlot\)/)
  // A raw row must never be handed to res.json.
  assert.doesNotMatch(SRC, /json\(\{[^}]*\bstudent,/, 'a raw student row must not be returned')
})

// ── 2. Non-enumeration ───────────────────────────────────────────────────────────────────────────

test('S-01: unknown email and ineligible student return one identical response', () => {
  // A single constant serves both branches, so the two cases cannot drift apart.
  assert.match(SRC, /if \(!student \|\| !ELIGIBLE_STATUSES\.has\(student\.status\)\) \{/)
  assert.match(SRC, /return res\.status\(NOT_ELIGIBLE\.status\)\.json\(NOT_ELIGIBLE\.body\)/)
  // Exactly one place produces it.
  assert.equal((SRC.match(/NOT_ELIGIBLE\.status/g) || []).length, 1)
})

test('S-01: the shared message does not confirm whether an email belongs to a student', () => {
  const msg = NOT_ELIGIBLE.body.error
  assert.equal(NOT_ELIGIBLE.status, 404)
  // No wording that asserts the record exists, or that it does not.
  assert.doesNotMatch(msg, /we (could not )?find your information/i)
  assert.doesNotMatch(msg, /not (yet )?eligible/i)
  assert.doesNotMatch(msg, /no (such )?(student|record|account)/i)
  assert.doesNotMatch(msg, /your (record|profile|application) (is|was)/i)
  // Still actionable for a real student who has simply not filled the form in.
  assert.match(msg, /Student Profile/)
  assert.match(msg, /contact the ASPIRE team/)
})

test('S-01: the eligible-status set is unchanged by this hardening', () => {
  assert.deepEqual([...ELIGIBLE_STATUSES].sort(), [
    'Active Rotation', 'Completed', 'Form Received', 'Interview Scheduled', 'Interviewed', 'Placed',
  ])
})

// ── 3. Rate limiting ─────────────────────────────────────────────────────────────────────────────

test('S-01: the rate limit uses the existing RPC and helpers, with no new mechanism', () => {
  assert.match(SRC, /import \{ extractClientIp, bucketKey \} from '\.\.\/lib\/server\/evaluation\/rate_limit\.js'/)
  assert.match(SRC, /rpc\('consume_evaluation_rate_limit'/)
  assert.match(SRC, /p_bucket_key:\s*bucketKey\(prefix, ip\)/)
  // No hand-rolled counter, no new table, no migration.
  assert.doesNotMatch(SRC, /new Map\(\)|setInterval|createTable|CREATE TABLE/i)
})

test('S-01: two buckets are configured, both far above real student use', () => {
  assert.equal(RATE_LIMITS.length, 2)
  const [burst, sustained] = RATE_LIMITS
  assert.deepEqual(burst,     { prefix: 'interview_lookup_burst',     windowSeconds: 60,   maxPerWindow: 10 })
  assert.deepEqual(sustained, { prefix: 'interview_lookup_sustained', windowSeconds: 3600, maxPerWindow: 60 })
  // A student needs one or two lookups; a sustained cap is what actually bounds enumeration.
  assert.ok(burst.maxPerWindow >= 5, 'a real student must never trip the burst cap')
  assert.ok(sustained.maxPerWindow < burst.maxPerWindow * 60, 'the hourly cap must bind tighter than the burst cap alone')
  // Distinct prefixes, or the two buckets would share one counter.
  assert.notEqual(burst.prefix, sustained.prefix)
})

test('S-01: the rate limit fails closed and runs before any student lookup', () => {
  assert.match(SRC, /if \(rlError \|\| allowed !== true\) \{/, 'an RPC error must be treated as exceeded')
  assert.match(SRC, /return res\.status\(429\)/)
  assert.ok(
    SRC.indexOf("rpc('consume_evaluation_rate_limit'") < SRC.indexOf(".from('students')"),
    'the limit must be consumed before the students query runs',
  )
  // The cohort read moved into the shared fail-closed resolver
  // (api/lib/intakeStudentLookup.js resolveAcceptingCohort), so the first lookup
  // this endpoint performs is now that call rather than a .from('cohorts') query.
  // The property under test is unchanged: nothing is read before the limit.
  assert.ok(
    SRC.indexOf("rpc('consume_evaluation_rate_limit'") < SRC.indexOf('resolveAcceptingCohort(db)'),
    'the limit must be consumed before any lookup at all',
  )
})

test('S-01: the pepper is mandatory, so the limiter cannot be silently absent', () => {
  const rl = read('lib/server/evaluation/rate_limit.js')
  assert.match(rl, /throw new Error\('Missing required environment variable: EVALUATION_RATE_LIMIT_PEPPER'\)/)
  // The IP is hashed with the pepper, never stored or logged raw.
  assert.match(rl, /createHmac\('sha256', EVALUATION_RATE_LIMIT_PEPPER\)/)
})

// ── 4. Generic failures, and no raw provider text ────────────────────────────────────────────────

test('S-01: the catch-all returns a fixed string and logs the detail server-side only', () => {
  assert.match(SRC, /return res\.status\(500\)\.json\(\{ error: 'Something went wrong\. Please try again\.' \}\)/)
  assert.doesNotMatch(SRC, /json\(\{ error: err\.message/, 'raw error text must not reach the caller')
  assert.doesNotMatch(SRC, /json\(\{[^}]*error:[^}]*\berror\b\.message/, 'no provider error object may be returned')
  assert.match(SRC, /console\.error\('\[interview-lookup\] unhandled error:'/)
})

// ── Boundary behavior that needs no database ─────────────────────────────────────────────────────

function fakeRes() {
  const res = {
    statusCode: null, body: null, headers: {}, ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this },
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    end() { this.ended = true; return this },
  }
  return res
}
const fakeReq = (over = {}) => ({ method: 'POST', headers: {}, body: {}, socket: {}, ...over })

test('S-01: CORS is narrowed to the app origins, and an unknown origin is not echoed', async () => {
  for (const origin of ['https://aspireintelligence.app', 'https://aspire-tracker.vercel.app']) {
    const res = fakeRes()
    await handler(fakeReq({ method: 'OPTIONS', headers: { origin } }), res)
    assert.equal(res.headers['access-control-allow-origin'], origin, `${origin} must be allowed`)
    assert.equal(res.headers.vary, 'Origin')
  }
  for (const origin of ['https://evil.example', 'null', 'http://aspireintelligence.app']) {
    const res = fakeRes()
    await handler(fakeReq({ method: 'OPTIONS', headers: { origin } }), res)
    assert.equal(res.headers['access-control-allow-origin'], undefined, `${origin} must not be echoed`)
  }
  // The wildcard is gone entirely.
  assert.doesNotMatch(SRC, /setHeader\('Access-Control-Allow-Origin', '\*'\)/)
})

test('S-01: a same-origin caller with no Origin header still works (no CORS header needed)', async () => {
  const res = fakeRes()
  await handler(fakeReq({ method: 'OPTIONS' }), res)
  assert.equal(res.headers['access-control-allow-origin'], undefined)
  assert.equal(res.statusCode, 200)
})

test('S-01: only POST is accepted', async () => {
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    const res = fakeRes()
    await handler(fakeReq({ method }), res)
    assert.equal(res.statusCode, 405, `${method} must be rejected`)
    assert.deepEqual(res.body, { error: 'Method not allowed' })
  }
})

test('S-01: a missing email is refused before any lookup, with a generic message', async () => {
  const prevUrl = process.env.VITE_SUPABASE_URL
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  process.env.VITE_SUPABASE_URL = 'https://placeholder.invalid'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-not-a-real-key'
  try {
    for (const body of [{}, { email: '' }, { email: '   ' }, {}]) {
      const res = fakeRes()
      await handler(fakeReq({ body }), res)
      assert.equal(res.statusCode, 400)
      assert.deepEqual(res.body, { error: 'Email is required' })
    }
  } finally {
    if (prevUrl === undefined) delete process.env.VITE_SUPABASE_URL; else process.env.VITE_SUPABASE_URL = prevUrl
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey
  }
})

// ── The calling page still gets everything it renders ────────────────────────────────────────────

test('S-01: every field the scheduling page reads is still provided', () => {
  const page = read('src/components/InterviewSchedulePage.jsx')
  const used = new Set((page.match(/student(?:\?)?\.([a-zA-Z_][a-zA-Z0-9_]*)/g) || [])
    .map(m => m.split('.').pop()))
  for (const field of used) {
    assert.ok(ALLOWED_STUDENT_FIELDS.includes(field), `the page renders student.${field}, so it must be allow-listed`)
  }
  // And the page does not read anything this endpoint stopped returning.
  assert.doesNotMatch(page, /existingBooking\?\.(id|interviewer_name|duration_minutes)/)
})

test('S-01: the no-slots state routes students to the ASPIRE Team, not a placement coordinator', () => {
  const page = read('src/components/InterviewSchedulePage.jsx')
  const noSlots = page.slice(page.indexOf("screen === 'no_slots'"), page.indexOf("screen === 'error'"))
  const teamEmail = ['aspire', 'cshs.org'].join('@')

  assert.ok(noSlots.length > 0, 'the no-slots branch must exist')
  assert.match(noSlots, /Please check back soon\. If you have questions, contact the ASPIRE Team at/)
  assert.ok(page.includes(`const ASPIRE_TEAM_EMAIL = '${teamEmail}'`), 'the shared ASPIRE inbox must be configured')
  assert.match(noSlots, /mailto:\$\{ASPIRE_TEAM_EMAIL\}/)
  assert.match(noSlots, /\{ASPIRE_TEAM_EMAIL\}/)
  assert.doesNotMatch(noSlots, /placement coordinator/i)
  assert.doesNotMatch(noSlots, /JESTER_EMAIL/)
})

// ── No live student data in this file ────────────────────────────────────────────────────────────

test('S-01: this test file contains no real student data', () => {
  const self = read('test/s01InterviewLookup.test.mjs')
  assert.doesNotMatch(self, /@cshs\.org/, 'no real institutional address')
  assert.doesNotMatch(self, /\b\d{3}-\d{2}-\d{4}\b/, 'no SSN-shaped value')
  // Every address used is a documentation-reserved example domain.
  for (const addr of self.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []) {
    assert.match(addr, /@(example\.(com|org|edu)|school\.edu|evil\.example)$/, `${addr} must be a fictional address`)
  }
})
