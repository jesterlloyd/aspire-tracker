// test/s03FileRefWriteBinding.test.mjs
//
// S-03 (write side): resume_url and headshot_url were persisted from browser-supplied strings with
// only a trim applied. Nothing checked that the value described the student it was being stored
// on, so a caller could point their own record at another student's object and every read path
// would then resolve and sign it.
//
// A stored reference must now equal the canonical path this server derives from THAT student's own
// cohort id and student id, for that kind, with an allow-listed extension.
//
// The validator is a pure function, so these are real behavioral tests, not source-shape ones.
// Nothing here performs network I/O and no email is sent.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  validateStoredFileRefForStudent, canonicalPath, FILE_REF_COLUMNS, FILE_KIND_RULES,
} from '../lib/server/studentFiles.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')

// Fictional ids. No production identifier appears in this file.
const COHORT = '11111111-1111-4111-8111-111111111111'
const STUDENT = '22222222-2222-4222-8222-222222222222'
const OTHER_STUDENT = '33333333-3333-4333-8333-333333333333'
const OTHER_COHORT = '44444444-4444-4444-8444-444444444444'

const ownPath = (kind, ext) => `${COHORT}/${STUDENT}/${kind}.${ext}`
const validate = (value, column, cohortId = COHORT, studentId = STUDENT) =>
  validateStoredFileRefForStudent({ value, column, cohortId, studentId })

// ── The canonical value is accepted ──────────────────────────────────────────────────────────────

test('S-03 write: the canonical path for this student is accepted for every allowed extension', () => {
  for (const [column, kind] of Object.entries(FILE_REF_COLUMNS)) {
    for (const ext of FILE_KIND_RULES[kind].exts) {
      const path = ownPath(kind, ext)
      const out = validate(path, column)
      assert.equal(out.ok, true, `${column} must accept ${ext}`)
      assert.equal(out.path, path)
    }
  }
})

test('S-03 write: the accepted value is byte-identical to canonicalPath', () => {
  const cp = canonicalPath(COHORT, STUDENT, 'resume', 'pdf')
  const out = validate(cp.path, 'resume_url')
  assert.equal(out.ok, true)
  assert.equal(out.path, cp.path, 'the validator must not reshape an already-canonical value')
})

test('S-03 write: surrounding whitespace is tolerated, since the old code trimmed too', () => {
  const out = validate(`  ${ownPath('headshot', 'png')}  `, 'headshot_url')
  assert.equal(out.ok, true)
  assert.equal(out.path, ownPath('headshot', 'png'))
})

// ── Another student, another cohort ──────────────────────────────────────────────────────────────

test('S-03 write: a path naming ANOTHER student is rejected', () => {
  const out = validate(`${COHORT}/${OTHER_STUDENT}/resume.pdf`, 'resume_url')
  assert.equal(out.ok, false)
  assert.equal(out.error, 'not_owned')
})

test('S-03 write: a path naming another cohort is rejected', () => {
  const out = validate(`${OTHER_COHORT}/${STUDENT}/resume.pdf`, 'resume_url')
  assert.equal(out.ok, false)
  assert.equal(out.error, 'not_owned')
})

test('S-03 write: a path naming another student AND cohort is rejected', () => {
  const out = validate(`${OTHER_COHORT}/${OTHER_STUDENT}/headshot.jpg`, 'headshot_url')
  assert.equal(out.ok, false)
  assert.equal(out.error, 'not_owned')
})

test('S-03 write: the wrong kind for the column is rejected', () => {
  // A resume path stored in headshot_url would break the Viewer photo-only boundary.
  assert.equal(validate(ownPath('resume', 'pdf'), 'headshot_url').ok, false)
  assert.equal(validate(ownPath('headshot', 'jpg'), 'resume_url').ok, false)
})

// ── Extensions ───────────────────────────────────────────────────────────────────────────────────

test('S-03 write: a non-allow-listed extension is rejected', () => {
  for (const ext of ['exe', 'svg', 'html', 'js', 'sh', 'php']) {
    const out = validate(`${COHORT}/${STUDENT}/resume.${ext}`, 'resume_url')
    assert.equal(out.ok, false, `.${ext} must be rejected`)
    assert.equal(out.error, 'invalid_extension')
  }
})

test('S-03 write: an extension valid for the OTHER kind is rejected', () => {
  // png is fine for a headshot, never for a resume, and vice versa.
  assert.equal(validate(`${COHORT}/${STUDENT}/resume.png`, 'resume_url').error, 'invalid_extension')
  assert.equal(validate(`${COHORT}/${STUDENT}/headshot.pdf`, 'headshot_url').error, 'invalid_extension')
})

// ── Shapes that must never be accepted ───────────────────────────────────────────────────────────

test('S-03 write: traversal, absolute paths, and extra segments are rejected', () => {
  for (const bad of [
    `${COHORT}/../${OTHER_STUDENT}/resume.pdf`,
    `/${COHORT}/${STUDENT}/resume.pdf`,
    `${COHORT}//${STUDENT}/resume.pdf`,
    `${COHORT}/${STUDENT}/sub/resume.pdf`,
    `${COHORT}/${STUDENT}`,
    `${COHORT}\\${STUDENT}\\resume.pdf`,
    'resume.pdf',
    '../../etc/passwd',
  ]) {
    assert.equal(validate(bad, 'resume_url').ok, false, `${bad} must be rejected`)
  }
})

