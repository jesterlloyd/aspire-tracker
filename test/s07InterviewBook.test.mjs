// test/s07InterviewBook.test.mjs
//
// S-07: api/interview-book.js is a PUBLIC, unauthenticated endpoint. It used to take studentId,
// cohortId, and slotId from the request body and trust all three without checking a single
// relationship between them, so anyone holding a student id could book slots for that student,
// drain a cohort's availability, flip statuses to Interview Scheduled, and fire a notification per
// call. It also returned the whole slot row and the interviewer's email address.
//
// Coverage note, stated plainly: the branches that depend on database rows (student resolution,
// cohort membership, slot claim, already-booked) are asserted against the source, because driving
// them would need a live database or a module mock this runner is not configured for. What that
// buys is still strong for this particular fix, because the guarantees are structural: a body id
// that is never read cannot be trusted, and a predicate that is present in the claim statement
// cannot be skipped at runtime. The projections, constants, and every request path that does not
// reach the database are exercised behaviorally against the real handler.
//
// Nothing here performs network I/O and no email is sent.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

process.env.EVALUATION_RATE_LIMIT_PEPPER ||= 'test-pepper-not-a-real-value'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')
const SRC = read('api/interview-book.js')
// Comment-free view of the endpoint. The header comments legitimately NAME studentId and cohortId
// while explaining what the old version did wrong, so "this identifier never appears" has to be
// asserted against code alone or it would fail on its own documentation.
const CODE = SRC.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

const mod = await import('../api/interview-book.js')
const { projectBookedSlot, BOOKED_SLOT_COLUMNS, STUDENT_COLUMNS, BOOKING_REFUSED, RATE_LIMITS } = mod
const handler = mod.default

// ── 1. A body-supplied student id cannot book for another student ────────────────────────────────

test('S-07: studentId is never read from the body, anywhere in the endpoint', () => {
  // The strongest form of this guarantee: the identifier does not exist in the executable code at
  // all, so there is no runtime path on which a caller-supplied id could be trusted.
  assert.doesNotMatch(CODE, /\bstudentId\b/, 'studentId must not appear in the endpoint code')
  assert.doesNotMatch(CODE, /req\.body[^\n]*studentId/)
  // The body destructure names exactly the two values the endpoint accepts.
  assert.match(CODE, /const \{ email, slotId \} = req\.body \|\| \{\}/)
})

test('S-07: cohortId is not accepted from the body either; the cohort comes from server state', () => {
  // The strongest form of this: the body yields exactly two fields, so no cohort
  // identifier can enter from the request at all.
  assert.match(SRC, /const \{ email, slotId \} = req\.body \|\| \{\}/)

  // The cohort is resolved server-side by the shared FAIL-CLOSED resolver. This
  // was `.eq('accepting_submissions', true).limit(1).maybeSingle()`, which could
  // not tell one accepting cohort from several and simply took the first row it
  // was handed, so a broken single-accepting-cohort invariant would have written
  // a real booking into an arbitrary cohort. resolveAcceptingCohort refuses both
  // the 0 and the >1 case and never yields a row.
  assert.match(SRC, /const cohortResult = await resolveAcceptingCohort\(db\)/)
  assert.match(SRC, /if \(cohortResult\.failure\)/)

  // `cohortId` may now appear ONLY as that resolver's return field. This replaces
  // the blanket ban on the identifier, which was a proxy for "it must not come
  // from the body" and stopped being usable once the server-side resolver
  // legitimately returned a field of that name. Any other occurrence, above all
  // one reached from req.body, still fails here.
  for (const m of CODE.matchAll(/\bcohortId\b/g)) {
    assert.match(
      CODE.slice(Math.max(0, m.index - 20), m.index), /cohortResult\.$/,
      'cohortId may only be read from resolveAcceptingCohort',
    )
  }
})

