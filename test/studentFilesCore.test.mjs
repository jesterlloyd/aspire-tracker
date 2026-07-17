// WAVE F-2 (Pass 1): guards for the pure student-file core (validation,
// canonical paths, and the legacy-URL/path compatibility resolver).
//
// Run: node --test test/studentFilesCore.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  STUDENT_FILES_BUCKET, FILE_KINDS, FILE_KIND_RULES,
  isUuid, extOf, validateFileMeta, canonicalPath, studentFolderPrefix,
  objectPathFromPublicUrl, parseStoredFileRef,
} from '../lib/server/studentFiles.js'

const C = '11111111-1111-4111-8111-111111111111'
const S = '22222222-2222-4222-8222-222222222222'

test('constants', () => {
  assert.equal(STUDENT_FILES_BUCKET, 'student-files')
  assert.deepEqual(FILE_KINDS, ['resume', 'headshot'])
  assert.equal(FILE_KIND_RULES.resume.maxBytes, 10 * 1024 * 1024)
  assert.equal(FILE_KIND_RULES.headshot.maxBytes, 5 * 1024 * 1024)
})

test('validateFileMeta: resume', () => {
  assert.deepEqual(validateFileMeta({ kind: 'resume', filename: 'cv.pdf', contentType: 'application/pdf', size: 1000 }), { ok: true, ext: 'pdf' })
  assert.deepEqual(validateFileMeta({ kind: 'resume', filename: 'cv.DOCX', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 1000 }), { ok: true, ext: 'docx' })
  assert.equal(validateFileMeta({ kind: 'resume', filename: 'cv.exe', contentType: 'application/pdf', size: 10 }).error, 'invalid_extension')
  assert.equal(validateFileMeta({ kind: 'resume', filename: 'cv.pdf', contentType: 'text/html', size: 10 }).error, 'invalid_content_type')
  assert.equal(validateFileMeta({ kind: 'resume', filename: 'cv.pdf', contentType: 'application/pdf', size: 10 * 1024 * 1024 + 1 }).error, 'file_too_large')
  assert.equal(validateFileMeta({ kind: 'resume', filename: 'cv.pdf', contentType: 'application/pdf', size: 0 }).error, 'invalid_size')
})

test('validateFileMeta: headshot', () => {
  assert.deepEqual(validateFileMeta({ kind: 'headshot', filename: 'me.JPG', contentType: 'image/jpeg', size: 1000 }), { ok: true, ext: 'jpg' })
  assert.deepEqual(validateFileMeta({ kind: 'headshot', filename: 'me.png', contentType: 'image/png', size: 1000 }), { ok: true, ext: 'png' })
  // A headshot may not be a pdf, and a resume mime is rejected for a headshot.
  assert.equal(validateFileMeta({ kind: 'headshot', filename: 'me.pdf', contentType: 'application/pdf', size: 10 }).error, 'invalid_extension')
  assert.equal(validateFileMeta({ kind: 'headshot', filename: 'me.svg', contentType: 'image/svg+xml', size: 10 }).error, 'invalid_extension')
  assert.equal(validateFileMeta({ kind: 'headshot', filename: 'me.jpg', contentType: 'image/jpeg', size: 5 * 1024 * 1024 + 1 }).error, 'file_too_large')
})

test('validateFileMeta: bad kind', () => {
  assert.equal(validateFileMeta({ kind: 'transcript', filename: 'x.pdf', contentType: 'application/pdf', size: 1 }).error, 'invalid_kind')
  assert.equal(validateFileMeta({}).error, 'invalid_kind')
})

test('extOf and isUuid', () => {
  assert.equal(extOf('a.b.PDF'), 'pdf')
  assert.equal(extOf('noext'), '')
  assert.equal(extOf(null), '')
  assert.equal(isUuid(C), true)
  assert.equal(isUuid('not-a-uuid'), false)
  assert.equal(isUuid(''), false)
})

test('canonicalPath: server-derived only', () => {
  assert.deepEqual(canonicalPath(C, S, 'resume', 'pdf'), { ok: true, path: `${C}/${S}/resume.pdf` })
  assert.deepEqual(canonicalPath(C, S, 'headshot', 'png'), { ok: true, path: `${C}/${S}/headshot.png` })
  // Non-uuid ids (a client trying to inject a path) are rejected.
  assert.equal(canonicalPath('../etc', S, 'resume', 'pdf').error, 'invalid_ids')
  assert.equal(canonicalPath(C, S, 'resume', '../x').error, 'invalid_extension')
  assert.equal(canonicalPath(C, S, 'evil', 'pdf').error, 'invalid_kind')
})

test('studentFolderPrefix', () => {
  assert.deepEqual(studentFolderPrefix(C, S), { ok: true, prefix: `${C}/${S}` })
  assert.equal(studentFolderPrefix('x', S).error, 'invalid_ids')
})

test('objectPathFromPublicUrl', () => {
  const base = 'https://proj.supabase.co/storage/v1/object/public/student-files'
  assert.equal(objectPathFromPublicUrl(`${base}/${C}/${S}/resume.pdf`), `${C}/${S}/resume.pdf`)
  // Cache-buster query is stripped.
  assert.equal(objectPathFromPublicUrl(`${base}/${C}/${S}/headshot.jpg?t=123`), `${C}/${S}/headshot.jpg`)
  // A URL-encoded space in a filename is decoded.
  assert.equal(objectPathFromPublicUrl(`${base}/${C}/${S}/resume%20final.pdf`), `${C}/${S}/resume final.pdf`)
  // Not a student-files object URL.
  assert.equal(objectPathFromPublicUrl('https://proj.supabase.co/storage/v1/object/public/avatars/x/a.png'), null)
  assert.equal(objectPathFromPublicUrl('https://example.com/whatever'), null)
  assert.equal(objectPathFromPublicUrl(''), null)
})

test('parseStoredFileRef: the compatibility resolver', () => {
  // Empty.
  assert.deepEqual(parseStoredFileRef(''), { kind: 'empty' })
  assert.deepEqual(parseStoredFileRef(null), { kind: 'empty' })
  assert.deepEqual(parseStoredFileRef('   '), { kind: 'empty' })

  // Legacy public URL -> resolves to a path.
  const url = `https://proj.supabase.co/storage/v1/object/public/student-files/${C}/${S}/resume.pdf`
  assert.deepEqual(parseStoredFileRef(url), { kind: 'legacyPublicUrl', path: `${C}/${S}/resume.pdf`, url })

  // Canonical path.
  assert.deepEqual(parseStoredFileRef(`${C}/${S}/headshot.png`), { kind: 'path', path: `${C}/${S}/headshot.png` })
  assert.deepEqual(parseStoredFileRef(`/${C}/${S}/headshot.png`), { kind: 'path', path: `${C}/${S}/headshot.png` })

  // A URL that is not a student-files object, or a traversal path -> unknown.
  assert.deepEqual(parseStoredFileRef('https://example.com/x'), { kind: 'unknown' })
  assert.deepEqual(parseStoredFileRef('../../etc/passwd'), { kind: 'unknown' })
  assert.deepEqual(parseStoredFileRef('a/b/c/d'), { kind: 'unknown' })
})

test('no em dash or ASPIRE Program in the core module', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../lib/server/studentFiles.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /—/)
  assert.doesNotMatch(src, /ASPIRE Program/)
})
