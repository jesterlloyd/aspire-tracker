// PLACEMENT-COMMUNICATION-HANDOFF-1
//
// Behavioral on the pure modules (real inputs, real outputs), structural for the
// wiring that cannot be executed here. Every requirement carries a NEGATIVE
// CONTROL: a case that would pass if the guard were absent.
//
// Run: node --test test/placementCommunicationHandoff.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
// Strip comments so an assertion can never be satisfied by prose I wrote about
// the code instead of by the code.
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/^\s*\*.*$/gm, '')

const {
  resolveStudentRotationWindow, formatRotationTerm, rotationTermText, TO_BE_CONFIRMED,
  programLabel, schoolFullName, studentPlacementName, hoursRequiredText,
  studentAvailabilityText, resolvePlacementPreceptor, resolveUnitLeaderGreetingName,
  buildPlacementFacts, missingSummary, singlePlacement,
} = await import('../src/lib/placementCommunication.js')

const { buildUnitLeaderPlacementMessage, buildUnitLeaderEmail, MAX_COMPOSE_URL_LENGTH } =
  await import('../src/lib/emailUtils.js')

const {
  resolveRequiredAttachments, attachmentWarningText, attachmentClaimBlockReason,
  claimsAttachments, normalizeTitle, PRECEPTOR_ASSIGNMENT_DOCUMENTS,
} = await import('../src/lib/connect/catalogAttachments.js')

const { buildPreceptorAssignmentDraft } = await import('../src/lib/outreachTemplates.js')

const { NOTIFY_CONFIRM, notifiedPatch, pendingNotifyTargets, notifyRecordedMessage, notifyFailedMessage } =
  await import('../src/lib/placementNotification.js')

const {
  preceptorSentIndex, preceptorSentState, preceptorSentLabel, preceptorSentTooltip,
  placementSentKey, placementSendMetadata,
} = await import('../src/lib/placementPreceptorSent.js')

// ── 1. The date audit, enforced ─────────────────────────────────────────────

const ROTATION = {
  id: 'rot-1', school_name: 'Cal State Northridge',
  rotation_start_date: '2026-08-24', rotation_end_date: '2026-10-20',
}

test('the linked coordinator rotation row is the authoritative window', () => {
  const student = { cohort_school_rotation_id: 'rot-1', school: 'Cal State Northridge' }
  const win = resolveStudentRotationWindow(student, [ROTATION])
  assert.deepEqual(win, { start: '2026-08-24', end: '2026-10-20', source: 'link' })
})

test('a legacy term_dates string can never become the window', () => {
  // NEGATIVE CONTROL: this student carries the retired free-text column and
  // nothing else. If any code path still read it, a window would appear.
  const student = { term_dates: 'Jun 8 - Aug 18, 2026', school: 'Cal State Northridge' }
  assert.equal(resolveStudentRotationWindow(student, []), null)
  assert.equal(rotationTermText(resolveStudentRotationWindow(student, [])), TO_BE_CONFIRMED)
})

test('a cohort name or cohort date range is never consulted', () => {
  const student = { cohort_school_rotation_id: null, school: 'Unlisted College' }
  const cohortish = [{ id: 'c1', school_name: 'Summer 2026', rotation_start_date: '2026-06-01', rotation_end_date: '2026-08-01' }]
  assert.equal(resolveStudentRotationWindow(student, cohortish), null,
    'a row whose school does not match must never supply this student a window')
})

test('the 1900-01-01 sentinel reads as unknown, not as a start date', () => {
  const sentinel = { id: 'rot-s', school_name: 'UCLA', rotation_start_date: '1900-01-01', rotation_end_date: '2026-10-20' }
  const student = { cohort_school_rotation_id: 'rot-s' }
  assert.equal(resolveStudentRotationWindow(student, [sentinel]), null)
})

test('an explicit link is final: it never falls through to another school', () => {
  // NEGATIVE CONTROL for a tempting "try the school next" fallback. The student
  // is linked to a row that is not present; the SAME school has a usable row.
  // Falling through would quote a window this student is not linked to.
  const other = { id: 'rot-2', school_name: 'UCLA', rotation_start_date: '2026-01-05', rotation_end_date: '2026-03-05' }
  const student = { cohort_school_rotation_id: 'rot-missing', school: 'UCLA' }
  assert.equal(resolveStudentRotationWindow(student, [other]), null)
})

test('an unlinked student resolves through a UNIQUE school match only', () => {
  const student = { school: 'CSUN' }   // an alias of Cal State Northridge
  const win = resolveStudentRotationWindow(student, [ROTATION])
  assert.deepEqual(win, { start: '2026-08-24', end: '2026-10-20', source: 'school' })
})

test('an AMBIGUOUS school match resolves to nothing rather than picking one', () => {
  const dupe = { ...ROTATION, id: 'rot-3', rotation_start_date: '2026-09-01', rotation_end_date: '2026-11-01' }
  const student = { school: 'Cal State Northridge' }
  assert.equal(resolveStudentRotationWindow(student, [ROTATION, dupe]), null)
})

// ── 2. Natural date formatting ──────────────────────────────────────────────

test('a rotation window reads the way a person writes it', () => {
  assert.equal(formatRotationTerm('2026-08-24', '2026-10-20'), 'August 24–October 20, 2026')
  assert.equal(formatRotationTerm('2026-08-24', '2026-08-30'), 'August 24–30, 2026')
  assert.equal(formatRotationTerm('2026-12-28', '2027-01-15'), 'December 28, 2026–January 15, 2027')
})

test('a one-sided or malformed window is not half an answer', () => {
  assert.equal(formatRotationTerm('2026-08-24', null), null)
  assert.equal(formatRotationTerm('2026-02-31', '2026-03-05'), null, 'calendar overflow is not a date')
  assert.equal(rotationTermText(null), TO_BE_CONFIRMED)
})

// ── 3. Canonical student values ─────────────────────────────────────────────

test('school resolves to the formal institutional name, unknowns pass through', () => {
  assert.equal(schoolFullName('CSUN'), 'California State University, Northridge')
  assert.equal(schoolFullName('Cal State Northridge'), 'California State University, Northridge')
  assert.equal(schoolFullName('UCLA'), 'University of California, Los Angeles')
  assert.equal(schoolFullName('Some Unlisted College'), 'Some Unlisted College')
  assert.equal(schoolFullName(''), '')
})

test('stored program codes become human-readable labels', () => {
  assert.equal(programLabel('MECN'), "Master's Entry Clinical Nurse (MECN)")
  assert.equal(programLabel('ELMN'), "Entry-Level Master's in Nursing (ELMN)")
  assert.equal(programLabel('Accelerated BSN'), 'Accelerated BSN (ABSN)')
  assert.equal(programLabel('BSN Semester'), 'BSN (Semester)')
  assert.equal(programLabel('Something New'), 'Something New', 'unknown values are never guessed at')
})

test('identity is Last, First with a preferred name surfaced only when it differs', () => {
  assert.equal(studentPlacementName({ first_name: 'Ana', last_name: 'Cruz' }), 'Cruz, Ana')
  assert.equal(
    studentPlacementName({ first_name: 'Anamaria', last_name: 'Cruz', preferred_first_name: 'Ana' }),
    'Cruz, Anamaria “Ana”')
  assert.equal(
    studentPlacementName({ first_name: 'Ana', last_name: 'Cruz', preferred_first_name: 'ana' }),
    'Cruz, Ana', 'a preferred name equal to the legal first name is not quoted')
})

test('hours are stated with their unit, and absence stays absent', () => {
  assert.equal(hoursRequiredText({ hours_required: 144 }), '144 hours')
  assert.equal(hoursRequiredText({ hours_required: '90 hours' }), '90 hours')
  assert.equal(hoursRequiredText({ hours_required: null }), '')
})

test('availability is built from student-owned fields only', () => {
  const text = studentAvailabilityText({
    preferred_days: ['Wed', 'Thu'],
    unavailable_weekdays: ['Mon', 'Tue'],
    weekends_available: true,
    nights_available: false,
    personal_blackout_dates: ['2026-09-07'],
    availability_notes: 'Class until noon on Fridays',
  })
  assert.match(text, /Preferred days: Wed, Thu/)
  assert.match(text, /Unavailable: Mon, Tue/)
  assert.match(text, /Weekends: available/)
  assert.match(text, /Nights: not available/)
  assert.match(text, /Blackout dates: 2026-09-07/)
  assert.match(text, /Class until noon on Fridays/)
})

