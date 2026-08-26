// test/s03FileRefReadGuard.test.mjs
//
// S-03 (read side): defense in depth for values persisted BEFORE the write-side binding existed.
// parseStoredFileRef validates only the SHAPE of a stored path, never that it belongs to the
// student row it sits on, and the same resolver serves staff, the Student Portal, Unit Leaders,
// Academic Partners, and Keith. A stored value naming another student would be resolved and signed
// by all of them.
//
// refBelongsToStudent now gates every path that mints a signed URL or reads bytes. A mismatch fails
// closed, returning a null signed URL rather than an error that would reveal structure, which is
// the denial idiom these endpoints already use.
//
// Behavioral tests against the pure predicate, plus wiring checks on the five endpoints. Nothing
// here performs network I/O and no email is sent.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { refBelongsToStudent, parseStoredFileRef, canonicalPath } from '../lib/server/studentFiles.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')

// Fictional ids.
const COHORT = '11111111-1111-4111-8111-111111111111'
const STUDENT = '22222222-2222-4222-8222-222222222222'
const OTHER_STUDENT = '33333333-3333-4333-8333-333333333333'
const OTHER_COHORT = '44444444-4444-4444-8444-444444444444'

// The five paths that resolve a stored reference into a signed URL or raw bytes. The four list
// endpoints that call parseStoredFileRef only as a has-photo boolean are deliberately not here:
// they expose no path and mint no URL.
const SIGNING_PATHS = [
  ['api/student-file-access.js',                    'row.id',      'staff batch access'],
  ['api/portal/student-file-access.js',             'student.id',  'Student Portal own photo'],
  ['api/portal/unit-student-file-access.js',        'studentId',   'Unit Leader'],
  ['api/portal/school-student-file-access.js',      'studentId',   'Academic Partner'],
  ['lib/server/keith/resumeInterviewQuestions.js',  'student?.id', 'Keith resume read'],
]

// ── The predicate ────────────────────────────────────────────────────────────────────────────────

test('S-03 read: a path owned by the student passes', () => {
  assert.equal(refBelongsToStudent(`${COHORT}/${STUDENT}/resume.pdf`, STUDENT), true)
  assert.equal(refBelongsToStudent(`${COHORT}/${STUDENT}/headshot.jpg`, STUDENT), true)
})

test('S-03 read: a path naming another student is refused', () => {
  assert.equal(refBelongsToStudent(`${COHORT}/${OTHER_STUDENT}/resume.pdf`, STUDENT), false)
  assert.equal(refBelongsToStudent(`${OTHER_COHORT}/${OTHER_STUDENT}/headshot.jpg`, STUDENT), false)
})

test('S-03 read: the cohort segment is deliberately NOT compared', () => {
  // A student's own object stays readable if their row is ever moved between cohorts. Only flows
  // carrying this student's id ever wrote under this student's segment, so the student segment is
  // the ownership boundary and the cohort segment adds nothing.
  assert.equal(refBelongsToStudent(`${OTHER_COHORT}/${STUDENT}/resume.pdf`, STUDENT), true)
})

test('S-03 read: id comparison is case-insensitive, as uuids may be stored either way', () => {
  assert.equal(refBelongsToStudent(`${COHORT}/${STUDENT.toUpperCase()}/resume.pdf`, STUDENT), true)
  assert.equal(refBelongsToStudent(`${COHORT}/${STUDENT}/resume.pdf`, STUDENT.toUpperCase()), true)
})

test('S-03 read: malformed input fails closed', () => {
  for (const [path, id] of [
    ['', STUDENT], [null, STUDENT], [undefined, STUDENT], [42, STUDENT],
    [`${COHORT}/${STUDENT}`, STUDENT],                    // too few segments
    [`${COHORT}/${STUDENT}/sub/resume.pdf`, STUDENT],     // too many
    [`${COHORT}/${STUDENT}/resume.pdf`, ''],              // no id to compare
    [`${COHORT}/${STUDENT}/resume.pdf`, null],
    [`${COHORT}/${STUDENT}/resume.pdf`, 'a-different-id'],   // simple mismatch, any id format
  ]) {
    assert.equal(refBelongsToStudent(path, id), false, `${path} / ${id} must fail closed`)
  }
})

test('S-03 read: a legacy public URL still resolves, and is then owner-checked', () => {
  // The resolver keeps accepting legacy stored URLs; the guard applies to the path it yields.
  const legacy = `https://example.supabase.co/storage/v1/object/public/student-files/${COHORT}/${STUDENT}/resume.pdf`
  const ref = parseStoredFileRef(legacy)
  assert.equal(ref.kind, 'legacyPublicUrl')
  assert.equal(refBelongsToStudent(ref.path, STUDENT), true)

  const foreign = `https://example.supabase.co/storage/v1/object/public/student-files/${COHORT}/${OTHER_STUDENT}/resume.pdf`
  assert.equal(refBelongsToStudent(parseStoredFileRef(foreign).path, STUDENT), false)
})

test('S-03 read: whatever canonicalPath produces, the guard accepts for that student', () => {
  for (const [kind, ext] of [['resume', 'pdf'], ['resume', 'docx'], ['headshot', 'png'], ['headshot', 'jpeg']]) {
    const cp = canonicalPath(COHORT, STUDENT, kind, ext)
    assert.equal(cp.ok, true)
    assert.equal(refBelongsToStudent(cp.path, STUDENT), true, `${kind}.${ext} must resolve for its owner`)
  }
})

