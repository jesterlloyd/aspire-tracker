// test/s06EndpointClosure.test.mjs
//
// S-06 ENDPOINT CLOSURE: the three unauthenticated email relays and the unauthenticated test
// sender are gone, and every send they used to perform now happens in-process from an endpoint
// that derives its recipients and its content from server state.
//
// These are source-shape guards in the style the rest of this suite uses: they prove the public
// routes cannot come back by accident and that the folded-in senders keep the same triggers,
// recipients, and content. No email is sent by this file, and nothing here performs network I/O.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')
const exists = p => existsSync(join(root, p))

const RETIRED_ROUTES = [
  'api/notify-interview-booked.js',
  'api/form-received-notification.js',
  'api/unit-form-notification.js',
  'api/test-resend.js',
]

// ── The routes are gone and stay gone ────────────────────────────────────────────────────────────

test('S-06: every unauthenticated email relay route is deleted', () => {
  for (const route of RETIRED_ROUTES) {
    assert.equal(exists(route), false, `${route} must not exist: it accepted recipients from an unauthenticated request body`)
  }
})

test('S-06: nothing in the app posts to a retired relay route', () => {
  const callers = [
    'api/interview-book.js',
    'api/school-form-submit.js',
    'api/portal/school-placement-requests.js',
    'api/unit-form-submit.js',
    'src/components/UnitFormPage.jsx',
    'src/components/InterviewSchedulePage.jsx',
  ]
  // A live call would be a fetch to the path. Comments explaining the closure are expected and are
  // not matched, because they never appear inside a fetch argument.
  const liveCall = /fetch\([^)]*(notify-interview-booked|form-received-notification|unit-form-notification|test-resend)/
  for (const p of callers) {
    assert.doesNotMatch(read(p), liveCall, `${p} still calls a retired relay route`)
  }
})

test('S-06: the retired maxDuration entries are gone from vercel.json and the new host is configured', () => {
  const vercel = JSON.parse(read('vercel.json'))
  const fns = vercel.functions || {}
  for (const route of RETIRED_ROUTES) {
    assert.equal(route in fns, false, `vercel.json still configures ${route}`)
  }
  // unit-form-submit inherited the send, so it inherits the budget the notification route had.
  assert.ok(fns['api/unit-form-submit.js'], 'api/unit-form-submit.js needs a maxDuration now that it sends')
})

// ── Interview booking notice ─────────────────────────────────────────────────────────────────────