test('S-07: identity is re-resolved from the email, matching the lookup exactly', () => {
  assert.match(SRC, /normalizeEmailForLookup\(email\)/)
  assert.match(SRC, /\.ilike\('school_email', escapeLikePattern\(cleanEmail\)\)/)
  // The normalized-equality confirm, so an ilike match alone is never enough.
  assert.match(SRC, /normalizeEmailForLookup\(s\.school_email\) === cleanEmail/)
  // The eligibility gate is imported from the lookup rather than re-declared, so the two halves of
  // the flow cannot drift about who may schedule.
  assert.match(SRC, /import \{ ELIGIBLE_STATUSES \} from '\.\/interview-lookup\.js'/)
  assert.doesNotMatch(SRC, /const ELIGIBLE_STATUSES/, 'the status set must not be duplicated here')
})

test('S-07: every write is keyed on the RESOLVED student, never on request input', () => {
  // Each of these writes previously used the body-supplied id.
  assert.match(SRC, /booked_by_student_id: student\.id/)
  assert.match(SRC, /\}\)\.eq\('id', student\.id\)/)             // students update
  assert.match(SRC, /student_id: student\.id/)                   // program_events + session insert
  assert.match(SRC, /\.eq\('student_id', student\.id\)/)         // session lookup
})

// ── 2, 3. Cohort and slot relationships ──────────────────────────────────────────────────────────

test('S-07: the slot claim requires the slot to belong to the resolved cohort', () => {
  const claim = SRC.slice(SRC.indexOf("update({ is_booked: true"), SRC.indexOf('if (slotError || !slot)'))
  assert.match(claim, /\.eq\('id', slotId\)/)
  assert.match(claim, /\.eq\('cohort_id', cohort\.id\)/, 'a slot from another cohort must not be claimable')
  assert.match(claim, /\.eq\('is_booked', false\)/, 'an already-taken slot must not be claimable')
  // All three predicates ride on the SAME statement that performs the claim, so none can be
  // bypassed by a race between checking and writing.
  assert.match(claim, /\.select\(BOOKED_SLOT_COLUMNS\)/)
})

test('S-07: a closed cohort is refused before anything is written', () => {
  assert.ok(
    SRC.indexOf("eq('accepting_submissions', true)") < SRC.indexOf("update({ is_booked: true"),
    'the accepting check must precede the claim',
  )
  assert.match(SRC, /Scheduling is not currently open/)
})

// ── 4. Already-booked handling ───────────────────────────────────────────────────────────────────

test('S-07: a student who already holds a booking is refused, not silently rescheduled', () => {
  const guard = SRC.slice(SRC.indexOf('const { data: priorBooking }'), SRC.indexOf('const now ='))
  assert.match(guard, /\.eq\('booked_by_student_id', student\.id\)/)
  assert.match(guard, /\.eq\('is_booked', true\)/)
  assert.match(guard, /return res\.status\(BOOKING_REFUSED\.status\)/)
  // Refuse, never release: the confirmation screen tells students to email the ASPIRE team to
  // reschedule, so this endpoint must not free a held slot.
  assert.ok(
    SRC.indexOf('const { data: priorBooking }') < SRC.indexOf("update({ is_booked: true"),
    'the prior-booking check must precede the claim',
  )
  const page = read('src/components/InterviewSchedulePage.jsx')
  assert.match(page, /To reschedule, please email/, 'the reschedule policy this mirrors must still be on the page')
})

test('S-07: a concurrent second claim is detected and the slot this request took is released', () => {
  const recheck = SRC.slice(SRC.indexOf('const { data: otherBookings }'), SRC.indexOf('// 6. Create or update'))
  // Re-verified AFTER the claim, excluding the row we just took.
  assert.match(recheck, /\.neq\('id', slot\.id\)/)
  // The compensating release only ever touches the row this request claimed.
  assert.match(recheck, /is_booked: false, booked_by_student_id: null/)
  assert.match(recheck, /\.eq\('id', slot\.id\)\s*\n\s*\.eq\('booked_by_student_id', student\.id\)/)
  assert.match(recheck, /return res\.status\(BOOKING_REFUSED\.status\)/)
})

// ── 5. Response allow-list ───────────────────────────────────────────────────────────────────────