test('a student who shared nothing produces no availability claim', () => {
  assert.equal(studentAvailabilityText({}), '')
  assert.equal(studentAvailabilityText(null), '')
})

// ── 4. The placement's preceptor ────────────────────────────────────────────

const PRECEPTORS = new Map([
  ['p-icu', { id: 'p-icu', full_name: 'Dana Reyes', email: 'dana@cshs.org', shift_type: 'Night' }],
  ['p-med', { id: 'p-med', full_name: 'Sam Ortiz', email: 'sam@cshs.org', shift_type: 'Day' }],
])

// THE MULTI-UNIT NEGATIVE-CONTROL FIXTURE, exactly as specified:
//   one student, two units; a student-level preceptor belonging to Unit A;
//   Unit A's match carries that preceptor; Unit B's match carries none.
const MULTI = {
  student: {
    id: 'stu-kai', preceptor_id: 'p-med', matched_preceptor: 'Sam Ortiz',
    preceptor_email: 'sam@cshs.org', shift_assigned: 'Day',
  },
  unitA: { id: 'm-a', student_id: 'stu-kai', unit_id: 'u-med', preceptor_id: 'p-med', preceptor_assigned: 'Sam Ortiz' },
  unitB: { id: 'm-b', student_id: 'stu-kai', unit_id: 'u-icu', preceptor_id: null, preceptor_assigned: '' },
}
MULTI.all = [MULTI.unitA, MULTI.unitB]

test('Unit A resolves its OWN preceptor from its own match row', () => {
  const p = resolvePlacementPreceptor({
    student: MULTI.student, match: MULTI.unitA, preceptorsById: PRECEPTORS, studentMatches: MULTI.all,
  })
  assert.equal(p.name, 'Sam Ortiz')
  assert.equal(p.source, 'match_record')
})

test('Unit B shows NO preceptor at all - never Unit A\'s', () => {
  const p = resolvePlacementPreceptor({
    student: MULTI.student, match: MULTI.unitB, preceptorsById: PRECEPTORS, studentMatches: MULTI.all,
  })
  assert.equal(p, null,
    'a second placement that names nobody must resolve to nobody, not to the student-level field')
})

test('NEGATIVE CONTROL: without the multi-placement guard, Unit B inherits Sam', () => {
  // The SAME inputs with the evidence withheld in the pre-correction way: a
  // resolver that consulted students.preceptor_id unconditionally answers "Sam
  // Ortiz" for Unit B, which is the cross-assignment this closes.
  const wouldHaveBeen = PRECEPTORS.get(MULTI.student.preceptor_id)
  assert.equal(wouldHaveBeen.full_name, 'Sam Ortiz')
  assert.equal(wouldHaveBeen.email, 'sam@cshs.org',
    'so the un-guarded fallback would have emailed Unit A’s preceptor about Unit B')
})

test('the Unit B row therefore offers Assign preceptor and no envelope', () => {
  const facts = buildPlacementFacts({
    student: MULTI.student, unit: { unit_name: '6 ICU' }, match: MULTI.unitB,
    rotationRows: [], preceptorsById: PRECEPTORS, studentMatches: MULTI.all,
  })
  assert.equal(facts.preceptorName, '')
  assert.equal(facts.preceptorEmail, '')
  assert.equal(facts.preceptorId, null)
  // The row's own condition, mirrored: no name -> the Assign preceptor action.
  assert.equal(!!facts.preceptorName, false)
})

test('a different preceptor per placement is honored, not merged', () => {
  const student = { id: 's1', preceptor_id: 'p-med', matched_preceptor: 'Sam Ortiz' }
  const a = { id: 'ma', student_id: 's1', unit_id: 'u-med', preceptor_id: 'p-med' }
  const b = { id: 'mb', student_id: 's1', unit_id: 'u-icu', preceptor_id: 'p-icu' }
  const all = [a, b]
  assert.equal(resolvePlacementPreceptor({ student, match: a, preceptorsById: PRECEPTORS, studentMatches: all }).name, 'Sam Ortiz')
  assert.equal(resolvePlacementPreceptor({ student, match: b, preceptorsById: PRECEPTORS, studentMatches: all }).name, 'Dana Reyes')
})

test('the SINGLE-placement fallback still works, because the evidence proves it', () => {
  const student = { id: 's2', preceptor_id: 'p-med' }
  const only = [{ id: 'm1', student_id: 's2', unit_id: 'u-med' }]
  const p = resolvePlacementPreceptor({ student, match: only[0], preceptorsById: PRECEPTORS, studentMatches: only })
  assert.equal(p.name, 'Sam Ortiz')
  assert.equal(p.source, 'student_record')
})

test('single-placement free text still answers when no canonical record exists', () => {
  const student = { id: 's3', matched_preceptor: 'Jo Park', preceptor_email: 'jo@cshs.org', shift_assigned: 'Day' }
  const only = [{ id: 'm1', student_id: 's3', unit_id: 'u-med' }]
  const p = resolvePlacementPreceptor({ student, match: only[0], preceptorsById: PRECEPTORS, studentMatches: only })
  assert.equal(p.name, 'Jo Park')
  assert.equal(p.source, 'student_text')
})

test('the fallback FAILS CLOSED when the caller offers no evidence', () => {
  const student = { preceptor_id: 'p-med', matched_preceptor: 'Sam Ortiz' }
  const match = { unit_id: 'u-med' }
  assert.equal(resolvePlacementPreceptor({ student, match, preceptorsById: PRECEPTORS }), null,
    'unknown placement count is not proof of a single placement')
  assert.equal(resolvePlacementPreceptor({ student, match, preceptorsById: PRECEPTORS, studentMatches: [] }), null,
    'an empty match list is not proof either')
})

test('singlePlacement only says yes to exactly one', () => {
  assert.equal(singlePlacement([{ id: 'a' }]), true)
  assert.equal(singlePlacement([{ id: 'a' }, { id: 'b' }]), false)
  assert.equal(singlePlacement([]), false)
  assert.equal(singlePlacement(undefined), false)
  assert.equal(singlePlacement(null), false)
})

test('no preceptor anywhere is null, never a placeholder name', () => {
  assert.equal(resolvePlacementPreceptor({ student: {}, match: {}, preceptorsById: PRECEPTORS, studentMatches: [{}] }), null)
})

// ── 5. The unit leader's greeting ───────────────────────────────────────────

const LEADERS = [
  { unit_name: '5 SCCT', full_name: 'Margaret Villanueva', preferred_name: 'Peachy', email: 'peachy@cshs.org', is_primary_lead: true, is_active: true },
  { unit_name: '5 SCCT', full_name: 'Robert Chen', preferred_name: '', email: 'rob@cshs.org', is_primary_lead: false, is_active: true },
]

test('the greeting names the person the message is actually addressed to', () => {
  const r = resolveUnitLeaderGreetingName({
    unit: { unit_name: '5 SCCT', contact_person: 'Someone Else' },
    leaders: LEADERS,
    recipientEmails: ['rob@cshs.org'],
  })
  assert.equal(r.name, 'Robert')
  assert.equal(r.source, 'unit_leader_recipient')
})

test('preferred_name wins over the legal first name', () => {
  const r = resolveUnitLeaderGreetingName({
    unit: { unit_name: '5 SCCT' }, leaders: LEADERS, recipientEmails: ['peachy@cshs.org'],
  })
  assert.equal(r.name, 'Peachy')
})

test('free-text contact_person is parsed conservatively', () => {
  const cases = [
    ['Ana Cruz', 'Ana'],
    ['Cruz, Ana', 'Ana'],                       // written last-name-first
    ['Ana Cruz; Ben Diaz', 'Ana'],              // first listed person
    ['Dr. Ana Cruz', 'Ana'],                    // a title is not a name
    ['Ana Cruz, MSN, RN', 'Ana'],
  ]
  for (const [input, expected] of cases) {
    assert.equal(resolveUnitLeaderGreetingName({ unit: { unit_name: 'X', contact_person: input } }).name,
      expected, `contact_person ${JSON.stringify(input)}`)
  }
})