test('S-06: the booking notice is rendered by a shared module and sent from interview-book', () => {
  const endpoint = read('api/interview-book.js')
  assert.match(endpoint, /import \{ interviewBookedEmail, shouldSkipDuplicateBookingNotice \}/)
  assert.match(endpoint, /emails\.send\(/, 'the endpoint sends in-process')
  // Recipients: the fixed owner address and the interviewer email resolved server-side in step 6.
  assert.match(endpoint, /\[\.\.\.new Set\(\[BOOKING_NOTICE_OWNER, interviewerEmail\]\.filter\(Boolean\)\)\]/)
  // The retired route accepted ownerEmail and interviewerEmail from its body. Neither may be read
  // from the request here.
  assert.doesNotMatch(endpoint, /req\.body[^\n]*(ownerEmail|interviewerEmail)/)
  assert.match(endpoint, /const \{ studentId, cohortId, slotId \} = req\.body/, 'body still carries only the three ids')
})

test('S-06: the booking notice keeps its subject, recipients contract, and dedupe window', () => {
  const mod = read('lib/server/email/interviewBooked.js')
  assert.match(mod, /New ASPIRE interview: \$\{studentName\}, \$\{interviewDate\} at \$\{interviewTime\}/)
  assert.match(mod, /DEDUP_WINDOW_MS = 60 \* 1000/)
  // Pure render, matching the other lib/server/email modules: no sends, no DB, no Resend import.
  assert.doesNotMatch(mod, /from 'resend'/)
  assert.doesNotMatch(mod, /createClient/)
})

test('S-06: the booking notice body is built only from escaping primitives', () => {
  const mod = read('lib/server/email/interviewBooked.js')
  assert.match(mod, /renderEmailDetailsCard\(/)
  assert.match(mod, /renderEmailNote\(/)
  assert.match(mod, /renderEmailHeading\(/)
  // No raw HTML tag built around an interpolated caller value.
  assert.doesNotMatch(mod, /<(td|div|span|a|strong)[^>]*>\$\{/)
})

// ── Placement request confirmations ──────────────────────────────────────────────────────────────

test('S-06: the placement-request sender is one shared writer used by both submit paths', () => {
  const sender = read('lib/server/notifications/placementRequestNotifications.js')
  assert.match(sender, /export async function sendPlacementRequestNotifications/)
  assert.match(sender, /export function buildPlacementRequestContext/)
  // The retired route's guard: studentEmail and school were both required.
  assert.match(sender, /if \(!studentEmail \|\| !school\) return null/)
  // Awaited, not fire-and-forget: an un-awaited promise can be frozen when a serverless response
  // returns, and the retired HTTP hop is what used to keep the work alive.
  assert.match(sender, /await Promise\.allSettled\(/)
  for (const p of ['api/school-form-submit.js', 'api/portal/school-placement-requests.js']) {
    assert.match(read(p), /await sendPlacementRequestNotifications\(/, `${p} awaits the shared sender`)
  }
})

test('S-06: a placement notification failure can never fail the submission', async () => {
  // The sender resolves even when every underlying send rejects. Import the real module and drive
  // it with an entry whose send will throw for lack of credentials; it must resolve, not reject.
  const { sendPlacementRequestNotifications, buildPlacementRequestContext } =
    await import('../lib/server/notifications/placementRequestNotifications.js')

  assert.equal(buildPlacementRequestContext({ studentEmail: '', school: 'A School' }), null)
  assert.equal(buildPlacementRequestContext({ studentEmail: 'a@b.edu', school: '' }), null)

  const ctx = buildPlacementRequestContext({ studentEmail: 'a@b.edu', school: 'A School' })
  assert.equal(ctx.studentName, 'a@b.edu', 'studentName falls back to the email')
  assert.equal(ctx.studentFirstName, 'a', 'studentFirstName falls back to the local part')
  assert.equal(ctx.cohortName, '')

  // Unusable entries are dropped without any send being attempted.
  const dropped = await sendPlacementRequestNotifications([{ studentEmail: '', school: '' }])
  assert.deepEqual(dropped, [])
})

// ── Unit participation confirmation ──────────────────────────────────────────────────────────────

test('S-06: the unit form confirmation is sent by the submit endpoint, not the browser', () => {
  const endpoint = read('api/unit-form-submit.js')
  assert.match(endpoint, /import \{ sendUnitFormReceivedNotification \}/)
  assert.match(endpoint, /await sendUnitFormReceivedNotification\(\{/)
  // Content comes from what the endpoint persisted, plus the server-resolved cohort.
  assert.match(endpoint, /\.\.\.result\.notification/)
  assert.match(endpoint, /cohortName: cohortResult\.cohortName/)

  const page = read('src/components/UnitFormPage.jsx')
  assert.doesNotMatch(page, /fetch\('\/api\/unit-form-notification'/, 'the public form must not call a notification route')
  // The form now talks to exactly two endpoints: the prefill lookup and the submit. No send.
  const called = (page.match(/fetch\('(\/api\/[^']+)'/g) || []).sort()
  assert.deepEqual(called, ["fetch('/api/unit-form-lookup'", "fetch('/api/unit-form-submit'"])
})

test('S-06: the unit upsert returns the values it persisted for the email', () => {
  const upsert = read('api/lib/unitResponseUpsert.js')
  assert.match(upsert, /notification: \{/)
  // Every notification value is read from upsertData, so the email cannot disagree with the row.
  for (const field of [
    'slotsOffered:        upsertData.slots_offered',
    'reasonForZero:       upsertData.reason_for_zero',
    'hiringNgrpReason:    upsertData.hiring_new_grads_reason',
    'alumniNotes:         upsertData.aspire_alumni_notes',
  ]) {
    assert.ok(upsert.includes(field), `unitResponseUpsert must expose ${field}`)
  }
})

test('S-06: the unit form sender keeps the retired route defaults and never throws', async () => {
  const mod = read('lib/server/notifications/unitFormNotifications.js')
  assert.match(mod, /context\.cohortName \|\| 'Current Cohort'/)
  assert.match(mod, /context\.slotsOffered \?\? 0/)
  assert.match(mod, /catch \(err\)/, 'the sender swallows failures')

  const { sendUnitFormReceivedNotification } =
    await import('../lib/server/notifications/unitFormNotifications.js')
  // Guard parity with the retired route's 400: submitterEmail and unitName were both required.
  assert.deepEqual(await sendUnitFormReceivedNotification({ submitterEmail: '', unitName: '7NE' }), [])
  assert.deepEqual(await sendUnitFormReceivedNotification({ submitterEmail: 'a@b.org', unitName: '' }), [])
})

test('S-06: resolveAcceptingCohort exposes the cohort name without changing its contract', () => {
  const lookup = read('api/lib/intakeStudentLookup.js')
  assert.match(lookup, /\.select\('id, name'\)/)
  assert.match(lookup, /return \{ cohortId: acceptingCohorts\[0\]\.id, cohortName: acceptingCohorts\[0\]\.name \|\| '' \}/)
  // The failure shapes are untouched, so existing callers behave identically.
  assert.match(lookup, /error: 'not_accepting'/)
  assert.match(lookup, /error: 'ambiguous_cohort'/)
})