test('S-03 write: a full URL is never an acceptable NEW value', () => {
  const out = validate(
    `https://example.supabase.co/storage/v1/object/public/student-files/${COHORT}/${STUDENT}/resume.pdf`,
    'resume_url',
  )
  assert.equal(out.ok, false)
  assert.equal(out.error, 'url_not_accepted')
})

test('S-03 write: empty, blank, and non-string values are rejected', () => {
  for (const v of ['', '   ', null, undefined, 42, {}, []]) {
    assert.equal(validate(v, 'resume_url').ok, false)
  }
})

test('S-03 write: an unknown column and non-uuid ids are rejected', () => {
  assert.equal(validate(ownPath('resume', 'pdf'), 'notes').error, 'invalid_column')
  assert.equal(validate(`not-a-uuid/${STUDENT}/resume.pdf`, 'resume_url', 'not-a-uuid').ok, false)
  assert.equal(validate(ownPath('resume', 'pdf'), 'resume_url', COHORT, 'not-a-uuid').ok, false)
})

// ── The refusal message ──────────────────────────────────────────────────────────────────────────

test('S-03 write: the refusal is non-technical and names no storage internals', () => {
  const out = validate(`${COHORT}/${OTHER_STUDENT}/resume.pdf`, 'resume_url')
  assert.match(out.message, /upload it again/i)
  assert.doesNotMatch(out.message, /path|bucket|cohort|uuid|canonical|storage|segment/i)
  // Every failure mode gives the same student-facing sentence, so the caller cannot tell which
  // rule they tripped.
  const messages = new Set([
    validate(`${COHORT}/${OTHER_STUDENT}/resume.pdf`, 'resume_url').message,
    validate(`${COHORT}/${STUDENT}/resume.exe`, 'resume_url').message,
    validate('https://x/storage/v1/object/public/student-files/a/b/resume.pdf', 'resume_url').message,
    validate('../../x', 'resume_url').message,
  ])
  assert.equal(messages.size, 1, 'all resume failures must read identically')
})

// ── Never silently rewritten ─────────────────────────────────────────────────────────────────────

test('S-03 write: a mismatch is rejected, never corrected into the canonical path', () => {
  const out = validate(`${COHORT}/${OTHER_STUDENT}/resume.pdf`, 'resume_url')
  assert.equal(out.ok, false)
  assert.equal(out.path, undefined, 'a rejected value must not hand back a usable path')
})

// ── Wiring: all three write paths are bound ──────────────────────────────────────────────────────

test('S-03 write: all three unbound write paths now validate before persisting', () => {
  for (const [file, cohortExpr, studentExpr] of [
    ['api/student-intake-submit.js', 'student.cohort_id', 'student.id'],
    ['api/portal/my-profile.js',     'student.cohort_id', 'student.id'],
    ['api/student-update.js',        'stu.cohort_id',     'stu.id'],
  ]) {
    const src = read(file)
    assert.match(src, /validateStoredFileRefForStudent\(\{/, `${file} must validate`)
    assert.ok(src.includes(`cohortId: ${cohortExpr}`), `${file} must bind to the student's own cohort`)
    assert.ok(src.includes(`studentId: ${studentExpr}`), `${file} must bind to the student's own id`)
    // The raw browser string must no longer be assigned straight through.
    assert.doesNotMatch(src, /(resume_url|headshot_url)\s*=\s*str\(body\.(resume_url|headshot_url)\)/,
      `${file} must not persist the raw supplied value`)
  }
})

test('S-03 write: the server-issued upload path is what a client round-trips', () => {
  // The three signed-upload endpoints build the path with canonicalPath and return it, so a
  // well-behaved client sends back exactly what the new check requires.
  for (const f of ['api/student-file-sign.js', 'api/student-intake-file-sign.js', 'api/portal/my-profile-file-sign.js']) {
    const src = read(f)
    assert.match(src, /canonicalPath\(/, `${f} derives the path server-side`)
    assert.match(src, /path: signed\.path \|\| cp\.path/, `${f} returns it to the client`)
  }
  // And the portal avatar endpoint writes cp.path directly, needing no validation.
  assert.match(read('api/portal/my-avatar.js'), /update\(\{ headshot_url: cp\.path \}\)/)
})

test('S-03 write: no live student data appears in this fixture', () => {
  const self = read('test/s03FileRefWriteBinding.test.mjs')
  assert.doesNotMatch(self, /@cshs\.org/)
  assert.doesNotMatch(self, /\b\d{3}-\d{2}-\d{4}\b/)
  // Every uuid used is a fictional repeating-digit pattern.
  for (const id of self.match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi) || []) {
    assert.match(id, /^(1{8}|2{8}|3{8}|4{8})-/, `${id} must be a fictional id`)
  }
})