// ── Wiring on all five signing paths ─────────────────────────────────────────────────────────────

test('S-03 read: every signing path applies the guard', () => {
  for (const [file, idExpr, label] of SIGNING_PATHS) {
    const src = read(file)
    assert.match(src, /refBelongsToStudent/, `${label} (${file}) must import and use the guard`)
    assert.ok(src.includes(`refBelongsToStudent(ref.path, ${idExpr})`),
      `${label} must bind to ${idExpr}`)
  }
})

test('S-03 read: the guard runs BEFORE the URL is minted or bytes are read', () => {
  for (const [file, , label] of SIGNING_PATHS) {
    const src = read(file)
    const guardIdx = src.indexOf('refBelongsToStudent(ref.path')
    const useIdx = Math.min(
      ...[src.indexOf('createSignedUrl'), src.indexOf('createSignedUrls'), src.indexOf('.download(')]
        .filter(i => i > -1),
    )
    assert.ok(guardIdx > -1 && useIdx > -1, `${label}: both landmarks must exist`)
    assert.ok(guardIdx < useIdx, `${label}: the guard must precede signing or download`)
  }
})

test('S-03 read: a refusal returns a null signed URL, never an error revealing structure', () => {
  // Each endpoint reuses its existing denial idiom, so a blocked reference is indistinguishable
  // from "no file on record".
  const staff = read('api/student-file-access.js')
  assert.match(staff, /if \(!refBelongsToStudent\(ref\.path, row\.id\)\) return nullResult/)

  const portal = read('api/portal/student-file-access.js')
  assert.match(portal, /if \(!refBelongsToStudent\(ref\.path, student\.id\)\) \{\s*\n\s*return res\.status\(200\)\.json\(\{ signed_url: null \}\)/)

  for (const f of ['api/portal/unit-student-file-access.js', 'api/portal/school-student-file-access.js']) {
    const src = read(f)
    assert.match(src, /if \(!refBelongsToStudent\(ref\.path, studentId\)\) \{\s*\n\s*results\.push\(nullResult\(studentId, kind\)\)/, f)
  }

  // Keith returns the same neutral reason it already uses for an unusable reference.
  assert.match(read('lib/server/keith/resumeInterviewQuestions.js'),
    /if \(!refBelongsToStudent\(ref\.path, student\?\.id\)\) return \{ ok: false, reason: 'unreadable_reference' \}/)
})

test('S-03 read: no signing path returns an error status on an ownership mismatch', () => {
  for (const [file, , label] of SIGNING_PATHS) {
    const src = read(file)
    const line = src.split('\n').find(l => l.includes('refBelongsToStudent(ref.path'))
    assert.ok(line, `${label}: guard line must exist`)
    assert.doesNotMatch(line, /status\((4|5)\d\d\)/, `${label}: a mismatch must not raise an error status`)
  }
})

// ── The has-photo consumers are correctly untouched ──────────────────────────────────────────────

test('S-03 read: list endpoints that only compute a has-photo flag are not in scope', () => {
  // These call parseStoredFileRef as a boolean predicate. They expose no path and mint no URL, so
  // a mismatched value there is cosmetic, not a disclosure, and guarding them would add nothing.
  for (const f of ['api/portal/unit-roster.js', 'api/portal/school-students.js',
                   'api/portal/unit-shift-activity.js', 'api/portal/unit-student-detail.js']) {
    const src = read(f)
    assert.match(src, /return ref\.kind !== 'empty' && ref\.kind !== 'unknown'/, `${f} is a boolean predicate`)
    assert.doesNotMatch(src, /createSignedUrl/, `${f} must not mint a URL`)
  }
})

// ── Legitimate behavior preserved ────────────────────────────────────────────────────────────────

test('S-03 read: the resolver, TTL, and role matrix are unchanged', () => {
  const files = read('lib/server/studentFiles.js')
  // The compatibility resolver still accepts both stored forms.
  assert.match(files, /kind: 'legacyPublicUrl'/)
  assert.match(files, /kind: 'path'/)
  // Every endpoint still signs with a bounded lifetime (STUDENT-PHOTO-PERF-1:
  // the value now comes from the shared per-kind table in studentFiles.js).
  for (const f of ['api/student-file-access.js', 'api/portal/student-file-access.js',
                   'api/portal/unit-student-file-access.js', 'api/portal/school-student-file-access.js']) {
    assert.match(read(f), /signedUrlTtlSeconds/, `${f} signs with the shared per-kind lifetime`)
  }
  // The staff role matrix still decides which kinds a role may request, before the new guard.
  const staff = read('api/student-file-access.js')
  // Compare against the GUARD CALL, not the import line, which naturally sits above everything.
  assert.ok(staff.indexOf('roleKinds.has(n.kind)') < staff.indexOf('refBelongsToStudent(ref.path'),
    'the role check still runs first and is unchanged')
  assert.match(staff, /entitledCohorts\.has\(row\.cohort_id\)/, 'interviewer entitlement scoping is untouched')
})

test('S-03 read: no live student data appears in this fixture', () => {
  const self = read('test/s03FileRefReadGuard.test.mjs')
  assert.doesNotMatch(self, /@cshs\.org/)
  for (const id of self.match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi) || []) {
    assert.match(id, /^(1{8}|2{8}|3{8}|4{8})-/, `${id} must be a fictional id`)
  }
})