test('credentials alone never become a greeting name', () => {
  // NEGATIVE CONTROL: "Dear MSN," is the failure this refuses.
  const r = resolveUnitLeaderGreetingName({ unit: { unit_name: '5 SCCT', contact_person: 'MSN, RN' } })
  assert.equal(r.name, null)
  assert.equal(r.source, 'none')
})

// ── 6. The unit-leader message ──────────────────────────────────────────────

const FULL_STUDENT = {
  first_name: 'Anamaria', last_name: 'Cruz', preferred_first_name: 'Ana',
  school: 'CSUN', program_type: 'Accelerated BSN', hours_required: 144,
  shift_availability: 'Day', cohort_school_rotation_id: 'rot-1',
  preferred_days: ['Wed', 'Thu'], nights_available: false,
}

const buildFor = (student, extra = {}) => buildPlacementFacts({
  student,
  unit: { unit_name: '5 SCCT' },
  match: { unit_id: 'u1', preceptor_id: 'p-icu' },
  rotationRows: [ROTATION],
  preceptorsById: PRECEPTORS,
  studentMatches: [{ id: 'only', unit_id: 'u1' }],
  ...extra,
})

const messageFor = (facts, greetingName = 'Peachy') => buildUnitLeaderPlacementMessage({
  contactEmails: 'peachy@cshs.org; rob@cshs.org',
  unitName: '5 SCCT',
  greetingName,
  students: [{
    name: facts.studentName, school: facts.school, program: facts.program,
    termDates: facts.termDates, hoursRequired: facts.hoursRequired,
    shiftPreference: facts.shiftPreference, preceptorName: facts.preceptorName,
    availability: facts.availability,
  }],
})

test('the notice carries the requested wording and the canonical values', () => {
  const m = messageFor(buildFor(FULL_STUDENT))
  assert.equal(m.subject, 'ASPIRE placement: Cruz, Anamaria “Ana” — 5 SCCT')
  assert.match(m.body, /^Dear Peachy and team,/)
  assert.match(m.body, /Affiliate Students' Pathway from Internship to Residency Experience/)
  assert.match(m.body, /We are pleased to share the following placement for your unit:/)
  assert.match(m.body, /Student: Cruz, Anamaria “Ana”/)
  assert.match(m.body, /School: California State University, Northridge/)
  assert.match(m.body, /Program: Accelerated BSN \(ABSN\)/)
  assert.match(m.body, /Term Dates: August 24–October 20, 2026/)
  assert.match(m.body, /Hours Required: 144 hours/)
  assert.match(m.body, /Shift Preference: Day/)
  assert.match(m.body, /Preceptor: Dana Reyes/)
  assert.match(m.body, /kindly confirm with your team which preceptor will be working with this student so we can coordinate the next steps/)
  assert.match(m.body, /we will send the preceptor a separate onboarding email with full details and guidelines/)
  assert.match(m.body, /If it helps in preceptor selection, the student shared the following availability for shifts: Preferred days: Wed, Thu; Nights: not available\./)
})

test('the body ends at the final thank-you, with no closing and no signature', () => {
  const m = messageFor(buildFor(FULL_STUDENT))
  assert.ok(m.body.trimEnd().endsWith(
    'Thank you again for your support of clinical nursing education at Cedars-Sinai.'),
  `body must end at the thank-you, ended with: ${JSON.stringify(m.body.slice(-70))}`)
  // NEGATIVE CONTROL: Outlook supplies the closing inside the sender's signature,
  // so writing one here produced a stranded or duplicated sign-off.
  for (const fragment of ['Kind regards', 'Warm regards', 'Jester Lloyd Bautista', 'Brawerman', 'cshs.org | 310']) {
    assert.ok(!m.body.includes(fragment), `closing or signature fragment leaked: ${fragment}`)
  }
  // And nothing trailing it - no blank placeholder line waiting for a name.
  assert.equal(m.body, m.body.trimEnd(), 'no trailing blank signature placeholder')
})

test('BOTH unit-leader entry points end the same way, from one builder', () => {
  // Neither surface composes the unit-leader body itself, so neither can append a
  // closing to it. (ActionCenter's KR_SIG belongs to its OTHER mailtos - the
  // preceptor welcome and orientation notes - which this task does not touch.)
  const board = strip(read('src/components/EmbedUnitCard.jsx'))
  const ac = strip(read('src/components/ActionCenter.jsx'))
  assert.ok(!/Kind regards/.test(board), 'the board must not add a closing of its own')
  const acUnitBlock = ac.slice(ac.indexOf('const href = unit ? buildUnitLeaderEmail'),
    ac.indexOf('return { id:`${s.id}-un`'))
  assert.ok(!/KR_SIG|Kind regards/.test(acUnitBlock),
    'the Action Center unit-leader notice must not append a signature')
  assert.match(board, /buildUnitLeaderPlacementMessage\(/)
  assert.match(strip(read('src/components/ActionCenter.jsx')), /buildUnitLeaderEmail\(/)
  // buildUnitLeaderEmail delegates, so the two cannot produce different bodies.
  assert.match(strip(read('src/lib/emailUtils.js')),
    /export function buildUnitLeaderEmail\(args\) \{\s*return buildUnitLeaderPlacementMessage\(args\)\.url/)
})

test('the greeting falls back to the unit team when no name is reliable', () => {
  const m = messageFor(buildFor(FULL_STUDENT), null)
  assert.match(m.body, /^Dear 5 SCCT team,/)
  assert.ok(!m.body.includes('undefined') && !m.body.includes('null'))
})

test('unavailable values print To be confirmed and are never invented', () => {
  const bare = { first_name: 'Lee', last_name: 'Ng', term_dates: 'Jun 8 - Aug 18, 2026' }
  const facts = buildPlacementFacts({
    student: bare, unit: { unit_name: '5 SCCT' }, match: null, rotationRows: [], preceptorsById: null,
  })
  const m = messageFor(facts)
  assert.match(m.body, /Term Dates: To be confirmed/)
  assert.match(m.body, /Hours Required: To be confirmed/)
  assert.match(m.body, /Preceptor: To be confirmed/)
  assert.ok(!m.body.includes('Jun 8'), 'the retired free-text column must not appear')
  assert.match(m.body, /has not shared shift availability yet/)
})

test('missing canonical values are enumerated for the pre-open review', () => {
  const facts = buildPlacementFacts({
    student: { first_name: 'Lee', last_name: 'Ng' },
    unit: { unit_name: '5 SCCT' }, match: null, rotationRows: [], preceptorsById: null,
  })
  const keys = facts.missing.map(m => m.key)
  for (const k of ['school', 'program', 'term_dates', 'hours', 'shift', 'availability']) {
    assert.ok(keys.includes(k), `missing ledger should list ${k}`)
  }
  assert.match(missingSummary(facts.missing), /are not on file yet\.$/)
  // NEGATIVE CONTROL: a complete student reports nothing missing.
  assert.deepEqual(buildFor(FULL_STUDENT).missing, [])
})

test('recipients and the compose target are unchanged', () => {
  const m = messageFor(buildFor(FULL_STUDENT))
  assert.ok(m.url.startsWith('https://outlook.office.com/mail/deeplink/compose?'))
  assert.match(m.url, /[?&]bcc=peachy%40cshs\.org%2Crob%40cshs\.org/,
    'the semicolon-separated contact list still becomes one comma-joined bcc')
  assert.ok(!/[?&](to|cc)=/.test(m.url), 'no to/cc recipient rule was introduced')
})

test('the whole message survives URL encoding and stays a practical length', () => {
  const m = messageFor(buildFor(FULL_STUDENT))
  const parsed = new URL(m.url)
  assert.equal(parsed.searchParams.get('subject'), m.subject)
  assert.equal(parsed.searchParams.get('body'), m.body,
    'decoding must return the body byte-for-byte, including line breaks and curly quotes')
  assert.ok(m.body.includes('\n\n'), 'intentional blank lines are preserved')
  // MEASURED, not assumed: a one-student notice encodes to ~1.7k characters, so
  // it clears the practical URL ceiling with a wide margin. A unit would need
  // roughly fourteen simultaneous placements to approach it.
  assert.ok(m.urlLength < 2200, `single-student compose URL was ${m.urlLength}`)
  assert.ok(m.urlLength < MAX_COMPOSE_URL_LENGTH)
  assert.equal(m.tooLong, false)
})

test('a very long multi-student notice is reported as too long, not opened silently', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    name: `Student ${i}`, school: 'California State University, Northridge',
    program: 'Accelerated BSN (ABSN)', termDates: 'August 24–October 20, 2026',
    hoursRequired: '144 hours', shiftPreference: 'Day', preceptorName: 'Dana Reyes',
    availability: 'Preferred days: Wed, Thu; Unavailable: Mon, Tue; Blackout dates: 2026-09-07',
  }))
  const m = buildUnitLeaderPlacementMessage({ contactEmails: 'a@b.org', unitName: '5 SCCT', greetingName: 'Peachy', students: many, isMultiStudent: true })
  assert.equal(m.tooLong, true)
  assert.match(m.subject, /^ASPIRE placements: 20 students — 5 SCCT$/)
})

