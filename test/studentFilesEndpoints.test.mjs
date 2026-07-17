// WAVE F-2 (Pass 1): static-source guards for the student-file endpoints. These
// serverless handlers need real Supabase to run, so following the repository
// convention they are verified by source assertions rather than execution.
//
// Run: node --test test/studentFilesEndpoints.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')

const intakeSign = read('../api/student-intake-file-sign.js')
const staffSign = read('../api/student-file-sign.js')
const access = read('../api/student-file-access.js')
const portalAccess = read('../api/portal/student-file-access.js')
const cleanup = read('../api/student-file-cleanup.js')
const all = { intakeSign, staffSign, access, portalAccess, cleanup }

test('every endpoint uses the shared core (one place for path/validation rules)', () => {
  assert.match(intakeSign, /from '\.\.\/lib\/server\/studentFiles\.js'/)
  assert.match(staffSign, /from '\.\.\/lib\/server\/studentFiles\.js'/)
  assert.match(access, /from '\.\.\/lib\/server\/studentFiles\.js'/)
  assert.match(portalAccess, /from '\.\.\/\.\.\/lib\/server\/studentFiles\.js'/)
  assert.match(cleanup, /from '\.\.\/lib\/server\/studentFiles\.js'/)
})

test('the browser never supplies an authoritative path', () => {
  // Paths come only from canonicalPath / studentFolderPrefix (server-derived).
  assert.match(intakeSign, /canonicalPath\(cohortId, studentId, kind, meta\.ext\)/)
  assert.match(staffSign, /canonicalPath\(student\.cohort_id, student\.id, kind, meta\.ext\)/)
  assert.match(cleanup, /studentFolderPrefix\(student\.cohort_id, student\.id\)/)
  // No endpoint reads a path/cohort/folder from the request body.
  for (const [name, s] of Object.entries(all)) {
    assert.doesNotMatch(s, /body\.(path|object_path|storage_path|folder|cohort_id)/, `${name} must not trust a client path/cohort`)
  }
})

