// AP-SCHOOL-CANONICALIZATION-1 (revised against the actual production schema: public.schools and
// students.school_id do NOT exist): one connected Academic Partner defect, fixed together.
//
// (1) School canonicalization: the AP portal submitted the canonical scope name
//     ("California State University, Northridge") while the public /school-form submitted the
//     operative name ("Cal State Northridge"); both were persisted verbatim, splitting one school
//     into two At a Glance groups and two rotation rows. Writes now resolve any known variant
//     through the STATIC identity catalog (src/lib/schoolIdentity.js, parity-tested against the
//     existing api/lib/schoolAliases.js vocabulary) and persist ONLY the operative display name;
//     the AP endpoint fails closed on unknown schools (no free-text fallback); At a Glance grouping
//     resolves through the same identity as a defensive safeguard.
// (2) Confirmation email: the retired 'form_received' notification spoke student-application
//     language for a coordinator-submitted placement request. Both submit paths now send
//     'placement_request_received' - placement-request language to the SUBMITTING coordinator plus
//     the internal team, never the student.
//
// Run: node --test test/apPlacementRequestFix.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SCHOOL_IDENTITY_GROUPS, resolveOperativeSchoolName, schoolGroupKey, normSchoolName } from '../src/lib/schoolIdentity.js'
import { SCHOOL_ALIAS_GROUPS } from '../api/lib/schoolAliases.js'
import { placementRequestReceived } from '../src/lib/notifications/templates/placementRequestReceived.js'
import { resolveRecipients } from '../src/lib/notifications/recipients.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

// ─── Canonical school identity (functional) ─────────────────────────────────────

test('every known CSUN variant resolves to the ONE operative identity', () => {
  for (const v of ['California State University, Northridge', 'Cal State Northridge', 'CSUN', 'csu northridge',
    'california state university northridge', '  CAL STATE NORTHRIDGE  ']) {
    assert.equal(resolveOperativeSchoolName(v)?.displayName, 'Cal State Northridge', `variant: ${v}`)
    assert.equal(schoolGroupKey(v), 'Cal State Northridge', `group key for: ${v}`)
  }
})

test('matching is exact-normalized only: no fuzzy guessing on the write path', () => {
  assert.equal(resolveOperativeSchoolName('Northridge'), null)          // substring is NOT enough
  assert.equal(resolveOperativeSchoolName('Cal State'), null)
  assert.equal(resolveOperativeSchoolName('Some New Nursing School'), null)
  assert.equal(resolveOperativeSchoolName(''), null)
  assert.equal(resolveOperativeSchoolName(null), null)
  // Unknown strings keep their exact stored grouping - never invented, never merged.
  assert.equal(schoolGroupKey('Some New Nursing School'), 'Some New Nursing School')
})

test('legitimate distinct scopes stay distinct (WCU campuses never collapse)', () => {
  assert.equal(resolveOperativeSchoolName('WCU NoHo')?.displayName, 'West Coast University North Hollywood')
  assert.equal(resolveOperativeSchoolName('WCU Anaheim')?.displayName, 'West Coast University Anaheim')
  assert.equal(resolveOperativeSchoolName('West Coast University')?.displayName, 'West Coast University')
  assert.notEqual(schoolGroupKey('WCU NoHo'), schoolGroupKey('WCU Anaheim'))
  assert.equal(normSchoolName('California State University, Northridge'), 'california state university northridge')
})

test('parity: the identity catalog carries the existing alias vocabulary (no drift, no new source)', () => {
  // Every canonical name and alias in the repository's existing alias source resolves to the SAME
  // canonical identity in schoolIdentity.js - the identity catalog is that source plus operative
  // names, never a divergent second vocabulary.
  for (const g of SCHOOL_ALIAS_GROUPS) {
    for (const term of [g.canonical, ...g.aliases]) {
      const hit = resolveOperativeSchoolName(term)
      assert.ok(hit, `alias-source term unresolved: ${term}`)
      assert.equal(hit.canonicalName, g.canonical, `term ${term} resolved to a different canonical`)
    }
  }
  // And the two group lists cover the same canonical set.
  const a = SCHOOL_ALIAS_GROUPS.map(g => g.canonical).sort()
  const b = SCHOOL_IDENTITY_GROUPS.map(g => g.canonical).sort()
  assert.deepEqual(b, a)
})