test('the URL-only form still exists for existing callers', () => {
  const url = buildUnitLeaderEmail({ contactEmails: 'a@b.org', unitName: 'X', students: [{ name: 'Ng, Lee' }] })
  assert.equal(typeof url, 'string')
  assert.ok(url.startsWith('https://outlook.office.com/'))
})

// ── 7. ASPIRE Catalog documents ─────────────────────────────────────────────

const OPTIONS = [
  { slug: 'aspire-brochure', title: 'ASPIRE Brochure', type_label: 'PDF' },
  { slug: 'prelicensure-guidelines', title: 'Pre-licensure Student General Guidelines', type_label: 'PDF' },
  { slug: 'other-doc', title: 'Preceptor Handbook', type_label: 'PDF' },
]

test('both promised documents resolve from the Catalog by exact-normalized title', () => {
  const r = resolveRequiredAttachments(OPTIONS)
  assert.equal(r.ok, true)
  assert.deepEqual(r.resolved.map(a => a.slug), ['aspire-brochure', 'prelicensure-guidelines'])
  assert.deepEqual(r.problems, [])
  assert.ok(!('storage_path' in r.resolved[0]), 'no storage path may reach the client model')
})

test('normalization is case, hyphen and apostrophe tolerant but never fuzzy', () => {
  assert.equal(normalizeTitle('Pre-Licensure Student General Guidelines'),
    normalizeTitle('Pre licensure student general guidelines'))
  assert.notEqual(normalizeTitle('Guidelines'), normalizeTitle('Pre-Licensure Student General Guidelines'))
})

test('a missing document is reported, not silently dropped', () => {
  const r = resolveRequiredAttachments([OPTIONS[0]])
  assert.equal(r.ok, false)
  assert.deepEqual(r.problems.map(p => p.code), ['missing'])
  assert.match(attachmentWarningText(r.problems), /not an active, attachable file/)
})

test('two Catalog files with the same title are AMBIGUOUS, never a coin flip', () => {
  const dupes = [...OPTIONS, { slug: 'brochure-v2', title: 'ASPIRE Brochure', type_label: 'PDF' }]
  const r = resolveRequiredAttachments(dupes)
  assert.equal(r.ok, false)
  assert.deepEqual(r.problems.map(p => p.code), ['ambiguous'])
  assert.ok(!r.resolved.some(a => a.requiredKey === 'aspire_brochure'))
})

test('a Catalog that could not be read is UNAVAILABLE, not empty', () => {
  const r = resolveRequiredAttachments(null)
  assert.equal(r.ok, false)
  assert.deepEqual(r.problems.map(p => p.code), ['unavailable', 'unavailable'])
  assert.match(attachmentWarningText(r.problems), /could not be read/)
})

// ── 8. The "never claim what you are not carrying" guard ────────────────────

const RESOLVED_SLUGS = ['aspire-brochure', 'prelicensure-guidelines']
const asItems = (slugs) => slugs.map(slug => ({ slug }))

test('a body with both documents attached and server-verified may send', () => {
  const reason = attachmentClaimBlockReason({
    body: 'Scope of practice: Please see attached ASPIRE Brochure and General Guidelines for Pre-Licensure Students for your reference.',
    selected: asItems(RESOLVED_SLUGS),
    serverResolved: asItems(RESOLVED_SLUGS),
    requiredSlugs: RESOLVED_SLUGS,
  })
  assert.equal(reason, null)
})

test('removing an attachment while the claim remains blocks the send', () => {
  const reason = attachmentClaimBlockReason({
    body: 'Please see attached ASPIRE Brochure and General Guidelines for Pre-Licensure Students for your reference..',
    selected: asItems(['aspire-brochure']),
    serverResolved: asItems(['aspire-brochure']),
    requiredSlugs: RESOLVED_SLUGS,
  })
  assert.match(reason, /says documents are attached/)
})

test('a selection the SERVER has not verified blocks the send', () => {
  const reason = attachmentClaimBlockReason({
    body: 'Please see the attached documents.',
    selected: asItems(RESOLVED_SLUGS),
    serverResolved: [],
    requiredSlugs: RESOLVED_SLUGS,
  })
  assert.match(reason, /not been verified by the server/)
})

test('an unresolvable Catalog blocks any claim at all', () => {
  const reason = attachmentClaimBlockReason({
    body: 'Please see attached ASPIRE Brochure and General Guidelines for Pre-Licensure Students for your reference..',
    selected: [], serverResolved: [], requiredSlugs: [],
  })
  assert.match(reason, /could not be identified in the ASPIRE Catalog/)
})

test('NEGATIVE CONTROL: a body that claims nothing is never blocked', () => {
  const reason = attachmentClaimBlockReason({
    body: 'The ASPIRE brochure can be shared separately for your reference.',
    selected: [], serverResolved: [], requiredSlugs: [],
  })
  assert.equal(reason, null)
  assert.equal(claimsAttachments('<p>The brochure can be shared separately.</p>'), false)
})

test('the claim is detected through the rich editor HTML too', () => {
  assert.equal(claimsAttachments('<ul><li>Scope of practice: Please <b>see the attached</b> ASPIRE brochure</li></ul>'), true)
})

// ── 9. The merged preceptor template ────────────────────────────────────────

const PLACEMENT = {
  studentName: 'Cruz, Anamaria “Ana”',
  school: 'California State University, Northridge',
  unit: '5 SCCT',
  schedule: 'August 24–October 20, 2026',
  hoursRequired: '144 hours',
  notes: 'Night shift',
  preceptorFirstName: 'Dana',
}

test('the merged draft carries the real placement, not placeholders', () => {
  const d = buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: true })
  assert.equal(d.subject, 'ASPIRE: Student Assignment and Introduction Details')
  assert.match(d.body, /^Preceptor Assignment & Details\n\nDear Dana,/)
  assert.match(d.body, /Student: Cruz, Anamaria “Ana”/)
  assert.match(d.body, /School: California State University, Northridge/)
  assert.match(d.body, /Unit \/ Assignment: 5 SCCT/)
  assert.match(d.body, /Rotation Dates \/ Schedule: August 24–October 20, 2026/)
  assert.match(d.body, /Required Hours: 144 hours/)
  assert.match(d.body, /Additional Notes: Night shift/)
  for (const ph of ['[Student Name]', '[School]', '[Unit / Assignment]', '[Rotation Dates / Schedule]', '[Required Hours']) {
    assert.ok(!d.body.includes(ph), `placeholder survived the merge: ${ph}`)
  }
  assert.ok(!d.richBody.includes('[Student Name]'), 'the rich body must merge too')
})

test('Additional Notes is omitted rather than left as placeholder text', () => {
  const d = buildPreceptorAssignmentDraft({ placement: { ...PLACEMENT, notes: '' }, attachmentsAttached: true })
  assert.ok(!d.body.includes('Additional Notes'))
  assert.ok(!d.richBody.includes('Additional Notes'))
  assert.ok(!d.body.includes('[Insert any relevant notes'))
})