test('intake signed upload: anonymous, server-resolved, validated', () => {
  // Same resolver as the existing intake, no JWT.
  assert.match(intakeSign, /resolveAcceptingCohort/)
  assert.match(intakeSign, /resolveStudentByEmail\(db, cohortResult\.cohortId, schoolEmail/)
  assert.match(intakeSign, /validateFileMeta\(\{ kind, filename: body\.filename, contentType: body\.content_type, size: body\.size \}\)/)
  // Preserves re-submit overwrite via upsert; one-path token.
  assert.match(intakeSign, /createSignedUploadUrl\(cp\.path, \{ upsert: true \}\)/)
  // Returns only token + path, no bucket internals.
  assert.match(intakeSign, /return res\.status\(200\)\.json\(\{ token: signed\.token, path: signed\.path \|\| cp\.path \}\)/)
  assert.doesNotMatch(intakeSign, /verifyStaffCaller|Authorization|Bearer/)
})

test('staff signed upload: Owner/Admin only, cohort resolved server-side', () => {
  assert.match(staffSign, /const UPLOAD_ROLES = \['owner', 'admin'\]/)
  assert.match(staffSign, /verifyStaffCaller\(req\)/)
  assert.match(staffSign, /if \(!UPLOAD_ROLES\.includes\(role\)\) return res\.status\(403\)/)
  // Cohort is looked up from the student row, not the client.
  assert.match(staffSign, /from\('students'\)\.select\('id, cohort_id'\)\.eq\('id', studentId\)/)
  assert.match(staffSign, /createSignedUploadUrl\(cp\.path, \{ upsert: true \}\)/)
})

test('access endpoint: the role matrix, server-mediated, short-lived signed URLs', () => {
  // Owner/Admin -> both; Viewer -> headshot only; interviewer/others -> none.
  assert.match(access, /if \(r === 'owner' \|\| r === 'admin'\) return new Set\(\['resume', 'headshot'\]\)/)
  assert.match(access, /if \(r === 'viewer'\) return new Set\(\['headshot'\]\)/)
  assert.match(access, /return new Set\(\) \/\/ interviewer and everything else: none/)
  // Resolves stored value (legacy URL or path) then mints signed URLs.
  assert.match(access, /parseStoredFileRef\(stored\)/)
  assert.match(access, /createSignedUrls\(toSign\.map\(\(t\) => t\.path\), SIGNED_URL_TTL_SECONDS\)/)
  assert.match(access, /const SIGNED_URL_TTL_SECONDS = 300/)
  // Batch supported for list views.
  assert.match(access, /Array\.isArray\(body\.items\)/)
  // Never returns a bucket/path in errors; unauthorized/empty -> null url.
  assert.doesNotMatch(access, /signed_url: ref\.path|bucket_id/)
})

test('access endpoint: never grants an interviewer, and inactive is rejected', () => {
  // Interviewer falls through to the empty set; inactive is denied by
  // verifyStaffCaller before authorization runs.
  assert.doesNotMatch(access, /'interviewer'/)
  assert.match(access, /verifyStaffCaller\(req\)/)
  // No name-string or email-based authorization anywhere.
  assert.doesNotMatch(access, /interviewer_name|interview_assigned_interviewers|\.email/)
})

test('portal access: own headshot only, server-resolved, no resume', () => {
  assert.match(portalAccess, /verifyPortalStudentCaller\(req\)/)
  assert.match(portalAccess, /const studentId = caller\.studentIds\[0\]/)
  assert.match(portalAccess, /select\('id, headshot_url'\)/)
  // No resume column, no student_id from the client.
  assert.doesNotMatch(portalAccess, /resume_url|body\.student_id/)
  assert.match(portalAccess, /createSignedUrl\(ref\.path, SIGNED_URL_TTL_SECONDS\)/)
})

test('cleanup: Owner/Admin, scoped to one student folder, two actions', () => {
  assert.match(cleanup, /const CLEANUP_ROLES = \['owner', 'admin'\]/)
  assert.match(cleanup, /studentFolderPrefix\(student\.cohort_id, student\.id\)/)
  assert.match(cleanup, /action === 'replace' \|\| body\.action === 'delete_student'/)
  // Replace removes only other-extension siblings of the same kind.
  assert.match(cleanup, /name\.startsWith\(`\$\{kind\}\.`\) && name !== keepName/)
  // delete_student removes everything under the resolved folder only.
  assert.match(cleanup, /toRemove = listed\.names/)
})

test('no endpoint changes the bucket or a storage policy (Pass 1 is code-only)', () => {
  for (const [name, s] of Object.entries(all)) {
    assert.doesNotMatch(s, /updateBucket|CREATE POLICY|DROP POLICY|storage\.buckets|public\s*[:=]\s*false/i, `${name} must not touch bucket/policy`)
    // Access is via short-lived signed URLs, never getPublicUrl in the endpoints.
    assert.doesNotMatch(s, /getPublicUrl/, `${name} must not mint public URLs`)
  }
})

test('privacy: no student content or path logged, safe errors', () => {
  for (const [name, s] of Object.entries(all)) {
    assert.doesNotMatch(s, /console\.(log|info|debug)/, `${name}`)
  }
  // The sign endpoints must return { token, path } (transport-necessary for
  // uploadToSignedUrl, as the catalog upload endpoint does); the path there is
  // the object the authorized caller is uploading to. The READ and cleanup
  // endpoints must never return a path/bucket/URL-field to the client.
  for (const [name, s] of Object.entries({ access, portalAccess, cleanup })) {
    assert.doesNotMatch(s, /res\.status\([0-9]+\)\.json\(\{[^}]*\b(path|resume_url|headshot_url|bucket_id|storage_path)\b/, `${name} must not leak a path/bucket`)
  }
})

test('hygiene: no em dash, correct ASPIRE usage', () => {
  for (const [name, s] of Object.entries(all)) {
    assert.doesNotMatch(s, /—/, `${name} em dash`)
    assert.doesNotMatch(s, /ASPIRE Program/, `${name} ASPIRE Program`)
  }
})
