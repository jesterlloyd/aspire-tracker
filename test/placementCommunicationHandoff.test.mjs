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

test('the body ends at "Kind regards," with no signature block', () => {
  const m = messageFor(buildFor(FULL_STUDENT))
  assert.ok(m.body.trimEnd().endsWith('Kind regards,'),
    `body must end at the closing, ended with: ${JSON.stringify(m.body.slice(-60))}`)
  // NEGATIVE CONTROL: the exact signature the previous builder appended.
  for (const fragment of ['Jester Lloyd Bautista', 'Brawerman', 'cshs.org | 310', 'Warm regards']) {
    assert.ok(!m.body.includes(fragment), `signature fragment leaked: ${fragment}`)
  }
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
    body: 'Scope of practice: Please see the attached ASPIRE brochure and Pre-Licensure Student General Guidelines for your reference.',
    selected: asItems(RESOLVED_SLUGS),
    serverResolved: asItems(RESOLVED_SLUGS),
    requiredSlugs: RESOLVED_SLUGS,
  })
  assert.equal(reason, null)
})

test('removing an attachment while the claim remains blocks the send', () => {
  const reason = attachmentClaimBlockReason({
    body: 'Please see the attached ASPIRE brochure and Pre-Licensure Student General Guidelines.',
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
    body: 'Please see the attached ASPIRE brochure.',
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
  assert.equal(d.subject, 'ASPIRE: Student preceptor assignment and introduction details')
  assert.match(d.body, /^Dear Dana,/)
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

test('the draft claims an attachment ONLY when both documents resolved', () => {
  const attached = buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: true })
  assert.match(attached.body, /Please see the attached ASPIRE brochure and Pre-Licensure Student General Guidelines/)

  const notAttached = buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: false })
  assert.ok(!/see the attached/i.test(notAttached.body), 'an unattached draft must not claim attachments')
  assert.ok(!/see the attached/i.test(notAttached.richBody))
  assert.match(notAttached.body, /can be added before sending or shared separately/)
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

test('the envelope is disabled, with a reason, when there is no address', () => {
  const src = strip(read('src/components/EmbedUnitCard.jsx'))
  assert.match(src, /data-testid="placement-preceptor-email"/)
  assert.match(src, /disabled=\{!preceptorEmail\}/)
  assert.match(src, /No email address on file for/)
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
  const i = src.indexOf('if (handoffSeed && DRAFT_KEY')
  assert.ok(i > 0, 'handoff application not found in the restore effect')
  const block = src.slice(i, i + 1400)
  assert.match(block, /if \(d && !directDraftIsEmpty\(d\)\) \{\s*setReplaceTemplateKey\('preceptor_assignment'\)/)
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

test('opening the unit-leader draft performs NO database write', () => {
  const src = strip(read('src/components/EmbedUnitCard.jsx'))
  const start = src.indexOf('const openUnitLeaderNotice')
  assert.ok(start > 0, 'opener not found')
  // Bounded at the NEXT declaration, so the confirmation machinery below is not
  // mistaken for part of the opener.
  const opener = src.slice(start, src.indexOf('const pendingConfirmRows', start))
  assert.ok(!opener.includes('onUpdateMatch'),
    'opening a compose window must not write notified state')
  assert.ok(!opener.includes('notification_sent'))
  assert.ok(!opener.includes('notified_at'))
  assert.match(opener, /openMailtoLink\(message\.url\)/, 'it still opens the draft')
  assert.match(opener, /setNotifyConfirm\(\{ studentIds: studentRows\.map\(r => r\.student\.id\), multi \}\)/,
    'it offers the confirmation instead of assuming the outcome')
  // NEGATIVE CONTROL: the exact pre-correction line must be gone from the file.
  assert.ok(!/openMailtoLink\(message\.url\)[\s\S]{0,400}?notification_sent: true/.test(src),
    'no notified write may follow the compose call')
})

test('the notified patch is written from ONE shared definition', () => {
  assert.deepEqual(Object.keys(notifiedPatch('2026-08-18T00:00:00.000Z')).sort(),
    ['notification_sent', 'notified_at'])
  assert.equal(notifiedPatch('2026-08-18T00:00:00.000Z').notification_sent, true)
  // Neither surface may hand-roll the patch.
  for (const f of ['src/components/EmbedUnitCard.jsx', 'src/components/ActionCenter.jsx']) {
    const src = strip(read(f))
    assert.ok(!/notification_sent:\s*true/.test(src),
      `${f} must write the shared notifiedPatch(), not its own literal`)
    assert.match(src, /notifiedPatch\(\)/, `${f} must use the shared patch`)
  }
})

test('BOTH surfaces write notified state only from their confirmation handler', () => {
  const board = strip(read('src/components/EmbedUnitCard.jsx'))
  const boardOpener = board.slice(board.indexOf('const openUnitLeaderNotice'),
    board.indexOf('const pendingConfirmRows'))
  assert.ok(!boardOpener.includes('onUpdateMatch'), 'the board opener must not write')
  assert.match(board.slice(board.indexOf('const confirmNotified')), /onUpdateMatch\(/,
    'the board writes from confirmNotified')

  const ac = strip(read('src/components/ActionCenter.jsx'))
  // The unit-notification branch of handleAction opens and returns - nothing else.
  const branch = ac.slice(ac.indexOf("if (item.actionType === 'unit_notification_needed'"),
    ac.indexOf("if (item.emailHref && item.markDoneType === 'log_communication')"))
  assert.match(branch, /openHref\(item\.emailHref\)/)
  assert.match(branch, /setNotifyConfirmId\(item\.id\)/)
  assert.ok(!branch.includes('onMatchUpdate'), 'opening must not write the match row')
  assert.ok(!branch.includes('logComm'), 'opening must not write a communication either')
  assert.ok(!branch.includes('logCompleted'), 'opening must not clear the task')

  const confirm = ac.slice(ac.indexOf('const handleConfirmNotified'), ac.indexOf('\n  // ── Mark Complete'))
  assert.match(confirm, /onMatchUpdate\?\.\(pending\[0\]\.match\.id/,
    'the Action Center writes only from its confirmation handler')
})

test('the generic log-on-compose path no longer touches notified state', () => {
  const ac = strip(read('src/components/ActionCenter.jsx'))
  const generic = ac.slice(ac.indexOf("if (item.emailHref && item.markDoneType === 'log_communication')"),
    ac.indexOf('const handleConfirmNotified'))
  assert.ok(!generic.includes('onMatchUpdate'),
    'the shared compose path must not write a match row for any task')
  assert.ok(!/unit_notification/.test(generic),
    'the unit notification no longer rides the log-on-compose branch at all')
})

test('BOTH confirmations are idempotent through the SAME shared derivation', () => {
  for (const f of ['src/components/EmbedUnitCard.jsx', 'src/components/ActionCenter.jsx']) {
    assert.match(strip(read(f)), /pendingNotifyTargets\(/,
      `${f} must derive its pending work from the shared rule`)
  }
  // And the rule itself: an already-notified row is never pending.
  const matches = [
    { id: 'm1', student_id: 's1', unit_id: 'u1', notification_sent: false },
    { id: 'm2', student_id: 's2', unit_id: 'u1', notification_sent: true },
  ]
  const targets = [
    { studentId: 's1', unitId: 'u1', label: 'One' },
    { studentId: 's2', unitId: 'u1', label: 'Two' },
    { studentId: 's3', unitId: 'u1', label: 'Missing' },
  ]
  const pending = pendingNotifyTargets(targets, matches)
  assert.deepEqual(pending.map(p => p.studentId), ['s1'],
    'only the un-notified, existing row is pending')

  // The second confirmation: the same call against the post-write rows.
  const after = matches.map(m => (m.id === 'm1' ? { ...m, notification_sent: true } : m))
  assert.deepEqual(pendingNotifyTargets(targets, after), [],
    'a repeated confirmation has nothing to write')
  // A row notified by the OTHER surface is skipped for free.
  assert.deepEqual(pendingNotifyTargets([targets[1]], matches), [])
})

test('both confirmations short-circuit before writing when nothing is pending', () => {
  const board = strip(read('src/components/EmbedUnitCard.jsx'))
  const bFn = board.slice(board.indexOf('const confirmNotified'), board.indexOf('\n  const ', board.indexOf('const confirmNotified') + 10))
  assert.match(bFn, /if \(pendingConfirmRows\.length === 0\) \{ setNotifyConfirm\(null\); return \}/)
  const ac = strip(read('src/components/ActionCenter.jsx'))
  const aFn = ac.slice(ac.indexOf('const handleConfirmNotified'), ac.indexOf('\n  // ── Mark Complete'))
  assert.match(aFn, /if \(pending\.length === 0\) \{[\s\S]{0,200}?setNotifyConfirmId\(null\)[\s\S]{0,60}?return/)
})

test('BOTH surfaces show the SAME words, from one source', () => {
  assert.equal(NOTIFY_CONFIRM.confirmLabel, 'Mark unit as notified')
  assert.equal(NOTIFY_CONFIRM.dismissLabel, 'Not sent yet')
  assert.match(NOTIFY_CONFIRM.shortHeadline,
    /Nothing is recorded yet\. Confirm only after you have actually sent the email\./)
  assert.match(NOTIFY_CONFIRM.headline('Cruz, Ana'),
    /^Draft opened for Cruz, Ana\. Nothing is recorded yet\. Confirm only after you have actually sent the email\.$/)
  // Neither surface may hard-code its own wording.
  for (const f of ['src/components/EmbedUnitCard.jsx', 'src/components/ActionCenter.jsx']) {
    const src = read(f)
    assert.match(src, /NOTIFY_CONFIRM\.confirmLabel/, `${f} must use the shared confirm label`)
    assert.match(src, /NOTIFY_CONFIRM\.dismissLabel/, `${f} must use the shared dismiss label`)
    assert.ok(!/Mark unit as notified'/.test(strip(src).replace(/NOTIFY_CONFIRM[^\n]*/g, '')),
      `${f} must not restate the label`)
  }
  assert.match(read('src/components/EmbedUnitCard.jsx'), /notifyConfirmHeadline\(pendingConfirmRows\)/)
  assert.match(read('src/components/ActionCenter.jsx'), /NOTIFY_CONFIRM\.shortHeadline/)
})

test('a failed confirmation is reported and leaves the work to do', () => {
  // App now returns the write error, which is what makes an honest report possible.
  // Read raw: App.jsx contains regex/string literals that a naive comment
  // stripper mangles, and this assertion only needs the function body.
  const app = read('src/App.jsx')
  const upd = app.slice(app.indexOf('const updateMatch = async'))
  assert.match(upd.slice(0, upd.indexOf('\n  }\n') + 5), /return error \|\| null/,
    'updateMatch must report whether the write landed')
  const board = strip(read('src/components/EmbedUnitCard.jsx'))
  assert.match(board, /const err = await onUpdateMatch\(r\.match\.id, r\.studentId, patch\)/)
  assert.match(board, /if \(err\) failed \+= 1/)
  assert.match(board, /failed > 0 \? notifyFailedMessage\(failed\)/)
  const ac = strip(read('src/components/ActionCenter.jsx'))
  const fn = ac.slice(ac.indexOf('const handleConfirmNotified'), ac.indexOf('\n  // ── Mark Complete'))
  assert.match(fn, /if \(err\) \{[\s\S]{0,320}?notifyFailedMessage\(1\)[\s\S]{0,60}?return/)
  assert.ok(fn.indexOf('logCompleted') > fn.indexOf('if (err)'),
    'a failed write must not be logged as completed')
})

test('the confirmed send is what earns the communication entry', () => {
  const ac = strip(read('src/components/ActionCenter.jsx'))
  const fn = ac.slice(ac.indexOf('const handleConfirmNotified'), ac.indexOf('\n  // ── Mark Complete'))
  assert.match(fn, /await logComm\(\{\s*type: 'unit_notification'/,
    'the communication log follows the confirmation, not the compose click')
})

test('a dismissed confirmation writes nothing', () => {
  const src = read('src/components/EmbedUnitCard.jsx')
  assert.match(src, /data-testid="notify-confirm-no"[\s\S]{0,300}?onClick=\{e => \{ e\.stopPropagation\(\); setNotifyConfirm\(null\) \}\}/,
    'Not sent yet must only close the strip')
})

test('the notified COUNT still reads from the stored match rows', () => {
  const src = strip(read('src/components/EmbedUnitCard.jsx'))
  assert.match(src, /const notifiedCount = matchedStudents\.filter\(s => \{[\s\S]{0,200}?notification_sent/,
    'counts must come from data, never from a local "we opened it" flag')
  assert.match(src, /const isNotified = !!match\?\.notification_sent/)
})

test('the required-document list is a single source of truth', () => {
  assert.deepEqual(PRECEPTOR_ASSIGNMENT_DOCUMENTS.map(d => d.label),
    ['ASPIRE Brochure', 'Pre-Licensure Student General Guidelines'])
})