test('every true section heading is Title Case', () => {
  const d = buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: true })
  for (const heading of [
    'Preceptor Assignment & Details',
    'Student Assignment Summary',
    'Details Requested for the Introduction',
    'A Few Quick Reminders',
  ]) {
    assert.ok(d.richBody.includes(`<h2>${heading.replace(/&/g, '&amp;')}</h2>`) || d.richBody.includes(`<h2>${heading}</h2>`),
      `rich heading missing or not Title Case: ${heading}`)
  }
  assert.match(d.body, /\nStudent Assignment Summary\n/)
  assert.match(d.body, /\nDetails Requested for the Introduction\n/)
  assert.match(d.body, /\nA Few Quick Reminders\n/)
  // NEGATIVE CONTROL: the previous sentence-case headings are gone.
  for (const old of ['Student assignment summary', 'Details requested for the introduction', 'A few quick reminders']) {
    assert.ok(!d.richBody.includes(`<h2>${old}</h2>`), `sentence-case heading survived: ${old}`)
  }
})

// PLACEMENT-NOTIFICATION-CONTROL-1 supersedes the wording this test previously
// pinned: the "Scope of practice: " label is dropped (no other reminder carries
// one) and the sentence reads "see the attached". The negative control below
// keeps the superseded text from creeping back.
test('the attachment reminder is EXACTLY the requested wording', () => {
  const EXPECTED = 'Please see the attached ASPIRE Brochure and General Guidelines for Pre-Licensure Students for your reference.'
  const SUPERSEDED = 'Scope of practice: Please see attached ASPIRE Brochure'
  for (const d of [
    buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: true }),
    buildPreceptorAssignmentDraft({ firstName: 'Dana', attachmentsAttached: true }),   // manual path
  ]) {
    assert.ok(d.body.includes(EXPECTED), 'plain body must carry the exact sentence')
    assert.ok(d.richBody.includes(EXPECTED), 'rich body must carry the exact sentence')
    assert.ok(!d.body.includes(SUPERSEDED), 'the superseded wording must not survive')
    assert.ok(!d.richBody.includes(SUPERSEDED), 'the superseded wording must not survive')
  }
})

test('the OLD attachment wording has zero active occurrences anywhere', () => {
  const OLD = 'can be added before sending or shared separately'
  const files = [
    'src/lib/outreachTemplates.js', 'src/lib/connect/catalogAttachments.js',
    'src/components/connect/OutreachView.jsx', 'src/components/EmbedUnitCard.jsx',
    'src/lib/keithKnowledge.js', 'src/components/ActionCenter.jsx',
  ]
  for (const f of files) {
    assert.ok(!strip(read(f)).includes(OLD), `the retired wording is still active in ${f}`)
  }
  // And it is not reachable from the builder in ANY state.
  for (const attachmentsAttached of [true, false]) {
    const d = buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached })
    assert.ok(!d.body.includes(OLD) && !d.richBody.includes(OLD))
  }
})