// ─── Corrected confirmation email (functional render) ───────────────────────────

const CTX = {
  studentName: 'Alexander Lim', studentFirstName: 'Alexander',
  school: 'Cal State Northridge', cohortName: 'Fall 2026',
  programType: '', studentEmail: 'alexander.lim@my.csun.example.edu',
  coordinatorName: 'Rebekah J. Howerton Child', coordinatorEmail: 'rebekah.child@csun.example.edu',
}

test('coordinator confirmation: exact subject and Owner-approved placement-request copy', () => {
  const { subject, html } = placementRequestReceived.school_coordinator(CTX, { name: CTX.coordinatorName })
  assert.equal(subject, 'ASPIRE Placement Request Received: Alexander Lim')
  assert.match(html, /Hi Rebekah,/)
  assert.match(html, /Thank you for submitting a placement request for <strong>Alexander Lim<\/strong> from <strong>Cal State Northridge<\/strong>/)
  assert.match(html, /will review it with the rest of the Fall 2026 cohort submissions\./)
  assert.match(html, /follow up with Alexander directly regarding the Student Profile Form, interview scheduling, and next steps\./)
  assert.match(html, /please email us at <a href="mailto:aspire@cshs\.org"[^>]*><strong>aspire@cshs\.org<\/strong><\/a>\./)
  assert.match(html, /Thank you for supporting our students\./)
  assert.match(html, /Kind regards,/)                       // existing approved handwritten signature
  assert.match(html, /signature-jester\.gif/)
  // The localized submitted timestamp survives.
  assert.match(html, /SUBMITTED/i)
  assert.match(html, / PT</)
  // NO application language anywhere: the student did not apply.
  assert.doesNotMatch(html, /application/i)
})

test('the Program row renders only when a program was submitted', () => {
  const blank = placementRequestReceived.school_coordinator(CTX, { name: CTX.coordinatorName }).html
  assert.doesNotMatch(blank, />PROGRAM</i)
  const withProgram = placementRequestReceived.school_coordinator({ ...CTX, programType: 'Traditional BSN' }, { name: CTX.coordinatorName }).html
  assert.match(withProgram, /Traditional BSN/)
})

test('internal team variant speaks placement-request language with submitter provenance', () => {
  const { subject, html } = placementRequestReceived.internal_team(CTX)
  assert.equal(subject, 'New ASPIRE Placement Request: Alexander Lim (Cal State Northridge)')
  assert.match(html, /New ASPIRE Placement Request/)
  assert.match(html, /Rebekah J\. Howerton Child · rebekah\.child@csun\.example\.edu/)
  assert.doesNotMatch(html, /application/i)
})

test('there is NO student variant: a placement request never emails the student', () => {
  assert.equal(placementRequestReceived.student, undefined)
})

// ─── Recipients (functional) ────────────────────────────────────────────────────

test('recipients: the SUBMITTING coordinator + internal team; never the student', async () => {
  const recipients = await resolveRecipients('placement_request_received', CTX)
  const audiences = recipients.map(r => r.audience)
  assert.ok(audiences.includes('school_coordinator'))
  assert.ok(audiences.includes('internal_team'))
  assert.ok(!audiences.includes('student'), 'no student audience')
  assert.ok(!recipients.some(r => r.email === CTX.studentEmail), 'student email never a recipient')
  const coord = recipients.find(r => r.audience === 'school_coordinator')
  assert.equal(coord.email, CTX.coordinatorEmail)             // the actual submitter, not the static map
  assert.equal(coord.isPrimary, true)
})