test('S-07: the booked-slot projection returns exactly the three rendered fields', () => {
  const out = projectBookedSlot({
    slot_date: '2026-09-01', slot_time: '10:00', duration_minutes: 30,
    id: 'SENSITIVE', cohort_id: 'SENSITIVE', interviewer_name: 'SENSITIVE',
    booked_by_student_id: 'SENSITIVE', is_booked: true, status: 'SENSITIVE',
    booked_at: 'SENSITIVE', created_at: 'SENSITIVE', notes: 'SENSITIVE',
  })
  assert.deepEqual(Object.keys(out).sort(), ['duration_minutes', 'slot_date', 'slot_time'])
  assert.ok(!JSON.stringify(out).includes('SENSITIVE'))
})

test('S-07: a column added to interview_slots cannot leak by default', () => {
  const out = projectBookedSlot({
    slot_date: 'd', slot_time: 't', duration_minutes: 30, some_future_column: 'SENSITIVE:future',
  })
  assert.ok(!('some_future_column' in out))
  assert.ok(!JSON.stringify(out).includes('SENSITIVE:future'))
})

test('S-07: the response no longer carries the raw slot row or any staff email address', () => {
  assert.match(SRC, /return res\.status\(200\)\.json\(\{ success: true, slot: projectBookedSlot\(slot\) \}\)/)
  // The old response returned `slot` whole plus interviewerEmail and ownerEmail.
  assert.doesNotMatch(SRC, /json\(\{[^}]*\bslot,/, 'the raw slot row must not be returned')
  assert.doesNotMatch(SRC, /json\(\{[^}]*interviewerEmail/, "the interviewer's address must not be returned")
  assert.doesNotMatch(SRC, /json\(\{[^}]*ownerEmail/, "the owner's address must not be returned")
  assert.doesNotMatch(SRC, /\.select\(\)/, 'a bare select() would fetch every column')
  // The student is never echoed back: the page already holds its own profile from the lookup.
  assert.doesNotMatch(SRC, /json\(\{[^}]*student:/)
})

test('S-07: the columns fetched are only those the server itself needs', () => {
  assert.equal(BOOKED_SLOT_COLUMNS, 'id, cohort_id, slot_date, slot_time, duration_minutes, interviewer_name')
  assert.equal(STUDENT_COLUMNS, 'id, cohort_id, school_email, status, first_name, last_name, school, program_type')
  // Nothing sensitive is read for the student even server-side.
  for (const f of ['ssn_last4', 'date_of_birth', 'cumulative_gpa', 'personal_email', 'phone']) {
    assert.ok(!STUDENT_COLUMNS.includes(f), `${f} must not be fetched`)
  }
})

// ── 6. Rate limiting ─────────────────────────────────────────────────────────────────────────────

test('S-07: the rate limit reuses the existing RPC and helpers, with no new mechanism', () => {
  assert.match(SRC, /import \{ extractClientIp, bucketKey \} from '\.\.\/lib\/server\/evaluation\/rate_limit\.js'/)
  assert.match(SRC, /rpc\('consume_evaluation_rate_limit'/)
  assert.doesNotMatch(SRC, /CREATE TABLE|new Map\(\)|setInterval/i)
})

test('S-07: two buckets, tighter than the lookup because booking is rarer', async () => {
  assert.equal(RATE_LIMITS.length, 2)
  const [burst, sustained] = RATE_LIMITS
  assert.deepEqual(burst,     { prefix: 'interview_book_burst',     windowSeconds: 60,   maxPerWindow: 5 })
  assert.deepEqual(sustained, { prefix: 'interview_book_sustained', windowSeconds: 3600, maxPerWindow: 20 })
  assert.notEqual(burst.prefix, sustained.prefix)
  // Distinct bucket prefixes from the lookup, or the two endpoints would share one counter and a
  // student's lookups would consume their ability to book.
  const lookup = await import('../api/interview-lookup.js')
  const lookupPrefixes = new Set(lookup.RATE_LIMITS.map(r => r.prefix))
  for (const r of RATE_LIMITS) {
    assert.ok(!lookupPrefixes.has(r.prefix), `${r.prefix} must not collide with a lookup bucket`)
  }
  // Booking must be no more permissive than looking up.
  const lookupBurst = lookup.RATE_LIMITS[0]
  assert.ok(burst.maxPerWindow <= lookupBurst.maxPerWindow)
})

test('S-07: the limit is consumed before any read or write, and fails closed', () => {
  assert.match(SRC, /if \(rlError \|\| allowed !== true\) \{/)
  assert.match(SRC, /return res\.status\(429\)/)
  const rl = SRC.indexOf("rpc('consume_evaluation_rate_limit'")
  // The cohort read is now the shared resolver call, not a .from('cohorts') query.
  assert.ok(rl < SRC.indexOf('resolveAcceptingCohort(db)'), 'before the cohort read')
  assert.ok(rl < SRC.indexOf(".from('students')"), 'before the student read')
  assert.ok(rl < SRC.indexOf("update({ is_booked: true"), 'before the slot claim')
})

// ── 7. Uniform refusal and generic errors ────────────────────────────────────────────────────────

test('S-07: every failed precondition returns one identical refusal', () => {
  // Four return sites cover the six conditions: identity, eligibility, unknown slot, wrong cohort,
  // taken slot, already booked.
  assert.equal((SRC.match(/BOOKING_REFUSED\.status/g) || []).length, 4)
  assert.equal((SRC.match(/BOOKING_REFUSED\.body/g) || []).length, 4)
  assert.equal(BOOKING_REFUSED.status, 409)
})

test('S-07: the refusal does not say which condition failed', () => {
  const msg = BOOKING_REFUSED.body.error
  assert.doesNotMatch(msg, /not eligible|no (such )?student|already (have|booked)|not found/i)
  assert.doesNotMatch(msg, /cohort|slot id|invalid id/i)
  // Still actionable: the lookup will show a real student their true state.
  assert.match(msg, /return to the scheduling page/i)
  assert.match(msg, /contact the ASPIRE team/)
})

test('S-07: no raw provider or database text reaches the caller', () => {
  assert.match(SRC, /return res\.status\(500\)\.json\(\{ error: 'Something went wrong\. Please try again\.' \}\)/)
  assert.doesNotMatch(SRC, /json\(\{ error: err\.message/)
  assert.doesNotMatch(SRC, /slotError\?\.message/, 'the old handler returned the raw slot error')
  assert.match(SRC, /console\.error\('\[interview-book\] unhandled error:'/)
})

// ── S-06 notification preserved exactly ──────────────────────────────────────────────────────────

test('S-07: the booking notification is unchanged in trigger, recipients, and content', () => {
  assert.match(SRC, /const recipients = \[\.\.\.new Set\(\[BOOKING_NOTICE_OWNER, interviewerEmail\]\.filter\(Boolean\)\)\]/)
  assert.match(SRC, /from:     BOOKING_NOTICE_FROM/)
  assert.match(SRC, /reply_to: BOOKING_NOTICE_REPLY_TO/)
  // Same eight content bindings the S-06 module expects.
  for (const field of [
    'studentName', 'studentSchool:   student.school', 'studentProgram:  student.program_type',
    'studentEmail:    student.school_email', 'interviewDate:   slot.slot_date',
    'interviewTime:   slot.slot_time', 'duration:        slot.duration_minutes',
    'interviewerName: slot.interviewer_name',
  ]) {
    assert.ok(SRC.includes(field), `notification binding ${field} must be preserved`)
  }
  // Still non-fatal and still deduped.
  assert.match(SRC, /shouldSkipDuplicateBookingNotice\(dedupeKey\)/)
  assert.match(SRC, /catch \(notifyErr\)/)
  // And it fires only after a successful claim.
  assert.ok(SRC.indexOf("update({ is_booked: true") < SRC.indexOf('interviewBookedEmail('))
})

// ── Behavior reachable without a database ────────────────────────────────────────────────────────

function fakeRes() {
  return {
    statusCode: null, body: null, headers: {}, ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this },
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    end() { this.ended = true; return this },
  }
}
const fakeReq = (over = {}) => ({ method: 'POST', headers: {}, body: {}, socket: {}, ...over })

test('S-07: CORS matches the lookup, and an unknown origin is not echoed', async () => {
  for (const origin of ['https://aspireintelligence.app', 'https://aspire-tracker.vercel.app']) {
    const res = fakeRes()
    await handler(fakeReq({ method: 'OPTIONS', headers: { origin } }), res)
    assert.equal(res.headers['access-control-allow-origin'], origin)
    assert.equal(res.headers.vary, 'Origin')
  }
  for (const origin of ['https://evil.example', 'http://aspireintelligence.app']) {
    const res = fakeRes()
    await handler(fakeReq({ method: 'OPTIONS', headers: { origin } }), res)
    assert.equal(res.headers['access-control-allow-origin'], undefined)
  }
  assert.doesNotMatch(SRC, /setHeader\('Access-Control-Allow-Origin', '\*'\)/)
})

test('S-07: only POST is accepted', async () => {
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    const res = fakeRes()
    await handler(fakeReq({ method }), res)
    assert.equal(res.statusCode, 405)
  }
})

test('S-07: a request missing the email or the slot is refused before any lookup', async () => {
  const prevUrl = process.env.VITE_SUPABASE_URL
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  process.env.VITE_SUPABASE_URL = 'https://placeholder.invalid'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-not-a-real-key'
  try {
    // Notably includes the OLD body shape: a caller sending only ids is now refused.
    for (const body of [{}, { email: 'a@school.edu' }, { slotId: 'slot-1' }, { email: '  ' , slotId: 's' },
                        { studentId: 'stu-1', cohortId: 'coh-1', slotId: 'slot-1' }]) {
      const res = fakeRes()
      await handler(fakeReq({ body }), res)
      assert.equal(res.statusCode, 400, `body ${JSON.stringify(body)} must be refused`)
      assert.deepEqual(res.body, { error: 'Email and slot are required.' })
    }
  } finally {
    if (prevUrl === undefined) delete process.env.VITE_SUPABASE_URL; else process.env.VITE_SUPABASE_URL = prevUrl
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey
  }
})

// ── The client sends what the server now expects ─────────────────────────────────────────────────

test('S-07: the scheduling page posts the school email, not a student id', () => {
  const page = read('src/components/InterviewSchedulePage.jsx')
  const call = page.slice(page.indexOf("fetch('/api/interview-book'"), page.indexOf('const data = await res.json()', page.indexOf("fetch('/api/interview-book'")))
  assert.match(call, /email: student\.school_email/)
  assert.match(call, /slotId: chosen\.id/)
  assert.doesNotMatch(call, /studentId/, 'the page must no longer send a student id')
  assert.doesNotMatch(call, /cohortId/, 'the page must no longer send a cohort id')
})

test('S-07: the page renders only fields the trimmed response still provides', () => {
  const page = read('src/components/InterviewSchedulePage.jsx')
  const used = new Set((page.match(/bookedSlot\.([a-zA-Z_][a-zA-Z0-9_]*)/g) || []).map(m => m.split('.').pop()))
  for (const f of used) {
    assert.ok(['slot_date', 'slot_time', 'duration_minutes'].includes(f), `bookedSlot.${f} is no longer returned`)
  }
  // school_email must still be in the LOOKUP allow-list, or the page cannot post it.
  assert.ok(read('api/interview-lookup.js').includes("'school_email'"))
})

// ── No live student data in this file ────────────────────────────────────────────────────────────

test('S-07: this test file contains no real student data', () => {
  const self = read('test/s07InterviewBook.test.mjs')
  assert.doesNotMatch(self, /@cshs\.org/)
  assert.doesNotMatch(self, /\b\d{3}-\d{2}-\d{4}\b/)
  for (const addr of self.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []) {
    assert.match(addr, /@(example\.(com|org|edu)|school\.edu|evil\.example)$/, `${addr} must be fictional`)
  }
})