test('an unattached draft says NOTHING about the documents rather than lying', () => {
  const notAttached = buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: false })
  assert.ok(!/see the attached/i.test(notAttached.body), 'it must not claim attachments')
  assert.ok(!/see the attached/i.test(notAttached.richBody))
  assert.ok(!/Scope of practice/.test(notAttached.body), 'the bullet is omitted entirely')
  assert.ok(!/Scope of practice/.test(notAttached.richBody))
  // The other three reminders survive - only the attachment claim is withheld.
  for (const kept of ['Preceptor pay:', 'Coverage:', 'Floating:']) {
    assert.match(notAttached.body, new RegExp(kept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('the manual template path resolves and attaches the SAME two documents', () => {
  const src = strip(read('src/components/connect/OutreachView.jsx'))
  assert.match(src, /if \(t\.key === 'preceptor_assignment' && !activePlacement\) \{\s*docs = await fetchRequiredDocs\(\)\s*setManualDocs\(docs\)/,
    'picking the template by hand must resolve the Catalog before the draft is written')
  assert.match(src, /applyTemplate\(t\.key, docs\)/,
    'and hand the freshly resolved set straight to the application - setState is not synchronous, so reading it back from state would drop it')
  assert.match(src, /queryKey: \['outreach_attachment_options'\]/,
    'and share the attachment picker’s cache, so both describe one Catalog')
  assert.match(src, /if \(key === 'preceptor_assignment'\) \{\s*setDmAttachments\(docs\.resolved/,
    'both paths preselect from the same resolved set')
  assert.match(src, /attachmentsAttached: docs\.ok/,
    'and the wording follows the SAME resolution, not the launch')
  assert.match(src, /const docs = docsOverride \|\| effectiveDocs/,
    'with the launch path falling back to its carried resolution')
})

test('the template with no placement is the unchanged placeholder draft', () => {
  const d = buildPreceptorAssignmentDraft({ firstName: 'Dana' })
  assert.match(d.body, /Student: \[Student Name\]/)
  assert.ok(!/see the attached/i.test(d.body))
})

test('no email signature is embedded in the template body', () => {
  const d = buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: true })
  for (const fragment of ['Warm regards', 'Kind regards', 'Jester Lloyd Bautista']) {
    assert.ok(!d.body.includes(fragment), `template must not carry its own closing: ${fragment}`)
  }
})

test('no font or typography styling is introduced by the template', () => {
  const d = buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: true })
  assert.ok(!/font-family|font-size|style=/.test(d.richBody),
    'the template must inherit the app’s existing email typography')
})

// ── 10. Wiring that cannot be executed here ─────────────────────────────────

test('the Placement Board hands off through sessionStorage, never the URL', () => {
  const src = strip(read('src/components/EmbedUnitCard.jsx'))
  assert.match(src, /writeLaunchContext\(\{/)
  assert.match(src, /LAUNCH_KINDS\.PRECEPTOR_ASSIGNMENT/)
  assert.match(src, /navigate\('\/connect\/outreach\?launch=1'/)
  // NEGATIVE CONTROL: no student or message value may ride in a query string.
  const navCall = src.slice(src.indexOf("navigate('/connect/outreach"), src.indexOf("navigate('/connect/outreach") + 400)
  for (const leak of ['studentName=', 'subject=', 'body=', 'school=', 'email=']) {
    assert.ok(!navCall.includes(leak), `handoff leaked ${leak} into the URL`)
  }
})

test('the preceptor envelope never opens a mailto', () => {
  const src = strip(read('src/components/EmbedUnitCard.jsx'))
  const start = src.indexOf('const handleEmailPreceptor')
  assert.ok(start > 0, 'handler not found')
  const handler = src.slice(start, src.indexOf('\n  const ', start + 10) > 0 ? src.indexOf('\n\n  //', start) : src.length)
  assert.ok(!handler.includes('openMailtoLink'), 'the preceptor envelope must not use mailto')
  assert.ok(!handler.includes('buildUnitLeaderEmail'))
})

test('opening Connect writes nothing and notifies nobody', () => {
  const src = strip(read('src/components/EmbedUnitCard.jsx'))
  const start = src.indexOf('const handleEmailPreceptor')
  const end = src.indexOf('return (', start)
  const handler = src.slice(start, end)
  assert.ok(!handler.includes('onUpdateMatch'), 'the handoff must not mark anyone notified')
  assert.ok(!handler.includes('notification_sent'))
  assert.ok(!handler.includes('.insert('), 'the handoff must not write any row')
  assert.ok(!handler.includes('.update('))
  // The only database access is the read that resolves the recipient contact.
  assert.match(handler, /\.from\('contacts'\)[\s\S]*?\.select\(/)
})

test('the composer applies the handoff only for the matching recipient and cohort', () => {
  const src = strip(read('src/components/connect/OutreachView.jsx'))
  assert.match(src, /preceptorLaunch\.cohortId === cohortId/,
    'a handoff must not survive into another cohort')
  assert.match(src, /recipient\?\.contactId \|\| ''\) === String\(contactId\)/,
    'a handoff must apply only to the contact it was written for')
})

test('the composer never overwrites an existing draft without asking', () => {
  const src = strip(read('src/components/connect/OutreachView.jsx'))
  const i = src.indexOf("if (handoffSeed && DRAFT_KEY && placementAppliedRef.current !== DRAFT_KEY)")
  assert.ok(i > 0, 'handoff application not found in the restore effect')
  const block = src.slice(i, i + 1700)
  assert.match(block, /if \(d && !directDraftIsEmpty\(d\) && !isOwnDraft\) \{\s*setReplaceTemplateKey\('preceptor_assignment'\)/,
    'an existing UNRELATED draft still gets the branded confirmation - only the handoff’s OWN restored draft skips it')
})

test('the send is blocked while the draft makes an unbacked attachment claim', () => {
  const src = strip(read('src/components/connect/OutreachView.jsx'))
  assert.match(src, /const sendBlocked = .*!!attachmentClaimBlock/)
  assert.match(src, /data-testid="required-attachment-warning"/)
  assert.match(src, /data-testid="attachment-claim-warning"/)
})

test('the final review lists the server-resolved attachments', () => {
  const src = strip(read('src/components/connect/OutreachView.jsx'))
  assert.match(src, /data-testid="dm-confirm-attachments"/)
  assert.match(src, /Attachments \(\{dmPreview\.attachments\.length\}\)/)
})

test('gaps are shown before the unit-leader draft opens', () => {
  const src = strip(read('src/components/EmbedUnitCard.jsx'))
  assert.match(src, /data-testid="notify-missing-modal"/)
  assert.match(src, /data-testid="notify-open-anyway"/)
  // NEGATIVE CONTROL: the review must gate the open, not follow it.
  const i = src.indexOf('const reviewThenNotify')
  const block = src.slice(i, i + 900)
  assert.match(block, /if \(missing\.length === 0\) \{ openUnitLeaderNotice/)
  assert.match(block, /setNotifyPreview\(\{ studentRows, multi, missing \}\)/)
})

test('the board reads the coordinator rotation dates it needs', () => {
  const src = strip(read('src/components/MatchingTab.jsx'))
  assert.match(src, /from\('cohort_school_rotations'\)[\s\S]{0,300}rotation_start_date, rotation_end_date/)
  assert.match(src, /from\('preceptors'\)/)
  assert.match(src, /from\('unit_leaders'\)/)
})

test('the Action Center shortcut resolves the same canonical facts', () => {
  const src = strip(read('src/components/ActionCenter.jsx'))
  assert.match(src, /buildPlacementFacts\(\{ student:s, unit, match:m, rotationRows:schoolRotations, studentMatches:sMatches \}\)/)
  assert.match(src, /const sMatches = matches\.filter\(mm => mm\.student_id === s\.id\)/,
    'the shortcut must supply the same multi-placement evidence the board does')
  assert.match(src, /matches\.find\(mm => mm\.student_id === s\.id && mm\.unit_id === s\.matched_unit_id\)/,
    'and read the match for the unit the task is about')
  assert.ok(!/termDates:\s*s\.term_dates/.test(src), 'the retired column must not be read here either')
})

// ── 11. Opening a draft is not evidence that it was sent ────────────────────

test('the generic log-on-compose path no longer touches notified state', () => {
  const ac = strip(read('src/components/ActionCenter.jsx'))
  const generic = ac.slice(ac.indexOf("if (item.emailHref && item.markDoneType === 'log_communication')"),
    ac.indexOf('const handleConfirmNotified'))
  assert.ok(!generic.includes('onMatchUpdate'),
    'the shared compose path must not write a match row for any task')
  assert.ok(!/unit_notification/.test(generic),
    'the unit notification no longer rides the log-on-compose branch at all')
})

test('the confirmed send is what earns the communication entry', () => {
  const ac = strip(read('src/components/ActionCenter.jsx'))
  const fn = ac.slice(ac.indexOf('const handleConfirmNotified'), ac.indexOf('\n  // ── Mark Complete'))
  assert.match(fn, /await logComm\(\{\s*type: 'unit_notification'/,
    'the communication log follows the confirmation, not the compose click')
})

// ── 12b. The tracking promise is visible before sending ─────────────────────

test('the composer states whether a placement send will be recorded', () => {
  const src = strip(read('src/components/connect/OutreachView.jsx'))
  assert.match(src, /const placementTracking = placementSendRef/)
  assert.match(src, /data-testid="placement-tracking-on"/)
  assert.match(src, /data-testid="placement-tracking-warning"/)
  assert.match(src, /will NOT mark the preceptor as notified/,
    'the broken-link case is stated, never silent')
  // And the same line sits in the send confirmation, before the footer.
  const modal = src.slice(src.indexOf('data-testid="dm-confirm-placement-tracking"'))
  assert.ok(modal.length > 0, 'the confirmation modal carries the notice')
  const confirmIdx = src.indexOf('data-testid="dm-confirm-placement-tracking"')
  const footerIdx = src.indexOf('const sendBlocked =')
  assert.ok(confirmIdx > 0 && confirmIdx < footerIdx,
    'nobody can reach Send without passing the notice')
})

test('the notice derives from the SAME ref the payload sends', () => {
  const src = strip(read('src/components/connect/OutreachView.jsx'))
  const i = src.indexOf('const placementTracking = placementSendRef')
  const block = src.slice(i, i + 700)
  assert.match(block, /placementSendRef\s*\?/,
    'tracked-vs-not is judged by placementSendRef itself - the notice can never disagree with the payload')
})

// ── 13. The two envelope controls (PLACEMENT-NOTIFICATION-STATE-1) ───────────

test('the required-document list is a single source of truth', () => {
  assert.deepEqual(PRECEPTOR_ASSIGNMENT_DOCUMENTS.map(d => d.label),
    ['ASPIRE Brochure', 'Pre-Licensure Student General Guidelines'])
})

// ── 12. Preceptor sent tracking: identity and authorization ─────────────────
//
// The state is the EXISTING notification_log row, written by
// api/connect-send-direct-email only after Resend accepts the message AND only
// after api/lib/placementSendGuard proves the placement. These cover the
// reduction over those rows, and the guard that decides which rows exist at all.

const S = { A: 'stu-a', B: 'stu-b' }
const U = { ONE: 'unit-1', TWO: 'unit-2' }
const P = { DANA: 'prec-dana', SAM: 'prec-sam' }
const M = { A1: 'match-a1', A2: 'match-a2', REBUILT: 'match-a1-rebuilt' }

const sentRow = ({ match, student = S.A, unit = U.ONE, preceptor = P.DANA, at = '2026-08-18T10:00:00Z',
  status = 'sent', template = 'preceptor_assignment', type = 'direct_message_sent', cohort = 'coh-1' }) => ({
  notification_type: type,
  status,
  sent_at: at,
  metadata: {
    placement_template_key: template,
    placement_student_id: student,
    placement_unit_id: unit,
    placement_preceptor_id: preceptor,
    placement_cohort_id: cohort,
    placement_match_id: match,
  },
})

test('a confirmed send marks exactly that match and preceptor', () => {
  const index = preceptorSentIndex([sentRow({ match: M.A1 })])
  assert.equal(preceptorSentState(index, { matchId: M.A1, preceptorId: P.DANA }).sent, true)
  assert.equal(preceptorSentState(index, { matchId: M.A2, preceptorId: P.DANA }).sent, false)
  assert.equal(preceptorSentState(index, { matchId: M.A1, preceptorId: P.SAM }).sent, false)
})

test('NEGATIVE CONTROL: a DELETED AND RECREATED placement starts unsent', () => {
  // The same student, the same unit, the same preceptor - but the placement was
  // unmatched and rematched, so it is a NEW match row.
  const index = preceptorSentIndex([sentRow({ match: M.A1 })])
  assert.equal(preceptorSentState(index, { matchId: M.REBUILT, preceptorId: P.DANA }).sent, false,
    'a recreated placement must not inherit the deleted one’s Sent state')
  // And the pre-correction key would have inherited it: the student/unit/preceptor
  // triple is byte-identical across the two rows.
  const old = sentRow({ match: M.A1 }).metadata
  const rebuilt = sentRow({ match: M.REBUILT }).metadata
  assert.equal(old.placement_student_id, rebuilt.placement_student_id)
  assert.equal(old.placement_unit_id, rebuilt.placement_unit_id)
  assert.equal(old.placement_preceptor_id, rebuilt.placement_preceptor_id)
  assert.notEqual(old.placement_match_id, rebuilt.placement_match_id,
    'only the match id distinguishes them, which is why it is the identity')
})

test('a multi-unit student’s send never appears on the other placement', () => {
  const index = preceptorSentIndex([sentRow({ match: M.A1, unit: U.ONE, preceptor: P.DANA })])
  assert.equal(preceptorSentState(index, { matchId: M.A1, preceptorId: P.DANA }).sent, true)
  assert.equal(preceptorSentState(index, { matchId: M.A2, preceptorId: P.SAM }).sent, false)
  assert.notEqual(placementSentKey({ matchId: M.A1, preceptorId: P.DANA }),
    placementSentKey({ matchId: M.A2, preceptorId: P.DANA }))
})

test('a preceptor removed and reassigned does not inherit a superseded send', () => {
  const index = preceptorSentIndex([sentRow({ match: M.A1, preceptor: P.DANA })])
  // Same still-current placement, now assigned to Sam: unsent.
  assert.equal(preceptorSentState(index, { matchId: M.A1, preceptorId: P.SAM }).sent, false)
  // Dana re-assigned to the SAME still-current match keeps her own record, which
  // does belong to this placement.
  assert.equal(preceptorSentState(index, { matchId: M.A1, preceptorId: P.DANA }).sent, true)
  // But not on a different placement record.
  assert.equal(preceptorSentState(index, { matchId: M.REBUILT, preceptorId: P.DANA }).sent, false)
})

// ── THE REPORTED DEFECT (PLACEMENT-NOTIFICATION-STATE-1) ────────────────────
//
// A real assignment email was sent and no chip appeared. Root cause:
// api/webhooks/resend.js advances notification_log.status after acceptance
// (sent -> delivered -> opened -> clicked), and the first reducer accepted only
// the transient 'sent'. The moment delivery confirmed - seconds, in practice -
// the row stopped matching and the evidence vanished.

test('DEFECT REPRODUCED: the pre-fix filter lost a row once delivery confirmed', () => {
  // The exact production shape: the send was written 'sent', then the webhook
  // advanced it to 'delivered' before the Owner returned to the board.
  const rows = [sentRow({ match: M.A1, status: 'delivered' })]
  // The pre-fix predicate, verbatim: status must EQUAL 'sent'.
  const preFix = rows.filter(r => String(r.status || '') === 'sent')
  assert.equal(preFix.length, 0,
    'this is the defect: a delivered email produced zero matching rows, so no chip')
  // The shipped reducer now keeps it.
  const index = preceptorSentIndex(rows)
  assert.equal(preceptorSentState(index, { matchId: M.A1, preceptorId: P.DANA }).sent, true,
    'delivered is STRONGER evidence than sent, and now counts as such')
})

test('every lifecycle stage after acceptance still reads as sent', () => {
  for (const status of ['sent', 'delivered', 'opened', 'clicked', 'delayed']) {
    const index = preceptorSentIndex([sentRow({ match: M.A1, status })])
    assert.equal(preceptorSentState(index, { matchId: M.A1, preceptorId: P.DANA }).sent, true,
      `${status} must count - the webhook advances rows there routinely`)
  }
})

test('a bounce or complaint clears the way for a retry instead of claiming Sent', () => {
  for (const status of ['bounced', 'complained', 'failed', 'queued']) {
    const index = preceptorSentIndex([sentRow({ match: M.A1, status })])
    assert.equal(preceptorSentState(index, { matchId: M.A1, preceptorId: P.DANA }).sent, false,
      `${status} means the preceptor did NOT get the email - showing Sent would hide that`)
  }
})

test('a FAILED or unfinished send records nothing that reads as sent', () => {
  const index = preceptorSentIndex([
    sentRow({ match: M.A1, status: 'failed' }),
    sentRow({ match: M.A2, status: 'queued' }),
  ])
  assert.equal(index.size, 0)
})

test('only the direct-message send path and this template count', () => {
  const index = preceptorSentIndex([
    sentRow({ match: M.A1, template: 'coordinator_acceptance' }),
    sentRow({ match: M.A2, type: 'bulk_message_sent' }),
    { notification_type: 'direct_message_sent', status: 'sent', metadata: { recipient_type: 'contact' } },
    { notification_type: 'direct_message_sent', status: 'sent', metadata: null },
  ])
  assert.equal(index.size, 0, 'wrong template, wrong source, or no placement at all')
})

test('a row missing the match id is not usable evidence', () => {
  const orphan = sentRow({ match: M.A1 })
  delete orphan.metadata.placement_match_id
  assert.equal(preceptorSentIndex([orphan]).size, 0)
})

test('repeated sends re-confirm one fact rather than creating duplicate state', () => {
  const index = preceptorSentIndex([
    sentRow({ match: M.A1, at: '2026-08-18T10:00:00Z' }),
    sentRow({ match: M.A1, at: '2026-08-19T09:00:00Z' }),
    sentRow({ match: M.A1, at: '2026-08-17T09:00:00Z' }),
  ])
  assert.equal(index.size, 1, 'one placement, one state')
  const state = preceptorSentState(index, { matchId: M.A1, preceptorId: P.DANA })
  assert.equal(state.count, 3)
  assert.equal(state.sentAt, '2026-08-19T09:00:00Z', 'the newest send is what is shown')
  assert.match(preceptorSentTooltip(state, 'Dana Reyes'), /Sent 3 times\./)
})

test('an incomplete placement reference is NOT recorded at all', () => {
  const full = { studentId: S.A, unitId: U.ONE, preceptorId: P.DANA, cohortId: 'c', matchId: M.A1 }
  assert.ok(placementSendMetadata(full))
  for (const missing of ['studentId', 'unitId', 'preceptorId', 'cohortId', 'matchId']) {
    const partial = { ...full, [missing]: '' }
    assert.equal(placementSendMetadata(partial), null, `a missing ${missing} must not produce a record`)
  }
  assert.equal(placementSendMetadata(null), null)
})

test('the guard runs BEFORE the mail provider, and the log write after the send', () => {
  const api = strip(read('api/connect-send-direct-email.js'))
  const guardIdx = api.indexOf('await verifyPlacementSend({')
  const resendIdx = api.indexOf('const resend = new Resend(')
  const failIdx = api.indexOf('if (sendError) {')
  const logIdx = api.indexOf("from('notification_log')")
  assert.ok(guardIdx > 0 && resendIdx > guardIdx,
    'a rejected placement must fail before any provider client exists')
  assert.ok(failIdx > resendIdx && logIdx > failIdx,
    'and a failed send must return before the log write')
  assert.match(api, /\.\.\.\(placementMeta \|\| \{\}\),/, 'the metadata rides the success-only log row')
})

test('the endpoint never builds the metadata from the request body', () => {
  const api = strip(read('api/connect-send-direct-email.js'))
  assert.ok(!/placementSendMetadata\(/.test(api),
    'the endpoint must not stamp metadata itself - the guard returns it, built from verified rows')
  assert.match(api, /let placementMeta = null;/)
  assert.match(api, /placementMeta = verdict\.metadata;/,
    'the ONLY assignment comes from the guard’s verdict')
  // The reference reaches the guard untouched and is not used for routing.
  const parse = api.slice(api.indexOf('const placementRefRaw'), api.indexOf('let recipientType'))
  assert.ok(!/recipientEmail|recipientId =/.test(parse), 'the reference must not touch recipient resolution')
})

test('a rejected placement returns a reason and sends nothing', () => {
  const api = strip(read('api/connect-send-direct-email.js'))
  const gate = api.slice(api.indexOf('if (placementRefRaw) {'), api.indexOf('const resend = new Resend('))
  assert.match(gate, /if \(!verdict\.ok\) \{[\s\S]{0,300}?return res\.status\(verdict\.status\)/,
    'the rejection must return, not continue')
  assert.match(gate, /placement_error: verdict\.code/, 'and name what disagreed')
})

test('the composer attributes a send only while the draft is still that template', () => {
  const src = strip(read('src/components/connect/OutreachView.jsx'))
  assert.match(src, /const placementSendRef = \(placementLink && activeTemplateId === 'preceptor_assignment'/,
    'the attribution derives from the PERSISTED link - what survives navigation - and template selection still gates it')
  assert.match(src, /placementLink\.matchId && placementLink\.studentId/,
    'and an incomplete link - no match id - must attribute nothing at all')
  assert.match(src, /placementLink\.cohortId === cohortId/,
    'a link from another cohort attributes nothing')
  assert.match(src, /\.\.\.\(placementSendRef \? \{ placement_ref: placementSendRef \} : \{\}\)/)
  // Sent only on the real send - the preview body must not carry it.
  const preview = src.slice(src.indexOf('preview:           true'), src.indexOf('preview:           true') + 700)
  assert.ok(!preview.includes('placement_ref'), 'the preview must not claim a placement send')
  assert.match(src, /queryClient\.invalidateQueries\(\{ queryKey: \['placement_preceptor_sent'\] \}\)/,
    'a successful send refreshes the board immediately')
})

// ── 14. PRECEPTOR-DRAFT-CONTINUITY-1 ────────────────────────────────────────

test('the corrected subject is Title Case, and the old subject is gone', () => {
  const d = buildPreceptorAssignmentDraft({ firstName: 'Romelyn', attachmentsAttached: true })
  assert.equal(d.subject, 'ASPIRE: Student Assignment and Introduction Details')
  for (const f of ['src/lib/outreachTemplates.js', 'src/components/connect/OutreachView.jsx', 'src/components/EmbedUnitCard.jsx']) {
    assert.ok(!read(f).includes('Student preceptor assignment and introduction details'),
      `the old subject survives in ${f}`)
  }
})

test('the greeting is its own paragraph, in BOTH bodies', () => {
  const d = buildPreceptorAssignmentDraft({ firstName: 'Romelyn', attachmentsAttached: true })
  assert.match(d.body, /^Preceptor Assignment & Details\n\nDear Romelyn,\n\nThank you for agreeing to precept one of our senior nursing students through ASPIRE\. Your willingness to teach, mentor, and support our students makes a meaningful difference in their professional growth and transition into practice\.\n/,
    'plain text: heading, greeting, blank paragraph break, then the exact thanks paragraph')
  assert.ok(d.richBody.includes('<p>Dear Romelyn,</p><p>Thank you for agreeing to precept'),
    'rich body: the greeting stands alone as its own paragraph element')
  // NEGATIVE CONTROL: the old fused single-paragraph greeting is gone.
  assert.ok(!d.richBody.includes('Dear Romelyn, thank you'), 'the fused greeting paragraph is gone')
})

test('the Catalog identities are matched by their CANONICAL titles, wording aside', () => {
  const options = [
    { slug: 'aspire-brochure', title: 'ASPIRE Brochure', type_label: 'PDF' },
    { slug: 'prelicensure-guidelines', title: 'General Guidelines for Pre-Licensure Students', type_label: 'PDF' },
  ]
  const r = resolveRequiredAttachments(options)
  assert.equal(r.ok, true, 'the bullet’s own wording is an accepted alias, not a new identity')
})

test('the placement connection is DRAFT DATA: persisted, restored, cohort-checked', () => {
  const src = strip(read('src/components/connect/OutreachView.jsx'))
  assert.match(src, /if \(l\.placementLink\) payload\.placement = l\.placementLink/,
    'the link is saved with the draft')
  assert.match(src, /if \(Array\.isArray\(l\.ccList\) && l\.ccList\.length\) payload\.cc = l\.ccList/,
    'and so is the CC list')
  assert.match(src, /link\.cohortId === cohortId && link\.templateKey === 'preceptor_assignment'/,
    'restore validates the cohort and template before reviving the connection')
  assert.match(src, /setPlacementLink\(link\)\s*\n\s*setActiveTemplateId\('preceptor_assignment'\)/,
    'a restored link restores its template selection - the link IS that statement')
})

test('the recipient survives Connect navigation and refresh', () => {
  const src = strip(read('src/components/connect/OutreachView.jsx'))
  assert.match(src, /const \[stickyRecipient, setStickyRecipient\] = useState\(null\)/,
    'the last explicit recipient is kept for the life of the mount')
  assert.match(src, /const \[adoptedRecipient, setAdoptedRecipient\] = useState\(null\)/,
    'and after refresh the most recent draft pointer is adopted')
  assert.match(src, /readDraftPointer\(userKey, cohortId\)/,
    'adoption reads the same pointer the Resume link used')
  assert.match(src, /const blockingLaunch = launchCtx && launchCtx\.kind !== LAUNCH_KINDS\.PRECEPTOR_ASSIGNMENT/,
    'bulk launches block adoption; the preceptor handoff allows it, because a refresh strips its router-state recipient')
  assert.match(src, /if \(adoptedRecipient \|\| stickyRecipient \|\| blockingLaunch\) return/)
})

test('detachment is deliberate and names its cause', () => {
  const src = strip(read('src/components/connect/OutreachView.jsx'))
  assert.match(src, /const detachPlacement = useCallback\(\(cause\)/,
    'one severing path, which requires a cause')
  assert.match(src, /detachPlacement\(`you switched to \$\{t\.label\}`\)/,
    'switching composer mode names itself')
  assert.match(src, /detachPlacement\(`you switched to the \$\{t\.label\} template`\)/,
    'switching template names itself')
  assert.match(src, /Placement tracking was disconnected because \$\{placementDetachInfo\.cause\}/,
    'and the banner repeats the cause verbatim - never a silent detach')
})

// ── 15. Manual confirmation evidence ────────────────────────────────────────

const manualRow = ({ match = M.A1, preceptor = P.DANA, at = '2026-08-19T10:00:00Z', status = 'confirmed' }) => ({
  notification_type: 'placement_manual_confirmation',
  status,
  sent_at: at,
  metadata: {
    placement_template_key: 'preceptor_assignment',
    placement_student_id: S.A, placement_unit_id: U.ONE,
    placement_preceptor_id: preceptor, placement_cohort_id: 'coh-1',
    placement_match_id: match,
    source: 'manual_confirmation', confirmed_by_name: 'QC Owner',
  },
})

test('a guarded manual confirmation reads as sent, labelled as manual', () => {
  const index = preceptorSentIndex([manualRow({})])
  const state = preceptorSentState(index, { matchId: M.A1, preceptorId: P.DANA })
  assert.equal(state.sent, true)
  assert.equal(state.manualOnly, true)
  assert.match(preceptorSentTooltip(state, 'Romelyn Martha Sanchez'), /Confirmed manually\./,
    'a manual answer never masquerades as a provider receipt')
})

test('provider evidence outranks the manual label, and neither double-counts', () => {
  const index = preceptorSentIndex([manualRow({}), sentRow({ match: M.A1, status: 'delivered' })])
  assert.equal(index.size, 1, 'one placement, ONE state - two evidence kinds cannot double-count')
  const state = preceptorSentState(index, { matchId: M.A1, preceptorId: P.DANA })
  assert.equal(state.manualOnly, false)
  assert.ok(!/Confirmed manually/.test(preceptorSentTooltip(state, 'X')))
})

test('a manual row with the wrong status or a foreign type is not evidence', () => {
  assert.equal(preceptorSentIndex([manualRow({ status: 'queued' })]).size, 0)
  const foreign = manualRow({})
  foreign.notification_type = 'someone_elses_type'
  assert.equal(preceptorSentIndex([foreign]).size, 0)
})

test('manual evidence is placement-specific: replaced preceptor and recreated match stay clean', () => {
  const index = preceptorSentIndex([manualRow({})])
  assert.equal(preceptorSentState(index, { matchId: M.A1, preceptorId: P.SAM }).sent, false)
  assert.equal(preceptorSentState(index, { matchId: M.REBUILT, preceptorId: P.DANA }).sent, false)
})

// PLACEMENT-NOTIFICATION-CONTROL-1 retired api/placement-preceptor-confirm.js.
// Its successor, api/placement-notification-confirm.js, is EXECUTED against a
// fake database in test/outreachAttachmentEndpoints.test.mjs (the CONFIRM and
// CORRECT tests), which proves the same guarantees for both targets and both
// directions rather than reading them off the source.


test('the canonical tooltip is portaled, so transformed cards cannot clip it', () => {
  const src = strip(read('src/components/ui/Tooltip.jsx'))
  assert.match(src, /import \{ createPortal \} from 'react-dom'/)
  assert.match(src, /createPortal\(tooltipEl, document\.body\)/,
    'the tooltip renders at the body, outside any transform containing block')
  // NEGATIVE CONTROL: the un-portaled inline rendering is gone from both branches.
  assert.ok(!/\{cloneElement\(child, extraProps\)\}\s*\{tooltipEl\}/.test(src))
  assert.ok(!/\{child\}\s*\{tooltipEl\}\s*<\/span>/.test(src))
})