test('legacy fallback: without coordinatorEmail the static coordinator map still routes', async () => {
  const { coordinatorEmail, coordinatorName, ...legacy } = CTX
  const recipients = await resolveRecipients('placement_request_received', legacy)
  const coord = recipients.find(r => r.audience === 'school_coordinator')
  assert.ok(coord, 'mapped coordinator resolved from the school name')
  assert.ok(!recipients.some(r => r.audience === 'student'))
})

test("the retired 'form_received' notification can never send again (no recipients resolve)", async () => {
  const recipients = await resolveRecipients('form_received', CTX)
  assert.deepEqual(recipients, [])
})

// ─── Wiring guards (source) ─────────────────────────────────────────────────────

test('the shared upsert persists ONE operative identity and never touches absent schema', () => {
  const upsert = read('api/lib/schoolPlacementUpsert.js')
  assert.match(upsert, /resolveOperativeSchoolName\(coordinator\.school\)/)
  assert.match(upsert, /const schoolName = canonicalSchool\?\.displayName \|\| coordinator\.school\.trim\(\)/)
  // Every persisted school field uses the resolved name; the raw string is never written directly.
  assert.match(upsert, /school_name:\s+schoolName/)
  assert.doesNotMatch(upsert, /school:\s+coordinator\.school/)
  assert.doesNotMatch(upsert, /school_name:\s+coordinator\.school/)
  // Production schema truth: no public.schools reads, no students.school_id writes anywhere.
  assert.doesNotMatch(upsert, /from\('schools'\)/)
  assert.doesNotMatch(upsert, /school_id:/)
  assert.match(upsert, /return \{ error: null, added, updated, skipped, rotationId, schoolName \}/)
})

test('the AP endpoint fails closed on unknown schools: no free-text fallback', () => {
  const ep = read('api/portal/school-placement-requests.js')
  assert.match(ep, /if \(!resolveOperativeSchoolName\(school\)\) return res\.status\(422\)\.json\(\{ error: 'unknown_school' \}\)/)
  // The 422 happens BEFORE any write (the upsert call appears later in the file).
  assert.ok(ep.indexOf("error: 'unknown_school'") < ep.indexOf('performSchoolPlacementUpsert(db'), 'fail-closed precedes the write')
  assert.doesNotMatch(ep, /from\('schools'\)|school_id/)
})

test('At a Glance groups Placement Requests by the operative identity (defensive safeguard)', () => {
  const overview = read('src/components/OverviewTab.jsx')
  assert.match(overview, /const key = schoolGroupKey\(s\.school\) \|\| 'Unknown School'/)
  assert.match(overview, /import \{ schoolGroupKey \} from '\.\.\/lib\/schoolIdentity'/)
})

test('both submit paths notify with the canonical school and the submitting coordinator', () => {
  for (const p of ['api/portal/school-placement-requests.js', 'api/school-form-submit.js']) {
    const src = read(p)
    assert.match(src, /school:\s+result\.schoolName \|\| /, `${p} sends the persisted operative name`)
    assert.match(src, /coordinatorEmail:/, `${p} carries the submitting coordinator`)
    assert.match(src, /cohortName/, `${p} carries the cohort name for the email copy`)
    // S-06 ENDPOINT CLOSURE: sent in-process through the shared sender, never by posting to a
    // public route that would accept the recipient from its own request body.
    assert.match(src, /sendPlacementRequestNotifications\(/, `${p} uses the shared sender`)
    assert.doesNotMatch(src, /form-received-notification'/, `${p} does not POST to the retired route`)
  }
  const sender = read('lib/server/notifications/placementRequestNotifications.js')
  assert.match(sender, /sendNotification\('placement_request_received'/)
  assert.doesNotMatch(sender, /sendNotification\('form_received'/)
})

test('archive reconstruction keeps history AND supports the new type', () => {
  const log = read('api/notification-log-message.js')
  assert.match(log, /'form_received',\s*\n\s*'placement_request_received',/)
  const registry = read('src/lib/notifications/templates/index.js')
  assert.match(registry, /placement_request_received:\s+placementRequestReceived/)
  assert.match(registry, /form_received:\s+formReceived/)     // archive-only; send-impossible (no resolver)
})
